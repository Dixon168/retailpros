// src/pages/pos-dashboard/POSDashboardPage.jsx
// POS Dashboard — financial overview with three tabs:
//   Summary  — total/net sales, payment-method breakdown, tax, refunds
//   Employee — per-employee revenue, commission, tips
//   Sales    — product-level sales (name/SKU/UPC/qty/total/tax/profit)
// All filterable by date range, terminal, and employee. Multi-language.

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { startOfDay, endOfDay, subDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useLang } from '@/lib/i18n'

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`

export default function POSDashboardPage() {
  const { tenant, store } = useAuthStore()
  const { t } = useLang()
  const [tab, setTab]           = useState('summary')   // summary | employee | sales
  const [range, setRange]       = useState('today')
  const [terminalId, setTerminalId] = useState('all')
  const [employeeId, setEmployeeId] = useState('all')

  const window = useMemo(() => {
    const now = new Date()
    if (range === 'today') return { start: startOfDay(now), end: endOfDay(now) }
    if (range === 'week')  return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) }
    return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) }
  }, [range])

  // ── Terminals + employees for the filter dropdowns ──
  const { data: terminals = [] } = useQuery({
    queryKey: ['dash-terminals', tenant?.id, store?.id],
    queryFn: async () => {
      const { data } = await supabase.from('terminals')
        .select('id, name').eq('tenant_id', tenant.id).eq('store_id', store.id).order('name')
      return data || []
    },
    enabled: !!tenant?.id && !!store?.id,
  })

  const { data: employees = [] } = useQuery({
    queryKey: ['dash-employees', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, name').eq('tenant_id', tenant.id).order('name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // ── Orders in range (with payments + items) ──
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['dash-orders', tenant?.id, store?.id, range],
    queryFn: async () => {
      const { data } = await supabase.from('orders')
        .select(`
          id, order_number, total, subtotal, tax_amount, discount_amount,
          refunded_amount, refund_status, status, cashier_id, cashier_name,
          terminal_id, terminal_name, created_at,
          payments:order_payments(method, amount),
          items:order_items(product_id, product_name, product_sku, quantity,
                            unit_price, line_total, discount_pct)
        `)
        .eq('tenant_id', tenant.id)
        .eq('store_id', store.id)
        .gte('created_at', window.start.toISOString())
        .lte('created_at', window.end.toISOString())
        .order('created_at', { ascending: false })
        .limit(3000)
      return data || []
    },
    enabled: !!tenant?.id && !!store?.id,
  })

  // ── Product costs + commission (for profit + commission) ──
  const { data: productMeta = {} } = useQuery({
    queryKey: ['dash-product-meta', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('products')
        .select('id, cost, upc, commission_type, commission_value').eq('tenant_id', tenant.id).limit(5000)
      const map = {}
      ;(data || []).forEach(p => { map[p.id] = {
        cost: Number(p.cost) || 0, upc: p.upc,
        commission_type: p.commission_type || 'none',
        commission_value: Number(p.commission_value) || 0,
      } })
      return map
    },
    enabled: !!tenant?.id,
  })

  // ── Gift + member card balances ──
  const { data: cardSummary = { gift:{count:0,balance:0}, member:{count:0,balance:0} } } = useQuery({
    queryKey: ['dash-cards', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('member_cards')
        .select('card_type, balance, is_active').eq('tenant_id', tenant.id)
      const sum = { gift:{count:0,balance:0}, member:{count:0,balance:0} }
      ;(data || []).forEach(c => {
        const bucket = c.card_type === 'gift' ? sum.gift : sum.member
        bucket.count += 1
        bucket.balance += Number(c.balance) || 0
      })
      return sum
    },
    enabled: !!tenant?.id,
  })

  // ── Apply terminal + employee filters client-side ──
  const filtered = useMemo(() => orders.filter(o => {
    if (terminalId !== 'all' && o.terminal_id !== terminalId) return false
    if (employeeId !== 'all' && o.cashier_id !== employeeId) return false
    return true
  }), [orders, terminalId, employeeId])

  const completed = useMemo(
    () => filtered.filter(o => o.status === 'completed' || o.status === 'partially_refunded'),
    [filtered]
  )

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      {/* Header + filters */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-[22px] font-bold" style={{color:'#1F1F1F'}}>📊 {t('dashboard')}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Terminal filter */}
          <select value={terminalId} onChange={e => setTerminalId(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer outline-none"
            style={{border:'1.5px solid #e5e5e5', background: terminalId!=='all'?'#E6F0FF':'#fff', color: terminalId!=='all'?'#006AFF':'#666'}}>
            <option value="all">🖥️ {t('allTerminals')}</option>
            {terminals.map(tm => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>
          {/* Employee filter */}
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer outline-none"
            style={{border:'1.5px solid #e5e5e5', background: employeeId!=='all'?'#E6F0FF':'#fff', color: employeeId!=='all'?'#006AFF':'#666'}}>
            <option value="all">👥 {t('allEmployees')}</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {/* Date range */}
          <div className="flex gap-1">
            {[['today',t('today')],['week',t('thisWeek')],['month',t('thisMonth')]].map(([k,label]) => (
              <button key={k} onClick={() => setRange(k)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer border-2"
                style={range===k ? {background:'#006AFF',color:'#fff',borderColor:'#006AFF'} : {background:'#fff',color:'#666',borderColor:'#e5e5e5'}}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-[#E5E5E5]">
        {[['summary',`📈 ${t('dashSummary')}`],['employee',`👥 ${t('dashEmployee')}`],['sales',`🛍️ ${t('dashSales')}`]].map(([k,label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="px-4 py-2.5 text-[13px] font-bold cursor-pointer border-none bg-transparent"
            style={{color: tab===k?'#006AFF':'#888', borderBottom: tab===k?'2px solid #006AFF':'2px solid transparent', marginBottom:'-1px'}}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-[13px] text-[#999]">Loading...</div>
      ) : tab === 'summary' ? (
        <SummaryTab completed={completed} filtered={filtered} cardSummary={cardSummary} t={t}/>
      ) : tab === 'employee' ? (
        <EmployeeTab completed={completed} employees={employees} productMeta={productMeta} t={t}/>
      ) : (
        <SalesTab completed={completed} productCosts={productMeta} t={t}/>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SUMMARY TAB
// ════════════════════════════════════════════════════════════════════
function SummaryTab({ completed, filtered, cardSummary, t }) {
  const m = useMemo(() => {
    let totalSales = 0, netSales = 0, tax = 0, refunds = 0, subtotal = 0, discount = 0
    const byMethod = {}  // method -> { count, amount }
    for (const o of completed) {
      totalSales += Number(o.total) || 0
      subtotal   += Number(o.subtotal) || 0
      tax        += Number(o.tax_amount) || 0
      discount   += Number(o.discount_amount) || 0
      refunds    += Number(o.refunded_amount) || 0
      for (const p of (o.payments || [])) {
        const key = ['credit_card','debit_card'].includes(p.method) ? 'card' : p.method
        if (!byMethod[key]) byMethod[key] = { count: 0, amount: 0 }
        byMethod[key].count += 1
        byMethod[key].amount += Number(p.amount) || 0
      }
    }
    netSales = subtotal - discount
    const collected = Object.values(byMethod).reduce((s,v) => s + v.amount, 0)
    return { totalSales, netSales, tax, refunds, subtotal, discount, byMethod, collected, orderCount: completed.length }
  }, [completed])

  const methodLabel = {
    cash: t('cash'), card: t('card'), gift_card: t('giftCard'),
    member_card: t('memberCard'), vip_card: t('memberCard'), on_account: t('other'),
    transfer: t('other'), check: t('other'), other: t('other'),
  }

  return (
    <div>
      {/* Top KPIs */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <Kpi label={t('totalCollected')} value={money(m.collected)} accent="#006AFF"/>
        <Kpi label={t('totalSales')} value={money(m.totalSales)} accent="#16a34a"/>
        <Kpi label={t('taxCollected')} value={money(m.tax)} accent="#0891b2"/>
        <Kpi label={t('refunds')} value={money(m.refunds)} accent="#dc2626"/>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-5">
        <Kpi label={t('netSales')} value={money(m.netSales)} small/>
        <Kpi label={t('ordersCount')} value={m.orderCount} small/>
        <Kpi label={t('discount')} value={money(m.discount)} small/>
        <Kpi label={t('netSales')+' / '+t('ordersCount')} value={money(m.orderCount?m.totalSales/m.orderCount:0)} small/>
      </div>

      {/* Payment method breakdown */}
      <div className="rounded-2xl p-4 mb-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
        <div className="text-[14px] font-bold mb-3" style={{color:'#1F1F1F'}}>💳 {t('paymentMethods')}</div>
        <div className="grid border-b border-[#eee] pb-2 mb-1" style={{gridTemplateColumns:'2fr 1fr 1.3fr 1fr'}}>
          {[t('paymentMethods'),t('qty'),t('amount'),t('share')].map((h,i) => (
            <div key={i} className="text-[10px] font-bold text-[#999] uppercase" style={{textAlign: i===0?'left':'right'}}>{h}</div>
          ))}
        </div>
        {Object.keys(m.byMethod).length === 0 ? (
          <div className="text-center py-4 text-[12px] text-[#999]">{t('noData')}</div>
        ) : Object.entries(m.byMethod).sort((a,b)=>b[1].amount-a[1].amount).map(([method, v]) => (
          <div key={method} className="grid py-2 border-b border-[#f5f5f5] last:border-0 items-center" style={{gridTemplateColumns:'2fr 1fr 1.3fr 1fr'}}>
            <div className="text-[13px] font-bold text-[#1F1F1F]">{methodLabel[method] || method}</div>
            <div className="text-[13px] font-mono text-[#666] text-right">{v.count}</div>
            <div className="text-[13px] font-mono font-bold text-[#1F1F1F] text-right">{money(v.amount)}</div>
            <div className="text-[12px] font-mono text-[#888] text-right">{m.collected>0?((v.amount/m.collected)*100).toFixed(0):0}%</div>
          </div>
        ))}
      </div>

      {/* Gift + member card balances */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[13px] font-bold mb-2" style={{color:'#1F1F1F'}}>🎁 {t('giftCard')}</div>
          <div className="text-[22px] font-bold font-mono" style={{color:'#a855f7'}}>{money(cardSummary.gift.balance)}</div>
          <div className="text-[11px] text-[#888] mt-1">{cardSummary.gift.count} {t('giftCard').toLowerCase()}</div>
        </div>
        <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
          <div className="text-[13px] font-bold mb-2" style={{color:'#1F1F1F'}}>⭐ {t('memberCard')}</div>
          <div className="text-[22px] font-bold font-mono" style={{color:'#0891b2'}}>{money(cardSummary.member.balance)}</div>
          <div className="text-[11px] text-[#888] mt-1">{cardSummary.member.count} {t('memberCard').toLowerCase()}</div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// EMPLOYEE TAB
// ════════════════════════════════════════════════════════════════════
function EmployeeTab({ completed, employees, productMeta, t }) {
  const rows = useMemo(() => {
    const byEmp = {}  // cashier_id -> { name, revenue, orders, commission }
    for (const o of completed) {
      const id = o.cashier_id || 'unknown'
      if (!byEmp[id]) byEmp[id] = { id, name: o.cashier_name || 'Unknown', revenue: 0, orders: 0, commission: 0 }
      byEmp[id].revenue += Number(o.total) || 0
      byEmp[id].orders  += 1
      // Commission from each line item's product setting
      for (const it of (o.items || [])) {
        const meta = productMeta[it.product_id]
        if (!meta || meta.commission_type === 'none') continue
        const qty = Number(it.quantity) || 0
        const lineTotal = Number(it.line_total) || 0
        let comm = 0
        if (meta.commission_type === 'fixed')    comm = meta.commission_value * qty
        else if (meta.commission_type === 'pct_sell') comm = lineTotal * (meta.commission_value / 100)
        else if (meta.commission_type === 'pct_cost') comm = (meta.cost * qty) * (meta.commission_value / 100)
        byEmp[id].commission += comm
      }
    }
    Object.values(byEmp).forEach(r => {
      if (r.name === 'Unknown') {
        const e = employees.find(e => e.id === r.id)
        if (e) r.name = e.name
      }
    })
    return Object.values(byEmp).sort((a,b) => b.revenue - a.revenue)
  }, [completed, employees, productMeta])

  return (
    <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="text-[14px] font-bold mb-3" style={{color:'#1F1F1F'}}>👥 {t('employeeSales')}</div>
      <div className="grid border-b border-[#eee] pb-2 mb-1" style={{gridTemplateColumns:'2fr 1fr 1.3fr 1.3fr'}}>
        {[t('dashEmployee'),t('ordersCount'),t('revenue'),t('commission')].map((h,i) => (
          <div key={i} className="text-[10px] font-bold text-[#999] uppercase" style={{textAlign:i===0?'left':'right'}}>{h}</div>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="text-center py-6 text-[12px] text-[#999]">{t('noData')}</div>
      ) : rows.map(r => (
        <div key={r.id} className="grid py-2.5 border-b border-[#f5f5f5] last:border-0 items-center" style={{gridTemplateColumns:'2fr 1fr 1.3fr 1.3fr'}}>
          <div className="text-[13px] font-bold text-[#1F1F1F]">{r.name}</div>
          <div className="text-[13px] font-mono text-[#666] text-right">{r.orders}</div>
          <div className="text-[13px] font-mono font-bold text-[#16a34a] text-right">{money(r.revenue)}</div>
          <div className="text-[13px] font-mono font-bold text-[#a855f7] text-right">{money(r.commission)}</div>
        </div>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SALES TAB
// ════════════════════════════════════════════════════════════════════
function SalesTab({ completed, productCosts, t }) {
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const byProd = {}  // product_id -> { name, sku, upc, qty, revenue, cost }
    for (const o of completed) {
      for (const it of (o.items || [])) {
        if (!it.product_id || Number(it.quantity) < 0) continue
        const id = it.product_id
        if (!byProd[id]) byProd[id] = {
          id, name: it.product_name, sku: it.product_sku || '',
          upc: productCosts[id]?.upc || '', qty: 0, revenue: 0, cost: 0,
        }
        const q = Number(it.quantity) || 0
        byProd[id].qty += q
        byProd[id].revenue += Number(it.line_total) || 0
        byProd[id].cost += q * (productCosts[id]?.cost || 0)
      }
    }
    let list = Object.values(byProd)
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      list = list.filter(p => p.name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s) || p.upc?.toLowerCase().includes(s))
    }
    return list.sort((a,b) => b.revenue - a.revenue)
  }, [completed, productCosts, search])

  const totals = useMemo(() => ({
    revenue: rows.reduce((s,r) => s + r.revenue, 0),
    profit:  rows.reduce((s,r) => s + (r.revenue - r.cost), 0),
    qty:     rows.reduce((s,r) => s + r.qty, 0),
  }), [rows])

  return (
    <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="text-[14px] font-bold" style={{color:'#1F1F1F'}}>🛍️ {t('dashSales')}</div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={`🔍 ${t('searchProduct')}`}
          className="rounded-lg px-3 py-1.5 text-[12px] outline-none" style={{border:'1.5px solid #e5e5e5', width:'200px'}}/>
      </div>
      <div className="grid border-b border-[#eee] pb-2 mb-1" style={{gridTemplateColumns:'2.2fr 1fr 1fr 0.7fr 1.1fr 1.1fr'}}>
        {[t('product'),'SKU','UPC',t('qty'),t('revenue'),t('profit')].map((h,i) => (
          <div key={i} className="text-[10px] font-bold text-[#999] uppercase" style={{textAlign:i>=3?'right':'left'}}>{h}</div>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="text-center py-6 text-[12px] text-[#999]">{t('noData')}</div>
      ) : (
        <div style={{maxHeight:'440px', overflowY:'auto'}}>
          {rows.map(r => {
            const profit = r.revenue - r.cost
            return (
              <div key={r.id} className="grid py-2 border-b border-[#f5f5f5] last:border-0 items-center" style={{gridTemplateColumns:'2.2fr 1fr 1fr 0.7fr 1.1fr 1.1fr'}}>
                <div className="text-[13px] font-bold text-[#1F1F1F] truncate pr-2">{r.name}</div>
                <div className="text-[11px] font-mono text-[#999] truncate">{r.sku || '—'}</div>
                <div className="text-[11px] font-mono text-[#999] truncate">{r.upc || '—'}</div>
                <div className="text-[12px] font-mono text-[#666] text-right">{r.qty}</div>
                <div className="text-[12px] font-mono font-bold text-[#1F1F1F] text-right">{money(r.revenue)}</div>
                <div className="text-[12px] font-mono text-right" style={{color: profit>=0?'#16a34a':'#dc2626'}}>{money(profit)}</div>
              </div>
            )
          })}
        </div>
      )}
      {/* Totals */}
      <div className="grid pt-3 mt-1 border-t-2 border-[#1F1F1F] items-center" style={{gridTemplateColumns:'2.2fr 1fr 1fr 0.7fr 1.1fr 1.1fr'}}>
        <div className="text-[12px] font-bold uppercase text-[#666]">Total</div>
        <div></div><div></div>
        <div className="text-[12px] font-mono font-bold text-right">{totals.qty}</div>
        <div className="text-[13px] font-mono font-bold text-right">{money(totals.revenue)}</div>
        <div className="text-[13px] font-mono font-bold text-right" style={{color:'#16a34a'}}>{money(totals.profit)}</div>
      </div>
    </div>
  )
}

function Kpi({ label, value, accent='#006AFF', small=false }) {
  return (
    <div className="rounded-2xl p-4" style={{background:'#fff', border:'1px solid #e5e5e5'}}>
      <div className="text-[11px] text-[#888] font-bold uppercase tracking-wider mb-1">{label}</div>
      <div className={`${small?'text-[18px]':'text-[24px]'} font-bold font-mono`} style={{color:accent}}>{value}</div>
    </div>
  )
}
