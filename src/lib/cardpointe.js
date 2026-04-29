// src/lib/cardpointe.js
// CardPointe / CardConnect API 完整封装
// 文档：https://developer.cardpointe.com/cardpointe-api

const ENDPOINTS = {
  production: 'https://fts.cardconnect.com',
  sandbox:    'https://fts-uat.cardconnect.com',
}

// ── 从数据库读取商家的 CardPointe 配置 ──
async function getConfig(tenantId) {
  const { supabase } = await import('./supabase')
  const { data } = await supabase
    .from('payment_configs')
    .select('cp_merchant_id, cp_username, cp_password, cp_endpoint, is_configured')
    .eq('tenant_id', tenantId)
    .single()
  if (!data?.is_configured) throw new Error('Card payment not configured. Contact RetailPOS support.')
  return data
}

// ── 基础请求 ──
async function request(endpoint, username, password, path, method = 'GET', body = null) {
  const credentials = btoa(`${username}:${password}`)
  const url = `${endpoint}/cardconnect/rest/${path}`

  const options = {
    method,
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/json',
    },
    signal: AbortSignal.timeout(65_000),
  }
  if (body) options.body = JSON.stringify(body)

  const res = await fetch(url, options)
  if (!res.ok) throw new Error(`CardPointe API error: ${res.status} ${res.statusText}`)
  return res.json()
}

// ── 金额格式（CardPointe 用字符串，单位是 dollars，如 "12.50"）──
const fmtAmt = (dollars) => Number(dollars).toFixed(2)

// ── 响应码判断 ──
const isApproved = (respcode) => respcode === '00' || respcode === '000'

// ══════════════════════════════════════════════════════════════
// 商家 POS 收费 API（钱进商家账户）
// ══════════════════════════════════════════════════════════════

/**
 * authorize — 授权收款（CardPointe Terminal API，控制 PAX 刷卡）
 * @param {string} tenantId
 * @param {string} terminalHsn   PAX 的 HSN（硬件序列号）或 IP
 * @param {number} amount        金额（dollars）
 * @param {string} orderRef      订单号（显示在 PAX 屏幕）
 * @param {string} [token]       补收时用已存的 token
 */
export async function cpAuthorize({ tenantId, terminalHsn, amount, orderRef, token = null }) {
  const cfg = await getConfig(tenantId)

  const body = {
    merchantid: cfg.cp_merchant_id,
    amount:     fmtAmt(amount),
    orderid:    orderRef,
    capture:    'Y',             // 立即 capture，不需要单独 capture 步骤
    tokenize:   'Y',             // 存 token，补收时用
  }

  // 如果有 token（补收），用 token 代替刷卡
  if (token) {
    body.account = token
  } else {
    // 通过 CardPointe Terminal API 触发 PAX 刷卡
    body.hsn = terminalHsn      // PAX HSN
  }

  const data = await request(
    cfg.cp_endpoint, cfg.cp_username, cfg.cp_password,
    'auth', 'POST', body
  )

  return normalizeResponse(data, amount)
}

/**
 * void — 作废（仅限未结算交易）
 * @param {string} tenantId
 * @param {string} retref     原交易的 cp_retref
 * @param {number} amount     金额（用于验证）
 */
export async function cpVoid({ tenantId, retref, amount }) {
  const cfg = await getConfig(tenantId)

  const data = await request(
    cfg.cp_endpoint, cfg.cp_username, cfg.cp_password,
    'void', 'POST', {
      merchantid: cfg.cp_merchant_id,
      retref,
      amount: fmtAmt(amount),
    }
  )

  return normalizeResponse(data, amount)
}

/**
 * refund — 退款（已结算交易）
 * @param {string} tenantId
 * @param {string} retref     原交易的 cp_retref
 * @param {number} amount     退款金额（可以少于原交易金额）
 */
export async function cpRefund({ tenantId, retref, amount }) {
  const cfg = await getConfig(tenantId)

  const data = await request(
    cfg.cp_endpoint, cfg.cp_username, cfg.cp_password,
    'refund', 'POST', {
      merchantid: cfg.cp_merchant_id,
      retref,
      amount: fmtAmt(amount),
    }
  )

  return normalizeResponse(data, amount)
}

/**
 * batchClose — 批次结算
 * @param {string} tenantId
 */
export async function cpBatchClose({ tenantId }) {
  const cfg = await getConfig(tenantId)

  const data = await request(
    cfg.cp_endpoint, cfg.cp_username, cfg.cp_password,
    'close', 'POST', {
      merchantid: cfg.cp_merchant_id,
    }
  )

  return {
    success:   data.respstat === 'A',
    batchId:   data.batchid,
    respText:  data.resptext,
    raw:       data,
  }
}

/**
 * inquire — 查询交易状态
 * @param {string} tenantId
 * @param {string} retref
 */
export async function cpInquire({ tenantId, retref }) {
  const cfg = await getConfig(tenantId)

  const data = await request(
    cfg.cp_endpoint, cfg.cp_username, cfg.cp_password,
    `inquire/${cfg.cp_merchant_id}/${retref}`, 'GET'
  )

  return normalizeResponse(data, parseFloat(data.amount || 0))
}

// ══════════════════════════════════════════════════════════════
// 平台收费 API（收商家订阅费，钱进你的账户）
// ══════════════════════════════════════════════════════════════

async function getPlatformConfig() {
  const { supabase } = await import('./supabase')
  const { data } = await supabase
    .from('platform_payment_config')
    .select('*')
    .single()
  if (!data?.cp_merchant_id) throw new Error('Platform payment not configured')
  return data
}

/**
 * platformCharge — 向商家收订阅费
 * @param {string} token      商家存储的信用卡 token
 * @param {number} amount     订阅金额
 * @param {string} tenantName 商家名称（订单备注）
 * @param {string} period     账单周期，如 '2024-01'
 */
export async function platformCharge({ token, amount, tenantName, period }) {
  const cfg = await getPlatformConfig()

  const data = await request(
    cfg.cp_endpoint, cfg.cp_username, cfg.cp_password,
    'auth', 'POST', {
      merchantid: cfg.cp_merchant_id,
      account:    token,
      amount:     fmtAmt(amount),
      orderid:    `SUB-${period}-${Date.now()}`,
      name:       tenantName,
      capture:    'Y',
      tokenize:   'Y',
    }
  )

  return normalizeResponse(data, amount)
}

/**
 * platformTokenize — 存储商家信用卡 token（订阅时调用）
 * @param {string} account    卡号或 PAX 刷卡后的加密数据
 * @param {string} expiry     MMYY
 * @param {string} cvv
 */
export async function platformTokenize({ account, expiry, cvv }) {
  const cfg = await getPlatformConfig()

  // 用 $0 auth 来 tokenize
  const data = await request(
    cfg.cp_endpoint, cfg.cp_username, cfg.cp_password,
    'auth', 'POST', {
      merchantid: cfg.cp_merchant_id,
      account,
      expiry,
      cvv2:    cvv,
      amount:  '0.00',
      tokenize: 'Y',
      capture:  'N',
    }
  )

  if (!isApproved(data.respcode)) {
    throw new Error(data.resptext || 'Card tokenization failed')
  }

  return {
    token:      data.token,
    maskedPan:  data.token?.slice(-4) ? `****${data.token.slice(-4)}` : null,
    expiry:     data.expiry,
    cardType:   data.bintype,
  }
}

// ── 统一响应格式 ──
function normalizeResponse(raw, amount) {
  const approved = isApproved(raw.respcode)
  return {
    success:      approved,
    approved,
    // CardPointe 字段
    retref:       raw.retref,
    authcode:     raw.authcode,
    token:        raw.token,
    respcode:     raw.respcode,
    resptext:     raw.resptext,
    // 卡信息
    cardType:     raw.bintype   || raw.cardproc,
    maskedPan:    raw.account   ? `****${raw.account.slice(-4)}` : null,
    cardHolder:   raw.name,
    entryMode:    raw.entrymode,
    // 金额
    amount:       parseFloat(raw.amount || amount),
    // 错误
    errorMessage: approved ? null : (raw.resptext || 'Transaction declined'),
    // 原始响应（调试用）
    _raw: raw,
  }
}
