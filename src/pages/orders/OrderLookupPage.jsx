// src/pages/orders/OrderLookupPage.jsx
import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useHeldOrdersStore } from '@/stores/heldOrdersStore'
import { useCartStore } from '@/stores/cartStore'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import toast from 'react-hot-toast'

// ── Status ──
const STATUS = {
  completed:     { label:'Completed',      bg:'#dcfce7', color:'#16a34a' },
  held:          { label:'On Hold',        bg:'#fef9c3', color:'#ca8a04' },
  voided:        { label:'Voided',         bg:'#f1f5f9', color:'#64748b' },
  refunded:      { label:'Refunded',       bg:'#fdf4ff', color:'#9333ea' },
  partial_refund:{ label:'Part. Refunded', bg:'#eff6ff', color:'#2563eb' },
}
function getStatus(o) {
  if (o._source==='held')           return 'held'
  if (o.status==='voided')          return 'voided'
  if (o.refund_status==='full')     return 'refunded'
  if (o.refund_status==='partial')  return 'partial_refund'
  return 'completed'
}

// ── Payment method icons ──
const PAY_ICON = {
  cash:'💵', card:'💳', credit_card:'💳', debit_card:'💳',
  member_card:'🏷️', vip_card:'🏷️', gift_card:'🎁',
  bank_transfer:'🏦', check:'📝', other:'💰',
}
const PAY_LABEL = {
  cash:'Cash', card:'Card', credit_card:'Credit Card', debit_card:'Debit Card',
  member_card:'VIP Card', vip_card:'VIP Card', gift_card:'Gift Card',
  bank_transfer:'Transfer', check:'Check', other:'Other',
}

// ── Payment filter groups ──
const PAY_FILTERS = [
  { id:'all',         label:'All',          icon:'📋' },
  { id:'cash',        label:'Cash',         icon:'💵' },
  { id:'card',        label:'Card',         icon:'💳' },
  { id:'member_card', label:'VIP Card',     icon:'🏷️' },
  { id:'gift_card',   label:'Gift Card',    icon:'🎁' },
  { id:'other',       label:'Other',        icon:'💰' },
]

const STATUS_FILTERS = [
  { id:'all',          label:'All' },
  { id:'completed',    label:'Paid' },
  { id:'held',         label:'Hold' },
  { id:'refunded',     label:'Refund' },
  { id:'partial_refund',label:'Part. Refund' },
  { id:'voided',       label:'Void' },
]

export default function OrderLookupPage() {
  const { tenant, user } = useAuthStore()
  const { resumeHeldOrder, cancelHeldOrder } = useHeldOrdersStore()

  const [search,     setSearch]     = useState('')
  const [statusF,    setStatusF]    = useState('all')
  const [payF,       setPayF]       = useState('all')
  const [dateMode,   setDateMode]   = useState('today') // today|3days|week|month|custom
  const [dateFrom,   setDateFrom]   = useState(format(new Date(),'yyyy-MM-dd'))
  const [dateTo,     setDateTo]     = useState(format(new Date(),'yyyy-MM-dd'))
  const [selected,   setSelected]   = useState(null)

  // Compute date range
  const range = (() => {
    const now = new Date()
    if (dateMode === 'today')  return [startOfDay(now), endOfDay(now)]
    if (dateMode === '3days')  return [startOfDay(subDays(now,3)), endOfDay(now)]
    if (dateMode === 'week')   return [startOfDay(subDays(now,7)), endOfDay(now)]
    if (dateMode === 'month')  return [startOfDay(subDays(now,30)), endOfDay(now)]
    if (dateMode === 'custom') return [startOfDay(new Date(dateFrom)), endOfDay(new Date(dateTo))]
    return [null, null]
  })()

  // ── Orders query ──
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders-lookup', tenant?.id, search, statusF, payF, dateMode, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase.from('orders')
        .select(`*, customers(name,phone), users(name), terminals(name),
          order_items(product_name,quantity,unit,unit_price,line_total),
          order_payments(method,amount)`)
        .eq('tenant_id', tenant.id)
      if (search) q = q.or(`order_number.ilike.%${search}%`)
      if (range[0]) q = q.gte('created_at', range[0].toISOString())
      if (range[1]) q = q.lte('created_at', range[1].toISOString())
      const { data } = await q.order('created_at',{ascending:false}).limit(200)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // ── Held orders ──
  const { data: heldRaw = [] } = useQuery({
    queryKey: ['held-lookup', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('held_orders')
        .select('*').eq('tenant_id', tenant.id).eq('status','held')
        .order('held_at',{ascending:false})
      return (data||[]).map(o=>({...o, _source:'held', created_at: o.held_at}))
    },
    enabled: !!tenant?.id,
  })

  // ── Filter ──
  const allOrders = [
    ...(statusF === 'all' || statusF === 'held' ? heldRaw : []),
    ...orders,
  ].sort((a,b) => new Date(b.created_at)-new Date(a.created_at))

  const filtered = allOrders.filter(o => {
    const st = getStatus(o)
    if (statusF !== 'all' && st !== statusF) return false
    if (payF !== 'all') {
      const methods = (o.order_payments||[]).map(p=>p.method)
      const match = payF==='card'
        ? methods.some(m=>['card','credit_card','debit_card'].includes(m))
        : methods.includes(payF)
      if (!match) return false
    }
    if (search && !o.order_number?.toLowerCase().includes(search.toLowerCase()) &&
        !o.customers?.name?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // ── Stats ──
  const totalAmt  = filtered.reduce((s,o) => s + (o.grand_total||o.total||0), 0)
  const paidCount = filtered.filter(o => getStatus(o)==='completed').length

  const handleResume = async (o) => {
    const cartItems = useCartStore.getState().items
    if (cartItems.length > 0 && !window.confirm('Clear cart and resume this order?')) return
    if (cartItems.length > 0) useCartStore.getState().clearCart()
    const ok = await resumeHeldOrder({ heldOrderId: o.id, tenantId: tenant.id, userId: user?.id })
    if (ok) { toast.success('Order resumed'); setSelected(null) }
  }

  const handleVoid = async (o) => {
    if (!window.confirm('Void this order?')) return
    await supabase.from('orders').update({ status:'voided' }).eq('id', o.id)
    toast.success('Order voided')
    setSelected(s => s?.id===o.id ? {...s, status:'voided'} : s)
  }

  return (
    <div className="flex h-full" style={{background:'#f0f2f5'}}>

      {/* ── Left: Filters + List ── */}
      <div className="flex flex-col flex-shrink-0"
        style={{width:'460px', transition:'width 0.2s', background:'#fff', borderRight:'1px solid #e2e8f0', flexShrink:0}}>

        {/* Top filters bar */}
        <div className="flex-shrink-0 px-4 pt-4 pb-3" style={{borderBottom:'1px solid #f1f5f9'}}>

          {/* Row 1: Search + Stats */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 flex items-center gap-2 rounded-xl px-3"
              style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}>
              <span className="text-slate-400">🔍</span>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Order # or customer..."
                className="flex-1 border-none outline-none py-2.5 text-[13px] bg-transparent"/>
              {search && <button onClick={()=>setSearch('')} className="text-slate-400 bg-transparent border-none cursor-pointer">✕</button>}
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-[11px] text-slate-400">{filtered.length} orders</div>
              <div className="text-[14px] font-black" style={{color:'#6366f1'}}>${totalAmt.toFixed(2)}</div>
            </div>
          </div>

          {/* Row 2: Date presets */}
          <div className="flex gap-1.5 mb-3">
            {[['today','Today'],['3days','3 Days'],['week','Week'],['month','Month'],['custom','Custom']].map(([id,label])=>(
              <button key={id} onClick={()=>setDateMode(id)}
                className="flex-1 py-2 rounded-xl text-[11px] font-semibold cursor-pointer border transition-all"
                style={dateMode===id
                  ? {background:'#6366f1',borderColor:'#6366f1',color:'#fff'}
                  : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                {label}
              </button>
            ))}
          </div>

          {/* Custom date picker */}
          {dateMode === 'custom' && (
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">From</div>
                <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
              </div>
              <div className="flex-1">
                <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">To</div>
                <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
              </div>
            </div>
          )}

          {/* Row 3: Status filter */}
          <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1" style={{scrollbarWidth:'none'}}>
            {STATUS_FILTERS.map(f => {
              const count = f.id==='all' ? filtered.length
                : allOrders.filter(o=>getStatus(o)===f.id).length
              return (
                <button key={f.id} onClick={()=>setStatusF(f.id)}
                  className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer border transition-all"
                  style={statusF===f.id
                    ? {background:'#1e293b',borderColor:'#1e293b',color:'#fff'}
                    : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                  {f.label}
                  <span className="text-[9px] px-1 py-0.5 rounded-full"
                    style={{background: statusF===f.id ? 'rgba(255,255,255,0.2)' : '#e2e8f0'}}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Row 4: Payment type filter */}
          <div className="flex gap-1.5 overflow-x-auto pb-1" style={{scrollbarWidth:'none'}}>
            {PAY_FILTERS.map(f => (
              <button key={f.id} onClick={()=>setPayF(f.id)}
                className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer border transition-all"
                style={payF===f.id
                  ? {background:'#6366f1',borderColor:'#6366f1',color:'#fff'}
                  : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                {f.icon} {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Order list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400 text-[13px]">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-slate-300">
              <div className="text-[48px] mb-3">📋</div>
              <div className="text-[14px]">No orders found</div>
            </div>
          ) : filtered.map(o => {
            const st = getStatus(o)
            const ss = STATUS[st] || STATUS.completed
            const isHeld = o._source === 'held'
            const isSelected = selected?.id === o.id
            const payMethods = o.order_payments || []

            return (
              <div key={o.id} onClick={()=>setSelected(o)}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer border-b transition-all"
                style={{
                  borderColor:'#f8fafc',
                  background: isSelected ? '#f0f4ff' : '#fff',
                  borderLeft: isSelected ? '3px solid #6366f1' : '3px solid transparent',
                }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {isHeld ? (
                      <span className="text-[13px] font-bold text-amber-600">
                        📌 {o.label || 'Held Order'}
                      </span>
                    ) : (
                      <span className="text-[13px] font-bold font-mono" style={{color:'#6366f1'}}>
                        {o.order_number}
                      </span>
                    )}
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={ss}>
                      {ss.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">
                      {format(new Date(o.created_at),'MMM d, h:mma')}
                    </span>
                    {o.customers?.name && (
                      <span className="text-[11px] text-slate-500">· {o.customers.name}</span>
                    )}
                  </div>
                  {payMethods.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {payMethods.map((p,i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{background:'#f1f5f9', color:'#475569'}}>
                          {PAY_ICON[p.method]||'💰'} ${parseFloat(p.amount).toFixed(0)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                  <div className="text-[15px] font-black font-mono" style={{color:'#1e293b'}}>
                    ${parseFloat(o.grand_total||o.total||0).toFixed(2)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">
                      {(o.order_items||o.cart_snapshot?.items||[]).length} items
                    </span>
                    <span className="text-[14px]" style={{color: selected?.id===o.id ? '#6366f1' : '#cbd5e1'}}>👁️</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right: Order Detail ── */}
      {true && (
        <div className="flex-1 flex flex-col overflow-hidden">

          {!selected && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
              <div className="text-[64px] mb-4">👁️</div>
              <div className="text-[16px] font-semibold text-slate-400">Select an order</div>
              <div className="text-[12px] mt-1 text-slate-300">Click any order to preview details</div>
            </div>
          )}
          {selected && <>
          {/* Detail header */}
          <div className="px-6 py-4 flex-shrink-0 flex items-start justify-between"
            style={{background:'#fff', borderBottom:'1px solid #e2e8f0'}}>
            <div>
              {selected._source === 'held' ? (
                <>
                  <div className="text-[18px] font-black text-amber-600">📌 {selected.label || 'Held Order'}</div>
                  <div className="text-[12px] text-slate-400 mt-0.5">
                    Held {format(new Date(selected.created_at),'MMM d, h:mm a')} · by {selected.held_by_name}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="text-[20px] font-black font-mono" style={{color:'#6366f1'}}>{selected.order_number}</div>
                    {(() => { const ss=STATUS[getStatus(selected)]; return ss ? (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={ss}>{ss.label}</span>
                    ) : null })()}
                  </div>
                  <div className="text-[12px] text-slate-400 mt-0.5">
                    {format(new Date(selected.created_at),'MMM d, yyyy h:mm a')}
                    {selected.customers?.name && <span className="ml-2">· 👤 {selected.customers.name}</span>}
                    {selected.users?.name && <span className="ml-2">· Staff: {selected.users.name}</span>}
                  </div>
                </>
              )}
            </div>
            <button onClick={()=>setSelected(null)}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 border-none cursor-pointer text-slate-500 text-[16px]">
              ✕
            </button>
          </div>

          {/* Detail body */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-4 max-w-3xl">

              {/* Items */}
              <div className="col-span-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Items</div>
                <div className="rounded-2xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                  <div className="grid px-4 py-2 text-[10px] font-bold text-slate-400 uppercase"
                    style={{gridTemplateColumns:'1fr 60px 80px 80px', background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
                    <div>Item</div><div className="text-right">Qty</div><div className="text-right">Price</div><div className="text-right">Total</div>
                  </div>
                  {(selected._source==='held'
                    ? selected.cart_snapshot?.items||[]
                    : selected.order_items||[]
                  ).map((item,i,arr) => {
                    const name  = selected._source==='held' ? item.name : (item.product_name||'Item')
                    const qty   = selected._source==='held' ? item.qty  : item.quantity
                    const price = selected._source==='held' ? item.unitPrice : item.unit_price
                    const total = selected._source==='held' ? item.unitPrice*item.qty : item.line_total
                    return (
                      <div key={i} className="grid px-4 py-3 items-center"
                        style={{gridTemplateColumns:'1fr 60px 80px 80px',
                          borderBottom: i<arr.length-1?'1px solid #f8fafc':'none',
                          background:'#fff'}}>
                        <div className="text-[13px] font-semibold text-slate-700">{name}</div>
                        <div className="text-[12px] text-slate-400 font-mono text-right">×{qty}</div>
                        <div className="text-[12px] font-mono text-right">${parseFloat(price||0).toFixed(2)}</div>
                        <div className="text-[13px] font-bold font-mono text-right">${parseFloat(total||0).toFixed(2)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Totals */}
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Summary</div>
                <div className="rounded-2xl p-4 flex flex-col gap-2" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                  {[
                    ['Subtotal', selected.subtotal],
                    ['Tax', selected.tax_amount],
                    ['Discount', selected.discount_amount ? -selected.discount_amount : null],
                    ['Tip', selected.tip_amount],
                  ].filter(([,v]) => v).map(([l,v]) => (
                    <div key={l} className="flex justify-between text-[12px]">
                      <span className="text-slate-500">{l}</span>
                      <span className="font-mono">${parseFloat(v).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-[16px] font-black pt-2"
                    style={{borderTop:'2px solid #f1f5f9'}}>
                    <span>Total</span>
                    <span className="font-mono" style={{color:'#6366f1'}}>
                      ${parseFloat(selected.grand_total||selected.total||0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment methods */}
              {(selected.order_payments||[]).length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Payment</div>
                  <div className="rounded-2xl p-4 flex flex-col gap-2" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                    {selected.order_payments.map((p,i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[16px]">{PAY_ICON[p.method]||'💰'}</span>
                          <span className="text-[13px] font-semibold text-slate-700">
                            {PAY_LABEL[p.method]||p.method}
                          </span>
                        </div>
                        <span className="text-[14px] font-bold font-mono" style={{color:'#16a34a'}}>
                          ${parseFloat(p.amount).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 py-4 flex gap-3 flex-shrink-0"
            style={{borderTop:'1px solid #e2e8f0', background:'#fff'}}>
            {selected._source === 'held' ? (
              <>
                <button onClick={() => handleResume(selected)}
                  className="flex-1 rounded-2xl py-3.5 text-[14px] font-bold text-white cursor-pointer border-none"
                  style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
                  ↩ Resume Order
                </button>
                <button onClick={async () => {
                  if (!window.confirm('Cancel this held order?')) return
                  await cancelHeldOrder({ heldOrderId: selected.id, tenantId: tenant.id })
                  setSelected(null); toast.success('Cancelled')
                }}
                  className="rounded-2xl px-5 py-3.5 text-[13px] font-bold cursor-pointer border"
                  style={{background:'#fff1f2', borderColor:'#fecdd3', color:'#e11d48'}}>
                  🗑 Cancel
                </button>
              </>
            ) : (
              <>
                {getStatus(selected) === 'completed' && (
                  <button onClick={() => handleVoid(selected)}
                    className="rounded-2xl px-5 py-3.5 text-[13px] font-bold cursor-pointer border"
                    style={{background:'#fff1f2', borderColor:'#fecdd3', color:'#e11d48'}}>
                    🚫 Void
                  </button>
                )}
                <div className="flex-1 flex items-center justify-center text-[12px] text-slate-400">
                  {format(new Date(selected.created_at),'EEEE, MMMM d yyyy · h:mm a')}
                </div>
              </>
            )}
          </div>
          </>}
        </div>
      )}
    </div>
  )
}
