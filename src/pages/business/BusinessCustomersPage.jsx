// src/pages/business/BusinessCustomersPage.jsx
// Phase 1 rewrite:
// - Square-style clean list
// - Smart search: company name OR phone (any digits match)
// - Financial summary per row: Open Balance, Open Invoices, Overdue, Last Activity
// - Click row → opens CustomerHistoryModal (existing — Phase 3 will replace with dedicated detail page)
// - Quick-create modal (Phase 2 will turn this into a wizard)

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import CreateCompanyWizard from './CreateCompanyWizard'

export default function BusinessCustomersPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch]             = useState('')
  const [filter, setFilter]             = useState('all')  // all | owes | overdue
  const [showCreate, setShowCreate]     = useState(false)

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['business-customer-list', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_business_customer_list')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('company_name')
      if (error) console.error('[Business] List error:', error)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Client-side filtering — search by company name OR phone (digits-only match)
  const filtered = useMemo(() => {
    let list = customers
    if (filter === 'owes') {
      list = list.filter(c => (c.computed_balance || 0) > 0)
    } else if (filter === 'overdue') {
      list = list.filter(c => (c.overdue_invoice_count || 0) > 0)
    }
    const q = search.trim()
    if (q) {
      const qLower = q.toLowerCase()
      const qDigits = q.replace(/\D/g, '')  // strip non-digits for phone match
      list = list.filter(c => {
        if (c.company_name?.toLowerCase().includes(qLower)) return true
        if (c.contact_name?.toLowerCase().includes(qLower)) return true
        if (c.code?.toLowerCase().includes(qLower)) return true
        if (qDigits.length >= 3) {
          const phoneDigits = (c.effective_phone || '').replace(/\D/g, '')
          if (phoneDigits.includes(qDigits)) return true
        }
        return false
      })
    }
    return list
  }, [customers, filter, search])

  // Top-of-page KPI stats
  const stats = useMemo(() => {
    let totalOwed = 0
    let totalOverdue = 0
    let owingCount = 0
    let overdueCount = 0
    customers.forEach(c => {
      const balance = c.computed_balance || 0
      if (balance > 0) {
        totalOwed += balance
        owingCount++
      }
      if ((c.overdue_invoice_count || 0) > 0) {
        overdueCount++
        // Overdue $ would need a more complex view — count is enough for now
      }
    })
    return {
      total: customers.length,
      totalOwed,
      owingCount,
      overdueCount,
    }
  }, [customers])

  return (
    <div className="max-w-[1300px] mx-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[22px] font-bold text-[#1F1F1F]">🏢 Companies</div>
          <div className="text-[12px] text-[#666] mt-1">
            {stats.total} active companies ·{' '}
            <span className="font-bold text-[#CF1322] font-mono">${stats.totalOwed.toFixed(2)}</span>{' '}
            total outstanding{stats.overdueCount > 0 && (
              <> · <span className="font-bold text-[#CF1322]">{stats.overdueCount} overdue</span></>
            )}
          </div>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
          + New Company
        </button>
      </div>

      {/* Search + filter */}
      <div className="mb-4 space-y-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search by company name, contact, or phone..."
          className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-3 text-[14px] outline-none focus:border-[#006AFF]"/>
        <div className="flex gap-2 flex-wrap">
          <FilterTab active={filter==='all'}     onClick={() => setFilter('all')}     count={stats.total}>All</FilterTab>
          <FilterTab active={filter==='owes'}    onClick={() => setFilter('owes')}    count={stats.owingCount} highlight>💰 Owes Money</FilterTab>
          <FilterTab active={filter==='overdue'} onClick={() => setFilter('overdue')} count={stats.overdueCount} red>⚠️ Overdue</FilterTab>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center text-[#666] text-[13px]">
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center">
          <div className="text-[48px] mb-2 opacity-30">🏢</div>
          <div className="text-[14px] font-bold text-[#1F1F1F] mb-1">
            {customers.length === 0 ? 'No companies yet' : 'No companies match'}
          </div>
          {customers.length === 0 && (
            <button onClick={() => setShowCreate(true)}
              className="mt-3 rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              Add your first company
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
          <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]"
            style={{gridTemplateColumns:'2fr 1.4fr 1fr 110px 110px 100px'}}>
            {['Company','Contact / Phone','Terms','Open Inv','Balance','Activity'].map(h => (
              <div key={h} className="px-3.5 py-2.5 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {filtered.map(c => {
            const owes = (c.computed_balance || 0) > 0
            const overdue = (c.overdue_invoice_count || 0) > 0
            return (
              <div key={c.id} onClick={() => navigate(`/business/${c.id}`)}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] cursor-pointer items-center"
                style={{gridTemplateColumns:'2fr 1.4fr 1fr 110px 110px 100px'}}>
                <div className="px-3.5 py-3 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{c.company_name}</div>
                    {c.tier && c.tier !== 'standard' && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{background: c.tier === 'vip' ? '#FEF3C7' : '#E6F0FF',
                                color: c.tier === 'vip' ? '#B45309' : '#006AFF'}}>
                        {c.tier}
                      </span>
                    )}
                  </div>
                  {c.trade_name && (
                    <div className="text-[10px] text-[#999] truncate">DBA: {c.trade_name}</div>
                  )}
                </div>
                <div className="px-3.5 py-3 min-w-0">
                  <div className="text-[12px] text-[#1F1F1F] truncate">{c.contact_name || '—'}</div>
                  <div className="text-[11px] text-[#666] font-mono">{c.effective_phone || '—'}</div>
                </div>
                <div className="px-3.5 py-3 text-[11px] text-[#666] uppercase font-bold">
                  {c.payment_terms || 'NET 30'}
                </div>
                <div className="px-3.5 py-3 text-[12px]">
                  {(c.open_invoice_count || 0) === 0 ? (
                    <span className="text-[#999]">—</span>
                  ) : (
                    <div>
                      <div className="font-bold text-[#1F1F1F]">{c.open_invoice_count}</div>
                      {overdue && (
                        <div className="text-[10px] font-bold text-[#CF1322]">
                          {c.overdue_invoice_count} overdue
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="px-3.5 py-3 text-right font-mono text-[14px] font-bold"
                  style={{color: owes ? (overdue ? '#CF1322' : '#1F1F1F') : '#15803D'}}>
                  ${(c.computed_balance || 0).toFixed(0)}
                </div>
                <div className="px-3.5 py-3 text-[10px] text-[#666]">
                  {fmtRelative(c.last_activity_at)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateCompanyWizard
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            qc.invalidateQueries({ queryKey: ['business-customer-list'] })
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

function fmtRelative(isoString) {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  if (diff < 0) return 'now'
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`
  if (diff < 86400_000 * 7) return `${Math.floor(diff / 86400_000)}d`
  if (diff < 86400_000 * 30) return `${Math.floor(diff / 86400_000 / 7)}w`
  return `${Math.floor(diff / 86400_000 / 30)}mo`
}
