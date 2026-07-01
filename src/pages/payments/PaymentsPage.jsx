// src/pages/payments/PaymentsPage.jsx
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import ReceivePaymentModal from '@/pages/invoices/ReceivePaymentModal'
import PaymentDetailModal from './PaymentDetailModal'

const METHOD_BADGE = {
  cash:          { bg:'#d1fae5', color:'#059669', label:'💵 Cash' },
  check:         { bg:'#eef0fc', color:'#5E6AD2', label:'🏦 Check' },
  ach:           { bg:'#FEF3C7', color:'#B45309', label:'🔄 ACH' },
  card:          { bg:'#F3E8FF', color:'#7C3AED', label:'💳 Card' },
  bank_transfer: { bg:'#eef0fc', color:'#5E6AD2', label:'🏦 Bank' },
  other:         { bg:'#F5F5F5', color:'#666',    label:'📋 Other' },
}

export default function PaymentsPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [showReceive, setShowReceive] = useState(false)
  const [viewingPmt, setViewingPmt]   = useState(null)
  const [search, setSearch]           = useState('')
  const [methodFilter, setMethodFilter] = useState('all')
  const [dateRange, setDateRange]     = useState('30')  // last 30 days

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments-list', tenant?.id, dateRange],
    queryFn: async () => {
      let q = supabase.from('v_payment_with_customer').select('*').eq('tenant_id', tenant.id)
      if (dateRange !== 'all') {
        const days = parseInt(dateRange)
        const since = new Date()
        since.setDate(since.getDate() - days)
        q = q.gte('payment_date', since.toISOString().slice(0, 10))
      }
      const { data } = await q.order('payment_date', { ascending: false }).limit(300)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const filtered = useMemo(() => {
    let list = payments
    if (methodFilter !== 'all') {
      list = list.filter(p => p.payment_method === methodFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(p =>
        p.payment_number?.toLowerCase().includes(q) ||
        p.company_name?.toLowerCase().includes(q) ||
        p.reference_number?.toLowerCase().includes(q)
      )
    }
    return list
  }, [payments, methodFilter, search])

  const totalReceived = useMemo(() =>
    filtered.reduce((s, p) => s + (p.amount || 0), 0)
  , [filtered])

  return (
    <div className="max-w-[1200px] mx-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[22px] font-bold text-[#1F1F1F]">💰 Payments Received</div>
          <div className="text-[12px] text-[#666] mt-1">
            {filtered.length} payment{filtered.length !== 1 ? 's' : ''} · Total: <span className="font-mono font-bold text-[#059669]">${totalReceived.toFixed(2)}</span>
          </div>
        </div>
        <button onClick={() => setShowReceive(true)}
          className="rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#059669', color:'#FFFFFF', border:'none'}}>
          💰 Receive Payment
        </button>
      </div>

      {/* Search + filters */}
      <div className="mb-4 space-y-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search by payment #, company, or reference #..."
          className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-3 text-[14px] outline-none focus:border-[#5E6AD2]"/>

        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[11px] font-bold text-[#666]">Date:</span>
          {['7', '30', '90', 'all'].map(d => (
            <button key={d} onClick={() => setDateRange(d)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer active:scale-[0.96]"
              style={dateRange === d
                ? { background:'#5E6AD2', color:'#FFFFFF', border:'none' }
                : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
              {d === 'all' ? 'All' : `Last ${d}d`}
            </button>
          ))}

          <span className="text-[11px] font-bold text-[#666] ml-3">Method:</span>
          <button onClick={() => setMethodFilter('all')}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer"
            style={methodFilter === 'all'
              ? { background:'#5E6AD2', color:'#FFFFFF', border:'none' }
              : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
            All
          </button>
          {Object.entries(METHOD_BADGE).map(([m, b]) => (
            <button key={m} onClick={() => setMethodFilter(m)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer"
              style={methodFilter === m
                ? { background: b.color, color:'#FFFFFF', border:'none' }
                : { background:'#FFFFFF', color: b.color, border:`1px solid ${b.color}` }}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center text-[#666] text-[13px]">
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center">
          <div className="text-[48px] mb-2 opacity-30">💰</div>
          <div className="text-[14px] font-bold text-[#1F1F1F] mb-1">
            {payments.length === 0 ? 'No payments received yet' : 'No payments match your filter'}
          </div>
          {payments.length === 0 && (
            <button onClick={() => setShowReceive(true)}
              className="mt-3 rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer"
              style={{background:'#059669', color:'#FFFFFF', border:'none'}}>
              Record your first payment
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
          <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]"
            style={{gridTemplateColumns:'1.2fr 1.5fr 110px 1fr 90px 110px'}}>
            {['Payment #','Company','Method','Reference','Invoices','Amount'].map(h => (
              <div key={h} className="px-3.5 py-2.5 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {filtered.map(p => {
            const m = METHOD_BADGE[p.payment_method] || METHOD_BADGE.other
            return (
              <div key={p.id} onClick={() => setViewingPmt(p)}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] cursor-pointer"
                style={{gridTemplateColumns:'1.2fr 1.5fr 110px 1fr 90px 110px'}}>
                <div className="px-3.5 py-3">
                  <div className="font-mono text-[13px] font-bold text-[#059669]">{p.payment_number}</div>
                  <div className="text-[10px] text-[#999]">
                    {p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—'}
                  </div>
                </div>
                <div className="px-3.5 py-3 text-[13px] text-[#1F1F1F] truncate">
                  {p.company_name || '—'}
                </div>
                <div className="px-3.5 py-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{background:m.bg, color:m.color}}>
                    {m.label}
                  </span>
                </div>
                <div className="px-3.5 py-3 text-[12px] text-[#666] font-mono truncate">
                  {p.reference_number || '—'}
                </div>
                <div className="px-3.5 py-3 text-[12px] text-[#666]">
                  {p.allocation_count || 0} invoice{p.allocation_count === 1 ? '' : 's'}
                </div>
                <div className="px-3.5 py-3 text-right font-mono text-[14px] font-bold text-[#059669]">
                  ${(p.amount || 0).toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showReceive && (
        <ReceivePaymentModal
          onClose={() => setShowReceive(false)}
          onDone={() => {
            setShowReceive(false)
            qc.invalidateQueries({ queryKey: ['payments-list'] })
            qc.invalidateQueries({ queryKey: ['invoices-list'] })
          }}
        />
      )}

      {viewingPmt && (
        <PaymentDetailModal
          payment={viewingPmt}
          onClose={() => setViewingPmt(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['payments-list'] })
            qc.invalidateQueries({ queryKey: ['invoices-list'] })
          }}
        />
      )}
    </div>
  )
}
