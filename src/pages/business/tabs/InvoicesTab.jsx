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
  voided:   { bg:'#F5F5F5', color:'#999',    label:'Voided' },
  void:     { bg:'#F5F5F5', color:'#999',    label:'Void' },    // legacy
  closed:   { bg:'#E5E7EB', color:'#374151', label:'🔒 Closed' },
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
      && !['paid','void','voided','draft'].includes(i.status) && (i.balance_due || 0) > 0
    )
    if (filter === 'paid')    return invoices.filter(i => i.status === 'paid')
    return invoices
  }, [invoices, filter])

  const counts = useMemo(() => ({
    all: invoices.length,
    open: invoices.filter(i => ['sent','viewed','partial'].includes(i.status) && (i.balance_due || 0) > 0).length,
    overdue: invoices.filter(i => i.due_date && new Date(i.due_date) < new Date()
      && !['paid','void','voided','draft'].includes(i.status) && (i.balance_due || 0) > 0).length,
    paid: invoices.filter(i => i.status === 'paid').length,
  }), [invoices])

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        <FTab active={filter==='all'}     onClick={()=>setFilter('all')}     count={counts.all}>All</FTab>
        <FTab active={filter==='open'}    onClick={()=>setFilter('open')}    count={counts.open}>Open</FTab>
        <FTab active={filter==='overdue'} onClick={()=>setFilter('overdue')} count={counts.overdue} red>Overdue</FTab>
        <FTab active={filter==='paid'}    onClick={()=>setFilter('paid')}    count={counts.paid}>Paid</FTab>
      </div>

      {isLoading ? (
        <div className="card p-10 text-center text-sm text-slate-500">Loading invoices…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-slate-500">
            {invoices.length === 0 ? 'No invoices yet for this company.' : 'No invoices match this filter.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid bg-slate-50 border-b border-black/[.06]"
            style={{gridTemplateColumns:'1.2fr 1fr 1fr 110px 110px 110px'}}>
            {['Invoice','Date','Due','Status','Total','Balance'].map((h,i) => (
              <div key={h} className={`px-4 py-3 text-xs uppercase tracking-wide font-semibold text-slate-500 ${i>=4?'text-right':''}`}>{h}</div>
            ))}
          </div>
          <div className="divide-y divide-black/[.06]">
            {filtered.map(inv => {
              const overdue = inv.due_date && new Date(inv.due_date) < new Date()
                            && !['paid','void'].includes(inv.status) && (inv.balance_due || 0) > 0
              const sb = STATUS_BADGE[inv.status] || STATUS_BADGE.sent
              const badgeCls =
                overdue                          ? 'bg-red-50 text-red-600'
                : inv.status === 'paid'          ? 'bg-emerald-50 text-emerald-600'
                : (inv.status === 'sent' || inv.status === 'viewed') ? 'bg-emerald-50 text-emerald-600'
                : inv.status === 'partial'       ? 'bg-red-50 text-red-600'
                :                                  'bg-black/5 text-slate-600'
              return (
                <div key={inv.id} onClick={() => setViewing(inv)}
                  className="grid items-center hover:bg-slate-50 cursor-pointer transition-colors"
                  style={{gridTemplateColumns:'1.2fr 1fr 1fr 110px 110px 110px'}}>
                  <div className="px-4 py-3 font-semibold text-slate-900 tabular-nums">{inv.invoice_number}</div>
                  <div className="px-4 py-3 text-sm text-slate-600">
                    {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : <span className="text-slate-400">—</span>}
                  </div>
                  <div className={`px-4 py-3 text-sm ${overdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                    {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : <span className="text-slate-400">—</span>}
                  </div>
                  <div className="px-4 py-3">
                    <span className={`badge ${badgeCls}`}>
                      {overdue ? 'Overdue' : sb.label}
                    </span>
                  </div>
                  <div className="px-4 py-3 text-right tabular-nums text-slate-900">${(inv.total || 0).toFixed(2)}</div>
                  <div className={`px-4 py-3 text-right tabular-nums font-semibold ${
                    (inv.balance_due || 0) > 0 ? 'text-red-600' : 'text-emerald-600'
                  }`}>
                    ${(inv.balance_due || 0).toFixed(2)}
                  </div>
                </div>
              )
            })}
          </div>
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

function FTab({ active, onClick, count, red, children }) {
  const activeBg = red ? 'bg-red-600 text-white border-transparent' : 'bg-lx-500 text-white border-transparent'
  const inactive = 'bg-white text-slate-900 border-black/[.08] hover:bg-slate-50'
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition active:scale-[.98] ${active ? activeBg : inactive}`}>
      {children}
      <span className={`text-xs ${active ? 'opacity-80' : 'text-slate-400'}`}>({count})</span>
    </button>
  )
}
