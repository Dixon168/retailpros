// src/stores/productsStore.js
// 商品数据管理 - 增删改查、库存、序列号

import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

export const useProductsStore = create((set, get) => ({
  selectedProduct: null,
  activeTab: 'info', // 'info' | 'inventory' | 'serials' | 'sales'

  setSelectedProduct: (p) => set({ selectedProduct: p, activeTab: 'info' }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  // 创建商品
  createProduct: async (tenantId, data) => {
    const { data: prod, error } = await supabase
      .from('products')
      .insert({ tenant_id: tenantId, ...data })
      .select()
      .single()
    if (error) { toast.error('Failed to create product'); throw error }
    toast.success('Product created')
    return prod
  },

  // 更新商品
  updateProduct: async (id, data) => {
    const { error } = await supabase
      .from('products')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { toast.error('Failed to update'); throw error }
    toast.success('Saved')
  },

  // 调整库存
  adjustInventory: async (storeId, productId, delta, tenantId) => {
    const { data: inv } = await supabase
      .from('inventory')
      .select('id, quantity')
      .eq('store_id', storeId)
      .eq('product_id', productId)
      .maybeSingle()

    if (inv) {
      await supabase.from('inventory')
        .update({ quantity: Math.max(0, inv.quantity + delta), updated_at: new Date().toISOString() })
        .eq('id', inv.id)
    } else {
      await supabase.from('inventory')
        .insert({ tenant_id: tenantId, store_id: storeId, product_id: productId, quantity: Math.max(0, delta) })
    }
    toast.success('Inventory updated')
  },

  // 录入序列号（入库）
  receiveSerials: async (tenantId, storeId, productId, serials, costPrice, purchaseOrderId, userId) => {
    const rows = serials.map(sn => ({
      tenant_id: tenantId,
      store_id: storeId,
      product_id: productId,
      serial_number: sn.trim().toUpperCase(),
      status: 'in_stock',
      cost_price: costPrice,
      purchase_order_id: purchaseOrderId || null,
      received_by: userId,
    }))
    const { error } = await supabase.from('serial_numbers').insert(rows)
    if (error) { toast.error('Failed to receive serials'); throw error }
    toast.success(`${rows.length} serial(s) received`)
  },
}))
