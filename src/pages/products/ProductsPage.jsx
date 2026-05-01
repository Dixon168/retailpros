// src/pages/products/ProductsPage.jsx
import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { ProductForm } from './ProductForm'
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

  const { data: allCategories = [] } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('id, name, emoji').eq('tenant_id', tenant.id).order('sort_order')
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
      <div className="w-[180px] bg-[#0d1117] border-r border-[#1e2d42] p-3 flex-shrink-0">
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
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#1e2d42] bg-[#0d1117] flex-shrink-0">
          <div className="flex gap-4 mr-2">
            {[
              ['Products', products.length, ''],
              ['Low Stock', lowStock, 'text-red-400'],
              ['Value', '$'+products.reduce((s,p)=>{const q=getQty(p);return s+q*getAvgCost(p)},0).toFixed(0), 'text-green-400'],
            ].map(([l,v,c]) => (
              <div key={l}>
                <div className="text-[9px] font-mono text-[#3d5068] uppercase">{l}</div>
                <div className={`text-[17px] font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 flex-1 focus-within:border-blue-500/40 transition-colors">
            <span className="text-[#3d5068]">🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search name, SKU, UPC, tag..."
              className="bg-transparent border-none outline-none text-[#e8edf5] text-[12px] py-2 flex-1 placeholder-[#3d5068]"/>
          </div>
          {/* Category filter */}
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}
            className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 text-[12px] text-[#e8edf5] outline-none focus:border-blue-500/40 flex-shrink-0">
            <option value="">All Categories</option>
            {allCategories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
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
        <div className="flex-1 overflow-auto">
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
                <tr className="bg-[#111827] border-b border-[#1e2d42]">
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
                    <tr className={`border-b border-[#1e2d42] transition-colors ${disabled ? 'opacity-50' : 'hover:bg-[#0d1117]'}`}>
                      {/* Image/Emoji */}
                      <td className="px-3 py-2 w-10">
                        <div className="w-9 h-9 rounded-[8px] bg-[#111827] border border-[#1e2d42] flex items-center justify-center overflow-hidden flex-shrink-0">
                          {p.image_url
                            ? <img src={p.image_url} alt="" className="w-full h-full object-cover"/>
                            : <span className="text-[17px]">{p.emoji||'📦'}</span>
                          }
                        </div>
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
function ProductDetailInline({ product: p, tenantId, onReceive, onAdjust, onEdit }) {
  const [tab, setTab] = useState('info')

  const { data: receives = [] } = useQuery({
    queryKey: ['product-receives', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_receives')
        .select('*, suppliers(name)')
        .eq('product_id', p.id).order('created_at', { ascending: false }).limit(30)
      return data || []
    },
    enabled: tab === 'receives',
  })
  const { data: adjustments = [] } = useQuery({
    queryKey: ['product-adjustments', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_adjustments')
        .select('*').eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(30)
      return data || []
    },
    enabled: tab === 'adjustments',
  })
  const { data: sales = [] } = useQuery({
    queryKey: ['product-sales', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('order_items')
        .select('*, orders(order_number, created_at, customers(name))')
        .eq('product_id', p.id).order('created_at', { ascending: false }).limit(30)
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

  const TABS = [
    { id:'info',        label:'📋 Info' },
    { id:'receives',    label:'📥 Receiving' },
    { id:'adjustments', label:'⚖️ Adjustments' },
    { id:'sales',       label:'💰 Sales History' },
    ...(p.has_serial ? [{ id:'serials', label:'🔢 Serials' }] : []),
  ]

  return (
    <div className="bg-[#07090f] border-t border-blue-500/20">
      {/* Tab bar */}
      <div className="flex items-center border-b border-[#1e2d42] px-4 bg-[#0d1117]">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`py-2.5 px-3 text-[11px] border-b-2 transition-all cursor-pointer bg-transparent whitespace-nowrap ${
              tab===t.id ? 'text-blue-400 border-blue-500' : 'text-[#3d5068] border-transparent hover:text-[#8899b0]'
            }`}>{t.label}
          </button>
        ))}
        <div className="flex-1"/>
        <div className="flex gap-1.5 py-2">
          <button onClick={onReceive} className="bg-green-500/10 border border-green-500/20 rounded px-2.5 py-1 text-[10px] font-bold text-green-400 cursor-pointer hover:bg-green-500/15">+ Receive</button>
          <button onClick={onAdjust} className="bg-yellow-500/10 border border-yellow-500/20 rounded px-2.5 py-1 text-[10px] font-bold text-yellow-400 cursor-pointer hover:bg-yellow-500/15">Adjust</button>
          <button onClick={onEdit} className="bg-blue-500/10 border border-blue-500/20 rounded px-2.5 py-1 text-[10px] font-bold text-blue-400 cursor-pointer hover:bg-blue-500/15">Edit</button>
        </div>
      </div>

      {/* Tab content */}
      <div className="p-4 max-h-[320px] overflow-y-auto">

        {tab === 'info' && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#0d1117] border border-[#1e2d42] rounded-[10px] p-3">
              <div className="text-[9px] font-mono text-[#3d5068] uppercase mb-2">Product Info</div>
              {[['Type',p.type?.toUpperCase()],['Unit',p.unit],['SKU',p.sku||'—'],['UPC',p.upc||'—'],['Description',p.description||'—']].map(([l,v])=>(
                <div key={l} className="flex justify-between mb-1.5 last:mb-0">
                  <span className="text-[10px] text-[#3d5068]">{l}</span>
                  <span className="text-[11px] font-semibold text-right max-w-[55%] truncate">{v}</span>
                </div>
              ))}
            </div>
            <div className="bg-[#0d1117] border border-[#1e2d42] rounded-[10px] p-3">
              <div className="text-[9px] font-mono text-[#3d5068] uppercase mb-2">Pricing</div>
              {[['Price',`$${parseFloat(p.price||0).toFixed(2)}`],['Cost',`$${parseFloat(p.cost||0).toFixed(2)}`],['Avg Cost',`$${parseFloat(p.inventory?.[0]?.avg_cost||p.cost||0).toFixed(2)}`],['Margin',`${p.price>0?((p.price-(p.inventory?.[0]?.avg_cost||p.cost||0))/p.price*100).toFixed(1):0}%`],['VIP',p.allow_vip?(p.vip_price?`$${p.vip_price}`:'% discount'):'No']].map(([l,v])=>(
                <div key={l} className="flex justify-between mb-1.5 last:mb-0">
                  <span className="text-[10px] text-[#3d5068]">{l}</span>
                  <span className="text-[11px] font-semibold">{v}</span>
                </div>
              ))}
            </div>
            <div className="bg-[#0d1117] border border-[#1e2d42] rounded-[10px] p-3">
              <div className="text-[9px] font-mono text-[#3d5068] uppercase mb-2">Settings</div>
              {[['Prompt Weight',p.prompt_weight?'✅':'—'],['Prompt Price',p.prompt_price?'✅':'—'],['Serial Track',p.has_serial?'✅':'—'],['Points',p.points_mode==='fixed'?`${p.points_fixed} pts fixed`:`$1=${p.points_rate}pts`]].map(([l,v])=>(
                <div key={l} className="flex justify-between mb-1.5 last:mb-0">
                  <span className="text-[10px] text-[#3d5068]">{l}</span>
                  <span className="text-[11px] font-semibold">{v}</span>
                </div>
              ))}
              {p.tags?.length>0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.tags.map(t=><span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{t}</span>)}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'receives' && (
          receives.length === 0
            ? <div className="text-center py-8 text-[#3d5068] text-[12px]">No receiving history</div>
            : <table className="w-full border-collapse">
                <thead><tr className="bg-[#111827]">{['Date','Vendor','Qty','Cost/Unit','Total','Notes'].map(h=><th key={h} className="px-3 py-2 text-left font-mono text-[9px] text-[#3d5068] uppercase">{h}</th>)}</tr></thead>
                <tbody>{receives.map((r,i)=>(
                  <tr key={i} className="border-b border-[#1e2d42] hover:bg-[#0d1117]">
                    <td className="px-3 py-2 text-[11px]">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-[11px]">{r.suppliers?.name||'—'}</td>
                    <td className="px-3 py-2 text-[11px] font-mono text-green-400">+{r.qty} {p.unit}</td>
                    <td className="px-3 py-2 text-[11px] font-mono">${parseFloat(r.cost||0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-[11px] font-mono text-blue-400">${(r.qty*r.cost).toFixed(2)}</td>
                    <td className="px-3 py-2 text-[11px] text-[#3d5068]">{r.notes||'—'}</td>
                  </tr>
                ))}</tbody>
              </table>
        )}

        {tab === 'adjustments' && (
          adjustments.length === 0
            ? <div className="text-center py-8 text-[#3d5068] text-[12px]">No adjustment history</div>
            : <table className="w-full border-collapse">
                <thead><tr className="bg-[#111827]">{['Date','Change','Before','After','Reason'].map(h=><th key={h} className="px-3 py-2 text-left font-mono text-[9px] text-[#3d5068] uppercase">{h}</th>)}</tr></thead>
                <tbody>{adjustments.map((r,i)=>(
                  <tr key={i} className="border-b border-[#1e2d42] hover:bg-[#0d1117]">
                    <td className="px-3 py-2 text-[11px]">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 font-mono text-[12px] font-bold">
                      <span className={r.qty_change>=0?'text-green-400':'text-red-400'}>{r.qty_change>=0?'+':''}{r.qty_change}</span>
                    </td>
                    <td className="px-3 py-2 text-[11px] font-mono">{r.qty_before}</td>
                    <td className="px-3 py-2 text-[11px] font-mono">{r.qty_after}</td>
                    <td className="px-3 py-2 text-[11px] text-[#8899b0]">{r.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
        )}

        {tab === 'sales' && (
          sales.length === 0
            ? <div className="text-center py-8 text-[#3d5068] text-[12px]">No sales history yet</div>
            : <table className="w-full border-collapse">
                <thead><tr className="bg-[#111827]">{['Date','Order #','Customer','Qty','Price','Total'].map(h=><th key={h} className="px-3 py-2 text-left font-mono text-[9px] text-[#3d5068] uppercase">{h}</th>)}</tr></thead>
                <tbody>{sales.map((r,i)=>(
                  <tr key={i} className="border-b border-[#1e2d42] hover:bg-[#0d1117]">
                    <td className="px-3 py-2 text-[11px]">{new Date(r.orders?.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-[11px] font-mono text-blue-400">{r.orders?.order_number||'—'}</td>
                    <td className="px-3 py-2 text-[11px]">{r.orders?.customers?.name||'Walk-in'}</td>
                    <td className="px-3 py-2 text-[11px] font-mono">{r.quantity} {p.unit}</td>
                    <td className="px-3 py-2 text-[11px] font-mono">${parseFloat(r.unit_price||0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-[11px] font-mono text-green-400">${parseFloat(r.line_total||0).toFixed(2)}</td>
                  </tr>
                ))}</tbody>
              </table>
        )}

        {tab === 'serials' && (
          serials.length === 0
            ? <div className="text-center py-8 text-[#3d5068] text-[12px]">No serial numbers recorded</div>
            : <table className="w-full border-collapse">
                <thead><tr className="bg-[#111827]">{['Serial Number','Status','Date Added'].map(h=><th key={h} className="px-3 py-2 text-left font-mono text-[9px] text-[#3d5068] uppercase">{h}</th>)}</tr></thead>
                <tbody>{serials.map((sn,i)=>{
                  const sc={in_stock:{c:'#10b981',bg:'rgba(16,185,129,.1)'},sold:{c:'#3b82f6',bg:'rgba(59,130,246,.1)'},returned:{c:'#f59e0b',bg:'rgba(245,158,11,.1)'},damaged:{c:'#ef4444',bg:'rgba(239,68,68,.1)'}}[sn.status]||{c:'#8899b0',bg:'rgba(136,153,176,.1)'}
                  return (
                    <tr key={i} className="border-b border-[#1e2d42] hover:bg-[#0d1117]">
                      <td className="px-3 py-2 font-mono text-[12px] font-bold">{sn.serial}</td>
                      <td className="px-3 py-2"><span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded" style={{background:sc.bg,color:sc.c}}>{sn.status?.replace('_',' ').toUpperCase()}</span></td>
                      <td className="px-3 py-2 text-[11px] text-[#3d5068]">{new Date(sn.created_at).toLocaleDateString()}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
        )}
      </div>
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
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
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
                  <tr className="bg-[#111827] border-b border-[#1e2d42]">
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
        <tr className="bg-[#111827] border-b border-[#1e2d42]">
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
function ReceiveModal({ product: p, tenantId, onSave, onClose }) {
  const [form, setForm] = useState({ vendor_id:'', cost:'', qty:'', notes:'' })
  const [serials, setSerials]     = useState([])
  const [serialInput, setSerialInput] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(prev=>({...prev,[k]:v}))

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('id,name')
        .eq('tenant_id', tenantId).eq('is_active', true).order('name')
      return data || []
    },
    enabled: !!tenantId,
  })

  const needsSerials   = p.has_serial || p.type === 'serialized'
  const qty            = parseInt(form.qty) || 0
  const serialsComplete = !needsSerials || serials.length === qty

  const addSerial = () => {
    const s = serialInput.trim().toUpperCase()
    if (!s) return
    if (serials.includes(s)) { toast.error('Duplicate serial number'); return }
    if (serials.length >= qty) { toast.error('Already entered all serial numbers'); return }
    setSerials(prev => [...prev, s])
    setSerialInput('')
  }

  const handleSave = async () => {
    if (!form.qty || qty <= 0) { toast.error('Enter quantity'); return }
    if (needsSerials && serials.length < qty) { toast.error(`Enter all ${qty} serial numbers`); return }
    setSaving(true)
    try {
      const cost = parseFloat(form.cost) || 0
      const { data: inv } = await supabase.from('inventory')
        .select('id,quantity,avg_cost').eq('product_id', p.id).maybeSingle()
      if (inv) {
        const newQty     = (inv.quantity||0) + qty
        const newAvgCost = ((inv.avg_cost||0)*(inv.quantity||0) + cost*qty) / newQty
        await supabase.from('inventory').update({ quantity: newQty, avg_cost: newAvgCost, updated_at: new Date().toISOString() }).eq('id', inv.id)
      } else {
        await supabase.from('inventory').insert({ tenant_id: tenantId, product_id: p.id, quantity: qty, avg_cost: cost })
      }
      if (needsSerials && serials.length > 0) {
        await supabase.from('serial_numbers').insert(serials.map(s => ({ tenant_id: tenantId, product_id: p.id, serial: s, status: 'in_stock' })))
      }
      await supabase.from('inventory_receives').insert({ tenant_id: tenantId, product_id: p.id, vendor_id: form.vendor_id||null, qty, cost, notes: form.notes||null })
      toast.success(`✓ Received ${qty} ${p.unit||'units'} of ${p.name}`)
      onSave()
    } catch(err) { toast.error('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[480px] max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1e2d42] flex items-center justify-between sticky top-0 bg-[#0d1117]">
          <div>
            <div className="text-[15px] font-bold">📥 Receive Inventory</div>
            <div className="text-[11px] text-[#3d5068] mt-0.5">{p.name}</div>
          </div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Vendor</div>
            <select value={form.vendor_id} onChange={e=>set('vendor_id',e.target.value)}
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] text-[#e8edf5] outline-none focus:border-blue-500/40">
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Cost per Unit</div>
              <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 focus-within:border-blue-500/40">
                <span className="text-[#3d5068] mr-1">$</span>
                <input type="number" value={form.cost} onChange={e=>set('cost',e.target.value)} placeholder="0.00" step="0.01"
                  className="flex-1 bg-transparent border-none outline-none py-2.5 text-[13px] font-mono placeholder-[#3d5068]"/>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Quantity</div>
              <input type="number" value={form.qty} onChange={e=>set('qty',e.target.value)} placeholder="0" min="1"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] font-mono outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
            </div>
          </div>
          {form.cost && form.qty && (
            <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-4 py-2.5 flex justify-between">
              <span className="text-[11px] text-[#3d5068]">Total Cost</span>
              <span className="font-mono text-[12px] font-bold text-green-400">${(parseFloat(form.cost)*qty).toFixed(2)}</span>
            </div>
          )}
          {needsSerials && qty > 0 && (
            <div>
              <div className="flex justify-between mb-1.5">
                <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider">Serial Numbers</div>
                <span className={`text-[10px] font-mono ${serials.length===qty?'text-green-400':'text-yellow-400'}`}>{serials.length}/{qty}</span>
              </div>
              <div className="flex gap-2 mb-2">
                <input value={serialInput} onChange={e=>setSerialInput(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&addSerial()} placeholder="Scan or type serial number..." autoFocus={needsSerials}
                  className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 text-[12px] font-mono outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
                <button onClick={addSerial} className="bg-blue-500 border-none rounded-[9px] px-3 py-2 text-[11px] font-bold text-white cursor-pointer">Add</button>
              </div>
              <div className="max-h-[120px] overflow-y-auto flex flex-col gap-1">
                {serials.map((s,i) => (
                  <div key={i} className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5">
                    <span className="text-[10px] text-[#3d5068] font-mono w-5">{i+1}.</span>
                    <span className="flex-1 font-mono text-[11px] text-green-400">{s}</span>
                    <button onClick={()=>setSerials(prev=>prev.filter((_,j)=>j!==i))}
                      className="text-[#3d5068] hover:text-red-400 bg-transparent border-none cursor-pointer text-[11px]">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Notes (optional)</div>
            <input value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="PO number, notes..."
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[12px] outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4 sticky bottom-0 bg-[#0d1117]">
          <button onClick={onClose} className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-3 text-[13px] text-[#8899b0] cursor-pointer">Cancel</button>
          <button onClick={handleSave} disabled={saving||(needsSerials&&serials.length<qty)}
            className="flex-[2] bg-gradient-to-r from-green-600 to-green-700 border-none rounded-[9px] py-3 text-[13px] font-bold text-white cursor-pointer disabled:opacity-40">
            {saving ? '⏳ Saving...' : `✓ Receive ${qty||0} ${p.unit||'units'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Adjust Inventory Modal ──
function AdjustModal({ product: p, tenantId, onSave, onClose }) {
  const [qty, setQty]     = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const adjustQty = parseInt(qty) || 0

  const handleSave = async () => {
    if (!qty) { toast.error('Enter adjustment quantity'); return }
    if (!reason.trim()) { toast.error('Enter a reason'); return }
    setSaving(true)
    try {
      const { data: inv } = await supabase.from('inventory')
        .select('id,quantity').eq('product_id', p.id).maybeSingle()
      const currentQty = inv?.quantity || 0
      const newQty     = Math.max(0, currentQty + adjustQty)
      if (inv) {
        await supabase.from('inventory').update({ quantity: newQty, updated_at: new Date().toISOString() }).eq('id', inv.id)
      } else {
        await supabase.from('inventory').insert({ tenant_id: tenantId, product_id: p.id, quantity: newQty })
      }
      await supabase.from('inventory_adjustments').insert({
        tenant_id: tenantId, product_id: p.id,
        qty_change: adjustQty, qty_before: currentQty, qty_after: newQty, reason
      })
      toast.success(`Inventory adjusted: ${adjustQty>=0?'+':''}${adjustQty} ${p.unit||'units'}`)
      onSave()
    } catch(err) { toast.error('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const REASONS = ['Damaged','Expired','Theft/Shrinkage','Received without PO','Count correction','Transfer out','Transfer in','Other']

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[400px]" onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1e2d42] flex items-center justify-between">
          <div>
            <div className="text-[15px] font-bold">⚖️ Adjust Inventory</div>
            <div className="text-[11px] text-[#3d5068] mt-0.5">{p.name}</div>
          </div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Adjustment Qty (use - to decrease)</div>
            <input type="number" value={qty} onChange={e=>setQty(e.target.value)} placeholder="+5 or -3" autoFocus
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-3 text-[18px] font-mono text-center outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
            {qty && <div className={`mt-1.5 text-center text-[11px] font-mono font-bold ${adjustQty>=0?'text-green-400':'text-red-400'}`}>
              {adjustQty>=0?'+':''}{adjustQty} {p.unit||'units'}
            </div>}
          </div>
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Reason *</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {REASONS.map(r => (
                <button key={r} onClick={()=>setReason(r)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] border transition-all cursor-pointer ${
                    reason===r ? 'border-blue-500/40 bg-blue-500/10 text-blue-400' : 'border-[#1e2d42] bg-[#111827] text-[#8899b0] hover:border-[#243347]'
                  }`}>{r}
                </button>
              ))}
            </div>
            <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Or type a custom reason..."
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 text-[12px] outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4">
          <button onClick={onClose} className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-3 text-[13px] text-[#8899b0] cursor-pointer">Cancel</button>
          <button onClick={handleSave} disabled={saving||!qty||!reason}
            className={`flex-[2] border-none rounded-[9px] py-3 text-[13px] font-bold text-white cursor-pointer disabled:opacity-40 ${
              adjustQty<0 ? 'bg-gradient-to-r from-red-600 to-red-700' : 'bg-gradient-to-r from-blue-600 to-blue-700'
            }`}>
            {saving ? '⏳ Saving...' : `${adjustQty>=0?'+':''}${adjustQty} ${p.unit||'units'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
