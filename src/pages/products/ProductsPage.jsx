// src/pages/products/ProductsPage.jsx
import React, { useState } from 'react'
import { ProductPhoto, PhotoViewer } from '@/components/ui/ProductPhoto'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { ProductForm } from './ProductForm'
import { ReceiveModal } from './ReceiveModal'
import { AdjustModal } from './AdjustModal'
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
  const [showReceive, setShowReceive] = useState(null)
  const [showAdjust, setShowAdjust]   = useState(null)
  const [expandedId, setExpandedId]   = useState(null)
  const [photoViewer, setPhotoViewer]   = useState(null)
  const [showPromo,    setShowPromo]     = useState(null)  // product for promo panel
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

  const getQty    = p  => p.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const getAvgCost = p => p.inventory?.[0]?.avg_cost || p.cost || 0
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
                  {['','Product','SKU','Type','Stock','Price','Margin','Actions'].map((h,i) => (
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

                      {/* Name */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="text-[13px] font-semibold">{p.name}</div>
                          {disabled && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">DISABLED</span>}
                        </div>
                        {p.tags?.length > 0 && (
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {p.tags.map(t => (
                              <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{t}</span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* SKU */}
                      <td className="px-3 py-2">
                        <div className="text-[11px] font-mono text-[#8899b0]">{p.sku || '—'}</div>
                        {cat && <div className="text-[9px] text-[#3d5068] mt-0.5">{cat}{sub ? ' › '+sub : ''}</div>}
                      </td>

                      {/* Type */}
                      <td className="px-3 py-2">
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                          style={{background:`${tc}18`,color:tc}}>
                          {p.type?.toUpperCase()}
                        </span>
                      </td>

                      {/* Stock */}
                      <td className="px-3 py-2">
                        {p.type === 'service'
                          ? <span className="text-[11px] text-[#3d5068]">—</span>
                          : <span className={`text-[12px] font-mono font-bold ${isLow?'text-red-400':''}`}>
                              {isLow && '⚠ '}{qty} {p.unit}
                            </span>
                        }
                      </td>

                      {/* Price */}
                      <td className="px-3 py-2">
                        <div className="text-[13px] font-bold font-mono text-blue-400">
                          ${parseFloat(p.price||0).toFixed(2)}
                        </div>
                        <div className="text-[10px] font-mono text-[#3d5068]">
                          cost ${parseFloat(avgCost).toFixed(2)}
                        </div>
                      </td>

                      {/* Margin */}
                      <td className="px-3 py-2">
                        <span className={`text-[12px] font-mono font-bold ${
                          margin>=30?'text-green-400':margin>=10?'text-yellow-400':'text-red-400'
                        }`}>{margin.toFixed(1)}%</span>
                      </td>

                      {/* Actions — ALWAYS VISIBLE */}
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          <button onClick={() => setExpandedId(expandedId===p.id ? null : p.id)}
                            className={`rounded px-2 py-1.5 text-[10px] cursor-pointer border transition-all whitespace-nowrap ${
                              expandedId===p.id
                                ? 'bg-blue-500/15 border-blue-500/40 text-blue-400'
                                : 'bg-[#111827] border border-[#1e2d42] text-[#8899b0] hover:text-white hover:border-[#243347]'
                            }`}>
                            📋 {expandedId===p.id ? 'Hide' : 'Detail'}
                          </button>
                          <button onClick={() => setShowReceive(p)}
                            className="bg-green-500/10 border border-green-500/20 rounded px-2 py-1.5 text-[10px] font-bold text-green-400 cursor-pointer hover:bg-green-500/15 transition-colors whitespace-nowrap">
                            + Receive
                          </button>
                          <button onClick={() => setShowAdjust(p)}
                            className="bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1.5 text-[10px] font-bold text-yellow-400 cursor-pointer hover:bg-yellow-500/15 transition-colors whitespace-nowrap">
                            Adjust
                          </button>
                          <button onClick={() => {setEditProduct(p); setShowForm(true)}}
                            className="bg-[#111827] border border-[#1e2d42] rounded px-2 py-1.5 text-[10px] text-[#8899b0] cursor-pointer hover:text-blue-400 hover:border-blue-500/30 transition-all">
                            Edit
                          </button>
                          <button onClick={() => handleDisable(p)}
                            className={`rounded px-2 py-1.5 text-[10px] font-bold cursor-pointer border transition-colors ${
                              disabled
                                ? 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/15'
                                : 'bg-orange-500/10 border-orange-500/20 text-orange-400 hover:bg-orange-500/15'
                            }`}>
                            {disabled ? '▶ Enable' : '⏸ Disable'}
                          </button>
                          <button onClick={() => handleDelete(p)}
                            className="bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5 text-[10px] font-bold text-red-400 cursor-pointer hover:bg-red-500/15 transition-colors">
                            🗑 Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === p.id && (
                      <tr key={p.id+'-detail'}>
                        <td colSpan={8} className="p-0 border-b border-[#1e2d42]">
                          <ProductDetailInline product={p} tenantId={tenant?.id}
                            onReceive={()=>setShowReceive(p)}
                            onAdjust={()=>setShowAdjust(p)}
                            onEdit={()=>{setEditProduct(p);setShowForm(true)}}/>
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
      {showPromo && (
        <PromoQuickPanel product={showPromo} tenantId={tenant?.id}
          onClose={() => setShowPromo(null)}/>
      )}

      {/* Modals */}
      {showForm && (
        <ProductForm initial={editProduct||{}} tenantId={tenant?.id}
          onSave={() => { qc.invalidateQueries(['products']); setShowForm(false); setEditProduct(null) }}
          onClose={() => { setShowForm(false); setEditProduct(null) }}/>
      )}
      {showReceive && (
        <ReceiveModal product={showReceive} tenantId={tenant?.id}
          onSave={() => { qc.invalidateQueries(['products']); setShowReceive(null) }}
          onClose={() => setShowReceive(null)}/>
      )}
      {showAdjust && (
        <AdjustModal product={showAdjust} tenantId={tenant?.id}
          onSave={() => { qc.invalidateQueries(['products']); setShowAdjust(null) }}
          onClose={() => setShowAdjust(null)}/>
      )}

    </div>
  )
}

// ── Product Detail Inline (expands inside table) ──
function ThCell({ h, children }) {
  return <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider"
    style={{color:'#64748b', background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>{h || children}</th>
}
function TdCell({ children, mono, bold, color }) {
  return <td className={`px-3 py-2.5 text-[12px] border-b ${mono?'font-mono':''} ${bold?'font-bold':''}`}
    style={{color: color||'#374151', borderColor:'#f1f5f9'}}>{children}</td>
}
function EmptyState({ msg }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
      <div className="text-3xl mb-2 opacity-30">📭</div>
      <div className="text-[12px]">{msg}</div>
    </div>
  )
}

function ProductDetailInline({ product: p, tenantId, onReceive, onAdjust, onEdit }) {
  const [tab, setTab] = useState('info')

  const { data: receives = [], isLoading: loadingR } = useQuery({
    queryKey: ['product-receives', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_receives')
        .select('*, suppliers(name)').eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab === 'receives',
  })
  const { data: adjustments = [], isLoading: loadingA } = useQuery({
    queryKey: ['product-adjustments', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_adjustments')
        .select('*').eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab === 'adjustments',
  })
  const { data: sales = [], isLoading: loadingS } = useQuery({
    queryKey: ['product-sales', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('order_items')
        .select('*, orders(order_number, created_at, customers(name))')
        .eq('product_id', p.id).order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab === 'sales',
  })
  const { data: serials = [] } = useQuery({
    queryKey: ['product-serials', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('serial_numbers')
        .select('*').eq('product_id', p.id).order('created_at', { ascending: false })
      return data || []
    },
    enabled: tab === 'serials' && p.has_serial,
  })

  const qty     = p.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const avgCost = p.inventory?.[0]?.avg_cost || p.cost || 0
  const margin  = p.price > 0 ? ((p.price - avgCost) / p.price * 100).toFixed(1) : '0.0'

  // Inventory movement summary
  const totalReceived  = receives.reduce((s,r) => s + (r.qty||0), 0)
  const totalAdjusted  = adjustments.reduce((s,r) => s + (r.qty_change||0), 0)
  const totalSold      = sales.reduce((s,r) => s + (r.quantity||0), 0)

  const TABS = [
    { id:'info',        label:'Info',         icon:'📋' },
    { id:'receives',    label:'Receiving',    icon:'📥', count: receives.length },
    { id:'adjustments', label:'Adjustments',  icon:'⚖️', count: adjustments.length },
    { id:'sales',       label:'Sales',        icon:'💰', count: sales.length },
    ...(p.has_serial ? [{ id:'serials', label:'Serials', icon:'🔢', count: serials.length }] : []),
  ]



  return (
    <div className="animate-fadeIn" style={{background:'#f8fafc', borderTop:'2px solid #6366f1'}}>

      {/* Tab bar */}
      <div className="flex items-center px-4" style={{background:'#fff', borderBottom:'1px solid #e2e8f0'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 py-2.5 px-3 text-[12px] border-b-2 transition-all cursor-pointer bg-transparent whitespace-nowrap"
            style={{
              borderBottomColor: tab===t.id ? '#6366f1' : 'transparent',
              color: tab===t.id ? '#6366f1' : '#64748b',
              fontWeight: tab===t.id ? 600 : 400,
            }}>
            {t.icon} {t.label}
            {t.count > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px]"
                style={{background: tab===t.id ? '#e0e7ff' : '#f1f5f9', color: tab===t.id ? '#6366f1' : '#94a3b8'}}>
                {t.count}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1"/>
        {/* Inventory summary pills */}
        {tab !== 'info' && (
          <div className="flex gap-2 mr-2">
            <span className="text-[11px] px-2.5 py-1 rounded-full font-medium"
              style={{background:'#dcfce7', color:'#16a34a'}}>
              In Stock: {qty} {p.unit}
            </span>
          </div>
        )}
        <div className="flex gap-1.5 py-1.5">
          <button onClick={onReceive}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border transition-all"
            style={{background:'#dcfce7', border:'1px solid #86efac', color:'#16a34a'}}>
            + Receive
          </button>
          <button onClick={onAdjust}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border transition-all"
            style={{background:'#fef9c3', border:'1px solid #fde047', color:'#ca8a04'}}>
            Adjust
          </button>
          <button onClick={onEdit}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border transition-all"
            style={{background:'#e0e7ff', border:'1px solid #a5b4fc', color:'#6366f1'}}>
            Edit
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="p-4 overflow-y-auto" style={{maxHeight:'340px'}}>

        {/* ── INFO ── */}
        {tab === 'info' && (
          <div className="grid gap-3" style={{gridTemplateColumns:'repeat(4,1fr)'}}>

            {/* Product Info */}
            <InfoCard title="Product Info">
              {[
                ['Name',        p.name],
                ['Type',        p.type?.toUpperCase()],
                ['Unit',        p.unit || 'ea'],
                ['SKU',         p.sku  || '—'],
                ['UPC',         p.upc  || '—'],
                ['Category',    p.subcategories?.categories?.name || '—'],
                ['Subcategory', p.subcategories?.name || '—'],
                ['Description', p.description || '—'],
                ['Tags',        p.tags?.length ? p.tags.join(', ') : '—'],
              ].map(([l,v]) => <InfoRow key={l} label={l} value={v}/>)}
            </InfoCard>

            {/* Pricing */}
            <InfoCard title="Pricing & Inventory">
              {[
                ['Sell Price',  `$${parseFloat(p.price||0).toFixed(2)}`],
                ['Cost Price',  `$${parseFloat(p.cost||0).toFixed(2)}`],
                ['Avg Cost',    `$${parseFloat(avgCost).toFixed(2)}`],
                ['Margin',      `${margin}%`],
                ['In Stock',    p.type==='service' ? '—' : `${qty} ${p.unit||'ea'}`],
              ].map(([l,v]) => <InfoRow key={l} label={l} value={v}/>)}
              <div className="mt-2 pt-2" style={{borderTop:'1px solid #f1f5f9'}}>
                {[
                  ['VIP Discount',  p.allow_vip ? 'Yes' : 'No'],
                  ['VIP Price',     p.vip_price ? `$${parseFloat(p.vip_price).toFixed(2)}` : 'Use % discount'],
                  ['Redeem Points', p.points_redeemable ? 'Yes' : 'No'],
                ].map(([l,v]) => <InfoRow key={l} label={l} value={v}/>)}
              </div>
            </InfoCard>

            {/* Points & Commission */}
            <InfoCard title="Points & Commission">
              {[
                ['Points Mode',   p.points_mode === 'fixed' ? 'Fixed' : '$ → Points'],
                ['Points Value',  p.points_mode === 'fixed'
                  ? `${p.points_fixed || 0} pts/purchase`
                  : `$1 = ${p.points_rate || 1} pts`],
                ['Commission',    p.commission_type === 'none' ? 'None' : p.commission_type],
                ['Comm. Value',   p.commission_type !== 'none'
                  ? `${p.commission_type === 'fixed' ? '$' : ''}${p.commission_value || 0}${p.commission_type !== 'fixed' ? '%' : ''}`
                  : '—'],
              ].map(([l,v]) => <InfoRow key={l} label={l} value={v}/>)}
            </InfoCard>

            {/* Settings */}
            <InfoCard title="Checkout Settings">
              {[
                ['Prompt Weight',  p.prompt_weight  ? '✅ Yes' : '✗ No'],
                ['Prompt Price',   p.prompt_price   ? '✅ Yes' : '✗ No'],
                ['Prompt Staff',   p.prompt_sales   ? '✅ Yes' : '✗ No'],
                ['Serial Numbers', p.has_serial     ? '✅ Yes' : '✗ No'],
                ['Track Inventory',p.track_inventory ? '✅ Yes' : '✗ No'],
              ].map(([l,v]) => <InfoRow key={l} label={l} value={v}/>)}
            </InfoCard>
          </div>
        )}

        {/* ── RECEIVING ── */}
        {tab === 'receives' && (
          <>
            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[
                ['Total Received', `${totalReceived} ${p.unit}`, '#16a34a'],
                ['Current Stock',  `${qty} ${p.unit}`,           qty<=5?'#dc2626':'#1e293b'],
                ['Avg Cost',       `$${parseFloat(avgCost).toFixed(2)}`, '#6366f1'],
              ].map(([l,v,c]) => (
                <div key={l} className="rounded-xl p-3 text-center"
                  style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {loadingR ? <Loading/> : receives.length === 0 ? <EmptyState msg="No receiving history yet"/> : (
              <table className="w-full border-collapse rounded-xl overflow-hidden"
                style={{border:'1px solid #e2e8f0'}}>
                <thead><tr>{['Date','Vendor','Qty','Cost/Unit','Total Cost','Notes'].map(h=><ThCell key={h} h={h}/>)}</tr></thead>
                <tbody>{receives.map((r,i)=>(
                  <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                    <TdCell>{new Date(r.created_at).toLocaleDateString()}</TdCell>
                    <TdCell>{r.suppliers?.name||<span className="text-slate-400">—</span>}</TdCell>
                    <TdCell mono bold color="#16a34a">+{r.qty} {p.unit}</TdCell>
                    <TdCell mono>${parseFloat(r.cost||0).toFixed(2)}</TdCell>
                    <TdCell mono bold color="#6366f1">${(r.qty*(r.cost||0)).toFixed(2)}</TdCell>
                    <TdCell color="#94a3b8">{r.notes||'—'}</TdCell>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </>
        )}

        {/* ── ADJUSTMENTS ── */}
        {tab === 'adjustments' && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[
                ['Total Adjustments', totalAdjusted >= 0 ? `+${totalAdjusted}` : totalAdjusted, totalAdjusted>=0?'#16a34a':'#dc2626'],
                ['Current Stock',     `${qty} ${p.unit}`, qty<=5?'#dc2626':'#1e293b'],
                ['Adj. Count',        adjustments.length, '#6366f1'],
              ].map(([l,v,c]) => (
                <div key={l} className="rounded-xl p-3 text-center"
                  style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {loadingA ? <Loading/> : adjustments.length === 0 ? <EmptyState msg="No adjustments yet"/> : (
              <table className="w-full border-collapse rounded-xl overflow-hidden"
                style={{border:'1px solid #e2e8f0'}}>
                <thead><tr>{['Date','Change','Before','After','Reason'].map(h=><ThCell key={h} h={h}/>)}</tr></thead>
                <tbody>{adjustments.map((r,i)=>(
                  <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                    <TdCell>{new Date(r.created_at).toLocaleDateString()}</TdCell>
                    <TdCell mono bold color={r.qty_change>=0?'#16a34a':'#dc2626'}>
                      {r.qty_change>=0?'+':''}{r.qty_change} {p.unit}
                    </TdCell>
                    <TdCell mono color="#94a3b8">{r.qty_before}</TdCell>
                    <TdCell mono bold>{r.qty_after}</TdCell>
                    <TdCell>{r.reason}</TdCell>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </>
        )}

        {/* ── SALES ── */}
        {tab === 'sales' && (
          <>
            <div className="grid grid-cols-4 gap-3 mb-3">
              {[
                ['Total Sold',   `${totalSold} ${p.unit}`,       '#6366f1'],
                ['Revenue',      `$${sales.reduce((s,r)=>s+(r.line_total||0),0).toFixed(2)}`, '#16a34a'],
                ['Transactions', sales.length,                    '#1e293b'],
                ['In Stock',     `${qty} ${p.unit}`,              qty<=5?'#dc2626':'#1e293b'],
              ].map(([l,v,c]) => (
                <div key={l} className="rounded-xl p-3 text-center"
                  style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {loadingS ? <Loading/> : sales.length === 0 ? <EmptyState msg="No sales yet"/> : (
              <table className="w-full border-collapse rounded-xl overflow-hidden"
                style={{border:'1px solid #e2e8f0'}}>
                <thead><tr>{['Date','Order #','Customer','Qty','Unit Price','Line Total'].map(h=><ThCell key={h} h={h}/>)}</tr></thead>
                <tbody>{sales.map((r,i)=>(
                  <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                    <TdCell>{new Date(r.orders?.created_at).toLocaleDateString()}</TdCell>
                    <TdCell mono color="#6366f1">{r.orders?.order_number||'—'}</TdCell>
                    <TdCell>{r.orders?.customers?.name||'Walk-in'}</TdCell>
                    <TdCell mono bold>{r.quantity} {p.unit}</TdCell>
                    <TdCell mono>${parseFloat(r.unit_price||0).toFixed(2)}</TdCell>
                    <TdCell mono bold color="#16a34a">${parseFloat(r.line_total||0).toFixed(2)}</TdCell>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </>
        )}

        {/* ── SERIALS ── */}
        {tab === 'serials' && (
          serials.length === 0 ? <EmptyState msg="No serial numbers recorded"/> : (
            <table className="w-full border-collapse rounded-xl overflow-hidden"
              style={{border:'1px solid #e2e8f0'}}>
              <thead><tr>{['Serial Number','Status','Date Added'].map(h=><ThCell key={h} h={h}/>)}</tr></thead>
              <tbody>{serials.map((sn,i) => {
                const sc = {
                  in_stock: {bg:'#dcfce7',color:'#16a34a'},
                  sold:     {bg:'#dbeafe',color:'#2563eb'},
                  returned: {bg:'#fef9c3',color:'#ca8a04'},
                  damaged:  {bg:'#fee2e2',color:'#dc2626'},
                }[sn.status]||{bg:'#f1f5f9',color:'#64748b'}
                return (
                  <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                    <TdCell mono bold>{sn.serial}</TdCell>
                    <TdCell>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{background:sc.bg,color:sc.color}}>
                        {sn.status?.replace('_',' ').toUpperCase()}
                      </span>
                    </TdCell>
                    <TdCell color="#94a3b8">{new Date(sn.created_at).toLocaleDateString()}</TdCell>
                  </tr>
                )
              })}</tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}

function InfoCard({ title, children }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
        style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9', color:'#64748b'}}>
        {title}
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  )
}
function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-start py-1" style={{borderBottom:'1px solid #f8fafc'}}>
      <span className="text-[11px] text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-[11px] font-semibold text-right ml-2 text-slate-700">{value}</span>
    </div>
  )
}
function Loading() {
  return (
    <div className="flex items-center justify-center py-8 text-slate-400">
      <div className="text-[12px]">Loading...</div>
    </div>
  )
}


// ── Product Detail Modal (with tabs) ──
function ProductDetailModal({ product: p, tenantId, onClose, onEdit, onReceive, onAdjust }) {
  const [tab, setTab] = useState('info')

  const { data: receives = [] } = useQuery({
    queryKey: ['product-receives', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_receives')
        .select('*, suppliers(name), users(name)')
        .eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab === 'receives',
  })

  const { data: adjustments = [] } = useQuery({
    queryKey: ['product-adjustments', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_adjustments')
        .select('*, users(name)')
        .eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab === 'adjustments',
  })

  const { data: sales = [] } = useQuery({
    queryKey: ['product-sales', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('order_items')
        .select('*, orders(order_number, created_at, customers(name))')
        .eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab === 'sales',
  })

  const { data: serials = [] } = useQuery({
    queryKey: ['product-serials', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('serial_numbers')
        .select('*').eq('product_id', p.id).order('created_at', { ascending: false })
      return data || []
    },
    enabled: tab === 'serials' && p.has_serial,
  })

  const qty      = p.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const avgCost  = p.inventory?.[0]?.avg_cost || p.cost || 0
  const margin   = p.price > 0 ? ((p.price - avgCost) / p.price * 100) : 0

  const TABS = [
    { id:'info',        label:'Info' },
    { id:'receives',    label:'Receiving History' },
    { id:'adjustments', label:'Adjustments' },
    { id:'sales',       label:'Sales History' },
    ...(p.has_serial ? [{ id:'serials', label:'Serial Numbers' }] : []),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(15,23,42,0.55)', backdropFilter:'blur(6px)'}} onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[680px] max-h-[90vh] flex flex-col" onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1e2d42] flex items-start gap-3 flex-shrink-0">
          <div className="w-12 h-12 rounded-[10px] bg-[#111827] border border-[#1e2d42] flex items-center justify-center overflow-hidden flex-shrink-0">
            {p.image_url
              ? <img src={p.image_url} alt="" className="w-full h-full object-cover"/>
              : <span className="text-[22px]">{p.emoji||'📦'}</span>
            }
          </div>
          <div className="flex-1">
            <div className="text-[16px] font-bold">{p.name}</div>
            <div className="text-[11px] font-mono text-[#3d5068] mt-0.5">
              {p.sku && `SKU: ${p.sku}`}{p.sku && p.upc && ' · '}{p.upc && `UPC: ${p.upc}`}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={onReceive}
              className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-1.5 text-[11px] font-bold text-green-400 cursor-pointer">
              + Receive
            </button>
            <button onClick={onAdjust}
              className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-1.5 text-[11px] font-bold text-yellow-400 cursor-pointer">
              Adjust
            </button>
            <button onClick={onEdit}
              className="bg-blue-500 border-none rounded-lg px-3 py-1.5 text-[11px] font-bold text-white cursor-pointer">
              Edit
            </button>
            <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 border-b border-[#1e2d42] flex-shrink-0">
          {[
            ['Price',    `$${parseFloat(p.price||0).toFixed(2)}`,  'text-blue-400'],
            ['Avg Cost', `$${parseFloat(avgCost).toFixed(2)}`,     'text-[#8899b0]'],
            ['Margin',   `${margin.toFixed(1)}%`,                   margin>=30?'text-green-400':margin>=10?'text-yellow-400':'text-red-400'],
            ['In Stock', p.type==='service' ? '—' : `${qty} ${p.unit}`, qty<=5&&p.type!=='service'?'text-red-400':'text-[#e8edf5]'],
          ].map(([l,v,c]) => (
            <div key={l} className="px-4 py-3 border-r border-[#1e2d42] last:border-0 bg-[#0d1117]">
              <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-wider mb-1">{l}</div>
              <div className={`text-[16px] font-bold ${c}`}>{v}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#1e2d42] flex-shrink-0 px-4">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`py-2.5 px-3 text-[12px] border-b-2 transition-all cursor-pointer bg-transparent ${
                tab===t.id ? 'text-blue-400 border-blue-400' : 'text-[#8899b0] border-transparent hover:text-white'
              }`}>{t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4">

          {tab === 'info' && (
            <div className="grid grid-cols-2 gap-3">
              <InfoBox title="Product Details">
                {[
                  ['Name',        p.name],
                  ['Type',        p.type?.toUpperCase()],
                  ['Unit',        p.unit],
                  ['Description', p.description || '—'],
                ].map(([l,v]) => <IRow key={l} label={l} value={v}/>)}
              </InfoBox>
              <InfoBox title="Pricing">
                {[
                  ['Sell Price',  `$${parseFloat(p.price||0).toFixed(2)}`],
                  ['Cost',        `$${parseFloat(p.cost||0).toFixed(2)}`],
                  ['Avg Cost',    `$${parseFloat(avgCost).toFixed(2)}`],
                  ['VIP Allowed', p.allow_vip ? 'Yes' : 'No'],
                  ['VIP Price',   p.vip_price ? `$${p.vip_price.toFixed(2)}` : 'Use % discount'],
                ].map(([l,v]) => <IRow key={l} label={l} value={v}/>)}
              </InfoBox>
              <InfoBox title="Settings">
                {[
                  ['Prompt Weight', p.prompt_weight ? '✅ Yes' : '—'],
                  ['Prompt Price',  p.prompt_price  ? '✅ Yes' : '—'],
                  ['Serial Track',  p.has_serial    ? '✅ Yes' : '—'],
                  ['Points Mode',   p.points_mode === 'fixed' ? `Fixed: ${p.points_fixed} pts` : `$1 = ${p.points_rate} pts`],
                ].map(([l,v]) => <IRow key={l} label={l} value={v}/>)}
              </InfoBox>
              <InfoBox title="Tags">
                {p.tags?.length > 0
                  ? <div className="flex flex-wrap gap-1.5">{p.tags.map(t => (
                      <span key={t} className="bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] px-2.5 py-0.5 rounded-full">{t}</span>
                    ))}</div>
                  : <span className="text-[12px] text-[#3d5068]">No tags</span>
                }
              </InfoBox>
            </div>
          )}

          {tab === 'receives' && (
            <HistoryTable
              data={receives}
              empty="No receiving history"
              columns={['Date','Vendor','Qty','Cost/Unit','Total','Note']}
              renderRow={r => [
                new Date(r.created_at).toLocaleDateString(),
                r.suppliers?.name || '—',
                `${r.qty} ${p.unit}`,
                `$${parseFloat(r.cost||0).toFixed(2)}`,
                `$${(r.qty * r.cost).toFixed(2)}`,
                r.notes || '—',
              ]}
            />
          )}

          {tab === 'adjustments' && (
            <HistoryTable
              data={adjustments}
              empty="No adjustment history"
              columns={['Date','Change','Before','After','Reason','By']}
              renderRow={r => [
                new Date(r.created_at).toLocaleDateString(),
                <span className={r.qty_change >= 0 ? 'text-green-400 font-mono font-bold' : 'text-red-400 font-mono font-bold'}>
                  {r.qty_change >= 0 ? '+' : ''}{r.qty_change}
                </span>,
                r.qty_before,
                r.qty_after,
                r.reason,
                r.users?.name || '—',
              ]}
            />
          )}

          {tab === 'sales' && (
            <HistoryTable
              data={sales}
              empty="No sales history"
              columns={['Date','Order','Customer','Qty','Unit Price','Total']}
              renderRow={r => [
                new Date(r.orders?.created_at).toLocaleDateString(),
                r.orders?.order_number || '—',
                r.orders?.customers?.name || 'Walk-in',
                r.quantity,
                `$${parseFloat(r.unit_price||0).toFixed(2)}`,
                `$${parseFloat(r.line_total||0).toFixed(2)}`,
              ]}
            />
          )}

          {tab === 'serials' && (
            <div>
              <div className="flex gap-2 mb-3">
                {['all','in_stock','sold','returned','damaged'].map(s => (
                  <button key={s}
                    className="px-2.5 py-1 rounded text-[10px] font-mono border border-[#1e2d42] bg-[#111827] text-[#8899b0] hover:text-white cursor-pointer transition-colors">
                    {s.replace('_',' ').toUpperCase()} ({serials.filter(sn=>s==='all'||sn.status===s).length})
                  </button>
                ))}
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0'}}>
                    {['Serial Number','Status','Added'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-mono text-[10px] text-[#3d5068] uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {serials.map(sn => {
                    const sc = {in_stock:{c:'#10b981',bg:'rgba(16,185,129,.1)'},sold:{c:'#3b82f6',bg:'rgba(59,130,246,.1)'},returned:{c:'#f59e0b',bg:'rgba(245,158,11,.1)'},damaged:{c:'#ef4444',bg:'rgba(239,68,68,.1)'}}[sn.status]||{c:'#8899b0',bg:'rgba(136,153,176,.1)'}
                    return (
                      <tr key={sn.id} className="border-b border-[#1e2d42] hover:bg-[#0d1117]">
                        <td className="px-3 py-2.5 font-mono text-[12px] font-bold">{sn.serial}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded" style={{background:sc.bg,color:sc.c}}>
                            {sn.status?.replace('_',' ').toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-[#3d5068]">
                          {new Date(sn.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoBox({ title, children }) {
  return (
    <div className="bg-[#0d1117] border border-[#1e2d42] rounded-[11px] p-4">
      <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  )
}
function IRow({ label, value }) {
  return (
    <div className="flex justify-between mb-2 last:mb-0">
      <span className="text-[11px] text-[#3d5068]">{label}</span>
      <span className="text-[12px] font-semibold text-right max-w-[55%]">{value}</span>
    </div>
  )
}
function HistoryTable({ data, empty, columns, renderRow }) {
  if (!data.length) return (
    <div className="flex flex-col items-center justify-center py-12 text-[#3d5068]">
      <div className="text-3xl mb-2 opacity-20">📋</div>
      <div className="text-[13px]">{empty}</div>
    </div>
  )
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr style={{background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0'}}>
          {columns.map(h => (
            <th key={h} className="px-3 py-2 text-left font-mono text-[10px] text-[#3d5068] uppercase tracking-wider">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i} className="border-b border-[#1e2d42] hover:bg-[#0d1117]">
            {renderRow(row).map((cell, j) => (
              <td key={j} className="px-3 py-2.5 text-[12px]">{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Receive Inventory Modal ──


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
