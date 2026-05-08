// src/pages/invoices/InvoiceDetailModal.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import ReceivePaymentModal from './ReceivePaymentModal'

const STATUS_BADGE = {
  draft:    { bg:'#F5F5F5', color:'#666',    label:'Draft' },
  sent:     { bg:'#E6F0FF', color:'#006AFF', label:'Sent' },
  viewed:   { bg:'#E6F0FF', color:'#006AFF', label:'Viewed' },
  partial:  { bg:'#FEF3C7', color:'#B45309', label:'Partial' },
  paid:     { bg:'#DCFCE7', color:'#15803D', label:'Paid' },
  overdue:  { bg:'#FEE2E2', color:'#CF1322', label:'Overdue' },
  void:     { bg:'#F5F5F5', color:'#999',    label:'Void' },
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
  const { tenant } = useAuthStore()
  const [showReceive, setShowReceive] = useState(false)
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

  const status = STATUS_BADGE[detail.status]
  const customer = detail.business_customers
  const items = (detail.invoice_items || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const isPaidOrVoid = detail.status === 'paid' || detail.status === 'void'
  const balanceDue = detail.balance_due || 0
  const isOverdue = detail.due_date && new Date(detail.due_date) < new Date() && balanceDue > 0

  const updateStatus = async (newStatus) => {
    setUpdating(true)
    const updates = { status: newStatus, updated_at: new Date().toISOString() }
    if (newStatus === 'sent') updates.sent_at = new Date().toISOString()
    const { error } = await supabase.from('invoices').update(updates).eq('id', detail.id)
    setUpdating(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Invoice marked as ${newStatus}`)
    refetch()
    onChanged?.()
  }

  return (
    <>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="rounded-2xl overflow-hidden flex flex-col" style={{
          width:'820px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
          boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
        }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-start justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[15px] font-bold text-[#006AFF]">{detail.invoice_number}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={isOverdue
                    ? {background:'#FEE2E2', color:'#CF1322'}
                    : {background:status.bg, color:status.color}}>
                  {isOverdue ? 'Overdue' : status.label}
                </span>
                {detail.source_estimate_id && (
                  <span className="text-[10px] text-[#666] font-bold">📝 from Estimate</span>
                )}
              </div>
              <div className="text-[14px] font-bold text-[#1F1F1F]">{customer?.company_name || 'Unknown'}</div>
              <div className="text-[11px] text-[#666] mt-0.5">
                {[
                  detail.invoice_date && `Date: ${new Date(detail.invoice_date).toLocaleDateString()}`,
                  detail.due_date && `Due: ${new Date(detail.due_date).toLocaleDateString()}`,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
              style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Balance Due banner */}
            {balanceDue > 0 && !isPaidOrVoid && (
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
                    ${balanceDue.toFixed(2)}
                  </div>
                  {detail.amount_paid > 0 && (
                    <div className="text-[11px] text-[#666] mt-0.5 font-mono">
                      ${detail.amount_paid.toFixed(2)} of ${detail.total.toFixed(2)} received
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
                  <div className="px-3 py-3 text-right font-mono text-[12px]">${(item.unit_price || 0).toFixed(2)}</div>
                  <div className="px-3 py-3 text-right font-mono text-[12px]">
                    {(item.discount_pct || 0) > 0 ? `${item.discount_pct}%` : '—'}
                  </div>
                  <div className="px-3 py-3 text-right font-mono text-[13px] font-bold">${(item.line_total || 0).toFixed(2)}</div>
                </div>
              ))}
              {/* Totals */}
              <div className="bg-[#FAFAFA] border-t border-[#E5E5E5] px-4 py-3">
                <div className="ml-auto max-w-[280px] text-[12px] space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[#666]">Subtotal</span>
                    <span className="font-mono">${(detail.subtotal || 0).toFixed(2)}</span>
                  </div>
                  {detail.discount_amount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[#666]">Discount</span>
                      <span className="font-mono text-[#CF1322]">−${(detail.discount_amount || 0).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1.5 border-t border-[#E5E5E5]">
                    <span className="font-bold">Total</span>
                    <span className="font-mono text-[16px] font-bold">${(detail.total || 0).toFixed(2)}</span>
                  </div>
                  {detail.amount_paid > 0 && (
                    <>
                      <div className="flex justify-between text-[#15803D]">
                        <span className="font-bold">Paid</span>
                        <span className="font-mono">−${(detail.amount_paid || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between pt-1.5 border-t border-[#E5E5E5]">
                        <span className="font-bold">Balance</span>
                        <span className="font-mono text-[15px] font-bold"
                          style={{color: balanceDue > 0 ? '#CF1322' : '#15803D'}}>
                          ${balanceDue.toFixed(2)}
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
                          +${a.amount.toFixed(2)}
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
          </div>

          {/* Footer */}
          <div className="px-5 py-4 flex gap-2 flex-shrink-0 flex-wrap" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onClose}
              className="rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              Close
            </button>

            {detail.status === 'draft' && (
              <button onClick={() => updateStatus('sent')} disabled={updating}
                className="rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
                style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #006AFF'}}>
                📤 Mark as Sent
              </button>
            )}
            {!isPaidOrVoid && (
              <button onClick={() => {
                if (confirm('Void this invoice? It will be marked Void and excluded from totals. (Inventory is NOT auto-restored.)')) {
                  updateStatus('void')
                }
              }} disabled={updating}
                className="rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
                style={{background:'#FFFFFF', color:'#CF1322', border:'1px solid #FECACA'}}>
                Void
              </button>
            )}

            {balanceDue > 0 && !isPaidOrVoid && (
              <button onClick={() => setShowReceive(true)}
                className="ml-auto rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer"
                style={{background:'#15803D', color:'#FFFFFF', border:'none'}}>
                💰 Receive Payment
              </button>
            )}
          </div>
        </div>
      </div>

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
