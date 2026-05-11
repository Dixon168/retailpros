// src/pages/barcode/BarcodePage.jsx
// Barcode label printing — manage templates, print now, settings
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { LabelPreview, printLabels } from '@/components/barcode/LabelPreview'
import toast from 'react-hot-toast'

const DEFAULT_TEMPLATE = {
  name:'New Template',
  width_mm: 50, height_mm: 25,
  barcode_format:'CODE128', barcode_height_mm: 10,
  show_store_name:false, show_name:true, show_sku:true,
  show_price:true, show_barcode:true, show_barcode_text:true, show_date:false,
  name_size_pt: 9, price_size_pt: 12, sku_size_pt: 7,
  printer_name:'', is_default:false,
}

const SIZE_PRESETS = [
  { label:'Small price tag',     w: 30, h: 20, name_pt:7,  price_pt:10, bc_h:8 },
  { label:'Standard label',      w: 50, h: 25, name_pt:9,  price_pt:12, bc_h:10 },
  { label:'Large shelf tag',     w: 80, h: 40, name_pt:12, price_pt:18, bc_h:15 },
  { label:'Square (50×50)',      w: 50, h: 50, name_pt:10, price_pt:14, bc_h:12 },
  { label:'DYMO 30252 address',  w: 89, h: 28, name_pt:10, price_pt:14, bc_h:10 },
  { label:'Avery 5160 (1″×2⅝)',  w: 67, h: 25, name_pt:9,  price_pt:12, bc_h:10 },
]

const TABS = [
  { id:'templates', label:'My Templates',   icon:'📐' },
  { id:'print',     label:'Print Now',      icon:'🖨️' },
  { id:'settings',  label:'Settings',       icon:'⚙️' },
]

export default function BarcodePage() {
  const { tenant, store, user } = useAuthStore()
  const [tab, setTab] = useState('templates')

  return (
    <div className="h-full overflow-y-auto bg-[#FAFAFA] p-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-4">
          <div className="text-[20px] font-bold text-[#1F1F1F]">🏷️ Barcode & Label Printing</div>
          <div className="text-[12px] text-[#666] mt-1">Design label templates, print product labels, or run quick custom prints.</div>
        </div>

        {/* Tabs */}
        <div className="flex mb-4" style={{borderBottom:'2px solid #E5E5E5'}}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className="px-5 py-2.5 text-[13px] font-bold cursor-pointer border-none transition-all"
              style={tab===t.id
                ? { background:'transparent', color:'#006AFF', borderBottom:'2px solid #006AFF', marginBottom:'-2px' }
                : { background:'transparent', color:'#666' }}>
              <span className="mr-1.5">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {tab === 'templates' && <TemplatesTab tenant={tenant} store={store} user={user}/>}
        {tab === 'print'     && <PrintNowTab  tenant={tenant} store={store}/>}
        {tab === 'settings'  && <SettingsTab  tenant={tenant}/>}
      </div>
    </div>
  )
}


// ════════════════════════════════════════════════════════
// TEMPLATES TAB — design / save / edit / delete templates
// ════════════════════════════════════════════════════════
function TemplatesTab({ tenant, store, user }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null) // template obj or null
  const [creating, setCreating] = useState(false)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['barcode-templates', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('barcode_templates')
        .select('*').eq('tenant_id', tenant.id)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const startNew = () => { setEditing({ ...DEFAULT_TEMPLATE }); setCreating(true) }
  const startEdit = (t) => { setEditing({ ...t }); setCreating(false) }
  const cancel = () => { setEditing(null); setCreating(false) }

  const save = async () => {
    if (!editing.name?.trim()) { toast.error('Name required'); return }
    const payload = { ...editing, tenant_id: tenant.id }
    delete payload.created_at
    delete payload.updated_at
    let err
    if (creating) {
      payload.created_by = user?.id
      const { error } = await supabase.from('barcode_templates').insert(payload)
      err = error
    } else {
      const { id, ...rest } = payload
      const { error } = await supabase.from('barcode_templates').update(rest).eq('id', id)
      err = error
    }
    if (err) { toast.error('Save failed: ' + err.message); return }
    // If user toggled this to default, unset others
    if (editing.is_default) {
      await supabase.from('barcode_templates')
        .update({ is_default: false })
        .eq('tenant_id', tenant.id)
        .neq('name', editing.name)
    }
    qc.invalidateQueries({ queryKey:['barcode-templates'] })
    toast.success(creating ? 'Template created ✓' : 'Template saved ✓')
    cancel()
  }

  const remove = async (t) => {
    if (!confirm(`Delete template "${t.name}"?`)) return
    const { error } = await supabase.from('barcode_templates').delete().eq('id', t.id)
    if (error) { toast.error('Delete failed: ' + error.message); return }
    qc.invalidateQueries({ queryKey:['barcode-templates'] })
    toast.success('Deleted')
  }

  const useTemplate = (t) => {
    const sample = { name:'Sample Product XL', price:'29.99', sku:'SKU-12345', upc:'012345678905' }
    printLabels({ template: t, items:[{ product: sample, qty: 1 }], storeName: store?.name })
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <div className="text-[13px] text-[#666]">{templates.length} template{templates.length !== 1 ? 's' : ''}</div>
        {!editing && (
          <button onClick={startNew}
            className="rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer border-none"
            style={{background:'#006AFF', color:'#fff'}}>
            + Add Template
          </button>
        )}
      </div>

      {editing && (
        <TemplateEditor editing={editing} setEditing={setEditing} onSave={save} onCancel={cancel}
          storeName={store?.name} creating={creating}/>
      )}

      {!editing && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading ? (
            <div className="col-span-3 text-center py-8 text-[#999]">Loading...</div>
          ) : templates.length === 0 ? (
            <div className="col-span-3 text-center py-8 text-[#999]">
              <div className="text-[40px] mb-2 opacity-30">📐</div>
              <div className="text-[13px]">No templates yet. Click <b>+ Add Template</b> to make your first one.</div>
            </div>
          ) : templates.map(t => (
            <div key={t.id} className="bg-[#FFFFFF] rounded-2xl p-4"
              style={{border: t.is_default ? '2px solid #006AFF' : '1px solid #E5E5E5'}}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-[14px] font-bold flex items-center gap-1">
                    {t.name}
                    {t.is_default && <span className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                      style={{background:'#E6F0FF', color:'#006AFF'}}>DEFAULT</span>}
                  </div>
                  <div className="text-[11px] text-[#666] mt-0.5 font-mono">
                    {t.width_mm}×{t.height_mm}mm · {t.barcode_format}
                  </div>
                </div>
              </div>
              <div className="flex justify-center bg-[#FAFAFA] rounded-lg py-3 mb-3" style={{border:'1px solid #F1F5F9'}}>
                <LabelPreview template={t}
                  product={{ name:'Sample Product', price:'9.99', sku:'SKU-12345', upc:'012345678905' }}
                  storeName={store?.name} scale={1.5}/>
              </div>
              <div className="flex gap-1.5">
                <button onClick={()=>useTemplate(t)}
                  className="flex-1 rounded-lg px-2 py-2 text-[11px] font-bold cursor-pointer border-none"
                  style={{background:'#006AFF', color:'#fff'}}>🖨 Test Print</button>
                <button onClick={()=>startEdit(t)}
                  className="rounded-lg px-3 py-2 text-[11px] font-bold cursor-pointer"
                  style={{background:'#fff', color:'#006AFF', border:'1px solid #80B2FF'}}>Edit</button>
                <button onClick={()=>remove(t)}
                  className="rounded-lg px-2 py-2 text-[12px] cursor-pointer"
                  style={{background:'#FEE2E2', color:'#CF1322', border:'1px solid #FCA5A5'}}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


function TemplateEditor({ editing, setEditing, onSave, onCancel, storeName, creating }) {
  const set = (k, v) => setEditing(p => ({ ...p, [k]:v }))
  const applyPreset = (p) => setEditing(prev => ({
    ...prev,
    width_mm: p.w, height_mm: p.h,
    name_size_pt: p.name_pt, price_size_pt: p.price_pt,
    barcode_height_mm: p.bc_h,
  }))

  return (
    <div className="bg-[#FFFFFF] rounded-2xl p-5 mb-5" style={{border:'2px solid #006AFF'}}>
      <div className="flex justify-between items-center mb-4">
        <div className="text-[15px] font-bold text-[#006AFF]">
          {creating ? '➕ New Template' : `✏️ Editing: ${editing.name}`}
        </div>
        <button onClick={onCancel}
          className="w-8 h-8 rounded-full border-none cursor-pointer text-[14px]"
          style={{background:'#F1F5F9', color:'#64748b'}}>✕</button>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* LEFT: form */}
        <div className="space-y-3">
          <FRow label="Template name">
            <input value={editing.name} onChange={e=>set('name', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{border:'1.5px solid #E5E5E5', background:'#fff', color:'#1F1F1F'}}/>
          </FRow>

          <div>
            <FLabel>Size preset</FLabel>
            <div className="grid grid-cols-2 gap-1.5">
              {SIZE_PRESETS.map(p => (
                <button key={p.label} onClick={()=>applyPreset(p)}
                  className="rounded-lg px-2 py-1.5 text-[10px] cursor-pointer border text-left"
                  style={editing.width_mm===p.w && editing.height_mm===p.h
                    ? {background:'#E6F0FF', borderColor:'#80B2FF', color:'#006AFF', fontWeight:'bold'}
                    : {background:'#fff', borderColor:'#E5E5E5', color:'#666'}}>
                  {p.label}<br/><span className="text-[9px] opacity-70">{p.w}×{p.h}mm</span>
                </button>
              ))}
            </div>
          </div>

          <FRow label="Custom size">
            <div className="flex items-center gap-2">
              <input type="number" step="0.5" value={editing.width_mm}
                onChange={e=>set('width_mm', parseFloat(e.target.value)||50)}
                className="flex-1 rounded-lg px-2 py-2 text-[12px] outline-none font-mono"
                style={{border:'1.5px solid #E5E5E5'}}/>
              <span className="text-[11px] text-[#666]">×</span>
              <input type="number" step="0.5" value={editing.height_mm}
                onChange={e=>set('height_mm', parseFloat(e.target.value)||25)}
                className="flex-1 rounded-lg px-2 py-2 text-[12px] outline-none font-mono"
                style={{border:'1.5px solid #E5E5E5'}}/>
              <span className="text-[11px] text-[#666]">mm</span>
            </div>
          </FRow>

          <FRow label="Barcode format">
            <select value={editing.barcode_format}
              onChange={e=>set('barcode_format', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none cursor-pointer"
              style={{border:'1.5px solid #E5E5E5', background:'#fff', color:'#1F1F1F'}}>
              <option value="CODE128">CODE128 — most flexible</option>
              <option value="EAN13">EAN13 — retail (13 digits)</option>
              <option value="EAN8">EAN8 — small retail (8 digits)</option>
              <option value="UPC">UPC — North American retail</option>
              <option value="CODE39">CODE39 — industrial</option>
              <option value="ITF14">ITF14 — outer cartons</option>
            </select>
          </FRow>

          <FRow label={`Barcode height: ${editing.barcode_height_mm}mm`}>
            <input type="range" min="3" max="30" step="0.5"
              value={editing.barcode_height_mm}
              onChange={e=>set('barcode_height_mm', parseFloat(e.target.value))}
              className="w-full cursor-pointer"/>
          </FRow>

          <div>
            <FLabel>Show on label</FLabel>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                ['show_store_name','🏪 Store name'],
                ['show_name','📦 Product name'],
                ['show_sku','🔢 SKU'],
                ['show_price','💲 Price'],
                ['show_barcode','▮▮▮ Barcode'],
                ['show_barcode_text','123 Code text'],
                ['show_date','📅 Print date'],
              ].map(([k,lbl]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5"
                  style={editing[k]?{background:'#E6F0FF', border:'1px solid #80B2FF'}:{background:'#F8FAFC', border:'1px solid #E5E5E5'}}>
                  <input type="checkbox" checked={!!editing[k]} onChange={e=>set(k, e.target.checked)}/>
                  <span className="text-[11px] font-semibold" style={{color: editing[k]?'#006AFF':'#666'}}>{lbl}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <FRow label="Name pt">
              <input type="number" step="0.5" min="5" max="30" value={editing.name_size_pt}
                onChange={e=>set('name_size_pt', parseFloat(e.target.value)||9)}
                className="w-full rounded-lg px-2 py-2 text-[12px] outline-none font-mono"
                style={{border:'1.5px solid #E5E5E5'}}/>
            </FRow>
            <FRow label="Price pt">
              <input type="number" step="0.5" min="5" max="40" value={editing.price_size_pt}
                onChange={e=>set('price_size_pt', parseFloat(e.target.value)||12)}
                className="w-full rounded-lg px-2 py-2 text-[12px] outline-none font-mono"
                style={{border:'1.5px solid #E5E5E5'}}/>
            </FRow>
            <FRow label="SKU pt">
              <input type="number" step="0.5" min="4" max="20" value={editing.sku_size_pt}
                onChange={e=>set('sku_size_pt', parseFloat(e.target.value)||7)}
                className="w-full rounded-lg px-2 py-2 text-[12px] outline-none font-mono"
                style={{border:'1.5px solid #E5E5E5'}}/>
            </FRow>
          </div>

          <FRow label="Printer name (blank = browser dialog)">
            <input value={editing.printer_name || ''} onChange={e=>set('printer_name', e.target.value)}
              placeholder="e.g. DYMO LabelWriter 450"
              className="w-full rounded-lg px-3 py-2 text-[12px] outline-none font-mono"
              style={{border:'1.5px solid #E5E5E5'}}/>
          </FRow>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!editing.is_default} onChange={e=>set('is_default', e.target.checked)}/>
            <span className="text-[12px] font-semibold">Set as default template</span>
          </label>

          <div className="flex gap-2 mt-4">
            <button onClick={onCancel}
              className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
              style={{background:'#fff', color:'#666', border:'1px solid #E5E5E5'}}>
              Cancel
            </button>
            <button onClick={onSave}
              className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer border-none"
              style={{background:'#006AFF', color:'#fff'}}>
              {creating ? '+ Create' : '✓ Save Changes'}
            </button>
          </div>
        </div>

        {/* RIGHT: live preview */}
        <div>
          <FLabel>Live preview</FLabel>
          <div className="rounded-2xl p-6 flex items-center justify-center" style={{background:'#FAFAFA', border:'1px dashed #CBD5E1', minHeight:'320px'}}>
            <LabelPreview template={editing}
              product={{ name:'Sample Product XL', price:'29.99', sku:'SKU-12345', upc:'012345678905' }}
              storeName={storeName} scale={2.5}/>
          </div>
          <div className="text-[10px] text-[#999] mt-2 text-center">
            Preview is ~2.5× actual size for readability. Print uses real {editing.width_mm}×{editing.height_mm}mm.
          </div>
        </div>
      </div>
    </div>
  )
}


// ════════════════════════════════════════════════════════
// PRINT-NOW TAB — pick template + ad-hoc content or product
// ════════════════════════════════════════════════════════
function PrintNowTab({ tenant, store }) {
  const [picked, setPicked] = useState(null) // template
  const [mode, setMode] = useState('manual') // 'manual' | 'product'

  // Manual entry
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [sku, setSku] = useState('')
  const [upc, setUpc] = useState('')
  const [qty, setQty] = useState(1)

  // Product lookup
  const [search, setSearch] = useState('')
  const [pickedProduct, setPickedProduct] = useState(null)

  const { data: templates = [] } = useQuery({
    queryKey: ['barcode-templates', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('barcode_templates')
        .select('*').eq('tenant_id', tenant.id)
        .order('is_default', { ascending: false })
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Pre-pick default template
  if (!picked && templates.length > 0) {
    setPicked(templates.find(t=>t.is_default) || templates[0])
  }

  const { data: products = [] } = useQuery({
    queryKey: ['print-products', tenant?.id, search],
    queryFn: async () => {
      if (search.length < 2) return []
      const { data } = await supabase.from('products')
        .select('id, name, sku, upc, price')
        .eq('tenant_id', tenant.id)
        .or(`name.ilike.%${search}%,sku.ilike.%${search}%,upc.ilike.%${search}%`)
        .limit(10)
      return data || []
    },
    enabled: search.length >= 2 && mode === 'product',
  })

  const product = mode === 'manual'
    ? { name: name || 'Sample', price: parseFloat(price)||0, sku, upc }
    : pickedProduct

  const doPrint = () => {
    if (!picked) { toast.error('Pick a template first'); return }
    if (!product || (!product.name && !product.sku)) { toast.error('Enter content or pick a product'); return }
    const q = parseInt(qty)||1
    printLabels({ template: picked, items:[{ product, qty: q }], storeName: store?.name })
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-12 text-[#666]">
        <div className="text-[40px] mb-2 opacity-30">🏷️</div>
        <div className="text-[13px] mb-2">No templates yet. Make one first in <b>My Templates</b>.</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-5">
      <div className="space-y-3">
        <div>
          <FLabel>Template</FLabel>
          <div className="grid grid-cols-2 gap-2">
            {templates.map(t => (
              <button key={t.id} onClick={()=>setPicked(t)}
                className="rounded-lg px-3 py-2 text-left cursor-pointer border-2"
                style={picked?.id===t.id
                  ? {background:'#E6F0FF', borderColor:'#006AFF'}
                  : {background:'#fff', borderColor:'#E5E5E5'}}>
                <div className="text-[12px] font-bold">{t.name}</div>
                <div className="text-[10px] text-[#666] font-mono">{t.width_mm}×{t.height_mm}mm · {t.barcode_format}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <FLabel>What to print</FLabel>
          <div className="flex gap-2 mb-2">
            <button onClick={()=>setMode('manual')}
              className="flex-1 rounded-lg py-2 text-[12px] font-bold cursor-pointer border-2"
              style={mode==='manual'
                ? {background:'#1F1F1F', color:'#fff', borderColor:'#1F1F1F'}
                : {background:'#fff', color:'#666', borderColor:'#E5E5E5'}}>
              ✏️ Type Custom Content
            </button>
            <button onClick={()=>setMode('product')}
              className="flex-1 rounded-lg py-2 text-[12px] font-bold cursor-pointer border-2"
              style={mode==='product'
                ? {background:'#1F1F1F', color:'#fff', borderColor:'#1F1F1F'}
                : {background:'#fff', color:'#666', borderColor:'#E5E5E5'}}>
              📦 Pick Existing Product
            </button>
          </div>

          {mode === 'manual' && (
            <div className="space-y-2 bg-[#FAFAFA] rounded-lg p-3" style={{border:'1px solid #E5E5E5'}}>
              <FRow label="Product / item name">
                <input value={name} onChange={e=>setName(e.target.value)}
                  placeholder="e.g. Coca-Cola 12oz"
                  className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                  style={{border:'1.5px solid #E5E5E5', background:'#fff'}}/>
              </FRow>
              <div className="grid grid-cols-2 gap-2">
                <FRow label="Price">
                  <input type="number" step="0.01" min="0" value={price} onChange={e=>setPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
                    style={{border:'1.5px solid #E5E5E5', background:'#fff'}}/>
                </FRow>
                <FRow label="SKU">
                  <input value={sku} onChange={e=>setSku(e.target.value)}
                    placeholder="optional"
                    className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
                    style={{border:'1.5px solid #E5E5E5', background:'#fff'}}/>
                </FRow>
              </div>
              <FRow label="UPC / barcode value">
                <input value={upc} onChange={e=>setUpc(e.target.value)}
                  placeholder="012345678905"
                  className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
                  style={{border:'1.5px solid #E5E5E5', background:'#fff'}}/>
              </FRow>
            </div>
          )}

          {mode === 'product' && (
            <div className="space-y-2 bg-[#FAFAFA] rounded-lg p-3" style={{border:'1px solid #E5E5E5'}}>
              <input autoFocus value={search} onChange={e=>{ setSearch(e.target.value); setPickedProduct(null) }}
                placeholder="Type product name, SKU or scan barcode..."
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{border:'1.5px solid #E5E5E5', background:'#fff'}}/>
              {pickedProduct ? (
                <div className="rounded-lg px-3 py-2.5 flex items-center justify-between"
                  style={{background:'#E6F0FF', border:'1px solid #80B2FF'}}>
                  <div>
                    <div className="text-[13px] font-bold text-[#006AFF]">{pickedProduct.name}</div>
                    <div className="text-[10px] text-[#666] font-mono">{pickedProduct.sku} · ${Number(pickedProduct.price||0).toFixed(2)}</div>
                  </div>
                  <button onClick={()=>{ setPickedProduct(null); setSearch('') }}
                    className="text-[16px] cursor-pointer bg-transparent border-none">✕</button>
                </div>
              ) : products.length > 0 ? (
                <div className="rounded-lg max-h-[200px] overflow-y-auto" style={{border:'1px solid #E5E5E5', background:'#fff'}}>
                  {products.map(p => (
                    <div key={p.id} onClick={()=>{ setPickedProduct(p); setSearch(p.name) }}
                      className="px-3 py-2 cursor-pointer hover:bg-[#E6F0FF] border-b border-[#F1F5F9] last:border-0">
                      <div className="text-[12px] font-semibold">{p.name}</div>
                      <div className="text-[10px] text-[#666] font-mono">{p.sku} · ${Number(p.price||0).toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              ) : search.length >= 2 ? (
                <div className="text-[11px] text-[#999] text-center py-2">No products found</div>
              ) : null}
            </div>
          )}
        </div>

        <FRow label={`Quantity to print: ${qty}`}>
          <input type="range" min="1" max="100" value={qty}
            onChange={e=>setQty(parseInt(e.target.value)||1)}
            className="w-full cursor-pointer"/>
          <div className="flex gap-1 mt-1">
            {[1,5,10,25,50,100].map(n=>(
              <button key={n} onClick={()=>setQty(n)}
                className="flex-1 rounded-md py-1 text-[10px] font-bold cursor-pointer border"
                style={qty===n
                  ? {background:'#006AFF', color:'#fff', borderColor:'#006AFF'}
                  : {background:'#fff', color:'#666', borderColor:'#E5E5E5'}}>{n}</button>
            ))}
          </div>
        </FRow>

        <button onClick={doPrint}
          className="w-full rounded-lg py-3 text-[14px] font-bold cursor-pointer border-none"
          style={{background:'#006AFF', color:'#fff'}}>
          🖨 Print {qty} label{qty>1?'s':''}
        </button>
      </div>

      {/* Preview */}
      <div>
        <FLabel>Preview</FLabel>
        <div className="rounded-2xl p-6 flex items-center justify-center" style={{background:'#FAFAFA', border:'1px dashed #CBD5E1', minHeight:'320px'}}>
          {picked && product?.name ? (
            <LabelPreview template={picked} product={product} storeName={store?.name} scale={2.5}/>
          ) : (
            <div className="text-[#999] text-center text-[12px]">
              <div className="text-[40px] mb-2 opacity-30">👀</div>
              {!picked ? 'Pick a template' : 'Enter content or select a product'}
            </div>
          )}
        </div>
        <div className="text-[10px] text-[#999] mt-2 text-center">
          Preview at ~2.5× actual size. Print uses {picked?.width_mm}×{picked?.height_mm}mm.
        </div>
      </div>
    </div>
  )
}


// ════════════════════════════════════════════════════════
// SETTINGS TAB — default printer for all labels
// ════════════════════════════════════════════════════════
function SettingsTab({ tenant }) {
  const qc = useQueryClient()
  const [printer, setPrinter] = useState(tenant?.default_label_printer || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('tenants')
      .update({ default_label_printer: printer || null }).eq('id', tenant.id)
    setSaving(false)
    if (error) { toast.error('Save failed: ' + error.message); return }
    qc.invalidateQueries({ queryKey:['tenant'] })
    toast.success('Saved ✓')
  }

  return (
    <div className="max-w-[640px] space-y-4">
      <div className="bg-[#FFFFFF] rounded-2xl p-5" style={{border:'1px solid #E5E5E5'}}>
        <div className="text-[14px] font-bold mb-1">🖨️ Default label printer</div>
        <div className="text-[11px] text-[#666] mb-3">
          If your label printer is on the OS as a regular printer, you can put its name here
          to skip the browser print dialog. Leave blank to always show the dialog (which lets you pick).
        </div>
        <FRow label="Printer name">
          <input value={printer} onChange={e=>setPrinter(e.target.value)}
            placeholder="e.g. DYMO LabelWriter 450, Zebra ZD220"
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
            style={{border:'1.5px solid #E5E5E5'}}/>
        </FRow>
        <div className="flex gap-2 mt-3">
          <button onClick={save} disabled={saving}
            className="rounded-lg px-5 py-2 text-[12px] font-bold cursor-pointer border-none disabled:opacity-50"
            style={{background:'#006AFF', color:'#fff'}}>
            {saving ? 'Saving...' : '✓ Save'}
          </button>
        </div>
      </div>

      <div className="rounded-lg p-4 text-[11px]"
        style={{background:'#FEF3C7', color:'#92400e', border:'1px solid #FCD34D'}}>
        💡 <b>Note about printers:</b> Web browsers can't pick a specific printer silently.
        The browser <i>print dialog</i> will pop up with your default selected. If you have
        a thermal label printer (DYMO/Zebra) installed via the OS driver, choose it once and
        most browsers will remember the choice. For fully silent printing, consider using a
        dedicated bridge app like <i>PrintNode</i> (we can add support if needed).
      </div>
    </div>
  )
}


function FRow({ label, children }) {
  return (
    <div>
      <FLabel>{label}</FLabel>
      {children}
    </div>
  )
}
function FLabel({ children }) {
  return <div className="text-[10px] font-bold text-[#1F1F1F] uppercase tracking-wider mb-1">{children}</div>
}
