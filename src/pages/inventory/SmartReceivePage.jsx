// src/pages/inventory/SmartReceivePage.jsx
// Smart Receive - scan barcode → AI lookup → receive inventory
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import NumPad from '@/components/ui/NumPad'
import toast from 'react-hot-toast'

// ── Open Food Facts lookup ──
async function lookupBarcode(upc) {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${upc}.json`)
    const data = await res.json()
    if (data.status === 1 && data.product) {
      const p = data.product
      return {
        found: true,
        name:        p.product_name || p.product_name_en || '',
        brand:       p.brands || '',
        image_url:   p.image_front_url || p.image_url || '',
        description: p.generic_name || p.ingredients_text_en || '',
        quantity:    p.quantity || '',
        categories:  p.categories_tags?.[0]?.replace('en:','') || '',
        alcohol:     p.alcohol || '',
        raw:         p,
      }
    }
    return { found: false }
  } catch(e) {
    return { found: false }
  }
}

// ── Claude AI to enrich product info ──
async function aiEnrichProduct(rawData, storeName) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are a retail inventory assistant for a store called "${storeName}".

Given this product data from Open Food Facts:
${JSON.stringify(rawData, null, 2)}

Please respond with ONLY a JSON object (no markdown, no explanation):
{
  "name": "clean product name in English",
  "description": "short 1-2 sentence product description",
  "category_suggestion": "one of: Food & Beverage, Alcohol & Wine, Snacks, Dairy, Produce, Meat & Seafood, Health & Beauty, Household, Electronics, Clothing, Other",
  "unit": "one of: ea, lb, kg, oz, g, l, ml, bottle, can, pack, box, case",
  "suggested_retail_price": number (estimate based on typical retail, be reasonable),
  "product_type": "unit or weight or service"
}`
        }]
      })
    })
    const d = await res.json()
    const text = d.content?.[0]?.text || '{}'
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch(e) {
    return {}
  }
}

export default function SmartReceivePage() {
  const { tenant, store } = useAuthStore()
  const qc = useQueryClient()

  // Flow states
  const [step, setStep] = useState('scan') // scan → found/new → confirm → done
  const [barcode, setBarcode]     = useState('')
  const [scanning, setScanning]   = useState(false)
  const [looking,  setLooking]    = useState(false)

  // Product data
  const [existingProduct, setExistingProduct] = useState(null)
  const [offData,  setOffData]   = useState(null) // Open Food Facts data
  const [aiData,   setAiData]    = useState(null) // AI enriched data
  const [isNewProduct, setIsNewProduct] = useState(false)

  // Form
  const [form, setForm] = useState({
    name: '', description: '', unit: 'ea',
    price: '', cost: '', qty: '', vendor_id: '', notes: '',
    image_url: '', category_suggestion: '',
  })
  const setF = (k,v) => setForm(f=>({...f,[k]:v}))

  const [showQtyPad,  setShowQtyPad]  = useState(false)
  const [showCostPad, setShowCostPad] = useState(false)
  const [showPricePad,setShowPricePad]= useState(false)
  const [saving, setSaving] = useState(false)

  const barcodeRef = useRef()

  useEffect(() => { barcodeRef.current?.focus() }, [])

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('id,name')
        .eq('tenant_id', tenant.id).eq('is_active', true).order('name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const handleScan = async () => {
    if (!barcode.trim()) return
    setLooking(true)

    try {
      // 1. Check if product exists in our DB
      const { data: existing } = await supabase.from('products')
        .select('*, inventory(quantity, avg_cost)')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .or(`upc.eq.${barcode},sku.eq.${barcode}`)
        .maybeSingle()

      if (existing) {
        // Product found in our system
        setExistingProduct(existing)
        setForm(f => ({...f,
          name: existing.name,
          unit: existing.unit || 'ea',
          cost: String(existing.cost || ''),
          price: String(existing.price || ''),
          image_url: existing.image_url || '',
        }))
        setIsNewProduct(false)
        setStep('found')
        toast.success(`✓ Found: ${existing.name}`)
      } else {
        // Not in our system - lookup Open Food Facts
        toast('🔍 Looking up barcode...', { icon: '⏳' })
        const off = await lookupBarcode(barcode)
        setOffData(off)

        if (off.found) {
          toast('🤖 AI enriching product info...', { icon: '✨' })
          const ai = await aiEnrichProduct(off.raw, store?.name || 'My Store')
          setAiData(ai)
          setForm(f => ({...f,
            name:        ai.name || off.name || '',
            description: ai.description || off.description || '',
            unit:        ai.unit || 'ea',
            price:       ai.suggested_retail_price ? String(ai.suggested_retail_price) : '',
            image_url:   off.image_url || '',
            category_suggestion: ai.category_suggestion || '',
          }))
          toast.success('✓ Product info found!')
        } else {
          toast('Product not found in database. Please fill in manually.', { icon: '📝' })
        }
        setIsNewProduct(true)
        setStep('new')
      }
    } catch(err) {
      toast.error('Error: ' + err.message)
    } finally {
      setLooking(false)
    }
  }

  const handleReceive = async () => {
    if (!form.qty || parseFloat(form.qty) <= 0) { toast.error('Enter quantity'); return }
    setSaving(true)
    try {
      let productId = existingProduct?.id

      if (isNewProduct) {
        // Create new product first
        if (!form.name.trim()) { toast.error('Product name required'); setSaving(false); return }
        const { data: newProduct, error } = await supabase.from('products').insert({
          tenant_id:      tenant.id,
          name:           form.name.trim(),
          description:    form.description || null,
          upc:            barcode,
          price:          parseFloat(form.price) || 0,
          cost:           parseFloat(form.cost)  || 0,
          unit:           form.unit,
          type:           'unit',
          image_url:      form.image_url || null,
          is_active:      true,
          track_inventory: true,
        }).select().single()
        if (error) throw error
        productId = newProduct.id

        // Create inventory record
        await supabase.from('inventory').insert({
          tenant_id: tenant.id,
          product_id: productId,
          quantity: 0,
          avg_cost: parseFloat(form.cost) || 0,
        })
        toast.success(`✓ New product created: ${form.name}`)
      }

      // Receive inventory
      const qty  = parseFloat(form.qty)
      const cost = parseFloat(form.cost) || 0

      const { data: inv } = await supabase.from('inventory')
        .select('id,quantity,avg_cost').eq('product_id', productId).maybeSingle()

      if (inv) {
        const newQty     = (inv.quantity||0) + qty
        const newAvgCost = newQty > 0 ? ((inv.avg_cost||0)*(inv.quantity||0) + cost*qty) / newQty : cost
        await supabase.from('inventory').update({
          quantity: newQty, avg_cost: newAvgCost, updated_at: new Date().toISOString()
        }).eq('id', inv.id)
      }

      await supabase.from('inventory_receives').insert({
        tenant_id:  tenant.id,
        product_id: productId,
        vendor_id:  form.vendor_id || null,
        qty,
        cost,
        notes: form.notes || null,
      })

      qc.invalidateQueries(['products'])
      toast.success(`✓ Received ${qty} ${form.unit} of ${form.name}`)
      setStep('done')
    } catch(err) {
      toast.error('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setStep('scan'); setBarcode(''); setExistingProduct(null)
    setOffData(null); setAiData(null); setIsNewProduct(false)
    setForm({ name:'', description:'', unit:'ea', price:'', cost:'', qty:'', vendor_id:'', notes:'', image_url:'', category_suggestion:'' })
    setTimeout(() => barcodeRef.current?.focus(), 100)
  }

  return (
    <div className="h-full overflow-auto p-6" style={{background:'#f0f2f5'}}>
      <div style={{maxWidth:'680px', margin:'0 auto'}}>

        {/* Header */}
        <div className="mb-6">
          <div className="text-[22px] font-bold text-slate-800">📥 Smart Receive</div>
          <div className="text-[13px] text-slate-400 mt-0.5">
            Scan or enter barcode — AI automatically identifies and creates products
          </div>
        </div>

        {/* ── STEP 1: SCAN ── */}
        {step === 'scan' && (
          <div className="rounded-2xl p-6 shadow-sm" style={{background:'#fff', border:'1.5px solid #e2e8f0'}}>
            <div className="text-[14px] font-bold text-slate-700 mb-4">
              Step 1 — Scan or Enter Barcode / UPC
            </div>

            <div className="flex gap-3">
              <div className="flex-1 flex items-center rounded-xl px-4 gap-2"
                style={{border:'2px solid #6366f1', background:'#f8fafc'}}>
                <span className="text-[20px]">🔍</span>
                <input
                  ref={barcodeRef}
                  value={barcode}
                  onChange={e => setBarcode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleScan()}
                  placeholder="Scan barcode or type UPC..."
                  className="flex-1 border-none outline-none py-3 text-[16px] font-mono bg-transparent"
                  style={{color:'#1e293b'}}
                  autoFocus
                />
                {barcode && (
                  <button onClick={() => setBarcode('')}
                    className="text-slate-400 bg-transparent border-none cursor-pointer">✕</button>
                )}
              </div>
              <button onClick={handleScan} disabled={!barcode.trim() || looking}
                className="rounded-xl px-6 py-3 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                {looking ? '⏳' : '→ Lookup'}
              </button>
            </div>

            {looking && (
              <div className="mt-4 p-4 rounded-xl text-center" style={{background:'#f0f4ff', border:'1px solid #c7d2fe'}}>
                <div className="text-[13px] text-indigo-700 font-semibold animate-pulse">
                  🔍 Searching database... 🤖 AI analyzing...
                </div>
              </div>
            )}

            <div className="mt-4 p-3 rounded-xl flex items-center gap-2"
              style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
              <span className="text-[16px]">💡</span>
              <span className="text-[12px] text-slate-500">
                If product exists in your inventory, it will be found immediately.
                New products are looked up in Open Food Facts database automatically.
              </span>
            </div>
          </div>
        )}

        {/* ── STEP 2A: EXISTING PRODUCT FOUND ── */}
        {step === 'found' && existingProduct && (
          <div className="flex flex-col gap-4">
            {/* Product card */}
            <div className="rounded-2xl overflow-hidden shadow-sm" style={{border:'1.5px solid #86efac'}}>
              <div className="px-5 py-3 flex items-center gap-2"
                style={{background:'#f0fdf4', borderBottom:'1px solid #dcfce7'}}>
                <span className="text-[18px]">✅</span>
                <span className="text-[13px] font-bold text-green-700">Product found in your inventory</span>
                <button onClick={reset} className="ml-auto text-[11px] text-slate-400 bg-transparent border-none cursor-pointer hover:text-slate-600">
                  ← Scan again
                </button>
              </div>
              <div className="p-4 flex gap-4" style={{background:'#fff'}}>
                {existingProduct.image_url && (
                  <img src={existingProduct.image_url} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0"
                    style={{border:'1px solid #e2e8f0'}}/>
                )}
                <div>
                  <div className="text-[18px] font-bold text-slate-800">{existingProduct.name}</div>
                  <div className="flex gap-4 mt-1 text-[12px] text-slate-500">
                    {existingProduct.sku && <span>SKU: {existingProduct.sku}</span>}
                    {existingProduct.upc && <span>UPC: {existingProduct.upc}</span>}
                  </div>
                  <div className="flex gap-4 mt-2">
                    <div className="text-[12px]">
                      <span className="text-slate-400">Price: </span>
                      <span className="font-bold text-indigo-600">${existingProduct.price}</span>
                    </div>
                    <div className="text-[12px]">
                      <span className="text-slate-400">In Stock: </span>
                      <span className="font-bold">{existingProduct.inventory?.reduce((a,i)=>a+(i.quantity||0),0)||0} {existingProduct.unit}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Receive form */}
            <ReceiveForm form={form} setF={setF} vendors={vendors}
              onQtyPad={() => setShowQtyPad(true)}
              onCostPad={() => setShowCostPad(true)}
              qty={parseFloat(form.qty)||0}/>

            <div className="flex gap-3">
              <button onClick={reset}
                className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border"
                style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
                ← Back
              </button>
              <button onClick={handleReceive} disabled={saving || !form.qty}
                className="flex-[2] rounded-xl py-3.5 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                style={{background:'linear-gradient(135deg,#16a34a,#15803d)'}}>
                {saving ? '⏳ Saving...' : `✓ Receive ${form.qty||0} ${form.unit}`}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2B: NEW PRODUCT ── */}
        {step === 'new' && (
          <div className="flex flex-col gap-4">
            {/* Status bar */}
            <div className="rounded-2xl overflow-hidden shadow-sm"
              style={{border:`1.5px solid ${offData?.found?'#a5b4fc':'#e2e8f0'}`}}>
              <div className="px-5 py-3 flex items-center gap-2"
                style={{background: offData?.found?'#f0f4ff':'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>
                <span className="text-[18px]">{offData?.found?'🤖':'📝'}</span>
                <div>
                  <div className="text-[13px] font-bold" style={{color: offData?.found?'#6366f1':'#64748b'}}>
                    {offData?.found ? 'AI found product info — please verify' : 'New product — fill in manually'}
                  </div>
                  <div className="text-[10px] text-slate-400">UPC: {barcode}</div>
                </div>
                <button onClick={reset} className="ml-auto text-[11px] text-slate-400 bg-transparent border-none cursor-pointer">
                  ← Scan again
                </button>
              </div>

              {/* AI found image + info */}
              {offData?.found && (
                <div className="p-4 flex gap-4" style={{background:'#fff'}}>
                  {form.image_url && (
                    <img src={form.image_url} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0"
                      style={{border:'1px solid #e2e8f0'}}/>
                  )}
                  <div>
                    {aiData?.category_suggestion && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full mb-1 inline-block"
                        style={{background:'#e0e7ff', color:'#6366f1'}}>
                        {aiData.category_suggestion}
                      </span>
                    )}
                    <div className="text-[11px] text-slate-400 mt-1">
                      {offData.brand && <span className="mr-2">Brand: {offData.brand}</span>}
                      {offData.quantity && <span>Size: {offData.quantity}</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Editable product info */}
            <div className="rounded-2xl p-5 shadow-sm" style={{background:'#fff', border:'1.5px solid #e2e8f0'}}>
              <div className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-3">
                Product Information
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Product Name *</div>
                  <input value={form.name} onChange={e=>setF('name',e.target.value)}
                    placeholder="Product name..." autoFocus
                    className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none"
                    style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Description</div>
                  <textarea value={form.description} onChange={e=>setF('description',e.target.value)}
                    rows={2} placeholder="Optional..."
                    className="w-full rounded-xl px-3 py-2 text-[12px] outline-none resize-none"
                    style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Unit</div>
                    <select value={form.unit} onChange={e=>setF('unit',e.target.value)}
                      className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                      style={{border:'1.5px solid #e2e8f0', background:'#fff'}}>
                      {['ea','lb','kg','oz','g','l','ml','bottle','can','pack','box','case'].map(u=>
                        <option key={u} value={u}>{u}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Retail Price</div>
                    <button onClick={()=>setShowPricePad(true)}
                      className="w-full rounded-xl px-3 py-2.5 text-left text-[14px] font-bold font-mono cursor-pointer"
                      style={{border:'1.5px solid #a5b4fc', background:'#eef2ff', color:'#6366f1'}}>
                      ${parseFloat(form.price||0).toFixed(2)}
                    </button>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Cost Price</div>
                    <button onClick={()=>setShowCostPad(true)}
                      className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] font-mono cursor-pointer"
                      style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#374151'}}>
                      ${parseFloat(form.cost||0).toFixed(2)}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Receive form */}
            <ReceiveForm form={form} setF={setF} vendors={vendors}
              onQtyPad={() => setShowQtyPad(true)}
              onCostPad={() => setShowCostPad(true)}
              qty={parseFloat(form.qty)||0}/>

            <div className="flex gap-3">
              <button onClick={reset}
                className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border"
                style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
                ← Back
              </button>
              <button onClick={handleReceive} disabled={saving || !form.qty || !form.name}
                className="flex-[2] rounded-xl py-3.5 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                style={{background:'linear-gradient(135deg,#16a34a,#15803d)'}}>
                {saving ? '⏳ Saving...' : `✓ Create & Receive ${form.qty||0} ${form.unit}`}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: DONE ── */}
        {step === 'done' && (
          <div className="rounded-2xl p-8 text-center shadow-sm" style={{background:'#fff', border:'1.5px solid #86efac'}}>
            <div className="text-[48px] mb-3">✅</div>
            <div className="text-[20px] font-bold text-green-700 mb-1">Received Successfully!</div>
            <div className="text-[13px] text-slate-500 mb-6">
              {form.qty} {form.unit} of <strong>{form.name}</strong> has been added to inventory
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={reset}
                className="rounded-xl px-6 py-3 text-[13px] font-bold text-white cursor-pointer border-none"
                style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                📥 Receive Another
              </button>
              <button onClick={() => window.location.href='/products'}
                className="rounded-xl px-6 py-3 text-[13px] font-semibold cursor-pointer border"
                style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
                View Products
              </button>
            </div>
          </div>
        )}
      </div>

      {/* NumPads */}
      {showQtyPad && (
        <NumPad title="Receive Quantity" subtitle={form.name}
          value={form.qty} onChange={v=>setF('qty',v)}
          allowNegative={false} allowDecimal={false}
          onConfirm={v=>{setF('qty',String(v));setShowQtyPad(false)}}
          onClose={()=>setShowQtyPad(false)}/>
      )}
      {showCostPad && (
        <NumPad title="Cost per Unit" subtitle={form.name}
          value={form.cost} onChange={v=>setF('cost',v)}
          prefix="$" allowNegative={false} allowDecimal={true}
          onConfirm={v=>{setF('cost',String(v));setShowCostPad(false)}}
          onClose={()=>setShowCostPad(false)}/>
      )}
      {showPricePad && (
        <NumPad title="Retail Price" subtitle={form.name}
          value={form.price} onChange={v=>setF('price',v)}
          prefix="$" allowNegative={false} allowDecimal={true}
          onConfirm={v=>{setF('price',String(v));setShowPricePad(false)}}
          onClose={()=>setShowPricePad(false)}/>
      )}
    </div>
  )
}

function ReceiveForm({ form, setF, vendors, onQtyPad, onCostPad, qty }) {
  return (
    <div className="rounded-2xl p-5 shadow-sm" style={{background:'#fff', border:'1.5px solid #e2e8f0'}}>
      <div className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-3">
        Receiving Details
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Quantity *</div>
          <button onClick={onQtyPad}
            className="w-full rounded-xl px-3 py-3 text-[18px] font-bold font-mono text-center cursor-pointer"
            style={{border:`2px solid ${form.qty?'#86efac':'#e2e8f0'}`, background: form.qty?'#f0fdf4':'#f8fafc', color: form.qty?'#16a34a':'#94a3b8'}}>
            {form.qty || 'Tap to enter'} {form.qty ? form.unit : ''}
          </button>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Cost per Unit</div>
          <button onClick={onCostPad}
            className="w-full rounded-xl px-3 py-3 text-[16px] font-bold font-mono text-center cursor-pointer"
            style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color: form.cost?'#374151':'#94a3b8'}}>
            ${parseFloat(form.cost||0).toFixed(2)}
          </button>
        </div>
      </div>

      {form.qty && form.cost && (
        <div className="rounded-xl px-4 py-2.5 flex justify-between mb-3"
          style={{background:'#f0fdf4', border:'1px solid #86efac'}}>
          <span className="text-[13px] font-semibold text-slate-600">Total Cost</span>
          <span className="text-[15px] font-bold font-mono text-green-700">
            ${(parseFloat(form.cost)*qty).toFixed(2)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Vendor</div>
          <select value={form.vendor_id} onChange={e=>setF('vendor_id',e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
            style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#1e293b'}}>
            <option value="">Select vendor...</option>
            {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Notes</div>
          <input value={form.notes} onChange={e=>setF('notes',e.target.value)}
            placeholder="PO number, notes..."
            className="w-full rounded-xl px-3 py-2.5 text-[12px] outline-none"
            style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
        </div>
      </div>
    </div>
  )
}
