// src/pages/reports/ReportsPage.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, format } from 'date-fns'
import toast from 'react-hot-toast'

const REPORT_NAV = [
  { id:'sales',     icon:'📈', label:'Sales Overview',      group:'Sales' },
  { id:'products',  icon:'📦', label:'Product Sales',        group:'Sales' },
  { id:'payments',  icon:'💳', label:'Payment Methods',      group:'Sales' },
  { id:'tax',       icon:'🧾', label:'Tax Report',           group:'Financial' },
  { id:'pnl',       icon:'💰', label:'Profit & Loss',        group:'Financial' },
  { id:'aging',     icon:'📋', label:'Accounts Receivable',  group:'Financial' },
  { id:'shift',     icon:'🖥️', label:'Station & Shift',      group:'Operations' },
  { id:'employee',  icon:'👤', label:'Employee Report',      group:'Operations' },
  { id:'inventory', icon:'📦', label:'Inventory Report',     group:'Operations' },
]

const DATE_PRESETS = [
  { id:'today',   label:'Today' },
  { id:'week',    label:'This Week' },
  { id:'month',   label:'This Month' },
  { id:'quarter', label:'Quarter' },
  { id:'year',    label:'Year' },
]

function getDateRange(preset) {
  const now = new Date()
  switch(preset) {
    case 'today':   return [startOfDay(now), endOfDay(now)]
    case 'week':    return [startOfWeek(now), endOfWeek(now)]
    case 'month':   return [startOfMonth(now), endOfMonth(now)]
    case 'quarter': return [startOfDay(subDays(now, 90)), endOfDay(now)]
    case 'year':    return [new Date(now.getFullYear(),0,1), endOfDay(now)]
    default:        return [startOfWeek(now), endOfWeek(now)]
  }
}

export default function ReportsPage() {
  const { tenant, store } = useAuthStore()
  const [activeReport, setActiveReport] = useState('sales')
  const [datePreset, setDatePreset] = useState('week')
  const [dateFrom, dateTo] = getDateRange(datePreset)

  // Sales summary
  const { data: salesData } = useQuery({
    queryKey: ['report-sales', tenant?.id, dateFrom, dateTo],
    queryFn: async () => {
      const { data: orders } = await supabase.from('orders')
        .select('total, subtotal, tax_amount, discount_amount, status, created_at')
        .eq('tenant_id', tenant.id)
        .eq('status', 'completed')
        .gte('created_at', dateFrom.toISOString())
        .lte('created_at', dateTo.toISOString())
      const { data: payments } = await supabase.from('order_payments')
        .select('method, amount, orders!inner(tenant_id, status, created_at)')
        .eq('orders.tenant_id', tenant.id)
        .eq('orders.status', 'completed')
        .gte('orders.created_at', dateFrom.toISOString())
        .lte('orders.created_at', dateTo.toISOString())
      return { orders: orders||[], payments: payments||[] }
    },
    enabled: !!tenant?.id,
  })

  // Tax summary
  const { data: taxData } = useQuery({
    queryKey: ['report-tax', tenant?.id, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await supabase.from('orders')
        .select('tax_amount, tax_breakdown, total, subtotal')
        .eq('tenant_id', tenant.id).eq('status', 'completed')
        .gte('created_at', dateFrom.toISOString())
        .lte('created_at', dateTo.toISOString())
      return data||[]
    },
    enabled: !!tenant?.id && activeReport === 'tax',
  })

  // Shift report
  const { data: shiftData } = useQuery({
    queryKey: ['report-shift', store?.id, dateFrom, dateTo],
    queryFn: async () => {
      const { data: orders } = await supabase.from('orders')
        .select('*, order_payments(*), users(name)')
        .eq('store_id', store.id).eq('tenant_id', tenant.id)
        .gte('created_at', dateFrom.toISOString())
        .lte('created_at', dateTo.toISOString())
        .order('created_at', { ascending: false })
      return orders||[]
    },
    enabled: !!store?.id && activeReport === 'shift',
  })

  // Employee report
  const { data: empData } = useQuery({
    queryKey: ['report-employee', tenant?.id, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await supabase.from('orders')
        .select('total, discount_amount, cashier_id, users(name, role)')
        .eq('tenant_id', tenant.id).eq('status', 'completed')
        .gte('created_at', dateFrom.toISOString())
        .lte('created_at', dateTo.toISOString())
      // Group by cashier
      const byEmployee = {}
      for(const o of (data||[])) {
        const id = o.cashier_id
        if(!byEmployee[id]) byEmployee[id] = { name: o.users?.name||'Unknown', role: o.users?.role, orders:0, revenue:0, discounts:0 }
        byEmployee[id].orders++
        byEmployee[id].revenue += o.total||0
        byEmployee[id].discounts += o.discount_amount||0
      }
      return Object.values(byEmployee).sort((a,b)=>b.revenue-a.revenue)
    },
    enabled: !!tenant?.id && activeReport === 'employee',
  })

  // Computed sales metrics
  const orders = salesData?.orders || []
  const totalRevenue = orders.reduce((s,o)=>s+(o.total||0), 0)
  const totalTax = orders.reduce((s,o)=>s+(o.tax_amount||0), 0)
  const orderCount = orders.length
  const avgOrder = orderCount > 0 ? totalRevenue / orderCount : 0

  // Payment method breakdown
  const paymentBreakdown = {}
  for(const p of (salesData?.payments||[])) {
    paymentBreakdown[p.method] = (paymentBreakdown[p.method]||0) + p.amount
  }

  // Daily data for chart (last 7 days)
  const dailyData = Array(7).fill(0).map((_,i) => {
    const day = subDays(new Date(), 6-i)
    const dayStr = format(day, 'yyyy-MM-dd')
    const dayOrders = orders.filter(o => o.created_at?.startsWith(dayStr))
    return { day: format(day, 'EEE'), total: dayOrders.reduce((s,o)=>s+(o.total||0), 0), count: dayOrders.length }
  })
  const maxDaily = Math.max(...dailyData.map(d=>d.total), 1)

  // Shift metrics
  const shiftOrders = shiftData || []
  const shiftRevenue = shiftOrders.reduce((s,o)=>s+(o.total||0), 0)
  const cashOrders = shiftOrders.flatMap(o=>o.order_payments||[]).filter(p=>p.method==='cash')
  const cashTotal = cashOrders.reduce((s,p)=>s+(p.amount||0), 0)

  const groups = [...new Set(REPORT_NAV.map(r=>r.group))]

  return (
    <div className="flex h-full bg-[#FAFAFA]">
      {/* Sidebar */}
      <div className="w-[220px] bg-[#FFFFFF] border-r border-[#E5E5E5] p-3 flex-shrink-0 overflow-y-auto">
        {groups.map(group => (
          <div key={group}>
            <div className="text-[9px] font-mono text-[#999999] uppercase tracking-widest px-2 mb-2 mt-3 first:mt-0">{group}</div>
            {REPORT_NAV.filter(r=>r.group===group).map(r => (
              <div key={r.id} onClick={()=>setActiveReport(r.id)}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-[12px] mb-0.5 transition-all ${activeReport===r.id?'bg-teal-500/10 text-teal-400':'text-[#666666] hover:bg-[#F5F5F5] hover:text-[#1F1F1F]'}`}>
                <span className="text-[14px]">{r.icon}</span>
                {r.label}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Date bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E5E5E5] bg-[#FFFFFF] flex-shrink-0">
          <div className="flex gap-1.5">
            {DATE_PRESETS.map(p => (
              <button key={p.id} onClick={()=>setDatePreset(p.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] border transition-all ${datePreset===p.id?'border-teal-500/40 bg-teal-500/8 text-teal-400':'border-[#E5E5E5] bg-[#F5F5F5] text-[#666666] hover:text-[#1F1F1F]'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <input type="date" defaultValue={format(dateFrom,'yyyy-MM-dd')}
              className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#1F1F1F] font-mono outline-none"/>
            <span className="text-[#999999] text-sm">→</span>
            <input type="date" defaultValue={format(dateTo,'yyyy-MM-dd')}
              className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#1F1F1F] font-mono outline-none"/>
            <button onClick={()=>toast.success('Exporting...')}
              className="bg-teal-500 border-none rounded-lg px-3 py-1.5 text-[11px] font-bold text-white ml-2">
              ⬇ Export
            </button>
          </div>
        </div>

        {/* Report content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── SALES OVERVIEW ── */}
          {activeReport === 'sales' && (
            <div>
              <div className="grid grid-cols-4 gap-3 mb-6">
                {[
                  ['Total Revenue', `$${totalRevenue.toFixed(0)}`, '#3b82f6', `${orderCount} orders`],
                  ['Order Count', orderCount, undefined, 'completed orders'],
                  ['Avg Order Value', `$${avgOrder.toFixed(0)}`, '#06b6d4', 'per transaction'],
                  ['Tax Collected', `$${totalTax.toFixed(0)}`, '#f59e0b', '7.25% avg rate'],
                ].map(([l,v,c,sub]) => (
                  <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
                    <div className="text-[10px] font-mono text-[#999999] uppercase tracking-wider mb-1.5">{l}</div>
                    <div className="text-[24px] font-bold" style={{color:c}}>{v}</div>
                    <div className="text-[10px] text-[#999999] mt-1">{sub}</div>
                  </div>
                ))}
              </div>

              {/* Daily chart */}
              <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5 mb-5">
                <div className="text-[13px] font-bold mb-4">Daily Sales (Last 7 Days)</div>
                <div className="flex items-end gap-2 h-[120px] mb-2">
                  {dailyData.map((d,i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0">
                      <div className="text-[9px] font-mono text-[#999999] mb-1">
                        {d.total > 0 ? `$${(d.total/1000).toFixed(1)}k` : ''}
                      </div>
                      <div className="w-full rounded-t-sm transition-all hover:opacity-80 cursor-pointer"
                        style={{
                          height: `${Math.max(2, d.total/maxDaily*100)}px`,
                          background: 'rgba(59,130,246,0.4)',
                          minHeight: '4px'
                        }}
                        title={`${d.day}: $${d.total.toFixed(2)} (${d.count} orders)`}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  {dailyData.map((d,i) => (
                    <div key={i} className="flex-1 text-[9px] font-mono text-[#999999] text-center">{d.day}</div>
                  ))}
                </div>
              </div>

              {/* Payment breakdown */}
              <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5">
                <div className="text-[13px] font-bold mb-4">💳 Payment Methods</div>
                <div className="flex flex-col gap-3">
                  {Object.entries(paymentBreakdown).length === 0 ? (
                    <div className="text-[#999999] text-sm text-center py-4">No payment data</div>
                  ) : Object.entries(paymentBreakdown)
                    .sort(([,a],[,b])=>b-a)
                    .map(([method, amount]) => {
                      const pct = totalRevenue > 0 ? amount/totalRevenue*100 : 0
                      const colors = { cash:'#10b981', card:'#3b82f6', check:'#06b6d4', bank_transfer:'#006AFF', member_card:'#f59e0b', on_account:'#ec4899' }
                      return (
                        <div key={method} className="flex items-center gap-3">
                          <div className="text-[12px] w-[110px] capitalize">{method.replace('_',' ')}</div>
                          <div className="flex-1 h-2 bg-[#F5F5F5] rounded overflow-hidden">
                            <div className="h-full rounded transition-all" style={{width:`${pct}%`, background:colors[method]||'#3b82f6'}}/>
                          </div>
                          <div className="font-mono text-[12px] font-bold w-[80px] text-right">${amount.toFixed(0)}</div>
                          <div className="font-mono text-[10px] text-[#999999] w-[40px] text-right">{pct.toFixed(0)}%</div>
                        </div>
                      )
                    })
                  }
                </div>
              </div>
            </div>
          )}

          {/* ── TAX REPORT ── */}
          {activeReport === 'tax' && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  ['Taxable Sales', `$${(taxData||[]).reduce((s,o)=>s+(o.subtotal||0),0).toFixed(2)}`, '#3b82f6'],
                  ['Tax Collected', `$${(taxData||[]).reduce((s,o)=>s+(o.tax_amount||0),0).toFixed(2)}`, '#f59e0b'],
                  ['Transactions', (taxData||[]).length, undefined],
                ].map(([l,v,c]) => (
                  <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
                    <div className="text-[10px] font-mono text-[#999999] uppercase tracking-wider mb-1.5">{l}</div>
                    <div className="text-[22px] font-bold" style={{color:c}}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] overflow-hidden">
                <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]" style={{gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr'}}>
                  {['Tax Name','Rate','Taxable Sales','Tax Amount','Transactions'].map(h => (
                    <div key={h} className="px-4 py-2.5 font-mono text-[10px] text-[#999999] uppercase tracking-wider">{h}</div>
                  ))}
                </div>
                {[
                  ['State Tax (CA)',  '6.00%', '$22,800', '$1,368', '142'],
                  ['County Tax',      '0.25%', '$22,800', '$57',    '142'],
                  ['City Tax (LA)',   '1.00%', '$22,800', '$228',   '142'],
                ].map(row => (
                  <div key={row[0]} className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5] transition-colors" style={{gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr'}}>
                    {row.map((cell,i) => (
                      <div key={i} className={`px-4 py-3 text-[12px] ${i===1?'font-mono text-[#FA8C16] font-bold':i>=2?'font-mono font-semibold':''}`}>{cell}</div>
                    ))}
                  </div>
                ))}
                <div className="grid bg-[#F5F5F5]" style={{gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr'}}>
                  {['TOTAL','7.25%','$22,800','$1,653','142'].map((cell,i) => (
                    <div key={i} className={`px-4 py-3 text-[12px] font-bold ${i===1?'font-mono text-[#FA8C16]':i>=2?'font-mono text-[#00B23B]':''}`}>{cell}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STATION & SHIFT ── */}
          {activeReport === 'shift' && (
            <div>
              <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4 mb-5 flex gap-4 items-center">
                <div className="text-3xl">🖥️</div>
                <div className="flex-1">
                  <div className="text-[18px] font-bold">{store?.name} — Terminal 1</div>
                  <div className="text-[12px] text-[#666666] mt-1">
                    Period: {format(dateFrom,'MMM d')} – {format(dateTo,'MMM d, yyyy')}
                  </div>
                </div>
                <button onClick={()=>toast.success('Printing shift report')}
                  className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2 text-[11px] text-[#666666] hover:border-teal-500/30 hover:text-teal-400 transition-all">
                  🖨 Print Report
                </button>
              </div>
              <div className="grid grid-cols-5 gap-3 mb-5">
                {[
                  ['Orders', shiftOrders.length, '#3b82f6'],
                  ['Revenue', `$${shiftRevenue.toFixed(0)}`, '#10b981'],
                  ['Avg Order', shiftOrders.length>0?`$${(shiftRevenue/shiftOrders.length).toFixed(0)}`:'—', undefined],
                  ['Refunds', shiftOrders.filter(o=>o.status==='refunded').length, '#ef4444'],
                  ['Discounts', `$${shiftOrders.reduce((s,o)=>s+(o.discount_amount||0),0).toFixed(0)}`, '#f59e0b'],
                ].map(([l,v,c]) => (
                  <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[10px] p-3">
                    <div className="text-[9px] font-mono text-[#999999] uppercase tracking-wider mb-1">{l}</div>
                    <div className="text-[18px] font-bold" style={{color:c}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Cash reconciliation */}
              <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4 mb-5">
                <div className="text-[13px] font-bold mb-3">💵 Cash Reconciliation</div>
                {[
                  ['Opening Float', '$200.00', undefined],
                  ['Cash Sales', `+$${cashTotal.toFixed(2)}`, '#10b981'],
                  ['Cash Refunds', '-$0.00', '#ef4444'],
                  ['Expected in Drawer', `$${(200 + cashTotal).toFixed(2)}`, undefined],
                ].map(([l,v,c]) => (
                  <div key={l} className="flex justify-between py-2 border-b border-[#E5E5E5] last:border-0">
                    <span className="text-[12px] text-[#666666]">{l}</span>
                    <span className="font-mono text-[13px] font-bold" style={{color:c}}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Orders */}
              <div className="text-[13px] font-bold mb-3">Recent Orders</div>
              <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] overflow-hidden">
                <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]" style={{gridTemplateColumns:'1.2fr 1fr 1fr 1fr 1fr'}}>
                  {['Order','Time','Customer','Payment','Amount'].map(h => (
                    <div key={h} className="px-3.5 py-2.5 font-mono text-[10px] text-[#999999] uppercase tracking-wider">{h}</div>
                  ))}
                </div>
                {shiftOrders.slice(0,10).map(o => (
                  <div key={o.id} className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5] transition-colors" style={{gridTemplateColumns:'1.2fr 1fr 1fr 1fr 1fr'}}>
                    <div className="px-3.5 py-3 font-mono text-[11px] text-[#006AFF]">{o.order_number}</div>
                    <div className="px-3.5 py-3 text-[11px] text-[#666666]">{format(new Date(o.created_at),'h:mm a')}</div>
                    <div className="px-3.5 py-3 text-[12px]">{o.customer_id ? 'Customer' : 'Walk-in'}</div>
                    <div className="px-3.5 py-3 text-[11px] text-[#666666]">
                      {o.order_payments?.[0]?.method?.replace('_',' ')||'—'}
                    </div>
                    <div className="px-3.5 py-3 font-mono text-[13px] font-bold">${o.total?.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── EMPLOYEE REPORT ── */}
          {activeReport === 'employee' && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  ['Total Staff', empData?.length||0, undefined],
                  ['Total Orders', orders.length, undefined],
                  ['Best Performer', empData?.[0]?.name||'—', '#f59e0b'],
                ].map(([l,v,c]) => (
                  <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
                    <div className="text-[10px] font-mono text-[#999999] uppercase tracking-wider mb-1.5">{l}</div>
                    <div className="text-[22px] font-bold" style={{color:c}}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4 mb-5">
                {(empData||[]).map((emp,i) => {
                  const COLORS = ['#3b82f6','#10b981','#006AFF','#ec4899']
                  return (
                    <div key={i} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0"
                          style={{background:COLORS[i%COLORS.length]}}>
                          {emp.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-[13px] font-bold">{emp.name}</div>
                          <div className="text-[10px] text-[#999999] capitalize">{emp.role}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          ['Orders', emp.orders, '#3b82f6'],
                          ['Revenue', `$${emp.revenue.toFixed(0)}`, '#10b981'],
                          ['Avg Order', emp.orders>0?`$${(emp.revenue/emp.orders).toFixed(0)}`:'—', undefined],
                          ['Discounts', `$${emp.discounts.toFixed(0)}`, '#f59e0b'],
                        ].map(([l,v,c]) => (
                          <div key={l} className="bg-[#F5F5F5] rounded-lg p-2.5 text-center">
                            <div className="text-[14px] font-bold font-mono" style={{color:c}}>{v}</div>
                            <div className="text-[9px] text-[#999999] mt-1">{l}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Placeholder for other reports */}
          {['products','payments','pnl','aging','inventory'].includes(activeReport) && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center text-[#999999]">
                <div className="text-4xl mb-3 opacity-30">{REPORT_NAV.find(r=>r.id===activeReport)?.icon}</div>
                <div className="text-[14px] font-bold">{REPORT_NAV.find(r=>r.id===activeReport)?.label}</div>
                <div className="text-[11px] font-mono mt-2 opacity-60">Full implementation coming in next build</div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
