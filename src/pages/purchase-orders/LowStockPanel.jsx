// src/pages/purchase-orders/LowStockPanel.jsx
//
// Shows all products at or below their low-stock threshold for the current
// store, with checkboxes. Select some → "Build PO from selected" hands them
// to CreatePOModal pre-filled with each product's auto_restock_qty.
//
// Low-stock definition: inventory.quantity <= products.low_stock_qty
// (low_stock_qty is the per-product threshold from STOCK_CENTER_SETUP).

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

export default function LowStockPanel({ onBuildPO }) {
  const { tenant, store } = useAuthStore()
  const [selected, setSelected] = useState({})  // { product_id: true }

  const { data: lowStock = [], isLoading } = useQuery({
    queryKey: ['lowstock-list', tenant?.id, store?.id],
    queryFn: async () => {
      // Pull products (non-service) + their stock for this store, then
      // filter to those at/below threshold client-side.
      const { data: products } = await supabase.from('products')
        .select('id, name, sku, cost, low_stock_qty, auto_restock_qty, type')
        .eq('tenant_id', tenant.id)
        .neq('type', 'service')
        .limit(1000)
      if (!products?.length) return []

      const { data: inv } = await supabase.from('inventory')
        .select('product_id, quantity')
        .eq('tenant_id', tenant.id)
        .eq('store_id', store.id)
      const stockMap = {}
      ;(inv || []).forEach(r => { stockMap[r.product_id] = r.quantity })

      return products
        .map(p => ({
          ...p,
          stock:     stockMap[p.id] ?? 0,
          threshold: p.low_stock_qty ?? 5,
          restock:   p.auto_restock_qty ?? 0,
        }))
        .filter(p => p.stock <= p.threshold)
        .sort((a, b) => (a.stock - a.threshold) - (b.stock - b.threshold))  // most urgent first
    },
    enabled: !!tenant?.id && !!store?.id,
  })

  const selectedCount = Object.values(selected).filter(Boolean).length
  const allSelected = lowStock.length > 0 && selectedCount === lowStock.length

  const toggleAll = () => {
    if (allSelected) { setSelected({}); return }
    const next = {}
    lowStock.forEach(p => { next[p.id] = true })
    setSelected(next)
  }

  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }))

  const buildPO = () => {
    const items = lowStock
      .filter(p => selected[p.id])
      .map(p => ({
        product_id:   p.id,
        product_name: p.name,
        product_sku:  p.sku,
        // Pre-fill qty from auto_restock_qty. If it's 0 (not set), fall
        // back to 1 so the line is valid; user can edit.
        quantity:     String(p.restock > 0 ? p.restock : 1),
        unit_cost:    String(p.cost || 0),
      }))
    if (items.length === 0) return
    onBuildPO(items)
  }

  return (
    <div>
      {/* Action bar */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[13px] text-[#666]">
          {isLoading ? 'Loading...' : (
            <>
              <span className="font-bold text-[#CF1322]">{lowStock.length}</span> products at or below their low-stock level
              {selectedCount > 0 && <span className="ml-2 text-[#006AFF] font-bold">· {selectedCount} selected</span>}
            </>
          )}
        </div>
        <button onClick={buildPO} disabled={selectedCount === 0}
          className="rounded-lg px-4 py-2 text-[13px] font-bold cursor-pointer active:scale-[0.96] disabled:opacity-40"
          style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
          🛒 Build PO from selected ({selectedCount})
        </button>
      </div>

      {isLoading ? (
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-12 text-center text-[#666] text-[13px]">
          Loading low-stock products...
        </div>
      ) : lowStock.length === 0 ? (
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-12 text-center">
          <div className="text-[48px] mb-2 opacity-30">✅</div>
          <div className="text-[14px] font-bold text-[#1F1F1F] mb-1">All stocked up!</div>
          <div className="text-[12px] text-[#666]">
            No products are at or below their low-stock level for this store.
          </div>
          <div className="text-[11px] text-[#999] mt-2">
            Set a product's low-stock level + auto-restock qty in Products → Adjust → Restock Settings.
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E5E5] rounded-xl overflow-hidden">
          {/* Header */}
          <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5] items-center"
            style={{gridTemplateColumns:'40px 2fr 1fr 1fr 1fr 1fr'}}>
            <div className="px-3 py-2.5 flex items-center justify-center">
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                className="w-4 h-4 cursor-pointer" style={{accentColor:'#006AFF'}}/>
            </div>
            {['Product', 'In Stock', 'Alert ≤', 'Restock Qty', 'Unit Cost'].map(h => (
              <div key={h} className="px-3 py-2.5 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {lowStock.map(p => {
            const isOut = p.stock <= 0
            return (
              <div key={p.id}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] items-center cursor-pointer"
                style={{gridTemplateColumns:'40px 2fr 1fr 1fr 1fr 1fr'}}
                onClick={() => toggle(p.id)}>
                <div className="px-3 py-3 flex items-center justify-center">
                  <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggle(p.id)}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 cursor-pointer" style={{accentColor:'#006AFF'}}/>
                </div>
                <div className="px-3 py-3">
                  <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{p.name}</div>
                  {p.sku && <div className="text-[10px] text-[#999] font-mono">{p.sku}</div>}
                </div>
                <div className="px-3 py-3">
                  <span className="font-mono text-[13px] font-bold"
                    style={{color: isOut ? '#CF1322' : '#B45309'}}>
                    {p.stock}{isOut && ' ⚠️'}
                  </span>
                </div>
                <div className="px-3 py-3 font-mono text-[12px] text-[#666]">{p.threshold}</div>
                <div className="px-3 py-3 font-mono text-[12px]"
                  style={{color: p.restock > 0 ? '#15803D' : '#999'}}>
                  {p.restock > 0 ? p.restock : '— (set in product)'}
                </div>
                <div className="px-3 py-3 font-mono text-[12px] text-[#666]">
                  ${(p.cost || 0).toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
