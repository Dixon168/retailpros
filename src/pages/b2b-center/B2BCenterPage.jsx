// src/pages/b2b-center/B2BCenterPage.jsx
// Aggregated B2B dashboard — KPIs + quick actions + recent activity + overdue list

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

import CreateEstimateModal from '@/pages/estimates/CreateEstimateModal'
import CreateInvoiceModal from '@/pages/invoices/CreateInvoiceModal'
import ReceivePaymentModal from '@/pages/invoices/ReceivePaymentModal'
import InvoiceDetailModal from '@/pages/invoices/InvoiceDetailModal'
import EstimateDetailModal from '@/pages/estimates/EstimateDetailModal'
import PaymentDetailModal from '@/pages/payments/PaymentDetailModal'

const PAYMENT_METHOD_LABELS = {
  cash:'💵 Cash', check:'🏦 Check', ach:'🔄 ACH',
  card:'💳 Card', bank_transfer:'🏦 Bank', other:'📋 Other'
}

export default function B2BCenterPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const navigate = useNavigate()

  // Modal state
  const [showCreateEst, setShowCreateEst]     = useState(false)
  const [showCreateInv, setShowCreateInv]     = useState(false)
  const [showReceive, setShowReceive]         = useState(false)
  const [viewInvoice, setViewInvoice]         = useState(null)
  const [viewEstimate, setViewEstimate]       = useState(null)
  const [viewPayment, setViewPayment]         = useState(null)

  // ── Invoices summary (uses v_invoice_with_customer) ──
  const { data: invoices = [] } = useQuery({
    queryKey: ['b2b-invoices-all', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_invoice_with_customer')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(500)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // ── Recent payments ──
  const { data: recentPayments = [] } = useQuery({
    queryKey: ['b2b-recent-payments', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_payment_with_customer')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('payment_date', { ascending: false })
        .limit(10)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // ── A/R aging (top overdue customers) ──
  const { data: aging = [] } = useQuery({
    queryKey: ['b2b-aging', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_ar_aging_by_customer')
        .select('*')
        .eq('tenant_id', tenant.id)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // ── Recent estimates ──
  const { data: recentEstimates = [] } = useQuery({
    queryKey: ['b2b-recent-estimates', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_estimate_with_customer')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(8)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // ── Compute KPIs from invoices ──
  const kpis = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const weekFromNow = new Date(today); weekFromNow.setDate(weekFromNow.getDate() + 7)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

    let outstanding = 0, outstandingCount = 0
    let overdue     = 0, overdueCount     = 0
    let dueThisWeek = 0, dueThisWeekCount = 0
    let paidThisMonth = 0, paidThisMonthCount = 0
    let openDraftCount = 0

    invoices.forEach(inv => {
      const balance = inv.balance_due || 0
      const status  = inv.status
      const dueDate = inv.due_date ? new Date(inv.due_date) : null
      if (dueDate) dueDate.setHours(0, 0, 0, 0)
      const isOpen = !['paid', 'void', 'draft'].includes(status) && balance > 0
      const isOverdue = isOpen && dueDate && dueDate < today

      if (status === 'draft') openDraftCount++

      if (isOpen) {
        outstanding += balance
        outstandingCount++
        if (isOverdue) {
          overdue += balance
          overdueCount++
        } else if (dueDate && dueDate >= today && dueDate <= weekFromNow) {
          dueThisWeek += balance
          dueThisWeekCount++
        }
      }

      if (status === 'paid') {
        const paidDate = new Date(inv.updated_at || inv.invoice_date || inv.created_at)
        if (paidDate >= monthStart) {
          paidThisMonth += inv.total || 0
          paidThisMonthCount++
        }
      }
    })

    return {
      outstanding, outstandingCount,
      overdue, overdueCount,
      dueThisWeek, dueThisWeekCount,
      paidThisMonth, paidThisMonthCount,
      openDraftCount,
    }
  }, [invoices])

  // Top 5 overdue customers
  const topOverdue = useMemo(() =>
    aging
      .filter(c => c.oldest_overdue_days > 0)
      .sort((a, b) => (b.oldest_overdue_days || 0) - (a.oldest_overdue_days || 0))
      .slice(0, 5),
    [aging]
  )

  // Build recent activity feed: payments + invoices + estimates, sorted
  const activityFeed = useMemo(() => {
    const items = []
    recentPayments.forEach(p => items.push({
      kind: 'payment', at: p.created_at || p.payment_date,
      record: p,
    }))
    invoices.slice(0, 8).forEach(i => items.push({
      kind: 'invoice', at: i.created_at,
      record: i,
    }))
    recentEstimates.slice(0, 5).forEach(e => items.push({
      kind: 'estimate', at: e.created_at,
      record: e,
    }))
    return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12)
  }, [recentPayments, invoices, recentEstimates])

  return (
    <div className="max-w-[1300px] mx-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[24px] font-bold text-[#1F1F1F]">💼 B2B Center</div>
          <div className="text-[12px] text-[#666] mt-1">
            Estimates · Invoices · Payments · A/R Aging — all in one place
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <KpiCard
          icon="💰" label="Outstanding"
          value={`$${kpis.outstanding.toFixed(0)}`}
          note={`${kpis.outstandingCount} unpaid invoice${kpis.outstandingCount === 1 ? '' : 's'}`}
          color="#1F1F1F"
          onClick={() => navigate('/invoices?filter=unpaid')}
        />
        <KpiCard
          icon="⚠️" label="Overdue"
          value={`$${kpis.overdue.toFixed(0)}`}
          note={`${kpis.overdueCount} past due`}
          color={kpis.overdueCount > 0 ? '#CF1322' : '#15803D'}
          onClick={() => navigate('/invoices?filter=overdue')}
          highlight={kpis.overdueCount > 0}
        />
        <KpiCard
          icon="📅" label="Due This Week"
          value={`$${kpis.dueThisWeek.toFixed(0)}`}
          note={`${kpis.dueThisWeekCount} invoice${kpis.dueThisWeekCount === 1 ? '' : 's'}`}
          color="#B45309"
          onClick={() => navigate('/invoices?filter=unpaid')}
        />
        <KpiCard
          icon="✅" label="Paid This Month"
          value={`$${kpis.paidThisMonth.toFixed(0)}`}
          note={`${kpis.paidThisMonthCount} payment${kpis.paidThisMonthCount === 1 ? '' : 's'}`}
          color="#15803D"
          onClick={() => navigate('/payments')}
        />
      </div>

      {/* Quick actions */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-4 mb-5">
        <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-2.5">🚀 Quick actions</div>
        <div className="flex gap-2 flex-wrap">
          <ActionButton onClick={() => setShowCreateEst(true)} icon="📝" color="#006AFF" label="New Estimate"/>
          <ActionButton onClick={() => setShowCreateInv(true)} icon="📄" color="#006AFF" label="New Invoice"/>
          <ActionButton onClick={() => setShowReceive(true)}   icon="💰" color="#15803D" label="Receive Payment"/>
          <div className="ml-auto flex gap-2">
            <NavButton onClick={() => navigate('/estimates')} label="📝 All Estimates"/>
            <NavButton onClick={() => navigate('/invoices')}  label="📄 All Invoices"/>
            <NavButton onClick={() => navigate('/payments')}  label="💰 Payments"/>
            <NavButton onClick={() => navigate('/reports/ar-aging')} label="📊 A/R Aging"/>
            <NavButton onClick={() => navigate('/business')}  label="🏢 Companies"/>
          </div>
        </div>
      </div>

      {/* 2-column body */}
      <div className="grid grid-cols-2 gap-4">

        {/* LEFT — Recent activity */}
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between border-b border-[#E5E5E5]">
            <div className="text-[13px] font-bold text-[#1F1F1F]">📋 Recent activity</div>
            <span className="text-[11px] text-[#666]">last 12 items</span>
          </div>
          <div className="divide-y divide-[#E5E5E5]">
            {activityFeed.length === 0 ? (
              <div className="p-8 text-center text-[12px] text-[#999]">No activity yet</div>
            ) : activityFeed.map((a, i) => (
              <ActivityRow key={`${a.kind}-${i}`} item={a}
                onOpen={() => {
                  if (a.kind === 'payment')  setViewPayment(a.record)
                  if (a.kind === 'invoice')  setViewInvoice(a.record)
                  if (a.kind === 'estimate') setViewEstimate(a.record)
                }}/>
            ))}
          </div>
        </div>

        {/* RIGHT — Top overdue customers */}
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between border-b border-[#E5E5E5]">
            <div className="text-[13px] font-bold text-[#1F1F1F]">⚠️ Most overdue customers</div>
            <button onClick={() => navigate('/reports/ar-aging')}
              className="text-[11px] font-bold text-[#006AFF] cursor-pointer"
              style={{background:'none', border:'none'}}>
              See all →
            </button>
          </div>
          {topOverdue.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-[36px] mb-2">🎉</div>
              <div className="text-[13px] font-bold text-[#15803D]">No overdue customers!</div>
              <div className="text-[11px] text-[#666] mt-1">Everyone is paying on time</div>
            </div>
          ) : (
            <div className="divide-y divide-[#E5E5E5]">
              {topOverdue.map(c => {
                const days = c.oldest_overdue_days || 0
                const severity = days > 90 ? 'critical' : days > 60 ? 'high' : days > 30 ? 'medium' : 'low'
                const color = severity === 'critical' ? '#CF1322'
                            : severity === 'high'     ? '#CF1322'
                            : severity === 'medium'   ? '#B45309'
                            : '#666'
                const dot = severity === 'critical' ? '🔴'
                          : severity === 'high'     ? '🔴'
                          : severity === 'medium'   ? '🟡'
                          : '🟢'
                return (
                  <div key={c.customer_id} onClick={() => navigate(`/business/${c.customer_id}`)}
                    className="px-4 py-3 hover:bg-[#FAFAFA] cursor-pointer flex items-center gap-3">
                    <span className="text-[14px]">{dot}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{c.company_name}</div>
                      <div className="text-[11px] font-bold" style={{color}}>
                        {days} days overdue
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-mono text-[15px] font-bold" style={{color}}>
                        ${(c.total_owed || 0).toFixed(0)}
                      </div>
                      <div className="text-[10px] text-[#666]">{c.invoice_count} invoice{c.invoice_count === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateEst && (
        <CreateEstimateModal
          onClose={() => setShowCreateEst(false)}
          onCreated={() => {
            setShowCreateEst(false)
            qc.invalidateQueries({ queryKey: ['b2b-recent-estimates'] })
            qc.invalidateQueries({ queryKey: ['estimates-list'] })
          }}/>
      )}
      {showCreateInv && (
        <CreateInvoiceModal
          onClose={() => setShowCreateInv(false)}
          onCreated={() => {
            setShowCreateInv(false)
            qc.invalidateQueries({ queryKey: ['b2b-invoices-all'] })
            qc.invalidateQueries({ queryKey: ['b2b-aging'] })
            qc.invalidateQueries({ queryKey: ['invoices-list'] })
          }}/>
      )}
      {showReceive && (
        <ReceivePaymentModal
          onClose={() => setShowReceive(false)}
          onDone={() => {
            setShowReceive(false)
            qc.invalidateQueries({ queryKey: ['b2b-invoices-all'] })
            qc.invalidateQueries({ queryKey: ['b2b-recent-payments'] })
            qc.invalidateQueries({ queryKey: ['b2b-aging'] })
            qc.invalidateQueries({ queryKey: ['invoices-list'] })
            qc.invalidateQueries({ queryKey: ['payments-list'] })
          }}/>
      )}
      {viewInvoice && (
        <InvoiceDetailModal
          invoice={viewInvoice}
          onClose={() => setViewInvoice(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['b2b-invoices-all'] })
            qc.invalidateQueries({ queryKey: ['b2b-aging'] })
          }}/>
      )}
      {viewEstimate && (
        <EstimateDetailModal
          estimate={viewEstimate}
          onClose={() => setViewEstimate(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['b2b-recent-estimates'] })
          }}/>
      )}
      {viewPayment && (
        <PaymentDetailModal
          payment={viewPayment}
          onClose={() => setViewPayment(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['b2b-recent-payments'] })
            qc.invalidateQueries({ queryKey: ['b2b-invoices-all'] })
          }}/>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, note, color, onClick, highlight }) {
  return (
    <button onClick={onClick}
      className="text-left rounded-xl p-3 cursor-pointer hover:shadow-md transition-shadow active:scale-[0.99]"
      style={{
        background: highlight ? '#FEE2E2' : '#FFFFFF',
        border: `1px solid ${highlight ? '#CF1322' : '#E5E5E5'}`,
      }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider"
          style={{color: highlight ? '#CF1322' : '#666'}}>{label}</span>
      </div>
      <div className="font-mono text-[22px] font-bold mt-0.5" style={{color}}>{value}</div>
      <div className="text-[10px] text-[#666] mt-0.5">{note}</div>
    </button>
  )
}

function ActionButton({ onClick, icon, label, color }) {
  return (
    <button onClick={onClick}
      className="rounded-lg px-3.5 py-2 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
      style={{background: color, color:'#FFFFFF', border:'none'}}>
      {icon} {label}
    </button>
  )
}

function NavButton({ onClick, label }) {
  return (
    <button onClick={onClick}
      className="rounded-lg px-3 py-2 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
      style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
      {label}
    </button>
  )
}

function ActivityRow({ item, onOpen }) {
  const ago = relativeTime(item.at)

  if (item.kind === 'payment') {
    const p = item.record
    return (
      <div onClick={onOpen} className="px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-[#FAFAFA]">
        <span className="text-[14px]">💰</span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-[#1F1F1F]">
            <span className="font-bold text-[#15803D]">{p.company_name || 'Unknown'}</span> paid{' '}
            <span className="font-mono font-bold">${(p.amount || 0).toFixed(0)}</span>
            <span className="text-[#999]"> · {PAYMENT_METHOD_LABELS[p.payment_method] || p.payment_method}</span>
          </div>
          <div className="text-[10px] text-[#999] font-mono">{p.payment_number}</div>
        </div>
        <div className="text-[10px] text-[#999]">{ago}</div>
      </div>
    )
  }

  if (item.kind === 'invoice') {
    const i = item.record
    return (
      <div onClick={onOpen} className="px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-[#FAFAFA]">
        <span className="text-[14px]">📄</span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-[#1F1F1F]">
            <span className="font-bold">Invoiced</span>{' '}
            <span className="font-bold text-[#1F1F1F]">{i.company_name || 'Unknown'}</span>{' '}
            <span className="font-mono font-bold">${(i.total || 0).toFixed(0)}</span>
            {i.status === 'paid' && <span className="ml-1 text-[10px] font-bold text-[#15803D]">PAID</span>}
            {i.status === 'partial' && <span className="ml-1 text-[10px] font-bold text-[#B45309]">PARTIAL</span>}
          </div>
          <div className="text-[10px] text-[#999] font-mono">{i.invoice_number}</div>
        </div>
        <div className="text-[10px] text-[#999]">{ago}</div>
      </div>
    )
  }

  // estimate
  const e = item.record
  return (
    <div onClick={onOpen} className="px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-[#FAFAFA]">
      <span className="text-[14px]">📝</span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-[#1F1F1F]">
          <span className="font-bold">Quoted</span>{' '}
          <span className="font-bold text-[#1F1F1F]">{e.company_name || 'Unknown'}</span>{' '}
          <span className="font-mono font-bold">${(e.total || 0).toFixed(0)}</span>
          {e.status === 'converted' && <span className="ml-1 text-[10px] font-bold text-[#006AFF]">→ INVOICE</span>}
          {e.status === 'declined'  && <span className="ml-1 text-[10px] font-bold text-[#CF1322]">DECLINED</span>}
        </div>
        <div className="text-[10px] text-[#999] font-mono">{e.estimate_number}</div>
      </div>
      <div className="text-[10px] text-[#999]">{ago}</div>
    </div>
  )
}

function relativeTime(isoString) {
  if (!isoString) return ''
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(isoString).toLocaleDateString()
}
