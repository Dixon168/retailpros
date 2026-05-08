// src/pages/purchase-orders/POReceiveModal.jsx
// View a PO + receive its items (one-click receive all)

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { NumericKeypad, QWERTYKeyboard } from '@/components/ui/TouchKeyboards'

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
  const [editingField, setEditingField] = useState(null)
  const [showProductPicker, setShowProductPicker] = useState(false)
  const [productSearch, setProductSearch] = useState('')
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

  // Search products for adding extras
  const { data: searchResults = [] } = useQuery({
    queryKey: ['po-extra-search', tenant?.id, productSearch],
    queryFn: async () => {
      const q = productSearch.trim()
      if (q.length < 2) return []
      const { data } = await supabase.from('products')
        .select('id, name, sku, cost')
        .eq('tenant_id', tenant.id).neq('type', 'service')
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%`).limit(20)
      return data || []
    },
    enabled: productSearch.trim().length >= 2,
  })

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

  // Totals
  const totalToReceive = useMemo(() => {
    const main = receiveLines.reduce((s, l) =>
      s + (parseFloat(l.qty_to_receive) || 0) * (parseFloat(l.unit_cost) || 0), 0)
    const extras = extraItems.reduce((s, e) =>
      s + (parseFloat(e.quantity) || 0) * (parseFloat(e.unit_cost) || 0), 0)
    return main + extras
  }, [receiveLines, extraItems])

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
    setProductSearch('')
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
                  style={{gridTemplateColumns:'1fr 70px 70px 90px 90px 100px'}}>
                  {['Product','Ordered','Already','Receive Now','Unit Cost','Subtotal'].map(h => (
                    <div key={h} className="px-2.5 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                  ))}
                </div>

                {/* Original PO lines */}
                {receiveLines.map((line, idx) => {
                  const qty = parseFloat(line.qty_to_receive) || 0
                  const cost = parseFloat(line.unit_cost) || 0
                  const sub = qty * cost
                  const isFullyReceived = (line.already_received || 0) >= line.ordered
                  const overReceiving = qty + line.already_received > line.ordered
                  return (
                    <div key={line.po_item_id} className="grid border-b border-[#E5E5E5] items-center"
                      style={{gridTemplateColumns:'1fr 70px 70px 90px 90px 100px'}}>
                      <div className="px-2.5 py-2.5">
                        <div className="text-[12px] font-bold text-[#1F1F1F] truncate"
                          style={{opacity: isFullyReceived ? 0.5 : 1}}>
                          {line.product_name}
                        </div>
                        {isFullyReceived && (
                          <div className="text-[9px] font-bold text-[#15803D]">✅ Fully received</div>
                        )}
                        {overReceiving && (
                          <div className="text-[9px] font-bold text-[#B45309]">⚠️ Over by {(qty + line.already_received - line.ordered).toFixed(0)}</div>
                        )}
                      </div>
                      <div className="px-2.5 py-2.5 text-right font-mono text-[12px] text-[#666]">
                        {line.ordered}
                      </div>
                      <div className="px-2.5 py-2.5 text-right font-mono text-[12px] text-[#666]">
                        {line.already_received || 0}
                      </div>
                      <div className="px-2 py-2.5">
                        <button onClick={() => !isReadOnly && setEditingField({
                          kind:'main', idx, field:'qty_to_receive', title:`Receive: ${line.product_name}`
                        })}
                          disabled={isReadOnly}
                          className="w-full px-2 py-1.5 rounded text-right font-mono text-[12px] cursor-pointer disabled:cursor-default"
                          style={{
                            background: isReadOnly ? '#F5F5F5' : '#FFFFFF',
                            border: `1px solid ${overReceiving ? '#F59E0B' : qty > 0 ? '#006AFF' : '#E5E5E5'}`,
                            color: qty > 0 ? '#1F1F1F' : '#999'
                          }}>
                          {line.qty_to_receive || '0'}
                        </button>
                      </div>
                      <div className="px-2 py-2.5">
                        <button onClick={() => !isReadOnly && setEditingField({
                          kind:'main', idx, field:'unit_cost', title:`Cost: ${line.product_name}`
                        })}
                          disabled={isReadOnly}
                          className="w-full px-2 py-1.5 rounded text-right font-mono text-[12px] cursor-pointer disabled:cursor-default"
                          style={{background:'#F5F5F5', border:'1px solid #E5E5E5'}}>
                          ${line.unit_cost || '0'}
                        </button>
                      </div>
                      <div className="px-3 py-2.5 text-right font-mono text-[13px] font-bold text-[#1F1F1F]">
                        ${sub.toFixed(2)}
                      </div>
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
                      style={{gridTemplateColumns:'1fr 70px 70px 90px 90px 100px', background:'#F5F8FF'}}>
                      <div className="px-2.5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded"
                            style={{background:'#006AFF', color:'#FFFFFF'}}>EXTRA</span>
                          <button onClick={() => removeExtra(idx)}
                            className="text-[10px] text-[#CF1322] cursor-pointer" style={{background:'none', border:'none'}}>✕</button>
                        </div>
                        <div className="text-[12px] font-bold text-[#1F1F1F] truncate">{item.product_name}</div>
                      </div>
                      <div className="px-2.5 py-2.5 text-right font-mono text-[12px] text-[#999]">—</div>
                      <div className="px-2.5 py-2.5 text-right font-mono text-[12px] text-[#999]">—</div>
                      <div className="px-2 py-2.5">
                        <button onClick={() => setEditingField({
                          kind:'extra', idx, field:'quantity', title:`Qty: ${item.product_name}`
                        })}
                          className="w-full px-2 py-1.5 rounded text-right font-mono text-[12px] cursor-pointer"
                          style={{background:'#FFFFFF', border:'1px solid #006AFF'}}>
                          {item.quantity || '0'}
                        </button>
                      </div>
                      <div className="px-2 py-2.5">
                        <button onClick={() => setEditingField({
                          kind:'extra', idx, field:'unit_cost', title:`Cost: ${item.product_name}`
                        })}
                          className="w-full px-2 py-1.5 rounded text-right font-mono text-[12px] cursor-pointer"
                          style={{background:'#F5F5F5', border:'1px solid #E5E5E5'}}>
                          ${item.unit_cost || '0'}
                        </button>
                      </div>
                      <div className="px-3 py-2.5 text-right font-mono text-[13px] font-bold text-[#006AFF]">
                        ${sub.toFixed(2)}
                      </div>
                    </div>
                  )
                })}

                {/* Total row */}
                <div className="grid bg-[#F5F5F5]" style={{gridTemplateColumns:'1fr 70px 70px 90px 90px 100px'}}>
                  <div className="col-span-5 px-3 py-3 text-right text-[12px] font-bold text-[#666] uppercase">
                    {isReadOnly ? 'PO Total' : 'Total to receive'}
                  </div>
                  <div className="px-3 py-3 text-right font-mono text-[16px] font-bold text-[#1F1F1F]">
                    ${(isReadOnly ? poDetail.total : totalToReceive).toFixed(2)}
                  </div>
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
                {saving ? 'Receiving...' : `📥 Receive All · $${totalToReceive.toFixed(2)}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Field number editor */}
      {editingField && (
        <NumericKeypad
          value={editingField.kind === 'main'
            ? receiveLines[editingField.idx][editingField.field]
            : extraItems[editingField.idx][editingField.field]}
          onChange={(v) => editingField.kind === 'main'
            ? updateLine(editingField.idx, editingField.field, v)
            : updateExtra(editingField.idx, editingField.field, v)}
          onClose={() => setEditingField(null)}
          title={editingField.title} placeholder="0"
          formatPhone={false} allowPlus={false} allowDecimal/>
      )}

      {/* Product picker for extras */}
      {showProductPicker && (
        <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
          <div className="rounded-2xl overflow-hidden flex flex-col" style={{
            width:'520px', maxWidth:'100%', maxHeight:'80vh', background:'#FFFFFF',
            boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
          }}>
            <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
              <div className="text-[15px] font-bold text-[#1F1F1F]">Add Extra Product</div>
              <button onClick={() => { setShowProductPicker(false); setProductSearch('') }}
                className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
                style={{background:'#F5F5F5', border:'none'}}>✕</button>
            </div>
            <div className="px-5 py-3 flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
              <input value={productSearch} onChange={e => setProductSearch(e.target.value)} autoFocus
                placeholder="🔍 Search product..."
                className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-2.5 text-[14px] outline-none focus:border-[#006AFF]"/>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {productSearch.trim().length < 2 ? (
                <div className="p-8 text-center text-[12px] text-[#999]">Type at least 2 chars</div>
              ) : searchResults.length === 0 ? (
                <div className="p-8 text-center text-[12px] text-[#999]">No products found</div>
              ) : (
                <div className="space-y-1">
                  {searchResults.map(p => (
                    <button key={p.id} onClick={() => addExtraProduct(p)}
                      className="w-full text-left px-3 py-2 rounded-lg cursor-pointer hover:bg-[#FAFAFA] flex items-center gap-3"
                      style={{border:'1px solid #E5E5E5', background:'#FFFFFF'}}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{p.name}</div>
                        <div className="text-[10px] text-[#999] font-mono">{p.sku || '—'}</div>
                      </div>
                      {p.cost > 0 && (
                        <div className="text-[12px] font-bold font-mono text-[#666]">${p.cost.toFixed(2)}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
