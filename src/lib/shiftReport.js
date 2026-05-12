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
