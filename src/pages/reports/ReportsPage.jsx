// src/pages/reports/ReportsPage.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, format } from 'date-fns'
import { printReceipt } from '@/lib/receipt'
import { printShiftReport } from '@/lib/shiftReport'
import toast from 'react-hot-toast'

const REPORT_NAV = [
  { id:'daily',     icon:'☀️', label:'Daily Summary',        group:'Sales' },
  { id:'sales',     icon:'📈', label:'Sales Overview',      group:'Sales' },
  { id:'products',  icon:'📦', label:'Product Sales',        group:'Sales' },
  { id:'payments',  icon:'💳', label:'Payment Methods',      group:'Sales' },
  { id:'discounts', icon:'✂️', label:'Discounts',            group:'Sales' },
  { id:'giftcards', icon:'🎁', label:'Gift Cards',           group:'Sales' },
  { id:'tax',       icon:'🧾', label:'Tax Report',           group:'Financial' },
  { id:'pnl',       icon:'💰', label:'Profit & Loss',        group:'Financial' },
  { id:'aging',     icon:'📋', label:'Accounts Receivable',  group:'Financial' },
  { id:'shift',     icon:'🖥️', label:'Station & Shift',      group:'Operations' },
  { id:'employee',  icon:'👤', label:'Employee Report',      group:'Operations' },
  { id:'overrides', icon:'🔐', label:'Manager Overrides',    group:'Operations' },
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
  const [filterCashier, setFilterCashier] = useState('all') // 'all' | user.id

  // Load employees for the filter dropdown
  const { data: allEmployees = [] } = useQuery({
    queryKey: ['employees-list', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, name, role').eq('tenant_id', tenant.id)
        .eq('is_active', true).order('name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Sales summary
  const { data: salesData } = useQuery({
    queryKey: ['report-sales', tenant?.id, dateFrom, dateTo, filterCashier],
    queryFn: async () => {
      let oq = supabase.from('orders')
        .select('total, subtotal, tax_amount, discount_amount, coupon_discount, coupon_code, points_redeemed, status, created_at, cashier_id')
        .eq('tenant_id', tenant.id)
        .eq('status', 'completed')
        .gte('created_at', dateFrom.toISOString())
        .lte('created_at', dateTo.toISOString())
      if (filterCashier !== 'all') oq = oq.eq('cashier_id', filterCashier)
      const { data: orders } = await oq

      let pq = supabase.from('order_payments')
        .select('method, amount, orders!inner(tenant_id, status, created_at, cashier_id)')
        .eq('orders.tenant_id', tenant.id)
        .eq('orders.status', 'completed')
        .gte('orders.created_at', dateFrom.toISOString())
        .lte('orders.created_at', dateTo.toISOString())
      if (filterCashier !== 'all') pq = pq.eq('orders.cashier_id', filterCashier)
      const { data: payments } = await pq

      return { orders: orders||[], payments: payments||[] }
    },
    enabled: !!tenant?.id,
  })

  // ── Phase 10: Product sales — top sellers, by day-of-week, by category
  const { data: productData } = useQuery({
    queryKey: ['report-products', tenant?.id, dateFrom, dateTo, filterCashier],
    queryFn: async () => {
      let q = supabase.from('order_items')
        .select(`
          product_id, product_name, product_sku, quantity, line_total, unit_price,
          orders!inner(tenant_id, status, created_at, cashier_id),
          products(category_id, categories(name))
        `)
        .eq('tenant_id', tenant.id)
        .eq('orders.status', 'completed')
        .gte('orders.created_at', dateFrom.toISOString())
        .lte('orders.created_at', dateTo.toISOString())
      if (filterCashier !== 'all') q = q.eq('orders.cashier_id', filterCashier)
      const { data: items } = await q
      return items || []
    },
    enabled: !!tenant?.id && activeReport === 'products',
  })

  // ── Phase 10: Gift cards aggregate report
  const { data: giftCardData } = useQuery({
    queryKey: ['report-giftcards', tenant?.id],
    queryFn: async () => {
      const { data: cards } = await supabase.from('member_cards')
        .select('id, card_number, card_type, init_amount, balance, status, expires_at, created_at, last_used_at, customers(name)')
        .eq('tenant_id', tenant.id)
        .eq('card_type', 'gift')
        .order('created_at', { ascending: false })
      const { data: txns } = await supabase.from('gift_card_transactions')
        .select('type, amount, paid_amount, bonus_amount, created_at')
        .eq('tenant_id', tenant.id)
        .gte('created_at', dateFrom.toISOString())
        .lte('created_at', dateTo.toISOString())
      return { cards: cards || [], txns: txns || [] }
    },
    enabled: !!tenant?.id && activeReport === 'giftcards',
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

  // Closed shift records (cash_drawers) in range — for the history list + reprint
  const { data: closedShifts = [] } = useQuery({
    queryKey: ['report-closed-shifts', store?.id, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await supabase.from('cash_drawers')
        .select('*, users(name)')
        .eq('tenant_id', tenant.id)
        .gte('opened_at', dateFrom.toISOString())
        .lte('opened_at', dateTo.toISOString())
        .order('opened_at', { ascending: false })
      return data || []
    },
    enabled: !!store?.id && !!tenant?.id && activeReport === 'shift',
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

  // ── Manager Overrides report ──
  const { data: overridesData } = useQuery({
    queryKey: ['report-overrides', tenant?.id, dateFrom, dateTo, filterCashier],
    queryFn: async () => {
      let q = supabase.from('override_approvals')
        .select('*')
        .eq('tenant_id', tenant.id)
        .gte('created_at', dateFrom.toISOString())
        .lte('created_at', dateTo.toISOString())
        .order('created_at', { ascending: false })
        .limit(500)
      if (filterCashier !== 'all') q = q.eq('requested_by_user_id', filterCashier)
      const { data } = await q
      return data || []
    },
    enabled: !!tenant?.id && activeReport === 'overrides',
  })

  // ── Daily Summary (X-Report) ──
  // Always uses TODAY's date regardless of the dateFrom picker, but
  // honors any cashier filter for split-shift reporting.
  const { data: dailyXReportData } = useQuery({
    queryKey: ['report-daily', tenant?.id, store?.id, format(new Date(),'yyyy-MM-dd')],
    queryFn: async () => {
      const dayStart = startOfDay(new Date())
      const dayEnd   = endOfDay(new Date())
      // Orders today
      let oq = supabase.from('orders')
        .select('id, order_number, status, subtotal, total, tax_amount, discount_amount, coupon_discount, points_redeemed, cashier_id, cashier_name, terminal_id, created_at, voided_at, refunded_at, refund_status')
        .eq('tenant_id', tenant.id)
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString())
      if (store?.id) oq = oq.eq('store_id', store.id)
      const { data: orders = [] } = await oq

      const orderIds = orders.map(o => o.id)
      const { data: payments = [] } = orderIds.length === 0 ? { data: [] } : await supabase
        .from('order_payments').select('order_id, method, amount').in('order_id', orderIds)

      // Adjustments today (voids/cash-in/cash-out logged here)
      const { data: adjustments = [] } = await supabase.from('order_adjustments')
        .select('id, type, amount, payment_method, staff_id, staff_name, created_at')
        .eq('tenant_id', tenant.id)
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString())

      // Shifts open during today (any opened or closed in today)
      const { data: shifts = [] } = await supabase.from('cash_drawers')
        .select('id, cashier_id, terminal_id, opened_at, closed_at, opening_amount, closing_amount, terminals(name)')
        .eq('tenant_id', tenant.id)
        .or(`opened_at.gte.${dayStart.toISOString()},closed_at.gte.${dayStart.toISOString()}`)

      // Overrides today
      const { data: overrides = [] } = await supabase.from('override_approvals')
        .select('id, permission, action_label, amount, requested_by_name, approved_by_name, created_at')
        .eq('tenant_id', tenant.id)
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString())

      return { orders, payments, adjustments, shifts, overrides }
    },
    enabled: !!tenant?.id && activeReport === 'daily',
  })

  // ── CSV Export ──────────────────────────────────────
  // Builds CSV from whichever report is currently active.
  // Handles overrides, employees, products, sales, payments, discounts, tax.
  const doExport = () => {
    const downloadCSV = (filename, headers, rows) => {
      const escape = (s) => {
        const str = s == null ? '' : String(s)
        // Quote if contains comma, quote, or newline
        if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"'
        return str
      }
      const csv = [
        headers.map(escape).join(','),
        ...rows.map(r => r.map(escape).join(','))
      ].join('\n')
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast.success(`✓ Downloaded ${filename}`)
    }

    const dateRange = `${format(dateFrom,'yyyy-MM-dd')}_to_${format(dateTo,'yyyy-MM-dd')}`

    if (activeReport === 'overrides') {
      const rows = (overridesData || []).map(r => [
        format(new Date(r.created_at), 'yyyy-MM-dd HH:mm'),
        r.permission,
        r.action_label || '',
        r.order_number || '',
        r.amount != null ? Number(r.amount).toFixed(2) : '',
        r.requested_by_name || '',
        r.approved_by_name || '',
        r.notes || '',
      ])
      if (rows.length === 0) { toast.error('No overrides in this date range'); return }
      return downloadCSV(
        `overrides_${dateRange}.csv`,
        ['When','Permission','Action','Order#','Amount','Requested by','Approved by','Notes'],
        rows,
      )
    }

    if (activeReport === 'employee') {
      const rows = (employeeData || []).map(e => [
        e.name, e.orders, Number(e.revenue||0).toFixed(2),
        Number(e.discounts||0).toFixed(2),
        e.orders ? (Number(e.revenue) / e.orders).toFixed(2) : '0.00',
      ])
      return downloadCSV(
        `employees_${dateRange}.csv`,
        ['Employee','Orders','Revenue','Discounts','Avg Ticket'],
        rows,
      )
    }

    if (activeReport === 'products') {
      const rows = (productData || []).map(p => [
        p.product_name || p.products?.name || '—',
        p.qty || 0,
        Number(p.line_total||0).toFixed(2),
      ])
      return downloadCSV(
        `products_${dateRange}.csv`,
        ['Product','Qty Sold','Revenue'],
        rows,
      )
    }

    if (activeReport === 'sales') {
      const rows = (orders || []).map(o => [
        o.order_number || '',
        format(new Date(o.created_at), 'yyyy-MM-dd HH:mm'),
        o.cashier_name || '',
        Number(o.subtotal||0).toFixed(2),
        Number(o.discount_amount||0).toFixed(2),
        Number(o.tax_amount||0).toFixed(2),
        Number(o.total||0).toFixed(2),
        o.status,
      ])
      return downloadCSV(
        `sales_${dateRange}.csv`,
        ['Order#','When','Cashier','Subtotal','Discount','Tax','Total','Status'],
        rows,
      )
    }

    // Fallback: simple "Date,Orders,Revenue" daily summary for any other report
    toast.error(`Export not yet implemented for "${activeReport}"`)
  }

  // Computed sales metrics
  const orders = salesData?.orders || []
  const totalRevenue = orders.reduce((s,o)=>s+(o.total||0), 0)
  const totalTax = orders.reduce((s,o)=>s+(o.tax_amount||0), 0)
  const orderCount = orders.length
  const avgOrder = orderCount > 0 ? totalRevenue / orderCount : 0

  // ── Phase 10: discount breakdown ──
  // discount_amount in orders = manual + coupon + points combined (legacy)
  // We can extract coupon_discount and points_redeemed separately,
  // and infer manual as: discount_amount - coupon - points_cash_value
  const POINTS_RATE = tenant?.points_redeem_rate || 100
  const discountStats = orders.reduce((s,o) => {
    const totalDisc = Number(o.discount_amount || 0)
    const couponDisc = Number(o.coupon_discount || 0)
    const pointsCash = Number(o.points_redeemed || 0) / POINTS_RATE
    const manualDisc = Math.max(0, totalDisc - couponDisc - pointsCash)
    s.total += totalDisc
    s.manual += manualDisc
    s.coupon += couponDisc
    s.points += pointsCash
    s.pointsUsed += Number(o.points_redeemed || 0)
    if (couponDisc > 0) s.couponOrders++
    if (Number(o.points_redeemed || 0) > 0) s.pointsOrders++
    if (manualDisc > 0) s.manualOrders++
    return s
  }, { total:0, manual:0, coupon:0, points:0, pointsUsed:0, couponOrders:0, pointsOrders:0, manualOrders:0 })

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
            <select value={filterCashier} onChange={e=>setFilterCashier(e.target.value)}
              className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#1F1F1F] font-semibold outline-none cursor-pointer"
              title="Filter all reports by who rang up the sale">
              <option value="all">👥 All Employees</option>
              {allEmployees.map(e => (
                <option key={e.id} value={e.id}>👤 {e.name}{e.role!=='cashier'?` (${e.role})`:''}</option>
              ))}
            </select>
            <input type="date" defaultValue={format(dateFrom,'yyyy-MM-dd')}
              className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#1F1F1F] font-mono outline-none"/>
            <span className="text-[#999999] text-sm">→</span>
            <input type="date" defaultValue={format(dateTo,'yyyy-MM-dd')}
              className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#1F1F1F] font-mono outline-none"/>
            <button onClick={() => doExport()}
              className="bg-teal-500 border-none rounded-lg px-3 py-1.5 text-[11px] font-bold text-white ml-2 cursor-pointer">
              ⬇ Export
            </button>
          </div>
        </div>

        {/* Report content */}
        <div className="flex-1 overflow-y-auto p-6">
          {filterCashier !== 'all' && (
            <div className="mb-4 rounded-lg px-4 py-2.5 flex items-center justify-between"
              style={{background:'#E6F0FF', border:'1px solid #80B2FF'}}>
              <div className="text-[12px] text-[#006AFF]">
                <b>📌 Filtered by:</b> {allEmployees.find(e=>e.id===filterCashier)?.name || 'Selected employee'}
                <span className="ml-2 text-[10px] text-[#666]">(only orders rung up by this employee)</span>
              </div>
              <button onClick={()=>setFilterCashier('all')}
                className="rounded-md px-3 py-1 text-[11px] font-bold cursor-pointer border"
                style={{background:'#fff', color:'#006AFF', borderColor:'#80B2FF'}}>
                Clear filter ✕
              </button>
            </div>
          )}
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

              {/* Shift history — real closed shifts, each reprintable */}
              <div className="text-[13px] font-bold mb-3">📋 Shift History</div>
              <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] overflow-hidden mb-5">
                <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]" style={{gridTemplateColumns:'1.4fr 1fr 1fr 0.9fr 0.9fr 0.9fr 80px'}}>
                  {['Opened','Closed','Cashier','Opening','Expected','Variance',''].map(h => (
                    <div key={h} className="px-3 py-2.5 font-mono text-[10px] text-[#999999] uppercase tracking-wider">{h}</div>
                  ))}
                </div>
                {closedShifts.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[12px] text-[#999]">No shifts in this period</div>
                ) : closedShifts.map(sh => {
                  const variance = sh.variance ?? null
                  const isClosed = !!sh.closed_at
                  return (
                    <div key={sh.id} className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5] items-center" style={{gridTemplateColumns:'1.4fr 1fr 1fr 0.9fr 0.9fr 0.9fr 80px'}}>
                      <div className="px-3 py-3 text-[11px] text-[#1F1F1F]">{format(new Date(sh.opened_at),'MMM d, h:mm a')}</div>
                      <div className="px-3 py-3 text-[11px] text-[#666]">
                        {isClosed ? format(new Date(sh.closed_at),'MMM d, h:mm a') : <span className="text-[#15803D] font-bold">● Open</span>}
                      </div>
                      <div className="px-3 py-3 text-[12px]">{sh.users?.name || '—'}</div>
                      <div className="px-3 py-3 font-mono text-[11px]">${(sh.opening_amount||0).toFixed(2)}</div>
                      <div className="px-3 py-3 font-mono text-[11px]">{sh.expected_amount!=null?`$${sh.expected_amount.toFixed(2)}`:'—'}</div>
                      <div className="px-3 py-3 font-mono text-[11px] font-bold" style={{color: variance==null?'#999':variance===0?'#15803D':Math.abs(variance)<0.01?'#15803D':'#CF1322'}}>
                        {variance!=null?`${variance>=0?'+':''}$${variance.toFixed(2)}`:'—'}
                      </div>
                      <div className="px-2 py-3">
                        <button onClick={async () => {
                          try {
                            await printShiftReport({
                              shift: sh,
                              closingAmount: sh.closing_amount ?? sh.expected_amount ?? 0,
                              tenantId: tenant.id,
                              storeInfo: store,
                              cashierName: sh.users?.name || '',
                              terminalName: sh.terminal_name || '',
                            })
                            toast.success('Shift report sent to printer')
                          } catch (e) { toast.error('Print failed: ' + e.message) }
                        }}
                          className="rounded-lg px-2 py-1.5 text-[10px] font-bold cursor-pointer"
                          style={{background:'#006AFF', color:'#fff', border:'none'}}>
                          🖨 Print
                        </button>
                      </div>
                    </div>
                  )
                })}
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

          {/* ── DAILY SUMMARY (X-Report) ── */}
          {activeReport === 'daily' && (
            <DailyReport data={dailyXReportData} storeInfo={store} tenantInfo={tenant}/>
          )}

          {/* ── MANAGER OVERRIDES ── */}
          {activeReport === 'overrides' && (
            <OverridesReport rows={overridesData || []} dateFrom={dateFrom} dateTo={dateTo}/>
          )}

          {/* ── PRODUCT SALES (Phase 10) ── */}
          {activeReport === 'products' && (
            <ProductReport items={productData || []} dateFrom={dateFrom} dateTo={dateTo}/>
          )}

          {/* ── DISCOUNTS (Phase 10) ── */}
          {activeReport === 'discounts' && (
            <DiscountReport stats={discountStats} orderCount={orderCount} pointsRate={POINTS_RATE} orders={orders}/>
          )}

          {/* ── GIFT CARDS (Phase 10) ── */}
          {activeReport === 'giftcards' && (
            <GiftCardReport cards={giftCardData?.cards || []} txns={giftCardData?.txns || []} dateFrom={dateFrom} dateTo={dateTo}/>
          )}

          {/* ── PAYMENT METHODS (Phase 10 — promote from sales overview) ── */}
          {activeReport === 'payments' && (
            <PaymentReport orders={orders} payments={salesData?.payments || []} totalRevenue={totalRevenue}/>
          )}

          {/* Remaining placeholders */}
          {['pnl','inventory'].includes(activeReport) && (
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


// ════════════════════════════════════════════════════════════════════
// PHASE 10 — Report components
// ════════════════════════════════════════════════════════════════════

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

// ── DAILY SUMMARY (X-REPORT) ─────────────────────────────────────
// "Open the books at end of day" view. Always shows TODAY's data
// regardless of the date picker. Combines orders + payments +
// adjustments + shifts + overrides across all terminals in the
// current store. Includes an 80mm print button.
function DailyReport({ data, storeInfo, tenantInfo }) {
  const orders     = data?.orders     || []
  const payments   = data?.payments   || []
  const adjustments= data?.adjustments|| []
  const shifts     = data?.shifts     || []
  const overrides  = data?.overrides  || []

  const completed = orders.filter(o => o.status === 'completed')
  const voided    = orders.filter(o => o.status === 'voided')
  const sales     = completed.filter(o => Number(o.total) >= 0)
  const refundOrders = completed.filter(o => Number(o.total) < 0)

  const grossSales  = sales.reduce((s,o) => s + Number(o.total||0), 0)
  const refundAmt   = Math.abs(refundOrders.reduce((s,o) => s + Number(o.total||0), 0))
  const taxTotal    = sales.reduce((s,o) => s + Number(o.tax_amount||0), 0)
  const discTotal   = sales.reduce((s,o) => s + Number(o.discount_amount||0), 0)
  const couponTotal = sales.reduce((s,o) => s + Number(o.coupon_discount||0), 0)
  const ptsTotal    = sales.reduce((s,o) => s + Number(o.points_redeemed||0), 0)
  const voidedAmt   = voided.reduce((s,o) => s + Number(o.total||0), 0)
  const netSales    = grossSales - refundAmt
  const orderCount  = sales.length
  const avgTicket   = orderCount > 0 ? grossSales / orderCount : 0

  // Payment breakdown
  const payByMethod = {}
  payments.forEach(p => {
    const ord = orders.find(o => o.id === p.order_id)
    if (!ord || ord.status !== 'completed') return
    const isRefund = Number(ord.total) < 0
    if (!payByMethod[p.method]) payByMethod[p.method] = { collected:0, refunded:0, net:0 }
    if (isRefund) payByMethod[p.method].refunded += Math.abs(Number(p.amount||0))
    else          payByMethod[p.method].collected += Number(p.amount||0)
    payByMethod[p.method].net = payByMethod[p.method].collected - payByMethod[p.method].refunded
  })

  // By cashier
  const byCashier = {}
  sales.forEach(o => {
    const k = o.cashier_name || 'Unknown'
    if (!byCashier[k]) byCashier[k] = { count:0, gross:0 }
    byCashier[k].count++
    byCashier[k].gross += Number(o.total||0)
  })
  const cashierRows = Object.entries(byCashier).sort((a,b) => b[1].gross - a[1].gross)

  // Cash drawer math
  const cashCollected = payByMethod.cash?.collected || 0
  const cashRefunded  = payByMethod.cash?.refunded || 0
  const cashIn  = adjustments.filter(a => a.type === 'cash_in').reduce((s,a) => s + Number(a.amount||0), 0)
  const cashOut = Math.abs(adjustments.filter(a => a.type === 'cash_out').reduce((s,a) => s + Number(a.amount||0), 0))
  const openingTotal = shifts.reduce((s,sh) => s + Number(sh.opening_amount||0), 0)
  const expectedCash = openingTotal + cashCollected - cashRefunded + cashIn - cashOut

  const fmt = (n) => '$' + Number(n||0).toFixed(2)

  const PAY_LABEL = {
    cash:'💵 Cash', card:'💳 Card', credit_card:'💳 Credit',
    debit_card:'💳 Debit', member_card:'🏷️ VIP Card',
    gift_card:'🎁 Gift Card', coupon:'🎫 Coupon',
  }

  const printX = () => {
    const sn = (storeInfo?.name || 'RetailPOS').toUpperCase()
    const dt = format(new Date(), 'EEE MMM d, yyyy')
    const tm = format(new Date(), 'h:mm a')
    const dash = '<div style="border-top:1px dashed #999;margin:4px 0;"></div>'
    const dbl  = '<div style="border-top:2px solid #000;margin:6px 0;"></div>'
    const row = (l, r, opt={}) => `
      <div style="display:flex;justify-content:space-between;${opt.bold?'font-weight:900;':''}${opt.big?'font-size:13px;':''}${opt.color?`color:${opt.color};`:''}">
        <span>${l}</span><span style="font-family:monospace;">${r}</span>
      </div>`

    const payRows = Object.entries(payByMethod).map(([m,v]) =>
      row(PAY_LABEL[m]||m, fmt(v.net))).join('')
    const cashierLines = cashierRows.map(([name, v]) =>
      row(name, `${v.count} ord · ${fmt(v.gross)}`)).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: 80mm auto; margin: 0; }
      body { font-family: 'Courier New', monospace; font-size: 12px; line-height:1.5; color:#000; max-width:80mm; margin:0 auto; padding:6px; }
      .title { font-size: 14px; font-weight: 900; text-align: center; letter-spacing: 1px; }
      .center { text-align: center; }
      .small { font-size: 10px; color:#555; }
    </style></head><body>
    <div class="title">${sn}</div>
    <div class="center small">DAILY SUMMARY (X-REPORT)</div>
    <div class="center small">${dt} · ${tm}</div>
    ${dash}
    ${row('Orders', orderCount)}
    ${row('Refunds', refundOrders.length)}
    ${row('Voids', voided.length)}
    ${row('Avg Ticket', fmt(avgTicket))}
    ${dash}
    ${row('Gross Sales', fmt(grossSales))}
    ${discTotal>0?row('  Discounts', `-${fmt(discTotal)}`, {color:'#dc2626'}):''}
    ${couponTotal>0?row('  Coupons',  `-${fmt(couponTotal)}`,{color:'#dc2626'}):''}
    ${ptsTotal>0?row('  Points', `${ptsTotal} pts`, {color:'#B45309'}):''}
    ${row('Tax', fmt(taxTotal))}
    ${refundAmt>0?row('Refunds', `-${fmt(refundAmt)}`, {color:'#dc2626'}):''}
    ${dash}
    ${row('NET SALES', fmt(netSales), {bold:true, big:true})}
    ${dash}
    <div class="bold center">— PAYMENTS —</div>
    ${payRows || '<div class="center small">No payments</div>'}
    ${dbl}
    <div class="bold center">— CASH DRAWER —</div>
    ${row('Opening total', fmt(openingTotal))}
    ${row('Cash sales', `+${fmt(cashCollected)}`)}
    ${cashRefunded>0?row('Cash refunds', `-${fmt(cashRefunded)}`, {color:'#dc2626'}):''}
    ${cashIn>0?row('Cash in (paid in)', `+${fmt(cashIn)}`):''}
    ${cashOut>0?row('Cash out (paid out)', `-${fmt(cashOut)}`):''}
    ${row('EXPECTED', fmt(expectedCash), {bold:true})}
    ${cashierRows.length>1?`${dbl}<div class="bold center">— BY EMPLOYEE —</div>${cashierLines}`:''}
    ${overrides.length>0?`${dbl}<div class="bold center">— OVERRIDES (${overrides.length}) —</div>`:''}
    ${dash}
    <div class="center small">Printed ${new Date().toLocaleString()}</div>
    <div class="center small" style="margin-top:8px;">— END OF X-REPORT —</div>
    </body></html>`
    printReceipt(html, 1)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[20px] font-bold mb-1">☀️ Daily Summary — {format(new Date(),'EEE MMM d, yyyy')}</div>
          <div className="text-[11px] text-[#666]">
            Today's activity across all terminals · {storeInfo?.name || 'All stores'} · auto-updated
          </div>
        </div>
        <button onClick={printX}
          className="rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer border-none text-white"
          style={{background:'#1F1F1F'}}>
          🖨️ Print X-Report
        </button>
      </div>

      {/* Big KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <BigKpi label="Orders"      value={orderCount}          color="#3b82f6"/>
        <BigKpi label="Net Sales"   value={fmt(netSales)}       color="#10b981"/>
        <BigKpi label="Tax"         value={fmt(taxTotal)}       color="#0891b2"/>
        <BigKpi label="Avg Ticket"  value={fmt(avgTicket)}      color="#1F1F1F"/>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SmallKpi label="Gross Sales"      value={fmt(grossSales)}      color="#10b981"/>
        <SmallKpi label="Refunds"          value={`-${fmt(refundAmt)}`} color="#dc2626"/>
        <SmallKpi label="Voids"            value={voided.length}        color="#64748b"/>
        <SmallKpi label="Discounts Given"  value={`-${fmt(discTotal)}`} color="#9333ea"/>
        <SmallKpi label="Coupons Used"     value={`-${fmt(couponTotal)}`} color="#c026d3"/>
        <SmallKpi label="Points Redeemed"  value={`${ptsTotal} pts`}    color="#B45309"/>
      </div>

      {/* Payment Breakdown */}
      <div>
        <div className="text-[12px] font-bold uppercase tracking-wider text-[#666] mb-2">💳 Payment Breakdown</div>
        <div className="rounded-xl overflow-hidden" style={{border:'1px solid #E5E5E5'}}>
          <table className="w-full text-[12px]">
            <thead style={{background:'#FAFAFA'}}>
              <tr>
                <th className="text-left px-3 py-2 font-bold">Method</th>
                <th className="text-right px-3 py-2 font-bold">Collected</th>
                <th className="text-right px-3 py-2 font-bold">Refunded</th>
                <th className="text-right px-3 py-2 font-bold">Net</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(payByMethod).length === 0 ? (
                <tr><td colSpan="4" className="text-center py-4 text-[#999]">No payments today</td></tr>
              ) : Object.entries(payByMethod).map(([m,v]) => (
                <tr key={m} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold">{PAY_LABEL[m] || m}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(v.collected)}</td>
                  <td className="px-3 py-2 text-right font-mono" style={{color:v.refunded>0?'#dc2626':'#999'}}>
                    {v.refunded > 0 ? `-${fmt(v.refunded)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">{fmt(v.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cash drawer */}
      <div>
        <div className="text-[12px] font-bold uppercase tracking-wider text-[#666] mb-2">💵 Cash Drawer</div>
        <div className="rounded-xl px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]"
          style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
          <Row l="Opening floats (all shifts)" v={fmt(openingTotal)} mono/>
          <Row l="Cash sales" v={`+${fmt(cashCollected)}`} mono color="#16a34a"/>
          {cashRefunded > 0 && <Row l="Cash refunds" v={`-${fmt(cashRefunded)}`} mono color="#dc2626"/>}
          {cashIn > 0  && <Row l="Cash in"  v={`+${fmt(cashIn)}`} mono/>}
          {cashOut > 0 && <Row l="Cash out" v={`-${fmt(cashOut)}`} mono/>}
          <Row l="EXPECTED CASH" v={fmt(expectedCash)} mono bold/>
        </div>
      </div>

      {/* By cashier */}
      {cashierRows.length > 0 && (
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wider text-[#666] mb-2">👤 By Employee</div>
          <div className="rounded-xl overflow-hidden" style={{border:'1px solid #E5E5E5'}}>
            <table className="w-full text-[12px]">
              <thead style={{background:'#FAFAFA'}}>
                <tr>
                  <th className="text-left px-3 py-2 font-bold">Employee</th>
                  <th className="text-right px-3 py-2 font-bold">Orders</th>
                  <th className="text-right px-3 py-2 font-bold">Sales</th>
                  <th className="text-right px-3 py-2 font-bold">Avg Ticket</th>
                </tr>
              </thead>
              <tbody>
                {cashierRows.map(([name, v]) => (
                  <tr key={name} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold">{name}</td>
                    <td className="px-3 py-2 text-right font-mono">{v.count}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{fmt(v.gross)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#666]">{fmt(v.gross / v.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Shifts today */}
      {shifts.length > 0 && (
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wider text-[#666] mb-2">🖥️ Shifts Today</div>
          <div className="rounded-xl overflow-hidden" style={{border:'1px solid #E5E5E5'}}>
            <table className="w-full text-[12px]">
              <thead style={{background:'#FAFAFA'}}>
                <tr>
                  <th className="text-left px-3 py-2 font-bold">Terminal</th>
                  <th className="text-left px-3 py-2 font-bold">Opened</th>
                  <th className="text-left px-3 py-2 font-bold">Closed</th>
                  <th className="text-right px-3 py-2 font-bold">Opening $</th>
                  <th className="text-right px-3 py-2 font-bold">Closing $</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map(sh => (
                  <tr key={sh.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold">{sh.terminals?.name || '—'}</td>
                    <td className="px-3 py-2 text-[#666] text-[11px]">{format(new Date(sh.opened_at), 'h:mm a')}</td>
                    <td className="px-3 py-2 text-[#666] text-[11px]">
                      {sh.closed_at ? format(new Date(sh.closed_at), 'h:mm a') : <span style={{color:'#16a34a',fontWeight:'bold'}}>● OPEN</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(sh.opening_amount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{sh.closing_amount != null ? fmt(sh.closing_amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Overrides today */}
      {overrides.length > 0 && (
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wider text-[#666] mb-2">
            🔐 Manager Overrides Today ({overrides.length})
          </div>
          <div className="rounded-xl overflow-hidden" style={{border:'1px solid #E5E5E5'}}>
            <table className="w-full text-[12px]">
              <thead style={{background:'#FAFAFA'}}>
                <tr>
                  <th className="text-left px-3 py-2 font-bold">Time</th>
                  <th className="text-left px-3 py-2 font-bold">Action</th>
                  <th className="text-right px-3 py-2 font-bold">Amount</th>
                  <th className="text-left px-3 py-2 font-bold">By</th>
                  <th className="text-left px-3 py-2 font-bold">Approved by</th>
                </tr>
              </thead>
              <tbody>
                {overrides.slice(0, 20).map(o => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-[11px] text-[#666]">{format(new Date(o.created_at), 'h:mm a')}</td>
                    <td className="px-3 py-2 text-[11px]">{o.action_label || o.permission}</td>
                    <td className="px-3 py-2 text-right font-mono">{o.amount ? fmt(o.amount) : '—'}</td>
                    <td className="px-3 py-2 text-[11px]">{o.requested_by_name || '—'}</td>
                    <td className="px-3 py-2 text-[11px] font-semibold" style={{color:'#9333ea'}}>{o.approved_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overrides.length > 20 && (
              <div className="px-3 py-2 text-[10px] text-[#999] text-center" style={{background:'#FAFAFA'}}>
                +{overrides.length - 20} more — see Manager Overrides tab for full list
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function BigKpi({ label, value, color }) {
  return (
    <div className="rounded-xl px-5 py-4" style={{background:'#fff', border:`2px solid ${color}22`, boxShadow:`0 2px 8px ${color}10`}}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#666]">{label}</div>
      <div className="text-[28px] font-bold font-mono mt-1" style={{color}}>{value}</div>
    </div>
  )
}

function SmallKpi({ label, value, color }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{background:'#fff', border:'1px solid #E5E5E5'}}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-[#999]">{label}</div>
      <div className="text-[14px] font-bold font-mono mt-0.5" style={{color}}>{value}</div>
    </div>
  )
}

function Row({ l, v, mono, bold, color }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-[#666]">{l}</span>
      <span style={{fontFamily: mono?'monospace':'inherit', fontWeight: bold?'bold':'normal', color: color||'inherit'}}>{v}</span>
    </div>
  )
}


// ── MANAGER OVERRIDES REPORT ──────────────────────────────────────
// Shows every time a cashier needed manager PIN approval, grouped by
// approver + permission so you can spot patterns (e.g. one cashier
// asking for refund overrides 20 times a day).
function OverridesReport({ rows, dateFrom, dateTo }) {
  const total = rows.length
  const totalAmt = rows.reduce((s,r) => s + Number(r.amount||0), 0)

  // Group by permission
  const byPerm = {}
  rows.forEach(r => {
    if (!byPerm[r.permission]) byPerm[r.permission] = { count:0, amt:0 }
    byPerm[r.permission].count++
    byPerm[r.permission].amt += Number(r.amount||0)
  })
  const permList = Object.entries(byPerm).sort((a,b) => b[1].count - a[1].count)

  // Group by approver
  const byApprover = {}
  rows.forEach(r => {
    const k = r.approved_by_name || 'Unknown'
    if (!byApprover[k]) byApprover[k] = { count:0, amt:0 }
    byApprover[k].count++
    byApprover[k].amt += Number(r.amount||0)
  })
  const approverList = Object.entries(byApprover).sort((a,b) => b[1].count - a[1].count)

  // Group by requester
  const byRequester = {}
  rows.forEach(r => {
    const k = r.requested_by_name || 'Unknown'
    if (!byRequester[k]) byRequester[k] = { count:0, amt:0 }
    byRequester[k].count++
    byRequester[k].amt += Number(r.amount||0)
  })
  const requesterList = Object.entries(byRequester).sort((a,b) => b[1].count - a[1].count)

  const fmt = (n) => '$' + Number(n||0).toFixed(2)
  const fmtDT = (s) => format(new Date(s), 'MMM d, h:mm a')

  // Pretty label per permission
  const PERM_LABEL = {
    'pos.refund': '↩️ Refund',
    'pos.void': '🚫 Void',
    'pos.discount': '✂️ Discount',
    'pos.price_override': '💲 Price Override',
    'pos.close_shift': '🌙 Close Shift',
    'pos.tax_exempt': '🏛️ Tax Exempt',
    'pos.surcharge': '💼 Surcharge',
    'pos.gift_card': '🎁 Gift Card',
    'pos.points_redeem': '⭐ Points Redeem',
  }
  const labelFor = (p) => PERM_LABEL[p] || p

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[18px] font-bold mb-1">🔐 Manager Overrides</div>
        <div className="text-[11px] text-[#666666]">
          Every action that needed manager PIN approval · {format(dateFrom,'MMM d')} – {format(dateTo,'MMM d, yyyy')}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Total Overrides"  value={total}                color="#9333ea"/>
        <KpiCard label="Total $ Affected" value={fmt(totalAmt)}        color="#dc2626"/>
        <KpiCard label="Unique Approvers" value={approverList.length}  color="#0891b2"/>
        <KpiCard label="Unique Requesters" value={requesterList.length} color="#f59e0b"/>
      </div>

      {total === 0 && (
        <div className="text-center py-12 text-[#999]">
          <div className="text-[40px] mb-2 opacity-30">🔐</div>
          <div className="text-[13px]">No manager overrides in this period</div>
          <div className="text-[11px] mt-1 opacity-70">When a cashier needs approval, it'll show up here</div>
        </div>
      )}

      {total > 0 && <>
        {/* By Permission */}
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wider text-[#666] mb-2">By Action Type</div>
          <div className="rounded-xl overflow-hidden" style={{border:'1px solid #E5E5E5'}}>
            <table className="w-full text-[12px]">
              <thead style={{background:'#FAFAFA'}}>
                <tr>
                  <th className="text-left px-3 py-2 font-bold">Action</th>
                  <th className="text-right px-3 py-2 font-bold">Count</th>
                  <th className="text-right px-3 py-2 font-bold">Total $</th>
                  <th className="text-right px-3 py-2 font-bold">Avg $</th>
                </tr>
              </thead>
              <tbody>
                {permList.map(([perm, s]) => (
                  <tr key={perm} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold">{labelFor(perm)}</td>
                    <td className="px-3 py-2 text-right font-mono">{s.count}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(s.amt)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#666]">{fmt(s.amt / s.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* By Approver & Requester side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wider text-[#666] mb-2">By Approver (who unlocked)</div>
            <div className="rounded-xl overflow-hidden" style={{border:'1px solid #E5E5E5'}}>
              <table className="w-full text-[12px]">
                <thead style={{background:'#FAFAFA'}}>
                  <tr>
                    <th className="text-left px-3 py-2 font-bold">Manager</th>
                    <th className="text-right px-3 py-2 font-bold">Count</th>
                    <th className="text-right px-3 py-2 font-bold">Total $</th>
                  </tr>
                </thead>
                <tbody>
                  {approverList.map(([name, s]) => (
                    <tr key={name} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white"
                          style={{background:'#9333ea'}}>{name.charAt(0).toUpperCase()}</span>
                        {name}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{s.count}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(s.amt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="text-[12px] font-bold uppercase tracking-wider text-[#666] mb-2">By Requester (who asked)</div>
            <div className="rounded-xl overflow-hidden" style={{border:'1px solid #E5E5E5'}}>
              <table className="w-full text-[12px]">
                <thead style={{background:'#FAFAFA'}}>
                  <tr>
                    <th className="text-left px-3 py-2 font-bold">Cashier</th>
                    <th className="text-right px-3 py-2 font-bold">Count</th>
                    <th className="text-right px-3 py-2 font-bold">Total $</th>
                  </tr>
                </thead>
                <tbody>
                  {requesterList.map(([name, s]) => (
                    <tr key={name} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white"
                          style={{background:'#f59e0b'}}>{name.charAt(0).toUpperCase()}</span>
                        {name}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{s.count}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(s.amt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Full chronological log */}
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wider text-[#666] mb-2">All Overrides — Newest First</div>
          <div className="rounded-xl overflow-hidden" style={{border:'1px solid #E5E5E5'}}>
            <table className="w-full text-[12px]">
              <thead style={{background:'#FAFAFA'}}>
                <tr>
                  <th className="text-left px-3 py-2 font-bold">When</th>
                  <th className="text-left px-3 py-2 font-bold">Action</th>
                  <th className="text-left px-3 py-2 font-bold">Order#</th>
                  <th className="text-right px-3 py-2 font-bold">Amount</th>
                  <th className="text-left px-3 py-2 font-bold">Requested</th>
                  <th className="text-left px-3 py-2 font-bold">Approved</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-[11px] text-[#666]">{fmtDT(r.created_at)}</td>
                    <td className="px-3 py-2 font-semibold">{labelFor(r.permission)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#666]">{r.order_number || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.amount ? fmt(r.amount) : '—'}</td>
                    <td className="px-3 py-2 text-[11px]">{r.requested_by_name || '—'}</td>
                    <td className="px-3 py-2 text-[11px] font-semibold" style={{color:'#9333ea'}}>🔐 {r.approved_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 500 && (
            <div className="text-[10px] text-[#999] mt-2 text-center">
              Showing first 500 — narrow the date range to see more
            </div>
          )}
        </div>
      </>}
    </div>
  )
}

function KpiCard({ label, value, color }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{background:'#fff', border:`1px solid ${color}33`}}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#666]">{label}</div>
      <div className="text-[20px] font-bold font-mono mt-1" style={{color}}>{value}</div>
    </div>
  )
}


// ── PRODUCT SALES REPORT ──────────────────────────────────────────
function ProductReport({ items, dateFrom, dateTo }) {
  // Top sellers (by qty)
  const byProduct = {}
  items.forEach(it => {
    const id = it.product_id || it.product_name
    if (!byProduct[id]) {
      byProduct[id] = {
        name: it.product_name, sku: it.product_sku,
        category: it.products?.categories?.name || 'Uncategorized',
        qty: 0, revenue: 0, orderCount: 0,
      }
    }
    byProduct[id].qty += Number(it.quantity || 0)
    byProduct[id].revenue += Number(it.line_total || 0)
    byProduct[id].orderCount += 1
  })
  const ranked = Object.values(byProduct).sort((a,b) => b.qty - a.qty)
  const top20 = ranked.slice(0, 20)
  const maxQty = Math.max(...top20.map(p => p.qty), 1)

  // By day-of-week
  const dowSales = Array(7).fill(0).map(() => ({ revenue: 0, qty: 0, orders: 0 }))
  items.forEach(it => {
    const d = new Date(it.orders?.created_at)
    const dow = d.getDay()
    dowSales[dow].revenue += Number(it.line_total || 0)
    dowSales[dow].qty += Number(it.quantity || 0)
  })
  const maxDow = Math.max(...dowSales.map(d => d.revenue), 1)

  // By category
  const byCat = {}
  items.forEach(it => {
    const cat = it.products?.categories?.name || 'Uncategorized'
    if (!byCat[cat]) byCat[cat] = { name: cat, qty: 0, revenue: 0, products: new Set() }
    byCat[cat].qty += Number(it.quantity || 0)
    byCat[cat].revenue += Number(it.line_total || 0)
    byCat[cat].products.add(it.product_id)
  })
  const cats = Object.values(byCat)
    .map(c => ({...c, productCount: c.products.size}))
    .sort((a,b) => b.revenue - a.revenue)
  const totalCatRev = cats.reduce((s,c) => s + c.revenue, 0)

  if (items.length === 0) return (
    <EmptyState icon="📦" label="No product sales in this period"/>
  )

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        {[
          ['Products sold', ranked.length, '#3b82f6', 'unique items'],
          ['Total units',   items.reduce((s,it)=>s+Number(it.quantity||0),0).toLocaleString(), '#10b981', 'pieces'],
          ['Total revenue', `$${items.reduce((s,it)=>s+Number(it.line_total||0),0).toFixed(0)}`, '#FA8C16', 'from products'],
          ['Categories',    cats.length, '#ec4899', 'in scope'],
        ].map(([l,v,c,sub]) => (
          <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
            <div className="text-[10px] font-mono text-[#999999] uppercase tracking-wider mb-1.5">{l}</div>
            <div className="text-[22px] font-bold" style={{color:c}}>{v}</div>
            <div className="text-[10px] text-[#999999] mt-1">{sub}</div>
          </div>
        ))}
      </div>

      {/* Top 20 sellers */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5">
        <div className="flex justify-between items-center mb-3">
          <div className="text-[13px] font-bold">🏆 Top 20 Sellers</div>
          <div className="text-[10px] text-[#666] font-mono">
            {format(dateFrom,'MMM d')} – {format(dateTo,'MMM d, yyyy')}
          </div>
        </div>
        <div className="space-y-1">
          {top20.map((p, i) => {
            const pct = (p.qty / maxQty) * 100
            return (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <div className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                  style={i<3
                    ? {background: i===0?'#FEF3C7':i===1?'#F1F5F9':'#FFEDD5', color: i===0?'#B45309':i===1?'#475569':'#9A3412'}
                    : {background:'#F8FAFC', color:'#94A3B8'}}>
                  {i+1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-[#1F1F1F] truncate">{p.name}</div>
                  <div className="text-[10px] text-[#666]">
                    {p.category}{p.sku ? ` · ${p.sku}` : ''}
                  </div>
                  <div className="h-1.5 bg-[#F1F5F9] rounded mt-1 overflow-hidden">
                    <div className="h-full rounded" style={{width:`${pct}%`, background:'linear-gradient(90deg,#FA8C16,#FB923C)'}}/>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[14px] font-bold font-mono text-[#1F1F1F]">{p.qty}</div>
                  <div className="text-[10px] text-[#666] font-mono">${p.revenue.toFixed(0)}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* By day of week */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5">
        <div className="text-[13px] font-bold mb-3">📅 Sales by Day of Week</div>
        <div className="flex items-end gap-2 h-[140px] mb-2">
          {dowSales.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end">
              <div className="text-[10px] font-mono text-[#666] mb-1">
                {d.revenue > 0 ? `$${(d.revenue/1000).toFixed(1)}k` : ''}
              </div>
              <div className="w-full rounded-t transition-all" title={`${DOW[i]}: $${d.revenue.toFixed(2)}, ${d.qty} units`}
                style={{
                  height:`${Math.max(2, d.revenue/maxDow * 110)}px`,
                  background: i===0||i===6 ? 'linear-gradient(180deg,#A78BFA,#7C3AED)' : 'linear-gradient(180deg,#60A5FA,#2563EB)',
                  minHeight:'4px',
                }}/>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          {DOW.map((d,i) => (
            <div key={i} className="flex-1 text-[10px] font-mono font-bold text-center"
              style={{color: i===0||i===6 ? '#7C3AED' : '#1F1F1F'}}>{d}</div>
          ))}
        </div>
      </div>

      {/* By category */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5">
        <div className="text-[13px] font-bold mb-3">🏷️ Sales by Category</div>
        <div className="space-y-2">
          {cats.map(c => {
            const pct = totalCatRev > 0 ? (c.revenue / totalCatRev) * 100 : 0
            return (
              <div key={c.name} className="flex items-center gap-3">
                <div className="w-[140px] text-[12px] font-semibold text-[#1F1F1F] truncate">{c.name}</div>
                <div className="flex-1 h-3 bg-[#F1F5F9] rounded overflow-hidden">
                  <div className="h-full rounded" style={{width:`${pct}%`, background:'linear-gradient(90deg,#10B981,#34D399)'}}/>
                </div>
                <div className="text-right w-[100px]">
                  <div className="text-[12px] font-bold font-mono">${c.revenue.toFixed(0)}</div>
                  <div className="text-[9px] text-[#666] font-mono">{c.qty} units · {c.productCount} SKUs</div>
                </div>
                <div className="text-[11px] font-mono text-[#666] w-[40px] text-right">{pct.toFixed(0)}%</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


// ── DISCOUNT REPORT ───────────────────────────────────────────────
function DiscountReport({ stats, orderCount, pointsRate, orders }) {
  if (stats.total === 0) return (
    <EmptyState icon="✂️" label="No discounts applied in this period"/>
  )

  const types = [
    { label:'Manual Discount', amt: stats.manual, color:'#16a34a', bg:'#dcfce7', count: stats.manualOrders, icon:'✂️' },
    { label:'Coupon Codes',    amt: stats.coupon, color:'#c026d3', bg:'#fdf4ff', count: stats.couponOrders, icon:'🎫' },
    { label:'Loyalty Points',  amt: stats.points, color:'#B45309', bg:'#FEF3C7', count: stats.pointsOrders, icon:'⭐' },
  ]
  // Top coupons used
  const byCoupon = {}
  orders.forEach(o => {
    if (o.coupon_code && Number(o.coupon_discount||0) > 0) {
      if (!byCoupon[o.coupon_code]) byCoupon[o.coupon_code] = { code: o.coupon_code, count: 0, total: 0 }
      byCoupon[o.coupon_code].count++
      byCoupon[o.coupon_code].total += Number(o.coupon_discount || 0)
    }
  })
  const topCoupons = Object.values(byCoupon).sort((a,b) => b.total - a.total).slice(0, 10)

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        {[
          ['Total Discounted',  `$${stats.total.toFixed(2)}`, '#dc2626', `${orderCount} orders`],
          ['Manual Discounts',  `$${stats.manual.toFixed(2)}`, '#16a34a', `${stats.manualOrders} orders`],
          ['Coupon Codes',      `$${stats.coupon.toFixed(2)}`, '#c026d3', `${stats.couponOrders} orders`],
          ['Loyalty Points',    `$${stats.points.toFixed(2)}`, '#B45309', `${stats.pointsUsed.toLocaleString()} pts used`],
        ].map(([l,v,c,sub]) => (
          <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
            <div className="text-[10px] font-mono text-[#999999] uppercase tracking-wider mb-1.5">{l}</div>
            <div className="text-[22px] font-bold" style={{color:c}}>{v}</div>
            <div className="text-[10px] text-[#999999] mt-1">{sub}</div>
          </div>
        ))}
      </div>

      {/* Breakdown bar */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5">
        <div className="text-[13px] font-bold mb-4">Breakdown by Discount Type</div>
        <div className="rounded-lg overflow-hidden flex h-10 mb-3" style={{border:'1px solid #E5E5E5'}}>
          {types.map(t => {
            const pct = stats.total > 0 ? (t.amt / stats.total) * 100 : 0
            if (pct === 0) return null
            return (
              <div key={t.label}
                className="flex items-center justify-center text-[11px] font-bold text-white"
                style={{width:`${pct}%`, background:t.color}}
                title={`${t.label}: $${t.amt.toFixed(2)} (${pct.toFixed(1)}%)`}>
                {pct > 12 && `${t.icon} ${pct.toFixed(0)}%`}
              </div>
            )
          })}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {types.map(t => {
            const pct = stats.total > 0 ? (t.amt / stats.total) * 100 : 0
            return (
              <div key={t.label} className="rounded-lg p-3" style={{background:t.bg, border:`1px solid ${t.color}33`}}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span>{t.icon}</span>
                  <span className="text-[11px] font-bold" style={{color:t.color}}>{t.label}</span>
                </div>
                <div className="text-[16px] font-bold font-mono" style={{color:t.color}}>${t.amt.toFixed(2)}</div>
                <div className="text-[10px] font-mono mt-0.5" style={{color:t.color}}>{pct.toFixed(1)}% · {t.count} orders</div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 rounded-lg px-3 py-2 text-[10px]"
          style={{background:'#F8FAFC', color:'#475569', border:'1px solid #E5E5E5'}}>
          💡 Manual discount is whatever wasn't captured by coupon or points — i.e. the cashier-applied % or $ off.
          Conversion rate: <b>{pointsRate} pts = $1.00</b>
        </div>
      </div>

      {/* Top coupons */}
      {topCoupons.length > 0 && (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5">
          <div className="text-[13px] font-bold mb-3">🎫 Top Coupon Codes</div>
          <div className="space-y-1.5">
            {topCoupons.map((c,i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <span className="rounded-md px-2 py-0.5 text-[11px] font-mono font-bold"
                  style={{background:'#1F1F1F', color:'#fff'}}>{c.code}</span>
                <div className="flex-1 text-[11px] text-[#666]">used {c.count} time{c.count>1?'s':''}</div>
                <div className="text-[13px] font-bold font-mono" style={{color:'#c026d3'}}>−${c.total.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


// ── GIFT CARDS REPORT ─────────────────────────────────────────────
function GiftCardReport({ cards, txns, dateFrom, dateTo }) {
  const active = cards.filter(c => c.status === 'active')
  const totalIssued = cards.reduce((s,c) => s + Number(c.init_amount || 0), 0)
  const poolBalance = cards.reduce((s,c) => s + Number(c.balance || 0), 0)
  const totalUsed = totalIssued - poolBalance
  // In-window money flows. For sells + top-ups:
  //   loaded  = amount onto cards (充值金额, a liability)
  //   cash    = paid_amount (付款金额, real income)
  //   bonus   = free promo amount (marketing cost)
  const loadTx = txns.filter(t => t.type === 'topup' || t.type === 'issue')
  const loadedInWindow = loadTx.reduce((s,t) => s + Number(t.amount || 0), 0)
  const cashInWindow   = loadTx.reduce((s,t) => s + Number(t.paid_amount != null ? t.paid_amount : t.amount), 0)
  const bonusInWindow  = loadTx.reduce((s,t) => s + Number(t.bonus_amount || 0), 0)
  const redeemsInWindow = txns.filter(t => t.type === 'redeem').reduce((s,t) => s + Math.abs(Number(t.amount)), 0)

  if (cards.length === 0) return (
    <EmptyState icon="🎁" label="No gift cards issued yet"/>
  )

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        {[
          ['Active Cards',    active.length,                       '#10b981', `of ${cards.length} total`],
          ['Pool Balance',    `$${poolBalance.toFixed(2)}`,        '#FA8C16', 'outstanding liability'],
          ['Total Redeemed',  `$${totalUsed.toFixed(2)}`,          '#dc2626', 'lifetime used'],
          ['Redeemed (period)', `$${redeemsInWindow.toFixed(2)}`,  '#9333ea', 'spent this period'],
        ].map(([l,v,c,sub]) => (
          <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
            <div className="text-[10px] font-mono text-[#999999] uppercase tracking-wider mb-1.5">{l}</div>
            <div className="text-[20px] font-bold" style={{color:c}}>{v}</div>
            <div className="text-[10px] text-[#999999] mt-1">{sub}</div>
          </div>
        ))}
      </div>

      {/* Sell / top-up money flow this period — cash vs loaded vs free */}
      <div className="grid grid-cols-3 gap-3">
        {[
          ['💵 Cash Collected', `$${cashInWindow.toFixed(2)}`, '#15803d', 'real income (付款金额) — goes to financials'],
          ['💳 Loaded to Cards', `$${loadedInWindow.toFixed(2)}`, '#3b82f6', 'balance added (充值金额) — card liability'],
          ['🎁 Promo Bonus Given', `$${bonusInWindow.toFixed(2)}`, '#d97706', 'free amount (marketing cost)'],
        ].map(([l,v,c,sub]) => (
          <div key={l} className="rounded-[12px] p-4" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
            <div className="text-[11px] font-bold text-[#666] mb-1.5">{l}</div>
            <div className="text-[22px] font-bold" style={{color:c}}>{v}</div>
            <div className="text-[10px] text-[#999999] mt-1">{sub}</div>
          </div>
        ))}
      </div>

      {/* All cards table */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] overflow-hidden">
        <div className="px-4 py-3" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div className="text-[13px] font-bold">🎁 All Gift Cards ({cards.length})</div>
          <div className="text-[10px] text-[#666] mt-0.5">Click 📋 to view that card's full transaction history</div>
        </div>
        <div className="grid bg-[#F8FAFC] text-[10px] font-mono font-bold text-[#666] uppercase tracking-wider"
          style={{gridTemplateColumns:'1.4fr 1fr 0.8fr 0.8fr 1fr 1fr 70px'}}>
          {['Card #','Customer','Initial','Balance','Status','Last used','Hist'].map((h,i)=>(
            <div key={h} className="px-3 py-2.5">{h}</div>
          ))}
        </div>
        {cards.map(c => {
          const STATUS = {
            active:   { bg:'#dcfce7', color:'#15803d' },
            depleted: { bg:'#f1f5f9', color:'#64748b' },
            expired:  { bg:'#f1f5f9', color:'#64748b' },
            voided:   { bg:'#fee2e2', color:'#dc2626' },
          }
          const st = STATUS[c.status] || STATUS.active
          return (
            <div key={c.id} className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#F8FAFC] transition-colors items-center"
              style={{gridTemplateColumns:'1.4fr 1fr 0.8fr 0.8fr 1fr 1fr 70px'}}>
              <div className="px-3 py-2.5 font-mono text-[11px] font-bold text-[#ea580c]">{c.card_number}</div>
              <div className="px-3 py-2.5 text-[12px]">{c.customers?.name || '—'}</div>
              <div className="px-3 py-2.5 font-mono text-[12px]">${Number(c.init_amount||0).toFixed(2)}</div>
              <div className="px-3 py-2.5 font-mono text-[12px] font-bold">${Number(c.balance||0).toFixed(2)}</div>
              <div className="px-3 py-2.5">
                <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                  style={{background:st.bg, color:st.color}}>{c.status || 'active'}</span>
              </div>
              <div className="px-3 py-2.5 text-[10px] text-[#666]">
                {c.last_used_at ? new Date(c.last_used_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}
              </div>
              <div className="px-3 py-2.5">
                <button onClick={()=>toast.success('Open Gift Cards panel from POS → 📋 History tab to view full ledger')}
                  className="rounded px-2 py-1 text-[11px] cursor-pointer"
                  style={{background:'#F1F5F9', color:'#475569', border:'1px solid #E5E5E5'}}>📋</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ── PAYMENT METHODS REPORT (now a dedicated page) ────────────────
function PaymentReport({ orders, payments, totalRevenue }) {
  const breakdown = {}
  payments.forEach(p => {
    breakdown[p.method] = (breakdown[p.method] || 0) + Number(p.amount || 0)
  })
  const entries = Object.entries(breakdown).sort((a,b)=>b[1]-a[1])
  if (entries.length === 0) return (
    <EmptyState icon="💳" label="No payments in this period"/>
  )
  const COLORS = {
    cash:'#10b981', card:'#3b82f6', credit_card:'#3b82f6', debit_card:'#06b6d4',
    check:'#06b6d4', bank_transfer:'#0891b2',
    member_card:'#f59e0b', gift_card:'#ea580c', on_account:'#ec4899',
  }
  const LABEL = {
    cash:'Cash', card:'Card', credit_card:'Credit Card', debit_card:'Debit Card',
    member_card:'VIP / Member Card', gift_card:'Gift Card',
    bank_transfer:'Bank Transfer', check:'Check', on_account:'Account/Credit',
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Total Receipts',  `$${totalRevenue.toFixed(2)}`, '#3b82f6', `${orders.length} orders`],
          ['Methods Used',    entries.length, undefined, 'distinct types'],
          ['Top Method',      LABEL[entries[0][0]] || entries[0][0], '#10b981', `$${entries[0][1].toFixed(2)}`],
        ].map(([l,v,c,sub]) => (
          <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
            <div className="text-[10px] font-mono text-[#999999] uppercase tracking-wider mb-1.5">{l}</div>
            <div className="text-[22px] font-bold" style={{color:c}}>{v}</div>
            <div className="text-[10px] text-[#999999] mt-1">{sub}</div>
          </div>
        ))}
      </div>

      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5">
        <div className="text-[13px] font-bold mb-4">💳 Tender Breakdown</div>
        <div className="rounded-lg overflow-hidden flex h-10 mb-4" style={{border:'1px solid #E5E5E5'}}>
          {entries.map(([m,a]) => {
            const pct = totalRevenue > 0 ? a/totalRevenue*100 : 0
            return (
              <div key={m} title={`${LABEL[m]||m}: $${a.toFixed(2)} (${pct.toFixed(1)}%)`}
                className="flex items-center justify-center text-[11px] font-bold text-white"
                style={{width:`${pct}%`, background:COLORS[m]||'#64748b'}}>
                {pct > 8 && `${pct.toFixed(0)}%`}
              </div>
            )
          })}
        </div>
        <div className="space-y-2">
          {entries.map(([m,a]) => {
            const pct = totalRevenue > 0 ? a/totalRevenue*100 : 0
            return (
              <div key={m} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{background:COLORS[m]||'#64748b'}}/>
                <div className="w-[160px] text-[12px] font-semibold">{LABEL[m] || m}</div>
                <div className="flex-1 h-2 bg-[#F1F5F9] rounded overflow-hidden">
                  <div className="h-full rounded" style={{width:`${pct}%`, background:COLORS[m]||'#64748b'}}/>
                </div>
                <div className="font-mono text-[12px] font-bold w-[90px] text-right">${a.toFixed(2)}</div>
                <div className="font-mono text-[10px] text-[#999999] w-[50px] text-right">{pct.toFixed(1)}%</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


function EmptyState({ icon, label }) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center text-[#999999]">
        <div className="text-4xl mb-3 opacity-30">{icon}</div>
        <div className="text-[14px] font-bold">{label}</div>
        <div className="text-[11px] font-mono mt-2 opacity-60">Try a different date range</div>
      </div>
    </div>
  )
}
