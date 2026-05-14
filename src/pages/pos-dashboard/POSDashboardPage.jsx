// src/pages/pos-dashboard/POSDashboardPage.jsx
// Retail POS Dashboard — at-a-glance view of today's walk-in retail
// performance. Designed for the store owner / manager who wants to know
// "how's the front-of-house doing right now?" without digging through
// reports.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { startOfDay, endOfDay, subDays, format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

export default function POSDashboardPage() {
  const nav = useNavigate()
  const { tenant, store } = useAuthStore()
  const [range, setRange] = useState('today')  // today / week / month

  // Date window for queries
  const window = (() => {
    const now = new Date()
    if (range === 'today') return { start: startOfDay(now), end: endOfDay(now) }
    if (range === 'week')  return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) }
    return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) }
  })()

  // ── All POS data fetched in parallel ──
  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['pos-dashboard-orders', tenant?.id, store?.id, range],
    queryFn: async () => {
      const { data } = await supabase.from('orders')
        .select(`
          id, order_number, total, subtotal, tax_amount, discount_amount,
          tip_amount, refunded_amount, refund_status, status,
          cashier_id, customer_id, created_at,
          payments:order_payments(method, amount),
          items:order_items(quantity, paid_unit_price, unit_price, bulk_savings)
        `)
        .eq('tenant_id', tenant.id)
        .eq('store_id', store.id)
        .gte('created_at', window.start.toISOString())
        .lte('created_at', window.end.toISOString())
        .order('created_at', { ascending: false })
        .limit(2000)
      return data || []
    },
    enabled: !!tenant?.id && !!store?.id,
  })

  const { data: topProducts = [] } = useQuery({
    queryKey: ['pos-dashboard-top', tenant?.id, store?.id, range],
    queryFn: async () => {
      const { data } = await supabase.from('order_items')
        .select(`
          product_id, product_name, quantity, paid_unit_price, unit_price,
          orders!inner(store_id, created_at, tenant_id)
        `)
        .eq('orders.tenant_id', tenant.id)
        .eq('orders.store_id', store.id)
        .gte('orders.created_at', window.start.toISOString())
        .lte('orders.created_at', window.end.toISOString())
      // Aggregate by product
      const agg = new Map()
      for (const it of data || []) {
        if (!it.product_id || it.quantity < 0) continue
        const key = it.product_id
        const cur = agg.get(key) || { id: key, name: it.product_name, qty: 0, revenue: 0 }
        cur.qty     += Number(it.quantity)
        cur.revenue += Number(it.quantity) * Number(it.paid_unit_price ?? it.unit_price)
        agg.set(key, cur)
      }
      return [...agg.values()].sort((a,b) => b.revenue - a.revenue).slice(0, 10)
    },
    enabled: !!tenant?.id && !!store?.id,
  })

  // Cashier list to resolve names
  const { data: cashiers = [] } = useQuery({
    queryKey: ['cashiers', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, name').eq('tenant_id', tenant.id)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Low stock alerts
  const { data: lowStock = [] } = useQuery({
    queryKey: ['low-stock', tenant?.id, store?.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory')
        .select('product_id, quantity, low_stock_threshold, products(name)')
        .eq('tenant_id', tenant.id)
        .eq('store_id', store.id)
        .limit(200)
      return (data || [])
        .filter(i => i.quantity <= (i.low_stock_threshold || 5) && i.quantity > 0)
        .slice(0, 8)
    },
    enabled: !!tenant?.id && !!store?.id,
  })

  // ── Derived metrics ──
  const completed = orders.filter(o => o.status === 'completed' || o.status === 'partially_refunded')
  const revenue = completed.reduce((s,o) => s + Number(o.total || 0) - Number(o.refunded_amount || 0), 0)
  const subtotal = completed.reduce((s,o) => s + Number(o.subtotal || 0), 0)
  const tax = completed.reduce((s,o) => s + Number(o.tax_amount || 0), 0)
  const tipTotal = completed.reduce((s,o) => s + Number(o.tip_amount || 0), 0)
  const refundCount = orders.filter(o => Number(o.refunded_amount || 0) > 0).length
  const refundTotal = orders.reduce((s,o) => s + Number(o.refunded_amount || 0), 0)
  const orderCount = completed.length
  const avgOrder = orderCount > 0 ? revenue / orderCount : 0
  const memberOrders = completed.filter(o => o.customer_id).length
  const memberRate = orderCount > 0 ? (memberOrders / orderCount * 100) : 0
  const bulkSavings = completed.reduce((s,o) =>
    s + (o.items || []).reduce((ss,i) => ss + Number(i.bulk_savings || 0), 0), 0)

  // Payment method breakdown
  const payMethods = {}
  completed.forEach(o => {
    (o.payments || []).forEach(p => {
      payMethods[p.method] = (payMethods[p.method] || 0) + Number(p.amount || 0)
    })
  })

  // Cashier performance
  const cashierPerf = {}
  completed.forEach(o => {
    if (!o.cashier_id) return
    cashierPerf[o.cashier_id] = cashierPerf[o.cashier_id] || { orders: 0, revenue: 0 }
    cashierPerf[o.cashier_id].orders++
    cashierPerf[o.cashier_id].revenue += Number(o.total || 0)
  })
  const cashierRanks = Object.entries(cashierPerf)
    .map(([id, p]) => ({ id, name: cashiers.find(c=>c.id===id)?.name || 'Unknown', ...p }))
    .sort((a,b) => b.revenue - a.revenue)

  // Hourly distribution (today only — find peak hours)
  const hourly = new Array(24).fill(0)
  if (range === 'today') {
    completed.forEach(o => {
      const h = new Date(o.created_at).getHours()
      hourly[h] += Number(o.total || 0)
    })
  }
  const peakHour = hourly.indexOf(Math.max(...hourly))

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight" style={{color:'#1F1F1F'}}>
            🛒 POS Dashboard
          </h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Retail walk-in performance · {store?.name}
          </p>
        </div>
        <div className="flex gap-2">
          {[
            ['today', 'Today'],
            ['week',  'Last 7 days'],
            ['month', 'Last 30 days'],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer border-2 transition-all"
              style={range===k
                ? {background:'#006AFF', color:'#fff', borderColor:'#006AFF'}
                : {background:'#fff', color:'#666', borderColor:'#e5e5e5'}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip — 4 big numbers */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <KpiCard label="Revenue" value={`$${revenue.toFixed(2)}`} icon="💵"
          sub={`avg $${avgOrder.toFixed(2)}/order`} accent="#006AFF"/>
        <KpiCard label="Orders" value={orderCount} icon="🧾"
          sub={`${memberOrders} from members`} accent="#16a34a"/>
        <KpiCard label="Tips" value={`$${tipTotal.toFixed(2)}`} icon="💰"
          sub={tipTotal > 0 && revenue > 0 ? `${(tipTotal/revenue*100).toFixed(1)}% of revenue` : '—'} accent="#f59e0b"/>
        <KpiCard label="Refunds" value={`$${refundTotal.toFixed(2)}`} icon="↩️"
          sub={`${refundCount} order${refundCount===1?'':'s'}`} accent="#dc2626"/>
      </div>

      {/* Secondary metrics strip */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <KpiCard label="Member Rate" value={`${memberRate.toFixed(0)}%`} icon="⭐"
          sub={`${memberOrders}/${orderCount} orders`} accent="#a855f7" small/>
        <KpiCard label="Bulk Savings" value={`$${bulkSavings.toFixed(2)}`} icon="🏷️"
          sub="given to customers" accent="#166534" small/>
        <KpiCard label="Tax Collected" value={`$${tax.toFixed(2)}`} icon="📋"
          sub={`on $${subtotal.toFixed(2)} subtotal`} accent="#0891b2" small/>
        {range === 'today' && peakHour >= 0 && hourly[peakHour] > 0 ? (
          <KpiCard label="Peak Hour" value={`${peakHour % 12 || 12}${peakHour < 12 ? 'am' : 'pm'}`} icon="⏰"
            sub={`$${hourly[peakHour].toFixed(2)} in 1 hour`} accent="#ec4899" small/>
        ) : (
          <KpiCard label="Period" value={range === 'today' ? 'Today' : range === 'week' ? '7 days' : '30 days'} icon="📅"
            sub={`${orders.length} total orders`} accent="#94a3b8" small/>
        )}
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Top products */}
        <div className="col-span-2 rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14px] font-bold" style={{color:'#1F1F1F'}}>🏆 Top Selling Products</div>
            <button onClick={() => nav('/pos-reports')} className="text-[11px] text-blue-600 cursor-pointer bg-transparent border-none">
              View all →
            </button>
          </div>
          {topProducts.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-slate-400">No sales in this period</div>
          ) : (
            <div className="space-y-1">
              {topProducts.slice(0, 8).map((p, i) => {
                const maxRev = topProducts[0].revenue || 1
                const pct = (p.revenue / maxRev * 100)
                return (
                  <div key={p.id} className="flex items-center gap-3 py-1.5">
                    <div className="text-[12px] font-bold w-6 text-slate-400">#{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold truncate" style={{color:'#1F1F1F'}}>{p.name}</div>
                      <div className="mt-0.5 h-1.5 rounded-full" style={{background:'#f1f5f9'}}>
                        <div className="h-full rounded-full" style={{width:`${pct}%`, background:'#006AFF'}}/>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[13px] font-bold font-mono">${p.revenue.toFixed(2)}</div>
                      <div className="text-[10px] text-slate-400">{p.qty} sold</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Payment methods */}
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[14px] font-bold mb-3" style={{color:'#1F1F1F'}}>💳 Payment Methods</div>
          {Object.keys(payMethods).length === 0 ? (
            <div className="py-12 text-center text-[12px] text-slate-400">No payments</div>
          ) : (
            <div className="space-y-2">
              {Object.entries(payMethods)
                .sort((a,b) => b[1]-a[1])
                .map(([method, amt]) => {
                  const pct = revenue > 0 ? (amt / revenue * 100) : 0
                  const icon = method==='cash' ? '💵' : method==='card' ? '💳' : method==='check' ? '📝' : method==='on_account' ? '🧾' : '💰'
                  return (
                    <div key={method}>
                      <div className="flex items-center justify-between text-[11px] mb-0.5">
                        <span className="font-semibold">{icon} {method}</span>
                        <span className="font-mono font-bold">${amt.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{background:'#f1f5f9'}}>
                        <div className="h-full rounded-full" style={{width:`${pct}%`, background:'#16a34a'}}/>
                      </div>
                      <div className="text-[9px] text-slate-400 mt-0.5">{pct.toFixed(0)}%</div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Cashier performance */}
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[14px] font-bold mb-3" style={{color:'#1F1F1F'}}>👤 Cashier Performance</div>
          {cashierRanks.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-slate-400">No data</div>
          ) : (
            <div className="space-y-2">
              {cashierRanks.slice(0, 6).map((c, i) => (
                <div key={c.id} className="flex items-center gap-2 py-1.5"
                  style={{borderBottom: i < cashierRanks.length - 1 ? '1px solid #f1f5f9' : 'none'}}>
                  <div className="text-[12px] font-bold w-5 text-slate-400">#{i+1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold truncate">{c.name}</div>
                    <div className="text-[10px] text-slate-400">{c.orders} orders</div>
                  </div>
                  <div className="text-[12px] font-bold font-mono">${c.revenue.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hourly chart (today only) */}
        {range === 'today' && (
          <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
            <div className="text-[14px] font-bold mb-3" style={{color:'#1F1F1F'}}>⏰ Hourly Sales (Today)</div>
            <div className="flex items-end gap-0.5 h-24">
              {hourly.map((amt, h) => {
                const max = Math.max(...hourly, 1)
                const pct = (amt / max * 100)
                return (
                  <div key={h} className="flex-1 flex flex-col items-center justify-end gap-0.5"
                    title={`${h}:00 — $${amt.toFixed(2)}`}>
                    <div className="w-full rounded-t transition-all"
                      style={{
                        height: `${pct}%`,
                        background: h === peakHour ? '#f59e0b' : '#80B2FF',
                        minHeight: amt > 0 ? '2px' : '0',
                      }}/>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between text-[8px] text-slate-400 mt-1">
              <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>
            </div>
          </div>
        )}

        {/* Low stock alerts */}
        <div className={range === 'today' ? '' : 'col-span-2'}>
          <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[14px] font-bold" style={{color:'#1F1F1F'}}>⚠️ Low Stock Alerts</div>
              <button onClick={() => nav('/stock-levels')} className="text-[11px] text-blue-600 cursor-pointer bg-transparent border-none">
                View all →
              </button>
            </div>
            {lowStock.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-green-600">✓ All stock levels healthy</div>
            ) : (
              <div className="space-y-1.5">
                {lowStock.map(item => (
                  <div key={item.product_id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg"
                    style={{background:'#fefce8', border:'1px solid #fde68a'}}>
                    <span className="text-[14px]">⚠️</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold truncate">{item.products?.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[12px] font-bold font-mono text-amber-700">{item.quantity}</div>
                      <div className="text-[9px] text-slate-400">≤ {item.low_stock_threshold || 5}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick links footer */}
      <div className="mt-5 flex flex-wrap gap-2">
        <QuickLink to="/pos" icon="🛒" label="Open POS"/>
        <QuickLink to="/orders" icon="🧾" label="View All Orders"/>
        <QuickLink to="/pos-reports" icon="📈" label="Detailed Reports"/>
        <QuickLink to="/customers" icon="👥" label="Members"/>
        <QuickLink to="/marketing" icon="🎯" label="Promotions"/>
      </div>
    </div>
  )
}


function KpiCard({ label, value, icon, sub, accent='#006AFF', small=false }) {
  return (
    <div className="rounded-2xl p-3.5" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{label}</span>
        <span className="text-[14px]">{icon}</span>
      </div>
      <div className={`${small?'text-[18px]':'text-[24px]'} font-black font-mono leading-tight`} style={{color:accent}}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}


function QuickLink({ to, icon, label }) {
  const nav = useNavigate()
  return (
    <button onClick={() => nav(to)}
      className="rounded-xl px-3 py-2 text-[12px] font-bold cursor-pointer border transition-all hover:bg-slate-100"
      style={{background:'#fff', borderColor:'#e5e5e5', color:'#475569'}}>
      {icon} {label}
    </button>
  )
}
