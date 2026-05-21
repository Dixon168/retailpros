// src/stores/heldOrdersStore.js
// 挂单管理

import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { useCartStore } from './cartStore'
import toast from 'react-hot-toast'

export const useHeldOrdersStore = create((set, get) => ({
  heldOrders: [],
  loading: false,

  // ── 加载挂单列表 ──
  load: async (tenantId) => {
    set({ loading: true })
    const { data } = await supabase
      .from('held_orders')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'held')
      .order('held_at', { ascending: false })
    set({ heldOrders: data || [], loading: false })
  },

  // ── 挂单（把当前购物车存起来）──
  holdCurrentCart: async ({ tenantId, storeId, terminalId, terminalName, userId, userName, label }) => {
    const cart = useCartStore.getState()
    const { items, customer, orderDiscount } = cart
    const { subtotal, grandTotal } = cart.totals()

    if (items.length === 0) {
      toast.error('Cart is empty')
      return false
    }

    const { error } = await supabase.from('held_orders').insert({
      tenant_id:     tenantId,
      store_id:      storeId,
      terminal_id:   terminalId,
      terminal_name: terminalName,
      label:         label || null,
      held_by:       userId,
      held_by_name:  userName,
      customer_id:   customer?.id || null,
      customer_name: customer?.name || null,
      cart_snapshot: {
        items,
        customer,
        orderDiscount,
      },
      subtotal,
      total:      grandTotal,
      item_count: items.length,
    })

    if (error) { toast.error('Failed to hold order'); return false }

    // 清空当前购物车
    cart.clearCart()
    toast.success('Order held ✓')
    get().load(tenantId)
    return true
  },

  // ── 调出挂单（恢复到购物车）──
  // ── Restore a held order into the cart (does NOT mark it completed).
  //    Used after navigating to /pos?resume=<id>. The held order stays
  //    'held' and is only finalized when the sale actually completes (or
  //    can be re-held / cancelled). Returns the held row so the caller can
  //    track which held order is in progress.
  restoreHeldToCart: async ({ heldOrderId }) => {
    const { data: held } = await supabase
      .from('held_orders')
      .select('*')
      .eq('id', heldOrderId)
      .single()

    if (!held) { toast.error('Held order not found'); return null }
    if (held.status !== 'held') { toast.error('This order is no longer on hold'); return null }

    const cart = useCartStore.getState()
    cart.clearCart()
    const snap = held.cart_snapshot || {}
    useCartStore.setState({
      items:         snap.items         || [],
      customer:      snap.customer      || null,
      orderDiscount: snap.orderDiscount || null,
      resumedHeldId: heldOrderId,   // remember which held order is in progress
    })
    toast.success(`↩ Resumed: ${held.label || held.customer_name || 'Held order'}`)
    return held
  },

  resumeHeldOrder: async ({ heldOrderId, tenantId, terminalId, userId }) => {
    const { data: held } = await supabase
      .from('held_orders')
      .select('*')
      .eq('id', heldOrderId)
      .single()

    if (!held) { toast.error('Order not found'); return false }
    if (held.status !== 'held') { toast.error('This order is no longer available'); return false }

    // 清空当前购物车再恢复
    const cart = useCartStore.getState()
    cart.clearCart()

    // 恢复购物车快照
    const snap = held.cart_snapshot
    useCartStore.setState({
      items:         snap.items         || [],
      customer:      snap.customer      || null,
      orderDiscount: snap.orderDiscount || null,
    })

    // 标记挂单为已处理
    await supabase.from('held_orders')
      .update({
        status:              'completed',
        resumed_at:          new Date().toISOString(),
        resumed_by:          userId,
        resumed_terminal_id: terminalId,
      })
      .eq('id', heldOrderId)

    toast.success(`Order resumed: ${held.label || held.customer_name || 'Held order'}`)
    get().load(tenantId)
    return true
  },

  // ── 删除挂单 ──
  cancelHeldOrder: async ({ heldOrderId, tenantId, userId }) => {
    await supabase.from('held_orders')
      .update({
        status:       'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: userId,
      })
      .eq('id', heldOrderId)

    toast.success('Held order cancelled')
    get().load(tenantId)
  },
}))
