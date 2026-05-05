// src/components/pos/RecallPanel.jsx
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useHeldOrdersStore } from '@/stores/heldOrdersStore'
import { useCartStore } from '@/stores/cartStore'

export function RecallPanel({ onClose }) {
  const { user, tenant, terminal } = useAuthStore()
  const { heldOrders, loading, load, resumeHeldOrder, cancelHeldOrder } = useHeldOrdersStore()
  const cartItems = useCartStore(s => s.items)

  useEffect(() => {
    if (tenant?.id) load(tenant.id)
  }, [tenant?.id])

  const handleResume = async (order) => {
    if (cartItems.length > 0) {
      if (!confirm('Current cart has items. Clear it and resume this order?')) return
      useCartStore.getState().clearCart()
    }
    const ok = await resumeHeldOrder({
      heldOrderId: order.id,
      tenantId:    tenant?.id,
      terminalId:  terminal?.id,
      userId:      user?.id,
    })
    if (ok) onClose()
  }

  const handleCancel = async (order) => {
    if (!confirm(`Cancel held order "${order.label || order.customer_name || 'this order'}"?`)) return
    await cancelHeldOrder({ heldOrderId: order.id, tenantId: tenant?.id, userId: user?.id })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch"
      style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ml-auto flex flex-col shadow-2xl"
        style={{width:'420px', background:'#fff'}}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
          <span className="text-[22px]">📋</span>
          <div>
            <div className="text-[16px] font-bold text-white">Held Orders</div>
            <div className="text-[11px] text-amber-200">
              {heldOrders.length} order{heldOrders.length!==1?'s':''} on hold
            </div>
          </div>
          <button onClick={onClose}
            className="ml-auto w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white text-[16px] flex items-center justify-center">
            ✕
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400 text-[13px]">
              Loading...
            </div>
          ) : heldOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-300">
              <div className="text-[48px] mb-3">📋</div>
              <div className="text-[14px] font-semibold">No held orders</div>
              <div className="text-[12px] mt-1">Hold a cart to see it here</div>
            </div>
          ) : (
            <div className="p-4 flex flex-col gap-3">
              {heldOrders.map(order => (
                <div key={order.id} className="rounded-2xl overflow-hidden shadow-sm"
                  style={{border:'1.5px solid #e2e8f0'}}>

                  {/* Order header */}
                  <div className="flex items-center gap-3 px-4 py-3"
                    style={{background:'#fffbeb', borderBottom:'1px solid #fde68a'}}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[18px]"
                      style={{background:'#fef3c7'}}>
                      📌
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold text-slate-800 truncate">
                        {order.label || order.customer_name || 'Held Order'}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {new Date(order.held_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} ·
                        by {order.held_by_name}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[16px] font-black font-mono" style={{color:'#d97706'}}>
                        ${parseFloat(order.total||0).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400">{order.item_count} items</div>
                    </div>
                  </div>

                  {/* Items preview */}
                  <div className="px-4 py-2.5 bg-white">
                    <div className="flex flex-wrap gap-1.5">
                      {(order.cart_snapshot?.items || []).slice(0,4).map((item,i) => (
                        <span key={i} className="text-[10px] px-2 py-1 rounded-lg"
                          style={{background:'#f1f5f9', color:'#475569'}}>
                          {item.name} ×{item.qty}
                        </span>
                      ))}
                      {(order.cart_snapshot?.items?.length||0) > 4 && (
                        <span className="text-[10px] text-slate-400">
                          +{order.cart_snapshot.items.length-4} more
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 px-4 py-3" style={{borderTop:'1px solid #f1f5f9'}}>
                    <button onClick={() => handleCancel(order)}
                      className="flex-1 rounded-xl py-2 text-[12px] font-semibold cursor-pointer border"
                      style={{background:'#fff1f2', borderColor:'#fecdd3', color:'#e11d48'}}>
                      🗑 Cancel
                    </button>
                    <button onClick={() => handleResume(order)}
                      className="flex-[2] rounded-xl py-2.5 text-[13px] font-bold text-white cursor-pointer border-none"
                      style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
                      ↩ Resume Order
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
