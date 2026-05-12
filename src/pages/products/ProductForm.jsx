// src/pages/products/ProductForm.jsx
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

const UNITS = ['ea','lb','kg','oz','g','l','ml','ft','m','hr','pair','box','case','pack','roll','bag','bottle','can']

// ── Open Food Facts + Claude AI lookup ──
async function lookupUPC(upc) {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${upc}.json`, {
      headers: { 'User-Agent': 'RetailPOS/1.0 (retailpros.netlify.app)' }
    })
    const data = await res.json()
    if (data.status === 1 && data.product) {
      const p = data.product
      return {
        found: true,
        name:        p.product_name || p.product_name_en || '',
        brand:       p.brands || '',
        image_url:   p.image_front_url || p.image_front_small_url || p.image_url || p.image_thumb_url || '',
        description: p.generic_name || p.product_name_en || p.abbreviated_product_name || '',
        quantity:    p.quantity || '',
        raw:         p,
      }
    }
    return { found: false }
  } catch { return { found: false } }
}

async function aiEnrichUPC(rawData) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{ role: 'user', content:
          'You are a retail product data assistant. Given this product info from Open Food Facts, return ONLY a JSON object (no markdown):\n' +
          JSON.stringify(rawData) + '\n\n' +
          'JSON format:\n{' +
          '"name":"clean english product name",' +
          '"description":"1-2 sentence product description",' +
          '"unit":"one of: ea,lb,kg,oz,g,l,ml,bottle,can,pack,box,case",' +
          '"suggested_price":number,' +
          '"category":"one of: Food & Beverage,Alcohol & Wine,Snacks,Dairy,Produce,Meat,Health & Beauty,Household,Other"' +
          '}'
        }]
      })
    })
    const d = await res.json()
    const text = d.content?.[0]?.text || '{}'
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch { return {} }
}
const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

// ── Reusable field components ──
function Label({ children, required }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{color:'#64748b'}}>
      {children}{required && <span className="text-red-500 ml-0.5">*</span>}
    </div>
  )
}
function Input({ value, onChange, placeholder, type='text', step, min, autoFocus, mono, className='' }) {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      step={step} min={min} autoFocus={autoFocus}
      className={`w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none transition-all ${mono?'font-mono':''} ${className}`}
      style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#1F1F1F'}}
      onFocus={e=>{e.target.style.borderColor='#006AFF';e.target.style.background='#fff'}}
      onBlur={e=>{e.target.style.borderColor='#e2e8f0';e.target.style.background='#f8fafc'}}
    />
  )
}
function Section({ title, icon, children, color='#006AFF' }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
      <div className="px-4 py-2.5 flex items-center gap-2"
        style={{background:`${color}08`, borderBottom:'1px solid #f1f5f9'}}>
        <span>{icon}</span>
        <span className="text-[12px] font-bold" style={{color}}>{title}</span>
      </div>
      <div className="px-4 py-4" style={{background:'#fff'}}>
        {children}
      </div>
    </div>
  )
}
function Toggle({ checked, onChange, label, desc }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer py-1.5">
      <div className="relative flex-shrink-0" onClick={onChange}>
        <div style={{
          background: checked ? '#006AFF' : '#e2e8f0',
          width:'40px', height:'22px', position:'relative', cursor:'pointer',
          borderRadius:'11px', transition:'background .2s'
        }}>
          <div style={{
            position:'absolute', top:'2px',
            left: checked ? '20px' : '2px',
            width:'18px', height:'18px',
            background:'#fff', borderRadius:'50%',
            transition:'left .2s',
            boxShadow:'0 1px 3px rgba(0,0,0,0.2)'
          }}/>
        </div>
      </div>
      <div>
        <div className="text-[13px] font-semibold text-slate-700">{label}</div>
        {desc && <div className="text-[11px] text-slate-400 mt-0.5">{desc}</div>}
      </div>
    </label>
  )
}

export function ProductForm({ initial={}, tenantId, storeId, onSave, onClose }) {
  const [upcLooking,  setUpcLooking]  = useState(false)
  const [genDesc,     setGenDesc]     = useState(false)
  const upcRef = useRef(null)

  // Auto-focus UPC on open
  useEffect(() => {
    setTimeout(() => upcRef.current?.focus(), 100)
  }, [])
  const qc = useQueryClient()
  const fileRef = useRef()
  const [saving,    setSaving]    = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saveError, setSaveError] = useState(null)  // inline error banner — visible inside modal
  const [form, setForm] = useState({
    id:               initial.id               || null,
    name:             initial.name             || '',
    description:      initial.description      || '',
    image_url:        initial.image_url        || '',
    sku:              initial.sku              || '',
    upc:              initial.upc              || '',
    price:            initial.price            || '',
    cost:             initial.cost             || '',
    unit:             initial.unit             || 'ea',
    qty:              '',
    subcategory_id:   initial.subcategory_id   || '',
    sort_order:       initial.sort_order       || 0,
    tags:             initial.tags             || [],
    // VIP
    allow_vip:        initial.allow_vip        ?? true,
    vip_price:        initial.vip_price        || '',
    // Points
    points_redeemable: initial.points_redeemable ?? true,
    points_mode:      initial.points_mode      || 'amount',
    points_fixed:     initial.points_fixed     || '',
    points_rate:      initial.points_rate      || 1,
    // Commission
    commission_type:  initial.commission_type  || 'none',
    commission_value: initial.commission_value || '',
    // Behavior
    prompt_weight:    initial.prompt_weight    ?? false,
    prompt_price:     initial.prompt_price     ?? false,
    has_serial:       initial.has_serial       ?? false,
    prompt_sales:     initial.prompt_sales     ?? false,
    track_inventory:  initial.track_inventory  ?? true,
    // Tax
    selectedTaxRates: [],
    tax_exempt:       initial.tax_exempt       ?? false,
    points_redeem:          initial.points_redeem          ?? false,
    redeem_points_required: initial.redeem_points_required || '',
  })
  const set = (k,v) => setForm(p => ({...p,[k]:v}))

  const [tagInput,    setTagInput]    = useState('')
  const [selCatId,    setSelCatId]    = useState('')
  const [showAddCat,  setShowAddCat]  = useState(false)
  const [newCatName,  setNewCatName]  = useState('')
  const [showAddSub,  setShowAddSub]  = useState(false)
  const [newSubName,  setNewSubName]  = useState('')
  const [newSubCatId, setNewSubCatId] = useState('')

  const { data: categories=[] } = useQuery({
    queryKey: ['categories-full', tenantId],
    queryFn: async () => {
      // Use 'left' join so categories with no subcategories still come back.
      // Log any error so we can see RLS / missing column / FK issues.
      const { data, error } = await supabase.from('categories')
        .select('id,name,emoji,color,sort_order,subcategories(id,name,sort_order)')
        .eq('tenant_id', tenantId)
        .order('sort_order')
      if (error) {
        console.error('[ProductForm categories query failed]', error)
        toast.error(`Couldn't load categories: ${error.message}`)
        return []
      }
      return data || []
    },
    enabled: !!tenantId,
    refetchOnMount: 'always',  // Always re-pull when the form opens so new
                                // categories created in Back Office show up
                                // immediately.
  })
  const { data: taxRates=[] } = useQuery({
    queryKey: ['tax-rates', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tax_rates')
        .select('id,name,rate').eq('tenant_id', tenantId)
      return data || []
    },
    enabled: !!tenantId,
  })
  useQuery({
    queryKey: ['product-taxes', initial.id],
    queryFn: async () => {
      const { data } = await supabase.from('product_tax_rates')
        .select('tax_rate_id').eq('product_id', initial.id)
      set('selectedTaxRates', data?.map(t=>t.tax_rate_id) || [])
      return data
    },
    enabled: !!initial.id,
  })

  // All tags already used on other products (for "pick from existing" UX)
  const { data: existingTags = [] } = useQuery({
    queryKey: ['all-product-tags', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('products')
        .select('tags').eq('tenant_id', tenantId).eq('is_active', true)
      const all = new Set()
      ;(data || []).forEach(p => (p.tags || []).forEach(t => t && all.add(t)))
      return Array.from(all).sort()
    },
    enabled: !!tenantId,
  })

  // Derived
  const margin = form.price && form.cost
    ? (((parseFloat(form.price)-parseFloat(form.cost))/parseFloat(form.price))*100).toFixed(1) : null
  const profit = form.price && form.cost
    ? (parseFloat(form.price)-parseFloat(form.cost)).toFixed(2) : null
  const totalTax = form.selectedTaxRates
    .map(id => taxRates.find(t=>t.id===id)?.rate||0)
    .reduce((s,r)=>s+r,0)

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5*1024*1024) { toast.error('Max 5MB'); return }
    setUploading(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `products/${tenantId}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert:true })
      if (error) throw error
      const { data:{ publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path)
      set('image_url', publicUrl)
      toast.success('Photo uploaded ✓')
    } catch(err) { toast.error('Upload failed: '+err.message) }
    finally { setUploading(false) }
  }

  const addCategory = async () => {
    const name = newCatName.trim()
    if (!name) { toast.error('Category name required'); return }
    try {
      const { data, error } = await supabase.from('categories')
        .insert({ tenant_id: tenantId, name, color: '#006AFF', sort_order: (categories?.length||0) + 1 })
        .select().single()
      if (error) throw error
      if (data) {
        setSelCatId(data.id)
        qc.invalidateQueries({ queryKey: ['categories-full'] })
        qc.invalidateQueries({ queryKey: ['categories'] })
        toast.success(`✓ Category "${data.name}" added`)
      }
      setShowAddCat(false); setNewCatName('')
    } catch (err) {
      console.error('[addCategory] failed:', err)
      const detail = err?.details || err?.hint || ''
      toast.error(`Failed to add category: ${err?.message || 'Unknown error'}${detail ? ' — ' + detail : ''}`,
        { duration: 6000 })
    }
  }

  const addSubcategory = async () => {
    const name = newSubName.trim()
    if (!name) { toast.error('Subcategory name required'); return }
    if (!newSubCatId) { toast.error('Pick a parent category first'); return }
    try {
      const parent = categories.find(c => c.id === newSubCatId)
      const { data, error } = await supabase.from('subcategories')
        .insert({ tenant_id: tenantId, category_id: newSubCatId, name,
                  sort_order: (parent?.subcategories?.length || 0) + 1 })
        .select().single()
      if (error) throw error
      if (data) {
        setSelCatId(newSubCatId)
        set('subcategory_id', data.id)
        qc.invalidateQueries({ queryKey: ['categories-full'] })
        qc.invalidateQueries({ queryKey: ['categories'] })
        toast.success(`✓ Subcategory "${data.name}" added`)
      }
      setShowAddSub(false); setNewSubName(''); setNewSubCatId('')
    } catch (err) {
      console.error('[addSubcategory] failed:', err)
      const detail = err?.details || err?.hint || ''
      toast.error(`Failed to add subcategory: ${err?.message || 'Unknown error'}${detail ? ' — ' + detail : ''}`,
        { duration: 6000 })
    }
  }

  const handleSave = async () => {
    setSaveError(null)
    if (!form.name.trim()) {
      const msg = 'Product name is required'
      setSaveError(msg); toast.error(msg); return
    }
    if (!form.price || parseFloat(form.price) <= 0) {
      const msg = 'Selling price is required (must be greater than $0)'
      setSaveError(msg); toast.error(msg); return
    }

    // Check dup SKU/UPC
    if (form.sku?.trim()) {
      const { data } = await supabase.from('products').select('id,name')
        .eq('tenant_id',tenantId).eq('sku',form.sku.trim()).eq('is_active',true)
        .neq('id',form.id||'00000000-0000-0000-0000-000000000000').maybeSingle()
      if (data) { toast.error(`SKU already used by: ${data.name}`); return }
    }
    if (form.upc?.trim()) {
      const { data } = await supabase.from('products').select('id,name')
        .eq('tenant_id',tenantId).eq('upc',form.upc.trim()).eq('is_active',true)
        .neq('id',form.id||'00000000-0000-0000-0000-000000000000').maybeSingle()
      if (data) { toast.error(`UPC already used by: ${data.name}`); return }
    }

    setSaving(true)
    try {
      let type = 'unit'
      if (form.has_serial)      type = 'serialized'
      else if (form.prompt_weight) type = 'weight'
      else if (!form.track_inventory) type = 'service'

      const payload = {
        tenant_id:        tenantId,
        name:             form.name.trim(),
        description:      form.description || null,
        image_url:        form.image_url   || null,
        sku:              form.sku         || null,
        upc:              form.upc         || null,
        price:            parseFloat(form.price) || 0,
        cost:             parseFloat(form.cost)  || 0,
        unit:             form.unit,
        type,
        subcategory_id:   form.subcategory_id || null,
        sort_order:       parseInt(form.sort_order) || 0,
        tags:             form.tags,
        allow_vip:        form.allow_vip,
        vip_price:        form.vip_price ? parseFloat(form.vip_price) : null,
        points_redeemable: form.points_redeemable,
        points_mode:      form.points_mode,
        points_redeem:    form.points_redeem,
        redeem_points_required: parseInt(form.redeem_points_required)||null,
        points_fixed:     parseInt(form.points_fixed)   || 0,
        points_rate:      parseFloat(form.points_rate)  || 1,
        commission_type:  form.commission_type,
        commission_value: parseFloat(form.commission_value) || 0,
        prompt_weight:    form.prompt_weight,
        prompt_price:     form.prompt_price,
        has_serial:       form.has_serial,
        prompt_sales:     form.prompt_sales,
        track_inventory:  form.track_inventory,
        tax_exempt:       form.tax_exempt,
        is_active:        true,
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
          // store_id is critical — POS filters inventory by store, so an
          // inventory row without store_id appears as 'out of stock' in
          // every store. Always tag with current store.
          await supabase.from('inventory').insert({
            tenant_id: tenantId,
            store_id:  storeId || null,
            product_id: productId,
            quantity: parseFloat(form.qty)||0,
            avg_cost: parseFloat(form.cost)||0,
          })
        }
      }
      if (productId) {
        await supabase.from('product_tax_rates').delete().eq('product_id', productId)
        if (form.selectedTaxRates.length > 0) {
          await supabase.from('product_tax_rates').insert(
            form.selectedTaxRates.map(tax_rate_id => ({ tenant_id:tenantId, product_id:productId, tax_rate_id }))
          )
        }
      }
      toast.success(form.id ? 'Product updated ✓' : 'Product added ✓')
      setSaveError(null)
      onSave?.()
    } catch(err) {
      // Surface every available detail so we can debug column/RLS/constraint issues
      console.error('[ProductForm save] failed:', err)
      const detail = err?.details || err?.hint || ''
      const code   = err?.code ? ` [${err.code}]` : ''
      const msg = `Save failed${code}: ${err?.message || 'Unknown error'}${detail ? ` — ${detail}` : ''}`
      setSaveError(msg)
      toast.error(msg, { duration: 8000 })
    }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 pb-4 px-4"
      style={{background:'rgba(15,23,42,0.6)', backdropFilter:'blur(2px)', overflowY:'auto'}}>
      <div className="flex flex-col rounded-2xl overflow-hidden shadow-md w-full"
        style={{maxWidth:'860px', background:'#FFFFFF', minHeight:'auto'}}>

        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0"
          style={{background:'#fff', borderBottom:'1.5px solid #e2e8f0'}}>
          <div>
            <div className="text-[17px] font-bold text-slate-800">
              {form.id ? '✏️ Edit Product' : '➕ New Product'}
            </div>
            {form.name && <div className="text-[12px] text-slate-400 mt-0.5">{form.name}</div>}
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer hover:bg-slate-100 transition-all">
            ✕
          </button>
        </div>

        {/* ── Inline save error banner — sticks at top of modal so the cashier
            can't miss it. Appears below header + above content. Cleared on
            successful save or when re-validating. ── */}
        {saveError && (
          <div className="px-6 py-3 flex items-start gap-3" style={{background:'#fef2f2', borderBottom:'1px solid #fecaca'}}>
            <span className="text-[20px] flex-shrink-0">❌</span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold text-[#991b1b]">Save failed</div>
              <div className="text-[11px] text-[#991b1b] mt-0.5 break-words">{saveError}</div>
            </div>
            <button onClick={() => setSaveError(null)}
              className="w-6 h-6 rounded-full bg-transparent border-none cursor-pointer text-[14px] flex-shrink-0"
              style={{color:'#991b1b'}}>✕</button>
          </div>
        )}

        <div className="px-6 py-5 flex flex-col gap-4">

          {/* ── UPC LOOKUP - TOP ── */}
          <div className="rounded-2xl p-4" style={{background:'#e6f0ff', border:'2px solid #80B2FF'}}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[18px]">🤖</span>
              <div>
                <div className="text-[14px] font-bold" style={{color:'#006AFF'}}>Auto-Fill from Barcode</div>
                <div className="text-[11px] text-slate-400">Scan UPC → AI fills name, description, photo & price automatically</div>
              </div>
            </div>
            <div className="flex gap-2">
              <input value={form.upc} onChange={e=>set('upc',e.target.value)}
                placeholder="Scan or enter UPC / barcode..."
                className="flex-1 rounded-xl px-4 py-3 text-[14px] font-mono outline-none"
                style={{border:'1.5px solid #80B2FF', background:'#fff', color:'#1F1F1F'}}
                onKeyDown={e=>{ if(e.key==='Enter' && form.upc?.trim()) document.getElementById('upc-lookup-btn').click() }}
                autoFocus
              />
              <button id="upc-lookup-btn" type="button"
                onClick={async () => {
                  if (!form.upc?.trim()) { toast.error('Enter UPC first'); return }
                  setUpcLooking(true)
                  const toastId = toast.loading('🔍 Searching Open Food Facts...')
                  try {
                    const off = await lookupUPC(form.upc.trim())
                    if (!off.found) { toast.error('Not found — fill manually', {id:toastId}); return }
                    toast.loading('🤖 Claude AI enriching...', {id:toastId})
                    const ai = await aiEnrichUPC(off.raw)
                    if (ai.name || off.name)                   set('name',        ai.name || off.name)
                    const desc = ai.description || off.description
                    if (desc) {
                      set('description', desc)
                    } else if (ai.name || off.name) {
                      // Auto-generate if no description found
                      try {
                        const dr = await fetch('https://api.anthropic.com/v1/messages', {
                          method:'POST', headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
                          body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:100,
                            messages:[{role:'user', content:'Write a short 1-2 sentence retail description for: "' + (ai.name||off.name) + '". Be concise and factual.'}]
                          })
                        })
                        const dd = await dr.json()
                        const dt = dd.content?.[0]?.text || ''
                        if (dt) set('description', dt)
                      } catch {}
                    }
                    if (ai.unit)                               set('unit',        ai.unit)
                    if (ai.suggested_price)                    set('price',       String(ai.suggested_price))
                    if (off.image_url) set('image_url', off.image_url.replace('http://', 'https://'))
                    // Count what was filled
                    const filled = [ai.name||off.name, ai.description||off.description, ai.unit, ai.suggested_price, off.image_url].filter(Boolean).length
                    toast.success(`✓ Auto-filled ${filled} fields from barcode!`, {id:toastId})
                  } catch(e) { toast.error('Lookup failed', {id:toastId}) }
                  finally { setUpcLooking(false) }
                }}
                disabled={upcLooking || !form.upc?.trim()}
                className="rounded-xl px-5 text-[13px] font-bold cursor-pointer border-none disabled:opacity-40 flex-shrink-0"
                style={{background: upcLooking ? '#80B2FF' : '#000000', color:'#fff', minWidth:'100px'}}>
                {upcLooking ? '⏳ Loading...' : '🔍 Lookup'}
              </button>
            </div>
          </div>

          {/* ── BASIC INFO ── */}
          <Section title="Basic Information" icon="📦" color="#006AFF">
            <div className="flex gap-4">
              {/* Photo */}
              <div className="flex-shrink-0">
                <Label>Photo</Label>
                <div onClick={()=>fileRef.current?.click()}
                  className="rounded-xl overflow-hidden cursor-pointer transition-all hover:opacity-90 relative flex items-center justify-center"
                  style={{width:'100px', height:'100px', background:'#f1f5f9', border:'2px dashed #cbd5e1'}}>
                  {uploading ? (
                    <div className="text-[10px] text-slate-400 animate-pulse">Uploading...</div>
                  ) : form.image_url ? (
                    <img src={form.image_url} alt="" className="w-full h-full" style={{objectFit:'contain', padding:'4px'}}/>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <div className="text-[24px]">📷</div>
                      <div className="text-[9px] text-slate-400">Upload</div>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden"/>
                </div>
              </div>

              {/* Name + Desc */}
              <div className="flex-1 flex flex-col gap-3">
                <div>
                  <Label required>Product Name</Label>
                  <Input value={form.name} onChange={e=>set('name',e.target.value)} autoFocus
                    placeholder="e.g. iPhone 15 Pro, Fuji Apple, Screen Repair"/>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label>Description</Label>
                    <button type="button" disabled={!form.name || genDesc}
                      onClick={async () => {
                        if (!form.name) return
                        setGenDesc(true)
                        try {
                          // Use Anthropic API - works in browser with proxy
                          const res = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'anthropic-version': '2023-06-01',
                            },
                            body: JSON.stringify({
                              model: 'claude-sonnet-4-20250514',
                              max_tokens: 150,
                              messages: [{
                                role: 'user',
                                content: 'Write a short 1-2 sentence retail product description for: "' + form.name + '".' +
                                  (form.upc ? ' UPC: ' + form.upc + '.' : '') +
                                  ' Be concise and factual. Just what the product is, no marketing.'
                              }]
                            })
                          })
                          if (!res.ok) throw new Error('API error: ' + res.status)
                          const d = await res.json()
                          const text = d.content?.[0]?.text?.trim() || ''
                          if (text) { set('description', text); toast.success('✓ Description generated') }
                          else throw new Error('No response')
                        } catch(e) {
                          // Fallback: generate locally based on name
                          const name = form.name
                          const unit = form.unit || 'ea'
                          const desc = name.includes('Tea') ? `A refreshing ${name.toLowerCase()} beverage.` :
                            name.includes('Coffee') ? `A quality ${name.toLowerCase()} product.` :
                            name.includes('Chips') || name.includes('Snack') ? `Delicious ${name.toLowerCase()} snack.` :
                            name.includes('Water') ? `Premium quality ${name.toLowerCase()}.` :
                            `${name} - quality retail product.`
                          set('description', desc)
                          toast.success('✓ Description added')
                        }
                        finally { setGenDesc(false) }
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer border-none disabled:opacity-40"
                      style={{background:'#000000', color:'#fff'}}>
                      {genDesc ? '⏳' : '🤖'} {genDesc ? 'Generating...' : 'AI Generate'}
                    </button>
                  </div>
                  <textarea value={form.description} onChange={e=>set('description',e.target.value)}
                    rows={3} placeholder="Optional — or click 🤖 AI Generate..."
                    className="w-full rounded-xl px-3.5 py-2.5 text-[12px] outline-none resize-none transition-all"
                    style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#1F1F1F'}}
                    onFocus={e=>{e.target.style.borderColor='#006AFF';e.target.style.background='#fff'}}
                    onBlur={e=>{e.target.style.borderColor='#e2e8f0';e.target.style.background='#f8fafc'}}/>
                </div>
              </div>
            </div>

            {/* SKU + UPC + Category + Sort */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <Label>SKU</Label>
                <Input value={form.sku} onChange={e=>set('sku',e.target.value)} placeholder="APL-IP15P" mono/>
              </div>
              <div>
                <Label>UPC / Barcode</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input value={form.upc} onChange={e=>set('upc',e.target.value)} placeholder="012345678901" mono/>
                  </div>
                  <button type="button"
                    onClick={async () => {
                      if (!form.upc?.trim()) { toast.error('Enter UPC first'); return }
                      setUpcLooking(true)
                      const toastId = toast.loading('🔍 Looking up barcode...')
                      try {
                        const off = await lookupUPC(form.upc.trim())
                        if (!off.found) { toast.error('Product not found in database', {id:toastId}); return }
                        toast.loading('🤖 AI enriching info...', {id:toastId})
                        const ai = await aiEnrichUPC(off.raw)
                        // Auto-fill fields
                        if (ai.name || off.name)        set('name',        ai.name || off.name)
                        if (ai.description || off.description) set('description', ai.description || off.description)
                        if (ai.unit)                    set('unit',        ai.unit)
                        if (ai.suggested_price)         set('price',       String(ai.suggested_price))
                        if (off.image_url) set('image_url', off.image_url.replace('http://', 'https://'))
                        toast.success('✓ Product info filled!', {id:toastId})
                      } catch(e) {
                        toast.error('Lookup failed', {id:toastId})
                      } finally {
                        setUpcLooking(false)
                      }
                    }}
                    disabled={upcLooking || !form.upc?.trim()}
                    className="rounded-xl px-3 text-[11px] font-bold cursor-pointer border-none flex-shrink-0 disabled:opacity-40 whitespace-nowrap"
                    style={{background: upcLooking ? '#E6F0FF' : '#000000', color:'#fff', height:'40px'}}>
                    {upcLooking ? '⏳' : '🔍 Lookup'}
                  </button>
                </div>
              </div>
            </div>

            {/* Category */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <Label>Main Category</Label>
                <select value={selCatId}
                  onChange={e=>{if(e.target.value==='__add__'){setShowAddCat(true);return};setSelCatId(e.target.value);set('subcategory_id','')}}
                  className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#1F1F1F'}}>
                  <option value="">— No category —</option>
                  <option value="__add__">✚ Add new...</option>
                  {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Subcategory</Label>
                <select value={form.subcategory_id}
                  onChange={e=>{if(e.target.value==='__add__'){setShowAddSub(true);setNewSubCatId(selCatId);return};set('subcategory_id',e.target.value);const pc=categories.find(c=>c.subcategories?.some(s=>s.id===e.target.value));if(pc)setSelCatId(pc.id)}}
                  className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#1F1F1F'}}>
                  <option value="">— No subcategory —</option>
                  <option value="__add__">✚ Add new...</option>
                  {categories.map(c=>(
                    c.subcategories?.length > 0 && (
                      <optgroup key={c.id} label={c.name}>
                        {c.subcategories.sort((a,b)=>a.sort_order-b.sort_order).map(s=>(
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </optgroup>
                    )
                  ))}
                </select>
              </div>
            </div>

            {/* Display order + Tags */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <Label>Display Order</Label>
                <Input type="number" value={form.sort_order} onChange={e=>set('sort_order',e.target.value)} mono/>
              </div>
              <div>
                <Label>Tags</Label>
                {/* Input — type & Enter to add, OR pick from existing below */}
                <input value={tagInput} onChange={e=>setTagInput(e.target.value)}
                  onKeyDown={e=>{
                    if(e.key==='Enter' && tagInput.trim()){
                      e.preventDefault()
                      const t = tagInput.trim().toLowerCase()
                      if(!form.tags.includes(t)) set('tags',[...form.tags, t])
                      setTagInput('')
                    }
                  }}
                  placeholder="Type new tag + Enter, or click existing below"
                  className="w-full rounded-xl px-3 py-2.5 text-[12px] outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#1F1F1F'}}/>

                {/* Currently selected tags (removable pills) */}
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {form.tags.map(t=>(
                      <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
                        style={{background:'#006AFF', color:'#FFFFFF'}}>
                        ✓ {t}
                        <button onClick={()=>set('tags',form.tags.filter(x=>x!==t))}
                          className="bg-transparent border-none cursor-pointer ml-0.5 text-[10px] text-white opacity-80 hover:opacity-100">✕</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Existing tags (filtered by input, excluding already-picked) */}
                {(() => {
                  const filter = tagInput.trim().toLowerCase()
                  const available = existingTags
                    .filter(t => !form.tags.includes(t))
                    .filter(t => !filter || t.includes(filter))
                    .slice(0, 20)
                  if (existingTags.length === 0) return (
                    <div className="text-[10px] text-slate-400 mt-1.5 italic">No tags used yet across your products.</div>
                  )
                  if (available.length === 0 && filter) return (
                    <div className="text-[10px] text-slate-400 mt-1.5">No existing tag matches "{filter}" — press Enter to add as new.</div>
                  )
                  if (available.length === 0) return null
                  return (
                    <div className="mt-2">
                      <div className="text-[10px] text-slate-500 mb-1 font-bold uppercase tracking-wider">Pick from existing</div>
                      <div className="flex flex-wrap gap-1">
                        {available.map(t => (
                          <button key={t} onClick={()=>{set('tags',[...form.tags, t]); setTagInput('')}}
                            className="px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-all"
                            style={{background:'#f1f5f9', color:'#475569', border:'1px solid #e2e8f0'}}
                            onMouseEnter={e=>{e.target.style.background='#E6F0FF'; e.target.style.color='#006AFF'; e.target.style.borderColor='#80B2FF'}}
                            onMouseLeave={e=>{e.target.style.background='#f1f5f9'; e.target.style.color='#475569'; e.target.style.borderColor='#e2e8f0'}}>
                            + {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          </Section>

          {/* ── PRICING ── */}
          <Section title="Pricing & Inventory" icon="💰" color="#16a34a">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <Label required>Selling Price</Label>
                <div className="flex items-center rounded-xl px-3 transition-all"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}
                  onFocusCapture={e=>{e.currentTarget.style.borderColor='#16a34a';e.currentTarget.style.background='#fff'}}
                  onBlurCapture={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.background='#f8fafc'}}>
                  <span className="text-slate-400 mr-1">$</span>
                  <input type="number" value={form.price} onChange={e=>set('price',e.target.value)}
                    placeholder="0.00" step="0.01"
                    className="flex-1 border-none outline-none py-2.5 text-[14px] font-mono font-bold bg-transparent"
                    style={{color:'#16a34a'}}/>
                </div>
              </div>
              <div>
                <Label>Cost Price</Label>
                <div className="flex items-center rounded-xl px-3 transition-all"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}
                  onFocusCapture={e=>{e.currentTarget.style.borderColor='#006AFF';e.currentTarget.style.background='#fff'}}
                  onBlurCapture={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.background='#f8fafc'}}>
                  <span className="text-slate-400 mr-1">$</span>
                  <input type="number" value={form.cost} onChange={e=>set('cost',e.target.value)}
                    placeholder="0.00" step="0.01"
                    className="flex-1 border-none outline-none py-2.5 text-[13px] font-mono bg-transparent" style={{color:'#1F1F1F'}}/>
                </div>
              </div>
              <div>
                <Label>Unit</Label>
                <select value={form.unit} onChange={e=>set('unit',e.target.value)}
                  className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#1F1F1F'}}>
                  {UNITS.map(u=><option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            {/* Margin preview */}
            {margin && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  ['Margin', `${margin}%`, parseFloat(margin)>=30?'#16a34a':parseFloat(margin)>=10?'#d97706':'#dc2626'],
                  ['Profit/Unit', `$${profit}`, '#006AFF'],
                  ['Cost', `$${parseFloat(form.cost||0).toFixed(2)}`, '#64748b'],
                ].map(([l,v,c])=>(
                  <div key={l} className="rounded-xl p-2.5 text-center" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                    <div className="text-[9px] text-slate-400 uppercase tracking-wider">{l}</div>
                    <div className="text-[15px] font-bold mt-0.5" style={{color:c}}>{v}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Opening stock + Tax */}
            <div className="grid grid-cols-2 gap-3">
              {!form.id && form.track_inventory && (
                <div>
                  <Label>Opening Stock (QTY)</Label>
                  <Input type="number" value={form.qty} onChange={e=>set('qty',e.target.value)} placeholder="0" mono/>
                </div>
              )}
              <div className={!form.id && form.track_inventory ? '' : 'col-span-2'}>
                <Label>
                  Tax
                  {!form.tax_exempt && totalTax > 0 && (
                    <span className="ml-2 text-yellow-600 font-bold normal-case">{(totalTax*100).toFixed(2)}% total</span>
                  )}
                </Label>

                {/* Tax Exempt? toggle — ALWAYS shown, default No (taxable) */}
                <div className="rounded-xl p-3 mb-2" style={{background:'#f8fafc', border:'1.5px solid #e2e8f0'}}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12px] font-bold text-slate-700">Tax Exempt?</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {form.tax_exempt
                          ? 'No tax will be charged on this product.'
                          : 'Product is taxable. Pick which taxes apply below.'}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={()=>set('tax_exempt', false)}
                        className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border transition-all"
                        style={!form.tax_exempt
                          ? {background:'#15803d', color:'#fff', borderColor:'#15803d'}
                          : {background:'#fff', color:'#475569', borderColor:'#e2e8f0'}}>
                        No
                      </button>
                      <button onClick={()=>set('tax_exempt', true)}
                        className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border transition-all"
                        style={form.tax_exempt
                          ? {background:'#dc2626', color:'#fff', borderColor:'#dc2626'}
                          : {background:'#fff', color:'#475569', borderColor:'#e2e8f0'}}>
                        Yes
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tax-rate multi-select checkboxes — only when NOT exempt */}
                {!form.tax_exempt && (
                  taxRates.length === 0 ? (
                    <div className="rounded-lg px-3 py-2 text-[11px]"
                      style={{background:'#fef9c3', color:'#92400e', border:'1px solid #fde68a'}}>
                      ⓘ No tax rates configured yet. Add them in <b>Settings → Tax Rates</b>, then come back to tick which apply.
                    </div>
                  ) : (
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        Apply these taxes
                      </div>
                      <div className="space-y-1.5">
                        {taxRates.map(tr => {
                          const checked = form.selectedTaxRates.includes(tr.id)
                          return (
                            <label key={tr.id}
                              onClick={()=>set('selectedTaxRates', checked
                                ? form.selectedTaxRates.filter(t=>t!==tr.id)
                                : [...form.selectedTaxRates, tr.id])}
                              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all"
                              style={checked
                                ? {background:'#fef9c3', border:'1.5px solid #ca8a04'}
                                : {background:'#f8fafc', border:'1.5px solid #e2e8f0'}}>
                              <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0"
                                  style={checked
                                    ? {borderColor:'#ca8a04', background:'#ca8a04'}
                                    : {borderColor:'#cbd5e1', background:'#fff'}}>
                                  {checked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                                </div>
                                <span className="text-[12px] font-medium text-slate-700">{tr.name}</span>
                              </div>
                              <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded"
                                style={{background: checked ? '#fff' : '#f1f5f9', color:'#ca8a04'}}>
                                {(tr.rate*100).toFixed(2)}%
                              </span>
                            </label>
                          )
                        })}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1.5">
                        💡 Tick multiple boxes to stack taxes (e.g. state + city).
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </Section>

          {/* ── VIP & LOYALTY ── */}
          <Section title="VIP & Loyalty" icon="⭐" color="#006AFF">
            {/* VIP */}
            <div className="mb-4">
              <Toggle checked={form.allow_vip} onChange={()=>set('allow_vip',!form.allow_vip)}
                label="Allow VIP Discount / Price"
                desc="VIP members get their tier discount on this product"/>
              {form.allow_vip && (
                <div className="mt-3 ml-12">
                  <Label>VIP Override Price <span className="text-slate-400 font-normal normal-case">(optional — overrides % discount)</span></Label>
                  <div className="flex items-center rounded-xl px-3 w-40 transition-all"
                    style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}>
                    <span className="text-slate-400 mr-1">$</span>
                    <input type="number" value={form.vip_price} onChange={e=>set('vip_price',e.target.value)}
                      placeholder="VIP price" step="0.01"
                      className="flex-1 border-none outline-none py-2.5 text-[13px] font-mono bg-transparent" style={{color:'#006AFF'}}/>
                  </div>
                  {form.vip_price && form.price && (
                    <div className="mt-1.5 flex items-center gap-2 text-[12px]">
                      <span className="line-through text-slate-400">${parseFloat(form.price).toFixed(2)}</span>
                      <span className="font-bold text-purple-600">VIP: ${parseFloat(form.vip_price).toFixed(2)}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-600">
                        Save ${(parseFloat(form.price)-parseFloat(form.vip_price)).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Points Earn */}
            <div className="mb-4">
              <Toggle checked={form.points_redeemable} onChange={()=>set('points_redeemable',!form.points_redeemable)}
                label="Customers Earn Points"
                desc="Points are awarded when this product is purchased"/>
              {form.points_redeemable && (
                <div className="mt-3 ml-12">
                  <div className="flex gap-3 mb-3">
                    {[['amount','$ → Points'],['fixed','Fixed Points']].map(([m,l])=>(
                      <label key={m} className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer border flex-1 transition-all ${
                        form.points_mode===m ? 'border-yellow-400 bg-yellow-50' : 'border-slate-200 bg-slate-50'
                      }`} onClick={()=>set('points_mode',m)}>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          form.points_mode===m ? 'border-yellow-500 bg-yellow-500' : 'border-slate-300'
                        }`}>
                          {form.points_mode===m && <div className="w-2 h-2 rounded-full bg-white"/>}
                        </div>
                        <span className="text-[12px] font-medium text-slate-700">{l}</span>
                      </label>
                    ))}
                  </div>
                  {form.points_mode==='amount' ? (
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                      style={{border:'1.5px solid #fde047', background:'#fffbeb', maxWidth:'220px'}}>
                      <span className="text-[12px] text-amber-600 font-semibold">$1 =</span>
                      <input type="number" value={form.points_rate} onChange={e=>set('points_rate',e.target.value)}
                        placeholder="1" step="0.1" min="0"
                        className="flex-1 border-none outline-none text-[14px] font-bold font-mono bg-transparent text-center" style={{color:'#ca8a04', width:'60px'}}/>
                      <span className="text-[12px] text-amber-600 font-semibold">pts</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                      style={{border:'1.5px solid #fde047', background:'#fffbeb', maxWidth:'220px'}}>
                      <input type="number" value={form.points_fixed} onChange={e=>set('points_fixed',e.target.value)}
                        placeholder="10" min="0"
                        className="flex-1 border-none outline-none text-[14px] font-bold font-mono bg-transparent text-center" style={{color:'#ca8a04'}}/>
                      <span className="text-[12px] text-amber-600 font-semibold">pts / purchase</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Points Redeem */}
            <div className="pt-4" style={{borderTop:'1px solid #f1f5f9'}}>
              <Toggle checked={form.points_redeem ?? false} onChange={()=>set('points_redeem',!form.points_redeem)}
                label="Allow Points Redemption"
                desc="Customers can use points to pay for this product"/>
              {form.points_redeem && (
                <div className="mt-3 ml-12">
                  <div className="text-[11px] text-slate-500 mb-2">Points required to redeem this product for free:</div>
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                    style={{border:'1.5px solid #c4b5fd', background:'#faf5ff', maxWidth:'220px'}}>
                    <input type="number" value={form.redeem_points_required || ''} onChange={e=>set('redeem_points_required',e.target.value)}
                      placeholder="e.g. 500" min="1"
                      className="flex-1 border-none outline-none text-[14px] font-bold font-mono bg-transparent text-center" style={{color:'#006AFF'}}/>
                    <span className="text-[12px] text-purple-500 font-semibold">pts</span>
                  </div>
                  {form.redeem_points_required && form.price && (
                    <div className="mt-2 text-[11px] text-slate-500">
                      = ${parseFloat(form.price).toFixed(2)} value ·
                      <span className="text-purple-600 font-semibold ml-1">
                        1 pt = ${(parseFloat(form.price)/parseFloat(form.redeem_points_required)).toFixed(4)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* ── COMMISSION ── */}
          <Section title="Staff Commission" icon="👤" color="#d97706">
            <div>
              <Label>Commission Type</Label>
              <div className="flex gap-2 mb-3">
                {[['none','None'],['fixed','Fixed $'],['pct_sell','% Sell Price'],['pct_cost','% Cost Price']].map(([t,l])=>(
                  <label key={t} className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer border flex-1 transition-all ${
                    form.commission_type===t ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50 hover:bg-white'
                  }`}>
                    <input type="radio" name="commission_type" value={t} checked={form.commission_type===t}
                      onChange={()=>set('commission_type',t)} className="accent-amber-500 w-3.5 h-3.5"/>
                    <span className="text-[11px] font-medium text-slate-700">{l}</span>
                  </label>
                ))}
              </div>
              {form.commission_type !== 'none' && (
                <div>
                  <Label>{form.commission_type==='fixed' ? 'Commission Amount ($)' : 'Commission Rate (%)'}</Label>
                  <div className="flex items-center rounded-xl px-3 w-48"
                    style={{border:'1.5px solid #fcd34d', background:'#fffbeb'}}>
                    <span className="text-slate-400 mr-1">{form.commission_type==='fixed'?'$':'%'}</span>
                    <input type="number" value={form.commission_value} onChange={e=>set('commission_value',e.target.value)}
                      placeholder={form.commission_type==='fixed'?'5.00':'10'} step="0.01"
                      className="flex-1 border-none outline-none py-2.5 text-[13px] font-mono bg-transparent"/>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* ── CHECKOUT BEHAVIOR ── */}
          <Section title="Checkout Behavior" icon="🛒" color="#0891b2">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <Toggle checked={form.prompt_weight}   onChange={()=>set('prompt_weight',  !form.prompt_weight)}
                label="Prompt Weight" desc="Numpad pops up for weight entry"/>
              <Toggle checked={form.prompt_price}    onChange={()=>set('prompt_price',   !form.prompt_price)}
                label="Prompt Price" desc="Numpad pops up for price entry"/>
              <Toggle checked={form.has_serial}      onChange={()=>set('has_serial',     !form.has_serial)}
                label="Track Serial Numbers" desc="Scan serials when receiving and selling"/>
              <Toggle checked={form.prompt_sales}    onChange={()=>set('prompt_sales',   !form.prompt_sales)}
                label="Prompt Staff" desc="Auto pop up staff list when adding to cart"/>
              <Toggle checked={form.track_inventory} onChange={()=>set('track_inventory',!form.track_inventory)}
                label="Track Inventory" desc="Show stock levels and low stock alerts"/>
            </div>
          </Section>

          {/* ── PROMOTIONS (existing products only) ── */}
          {form.id && (
            <Section title="Promotions" icon="🏷️" color="#dc2626">
              <ProductPromotions productId={form.id} productName={form.name}
                productPrice={form.price} tenantId={tenantId}/>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3 sticky bottom-0"
          style={{background:'#FFFFFF', borderTop:'1.5px solid #e2e8f0', paddingTop:'16px'}}>
          <button onClick={onClose}
            className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border transition-all"
            style={{background:'#fff', border:'1.5px solid #e2e8f0', color:'#64748b'}}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving||uploading}
            className="flex-[2] rounded-xl py-3 text-[13px] font-bold text-white cursor-pointer border-none disabled:opacity-50 transition-all"
            style={{background:'#000000'}}>
            {saving ? '⏳ Saving...' : form.id ? '✓ Update Product' : '✓ Add Product'}
          </button>
        </div>

        {/* Add Category modal */}
        {showAddCat && (
          <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center" onClick={()=>setShowAddCat(false)}>
            <div className="bg-white rounded-2xl w-[320px] p-5 shadow-md" onClick={e=>e.stopPropagation()}>
              <div className="text-[15px] font-bold mb-3">✚ Add Main Category</div>
              <input value={newCatName} onChange={e=>setNewCatName(e.target.value)} autoFocus
                placeholder="Category name..." onKeyDown={async e=>{
                  if(e.key==='Enter'&&newCatName.trim()){ await addCategory() }
                }}
                className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none mb-3"
                style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
              <div className="flex gap-2">
                <button onClick={()=>{setShowAddCat(false);setNewCatName('')}}
                  className="flex-1 rounded-xl py-2 text-[12px] text-slate-500 cursor-pointer border border-slate-200 bg-slate-50">Cancel</button>
                <button disabled={!newCatName.trim()} onClick={addCategory}
                  className="flex-[2] rounded-xl py-2 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                  style={{background:'#006AFF'}}>✓ Add</button>
              </div>
            </div>
          </div>
        )}

        {/* Add Subcategory modal */}
        {showAddSub && (
          <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center" onClick={()=>setShowAddSub(false)}>
            <div className="bg-white rounded-2xl w-[360px] p-5 shadow-md" onClick={e=>e.stopPropagation()}>
              <div className="text-[15px] font-bold mb-4">✚ Add Subcategory</div>
              <div className="mb-3">
                <Label>Main Category *</Label>
                <select value={newSubCatId} onChange={e=>setNewSubCatId(e.target.value)} autoFocus
                  className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}>
                  <option value="">— Select category —</option>
                  {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="mb-4">
                <Label>Subcategory Name *</Label>
                <input value={newSubName} onChange={e=>setNewSubName(e.target.value)} disabled={!newSubCatId}
                  placeholder="e.g. Phones, Dairy, Repair..."
                  className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none disabled:opacity-40"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
              </div>
              <div className="flex gap-2">
                <button onClick={()=>{setShowAddSub(false);setNewSubName('');setNewSubCatId('')}}
                  className="flex-1 rounded-xl py-2 text-[12px] text-slate-500 cursor-pointer border border-slate-200 bg-slate-50">Cancel</button>
                <button disabled={!newSubName.trim()||!newSubCatId} onClick={addSubcategory}
                  className="flex-[2] rounded-xl py-2 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                  style={{background:'#006AFF'}}>✓ Add</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Promotions section inside ProductForm ──
function ProductPromotions({ productId, productName, productPrice, tenantId }) {
  const qc = useQueryClient()
  const [adding,    setAdding]    = useState(false)
  const [type,      setType]      = useState('sale')
  const [saving,    setSaving]    = useState(false)
  const [saleStart, setSaleStart] = useState('')
  const [saleEnd,   setSaleEnd]   = useState('')
  const [saleType,  setSaleType]  = useState('fixed')
  const [saleVal,   setSaleVal]   = useState('')
  const [bulkQty,   setBulkQty]   = useState('')
  const [bulkType,  setBulkType]  = useState('fixed')
  const [bulkVal,   setBulkVal]   = useState('')
  const [timeDays,  setTimeDays]  = useState([])
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd,   setTimeEnd]   = useState('')
  const [timeType,  setTimeType]  = useState('fixed')
  const [timeVal,   setTimeVal]   = useState('')

  const { data: promos=[] } = useQuery({
    queryKey: ['product-promos', productId],
    queryFn: async () => {
      const { data } = await supabase.from('promotions').select('*')
        .eq('product_id', productId).order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!productId,
  })

  const togglePromo = async (p) => {
    await supabase.from('promotions').update({ is_active: !p.is_active }).eq('id', p.id)
    qc.invalidateQueries(['product-promos', productId])
    qc.invalidateQueries(['promotions'])
  }
  const deletePromo = async (id) => {
    if (!confirm('Delete this promotion?')) return
    await supabase.from('promotions').delete().eq('id', id)
    qc.invalidateQueries(['product-promos', productId])
    qc.invalidateQueries(['promotions'])
  }

  const savePromo = async () => {
    setSaving(true)
    try {
      const base = { tenant_id: tenantId, product_id: productId, type, is_active: true }
      let payload
      if (type==='sale') {
        if (!saleStart||!saleEnd||!saleVal) { toast.error('Fill all fields'); setSaving(false); return }
        payload = { ...base, name:`${productName} Sale`, sale_start:saleStart, sale_end:saleEnd, sale_type:saleType, sale_value:parseFloat(saleVal) }
      } else if (type==='bulk') {
        if (!bulkQty||!bulkVal) { toast.error('Fill all fields'); setSaving(false); return }
        payload = { ...base, name:`${productName} Bulk`, bulk_tiers:[{ min_qty:parseInt(bulkQty), type:bulkType, value:parseFloat(bulkVal) }] }
      } else {
        if (!timeDays.length||!timeStart||!timeEnd||!timeVal) { toast.error('Fill all fields'); setSaving(false); return }
        payload = { ...base, name:`${productName} Time`, time_rules:[{ days:timeDays, start_time:timeStart, end_time:timeEnd, type:timeType, value:parseFloat(timeVal) }] }
      }
      await supabase.from('promotions').insert(payload)
      qc.invalidateQueries(['product-promos', productId])
      qc.invalidateQueries(['promotions'])
      setAdding(false); setSaleVal(''); setBulkQty(''); setBulkVal(''); setTimeVal(''); setTimeDays([])
      toast.success('Promotion added ✓')
    } catch(err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const TYPE_COLOR = { sale:'#006AFF', bulk:'#16a34a', time:'#d97706' }
  const TYPE_ICON  = { sale:'🏷️', bulk:'📦', time:'⏰' }
  const TYPE_NAME  = { sale:'Sale', bulk:'Bulk', time:'Time' }

  return (
    <div>
      {/* Existing promos */}
      {promos.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          {promos.map(p => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{background:'#f8fafc', border:`1.5px solid ${p.is_active ? TYPE_COLOR[p.type]+'40' : '#e2e8f0'}`}}>
              <span className="text-[16px]">{TYPE_ICON[p.type]}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-700">{p.name}</div>
                <div className="text-[10px] text-slate-400 truncate">{TYPE_NAME[p.type]} promotion</div>
              </div>
              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${p.is_active?'text-green-700 bg-green-100':'text-slate-400 bg-slate-100'}`}>
                {p.is_active?'ACTIVE':'PAUSED'}
              </span>
              <button onClick={()=>togglePromo(p)}
                className="text-[10px] px-2.5 py-1 rounded-lg border cursor-pointer transition-all"
                style={p.is_active?{background:'#fff1f2',borderColor:'#fecdd3',color:'#e11d48'}:{background:'#dcfce7',borderColor:'#86efac',color:'#16a34a'}}>
                {p.is_active?'Pause':'On'}
              </button>
              <button onClick={()=>deletePromo(p.id)}
                className="text-slate-400 hover:text-red-500 bg-transparent border-none cursor-pointer">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Add new inline */}
      {!adding ? (
        <button onClick={()=>setAdding(true)}
          className="w-full rounded-xl py-2.5 text-[12px] font-semibold cursor-pointer border-2 border-dashed transition-all"
          style={{borderColor:'#B3D1FF', color:'#006AFF', background:'#E6F0FF'}}>
          + Add Promotion
        </button>
      ) : (
        <div className="rounded-xl p-4" style={{background:'#E6F0FF', border:'1.5px solid #B3D1FF'}}>
          <div className="flex gap-2 mb-3">
            {[['sale','🏷️ Sale'],['bulk','📦 Bulk'],['time','⏰ Time']].map(([t,l])=>(
              <button key={t} onClick={()=>setType(t)}
                className="flex-1 py-2 rounded-xl text-[11px] font-bold cursor-pointer border-2 transition-all"
                style={type===t?{background:`${TYPE_COLOR[t]}18`,borderColor:TYPE_COLOR[t],color:TYPE_COLOR[t]}:{background:'#fff',borderColor:'#e2e8f0',color:'#64748b'}}>
                {l}
              </button>
            ))}
          </div>

          {type==='sale' && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] text-slate-500 mb-1">Start</div>
                  <input type="datetime-local" value={saleStart} onChange={e=>setSaleStart(e.target.value)}
                    className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none"
                    style={{border:'1.5px solid #B3D1FF', background:'#fff'}}/>
                </div>
                <div>
                  <div className="text-[9px] text-slate-500 mb-1">End</div>
                  <input type="datetime-local" value={saleEnd} onChange={e=>setSaleEnd(e.target.value)}
                    className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none"
                    style={{border:'1.5px solid #B3D1FF', background:'#fff'}}/>
                </div>
              </div>
              <div className="flex gap-2">
                <select value={saleType} onChange={e=>setSaleType(e.target.value)}
                  className="rounded-lg px-2 py-2 text-[11px] outline-none" style={{border:'1.5px solid #B3D1FF',background:'#fff'}}>
                  <option value="fixed">$ Fixed Price</option>
                  <option value="pct">% Off</option>
                </select>
                <input type="number" value={saleVal} onChange={e=>setSaleVal(e.target.value)}
                  placeholder={saleType==='fixed'?'Sale price':'% off'} step="0.01"
                  className="flex-1 rounded-lg px-3 py-2 text-[12px] font-mono outline-none"
                  style={{border:'1.5px solid #B3D1FF',background:'#fff'}}/>
              </div>
              {saleVal && productPrice && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="line-through text-slate-400">${parseFloat(productPrice||0).toFixed(2)}</span>
                  <span className="font-bold text-indigo-600">→ ${saleType==='fixed'?parseFloat(saleVal).toFixed(2):(parseFloat(productPrice||0)*(1-parseFloat(saleVal)/100)).toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          {type==='bulk' && (
            <div className="flex gap-2 items-center">
              <span className="text-[11px] text-slate-600 whitespace-nowrap">Buy</span>
              <input type="number" value={bulkQty} onChange={e=>setBulkQty(e.target.value)} placeholder="2" min="2"
                className="w-16 rounded-lg px-2 py-2 text-[12px] font-mono outline-none" style={{border:'1.5px solid #86efac',background:'#fff'}}/>
              <span className="text-[11px] text-slate-600">or more →</span>
              <select value={bulkType} onChange={e=>setBulkType(e.target.value)}
                className="rounded-lg px-2 py-2 text-[11px] outline-none" style={{border:'1.5px solid #86efac',background:'#fff'}}>
                <option value="fixed">$ Each</option>
                <option value="pct">% Off</option>
              </select>
              <input type="number" value={bulkVal} onChange={e=>setBulkVal(e.target.value)} placeholder={bulkType==='fixed'?'8.00':'10'} step="0.01"
                className="flex-1 rounded-lg px-2 py-2 text-[12px] font-mono outline-none" style={{border:'1.5px solid #86efac',background:'#fff'}}/>
            </div>
          )}

          {type==='time' && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-1">
                {DAYS.map((d,i)=>(
                  <button key={i} onClick={()=>setTimeDays(ds=>ds.includes(i)?ds.filter(x=>x!==i):[...ds,i].sort())}
                    className="w-9 h-8 rounded-lg text-[10px] font-bold cursor-pointer border-2 transition-all"
                    style={timeDays.includes(i)?{background:'#f59e0b',borderColor:'#f59e0b',color:'#fff'}:{background:'#fff',borderColor:'#e2e8f0',color:'#64748b'}}>
                    {d.substring(0,2)}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <input type="time" value={timeStart} onChange={e=>setTimeStart(e.target.value)}
                  className="rounded-lg px-2 py-2 text-[11px] outline-none" style={{border:'1.5px solid #fde047',background:'#fff'}}/>
                <span className="text-[11px] text-slate-400">to</span>
                <input type="time" value={timeEnd} onChange={e=>setTimeEnd(e.target.value)}
                  className="rounded-lg px-2 py-2 text-[11px] outline-none" style={{border:'1.5px solid #fde047',background:'#fff'}}/>
                <select value={timeType} onChange={e=>setTimeType(e.target.value)}
                  className="rounded-lg px-2 py-2 text-[11px] outline-none" style={{border:'1.5px solid #fde047',background:'#fff'}}>
                  <option value="fixed">$ Price</option>
                  <option value="pct">% Off</option>
                </select>
                <input type="number" value={timeVal} onChange={e=>setTimeVal(e.target.value)} placeholder={timeType==='fixed'?'3.00':'10'} step="0.01"
                  className="w-20 rounded-lg px-2 py-2 text-[12px] font-mono outline-none" style={{border:'1.5px solid #fde047',background:'#fff'}}/>
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <button onClick={()=>{setAdding(false);setSaleVal('');setBulkQty('');setBulkVal('');setTimeVal('');setTimeDays([])}}
              className="flex-1 rounded-xl py-2 text-[12px] text-slate-500 cursor-pointer border border-slate-200 bg-white">Cancel</button>
            <button onClick={savePromo} disabled={saving}
              className="flex-[2] rounded-xl py-2 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-50"
              style={{background:'#000000'}}>
              {saving?'⏳ Saving...':'✓ Add Promotion'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
