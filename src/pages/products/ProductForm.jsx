// src/pages/products/ProductForm.jsx
import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

const UNITS = ['ea','lb','kg','oz','g','l','ml','ft','m','hr','pair','box','case','pack','roll','sheet','set','bag','bottle','can']

export function ProductForm({ initial = {}, tenantId, onSave, onClose }) {
  const qc = useQueryClient()
  const [saving, setSaving]     = useState(false)
  const [uploading, setUploading] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [showAddSub, setShowAddSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
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
    subcategory_id:  initial.subcategory_id  || '',
    sort_order:      initial.sort_order      || 0,
    tags:            initial.tags            || [],
    allow_vip:       initial.allow_vip       ?? true,
    vip_price:       initial.vip_price       || '',
    points_mode:     initial.points_mode     || 'amount',
    points_fixed:    initial.points_fixed    || '',
    points_rate:     initial.points_rate     || 1,
    points_redeemable: initial.points_redeemable ?? true,
    prompt_weight:   initial.prompt_weight   ?? false,
    prompt_price:    initial.prompt_price    ?? false,
    has_serial:      initial.has_serial      ?? false,
    track_inventory: initial.track_inventory ?? true,
    selectedTaxRates: [],
  })
  const set = (k,v) => setForm(p => ({...p,[k]:v}))

  // Load categories + subcategories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories-full', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('*, subcategories(id,name,sort_order)')
        .eq('tenant_id', tenantId).eq('is_active', true).order('sort_order')
      return data || []
    },
    enabled: !!tenantId,
  })

  // Load tax rates
  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tax_rates')
        .select('id, name, rate, tax_groups(name)')
        .eq('tenant_id', tenantId)
      return data || []
    },
    enabled: !!tenantId,
  })

  // Load existing tax rates for this product
  useQuery({
    queryKey: ['product-taxes', initial.id],
    queryFn: async () => {
      const { data } = await supabase.from('product_tax_rates')
        .select('tax_rate_id').eq('product_id', initial.id)
      set('selectedTaxRates', data?.map(t => t.tax_rate_id) || [])
      return data
    },
    enabled: !!initial.id,
  })

  const selectedCat = categories.find(c => c.subcategories?.some(s => s.id === form.subcategory_id))
  const [selectedCatId, setSelectedCatId] = useState(selectedCat?.id || '')

  const margin = form.price && form.cost
    ? (((parseFloat(form.price) - parseFloat(form.cost)) / parseFloat(form.price)) * 100).toFixed(1)
    : null
  const profit = form.price && form.cost
    ? (parseFloat(form.price) - parseFloat(form.cost)).toFixed(2)
    : null
  const totalTax = form.selectedTaxRates
    .map(id => taxRates.find(t => t.id === id)?.rate || 0)
    .reduce((s,r) => s+r, 0)

  const toggleTax = (id) => {
    set('selectedTaxRates', form.selectedTaxRates.includes(id)
      ? form.selectedTaxRates.filter(t => t !== id)
      : [...form.selectedTaxRates, id])
  }

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase()
    if (!tag || form.tags.includes(tag)) return
    set('tags', [...form.tags, tag])
    setTagInput('')
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `products/${tenantId}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: true })
      if (error) throw error
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
    if (!form.name.trim()) { toast.error('Product name required'); return }
    if (!form.price)       { toast.error('Selling price required'); return }

    // Check duplicate SKU
    if (form.sku?.trim()) {
      const { data: skuCheck } = await supabase.from('products')
        .select('id, name').eq('tenant_id', tenantId).eq('sku', form.sku.trim()).eq('is_active', true)
        .neq('id', form.id || '00000000-0000-0000-0000-000000000000').maybeSingle()
      if (skuCheck) {
        toast.error(`SKU "${form.sku}" already used by: ${skuCheck.name}`)
        return
      }
    }

    // Check duplicate UPC
    if (form.upc?.trim()) {
      const { data: upcCheck } = await supabase.from('products')
        .select('id, name').eq('tenant_id', tenantId).eq('upc', form.upc.trim()).eq('is_active', true)
        .neq('id', form.id || '00000000-0000-0000-0000-000000000000').maybeSingle()
      if (upcCheck) {
        toast.error(`UPC "${form.upc}" already used by: ${upcCheck.name}`)
        return
      }
    }

    setSaving(true)
    try {
      let type = 'unit'
      if (form.has_serial)    type = 'serialized'
      else if (form.prompt_weight) type = 'weight'
      else if (form.track_inventory) type = 'unit'
      else type = 'service'

      const payload = {
        tenant_id:       tenantId,
        name:            form.name.trim(),
        description:     form.description     || null,
        image_url:       form.image_url       || null,
        sku:             form.sku             || null,
        upc:             form.upc             || null,
        price:           parseFloat(form.price) || 0,
        cost:            parseFloat(form.cost)  || 0,
        unit:            form.unit,
        type,
        subcategory_id:  form.subcategory_id  || null,
        sort_order:      parseInt(form.sort_order) || 0,
        tags:            form.tags,
        allow_vip:       form.allow_vip,
        vip_price:       form.vip_price ? parseFloat(form.vip_price) : null,
        points_mode:     form.points_mode,
        points_fixed:    parseInt(form.points_fixed)  || 0,
        points_rate:     parseFloat(form.points_rate) || 1,
        prompt_weight:   form.prompt_weight,
        prompt_price:    form.prompt_price,
        has_serial:      form.has_serial,
        track_inventory: form.track_inventory,
        is_active:       true,
        emoji: form.has_serial ? '🔢' : form.prompt_weight ? '⚖️' : '📦',
      }

      let productId = form.id
      if (form.id) {
        const { error } = await supabase.from('products').update(payload).eq('id', form.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('products').insert(payload).select().single()
        if (error) throw error
        productId = data?.id
        if (productId && form.track_inventory) {
          await supabase.from('inventory').insert({
            tenant_id:  tenantId,
            product_id: productId,
            quantity:   parseFloat(form.qty) || 0,
            avg_cost:   parseFloat(form.cost) || 0,
          })
        }
      }

      // Save tax rates
      if (productId) {
        await supabase.from('product_tax_rates').delete().eq('product_id', productId)
        if (form.selectedTaxRates.length > 0) {
          await supabase.from('product_tax_rates').insert(
            form.selectedTaxRates.map(tax_rate_id => ({ tenant_id: tenantId, product_id: productId, tax_rate_id }))
          )
        }
      }

      toast.success(form.id ? 'Product updated ✓' : 'Product added ✓')
      onSave?.()
    } catch(err) {
      toast.error('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[660px] max-h-[92vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1e2d42] flex items-center justify-between sticky top-0 bg-[#0d1117] z-10">
          <div className="text-[15px] font-bold">{form.id ? '✏️ Edit Product' : '📦 New Product'}</div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-5">

          {/* Image + Name + Description */}
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Photo</div>
              <div onClick={() => fileRef.current?.click()}
                className="w-[100px] h-[100px] bg-[#111827] border-2 border-dashed border-[#1e2d42]
                  rounded-[10px] flex flex-col items-center justify-center cursor-pointer
                  hover:border-blue-500/40 transition-colors overflow-hidden relative">
                {uploading ? (
                  <div className="text-[10px] text-[#3d5068] animate-pulse">Uploading...</div>
                ) : form.image_url ? (
                  <img src={form.image_url} alt="" className="w-full h-full object-cover"/>
                ) : (
                  <><div className="text-[28px] mb-1">📷</div><div className="text-[9px] text-[#3d5068]">Upload photo</div></>
                )}
                <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden"/>
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-3">
              <div>
                <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Product Name *</div>
                <input value={form.name} onChange={e=>set('name',e.target.value)} autoFocus
                  placeholder="e.g. iPhone 15 Pro"
                  className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
              </div>
              <div>
                <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Description</div>
                <textarea value={form.description} onChange={e=>set('description',e.target.value)} rows={2}
                  placeholder="Optional description..."
                  className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2 text-[12px] outline-none focus:border-blue-500/40 resize-none placeholder-[#3d5068]"/>
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

          {/* Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Category</div>
              <select value={selectedCatId}
                onChange={e => { setSelectedCatId(e.target.value); set('subcategory_id', '') }}
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] text-[#e8edf5] outline-none focus:border-blue-500/40">
                <option value="">— No category —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">
                Subcategory
                {selectedCatId && (
                  <span className="ml-2 text-blue-400 font-normal normal-case">
                    ({(categories.find(c=>c.id===selectedCatId)?.subcategories||[]).length} available)
                  </span>
                )}
              </div>
              <select
                value={form.subcategory_id}
                onChange={e => {
                  if (e.target.value === '__add_new__') { setShowAddSub(true); return }
                  set('subcategory_id', e.target.value)
                }}
                disabled={!selectedCatId}
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] text-[#e8edf5] outline-none focus:border-blue-500/40 disabled:opacity-40">
                <option value="">— No subcategory —</option>
                {selectedCatId && (
                  <option value="__add_new__">✚ Add new subcategory...</option>
                )}
                {(categories.find(c=>c.id===selectedCatId)?.subcategories||[])
                  .filter(s => s.is_active !== false)
                  .sort((a,b)=>a.sort_order-b.sort_order)
                  .map(s => <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)
                }
              </select>
            </div>
          </div>

          {/* Sort order */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Display Order</div>
              <input type="number" value={form.sort_order} onChange={e=>set('sort_order',e.target.value)} min="0"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] font-mono outline-none focus:border-blue-500/40"/>
            </div>
          </div>

          {/* Price + Cost + Unit */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Selling Price *</div>
              <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 focus-within:border-blue-500/40">
                <span className="text-[#3d5068] mr-1">$</span>
                <input type="number" value={form.price} onChange={e=>set('price',e.target.value)} placeholder="0.00" step="0.01"
                  className="flex-1 bg-transparent border-none outline-none py-2.5 text-[13px] font-mono placeholder-[#3d5068]"/>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Cost Price</div>
              <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 focus-within:border-blue-500/40">
                <span className="text-[#3d5068] mr-1">$</span>
                <input type="number" value={form.cost} onChange={e=>set('cost',e.target.value)} placeholder="0.00" step="0.01"
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

          {/* Margin + Profit + Avg Cost */}
          {margin && (
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Margin', `${margin}%`, parseFloat(margin)>=30?'text-green-400':parseFloat(margin)>=10?'text-yellow-400':'text-red-400'],
                ['Profit / Unit', `$${profit}`, 'text-blue-400'],
                ['Cost Price', `$${parseFloat(form.cost||0).toFixed(2)}`, 'text-[#8899b0]'],
              ].map(([l,v,c]) => (
                <div key={l} className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-4 py-2.5 text-center">
                  <div className="text-[9px] font-mono text-[#3d5068] uppercase mb-1">{l}</div>
                  <div className={`text-[16px] font-bold font-mono ${c}`}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Opening QTY */}
          {!form.id && form.track_inventory && (
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Opening Stock (QTY)</div>
              <input type="number" value={form.qty} onChange={e=>set('qty',e.target.value)} placeholder="0" min="0"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] font-mono outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
            </div>
          )}

          {/* Tax — multi-select */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">
              Tax
              {totalTax > 0 && <span className="ml-2 text-yellow-400">Total: {(totalTax*100).toFixed(2)}%</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                form.selectedTaxRates.length===0 ? 'border-blue-500/40 bg-blue-500/8' : 'border-[#1e2d42] bg-[#111827]'
              }`}>
                <input type="checkbox" checked={form.selectedTaxRates.length===0} onChange={() => set('selectedTaxRates',[])}
                  className="w-3 h-3 accent-blue-500"/>
                <span className="text-[12px]">No Tax</span>
              </label>
              {taxRates.map(tr => (
                <label key={tr.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                  form.selectedTaxRates.includes(tr.id) ? 'border-yellow-500/40 bg-yellow-500/8' : 'border-[#1e2d42] bg-[#111827]'
                }`}>
                  <input type="checkbox" checked={form.selectedTaxRates.includes(tr.id)} onChange={() => toggleTax(tr.id)}
                    className="w-3 h-3 accent-yellow-500"/>
                  <span className="text-[12px]">{tr.name}</span>
                  <span className="text-[10px] font-mono text-[#3d5068]">{(tr.rate*100).toFixed(2)}%</span>
                </label>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Tags</div>
            <div className="flex gap-2 mb-2">
              <input value={tagInput} onChange={e=>setTagInput(e.target.value)}
                onKeyDown={e => e.key==='Enter' && (e.preventDefault(), addTag())}
                placeholder="Add tag (press Enter)..."
                className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 text-[12px] outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
              <button onClick={addTag}
                className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 text-[11px] text-[#8899b0] hover:text-white cursor-pointer transition-colors">
                + Add
              </button>
            </div>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 bg-blue-500/10 border border-blue-500/20
                    rounded-full px-2.5 py-0.5 text-[11px] text-blue-400">
                    {tag}
                    <button onClick={() => set('tags', form.tags.filter(t=>t!==tag))}
                      className="text-blue-400/50 hover:text-red-400 bg-transparent border-none cursor-pointer ml-0.5">✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* VIP + Loyalty */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">VIP & Loyalty</div>
            </div>
            <label className={`flex items-center gap-3 px-4 py-3 rounded-[9px] border cursor-pointer col-span-2 transition-all ${
              form.allow_vip ? 'border-purple-500/30 bg-purple-500/5' : 'border-[#1e2d42] bg-[#111827]'
            }`}>
              <input type="checkbox" checked={form.allow_vip} onChange={e=>set('allow_vip',e.target.checked)}
                className="w-4 h-4 accent-purple-500"/>
              <div>
                <div className="text-[13px] font-semibold">Allow VIP Discount / Price</div>
                <div className="text-[10px] text-[#3d5068] mt-0.5">VIP customers get their tier discount on this product</div>
              </div>
            </label>
            {form.allow_vip && (
              <div>
                <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">VIP Override Price (optional)</div>
                <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 focus-within:border-purple-500/40">
                  <span className="text-[#3d5068] mr-1">$</span>
                  <input type="number" value={form.vip_price} onChange={e=>set('vip_price',e.target.value)} placeholder="Leave blank = use % discount"
                    className="flex-1 bg-transparent border-none outline-none py-2.5 text-[12px] font-mono placeholder-[#3d5068]"/>
                </div>
              </div>
            )}
            <label className={`flex items-center gap-3 px-4 py-3 rounded-[9px] border cursor-pointer transition-all ${
              form.points_redeemable ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-[#1e2d42] bg-[#111827]'
            }`}>
              <input type="checkbox" checked={form.points_redeemable} onChange={e=>set('points_redeemable',e.target.checked)}
                className="w-4 h-4 accent-yellow-500"/>
              <div>
                <div className="text-[13px] font-semibold">Can Redeem Points</div>
                <div className="text-[10px] text-[#3d5068] mt-0.5">Customers can use points to pay for this</div>
              </div>
            </label>
          </div>

          {/* Points earning */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Points Earning</div>
            <div className="flex gap-2 mb-3">
              {[['amount','$ → Points (e.g. $1 = X pts)'],['fixed','Fixed Points per purchase']].map(([mode,label]) => (
                <label key={mode} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer flex-1 transition-all ${
                  form.points_mode===mode ? 'border-yellow-500/40 bg-yellow-500/8' : 'border-[#1e2d42] bg-[#111827]'
                }`}>
                  <input type="radio" name="points_mode" value={mode} checked={form.points_mode===mode} onChange={()=>set('points_mode',mode)}
                    className="accent-yellow-500"/>
                  <span className="text-[11px]">{label}</span>
                </label>
              ))}
            </div>
            {form.points_mode === 'amount' ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 flex-1 focus-within:border-yellow-500/40">
                  <span className="text-[#3d5068] text-[11px] mr-2 whitespace-nowrap">$1 =</span>
                  <input type="number" value={form.points_rate} onChange={e=>set('points_rate',e.target.value)} placeholder="1" step="0.1"
                    className="flex-1 bg-transparent border-none outline-none py-2.5 text-[13px] font-mono placeholder-[#3d5068]"/>
                  <span className="text-[#3d5068] text-[11px] ml-2">pts</span>
                </div>
                <span className="text-[11px] text-[#3d5068]">(default: $1=1pt)</span>
              </div>
            ) : (
              <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 focus-within:border-yellow-500/40">
                <input type="number" value={form.points_fixed} onChange={e=>set('points_fixed',e.target.value)} placeholder="10"
                  className="flex-1 bg-transparent border-none outline-none py-2.5 text-[13px] font-mono placeholder-[#3d5068]"/>
                <span className="text-[#3d5068] text-[11px] ml-2">points per purchase</span>
              </div>
            )}
          </div>

          {/* Behavior checkboxes */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Checkout Behavior</div>
            <div className="flex flex-col gap-2">
              {[
                ['prompt_weight',   '⚖️', 'Prompt Weight at Checkout',  'Number pad pops up for weight entry'],
                ['prompt_price',    '💲', 'Prompt Price at Checkout',   'Number pad pops up for price entry'],
                ['has_serial',      '🔢', 'Track Serial Numbers',       'Scan serials when receiving and selling'],
                ['track_inventory', '📊', 'Track Inventory',            'Show stock levels and low stock alerts'],
              ].map(([key,icon,label,desc]) => (
                <label key={key} className={`flex items-center gap-3 px-4 py-3 rounded-[9px] border cursor-pointer transition-all ${
                  form[key] ? 'border-blue-500/30 bg-blue-500/5' : 'border-[#1e2d42] bg-[#111827] hover:border-[#243347]'
                }`}>
                  <input type="checkbox" checked={form[key]} onChange={e=>set(key,e.target.checked)}
                    className="w-4 h-4 accent-blue-500 flex-shrink-0"/>
                  <span className="text-[16px]">{icon}</span>
                  <div>
                    <div className="text-[13px] font-semibold">{label}</div>
                    <div className="text-[10px] text-[#3d5068] mt-0.5">{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Add Subcategory mini modal */}
        {showAddSub && (
          <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center" onClick={()=>setShowAddSub(false)}>
            <div className="bg-[#0d1117] border border-[#243347] rounded-xl w-[320px] p-5" onClick={e=>e.stopPropagation()}>
              <div className="text-[14px] font-bold mb-3">
                ✚ Add Subcategory
                <div className="text-[11px] text-[#3d5068] font-normal mt-0.5">
                  Under: {categories.find(c=>c.id===selectedCatId)?.emoji} {categories.find(c=>c.id===selectedCatId)?.name}
                </div>
              </div>
              <input
                value={newSubName}
                onChange={e=>setNewSubName(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&newSubName.trim()&&(async()=>{
                  const {data} = await supabase.from('subcategories').insert({
                    tenant_id: tenantId, category_id: selectedCatId,
                    name: newSubName.trim(),
                    sort_order: (categories.find(c=>c.id===selectedCatId)?.subcategories?.length||0)+1
                  }).select().single()
                  if(data){ set('subcategory_id', data.id); qc.invalidateQueries(['categories-full']) }
                  setShowAddSub(false); setNewSubName('')
                })()}
                autoFocus placeholder="e.g. Phones, Dairy, Repair..."
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] outline-none focus:border-blue-500/40 placeholder-[#3d5068] mb-3"
              />
              <div className="flex gap-2">
                <button onClick={()=>{setShowAddSub(false);setNewSubName('')}}
                  className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-2 text-[12px] text-[#8899b0] cursor-pointer">Cancel</button>
                <button
                  disabled={!newSubName.trim()}
                  onClick={async()=>{
                    const {data} = await supabase.from('subcategories').insert({
                      tenant_id: tenantId, category_id: selectedCatId,
                      name: newSubName.trim(),
                      sort_order: (categories.find(c=>c.id===selectedCatId)?.subcategories?.length||0)+1
                    }).select().single()
                    if(data){ set('subcategory_id', data.id); qc.invalidateQueries(['categories-full']) }
                    setShowAddSub(false); setNewSubName('')
                  }}
                  className="flex-[2] bg-blue-500 border-none rounded-[9px] py-2 text-[12px] font-bold text-white cursor-pointer disabled:opacity-40">
                  ✓ Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4 sticky bottom-0 bg-[#0d1117]">
          <button onClick={onClose}
            className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-3 text-[13px] text-[#8899b0] cursor-pointer hover:text-white transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving||uploading}
            className="flex-[2] bg-gradient-to-r from-blue-600 to-blue-700 border-none rounded-[9px] py-3 text-[13px] font-bold text-white cursor-pointer disabled:opacity-50 transition-all">
            {saving ? '⏳ Saving...' : form.id ? '✓ Update Product' : '✓ Add Product'}
          </button>
        </div>
      </div>
    </div>
  )
}
