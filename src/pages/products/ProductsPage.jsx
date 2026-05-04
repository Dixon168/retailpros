// src/pages/products/ProductsPage.jsx
import React, { useState } from 'react'
import { ProductPhoto, PhotoViewer } from '@/components/ui/ProductPhoto'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { ProductForm } from './ProductForm'
import { ProductDetailInline } from './ProductDetailInline'
import toast from 'react-hot-toast'

const TYPE_COLOR = {
  unit:'#3b82f6', weight:'#10b981', serialized:'#f59e0b', service:'#8b5cf6'
}

export default function ProductsPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch]         = useState('')
  const [filterType, setFilterType] = useState('all')
  const [showForm, setShowForm]     = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [expandedId, setExpandedId]   = useState(null)
  const [photoViewer, setPhotoViewer]   = useState(null)
  const [filterCat, setFilterCat]     = useState('')
  const [filterTag, setFilterTag]     = useState('')

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', tenant?.id, search, filterType, filterCat, filterTag],
    queryFn: async () => {
      let q = supabase.from('products')
        .select('*, inventory(quantity, avg_cost), subcategories(id, name, category_id, categories(id, name, emoji, color))')
        .eq('tenant_id', tenant.id).eq('is_active', true)
      if (search) q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%,upc.ilike.%${search}%`)
      if (filterType !== 'all' && filterType !== 'low') q = q.eq('type', filterType)
      if (filterCat) q = q.eq('subcategories.category_id', filterCat)
      if (filterTag) q = q.contains('tags', [filterTag])
      const { data } = await q.order('name').limit(200)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  function getQty(p)     { return p.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0 }
  function getAvgCost(p) { return p.inventory?.[0]?.avg_cost || p.cost || 0 }

  const inventoryValue = products.reduce((s,p) => {
    const q = getQty(p)
    return s + q * getAvgCost(p)
  }, 0)

  const { data: allCategories = [] } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('id, name').eq('tenant_id', tenant.id).order('sort_order')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Collect all tags from loaded products
  const allTags = [...new Set(products.flatMap(p => p.tags || []))].sort()

  const displayed  = filterType === 'low'
    ? products.filter(p => getQty(p) <= 5 && p.type !== 'service')
    : products
  const lowStock   = products.filter(p => getQty(p) <= 5 && p.type !== 'service').length

  const handleDisable = async (p) => {
    const enabling = p.is_enabled === false
    await supabase.from('products').update({ is_enabled: enabling }).eq('id', p.id)
    qc.invalidateQueries(['products'])
    toast.success(`Product ${enabling ? 'enabled' : 'disabled'}`)
  }

  const handleDelete = async (p) => {
    if (!confirm(`Permanently delete "${p.name}"?\n\nThis will free up the SKU and UPC codes.\nThis cannot be undone.`)) return
    await supabase.from('products').update({ is_active: false, sku: null, upc: null }).eq('id', p.id)
    qc.invalidateQueries(['products'])
    toast.success('Product deleted — SKU/UPC codes are now free')
  }

  return (
    <div className="flex h-full bg-[#07090f]">
      {/* Sidebar */}
      <div className="w-[180px] p-3 flex-shrink-0" style={{background:'#fff', borderRight:'1.5px solid #e2e8f0'}}>
        <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-widest px-2 mb-2">Filter</div>
        {[
          ['all','All Products',null],
          ['unit','Unit','#3b82f6'],
          ['weight','Weight','#10b981'],
          ['serialized','Serialized','#f59e0b'],
          ['service','Service','#8b5cf6'],
        ].map(([id,label,color]) => (
          <div key={id} onClick={() => setFilterType(id)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-[12px] mb-0.5 transition-all ${
              filterType===id ? 'bg-[#1a2236] text-white' : 'text-[#8899b0] hover:bg-[#111827] hover:text-white'
            }`}>
            {color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:color}}/>}
            {label}
          </div>
        ))}
        <div className="h-px bg-[#1e2d42] my-2"/>
        <div onClick={() => setFilterType('low')}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-[12px] transition-all ${
            filterType==='low' ? 'bg-red-500/10 text-red-400' : 'text-[#8899b0] hover:bg-[#111827]'
          }`}>
          <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"/>
          Low Stock
          {lowStock > 0 && <span className="ml-auto text-[10px] font-mono bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">{lowStock}</span>}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{background:'#fff', borderBottom:'1.5px solid #e2e8f0'}}>
          <div className="flex gap-4 mr-2">
            {[
              ['Products', products.length, ''],
              ['Low Stock', lowStock, 'text-red-400'],
              ['Value', '$'+products.reduce((s,p)=>{const q=getQty(p);return s+q*getAvgCost(p)},0).toFixed(0), 'text-green-400'],
            ].map(([l,v,c]) => (
              <div key={l}>
                <div className="text-[9px] font-mono text-[#3d5068] uppercase">{l}</div>
                <div className={`text-[17px] font-bold ${c}`} style={{}}>{v}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-[9px] px-3 flex-1 transition-colors" style={{background:'#f8fafc', border:'1.5px solid #e2e8f0'}}>
            <span className="text-[#3d5068]">🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search name, SKU, UPC, tag..."
              className="bg-transparent border-none outline-none text-[12px] py-2 flex-1" style={{color:'#1e293b'}} placeholder-slate-400/>
          </div>
          {/* Category filter */}
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}
            className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 text-[12px] text-[#e8edf5] outline-none focus:border-blue-500/40 flex-shrink-0">
            <option value="">All Categories</option>
            {allCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Tag filter */}
          <select value={filterTag} onChange={e=>setFilterTag(e.target.value)}
            className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 text-[12px] text-[#e8edf5] outline-none focus:border-blue-500/40 flex-shrink-0">
            <option value="">All Tags</option>
            {allTags.map(t => <option key={t} value={t}>🏷️ {t}</option>)}
          </select>

          {/* Clear filters */}
          {(filterCat || filterTag || search) && (
            <button onClick={()=>{setFilterCat('');setFilterTag('');setSearch('')}}
              className="bg-[#111827] border border-red-500/20 rounded-[9px] px-2.5 py-2 text-[10px] text-red-400 cursor-pointer hover:border-red-500/40 flex-shrink-0 whitespace-nowrap">
              ✕ Clear
            </button>
          )}

          <button onClick={()=>{setEditProduct(null);setShowForm(true)}}
            className="bg-blue-500 border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white cursor-pointer hover:bg-blue-600 transition-colors flex-shrink-0">
            + Add Product
          </button>
        </div>

        {/* Product List — always visible buttons */}
        <div className="flex-1 overflow-auto" style={{background:'#f8fafc'}}>
          {isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array(6).fill(0).map((_,i) => (
                <div key={i} className="h-[72px] bg-[#0d1117] border border-[#1e2d42] rounded-[11px] animate-pulse"/>
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#3d5068]">
              <div className="text-5xl mb-3 opacity-15">📦</div>
              <div className="text-[14px] font-semibold mb-2">No products yet</div>
              <button onClick={()=>{setEditProduct(null);setShowForm(true)}}
                className="bg-blue-500 border-none rounded-lg px-5 py-2.5 text-[12px] font-bold text-white cursor-pointer mt-1">
                + Add your first product
              </button>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr style={{background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0'}}>
                  {['','Product','SKU','UPC','Price','Avg Cost','Stock','Stock Value','Margin','Actions'].map((h,i) => (
                    <th key={i} className="px-3 py-2.5 text-left font-mono text-[10px] text-[#3d5068] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map(p => {
                  const qty      = getQty(p)
                  const avgCost  = getAvgCost(p)
                  const margin   = p.price > 0 ? ((p.price - avgCost) / p.price * 100) : 0
                  const isLow    = qty <= 5 && p.type !== 'service'
                  const disabled = p.is_enabled === false
                  const tc       = TYPE_COLOR[p.type] || '#3b82f6'
                  const subcat   = p.subcategories || null
                  const catObj   = subcat?.categories || null
                  const cat      = catObj?.name || null
                  const sub      = subcat?.name || null

                  return (
                    <React.Fragment key={p.id}>
                    <tr className={`transition-colors ${disabled ? 'opacity-40' : 'hover:bg-blue-50/30 cursor-pointer'}`} style={{borderBottom:'1px solid #f1f5f9'}}>
                      {/* Photo */}
                      <td className="px-3 py-2 w-10">
                        <ProductPhoto imageUrl={p.image_url} name={p.name} size="sm"
                          onClick={() => setPhotoViewer(p)}/>
                      </td>



                      {/* Product name */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="text-[13px] font-semibold text-slate-800">{p.name}</div>
                          {disabled && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{background:'#fff7ed',color:'#ea580c'}}>DISABLED</span>}
                        </div>
                        {cat && <div className="text-[9px] text-slate-400 mt-0.5">{cat}{sub ? ' › '+sub : ''}</div>}
                        {p.tags?.length > 0 && (
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {p.tags.map(t=><span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{background:'#e0e7ff',color:'#6366f1'}}>{t}</span>)}
                          </div>
                        )}
                      </td>

                      {/* SKU */}
                      <td className="px-3 py-2">
                        <span className="text-[11px] font-mono text-slate-600">{p.sku || '—'}</span>
                      </td>

                      {/* UPC */}
                      <td className="px-3 py-2">
                        <span className="text-[11px] font-mono text-slate-500">{p.upc || '—'}</span>
                      </td>

                      {/* Price */}
                      <td className="px-3 py-2">
                        <div className="text-[13px] font-bold font-mono" style={{color:'#4f46e5'}}>
                          ${parseFloat(p.price||0).toFixed(2)}
                        </div>
                      </td>

                      {/* Avg Cost */}
                      <td className="px-3 py-2">
                        <div className="text-[12px] font-mono text-slate-500">
                          ${parseFloat(avgCost).toFixed(2)}
                        </div>
                      </td>

                      {/* Stock */}
                      <td className="px-3 py-2">
                        {p.type === 'service'
                          ? <span className="text-[11px] text-slate-400">—</span>
                          : <span className={`text-[12px] font-mono font-bold ${isLow?'text-red-500':''}`}>
                              {isLow && '⚠ '}{qty} {p.unit}
                            </span>
                        }
                      </td>

                      {/* Stock Value */}
                      <td className="px-3 py-2">
                        {p.type === 'service'
                          ? <span className="text-[11px] text-slate-400">—</span>
                          : <span className="text-[12px] font-mono font-semibold" style={{color:'#16a34a'}}>
                              ${(qty * avgCost).toFixed(2)}
                            </span>
                        }
                      </td>

                      {/* Margin */}
                      <td className="px-3 py-2">
                        <div className={`text-[12px] font-mono font-bold ${
                          margin>=30?'text-green-600':margin>=10?'text-yellow-600':'text-red-500'
                        }`}>{margin.toFixed(1)}%</div>
                        <div className="text-[10px] font-mono text-slate-400">
                          ${(parseFloat(p.price||0)-avgCost).toFixed(2)}/ea
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5 flex-wrap">
                          <button onClick={() => setExpandedId(expandedId===p.id ? null : p.id)}
                            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border transition-all"
                            style={expandedId===p.id
                              ? {background:'#e0e7ff', borderColor:'#a5b4fc', color:'#6366f1'}
                              : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
                            📋 {expandedId===p.id ? 'Close' : 'Detail'}
                          </button>
                          <button onClick={() => handleDisable(p)}
                            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border"
                            style={disabled
                              ? {background:'#dcfce7', borderColor:'#86efac', color:'#16a34a'}
                              : {background:'#fff7ed', borderColor:'#fed7aa', color:'#ea580c'}}>
                            {disabled ? '▶ Enable' : '⏸ Disable'}
                          </button>
                          <button onClick={() => handleDelete(p)}
                            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border"
                            style={{background:'#fff1f2', borderColor:'#fecdd3', color:'#e11d48'}}>
                            🗑 Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === p.id && (
                      <tr key={p.id+'-detail'}>
                        <td colSpan={10} className="p-0" style={{borderBottom:'1px solid #e2e8f0'}}>
                          <ProductDetailInline product={p} tenantId={tenant?.id}
                            onRefresh={() => { qc.refetchQueries(['products']); qc.invalidateQueries(['pos-products']) }}/>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {photoViewer && <PhotoViewer product={photoViewer} onClose={() => setPhotoViewer(null)}/>}


      {/* Modals */}
      {showForm && (
        <ProductForm initial={editProduct||{}} tenantId={tenant?.id}
          onSave={() => { qc.invalidateQueries(['products']); setShowForm(false); setEditProduct(null) }}
          onClose={() => { setShowForm(false); setEditProduct(null) }}/>
      )}


    </div>
  )
}

// ── Product Detail Inline (expands inside table) ──
// ── Promo Quick Panel ──
function PromoQuickPanel({ product, tenantId, onClose }) {
  const qc = useQueryClient()
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
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const TYPE_COLOR = { sale:'#6366f1', bulk:'#16a34a', time:'#d97706' }

  const { data: promos=[] } = useQuery({
    queryKey: ['product-promos', product.id],
    queryFn: async () => {
      const { data } = await supabase.from('promotions').select('*')
        .eq('product_id', product.id).order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!product.id,
  })

  const togglePromo = async (p) => {
    await supabase.from('promotions').update({ is_active: !p.is_active }).eq('id', p.id)
    qc.invalidateQueries(['product-promos', product.id])
    qc.invalidateQueries(['promotions'])
  }
  const deletePromo = async (id) => {
    if (!confirm('Delete this promotion?')) return
    await supabase.from('promotions').delete().eq('id', id)
    qc.invalidateQueries(['product-promos', product.id])
  }

  const savePromo = async () => {
    setSaving(true)
    try {
      const base = { tenant_id: tenantId, product_id: product.id, type, is_active: true }
      let payload
      if (type==='sale') {
        if (!saleStart||!saleEnd||!saleVal) { toast.error('Fill all fields'); setSaving(false); return }
        payload = { ...base, name:`${product.name} Sale`, sale_start:saleStart, sale_end:saleEnd, sale_type:saleType, sale_value:parseFloat(saleVal) }
      } else if (type==='bulk') {
        if (!bulkQty||!bulkVal) { toast.error('Fill all fields'); setSaving(false); return }
        payload = { ...base, name:`${product.name} Bulk`, bulk_tiers:[{min_qty:parseInt(bulkQty),type:bulkType,value:parseFloat(bulkVal)}] }
      } else {
        if (!timeDays.length||!timeStart||!timeEnd||!timeVal) { toast.error('Fill all fields'); setSaving(false); return }
        payload = { ...base, name:`${product.name} Time`, time_rules:[{days:timeDays,start_time:timeStart,end_time:timeEnd,type:timeType,value:parseFloat(timeVal)}] }
      }
      await supabase.from('promotions').insert(payload)
      qc.invalidateQueries(['product-promos', product.id])
      qc.invalidateQueries(['promotions'])
      setSaleVal(''); setBulkQty(''); setBulkVal(''); setTimeVal(''); setTimeDays([])
      toast.success('Promotion added ✓')
    } catch(err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{background:'rgba(15,23,42,0.55)', backdropFilter:'blur(6px)'}} onClick={onClose}>
      <div className="rounded-2xl w-[520px] max-h-[90vh] overflow-y-auto shadow-2xl"
        style={{background:'#fff'}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'#fdf4ff', borderBottom:'1.5px solid #e9d5ff', borderRadius:'16px 16px 0 0'}}>
          <div>
            <div className="text-[15px] font-bold text-slate-800">🏷️ Promotions</div>
            <div className="text-[12px] text-slate-500 mt-0.5">{product.name} · <span className="font-mono">${parseFloat(product.price||0).toFixed(2)}</span></div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-[18px]">✕</button>
        </div>

        <div className="p-5">
          {/* Existing promos */}
          {promos.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Active Promotions</div>
              <div className="flex flex-col gap-2">
                {promos.map(p => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                    style={{background:'#f8fafc', border:`1.5px solid ${p.is_active ? (TYPE_COLOR[p.type]||'#6366f1')+'40' : '#e2e8f0'}`}}>
                    <span className="text-[16px]">{{sale:'🏷️',bulk:'📦',time:'⏰'}[p.type]||'🏷️'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-slate-700">{p.name}</div>
                      <div className="text-[10px] text-slate-400">{p.type?.toUpperCase()}</div>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${p.is_active?'bg-green-100 text-green-700':'bg-slate-100 text-slate-400'}`}>
                      {p.is_active?'ACTIVE':'PAUSED'}
                    </span>
                    <button onClick={()=>togglePromo(p)}
                      className="text-[10px] px-2.5 py-1 rounded-lg border cursor-pointer"
                      style={p.is_active?{background:'#fff1f2',borderColor:'#fecdd3',color:'#e11d48'}:{background:'#dcfce7',borderColor:'#86efac',color:'#16a34a'}}>
                      {p.is_active?'Pause':'On'}
                    </button>
                    <button onClick={()=>deletePromo(p.id)}
                      className="text-slate-400 hover:text-red-500 bg-transparent border-none cursor-pointer">✕</button>
                  </div>
                ))}
              </div>
              <div className="my-4" style={{borderTop:'1px solid #f1f5f9'}}/>
            </div>
          )}

          {/* Add new */}
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Add Promotion</div>

          {/* Type tabs */}
          <div className="flex gap-2 mb-4">
            {[['sale','🏷️','Sale Pricing'],['bulk','📦','Bulk Pricing'],['time','⏰','Time Based']].map(([t,icon,l])=>(
              <button key={t} onClick={()=>setType(t)}
                className="flex-1 py-2.5 rounded-xl text-[11px] font-bold cursor-pointer border-2 transition-all flex flex-col items-center gap-1"
                style={type===t?{background:`${TYPE_COLOR[t]}12`,borderColor:TYPE_COLOR[t],color:TYPE_COLOR[t]}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                <span className="text-[18px]">{icon}</span>
                {l}
              </button>
            ))}
          </div>

          {/* Sale fields */}
          {type==='sale' && (
            <div className="flex flex-col gap-3 p-4 rounded-xl" style={{background:'#f0f4ff', border:'1.5px solid #c7d2fe'}}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">Start Date & Time</div>
                  <input type="datetime-local" value={saleStart} onChange={e=>setSaleStart(e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #c7d2fe', background:'#fff'}}/>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">End Date & Time</div>
                  <input type="datetime-local" value={saleEnd} onChange={e=>setSaleEnd(e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #c7d2fe', background:'#fff'}}/>
                </div>
              </div>
              <div className="flex gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">Type</div>
                  <select value={saleType} onChange={e=>setSaleType(e.target.value)}
                    className="rounded-xl px-3 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #c7d2fe', background:'#fff'}}>
                    <option value="fixed">$ Fixed Sale Price</option>
                    <option value="pct">% Percentage Off</option>
                  </select>
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">{saleType==='fixed'?'Sale Price':'Discount %'}</div>
                  <input type="number" value={saleVal} onChange={e=>setSaleVal(e.target.value)}
                    placeholder={saleType==='fixed'?'e.g. 8.00':'e.g. 20'} step="0.01"
                    className="w-full rounded-xl px-3 py-2 text-[13px] font-mono outline-none"
                    style={{border:'1.5px solid #c7d2fe', background:'#fff'}}/>
                </div>
              </div>
              {saleVal && (
                <div className="flex items-center gap-2 text-[12px] pt-1">
                  <span className="line-through text-slate-400">${parseFloat(product.price||0).toFixed(2)}</span>
                  <span>→</span>
                  <span className="font-bold text-indigo-600 text-[14px]">
                    ${saleType==='fixed' ? parseFloat(saleVal).toFixed(2) : (parseFloat(product.price||0)*(1-parseFloat(saleVal)/100)).toFixed(2)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">
                    Save ${saleType==='fixed' ? (parseFloat(product.price||0)-parseFloat(saleVal)).toFixed(2) : (parseFloat(product.price||0)*parseFloat(saleVal)/100).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Bulk fields */}
          {type==='bulk' && (
            <div className="flex flex-col gap-3 p-4 rounded-xl" style={{background:'#f0fdf4', border:'1.5px solid #86efac'}}>
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">Buy Qty or more</div>
                  <input type="number" value={bulkQty} onChange={e=>setBulkQty(e.target.value)} placeholder="2" min="2"
                    className="w-20 rounded-xl px-3 py-2 text-[13px] font-mono outline-none"
                    style={{border:'1.5px solid #86efac', background:'#fff'}}/>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">Discount Type</div>
                  <select value={bulkType} onChange={e=>setBulkType(e.target.value)}
                    className="rounded-xl px-3 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #86efac', background:'#fff'}}>
                    <option value="fixed">$ Each</option>
                    <option value="pct">% Off</option>
                  </select>
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">{bulkType==='fixed'?'Price per unit ($)':'Discount (%)'}</div>
                  <input type="number" value={bulkVal} onChange={e=>setBulkVal(e.target.value)}
                    placeholder={bulkType==='fixed'?'8.00':'10'} step="0.01"
                    className="w-full rounded-xl px-3 py-2 text-[13px] font-mono outline-none"
                    style={{border:'1.5px solid #86efac', background:'#fff'}}/>
                </div>
              </div>
              {bulkQty && bulkVal && (
                <div className="text-[12px] text-green-700 font-medium">
                  Buy {bulkQty}+ → {bulkType==='fixed'?`$${parseFloat(bulkVal).toFixed(2)}/ea`:`${bulkVal}% off`}
                  {bulkType==='pct' && ` = $${(parseFloat(product.price||0)*(1-parseFloat(bulkVal)/100)).toFixed(2)}/ea`}
                </div>
              )}
            </div>
          )}

          {/* Time fields */}
          {type==='time' && (
            <div className="flex flex-col gap-3 p-4 rounded-xl" style={{background:'#fffbeb', border:'1.5px solid #fde047'}}>
              <div>
                <div className="text-[10px] font-semibold text-slate-500 mb-2">Days of Week</div>
                <div className="flex gap-2">
                  {DAYS.map((d,i)=>(
                    <button key={i} onClick={()=>setTimeDays(ds=>ds.includes(i)?ds.filter(x=>x!==i):[...ds,i].sort())}
                      className="w-10 h-10 rounded-xl text-[11px] font-bold cursor-pointer border-2 transition-all"
                      style={timeDays.includes(i)?{background:'#f59e0b',borderColor:'#f59e0b',color:'#fff'}:{background:'#fff',borderColor:'#e2e8f0',color:'#64748b'}}>
                      {d.substring(0,2)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">Start Time</div>
                  <input type="time" value={timeStart} onChange={e=>setTimeStart(e.target.value)}
                    className="w-full rounded-xl px-2 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #fde047', background:'#fff'}}/>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">End Time</div>
                  <input type="time" value={timeEnd} onChange={e=>setTimeEnd(e.target.value)}
                    className="w-full rounded-xl px-2 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #fde047', background:'#fff'}}/>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">Type</div>
                  <select value={timeType} onChange={e=>setTimeType(e.target.value)}
                    className="w-full rounded-xl px-2 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #fde047', background:'#fff'}}>
                    <option value="fixed">$ Price</option>
                    <option value="pct">% Off</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">{timeType==='fixed'?'Price':'% Off'}</div>
                  <input type="number" value={timeVal} onChange={e=>setTimeVal(e.target.value)}
                    placeholder={timeType==='fixed'?'3.00':'10'} step="0.01"
                    className="w-full rounded-xl px-2 py-2 text-[12px] font-mono outline-none"
                    style={{border:'1.5px solid #fde047', background:'#fff'}}/>
                </div>
              </div>
            </div>
          )}

          <button onClick={savePromo} disabled={saving}
            className="w-full mt-4 rounded-xl py-3 text-[13px] font-bold text-white cursor-pointer border-none disabled:opacity-50"
            style={{background:'linear-gradient(135deg,#9333ea,#6366f1)'}}>
            {saving ? '⏳ Saving...' : '✓ Add Promotion'}
          </button>
        </div>
      </div>
    </div>
  )
}
