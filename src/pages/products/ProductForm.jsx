// src/pages/products/ProductForm.jsx
import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

const UNITS = ['ea','lb','kg','oz','g','l','ml','ft','m','hr','pair','box','case','pack','roll','sheet','set','bag','bottle','can','jar','tube']

export function ProductForm({ initial = {}, tenantId, onSave, onClose }) {
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()
  const [form, setForm] = useState({
    id:              initial.id              || null,
    name:            initial.name            || '',
    description:     initial.description     || '',
    image_url:       initial.image_url       || '',
    sku:             initial.sku             || '',
    upc:             initial.upc             || '',
    price:           initial.price           || '',
    cost:            initial.cost            || '',
    unit:            initial.unit            || 'ea',
    qty:             '',
    tax_group_id:    initial.tax_group_id    || '',
    prompt_weight:   initial.prompt_weight   ?? false,
    prompt_price:    initial.prompt_price    ?? false,
    has_serial:      initial.has_serial      ?? false,
    track_inventory: initial.track_inventory ?? true,
    type:            initial.type            || 'unit',
  })
  const set = (k,v) => setForm(p => ({...p,[k]:v}))

  // Load tax groups
  const { data: taxGroups = [] } = useQuery({
    queryKey: ['tax-groups', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tax_groups').select('id,name,tax_rates(rate)').eq('tenant_id', tenantId)
      return data || []
    },
    enabled: !!tenantId,
  })

  const margin = form.price && form.cost
    ? (((parseFloat(form.price) - parseFloat(form.cost)) / parseFloat(form.price)) * 100).toFixed(1)
    : null
  const profit = form.price && form.cost
    ? (parseFloat(form.price) - parseFloat(form.cost)).toFixed(2)
    : null

  // Upload image to Supabase Storage
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `products/${tenantId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('product-images').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path)
      set('image_url', publicUrl)
      toast.success('Image uploaded ✓')
    } catch(err) {
      toast.error('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Product name is required'); return }
    if (!form.price)       { toast.error('Sell price is required'); return }
    setSaving(true)
    try {
      // Determine type from flags
      let type = form.type
      if (form.has_serial) type = 'serialized'
      else if (form.prompt_weight) type = 'weight'

      const payload = {
        tenant_id:       tenantId,
        name:            form.name.trim(),
        description:     form.description || null,
        image_url:       form.image_url   || null,
        sku:             form.sku         || null,
        upc:             form.upc         || null,
        price:           parseFloat(form.price) || 0,
        cost:            parseFloat(form.cost)  || 0,
        unit:            form.unit,
        type,
        tax_group_id:    form.tax_group_id || null,
        prompt_weight:   form.prompt_weight,
        prompt_price:    form.prompt_price,
        has_serial:      form.has_serial,
        track_inventory: form.track_inventory,
        is_active:       true,
        emoji:           form.prompt_weight ? '⚖️' : form.has_serial ? '🔢' : '📦',
      }

      if (form.id) {
        const { error } = await supabase.from('products').update(payload).eq('id', form.id)
        if (error) throw error
        toast.success('Product updated ✓')
      } else {
        const { data, error } = await supabase.from('products').insert(payload).select().single()
        if (error) throw error
        // Create inventory record
        if (data?.id && form.track_inventory) {
          await supabase.from('inventory').insert({
            tenant_id:  tenantId,
            product_id: data.id,
            quantity:   parseFloat(form.qty) || 0,
            avg_cost:   parseFloat(form.cost) || 0,
          })
        }
        toast.success('Product added ✓')
      }
      onSave?.()
    } catch(err) {
      toast.error('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[620px] max-h-[92vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1e2d42] flex items-center justify-between sticky top-0 bg-[#0d1117] z-10">
          <div className="text-[15px] font-bold">{form.id ? '✏️ Edit Product' : '📦 New Product'}</div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-5">

          {/* Image + Name row */}
          <div className="flex gap-4">
            {/* Image upload */}
            <div className="flex-shrink-0">
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Photo</div>
              <div
                onClick={() => fileRef.current?.click()}
                className="w-[100px] h-[100px] bg-[#111827] border-2 border-dashed border-[#1e2d42] rounded-[10px]
                  flex flex-col items-center justify-center cursor-pointer hover:border-blue-500/40 transition-colors overflow-hidden relative">
                {uploading ? (
                  <div className="text-[11px] text-[#3d5068] animate-pulse">Uploading...</div>
                ) : form.image_url ? (
                  <>
                    <img src={form.image_url} alt="" className="w-full h-full object-cover"/>
                    <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[10px] text-white">Change</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[24px] mb-1">📷</div>
                    <div className="text-[9px] text-[#3d5068] text-center">Upload<br/>photo</div>
                  </>
                )}
                <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden"/>
              </div>
            </div>

            {/* Name + Description */}
            <div className="flex-1 flex flex-col gap-3">
              <div>
                <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Product Name *</div>
                <input value={form.name} onChange={e=>set('name',e.target.value)} autoFocus
                  placeholder="e.g. iPhone 15 Pro, Fuji Apple, Screen Repair"
                  className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] outline-none focus:border-blue-500/40 transition-colors placeholder-[#3d5068]"/>
              </div>
              <div>
                <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Description</div>
                <textarea value={form.description} onChange={e=>set('description',e.target.value)}
                  rows={2} placeholder="Optional description..."
                  className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2 text-[12px] outline-none focus:border-blue-500/40 transition-colors resize-none placeholder-[#3d5068]"/>
              </div>
            </div>
          </div>

          {/* SKU + UPC */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">SKU</div>
              <input value={form.sku} onChange={e=>set('sku',e.target.value)} placeholder="APL-IP15P"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] font-mono outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">UPC / Barcode</div>
              <input value={form.upc} onChange={e=>set('upc',e.target.value)} placeholder="012345678901"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] font-mono outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
            </div>
          </div>

          {/* Price + Cost + Unit */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Selling Price *</div>
              <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 focus-within:border-blue-500/40">
                <span className="text-[#3d5068] mr-1">$</span>
                <input type="number" value={form.price} onChange={e=>set('price',e.target.value)}
                  placeholder="0.00" step="0.01" min="0"
                  className="flex-1 bg-transparent border-none outline-none py-2.5 text-[13px] font-mono placeholder-[#3d5068]"/>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Cost Price</div>
              <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 focus-within:border-blue-500/40">
                <span className="text-[#3d5068] mr-1">$</span>
                <input type="number" value={form.cost} onChange={e=>set('cost',e.target.value)}
                  placeholder="0.00" step="0.01" min="0"
                  className="flex-1 bg-transparent border-none outline-none py-2.5 text-[13px] font-mono placeholder-[#3d5068]"/>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Unit</div>
              <select value={form.unit} onChange={e=>set('unit',e.target.value)}
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] text-[#e8edf5] outline-none focus:border-blue-500/40">
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* Margin + Profit display */}
          {margin && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-4 py-2.5 text-center">
                <div className="text-[9px] font-mono text-[#3d5068] uppercase mb-1">Margin</div>
                <div className={`text-[16px] font-bold font-mono ${parseFloat(margin)>=30?'text-green-400':parseFloat(margin)>=10?'text-yellow-400':'text-red-400'}`}>
                  {margin}%
                </div>
              </div>
              <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-4 py-2.5 text-center">
                <div className="text-[9px] font-mono text-[#3d5068] uppercase mb-1">Profit / Unit</div>
                <div className="text-[16px] font-bold font-mono text-blue-400">${profit}</div>
              </div>
              <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-4 py-2.5 text-center">
                <div className="text-[9px] font-mono text-[#3d5068] uppercase mb-1">Avg Cost</div>
                <div className="text-[16px] font-bold font-mono text-[#8899b0]">
                  ${parseFloat(form.cost||0).toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* Opening QTY - new only */}
          {!form.id && form.track_inventory && (
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Opening Stock (QTY)</div>
              <input type="number" value={form.qty} onChange={e=>set('qty',e.target.value)}
                placeholder="0" min="0"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] font-mono outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
            </div>
          )}

          {/* Tax groups */}
          {taxGroups.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Tax</div>
              <div className="flex flex-wrap gap-2">
                {taxGroups.map(tg => {
                  const totalRate = tg.tax_rates?.reduce((s,r)=>s+r.rate,0)||0
                  return (
                    <label key={tg.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                      form.tax_group_id===tg.id ? 'border-blue-500/50 bg-blue-500/8' : 'border-[#1e2d42] bg-[#111827] hover:border-[#243347]'
                    }`}>
                      <input type="radio" name="tax_group" value={tg.id}
                        checked={form.tax_group_id===tg.id}
                        onChange={()=>set('tax_group_id',tg.id)}
                        className="accent-blue-500 w-3 h-3"/>
                      <span className="text-[12px]">{tg.name}</span>
                      <span className="text-[10px] font-mono text-[#3d5068]">{(totalRate*100).toFixed(2)}%</span>
                    </label>
                  )
                })}
                <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                  !form.tax_group_id ? 'border-blue-500/50 bg-blue-500/8' : 'border-[#1e2d42] bg-[#111827]'
                }`}>
                  <input type="radio" name="tax_group" value=""
                    checked={!form.tax_group_id}
                    onChange={()=>set('tax_group_id','')}
                    className="accent-blue-500 w-3 h-3"/>
                  <span className="text-[12px]">No Tax</span>
                </label>
              </div>
            </div>
          )}

          {/* Checkboxes */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Product Behavior</div>
            <div className="flex flex-col gap-2">
              {[
                ['prompt_weight', '⚖️ Prompt Weight at Checkout', 'Number pad pops up to enter weight when selling'],
                ['prompt_price',  '💲 Prompt Price at Checkout',  'Number pad pops up to enter price when selling'],
                ['has_serial',    '🔢 Track Serial Numbers',       'Scan serial number when receiving and selling'],
                ['track_inventory','📊 Track Inventory',           'Show stock levels and low stock alerts'],
              ].map(([key, label, desc]) => (
                <label key={key} className={`flex items-center gap-3 px-4 py-3 rounded-[9px] border cursor-pointer transition-all ${
                  form[key] ? 'border-blue-500/40 bg-blue-500/5' : 'border-[#1e2d42] bg-[#111827] hover:border-[#243347]'
                }`}>
                  <input type="checkbox" checked={form[key]} onChange={e=>set(key,e.target.checked)}
                    className="w-4 h-4 accent-blue-500 flex-shrink-0"/>
                  <div>
                    <div className="text-[13px] font-semibold">{label}</div>
                    <div className="text-[10px] text-[#3d5068] mt-0.5">{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4 sticky bottom-0 bg-[#0d1117]">
          <button onClick={onClose}
            className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-3 text-[13px] text-[#8899b0] cursor-pointer hover:text-white transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving||uploading}
            className="flex-[2] bg-gradient-to-r from-blue-600 to-blue-700 border-none rounded-[9px] py-3 text-[13px] font-bold text-white cursor-pointer disabled:opacity-50 hover:from-blue-500 hover:to-blue-600 transition-all">
            {saving ? '⏳ Saving...' : form.id ? '✓ Update Product' : '✓ Add Product'}
          </button>
        </div>
      </div>
    </div>
  )
}
