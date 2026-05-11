// src/pages/estimates/EstimateProductPicker.jsx
// Product picker for Estimates/Invoices — shows current stock and sell price.

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

export default function EstimateProductPicker({ onPick, onClose, excludeIds = [], title = 'Add Product' }) {
  const { tenant, store } = useAuthStore()
  const [search, setSearch]     = useState('')
  const [debounced, setDebounced] = useState('')
  const [categoryId, setCategoryId] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('id, name').eq('tenant_id', tenant.id).order('name')
      return data || []
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
  })

  const queryMode = debounced.length >= 1 ? 'search' : categoryId ? 'category' : 'idle'

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['est-product-picker', tenant?.id, store?.id, queryMode, debounced, categoryId],
    queryFn: async () => {
      // Match the POS picker query pattern (proven to work on Dixon's schema):
      // - select(*) instead of cherry-picked cols (avoids missing-column errors
      //   if the schema doesn't have e.g. `barcode`)
      // - filter is_active = true (same as POS)
      // - search by name, sku, OR upc (the POS uses `upc`, not `barcode`)
      // - NO `.neq('type', 'service')` — that filter excludes rows where type
      //   IS NULL (in SQL `NULL != 'service'` is NULL, not TRUE). Older products
      //   may have type=NULL and would be invisible. Filter services in JS instead.
      let q = supabase.from('products')
        .select('id, name, sku, price, cost, category_id, is_active, type')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)

      if (queryMode === 'search') {
        const term = debounced.replace(/[%,]/g, '')
        q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,upc.eq.${term}`)
        if (categoryId) q = q.eq('category_id', categoryId)
      } else if (queryMode === 'category') {
        q = q.eq('category_id', categoryId)
      }

      const { data: products, error: pErr } = await q.order('name').limit(100)
      if (pErr) {
        toast.error(`Product lookup failed: ${pErr.message}`)
        console.error('[ProductPicker] products query error:', pErr)
        return []
      }
      // Filter out services in JS — keeps products with type=null visible
      const nonService = (products || []).filter(p => p.type !== 'service')
      if (!nonService.length) return []

      // Fetch inventory for these products
      const { data: inv, error: iErr } = await supabase.from('inventory')
        .select('product_id, quantity')
        .eq('tenant_id', tenant.id).eq('store_id', store.id)
        .in('product_id', nonService.map(p => p.id))
      if (iErr) console.warn('[ProductPicker] inventory query error:', iErr)
      const stockMap = {}
      ;(inv || []).forEach(r => { stockMap[r.product_id] = r.quantity })

      return nonService.map(p => ({ ...p, stock_qty: stockMap[p.id] || 0 }))
    },
    enabled: !!tenant?.id && queryMode !== 'idle',
  })

  const visible = results.filter(p => !excludeIds.includes(p.id))

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width:'560px', maxWidth:'100%', maxHeight:'80vh', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
      }}>
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div className="text-[15px] font-bold text-[#1F1F1F]">{title}</div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        <div className="px-5 py-3 flex-shrink-0 space-y-2" style={{borderBottom:'1px solid #E5E5E5'}}>
          <input value={search} onChange={e => setSearch(e.target.value)} autoFocus
            placeholder="🔍 Search by name, SKU, or scan barcode..."
            onKeyDown={(e) => {
              // Barcode scanner workflow: scan ends with Enter.
              // If we have exactly 1 result, auto-pick it.
              if (e.key === 'Enter' && results.length === 1) {
                e.preventDefault()
                onPick(results[0])
              }
            }}
            className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-2.5 text-[14px] outline-none focus:border-[#006AFF]"/>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#666] font-bold">Or pick a category:</span>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
              className="flex-1 bg-[#FFFFFF] border rounded-lg px-3 py-2 text-[12px] font-bold outline-none cursor-pointer"
              style={{
                color: categoryId ? '#006AFF' : '#1F1F1F',
                borderColor: categoryId ? '#006AFF' : '#E5E5E5',
              }}>
              <option value="">📁 All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>📁 {c.name}</option>)}
            </select>
            {(search || categoryId) && (
              <button onClick={() => { setSearch(''); setCategoryId('') }}
                className="text-[11px] text-[#CF1322] font-bold cursor-pointer"
                style={{background:'none', border:'none'}}>
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {queryMode === 'idle' ? (
            <div className="p-12 text-center">
              <div className="text-[40px] mb-2 opacity-30">📦</div>
              <div className="text-[13px] text-[#1F1F1F] font-bold mb-1">Search or pick a category</div>
              <div className="text-[11px] text-[#999]">Type a name / SKU, scan a barcode, or pick a category</div>
            </div>
          ) : isLoading ? (
            <div className="p-8 text-center text-[12px] text-[#999]">Loading...</div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-[36px] mb-2 opacity-30">🔍</div>
              <div className="text-[12px] text-[#999]">No products found</div>
            </div>
          ) : (
            <div className="space-y-1">
              {results.length >= 100 && (
                <div className="rounded-lg px-3 py-2 text-[11px] mb-2"
                  style={{background:'#FEF3C7', color:'#B45309', border:'1px solid #FCD34D'}}>
                  ⚠️ Showing first 100 results. Refine your search.
                </div>
              )}
              {visible.map(p => {
                const stock = p.stock_qty || 0
                return (
                  <button key={p.id} onClick={() => onPick(p)}
                    className="w-full text-left px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[#FAFAFA] flex items-center gap-3"
                    style={{border:'1px solid #E5E5E5', background:'#FFFFFF'}}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{p.name}</div>
                      <div className="text-[10px] text-[#999] font-mono">{p.sku || '—'}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[10px] font-bold uppercase"
                        style={{ color: stock > 5 ? '#15803D' : stock > 0 ? '#B45309' : '#CF1322' }}>
                        Stock: {stock}
                      </div>
                      <div className="text-[13px] font-bold font-mono text-[#1F1F1F]">${(p.price || 0).toFixed(2)}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
