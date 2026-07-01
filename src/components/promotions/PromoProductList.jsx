// src/components/promotions/PromoProductList.jsx
// The "Products in this promotion" editor — multi-select with three ways
// to add (single, by category snapshot, search-typing) and conflict
// detection against other active promotions.
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { findConflicts, loadProductsByCategory } from '@/lib/promoProducts'
import toast from 'react-hot-toast'

export default function PromoProductList({ tenantId, promotionId, products, onChange }) {
  // products: [{ id, name, sku, barcode, price, image_url, category_id, _added_via }]
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showCat, setShowCat] = useState(false)
  const [conflicts, setConflicts] = useState([])     // last conflict report
  const selectedIds = useMemo(() => new Set(products.map(p => p.id)), [products])

  // ── Search results for the "+ Add" panel ──
  const { data: searchResults = [] } = useQuery({
    queryKey: ['promo-product-search', tenantId, search],
    queryFn: async () => {
      if (!search.trim()) return []
      const t = search.replace(/[,()*%\\]/g, ' ').trim()
      const { data } = await supabase.from('products')
        .select('id, name, sku, barcode, price, image_url, category_id, is_active')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .or(`name.ilike.%${t}%,sku.ilike.%${t}%,barcode.eq.${t}`)
        .order('name').limit(40)
      return data || []
    },
    enabled: showAdd && !!tenantId && !!search.trim(),
  })

  // ── Categories for the "+ Add by Category" panel ──
  const { data: categories = [] } = useQuery({
    queryKey: ['promo-categories', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('id, name').eq('tenant_id', tenantId).order('name')
      return data || []
    },
    enabled: showCat && !!tenantId,
  })

  // ── Add one product (with conflict check) ──
  const addProduct = async (prod, viaTag = 'manual') => {
    if (selectedIds.has(prod.id)) {
      toast(`${prod.name} is already in this list`, { icon:'ℹ️' })
      return false
    }
    const cs = await findConflicts(tenantId, [prod.id], promotionId)
    if (cs.length) {
      const c = cs[0]
      toast.error(`${prod.name} is already in "${c.conflict_promo_name}" — not added`, { duration: 4000 })
      setConflicts(cs)
      return false
    }
    onChange([...products, { ...prod, _added_via: viaTag }])
    return true
  }

  // ── Add many at once (typed bulk / category snapshot) ──
  const addMany = async (prods, viaTag) => {
    const fresh = prods.filter(p => !selectedIds.has(p.id))
    if (fresh.length === 0) {
      toast(`All ${prods.length} products are already in this list`, { icon:'ℹ️' })
      return
    }
    const cs = await findConflicts(tenantId, fresh.map(p => p.id), promotionId)
    const conflictIds = new Set(cs.map(c => c.product_id))
    const toAdd = fresh.filter(p => !conflictIds.has(p.id))
    onChange([...products, ...toAdd.map(p => ({ ...p, _added_via: viaTag }))])
    setConflicts(cs)
    if (cs.length > 0 && toAdd.length > 0) {
      toast(`Added ${toAdd.length}, skipped ${cs.length} already in another promo`,
        { icon: '⚠️', duration: 5000 })
    } else if (cs.length > 0) {
      toast.error(`All ${cs.length} products are already in another promo — none added`, { duration: 5000 })
    } else {
      toast.success(`Added ${toAdd.length} product${toAdd.length>1?'s':''}`)
    }
  }

  const removeProduct = (id) => onChange(products.filter(p => p.id !== id))

  // ── Snapshot all products of a category ──
  const addCategorySnapshot = async (cat) => {
    const prods = await loadProductsByCategory(tenantId, cat.id)
    if (prods.length === 0) { toast(`No active products in "${cat.name}"`, { icon:'ℹ️' }); return }
    await addMany(prods, `category:${cat.name}`)
    setShowCat(false)
  }

  return (
    <div className="rounded-xl border" style={{borderColor:'#E5E5E5', background:'#fff'}}>
      <div className="px-4 py-3 flex items-center justify-between"
        style={{background:'#FAFAFA', borderBottom:'1px solid #E5E5E5'}}>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-[#1F1F1F]">Products in this promotion</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{background:'#eef0fc', color:'#5E6AD2'}}>{products.length} selected</span>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>{ setShowAdd(true); setShowCat(false) }} type="button"
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg cursor-pointer border"
            style={{background:'#fff', borderColor:'#cbd5e1', color:'#0f172a'}}>
            + Add product
          </button>
          <button onClick={()=>{ setShowCat(true); setShowAdd(false) }} type="button"
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg cursor-pointer border"
            style={{background:'#fff', borderColor:'#cbd5e1', color:'#0f172a'}}>
            + Add by Category
          </button>
        </div>
      </div>

      {/* Search-to-add panel */}
      {showAdd && (
        <div className="px-4 py-3" style={{background:'#F8FAFC', borderBottom:'1px solid #E5E5E5'}}>
          <div className="flex gap-2 items-center mb-2">
            <input value={search} onChange={e=>setSearch(e.target.value)} autoFocus
              placeholder="Search by name / SKU / barcode..."
              className="flex-1 rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{border:'1.5px solid #cbd5e1', background:'#fff'}}/>
            <button onClick={()=>{ setShowAdd(false); setSearch('') }} type="button"
              className="text-[11px] px-3 py-2 rounded-lg cursor-pointer border"
              style={{background:'#fff', borderColor:'#cbd5e1', color:'#64748b'}}>Done</button>
          </div>
          {search.trim() && searchResults.length === 0 && (
            <div className="text-[11px] text-slate-400 text-center py-3">No products found</div>
          )}
          {searchResults.length > 0 && (
            <div className="max-h-[240px] overflow-y-auto rounded-lg" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
              {searchResults.map(p => {
                const already = selectedIds.has(p.id)
                return (
                  <button key={p.id} onClick={()=>addProduct(p)} disabled={already} type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 text-left border-b last:border-b-0 cursor-pointer disabled:opacity-40 hover:bg-blue-50"
                    style={{borderColor:'#f1f5f9', background:'#fff'}}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-bold text-slate-800 truncate">{p.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {p.sku ? `SKU ${p.sku}` : ''}{p.barcode ? ` · ${p.barcode}` : ''}
                      </div>
                    </div>
                    <div className="text-[12px] font-bold font-mono text-slate-600">${Number(p.price||0).toFixed(2)}</div>
                    <div className="text-[10px] font-bold flex-shrink-0" style={{color: already ? '#94a3b8' : '#5E6AD2'}}>
                      {already ? '✓ Added' : '+ Add'}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Category snapshot panel */}
      {showCat && (
        <div className="px-4 py-3" style={{background:'#F8FAFC', borderBottom:'1px solid #E5E5E5'}}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-slate-500">
              Pick a category — its current products get snapshotted into the list.
              You can edit the list afterwards (delete / add).
            </div>
            <button onClick={()=>setShowCat(false)} type="button"
              className="text-[11px] px-3 py-1.5 rounded-lg cursor-pointer border"
              style={{background:'#fff', borderColor:'#cbd5e1', color:'#64748b'}}>Done</button>
          </div>
          {categories.length === 0 && (
            <div className="text-[11px] text-slate-400 text-center py-3">No categories yet</div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {categories.map(cat => (
              <button key={cat.id} onClick={()=>addCategorySnapshot(cat)} type="button"
                className="rounded-lg px-3 py-2 text-[12px] font-bold cursor-pointer border"
                style={{background:'#fff', borderColor:'#cbd5e1', color:'#0f172a'}}>
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Conflict report */}
      {conflicts.length > 0 && (
        <div className="px-4 py-3 text-[11px]" style={{background:'#FEF3C7', borderBottom:'1px solid #FCD34D', color:'#92400E'}}>
          <div className="font-bold mb-1">⚠ {conflicts.length} product{conflicts.length>1?'s':''} skipped (already in another active promotion):</div>
          <ul className="ml-4 list-disc">
            {conflicts.slice(0, 8).map((c, i) => (
              <li key={i}>conflicts with <b>{c.conflict_promo_name}</b></li>
            ))}
            {conflicts.length > 8 && <li>...and {conflicts.length - 8} more</li>}
          </ul>
          <button onClick={()=>setConflicts([])} type="button"
            className="mt-1 text-[10px] underline cursor-pointer">dismiss</button>
        </div>
      )}

      {/* The list itself */}
      {products.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <div className="text-[28px] mb-2">📋</div>
          <div className="text-[13px] font-bold text-slate-500">No products yet</div>
          <div className="text-[11px] text-slate-400 mt-1">Use the buttons above to add products one-by-one or by category.</div>
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto">
          {products.map(p => (
            <div key={p.id} className="px-4 py-2.5 flex items-center gap-3 border-b last:border-b-0"
              style={{borderColor:'#f1f5f9', background:'#fff'}}>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-slate-800 truncate">{p.name}</div>
                <div className="text-[10px] text-slate-400 font-mono">
                  {p.sku ? `SKU ${p.sku}` : ''}{p.barcode ? ` · ${p.barcode}` : ''}
                  {p._added_via && p._added_via !== 'manual' && (
                    <span className="ml-2 px-1.5 py-0.5 rounded font-bold"
                      style={{background:'#f1f5f9', color:'#64748b'}}>
                      via {p._added_via}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-[12px] font-bold font-mono text-slate-600">${Number(p.price||0).toFixed(2)}</div>
              <button onClick={()=>removeProduct(p.id)} type="button"
                title="Remove from this promotion"
                className="w-6 h-6 rounded-full border-none cursor-pointer text-[12px] font-bold"
                style={{background:'#fee2e2', color:'#dc2626'}}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
