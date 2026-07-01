// src/pages/business/tabs/PaymentsTab.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import PaymentDetailModal from '@/pages/payments/PaymentDetailModal'

const METHOD_BADGE = {
  cash:          { bg:'#d1fae5', color:'#059669', label:'💵 Cash' },
  check:         { bg:'#eef0fc', color:'#5E6AD2', label:'🏦 Check' },
  ach:           { bg:'#FEF3C7', color:'#B45309', label:'🔄 ACH' },
  card:          { bg:'#F3E8FF', color:'#7C3AED', label:'💳 Card' },
  bank_transfer: { bg:'#eef0fc', color:'#5E6AD2', label:'🏦 Bank' },
  other:         { bg:'#F5F5F5', color:'#666',    label:'📋 Other' },
}

export default function PaymentsTab({ customerId, onChanged }) {
  const [viewing, setViewing] = useState(null)

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['company-payments', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('received_payments')
        .select('*')
        .eq('business_customer_id', customerId)
        .order('payment_date', { ascending: false })
      return data || []
    },
  })

  const totalReceived = payments.reduce((s, p) => s + (p.amount || 0), 0)

  return (
    <div>
      <div className="mb-3 text-[11px] text-[#666]">
        {payments.length} payment{payments.length !== 1 ? 's' : ''} ·
        Total received: <span className="font-bold font-mono text-[#059669]">${totalReceived.toFixed(2)}</span>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-[12px] text-[#999]">Loading...</div>
      ) : payments.length === 0 ? (
        <div className="rounded-lg p-8 text-center text-[12px] text-[#999]"
          style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
          No payments received yet from this company
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg overflow-hidden">
          <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
            style={{gridTemplateColumns:'1.2fr 100px 100px 1fr 100px'}}>
            {['Payment #','Date','Method','Reference','Amount'].map(h => (
              <div key={h} className="px-3 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {payments.map(p => {
            const m = METHOD_BADGE[p.payment_method] || METHOD_BADGE.other
            return (
              <div key={p.id} onClick={() => setViewing(p)}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] cursor-pointer items-center"
                style={{gridTemplateColumns:'1.2fr 100px 100px 1fr 100px'}}>
                <div className="px-3 py-2.5 font-mono text-[12px] font-bold text-[#059669]">
                  {p.payment_number}
                </div>
                <div className="px-3 py-2.5 text-[11px] text-[#666]">
                  {p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—'}
                </div>
                <div className="px-3 py-2.5">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{background:m.bg, color:m.color}}>
                    {m.label}
                  </span>
                </div>
                <div className="px-3 py-2.5 text-[11px] text-[#666] font-mono truncate">
                  {p.reference_number || '—'}
                </div>
                <div className="px-3 py-2.5 text-right font-mono text-[13px] font-bold text-[#059669]">
                  ${(p.amount || 0).toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {viewing && (
        <PaymentDetailModal payment={viewing} onClose={() => setViewing(null)} onChanged={onChanged}/>
      )}
    </div>
  )
}
