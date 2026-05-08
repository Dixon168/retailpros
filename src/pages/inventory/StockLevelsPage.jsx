// src/pages/inventory/StockLevelsPage.jsx
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { NumericKeypad } from '@/components/ui/TouchKeyboards'

const ATTENTION_THRESHOLD = 5  // <= this counts as "low" in addition to product's own low_stock_qty

export default function StockLevelsPage() {
  const { tenant, store, user } = useAuthStore()
  const qc = useQueryClient()
  const [tab, setTab]       = useState('all')        // all | attention | normal
  const [search, setSearch] = useState('')
  const [sort, setSort]     = useState('low_first')  // low_first | high_first | name
  const [adjusting, setAdjusting] = useState(null)   // { product, mode: 'set'|'add'|'sub', currentQty }
  const [historyFor, setHistoryFor] = useState(null) // product object

  // Fetch all products with inventory
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['stock-levels', tenant?.id, store?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, type, low_stock_qty, image_url, category_id, categories(name), inventory!inner(quantity, store_id)')
        .eq('tenant_id', tenant.id)
        .eq('inventory.store_id', store.id)
        .neq('type', 'service')
        .order('name')
      if (error) throw error
      return (data || []).map(p => ({
        ...p,
        qty: p.inventory?.[0]?.quantity ?? 0,
        category_name: p.categories?.name || '',
      }))
    },
    enabled: !!tenant?.id && !!store?.id,
    refetchInterval: 30000,
  })

  // Categorize each row
  const classify = (r) => {
    const threshold = r.low_stock_qty || ATTENTION_THRESHOLD
    if (r.qty < 0) return 'negative'
    if (r.qty === 0) return 'oos'
    if (r.qty <= threshold) return 'low'
    return 'normal'
  }

  // Filter & sort
  const filtered = useMemo(() => {
    let list = rows
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.sku || '').toLowerCase().includes(q)
      )
    }
    if (tab !== 'all') {
      list = list.filter(r => {
        const c = classify(r)
        if (tab === 'attention') return c !== 'normal'
        if (tab === 'normal') return c === 'normal'
        return true
      })
    }
    list = [...list]
    if (sort === 'low_first') list.sort((a, b) => a.qty - b.qty)
    else if (sort === 'high_first') list.sort((a, b) => b.qty - a.qty)
    else list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return list
  }, [rows, search, tab, sort])

  // Counts for tab badges
  const counts = useMemo(() => {
    const out = { all: rows.length, attention: 0, normal: 0 }
    rows.forEach(r => {
      const c = classify(r)
      if (c === 'normal') out.normal++
      else out.attention++
    })
    return out
  }, [rows])

  // Quick adjust by ±1
  const quickAdjust = async (product, delta) => {
    const newQty = (product.qty || 0) + delta
    const { data, error } = await supabase.rpc('fn_adjust_inventory', {
      p_tenant_id:  tenant.id,
      p_store_id:   store.id,
      p_product_id: product.id,
      p_new_qty:    newQty,
      p_reason:     delta > 0 ? 'Quick +1' : 'Quick -1',
      p_notes:      null,
      p_user_id:    user?.id || null,
    })
    if (error) { toast.error(error.message); return }
    if (!data?.success) { toast.error(data?.message || 'Failed'); return }
    toast.success(`${product.name}: ${product.qty} → ${newQty}`)
    qc.invalidateQueries({ queryKey: ['stock-levels'] })
  }

  if (isLoading) {
    return <div className="p-8 text-center text-[#666]">Loading...</div>
  }

  return (
    <div className="max-w-[1100px] mx-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[22px] font-bold text-[#1F1F1F]">📦 Stock Levels</div>
          <div className="text-[12px] text-[#666] mt-1">
            Total {counts.all} · Need attention <span className="text-[#CF1322] font-bold">{counts.attention}</span> · Normal <span className="text-[#15803D] font-bold">{counts.normal}</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="🔍 Search by name or SKU..."
        className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-3 text-[14px] outline-none focus:border-[#006AFF] mb-3"/>

      {/* Tabs + Sort */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-2">
          <TabBtn active={tab==='all'} onClick={() => setTab('all')} count={counts.all}>All</TabBtn>
          <TabBtn active={tab==='attention'} onClick={() => setTab('attention')} count={counts.attention} alert>⚠️ Need attention</TabBtn>
          <TabBtn active={tab==='normal'} onClick={() => setTab('normal')} count={counts.normal}>✅ Normal</TabBtn>
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg px-3 py-2 text-[12px] outline-none cursor-pointer">
          <option value="low_first">Stock low → high</option>
          <option value="high_first">Stock high → low</option>
          <option value="name">Name A → Z</option>
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center text-[#666]">
          {search ? 'No products match your search' : 'No products in this category'}
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
          {filtered.map((p, i) => (
            <StockRow
              key={p.id} product={p} cls={classify(p)}
              onQuickAdjust={(delta) => quickAdjust(p, delta)}
              onSet={() => setAdjusting({ product: p, currentQty: p.qty })}
              onHistory={() => setHistoryFor(p)}
              isLast={i === filtered.length - 1}
            />
          ))}
        </div>
      )}

      {/* Adjust modal */}
      {adjusting && (
        <AdjustModal
          product={adjusting.product}
          currentQty={adjusting.currentQty}
          tenantId={tenant.id} storeId={store.id} userId={user?.id}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null)
            qc.invalidateQueries({ queryKey: ['stock-levels'] })
          }}
        />
      )}

      {/* History modal */}
      {historyFor && (
        <HistoryModal product={historyFor} tenantId={tenant.id} onClose={() => setHistoryFor(null)}/>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────
function TabBtn({ active, onClick, count, alert, children }) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 rounded-lg text-[13px] font-bold cursor-pointer active:scale-[0.96] transition-all"
      style={active
        ? { background:'#006AFF', color:'#FFFFFF', border:'none' }
        : { background:'#FFFFFF', color: alert ? '#CF1322' : '#1F1F1F', border:'1px solid #E5E5E5' }}>
      {children} <span className="ml-1 opacity-75">({count})</span>
    </button>
  )
}

// ────────────────────────────────────────────────
function StockRow({ product, cls, onQuickAdjust, onSet, onHistory, isLast }) {
  const badge = {
    negative: { bg:'#FEE2E2', color:'#CF1322', dot:'#CF1322', label: `${product.qty}` },
    oos:      { bg:'#FEE2E2', color:'#CF1322', dot:'#CF1322', label: 'Out' },
    low:      { bg:'#FEF3C7', color:'#B45309', dot:'#F59E0B', label: `${product.qty}` },
    normal:   { bg:'#DCFCE7', color:'#15803D', dot:'#15803D', label: `${product.qty}` },
  }[cls]

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${!isLast ? 'border-b border-[#E5E5E5]' : ''}`}>
      {/* Image */}
      <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
        style={{ background:'#F5F5F5', border:'1px solid #E5E5E5' }}>
        {product.image_url
          ? <img src={product.image_url} alt="" className="w-full h-full object-cover"/>
          : <span className="text-[14px] font-bold text-[#999]">{product.name?.substring(0,2).toUpperCase()}</span>}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-[#1F1F1F] truncate">{product.name}</div>
        <div className="text-[11px] text-[#666] mt-0.5 truncate">
          {product.sku || '—'}{product.category_name ? ` · ${product.category_name}` : ''}
        </div>
      </div>

      {/* Stock badge */}
      <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg flex-shrink-0"
        style={{ background: badge.bg, color: badge.color }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: badge.dot }}/>
        <span className="text-[13px] font-bold font-mono">{badge.label}</span>
      </div>

      {/* Actions */}
      <div className="flex gap-1 flex-shrink-0">
        <button onClick={() => onQuickAdjust(-1)} title="Decrease by 1"
          className="w-9 h-9 rounded-lg text-[16px] font-bold cursor-pointer active:scale-[0.96]"
          style={{ background:'#FEE2E2', color:'#CF1322', border:'1px solid #FECACA' }}>−</button>
        <button onClick={() => onQuickAdjust(1)} title="Increase by 1"
          className="w-9 h-9 rounded-lg text-[16px] font-bold cursor-pointer active:scale-[0.96]"
          style={{ background:'#DCFCE7', color:'#15803D', border:'1px solid #BBF7D0' }}>+</button>
        <button onClick={onSet}
          className="px-3 h-9 rounded-lg text-[12px] font-bold cursor-pointer active:scale-[0.96]"
          style={{ background:'#006AFF', color:'#FFFFFF', border:'none' }}>Set</button>
        <button onClick={onHistory}
          className="w-9 h-9 rounded-lg text-[14px] cursor-pointer active:scale-[0.96]"
          style={{ background:'#F5F5F5', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>📜</button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
const REASONS = ['Damage / loss', 'Stocktake', 'Return to vendor', 'Gift / sample', 'Found stock', 'Other']

function AdjustModal({ product, currentQty, tenantId, storeId, userId, onClose, onSaved }) {
  const [newQty, setNewQty]     = useState(String(currentQty))
  const [reason, setReason]     = useState('')
  const [notes, setNotes]       = useState('')
  const [showPad, setShowPad]   = useState(false)
  const [saving, setSaving]     = useState(false)

  const change = (parseFloat(newQty) || 0) - currentQty

  const save = async () => {
    setSaving(true)
    const { data, error } = await supabase.rpc('fn_adjust_inventory', {
      p_tenant_id:  tenantId,
      p_store_id:   storeId,
      p_product_id: product.id,
      p_new_qty:    parseFloat(newQty) || 0,
      p_reason:     reason || null,
      p_notes:      notes || null,
      p_user_id:    userId || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Stock updated: ${product.name}`)
    onSaved()
  }

  return (
    <>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4"
        style={{background:'rgba(0,0,0,0.45)'}}>
        <div className="rounded-2xl overflow-hidden" style={{
          width:'440px', maxWidth:'100%', background:'#FFFFFF',
          boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
        }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-center justify-between" style={{borderBottom:'1px solid #E5E5E5'}}>
            <div>
              <div className="text-[11px] font-semibold text-[#666] uppercase tracking-wider">Adjust Stock</div>
              <div className="text-[16px] font-bold text-[#1F1F1F] truncate" style={{maxWidth:'320px'}}>{product.name}</div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
              style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          <div className="p-5 space-y-4">
            {/* Current */}
            <div className="flex items-center justify-between bg-[#F5F5F5] rounded-lg px-4 py-3">
              <span className="text-[12px] text-[#666] font-semibold">Current stock</span>
              <span className="text-[18px] font-bold font-mono text-[#1F1F1F]">{currentQty}</span>
            </div>

            {/* New qty (tap to open keypad) */}
            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">New quantity</div>
              <button onClick={() => setShowPad(true)}
                className="w-full text-left px-4 py-3 rounded-lg cursor-pointer"
                style={{background:'#F5F5F5', border:'2px solid #006AFF'}}>
                <div className="text-[10px] text-[#006AFF] font-bold uppercase">Tap to edit</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[26px] font-bold font-mono text-[#1F1F1F]">{newQty || '0'}</span>
                  {change !== 0 && (
                    <span className="text-[13px] font-bold font-mono"
                      style={{color: change > 0 ? '#15803D' : '#CF1322'}}>
                      ({change > 0 ? '+' : ''}{change})
                    </span>
                  )}
                </div>
              </button>
            </div>

            {/* Reason (optional) */}
            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Reason <span className="font-normal text-[#999]">(optional)</span></div>
              <div className="grid grid-cols-2 gap-1.5">
                {REASONS.map(r => (
                  <button key={r} onClick={() => setReason(reason === r ? '' : r)}
                    className="px-2 py-2 rounded-lg text-[11px] font-semibold cursor-pointer active:scale-[0.96]"
                    style={reason === r
                      ? {background:'#E6F0FF', border:'1px solid #006AFF', color:'#006AFF'}
                      : {background:'#FFFFFF', border:'1px solid #E5E5E5', color:'#1F1F1F'}}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Notes <span className="font-normal text-[#999]">(optional)</span></div>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Anything to remember about this adjustment..."
                className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-[#006AFF]"/>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onClose}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer active:scale-[0.98]"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              Cancel
            </button>
            <button onClick={save} disabled={saving || newQty === String(currentQty)}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40 active:scale-[0.98]"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              {saving ? 'Saving...' : 'Save Adjustment'}
            </button>
          </div>
        </div>
      </div>

      {showPad && (
        <NumericKeypad
          value={newQty}
          onChange={setNewQty}
          onClose={() => setShowPad(false)}
          title="New Stock Quantity"
          placeholder="0"
          formatPhone={false}
          allowPlus={false}
        />
      )}
    </>
  )
}

// ────────────────────────────────────────────────
function HistoryModal({ product, tenantId, onClose }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['inv-adj-history', product.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_adjustments')
        .select('id, qty_change, qty_before, qty_after, reason, notes, created_at, adjusted_by, users(name, email)')
        .eq('tenant_id', tenantId)
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data || []
    },
  })

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.45)'}}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width:'520px', maxWidth:'100%', maxHeight:'88vh', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
      }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div>
            <div className="text-[11px] font-semibold text-[#666] uppercase tracking-wider">Stock History</div>
            <div className="text-[16px] font-bold text-[#1F1F1F] truncate" style={{maxWidth:'400px'}}>{product.name}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="p-8 text-center text-[#666] text-[13px]">Loading...</div>
          ) : history.length === 0 ? (
            <div className="p-12 text-center text-[#666] text-[13px]">
              <div className="text-[36px] mb-2">📭</div>
              No adjustments yet
            </div>
          ) : (
            <div className="space-y-2">
              {history.map(h => {
                const isPositive = h.qty_change >= 0
                return (
                  <div key={h.id} className="rounded-lg p-3"
                    style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold font-mono"
                          style={{color: isPositive ? '#15803D' : '#CF1322'}}>
                          {isPositive ? '+' : ''}{h.qty_change}
                        </span>
                        <span className="text-[11px] text-[#666] font-mono">
                          ({h.qty_before} → {h.qty_after})
                        </span>
                      </div>
                      <span className="text-[10px] text-[#999]">
                        {new Date(h.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {h.reason && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-semibold"
                          style={{background:'#E6F0FF', color:'#006AFF'}}>
                          {h.reason}
                        </span>
                      )}
                      {h.users?.name && (
                        <span className="text-[11px] text-[#666]">by {h.users.name}</span>
                      )}
                    </div>
                    {h.notes && (
                      <div className="text-[11px] text-[#666] mt-1.5 italic">"{h.notes}"</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex-shrink-0" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="w-full rounded-lg py-3 text-[13px] font-bold cursor-pointer active:scale-[0.98]"
            style={{background:'#1F1F1F', color:'#FFFFFF', border:'none'}}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
