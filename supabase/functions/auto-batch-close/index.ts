// supabase/functions/auto-batch-close/index.ts
// 自动 Batch Close — 每天凌晨由 pg_cron 触发
// 部署命令：supabase functions deploy auto-batch-close
//
// pg_cron 设置（在 Supabase SQL Editor 执行）：
// SELECT cron.schedule(
//   'auto-batch-close',
//   '0 2 * * *',   -- 每天 UTC 02:00
//   $$
//   SELECT net.http_post(
//     url := 'https://YOUR_PROJECT.supabase.co/functions/v1/auto-batch-close',
//     headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
//     body := '{}'::jsonb
//   );
//   $$
// );

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  // Service role key — allows bypassing RLS
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const results: Record<string, string> = {}

  try {
    // 1. Get all tenants that have auto batch close enabled
    const { data: configs } = await supabase
      .from('payment_configs')
      .select('tenant_id, cp_merchant_id, cp_username, cp_password, cp_endpoint, auto_batch_close_time')
      .eq('auto_batch_close', true)
      .eq('is_configured', true)

    if (!configs?.length) {
      return new Response(JSON.stringify({ message: 'No tenants to process' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const currentHour = new Date().toISOString().slice(11, 16) // HH:MM UTC

    for (const cfg of configs) {
      // Check if it's this tenant's batch close time
      if (cfg.auto_batch_close_time !== currentHour) continue

      try {
        // Get all terminals for this tenant that have authorized transactions
        const { data: terminals } = await supabase
          .from('terminals')
          .select('id, name')
          .eq('tenant_id', cfg.tenant_id)
          .eq('is_active', true)

        for (const terminal of terminals || []) {
          // Check if there are any authorized transactions for this terminal
          const { count } = await supabase
            .from('card_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', cfg.tenant_id)
            .eq('terminal_id', terminal.id)
            .eq('status', 'authorized')

          if (!count || count === 0) continue

          // Call CardPointe batch close API
          const credentials = btoa(`${cfg.cp_username}:${cfg.cp_password}`)
          const paxRes = await fetch(`${cfg.cp_endpoint}/cardconnect/rest/close`, {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${credentials}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({ merchantid: cfg.cp_merchant_id }),
          })
          const paxData = await paxRes.json()
          const success = paxData.respstat === 'A'

          // Record batch close
          const { data: batch } = await supabase
            .from('batch_closes')
            .insert({
              tenant_id:         cfg.tenant_id,
              terminal_id:       terminal.id,
              terminal_name:     terminal.name,
              batch_date:        new Date().toISOString().slice(0, 10),
              triggered_by:      'auto',
              cp_batchid:        paxData.batchid,
              cp_resptext:       paxData.resptext,
              status:            success ? 'success' : 'failed',
              error_message:     success ? null : paxData.resptext,
            })
            .select()
            .single()

          // Mark transactions as settled
          if (success && batch) {
            await supabase.rpc('fn_settle_batch_transactions', {
              p_batch_id:    batch.id,
              p_tenant_id:   cfg.tenant_id,
              p_terminal_id: terminal.id,
            })
          }

          results[`${cfg.tenant_id}:${terminal.name}`] = success ? 'success' : 'failed'
        }
      } catch (err) {
        results[cfg.tenant_id] = `error: ${err.message}`
      }
    }

    return new Response(JSON.stringify({ processed: Object.keys(results).length, results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
