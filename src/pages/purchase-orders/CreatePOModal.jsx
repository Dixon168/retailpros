// src/pages/purchase-orders/CreatePOModal.jsx
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { NumericKeypad, QWERTYKeyboard } from '@/components/ui/TouchKeyboards'
import ProductPicker from '@/components/inventory/ProductPicker'

export default function CreatePOModal({ initialItems = [], initialVendorId = null, onClose, onCreated }) {
  const { tenant, store, user } = useAuthStore()
  const [vendorId, setVendorId]         = useState(initialVendorId || '')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes]               = useState('')
  const [items, setItems]               = useState(initialItems)  // [{product_id, product_name, quantity, unit_cost}]
  const [showProductPicker, setShowProductPicker] = useState(false)
  const [editingField, setEditingField] = useState(null)  // {idx, field, kind:'num'|'text'}
  const [showNotesKB, setShowNotesKB]   = useState(false)
  const [saving, setSaving]             = useState(false)

  // Vendors list
  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors-active', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers')
        .select('id, name, contact_name')
        .eq('tenant_id', tenant.id).eq('is_active', true)
        .order('name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Product search (debounced)
  const totalAmount = useMemo(() =>
    items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_cost) || 0), 0),
    [items]
  )

  const addProduct = (product) => {
    if (items.find(i => i.product_id === product.id)) {
      toast.error(`${product.name} is already in this PO`)
      return
    }
    // Suggested cost: vendor's last cost > vendor avg > product.cost > 0
    const suggestedCost = product.vendor_last_cost || product.vendor_avg_cost || product.cost || 0
    setItems([...items, {
      product_id:   product.id,
      product_name: product.name,
      product_sku:  product.sku,
      quantity:     '1',
      unit_cost:    String(suggestedCost),
    }])
    setShowProductPicker(false)
  }

  const updateItem = (idx, field, value) => {
    setItems(items.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const removeItem = (idx) => {
    setItems(items.filter((_, i) => i !== idx))
  }

  const create = async () => {
    if (!vendorId) { toast.error('Please pick a vendor'); return }
    if (items.length === 0) { toast.error('Add at least one product'); return }

    // Validate quantities
    for (const item of items) {
      if (!parseFloat(item.quantity) || parseFloat(item.quantity) <= 0) {
        toast.error(`${item.product_name}: quantity must be > 0`)
        return
      }
    }

    setSaving(true)
    const { data, error } = await supabase.rpc('fn_create_po_atomic', {
      p_tenant_id:     tenant.id,
      p_store_id:      store.id,
      p_supplier_id:   vendorId,
      p_expected_date: expectedDate || null,
      p_notes:         notes || null,
      p_created_by:    user?.id || null,
      p_items:         items.map(it => ({
        product_id:   it.product_id,
        product_name: it.product_name,
        quantity:     parseFloat(it.quantity) || 0,
        unit_cost:    parseFloat(it.unit_cost) || 0,
      })),
    })
    setSaving(false)
    if (error || !data?.success) {
      toast.error(error?.message || data?.message || 'Failed to create PO')
      return
    }
    toast.success(`Created ${data.po_number}`)
    onCreated()
  }

  const selectedVendor = vendors.find(v => v.id === vendorId)

  return (
    <>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="rounded-2xl overflow-hidden flex flex-col" style={{
          width:'720px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
          boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
        }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
            <div>
              <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">New Purchase Order</div>
              <div className="text-[16px] font-bold text-[#1F1F1F]">
                {selectedVendor?.name || 'Pick a vendor'}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
              style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">

            {/* Vendor + Expected date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Vendor *</FieldLabel>
                <select value={vendorId} onChange={e => setVendorId(e.target.value)}
                  className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none cursor-pointer"
                  style={{borderColor: vendorId ? '#006AFF' : '#E5E5E5'}}>
                  <option value="">— Select vendor —</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}{v.contact_name ? ` · ${v.contact_name}` : ''}</option>
                  ))}
                </select>
                {vendors.length === 0 && (
                  <div className="text-[11px] text-[#CF1322] mt-1">⚠️ No vendors yet. Add one in Vendors page first.</div>
                )}
              </div>
              <div>
                <FieldLabel>Expected delivery (optional)</FieldLabel>
                <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)}
                  className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none cursor-pointer"/>
              </div>
            </div>

            {/* Items table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <FieldLabel>Items ({items.length})</FieldLabel>
                <button onClick={() => setShowProductPicker(true)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                  style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
                  + Add Product
                </button>
              </div>

              {items.length === 0 ? (
                <div className="rounded-xl p-8 text-center"
                  style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
                  <div className="text-[36px] mb-2 opacity-30">📦</div>
                  <div className="text-[13px] text-[#666] mb-3">No items yet</div>
                  <button onClick={() => setShowProductPicker(true)}
                    className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer"
                    style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
                    + Add your first product
                  </button>
                </div>
              ) : (
                <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
                  <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
                    style={{gridTemplateColumns:'1fr 90px 90px 90px 40px'}}>
                    {['Product','Qty','Unit Cost','Subtotal',''].map(h => (
                      <div key={h} className="px-3 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                    ))}
                  </div>
                  {items.map((item, idx) => {
                    const sub = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0)
                    return (
                      <div key={idx} className="grid border-b border-[#E5E5E5] last:border-0 items-center"
                        style={{gridTemplateColumns:'1fr 90px 90px 90px 40px'}}>
                        <div className="px-3 py-2.5">
                          <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{item.product_name}</div>
                          {item.product_sku && (
                            <div className="text-[10px] text-[#999] font-mono">{item.product_sku}</div>
                          )}
                        </div>
                        <div className="px-2 py-2.5">
                          <button onClick={() => setEditingField({ idx, field:'quantity', kind:'num', title:'Quantity' })}
                            className="w-full px-2 py-1.5 rounded text-right font-mono text-[13px] cursor-pointer hover:border-[#006AFF]"
                            style={{background:'#F5F5F5', border:'1px solid #E5E5E5'}}>
                            {item.quantity || '0'}
                          </button>
                        </div>
                        <div className="px-2 py-2.5">
                          <button onClick={() => setEditingField({ idx, field:'unit_cost', kind:'num', title:'Unit Cost' })}
                            className="w-full px-2 py-1.5 rounded text-right font-mono text-[13px] cursor-pointer hover:border-[#006AFF]"
                            style={{background:'#F5F5F5', border:'1px solid #E5E5E5'}}>
                            ${item.unit_cost || '0'}
                          </button>
                        </div>
                        <div className="px-3 py-2.5 text-right font-mono text-[13px] font-bold text-[#1F1F1F]">
                          ${sub.toFixed(2)}
                        </div>
                        <div className="px-2 py-2.5">
                          <button onClick={() => removeItem(idx)}
                            className="w-7 h-7 rounded text-[14px] cursor-pointer"
                            style={{background:'#FEE2E2', color:'#CF1322', border:'none'}}>×</button>
                        </div>
                      </div>
                    )
                  })}
                  {/* Total */}
                  <div className="grid bg-[#F5F5F5] border-t border-[#E5E5E5]"
                    style={{gridTemplateColumns:'1fr 90px 90px 90px 40px'}}>
                    <div className="col-span-3 px-3 py-3 text-right text-[12px] font-bold text-[#666] uppercase">
                      Total
                    </div>
                    <div className="px-3 py-3 text-right font-mono text-[16px] font-bold text-[#1F1F1F]">
                      ${totalAmount.toFixed(2)}
                    </div>
                    <div></div>
                  </div>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <FieldLabel>Notes (optional)</FieldLabel>
              <button onClick={() => setShowNotesKB(true)}
                className="w-full text-left bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] cursor-pointer"
                style={{color: notes ? '#1F1F1F' : '#999'}}>
                {notes || 'Tap to add notes...'}
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 flex gap-2 flex-shrink-0" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onClose}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              Cancel
            </button>
            <button onClick={create} disabled={saving || !vendorId || items.length === 0}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              {saving ? 'Creating...' : `Create PO · $${totalAmount.toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>

      {/* Product picker modal */}
      {showProductPicker && (
        <ProductPicker
          title="Add Product to PO"
          vendorId={vendorId}
          excludeIds={items.map(i => i.product_id)}
          onPick={addProduct}
          onClose={() => setShowProductPicker(false)}
        />
      )}

      {/* Field editors */}
      {editingField && (
        <NumericKeypad
          value={items[editingField.idx][editingField.field]}
          onChange={(v) => updateItem(editingField.idx, editingField.field, v)}
          onClose={() => setEditingField(null)}
          title={editingField.title} placeholder="0"
          formatPhone={false} allowPlus={false} allowDecimal/>
      )}
      {showNotesKB && (
        <QWERTYKeyboard value={notes} onChange={setNotes}
          onClose={() => setShowNotesKB(false)} title="PO Notes"
          placeholder="e.g. Hold for pickup Friday"/>
      )}
    </>
  )
}

function FieldLabel({ children }) {
  return <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">{children}</div>
}
