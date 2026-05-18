// src/lib/receipt.js
// Receipt utilities — load settings, build HTML, print, queue email/SMS

const DEFAULT_PRINTING = {
  fontSize: 'medium',
  show: {
    logo: false, storeName: true, address: true, phone: true,
    header: false, orderNumber: true, dateTime: true,
    cashier: true, customer: true,
    items: true, discount: true, tax: true, total: true,
    paymentMethod: true, change: true,
    footer: true, thankYou: true, qrCode: false,
  },
  headerText: 'Welcome!',
  footerText: 'Returns within 30 days with receipt.',
  autoMode: 'ask',
  copies: 1,
  enableEmail: false,
  enableSms: false,
}

export function getPrintingSettings() {
  try {
    const v = localStorage.getItem('printingSettings')
    const parsed = v ? JSON.parse(v) : {}
    return {
      ...DEFAULT_PRINTING,
      ...parsed,
      show: { ...DEFAULT_PRINTING.show, ...(parsed.show || {}) },
    }
  } catch { return DEFAULT_PRINTING }
}

export function getPrinterSettings() {
  try {
    const v = localStorage.getItem('printerSettings')
    return v ? JSON.parse(v) : { ip:'', port:'9100', model:'thermal_80mm', name:'Default' }
  } catch {
    return { ip:'', port:'9100', model:'thermal_80mm', name:'Default' }
  }
}

const escapeHTML = (s) => String(s||'').replace(/[&<>"']/g, m => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[m]))

const labelOf = (method) => {
  const map = { cash:'Cash', card:'Card', member_card:'VIP Card', gift_card:'Gift Card',
    bank_transfer:'Transfer', check:'Check', on_account:'On Account' }
  return map[method] || method
}

// Build a money formatter scoped to a specific currency. Receipts are
// generated for a single order so we capture the symbol once and use it
// consistently throughout. Pass storeInfo.currency_symbol (set by
// PaymentPanel from tenant.currency_symbol) — falls back to '$' if not set.
const makeFmt = (sym) => (n) => sym + Number(n||0).toFixed(2)

// Build standalone HTML document for the receipt
export function buildReceiptHTML(orderData, settings, storeInfo) {
  const s = settings || getPrintingSettings()
  const fontPx = { small:11, medium:13, large:15 }[s.fontSize] || 13
  const sh = s.show
  const {
    order_number, date, cashier_name, customer_name,
    items = [], subtotal = 0, discount = 0, bulk_savings = 0, tax = 0, total = 0,
    payments = [], change = 0,
  } = orderData || {}
  const { name: storeName = '', address = '', phone = '', currency_symbol } = storeInfo || {}
  const fmt = makeFmt(currency_symbol || '$')

  const dash = `<div style="text-align:center;color:#888;margin:6px 0;">- - - - - - - - - - - - - - - -</div>`

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Receipt ${escapeHTML(order_number||'')}</title>
<style>
  @page { margin: 5mm; size: 80mm auto; }
  @media print { body { width: 80mm; } }
  body { font-family: ui-monospace, 'Courier New', monospace; font-size: ${fontPx}px;
    line-height: 1.55; color: #000; max-width: 80mm; margin: 0 auto; padding: 8px; }
  .row { display: flex; justify-content: space-between; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .big { font-size: ${fontPx + 3}px; font-weight: 900; letter-spacing: 1px; }
  .total { font-size: ${fontPx + 2}px; font-weight: 900;
    border-top: 1px solid #444; padding-top: 4px; margin-top: 4px; }
  .small { font-size: ${Math.max(fontPx - 1, 9)}px; }
  .gray { color: #555; }
</style></head>
<body>
${sh.logo ? `<div class="center"><div style="display:inline-block;padding:3px 10px;background:#eee;border-radius:4px;font-size:${fontPx-3}px;color:#666;">[ LOGO ]</div></div>` : ''}
${sh.storeName && storeName ? `<div class="center big">${escapeHTML(storeName)}</div>` : ''}
${sh.address && address ? `<div class="center gray">${escapeHTML(address)}</div>` : ''}
${sh.phone && phone ? `<div class="center gray">${escapeHTML(phone)}</div>` : ''}
${dash}
${sh.header && s.headerText ? `<div class="center bold" style="margin-bottom:6px;">${escapeHTML(s.headerText)}</div>` : ''}
${sh.orderNumber && order_number ? `<div class="row"><span>Order #:</span><span>${escapeHTML(order_number)}</span></div>` : ''}
${sh.dateTime ? `<div class="row"><span>Date:</span><span>${date || new Date().toLocaleString()}</span></div>` : ''}
${sh.cashier && cashier_name ? `<div class="row"><span>Cashier:</span><span>${escapeHTML(cashier_name)}</span></div>` : ''}
${sh.customer ? `<div class="row"><span>Customer:</span><span>${escapeHTML(customer_name || 'Walk-in')}</span></div>` : ''}
${dash}
${sh.items ? items.map(i => {
  // If line has bulk breakdown, show how qty was split
  const bulkLine = i.bulk_breakdown && i.bulk_breakdown.length > 0
    ? `<div class="row" style="font-size:${fontPx-2}px;color:#555;padding-left:8px;">` +
      `<span>${i.bulk_breakdown.map(b => b.bundleCount
        ? `${b.bundleCount}× ${escapeHTML(b.label)}`
        : `${b.count}× ${fmt(b.unitPrice)}`).join(' + ')}</span>` +
      (i.bulk_savings > 0 ? `<span style="color:#16a34a;">saved ${fmt(i.bulk_savings)}</span>` : '<span></span>') +
      `</div>`
    : ''
  return `<div class="row"><span>${escapeHTML(i.name)} ×${i.qty}</span><span>${fmt(i.line_total)}</span></div>${bulkLine}`
}).join('') : ''}
${dash}
<div class="row"><span>Subtotal:</span><span>${fmt(subtotal)}</span></div>
${bulk_savings > 0 ? `<div class="row" style="color:#16a34a;"><span>Bulk savings:</span><span>-${fmt(bulk_savings)}</span></div>` : ''}
${sh.discount && discount > 0 ? `<div class="row" style="color:#16a34a;"><span>Discount:</span><span>-${fmt(discount)}</span></div>` : ''}
${sh.tax ? `<div class="row"><span>Tax:</span><span>${fmt(tax)}</span></div>` : ''}
${sh.total ? `<div class="row total"><span>TOTAL:</span><span>${fmt(total)}</span></div>` : ''}
${bulk_savings > 0 ? `<div class="center bold" style="color:#16a34a;margin-top:4px;">★ You saved ${fmt(bulk_savings)}! ★</div>` : ''}
${(sh.paymentMethod || sh.change) ? dash : ''}
${sh.paymentMethod ? payments.map(p => `<div class="row"><span>${labelOf(p.method)}:</span><span>${fmt(p.amount)}</span></div>`).join('') : ''}
${sh.change && change > 0 ? `<div class="row"><span>Change:</span><span>${fmt(change)}</span></div>` : ''}
${dash}
${sh.thankYou ? `<div class="center bold">★ Thank you! ★</div>` : ''}
${sh.footer && s.footerText ? `<div class="center small gray" style="margin-top:4px;">${escapeHTML(s.footerText)}</div>` : ''}
${sh.qrCode ? `<div class="center" style="margin-top:10px;"><div style="display:inline-block;width:70px;height:70px;background:#000;padding:4px;"><div style="background:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:8px;color:#000;">QR</div></div></div>` : ''}
</body></html>`
}

// Trigger browser print dialog with the receipt HTML (handles N copies)
export function printReceipt(html, copies = 1) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow.document
  doc.open(); doc.write(html); doc.close()

  iframe.contentWindow.focus()
  let printed = 0
  const doPrint = () => {
    try { iframe.contentWindow.print() } catch (e) { console.error(e) }
    printed++
    if (printed < copies) setTimeout(doPrint, 800)
    else setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 1500)
  }
  setTimeout(doPrint, 300)
}

// Queue email receipt — saves to digital_receipts table for backend worker to process
export async function sendEmailReceipt(email, html, orderNumber, tenantId) {
  try {
    const { supabase } = await import('@/lib/supabase')
    const { error } = await supabase.from('digital_receipts').insert({
      tenant_id: tenantId,
      channel: 'email',
      recipient: email,
      order_number: orderNumber,
      html_content: html,
      status: 'queued',
    })
    if (error) throw error
    return { ok: true, msg: `Email queued → ${email}` }
  } catch (err) {
    // Table missing — fallback: store in localStorage queue
    try {
      const queue = JSON.parse(localStorage.getItem('digitalReceiptQueue') || '[]')
      queue.push({ channel:'email', recipient:email, orderNumber, html, queuedAt:new Date().toISOString() })
      localStorage.setItem('digitalReceiptQueue', JSON.stringify(queue))
      return { ok: true, msg: `Email queued locally → ${email}` }
    } catch (e2) {
      return { ok: false, msg: err.message || 'Queue failed' }
    }
  }
}

export async function sendSmsReceipt(phone, html, orderNumber, tenantId) {
  try {
    const { supabase } = await import('@/lib/supabase')
    const { error } = await supabase.from('digital_receipts').insert({
      tenant_id: tenantId,
      channel: 'sms',
      recipient: phone,
      order_number: orderNumber,
      html_content: html,
      status: 'queued',
    })
    if (error) throw error
    return { ok: true, msg: `SMS queued → ${phone}` }
  } catch (err) {
    try {
      const queue = JSON.parse(localStorage.getItem('digitalReceiptQueue') || '[]')
      queue.push({ channel:'sms', recipient:phone, orderNumber, html, queuedAt:new Date().toISOString() })
      localStorage.setItem('digitalReceiptQueue', JSON.stringify(queue))
      return { ok: true, msg: `SMS queued locally → ${phone}` }
    } catch (e2) {
      return { ok: false, msg: err.message || 'Queue failed' }
    }
  }
}

// Validation helpers
export const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '')
export const isValidPhone = (p) => {
  const digits = String(p||'').replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}
