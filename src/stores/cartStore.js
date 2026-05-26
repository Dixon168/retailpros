// src/stores/cartStore.js
// POS 购物车状态管理
// 负责：商品增删改、折扣、税务计算、支付处理

import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { calculateBulkPrice, getActiveBulkTiers } from '@/lib/bulkPricing'

// 美国 California 默认税率（实际从门店设置读取）
const DEFAULT_TAX_RATE = 0.0725

export const useCartStore = create((set, get) => ({
  // ── 购物车数据 ──
  items: [],           // 购物车商品列表
  customer: null,      // 选中的客户
  orderDiscount: null, // 整单折扣 { type: 'pct'|'amt', value: number } OR { type:'points_cash', amount, points_used }
  appliedCoupon: null, // 已应用的 coupon { id, code, name, discount_type, discount_value, discount_amount }
  taxGroups: [],       // 税率组（从数据库加载）
  resumedHeldId: null, // 若当前购物车是从挂单恢复的, 记录挂单 id (完成后标记该挂单)

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
      .from('tax_rates')
      .select('id, name, rate')
      .eq('tenant_id', tenantId)
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

    // ── Stock check (warning only, not blocking) ──
    const stock = product.inventory?.reduce((a,i)=>a+(i.quantity||0), 0)
    const isService = product.type === 'service'
    if (!isService && stock !== undefined && stock !== null) {
      const existing = items.find(i =>
        i.productId === product.id && i.type !== 'serialized' && i.type !== 'weight'
      )
      const newQty = (existing?.qty || 0) + 1
      if (stock <= 0) {
        toast(`🚫 ${product.name} is out of stock — added anyway`, {
          icon: '⚠️',
          style: { background:'#FEE2E2', color:'#CF1322', fontWeight:600 }
        })
      } else if (newQty > stock) {
        toast(`⚠️ ${product.name} — only ${stock} in stock, you have ${newQty}`, {
          icon: '⚠️',
          style: { background:'#FEF3C7', color:'#B45309', fontWeight:600 }
        })
      }
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
        inventory: product.inventory || null,  // carry stock data into cart
        points_redeem:          product.points_redeem,
        redeem_points_required: product.redeem_points_required,
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

  // ── Add a card-top-up REVERSAL as a refund cart line ────────────
  // For voiding/refunding an order that loaded a card. Pulls the top-up
  // amount back OFF the card and refunds the payment amount to the
  // customer. Like top-ups, this only executes when the refund order is
  // completed. The line price is NEGATIVE (money going back to customer)
  // and editable; the card reversal amount is fixed at the original
  // top-up amount. Non-taxable.
  addCardReversal: (payload) => {
    const label = payload.cardKind === 'member'
      ? `↩ Refund — Member Top-up $${Number(payload.topupAmount).toFixed(2)}${payload.customerName ? ` (${payload.customerName})` : ''}`
      : `↩ Refund — Gift Card Top-up $${Number(payload.topupAmount).toFixed(2)}${payload.cardNumber ? ` (#${payload.cardNumber})` : ''}`
    get()._addItem({
      productId:  null,
      name:       label,
      sku:        payload.cardNumber || '',
      type:       'card_reversal',
      qty:        -1,                          // negative = refund
      unit:       'ea',
      unitPrice:  payload.paymentAmount,       // editable; line total = -payment
      isTaxable:  false,
      taxGroupId: null,
      isReturn:   true,
      cardReversal: {
        cardKind:      payload.cardKind,
        topupAmount:   payload.topupAmount,
        allowNegative: !!payload.allowNegative,
        cardNumber:    payload.cardNumber || null,
        customerId:    payload.customerId || null,
        origOrderId:     payload.origOrderId || null,
        origOrderNumber: payload.origOrderNumber || null,
      },
    })
  },

  // ── Add a card top-up / sell as a cart line ──────────────────────
  // Top-ups (gift card sell/top-up, member card top-up) are NOT charged
  // on the spot. They're added to the cart like a product and only
  // activated when the whole order is paid in full (status completed).
  // The line is NON-TAXABLE — tax only applies when the card is later
  // spent on goods, never on loading money onto it.
  //   payload: {
  //     cardKind: 'gift' | 'member',
  //     topupAmount,        // 充值金额 — what lands on the card
  //     paymentAmount,      // 付款金额 — cash the customer pays (line price)
  //     bonusAmount,        // free promo amount (= topup - payment)
  //     // gift:   cardNumber, isNewCard, recipientName, recipientPhone, expireDays, cardType
  //     // member: customerId, customerName, cardNumber
  //     meta: {...}         // everything fn needs to activate on completion
  //   }
  addCardTopup: (payload) => {
    const label = payload.cardKind === 'member'
      ? `💳 Member Card Top-up${payload.customerName ? ` — ${payload.customerName}` : ''}`
      : `🎁 Gift Card ${payload.isNewCard ? 'Sale' : 'Top-up'}${payload.cardNumber ? ` — #${payload.cardNumber}` : ''}`
    get()._addItem({
      productId:   null,
      name:        label,
      sku:         payload.cardNumber || '',
      type:        'card_topup',          // special line type
      qty:         1,
      unit:        'ea',
      unitPrice:   payload.paymentAmount, // customer pays the PAYMENT amount
      isTaxable:   false,                 // loading money is never taxed
      taxGroupId:  null,
      // card activation details (read on order completion)
      cardTopup: {
        cardKind:       payload.cardKind,
        topupAmount:    payload.topupAmount,
        paymentAmount:  payload.paymentAmount,
        bonusAmount:    payload.bonusAmount || Math.max(0, payload.topupAmount - payload.paymentAmount),
        ...payload.meta,
      },
    })
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

  // ── 应用优惠券 ──
  setAppliedCoupon: (coupon) => {
    set({ appliedCoupon: coupon })
    if (coupon) toast.success(`🎫 ${coupon.code} applied (−$${Number(coupon.discount_amount).toFixed(2)})`)
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
  // Per-line bulk pricing (used by Cart UI + Customer Display).
  // Returns null when no active bulk promo applies.
  lineBulk: (item) => {
    if (!item) return null
    const tiers = getActiveBulkTiers(item)
    if (tiers.length === 0) return null
    // Don't apply bulk if the item has a manual itemDiscount — the cashier
    // intentionally overrode pricing, that takes priority over the promo
    if (item.itemDiscount || item.discount) return null
    return calculateBulkPrice(item.qty, item.unitPrice, tiers)
  },

  totals: () => {
    const { items, orderDiscount, appliedCoupon } = get()

    let subtotal = 0

    items.forEach(item => {
      // 1) Bulk pricing has highest priority (if no manual itemDiscount)
      const bulkTiers = getActiveBulkTiers(item)
      if (bulkTiers.length > 0 && !(item.itemDiscount || item.discount)) {
        const bp = calculateBulkPrice(item.qty, item.unitPrice, bulkTiers)
        subtotal += bp.lineTotal
        return
      }
      // 2) Manual itemDiscount path (old behavior)
      const lineAmt = item.unitPrice * item.qty
      let discounted = lineAmt
      const disc = item.itemDiscount || item.discount
      if (disc) {
        discounted = disc.type === 'pct'
          ? lineAmt * (1 - disc.value / 100)
          : lineAmt - Math.min(disc.value, lineAmt)
      }
      subtotal += discounted
    })

    // 整单折扣 (manual % or $ OR points-cash)
    let orderDiscountAmt = 0
    if (orderDiscount?.value > 0) {
      orderDiscountAmt = orderDiscount.type === 'pct'
        ? subtotal * (orderDiscount.value / 100)
        : Math.min(orderDiscount.value, subtotal)
    } else if (orderDiscount?.type === 'points_cash') {
      orderDiscountAmt = orderDiscount.amount || 0
    } else if (orderDiscount?.type === 'points_product') {
      orderDiscountAmt = orderDiscount.amount || 0
    }

    // Coupon discount — applied on top of subtotal (NOT compounded with order discount, both come off independently)
    let couponDiscountAmt = 0
    if (appliedCoupon) {
      if (appliedCoupon.discount_type === 'pct') {
        couponDiscountAmt = subtotal * (Number(appliedCoupon.discount_value) / 100)
      } else {
        couponDiscountAmt = Math.min(Number(appliedCoupon.discount_value), subtotal)
      }
    }

    // Don't let total discounts exceed subtotal (clamp to >= 0)
    const totalReductions = Math.min(orderDiscountAmt + couponDiscountAmt, subtotal)
    const afterDiscount = subtotal - totalReductions

    // Tax recomputed on the discounted subtotal proportionally
    let totalTax = 0
    if (subtotal > 0) {
      const taxRatio = afterDiscount / subtotal
      items.forEach(item => {
        // Determine the line's taxable amount the same way subtotal was computed
        let discounted
        const bulkTiers = getActiveBulkTiers(item)
        if (bulkTiers.length > 0 && !(item.itemDiscount || item.discount)) {
          discounted = calculateBulkPrice(item.qty, item.unitPrice, bulkTiers).lineTotal
        } else {
          const lineAmt = item.unitPrice * item.qty
          discounted = lineAmt
          const disc = item.itemDiscount || item.discount
          if (disc) {
            discounted = disc.type === 'pct'
              ? lineAmt * (1 - disc.value / 100)
              : lineAmt - Math.min(disc.value, lineAmt)
          }
        }
        // Apply taxRatio to fairly distribute the order/coupon discount before tax
        const taxableAmount = discounted * taxRatio
        const { taxAmount } = get().calcTaxForItem({ ...item, unitPrice: taxableAmount / item.qty })
        totalTax += taxAmount
      })
    }

    const grandTotal = afterDiscount + totalTax

    // Total savings from bulk pricing (for display: "You saved $X")
    let bulkSavings = 0
    items.forEach(item => {
      const bulkTiers = getActiveBulkTiers(item)
      if (bulkTiers.length > 0 && !(item.itemDiscount || item.discount)) {
        bulkSavings += calculateBulkPrice(item.qty, item.unitPrice, bulkTiers).savings
      }
    })

    return {
      subtotal,
      orderDiscountAmt,
      couponDiscountAmt,
      bulkSavings,
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
    const { items, customer, payments, orderDiscount, appliedCoupon } = get()
    const { subtotal, orderDiscountAmt, couponDiscountAmt, taxAmount, grandTotal } = get().totals()

    if (items.length === 0) {
      toast.error('Cart is empty')
      return null
    }

    const paidAmt = get().paidAmount()

    const pointsRedeemed = (orderDiscount?.type === 'points_cash' || orderDiscount?.type === 'points_product')
      ? (orderDiscount.points_used || 0)
      : 0

    // 构建传给数据库函数的数据
    const orderData = {
      customer_id:     customer?.id || null,
      subtotal:        subtotal,
      discount_amount: orderDiscountAmt + (couponDiscountAmt || 0),  // total off (manual + coupon, points)
      tax_amount:      taxAmount,
      total:           grandTotal,
      amount_paid:     paidAmt,
      points_earned:   customer ? Math.floor(grandTotal) : 0,
      points_redeemed: pointsRedeemed,
      coupon_id:       appliedCoupon?.id || null,
      coupon_code:     appliedCoupon?.code || null,
      coupon_discount: couponDiscountAmt || 0,
      tax_breakdown:   [],
    }

    const orderItems = items.map(item => {
      const { taxAmount: itemTax } = get().calcTaxForItem(item)

      // Determine the actual line price the customer is paying.
      // Priority: bulk promo > manual itemDiscount > unit price.
      // This is critical for refunds — without it, returns would refund
      // the original unit price even when the customer paid a bulk price.
      const bulkTiers = getActiveBulkTiers(item)
      let lineSubtotal
      let bulkSavings = 0
      if (bulkTiers.length > 0 && !item.itemDiscount && !item.discount) {
        const bp = calculateBulkPrice(item.qty, item.unitPrice, bulkTiers)
        lineSubtotal = bp.lineTotal
        bulkSavings  = bp.savings
      } else {
        const d = item.itemDiscount
        const linePrice = d
          ? d.type === 'pct'
            ? item.unitPrice * (1 - d.value / 100)
            : Math.max(0, item.unitPrice - d.value)
          : item.unitPrice
        lineSubtotal = linePrice * item.qty
      }

      // Paid per-unit price (rounded to 4 decimals to keep things tidy).
      // Returns use this number — the customer gets back what they paid,
      // not the original sticker price.
      const paidUnitPrice = item.qty !== 0
        ? Math.round((lineSubtotal / item.qty) * 10000) / 10000
        : item.unitPrice

      // Convert item discount to a percentage for storage (legacy reporting).
      const d = item.itemDiscount
      const discountPct = !d ? 0
        : d.type === 'pct' ? d.value
        : (item.unitPrice > 0 ? Math.min(100, (d.value / item.unitPrice) * 100) : 0)

      return {
        product_id:       item.productId,
        product_name:     item.name,
        product_sku:      item.sku || '',
        // card_topup / card_reversal lines carry no inventory — present
        // them as 'service' so the atomic submit skips inventory.
        product_type:     (item.type === 'card_topup' || item.type === 'card_reversal') ? 'service' : item.type,
        serial_number:    item.serialNumber || '',
        quantity:         item.qty,
        unit:             item.unit || 'ea',
        unit_price:       item.unitPrice,
        paid_unit_price:  paidUnitPrice,    // what the customer actually paid per unit
        bulk_savings:     bulkSavings,      // money saved by bulk pricing on this line
        discount_pct:     discountPct,
        line_total:       lineSubtotal + itemTax,
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

    // If this sale came from a resumed held order, mark that held order
    // completed now (not on resume) so it leaves the hold list only once
    // the sale is actually done.
    const resumedHeldId = get().resumedHeldId
    if (resumedHeldId) {
      try {
        await supabase.from('held_orders')
          .update({ status: 'completed', resumed_at: new Date().toISOString() })
          .eq('id', resumedHeldId)
      } catch (e) { /* non-fatal */ }
    }

    // Show oversold warnings if any (stock went negative)
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      result.warnings.forEach(w => {
        toast(`⚠️ ${w}`, {
          icon: '📉',
          duration: 6000,
          style: { background:'#FEF3C7', color:'#B45309', fontWeight:600 }
        })
      })
    }

    // ── Activate any card top-ups now that the order is paid in full ──
    // These were added as non-taxable cart lines and intentionally NOT
    // executed until payment succeeded. Now that the order is completed,
    // load the balances. Done per-line so one failure is reported but
    // doesn't roll back the (already completed) sale.
    const topupLines = items.filter(i => i.type === 'card_topup' && i.cardTopup)
    for (const line of topupLines) {
      const ct = line.cardTopup
      try {
        if (ct.cardKind === 'gift') {
          if (ct.isNewCard) {
            const { data, error: e } = await supabase.rpc('fn_create_gift_card', {
              p_tenant_id:       tenantId,
              p_card_number:     ct.cardNumber,
              p_amount:          ct.topupAmount,
              p_paid_amount:     ct.paymentAmount,
              p_card_type:       ct.cardType || 'gift',
              p_expire_days:     ct.expireDays || null,
              p_recipient_name:  ct.recipientName || null,
              p_recipient_phone: ct.recipientPhone || null,
              p_note:            ct.note || null,
              p_user_id:         cashierId,
              p_order_id:        result.order_id,
            })
            if (e || !data?.success) throw new Error(data?.message || e?.message || 'card create failed')
          } else {
            const { data, error: e } = await supabase.rpc('fn_topup_gift_card', {
              p_tenant_id:   tenantId,
              p_card_number: ct.cardNumber,
              p_amount:      ct.topupAmount,
              p_paid_amount: ct.paymentAmount,
              p_user_id:     cashierId,
              p_order_id:    result.order_id,
              p_note:        ct.note || null,
            })
            if (e || !data?.success) throw new Error(data?.message || e?.message || 'top-up failed')
          }
        } else if (ct.cardKind === 'member') {
          // Member card lives on the customer record + customer_topups log
          const { data: cust } = await supabase.from('customers')
            .select('card_balance').eq('id', ct.customerId).single()
          const newBal = (cust?.card_balance || 0) + ct.topupAmount
          const u = await supabase.from('customers')
            .update({ card_balance: newBal }).eq('id', ct.customerId)
          if (u.error) throw new Error(u.error.message)
          const ins = await supabase.from('customer_topups').insert({
            tenant_id: tenantId, customer_id: ct.customerId,
            amount: ct.topupAmount, paid_amount: ct.paymentAmount,
            bonus_amount: ct.bonusAmount || 0, balance_after: newBal,
            method: 'order', note: ct.note || `Order ${result.order_number}`,
            staff_id: cashierId, order_id: result.order_id,
          })
          if (ins.error) throw new Error(ins.error.message)
        }
        toast.success(`💳 ${ct.cardKind === 'member' ? 'Member' : 'Gift'} card loaded $${Number(ct.topupAmount).toFixed(2)}`)
      } catch (e) {
        console.error('Card activation:', e)
        toast.error(`⚠️ Order done but card load failed: ${e.message}. Load manually.`, { duration: 8000 })
      }
    }

    // ── Execute card-top-up reversals (void/refund of a top-up) ──────
    // Pull the original top-up amount back off the card. The cash refund
    // to the customer is already handled by the negative line total in
    // this order. Balance was verified (or manager-overridden) before the
    // reversal line was added to the cart.
    const reversalLines = items.filter(i => i.type === 'card_reversal' && i.cardReversal)
    for (const line of reversalLines) {
      const cr = line.cardReversal
      try {
        if (cr.cardKind === 'gift') {
          const { data, error: e } = await supabase.rpc('fn_reverse_gift_card', {
            p_tenant_id:      tenantId,
            p_card_number:    cr.cardNumber,
            p_amount:         cr.topupAmount,
            p_allow_negative: !!cr.allowNegative,
            p_user_id:        cashierId,
            p_order_id:       result.order_id,
            p_note:           cr.origOrderNumber ? `Reversal of ${cr.origOrderNumber}` : 'Top-up reversed',
          })
          if (e || !data?.success) throw new Error(data?.message || e?.message || 'reversal failed')
        } else if (cr.cardKind === 'member') {
          const { data: cust } = await supabase.from('customers')
            .select('card_balance').eq('id', cr.customerId).single()
          const cur = cust?.card_balance || 0
          if (cur < cr.topupAmount && !cr.allowNegative) {
            throw new Error('Insufficient card balance to reverse — manager override required')
          }
          const newBal = cur - cr.topupAmount
          const u = await supabase.from('customers')
            .update({ card_balance: newBal }).eq('id', cr.customerId)
          if (u.error) throw new Error(u.error.message)
          const ins = await supabase.from('customer_topups').insert({
            tenant_id: tenantId, customer_id: cr.customerId,
            amount: -cr.topupAmount, paid_amount: null, bonus_amount: 0,
            balance_after: newBal, method: 'reversal',
            note: cr.origOrderNumber ? `Reversal of ${cr.origOrderNumber}` : 'Top-up reversed',
            staff_id: cashierId, order_id: result.order_id,
          })
          if (ins.error) throw new Error(ins.error.message)
        }
        // Mark the original order refunded/voided
        if (cr.origOrderId) {
          await supabase.from('orders')
            .update({ refund_status: 'full', refunded_at: new Date().toISOString(), refunded_by: cashierId })
            .eq('id', cr.origOrderId)
        }
        toast.success(`↩ Reversed $${Number(cr.topupAmount).toFixed(2)} off the card`)
      } catch (e) {
        console.error('Card reversal:', e)
        toast.error(`⚠️ Refund done but card reversal failed: ${e.message}`, { duration: 8000 })
      }
    }

    get().clearCart()

    return { id: result.order_id, order_number: result.order_number }
  },

  // ── 清空购物车 ──
  clearCart: () => {
    set({
      items: [],
      customer: null,
      orderDiscount: null,
      appliedCoupon: null,
      payments: [],
      resumedHeldId: null,
      pendingProduct: null,
      showSnPanel: false,
      showWtPanel: false,
      showCustPanel: false,
      showDiscPanel: false,
      showPayPanel: false,
    })
  },
}))
