// src/pages/pos/panels/RefundPanel.jsx
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
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
    refunded:  { bg:'#fdf4ff', color:'#9333ea', label:'Refunded' },
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
  const { addProduct }   = useCartStore()
  const qc               = useQueryClient()

  const [mode, setMode]   = useState(null) // 'by_item' | 'by_invoice'
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
  const [returnQtys,    setReturnQtys]    = useState({}) // {itemId: qty}
  const [showQtyPad,    setShowQtyPad]    = useState(null) // itemId
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

  // ── Confirm return by invoice ──
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

    setProcessing(true)
    try {
      const totalRefund = itemsToReturn.reduce((s, {item, qty}) =>
        s + (item.unit_price * qty), 0)

      // Update order_items returned_qty
      for (const { item, qty } of itemsToReturn) {
        await supabase.from('order_items')
          .update({ returned_qty: (item.returned_qty||0) + qty })
          .eq('id', item.id)
      }

      // Update order refund_status
      const allItems = selectedOrder.order_items
      const totalOrigQty = allItems.reduce((s,i) => s+i.quantity, 0)
      const totalReturnQty = allItems.reduce((s,i) => {
        const extra = itemsToReturn.find(r => r.item.id === i.id)?.qty || 0
        return s + (i.returned_qty||0) + extra
      }, 0)
      const refundStatus = totalReturnQty >= totalOrigQty ? 'full' : 'partial'

      await supabase.from('orders')
        .update({
          refund_status: refundStatus,
          refunded_amount: (selectedOrder.refunded_amount||0) + totalRefund,
          refunded_at: new Date().toISOString(),
          refunded_by: user?.id,
          refunded_by_name: user?.name,
        })
        .eq('id', selectedOrder.id)

      // Record refund
      await supabase.from('refund_records').insert({
        tenant_id:   tenant.id,
        original_order_id: selectedOrder.id,
        original_order_number: selectedOrder.order_number,
        mode: 'by_invoice',
        amount: totalRefund,
        items: itemsToReturn.map(({item,qty}) => ({
          product_id: item.product_id,
          name: item.products?.name,
          qty, unit_price: item.unit_price,
        })),
        refunded_by: user?.id,
        refunded_by_name: user?.name,
      })

      // Add negative items to cart
      itemsToReturn.forEach(({ item, qty }) => {
        useCartStore.getState()._addItem({
          productId:  item.product_id,
          name:       item.products?.name || 'Item',
          unitPrice:  item.unit_price,
          qty:        -qty,
          unit:       item.products?.unit || 'ea',
          isReturn:   true,
          refundOrderId: selectedOrder.id,
        })
      })

      qc.invalidateQueries(['orders'])
      setSummary({ items: itemsToReturn, total: totalRefund, order: selectedOrder })
      setDone(true)
      toast.success(`↩ Return processed: $${totalRefund.toFixed(2)}`)
    } catch(err) {
      toast.error('Error: ' + err.message)
    } finally {
      setProcessing(false)
    }
  }

  const totalReturnAmt = returnItems.reduce((s,{product,qty}) => s+product.price*qty, 0)
  const invoiceReturnAmt = Object.entries(returnQtys).reduce((s,[id,qty]) => {
    const item = selectedOrder?.order_items?.find(i=>i.id===id)
    return s + (item?.unit_price||0)*qty
  }, 0)

  // ─────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-stretch"
      style={{background:'rgba(15,23,42,0.7)', backdropFilter:'blur(6px)'}}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ml-auto flex flex-col shadow-2xl overflow-hidden"
        style={{width:'520px', background:'#fff'}}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{background:'linear-gradient(135deg,#7c3aed,#6366f1)', color:'#fff'}}>
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
                    <span className="font-mono text-red-500">-${(item.unit_price*qty).toFixed(2)}</span>
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
                  style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
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
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#6366f1';e.currentTarget.style.background='#f0f4ff'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.background='#fff'}}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[24px] flex-shrink-0"
                    style={{background:'#e0e7ff'}}>
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
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#8b5cf6';e.currentTarget.style.background='#faf5ff'}}
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
                    style={{color:'#1e293b'}}/>
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
                          style={{background:'linear-gradient(135deg,#7c3aed,#6366f1)'}}>
                          {item.product.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="text-[13px] font-semibold text-slate-700">{item.product.name}</div>
                          <div className="text-[11px] text-slate-400">${item.product.price} × {item.qty} = <span className="text-red-500 font-bold">-${(item.product.price*item.qty).toFixed(2)}</span></div>
                        </div>
                        {/* Qty controls */}
                        <div className="flex items-center gap-1">
                          <button onClick={() => setReturnItems(prev => prev.map((r,i) => i===idx ? {...r, qty: Math.max(1,r.qty-1)} : r))}
                            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border"
                            style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>−</button>
                          <button onClick={() => { setEditItemIdx(idx); setShowItemPad(true) }}
                            className="w-10 h-7 rounded-lg text-[13px] font-bold text-center cursor-pointer border"
                            style={{background:'#eff6ff', borderColor:'#93c5fd', color:'#2563eb'}}>
                            {item.qty}
                          </button>
                          <button onClick={() => setReturnItems(prev => prev.map((r,i) => i===idx ? {...r, qty: r.qty+1} : r))}
                            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border"
                            style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>+</button>
                        </div>
                        <button onClick={() => setReturnItems(prev => prev.filter((_,i) => i!==idx))}
                          className="text-slate-400 hover:text-red-500 bg-transparent border-none cursor-pointer text-[16px] ml-1">✕</button>
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
                  style={{background:'linear-gradient(135deg,#7c3aed,#6366f1)'}}>
                  ↩ Add Returns to Cart
                </button>
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

              {/* Step 1: Search invoice */}
              {!selectedOrder && (
                <>
                  <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
                    <div className="px-4 py-3 flex items-center gap-3"
                      style={{background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>
                      <span className="text-[18px]">🔍</span>
                      <button onClick={() => setShowKB(true)}
                        className="flex-1 text-left border-none outline-none text-[13px] bg-transparent cursor-pointer"
                        style={{color: invoiceSearch ? '#1e293b' : '#94a3b8'}}>
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
                  <div className="rounded-2xl p-4" style={{background:'#f0f4ff', border:'1.5px solid #c7d2fe'}}>
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
                              ${item.unit_price?.toFixed(2)}/ea
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
                              <button onClick={() => setShowQtyPad(item.id)}
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
                    style={{background:'linear-gradient(135deg,#7c3aed,#6366f1)'}}>
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
          value={String(returnItems[editItemIdx]?.qty || '')}
          onChange={() => {}}
          allowNegative={false} allowDecimal={false}
          onConfirm={v => {
            setReturnItems(prev => prev.map((r,i) => i===editItemIdx ? {...r, qty: Math.max(1,Math.round(v))} : r))
            setShowItemPad(false); setEditItemIdx(null)
          }}
          onClose={() => { setShowItemPad(false); setEditItemIdx(null) }}/>
      )}

      {/* NumPad for invoice item qty */}
      {showQtyPad && (
        <NumPad title="Return Quantity"
          subtitle={selectedOrder?.order_items?.find(i=>i.id===showQtyPad)?.products?.name}
          value={String(returnQtys[showQtyPad] || '')}
          onChange={() => {}}
          allowNegative={false} allowDecimal={false}
          onConfirm={v => {
            const item = selectedOrder.order_items.find(i=>i.id===showQtyPad)
            const max  = (item?.quantity||0) - (item?.returned_qty||0)
            setReturnQtys(q => ({...q, [showQtyPad]: Math.min(max, Math.max(0, Math.round(v)))}))
            setShowQtyPad(null)
          }}
          onClose={() => setShowQtyPad(null)}/>
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
