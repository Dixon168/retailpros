// src/pages/pos/panels/RefundPanel.jsx
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import { useCartStore } from '@/stores/cartStore'
import NumPad from '@/components/ui/NumPad'
import { TouchKeyboard } from '@/components/ui/TouchKeyboard'
import toast from 'react-hot-toast'

// ── Order status badge ──
export function OrderStatusBadge({ order }) {
  const hasRefund = order.refund_status === 'partial' || order.refund_status === 'full'
  const isVoided  = order.status === 'voided'

  const STATUS = {
    completed: { bg:'#dcfce7', color:'#16a34a', label:'Completed' },
    voided:    { bg:'#fee2e2', color:'#dc2626', label:'Voided' },
    held:      { bg:'#fef9c3', color:'#ca8a04', label:'On Hold' },
    refunded:  { bg:'#fdf4ff', color:'#006AFF', label:'Refunded' },
    partial_refund: { bg:'#eff6ff', color:'#2563eb', label:'Part. Refunded' },
  }

  const key = isVoided ? 'voided'
    : order.refund_status === 'full' ? 'refunded'
    : order.refund_status === 'partial' ? 'partial_refund'
    : order.status === 'held' ? 'held'
    : 'completed'

  const s = STATUS[key]
  return (
    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
      style={{background:s.bg, color:s.color}}>
      {s.label}
    </span>
  )
}

export default function RefundPanel({ onClose, preloadOrder = null }) {
  const { user, tenant } = useAuthStore()
  const { activeEmployee } = useEmployeeStore()
  const effCashierId   = activeEmployee?.id   || user?.id
  const effCashierName = activeEmployee?.name || user?.name

  // If this refund was approved via a manager-override on the Order Lookup
  // page, the approver info will be in sessionStorage. Consume it once.
  const [approver] = useState(() => {
    try {
      const raw = sessionStorage.getItem('refundApprover')
      if (!raw) return null
      sessionStorage.removeItem('refundApprover')
      return JSON.parse(raw)
    } catch { return null }
  })

  const { addProduct }   = useCartStore()
  const qc               = useQueryClient()

  const [mode, setMode]   = useState(preloadOrder ? 'by_invoice' : null) // 'by_item' | 'by_invoice'
  const [step, setStep]   = useState('select')

  // ── BY ITEM mode ──
  const [itemScan,    setItemScan]    = useState('')
  const [returnItems, setReturnItems] = useState([]) // [{product, qty}]
  const [showItemPad, setShowItemPad] = useState(false)
  const [editItemIdx, setEditItemIdx] = useState(null)
  const scanRef = useRef()

  // ── BY INVOICE mode ──
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(preloadOrder)
  const [returnQtys,    setReturnQtys]    = useState(() => {
    if (!preloadOrder?.order_items) return {}
    const init = {}
    preloadOrder.order_items.forEach(item => { init[item.id] = 0 })
    return init
  })
  const [showQtyPad,    setShowQtyPad]    = useState(null) // itemId
  const [qtyPadValue,   setQtyPadValue]   = useState('')   // controlled NumPad input
  const [showKB,        setShowKB]        = useState(false)

  // PIN auth
  const [needPin, setNeedPin]     = useState(false)
  const [pin,     setPin]         = useState('')
  const [pinErr,  setPinErr]      = useState(false)
  const [authBy,  setAuthBy]      = useState(null)

  // Processing
  const [processing, setProcessing] = useState(false)
  const [done,       setDone]       = useState(false)
  const [summary,    setSummary]    = useState(null)
  const [openAmt,    setOpenAmt]    = useState('')
  const [openReason, setOpenReason] = useState('')

  useEffect(() => {
    if (step === 'scan' && scanRef.current) scanRef.current.focus()
  }, [step])

  // ── Search invoices ──
  const { data: searchResults = [], isLoading: searching } = useQuery({
    queryKey: ['refund-search', invoiceSearch, tenant?.id],
    queryFn: async () => {
      if (invoiceSearch.length < 2) return []
      const { data } = await supabase.from('orders')
        .select('*, order_items(*, products(name, unit, price, image_url)), customers(name)')
        .eq('tenant_id', tenant.id)
        .or(`order_number.ilike.%${invoiceSearch}%`)
        .in('status', ['completed','partially_refunded'])
        .order('created_at', { ascending: false })
        .limit(8)
      return data || []
    },
    enabled: invoiceSearch.length >= 2 && mode === 'by_invoice' && !selectedOrder,
  })

  // ── Card top-ups on the selected order (for reversal) ──────────────
  const { data: orderTopups = [] } = useQuery({
    queryKey: ['order-topups', selectedOrder?.id],
    queryFn: async () => {
      if (!selectedOrder?.id) return []
      const out = []
      // Member-card top-ups (customer_topups by order_id)
      const { data: mem } = await supabase.from('customer_topups')
        .select('id, customer_id, amount, paid_amount, bonus_amount')
        .eq('order_id', selectedOrder.id).gt('amount', 0)
      for (const m of (mem || [])) {
        const { data: cust } = await supabase.from('customers')
          .select('name, card_number, card_balance').eq('id', m.customer_id).maybeSingle()
        out.push({ kind:'member', id:m.id, topup:Number(m.amount), paid:Number(m.paid_amount ?? m.amount),
          customerId:m.customer_id, customerName:cust?.name, cardNumber:cust?.card_number, balance:Number(cust?.card_balance||0) })
      }
      // Gift-card top-ups (gift_card_transactions by order_id)
      const { data: gc } = await supabase.from('gift_card_transactions')
        .select('id, card_id, amount, paid_amount, type')
        .eq('order_id', selectedOrder.id).in('type', ['issue','topup'])
      for (const g of (gc || [])) {
        const { data: card } = await supabase.from('member_cards')
          .select('card_number, balance').eq('id', g.card_id).maybeSingle()
        out.push({ kind:'gift', id:g.id, topup:Number(g.amount), paid:Number(g.paid_amount ?? g.amount),
          cardNumber:card?.card_number, balance:Number(card?.balance||0) })
      }
      return out
    },
    enabled: !!selectedOrder?.id,
  })

  // ── Add a top-up reversal to the cart (verify balance / override) ──
  const reverseTopup = (tu) => {
    const enough = tu.balance >= tu.topup
    const allowNegative = !enough && !!approver  // manager override required when short
    if (!enough && !approver) {
      toast.error(`Card balance $${tu.balance.toFixed(2)} < top-up $${tu.topup.toFixed(2)} — manager override required to reverse`, { duration: 6000 })
      return
    }
    useCartStore.getState().addCardReversal({
      cardKind: tu.kind,
      topupAmount: tu.topup,
      paymentAmount: tu.paid,         // refunded to customer (editable in cart)
      allowNegative,
      cardNumber: tu.cardNumber,
      customerId: tu.customerId,
      customerName: tu.customerName,
      origOrderId: selectedOrder.id,
      origOrderNumber: selectedOrder.order_number,
    })
    toast.success(`↩ Refund added to cart — reverse $${tu.topup.toFixed(2)} off card, refund $${tu.paid.toFixed(2)}`)
    onClose()
  }

  // ── Scan product for by_item ──
  const handleProductScan = async (e) => {
    if (e.key !== 'Enter') return
    const code = itemScan.trim()
    if (!code) return
    setItemScan('')

    const { data: product } = await supabase.from('products')
      .select('id, name, price, unit, image_url, upc, sku')
      .eq('tenant_id', tenant.id)
      .or(`upc.eq.${code},sku.eq.${code}`)
      .eq('is_active', true)
      .maybeSingle()

    if (!product) { toast.error('Product not found: ' + code); return }

    setReturnItems(prev => {
      const existing = prev.findIndex(i => i.product.id === product.id)
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing].qty += 1
        return updated
      }
      return [...prev, { product, qty: 1 }]
    })
    toast.success('Added: ' + product.name)
  }

  // ── Confirm return by item → add negative to cart ──
  const confirmByItem = () => {
    if (returnItems.length === 0) { toast.error('No items added'); return }
    returnItems.forEach(({ product, qty }) => {
      const p = { ...product, price: product.price }
      // Add as negative qty
      useCartStore.getState()._addItem({
        productId: p.id, name: p.name, unitPrice: p.price,
        qty: -qty, unit: p.unit, image_url: p.image_url,
        isReturn: true,
      })
    })
    toast.success(`↩ ${returnItems.length} item(s) added as return`)
    onClose()
  }

  // ── Select order for by_invoice ──
  const selectOrder = (order) => {
    setSelectedOrder(order)
    // Init return qty to 0 for each item
    const init = {}
    order.order_items?.forEach(item => { init[item.id] = 0 })
    setReturnQtys(init)
  }

  // ── Open-amount refund → add a custom refund line to cart ──────────
  const confirmOpenAmount = () => {
    const amt = parseFloat(openAmt)
    if (!amt || amt <= 0) { toast.error('Enter a refund amount'); return }
    useCartStore.getState()._addItem({
      productId: null,
      name: openReason.trim() ? `↩ Refund — ${openReason.trim()}` : '↩ Refund — Open Amount',
      unitPrice: amt,
      qty: -1,
      unit: 'ea',
      type: 'service',          // non-inventory
      isTaxable: false,
      isReturn: true,
    })
    toast.success(`↩ $${amt.toFixed(2)} refund added — complete at checkout`)
    onClose()
  }

  // ── Confirm return by invoice → add to cart (executes on checkout) ──
  const confirmByInvoice = async () => {
    const itemsToReturn = Object.entries(returnQtys)
      .filter(([,qty]) => qty > 0)
      .map(([id, qty]) => {
        const item = selectedOrder.order_items.find(i => i.id === id)
        return { item, qty }
      })

    if (itemsToReturn.length === 0) { toast.error('Select items to return'); return }

    // Validate qty
    for (const { item, qty } of itemsToReturn) {
      const alreadyReturned = item.returned_qty || 0
      const maxReturn = item.quantity - alreadyReturned
      if (qty > maxReturn) {
        toast.error(`${item.products?.name}: max ${maxReturn} can be returned`)
        return
      }
    }

    // Add negative items to cart at the PAID unit price. Nothing is written
    // to the DB now — the refund (returned_qty, refund_status, refund
    // record, inventory restore) is executed only when the refund order is
    // completed at checkout. Cancel = nothing happens. Each line carries
    // the info needed to finalize on completion, and the price stays
    // editable in the cart so the cashier can adjust the refund.
    itemsToReturn.forEach(({ item, qty }) => {
      const paidPerUnit = (item.paid_unit_price !== null && item.paid_unit_price !== undefined)
        ? Number(item.paid_unit_price)
        : Number(item.unit_price)
      useCartStore.getState()._addItem({
        productId:  item.product_id,
        name:       item.products?.name || 'Item',
        unitPrice:  paidPerUnit,
        qty:        -qty,
        unit:       item.products?.unit || 'ea',
        isReturn:   true,
        refund: {
          origOrderId:     selectedOrder.id,
          origOrderNumber: selectedOrder.order_number,
          orderItemId:     item.id,
          approverId:      approver?.id || null,
          approverName:    approver?.name || null,
        },
      })
    })
    toast.success(`↩ ${itemsToReturn.length} item(s) added as return — complete at checkout`)
    onClose()
  }

  // Effective per-unit refund price: what the customer actually paid.
  // Falls back to sticker price for legacy orders missing paid_unit_price.
  const refundUnit = (item) =>
    (item?.paid_unit_price !== null && item?.paid_unit_price !== undefined)
      ? Number(item.paid_unit_price)
      : Number(item?.unit_price || 0)

  const totalReturnAmt = returnItems.reduce((s,{product,qty}) => s+product.price*qty, 0)
  const invoiceReturnAmt = Object.entries(returnQtys).reduce((s,[id,qty]) => {
    const item = selectedOrder?.order_items?.find(i=>i.id===id)
    return s + refundUnit(item) * qty
  }, 0)

  // ─────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-stretch"
      style={{background:'rgba(0,0,0,0.4)', backdropFilter:'blur(2px)'}}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ml-auto flex flex-col shadow-md overflow-hidden"
        style={{width:'520px', background:'#fff'}}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{background:'#000000', color:'#fff'}}>
          <span className="text-[22px]">↩</span>
          <div>
            <div className="text-[16px] font-bold">Return / Refund</div>
            <div className="text-[11px] opacity-70">Process customer returns</div>
          </div>
          <button onClick={onClose}
            className="ml-auto w-8 h-8 rounded-full flex items-center justify-center bg-white/20 border-none cursor-pointer text-white text-[16px]">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ── DONE ── */}
          {done && summary && (
            <div className="flex flex-col items-center p-8 text-center">
              <div className="text-[52px] mb-3">✅</div>
              <div className="text-[18px] font-bold text-slate-800 mb-1">Return Processed</div>
              <div className="text-[13px] text-slate-500 mb-4">
                Items added to cart as negative
              </div>
              <div className="rounded-2xl p-4 w-full mb-4 text-left"
                style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                {summary.items.map(({item,qty},i) => (
                  <div key={i} className="flex justify-between py-1.5 text-[13px]"
                    style={{borderBottom: i<summary.items.length-1 ? '1px solid #f1f5f9':'none'}}>
                    <span className="text-slate-700">{item.products?.name} × {qty}</span>
                    <span className="font-mono text-red-500">-${(refundUnit(item)*qty).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 font-bold text-[14px]">
                  <span>Total Return</span>
                  <span className="font-mono text-red-600">-${summary.total.toFixed(2)}</span>
                </div>
              </div>
              <div className="flex gap-3 w-full">
                <button onClick={onClose}
                  className="flex-1 rounded-xl py-3 text-[13px] font-bold text-white cursor-pointer border-none"
                  style={{background:'#000000'}}>
                  Continue to Payment
                </button>
              </div>
            </div>
          )}

          {/* ── SELECT MODE ── */}
          {!done && !mode && (
            <div className="p-6">
              <div className="text-[13px] font-semibold text-slate-600 mb-4">
                Select return method:
              </div>
              <div className="flex flex-col gap-3">

                {/* By Item */}
                <button onClick={() => setMode('by_item')}
                  className="flex items-center gap-4 p-5 rounded-2xl text-left cursor-pointer border-2 transition-all"
                  style={{border:'2px solid #e2e8f0', background:'#fff'}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#006AFF';e.currentTarget.style.background='#E6F0FF'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.background='#fff'}}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[24px] flex-shrink-0"
                    style={{background:'#E6F0FF'}}>
                    📦
                  </div>
                  <div>
                    <div className="text-[15px] font-bold text-slate-800">By Item</div>
                    <div className="text-[12px] text-slate-400 mt-0.5">
                      Scan or search items to return — no invoice needed
                    </div>
                  </div>
                  <span className="ml-auto text-slate-300 text-[20px]">›</span>
                </button>

                {/* By Invoice */}
                <button onClick={() => setMode('by_invoice')}
                  className="flex items-center gap-4 p-5 rounded-2xl text-left cursor-pointer border-2 transition-all"
                  style={{border:'2px solid #e2e8f0', background:'#fff'}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#006AFF';e.currentTarget.style.background='#faf5ff'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.background='#fff'}}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[24px] flex-shrink-0"
                    style={{background:'#ede9fe'}}>
                    🧾
                  </div>
                  <div>
                    <div className="text-[15px] font-bold text-slate-800">By Invoice</div>
                    <div className="text-[12px] text-slate-400 mt-0.5">
                      Look up original order — return only items from that order
                    </div>
                  </div>
                  <span className="ml-auto text-slate-300 text-[20px]">›</span>
                </button>

                {/* Open Amount */}
                <button onClick={() => setMode('open_amount')}
                  className="flex items-center gap-4 p-5 rounded-2xl text-left cursor-pointer border-2 transition-all"
                  style={{border:'2px solid #e2e8f0', background:'#fff'}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#ea580c';e.currentTarget.style.background='#fff7ed'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.background='#fff'}}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[24px] flex-shrink-0"
                    style={{background:'#ffedd5'}}>
                    💵
                  </div>
                  <div>
                    <div className="text-[15px] font-bold text-slate-800">Open Amount</div>
                    <div className="text-[12px] text-slate-400 mt-0.5">
                      Refund a custom dollar amount — no item or invoice needed
                    </div>
                  </div>
                  <span className="ml-auto text-slate-300 text-[20px]">›</span>
                </button>
              </div>
            </div>
          )}

          {/* ── BY ITEM MODE ── */}
          {!done && mode === 'by_item' && (
            <div className="p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <button onClick={() => setMode(null)}
                  className="text-slate-400 bg-transparent border-none cursor-pointer text-[14px]">‹ Back</button>
                <div className="text-[14px] font-bold text-slate-700">Return by Item</div>
              </div>

              {/* Scan input */}
              <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
                <div className="px-4 py-3 flex items-center gap-3"
                  style={{background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>
                  <span className="text-[18px]">🔍</span>
                  <input ref={scanRef}
                    value={itemScan} onChange={e=>setItemScan(e.target.value)}
                    onKeyDown={handleProductScan}
                    placeholder="Scan barcode or enter SKU/UPC..."
                    autoFocus
                    className="flex-1 border-none outline-none text-[13px] bg-transparent"
                    style={{color:'#1F1F1F'}}/>
                </div>

                {/* Item list */}
                {returnItems.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-slate-300">
                    <div className="text-[32px] mb-2">📦</div>
                    <div className="text-[12px]">Scan items to return</div>
                  </div>
                ) : (
                  <div>
                    {returnItems.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3 px-4 py-3 border-b"
                        style={{borderColor:'#f1f5f9'}}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0"
                          style={{background:'#000000'}}>
                          {item.product.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="text-[13px] font-semibold text-slate-700">{item.product.name}</div>
                          <div className="text-[11px] text-slate-400">${item.product.price} × {item.qty} = <span className="text-red-500 font-bold">-${(item.product.price*item.qty).toFixed(2)}</span></div>
                        </div>
                        {/* Qty controls */}
                        <div className="flex items-center gap-1">
                          <button onClick={() => setReturnItems(prev => prev.map((r,i) => i===idx ? {...r, qty: Math.max(1,r.qty-1)} : r))}
                            className="w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer border text-[18px] font-bold active:scale-90"
                            style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>−</button>
                          <button onClick={() => { setEditItemIdx(idx); setShowItemPad(true); setQtyPadValue(String(returnItems[idx]?.qty || '')) }}
                            className="min-w-[44px] h-10 px-2 rounded-lg text-[15px] font-bold text-center cursor-pointer border"
                            style={{background:'#eff6ff', borderColor:'#93c5fd', color:'#2563eb'}}>
                            {item.qty}
                          </button>
                          <button onClick={() => setReturnItems(prev => prev.map((r,i) => i===idx ? {...r, qty: r.qty+1} : r))}
                            className="w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer border text-[18px] font-bold active:scale-90"
                            style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>+</button>
                        </div>
                        <button onClick={() => setReturnItems(prev => prev.filter((_,i) => i!==idx))}
                          className="text-slate-400 hover:text-red-500 bg-transparent border-none cursor-pointer text-[18px] ml-1 w-8 h-8 flex items-center justify-center">✕</button>
                      </div>
                    ))}
                    {/* Total */}
                    <div className="flex justify-between px-4 py-3 font-bold"
                      style={{background:'#fef2f2'}}>
                      <span className="text-[13px] text-slate-600">Total Return</span>
                      <span className="font-mono text-[15px] text-red-600">-${totalReturnAmt.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>

              {returnItems.length > 0 && (
                <button onClick={confirmByItem}
                  className="w-full rounded-2xl py-4 text-[15px] font-bold text-white cursor-pointer border-none"
                  style={{background:'#000000'}}>
                  ↩ Add Returns to Cart
                </button>
              )}
            </div>
          )}

          {/* ── OPEN AMOUNT MODE ── */}
          {!done && mode === 'open_amount' && (
            <div className="p-5 flex flex-col gap-4">
              <button onClick={() => setShowOpenPad(true)}
                className="w-full rounded-2xl py-5 text-center cursor-pointer border-2 transition-all"
                style={{border: openAmt?'2px solid #fdba74':'2px dashed #e2e8f0', background: openAmt?'#fff7ed':'#f8fafc'}}>
                <div className="text-[11px] text-slate-400 mb-1">Refund Amount</div>
                <div className="text-[40px] font-bold font-mono" style={{color: openAmt?'#ea580c':'#94a3b8'}}>
                  ${openAmt ? parseFloat(openAmt).toFixed(2) : '0.00'}
                </div>
              </button>

              <div className="grid grid-cols-4 gap-2">
                {[5,10,20,50].map(q => (
                  <button key={q} onClick={() => setOpenAmt(String(q))}
                    className="rounded-xl py-2.5 text-[13px] font-bold cursor-pointer border-2 transition-all"
                    style={parseFloat(openAmt)===q
                      ? {background:'#ea580c', borderColor:'#ea580c', color:'#fff'}
                      : {background:'#fff7ed', borderColor:'#fed7aa', color:'#ea580c'}}>
                    ${q}
                  </button>
                ))}
              </div>

              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Reason / note (optional)</div>
                <input value={openReason} onChange={e=>setOpenReason(e.target.value)}
                  placeholder="e.g. price adjustment, goodwill"
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
              </div>

              <div className="rounded-xl p-3 text-[11px]"
                style={{background:'#fff7ed', color:'#9a3412', border:'1px solid #fed7aa'}}>
                💡 Adds a custom refund to the cart. It's editable there and only completes when you check out.
              </div>

              <div className="flex gap-2">
                <button onClick={() => { setMode(null); setOpenAmt(''); setOpenReason('') }}
                  className="flex-1 rounded-xl py-3 text-[13px] font-bold cursor-pointer border"
                  style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>‹ Back</button>
                <button onClick={confirmOpenAmount} disabled={!openAmt}
                  className="flex-[2] rounded-xl py-3 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                  style={{background:'#ea580c'}}>
                  ↩ Add ${openAmt ? parseFloat(openAmt).toFixed(2) : '0.00'} Refund to Cart
                </button>
              </div>

              {showOpenPad && (
                <NumPad title="Refund Amount" prefix="$"
                  value={openAmt} onChange={setOpenAmt}
                  allowNegative={false} allowDecimal={true}
                  onConfirm={v => { setOpenAmt(v.toFixed(2)); setShowOpenPad(false) }}
                  onClose={() => setShowOpenPad(false)}/>
              )}
            </div>
          )}

          {/* ── BY INVOICE MODE ── */}
          {!done && mode === 'by_invoice' && (
            <div className="p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <button onClick={() => { setMode(null); setSelectedOrder(null) }}
                  className="text-slate-400 bg-transparent border-none cursor-pointer text-[14px]">‹ Back</button>
                <div className="text-[14px] font-bold text-slate-700">Return by Invoice</div>
              </div>

              {approver && (
                <div className="rounded-xl px-3 py-2 text-[11px]"
                  style={{background:'#faf5ff', border:'1px solid #e9d5ff', color:'#7c2d92'}}>
                  🔐 <b>Manager Override active:</b> approved by {approver.name} — this refund will be logged with their authorization
                </div>
              )}

              {/* Step 1: Search invoice */}
              {!selectedOrder && (
                <>
                  <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
                    <div className="px-4 py-3 flex items-center gap-3"
                      style={{background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>
                      <span className="text-[18px]">🔍</span>
                      <button onClick={() => setShowKB(true)}
                        className="flex-1 text-left border-none outline-none text-[13px] bg-transparent cursor-pointer"
                        style={{color: invoiceSearch ? '#1F1F1F' : '#94a3b8'}}>
                        {invoiceSearch || 'Scan or enter invoice number...'}
                      </button>
                      {invoiceSearch && (
                        <button onClick={() => setInvoiceSearch('')}
                          className="text-slate-400 bg-transparent border-none cursor-pointer">✕</button>
                      )}
                    </div>

                    {/* Results */}
                    {searching && <div className="text-center py-4 text-slate-400 text-[12px]">Searching...</div>}
                    {searchResults.map(order => (
                      <button key={order.id} onClick={() => selectOrder(order)}
                        className="w-full flex items-center gap-3 px-4 py-3 border-b text-left cursor-pointer hover:bg-blue-50 transition-colors"
                        style={{borderColor:'#f1f5f9'}}>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold text-indigo-600">{order.order_number}</span>
                            <OrderStatusBadge order={order}/>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {new Date(order.created_at).toLocaleDateString()} ·
                            {order.customers?.name || 'Walk-in'} ·
                            ${order.grand_total?.toFixed(2)}
                          </div>
                        </div>
                        <span className="text-slate-300 text-[18px]">›</span>
                      </button>
                    ))}
                    {invoiceSearch.length >= 2 && !searching && searchResults.length === 0 && (
                      <div className="text-center py-4 text-slate-400 text-[12px]">No orders found</div>
                    )}
                  </div>
                </>
              )}

              {/* Step 2: Select items from order */}
              {selectedOrder && (
                <>
                  {/* Order header */}
                  <div className="rounded-2xl p-4" style={{background:'#E6F0FF', border:'1.5px solid #B3D1FF'}}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-bold text-indigo-700">{selectedOrder.order_number}</span>
                        <OrderStatusBadge order={selectedOrder}/>
                      </div>
                      <button onClick={() => setSelectedOrder(null)}
                        className="text-[11px] text-indigo-500 bg-transparent border-none cursor-pointer">
                        Change
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {new Date(selectedOrder.created_at).toLocaleDateString()} ·
                      {selectedOrder.customers?.name || 'Walk-in'} ·
                      Original: ${selectedOrder.grand_total?.toFixed(2)}
                    </div>
                  </div>

                  {/* Card top-up reversal (if this order loaded a card) */}
                  {orderTopups.length > 0 && (
                    <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #fed7aa', background:'#fff7ed'}}>
                      <div className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{color:'#c2410c', borderBottom:'1px solid #fed7aa'}}>
                        💳 Card top-up on this order — reverse it
                      </div>
                      {orderTopups.map(tu => {
                        const enough = tu.balance >= tu.topup
                        return (
                          <div key={tu.id} className="px-4 py-3 flex items-center gap-3 border-b border-orange-100 last:border-0">
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-bold" style={{color:'#1F1F1F'}}>
                                {tu.kind === 'member' ? '👤 Member' : '🎁 Gift'} top-up ${tu.topup.toFixed(2)}
                                {tu.cardNumber && <span className="text-[11px] font-mono text-slate-500"> · #{tu.cardNumber}</span>}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Paid ${tu.paid.toFixed(2)} · Card balance now ${tu.balance.toFixed(2)}
                              </div>
                              {!enough && (
                                <div className="text-[11px] font-bold mt-0.5" style={{color:'#dc2626'}}>
                                  ⚠️ Balance too low to reverse — {approver ? `override by ${approver.name} OK` : 'manager override required'}
                                </div>
                              )}
                            </div>
                            <button onClick={() => reverseTopup(tu)}
                              disabled={!enough && !approver}
                              className="rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer border-none text-white disabled:opacity-40"
                              style={{background: enough ? '#ea580c' : '#dc2626'}}>
                              ↩ Reverse
                            </button>
                          </div>
                        )
                      })}
                      <div className="px-4 py-2 text-[10px] text-slate-500" style={{background:'#fffbeb'}}>
                        Reverses the top-up off the card and adds a refund to the cart (editable). Completes when you check out.
                      </div>
                    </div>
                  )}

                  {/* Items */}
                  <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
                    <div className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider"
                      style={{background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>
                      Select items and quantities to return
                    </div>
                    {selectedOrder.order_items?.map(item => {
                      const alreadyReturned = item.returned_qty || 0
                      const maxQty = item.quantity - alreadyReturned
                      const retQty = returnQtys[item.id] || 0
                      const canReturn = maxQty > 0

                      return (
                        <div key={item.id}
                          className="flex items-center gap-3 px-4 py-3 border-b transition-colors"
                          style={{
                            borderColor:'#f1f5f9',
                            background: retQty > 0 ? '#fef2f2' : '#fff',
                            opacity: canReturn ? 1 : 0.5,
                          }}>
                          <div className="flex-1">
                            <div className="text-[13px] font-semibold text-slate-700">
                              {item.products?.name}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              Qty: {item.quantity} {item.products?.unit} ·
                              {' '}
                              {item.paid_unit_price && Math.abs(item.paid_unit_price - item.unit_price) > 0.01 ? (
                                <>
                                  <span className="line-through font-mono">${item.unit_price?.toFixed(2)}</span>
                                  {' '}
                                  <span className="font-mono font-bold text-green-700">${Number(item.paid_unit_price).toFixed(2)}/ea</span>
                                  <span className="ml-1 px-1 rounded text-[9px] font-bold"
                                    style={{background:'#dcfce7', color:'#166534'}}>BULK</span>
                                </>
                              ) : (
                                <span className="font-mono">${item.unit_price?.toFixed(2)}/ea</span>
                              )}
                              {alreadyReturned > 0 && (
                                <span className="text-orange-500 ml-1">
                                  · {alreadyReturned} already returned
                                </span>
                              )}
                            </div>
                          </div>

                          {canReturn ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setReturnQtys(q => ({...q, [item.id]: Math.max(0,(q[item.id]||0)-1)}))}
                                className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border text-[16px] font-bold"
                                style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>−</button>
                              <button onClick={() => { setShowQtyPad(item.id); setQtyPadValue(String(retQty || '')) }}
                                className="w-12 h-8 rounded-lg text-[14px] font-bold text-center cursor-pointer"
                                style={{
                                  background: retQty > 0 ? '#fee2e2' : '#f8fafc',
                                  border: `1.5px solid ${retQty > 0 ? '#fca5a5' : '#e2e8f0'}`,
                                  color: retQty > 0 ? '#dc2626' : '#94a3b8',
                                }}>
                                {retQty}/{maxQty}
                              </button>
                              <button
                                onClick={() => setReturnQtys(q => ({...q, [item.id]: Math.min(maxQty,(q[item.id]||0)+1)}))}
                                className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border text-[16px] font-bold"
                                style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>+</button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-semibold">All Returned</span>
                          )}
                        </div>
                      )
                    })}

                    {/* Total */}
                    {invoiceReturnAmt > 0 && (
                      <div className="flex justify-between px-4 py-3 font-bold"
                        style={{background:'#fef2f2'}}>
                        <span className="text-[13px] text-slate-600">Return Total</span>
                        <span className="font-mono text-[15px] text-red-600">-${invoiceReturnAmt.toFixed(2)}</span>
                      </div>
                    )}
                  </div>

                  <button onClick={confirmByInvoice}
                    disabled={processing || invoiceReturnAmt === 0}
                    className="w-full rounded-2xl py-4 text-[15px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                    style={{background:'#000000'}}>
                    {processing ? '⏳ Processing...' : `↩ Confirm Return — $${invoiceReturnAmt.toFixed(2)}`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* NumPad for item qty */}
      {showItemPad && editItemIdx !== null && (
        <NumPad title="Return Quantity"
          subtitle={returnItems[editItemIdx]?.product.name}
          value={qtyPadValue}
          onChange={setQtyPadValue}
          allowNegative={false} allowDecimal={false}
          onConfirm={v => {
            setReturnItems(prev => prev.map((r,i) => i===editItemIdx ? {...r, qty: Math.max(1,Math.round(v))} : r))
            setShowItemPad(false); setEditItemIdx(null); setQtyPadValue('')
          }}
          onClose={() => { setShowItemPad(false); setEditItemIdx(null); setQtyPadValue('') }}/>
      )}

      {/* NumPad for invoice item qty */}
      {showQtyPad && (
        <NumPad title="Return Quantity"
          subtitle={selectedOrder?.order_items?.find(i=>i.id===showQtyPad)?.products?.name}
          value={qtyPadValue}
          onChange={setQtyPadValue}
          allowNegative={false} allowDecimal={false}
          onConfirm={v => {
            const item = selectedOrder.order_items.find(i=>i.id===showQtyPad)
            const max  = (item?.quantity||0) - (item?.returned_qty||0)
            setReturnQtys(q => ({...q, [showQtyPad]: Math.min(max, Math.max(0, Math.round(v)))}))
            setShowQtyPad(null)
            setQtyPadValue('')
          }}
          onClose={() => { setShowQtyPad(null); setQtyPadValue('') }}/>
      )}

      {/* Keyboard for invoice search */}
      {showKB && (
        <TouchKeyboard
          title="Invoice Number"
          value={invoiceSearch}
          onChange={setInvoiceSearch}
          placeholder="Enter invoice number..."
          onDone={() => setShowKB(false)}
          onClose={() => setShowKB(false)}/>
      )}
    </div>
  )
}
