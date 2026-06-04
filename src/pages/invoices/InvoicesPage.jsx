// src/pages/invoices/InvoicesPage.jsx
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import CreateInvoiceModal from './CreateInvoiceModal'
import InvoiceDetailModal from './InvoiceDetailModal'
import ReceivePaymentModal from './ReceivePaymentModal'

const STATUS_BADGE = {
  draft:    { bg:'#F5F5F5', color:'#666',    label:'Draft' },
  sent:     { bg:'#E6F0FF', color:'#006AFF', label:'Sent' },
  viewed:   { bg:'#E6F0FF', color:'#006AFF', label:'Viewed' },
  partial:  { bg:'#FEF3C7', color:'#B45309', label:'Partial' },
  paid:     { bg:'#DCFCE7', color:'#15803D', label:'Paid' },
  overdue:  { bg:'#FEE2E2', color:'#CF1322', label:'Overdue' },
  void:     { bg:'#F5F5F5', color:'#999',    label:'Void' },
  voided:   { bg:'#F5F5F5', color:'#999',    label:'Voided' },
  closed:   { bg:'#E5E7EB', color:'#374151', label:'🔒 Closed' },
}

export default function InvoicesPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showCreate, setShowCreate]     = useState(false)
  const [showReceive, setShowReceive]   = useState(false)
  const [viewingInv, setViewingInv]     = useState(null)
  const [statusFilter, setStatusFilter] = useState(searchParams.get('filter') || 'all')
  const [search, setSearch]             = useState('')

  // Sync filter to URL (so deep links from B2B Center KPIs work)
  useEffect(() => {
    if (statusFilter === 'all') {
      searchParams.delete('filter')
    } else {
      searchParams.set('filter', statusFilter)
    }
    setSearchParams(searchParams, { replace: true })
    // eslint-disable-next-line
  }, [statusFilter])

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices-list', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_invoice_with_customer')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(200)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const filtered = useMemo(() => {
    let list = invoices
    if (statusFilter === 'unpaid') {
      list = list.filter(i => ['sent', 'viewed', 'partial', 'overdue'].includes(i.status))
    } else if (statusFilter === 'overdue') {
      list = list.filter(i => i.days_overdue > 0 && i.status !== 'paid' && i.status !== 'void' && i.status !== 'voided')
    } else if (statusFilter === 'paid') {
      list = list.filter(i => i.status === 'paid')
    } else if (statusFilter === 'draft') {
      list = list.filter(i => i.status === 'draft')
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(i =>
        i.invoice_number?.toLowerCase().includes(q) ||
        i.company_name?.toLowerCase().includes(q)
      )
    }
    return list
  }, [invoices, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: invoices.length, draft: 0, unpaid: 0, overdue: 0, paid: 0 }
    let totalOwed = 0
    invoices.forEach(i => {
      if (i.status === 'draft') c.draft++
      if (['sent', 'viewed', 'partial', 'overdue'].includes(i.status)) c.unpaid++
      if (i.days_overdue > 0 && i.status !== 'paid' && i.status !== 'void' && i.status !== 'voided') c.overdue++
      if (i.status === 'paid') c.paid++
      if (i.status !== 'paid' && i.status !== 'void' && i.status !== 'voided') totalOwed += (i.balance_due || 0)
    })
    return { ...c, totalOwed }
  }, [invoices])

  return (
    <div className="b2b-theme">
      <div className="max-w-[1200px] mx-auto px-6 py-8">

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink leading-tight">Invoices</h1>
            <p className="text-sm text-ink/55 mt-1">
              Total outstanding <span className="font-semibold tabular-nums text-clay">${counts.totalOwed.toFixed(2)}</span>
              {counts.overdue > 0 && (
                <> · <span className="font-semibold text-clay">{counts.overdue} overdue</span></>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowReceive(true)} className="btn-outline">
              Receive Payment
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              + New Invoice
            </button>
          </div>
        </div>

        {/* ── Search + filters ── */}
        <div className="mb-5 space-y-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by invoice number or company name…"
            className="input"/>
          <div className="flex gap-2 flex-wrap">
            <FilterTab active={statusFilter==='all'}     onClick={() => setStatusFilter('all')}     count={counts.all}>All</FilterTab>
            <FilterTab active={statusFilter==='draft'}   onClick={() => setStatusFilter('draft')}   count={counts.draft}>Draft</FilterTab>
            <FilterTab active={statusFilter==='unpaid'}  onClick={() => setStatusFilter('unpaid')}  count={counts.unpaid}>Unpaid</FilterTab>
            <FilterTab active={statusFilter==='overdue'} onClick={() => setStatusFilter('overdue')} count={counts.overdue} red>Overdue</FilterTab>
            <FilterTab active={statusFilter==='paid'}    onClick={() => setStatusFilter('paid')}    count={counts.paid}>Paid</FilterTab>
          </div>
        </div>

        {/* ── List ── */}
        {isLoading ? (
          <div className="card p-12 text-center text-sm text-ink/55">Loading invoices…</div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="font-display text-2xl text-ink mb-1">
              {invoices.length === 0 ? 'No invoices yet' : 'No invoices match your filter'}
            </div>
            <p className="text-sm text-ink/55 mb-4">
              {invoices.length === 0
                ? 'Create your first invoice to start tracking what your wholesale customers owe.'
                : 'Try clearing your search or picking a different filter.'}
            </p>
            {invoices.length === 0 && (
              <button onClick={() => setShowCreate(true)} className="btn-primary">
                Create your first invoice
              </button>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden">
            {/* table header */}
            <div className="grid bg-sand/60 border-b border-black/[.06]"
              style={{gridTemplateColumns:'1.3fr 1.4fr 1fr 1fr 100px 110px 110px'}}>
              {['Invoice','Company','Status','Due Date','Days Past','Balance','Total'].map((h,i) => (
                <div key={h} className={`px-4 py-3 text-xs uppercase tracking-wide font-semibold text-ink/50 ${i>=4 ? 'text-right' : ''}`}>{h}</div>
              ))}
            </div>
            {/* rows */}
            <div className="divide-y divide-black/[.06]">
              {filtered.map(inv => {
                const st = STATUS_BADGE[inv.status] || STATUS_BADGE.draft
                const isOverdue = inv.days_overdue > 0 && inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'voided'
                const badgeCls =
                  isOverdue                                       ? 'bg-clay/10 text-clay'
                  : inv.status === 'paid'                         ? 'bg-moss-50 text-moss-700'
                  : (inv.status === 'sent' || inv.status === 'viewed') ? 'bg-moss-50 text-moss-700'
                  : inv.status === 'partial'                      ? 'bg-clay/10 text-clay'
                  :                                                 'bg-black/5 text-ink/70'
                return (
                  <div key={inv.id} onClick={() => setViewingInv(inv)}
                    className="grid items-center hover:bg-sand/40 cursor-pointer transition-colors"
                    style={{gridTemplateColumns:'1.3fr 1.4fr 1fr 1fr 100px 110px 110px'}}>
                    <div className="px-4 py-3.5 font-semibold text-ink tabular-nums">
                      {inv.invoice_number}
                      {inv.source_estimate_id && (
                        <span className="ml-1.5 text-xs text-ink/40" title="From estimate">·</span>
                      )}
                    </div>
                    <div className="px-4 py-3.5 text-sm text-ink truncate">
                      {inv.company_name || <span className="text-ink/40">—</span>}
                    </div>
                    <div className="px-4 py-3.5">
                      <span className={`badge ${badgeCls}`}>
                        {isOverdue ? 'Overdue' : st.label}
                      </span>
                    </div>
                    <div className="px-4 py-3.5 text-sm text-ink/65">
                      {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : <span className="text-ink/40">—</span>}
                    </div>
                    <div className={`px-4 py-3.5 text-right text-sm tabular-nums ${isOverdue ? 'text-clay font-semibold' : 'text-ink/40'}`}>
                      {isOverdue ? `${inv.days_overdue}d` : '—'}
                    </div>
                    <div className={`px-4 py-3.5 text-right tabular-nums font-semibold ${
                      (inv.balance_due || 0) > 0 ? 'text-clay' : 'text-moss-700'
                    }`}>
                      ${(inv.balance_due || 0).toFixed(2)}
                    </div>
                    <div className="px-4 py-3.5 text-right tabular-nums text-ink">
                      ${(inv.total || 0).toFixed(2)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {showCreate && (
          <CreateInvoiceModal
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false)
              qc.invalidateQueries({ queryKey: ['invoices-list'] })
              qc.invalidateQueries({ queryKey: ['stock-rows'] })
            }}
          />
        )}
        {showReceive && (
          <ReceivePaymentModal
            onClose={() => setShowReceive(false)}
            onDone={() => {
              setShowReceive(false)
              qc.invalidateQueries({ queryKey: ['invoices-list'] })
            }}
          />
        )}
        {viewingInv && (
          <InvoiceDetailModal
            invoice={viewingInv}
            onClose={() => setViewingInv(null)}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ['invoices-list'] })
              qc.invalidateQueries({ queryKey: ['stock-rows'] })
              qc.invalidateQueries({ queryKey: ['pos-products'] })
              qc.invalidateQueries({ queryKey: ['products'] })
            }}
          />
        )}
      </div>
    </div>
  )
}

function FilterTab({ active, onClick, count, red, children }) {
  // Pill-style tabs that match the premium-SaaS look. Active gets the
  // moss/clay solid; inactive is a quiet white pill with a hairline border.
  const activeBg  = red ? 'bg-clay text-white border-transparent' : 'bg-moss-700 text-white border-transparent'
  const inactive  = 'bg-white text-ink border-black/[.08] hover:bg-sand/60'
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition active:scale-[.98] ${active ? activeBg : inactive}`}>
      {children}
      <span className={`text-xs ${active ? 'opacity-80' : 'text-ink/40'}`}>({count})</span>
    </button>
  )
}
