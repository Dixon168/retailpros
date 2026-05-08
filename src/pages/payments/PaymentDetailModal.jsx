// src/pages/payments/PaymentDetailModal.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

const METHOD_LABELS = {
  cash:          '💵 Cash',
  check:         '🏦 Check',
  ach:           '🔄 ACH',
  card:          '💳 Card',
  bank_transfer: '🏦 Bank Transfer',
  other:         '📋 Other',
}

export default function PaymentDetailModal({ payment, onClose, onChanged }) {
  const { tenant } = useAuthStore()
  const [voiding, setVoiding] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)

  const { data: detail, isLoading } = useQuery({
    queryKey: ['payment-detail', payment.id],
    queryFn: async () => {
      const { data: pmt } = await supabase
        .from('received_payments')
        .select('*, business_customers(*)')
        .eq('id', payment.id).single()

      const { data: allocs } = await supabase
        .from('payment_allocations')
        .select('amount, invoices(*)')
        .eq('payment_id', payment.id)

      return { ...pmt, allocations: allocs || [] }
    },
  })

  if (isLoading || !detail) {
    return (
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="bg-white rounded-2xl p-12 text-[#666]">Loading...</div>
      </div>
    )
  }

  const customer = detail.business_customers
  const allocations = detail.allocations || []
  const methodLabel = METHOD_LABELS[detail.payment_method] || detail.payment_method

  const voidPayment = async () => {
    setVoiding(true)
    const { data, error } = await supabase.rpc('fn_void_payment', {
      p_tenant_id:  tenant.id,
      p_payment_id: detail.id,
    })
    setVoiding(false)
    if (error || !data?.success) {
      toast.error(error?.message || data?.message || 'Failed to void payment')
      return
    }
    toast.success(`Voided ${data.payment_number} — $${data.amount_voided} restored to balance`)
    onChanged?.()
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="rounded-2xl overflow-hidden flex flex-col" style={{
          width:'620px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
          boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
        }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-start justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[15px] font-bold text-[#15803D]">{detail.payment_number}</span>
              </div>
              <div className="text-[14px] font-bold text-[#1F1F1F]">{customer?.company_name || 'Unknown'}</div>
              <div className="text-[11px] text-[#666] mt-0.5">
                {detail.payment_date ? new Date(detail.payment_date).toLocaleDateString() : ''}
                {detail.received_by_name && ` · received by ${detail.received_by_name}`}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
              style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Big amount + method */}
            <div className="rounded-lg p-4 text-center"
              style={{background:'#DCFCE7', border:'1px solid #15803D'}}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#15803D] mb-1">Amount Received</div>
              <div className="font-mono text-[32px] font-bold text-[#15803D]">${(detail.amount || 0).toFixed(2)}</div>
              <div className="text-[12px] text-[#15803D] mt-1 font-bold">{methodLabel}</div>
              {detail.reference_number && (
                <div className="text-[11px] text-[#666] mt-2 font-mono">
                  Reference: {detail.reference_number}
                </div>
              )}
            </div>

            {/* Allocations */}
            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-2">
                Applied to {allocations.length} invoice{allocations.length === 1 ? '' : 's'}
              </div>
              {allocations.length === 0 ? (
                <div className="rounded-lg p-4 text-center text-[12px] text-[#999]"
                  style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
                  No allocations found
                </div>
              ) : (
                <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
                  <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
                    style={{gridTemplateColumns:'1.3fr 1fr 100px 100px'}}>
                    {['Invoice #','Status','Total','Applied'].map(h => (
                      <div key={h} className="px-3 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                    ))}
                  </div>
                  {allocations.map((a, i) => {
                    const inv = a.invoices
                    return (
                      <div key={i} className="grid border-b border-[#E5E5E5] last:border-0"
                        style={{gridTemplateColumns:'1.3fr 1fr 100px 100px'}}>
                        <div className="px-3 py-2.5 font-mono text-[12px] font-bold text-[#006AFF]">
                          {inv?.invoice_number || '—'}
                        </div>
                        <div className="px-3 py-2.5 text-[11px]">
                          <span className="font-bold uppercase"
                            style={{ color: inv?.status === 'paid' ? '#15803D' : inv?.status === 'partial' ? '#B45309' : '#666' }}>
                            {inv?.status || '—'}
                          </span>
                        </div>
                        <div className="px-3 py-2.5 text-right font-mono text-[12px] text-[#666]">
                          ${(inv?.total || 0).toFixed(2)}
                        </div>
                        <div className="px-3 py-2.5 text-right font-mono text-[13px] font-bold text-[#15803D]">
                          ${(a.amount || 0).toFixed(2)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            {detail.notes && (
              <div className="rounded-lg p-3" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
                <div className="text-[10px] font-bold text-[#666] uppercase mb-1">Memo</div>
                <div className="text-[12px] text-[#1F1F1F] whitespace-pre-wrap">{detail.notes}</div>
              </div>
            )}

            {/* Void warning area */}
            {confirmVoid && (
              <div className="rounded-lg p-4"
                style={{background:'#FEE2E2', border:'1px solid #CF1322'}}>
                <div className="text-[13px] font-bold text-[#CF1322] mb-2">⚠️ Void this payment?</div>
                <div className="text-[12px] text-[#1F1F1F] mb-3">
                  This will:
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    <li>Reverse <span className="font-mono font-bold">${(detail.amount || 0).toFixed(2)}</span> from {allocations.length} invoice{allocations.length === 1 ? '' : 's'}</li>
                    <li>Restore the customer's outstanding balance</li>
                    <li><strong>Permanently delete</strong> this payment record</li>
                  </ul>
                  <div className="mt-2 text-[#CF1322]">This cannot be undone.</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmVoid(false)} disabled={voiding}
                    className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
                    Keep Payment
                  </button>
                  <button onClick={voidPayment} disabled={voiding}
                    className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer text-white disabled:opacity-40"
                    style={{background:'#CF1322', border:'none'}}>
                    {voiding ? 'Voiding...' : '🗑 Yes, Void Payment'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 flex gap-2 flex-shrink-0" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onClose}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              Close
            </button>
            {!confirmVoid && (
              <button onClick={() => setConfirmVoid(true)}
                className="rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer"
                style={{background:'#FFFFFF', color:'#CF1322', border:'1px solid #FECACA'}}>
                🗑 Void
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
