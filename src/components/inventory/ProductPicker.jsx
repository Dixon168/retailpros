// src/components/inventory/ProductPicker.jsx
// Reusable product picker with search + category filter.
// Used in CreatePOModal, POReceiveModal, and anywhere else products need to be added.

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

/**
 * @param title         — modal title (e.g. "Add Product to PO")
 * @param onPick        — called with product object when row clicked
 * @param onClose       — close modal
 * @param vendorId      — optional, if set will fetch this vendor's last/avg cost
 *                        and surface it in the row (suggests cost when adding to PO)
 * @param excludeIds    — array of product IDs already in the cart (so they don't show)
 */
export default function ProductPicker({ title = 'Add Product', onPick, onClose, vendorId = null, excludeIds = [] }) {
  const { tenant } = useAuthStore()
  const [search, setSearch]         = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Categories list
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('id, name')
        .eq('tenant_id', tenant.id)
        .order('name')
      return data || []
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
  })

  // Search results
  const queryMode = debouncedSearch.length >= 2 ? 'search'
                  : categoryId ? 'category'
                  : 'idle'

  const { data: results = [], isLoading, error } = useQuery({
    queryKey: ['product-picker', tenant?.id, queryMode, debouncedSearch, categoryId, vendorId],
    queryFn: async () => {
      let q = supabase.from('products')
        .select('id, name, sku, cost, category_id')
        .eq('tenant_id', tenant.id)
        .neq('type', 'service')

      if (queryMode === 'search') {
        q = q.or(`name.ilike.%${debouncedSearch}%,sku.ilike.%${debouncedSearch}%`)
        if (categoryId) q = q.eq('category_id', categoryId)
      } else if (queryMode === 'category') {
        q = q.eq('category_id', categoryId)
      }

      const { data: products, error: prodErr } = await q.order('name').limit(100)
      if (prodErr) throw prodErr

      // Attach vendor pricing if a vendor is provided. Wrapped so a pricing
      // lookup failure can never block the product search itself.
      if (vendorId && products?.length > 0) {
        try {
          const { data: vp } = await supabase.from('vendor_product_pricing')
            .select('product_id, last_cost, avg_cost')
            .eq('vendor_id', vendorId)
            .in('product_id', products.map(p => p.id))
          const priceMap = {}
          ;(vp || []).forEach(p => { priceMap[p.product_id] = p })
          return products.map(p => ({
            ...p,
            vendor_last_cost: priceMap[p.id]?.last_cost,
            vendor_avg_cost: priceMap[p.id]?.avg_cost,
          }))
        } catch { return products }
      }
      return products || []
    },
    enabled: !!tenant?.id && queryMode !== 'idle',
  })

  // Filter out excluded
  const visible = results.filter(p => !excludeIds.includes(p.id))

  const selectedCategoryName = categories.find(c => c.id === categoryId)?.name

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width:'560px', maxWidth:'100%', maxHeight:'80vh', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div className="text-[15px] font-bold text-[#1F1F1F]">{title}</div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        {/* Search + Category filter */}
        <div className="px-5 py-3 flex-shrink-0 space-y-2" style={{borderBottom:'1px solid #E5E5E5'}}>
          <input value={search} onChange={e => setSearch(e.target.value)} autoFocus
            placeholder="🔍 Search by name or SKU (2+ chars)..."
            className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-2.5 text-[14px] outline-none focus:border-[#5E6AD2]"/>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#666] font-bold">Or pick a category:</span>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
              className="flex-1 bg-[#FFFFFF] border rounded-lg px-3 py-2 text-[12px] font-bold outline-none cursor-pointer"
              style={{
                color: categoryId ? '#5E6AD2' : '#1F1F1F',
                borderColor: categoryId ? '#5E6AD2' : '#E5E5E5',
              }}>
              <option value="">📁 All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>📁 {c.name}</option>)}
            </select>
            {(search || categoryId) && (
              <button onClick={() => { setSearch(''); setCategoryId('') }}
                className="text-[11px] text-[#dc2626] font-bold cursor-pointer"
                style={{background:'none', border:'none'}}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-3">
          {queryMode === 'idle' ? (
            <div className="p-12 text-center">
              <div className="text-[40px] mb-2 opacity-30">📦</div>
              <div className="text-[13px] text-[#1F1F1F] font-bold mb-1">Search or pick a category</div>
              <div className="text-[11px] text-[#999]">Type 2+ letters or select a category to see products</div>
            </div>
          ) : isLoading ? (
            <div className="p-8 text-center text-[12px] text-[#999]">Loading...</div>
          ) : error ? (
            <div className="p-8 text-center">
              <div className="text-[36px] mb-2 opacity-30">⚠️</div>
              <div className="text-[12px] text-[#dc2626] font-bold">Search error</div>
              <div className="text-[11px] text-[#999] mt-1">{error.message || 'Could not load products'}</div>
            </div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-[36px] mb-2 opacity-30">🔍</div>
              <div className="text-[12px] text-[#999]">
                No products found
                {selectedCategoryName && ` in ${selectedCategoryName}`}
                {debouncedSearch && ` matching "${debouncedSearch}"`}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {results.length >= 100 && (
                <div className="rounded-lg px-3 py-2 text-[11px] mb-2"
                  style={{background:'#FEF3C7', color:'#B45309', border:'1px solid #FCD34D'}}>
                  ⚠️ Showing first 100 results. Refine your search or pick a different category.
                </div>
              )}
              {visible.map(p => (
                <button key={p.id} onClick={() => onPick(p)}
                  className="w-full text-left px-3 py-2 rounded-lg cursor-pointer hover:bg-[#FAFAFA] flex items-center gap-3"
                  style={{border:'1px solid #E5E5E5', background:'#FFFFFF'}}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{p.name}</div>
                    <div className="text-[10px] text-[#999] font-mono">{p.sku || '—'}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {p.vendor_last_cost ? (
                      <>
                        <div className="text-[10px] text-[#666]">Last from vendor</div>
                        <div className="text-[13px] font-bold font-mono text-[#5E6AD2]">${p.vendor_last_cost.toFixed(2)}</div>
                      </>
                    ) : p.cost > 0 ? (
                      <>
                        <div className="text-[10px] text-[#999]">Avg cost</div>
                        <div className="text-[13px] font-bold font-mono text-[#666]">${p.cost.toFixed(2)}</div>
                      </>
                    ) : (
                      <div className="text-[10px] text-[#999]">No price</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
