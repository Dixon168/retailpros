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
        <div className="card p-10 text-center text-sm text-ink/55">Loading invoices…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink/55">
            {invoices.length === 0 ? 'No invoices yet for this company.' : 'No invoices match this filter.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid bg-sand/60 border-b border-black/[.06]"
            style={{gridTemplateColumns:'1.2fr 1fr 1fr 110px 110px 110px'}}>
            {['Invoice','Date','Due','Status','Total','Balance'].map((h,i) => (
              <div key={h} className={`px-4 py-3 text-xs uppercase tracking-wide font-semibold text-ink/50 ${i>=4?'text-right':''}`}>{h}</div>
            ))}
          </div>
          <div className="divide-y divide-black/[.06]">
            {filtered.map(inv => {
              const overdue = inv.due_date && new Date(inv.due_date) < new Date()
                            && !['paid','void'].includes(inv.status) && (inv.balance_due || 0) > 0
              const sb = STATUS_BADGE[inv.status] || STATUS_BADGE.sent
              const badgeCls =
                overdue                          ? 'bg-clay/10 text-clay'
                : inv.status === 'paid'          ? 'bg-moss-50 text-moss-700'
                : (inv.status === 'sent' || inv.status === 'viewed') ? 'bg-moss-50 text-moss-700'
                : inv.status === 'partial'       ? 'bg-clay/10 text-clay'
                :                                  'bg-black/5 text-ink/70'
              return (
                <div key={inv.id} onClick={() => setViewing(inv)}
                  className="grid items-center hover:bg-sand/40 cursor-pointer transition-colors"
                  style={{gridTemplateColumns:'1.2fr 1fr 1fr 110px 110px 110px'}}>
                  <div className="px-4 py-3 font-semibold text-ink tabular-nums">{inv.invoice_number}</div>
                  <div className="px-4 py-3 text-sm text-ink/65">
                    {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : <span className="text-ink/40">—</span>}
                  </div>
                  <div className={`px-4 py-3 text-sm ${overdue ? 'text-clay font-semibold' : 'text-ink/65'}`}>
                    {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : <span className="text-ink/40">—</span>}
                  </div>
                  <div className="px-4 py-3">
                    <span className={`badge ${badgeCls}`}>
                      {overdue ? 'Overdue' : sb.label}
                    </span>
                  </div>
                  <div className="px-4 py-3 text-right tabular-nums text-ink">${(inv.total || 0).toFixed(2)}</div>
                  <div className={`px-4 py-3 text-right tabular-nums font-semibold ${
                    (inv.balance_due || 0) > 0 ? 'text-clay' : 'text-moss-700'
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
  const activeBg = red ? 'bg-clay text-white border-transparent' : 'bg-moss-700 text-white border-transparent'
  const inactive = 'bg-white text-ink border-black/[.08] hover:bg-sand/60'
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition active:scale-[.98] ${active ? activeBg : inactive}`}>
      {children}
      <span className={`text-xs ${active ? 'opacity-80' : 'text-ink/40'}`}>({count})</span>
    </button>
  )
}
