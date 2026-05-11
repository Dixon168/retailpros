// src/pages/reports/ARAgingPage.jsx
// A/R Aging — accounts receivable aging report
// Shows who owes money, bucketed by days overdue

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import ReceivePaymentModal from '@/pages/invoices/ReceivePaymentModal'

export default function ARAgingPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch]       = useState('')
  const [showOnlyOwing, setShowOnlyOwing] = useState(true)
  const [receiveFor, setReceiveFor] = useState(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ar-aging', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_ar_aging_by_customer')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('total_owed', { ascending: false })
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const filtered = useMemo(() => {
    let list = rows
    if (showOnlyOwing) list = list.filter(r => (r.total_owed || 0) > 0)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(r => r.company_name?.toLowerCase().includes(q))
    }
    return list
  }, [rows, search, showOnlyOwing])

  const totals = useMemo(() => {
    const t = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0, total: 0 }
    filtered.forEach(r => {
      t.current   += r.bucket_current   || 0
      t.b1_30     += r.bucket_1_30      || 0
      t.b31_60    += r.bucket_31_60     || 0
      t.b61_90    += r.bucket_61_90     || 0
      t.b90_plus  += r.bucket_90_plus   || 0
      t.total     += r.total_owed       || 0
    })
    return t
  }, [filtered])

  const exportCSV = () => {
    const header = ['Company','Invoices','Current','1-30 Days','31-60 Days','61-90 Days','90+ Days','Total Owed','Oldest Days']
    const lines = [header.join(',')]
    filtered.forEach(r => {
      lines.push([
        `"${(r.company_name || '').replace(/"/g, '""')}"`,
        r.invoice_count || 0,
        (r.bucket_current  || 0).toFixed(2),
        (r.bucket_1_30     || 0).toFixed(2),
        (r.bucket_31_60    || 0).toFixed(2),
        (r.bucket_61_90    || 0).toFixed(2),
        (r.bucket_90_plus  || 0).toFixed(2),
        (r.total_owed      || 0).toFixed(2),
        r.oldest_overdue_days || 0,
      ].join(','))
    })
    const blob = new Blob([lines.join('\n')], { type:'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ar-aging-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-[1300px] mx-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[22px] font-bold text-[#1F1F1F]">📊 A/R Aging Report</div>
          <div className="text-[12px] text-[#666] mt-1">
            Who owes you money — broken down by how late they are
          </div>
        </div>
        <button onClick={exportCSV}
          className="rounded-lg px-3 py-2 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
          ⬇️ Export CSV
        </button>
      </div>

      {/* Summary buckets */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        <BucketCard label="Current" amount={totals.current} note="Not yet due" color="#15803D"/>
        <BucketCard label="1–30 days" amount={totals.b1_30} note="Past due" color="#F59E0B"/>
        <BucketCard label="31–60 days" amount={totals.b31_60} note="Late" color="#F59E0B"/>
        <BucketCard label="61–90 days" amount={totals.b61_90} note="Very late" color="#CF1322"/>
        <BucketCard label="90+ days" amount={totals.b90_plus} note="Critical" color="#CF1322"/>
      </div>
      <div className="rounded-xl p-4 mb-4 flex items-center justify-between"
        style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
        <span className="text-[13px] font-bold text-[#1F1F1F]">Total outstanding</span>
        <span className="font-mono text-[24px] font-bold"
          style={{color: totals.total > 0 ? '#CF1322' : '#15803D'}}>
          ${totals.total.toFixed(2)}
        </span>
      </div>

      {/* Filters */}
      <div className="mb-3 flex gap-2 items-center flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search company..."
          className="flex-1 min-w-[200px] bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-2.5 text-[13px] outline-none focus:border-[#006AFF]"/>
        <label className="flex items-center gap-2 text-[12px] cursor-pointer text-[#1F1F1F]">
          <input type="checkbox" checked={showOnlyOwing} onChange={e => setShowOnlyOwing(e.target.checked)}
            className="cursor-pointer accent-blue-500"/>
          Only show customers who owe money
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center text-[#666] text-[13px]">
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center">
          <div className="text-[48px] mb-2 opacity-30">📊</div>
          <div className="text-[14px] font-bold text-[#1F1F1F] mb-1">
            {rows.length === 0 ? 'No customer data' : showOnlyOwing ? '✅ No outstanding balances!' : 'No customers match search'}
          </div>
          {rows.length > 0 && showOnlyOwing && totals.total === 0 && (
            <div className="text-[12px] text-[#15803D] mt-1">All your invoices are paid 🎉</div>
          )}
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
          <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]"
            style={{gridTemplateColumns:'1.6fr 60px 90px 90px 90px 90px 90px 105px 90px'}}>
            {['Company','Inv','Current','1–30d','31–60d','61–90d','90+ d','Total','Action'].map((h,i) => (
              <div key={h} className={`px-2.5 py-2.5 text-[10px] text-[#666] font-bold uppercase tracking-wider ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </div>
            ))}
          </div>
          {filtered.map(r => {
            const owesMoney = (r.total_owed || 0) > 0
            const isCritical = (r.bucket_90_plus || 0) > 0
            const oldest = r.oldest_overdue_days || 0
            return (
              <div key={r.customer_id}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] items-center"
                style={{gridTemplateColumns:'1.6fr 60px 90px 90px 90px 90px 90px 105px 90px'}}>
                <div className="px-2.5 py-3 cursor-pointer" onClick={() => navigate(`/business/${r.customer_id}`)}>
                  <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{r.company_name}</div>
                  {r.contact_name && (
                    <div className="text-[10px] text-[#666] truncate">{r.contact_name}</div>
                  )}
                  {oldest > 0 && (
                    <div className="text-[9px] font-bold mt-0.5"
                      style={{color: oldest > 60 ? '#CF1322' : '#B45309'}}>
                      ⚠️ Oldest {oldest}d overdue
                    </div>
                  )}
                </div>
                <Cell>{r.invoice_count || 0}</Cell>
                <Cell>{(r.bucket_current  || 0) > 0 ? `$${(r.bucket_current  || 0).toFixed(0)}` : '—'}</Cell>
                <Cell color={(r.bucket_1_30    || 0) > 0 ? '#B45309' : '#999'}>{(r.bucket_1_30    || 0) > 0 ? `$${(r.bucket_1_30    || 0).toFixed(0)}` : '—'}</Cell>
                <Cell color={(r.bucket_31_60   || 0) > 0 ? '#B45309' : '#999'}>{(r.bucket_31_60   || 0) > 0 ? `$${(r.bucket_31_60   || 0).toFixed(0)}` : '—'}</Cell>
                <Cell color={(r.bucket_61_90   || 0) > 0 ? '#CF1322' : '#999'}>{(r.bucket_61_90   || 0) > 0 ? `$${(r.bucket_61_90   || 0).toFixed(0)}` : '—'}</Cell>
                <Cell color={(r.bucket_90_plus || 0) > 0 ? '#CF1322' : '#999'} bold={isCritical}>
                  {(r.bucket_90_plus || 0) > 0 ? `$${(r.bucket_90_plus || 0).toFixed(0)}` : '—'}
                </Cell>
                <div className="px-2.5 py-3 text-right font-mono text-[14px] font-bold"
                  style={{color: owesMoney ? (isCritical ? '#CF1322' : '#1F1F1F') : '#15803D'}}>
                  ${(r.total_owed || 0).toFixed(2)}
                </div>
                <div className="px-2 py-3">
                  {owesMoney && (
                    <button onClick={() => setReceiveFor(r)}
                      className="w-full rounded px-2 py-1.5 text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                      style={{background:'#15803D', color:'#FFFFFF', border:'none'}}>
                      💰 Pay
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 text-[11px] text-[#666] flex items-start gap-1.5">
        <span>💡</span>
        <span>
          <strong>Current</strong> = not yet due ·
          <strong> 1–30 days</strong> = late but recent ·
          <strong> 90+ days</strong> = critical, may need to write off or use collections.
        </span>
      </div>

      {/* Modals */}
      {receiveFor && (
        <ReceivePaymentModal
          presetCustomerId={receiveFor.customer_id}
          onClose={() => setReceiveFor(null)}
          onDone={() => {
            setReceiveFor(null)
            qc.invalidateQueries({ queryKey: ['ar-aging'] })
            qc.invalidateQueries({ queryKey: ['invoices-list'] })
          }}
        />
      )}
    </div>
  )
}

function BucketCard({ label, amount, note, color }) {
  const has = amount > 0
  return (
    <div className="rounded-xl p-3"
      style={{background: has ? '#FFFFFF' : '#FAFAFA', border: `1px solid ${has ? color : '#E5E5E5'}`}}>
      <div className="text-[10px] font-bold uppercase tracking-wider"
        style={{color: has ? color : '#999'}}>{label}</div>
      <div className="font-mono text-[18px] font-bold mt-1"
        style={{color: has ? '#1F1F1F' : '#999'}}>
        ${amount.toFixed(0)}
      </div>
      <div className="text-[10px] text-[#666] mt-0.5">{note}</div>
    </div>
  )
}

function Cell({ children, color, bold }) {
  return (
    <div className="px-2.5 py-3 text-right font-mono text-[12px]"
      style={{ color: color || '#1F1F1F', fontWeight: bold ? 700 : 600 }}>
      {children}
    </div>
  )
}
