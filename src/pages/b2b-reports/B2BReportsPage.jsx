// src/pages/b2b-reports/B2BReportsPage.jsx
// Detailed B2B reports for invoice-driven business accounts.
// Focused on the metrics that matter for B2B: AR aging, top-paying
// customers, invoice status flow, revenue by company.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { startOfDay, endOfDay, subDays, format, differenceInDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

const TABS = [
  { id: 'revenue',   label: 'Revenue',         icon: '💵' },
  { id: 'customers', label: 'Top Customers',   icon: '🏆' },
  { id: 'aging',     label: 'A/R Aging',       icon: '⏰' },
  { id: 'estimates', label: 'Estimates',       icon: '📝' },
  { id: 'payments',  label: 'Payments',        icon: '💳' },
]

export default function B2BReportsPage() {
  const { tenant } = useAuthStore()
  const [tab, setTab] = useState('revenue')
  const [range, setRange] = useState('month')

  const window = (() => {
    const now = new Date()
    if (range === 'week')    return { start: startOfDay(subDays(now, 6)),  end: endOfDay(now) }
    if (range === 'month')   return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) }
    if (range === 'quarter') return { start: startOfDay(subDays(now, 89)), end: endOfDay(now) }
    return { start: startOfDay(subDays(now, 364)), end: endOfDay(now) }
  })()

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['b2b-reports-invoices', tenant?.id, range],
    queryFn: async () => {
      const { data } = await supabase.from('invoices')
        .select(`
          id, invoice_number, total, balance_due, paid_amount, status,
          issue_date, due_date, created_at, sent_at, paid_at,
          company_id, companies(name)
        `)
        .eq('tenant_id', tenant.id)
        .gte('created_at', window.start.toISOString())
        .lte('created_at', window.end.toISOString())
        .order('created_at', { ascending: false })
        .limit(5000)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const { data: estimates = [] } = useQuery({
    queryKey: ['b2b-reports-estimates', tenant?.id, range],
    queryFn: async () => {
      const { data } = await supabase.from('estimates')
        .select(`
          id, estimate_number, total, status, issue_date, created_at,
          company_id, companies(name)
        `)
        .eq('tenant_id', tenant.id)
        .gte('created_at', window.start.toISOString())
        .lte('created_at', window.end.toISOString())
        .order('created_at', { ascending: false })
        .limit(1000)
      return data || []
    },
    enabled: !!tenant?.id && tab === 'estimates',
  })

  const { data: payments = [] } = useQuery({
    queryKey: ['b2b-reports-payments', tenant?.id, range],
    queryFn: async () => {
      const { data } = await supabase.from('payments')
        .select(`
          id, amount, method, reference, payment_date, created_at,
          invoice_id, invoices(invoice_number, company_id, companies(name))
        `)
        .eq('tenant_id', tenant.id)
        .gte('created_at', window.start.toISOString())
        .lte('created_at', window.end.toISOString())
        .order('payment_date', { ascending: false })
        .limit(2000)
      return data || []
    },
    enabled: !!tenant?.id && tab === 'payments',
  })

  const exportCSV = (rows, filename) => {
    if (rows.length === 0) return
    const headers = Object.keys(rows[0])
    const lines = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = r[h]
        if (v === null || v === undefined) return ''
        const s = String(v)
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(','))
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="linear-theme">
    <div className="px-6 py-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="font-semibold tracking-tight text-3xl text-slate-900 leading-tight">B2B Reports</h1>
          <p className="text-sm text-slate-500 mt-1">
            Invoice & A/R performance · {format(window.start, 'MMM d')} → {format(window.end, 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex gap-1.5">
          {[
            ['week','7 days'], ['month','30 days'], ['quarter','90 days'], ['year','1 year']
          ].map(([k,label]) => (
            <button key={k} onClick={() => setRange(k)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition active:scale-[.98] ${
                range===k ? 'bg-lx-500 text-white border-transparent' : 'bg-white text-slate-900 border-black/[.08] hover:bg-slate-50'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6" style={{borderBottom:'1px solid rgba(0,0,0,0.08)'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-sm font-semibold cursor-pointer border-none transition-all flex items-center gap-1.5 bg-transparent"
            style={tab === t.id
              ? {color:'#2f5f49', borderBottom:'2px solid #2f5f49', marginBottom:'-1px'}
              : {color: 'rgba(17,33,27,0.55)'}}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {isLoading
        ? <div className="py-20 text-center text-sm text-slate-400">Loading…</div>
        : tab === 'revenue'   ? <Revenue   invoices={invoices} exportCSV={exportCSV}/>
        : tab === 'customers' ? <Customers invoices={invoices} exportCSV={exportCSV}/>
        : tab === 'aging'     ? <Aging     invoices={invoices} exportCSV={exportCSV}/>
        : tab === 'estimates' ? <Estimates estimates={estimates} exportCSV={exportCSV}/>
        : tab === 'payments'  ? <Payments  payments={payments} exportCSV={exportCSV}/>
        : null}
    </div>
    </div>
  )
}


// ── Revenue tab ──
function Revenue({ invoices, exportCSV }) {
  const sent = invoices.filter(i => i.status !== 'draft' && i.status !== 'cancelled')
  const totalInvoiced = sent.reduce((s,i) => s + Number(i.total || 0), 0)
  const totalPaid     = sent.reduce((s,i) => s + Number(i.paid_amount || 0), 0)
  const outstanding   = sent.reduce((s,i) => s + Number(i.balance_due || 0), 0)
  const paidPct = totalInvoiced > 0 ? (totalPaid / totalInvoiced * 100) : 0

  // Daily revenue
  const byDay = new Map()
  sent.forEach(inv => {
    const day = format(new Date(inv.created_at), 'yyyy-MM-dd')
    const cur = byDay.get(day) || { day, count: 0, invoiced: 0, paid: 0 }
    cur.count++
    cur.invoiced += Number(inv.total || 0)
    cur.paid     += Number(inv.paid_amount || 0)
    byDay.set(day, cur)
  })
  const rows = [...byDay.values()].sort((a,b) => b.day.localeCompare(a.day))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Invoiced"    value={`$${totalInvoiced.toFixed(2)}`} sub={`${sent.length} invoices`} color="#5E6AD2"/>
        <Stat label="Collected"   value={`$${totalPaid.toFixed(2)}`}     sub={`${paidPct.toFixed(0)}% of invoiced`}    color="#16a34a"/>
        <Stat label="Outstanding" value={`$${outstanding.toFixed(2)}`}   sub={sent.filter(i=>i.balance_due>0).length + ' unpaid'} color="#dc2626"/>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
        <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
          <div className="text-[13px] font-bold">Daily Revenue</div>
          <button onClick={() => exportCSV(rows, `b2b-revenue-${format(new Date(),'yyyyMMdd')}.csv`)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
            style={{background:'#5E6AD2'}}>
            📥 Export CSV
          </button>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{background:'#f8fafc', color:'#666'}}>
              <th className="text-left  px-4 py-2 font-semibold">Date</th>
              <th className="text-right px-4 py-2 font-semibold">Invoices</th>
              <th className="text-right px-4 py-2 font-semibold">Invoiced</th>
              <th className="text-right px-4 py-2 font-semibold">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-slate-400">No data</td></tr>
            ) : rows.map(r => (
              <tr key={r.day} style={{borderTop:'1px solid #f1f5f9'}}>
                <td className="px-4 py-2 font-mono">{format(new Date(r.day+'T12:00'), 'MMM d, yyyy')}</td>
                <td className="px-4 py-2 text-right font-mono">{r.count}</td>
                <td className="px-4 py-2 text-right font-mono font-bold">${r.invoiced.toFixed(2)}</td>
                <td className="px-4 py-2 text-right font-mono text-green-700">${r.paid.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Top customers tab ──
function Customers({ invoices, exportCSV }) {
  const agg = new Map()
  invoices.filter(i => i.status !== 'draft' && i.status !== 'cancelled').forEach(inv => {
    if (!inv.company_id) return
    const cur = agg.get(inv.company_id) || {
      id: inv.company_id, name: inv.companies?.name || 'Unknown',
      invoices: 0, invoiced: 0, paid: 0, outstanding: 0,
    }
    cur.invoices++
    cur.invoiced    += Number(inv.total || 0)
    cur.paid        += Number(inv.paid_amount || 0)
    cur.outstanding += Number(inv.balance_due || 0)
    agg.set(inv.company_id, cur)
  })
  const rows = [...agg.values()].sort((a,b) => b.invoiced - a.invoiced)

  return (
    <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
        <div className="text-[13px] font-bold">Top Customers — {rows.length} companies</div>
        <button onClick={() => exportCSV(rows.map(({id,...r})=>r), `b2b-customers-${format(new Date(),'yyyyMMdd')}.csv`)}
          className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
          style={{background:'#5E6AD2'}}>
          📥 Export CSV
        </button>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{background:'#f8fafc', color:'#666'}}>
            <th className="text-left  px-4 py-2 font-semibold">Rank</th>
            <th className="text-left  px-4 py-2 font-semibold">Company</th>
            <th className="text-right px-4 py-2 font-semibold">Invoices</th>
            <th className="text-right px-4 py-2 font-semibold">Invoiced</th>
            <th className="text-right px-4 py-2 font-semibold">Paid</th>
            <th className="text-right px-4 py-2 font-semibold">Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="py-12 text-center text-slate-400">No data</td></tr>
          ) : rows.map((r,i) => (
            <tr key={r.id} style={{borderTop:'1px solid #f1f5f9'}}>
              <td className="px-4 py-2 font-bold text-slate-400">#{i+1}</td>
              <td className="px-4 py-2 font-semibold">{r.name}</td>
              <td className="px-4 py-2 text-right font-mono">{r.invoices}</td>
              <td className="px-4 py-2 text-right font-mono font-bold">${r.invoiced.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono text-green-700">${r.paid.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono text-red-600">{r.outstanding > 0 ? `$${r.outstanding.toFixed(2)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── A/R Aging tab ──
function Aging({ invoices, exportCSV }) {
  const today = new Date()
  const buckets = { current:0, d1_30:0, d31_60:0, d61_90:0, d90plus:0 }
  const unpaid = invoices.filter(i => Number(i.balance_due || 0) > 0 && i.status !== 'cancelled')
  unpaid.forEach(inv => {
    const due = inv.due_date ? new Date(inv.due_date) : new Date(inv.created_at)
    const days = differenceInDays(today, due)
    const amt = Number(inv.balance_due || 0)
    if (days <= 0)       buckets.current += amt
    else if (days <= 30) buckets.d1_30   += amt
    else if (days <= 60) buckets.d31_60  += amt
    else if (days <= 90) buckets.d61_90  += amt
    else                 buckets.d90plus += amt
  })

  const totalAR = Object.values(buckets).reduce((s,v) => s+v, 0)

  const rows = unpaid.map(inv => {
    const due = inv.due_date ? new Date(inv.due_date) : new Date(inv.created_at)
    const days = differenceInDays(today, due)
    return {
      invoice: inv.invoice_number,
      company: inv.companies?.name || 'Unknown',
      due_date: inv.due_date || '—',
      days_overdue: days > 0 ? days : 0,
      balance: Number(inv.balance_due || 0),
    }
  }).sort((a,b) => b.days_overdue - a.days_overdue)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        <Stat label="Current"     value={`$${buckets.current.toFixed(2)}`} color="#16a34a" small/>
        <Stat label="1-30 days"   value={`$${buckets.d1_30.toFixed(2)}`}   color="#f59e0b" small/>
        <Stat label="31-60 days"  value={`$${buckets.d31_60.toFixed(2)}`}  color="#ea580c" small/>
        <Stat label="61-90 days"  value={`$${buckets.d61_90.toFixed(2)}`}  color="#dc2626" small/>
        <Stat label="90+ days"    value={`$${buckets.d90plus.toFixed(2)}`} color="#991b1b" small/>
      </div>
      <div className="rounded-2xl p-3 text-center" style={{background:'#1F1F1F', color:'#fff'}}>
        <span className="text-[10px] uppercase tracking-wider opacity-70">Total Outstanding</span>
        <div className="text-[28px] font-black font-mono">${totalAR.toFixed(2)}</div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
        <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
          <div className="text-[13px] font-bold">{rows.length} Unpaid Invoices</div>
          <button onClick={() => exportCSV(rows, `b2b-aging-${format(new Date(),'yyyyMMdd')}.csv`)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
            style={{background:'#5E6AD2'}}>
            📥 Export CSV
          </button>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{background:'#f8fafc', color:'#666'}}>
              <th className="text-left  px-4 py-2 font-semibold">Invoice #</th>
              <th className="text-left  px-4 py-2 font-semibold">Company</th>
              <th className="text-left  px-4 py-2 font-semibold">Due Date</th>
              <th className="text-right px-4 py-2 font-semibold">Days Overdue</th>
              <th className="text-right px-4 py-2 font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-slate-400">No outstanding invoices 🎉</td></tr>
            ) : rows.slice(0, 100).map((r,i) => (
              <tr key={i} style={{borderTop:'1px solid #f1f5f9'}}>
                <td className="px-4 py-2 font-mono font-bold">{r.invoice}</td>
                <td className="px-4 py-2 font-semibold">{r.company}</td>
                <td className="px-4 py-2 font-mono">{r.due_date !== '—' ? format(new Date(r.due_date), 'MMM d, yyyy') : '—'}</td>
                <td className="px-4 py-2 text-right font-mono font-bold"
                  style={{color: r.days_overdue > 60 ? '#dc2626' : r.days_overdue > 30 ? '#ea580c' : r.days_overdue > 0 ? '#f59e0b' : '#16a34a'}}>
                  {r.days_overdue > 0 ? `${r.days_overdue}d` : 'Current'}
                </td>
                <td className="px-4 py-2 text-right font-mono font-bold">${r.balance.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Estimates tab ──
function Estimates({ estimates, exportCSV }) {
  const byStatus = {}
  estimates.forEach(e => {
    byStatus[e.status] = byStatus[e.status] || { count: 0, total: 0 }
    byStatus[e.status].count++
    byStatus[e.status].total += Number(e.total || 0)
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {['draft', 'sent', 'accepted', 'converted'].map(status => {
          const s = byStatus[status] || { count: 0, total: 0 }
          const color = status==='converted'?'#16a34a' : status==='accepted'?'#5E6AD2' : status==='sent'?'#f59e0b' : '#94a3b8'
          return (
            <div key={status} className="rounded-2xl p-3" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{status}</div>
              <div className="text-[20px] font-black font-mono mt-1" style={{color}}>{s.count}</div>
              <div className="text-[10px] text-slate-500">${s.total.toFixed(2)}</div>
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
        <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
          <div className="text-[13px] font-bold">All Estimates</div>
          <button onClick={() => exportCSV(estimates.map(e => ({
              number: e.estimate_number, company: e.companies?.name, status: e.status,
              total: e.total, date: e.created_at,
            })), `b2b-estimates-${format(new Date(),'yyyyMMdd')}.csv`)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
            style={{background:'#5E6AD2'}}>
            📥 Export CSV
          </button>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{background:'#f8fafc', color:'#666'}}>
              <th className="text-left  px-4 py-2 font-semibold">Estimate #</th>
              <th className="text-left  px-4 py-2 font-semibold">Company</th>
              <th className="text-left  px-4 py-2 font-semibold">Status</th>
              <th className="text-left  px-4 py-2 font-semibold">Date</th>
              <th className="text-right px-4 py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {estimates.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-slate-400">No estimates</td></tr>
            ) : estimates.slice(0, 100).map(e => (
              <tr key={e.id} style={{borderTop:'1px solid #f1f5f9'}}>
                <td className="px-4 py-2 font-mono font-bold">{e.estimate_number}</td>
                <td className="px-4 py-2">{e.companies?.name || '—'}</td>
                <td className="px-4 py-2">
                  <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
                    style={{
                      background: e.status==='converted'?'#d1fae5' : e.status==='accepted'?'#dbeafe' : e.status==='sent'?'#fef3c7' : '#f1f5f9',
                      color:      e.status==='converted'?'#166534' : e.status==='accepted'?'#1e40af' : e.status==='sent'?'#854d0e' : '#475569',
                    }}>
                    {e.status}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono">{format(new Date(e.created_at), 'MMM d')}</td>
                <td className="px-4 py-2 text-right font-mono font-bold">${Number(e.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Payments tab ──
function Payments({ payments, exportCSV }) {
  const byMethod = {}
  let totalReceived = 0
  payments.forEach(p => {
    const m = p.method || 'unknown'
    byMethod[m] = (byMethod[m] || 0) + Number(p.amount || 0)
    totalReceived += Number(p.amount || 0)
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total Received" value={`$${totalReceived.toFixed(2)}`} sub={`${payments.length} payments`} color="#16a34a"/>
        <Stat label="Avg Payment" value={`$${payments.length > 0 ? (totalReceived/payments.length).toFixed(2) : '0.00'}`} sub="—" color="#5E6AD2"/>
      </div>

      <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
        <div className="text-[13px] font-bold mb-3">By Payment Method</div>
        <div className="space-y-2">
          {Object.entries(byMethod).sort((a,b) => b[1]-a[1]).map(([method, amt]) => {
            const pct = totalReceived > 0 ? (amt / totalReceived * 100) : 0
            return (
              <div key={method}>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="font-semibold capitalize">{method}</span>
                  <span className="font-mono font-bold">${amt.toFixed(2)} ({pct.toFixed(0)}%)</span>
                </div>
                <div className="h-1.5 rounded-full" style={{background:'#f1f5f9'}}>
                  <div className="h-full rounded-full" style={{width:`${pct}%`, background:'#5E6AD2'}}/>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
        <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
          <div className="text-[13px] font-bold">Recent Payments</div>
          <button onClick={() => exportCSV(payments.map(p => ({
              invoice: p.invoices?.invoice_number, company: p.invoices?.companies?.name,
              amount: p.amount, method: p.method, date: p.payment_date,
            })), `b2b-payments-${format(new Date(),'yyyyMMdd')}.csv`)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
            style={{background:'#5E6AD2'}}>
            📥 Export CSV
          </button>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{background:'#f8fafc', color:'#666'}}>
              <th className="text-left  px-4 py-2 font-semibold">Date</th>
              <th className="text-left  px-4 py-2 font-semibold">Invoice</th>
              <th className="text-left  px-4 py-2 font-semibold">Company</th>
              <th className="text-left  px-4 py-2 font-semibold">Method</th>
              <th className="text-right px-4 py-2 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-slate-400">No payments</td></tr>
            ) : payments.slice(0, 100).map(p => (
              <tr key={p.id} style={{borderTop:'1px solid #f1f5f9'}}>
                <td className="px-4 py-2 font-mono">{format(new Date(p.payment_date || p.created_at), 'MMM d')}</td>
                <td className="px-4 py-2 font-mono font-bold">{p.invoices?.invoice_number}</td>
                <td className="px-4 py-2">{p.invoices?.companies?.name || '—'}</td>
                <td className="px-4 py-2 capitalize">{p.method}</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-green-700">${Number(p.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color = '#5E6AD2', small = false }) {
  return (
    <div className="rounded-2xl p-3.5" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{label}</div>
      <div className={`${small?'text-[16px]':'text-[24px]'} font-black font-mono mt-1`} style={{color}}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}
