// src/pages/products/ProductsPage.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useProductsStore } from '@/stores/productsStore'

const TYPE_BADGE = {
  unit:       { label: 'UNIT',    bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  weight:     { label: 'WEIGHT',  bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
  serialized: { label: 'SERIAL',  bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b' },
  service:    { label: 'SERVICE', bg: 'rgba(139,92,246,0.12)',  color: '#8b5cf6' },
}
function getEmoji(p) {
  const n = p?.name?.toLowerCase()||''
  if(n.includes('iphone')||n.includes('samsung')) return '📱'
  if(n.includes('macbook')||n.includes('laptop')) return '💻'
  if(n.includes('airpods')) return '🎧'
  if(n.includes('apple')&&!n.includes('macbook')) return '🍎'
  if(n.includes('banana')) return '🍌'
  if(n.includes('grape')) return '🍇'
  if(n.includes('milk')) return '🥛'
  if(p?.type==='service') return '🔧'
  if(p?.type==='weight') return '🥬'
  return '📦'
}

export default function ProductsPage() {
  const { tenant } = useAuthStore()
  const { selectedProduct, setSelectedProduct } = useProductsStore()
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')

  const { data: products=[], isLoading } = useQuery({
    queryKey: ['products', tenant?.id, search, filterType],
    queryFn: async () => {
      let q = supabase.from('products')
        .select('*, inventory(quantity, low_stock_alert, stores(name))')
        .eq('tenant_id', tenant.id).eq('is_active', true)
      if(search) q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
      if(filterType !== 'all') q = q.eq('type', filterType)
      const { data } = await q.order('name').limit(100)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const lowStock = products.filter(p => {
    const qty = p.inventory?.reduce((a,i)=>a+(i.quantity||0),0)||0
    return qty <= 5 && p.type !== 'service'
  }).length

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-[200px] bg-[#0d1117] border-r border-[#1e2d42] p-3 flex-shrink-0">
        <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-widest px-2 mb-2">Type</div>
        {[['all','All Products'],['unit','Unit'],['weight','Weight'],['serialized','Serialized'],['service','Service']].map(([id,label]) => (
          <div key={id} onClick={() => setFilterType(id)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-[12px] mb-0.5 transition-all ${filterType===id?'bg-blue-500/10 text-blue-400':'text-[#8899b0] hover:bg-[#111827]'}`}>
            {id !== 'all' && <span className="w-1.5 h-1.5 rounded-full" style={{background:TYPE_BADGE[id]?.color}}/>}
            {label}
          </div>
        ))}
        <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-widest px-2 mb-2 mt-4">Alerts</div>
        <div onClick={() => setFilterType('low')}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-[12px] mb-0.5 transition-all ${filterType==='low'?'bg-red-500/10 text-red-400':'text-[#8899b0] hover:bg-[#111827]'}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-red-400"/>
          Low Stock
          {lowStock > 0 && <span className="ml-auto font-mono text-[10px] bg-red-500/10 text-red-400 px-1.5 rounded">{lowStock}</span>}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#1e2d42] bg-[#0d1117] flex-shrink-0">
          <div className="flex gap-5 mr-2">
            <div><div className="text-[9px] font-mono text-[#3d5068] uppercase">Products</div><div className="text-[16px] font-bold">{products.length}</div></div>
            <div><div className="text-[9px] font-mono text-[#3d5068] uppercase">Low Stock</div><div className="text-[16px] font-bold text-red-400">{lowStock}</div></div>
          </div>
          <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 flex-1 focus-within:border-blue-500/40 transition-colors">
            <span className="text-[#3d5068]">🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search name, SKU, barcode..."
              className="bg-transparent border-none outline-none text-[#e8edf5] text-[12px] py-2 flex-1 font-sans placeholder-[#3d5068]"/>
          </div>
          <button className="bg-blue-500 border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white">+ Add Product</button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#111827] border-b border-[#1e2d42]">
                {['','Product','Type','Stock','Price','Cost','Margin','Actions'].map((h,i) => (
                  <th key={i} className="px-3.5 py-2.5 text-left font-mono text-[10px] text-[#3d5068] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array(6).fill(0).map((_,i)=>(
                <tr key={i} className="border-b border-[#1e2d42]">
                  {Array(8).fill(0).map((_,j)=>(
                    <td key={j} className="px-3.5 py-4"><div className="h-3 bg-[#111827] rounded animate-pulse"/></td>
                  ))}
                </tr>
              )) : products.map(p => {
                const badge = TYPE_BADGE[p.type]
                const qty = p.inventory?.reduce((a,i)=>a+(i.quantity||0),0)||0
                const isLow = qty <= 5 && p.type !== 'service'
                const margin = p.cost > 0 ? ((p.price-p.cost)/p.price*100).toFixed(1) : null
                return (
                  <tr key={p.id} onClick={()=>setSelectedProduct(p)}
                    className={`border-b border-[#1e2d42] cursor-pointer transition-colors hover:bg-[#111827] ${selectedProduct?.id===p.id?'bg-[#111827]':''}`}>
                    <td className="px-3.5 py-3" onClick={e=>e.stopPropagation()}><input type="checkbox" className="accent-blue-500"/></td>
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-[#1a2236] flex items-center justify-center text-lg flex-shrink-0">{getEmoji(p)}</div>
                        <div>
                          <div className="text-[12px] font-semibold">{p.name}</div>
                          <div className="text-[10px] font-mono text-[#3d5068] mt-0.5">{p.sku||p.barcode||''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3.5 py-3">
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded" style={{background:badge?.bg,color:badge?.color}}>{badge?.label}</span>
                    </td>
                    <td className="px-3.5 py-3">
                      {p.type==='service' ? <span className="text-[11px] text-[#3d5068]">N/A</span> : (
                        <div>
                          <div className={`text-[12px] font-mono ${isLow?'text-red-400':''}`}>{qty} {p.unit||'ea'}</div>
                          <div className="h-1 bg-[#1e2d42] rounded mt-1 overflow-hidden w-10">
                            <div className="h-full rounded" style={{width:`${Math.min(100,qty/20*100)}%`,background:isLow?'#ef4444':'#10b981'}}/>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-[12px] font-bold" style={{color:p.type==='weight'?'#10b981':'#3b82f6'}}>
                      ${p.price.toFixed(2)}{p.type==='weight'?`/${p.unit}`:''}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-[11px] text-[#8899b0]">{p.cost?`$${p.cost.toFixed(2)}`:'—'}</td>
                    <td className="px-3.5 py-3 font-mono text-[12px] font-bold" style={{color:margin?'#10b981':'#3d5068'}}>{margin?`${margin}%`:'—'}</td>
                    <td className="px-3.5 py-3" onClick={e=>e.stopPropagation()}>
                      <div className="flex gap-1.5">
                        <button onClick={()=>setSelectedProduct(p)} className="bg-[#111827] border border-[#1e2d42] rounded px-2 py-1 text-[10px] text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400 transition-all">Edit</button>
                        <button className="bg-[#111827] border border-[#1e2d42] rounded px-2 py-1 text-[10px] text-[#8899b0] hover:border-red-500/30 hover:text-red-400 transition-all">Del</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Panel */}
      {selectedProduct && <ProductDetailPanel product={selectedProduct} onClose={()=>setSelectedProduct(null)} />}
    </div>
  )
}

function ProductDetailPanel({ product: p, onClose }) {
  const [tab, setTab] = useState('info')
  const { tenant } = useAuthStore()
  const badge = TYPE_BADGE[p.type]

  const { data: serials=[] } = useQuery({
    queryKey: ['serials', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('serial_numbers').select('*')
        .eq('product_id', p.id).eq('tenant_id', tenant.id)
        .order('received_at', { ascending: false }).limit(50)
      return data||[]
    },
    enabled: p.type === 'serialized',
  })

  const { data: sales=[] } = useQuery({
    queryKey: ['product-sales', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('order_items')
        .select('*, orders(order_number, created_at, customers(name))')
        .eq('product_id', p.id).eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false }).limit(20)
      return data||[]
    },
    enabled: tab === 'sales',
  })

  const tabs = [
    { id:'info', label:'Info' },
    { id:'inventory', label:'Inventory' },
    ...(p.type==='serialized' ? [{ id:'serials', label:`Serials (${serials.length})` }] : []),
    { id:'sales', label:'Sales' },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}/>
      <div className="fixed right-0 top-14 bottom-0 w-[440px] bg-[#0d1117] border-l border-[#1e2d42] z-50 flex flex-col shadow-2xl"
        onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-[#1e2d42] flex gap-3 items-start flex-shrink-0">
          <div className="w-[50px] h-[50px] rounded-xl bg-[#1a2236] flex items-center justify-center text-2xl flex-shrink-0">{getEmoji(p)}</div>
          <div className="flex-1">
            <div className="text-[17px] font-bold">{p.name}</div>
            <div className="text-[10px] font-mono text-[#3d5068] mt-1">{p.sku&&`SKU: ${p.sku}`}</div>
            <div className="flex gap-1.5 mt-2">
              <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded" style={{background:badge?.bg,color:badge?.color}}>{badge?.label}</span>
              <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-green-500/10 text-green-400">Active</span>
            </div>
          </div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl px-1">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#1e2d42] flex-shrink-0">
          {tabs.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`flex-1 py-2.5 text-[11px] border-b-2 transition-all ${tab===t.id?'text-blue-400 border-blue-400':'text-[#8899b0] border-transparent'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'info' && (
            <div>
              <div className="grid grid-cols-2 gap-2.5 mb-4">
                {[
                  ['Name', p.name], ['Type', badge?.label],
                  ['SKU', p.sku||'—'], ['Barcode', p.barcode||'—'],
                  ['Price', `$${p.price.toFixed(2)}`], ['Cost', p.cost?`$${p.cost.toFixed(2)}`:'—'],
                  ['Unit', p.unit||'ea'], ['Taxable', p.is_taxable?'Yes':'No'],
                ].map(([label,value]) => (
                  <div key={label} className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5">
                    <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-wider mb-1">{label}</div>
                    <div className="text-[12px] font-semibold">{value}</div>
                  </div>
                ))}
              </div>
              {p.cost > 0 && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px] p-3 text-center">
                    <div className="text-[9px] font-mono text-[#3d5068] mb-1">GROSS MARGIN</div>
                    <div className="text-[18px] font-bold font-mono text-green-400">{((p.price-p.cost)/p.price*100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px] p-3 text-center">
                    <div className="text-[9px] font-mono text-[#3d5068] mb-1">PROFIT / UNIT</div>
                    <div className="text-[18px] font-bold font-mono text-green-400">${(p.price-p.cost).toFixed(2)}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'inventory' && (
            <div>
              {(p.inventory||[]).map(inv => (
                <div key={inv.id} className="bg-[#111827] border border-[#1e2d42] rounded-[10px] p-3.5 mb-3">
                  <div className="flex justify-between mb-3">
                    <span className="text-[13px] font-bold">🏪 {inv.stores?.name||'Store'}</span>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded ${inv.quantity<=5?'bg-red-500/10 text-red-400':'bg-green-500/10 text-green-400'}`}>
                      {inv.quantity<=5?'LOW STOCK':'IN STOCK'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[['In Stock', inv.quantity, inv.quantity<=5?'#ef4444':undefined],
                      ['Alert At', inv.low_stock_alert||5, undefined],
                      ['Est. Value', `$${((inv.quantity||0)*(p.cost||p.price)).toFixed(0)}`, '#10b981']
                    ].map(([l,v,c]) => (
                      <div key={l} className="bg-[#0d1117] border border-[#1e2d42] rounded-lg p-2.5 text-center">
                        <div className="text-[15px] font-bold font-mono" style={{color:c||undefined}}>{v}</div>
                        <div className="text-[9px] text-[#3d5068] mt-1">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button className="w-full bg-blue-500/10 border border-blue-500/20 rounded-[9px] py-2.5 text-[12px] text-blue-400">+ Adjust Inventory</button>
            </div>
          )}

          {tab === 'serials' && (
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-[12px] text-[#8899b0]">
                  <span className="text-green-400">{serials.filter(s=>s.status==='in_stock').length} in stock</span>
                  {' · '}
                  <span className="text-blue-400">{serials.filter(s=>s.status==='sold').length} sold</span>
                </span>
                <button className="bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg px-3 py-1 text-[10px]">+ Receive</button>
              </div>
              {serials.map(sn => (
                <div key={sn.id} className="flex items-center gap-3 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 mb-1.5"
                  style={{opacity: sn.status==='sold'?0.6:1}}>
                  <div className="font-mono text-[12px] font-semibold flex-1">{sn.serial_number}</div>
                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${sn.status==='in_stock'?'bg-green-500/10 text-green-400':'bg-blue-500/10 text-blue-400'}`}>
                    {sn.status==='in_stock'?'IN STOCK':'SOLD'}
                  </span>
                  <span className="text-[10px] text-[#3d5068]">
                    {sn.status==='sold'?`Sold ${new Date(sn.sold_at).toLocaleDateString()}`:`Recv ${new Date(sn.received_at).toLocaleDateString()}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'sales' && (
            <div>
              {sales.length === 0
                ? <div className="text-center py-8 text-[#3d5068] text-sm">No sales yet</div>
                : sales.map(item => (
                  <div key={item.id} className="flex items-center gap-3 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 mb-1.5">
                    <div className="flex-1">
                      <div className="font-mono text-[11px] text-blue-400">{item.orders?.order_number}</div>
                      <div className="text-[10px] text-[#3d5068] mt-0.5">
                        {item.orders?.customers?.name||'Walk-in'} · {new Date(item.orders?.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-[11px] font-mono text-[#8899b0]">×{item.quantity}</div>
                    <div className="font-mono text-[13px] font-bold">${item.line_total?.toFixed(2)}</div>
                  </div>
                ))
              }
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#1e2d42] flex-shrink-0">
          <button className="w-full bg-gradient-to-r from-blue-600 to-blue-700 border-none rounded-[9px] py-3 text-[13px] font-bold text-white">Save Changes</button>
        </div>
      </div>
    </>
  )
}
