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
    <div className="max-w-[1200px] mx-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[22px] font-bold text-[#1F1F1F]">📄 Invoices</div>
          <div className="text-[12px] text-[#666] mt-1">
            Total outstanding: <span className="font-bold font-mono text-[#CF1322]">${counts.totalOwed.toFixed(2)}</span>
            {counts.overdue > 0 && (
              <> · <span className="font-bold text-[#CF1322]">{counts.overdue} overdue</span></>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowReceive(true)}
            className="rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
            style={{background:'#15803D', color:'#FFFFFF', border:'none'}}>
            💰 Receive Payment
          </button>
          <button onClick={() => setShowCreate(true)}
            className="rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
            style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
            + New Invoice
          </button>
        </div>
      </div>

      {/* Search + filter */}
      <div className="mb-4 space-y-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search by invoice number or company name..."
          className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-3 text-[14px] outline-none focus:border-[#006AFF]"/>
        <div className="flex gap-2 flex-wrap">
          <FilterTab active={statusFilter==='all'}     onClick={() => setStatusFilter('all')}     count={counts.all}>All</FilterTab>
          <FilterTab active={statusFilter==='draft'}   onClick={() => setStatusFilter('draft')}   count={counts.draft}>📝 Draft</FilterTab>
          <FilterTab active={statusFilter==='unpaid'}  onClick={() => setStatusFilter('unpaid')}  count={counts.unpaid} highlight>📤 Unpaid</FilterTab>
          <FilterTab active={statusFilter==='overdue'} onClick={() => setStatusFilter('overdue')} count={counts.overdue} red>⚠️ Overdue</FilterTab>
          <FilterTab active={statusFilter==='paid'}    onClick={() => setStatusFilter('paid')}    count={counts.paid}>✅ Paid</FilterTab>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center text-[#666] text-[13px]">
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center">
          <div className="text-[48px] mb-2 opacity-30">📄</div>
          <div className="text-[14px] font-bold text-[#1F1F1F] mb-1">
            {invoices.length === 0 ? 'No invoices yet' : 'No invoices match your filter'}
          </div>
          {invoices.length === 0 && (
            <button onClick={() => setShowCreate(true)}
              className="mt-3 rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              Create your first invoice
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
          <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]"
            style={{gridTemplateColumns:'1.3fr 1.4fr 1fr 1fr 100px 110px 110px'}}>
            {['Invoice #','Company','Status','Due Date','Days Past','Balance','Total'].map(h => (
              <div key={h} className="px-3.5 py-2.5 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {filtered.map(inv => {
            const st = STATUS_BADGE[inv.status] || STATUS_BADGE.draft
            const isOverdue = inv.days_overdue > 0 && inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'voided'
            return (
              <div key={inv.id} onClick={() => setViewingInv(inv)}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] cursor-pointer"
                style={{gridTemplateColumns:'1.3fr 1.4fr 1fr 1fr 100px 110px 110px'}}>
                <div className="px-3.5 py-3 font-mono text-[13px] font-bold text-[#006AFF]">
                  {inv.invoice_number}
                  {inv.source_estimate_id && (
                    <span className="ml-1 text-[9px] text-[#999]" title="From estimate">📝</span>
                  )}
                </div>
                <div className="px-3.5 py-3 text-[13px] text-[#1F1F1F] truncate">
                  {inv.company_name || '—'}
                </div>
                <div className="px-3.5 py-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={isOverdue ? { background:'#FEE2E2', color:'#CF1322' } : { background:st.bg, color:st.color }}>
                    {isOverdue ? 'Overdue' : st.label}
                  </span>
                </div>
                <div className="px-3.5 py-3 text-[12px] text-[#666]">
                  {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                </div>
                <div className="px-3.5 py-3 text-[12px] font-bold"
                  style={{color: isOverdue ? '#CF1322' : '#999'}}>
                  {isOverdue ? `${inv.days_overdue}d` : '—'}
                </div>
                <div className="px-3.5 py-3 text-right font-mono text-[13px] font-bold"
                  style={{color: (inv.balance_due || 0) > 0 ? '#CF1322' : '#15803D'}}>
                  ${(inv.balance_due || 0).toFixed(2)}
                </div>
                <div className="px-3.5 py-3 text-right font-mono text-[13px] text-[#1F1F1F]">
                  ${(inv.total || 0).toFixed(2)}
                </div>
              </div>
            )
          })}
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
            // Invoice changes affect: list view, stock pages, AND POS cart
            // (because Send / Void changes inventory.quantity)
            qc.invalidateQueries({ queryKey: ['invoices-list'] })
            qc.invalidateQueries({ queryKey: ['stock-rows'] })
            qc.invalidateQueries({ queryKey: ['pos-products'] })
            qc.invalidateQueries({ queryKey: ['products'] })  // BackOffice product list
          }}
        />
      )}
    </div>
  )
}

function FilterTab({ active, onClick, count, highlight, red, children }) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 rounded-lg text-[13px] font-bold cursor-pointer active:scale-[0.96]"
      style={active
        ? { background: red ? '#CF1322' : '#006AFF', color:'#FFFFFF', border:'none' }
        : { background:'#FFFFFF',
            color: red ? '#CF1322' : highlight ? '#006AFF' : '#1F1F1F',
            border:'1px solid #E5E5E5' }}>
      {children} <span className="ml-1 opacity-75">({count})</span>
    </button>
  )
}
