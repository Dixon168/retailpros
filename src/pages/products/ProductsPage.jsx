// src/pages/products/ProductsPage.jsx
import React, { useState } from 'react'
import { ProductPhoto, PhotoViewer } from '@/components/ui/ProductPhoto'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { ProductForm } from './ProductForm'
import { ProductDetailInline } from './ProductDetailInline'
import { AIStockBadge, AIStockPanel } from './AIStockPredict'
import { ReceiveModal } from './ReceiveModal'
import { AdjustModal } from './AdjustModal'
import { CountModal, WriteOffModal, HistoryModal } from '@/components/inventory/StockOpsModals'
import toast from 'react-hot-toast'

const TYPE_COLOR = {
  unit:'#3b82f6', weight:'#10b981', serialized:'#f59e0b', service:'#006AFF'
}

export default function ProductsPage() {
  const { tenant, store } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch]         = useState('')
  const [filterType, setFilterType] = useState('all')
  const [showForm, setShowForm]     = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [expandedId, setExpandedId]   = useState(null)
  const [showStock,   setShowStock]     = useState(null)
  const [historyId,   setHistoryId]     = useState(null)
  const [aiId,        setAiId]          = useState(null)
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
    <div className="flex h-full bg-[#FAFAFA]">
      {/* Sidebar */}
      <div className="w-[180px] p-3 flex-shrink-0" style={{background:'#fff', borderRight:'1.5px solid #e2e8f0'}}>
        <div className="text-[9px] font-mono text-[#999999] uppercase tracking-widest px-2 mb-2">Filter</div>
        {[
          ['all','All Products',null],
          ['unit','Unit','#3b82f6'],
          ['weight','Weight','#10b981'],
          ['serialized','Serialized','#f59e0b'],
          ['service','Service','#006AFF'],
        ].map(([id,label,color]) => (
          <div key={id} onClick={() => setFilterType(id)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-[12px] mb-0.5 transition-all ${
              filterType===id ? 'bg-[#F5F5F5] text-white' : 'text-[#666666] hover:bg-[#F5F5F5] hover:text-[#1F1F1F]'
            }`}>
            {color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:color}}/>}
            {label}
          </div>
        ))}
        <div className="h-px bg-[#E5E5E5] my-2"/>
        <div onClick={() => setFilterType('low')}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-[12px] transition-all ${
            filterType==='low' ? 'bg-red-500/10 text-[#CF1322]' : 'text-[#666666] hover:bg-[#F5F5F5]'
          }`}>
          <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"/>
          Low Stock
          {lowStock > 0 && <span className="ml-auto text-[10px] font-mono bg-red-500/10 text-[#CF1322] px-1.5 py-0.5 rounded">{lowStock}</span>}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{background:'#fff', borderBottom:'1.5px solid #e2e8f0'}}>
          <div className="flex gap-4 mr-2">
            {[
              ['Products', products.length, ''],
              ['Low Stock', lowStock, 'text-[#CF1322]'],
              ['Value', '$'+products.reduce((s,p)=>{const q=getQty(p);return s+q*getAvgCost(p)},0).toFixed(0), 'text-[#00B23B]'],
            ].map(([l,v,c]) => (
              <div key={l}>
                <div className="text-[9px] font-mono text-[#999999] uppercase">{l}</div>
                <div className={`text-[17px] font-bold ${c}`} style={{}}>{v}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-[9px] px-3 flex-1 transition-colors" style={{background:'#f8fafc', border:'1.5px solid #e2e8f0'}}>
            <span className="text-[#999999]">🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search name, SKU, UPC, tag..."
              className="bg-transparent border-none outline-none text-[12px] py-2 flex-1" style={{color:'#1F1F1F'}} placeholder-slate-400/>
          </div>
          {/* Category filter */}
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}
            className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2 text-[12px] text-[#1F1F1F] outline-none focus:border-[#006AFF] flex-shrink-0">
            <option value="">All Categories</option>
            {allCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Tag filter */}
          <select value={filterTag} onChange={e=>setFilterTag(e.target.value)}
            className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2 text-[12px] text-[#1F1F1F] outline-none focus:border-[#006AFF] flex-shrink-0">
            <option value="">All Tags</option>
            {allTags.map(t => <option key={t} value={t}>🏷️ {t}</option>)}
          </select>

          {/* Clear filters */}
          {(filterCat || filterTag || search) && (
            <button onClick={()=>{setFilterCat('');setFilterTag('');setSearch('')}}
              className="bg-[#F5F5F5] border border-red-500/20 rounded-[9px] px-2.5 py-2 text-[10px] text-[#CF1322] cursor-pointer hover:border-red-500/40 flex-shrink-0 whitespace-nowrap">
              ✕ Clear
            </button>
          )}

          <button onClick={()=>{setEditProduct(null);setShowForm(true)}}
            className="bg-[#006AFF] border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white cursor-pointer hover:bg-[#0055CC] transition-colors flex-shrink-0">
            + Add Product
          </button>
        </div>

        {/* Product List — always visible buttons */}
        <div className="flex-1 overflow-auto" style={{background:'#f8fafc'}}>
          {isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array(6).fill(0).map((_,i) => (
                <div key={i} className="h-[72px] bg-[#FFFFFF] border border-[#E5E5E5] rounded-[11px] animate-pulse"/>
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#999999]">
              <div className="text-5xl mb-3 opacity-15">📦</div>
              <div className="text-[14px] font-semibold mb-2">No products yet</div>
              <button onClick={()=>{setEditProduct(null);setShowForm(true)}}
                className="bg-[#006AFF] border-none rounded-lg px-5 py-2.5 text-[12px] font-bold text-white cursor-pointer mt-1">
                + Add your first product
              </button>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr style={{background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0'}}>
                  {['','Product','SKU','UPC','Price','Avg Cost','Stock','Stock Value','Margin','🤖 AI','Actions'].map((h,i) => (
                    <th key={i} className="px-3 py-2.5 text-left font-mono text-[10px] text-[#999999] uppercase tracking-wider whitespace-nowrap">{h}</th>
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
                            {p.tags.map(t=><span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{background:'#E6F0FF',color:'#006AFF'}}>{t}</span>)}
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

                      {/* AI Prediction */}
                      <AIStockBadge product={p}
                        isExpanded={aiId===p.id}
                        onExpand={() => { setAiId(aiId===p.id?null:p.id); setExpandedId(null); setHistoryId(null) }}/>

                      {/* Actions */}
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5 flex-wrap">
                          <button onClick={() => { setExpandedId(expandedId===p.id?null:p.id); setHistoryId(null); setAiId(null) }}
                            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border transition-all"
                            style={expandedId===p.id
                              ? {background:'#E6F0FF', borderColor:'#80B2FF', color:'#006AFF'}
                              : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
                            📋 {expandedId===p.id ? 'Close' : 'Detail'}
                          </button>
                          <button onClick={() => setShowStock(showStock?.id===p.id ? null : p)}
                            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border transition-all"
                            style={showStock?.id===p.id
                              ? {background:'#dcfce7', borderColor:'#86efac', color:'#16a34a'}
                              : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
                            📦 Stock
                          </button>
                          <button onClick={() => { setHistoryId(historyId===p.id?null:p.id); setExpandedId(null); setAiId(null) }}
                            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border transition-all"
                            style={historyId===p.id
                              ? {background:'#dbeafe', borderColor:'#93c5fd', color:'#2563eb'}
                              : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
                            🧾 History
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
                        <td colSpan={11} className="p-0" style={{borderBottom:'1px solid #e2e8f0'}}>
                          <ProductDetailInline product={p} tenantId={tenant?.id}
                            onRefresh={() => { qc.invalidateQueries(['products']); qc.invalidateQueries(['pos-products']);const id=expandedId;setExpandedId(null);setTimeout(()=>setExpandedId(id),100) }}/>
                        </td>
                      </tr>
                    )}
                    {historyId === p.id && (
                      <tr key={p.id+'-history'}>
                        <td colSpan={11} className="p-0" style={{borderBottom:'2px solid #2563eb'}}>
                          <SalesHistoryInline product={p} tenantId={tenant?.id}/>
                        </td>
                      </tr>
                    )}
                    {aiId === p.id && (
                      <AIStockPanel key={p.id+'-ai'} product={p} onClose={() => setAiId(null)}/>
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


      {showStock && (
        <StockPanel product={showStock} tenantId={tenant?.id} storeId={store?.id}
          onClose={() => setShowStock(null)}
          onRefresh={() => { qc.invalidateQueries(['products']); setShowStock(null) }}/>
      )}

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
  const TYPE_COLOR = { sale:'#006AFF', bulk:'#16a34a', time:'#d97706' }

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
      style={{background:'rgba(15,23,42,0.55)', backdropFilter:'blur(2px)'}} onClick={onClose}>
      <div className="rounded-2xl w-[520px] max-h-[90vh] overflow-y-auto shadow-md"
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
                    style={{background:'#f8fafc', border:`1.5px solid ${p.is_active ? (TYPE_COLOR[p.type]||'#006AFF')+'40' : '#e2e8f0'}`}}>
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
            <div className="flex flex-col gap-3 p-4 rounded-xl" style={{background:'#E6F0FF', border:'1.5px solid #B3D1FF'}}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">Start Date & Time</div>
                  <input type="datetime-local" value={saleStart} onChange={e=>setSaleStart(e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #B3D1FF', background:'#fff'}}/>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">End Date & Time</div>
                  <input type="datetime-local" value={saleEnd} onChange={e=>setSaleEnd(e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #B3D1FF', background:'#fff'}}/>
                </div>
              </div>
              <div className="flex gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">Type</div>
                  <select value={saleType} onChange={e=>setSaleType(e.target.value)}
                    className="rounded-xl px-3 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #B3D1FF', background:'#fff'}}>
                    <option value="fixed">$ Fixed Sale Price</option>
                    <option value="pct">% Percentage Off</option>
                  </select>
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">{saleType==='fixed'?'Sale Price':'Discount %'}</div>
                  <input type="number" value={saleVal} onChange={e=>setSaleVal(e.target.value)}
                    placeholder={saleType==='fixed'?'e.g. 8.00':'e.g. 20'} step="0.01"
                    className="w-full rounded-xl px-3 py-2 text-[13px] font-mono outline-none"
                    style={{border:'1.5px solid #B3D1FF', background:'#fff'}}/>
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
            style={{background:'#006aff'}}>
            {saving ? '⏳ Saving...' : '✓ Add Promotion'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Stock Quick Panel ──
function StockPanel({ product: p, tenantId, storeId, onClose, onRefresh }) {
  const [showReceive, setShowReceive] = useState(false)
  const [showCount, setShowCount]     = useState(false)
  const [showWriteOff, setShowWriteOff] = useState(false)
  const [showHistory, setShowHistory] = useState(false)


  const qty      = p.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const avgCost  = p.inventory?.[0]?.avg_cost || p.cost || 0
  const stockVal = qty * avgCost
  const isLow    = qty <= (p.low_stock_qty || 5) && p.type !== 'service'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{background:'rgba(15,23,42,0.5)', backdropFilter:'blur(4px)'}} onClick={onClose}>
      <div className="rounded-2xl shadow-md overflow-hidden"
        style={{background:'#fff', width:'360px'}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'#f0fdf4', borderBottom:'1.5px solid #86efac'}}>
          <div>
            <div className="text-[15px] font-bold text-slate-800">📦 Stock</div>
            <div className="text-[12px] text-slate-500 mt-0.5">{p.name}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-[18px]">✕</button>
        </div>

        {/* Stock info */}
        <div className="p-5">
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              ['In Stock', p.type==='service'?'—':`${qty} ${p.unit||'ea'}`, isLow?'#dc2626':'#16a34a'],
              ['Avg Cost', `$${parseFloat(avgCost).toFixed(2)}`, '#006AFF'],
              ['Stock Value', p.type==='service'?'—':`$${stockVal.toFixed(2)}`, '#1F1F1F'],
            ].map(([l,v,c]) => (
              <div key={l} className="rounded-xl p-3 text-center" style={{background:'#f8fafc', border:'1.5px solid #e2e8f0'}}>
                <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                <div className="text-[18px] font-bold" style={{color:c}}>{v}</div>
              </div>
            ))}
          </div>

          {isLow && (
            <div className="rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2"
              style={{background:'#fee2e2', border:'1px solid #fca5a5'}}>
              <span>⚠️</span>
              <span className="text-[12px] font-semibold text-red-700">Low Stock Alert</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setShowReceive(true)}
              className="rounded-lg py-2.5 px-3 text-[13px] font-bold cursor-pointer active:scale-[0.96] flex items-center justify-center gap-1.5"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              📥 Receive
            </button>
            <button onClick={() => setShowCount(true)}
              className="rounded-lg py-2.5 px-3 text-[13px] font-bold cursor-pointer active:scale-[0.96] flex items-center justify-center gap-1.5"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              🔢 Count
            </button>
            <button onClick={() => setShowWriteOff(true)}
              className="rounded-lg py-2.5 px-3 text-[13px] font-bold cursor-pointer active:scale-[0.96] flex items-center justify-center gap-1.5"
              style={{background:'#FFFFFF', color:'#CF1322', border:'1px solid #FECACA'}}>
              💔 Write off
            </button>
            <button onClick={() => setShowHistory(true)}
              className="rounded-lg py-2.5 px-3 text-[13px] font-bold cursor-pointer active:scale-[0.96] flex items-center justify-center gap-1.5"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              📜 History
            </button>
          </div>

          <button onClick={() => { window.location.href = `/stock-levels?focus=${p.id}` }}
            className="mt-3 w-full rounded-lg py-2.5 text-[12px] font-bold cursor-pointer active:scale-[0.96] flex items-center justify-center gap-2"
            style={{background:'#F5F5F5', color:'#006AFF', border:'1px solid #E5E5E5'}}>
            📊 Open in Stock Center →
          </button>
        </div>
      </div>

      {showReceive && (
        <ReceiveModal product={p} tenantId={tenantId} storeId={storeId}
          onSave={() => { onRefresh(); setShowReceive(false) }}
          onClose={() => setShowReceive(false)}/>
      )}
      {showCount && (
        <CountModal product={p} currentQty={qty}
          onClose={() => setShowCount(false)}
          onSaved={() => { onRefresh(); setShowCount(false) }}/>
      )}
      {showWriteOff && (
        <WriteOffModal product={p} currentQty={qty}
          onClose={() => setShowWriteOff(false)}
          onSaved={() => { onRefresh(); setShowWriteOff(false) }}/>
      )}
      {showHistory && (
        <HistoryModal product={p} onClose={() => setShowHistory(false)}/>
      )}
    </div>
  )
}

// ── Combined History Inline (Sales + Receiving + Adjustments) ──
function SalesHistoryInline({ product: p }) {
  const [filter, setFilter] = useState('all') // 'all'|'sale'|'receive'|'adjust'

  const { data: sales = [], isLoading: ls } = useQuery({
    queryKey: ['hist-sales', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('order_items')
        .select('*, orders(order_number, created_at, cashier_name, customers(name), order_payments(method))')
        .eq('product_id', p.id).order('created_at', { ascending: false }).limit(200)
      return (data||[]).map(r => ({
        _type: 'sale',
        date: r.orders?.created_at,
        invoice: r.orders?.order_number,
        customer: r.orders?.customers?.name || 'Walk-in',
        qty: r.quantity,
        unit: p.unit,
        price: r.unit_price,
        discount: r.discount_amt > 0 ? `-$${parseFloat(r.discount_amt).toFixed(2)}` : r.discount_pct > 0 ? `-${r.discount_pct}%` : null,
        total: r.line_total,
        serial: r.serial_number,
        payment: r.orders?.order_payments?.[0]?.method,
        cashier: r.orders?.cashier_name,
        note: r.note,
        reason: null,
        by: null,
      }))
    },
  })

  const { data: receives = [], isLoading: lr } = useQuery({
    queryKey: ['hist-receives', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_receives')
        .select('*, suppliers(name)').eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(200)
      return (data||[]).map(r => ({
        _type: 'receive',
        date: r.created_at,
        invoice: null,
        customer: r.suppliers?.name || '—',
        qty: `+${r.qty}`,
        unit: p.unit,
        price: r.cost,
        discount: null,
        total: r.qty * (r.cost||0),
        serial: null,
        payment: null,
        cashier: null,
        note: r.notes,
        reason: 'Stock Receive',
        by: null,
      }))
    },
  })

  const { data: adjustments = [], isLoading: la } = useQuery({
    queryKey: ['hist-adjustments', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_adjustments')
        .select('*, users(name)').eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(200)
      return (data||[]).map(r => ({
        _type: 'adjust',
        date: r.created_at,
        invoice: null,
        customer: null,
        qty: `${r.qty_change>=0?'+':''}${r.qty_change}`,
        unit: p.unit,
        price: null,
        discount: null,
        total: null,
        serial: null,
        payment: null,
        cashier: null,
        note: null,
        reason: r.reason,
        by: r.users?.name || r.user_name,
      }))
    },
  })

  const TYPE_STYLE = {
    sale:    { bg:'#eff6ff', color:'#2563eb', label:'Sale',    dot:'#2563eb' },
    receive: { bg:'#f0fdf4', color:'#16a34a', label:'Receive', dot:'#16a34a' },
    adjust:  { bg:'#fffbeb', color:'#ca8a04', label:'Adjust',  dot:'#f59e0b' },
  }

  const all = [...sales, ...receives, ...adjustments]
    .sort((a,b) => new Date(b.date) - new Date(a.date))

  const displayed = filter === 'all' ? all : all.filter(r => r._type === filter)
  const isLoading = ls || lr || la

  const salesQty = sales.reduce((s,r) => s + (r.qty||0), 0)
  const salesRev = sales.reduce((s,r) => s + (r.total||0), 0)
  const recQty   = receives.reduce((s,r) => s + parseInt(r.qty||0), 0)
  const adjNet   = adjustments.reduce((s,r) => s + parseFloat(r.qty||0), 0)

  return (
    <div style={{background:'#f8fafc', borderTop:'2px solid #2563eb'}}>

      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b flex-wrap"
        style={{background:'#fff', borderColor:'#e2e8f0'}}>
        <div className="text-[13px] font-bold text-blue-700">🧾 Full History — {p.name}</div>
        <div className="flex gap-4 ml-2">
          {[
            ['Sales',    `${salesQty} ${p.unit} / $${salesRev.toFixed(2)}`, '#2563eb'],
            ['Received', `+${recQty} ${p.unit}`,  '#16a34a'],
            ['Adjusted', `${adjNet>=0?'+':''}${adjNet} ${p.unit}`, adjNet>=0?'#ca8a04':'#dc2626'],
          ].map(([l,v,c])=>(
            <div key={l} className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400">{l}:</span>
              <span className="text-[12px] font-bold" style={{color:c}}>{v}</span>
            </div>
          ))}
        </div>
        {/* Filter tabs */}
        <div className="flex gap-1.5 ml-auto">
          {[['all','All'],['sale','Sales'],['receive','Receiving'],['adjust','Adjustments']].map(([id,label])=>(
            <button key={id} onClick={()=>setFilter(id)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-semibold cursor-pointer border transition-all"
              style={filter===id
                ? {background:'#2563eb', borderColor:'#2563eb', color:'#fff'}
                : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
              {label}
              <span className="ml-1 text-[9px] opacity-70">
                ({id==='all'?all.length:id==='sale'?sales.length:id==='receive'?receives.length:adjustments.length})
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{maxHeight:'300px', overflowY:'auto'}}>
        {isLoading ? (
          <div className="text-center py-6 text-slate-400 text-[12px]">Loading...</div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-slate-300">
            <div className="text-3xl mb-2">📭</div>
            <div className="text-[12px]">No history yet</div>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr style={{background:'#f8fafc'}}>
                {['Type','Date & Time','Invoice / Ref','Party','Qty','Price','Total','Serial','Payment','Cashier / By','Reason / Note'].map(h=>(
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{color:'#64748b', borderBottom:'1px solid #e2e8f0'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((r,i) => {
                const ts = TYPE_STYLE[r._type]
                return (
                  <tr key={i} className="border-b hover:bg-blue-50/30 transition-colors"
                    style={{borderColor:'#f1f5f9'}}>
                    {/* Type */}
                    <td className="px-3 py-2.5">
                      <span className="text-[9px] font-bold px-2 py-1 rounded-full"
                        style={{background:ts.bg, color:ts.color}}>
                        ● {ts.label}
                      </span>
                    </td>
                    {/* Date */}
                    <td className="px-3 py-2.5">
                      <div className="text-[11px] font-medium text-slate-700">{new Date(r.date).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-400">{new Date(r.date).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
                    </td>
                    {/* Invoice */}
                    <td className="px-3 py-2.5">
                      {r.invoice
                        ? <span className="text-[11px] font-mono font-bold" style={{color:'#006AFF'}}>{r.invoice}</span>
                        : <span className="text-[11px] text-slate-300">—</span>}
                    </td>
                    {/* Party */}
                    <td className="px-3 py-2.5 text-[11px] text-slate-700">{r.customer||'—'}</td>
                    {/* Qty */}
                    <td className="px-3 py-2.5">
                      <span className="text-[12px] font-bold font-mono"
                        style={{color: String(r.qty).startsWith('-')?'#dc2626':String(r.qty).startsWith('+')?'#16a34a':'#1F1F1F'}}>
                        {r.qty} {r.unit}
                      </span>
                    </td>
                    {/* Price */}
                    <td className="px-3 py-2.5">
                      {r.price!=null
                        ? <span className="text-[11px] font-mono text-slate-600">${parseFloat(r.price).toFixed(2)}</span>
                        : <span className="text-[11px] text-slate-300">—</span>}
                    </td>
                    {/* Total */}
                    <td className="px-3 py-2.5">
                      {r.total!=null
                        ? <span className="text-[12px] font-bold font-mono" style={{color:r._type==='sale'?'#16a34a':'#006AFF'}}>${parseFloat(r.total).toFixed(2)}</span>
                        : <span className="text-[11px] text-slate-300">—</span>}
                    </td>
                    {/* Serial */}
                    <td className="px-3 py-2.5">
                      {r.serial
                        ? <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{background:'#fef9c3',color:'#ca8a04'}}>{r.serial}</span>
                        : <span className="text-[11px] text-slate-300">—</span>}
                    </td>
                    {/* Payment */}
                    <td className="px-3 py-2.5">
                      {r.payment
                        ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize" style={{background:'#eff6ff',color:'#2563eb'}}>{r.payment}</span>
                        : <span className="text-[11px] text-slate-300">—</span>}
                    </td>
                    {/* Cashier/By */}
                    <td className="px-3 py-2.5 text-[11px] text-slate-600">{r.cashier||r.by||'—'}</td>
                    {/* Reason/Note */}
                    <td className="px-3 py-2.5">
                      {(r.reason||r.note||r.discount)
                        ? <span className="text-[11px] text-slate-500">{r.reason||r.note||r.discount}</span>
                        : <span className="text-[11px] text-slate-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
