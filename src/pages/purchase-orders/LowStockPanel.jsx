// src/pages/purchase-orders/LowStockPanel.jsx
//
// Low-stock reorder list inside Purchase Center.
// Columns: checkbox · Product (name + UPC) · Price · In Stock · Reorder Qty
//          (editable) · details (>)
// Select rows → edit each reorder qty inline → "Build PO from selected"
// hands the chosen items (with the edited quantities) to CreatePOModal.
//
// Low-stock definition: inventory.quantity <= products.low_stock_qty

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

export default function LowStockPanel({ onBuildPO, onOpenDetail }) {
  const { tenant, store } = useAuthStore()
  const [selected, setSelected] = useState({})   // { product_id: true }
  const [qtyEdits, setQtyEdits] = useState({})    // { product_id: '12' } — edited reorder qty

  const { data: lowStock = [], isLoading } = useQuery({
    queryKey: ['lowstock-list', tenant?.id, store?.id],
    queryFn: async () => {
      const { data: products } = await supabase.from('products')
        .select('id, name, sku, upc, price, cost, low_stock_qty, auto_restock_qty, type')
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

  // Seed the editable reorder qty: use auto_restock_qty, or enough to get
  // back up to threshold+1, or 1 as a floor.
  useEffect(() => {
    if (!lowStock.length) return
    setQtyEdits(prev => {
      const next = { ...prev }
      lowStock.forEach(p => {
        if (next[p.id] === undefined) {
          const suggested = p.restock > 0
            ? p.restock
            : Math.max(1, (p.threshold + 1) - p.stock)
          next[p.id] = String(suggested)
        }
      })
      return next
    })
  }, [lowStock])

  const selectedCount = Object.values(selected).filter(Boolean).length
  const allSelected = lowStock.length > 0 && selectedCount === lowStock.length

  const toggleAll = () => {
    if (allSelected) { setSelected({}); return }
    const next = {}
    lowStock.forEach(p => { next[p.id] = true })
    setSelected(next)
  }
  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }))
  const setQty = (id, v) => setQtyEdits(e => ({ ...e, [id]: v.replace(/[^\d]/g, '') }))

  const buildPO = () => {
    const items = lowStock
      .filter(p => selected[p.id])
      .map(p => ({
        product_id:   p.id,
        product_name: p.name,
        product_sku:  p.sku,
        quantity:     String(parseInt(qtyEdits[p.id]) || 1),
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
          {/* Header: checkbox · Product · UPC · Price · In Stock · Reorder Qty · > */}
          <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5] items-center"
            style={{gridTemplateColumns:'40px 2fr 1.3fr 0.9fr 0.9fr 1.1fr 44px'}}>
            <div className="px-3 py-2.5 flex items-center justify-center">
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                className="w-4 h-4 cursor-pointer" style={{accentColor:'#006AFF'}}/>
            </div>
            {['Product', 'UPC', 'Price', 'In Stock', 'Reorder Qty', ''].map((h,i) => (
              <div key={i} className="px-3 py-2.5 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {lowStock.map(p => {
            const isOut = p.stock <= 0
            const checked = !!selected[p.id]
            return (
              <div key={p.id}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] items-center"
                style={{gridTemplateColumns:'40px 2fr 1.3fr 0.9fr 0.9fr 1.1fr 44px',
                        background: checked ? '#F0F7FF' : undefined}}>
                {/* Checkbox */}
                <div className="px-3 py-3 flex items-center justify-center cursor-pointer" onClick={() => toggle(p.id)}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(p.id)}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 cursor-pointer" style={{accentColor:'#006AFF'}}/>
                </div>
                {/* Product name + sku */}
                <div className="px-3 py-3 cursor-pointer" onClick={() => toggle(p.id)}>
                  <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{p.name}</div>
                  {p.sku && <div className="text-[10px] text-[#999] font-mono">SKU {p.sku}</div>}
                </div>
                {/* UPC */}
                <div className="px-3 py-3 font-mono text-[12px] text-[#666] truncate">
                  {p.upc || '—'}
                </div>
                {/* Price */}
                <div className="px-3 py-3 font-mono text-[12px] text-[#1F1F1F]">
                  ${(p.price || 0).toFixed(2)}
                </div>
                {/* In Stock */}
                <div className="px-3 py-3">
                  <span className="font-mono text-[13px] font-bold"
                    style={{color: isOut ? '#CF1322' : '#B45309'}}>
                    {p.stock}{isOut && ' ⚠️'}
                  </span>
                </div>
                {/* Reorder Qty — editable */}
                <div className="px-3 py-3">
                  <input
                    value={qtyEdits[p.id] ?? ''}
                    onChange={e => setQty(p.id, e.target.value)}
                    onClick={e => e.stopPropagation()}
                    inputMode="numeric" placeholder="0"
                    className="w-16 rounded-lg px-2 py-1.5 text-[13px] font-mono font-bold text-center outline-none focus:border-[#006AFF]"
                    style={{border:'1.5px solid #E5E5E5', background:'#fff', color:'#15803D'}}/>
                </div>
                {/* Detail > */}
                <div className="px-2 py-3 flex items-center justify-center">
                  <button onClick={(e) => { e.stopPropagation(); onOpenDetail?.(p.id) }}
                    title="View details"
                    className="w-7 h-7 rounded-lg cursor-pointer border flex items-center justify-center text-[14px] text-[#666] hover:bg-[#F0F7FF] hover:text-[#006AFF]"
                    style={{borderColor:'#E5E5E5', background:'#fff'}}>
                    ›
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
