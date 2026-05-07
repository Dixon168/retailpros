// src/components/pos/RecallPanel.jsx
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useCartStore } from '@/stores/cartStore'
import { useHeldOrdersStore } from '@/stores/heldOrdersStore'
import toast from 'react-hot-toast'

const STATUS_STYLE = {
  completed:      { bg:'#dcfce7', color:'#16a34a', label:'Completed' },
  held:           { bg:'#fef9c3', color:'#ca8a04', label:'On Hold' },
  voided:         { bg:'#f1f5f9', color:'#64748b', label:'Voided' },
  refunded:       { bg:'#fdf4ff', color:'#9333ea', label:'Refunded' },
  partial_refund: { bg:'#eff6ff', color:'#2563eb', label:'Part. Refunded' },
}

function getStatus(order) {
  if (order.status === 'voided') return 'voided'
  if (order.status === 'held')   return 'held'
  if (order.refund_status === 'full')    return 'refunded'
  if (order.refund_status === 'partial') return 'partial_refund'
  return 'completed'
}

export function RecallPanel({ onClose }) {
  const { user, tenant, terminal } = useAuthStore()
  const cartItems = useCartStore(s => s.items)
  const qc = useQueryClient()

  const [filter, setFilter]       = useState('held') // held | today | all
  const [search, setSearch]       = useState('')
  const [selected, setSelected]   = useState(null)

  // Held orders from store
  const { heldOrders, loading: heldLoading, load, resumeHeldOrder, cancelHeldOrder } = useHeldOrdersStore()

  useEffect(() => {
    if (tenant?.id) load(tenant.id)
  }, [tenant?.id])

  // Recent orders from DB
  const { data: dbOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['recall-orders', tenant?.id, filter],
    queryFn: async () => {
      if (filter === 'held') return []
      let q = supabase.from('orders')
        .select('id,order_number,grand_total,created_at,status,refund_status,order_items(id,product_id,quantity,unit_price,products(name,unit)),customers(name,phone)')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (filter === 'today') {
        const today = new Date().toISOString().split('T')[0]
        q = q.gte('created_at', today)
      }
      const { data } = await q
      return data || []
    },
    enabled: !!tenant?.id && filter !== 'held',
  })

  const allOrders = filter === 'held' ? [] : dbOrders
  const filtered  = search
    ? allOrders.filter(o =>
        o.order_number?.toLowerCase().includes(search.toLowerCase()) ||
        o.customers?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : allOrders

  const handleResume = async (heldOrder) => {
    if (cartItems.length > 0) {
      if (!window.confirm('Current cart has items. Clear and resume this order?')) return
      useCartStore.getState().clearCart()
    }
    const ok = await resumeHeldOrder({
      heldOrderId: heldOrder.id,
      tenantId: tenant?.id,
      terminalId: terminal?.id,
      userId: user?.id,
    })
    if (ok) { qc.invalidateQueries(['orders']); onClose() }
  }

  const handleCancelHeld = async (order) => {
    if (!window.confirm('Cancel this held order?')) return
    await cancelHeldOrder({ heldOrderId: order.id, tenantId: tenant?.id, userId: user?.id })
    toast.success('Held order cancelled')
  }

  const FILTERS = [
    { id:'held',  label:'📌 Held',  count: heldOrders.length },
    { id:'today', label:'📅 Today', count: null },
    { id:'all',   label:'📋 All',   count: null },
  ]

  return (
    <div className="fixed inset-0 z-50 flex"
      style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}
      onClick={e => e.target === e.currentTarget && onClose()}>

      {/* Left: Order List */}
      <div className="ml-auto flex h-full"
        style={{width: selected ? '980px' : '480px', transition:'width 0.2s'}}>

        <div className="flex flex-col h-full flex-shrink-0"
          style={{width:'480px', background:'#fff', borderLeft:'1px solid #e2e8f0'}}>

          {/* Header */}
          <div className="px-4 py-4 flex-shrink-0"
            style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[16px] font-bold text-white">📋 Orders</div>
              <button onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white text-[16px] flex items-center justify-center">✕</button>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1.5">
              {FILTERS.map(f => (
                <button key={f.id} onClick={() => { setFilter(f.id); setSelected(null) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer border-none transition-all"
                  style={{
                    background: filter===f.id ? '#fff' : 'rgba(255,255,255,0.2)',
                    color: filter===f.id ? '#d97706' : '#fff',
                  }}>
                  {f.label}
                  {f.count !== null && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{background: filter===f.id ? '#fef9c3' : 'rgba(255,255,255,0.3)'}}>
                      {f.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          {filter !== 'held' && (
            <div className="px-4 py-2.5 flex-shrink-0" style={{borderBottom:'1px solid #f1f5f9'}}>
              <div className="flex items-center gap-2 rounded-xl px-3"
                style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}>
                <span className="text-slate-400 text-[14px]">🔍</span>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Order # or customer..."
                  className="flex-1 border-none outline-none py-2 text-[13px] bg-transparent"/>
                {search && <button onClick={() => setSearch('')}
                  className="text-slate-400 bg-transparent border-none cursor-pointer">✕</button>}
              </div>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto">

            {/* ── HELD ORDERS ── */}
            {filter === 'held' && (
              heldLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-400 text-[13px]">Loading...</div>
              ) : heldOrders.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-slate-300">
                  <div className="text-[48px] mb-3">📌</div>
                  <div className="text-[14px] font-semibold">No held orders</div>
                  <div className="text-[12px] mt-1">Hold a cart to see it here</div>
                </div>
              ) : heldOrders.map(order => (
                <div key={order.id}
                  onClick={() => setSelected({...order, _type:'held'})}
                  className="flex items-center gap-3 px-4 py-3.5 cursor-pointer border-b transition-all"
                  style={{
                    borderColor:'#f1f5f9',
                    background: selected?.id===order.id ? '#fffbeb' : '#fff',
                    borderLeft: selected?.id===order.id ? '3px solid #f59e0b' : '3px solid transparent',
                  }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[18px] flex-shrink-0"
                    style={{background:'#fef9c3'}}>📌</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-slate-800 truncate">
                      {order.label || order.customer_name || 'Held Order'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {new Date(order.held_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {order.held_by_name} · {order.item_count} items
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="text-[16px] font-black font-mono" style={{color:'#d97706'}}>
                      ${parseFloat(order.total||0).toFixed(2)}
                    </div>
                    <span className="text-[14px]" style={{color: selected?.id===order.id ? '#f59e0b':'#cbd5e1'}}>👁️</span>
                  </div>
                </div>
              ))
            )}

            {/* ── DB ORDERS ── */}
            {filter !== 'held' && (
              ordersLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-400 text-[13px]">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-slate-300">
                  <div className="text-[48px] mb-3">📋</div>
                  <div className="text-[14px]">No orders found</div>
                </div>
              ) : filtered.map(order => {
                const st = getStatus(order)
                const ss = STATUS_STYLE[st]
                return (
                  <div key={order.id}
                    onClick={() => setSelected({...order, _type:'order'})}
                    className="flex items-center gap-3 px-4 py-3.5 cursor-pointer border-b transition-all"
                    style={{
                      borderColor:'#f1f5f9',
                      background: selected?.id===order.id ? '#f0f4ff' : '#fff',
                      borderLeft: selected?.id===order.id ? '3px solid #6366f1' : '3px solid transparent',
                    }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[13px] font-bold text-indigo-600 font-mono">{order.order_number}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={ss}>{ss.label}</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {new Date(order.created_at).toLocaleDateString()} {new Date(order.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
                        {order.customers?.name && <span className="ml-1.5">· {order.customers.name}</span>}
                      </div>
                    </div>
                    <div className="text-[15px] font-black font-mono flex-shrink-0" style={{color:'#1e293b'}}>
                      ${parseFloat(order.grand_total||0).toFixed(2)}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right: Order Detail - always visible */}
        {true && (
          <div className="flex flex-col h-full flex-1"
            style={{background:'#f8fafc', borderLeft:'1px solid #e2e8f0'}}>

            {!selected && (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                <div className="text-[52px] mb-3">👁️</div>
                <div className="text-[14px] font-semibold text-slate-400">Click an order to preview</div>
              </div>
            )}
            {selected && <>
            {/* Detail header */}
            <div className="px-5 py-4 flex items-center justify-between flex-shrink-0"
              style={{background:'#fff', borderBottom:'1px solid #e2e8f0'}}>
              <div>
                {selected._type === 'held' ? (
                  <>
                    <div className="text-[15px] font-bold text-slate-800">
                      📌 {selected.label || 'Held Order'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Held at {new Date(selected.held_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} by {selected.held_by_name}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[15px] font-bold text-indigo-600 font-mono">{selected.order_number}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {new Date(selected.created_at).toLocaleString()}
                      {selected.customers?.name && <span className="ml-1.5">· {selected.customers.name}</span>}
                    </div>
                  </>
                )}
              </div>
              <button onClick={() => setSelected(null)}
                className="text-slate-400 bg-transparent border-none cursor-pointer text-[20px]">✕</button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Items</div>
              <div className="rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                {(selected._type === 'held'
                  ? selected.cart_snapshot?.items || []
                  : selected.order_items || []
                ).map((item, i, arr) => {
                  const name  = selected._type === 'held' ? item.name : item.products?.name
                  const qty   = selected._type === 'held' ? item.qty  : item.quantity
                  const price = selected._type === 'held' ? item.unitPrice : item.unit_price
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 bg-white"
                      style={{borderBottom: i<arr.length-1 ? '1px solid #f1f5f9':'none'}}>
                      <div className="flex-1">
                        <div className="text-[13px] font-semibold text-slate-700">{name}</div>
                      </div>
                      <div className="text-[12px] text-slate-400 font-mono">×{qty}</div>
                      <div className="text-[13px] font-bold font-mono text-slate-800">
                        ${((price||0)*qty).toFixed(2)}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Total */}
              <div className="mt-3 rounded-xl p-4" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                <div className="flex justify-between text-[15px] font-black">
                  <span>Total</span>
                  <span className="font-mono" style={{color:'#6366f1'}}>
                    ${parseFloat(selected.total || selected.grand_total || 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 flex flex-col gap-2 flex-shrink-0"
              style={{borderTop:'1px solid #e2e8f0', background:'#fff'}}>
              {selected._type === 'held' ? (
                <>
                  <button onClick={() => handleResume(selected)}
                    className="w-full rounded-2xl py-4 text-[14px] font-bold text-white cursor-pointer border-none"
                    style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
                    ↩ Resume Order
                  </button>
                  <button onClick={() => handleCancelHeld(selected)}
                    className="w-full rounded-xl py-2.5 text-[12px] font-semibold cursor-pointer border"
                    style={{background:'#fff1f2', borderColor:'#fecdd3', color:'#e11d48'}}>
                    🗑 Cancel Held Order
                  </button>
                </>
              ) : (
                <div className="text-[11px] text-slate-400 text-center py-2">
                  Completed order — view only
                </div>
              )}
            </div>
            </>}
          </div>
        )}
      </div>
    </div>
  )
}
