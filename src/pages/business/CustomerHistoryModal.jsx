// src/pages/business/CustomerHistoryModal.jsx
// Drill-down: full A/R history for one business customer
// - Summary stats
// - All invoices (paid + open)
// - All payments received
// Click invoice → opens InvoiceDetailModal
// Click payment → opens PaymentDetailModal

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import InvoiceDetailModal from '@/pages/invoices/InvoiceDetailModal'
import PaymentDetailModal from '@/pages/payments/PaymentDetailModal'
import ReceivePaymentModal from '@/pages/invoices/ReceivePaymentModal'
import CreateInvoiceModal from '@/pages/invoices/CreateInvoiceModal'
import CreateEstimateModal from '@/pages/estimates/CreateEstimateModal'

const STATUS_COLOR = {
  draft:   { bg:'#F5F5F5', color:'#666' },
  sent:    { bg:'#E6F0FF', color:'#006AFF' },
  viewed:  { bg:'#E6F0FF', color:'#006AFF' },
  partial: { bg:'#FEF3C7', color:'#B45309' },
  paid:    { bg:'#DCFCE7', color:'#15803D' },
  overdue: { bg:'#FEE2E2', color:'#CF1322' },
  void:    { bg:'#F5F5F5', color:'#999' },
}

const METHOD_LABELS = {
  cash:'💵 Cash', check:'🏦 Check', ach:'🔄 ACH',
  card:'💳 Card', bank_transfer:'🏦 Bank', other:'📋 Other'
}

export default function CustomerHistoryModal({ customerId, onClose, onChanged }) {
  const { tenant } = useAuthStore()
  const [tab, setTab] = useState('invoices')
  const [viewingInv, setViewingInv] = useState(null)
  const [viewingPmt, setViewingPmt] = useState(null)
  const [showReceive, setShowReceive] = useState(false)
  const [showCreateInv, setShowCreateInv] = useState(false)
  const [showCreateEst, setShowCreateEst] = useState(false)

  const { data: customer } = useQuery({
    queryKey: ['business-customer', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('business_customers')
        .select('*').eq('id', customerId).single()
      return data
    },
    enabled: !!customerId,
  })

  const { data: invoices = [] } = useQuery({
    queryKey: ['customer-invoices', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('invoices')
        .select('*').eq('business_customer_id', customerId)
        .order('invoice_date', { ascending: false })
      return data || []
    },
    enabled: !!customerId,
  })

  const { data: payments = [] } = useQuery({
    queryKey: ['customer-payments', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('received_payments')
        .select('*').eq('business_customer_id', customerId)
        .order('payment_date', { ascending: false })
      return data || []
    },
    enabled: !!customerId,
  })

  if (!customer) {
    return (
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="bg-white rounded-2xl p-12 text-[#666]">Loading...</div>
      </div>
    )
  }

  const totalOwed   = invoices.filter(i => !['paid','void'].includes(i.status))
                              .reduce((s,i) => s + (i.balance_due || 0), 0)
  const totalSpent  = invoices.filter(i => i.status !== 'void').reduce((s,i) => s + (i.total || 0), 0)
  const totalPaid   = payments.reduce((s,p) => s + (p.amount || 0), 0)
  const overdueInvs = invoices.filter(i =>
    i.due_date && new Date(i.due_date) < new Date()
    && !['paid','void'].includes(i.status)
    && (i.balance_due || 0) > 0
  )

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
              <div className="text-[18px] font-bold text-[#1F1F1F]">{customer.company_name}</div>
              <div className="text-[12px] text-[#666] mt-1">
                {[customer.contact_name, customer.contact_email, customer.contact_phone].filter(Boolean).join(' · ')}
              </div>
              <div className="text-[11px] text-[#666] mt-0.5">
                Terms: <span className="font-bold uppercase">{customer.payment_terms || 'NET 30'}</span>
                {customer.credit_limit > 0 && (
                  <> · Credit limit: <span className="font-mono">${customer.credit_limit.toFixed(0)}</span></>
                )}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
              style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          {/* Stats */}
          <div className="px-5 py-3 grid grid-cols-4 gap-3 flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
            <Stat label="Owed" value={`$${totalOwed.toFixed(0)}`} color={totalOwed > 0 ? '#CF1322' : '#15803D'}/>
            <Stat label="Total Sales" value={`$${totalSpent.toFixed(0)}`}/>
            <Stat label="Total Paid" value={`$${totalPaid.toFixed(0)}`} color="#15803D"/>
            <Stat label="Overdue" value={overdueInvs.length} color={overdueInvs.length > 0 ? '#CF1322' : '#15803D'}/>
          </div>

          {/* Tabs */}
          <div className="px-5 py-2 flex gap-2 flex-shrink-0 items-center" style={{borderBottom:'1px solid #E5E5E5'}}>
            <TabButton active={tab==='invoices'} onClick={() => setTab('invoices')}>
              📄 Invoices ({invoices.length})
            </TabButton>
            <TabButton active={tab==='payments'} onClick={() => setTab('payments')}>
              💰 Payments ({payments.length})
            </TabButton>

            {/* Quick actions for this customer */}
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => setShowCreateEst(true)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #006AFF'}}>
                + Estimate
              </button>
              <button onClick={() => setShowCreateInv(true)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
                + Invoice
              </button>
              {totalOwed > 0 && (
                <button onClick={() => setShowReceive(true)}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                  style={{background:'#15803D', color:'#FFFFFF', border:'none'}}>
                  💰 Receive
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {tab === 'invoices' && (
              invoices.length === 0 ? (
                <div className="p-8 text-center text-[12px] text-[#999]">No invoices yet</div>
              ) : (
                <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
                  <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
                    style={{gridTemplateColumns:'1.2fr 1fr 1fr 90px 100px'}}>
                    {['Invoice #','Date','Due','Status','Balance'].map(h => (
                      <div key={h} className="px-3 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                    ))}
                  </div>
                  {invoices.map(inv => {
                    const overdue = inv.due_date && new Date(inv.due_date) < new Date()
                                    && !['paid','void'].includes(inv.status)
                                    && (inv.balance_due || 0) > 0
                    const sc = STATUS_COLOR[inv.status] || STATUS_COLOR.draft
                    return (
                      <div key={inv.id} onClick={() => setViewingInv(inv)}
                        className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] cursor-pointer items-center"
                        style={{gridTemplateColumns:'1.2fr 1fr 1fr 90px 100px'}}>
                        <div className="px-3 py-2.5 font-mono text-[12px] font-bold text-[#006AFF]">
                          {inv.invoice_number}
                        </div>
                        <div className="px-3 py-2.5 text-[11px] text-[#666]">
                          {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '—'}
                        </div>
                        <div className="px-3 py-2.5 text-[11px]" style={{color: overdue ? '#CF1322' : '#666'}}>
                          {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                          {overdue && <span className="ml-1 text-[9px]">⚠️</span>}
                        </div>
                        <div className="px-3 py-2.5">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase"
                            style={overdue ? {background:'#FEE2E2', color:'#CF1322'} : {background:sc.bg, color:sc.color}}>
                            {overdue ? 'Overdue' : inv.status}
                          </span>
                        </div>
                        <div className="px-3 py-2.5 text-right font-mono text-[12px] font-bold"
                          style={{color: (inv.balance_due || 0) > 0 ? '#CF1322' : '#15803D'}}>
                          ${(inv.balance_due || 0).toFixed(2)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            )}

            {tab === 'payments' && (
              payments.length === 0 ? (
                <div className="p-8 text-center text-[12px] text-[#999]">No payments received yet</div>
              ) : (
                <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
                  <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
                    style={{gridTemplateColumns:'1.2fr 1fr 90px 1fr 100px'}}>
                    {['Payment #','Date','Method','Reference','Amount'].map(h => (
                      <div key={h} className="px-3 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                    ))}
                  </div>
                  {payments.map(p => (
                    <div key={p.id} onClick={() => setViewingPmt(p)}
                      className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] cursor-pointer items-center"
                      style={{gridTemplateColumns:'1.2fr 1fr 90px 1fr 100px'}}>
                      <div className="px-3 py-2.5 font-mono text-[12px] font-bold text-[#15803D]">
                        {p.payment_number}
                      </div>
                      <div className="px-3 py-2.5 text-[11px] text-[#666]">
                        {p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—'}
                      </div>
                      <div className="px-3 py-2.5 text-[11px] font-bold">
                        {METHOD_LABELS[p.payment_method] || p.payment_method}
                      </div>
                      <div className="px-3 py-2.5 text-[11px] text-[#666] font-mono truncate">
                        {p.reference_number || '—'}
                      </div>
                      <div className="px-3 py-2.5 text-right font-mono text-[12px] font-bold text-[#15803D]">
                        ${(p.amount || 0).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {viewingInv && (
        <InvoiceDetailModal
          invoice={viewingInv}
          onClose={() => setViewingInv(null)}
          onChanged={onChanged}
        />
      )}
      {viewingPmt && (
        <PaymentDetailModal
          payment={viewingPmt}
          onClose={() => setViewingPmt(null)}
          onChanged={onChanged}
        />
      )}
      {showReceive && (
        <ReceivePaymentModal
          presetCustomerId={customerId}
          onClose={() => setShowReceive(false)}
          onDone={() => { setShowReceive(false); onChanged?.() }}
        />
      )}
      {showCreateInv && (
        <CreateInvoiceModal
          presetCustomerId={customerId}
          onClose={() => setShowCreateInv(false)}
          onCreated={() => { setShowCreateInv(false); onChanged?.() }}
        />
      )}
      {showCreateEst && (
        <CreateEstimateModal
          presetCustomerId={customerId}
          onClose={() => setShowCreateEst(false)}
          onCreated={() => { setShowCreateEst(false); onChanged?.() }}
        />
      )}
    </>
  )
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider">{label}</div>
      <div className="text-[20px] font-bold mt-0.5"
        style={{color: color || '#1F1F1F'}}>{value}</div>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer active:scale-[0.96]"
      style={active
        ? { background:'#006AFF', color:'#FFFFFF', border:'none' }
        : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
      {children}
    </button>
  )
}
