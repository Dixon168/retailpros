// src/lib/pax.js
// PAX 刷卡机直连服务
// 原理：PAX 终端在局域网内开了一个 HTTP 服务（端口 10009）
//       收银机直接往 PAX 的 IP 发 POST 请求触发刷卡
//       PAX 处理完后返回 JSON 结果
//
// 支持机型：A920 / A920Pro / A80 / S300 / E600 / IM30 等所有 PAX HTTP 系列
// 文档参考：PAX HTTP API Specification v3.x

// ── PAX 响应状态码 ──
export const PAX_STATUS = {
  '000000': 'approved',
  '000001': 'partial_approved',  // 部分批准（如礼品卡余额不足）
  '100001': 'declined',
  '100002': 'declined_insufficient_funds',
  '100003': 'declined_limit_exceeded',
  '100004': 'declined_expired_card',
  '100005': 'declined_invalid_card',
  '100006': 'declined_lost_stolen',
  '200001': 'cancelled',         // 用户在 PAX 上按了取消
  '200002': 'timeout',           // PAX 超时（60秒无操作）
  '300001': 'error_no_response',
  '300002': 'error_communication',
}

// ── 发送请求到 PAX ──
// PAX HTTP API: POST http://{ip}:{port}/
// Content-Type: application/json
// Body: { "command": "...", ... }
//
// ⚠️  注意：PAX 在局域网，浏览器直接请求会遇到 CORS 问题
//     解决方案：用 Supabase Edge Function 做中转（见下方 paxProxy）

async function callPax(paxIp, paxPort = 10009, command, params = {}) {
  // 先尝试直连（如果 PAX 固件支持 CORS headers）
  // 如果不支持，走 Edge Function 代理
  const url = `http://${paxIp}:${paxPort}/`

  const body = JSON.stringify({ command, ...params })

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(65_000), // PAX 最长60秒，留5秒余量
    })
  } catch (err) {
    // 直连失败（CORS 或网络）→ 走代理
    if (err.name === 'TypeError' || err.name === 'AbortError') {
      return callPaxViaProxy(paxIp, paxPort, command, params)
    }
    throw err
  }

  const data = await response.json()
  return normalizePaxResponse(data)
}

// ── Supabase Edge Function 代理（解决 CORS 问题）──
// 部署见：supabase/functions/pax-proxy/index.ts
async function callPaxViaProxy(paxIp, paxPort, command, params) {
  const { supabase } = await import('./supabase')

  const { data, error } = await supabase.functions.invoke('pax-proxy', {
    body: { paxIp, paxPort, command, params }
  })

  if (error) throw new Error(`PAX proxy error: ${error.message}`)
  return normalizePaxResponse(data)
}

// ── 统一响应格式 ──
function normalizePaxResponse(raw) {
  const statusCode = raw?.ResultCode || raw?.status_code || raw?.ResponseCode || '300001'
  const status = PAX_STATUS[statusCode] || 'error_unknown'

  return {
    success:       status === 'approved' || status === 'partial_approved',
    status,
    statusCode,
    // 批准信息
    approvalCode:  raw?.ApprovalCode  || raw?.approval_code  || null,
    authCode:      raw?.AuthCode      || raw?.auth_code      || null,
    // 卡信息（脱敏）
    cardType:      raw?.CardType      || raw?.card_type      || null, // VISA / MC / AMEX / DISC
    maskedPan:     raw?.MaskedPan     || raw?.masked_pan     || null, // ****1234
    cardHolder:    raw?.CardHolder    || raw?.card_holder    || null,
    entryMode:     raw?.EntryMode     || raw?.entry_mode     || null, // CHIP / TAP / SWIPE / MANUAL
    // 金额
    approvedAmount: parseFloat(raw?.ApprovedAmt || raw?.approved_amount || '0') / 100,
    // 收据信息
    refNum:        raw?.RefNum        || raw?.ref_num        || null,
    traceNum:      raw?.TraceNum      || raw?.trace_num      || null,
    // 原始响应（调试用）
    _raw: raw,
  }
}

// ══════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════

/**
 * paxSale — 发起销售（刷卡/插卡/NFC）
 *
 * @param {string}  paxIp      PAX 机器 IP
 * @param {number}  paxPort    端口（默认 10009）
 * @param {number}  amountCents 金额（分，如 $12.50 = 1250）
 * @param {string}  [invoiceNum] 订单号（显示在 PAX 屏幕和收据上）
 */
export async function paxSale({ paxIp, paxPort = 10009, amountCents, invoiceNum = '' }) {
  return callPax(paxIp, paxPort, 'T00',  {   // T00 = Sale
    Amount:     String(amountCents).padStart(12, '0'),
    InvoiceNum: invoiceNum,
    ECRRefNum:  invoiceNum,
  })
}

/**
 * paxVoid — 撤销/取消最近一笔交易
 */
export async function paxVoid({ paxIp, paxPort = 10009, origRefNum, origTraceNum }) {
  return callPax(paxIp, paxPort, 'T02', {    // T02 = Void
    OrigRefNum:   origRefNum,
    OrigTraceNum: origTraceNum,
  })
}

/**
 * paxRefund — 退款
 */
export async function paxRefund({ paxIp, paxPort = 10009, amountCents, origRefNum }) {
  return callPax(paxIp, paxPort, 'T01', {    // T01 = Return/Refund
    Amount:     String(amountCents).padStart(12, '0'),
    OrigRefNum: origRefNum,
  })
}

/**
 * paxBatchClose — 批次结算（每天营业结束时调用）
 */
export async function paxBatchClose({ paxIp, paxPort = 10009 }) {
  return callPax(paxIp, paxPort, 'B00', {})  // B00 = BatchClose
}

/**
 * paxGetStatus — 检查 PAX 是否在线/就绪
 */
export async function paxGetStatus({ paxIp, paxPort = 10009 }) {
  try {
    const result = await callPax(paxIp, paxPort, 'A00', {}) // A00 = Initialize
    return { online: true, ...result }
  } catch {
    return { online: false }
  }
}

/**
 * paxCancel — 取消当前正在进行的交易（PAX 屏幕上取消）
 */
export async function paxCancel({ paxIp, paxPort = 10009 }) {
  return callPax(paxIp, paxPort, 'A14', {})  // A14 = CancelTrans
}

// ── 金额转换工具 ──
export const dollarsToCents = (dollars) => Math.round(dollars * 100)
export const centsToDollars = (cents)   => cents / 100
