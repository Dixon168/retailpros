// src/stores/cartStore.js
// POS 购物车状态管理
// 负责：商品增删改、折扣、税务计算、支付处理

import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

// 美国 California 默认税率（实际从门店设置读取）
const DEFAULT_TAX_RATE = 0.0725

export const useCartStore = create((set, get) => ({
  // ── 购物车数据 ──
  items: [],           // 购物车商品列表
  customer: null,      // 选中的客户
  orderDiscount: null, // 整单折扣 { type: 'pct'|'amt', value: number }
  taxGroups: [],       // 税率组（从数据库加载）

  // ── 支付数据 ──
  payments: [],        // 支付方式列表 [{ method, amount, cardId }]

  // ── UI 状态 ──
  pendingProduct: null,   // 等待输入序列号/重量/价格的商品
  showSnPanel: false,     // 序列号输入面板
  showWtPanel: false,     // 称重输入面板
  showPricePanel: false,  // 自定义价格输入面板
  pendingWeight: null,    // 已输入的重量（等待价格输入）
  selectedItemId: null,   // 选中的购物车 item（用于侧边面板）
  showCustPanel: false,   // 客户选择面板
  showDiscPanel: false,   // 折扣面板
  showPayPanel: false,    // 支付面板

  // ── 加载税率 ──
  loadTaxGroups: async (tenantId) => {
    const { data } = await supabase
      .from('tax_groups')
      .select('*, tax_rates(*)')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
    set({ taxGroups: data || [] })
  },

  // ── 添加商品 ──
  addProduct: (product) => {
    const { items } = get()

    // 序列号商品 → 弹出序列号输入框
    if (product.type === 'serialized' || product.has_serial) {
      set({ pendingProduct: product, showSnPanel: true })
      return
    }

    // Prompt weight → 弹出重量输入框（之后如果也有prompt_price会继续弹）
    if (product.type === 'weight' || product.prompt_weight) {
      set({ pendingProduct: product, showWtPanel: true, pendingWeight: null })
      return
    }

    // 只有 prompt_price → 直接弹价格输入框
    if (product.prompt_price) {
      set({ pendingProduct: product, showPricePanel: true })
      return
    }

    // 普通件装/服务 → 检查是否已在购物车
    const existing = items.find(i =>
      i.productId === product.id &&
      i.type !== 'serialized' &&
      i.type !== 'weight'
    )

    if (existing) {
      // 已存在则数量+1
      get().updateQty(existing.id, existing.qty + 1)
    } else {
      // 新增
      get()._addItem({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        type: product.type,
        qty: 1,
        unit: product.unit || 'ea',
        unitPrice: product.price,
        taxGroupId: product.tax_group_id,
        isTaxable: product.is_taxable,
        imageUrl: product.image_url || null,
      })
    }
  },

  // 确认序列号，添加到购物车
  confirmSerialNumber: (serialNumber) => {
    const { pendingProduct } = get()
    if (!pendingProduct) return
    get()._addItem({
      productId: pendingProduct.id,
      name: pendingProduct.name,
      sku: pendingProduct.sku,
      type: 'serialized',
      qty: 1,
      unit: 'ea',
      unitPrice: pendingProduct.price,
      taxGroupId: pendingProduct.tax_group_id,
      isTaxable: pendingProduct.is_taxable,
      serialNumber,
      imageUrl: pendingProduct.image_url || null,
    })
    set({ pendingProduct: null, showSnPanel: false })
    toast.success(`Added: ${pendingProduct.name}`)
  },

  // ── Item level operations ──
  setItemNote: (itemId, note) => {
    set(s => ({ items: s.items.map(i => i.id===itemId ? {...i, note} : i) }))
  },
  setItemEmployee: (itemId, employee) => {
    set(s => ({ items: s.items.map(i => i.id===itemId ? {...i, employee} : i) }))
  },
  setItemPrice: (itemId, price) => {
    set(s => ({ items: s.items.map(i => i.id===itemId ? {...i, unitPrice: price, priceOverridden: true} : i) }))
  },
  setItemDiscount: (itemId, discount) => {
    set(s => ({ items: s.items.map(i => i.id===itemId ? {...i, itemDiscount: discount} : i) }))
  },
  setItemQty: (itemId, qty) => {
    if (qty === 0) { get().removeItem(itemId); return }
    set(s => ({ items: s.items.map(i => i.id===itemId ? {...i, qty} : i) }))
  },

  // ── 确认称重
  // 如果产品同时有 prompt_price，先存重量，再弹价格输入框
  confirmWeight: (weightLbs) => {
    const { pendingProduct } = get()
    if (!pendingProduct || weightLbs <= 0) return

    if (pendingProduct.prompt_price) {
      // Both weight AND price prompts — save weight, now ask for price
      set({ pendingWeight: weightLbs, showWtPanel: false, showPricePanel: true })
      return
    }

    // Weight only
    get()._addItem({
      productId: pendingProduct.id,
      name: pendingProduct.name,
      sku: pendingProduct.sku,
      type: pendingProduct.prompt_weight ? 'weight' : pendingProduct.type,
      qty: weightLbs,
      unit: pendingProduct.unit || 'lb',
      unitPrice: pendingProduct.price,
      taxGroupId: pendingProduct.tax_group_id,
      isTaxable: pendingProduct.is_taxable,
      imageUrl: pendingProduct.image_url || null,
    })
    set({ pendingProduct: null, pendingWeight: null, showWtPanel: false })
    toast.success(`Added: ${pendingProduct.name} (${weightLbs} ${pendingProduct.unit||'lb'})`)
  },

  // 确认自定义价格
  confirmPrice: (customPrice) => {
    const { pendingProduct, pendingWeight } = get()
    if (!pendingProduct || customPrice <= 0) return

    get()._addItem({
      productId: pendingProduct.id,
      name: pendingProduct.name,
      sku: pendingProduct.sku,
      type: pendingWeight ? 'weight' : pendingProduct.type,
      qty: pendingWeight || 1,
      unit: pendingWeight ? (pendingProduct.unit || 'lb') : 'ea',
      unitPrice: customPrice,
      taxGroupId: pendingProduct.tax_group_id,
      isTaxable: pendingProduct.is_taxable,
      imageUrl: pendingProduct.image_url || null,
    })

    const desc = pendingWeight
      ? `${pendingProduct.name} (${pendingWeight} ${pendingProduct.unit||'lb'} @ $${customPrice.toFixed(2)})`
      : `${pendingProduct.name} @ $${customPrice.toFixed(2)}`

    set({ pendingProduct: null, pendingWeight: null, showPricePanel: false })
    toast.success(`Added: ${desc}`)
  },

  // 内部添加商品方法
  _addItem: (item) => {
    const newId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    set(state => ({
      items: [...state.items, {
        id: newId,
        discount: null,
        ...item
      }],
      selectedItemId: newId,  // Auto-select the new item
    }))
  },

  // ── 修改数量 ──
  updateQty: (itemId, newQty) => {
    if (newQty < 1) return
    set(state => ({
      items: state.items.map(i =>
        i.id === itemId ? { ...i, qty: newQty } : i
      ),
      selectedItemId: itemId,  // Auto-select updated item
    }))
  },

  // ── 删除商品 ──
  removeItem: (itemId) => {
    set(state => ({ items: state.items.filter(i => i.id !== itemId) }))
  },



  // ── 整单折扣 ──
  setOrderDiscount: (discount) => {
    set({ orderDiscount: discount })
    toast.success('Discount applied')
  },

  // ── 选择客户 ──
  setCustomer: (customer) => {
    set({ customer, showCustPanel: false })
    if (customer) toast.success(`Customer: ${customer.name}`)
  },

  // ── 税务计算 ──
  calcTaxForItem: (item) => {
    const { taxGroups } = get()
    if (!item.isTaxable) return { taxAmount: 0, taxBreakdown: [] }

    const group = taxGroups.find(g => g.id === item.taxGroupId)
      || taxGroups.find(g => g.is_default)
    if (!group?.tax_rates?.length) {
      // 备用：使用默认税率
      const lineAmt = item.unitPrice * item.qty
      return {
        taxAmount: lineAmt * DEFAULT_TAX_RATE,
        taxBreakdown: [{ name: 'Sales Tax', rate: DEFAULT_TAX_RATE, amount: lineAmt * DEFAULT_TAX_RATE }]
      }
    }

    // 多层税率计算
    const lineAmt = item.unitPrice * item.qty
    let taxBase = lineAmt
    let totalTax = 0
    const breakdown = []

    const sortedRates = [...group.tax_rates].sort((a, b) => a.sequence - b.sequence)
    for (const rate of sortedRates) {
      if (!rate.is_active) continue
      const base = rate.is_compound ? lineAmt + totalTax : lineAmt
      const taxAmt = base * rate.rate
      totalTax += taxAmt
      breakdown.push({ name: rate.name, rate: rate.rate, amount: taxAmt })
    }

    return { taxAmount: totalTax, taxBreakdown: breakdown }
  },

  // ── 汇总计算 ──
  totals: () => {
    const { items, orderDiscount } = get()

    let subtotal = 0
    let totalTax = 0

    items.forEach(item => {
      const lineAmt = item.unitPrice * item.qty

      // 单品折扣
      let discounted = lineAmt
      const disc = item.itemDiscount || item.discount
      if (disc) {
        discounted = disc.type === 'pct'
          ? lineAmt * (1 - disc.value / 100)
          : lineAmt - Math.min(disc.value, lineAmt)
      }

      subtotal += discounted

      // 税
      const { taxAmount } = get().calcTaxForItem({ ...item, unitPrice: discounted / item.qty })
      totalTax += taxAmount
    })

    // 整单折扣
    let orderDiscountAmt = 0
    if (orderDiscount?.value > 0) {
      orderDiscountAmt = orderDiscount.type === 'pct'
        ? subtotal * (orderDiscount.value / 100)
        : Math.min(orderDiscount.value, subtotal)
    }

    const afterDiscount = subtotal - orderDiscountAmt
    const grandTotal = afterDiscount + totalTax

    return {
      subtotal,
      orderDiscountAmt,
      taxAmount: totalTax,
      grandTotal,
      itemCount: items.length
    }
  },

  // ── 支付 ──
  addPayment: (payment) => {
    set(state => ({ payments: [...state.payments, payment] }))
  },
  removePayment: (index) => {
    set(state => ({ payments: state.payments.filter((_, i) => i !== index) }))
  },

  // 已支付总额
  paidAmount: () => get().payments.reduce((s, p) => s + p.amount, 0),

  // 找零
  changeAmount: () => {
    const { grandTotal } = get().totals()
    const paid = get().paidAmount()
    return Math.max(0, paid - grandTotal)
  },

  // ── 完成订单（原子性，含并发控制）──
  submitOrder: async (storeId, cashierId, tenantId, terminalId) => {
    const { items, customer, payments } = get()
    const { subtotal, orderDiscountAmt, taxAmount, grandTotal } = get().totals()

    if (items.length === 0) {
      toast.error('Cart is empty')
      return null
    }

    const paidAmt = get().paidAmount()

    // 构建传给数据库函数的数据
    const orderData = {
      customer_id:     customer?.id || null,
      subtotal:        subtotal,
      discount_amount: orderDiscountAmt,
      tax_amount:      taxAmount,
      total:           grandTotal,
      amount_paid:     paidAmt,
      points_earned:   customer ? Math.floor(grandTotal) : 0,
      tax_breakdown:   [],
    }

    const orderItems = items.map(item => {
      const { taxAmount: itemTax } = get().calcTaxForItem(item)
      return {
        product_id:      item.productId,
        product_name:    item.name,
        product_sku:     item.sku || '',
        product_type:    item.type,
        serial_number:   item.serialNumber || '',
        quantity:        item.qty,
        unit:            item.unit || 'ea',
        unit_price:      item.unitPrice,
        discount_amount: 0,
        tax_amount:      itemTax,
        line_total:      item.unitPrice * item.qty + itemTax,
      }
    })

    const orderPayments = payments.map(p => ({
      method:    p.method,
      amount:    p.amount,
      reference: p.reference || null,
    }))

    // 调用原子性函数：单个事务完成库存检查+序列号锁定+写入所有记录
    const { data: result, error } = await supabase.rpc('fn_submit_order_atomic', {
      p_tenant_id:   tenantId,
      p_store_id:    storeId,
      p_cashier_id:  cashierId,
      p_terminal_id: terminalId,
      p_order_data:  orderData,
      p_items:       orderItems,
      p_payments:    orderPayments,
    })

    if (error) {
      toast.error(`System error: ${error.message}`)
      throw error
    }

    if (!result?.success) {
      // 具体的业务失败（库存不足 / 序列号已售 / 并发冲突）
      const msg = result?.message || 'Order failed'

      if (result?.step === 'inventory_check') {
        toast.error(`❌ ${result.product}: insufficient stock (available: ${result.available})`, { duration: 5000 })
      } else if (result?.step === 'serial_check') {
        toast.error(`❌ ${msg}`, { duration: 5000 })
      } else {
        toast.error(`❌ ${msg}`)
      }
      return null
    }

    toast.success(`✅ Order ${result.order_number} completed!`)
    get().clearCart()

    return { id: result.order_id, order_number: result.order_number }
  },

  // ── 清空购物车 ──
  clearCart: () => {
    set({
      items: [],
      customer: null,
      orderDiscount: null,
      payments: [],
      pendingProduct: null,
      showSnPanel: false,
      showWtPanel: false,
      showCustPanel: false,
      showDiscPanel: false,
      showPayPanel: false,
    })
  },
}))
