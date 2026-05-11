// src/pages/business/tabs/InvoicesTab.jsx
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import InvoiceDetailModal from '@/pages/invoices/InvoiceDetailModal'

const STATUS_BADGE = {
  draft:    { bg:'#F5F5F5', color:'#666',    label:'Draft' },
  sent:     { bg:'#E6F0FF', color:'#006AFF', label:'Sent' },
  viewed:   { bg:'#E6F0FF', color:'#006AFF', label:'Viewed' },
  partial:  { bg:'#FEF3C7', color:'#B45309', label:'Partial' },
  paid:     { bg:'#DCFCE7', color:'#15803D', label:'Paid' },
  void:     { bg:'#F5F5F5', color:'#999',    label:'Void' },
}

export default function InvoicesTab({ customerId, onChanged }) {
  const [filter, setFilter] = useState('all')
  const [viewing, setViewing] = useState(null)

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['company-invoices', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('invoices')
        .select('*')
        .eq('business_customer_id', customerId)
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  const filtered = useMemo(() => {
    if (filter === 'open') return invoices.filter(i => ['sent','viewed','partial'].includes(i.status) && (i.balance_due || 0) > 0)
    if (filter === 'overdue') return invoices.filter(i =>
      i.due_date && new Date(i.due_date) < new Date()
      && !['paid','void'].includes(i.status) && (i.balance_due || 0) > 0
    )
    if (filter === 'paid')    return invoices.filter(i => i.status === 'paid')
    return invoices
  }, [invoices, filter])

  const counts = useMemo(() => ({
    all: invoices.length,
    open: invoices.filter(i => ['sent','viewed','partial'].includes(i.status) && (i.balance_due || 0) > 0).length,
    overdue: invoices.filter(i => i.due_date && new Date(i.due_date) < new Date()
      && !['paid','void'].includes(i.status) && (i.balance_due || 0) > 0).length,
    paid: invoices.filter(i => i.status === 'paid').length,
  }), [invoices])

  return (
    <div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <FTab active={filter==='all'}     onClick={()=>setFilter('all')}     count={counts.all}>All</FTab>
        <FTab active={filter==='open'}    onClick={()=>setFilter('open')}    count={counts.open}    highlight>📤 Open</FTab>
        <FTab active={filter==='overdue'} onClick={()=>setFilter('overdue')} count={counts.overdue} red>⚠️ Overdue</FTab>
        <FTab active={filter==='paid'}    onClick={()=>setFilter('paid')}    count={counts.paid}>✅ Paid</FTab>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-[12px] text-[#999]">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg p-8 text-center text-[12px] text-[#999]"
          style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
          {invoices.length === 0 ? 'No invoices yet for this company' : 'No invoices match this filter'}
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg overflow-hidden">
          <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
            style={{gridTemplateColumns:'1.2fr 1fr 1fr 90px 100px 100px'}}>
            {['Invoice #','Date','Due','Status','Total','Balance'].map(h => (
              <div key={h} className="px-3 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {filtered.map(inv => {
            const overdue = inv.due_date && new Date(inv.due_date) < new Date()
                          && !['paid','void'].includes(inv.status) && (inv.balance_due || 0) > 0
            const sb = STATUS_BADGE[inv.status] || STATUS_BADGE.sent
            return (
              <div key={inv.id} onClick={() => setViewing(inv)}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] cursor-pointer items-center"
                style={{gridTemplateColumns:'1.2fr 1fr 1fr 90px 100px 100px'}}>
                <div className="px-3 py-2.5 font-mono text-[12px] font-bold text-[#006AFF]">
                  {inv.invoice_number}
                </div>
                <div className="px-3 py-2.5 text-[11px] text-[#666]">
                  {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '—'}
                </div>
                <div className="px-3 py-2.5 text-[11px]" style={{color: overdue ? '#CF1322' : '#666'}}>
                  {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                  {overdue && <span className="ml-1 text-[9px] font-bold">⚠️</span>}
                </div>
                <div className="px-3 py-2.5">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase"
                    style={overdue ? {background:'#FEE2E2', color:'#CF1322'} : {background:sb.bg, color:sb.color}}>
                    {overdue ? 'Overdue' : sb.label}
                  </span>
                </div>
                <div className="px-3 py-2.5 text-right font-mono text-[12px]">${(inv.total || 0).toFixed(2)}</div>
                <div className="px-3 py-2.5 text-right font-mono text-[12px] font-bold"
                  style={{color: (inv.balance_due || 0) > 0 ? '#CF1322' : '#15803D'}}>
                  ${(inv.balance_due || 0).toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {viewing && (
        <InvoiceDetailModal
          invoice={viewing}
          onClose={() => setViewing(null)}
          onChanged={onChanged}/>
      )}
    </div>
  )
}

function FTab({ active, onClick, count, highlight, red, children }) {
  return (
    <button onClick={onClick}
      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
      style={active
        ? { background: red ? '#CF1322' : '#006AFF', color:'#FFFFFF', border:'none' }
        : { background:'#FFFFFF', color: red ? '#CF1322' : highlight ? '#006AFF' : '#1F1F1F', border:'1px solid #E5E5E5' }}>
      {children} <span className="opacity-75">({count})</span>
    </button>
  )
}
