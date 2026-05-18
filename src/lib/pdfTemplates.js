// src/lib/pdfTemplates.js
// Universal A4 print/PDF templates for Invoice, Estimate, and Packing Slip.
//
// Strategy: build a clean printable HTML in a hidden iframe, then call
// window.print() or window.print() → user picks "Save as PDF" from system dialog.
//
// Why iframe + browser print?
//  - Works on any device, no PDF library to ship
//  - Renders identically to what the user sees
//  - User can choose real printer OR Save as PDF in same dialog

// ─────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;')

// fmtMoney is now a factory — call mkMoney(tenant) to get a formatter
// scoped to that tenant's currency. Done this way because the templates
// already accept `tenant` as a parameter, but the formatter is used in
// many places inside the template strings — easier to bind once at the
// top of each builder than to thread `sym` through every call site.
const mkMoney = (tenant) => {
  const sym = tenant?.currency_symbol || '$'
  return (n) => `${sym}${(Number(n) || 0).toFixed(2)}`
}
// Legacy fallback for any caller that doesn't have tenant
const fmtMoney = (n) => `$${(Number(n) || 0).toFixed(2)}`
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-US', {
  year:'numeric', month:'short', day:'numeric'
}) : ''

const formatAddr = (parts) => {
  const lines = []
  if (parts.address) lines.push(parts.address)
  const cityLine = [parts.city, parts.state, parts.zip].filter(Boolean).join(', ').replace(/, ([A-Z]{2}), /, ', $1 ')
  if (cityLine) lines.push(cityLine)
  if (parts.country && parts.country !== 'US') lines.push(parts.country)
  return lines.map(l => `<div>${escapeHtml(l)}</div>`).join('')
}


// ─────────────────────────────────────────────────────────────
// SHARED CSS
// ─────────────────────────────────────────────────────────────

const SHARED_CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt;
         color: #1F1F1F; margin: 0; padding: 0; line-height: 1.45; }
  .doc { max-width: 186mm; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; padding-bottom: 18px; border-bottom: 2px solid #1F1F1F; }
  .company { display: flex; gap: 14px; align-items: flex-start; flex: 1; }
  .logo-box { width: 70px; height: 70px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
              background: #F5F5F5; border-radius: 8px; overflow: hidden; }
  .logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .logo-box .placeholder { font-size: 22pt; font-weight: 700; color: #999; }
  .company-info { flex: 1; }
  .company-name { font-size: 16pt; font-weight: 700; color: #1F1F1F; margin: 0 0 2px 0; }
  .company-meta { font-size: 8pt; color: #666; line-height: 1.4; }
  .doc-meta { text-align: right; min-width: 180px; }
  .doc-title { font-size: 22pt; font-weight: 700; color: #1F1F1F; margin: 0 0 4px 0; letter-spacing: 1px; }
  .doc-number { font-size: 11pt; color: #006AFF; font-weight: 700; font-family: 'Courier New', monospace; }
  .doc-dates { margin-top: 8px; font-size: 9pt; }
  .doc-dates .lbl { color: #666; }
  .doc-dates .val { font-weight: 600; margin-left: 4px; }

  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 22px; }
  .party { background: #FAFAFA; border: 1px solid #E5E5E5; border-radius: 6px; padding: 12px 14px; }
  .party .lbl { font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #666; letter-spacing: 0.5px; margin-bottom: 6px; }
  .party .name { font-size: 11pt; font-weight: 700; color: #1F1F1F; margin-bottom: 3px; }
  .party .meta { font-size: 9pt; color: #666; line-height: 1.5; }

  table.items { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  table.items thead th { background: #1F1F1F; color: #FFFFFF; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.5px;
                         padding: 8px 10px; text-align: left; font-weight: 700; }
  table.items thead th.num { text-align: right; }
  table.items tbody td { padding: 8px 10px; border-bottom: 1px solid #E5E5E5; font-size: 9.5pt; vertical-align: top; }
  table.items tbody td.num { text-align: right; font-family: 'Courier New', monospace; }
  table.items tbody td.bold { font-weight: 700; }
  table.items tbody tr:nth-child(even) { background: #FAFAFA; }
  .item-name { font-weight: 600; color: #1F1F1F; }
  .item-sku { font-family: 'Courier New', monospace; font-size: 8.5pt; color: #999; margin-top: 1px; }
  .item-desc { color: #666; font-size: 8.5pt; margin-top: 2px; font-style: italic; }

  .totals { margin-left: auto; width: 280px; margin-top: 8px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 10px; font-size: 10pt; }
  .totals .row.label { color: #666; }
  .totals .row.value { font-family: 'Courier New', monospace; }
  .totals .row.subtotal { border-top: 1px solid #E5E5E5; padding-top: 8px; }
  .totals .grand { background: #1F1F1F; color: #FFFFFF; padding: 10px 12px; border-radius: 4px; margin-top: 6px; display: flex; justify-content: space-between; }
  .totals .grand .lbl { font-weight: 700; font-size: 11pt; }
  .totals .grand .val { font-family: 'Courier New', monospace; font-weight: 700; font-size: 13pt; }
  .totals .balance { background: #FEE2E2; color: #CF1322; padding: 8px 12px; border-radius: 4px; margin-top: 6px;
                     display: flex; justify-content: space-between; border: 1px solid #CF1322; }
  .totals .balance .lbl { font-weight: 700; font-size: 10pt; }
  .totals .balance .val { font-family: 'Courier New', monospace; font-weight: 700; font-size: 11pt; }
  .totals .paid { color: #15803D; }

  .notes { margin-top: 24px; padding: 12px 14px; background: #FAFAFA; border-left: 3px solid #006AFF; border-radius: 4px;
           font-size: 9pt; color: #1F1F1F; line-height: 1.5; }
  .notes .lbl { font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #666; margin-bottom: 4px; letter-spacing: 0.5px; }

  .terms { margin-top: 16px; font-size: 8.5pt; color: #666; line-height: 1.5; padding-top: 12px; border-top: 1px dashed #E5E5E5; }

  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #E5E5E5;
            text-align: center; font-size: 8pt; color: #999; }

  .stamp { display: inline-block; padding: 6px 12px; border-radius: 4px; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .stamp.draft { background: #F5F5F5; color: #666; border: 1px solid #E5E5E5; }
  .stamp.paid { background: #DCFCE7; color: #15803D; border: 1px solid #15803D; }
  .stamp.overdue { background: #FEE2E2; color: #CF1322; border: 1px solid #CF1322; }
  .stamp.void { background: #F5F5F5; color: #999; text-decoration: line-through; }
  .stamp.partial { background: #FEF3C7; color: #B45309; border: 1px solid #F59E0B; }

  .pkg-cell-recv { width: 70px; height: 26px; border: 1px solid #1F1F1F; display: inline-block; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none !important; } }
`


// ─────────────────────────────────────────────────────────────
// COMPANY HEADER (shared by all 3 docs)
// ─────────────────────────────────────────────────────────────

function companyHeaderHtml(store, tenant) {
  const logoHtml = store?.logo_url
    ? `<img src="${escapeHtml(store.logo_url)}" alt="logo"/>`
    : `<span class="placeholder">${escapeHtml((store?.name || tenant?.name || '?').charAt(0).toUpperCase())}</span>`

  const companyName = escapeHtml(store?.name || tenant?.name || 'Company')
  const meta = []
  if (store?.address || store?.city) {
    const addr = [store.address, [store.city, store.state, store.zip].filter(Boolean).join(', ')]
                 .filter(Boolean).join(' · ')
    if (addr) meta.push(escapeHtml(addr))
  }
  if (store?.phone)   meta.push(`📞 ${escapeHtml(store.phone)}`)
  if (store?.email)   meta.push(`✉️ ${escapeHtml(store.email)}`)
  if (store?.website) meta.push(`🌐 ${escapeHtml(store.website)}`)
  if (store?.tax_id)  meta.push(`Tax ID: ${escapeHtml(store.tax_id)}`)

  return `
    <div class="company">
      <div class="logo-box">${logoHtml}</div>
      <div class="company-info">
        <h1 class="company-name">${companyName}</h1>
        <div class="company-meta">${meta.join('<br/>')}</div>
      </div>
    </div>
  `
}


// ─────────────────────────────────────────────────────────────
// 1️⃣  INVOICE PDF
// ─────────────────────────────────────────────────────────────

export function buildInvoiceHtml({ invoice, items, customer, payments = [], store, tenant }) {
  // Shadow the module-level fmtMoney with a tenant-currency-aware one.
  // All template-string interpolations below will pick this up via lexical
  // scope rather than the module-level fallback.
  const fmtMoney = mkMoney(tenant)
  const balanceDue = (invoice.balance_due ?? (invoice.total - (invoice.amount_paid || 0))) || 0
  const isPaid     = invoice.status === 'paid' || balanceDue <= 0.005
  const isOverdue  = invoice.due_date && new Date(invoice.due_date) < new Date() && balanceDue > 0
  const isVoid     = invoice.status === 'void' || invoice.status === 'voided'

  const stampLabel = isVoid ? 'VOID'
                   : isPaid ? 'PAID'
                   : isOverdue ? `OVERDUE` : null
  const stampClass = isVoid ? 'void'
                   : isPaid ? 'paid'
                   : isOverdue ? 'overdue' : 'draft'

  const itemRows = items.map(it => {
    const qty   = Number(it.quantity)   || 0
    const price = Number(it.unit_price) || 0
    const dpct  = Number(it.discount_pct) || 0
    return `
      <tr>
        <td>
          <div class="item-name">${escapeHtml(it.product_name || '')}</div>
          ${it.product_sku ? `<div class="item-sku">${escapeHtml(it.product_sku)}</div>` : ''}
          ${it.description ? `<div class="item-desc">${escapeHtml(it.description)}</div>` : ''}
        </td>
        <td class="num">${qty}</td>
        <td class="num">${fmtMoney(price)}</td>
        <td class="num">${dpct > 0 ? `${dpct}%` : '—'}</td>
        <td class="num bold">${fmtMoney(it.line_total)}</td>
      </tr>`
  }).join('')

  const paymentsHtml = payments.length > 0 ? `
    <div style="margin-top: 18px;">
      <div style="font-size: 9pt; font-weight: 700; text-transform: uppercase; color: #666; letter-spacing: 0.5px; margin-bottom: 6px;">Payments Received</div>
      <table class="items">
        <thead>
          <tr>
            <th>Date</th>
            <th>Method</th>
            <th>Reference</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${payments.map(p => `
            <tr>
              <td>${fmtDate(p.payment_date)}</td>
              <td>${escapeHtml((p.payment_method || '').replace(/_/g, ' ').toUpperCase())}</td>
              <td style="font-family: 'Courier New', monospace;">${escapeHtml(p.reference_number || '—')}</td>
              <td class="num bold" style="color:#15803D;">${fmtMoney(p.amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : ''

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(invoice.invoice_number)}</title>
<style>${SHARED_CSS}</style></head>
<body><div class="doc">
  <div class="header">
    ${companyHeaderHtml(store, tenant)}
    <div class="doc-meta">
      <h2 class="doc-title">INVOICE</h2>
      <div class="doc-number">${escapeHtml(invoice.invoice_number)}</div>
      ${stampLabel ? `<div style="margin-top:8px;"><span class="stamp ${stampClass}">${stampLabel}</span></div>` : ''}
      <div class="doc-dates">
        <div><span class="lbl">Date:</span><span class="val">${fmtDate(invoice.invoice_date || invoice.created_at)}</span></div>
        ${invoice.due_date ? `<div><span class="lbl">Due:</span><span class="val">${fmtDate(invoice.due_date)}</span></div>` : ''}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="lbl">Bill To</div>
      <div class="name">${escapeHtml(customer?.company_name || '—')}</div>
      <div class="meta">
        ${customer?.contact_name ? `<div>${escapeHtml(customer.contact_name)}</div>` : ''}
        ${formatAddr({
          address: customer?.billing_address,
          city: customer?.billing_city,
          state: customer?.billing_state,
          zip: customer?.billing_zip,
          country: customer?.billing_country,
        })}
        ${customer?.contact_email ? `<div>${escapeHtml(customer.contact_email)}</div>` : ''}
        ${customer?.contact_phone ? `<div>${escapeHtml(customer.contact_phone)}</div>` : ''}
      </div>
    </div>
    <div class="party">
      <div class="lbl">Payment Terms</div>
      <div class="name" style="text-transform:uppercase;">${escapeHtml(customer?.payment_terms || 'Net 30')}</div>
      ${invoice.due_date ? `<div class="meta">Payment due by <strong>${fmtDate(invoice.due_date)}</strong></div>` : ''}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit Price</th>
        <th class="num">Disc</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">
    <div class="row label"><span>Subtotal</span><span class="value">${fmtMoney(invoice.subtotal)}</span></div>
    ${(invoice.discount_amount || 0) > 0 ? `<div class="row label"><span>Discount</span><span class="value" style="color:#CF1322;">−${fmtMoney(invoice.discount_amount)}</span></div>` : ''}
    ${(invoice.tax_amount || 0) > 0 ? `<div class="row label"><span>Tax</span><span class="value">${fmtMoney(invoice.tax_amount)}</span></div>` : ''}
    <div class="grand"><span class="lbl">Total</span><span class="val">${fmtMoney(invoice.total)}</span></div>
    ${(invoice.amount_paid || 0) > 0 ? `<div class="row paid"><span>${
      // Partial = call it "Deposit" so the customer understands they paid SOME,
      // not all. Fully-paid invoices say "Amount Paid". Either way the math is
      // the same — this is presentation only.
      balanceDue > 0.005 ? 'Deposit' : 'Amount Paid'
    }</span><span class="value">−${fmtMoney(invoice.amount_paid)}</span></div>` : ''}
    ${balanceDue > 0.005 && !isVoid ? `<div class="balance"><span class="lbl">Balance Due</span><span class="val">${fmtMoney(balanceDue)}</span></div>` : ''}
  </div>

  ${paymentsHtml}

  ${invoice.notes ? `<div class="notes"><div class="lbl">Notes</div>${escapeHtml(invoice.notes).replace(/\n/g, '<br/>')}</div>` : ''}

  <div class="footer">Thank you for your business!</div>
</div></body></html>`
}


// ─────────────────────────────────────────────────────────────
// 2️⃣  ESTIMATE PDF
// ─────────────────────────────────────────────────────────────

export function buildEstimateHtml({ estimate, items, customer, store, tenant }) {
  const fmtMoney = mkMoney(tenant)
  const isExpired   = estimate.valid_until && new Date(estimate.valid_until) < new Date()
                      && !['converted', 'declined'].includes(estimate.status)
  const isConverted = estimate.status === 'converted'
  const isDeclined  = estimate.status === 'declined'

  const stampLabel = isConverted ? 'CONVERTED'
                   : isDeclined ? 'DECLINED'
                   : isExpired ? 'EXPIRED' : null
  const stampClass = isConverted ? 'paid'
                   : isDeclined ? 'void'
                   : isExpired ? 'overdue' : 'draft'

  const itemRows = items.map(it => {
    const qty   = Number(it.quantity)   || 0
    const price = Number(it.unit_price) || 0
    const dpct  = Number(it.discount_pct) || 0
    return `
      <tr>
        <td>
          <div class="item-name">${escapeHtml(it.product_name || '')}</div>
          ${it.product_sku ? `<div class="item-sku">${escapeHtml(it.product_sku)}</div>` : ''}
          ${it.description ? `<div class="item-desc">${escapeHtml(it.description)}</div>` : ''}
        </td>
        <td class="num">${qty}</td>
        <td class="num">${fmtMoney(price)}</td>
        <td class="num">${dpct > 0 ? `${dpct}%` : '—'}</td>
        <td class="num bold">${fmtMoney(it.line_total)}</td>
      </tr>`
  }).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Estimate ${escapeHtml(estimate.estimate_number)}</title>
<style>${SHARED_CSS}</style></head>
<body><div class="doc">
  <div class="header">
    ${companyHeaderHtml(store, tenant)}
    <div class="doc-meta">
      <h2 class="doc-title">ESTIMATE</h2>
      <div class="doc-number">${escapeHtml(estimate.estimate_number)}</div>
      ${stampLabel ? `<div style="margin-top:8px;"><span class="stamp ${stampClass}">${stampLabel}</span></div>` : ''}
      <div class="doc-dates">
        <div><span class="lbl">Date:</span><span class="val">${fmtDate(estimate.estimate_date || estimate.created_at)}</span></div>
        ${estimate.valid_until ? `<div><span class="lbl">Valid Until:</span><span class="val" ${isExpired ? 'style="color:#CF1322"' : ''}>${fmtDate(estimate.valid_until)}</span></div>` : ''}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="lbl">Quote For</div>
      <div class="name">${escapeHtml(customer?.company_name || '—')}</div>
      <div class="meta">
        ${customer?.contact_name ? `<div>${escapeHtml(customer.contact_name)}</div>` : ''}
        ${formatAddr({
          address: customer?.billing_address,
          city: customer?.billing_city,
          state: customer?.billing_state,
          zip: customer?.billing_zip,
          country: customer?.billing_country,
        })}
        ${customer?.contact_email ? `<div>${escapeHtml(customer.contact_email)}</div>` : ''}
        ${customer?.contact_phone ? `<div>${escapeHtml(customer.contact_phone)}</div>` : ''}
      </div>
    </div>
    <div class="party">
      <div class="lbl">Quote Details</div>
      <div class="meta">
        ${estimate.valid_until ? `<div>Valid through <strong>${fmtDate(estimate.valid_until)}</strong></div>` : ''}
        <div>Payment terms: <strong>${escapeHtml((customer?.payment_terms || 'Net 30').toUpperCase())}</strong></div>
        <div style="margin-top:6px; color:#999; font-size:8.5pt;">Prices subject to change after expiration date.</div>
      </div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit Price</th>
        <th class="num">Disc</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">
    <div class="row label"><span>Subtotal</span><span class="value">${fmtMoney(estimate.subtotal)}</span></div>
    ${(estimate.discount_amount || 0) > 0 ? `<div class="row label"><span>Discount</span><span class="value" style="color:#CF1322;">−${fmtMoney(estimate.discount_amount)}</span></div>` : ''}
    ${(estimate.tax_amount || 0) > 0 ? `<div class="row label"><span>Tax</span><span class="value">${fmtMoney(estimate.tax_amount)}</span></div>` : ''}
    <div class="grand"><span class="lbl">Total</span><span class="val">${fmtMoney(estimate.total)}</span></div>
  </div>

  ${estimate.notes ? `<div class="notes"><div class="lbl">Notes</div>${escapeHtml(estimate.notes).replace(/\n/g, '<br/>')}</div>` : ''}

  <div class="terms">
    This is an estimate only — not a final invoice. To accept this quote and begin work,
    please reply to confirm. ${estimate.valid_until ? `Quote valid through <strong>${fmtDate(estimate.valid_until)}</strong>.` : ''}
  </div>

  <div class="footer">Thank you for the opportunity to quote your business!</div>
</div></body></html>`
}


// ─────────────────────────────────────────────────────────────
// 3️⃣  PACKING SLIP PDF (no prices — warehouse use)
// ─────────────────────────────────────────────────────────────

export function buildPackingSlipHtml({ invoice, items, customer, store, tenant }) {
  const itemRows = items.map(it => `
    <tr>
      <td>
        <div class="item-name">${escapeHtml(it.product_name || '')}</div>
        ${it.product_sku ? `<div class="item-sku">${escapeHtml(it.product_sku)}</div>` : ''}
        ${it.description ? `<div class="item-desc">${escapeHtml(it.description)}</div>` : ''}
      </td>
      <td class="num">${Number(it.quantity) || 0}</td>
      <td><div class="pkg-cell-recv"></div></td>
    </tr>
  `).join('')

  const totalUnits = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)

  // Prefer the shipping address snapshot captured at invoice creation
  // (saved delivery address OR one-time custom address). Fall back to billing.
  const snap = invoice.shipping_address_snapshot
  const usingSnap = !!(snap && snap.address)
  const shipAddr = usingSnap ? snap : {
    address: customer?.billing_address,
    city:    customer?.billing_city,
    state:   customer?.billing_state,
    zip:     customer?.billing_zip,
    country: customer?.billing_country,
  }
  // Contact at the receiving site — snapshot overrides company-level contact
  const shipContactName  = usingSnap ? snap.contact_name  : customer?.contact_name
  const shipContactPhone = usingSnap ? snap.contact_phone : customer?.contact_phone
  const shipLabel        = usingSnap ? snap.label         : null

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Packing Slip ${escapeHtml(invoice.invoice_number)}</title>
<style>${SHARED_CSS}</style></head>
<body><div class="doc">
  <div class="header">
    ${companyHeaderHtml(store, tenant)}
    <div class="doc-meta">
      <h2 class="doc-title">PACKING SLIP</h2>
      <div class="doc-number">${escapeHtml(invoice.invoice_number)}</div>
      <div class="doc-dates">
        <div><span class="lbl">Date:</span><span class="val">${fmtDate(new Date())}</span></div>
        <div><span class="lbl">Invoice Date:</span><span class="val">${fmtDate(invoice.invoice_date || invoice.created_at)}</span></div>
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="lbl">Ship To${shipLabel ? ` — ${escapeHtml(shipLabel)}` : ''}</div>
      <div class="name">${escapeHtml(customer?.company_name || '—')}</div>
      <div class="meta">
        ${shipContactName ? `<div>${escapeHtml(shipContactName)}</div>` : ''}
        ${formatAddr(shipAddr)}
        ${shipContactPhone ? `<div>📞 ${escapeHtml(shipContactPhone)}</div>` : ''}
      </div>
    </div>
    <div class="party">
      <div class="lbl">Ship From</div>
      <div class="name">${escapeHtml(store?.name || tenant?.name || '—')}</div>
      <div class="meta">
        ${formatAddr({ address: store?.address, city: store?.city, state: store?.state, zip: store?.zip })}
        ${store?.phone ? `<div>📞 ${escapeHtml(store.phone)}</div>` : ''}
      </div>
    </div>
  </div>

  ${invoice.delivery_notes ? `
    <div style="margin:14px 0; padding:12px 14px; border:2px solid #B45309; background:#FEF3C7; border-radius:6px;">
      <div style="font-size:8pt; font-weight:700; text-transform:uppercase; letter-spacing:0.7px; color:#B45309; margin-bottom:4px;">⚠️ Delivery Instructions</div>
      <div style="font-size:11pt; color:#1F1F1F; line-height:1.45;">${escapeHtml(invoice.delivery_notes).replace(/\n/g, '<br/>')}</div>
    </div>` : ''}

  <table class="items">
    <thead>
      <tr>
        <th>Item</th>
        <th class="num" style="width:90px;">Qty Shipped</th>
        <th style="width:90px;">Received ✓</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
    <tfoot>
      <tr style="background:#1F1F1F; color:#FFFFFF;">
        <td style="padding:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; font-size:9pt;">Total Units</td>
        <td class="num" style="padding:10px; font-weight:700; font-size:11pt;">${totalUnits}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  ${invoice.notes ? `<div class="notes"><div class="lbl">Customer Notes</div>${escapeHtml(invoice.notes).replace(/\n/g, '<br/>')}</div>` : ''}

  <div style="margin-top:32px; padding-top:18px; border-top:1px dashed #999;">
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:30px;">
      <div>
        <div style="font-size:8pt; color:#666; margin-bottom:36px;">Picked by</div>
        <div style="border-top:1px solid #1F1F1F; padding-top:4px; font-size:8pt; color:#666;">Signature / Date</div>
      </div>
      <div>
        <div style="font-size:8pt; color:#666; margin-bottom:36px;">Received by</div>
        <div style="border-top:1px solid #1F1F1F; padding-top:4px; font-size:8pt; color:#666;">Signature / Date</div>
      </div>
    </div>
  </div>

  <div class="footer">This is not an invoice. Please refer to invoice ${escapeHtml(invoice.invoice_number)} for billing.</div>
</div></body></html>`
}


// ─────────────────────────────────────────────────────────────
// PRINT / DOWNLOAD HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Open the doc in a new tab so the user can use browser's
 * Print → Save as PDF, or Download / share from the new tab.
 */
export function openPrintWindow(html, title = 'Document') {
  const win = window.open('', '_blank', 'width=900,height=1100')
  if (!win) {
    alert('Please allow pop-ups to print.')
    return
  }
  win.document.write(html)
  win.document.title = title
  win.document.close()
  // Auto-trigger print dialog after a small delay so styles load
  setTimeout(() => {
    try { win.focus(); win.print() } catch {}
  }, 350)
}

/**
 * Download as .html file — user can open in browser and Save as PDF.
 * Lighter weight than embedding a PDF library; the user gets a tab they can print/save.
 */
export function downloadHtml(html, filename = 'document.html') {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
