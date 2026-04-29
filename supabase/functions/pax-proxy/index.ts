// supabase/functions/pax-proxy/index.ts
// PAX 代理 Edge Function
// 部署：supabase functions deploy pax-proxy
//
// 为什么需要这个：
//   浏览器直接请求局域网 PAX IP 会遇到 CORS 限制
//   Edge Function 运行在服务器端，不受 CORS 限制
//   但注意：Edge Function 运行在 Supabase 云端，无法直接访问局域网 IP
//
// 真正的解法选项：
//   A) 在同一局域网的收银机上运行一个小 Node.js 中间件（推荐）
//   B) PAX 固件配置允许 CORS（部分型号支持）
//   C) Electron 客户端（不受浏览器 CORS 限制）
//
// 本文件是方案 A 的 Edge Function 部分，
// 配合 src/lib/pax-local-proxy.js 的本地 Node 服务使用

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const { paxIp, paxPort = 10009, command, params } = await req.json()

    if (!paxIp) {
      return new Response(
        JSON.stringify({ error: 'paxIp is required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // 验证 IP 格式（防止 SSRF 攻击）
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/
    if (!ipRegex.test(paxIp)) {
      return new Response(
        JSON.stringify({ error: 'Invalid IP address' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // 转发请求到 PAX
    const paxUrl = `http://${paxIp}:${paxPort}/`
    const paxResponse = await fetch(paxUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ command, ...params }),
      // Deno fetch 没有 AbortSignal.timeout，用 setTimeout 模拟
    })

    const paxData = await paxResponse.json()

    return new Response(
      JSON.stringify(paxData),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, ResultCode: '300002' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})
