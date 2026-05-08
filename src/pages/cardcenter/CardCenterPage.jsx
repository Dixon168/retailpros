// src/pages/cardcenter/CardCenterPage.jsx
// 信用卡中心 — 交易管理、Void、Batch Close

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
import { cpVoid, cpBatchClose } from '@/lib/cardpointe'
import { format, startOfDay, endOfDay, subDays } from 'date-fns'
import toast from 'react-hot-toast'

const TX_STATUS = {
  authorized:          { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6', label: 'AUTH' },
  settled:             { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', label: 'SETTLED' },
  voided:              { bg: 'rgba(61,80,104,0.2)',    color: '#666666', label: 'VOIDED' },
  refunded:            { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', label: 'REFUNDED' },
  partially_refunded:  { bg: 'rgba(20,184,166,0.12)',  color: '#14b8a6', label: 'PART.REF' },
  declined:            { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', label: 'DECLINED' },
}

export default function CardCenterPage() {
  const { tenant, user, can } = useAuthStore()
  const { terminal } = useTerminalStore()
  const qc = useQueryClient()

  const [tab,           setTab]           = useState('transactions') // transactions|batches
  const [datePreset,    setDatePreset]    = useState('today')
  const [terminalFilter,setTerminalFilter]= useState('all')
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [voidConfirm,   setVoidConfirm]   = useState(null) // tx to void
  const [batchConfirm,  setBatchConfirm]  = useState(false)
  const [pinInput,      setPinInput]      = useState('')
  const [pinFor,        setPinFor]        = useState(null) // 'void' | 'batch'

  const needsVoidAuth   = !can('can_void')
  const needsBatchAuth  = !can('can_void') // same permission

  const dateFrom = datePreset === 'today'  ? startOfDay(new Date()) :
                   datePreset === '3days'  ? startOfDay(subDays(new Date(), 3)) :
                   datePreset === 'week'   ? startOfDay(subDays(new Date(), 7)) : null
  const dateTo = endOfDay(new Date())

  // ── Load terminals ──
  const { data: terminals = [] } = useQuery({
    queryKey: ['terminals', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('terminals')
        .select('id, name').eq('tenant_id', tenant.id).eq('is_active', true)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // ── Load transactions ──
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['card-transactions', tenant?.id, datePreset, terminalFilter, statusFilter],
    queryFn: async () => {
      let q = supabase.from('card_transactions')
        .select('*, orders(order_number), terminals(name), users(name)')
        .eq('tenant_id', tenant.id)
      if (terminalFilter !== 'all') q = q.eq('terminal_id', terminalFilter)
      if (statusFilter   !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom) q = q.gte('authorized_at', dateFrom.toISOString())
      if (dateTo)   q = q.lte('authorized_at', dateTo.toISOString())
      const { data } = await q.order('authorized_at', { ascending: false }).limit(200)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // ── Load batch closes ──
  const { data: batches = [] } = useQuery({
    queryKey: ['batch-closes', tenant?.id, terminalFilter],
    queryFn: async () => {
      let q = supabase.from('batch_closes')
        .select('*').eq('tenant_id', tenant.id)
      if (terminalFilter !== 'all') q = q.eq('terminal_id', terminalFilter)
      const { data } = await q.order('closed_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: !!tenant?.id && tab === 'batches',
  })

  // ── Summaries ──
  const totalAuth     = transactions.filter(t => t.status === 'authorized').reduce((s,t) => s+t.amount, 0)
  const totalSettled  = transactions.filter(t => t.status === 'settled').reduce((s,t) => s+t.amount, 0)
  const totalVoided   = transactions.filter(t => t.status === 'voided').reduce((s,t) => s+t.amount, 0)
  const totalRefunded = transactions.filter(t => ['refunded','partially_refunded'].includes(t.status)).reduce((s,t) => s+(t.refunded_amount||t.amount), 0)

  // ── Void handler ──
  const handleVoid = async (tx, authorizedBy = user) => {
    try {
      const result = await cpVoid({ tenantId: tenant.id, retref: tx.cp_retref, amount: tx.amount })
      if (!result.success) { toast.error(`Void failed: ${result.errorMessage}`); return }

      await supabase.from('card_transactions').update({
        status:         'voided',
        voided_by:      authorizedBy.id,
        voided_by_name: authorizedBy.name,
        voided_at:      new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      }).eq('id', tx.id)

      toast.success(`Voided: ${tx.masked_pan} $${tx.amount.toFixed(2)}`)
      setVoidConfirm(null)
      setPinInput('')
      setPinFor(null)
      qc.invalidateQueries(['card-transactions'])
    } catch (err) {
      toast.error(`Error: ${err.message}`)
    }
  }

  // ── Batch close handler ──
  const handleBatchClose = async (authorizedBy = user) => {
    try {
      const termId   = terminalFilter === 'all' ? terminal?.id : terminalFilter
      const termName = terminals.find(t => t.id === termId)?.name || terminal?.name || 'Unknown'

      const result = await cpBatchClose({ tenantId: tenant.id })

      const batchRecord = {
        tenant_id:         tenant.id,
        terminal_id:       termId,
        terminal_name:     termName,
        batch_date:        format(new Date(), 'yyyy-MM-dd'),
        triggered_by:      'manual',
        triggered_by_user: authorizedBy.id,
        triggered_by_name: authorizedBy.name,
        cp_batchid:        result.batchId,
        cp_resptext:       result.respText,
        total_sales:       totalAuth + totalSettled,
        total_refunds:     totalRefunded,
        total_voids:       totalVoided,
        net_amount:        totalAuth + totalSettled - totalRefunded,
        transaction_count: transactions.filter(t => t.status !== 'declined').length,
        status:            result.success ? 'success' : 'failed',
      }

      const { data: batch } = await supabase
        .from('batch_closes').insert(batchRecord).select().single()

      // Mark transactions as settled
      if (result.success && batch) {
        await supabase.rpc('fn_settle_batch_transactions', {
          p_batch_id:    batch.id,
          p_tenant_id:   tenant.id,
          p_terminal_id: termId,
        })
      }

      toast.success(result.success ? 'Batch closed successfully ✓' : `Batch close failed: ${result.respText}`)
      setBatchConfirm(false)
      setPinInput('')
      setPinFor(null)
      qc.invalidateQueries(['card-transactions'])
      qc.invalidateQueries(['batch-closes'])
    } catch (err) {
      toast.error(`Error: ${err.message}`)
    }
  }

  // ── PIN verify ──
  const verifyPin = async () => {
    const { data: u } = await supabase.from('users')
      .select('id, name, permissions, role')
      .eq('tenant_id', tenant.id)
      .eq('pin', pinInput)
      .eq('is_active', true)
      .maybeSingle()

    const hasPerm = u && (u.role === 'owner' || u.role === 'manager' || u.permissions?.can_void)
    if (!hasPerm) {
      toast.error('Invalid PIN or no permission')
      setPinInput('')
      return
    }

    if (pinFor === 'void' && voidConfirm) await handleVoid(voidConfirm, u)
    if (pinFor === 'batch')               await handleBatchClose(u)
  }

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA]">

      {/* Header */}
      <div className="px-6 py-4 bg-[#FFFFFF] border-b border-[#E5E5E5] flex items-center gap-4 flex-shrink-0">
        <div className="text-[18px] font-bold">💳 Card Center</div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[7px] overflow-hidden">
          {[['transactions','Transactions'],['batches','Batch History']].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-[11px] transition-all ${
                tab === id ? 'bg-[#F5F5F5] text-white' : 'text-[#666666] hover:text-[#1F1F1F]'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-2 ml-4">
          {/* Date */}
          {tab === 'transactions' && (
            <div className="flex gap-1">
              {[['today','Today'],['3days','3d'],['week','7d'],['all','All']].map(([id,label]) => (
                <button key={id} onClick={() => setDatePreset(id)}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] border transition-all ${
                    datePreset === id
                      ? 'border-blue-500/40 bg-[#006AFF]/8 text-[#006AFF]'
                      : 'border-[#E5E5E5] bg-[#F5F5F5] text-[#666666]'
                  }`}>{label}
                </button>
              ))}
            </div>
          )}

          {/* Terminal */}
          <select value={terminalFilter} onChange={e => setTerminalFilter(e.target.value)}
            className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-2.5 py-1.5
              text-[11px] text-[#1F1F1F] outline-none">
            <option value="all">All Terminals</option>
            {terminals.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          {/* Status */}
          {tab === 'transactions' && (
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-2.5 py-1.5
                text-[11px] text-[#1F1F1F] outline-none">
              <option value="all">All Status</option>
              {Object.entries(TX_STATUS).map(([k,v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1"/>

        {/* Batch close button */}
        {tab === 'transactions' && (
          <button
            onClick={() => { setBatchConfirm(true); if (needsBatchAuth) setPinFor('batch') }}
            className="bg-[#006AFF] border-none
              rounded-lg px-4 py-2 text-[12px] font-bold text-white">
            🔒 Batch Close
          </button>
        )}
      </div>

      {/* Summary row */}
      {tab === 'transactions' && (
        <div className="grid grid-cols-4 border-b border-[#E5E5E5] flex-shrink-0">
          {[
            ['Authorized', `$${totalAuth.toFixed(2)}`,     '#3b82f6', transactions.filter(t=>t.status==='authorized').length],
            ['Settled',    `$${totalSettled.toFixed(2)}`,  '#10b981', transactions.filter(t=>t.status==='settled').length],
            ['Voided',     `$${totalVoided.toFixed(2)}`,   '#666666', transactions.filter(t=>t.status==='voided').length],
            ['Refunded',   `$${totalRefunded.toFixed(2)}`, '#14b8a6', transactions.filter(t=>['refunded','partially_refunded'].includes(t.status)).length],
          ].map(([l,v,c,count]) => (
            <div key={l} className="px-5 py-3 border-r border-[#E5E5E5] last:border-0 bg-[#FFFFFF]">
              <div className="text-[9px] font-mono text-[#999999] uppercase tracking-wider mb-1">
                {l} ({count})
              </div>
              <div className="text-[18px] font-bold" style={{ color: c }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-auto">

        {/* Transactions tab */}
        {tab === 'transactions' && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F5F5F5] border-b border-[#E5E5E5]">
                {['Time','Terminal','Order','Card','Amount','Status','Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-mono text-[10px]
                    text-[#999999] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array(6).fill(0).map((_,i) => (
                    <tr key={i} className="border-b border-[#E5E5E5]">
                      {Array(7).fill(0).map((_,j) => (
                        <td key={j} className="px-4 py-4">
                          <div className="h-3 bg-[#F5F5F5] rounded animate-pulse"/>
                        </td>
                      ))}
                    </tr>
                  ))
                : transactions.map(tx => {
                    const ss = TX_STATUS[tx.status] || TX_STATUS.authorized
                    const canVoid = tx.status === 'authorized'   // not settled
                    const canRefund = tx.status === 'settled'
                    return (
                      <tr key={tx.id}
                        className="border-b border-[#E5E5E5] hover:bg-[#F5F5F5] transition-colors">
                        <td className="px-4 py-3 text-[11px] text-[#666666] font-mono">
                          {format(new Date(tx.authorized_at), 'MM/dd HH:mm')}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-[#666666]">
                          {tx.terminals?.name || tx.terminal_name || '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-[#006AFF]">
                          {tx.orders?.order_number || tx.order_number || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[12px] font-bold">{tx.card_type} {tx.masked_pan}</div>
                          <div className="text-[10px] font-mono text-[#999999]">
                            {tx.entry_mode} · Auth: {tx.cp_authcode || '—'}
                          </div>
                          {tx.refunded_amount > 0 && (
                            <div className="text-[10px] font-mono text-[#00B23B]">
                              Refunded: ${tx.refunded_amount.toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[13px] font-bold">
                          ${tx.amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded"
                            style={{ background: ss.bg, color: ss.color }}>
                            {ss.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            {canVoid && (
                              <button
                                onClick={() => {
                                  setVoidConfirm(tx)
                                  if (needsVoidAuth) setPinFor('void')
                                }}
                                className="bg-red-500/10 border border-red-500/20 rounded px-2 py-1
                                  text-[10px] text-[#CF1322] hover:bg-red-500/15 transition-colors">
                                Void
                              </button>
                            )}
                            {canRefund && (
                              <button
                                onClick={() => toast.success('Opening refund panel')}
                                className="bg-green-500/10 border border-green-500/20 rounded px-2 py-1
                                  text-[10px] text-[#00B23B] hover:bg-green-500/15 transition-colors">
                                Refund
                              </button>
                            )}
                            {!canVoid && !canRefund && (
                              <span className="text-[10px] text-[#999999]">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        )}

        {/* Batch history tab */}
        {tab === 'batches' && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F5F5F5] border-b border-[#E5E5E5]">
                {['Date','Terminal','Triggered By','Sales','Refunds','Voids','Net','Txns','Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-mono text-[10px]
                    text-[#999999] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batches.map(batch => (
                <tr key={batch.id} className="border-b border-[#E5E5E5] hover:bg-[#F5F5F5]">
                  <td className="px-4 py-3 font-mono text-[11px]">
                    {format(new Date(batch.closed_at), 'MMM d, yyyy HH:mm')}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-[#666666]">{batch.terminal_name || '—'}</td>
                  <td className="px-4 py-3 text-[11px]">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded mr-1"
                      style={{ background: batch.triggered_by === 'auto' ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)',
                               color: batch.triggered_by === 'auto' ? '#3b82f6' : '#10b981' }}>
                      {batch.triggered_by === 'auto' ? 'AUTO' : 'MANUAL'}
                    </span>
                    {batch.triggered_by_name || '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#00B23B]">${batch.total_sales?.toFixed(2)}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#CF1322]">-${batch.total_refunds?.toFixed(2)}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#666666]">-${batch.total_voids?.toFixed(2)}</td>
                  <td className="px-4 py-3 font-mono text-[13px] font-bold">${batch.net_amount?.toFixed(2)}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{batch.transaction_count}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded ${
                      batch.status === 'success' ? 'bg-green-500/10 text-[#00B23B]' : 'bg-red-500/10 text-[#CF1322]'
                    }`}>
                      {batch.status?.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Void confirm modal ── */}
      {voidConfirm && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm z-50
          flex items-center justify-center">
          <div className="bg-[#FFFFFF] border border-red-500/30 rounded-2xl w-[380px] p-6">
            {!pinFor || !needsVoidAuth ? (
              <>
                <div className="text-[15px] font-bold mb-1">⚠️ Confirm Void</div>
                <div className="text-[12px] text-[#666666] mb-4">
                  This will void the following transaction. This cannot be undone.
                </div>
                <div className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] p-3.5 mb-5">
                  <div className="text-[13px] font-bold">{voidConfirm.card_type} {voidConfirm.masked_pan}</div>
                  <div className="text-[11px] text-[#666666] mt-1">
                    ${voidConfirm.amount.toFixed(2)} · Auth: {voidConfirm.cp_authcode}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setVoidConfirm(null); setPinFor(null) }}
                    className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] py-2.5 text-[13px] text-[#666666]">
                    Cancel
                  </button>
                  <button onClick={() => handleVoid(voidConfirm)}
                    className="flex-[2] bg-red-500 border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white">
                    ✓ Void Transaction
                  </button>
                </div>
              </>
            ) : (
              // PIN required
              <PinInput
                title="Authorize Void"
                subtitle={`$${voidConfirm.amount.toFixed(2)} · ${voidConfirm.masked_pan}`}
                value={pinInput}
                onChange={setPinInput}
                onConfirm={verifyPin}
                onCancel={() => { setVoidConfirm(null); setPinFor(null); setPinInput('') }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Batch close confirm ── */}
      {batchConfirm && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm z-50
          flex items-center justify-center">
          <div className="bg-[#FFFFFF] border border-blue-500/30 rounded-2xl w-[400px] p-6">
            {!needsBatchAuth ? (
              <>
                <div className="text-[15px] font-bold mb-1">🔒 Batch Close</div>
                <div className="text-[12px] text-[#666666] mb-4">
                  This will settle all authorized transactions. Transactions cannot be voided after batch close.
                </div>
                <div className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] p-3.5 mb-5">
                  {[
                    ['Transactions', transactions.filter(t=>t.status==='authorized').length],
                    ['Total to Settle', `$${totalAuth.toFixed(2)}`],
                  ].map(([l,v]) => (
                    <div key={l} className="flex justify-between mb-1.5 last:mb-0">
                      <span className="text-[12px] text-[#666666]">{l}</span>
                      <span className="font-mono text-[12px] font-bold">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setBatchConfirm(false)}
                    className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] py-2.5 text-[13px] text-[#666666]">
                    Cancel
                  </button>
                  <button onClick={() => handleBatchClose()}
                    className="flex-[2] bg-[#006AFF] border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white">
                    ✓ Close Batch
                  </button>
                </div>
              </>
            ) : (
              <PinInput
                title="Authorize Batch Close"
                subtitle="Manager or owner PIN required"
                value={pinInput}
                onChange={setPinInput}
                onConfirm={verifyPin}
                onCancel={() => { setBatchConfirm(false); setPinInput('') }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PinInput({ title, subtitle, value, onChange, onConfirm, onCancel }) {
  return (
    <div className="text-center">
      <div className="text-2xl mb-2">🔐</div>
      <div className="text-[14px] font-bold mb-1">{title}</div>
      <div className="text-[11px] text-[#666666] mb-4">{subtitle}</div>
      <div className="grid grid-cols-3 gap-2 max-w-[180px] mx-auto mb-3">
        {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k,i) => (
          <button key={i}
            onClick={() => {
              if (k === '⌫') onChange(p => p.slice(0,-1))
              else if (k !== '') onChange(p => p.length < 6 ? p + k : p)
            }}
            className={`py-2.5 rounded-lg font-mono text-[15px] font-bold transition-all
              ${k==='' ? 'invisible' : 'bg-[#F5F5F5] border border-[#E5E5E5] hover:bg-[#F5F5F5]'}`}>
            {k}
          </button>
        ))}
      </div>
      <div className="font-mono text-[18px] tracking-widest mb-4 h-7">
        {'●'.repeat(value.length)}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] py-2.5 text-[12px] text-[#666666]">
          Cancel
        </button>
        <button onClick={onConfirm} disabled={value.length < 4}
          className="flex-[2] bg-[#006AFF] border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white disabled:opacity-40">
          Authorize
        </button>
      </div>
    </div>
  )
}
