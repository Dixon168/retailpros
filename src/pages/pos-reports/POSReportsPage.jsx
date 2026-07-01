// src/pages/pos-reports/POSReportsPage.jsx
// Detailed retail POS reports — drill-down view of walk-in sales.
// Different from the Dashboard which is "at-a-glance" — this is
// "give me the numbers I need to do my taxes / find issues".

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { startOfDay, endOfDay, subDays, format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

const TABS = [
  { id: 'sales',     label: 'Sales Summary', icon: '💵' },
  { id: 'products',  label: 'By Product',    icon: '📦' },
  { id: 'cashiers',  label: 'By Cashier',    icon: '👤' },
  { id: 'tax',       label: 'Tax Report',    icon: '📋' },
  { id: 'refunds',   label: 'Refunds',       icon: '↩️' },
  { id: 'tips',      label: 'Tips',          icon: '💰' },
]

export default function POSReportsPage() {
  const nav = useNavigate()
  const { tenant, store } = useAuthStore()
  const [tab, setTab] = useState('sales')
  const [range, setRange] = useState('week')

  const window = (() => {
    const now = new Date()
    if (range === 'today') return { start: startOfDay(now), end: endOfDay(now) }
    if (range === 'week')  return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) }
    if (range === 'month') return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) }
    return { start: startOfDay(subDays(now, 89)), end: endOfDay(now) }
  })()

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['pos-reports-orders', tenant?.id, store?.id, range],
    queryFn: async () => {
      const { data } = await supabase.from('orders')
        .select(`
          id, order_number, total, subtotal, tax_amount, discount_amount,
          tip_amount, refunded_amount, status, refund_status,
          cashier_id, customer_id, created_at,
          payments:order_payments(method, amount),
          items:order_items(product_id, product_name, quantity, paid_unit_price, unit_price, bulk_savings, tax_amount)
        `)
        .eq('tenant_id', tenant.id)
        .eq('store_id', store.id)
        .gte('created_at', window.start.toISOString())
        .lte('created_at', window.end.toISOString())
        .order('created_at', { ascending: false })
        .limit(5000)
      return data || []
    },
    enabled: !!tenant?.id && !!store?.id,
  })

  const { data: cashiers = [] } = useQuery({
    queryKey: ['cashiers', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, name').eq('tenant_id', tenant.id)
      return data || []
    },
    enabled: !!tenant?.id,
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
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight" style={{color:'#1F1F1F'}}>
            📈 POS Reports
          </h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Detailed retail performance · {store?.name} ·
            {format(window.start, 'MMM d')} → {format(window.end, 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex gap-2">
          {[
            ['today','Today'], ['week','7 days'], ['month','30 days'], ['quarter','90 days']
          ].map(([k,label]) => (
            <button key={k} onClick={() => setRange(k)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer border-2 transition-all"
              style={range===k
                ? {background:'#5E6AD2', color:'#fff', borderColor:'#5E6AD2'}
                : {background:'#fff', color:'#666', borderColor:'#e5e5e5'}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto" style={{borderBottom:'1px solid #e5e5e5'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-4 py-2 text-[12px] font-bold cursor-pointer border-none transition-all flex items-center gap-1.5 flex-shrink-0"
            style={tab === t.id
              ? {background:'transparent', color:'#5E6AD2', borderBottom:'2px solid #5E6AD2', marginBottom:'-1px'}
              : {background:'transparent', color:'#666'}}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {isLoading
        ? <div className="py-20 text-center text-[12px] text-slate-400">Loading...</div>
        : tab === 'sales'    ? <SalesSummary orders={orders} exportCSV={exportCSV}/>
        : tab === 'products' ? <ByProduct    orders={orders} exportCSV={exportCSV}/>
        : tab === 'cashiers' ? <ByCashier    orders={orders} cashiers={cashiers} exportCSV={exportCSV}/>
        : tab === 'tax'      ? <TaxReport    orders={orders} exportCSV={exportCSV}/>
        : tab === 'refunds'  ? <Refunds      orders={orders} exportCSV={exportCSV}/>
        : tab === 'tips'     ? <Tips         orders={orders} cashiers={cashiers} exportCSV={exportCSV}/>
        : null}
    </div>
  )
}

// ── Tab 1: Sales Summary ──────────────────────────────────────
function SalesSummary({ orders, exportCSV }) {
  const completed = orders.filter(o => o.status === 'completed' || o.status === 'partially_refunded')
  const byDay = new Map()
  completed.forEach(o => {
    const day = format(new Date(o.created_at), 'yyyy-MM-dd')
    const cur = byDay.get(day) || { day, orders: 0, gross: 0, refunds: 0, net: 0, tax: 0, tips: 0 }
    cur.orders++
    cur.gross   += Number(o.total || 0)
    cur.refunds += Number(o.refunded_amount || 0)
    cur.net     += Number(o.total || 0) - Number(o.refunded_amount || 0)
    cur.tax     += Number(o.tax_amount || 0)
    cur.tips    += Number(o.tip_amount || 0)
    byDay.set(day, cur)
  })
  const rows = [...byDay.values()].sort((a,b) => b.day.localeCompare(a.day))
  const totals = rows.reduce((s,r) => ({
    orders: s.orders + r.orders, gross: s.gross + r.gross, refunds: s.refunds + r.refunds,
    net: s.net + r.net, tax: s.tax + r.tax, tips: s.tips + r.tips,
  }), { orders:0, gross:0, refunds:0, net:0, tax:0, tips:0 })

  return (
    <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
        <div className="text-[13px] font-bold">Daily Sales Summary</div>
        <button onClick={() => exportCSV(rows, `pos-sales-${format(new Date(),'yyyyMMdd')}.csv`)}
          className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
          style={{background:'#5E6AD2'}}>
          📥 Export CSV
        </button>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{background:'#f8fafc', color:'#666'}}>
            <th className="text-left  px-4 py-2 font-semibold">Date</th>
            <th className="text-right px-4 py-2 font-semibold">Orders</th>
            <th className="text-right px-4 py-2 font-semibold">Gross</th>
            <th className="text-right px-4 py-2 font-semibold">Refunds</th>
            <th className="text-right px-4 py-2 font-semibold">Net</th>
            <th className="text-right px-4 py-2 font-semibold">Tax</th>
            <th className="text-right px-4 py-2 font-semibold">Tips</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="py-12 text-center text-slate-400">No data</td></tr>
          ) : rows.map(r => (
            <tr key={r.day} style={{borderTop:'1px solid #f1f5f9'}}>
              <td className="px-4 py-2 font-mono">{format(new Date(r.day+'T12:00'), 'MMM d, yyyy')}</td>
              <td className="px-4 py-2 text-right font-mono">{r.orders}</td>
              <td className="px-4 py-2 text-right font-mono">${r.gross.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono text-red-600">{r.refunds > 0 ? `-$${r.refunds.toFixed(2)}` : '—'}</td>
              <td className="px-4 py-2 text-right font-mono font-bold">${r.net.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono">${r.tax.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono">${r.tips.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr style={{background:'#f8fafc', borderTop:'2px solid #1F1F1F'}}>
              <td className="px-4 py-2 font-bold">TOTAL</td>
              <td className="px-4 py-2 text-right font-mono font-bold">{totals.orders}</td>
              <td className="px-4 py-2 text-right font-mono font-bold">${totals.gross.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono font-bold text-red-600">-${totals.refunds.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono font-bold" style={{color:'#5E6AD2'}}>${totals.net.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono font-bold">${totals.tax.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono font-bold">${totals.tips.toFixed(2)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ── Tab 2: By Product ──────────────────────────────────────
function ByProduct({ orders, exportCSV }) {
  const agg = new Map()
  orders.filter(o => o.status === 'completed' || o.status === 'partially_refunded').forEach(o => {
    (o.items || []).forEach(i => {
      if (!i.product_id || i.quantity < 0) return
      const cur = agg.get(i.product_id) || { id: i.product_id, name: i.product_name, qty: 0, revenue: 0, savings: 0 }
      cur.qty     += Number(i.quantity)
      cur.revenue += Number(i.quantity) * Number(i.paid_unit_price ?? i.unit_price)
      cur.savings += Number(i.bulk_savings || 0)
      agg.set(i.product_id, cur)
    })
  })
  const rows = [...agg.values()].sort((a,b) => b.revenue - a.revenue)

  return (
    <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
        <div className="text-[13px] font-bold">Sales by Product</div>
        <button onClick={() => exportCSV(rows, `pos-products-${format(new Date(),'yyyyMMdd')}.csv`)}
          className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
          style={{background:'#5E6AD2'}}>
          📥 Export CSV
        </button>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{background:'#f8fafc', color:'#666'}}>
            <th className="text-left  px-4 py-2 font-semibold">Rank</th>
            <th className="text-left  px-4 py-2 font-semibold">Product</th>
            <th className="text-right px-4 py-2 font-semibold">Qty Sold</th>
            <th className="text-right px-4 py-2 font-semibold">Revenue</th>
            <th className="text-right px-4 py-2 font-semibold">Bulk Savings</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="py-12 text-center text-slate-400">No data</td></tr>
          ) : rows.slice(0, 100).map((p, i) => (
            <tr key={p.id} style={{borderTop:'1px solid #f1f5f9'}}>
              <td className="px-4 py-2 font-bold text-slate-400">#{i+1}</td>
              <td className="px-4 py-2">{p.name}</td>
              <td className="px-4 py-2 text-right font-mono">{p.qty}</td>
              <td className="px-4 py-2 text-right font-mono font-bold">${p.revenue.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono text-green-700">{p.savings > 0 ? `$${p.savings.toFixed(2)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <div className="px-4 py-2 text-[11px] text-slate-400 text-center" style={{borderTop:'1px solid #f1f5f9'}}>
          Showing top 100 of {rows.length}. Export CSV for full data.
        </div>
      )}
    </div>
  )
}

// ── Tab 3: By Cashier ──────────────────────────────────────
function ByCashier({ orders, cashiers, exportCSV }) {
  const agg = {}
  orders.filter(o => o.status === 'completed' || o.status === 'partially_refunded').forEach(o => {
    if (!o.cashier_id) return
    agg[o.cashier_id] = agg[o.cashier_id] || { id:o.cashier_id, orders:0, revenue:0, refunded:0, tips:0 }
    agg[o.cashier_id].orders++
    agg[o.cashier_id].revenue  += Number(o.total || 0)
    agg[o.cashier_id].refunded += Number(o.refunded_amount || 0)
    agg[o.cashier_id].tips     += Number(o.tip_amount || 0)
  })
  const rows = Object.values(agg)
    .map(a => ({ ...a, name: cashiers.find(c=>c.id===a.id)?.name || 'Unknown' }))
    .sort((a,b) => b.revenue - a.revenue)

  return (
    <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
        <div className="text-[13px] font-bold">Cashier Performance</div>
        <button onClick={() => exportCSV(rows.map(({id,...r}) => r), `pos-cashiers-${format(new Date(),'yyyyMMdd')}.csv`)}
          className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
          style={{background:'#5E6AD2'}}>
          📥 Export CSV
        </button>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{background:'#f8fafc', color:'#666'}}>
            <th className="text-left  px-4 py-2 font-semibold">Cashier</th>
            <th className="text-right px-4 py-2 font-semibold">Orders</th>
            <th className="text-right px-4 py-2 font-semibold">Revenue</th>
            <th className="text-right px-4 py-2 font-semibold">Avg / Order</th>
            <th className="text-right px-4 py-2 font-semibold">Refunds</th>
            <th className="text-right px-4 py-2 font-semibold">Tips</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="py-12 text-center text-slate-400">No data</td></tr>
          ) : rows.map(r => (
            <tr key={r.id} style={{borderTop:'1px solid #f1f5f9'}}>
              <td className="px-4 py-2 font-semibold">{r.name}</td>
              <td className="px-4 py-2 text-right font-mono">{r.orders}</td>
              <td className="px-4 py-2 text-right font-mono font-bold">${r.revenue.toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono">${(r.revenue/r.orders).toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono text-red-600">{r.refunded > 0 ? `$${r.refunded.toFixed(2)}` : '—'}</td>
              <td className="px-4 py-2 text-right font-mono">${r.tips.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tab 4: Tax Report ──────────────────────────────────────
function TaxReport({ orders, exportCSV }) {
  const completed = orders.filter(o => o.status === 'completed' || o.status === 'partially_refunded')
  const totals = completed.reduce((s, o) => ({
    subtotal: s.subtotal + Number(o.subtotal || 0),
    tax:      s.tax + Number(o.tax_amount || 0),
    refunded: s.refunded + Number(o.refunded_amount || 0),
  }), { subtotal:0, tax:0, refunded:0 })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Taxable Subtotal</div>
          <div className="text-[24px] font-black font-mono mt-1" style={{color:'#5E6AD2'}}>${totals.subtotal.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Tax Collected</div>
          <div className="text-[24px] font-black font-mono mt-1" style={{color:'#16a34a'}}>${totals.tax.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Refunded</div>
          <div className="text-[24px] font-black font-mono mt-1" style={{color:'#dc2626'}}>${totals.refunded.toFixed(2)}</div>
        </div>
      </div>
      <div className="rounded-2xl p-4 text-[12px]" style={{background:'#eff6ff', border:'1px solid #dee2f8', color:'#1e3a8a'}}>
        💡 <b>For sales tax filing:</b> Tax Collected = ${totals.tax.toFixed(2)} on Taxable Subtotal of ${totals.subtotal.toFixed(2)}.
        Adjust for refunds when filing.
      </div>
    </div>
  )
}

// ── Tab 5: Refunds ──────────────────────────────────────
function Refunds({ orders, exportCSV }) {
  const refunds = orders
    .filter(o => Number(o.refunded_amount || 0) > 0)
    .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const total = refunds.reduce((s,o) => s + Number(o.refunded_amount || 0), 0)

  return (
    <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
        <div className="text-[13px] font-bold">
          Refunds — {refunds.length} order{refunds.length===1?'':'s'} totaling
          <span className="ml-2 text-red-600">${total.toFixed(2)}</span>
        </div>
        <button onClick={() => exportCSV(refunds.map(o => ({
            order_number: o.order_number, date: o.created_at,
            total: o.total, refunded: o.refunded_amount, status: o.refund_status,
          })), `pos-refunds-${format(new Date(),'yyyyMMdd')}.csv`)}
          className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
          style={{background:'#5E6AD2'}}>
          📥 Export CSV
        </button>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{background:'#f8fafc', color:'#666'}}>
            <th className="text-left  px-4 py-2 font-semibold">Order #</th>
            <th className="text-left  px-4 py-2 font-semibold">Date</th>
            <th className="text-right px-4 py-2 font-semibold">Order Total</th>
            <th className="text-right px-4 py-2 font-semibold">Refunded</th>
            <th className="text-left  px-4 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {refunds.length === 0 ? (
            <tr><td colSpan={5} className="py-12 text-center text-slate-400">No refunds in this period 🎉</td></tr>
          ) : refunds.map(o => (
            <tr key={o.id} style={{borderTop:'1px solid #f1f5f9'}}>
              <td className="px-4 py-2 font-mono font-bold">{o.order_number}</td>
              <td className="px-4 py-2 font-mono">{format(new Date(o.created_at), 'MMM d, h:mm a')}</td>
              <td className="px-4 py-2 text-right font-mono">${Number(o.total).toFixed(2)}</td>
              <td className="px-4 py-2 text-right font-mono font-bold text-red-600">-${Number(o.refunded_amount).toFixed(2)}</td>
              <td className="px-4 py-2">
                <span className="rounded-md px-2 py-0.5 text-[10px] font-bold"
                  style={{background: o.refund_status==='full' ? '#fef2f2' : '#fefce8',
                          color:      o.refund_status==='full' ? '#991b1b' : '#854d0e'}}>
                  {o.refund_status === 'full' ? 'FULL REFUND' : 'PARTIAL'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tab 6: Tips ──────────────────────────────────────
function Tips({ orders, cashiers, exportCSV }) {
  const tipped = orders.filter(o => Number(o.tip_amount || 0) > 0)
  const total = tipped.reduce((s,o) => s + Number(o.tip_amount || 0), 0)

  // Group tips by cashier
  const byCashier = {}
  tipped.forEach(o => {
    if (!o.cashier_id) return
    byCashier[o.cashier_id] = byCashier[o.cashier_id] || { id: o.cashier_id, tips: 0, count: 0 }
    byCashier[o.cashier_id].tips += Number(o.tip_amount || 0)
    byCashier[o.cashier_id].count++
  })
  const rows = Object.values(byCashier)
    .map(r => ({ ...r, name: cashiers.find(c=>c.id===r.id)?.name || 'Unknown' }))
    .sort((a,b) => b.tips - a.tips)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Total Tips</div>
          <div className="text-[24px] font-black font-mono mt-1" style={{color:'#f59e0b'}}>${total.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Tipped Orders</div>
          <div className="text-[24px] font-black font-mono mt-1">{tipped.length}</div>
        </div>
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Avg Tip</div>
          <div className="text-[24px] font-black font-mono mt-1">${tipped.length > 0 ? (total/tipped.length).toFixed(2) : '0.00'}</div>
        </div>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
        <div className="flex justify-between items-center px-4 py-3" style={{borderBottom:'1px solid #f1f5f9'}}>
          <div className="text-[13px] font-bold">Tips by Cashier</div>
          <button onClick={() => exportCSV(rows.map(({id,...r})=>r), `pos-tips-${format(new Date(),'yyyyMMdd')}.csv`)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
            style={{background:'#5E6AD2'}}>
            📥 Export CSV
          </button>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{background:'#f8fafc', color:'#666'}}>
              <th className="text-left  px-4 py-2 font-semibold">Cashier</th>
              <th className="text-right px-4 py-2 font-semibold">Tipped Orders</th>
              <th className="text-right px-4 py-2 font-semibold">Total Tips</th>
              <th className="text-right px-4 py-2 font-semibold">Avg Tip</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-slate-400">No tips in this period</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} style={{borderTop:'1px solid #f1f5f9'}}>
                <td className="px-4 py-2 font-semibold">{r.name}</td>
                <td className="px-4 py-2 text-right font-mono">{r.count}</td>
                <td className="px-4 py-2 text-right font-mono font-bold">${r.tips.toFixed(2)}</td>
                <td className="px-4 py-2 text-right font-mono">${(r.tips/r.count).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
