// src/pages/invoices/InvoiceDetailModal.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import ReceivePaymentModal from './ReceivePaymentModal'
import CreateInvoiceModal from './CreateInvoiceModal'
import InvoiceAuditHistory from './InvoiceAuditHistory'
import { buildInvoiceHtml, buildPackingSlipHtml, openPrintWindow, downloadHtml } from '@/lib/pdfTemplates'

const STATUS_BADGE = {
  draft:    { bg:'#F5F5F5', color:'#666',    label:'Draft' },
  sent:     { bg:'#E6F0FF', color:'#006AFF', label:'Sent' },
  viewed:   { bg:'#E6F0FF', color:'#006AFF', label:'Viewed' },
  partial:  { bg:'#FEF3C7', color:'#B45309', label:'Partial' },
  paid:     { bg:'#DCFCE7', color:'#15803D', label:'Paid' },
  overdue:  { bg:'#FEE2E2', color:'#CF1322', label:'Overdue' },
  voided:   { bg:'#F5F5F5', color:'#999',    label:'Voided' },
  void:     { bg:'#F5F5F5', color:'#999',    label:'Void' },  // legacy alias
  closed:   { bg:'#E5E7EB', color:'#374151', label:'🔒 Closed' },
}

const PAYMENT_METHOD_LABELS = {
  cash:          '💵 Cash',
  check:         '🏦 Check',
  ach:           '🔄 ACH',
  card:          '💳 Card',
  bank_transfer: '🏦 Bank Transfer',
  other:         '📋 Other',
}

export default function InvoiceDetailModal({ invoice, onClose, onChanged }) {
  const { tenant, store, user } = useAuthStore()
  const $ = tenant?.currency_symbol || '$'  // currency prefix used in template strings below
  const [showReceive, setShowReceive] = useState(false)
  const [showVoidInline, setShowVoidInline] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [updating, setUpdating] = useState(false)

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['invoice-detail', invoice.id],
    queryFn: async () => {
      const { data: inv } = await supabase
        .from('invoices')
        .select('*, business_customers(*), invoice_items(*)')
        .eq('id', invoice.id).single()

      // Fetch payments allocated to this invoice
      const { data: allocs } = await supabase
        .from('payment_allocations')
        .select('amount, received_payments(*)')
        .eq('invoice_id', invoice.id)
        .order('created_at', { ascending: false })

      return { ...inv, allocations: allocs || [] }
    },
  })

  if (isLoading || !detail) {
    return (
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="bg-white rounded-2xl p-12 text-[#666]">Loading...</div>
      </div>
    )
  }

  const status = STATUS_BADGE[detail.status] || { bg:'#F5F5F5', color:'#666', label: detail.status }
  const customer = detail.business_customers
  const items = (detail.invoice_items || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const isVoid    = detail.status === 'void' || detail.status === 'voided'
  const isClosed  = detail.status === 'closed'
  const isLocked  = isVoid || isClosed   // permanently locked, no edits
  const isPaidOrVoid = detail.status === 'paid' || isVoid || isClosed
  const canEdit   = !isLocked   // any non-terminal state can be edited
  const canClose  = detail.status === 'paid'   // only paid invoices can be closed
  const balanceDue = detail.balance_due || 0
  const isOverdue = detail.due_date && new Date(detail.due_date) < new Date() && balanceDue > 0

  const updateStatus = async (newStatus) => {
    setUpdating(true)
    try {
      const updates = { status: newStatus, updated_at: new Date().toISOString() }
      if (newStatus === 'sent') updates.sent_at = new Date().toISOString()
      const { error } = await supabase.from('invoices').update(updates).eq('id', detail.id)
      if (error) { toast.error(error.message); return }
      toast.success(`Invoice marked as ${newStatus}`)
      refetch()
      onChanged?.()
    } finally { setUpdating(false) }
  }

  // Close & Lock — final step, calls fn_close_invoice. Permanent.
  const closeAndLock = async () => {
    setUpdating(true)
    try {
      const { data, error } = await supabase.rpc('fn_close_invoice', {
        p_tenant_id:  tenant.id,
        p_invoice_id: detail.id,
        p_user_id:    user?.id || null,
      })
      if (error || !data?.success) {
        toast.error(error?.message || data?.message || 'Close failed')
        return
      }
      toast.success(data.message || 'Invoice closed and locked 🔒')
      setShowCloseConfirm(false)
      refetch()
      onChanged?.()
    } catch (e) {
      console.error('Close invoice:', e)
      toast.error(e?.message || 'Close failed')
    } finally { setUpdating(false) }
  }

  // Send a draft invoice — calls fn_send_invoice which deducts inventory
  // atomically (with a stock-availability pre-check). If any item is short,
  // nothing is deducted and the user sees which product failed.
  const sendInvoice = async () => {
    setUpdating(true)
    try {
      const { user } = useAuthStore.getState()
      const { data, error } = await supabase.rpc('fn_send_invoice', {
        p_tenant_id:  tenant.id,
        p_invoice_id: detail.id,
        p_user_id:    user?.id || null,
      })
      if (error) { toast.error(`Send failed: ${error.message}`); return }
      if (!data?.success) { toast.error(data?.message || 'Send failed'); return }
      toast.success('✓ Invoice sent — inventory deducted')
      refetch()
      onChanged?.()
    } catch (e) {
      console.error('Send invoice:', e)
      toast.error(e?.message || 'Send failed')
    } finally { setUpdating(false) }
  }

  // Void an invoice — calls fn_void_invoice which restores inventory if it
  // was previously deducted (i.e. if the invoice was sent, not just drafted).
  const voidInvoice = async (reason) => {
    setUpdating(true)
    try {
      const { user } = useAuthStore.getState()
      const { data, error } = await supabase.rpc('fn_void_invoice', {
        p_tenant_id:  tenant.id,
        p_invoice_id: detail.id,
        p_user_id:    user?.id || null,
        p_reason:     reason || null,
      })
      if (error) { toast.error(`Void failed: ${error.message}`); return }
      if (!data?.success) { toast.error(data?.message || 'Void failed'); return }
      toast.success(data.message || '✓ Voided')
      refetch()
      onChanged?.()
    } catch (e) {
      console.error('Void invoice:', e)
      toast.error(e?.message || 'Void failed')
    } finally { setUpdating(false) }
  }

  // Build doc data once
  const docData = {
    invoice: detail,
    items,
    customer,
    payments: (detail.allocations || []).map(a => ({
      ...(a.received_payments || {}),
      amount: a.amount,    // use the allocated amount (not the full payment amount)
    })).filter(p => p.payment_number),
    store,
    tenant,
  }

  const printInvoice = () => {
    const html = buildInvoiceHtml(docData)
    openPrintWindow(html, `Invoice ${detail.invoice_number}`)
  }
  const downloadInvoice = () => {
    const html = buildInvoiceHtml(docData)
    downloadHtml(html, `${detail.invoice_number}.html`)
    toast.success('Invoice downloaded — open it to save as PDF')
  }
  const printPacking = () => {
    const html = buildPackingSlipHtml(docData)
    openPrintWindow(html, `Packing ${detail.invoice_number}`)
  }
  const downloadPacking = () => {
    const html = buildPackingSlipHtml(docData)
    downloadHtml(html, `Packing-${detail.invoice_number}.html`)
    toast.success('Packing slip downloaded')
  }

  return (
    <>
      <div className="linear-theme fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="card overflow-hidden flex flex-col" style={{
          width:'820px', maxWidth:'100%', maxHeight:'92vh'
        }}>
          {/* Header */}
          <div className="px-6 py-5 flex items-start justify-between flex-shrink-0" style={{borderBottom:'1px solid rgba(0,0,0,0.06)'}}>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold tracking-tight text-xl text-slate-900 leading-none">{detail.invoice_number}</span>
                <span className={`badge ${
                  isOverdue                                           ? 'bg-red-50 text-red-600'
                  : detail.status === 'paid'                          ? 'bg-emerald-50 text-emerald-600'
                  : (detail.status === 'sent' || detail.status === 'viewed') ? 'bg-emerald-50 text-emerald-600'
                  : detail.status === 'partial'                       ? 'bg-red-50 text-red-600'
                  :                                                     'bg-black/5 text-slate-600'
                }`}>
                  {isOverdue ? 'Overdue' : status.label}
                </span>
                {detail.source_estimate_id && (
                  <span className="text-xs text-slate-500">· from Estimate</span>
                )}
              </div>
              <div className="text-sm font-semibold text-slate-900">{customer?.company_name || 'Unknown'}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {[
                  detail.invoice_date && `Date: ${new Date(detail.invoice_date).toLocaleDateString()}`,
                  detail.due_date && `Due: ${new Date(detail.due_date).toLocaleDateString()}`,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-lg cursor-pointer text-base bg-black/[.04] hover:bg-black/[.08] border-none">✕</button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50/50">
            {/* Draft hint — this invoice hasn't been issued yet */}
            {detail.status === 'draft' && (
              <div className="rounded-lg p-4 flex items-center justify-between"
                style={{background:'#F5F5F5', border:'1px solid #D5D5D5'}}>
                <div>
                  <div className="text-[10px] font-bold uppercase mb-0.5 text-[#666]">
                    📝 Draft
                  </div>
                  <div className="text-[12px] text-[#1F1F1F]">
                    This invoice hasn't been sent yet. Customer can't pay it until you send.
                  </div>
                  <div className="text-[11px] text-[#666] mt-1">
                    Sending will deduct stock and lock the line items.
                  </div>
                </div>
                <button onClick={sendInvoice} disabled={updating}
                  className="rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer active:scale-[0.96] text-white disabled:opacity-40"
                  style={{background:'#006AFF', border:'none'}}>
                  📤 Send Invoice
                </button>
              </div>
            )}

            {/* Balance Due banner — only after invoice is sent (drafts can't be paid) */}
            {balanceDue > 0 && !isPaidOrVoid && detail.status !== 'draft' && (
              <div className="rounded-lg p-4 flex items-center justify-between"
                style={isOverdue
                  ? {background:'#FEE2E2', border:'1px solid #CF1322'}
                  : {background:'#FFF7ED', border:'1px solid #F59E0B'}}>
                <div>
                  <div className="text-[10px] font-bold uppercase mb-0.5"
                    style={{color: isOverdue ? '#CF1322' : '#B45309'}}>
                    {isOverdue ? '⚠️ Past Due' : 'Balance Due'}
                  </div>
                  <div className="font-mono text-[24px] font-bold"
                    style={{color: isOverdue ? '#CF1322' : '#1F1F1F'}}>
                    {$}{balanceDue.toFixed(2)}
                  </div>
                  {detail.amount_paid > 0 && (
                    <div className="text-[11px] text-[#666] mt-0.5 font-mono">
                      {$}{detail.amount_paid.toFixed(2)} of {$}{detail.total.toFixed(2)} received
                    </div>
                  )}
                </div>
                <button onClick={() => setShowReceive(true)}
                  className="rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
                  style={{background:'#15803D', color:'#FFFFFF', border:'none'}}>
                  💰 Receive Payment
                </button>
              </div>
            )}

            {/* Customer block */}
            {customer && (
              <div className="rounded-lg p-3 grid grid-cols-2 gap-3" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
                <div>
                  <div className="text-[10px] font-bold text-[#666] uppercase mb-1">Bill to</div>
                  <div className="text-[12px] font-bold text-[#1F1F1F]">{customer.company_name}</div>
                  {customer.contact_name && <div className="text-[11px] text-[#666]">{customer.contact_name}</div>}
                  {customer.contact_email && <div className="text-[11px] text-[#666]">{customer.contact_email}</div>}
                  {customer.billing_address && (
                    <div className="text-[11px] text-[#666] mt-1">
                      {customer.billing_address}
                      {customer.billing_city && <>, {customer.billing_city}</>}
                      {customer.billing_state && <>, {customer.billing_state}</>}
                      {customer.billing_zip && <> {customer.billing_zip}</>}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-bold text-[#666] uppercase mb-1">Terms</div>
                  <div className="text-[11px] text-[#1F1F1F]">
                    Payment: <span className="font-bold uppercase">{customer.payment_terms || 'NET 30'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Items */}
            <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
              <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
                style={{gridTemplateColumns:'1.4fr 70px 90px 65px 100px'}}>
                {['Item','Qty','Price','Disc%','Total'].map(h => (
                  <div key={h} className="px-3 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                ))}
              </div>
              {items.map(item => (
                <div key={item.id} className="grid border-b border-[#E5E5E5] last:border-0"
                  style={{gridTemplateColumns:'1.4fr 70px 90px 65px 100px'}}>
                  <div className="px-3 py-3">
                    <div className="text-[13px] font-bold text-[#1F1F1F]">{item.product_name}</div>
                    {item.product_sku && <div className="text-[10px] text-[#999] font-mono">{item.product_sku}</div>}
                    {item.description && <div className="text-[11px] text-[#666] mt-0.5">{item.description}</div>}
                  </div>
                  <div className="px-3 py-3 text-right font-mono text-[12px]">{item.quantity}</div>
                  <div className="px-3 py-3 text-right font-mono text-[12px]">{$}{(item.unit_price || 0).toFixed(2)}</div>
                  <div className="px-3 py-3 text-right font-mono text-[12px]">
                    {(item.discount_pct || 0) > 0 ? `${item.discount_pct}%` : '—'}
                  </div>
                  <div className="px-3 py-3 text-right font-mono text-[13px] font-bold">{$}{(item.line_total || 0).toFixed(2)}</div>
                </div>
              ))}
              {/* Totals */}
              <div className="bg-[#FAFAFA] border-t border-[#E5E5E5] px-4 py-3">
                <div className="ml-auto max-w-[280px] text-[12px] space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[#666]">Subtotal</span>
                    <span className="font-mono">{$}{(detail.subtotal || 0).toFixed(2)}</span>
                  </div>
                  {detail.discount_amount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[#666]">Discount</span>
                      <span className="font-mono text-[#CF1322]">−{$}{(detail.discount_amount || 0).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1.5 border-t border-[#E5E5E5]">
                    <span className="font-bold">Total</span>
                    <span className="font-mono text-[16px] font-bold">{$}{(detail.total || 0).toFixed(2)}</span>
                  </div>
                  {detail.amount_paid > 0 && (
                    <>
                      <div className="flex justify-between text-[#15803D]">
                        <span className="font-bold">Paid</span>
                        <span className="font-mono">−{$}{(detail.amount_paid || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between pt-1.5 border-t border-[#E5E5E5]">
                        <span className="font-bold">Balance</span>
                        <span className="font-mono text-[15px] font-bold"
                          style={{color: balanceDue > 0 ? '#CF1322' : '#15803D'}}>
                          {$}{balanceDue.toFixed(2)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Payment history */}
            {detail.allocations && detail.allocations.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-[#1F1F1F] mb-2">💰 Payment History ({detail.allocations.length})</div>
                <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
                  {detail.allocations.map((a, i) => {
                    const p = a.received_payments
                    return (
                      <div key={i} className="px-3 py-2.5 flex items-center justify-between gap-3 border-b border-[#E5E5E5] last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-bold text-[#1F1F1F]">
                            {PAYMENT_METHOD_LABELS[p?.payment_method] || p?.payment_method || '—'}
                            {p?.reference_number && (
                              <span className="ml-2 text-[10px] text-[#666] font-normal font-mono">
                                Ref: {p.reference_number}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[#666] font-mono">
                            {p?.payment_number} · {p?.payment_date ? new Date(p.payment_date).toLocaleDateString() : ''}
                          </div>
                        </div>
                        <div className="font-mono text-[14px] font-bold text-[#15803D]">
                          +{$}{a.amount.toFixed(2)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Notes */}
            {detail.notes && (
              <div className="rounded-lg p-3" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
                <div className="text-[10px] font-bold text-[#666] uppercase mb-1">Notes</div>
                <div className="text-[12px] text-[#1F1F1F] whitespace-pre-wrap">{detail.notes}</div>
              </div>
            )}

            {/* INLINE: Void confirm */}
            {showVoidInline && !isPaidOrVoid && (
              <div className="rounded-lg p-4" style={{background:'#FEE2E2', border:'1px solid #CF1322'}}>
                <div className="text-[13px] font-bold text-[#CF1322] mb-2">⚠️ Void this invoice?</div>
                <div className="text-[11px] text-[#1F1F1F] mb-3">
                  This will:
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    <li>Mark invoice as <strong>Void</strong> and exclude from totals</li>
                    <li>Customer's outstanding balance goes back down</li>
                    {detail.status !== 'draft' && (
                      <li className="text-[#15803D]"><strong>✓ Inventory will be automatically restored</strong></li>
                    )}
                    {detail.status === 'draft' && (
                      <li className="text-[#666]">Inventory wasn't deducted yet (draft) — nothing to restore</li>
                    )}
                  </ul>
                  {detail.amount_paid > 0 && (
                    <div className="mt-3 rounded-lg p-2.5" style={{background:'#FEF3C7', border:'1px solid #FCD34D'}}>
                      <div className="font-bold text-[#92400E] mb-1">
                        ⚠️ Customer has already paid {$}{detail.amount_paid.toFixed(2)}
                      </div>
                      <div className="text-[#92400E]">
                        Voiding does NOT refund the money. You'll need to either:
                        <br/>• Refund cash/transfer back to the customer, OR
                        <br/>• Leave it as a credit on their account for next invoice
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowVoidInline(false)} disabled={updating}
                    className="flex-1 rounded-lg py-2 text-[12px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
                    Keep Invoice
                  </button>
                  <button onClick={() => { setShowVoidInline(false); voidInvoice() }} disabled={updating}
                    className="flex-1 rounded-lg py-2 text-[12px] font-bold cursor-pointer text-white disabled:opacity-40"
                    style={{background:'#CF1322', border:'none'}}>
                    🗑 Yes, Void Invoice
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 flex gap-2 flex-shrink-0 flex-wrap items-center bg-white" style={{borderTop:'1px solid rgba(0,0,0,0.06)'}}>
            <button onClick={onClose} className="btn-outline">Close</button>

            {/* Print group */}
            <div className="flex items-stretch rounded-lg overflow-hidden border border-ink/80">
              <button onClick={printInvoice} title="Print or Save as PDF"
                className="px-4 py-2.5 text-sm font-semibold cursor-pointer bg-ink text-white border-none">
                Print / PDF
              </button>
              <button onClick={downloadInvoice} title="Download HTML"
                className="px-3 py-2.5 text-sm font-semibold cursor-pointer bg-white text-slate-900 border-none border-l border-black/10">
                ↓
              </button>
            </div>

            {/* Packing slip group */}
            <div className="flex items-stretch rounded-lg overflow-hidden border border-red-300">
              <button onClick={printPacking} title="Print packing slip (no prices)"
                className="px-3 py-2.5 text-sm font-semibold cursor-pointer bg-white text-red-600 border-none">
                Packing Slip
              </button>
              <button onClick={downloadPacking} title="Download packing slip"
                className="px-2.5 py-2.5 text-sm font-semibold cursor-pointer bg-white text-red-600 border-none border-l border-red-200">
                ↓
              </button>
            </div>

            {canEdit && !showVoidInline && (
              <button onClick={() => setShowEdit(true)} disabled={updating} className="btn-outline">
                Edit
              </button>
            )}

            <button onClick={() => setShowAudit(true)} disabled={updating} title="View edit history" className="btn-ghost">
              History
            </button>

            {!isPaidOrVoid && !showVoidInline && (
              <>
                {detail.status === 'draft' && (
                  <button onClick={sendInvoice} disabled={updating} className="btn-primary">
                    Send Invoice
                  </button>
                )}
                <button onClick={() => setShowVoidInline(true)} disabled={updating} className="btn-danger">
                  Void
                </button>
              </>
            )}

            {balanceDue > 0 && !isPaidOrVoid && !showVoidInline && detail.status !== 'draft' && (
              <button onClick={() => setShowReceive(true)} className="btn-primary ml-auto">
                Receive Payment
              </button>
            )}

            {canClose && !showVoidInline && (
              <button onClick={() => setShowCloseConfirm(true)} disabled={updating}
                className="ml-auto inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold cursor-pointer bg-ink text-white border-none disabled:opacity-40 active:scale-[.98]">
                Close &amp; Lock
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Close & Lock confirmation dialog */}
      {showCloseConfirm && (
        <div className="linear-theme fixed inset-0 z-[700] flex items-center justify-center p-4"
          style={{background:'rgba(0,0,0,0.5)'}}>
          <div className="card max-w-md w-full p-6">
            <div className="font-semibold tracking-tight text-2xl text-slate-900 mb-2">
              Close &amp; Lock this invoice?
            </div>
            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              Once closed, <b>this invoice can never be edited or voided</b>. The numbers are final.
            </p>
            <div className="rounded-lg p-3 mb-4 text-xs bg-red-50 border border-red-200">
              <div className="font-semibold text-red-600 mb-1">If you need to make changes later:</div>
              <div className="text-red-600/90">
                You'll have to issue a separate credit memo or correction invoice. You cannot reopen this one.
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowCloseConfirm(false)} disabled={updating} className="btn-outline flex-1">
                Cancel
              </button>
              <button onClick={closeAndLock} disabled={updating}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold cursor-pointer bg-ink text-white border-none disabled:opacity-40 active:scale-[.98]">
                {updating ? 'Locking…' : 'Yes, Close & Lock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal — reuses CreateInvoiceModal in edit mode */}
      {showEdit && (
        <CreateInvoiceModal
          editInvoiceId={detail.id}
          onClose={() => setShowEdit(false)}
          onCreated={() => {
            setShowEdit(false)
            refetch()
            onChanged?.()
          }}
        />
      )}

      {/* Audit history drawer */}
      {showAudit && (
        <InvoiceAuditHistory
          invoiceId={detail.id}
          invoiceNumber={detail.invoice_number}
          onClose={() => setShowAudit(false)}
        />
      )}

      {showReceive && (
        <ReceivePaymentModal
          presetCustomerId={customer?.id}
          presetInvoiceId={detail.id}
          onClose={() => setShowReceive(false)}
          onDone={() => {
            setShowReceive(false)
            refetch()
            onChanged?.()
          }}
        />
      )}
    </>
  )
}
