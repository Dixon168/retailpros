// src/pages/products/ProductDetailInline.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ReceiveModal } from './ReceiveModal'
import { AdjustModal } from './AdjustModal'
import NumPad from '@/components/ui/NumPad'
import toast from 'react-hot-toast'

const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const UNITS = ['ea','lb','kg','oz','g','l','ml','ft','m','hr','pair','box','case','pack','roll','bag','bottle','can']
const TYPE_COLOR = { sale:'#6366f1', bulk:'#16a34a', time:'#d97706' }
const TYPE_ICON  = { sale:'🏷️', bulk:'📦', time:'⏰' }
const TYPE_NAME  = { sale:'Sale Pricing', bulk:'Bulk Pricing', time:'Time Based' }
const TAB_COLOR  = { info:'#6366f1', receiving:'#16a34a', adjustments:'#ca8a04', sales:'#2563eb', promotions:'#9333ea' }
const TAB_BG     = { info:'#e0e7ff', receiving:'#dcfce7', adjustments:'#fef9c3', sales:'#dbeafe', promotions:'#fdf4ff' }

// ── Shared UI helpers ──
function Th({ children }) {
  return <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
    style={{color:'#64748b', background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>{children}</th>
}
function Td({ children, mono, bold, color }) {
  return <td className={`px-3 py-2.5 text-[12px] border-b ${mono?'font-mono':''} ${bold?'font-bold':''}`}
    style={{color:color||'#374151', borderColor:'#f1f5f9'}}>{children}</td>
}
function Empty({ msg }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-slate-300">
      <div className="text-3xl mb-2">📭</div>
      <div className="text-[12px]">{msg}</div>
    </div>
  )
}
function SectionBox({ title, icon, color='#6366f1', children }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
      <div className="px-4 py-2 flex items-center gap-2"
        style={{background:`${color}08`, borderBottom:'1px solid #f1f5f9'}}>
        <span>{icon}</span>
        <span className="text-[11px] font-bold" style={{color}}>{title}</span>
      </div>
      <div className="px-4 py-3 bg-white">{children}</div>
    </div>
  )
}
function FieldLabel({ children, required }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{color:'#64748b'}}>
    {children}{required && <span className="text-red-500 ml-0.5">*</span>}
  </div>
}
function FieldInput({ value, onChange, placeholder, type='text', mono, disabled }) {
  return <input type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
    className={`w-full rounded-xl px-3 py-2 text-[13px] outline-none transition-all ${mono?'font-mono':''} disabled:opacity-50`}
    style={{border:'1.5px solid #e2e8f0', background: disabled?'#f8fafc':'#fff', color:'#1e293b'}}
    onFocus={e=>{if(!disabled){e.target.style.borderColor='#6366f1'}}}
    onBlur={e=>{e.target.style.borderColor='#e2e8f0'}}/>
}
function Toggle({ checked, onChange, label, desc }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer py-1.5" onClick={onChange}>
      <div style={{width:'38px',height:'21px',position:'relative',cursor:'pointer',
        background:checked?'#6366f1':'#e2e8f0', borderRadius:'11px', transition:'background .2s', flexShrink:0}}>
        <div style={{position:'absolute',top:'2px',left:checked?'19px':'2px',
          width:'17px',height:'17px',background:'#fff',borderRadius:'50%',
          transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
      </div>
      <div>
        <div className="text-[12px] font-semibold text-slate-700">{label}</div>
        {desc && <div className="text-[10px] text-slate-400">{desc}</div>}
      </div>
    </label>
  )
}

export function ProductDetailInline({ product: p, tenantId, onRefresh }) {
  const qc = useQueryClient()
  const [tab, setTab]           = useState('info')
  const [showReceive, setShowReceive] = useState(false)
  const [showAdjust,  setShowAdjust]  = useState(false)
  const [editing,     setEditing]     = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [savedData,   setSavedData]   = useState(null) // holds last saved values for immediate display
  const [numpadField, setNumpadField] = useState(null) // 'price'|'cost'|'vip_price'|'commission_value'

  // Tag input
  const [tagInput, setTagInput]   = useState('')
  // Add new cat/subcat
  const [selCatId, setSelCatId]   = useState('')
  const [newCatName, setNewCatName] = useState('')
  const [showAddCat, setShowAddCat] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [newSubCatId, setNewSubCatId] = useState('')
  const [showAddSub, setShowAddSub] = useState(false)

  // Edit form - initialized from product
  const [form, setForm] = useState({})
  const setF = (k,v) => setForm(f=>({...f,[k]:v}))

  const startEdit = () => {
    // Find parent category
    const parentCat = categories.find(c => c.subcategories?.some(s => s.id === p.subcategory_id))
    setSelCatId(parentCat?.id || '')
    setForm({
      name:             p.name || '',
      description:      p.description || '',
      sku:              p.sku || '',
      upc:              p.upc || '',
      price:            String(p.price || ''),
      cost:             String(p.cost || ''),
      unit:             p.unit || 'ea',
      subcategory_id:   p.subcategory_id || '',
      sort_order:       p.sort_order || 0,
      tags:             p.tags || [],
      // VIP
      allow_vip:        p.allow_vip ?? true,
      vip_price:        String(p.vip_price || ''),
      // Points
      points_redeemable: p.points_redeemable ?? true,
      points_mode:      p.points_mode || 'amount',
      points_fixed:     String(p.points_fixed || ''),
      points_rate:      String(p.points_rate || 1),
      // Commission
      commission_type:  p.commission_type || 'none',
      commission_value: String(p.commission_value || ''),
      // Behavior
      prompt_weight:    p.prompt_weight ?? false,
      prompt_price:     p.prompt_price ?? false,
      has_serial:       p.has_serial ?? false,
      prompt_sales:     p.prompt_sales ?? false,
      track_inventory:  p.track_inventory ?? true,
      // Tax
      selectedTaxRates: [],
    })
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setTagInput('') }

  const handleSave = async () => {
    if (!form.name?.trim()) { toast.error('Product name required'); return }
    if (!form.price)         { toast.error('Price required'); return }
    setSaving(true)
    try {
      let type = 'unit'
      if (form.has_serial)       type = 'serialized'
      else if (form.prompt_weight) type = 'weight'
      else if (!form.track_inventory) type = 'service'

      await supabase.from('products').update({
        name:             form.name.trim(),
        description:      form.description || null,
        sku:              form.sku || null,
        upc:              form.upc || null,
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
        points_fixed:     parseInt(form.points_fixed) || 0,
        points_rate:      parseFloat(form.points_rate) || 1,
        commission_type:  form.commission_type,
        commission_value: parseFloat(form.commission_value) || 0,
        prompt_weight:    form.prompt_weight,
        prompt_price:     form.prompt_price,
        has_serial:       form.has_serial,
        prompt_sales:     form.prompt_sales,
        track_inventory:  form.track_inventory,
      }).eq('id', p.id)

      // Update tax rates
      await supabase.from('product_tax_rates').delete().eq('product_id', p.id)
      if (form.selectedTaxRates?.length > 0) {
        await supabase.from('product_tax_rates').insert(
          form.selectedTaxRates.map(tax_rate_id => ({ tenant_id: tenantId, product_id: p.id, tax_rate_id }))
        )
      }

      toast.success('Product updated ✓')
      setSavedData({...form, price: parseFloat(form.price), cost: parseFloat(form.cost)})

      setEditing(false)
      // Refetch all product queries immediately
      await qc.refetchQueries({ queryKey: ['products'] })
      await qc.refetchQueries({ queryKey: ['pos-products'] })
    } catch(err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  // Use savedData for immediate display after save (before parent re-renders)
  const d = savedData ? { ...p, ...savedData, price: parseFloat(savedData.price||p.price), cost: parseFloat(savedData.cost||p.cost) } : p

  // Data queries
  const qty     = p.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const avgCost = p.inventory?.[0]?.avg_cost || d.cost || 0
  const margin  = d.price > 0 ? ((d.price-avgCost)/d.price*100).toFixed(1) : '0.0'

  const { data: categories=[] } = useQuery({
    queryKey: ['categories-full', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('id,name,color,subcategories(id,name,sort_order)')
        .eq('tenant_id', tenantId).order('sort_order')
      return data || []
    },
    enabled: !!tenantId,
  })
  const { data: taxRates=[] } = useQuery({
    queryKey: ['tax-rates', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tax_rates')
        .select('id,name,rate').eq('tenant_id', tenantId)
      return data || []
    },
    enabled: !!tenantId && editing,
  })
  useQuery({
    queryKey: ['product-taxes', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('product_tax_rates')
        .select('tax_rate_id').eq('product_id', p.id)
      setF('selectedTaxRates', data?.map(t=>t.tax_rate_id) || [])
      return data
    },
    enabled: editing,
  })

  const { data: receives=[], isLoading: loadingR } = useQuery({
    queryKey: ['product-receives', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_receives')
        .select('*, suppliers(name)').eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab==='receiving' || tab==='info',
  })
  const { data: adjustments=[], isLoading: loadingA } = useQuery({
    queryKey: ['product-adjustments', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_adjustments')
        .select('*, users(name)').eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(100)
      return data || []
    },
    enabled: true,
  })
  const { data: sales=[], isLoading: loadingS } = useQuery({
    queryKey: ['product-sales', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('order_items')
        .select('*, orders(order_number, created_at, cashier_name, customers(name), order_payments(method))')
        .eq('product_id', p.id).order('created_at', { ascending: false }).limit(100)
      return data || []
    },
    enabled: true,
  })

  // Promotions
  const [promoAdding, setPromoAdding] = useState(false)
  const [promoSaving, setPromoSaving] = useState(false)
  const [promoType, setPromoType] = useState('sale')
  const [saleStart, setSaleStart] = useState('')
  const [saleEnd, setSaleEnd]     = useState('')
  const [saleType, setSaleType]   = useState('fixed')
  const [saleVal, setSaleVal]     = useState('')
  const [bulkQty, setBulkQty]     = useState('')
  const [bulkType, setBulkType]   = useState('fixed')
  const [bulkVal, setBulkVal]     = useState('')
  const [timeDays, setTimeDays]   = useState([])
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd]     = useState('')
  const [timeType, setTimeType]   = useState('fixed')
  const [timeVal, setTimeVal]     = useState('')

  const { data: promos=[] } = useQuery({
    queryKey: ['product-promos', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('promotions').select('*')
        .eq('product_id', p.id).order('created_at', { ascending: false })
      return data || []
    },
    enabled: true,
  })

  const togglePromo = async (promo) => {
    await supabase.from('promotions').update({ is_active: !promo.is_active }).eq('id', promo.id)
    qc.invalidateQueries(['product-promos', p.id])
    qc.invalidateQueries(['promotions'])
  }
  const deletePromo = async (id) => {
    if (!confirm('Delete this promotion?')) return
    await supabase.from('promotions').delete().eq('id', id)
    qc.invalidateQueries(['product-promos', p.id])
    toast.success('Deleted')
  }
  const savePromo = async () => {
    setPromoSaving(true)
    try {
      const base = { tenant_id: tenantId, product_id: p.id, type: promoType, is_active: true }
      let payload
      if (promoType==='sale') {
        if (!saleStart||!saleEnd||!saleVal) { toast.error('Fill all fields'); return }
        payload = { ...base, name:`${p.name} Sale`, sale_start:saleStart, sale_end:saleEnd, sale_type:saleType, sale_value:parseFloat(saleVal) }
      } else if (promoType==='bulk') {
        if (!bulkQty||!bulkVal) { toast.error('Fill qty and value'); return }
        payload = { ...base, name:`${p.name} Bulk`, bulk_tiers:[{min_qty:parseInt(bulkQty),type:bulkType,value:parseFloat(bulkVal)}] }
      } else {
        if (!timeDays.length||!timeStart||!timeEnd||!timeVal) { toast.error('Fill all fields'); return }
        payload = { ...base, name:`${p.name} Time`, time_rules:[{days:timeDays,start_time:timeStart,end_time:timeEnd,type:timeType,value:parseFloat(timeVal)}] }
      }
      await supabase.from('promotions').insert(payload)
      qc.invalidateQueries(['product-promos', p.id])
      qc.invalidateQueries(['promotions'])
      setPromoAdding(false)
      setSaleVal(''); setBulkQty(''); setBulkVal(''); setTimeVal(''); setTimeDays([])
      toast.success('Promotion added ✓')
    } catch(err) { toast.error(err.message) }
    finally { setPromoSaving(false) }
  }

  const TABS = [
    { id:'info',        label:'📋 Info' },
    { id:'receiving',   label:'📥 Receiving',   count: receives.length },
    { id:'adjustments', label:'⚖️ Adjustments', count: adjustments.length },
    { id:'sales',       label:'💰 Sales',        count: sales.length },
    { id:'promotions',  label:'🏷️ Promotions',  count: promos.length },
  ]

  // Numpad config
  const numpadConfig = {
    price:            { title:'Selling Price',    prefix:'$', neg:false },
    cost:             { title:'Cost Price',        prefix:'$', neg:false },
    vip_price:        { title:'VIP Override Price',prefix:'$', neg:false },
    commission_value: { title:'Commission Value',  prefix: form.commission_type==='fixed'?'$':'', suffix: form.commission_type!=='fixed'?'%':'', neg:false },
    points_rate:      { title:'Points Rate',       suffix:' pts', neg:false },
    points_fixed:     { title:'Fixed Points',      suffix:' pts', neg:false },
  }

  return (
    <div style={{background:'#f8fafc', borderTop:`2px solid ${TAB_COLOR[tab]}`}}>

      {/* ── Tab bar ── */}
      <div className="flex items-center border-b px-3" style={{background:'#fff', borderColor:'#e2e8f0'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); if(t.id!=='info') setEditing(false) }}
            className="flex items-center gap-1.5 py-2.5 px-3 text-[12px] border-b-2 cursor-pointer bg-transparent whitespace-nowrap transition-all"
            style={{
              borderBottomColor: tab===t.id ? TAB_COLOR[t.id] : 'transparent',
              color: tab===t.id ? TAB_COLOR[t.id] : '#64748b',
              fontWeight: tab===t.id ? 600 : 400,
            }}>
            {t.label}
            {t.count > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{background: tab===t.id ? TAB_BG[t.id] : '#f1f5f9', color: tab===t.id ? TAB_COLOR[t.id] : '#94a3b8'}}>
                {t.count}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1"/>

        {/* Tab actions */}
        {tab==='info' && !editing && (
          <button onClick={startEdit}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border mr-2"
            style={{background:'#e0e7ff', borderColor:'#a5b4fc', color:'#6366f1'}}>
            ✏️ Edit
          </button>
        )}
        {tab==='info' && editing && (
          <div className="flex gap-1.5 mr-2">
            <button onClick={handleSave} disabled={saving}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white cursor-pointer border-none disabled:opacity-50"
              style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
              {saving?'⏳':'✓ Save'}
            </button>
            <button onClick={cancelEdit}
              className="rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border"
              style={{background:'#fff1f2', borderColor:'#fecdd3', color:'#e11d48'}}>
              Cancel
            </button>
          </div>
        )}
        {tab==='receiving' && (
          <button onClick={() => setShowReceive(true)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border mr-2"
            style={{background:'#dcfce7', borderColor:'#86efac', color:'#16a34a'}}>
            + Receive
          </button>
        )}
        {tab==='adjustments' && (
          <button onClick={() => setShowAdjust(true)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border mr-2"
            style={{background:'#fef9c3', borderColor:'#fde047', color:'#ca8a04'}}>
            Adjust
          </button>
        )}
        {tab==='promotions' && (
          <button onClick={() => setPromoAdding(!promoAdding)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border mr-2"
            style={promoAdding ? {background:'#fff1f2',borderColor:'#fecdd3',color:'#e11d48'} : {background:'#fdf4ff',borderColor:'#e9d5ff',color:'#9333ea'}}>
            {promoAdding ? '✕ Cancel' : '+ Add Promotion'}
          </button>
        )}
      </div>

      {/* ── Content ── */}
      <div style={{maxHeight:'480px', overflowY:'auto', padding:'16px'}}>

        {/* ══ INFO — View Mode ══ */}
        {tab==='info' && !editing && (
          <div className="grid gap-3" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
            <SectionBox title="Product Info" icon="📦" color="#6366f1">
              {[['Name',d.name],['Type',d.type?.toUpperCase()],['Unit',d.unit||'ea'],['SKU',d.sku||'—'],['UPC',d.upc||'—'],['Category',d.subcategories?.categories?.name||'—'],['Subcategory',d.subcategories?.name||'—'],['Tags',d.tags?.join(', ')||'—'],['Description',d.description||'—']].map(([l,v])=>(
                <div key={l} className="flex justify-between py-1" style={{borderBottom:'1px solid #f8fafc'}}>
                  <span className="text-[11px] text-slate-400">{l}</span>
                  <span className="text-[11px] font-semibold text-right ml-2 text-slate-700 max-w-[55%] truncate">{v}</span>
                </div>
              ))}
            </SectionBox>
            <SectionBox title="Pricing & Stock" icon="💰" color="#16a34a">
              {[['Sell Price',`$${parseFloat(d.price||0).toFixed(2)}`],['Cost',`$${parseFloat(d.cost||0).toFixed(2)}`],['Avg Cost',`$${parseFloat(avgCost).toFixed(2)}`],['Margin',`${margin}%`],['Profit/ea',`$${(parseFloat(d.price||0)-avgCost).toFixed(2)}`],['In Stock',`${qty} ${d.unit||'ea'}`],['Stock Value',`$${(qty*avgCost).toFixed(2)}`],['VIP',d.allow_vip?'Yes':'No'],['VIP Price',d.vip_price?`$${d.vip_price}`:'% tier discount']].map(([l,v])=>(
                <div key={l} className="flex justify-between py-1" style={{borderBottom:'1px solid #f8fafc'}}>
                  <span className="text-[11px] text-slate-400">{l}</span>
                  <span className="text-[11px] font-semibold text-right ml-2 text-slate-700">{v}</span>
                </div>
              ))}
            </SectionBox>
            <SectionBox title="Points & Commission" icon="⭐" color="#8b5cf6">
              {[['Points Mode',d.points_mode==='fixed'?'Fixed':'$ → Points'],['Points Value',d.points_mode==='fixed'?`${d.points_fixed||0} pts`:`$1=${d.points_rate||1} pts`],['Redeemable',d.points_redeemable?'Yes':'No'],['Commission',d.commission_type==='none'?'None':d.commission_type],['Comm. Value',d.commission_type!=='none'?`${d.commission_type==='fixed'?'$':''}${d.commission_value||0}${d.commission_type!=='fixed'?'%':''}`:'—']].map(([l,v])=>(
                <div key={l} className="flex justify-between py-1" style={{borderBottom:'1px solid #f8fafc'}}>
                  <span className="text-[11px] text-slate-400">{l}</span>
                  <span className="text-[11px] font-semibold text-slate-700">{v}</span>
                </div>
              ))}
            </SectionBox>
            <SectionBox title="Checkout Settings" icon="🛒" color="#0891b2">
              {[['Prompt Weight',d.prompt_weight],['Prompt Price',d.prompt_price],['Prompt Staff',d.prompt_sales],['Serial Numbers',d.has_serial],['Track Inventory',d.track_inventory]].map(([l,v])=>(
                <div key={l} className="flex justify-between items-center py-1" style={{borderBottom:'1px solid #f8fafc'}}>
                  <span className="text-[11px] text-slate-400">{l}</span>
                  <span className={`text-[11px] font-bold ${v?'text-green-600':'text-slate-300'}`}>{v?'✅ Yes':'✗ No'}</span>
                </div>
              ))}
            </SectionBox>
          </div>
        )}

        {/* ══ INFO — Edit Mode ══ */}
        {tab==='info' && editing && (
          <div className="flex flex-col gap-4">

            {/* Basic Info */}
            <SectionBox title="Basic Information" icon="📦" color="#6366f1">
              <div className="grid gap-3" style={{gridTemplateColumns:'1fr 1fr'}}>
                <div className="col-span-2">
                  <FieldLabel required>Product Name</FieldLabel>
                  <FieldInput value={form.name} onChange={e=>setF('name',e.target.value)} placeholder="Product name"/>
                </div>
                <div>
                  <FieldLabel>SKU</FieldLabel>
                  <FieldInput value={form.sku} onChange={e=>setF('sku',e.target.value)} placeholder="APL-001" mono/>
                </div>
                <div>
                  <FieldLabel>UPC / Barcode</FieldLabel>
                  <FieldInput value={form.upc} onChange={e=>setF('upc',e.target.value)} placeholder="012345678901" mono/>
                </div>
                <div>
                  <FieldLabel>Main Category</FieldLabel>
                  <select value={selCatId}
                    onChange={e=>{if(e.target.value==='__add__'){setShowAddCat(true);return};setSelCatId(e.target.value);setF('subcategory_id','')}}
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{border:'1.5px solid #e2e8f0', background:'#fff', color:'#1e293b'}}>
                    <option value="">— No category —</option>
                    <option value="__add__">✚ Add new...</option>
                    {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Subcategory</FieldLabel>
                  <select value={form.subcategory_id}
                    onChange={e=>{if(e.target.value==='__add__'){setShowAddSub(true);setNewSubCatId(selCatId);return};setF('subcategory_id',e.target.value);const pc=categories.find(c=>c.subcategories?.some(s=>s.id===e.target.value));if(pc)setSelCatId(pc.id)}}
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{border:'1.5px solid #e2e8f0', background:'#fff', color:'#1e293b'}}>
                    <option value="">— No subcategory —</option>
                    <option value="__add__">✚ Add new...</option>
                    {categories.map(c=>c.subcategories?.length>0&&(
                      <optgroup key={c.id} label={c.name}>
                        {c.subcategories.sort((a,b)=>a.sort_order-b.sort_order).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <FieldLabel>Description</FieldLabel>
                  <textarea value={form.description} onChange={e=>setF('description',e.target.value)}
                    rows={2} placeholder="Optional description..."
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
                    style={{border:'1.5px solid #e2e8f0', background:'#fff'}}/>
                </div>
                <div>
                  <FieldLabel>Display Order</FieldLabel>
                  <FieldInput type="number" value={form.sort_order} onChange={e=>setF('sort_order',e.target.value)} mono/>
                </div>
                <div>
                  <FieldLabel>Tags</FieldLabel>
                  <input value={tagInput} onChange={e=>setTagInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter'&&tagInput.trim()){e.preventDefault();if(!form.tags?.includes(tagInput.trim().toLowerCase())){setF('tags',[...(form.tags||[]),tagInput.trim().toLowerCase()])};setTagInput('')}}}
                    placeholder="Type + Enter"
                    className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #e2e8f0', background:'#fff'}}/>
                  {form.tags?.length>0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {form.tags.map(t=>(
                        <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]"
                          style={{background:'#e0e7ff', color:'#6366f1'}}>
                          {t}
                          <button onClick={()=>setF('tags',form.tags.filter(x=>x!==t))}
                            className="bg-transparent border-none cursor-pointer text-[10px] text-indigo-400 hover:text-red-500">✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionBox>

            {/* Pricing */}
            <SectionBox title="Pricing & Inventory" icon="💰" color="#16a34a">
              <div className="grid gap-3" style={{gridTemplateColumns:'1fr 1fr 1fr'}}>
                <div>
                  <FieldLabel required>Selling Price</FieldLabel>
                  <button onClick={()=>setNumpadField('price')}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-[16px] font-bold font-mono cursor-pointer"
                    style={{border:'1.5px solid #a5b4fc', background:'#eef2ff', color:'#6366f1'}}>
                    ${parseFloat(form.price||0).toFixed(2)}
                  </button>
                </div>
                <div>
                  <FieldLabel>Cost Price</FieldLabel>
                  <button onClick={()=>setNumpadField('cost')}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-[14px] font-mono cursor-pointer"
                    style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#374151'}}>
                    ${parseFloat(form.cost||0).toFixed(2)}
                  </button>
                </div>
                <div>
                  <FieldLabel>Unit</FieldLabel>
                  <select value={form.unit} onChange={e=>setF('unit',e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                    style={{border:'1.5px solid #e2e8f0', background:'#fff', color:'#1e293b'}}>
                    {UNITS.map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              {form.price && form.cost && (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[['Margin',`${((parseFloat(form.price)-parseFloat(form.cost||0))/parseFloat(form.price)*100).toFixed(1)}%`,'#16a34a'],
                    ['Profit/ea',`$${(parseFloat(form.price)-parseFloat(form.cost||0)).toFixed(2)}`,'#6366f1'],
                    ['Cost',`$${parseFloat(form.cost||0).toFixed(2)}`,'#64748b']
                  ].map(([l,v,c])=>(
                    <div key={l} className="rounded-xl p-2 text-center" style={{background:'#f0fdf4',border:'1px solid #86efac'}}>
                      <div className="text-[9px] text-slate-400 uppercase">{l}</div>
                      <div className="text-[14px] font-bold" style={{color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
              {/* Tax */}
              <div className="mt-3">
                <FieldLabel>Tax</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <label className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer border transition-all ${form.selectedTaxRates?.length===0?'border-indigo-300 bg-indigo-50':'border-slate-200 bg-slate-50'}`}>
                    <input type="checkbox" checked={form.selectedTaxRates?.length===0} onChange={()=>setF('selectedTaxRates',[])} className="accent-indigo-500 w-4 h-4"/>
                    <span className="text-[12px] font-medium text-slate-700">No Tax</span>
                  </label>
                  {taxRates.map(tr=>(
                    <label key={tr.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer border transition-all ${form.selectedTaxRates?.includes(tr.id)?'border-yellow-400 bg-yellow-50':'border-slate-200 bg-slate-50'}`}>
                      <input type="checkbox" checked={form.selectedTaxRates?.includes(tr.id)||false}
                        onChange={()=>setF('selectedTaxRates',form.selectedTaxRates?.includes(tr.id)?form.selectedTaxRates.filter(t=>t!==tr.id):[...(form.selectedTaxRates||[]),tr.id])}
                        className="accent-yellow-500 w-4 h-4"/>
                      <span className="text-[12px] font-medium text-slate-700">{tr.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{(tr.rate*100).toFixed(2)}%</span>
                    </label>
                  ))}
                </div>
              </div>
            </SectionBox>

            {/* VIP & Loyalty */}
            <SectionBox title="VIP & Loyalty" icon="⭐" color="#8b5cf6">
              <div className="grid gap-3" style={{gridTemplateColumns:'1fr 1fr'}}>
                <div>
                  <Toggle checked={form.allow_vip} onChange={()=>setF('allow_vip',!form.allow_vip)}
                    label="Allow VIP Discount" desc="VIP members get tier discount"/>
                  {form.allow_vip && (
                    <div className="mt-2 ml-12">
                      <FieldLabel>VIP Override Price (optional)</FieldLabel>
                      <button onClick={()=>setNumpadField('vip_price')}
                        className="w-full rounded-xl px-3 py-2 text-left text-[13px] font-mono cursor-pointer"
                        style={{border:'1.5px solid #e9d5ff', background:'#faf5ff', color: form.vip_price?'#8b5cf6':'#94a3b8'}}>
                        {form.vip_price ? `$${parseFloat(form.vip_price).toFixed(2)}` : 'Tap to set VIP price'}
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <Toggle checked={form.points_redeemable} onChange={()=>setF('points_redeemable',!form.points_redeemable)}
                    label="Earn Points" desc="Award points on purchase"/>
                  {form.points_redeemable && (
                    <div className="mt-2 ml-12 flex flex-col gap-2">
                      <div className="flex gap-2">
                        {[['amount','$ → Points'],['fixed','Fixed Points']].map(([m,l])=>(
                          <label key={m} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer border flex-1 text-center ${form.points_mode===m?'border-yellow-400 bg-yellow-50':'border-slate-200 bg-slate-50'}`}>
                            <input type="radio" checked={form.points_mode===m} onChange={()=>setF('points_mode',m)} className="accent-yellow-500"/>
                            <span className="text-[11px]">{l}</span>
                          </label>
                        ))}
                      </div>
                      <button onClick={()=>setNumpadField(form.points_mode==='amount'?'points_rate':'points_fixed')}
                        className="rounded-xl px-3 py-2 text-left text-[12px] font-mono cursor-pointer"
                        style={{border:'1.5px solid #fde047', background:'#fffbeb', color:'#ca8a04'}}>
                        {form.points_mode==='amount' ? `$1 = ${form.points_rate||1} pts` : `${form.points_fixed||0} pts/purchase`}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </SectionBox>

            {/* Commission */}
            <SectionBox title="Staff Commission" icon="👤" color="#d97706">
              <div className="flex gap-2 mb-3">
                {[['none','None'],['fixed','Fixed $'],['pct_sell','% Sell'],['pct_cost','% Cost']].map(([t,l])=>(
                  <label key={t} className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl cursor-pointer border flex-1 justify-center ${form.commission_type===t?'border-amber-400 bg-amber-50':'border-slate-200 bg-slate-50'}`}>
                    <input type="radio" checked={form.commission_type===t} onChange={()=>setF('commission_type',t)} className="accent-amber-500"/>
                    <span className="text-[11px] font-medium">{l}</span>
                  </label>
                ))}
              </div>
              {form.commission_type!=='none' && (
                <button onClick={()=>setNumpadField('commission_value')}
                  className="rounded-xl px-3 py-2 text-left text-[13px] font-mono cursor-pointer"
                  style={{border:'1.5px solid #fcd34d', background:'#fffbeb', color:'#d97706'}}>
                  {form.commission_type==='fixed'?'$':''}{form.commission_value||'0'}{form.commission_type!=='fixed'?'%':''}
                </button>
              )}
            </SectionBox>

            {/* Checkout Behavior */}
            <SectionBox title="Checkout Behavior" icon="🛒" color="#0891b2">
              <div className="grid gap-1" style={{gridTemplateColumns:'1fr 1fr'}}>
                <Toggle checked={form.prompt_weight}    onChange={()=>setF('prompt_weight',   !form.prompt_weight)}    label="Prompt Weight"    desc="Show numpad for weight"/>
                <Toggle checked={form.prompt_price}     onChange={()=>setF('prompt_price',    !form.prompt_price)}     label="Prompt Price"     desc="Show numpad for price"/>
                <Toggle checked={form.has_serial}       onChange={()=>setF('has_serial',      !form.has_serial)}       label="Serial Numbers"   desc="Track serial numbers"/>
                <Toggle checked={form.prompt_sales}     onChange={()=>setF('prompt_sales',    !form.prompt_sales)}     label="Prompt Staff"     desc="Show staff list on add"/>
                <Toggle checked={form.track_inventory}  onChange={()=>setF('track_inventory', !form.track_inventory)}  label="Track Inventory"  desc="Show stock levels"/>
              </div>
            </SectionBox>

            {/* Save button at bottom */}
            <button onClick={handleSave} disabled={saving}
              className="w-full rounded-xl py-3.5 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-50"
              style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow:'0 4px 16px rgba(99,102,241,0.3)'}}>
              {saving ? '⏳ Saving...' : '✓ Save All Changes'}
            </button>
          </div>
        )}

        {/* ══ RECEIVING ══ */}
        {tab==='receiving' && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[['Total Received',`${receives.reduce((s,r)=>s+(r.qty||0),0)} ${p.unit}`,'#16a34a'],
                ['In Stock',`${qty} ${p.unit}`,qty<=5?'#dc2626':'#1e293b'],
                ['Avg Cost',`$${parseFloat(avgCost).toFixed(2)}`,'#6366f1']
              ].map(([l,v,c])=>(
                <div key={l} className="rounded-xl p-3 text-center" style={{background:'#fff',border:'1px solid #e2e8f0'}}>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {loadingR ? <div className="text-center py-4 text-slate-400 text-[12px]">Loading...</div>
            : receives.length===0 ? <Empty msg="No receiving history yet"/>
            : <table className="w-full border-collapse rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                <thead><tr><Th>Date</Th><Th>Vendor</Th><Th>Qty</Th><Th>Cost/Unit</Th><Th>Total</Th><Th>Notes</Th></tr></thead>
                <tbody>{receives.map((r,i)=>(
                  <tr key={i} className="hover:bg-blue-50/30">
                    <Td>{new Date(r.created_at).toLocaleDateString()}</Td>
                    <Td>{r.suppliers?.name||'—'}</Td>
                    <Td mono bold color="#16a34a">+{r.qty} {p.unit}</Td>
                    <Td mono>${parseFloat(r.cost||0).toFixed(2)}</Td>
                    <Td mono bold color="#6366f1">${(r.qty*(r.cost||0)).toFixed(2)}</Td>
                    <Td color="#94a3b8">{r.notes||'—'}</Td>
                  </tr>
                ))}</tbody>
              </table>}
          </>
        )}

        {/* ══ ADJUSTMENTS ══ */}
        {tab==='adjustments' && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[['Net Change',`${adjustments.reduce((s,r)=>s+(r.qty_change||0),0)>=0?'+':''}${adjustments.reduce((s,r)=>s+(r.qty_change||0),0)}`,adjustments.reduce((s,r)=>s+(r.qty_change||0),0)>=0?'#16a34a':'#dc2626'],
                ['In Stock',`${qty} ${p.unit}`,qty<=5?'#dc2626':'#1e293b'],
                ['Count',adjustments.length,'#6366f1']
              ].map(([l,v,c])=>(
                <div key={l} className="rounded-xl p-3 text-center" style={{background:'#fff',border:'1px solid #e2e8f0'}}>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {loadingA ? <div className="text-center py-4 text-slate-400 text-[12px]">Loading...</div>
            : adjustments.length===0 ? <Empty msg="No adjustments yet"/>
            : <table className="w-full border-collapse rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                <thead><tr><Th>Date & Time</Th><Th>Change</Th><Th>Before</Th><Th>After</Th><Th>Reason</Th><Th>By</Th></tr></thead>
                <tbody>{adjustments.map((r,i)=>(
                  <tr key={i} className="hover:bg-blue-50/30">
                    <Td>
                      <div>{new Date(r.created_at).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-400">{new Date(r.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
                    </Td>
                    <Td mono bold color={r.qty_change>=0?'#16a34a':'#dc2626'}>{r.qty_change>=0?'+':''}{r.qty_change} {p.unit}</Td>
                    <Td mono color="#94a3b8">{r.qty_before}</Td>
                    <Td mono bold>{r.qty_after}</Td>
                    <Td>{r.reason}</Td>
                    <Td color="#6366f1">{r.users?.name||r.user_name||'—'}</Td>
                  </tr>
                ))}</tbody>
              </table>}
          </>
        )}

        {/* ══ SALES ══ */}
        {tab==='sales' && (
          <>
            <div className="grid grid-cols-4 gap-3 mb-3">
              {[['Units Sold',`${sales.reduce((s,r)=>s+(r.quantity||0),0)} ${p.unit}`,'#6366f1'],
                ['Revenue',`$${sales.reduce((s,r)=>s+(r.line_total||0),0).toFixed(2)}`,'#16a34a'],
                ['Transactions',sales.length,'#1e293b'],
                ['In Stock',`${qty} ${p.unit}`,qty<=5?'#dc2626':'#1e293b']
              ].map(([l,v,c])=>(
                <div key={l} className="rounded-xl p-3 text-center" style={{background:'#fff',border:'1px solid #e2e8f0'}}>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {loadingS ? <div className="text-center py-4 text-slate-400 text-[12px]">Loading...</div>
            : sales.length===0 ? <Empty msg="No sales yet"/>
            : <table className="w-full border-collapse rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                <thead><tr>
                  <Th>Date & Time</Th>
                  <Th>Invoice #</Th>
                  <Th>Customer</Th>
                  <Th>Qty</Th>
                  <Th>Unit Price</Th>
                  <Th>Discount</Th>
                  <Th>Total</Th>
                  <Th>Serial #</Th>
                  <Th>Payment</Th>
                  <Th>Cashier</Th>
                  <Th>Note</Th>
                </tr></thead>
                <tbody>{sales.map((r,i)=>(
                  <tr key={i} className="hover:bg-blue-50/30">
                    <Td>
                      <div>{new Date(r.orders?.created_at).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-400">{new Date(r.orders?.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
                    </Td>
                    <Td mono color="#6366f1">{r.orders?.order_number||'—'}</Td>
                    <Td>{r.orders?.customers?.name||'Walk-in'}</Td>
                    <Td mono bold>{r.quantity} {p.unit}</Td>
                    <Td mono>${parseFloat(r.unit_price||0).toFixed(2)}</Td>
                    <Td mono color="#e11d48">{r.discount_amt>0?`-$${parseFloat(r.discount_amt).toFixed(2)}`:r.discount_pct>0?`-${r.discount_pct}%`:'—'}</Td>
                    <Td mono bold color="#16a34a">${parseFloat(r.line_total||0).toFixed(2)}</Td>
                    <Td mono color="#ca8a04">{r.serial_number||'—'}</Td>
                    <Td>{r.orders?.order_payments?.[0]?.method||'—'}</Td>
                    <Td>{r.orders?.cashier_name||'—'}</Td>
                    <Td color="#94a3b8">{r.note||'—'}</Td>
                  </tr>
                ))}</tbody>
              </table>}
          </>
        )}

        {/* ══ PROMOTIONS ══ */}
        {tab==='promotions' && (
          <div>
            {/* Add form */}
            {promoAdding && (
              <div className="mb-4 rounded-xl overflow-hidden" style={{border:'1.5px solid #e9d5ff'}}>
                {/* Type selector */}
                <div className="flex border-b" style={{borderColor:'#e9d5ff'}}>
                  {[['sale','🏷️','Sale'],['bulk','📦','Bulk'],['time','⏰','Time']].map(([t,icon,l])=>(
                    <button key={t} onClick={()=>setPromoType(t)}
                      className="flex-1 py-2.5 text-[12px] font-bold cursor-pointer border-none transition-all"
                      style={promoType===t
                        ? {background:TYPE_COLOR[t], color:'#fff'}
                        : {background:'#fdf4ff', color:'#94a3b8'}}>
                      {icon} {l}
                    </button>
                  ))}
                </div>

                {/* Form fields */}
                <div className="p-3" style={{background:'#fff'}}>
                  {/* Sale */}
                  {promoType==='sale' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <div className="text-[10px] text-slate-500 mb-1">Start</div>
                          <input type="datetime-local" value={saleStart} onChange={e=>setSaleStart(e.target.value)}
                            className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none" style={{border:'1.5px solid #c7d2fe'}}/>
                        </div>
                        <div className="flex-1">
                          <div className="text-[10px] text-slate-500 mb-1">End</div>
                          <input type="datetime-local" value={saleEnd} onChange={e=>setSaleEnd(e.target.value)}
                            className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none" style={{border:'1.5px solid #c7d2fe'}}/>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">Type</div>
                          <select value={saleType} onChange={e=>setSaleType(e.target.value)}
                            className="rounded-lg px-2 py-2 text-[11px] outline-none" style={{border:'1.5px solid #c7d2fe'}}>
                            <option value="fixed">$ Fixed</option>
                            <option value="pct">% Off</option>
                          </select>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">{saleType==='fixed'?'Sale Price':'Discount %'}</div>
                          <input type="number" value={saleVal} onChange={e=>setSaleVal(e.target.value)}
                            placeholder={saleType==='fixed'?'8.00':'20'} step="0.01"
                            className="w-24 rounded-lg px-2 py-1.5 text-[12px] font-mono outline-none" style={{border:'1.5px solid #c7d2fe'}}/>
                        </div>
                        {saleVal && (
                          <div className="flex items-end pb-1.5 gap-1 text-[11px]">
                            <span className="line-through text-slate-400">${parseFloat(p.price||0).toFixed(2)}</span>
                            <span className="font-bold" style={{color:'#6366f1'}}>
                              →${saleType==='fixed'?parseFloat(saleVal).toFixed(2):(parseFloat(p.price||0)*(1-parseFloat(saleVal)/100)).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Bulk */}
                  {promoType==='bulk' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">Buy</span>
                      <input type="number" value={bulkQty} onChange={e=>setBulkQty(e.target.value)} placeholder="2" min="2"
                        className="w-16 rounded-lg px-2 py-2 text-[12px] font-mono outline-none" style={{border:'1.5px solid #86efac'}}/>
                      <span className="text-[11px] text-slate-400">or more at</span>
                      <select value={bulkType} onChange={e=>setBulkType(e.target.value)}
                        className="rounded-lg px-2 py-2 text-[11px] outline-none" style={{border:'1.5px solid #86efac'}}>
                        <option value="fixed">$ Each</option>
                        <option value="pct">% Off</option>
                      </select>
                      <input type="number" value={bulkVal} onChange={e=>setBulkVal(e.target.value)}
                        placeholder={bulkType==='fixed'?'8.00':'10'} step="0.01"
                        className="w-24 rounded-lg px-2 py-2 text-[12px] font-mono outline-none" style={{border:'1.5px solid #86efac'}}/>
                      {bulkQty && bulkVal && (
                        <span className="text-[11px] font-semibold" style={{color:'#16a34a'}}>
                          Buy {bulkQty}+ → {bulkType==='fixed'?`$${parseFloat(bulkVal).toFixed(2)}/ea`:`${bulkVal}% off`}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Time */}
                  {promoType==='time' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500 mr-1">Days:</span>
                        {DAYS.map((d,i)=>(
                          <button key={i} onClick={()=>setTimeDays(ds=>ds.includes(i)?ds.filter(x=>x!==i):[...ds,i].sort())}
                            className="w-8 h-7 rounded text-[10px] font-bold cursor-pointer border-2 transition-all"
                            style={timeDays.includes(i)?{background:'#f59e0b',borderColor:'#f59e0b',color:'#fff'}:{background:'#fff',borderColor:'#e2e8f0',color:'#64748b'}}>
                            {d.substring(0,2)}
                          </button>
                        ))}
                        <span className="text-[10px] text-slate-500 ml-2">Time:</span>
                        <input type="time" value={timeStart} onChange={e=>setTimeStart(e.target.value)}
                          className="rounded-lg px-2 py-1 text-[11px] outline-none" style={{border:'1.5px solid #fde047'}}/>
                        <span className="text-slate-400 text-[10px]">→</span>
                        <input type="time" value={timeEnd} onChange={e=>setTimeEnd(e.target.value)}
                          className="rounded-lg px-2 py-1 text-[11px] outline-none" style={{border:'1.5px solid #fde047'}}/>
                        <select value={timeType} onChange={e=>setTimeType(e.target.value)}
                          className="rounded-lg px-2 py-1 text-[11px] outline-none" style={{border:'1.5px solid #fde047'}}>
                          <option value="fixed">$ Price</option>
                          <option value="pct">% Off</option>
                        </select>
                        <input type="number" value={timeVal} onChange={e=>setTimeVal(e.target.value)}
                          placeholder={timeType==='fixed'?'3.00':'10'} step="0.01"
                          className="w-20 rounded-lg px-2 py-1 text-[11px] font-mono outline-none" style={{border:'1.5px solid #fde047'}}/>
                      </div>
                    </div>
                  )}

                  {/* Save button */}
                  <button onClick={savePromo} disabled={promoSaving}
                    className="w-full mt-2 rounded-lg py-2 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-50"
                    style={{background: TYPE_COLOR[promoType]}}>
                    {promoSaving ? '⏳ Saving...' : `✓ Add ${TYPE_NAME[promoType]}`}
                  </button>
                </div>
              </div>
            )}

            {/* Promotions list */}
            {promos.length===0 && !promoAdding ? <Empty msg="No promotions — click +Add Promotion"/>
            : <div className="flex flex-col gap-2">
                {promos.map(promo=>(
                  <div key={promo.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                    style={{background:'#fff', border:`1.5px solid ${promo.is_active?(TYPE_COLOR[promo.type]||'#6366f1')+'40':'#e2e8f0'}`}}>
                    <span className="text-[18px]">{TYPE_ICON[promo.type]||'🏷️'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-slate-700">{promo.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                          style={{background:TYPE_COLOR[promo.type]+'15', color:TYPE_COLOR[promo.type]}}>
                          {TYPE_NAME[promo.type]}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {promo.type==='sale'&&`${promo.sale_type==='pct'?`${promo.sale_value}% off`:`$${promo.sale_value}`} · ${new Date(promo.sale_start).toLocaleDateString()} → ${new Date(promo.sale_end).toLocaleDateString()}`}
                        {promo.type==='bulk'&&(promo.bulk_tiers||[]).map(t=>`Buy ${t.min_qty}+: ${t.type==='fixed'?`$${t.value}/ea`:`${t.value}% off`}`).join(' · ')}
                        {promo.type==='time'&&(promo.time_rules||[]).map(r=>`${(r.days||[]).map(d=>DAYS[d]).join(',')} ${r.start_time}-${r.end_time}`).join(' · ')}
                      </div>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${promo.is_active?'bg-green-100 text-green-700':'bg-slate-100 text-slate-400'}`}>
                      {promo.is_active?'● ACTIVE':'● PAUSED'}
                    </span>
                    <button onClick={()=>togglePromo(promo)}
                      className="text-[10px] px-2.5 py-1 rounded-lg border cursor-pointer"
                      style={promo.is_active?{background:'#fff1f2',borderColor:'#fecdd3',color:'#e11d48'}:{background:'#dcfce7',borderColor:'#86efac',color:'#16a34a'}}>
                      {promo.is_active?'Pause':'On'}
                    </button>
                    <button onClick={()=>deletePromo(promo.id)}
                      className="text-slate-400 hover:text-red-500 bg-transparent border-none cursor-pointer text-[14px]">✕</button>
                  </div>
                ))}
              </div>}
          </div>
        )}
      </div>

      {/* Modals & Numpads */}
      {showReceive && (
        <ReceiveModal product={p} tenantId={tenantId}
          onSave={() => { qc.invalidateQueries(['product-receives',p.id]); onRefresh(); setShowReceive(false) }}
          onClose={() => setShowReceive(false)}/>
      )}
      {showAdjust && (
        <AdjustModal product={p} tenantId={tenantId}
          onSave={() => { qc.invalidateQueries(['product-adjustments',p.id]); onRefresh(); setShowAdjust(false) }}
          onClose={() => setShowAdjust(false)}/>
      )}
      {numpadField && numpadConfig[numpadField] && (
        <NumPad
          title={numpadConfig[numpadField].title}
          subtitle={p.name}
          value={String(form[numpadField]||'')}
          onChange={v=>setF(numpadField,v)}
          prefix={numpadConfig[numpadField].prefix||''}
          suffix={numpadConfig[numpadField].suffix||''}
          allowNegative={false}
          allowDecimal={true}
          onConfirm={v=>{ setF(numpadField, v); setNumpadField(null) }}
          onClose={()=>setNumpadField(null)}
        />
      )}

      {/* Add Category modal */}
      {showAddCat && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center" onClick={()=>setShowAddCat(false)}>
          <div className="bg-white rounded-2xl w-[300px] p-5 shadow-2xl" onClick={e=>e.stopPropagation()}>
            <div className="text-[14px] font-bold mb-3">✚ Add Category</div>
            <input value={newCatName} onChange={e=>setNewCatName(e.target.value)} autoFocus placeholder="Category name..."
              onKeyDown={async e=>{if(e.key==='Enter'&&newCatName.trim()){const{data}=await supabase.from('categories').insert({tenant_id:tenantId,name:newCatName.trim(),color:'#6366f1',sort_order:categories.length+1}).select().single();if(data){setSelCatId(data.id);qc.invalidateQueries(['categories-full'])};setShowAddCat(false);setNewCatName('')}}}
              className="w-full rounded-xl px-3 py-2 text-[13px] outline-none mb-3" style={{border:'1.5px solid #e2e8f0'}}/>
            <div className="flex gap-2">
              <button onClick={()=>{setShowAddCat(false);setNewCatName('')}}
                className="flex-1 rounded-xl py-2 text-[12px] text-slate-500 cursor-pointer border border-slate-200 bg-slate-50">Cancel</button>
              <button disabled={!newCatName.trim()} onClick={async()=>{const{data}=await supabase.from('categories').insert({tenant_id:tenantId,name:newCatName.trim(),color:'#6366f1',sort_order:categories.length+1}).select().single();if(data){setSelCatId(data.id);qc.invalidateQueries(['categories-full'])};setShowAddCat(false);setNewCatName('')}}
                className="flex-[2] rounded-xl py-2 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-40" style={{background:'#6366f1'}}>✓ Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Subcategory modal */}
      {showAddSub && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center" onClick={()=>setShowAddSub(false)}>
          <div className="bg-white rounded-2xl w-[340px] p-5 shadow-2xl" onClick={e=>e.stopPropagation()}>
            <div className="text-[14px] font-bold mb-4">✚ Add Subcategory</div>
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Main Category *</div>
              <select value={newSubCatId} onChange={e=>setNewSubCatId(e.target.value)} autoFocus
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none" style={{border:'1.5px solid #e2e8f0'}}>
                <option value="">— Select —</option>
                {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Name *</div>
              <input value={newSubName} onChange={e=>setNewSubName(e.target.value)} disabled={!newSubCatId} placeholder="Subcategory name..."
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none disabled:opacity-40" style={{border:'1.5px solid #e2e8f0'}}/>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{setShowAddSub(false);setNewSubName('');setNewSubCatId('')}}
                className="flex-1 rounded-xl py-2 text-[12px] text-slate-500 cursor-pointer border border-slate-200 bg-slate-50">Cancel</button>
              <button disabled={!newSubName.trim()||!newSubCatId} onClick={async()=>{const{data}=await supabase.from('subcategories').insert({tenant_id:tenantId,category_id:newSubCatId,name:newSubName.trim(),sort_order:(categories.find(c=>c.id===newSubCatId)?.subcategories?.length||0)+1}).select().single();if(data){setSelCatId(newSubCatId);setF('subcategory_id',data.id);qc.invalidateQueries(['categories-full'])};setShowAddSub(false);setNewSubName('');setNewSubCatId('')}}
                className="flex-[2] rounded-xl py-2 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-40" style={{background:'#6366f1'}}>✓ Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
