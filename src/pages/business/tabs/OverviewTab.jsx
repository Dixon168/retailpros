// src/pages/business/tabs/OverviewTab.jsx
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

const PAYMENT_METHOD_LABELS = {
  cash:'💵 Cash', check:'🏦 Check', ach:'🔄 ACH',
  card:'💳 Card', bank_transfer:'🏦 Bank', other:'📋 Other'
}

export default function OverviewTab({ customer }) {
  const cid = customer.id

  const { data: recentInvoices = [] } = useQuery({
    queryKey: ['company-recent-invoices', cid],
    queryFn: async () => {
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, total, balance_due, status, created_at')
        .eq('business_customer_id', cid)
        .order('created_at', { ascending: false })
        .limit(5)
      return data || []
    },
  })

  const { data: recentPayments = [] } = useQuery({
    queryKey: ['company-recent-payments-overview', cid],
    queryFn: async () => {
      const { data } = await supabase
        .from('received_payments')
        .select('id, payment_number, payment_date, amount, payment_method, reference_number, created_at')
        .eq('business_customer_id', cid)
        .order('created_at', { ascending: false })
        .limit(5)
      return data || []
    },
  })

  // Merge into activity feed
  const activity = [
    ...recentInvoices.map(i => ({ kind:'invoice', at: i.created_at, record: i })),
    ...recentPayments.map(p => ({ kind:'payment', at: p.created_at, record: p })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8)

  return (
    <div className="space-y-4">
      {/* Customer info card */}
      <div className="rounded-lg p-4" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
        <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-2">Company info</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
          <InfoRow label="Primary contact"  value={customer.contact_name}/>
          <InfoRow label="Phone"            value={customer.effective_phone}/>
          <InfoRow label="Email"            value={customer.contact_email}/>
          <InfoRow label="Trade name (DBA)" value={customer.trade_name}/>
          <InfoRow label="Billing address"
            value={[customer.billing_address, [customer.billing_city, customer.billing_state, customer.billing_zip].filter(Boolean).join(', ')]
              .filter(Boolean).join(' · ')}/>
          <InfoRow label="Customer since"
            value={customer.created_at ? new Date(customer.created_at).toLocaleDateString() : null}/>
          <InfoRow label="Credit limit"     value={customer.credit_limit > 0 ? `$${customer.credit_limit.toFixed(2)}` : null}/>
          {customer.opening_balance > 0 && (
            <InfoRow label="Opening balance" value={`$${customer.opening_balance.toFixed(2)}`}/>
          )}
        </div>
      </div>

      {/* Activity feed */}
      <div>
        <div className="text-[12px] font-bold text-[#1F1F1F] mb-2">📋 Recent activity</div>
        {activity.length === 0 ? (
          <div className="rounded-lg p-8 text-center text-[12px] text-[#999]"
            style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
            No activity yet — create an estimate or invoice to get started.
          </div>
        ) : (
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg overflow-hidden">
            {activity.map((a, i) => {
              if (a.kind === 'payment') {
                const p = a.record
                return (
                  <div key={`p-${i}`} className="px-3 py-2.5 flex items-center gap-3 border-b border-[#E5E5E5] last:border-0">
                    <span className="text-[15px]">💰</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-[#1F1F1F]">
                        <span className="font-bold text-[#15803D]">Paid ${(p.amount || 0).toFixed(2)}</span>
                        <span className="text-[#999]"> · {PAYMENT_METHOD_LABELS[p.payment_method] || p.payment_method}</span>
                        {p.reference_number && <span className="text-[#999]"> · Ref: {p.reference_number}</span>}
                      </div>
                      <div className="text-[10px] text-[#999] font-mono">{p.payment_number}</div>
                    </div>
                    <div className="text-[10px] text-[#999]">
                      {p.payment_date ? new Date(p.payment_date).toLocaleDateString() : ''}
                    </div>
                  </div>
                )
              }
              const inv = a.record
              return (
                <div key={`i-${i}`} className="px-3 py-2.5 flex items-center gap-3 border-b border-[#E5E5E5] last:border-0">
                  <span className="text-[15px]">📄</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-[#1F1F1F]">
                      <span className="font-bold">Invoiced ${(inv.total || 0).toFixed(2)}</span>
                      {inv.status === 'paid' && <span className="ml-1.5 text-[10px] font-bold text-[#15803D]">PAID</span>}
                      {inv.status === 'partial' && <span className="ml-1.5 text-[10px] font-bold text-[#B45309]">PARTIAL</span>}
                      {inv.status === 'void' && <span className="ml-1.5 text-[10px] font-bold text-[#999]">VOID</span>}
                      {(inv.balance_due || 0) > 0 && inv.status !== 'paid' && (
                        <span className="ml-1.5 text-[10px] text-[#CF1322]">Balance ${inv.balance_due.toFixed(2)}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#999] font-mono">{inv.invoice_number}</div>
                  </div>
                  <div className="text-[10px] text-[#999]">
                    {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : ''}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start">
      <span className="text-[10px] text-[#666] font-bold uppercase tracking-wider w-[120px] flex-shrink-0">{label}</span>
      <span className="text-[#1F1F1F] flex-1">{value || '—'}</span>
    </div>
  )
}
