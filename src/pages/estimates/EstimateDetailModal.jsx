// src/pages/estimates/EstimateDetailModal.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { buildEstimateHtml, openPrintWindow, downloadHtml } from '@/lib/pdfTemplates'

const STATUS_BADGE = {
  draft:     { bg:'#F5F5F5', color:'#666',    label:'Draft' },
  sent:      { bg:'#E6F0FF', color:'#006AFF', label:'Sent' },
  accepted:  { bg:'#DCFCE7', color:'#15803D', label:'Accepted' },
  declined:  { bg:'#FEE2E2', color:'#CF1322', label:'Declined' },
  expired:   { bg:'#FEF3C7', color:'#B45309', label:'Expired' },
  converted: { bg:'#E6F0FF', color:'#006AFF', label:'→ Invoice' },
}

export default function EstimateDetailModal({ estimate, onClose, onChanged }) {
  const { tenant, store, user } = useAuthStore()
  const [updating, setUpdating]               = useState(false)
  const [showConvertInline, setShowConvertInline] = useState(false)
  const [showDeclineInline, setShowDeclineInline] = useState(false)
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['estimate-detail', estimate.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('estimates')
        .select('*, business_customers(*), estimate_items(*)')
        .eq('id', estimate.id).single()
      return data
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
  const items = (detail.estimate_items || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const isLocked = detail.status === 'converted' || detail.status === 'declined'

  const updateStatus = async (newStatus) => {
    setUpdating(true)
    const { error } = await supabase.from('estimates')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', detail.id)
    setUpdating(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Marked as ${newStatus}`)
    refetch()
    onChanged?.()
  }

  const convertNow = async () => {
    setUpdating(true)
    const { data, error } = await supabase.rpc('fn_convert_estimate_to_invoice', {
      p_tenant_id:   tenant.id,
      p_estimate_id: detail.id,
      p_due_date:    dueDate || null,
      p_user_id:     user?.id || null,
    })
    setUpdating(false)
    if (error || !data?.success) {
      toast.error(error?.message || data?.message || 'Failed to convert')
      return
    }
    toast.success(`Created ${data.invoice_number} — stock deducted`)
    onChanged?.()
    onClose()
  }

  const docData = { estimate: detail, items, customer, store, tenant }
  const printEstimate = () => openPrintWindow(buildEstimateHtml(docData), `Estimate ${detail.estimate_number}`)
  const downloadEstimate = () => {
    downloadHtml(buildEstimateHtml(docData), `${detail.estimate_number}.html`)
    toast.success('Downloaded — open it to save as PDF')
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width:'780px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[15px] font-bold text-[#006AFF]">{detail.estimate_number}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                style={{background:status.bg, color:status.color}}>
                {status.label}
              </span>
            </div>
            <div className="text-[14px] font-bold text-[#1F1F1F]">{customer?.company_name || 'Unknown'}</div>
            <div className="text-[11px] text-[#666] mt-0.5">
              {[
                detail.estimate_date && `Date: ${new Date(detail.estimate_date).toLocaleDateString()}`,
                detail.valid_until && `Valid until: ${new Date(detail.valid_until).toLocaleDateString()}`,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Customer info */}
          {customer && (
            <div className="rounded-lg p-3 grid grid-cols-2 gap-3" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
              <div>
                <div className="text-[10px] font-bold text-[#666] uppercase mb-1">Quote for</div>
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

          {/* Items table */}
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
              </div>
            </div>
          </div>

          {/* Notes */}
          {detail.notes && (
            <div className="rounded-lg p-3" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
              <div className="text-[10px] font-bold text-[#666] uppercase mb-1">Notes</div>
              <div className="text-[12px] text-[#1F1F1F] whitespace-pre-wrap">{detail.notes}</div>
            </div>
          )}

          {/* Converted invoice link */}
          {detail.status === 'converted' && detail.converted_invoice_id && (
            <div className="rounded-lg p-3 flex items-center justify-between"
              style={{background:'#E6F0FF', border:'1px solid #006AFF'}}>
              <div className="text-[12px] text-[#006AFF] font-bold">
                ✅ This estimate has been converted to an invoice
              </div>
              <button onClick={() => { onClose(); window.location.href = '/invoices' }}
                className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
                View invoice →
              </button>
            </div>
          )}

          {/* INLINE: Convert flow */}
          {showConvertInline && !isLocked && (
            <div className="rounded-lg p-4" style={{background:'#E6F0FF', border:'1px solid #006AFF'}}>
              <div className="text-[13px] font-bold text-[#006AFF] mb-2">Convert to Invoice</div>
              <div className="text-[11px] text-[#1F1F1F] mb-3">
                Creates invoice from this estimate and <strong className="text-[#CF1322]">deducts inventory</strong>.
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <div className="text-[10px] font-bold text-[#666] uppercase mb-1">Due date</div>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                    className="w-full bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg px-3 py-2 text-[12px] outline-none"/>
                </div>
                <button onClick={() => setShowConvertInline(false)} disabled={updating}
                  className="rounded-lg px-3 py-2 text-[12px] font-bold cursor-pointer"
                  style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
                  Cancel
                </button>
                <button onClick={convertNow} disabled={updating}
                  className="rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer text-white disabled:opacity-40"
                  style={{background:'#006AFF', border:'none'}}>
                  {updating ? 'Converting...' : '→ Create Invoice'}
                </button>
              </div>
            </div>
          )}

          {/* INLINE: Decline confirm */}
          {showDeclineInline && !isLocked && (
            <div className="rounded-lg p-4" style={{background:'#FEE2E2', border:'1px solid #CF1322'}}>
              <div className="text-[13px] font-bold text-[#CF1322] mb-2">Mark as Declined?</div>
              <div className="text-[11px] text-[#1F1F1F] mb-3">
                This will close the estimate. You can still view it but no further actions.
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowDeclineInline(false)} disabled={updating}
                  className="flex-1 rounded-lg py-2 text-[12px] font-bold cursor-pointer"
                  style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
                  Keep Open
                </button>
                <button onClick={() => updateStatus('declined')} disabled={updating}
                  className="flex-1 rounded-lg py-2 text-[12px] font-bold cursor-pointer text-white disabled:opacity-40"
                  style={{background:'#CF1322', border:'none'}}>
                  ❌ Yes, Mark Declined
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex gap-2 flex-shrink-0 flex-wrap items-center" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Close
          </button>

          {/* Print group */}
          <div className="flex items-stretch rounded-lg overflow-hidden" style={{border:'1px solid #1F1F1F'}}>
            <button onClick={printEstimate} title="Print or Save as PDF"
              className="px-3 py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#1F1F1F', color:'#FFFFFF', border:'none'}}>
              🖨️ Print / PDF
            </button>
            <button onClick={downloadEstimate} title="Download HTML"
              className="px-3 py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'none', borderLeft:'1px solid #E5E5E5'}}>
              📥
            </button>
          </div>

          {!isLocked && !showConvertInline && !showDeclineInline && (
            <>
              {/* Decline button */}
              <button onClick={() => setShowDeclineInline(true)} disabled={updating}
                className="rounded-lg px-3 py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
                style={{background:'#FFFFFF', color:'#CF1322', border:'1px solid #FECACA'}}>
                ❌ Decline
              </button>

              {/* Mark as Sent (only from draft) */}
              {detail.status === 'draft' && (
                <button onClick={() => updateStatus('sent')} disabled={updating}
                  className="rounded-lg px-3 py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
                  style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #006AFF'}}>
                  📤 Mark Sent
                </button>
              )}

              {/* Primary action: Convert to Invoice (always available) */}
              <button onClick={() => setShowConvertInline(true)} disabled={updating}
                className="ml-auto rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
                style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
                ✓ Accept &amp; Convert to Invoice →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
