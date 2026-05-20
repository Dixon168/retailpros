// src/pages/purchase-orders/POReceiveModal.jsx
// View a PO + receive its items (one-click receive all)

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { NumericKeypad, QWERTYKeyboard } from '@/components/ui/TouchKeyboards'
import DualInput from '@/components/ui/DualInput'
import ProductPicker from '@/components/inventory/ProductPicker'

const STATUS_BADGE = {
  draft:     { bg:'#F5F5F5', color:'#666', label:'Draft' },
  ordered:   { bg:'#E6F0FF', color:'#006AFF', label:'Ordered' },
  partial:   { bg:'#FEF3C7', color:'#B45309', label:'Partial' },
  received:  { bg:'#DCFCE7', color:'#15803D', label:'Received' },
  cancelled: { bg:'#FEE2E2', color:'#CF1322', label:'Cancelled' },
}

export default function POReceiveModal({ po, onClose, onChanged }) {
  const { tenant, store, user } = useAuthStore()
  const [receiveLines, setReceiveLines] = useState([])  // [{po_item_id, product_id, product_name, ordered, already_received, qty_to_receive, unit_cost}]
  const [extraItems, setExtraItems]     = useState([])  // [{product_id, product_name, quantity, unit_cost}] — added at receiving
  const [showProductPicker, setShowProductPicker] = useState(false)
  const [saving, setSaving] = useState(false)

  // Fetch PO details
  const { data: poDetail, isLoading } = useQuery({
    queryKey: ['po-detail', po.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          suppliers(name, contact_name, email, phone),
          purchase_order_items(*)
        `)
        .eq('id', po.id).eq('tenant_id', tenant.id).single()
      if (error) throw error
      return data
    },
  })

  // Initialize receive lines when PO loads
  useEffect(() => {
    if (!poDetail?.purchase_order_items) return
    const lines = poDetail.purchase_order_items.map(it => {
      const ordered = it.quantity || 0
      const alreadyReceived = it.received || 0
      const remaining = Math.max(0, ordered - alreadyReceived)
      return {
        po_item_id:        it.id,
        product_id:        it.product_id,
        product_name:      it.product_name,
        ordered,
        already_received:  alreadyReceived,
        qty_to_receive:    String(remaining),  // default: remaining
        unit_cost:         String(it.received_unit_cost || it.unit_cost || 0),
      }
    })
    setReceiveLines(lines)
  }, [poDetail])

  // Totals — must be declared BEFORE any early return so the hook order
  // stays stable across the loading and loaded renders (React error #310).
  const totalToReceive = useMemo(() => {
    const main = receiveLines.reduce((s, l) =>
      s + (parseFloat(l.qty_to_receive) || 0) * (parseFloat(l.unit_cost) || 0), 0)
    const extras = extraItems.reduce((s, e) =>
      s + (parseFloat(e.quantity) || 0) * (parseFloat(e.unit_cost) || 0), 0)
    return main + extras
  }, [receiveLines, extraItems])

  if (isLoading || !poDetail) {
    return (
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="bg-white rounded-2xl p-12 text-[#666]">Loading...</div>
      </div>
    )
  }

  const status = STATUS_BADGE[poDetail.status]
  const isReadOnly = poDetail.status === 'received' || poDetail.status === 'cancelled'
  const vendor = poDetail.suppliers

  const updateLine = (idx, field, value) => {
    setReceiveLines(receiveLines.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  const updateExtra = (idx, field, value) => {
    setExtraItems(extraItems.map((e, i) => i === idx ? { ...e, [field]: value } : e))
  }

  const removeExtra = (idx) => setExtraItems(extraItems.filter((_, i) => i !== idx))

  const addExtraProduct = (product) => {
    if (extraItems.find(e => e.product_id === product.id) ||
        receiveLines.find(l => l.product_id === product.id)) {
      toast.error(`${product.name} is already in this PO`)
      return
    }
    setExtraItems([...extraItems, {
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      quantity: '1',
      unit_cost: String(product.cost || 0),
    }])
    setShowProductPicker(false)
  }

  const receiveAll = async () => {
    // Build items for the RPC
    const items = []

    // Existing PO lines
    receiveLines.forEach(l => {
      const qty = parseFloat(l.qty_to_receive) || 0
      const cost = parseFloat(l.unit_cost) || 0
      if (qty > 0) {
        items.push({
          po_item_id:         l.po_item_id,
          product_id:         l.product_id,
          qty_received:       qty,
          received_unit_cost: cost,
        })
      }
    })

    // Extra items added at receiving
    extraItems.forEach(e => {
      const qty = parseFloat(e.quantity) || 0
      const cost = parseFloat(e.unit_cost) || 0
      if (qty > 0) {
        items.push({
          po_item_id:         null,  // signals: new line
          product_id:         e.product_id,
          qty_received:       qty,
          received_unit_cost: cost,
        })
      }
    })

    if (items.length === 0) {
      toast.error('Nothing to receive — set quantities first')
      return
    }

    setSaving(true)
    const { data, error } = await supabase.rpc('fn_receive_po_atomic', {
      p_tenant_id: tenant.id,
      p_store_id:  store.id,
      p_po_id:     po.id,
      p_user_id:   user?.id || null,
      p_items:     items,
    })
    setSaving(false)

    if (error || !data?.success) {
      toast.error(error?.message || data?.message || 'Failed to receive')
      return
    }
    toast.success(`✅ Received ${items.length} line(s) into stock`)
    onChanged?.()
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="rounded-2xl overflow-hidden flex flex-col" style={{
          width:'780px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
          boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
        }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-start justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[15px] font-bold text-[#006AFF]">{poDetail.po_number}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={{background:status.bg, color:status.color}}>
                  {status.label}
                </span>
              </div>
              <div className="text-[14px] font-bold text-[#1F1F1F]">{vendor?.name || 'Unknown vendor'}</div>
              <div className="text-[11px] text-[#666] mt-0.5">
                {[
                  poDetail.ordered_at && `Ordered ${new Date(poDetail.ordered_at).toLocaleDateString()}`,
                  poDetail.expected_date && `Expected ${new Date(poDetail.expected_date).toLocaleDateString()}`,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
              style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Notes */}
            {poDetail.notes && (
              <div className="rounded-lg p-3" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
                <div className="text-[10px] font-bold text-[#666] uppercase mb-1">PO Notes</div>
                <div className="text-[12px] text-[#1F1F1F] whitespace-pre-wrap">{poDetail.notes}</div>
              </div>
            )}

            {/* Items table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-bold text-[#1F1F1F]">
                  {isReadOnly ? 'Items received' : `Receive items (${receiveLines.length} line${receiveLines.length !== 1 ? 's' : ''})`}
                </div>
                {!isReadOnly && (
                  <button onClick={() => setShowProductPicker(true)}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                    style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #006AFF'}}>
                    + Add Extra Item
                  </button>
                )}
              </div>

              <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
                <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
                  style={{gridTemplateColumns:'1fr 100px 110px 110px 44px'}}>
                  {['Product','Qty','Price','Subtotal',''].map((h,i) => (
                    <div key={i} className="px-2.5 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                  ))}
                </div>

                {/* Original PO lines */}
                {receiveLines.map((line, idx) => {
                  const qty = parseFloat(line.qty_to_receive) || 0
                  const cost = parseFloat(line.unit_cost) || 0
                  const sub = qty * cost
                  return (
                    <div key={line.po_item_id} className="grid border-b border-[#E5E5E5] items-center"
                      style={{gridTemplateColumns:'1fr 100px 110px 110px 44px'}}>
                      <div className="px-2.5 py-2.5">
                        <div className="text-[12px] font-bold text-[#1F1F1F] truncate">
                          {line.product_name}
                        </div>
                        {line.ordered != null && (
                          <div className="text-[9px] text-[#999]">Ordered {line.ordered}</div>
                        )}
                      </div>
                      <div className="px-2 py-2.5">
                        <DualInput compact mode="decimal"
                          value={line.qty_to_receive}
                          onChange={(v) => updateLine(idx, 'qty_to_receive', v)}
                          kbTitle={`Qty: ${line.product_name}`}/>
                      </div>
                      <div className="px-2 py-2.5">
                        <DualInput compact mode="decimal" prefix="$"
                          value={line.unit_cost}
                          onChange={(v) => updateLine(idx, 'unit_cost', v)}
                          kbTitle={`Price: ${line.product_name}`}/>
                      </div>
                      <div className="px-3 py-2.5 text-right font-mono text-[13px] font-bold text-[#1F1F1F]">
                        ${sub.toFixed(2)}
                      </div>
                      <div className="px-2 py-2.5"></div>
                    </div>
                  )
                })}

                {/* Extra items */}
                {extraItems.map((item, idx) => {
                  const qty = parseFloat(item.quantity) || 0
                  const cost = parseFloat(item.unit_cost) || 0
                  const sub = qty * cost
                  return (
                    <div key={`extra-${idx}`} className="grid border-b border-[#E5E5E5] items-center"
                      style={{gridTemplateColumns:'1fr 100px 110px 110px 44px', background:'#F5F8FF'}}>
                      <div className="px-2.5 py-2.5">
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded mr-1"
                          style={{background:'#006AFF', color:'#FFFFFF'}}>NEW</span>
                        <span className="text-[12px] font-bold text-[#1F1F1F]">{item.product_name}</span>
                      </div>
                      <div className="px-2 py-2.5">
                        <DualInput compact mode="decimal"
                          value={item.quantity}
                          onChange={(v) => updateExtra(idx, 'quantity', v)}
                          kbTitle={`Qty: ${item.product_name}`}/>
                      </div>
                      <div className="px-2 py-2.5">
                        <DualInput compact mode="decimal" prefix="$"
                          value={item.unit_cost}
                          onChange={(v) => updateExtra(idx, 'unit_cost', v)}
                          kbTitle={`Price: ${item.product_name}`}/>
                      </div>
                      <div className="px-3 py-2.5 text-right font-mono text-[13px] font-bold text-[#006AFF]">
                        ${sub.toFixed(2)}
                      </div>
                      <div className="px-2 py-2.5 flex items-center justify-center">
                        <button onClick={() => removeExtra(idx)}
                          className="w-7 h-7 rounded text-[14px] cursor-pointer"
                          style={{background:'#FEE2E2', color:'#CF1322', border:'none'}}>×</button>
                      </div>
                    </div>
                  )
                })}

                {/* Total row */}
                <div className="grid bg-[#F5F5F5]" style={{gridTemplateColumns:'1fr 100px 110px 110px 44px'}}>
                  <div className="col-span-3 px-3 py-3 text-right text-[12px] font-bold text-[#666] uppercase">
                    Total
                  </div>
                  <div className="px-3 py-3 text-right font-mono text-[16px] font-bold text-[#1F1F1F]">
                    ${(isReadOnly ? poDetail.total : totalToReceive).toFixed(2)}
                  </div>
                  <div className="px-2 py-3"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 flex gap-2 flex-shrink-0" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onClose}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              {isReadOnly ? 'Close' : 'Cancel'}
            </button>
            {!isReadOnly && (
              <button onClick={receiveAll} disabled={saving || totalToReceive === 0}
                className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
                style={{background:'#15803D', color:'#FFFFFF', border:'none'}}>
                {saving ? 'Saving...' : `✓ Save · Add to Inventory — $${totalToReceive.toFixed(2)}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Product picker for extras */}
      {showProductPicker && (
        <ProductPicker
          title="Add Extra Product"
          vendorId={poDetail?.supplier_id}
          excludeIds={[
            ...receiveLines.map(l => l.product_id),
            ...extraItems.map(e => e.product_id),
          ]}
          onPick={addExtraProduct}
          onClose={() => setShowProductPicker(false)}
        />
      )}
    </>
  )
}
