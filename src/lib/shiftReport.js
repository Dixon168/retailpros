// src/lib/shiftReport.js
// Generate a printable shift report (3 1/8" / 80mm thermal receipt format)
// covering all order/payment activity since the shift opened.

import { supabase } from './supabase'
import { printReceipt } from './receipt'

const PAY_LABEL = {
  cash:          'Cash',
  card:          'Card',
  credit_card:   'Credit Card',
  debit_card:    'Debit Card',
  check:         'Check',
  bank_transfer: 'Bank Transfer',
  member_card:   'VIP / Member Card',
  gift_card:     'Gift Card',
  on_account:    'On Account',
  other:         'Other',
}

const fmt = (n) => `$${Number(n || 0).toFixed(2)}`
const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

// Fetch all data for the shift and build a structured summary
export async function buildShiftSummary({
  shift,            // cash_drawers row: id, opened_at, opening_amount, closing_amount, etc
  closingAmount,    // override if shift not closed yet (preview)
  tenantId,
}) {
  const openedAt  = shift.opened_at
  const closedAt  = shift.closed_at || new Date().toISOString()
  const terminalId = shift.terminal_id

  // ── orders during the shift window for THIS terminal ──
  // (we can't filter by terminal_id directly because some legacy orders may
  // not have it; we filter by date + tenant for the broad set, then by
  // terminal_id when set.)
  let ordersQ = supabase.from('orders')
    .select('id, order_number, status, subtotal, total, tax_amount, discount_amount, coupon_discount, points_redeemed, terminal_id, created_at, voided_at, cashier_id')
    .eq('tenant_id', tenantId)
    .gte('created_at', openedAt)
    .lte('created_at', closedAt)
  if (terminalId) ordersQ = ordersQ.eq('terminal_id', terminalId)

  const { data: orders = [] } = await ordersQ

  // ── payments during shift (matched via orders) ──
  const orderIds = orders.map(o => o.id)
  const { data: payments = [] } = orderIds.length === 0 ? { data: [] } : await supabase
    .from('order_payments')
    .select('order_id, method, amount')
    .in('order_id', orderIds)

  // ── refunds during the shift (negative-totals orders) ──
  // Note: refunds in this POS are stored as orders with negative totals.
  // Voids = status='voided'.

  // Categorize
  const completed = orders.filter(o => o.status === 'completed')
  const voided    = orders.filter(o => o.status === 'voided')
  const sales     = completed.filter(o => Number(o.total) >= 0)
  const refunds   = completed.filter(o => Number(o.total) < 0)

  // ── Fetch ADDITIONAL audit data for the activity log ──
  // Order adjustments (voids, midshift cash in/out)
  let adjQ = supabase.from('order_adjustments')
    .select('id, type, amount, reason, payment_method, staff_id, staff_name, order_number, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', openedAt)
    .lte('created_at', closedAt)
  if (terminalId) adjQ = adjQ.eq('terminal_id', terminalId)
  const { data: adjustments = [] } = await adjQ.then(r => ({ data: r.data || [] }))

  // Time-clock events that crossed this shift window
  const { data: clockEvents = [] } = await supabase.from('time_clock_entries')
    .select('id, user_id, clock_in_at, clock_out_at, users(name)')
    .eq('tenant_id', tenantId)
    .or(`and(clock_in_at.gte.${openedAt},clock_in_at.lte.${closedAt}),and(clock_out_at.gte.${openedAt},clock_out_at.lte.${closedAt})`)
    .then(r => ({ data: r.data || [] }))

  const grossSales   = sales.reduce((s, o) => s + Number(o.total || 0), 0)
  const refundAmt    = Math.abs(refunds.reduce((s, o) => s + Number(o.total || 0), 0))
  const netSales     = grossSales - refundAmt
  const taxTotal     = sales.reduce((s, o) => s + Number(o.tax_amount || 0), 0)
  const discTotal    = sales.reduce((s, o) => s + Number(o.discount_amount || 0), 0)
  const couponTotal  = sales.reduce((s, o) => s + Number(o.coupon_discount || 0), 0)
  const ptsRedeemed  = sales.reduce((s, o) => s + Number(o.points_redeemed || 0), 0)
  const voidedTotal  = voided.reduce((s, o) => s + Number(o.total || 0), 0)

  // Payment breakdown — split sales vs refunds because refund payments are
  // typically negative on the same `method`
  const payByMethod = {}
  payments.forEach(p => {
    const ord = orders.find(o => o.id === p.order_id)
    if (!ord || ord.status !== 'completed') return
    const isRefund = Number(ord.total) < 0
    if (!payByMethod[p.method]) payByMethod[p.method] = { collected: 0, refunded: 0, net: 0 }
    if (isRefund) payByMethod[p.method].refunded += Math.abs(Number(p.amount || 0))
    else          payByMethod[p.method].collected += Number(p.amount || 0)
    payByMethod[p.method].net = payByMethod[p.method].collected - payByMethod[p.method].refunded
  })

  // Per-cashier breakdown — useful when multiple employees worked the same shift
  // (Common case: 1 station, multiple people clock in/out across one shift.)
  const cashierIds = [...new Set(sales.map(o => o.cashier_id).filter(Boolean))]
  let cashierNames = {}
  if (cashierIds.length > 0) {
    const { data: us } = await supabase.from('users').select('id, name').in('id', cashierIds)
    ;(us || []).forEach(u => { cashierNames[u.id] = u.name })
  }
  const byCashier = {}
  sales.forEach(o => {
    const cid = o.cashier_id || 'unknown'
    if (!byCashier[cid]) byCashier[cid] = {
      id: cid,
      name: cashierNames[cid] || 'Unknown',
      orderCount: 0, gross: 0, tax: 0, disc: 0,
    }
    byCashier[cid].orderCount++
    byCashier[cid].gross += Number(o.total || 0)
    byCashier[cid].tax   += Number(o.tax_amount || 0)
    byCashier[cid].disc  += Number(o.discount_amount || 0)
  })
  const byCashierList = Object.values(byCashier).sort((a,b) => b.gross - a.gross)

  // ── Build chronological activity log ──
  // Resolve any extra user IDs we haven't already fetched names for
  const extraIds = new Set()
  voided.forEach(o => o.voided_by && extraIds.add(o.voided_by))
  adjustments.forEach(a => a.staff_id && extraIds.add(a.staff_id))
  clockEvents.forEach(e => e.user_id && extraIds.add(e.user_id))
  const newIds = [...extraIds].filter(id => !cashierNames[id])
  if (newIds.length > 0) {
    const { data: us } = await supabase.from('users').select('id, name').in('id', newIds)
    ;(us || []).forEach(u => { cashierNames[u.id] = u.name })
  }
  const nameOf = (id, fallback) => cashierNames[id] || fallback || 'Unknown'

  const activity = []
  // Shift open
  activity.push({
    at: openedAt,
    icon:'☀️', kind:'shift_open',
    who: nameOf(shift.cashier_id, 'Cashier'),
    detail: `Opened shift · float $${Number(shift.opening_amount||0).toFixed(2)}`,
  })
  // Sales
  sales.forEach(o => activity.push({
    at: o.created_at,
    icon:'🛒', kind:'sale',
    who: nameOf(o.cashier_id),
    detail: `Sold #${o.order_number} · $${Number(o.total||0).toFixed(2)}`,
    order_id: o.id,
  }))
  // Refunds (orders with negative totals)
  refunds.forEach(o => activity.push({
    at: o.created_at,
    icon:'↩️', kind:'refund',
    who: nameOf(o.cashier_id),
    detail: `Refunded order · ${'$'+Math.abs(Number(o.total||0)).toFixed(2)}`,
    order_id: o.id,
  }))
  // Voids
  voided.forEach(o => activity.push({
    at: o.voided_at || o.created_at,
    icon:'🚫', kind:'void',
    who: nameOf(o.voided_by, o.voided_by_name),
    detail: `Voided #${o.order_number} · $${Number(o.total||0).toFixed(2)}`,
    order_id: o.id,
  }))
  // Order adjustments (other than voids which we already have)
  adjustments.forEach(a => {
    if (a.type === 'void') return // already in voided list
    activity.push({
      at: a.created_at,
      icon: a.type === 'cash_in' ? '💵' : a.type === 'cash_out' ? '💸' : '🔧',
      kind: a.type,
      who: nameOf(a.staff_id, a.staff_name),
      detail: `${a.type.replace(/_/g,' ')} · $${Math.abs(Number(a.amount||0)).toFixed(2)}${a.reason ? ' — '+a.reason : ''}`,
    })
  })
  // Clock in / out events within the shift window
  clockEvents.forEach(e => {
    const inAt  = e.clock_in_at && new Date(e.clock_in_at)
    const outAt = e.clock_out_at && new Date(e.clock_out_at)
    const openAt = new Date(openedAt)
    const closeAt = new Date(closedAt)
    if (inAt && inAt >= openAt && inAt <= closeAt) {
      activity.push({
        at: e.clock_in_at,
        icon:'⏰', kind:'clock_in',
        who: e.users?.name || nameOf(e.user_id),
        detail: 'Clocked in',
      })
    }
    if (outAt && outAt >= openAt && outAt <= closeAt) {
      activity.push({
        at: e.clock_out_at,
        icon:'🌙', kind:'clock_out',
        who: e.users?.name || nameOf(e.user_id),
        detail: 'Clocked out',
      })
    }
  })
  // Shift close (only if actually closed)
  if (shift.closed_at) {
    activity.push({
      at: shift.closed_at,
      icon:'🌙', kind:'shift_close',
      who: nameOf(shift.cashier_id, 'Cashier'),
      detail: `Closed shift · counted $${Number(shift.closing_amount||0).toFixed(2)}`,
    })
  }
  // Sort chronologically
  activity.sort((a,b) => new Date(a.at) - new Date(b.at))

  // Cash reconciliation
  const cashCollected = payByMethod.cash?.collected || 0
  const cashRefunded  = payByMethod.cash?.refunded || 0
  const cashNet       = cashCollected - cashRefunded
  const opening       = Number(shift.opening_amount || 0)
  const expected      = opening + cashNet
  const actualClosing = closingAmount != null
    ? Number(closingAmount)
    : (shift.closing_amount != null ? Number(shift.closing_amount) : expected)
  const variance      = actualClosing - expected

  return {
    shift,
    openedAt, closedAt,
    orderCount:     sales.length,
    refundCount:    refunds.length,
    voidCount:      voided.length,
    avgTicket:      sales.length ? grossSales / sales.length : 0,
    grossSales,
    refundAmt,
    netSales,
    taxTotal,
    discTotal,
    couponTotal,
    ptsRedeemed,
    voidedTotal,
    payByMethod,
    byCashier:    byCashierList,
    activity,
    cashCollected, cashRefunded, cashNet,
    opening, expected, actualClosing, variance,
  }
}


// Render to thermal-receipt HTML (80mm) — used for browser print
export function buildShiftReportHTML({ summary, storeInfo, cashier, terminalName }) {
  const s   = summary
  const sn  = (storeInfo?.name || 'RetailPOS').toUpperCase()
  const dash = `<div style="text-align:center;color:#888;margin:6px 0;">- - - - - - - - - - - - - - - -</div>`
  const dbl  = `<div style="text-align:center;color:#444;margin:6px 0;">============================</div>`
  const opened = new Date(s.openedAt).toLocaleString()
  const closed = new Date(s.closedAt).toLocaleString()
  const duration = Math.round((new Date(s.closedAt) - new Date(s.openedAt)) / 60_000)
  const hh = Math.floor(duration / 60), mm = duration % 60

  const row = (l, v, opts = {}) => `<div class="row${opts.bold?' bold':''}${opts.big?' big':''}" style="${opts.indent?'padding-left:8px;':''}${opts.color?`color:${opts.color};`:''}"><span>${esc(l)}</span><span>${esc(String(v))}</span></div>`

  // Build the payment rows (only methods with activity)
  const payRows = Object.entries(s.payByMethod)
    .filter(([m, v]) => v.collected > 0 || v.refunded > 0)
    .map(([m, v]) => `
      ${row(PAY_LABEL[m] || m, fmt(v.net), { bold:true })}
      ${v.refunded > 0 ? row('  ↳ refunded', `-${fmt(v.refunded)}`, { color:'#dc2626' }) : ''}
    `).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Shift Report</title>
<style>
  @page { margin: 5mm; size: 80mm auto; }
  @media print { body { width: 80mm; } }
  body { font-family: ui-monospace, 'Courier New', monospace; font-size: 11px;
    line-height: 1.55; color: #000; max-width: 80mm; margin: 0 auto; padding: 6px; }
  .row { display: flex; justify-content: space-between; }
  .bold { font-weight: bold; }
  .center { text-align: center; }
  .big { font-size: 13px; }
  .small { font-size: 10px; color: #555; }
  .title { font-size: 14px; font-weight: 900; text-align: center; letter-spacing: 1px; }
  .alert { font-weight: 900; }
</style></head><body>

<div class="title">${esc(sn)}</div>
<div class="center small">SHIFT REPORT</div>
${dash}

<div class="row small"><span>Terminal:</span><span>${esc(terminalName || '—')}</span></div>
<div class="row small"><span>Cashier:</span><span>${esc(cashier || '—')}</span></div>
<div class="row small"><span>Opened:</span><span>${esc(opened)}</span></div>
<div class="row small"><span>Closed:</span><span>${esc(closed)}</span></div>
<div class="row small"><span>Duration:</span><span>${hh}h ${mm}m</span></div>
${dash}

<div class="bold center">— SALES SUMMARY —</div>
${row('Orders', s.orderCount)}
${row('Avg Ticket', fmt(s.avgTicket))}
${row('Gross Sales', fmt(s.grossSales))}
${s.discTotal > 0 ? row('  Discounts', `-${fmt(s.discTotal)}`, { color:'#dc2626' }) : ''}
${s.couponTotal > 0 ? row('  Coupons', `-${fmt(s.couponTotal)}`, { color:'#dc2626' }) : ''}
${s.ptsRedeemed > 0 ? row('  Points used', `${s.ptsRedeemed} pts`, { color:'#B45309' }) : ''}
${row('Tax Collected', fmt(s.taxTotal))}
${s.refundCount > 0 ? row(`Refunds (${s.refundCount})`, `-${fmt(s.refundAmt)}`, { color:'#dc2626' }) : ''}
${s.voidCount > 0 ? row(`Voided (${s.voidCount})`, `-${fmt(s.voidedTotal)}`, { color:'#999' }) : ''}
${dash}
${row('NET SALES', fmt(s.netSales), { bold:true, big:true })}

${dash}
<div class="bold center">— PAYMENT BREAKDOWN —</div>
${payRows || '<div class="center small">No payments collected</div>'}

${(s.byCashier && s.byCashier.length > 1) ? `
${dash}
<div class="bold center">— BY EMPLOYEE —</div>
${s.byCashier.map(c => `
  <div style="margin-top:4px;">
    <div class="row bold"><span>${esc(c.name)}</span><span>${fmt(c.gross)}</span></div>
    <div class="row small"><span style="padding-left:6px;">${c.orderCount} orders · tax ${fmt(c.tax)}${c.disc>0?` · disc ${fmt(c.disc)}`:''}</span></div>
  </div>
`).join('')}
` : ''}

${dbl}
<div class="bold center">— CASH DRAWER —</div>
${row('Opening Float', fmt(s.opening))}
${row('Cash Sales', `+${fmt(s.cashCollected)}`)}
${s.cashRefunded > 0 ? row('Cash Refunds', `-${fmt(s.cashRefunded)}`, { color:'#dc2626' }) : ''}
${row('Expected Cash', fmt(s.expected), { bold:true })}
${row('Counted Cash', fmt(s.actualClosing), { bold:true })}

<div class="row ${Math.abs(s.variance) > 0.01 ? 'alert' : 'bold'}"
  style="margin-top:4px;color:${s.variance===0?'#000':s.variance<0?'#dc2626':'#16a34a'};">
  <span>${s.variance===0?'BALANCED ✓':'VARIANCE'}</span>
  <span>${s.variance>=0?'+':''}${fmt(s.variance)}</span>
</div>

${(s.activity && s.activity.length > 0) ? `
${dash}
<div class="bold center">— WHO DID WHAT —</div>
${s.activity.map(a => `
  <div style="display:flex;gap:4px;margin-top:2px;align-items:flex-start;">
    <span style="font-size:10px;width:48px;flex-shrink:0;color:#666;">${new Date(a.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
    <span style="font-size:10px;flex:1;">
      <b>${esc(a.who)}</b> ${esc(a.detail)}
    </span>
  </div>`).join('')}
` : ''}

${dash}
<div class="center small">— END OF SHIFT REPORT —</div>
<div class="center small">${new Date().toLocaleString()}</div>

</body></html>`
}


// One-shot: print the shift report for a (possibly still-open) shift
export async function printShiftReport({ shift, closingAmount, tenantId, storeInfo, cashierName, terminalName }) {
  const summary = await buildShiftSummary({ shift, closingAmount, tenantId })
  const html = buildShiftReportHTML({ summary, storeInfo, cashier: cashierName, terminalName })
  printReceipt(html, 1)
  return summary
}
