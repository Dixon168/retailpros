// src/pages/inventory/StockLevelsPage.jsx
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { NumericKeypad } from '@/components/ui/TouchKeyboards'
import StockDetailPanel from './StockDetailPanel'
import CreatePOModal from '@/pages/purchase-orders/CreatePOModal'

const ATTENTION_THRESHOLD = 5  // <= this counts as "low" in addition to product's own low_stock_qty
const PAGE_LIMIT = 500         // search/category cap — Supabase server-side max anyway is 1000
const ALL_TAB_LIMIT = 5000     // 'All' tab: high cap, virtualized for perf

export default function StockLevelsPage() {
  const { tenant, store, user } = useAuthStore()
  const qc = useQueryClient()
  const [tab, setTab]               = useState('attention')  // attention | search | category | all
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]         = useState('')           // debounced
  const [categoryId, setCategoryId] = useState('')
  const [sort, setSort]             = useState('low_first')
  const [adjusting, setAdjusting]   = useState(null)
  const [historyFor, setHistoryFor] = useState(null)
  const [detailFor, setDetailFor]   = useState(null)  // product currently shown in side panel
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showCreatePO, setShowCreatePO] = useState(false)

  // ── Auto-open detail panel if URL has ?focus=PRODUCT_ID ──
  useEffect(() => {
    const url = new URL(window.location.href)
    const focusId = url.searchParams.get('focus')
    if (!focusId || !tenant?.id || !store?.id) return
    ;(async () => {
      const { data } = await supabase.from('products')
        .select('id, name, sku, type, low_stock_qty, image_url, category_id')
        .eq('id', focusId).maybeSingle()
      if (data) {
        const { data: inv } = await supabase.from('inventory')
          .select('quantity').eq('product_id', focusId).eq('store_id', store.id).maybeSingle()
        setDetailFor({ ...data, qty: inv?.quantity ?? 0 })
        // Clean the URL so refresh doesn't re-trigger
        url.searchParams.delete('focus')
        window.history.replaceState({}, '', url.toString())
      }
    })()
  }, [tenant?.id, store?.id])

  // Debounce search input (only fire query 400ms after typing stops, min 2 chars)
  useEffect(() => {
    const t = setTimeout(() => {
      const q = searchInput.trim()
      setSearch(q.length >= 2 ? q : '')
    }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  // ── Categories list (always loaded — small) ──
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories')
        .select('id, name')
        .eq('tenant_id', tenant.id)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
  })

  // ── Summary counts (small query — gets ALL inventory rows for this store) ──
  const { data: summary = { total: 0, attention: 0, normal: 0 } } = useQuery({
    queryKey: ['stock-summary', tenant?.id, store?.id],
    queryFn: async () => {
      // Count total products (excluding services)
      const { count: total } = await supabase.from('products')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .neq('type', 'service')

      // Get inventory + thresholds (need both to classify "attention")
      const { data: inv } = await supabase.from('inventory')
        .select('product_id, quantity, products!inner(low_stock_qty, type)')
        .eq('tenant_id', tenant.id)
        .eq('store_id', store.id)

      let attention = 0
      ;(inv || []).forEach(r => {
        if (r.products?.type === 'service') return
        const t = r.products?.low_stock_qty || ATTENTION_THRESHOLD
        if (r.quantity <= t) attention++
      })
      return { total: total || 0, attention, normal: (total || 0) - attention }
    },
    enabled: !!tenant?.id && !!store?.id,
    staleTime: 30000,
    refetchInterval: 60000,
  })

  // ── Build the right query depending on tab ──
  // 'attention' → query inventory rows where qty <= threshold
  // 'search'    → search products by name/sku
  // 'category'  → products in selected category
  // 'all'       → first 500 products (with warning)
  const queryMode = search ? 'search'
                  : tab === 'attention' ? 'attention'
                  : categoryId ? 'category'
                  : tab === 'all' ? 'all'
                  : 'idle'  // nothing to show — empty state

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: ['stock-rows', tenant?.id, store?.id, queryMode, search, categoryId, tab],
    queryFn: async () => {
      if (queryMode === 'idle') return []

      // Build product query
      let pq = supabase.from('products')
        .select('id, name, sku, type, low_stock_qty, image_url, category_id')
        .eq('tenant_id', tenant.id)
        .neq('type', 'service')

      if (queryMode === 'search') {
        pq = pq.or(`name.ilike.%${search}%,sku.ilike.%${search}%`).limit(PAGE_LIMIT)
      } else if (queryMode === 'category') {
        pq = pq.eq('category_id', categoryId).limit(PAGE_LIMIT)
      } else if (queryMode === 'attention') {
        // Get product_ids that have low/zero/negative stock first
        const { data: lowInv } = await supabase.from('inventory')
          .select('product_id, quantity, products!inner(low_stock_qty, type)')
          .eq('tenant_id', tenant.id)
          .eq('store_id', store.id)
        const ids = (lowInv || [])
          .filter(r => {
            if (r.products?.type === 'service') return false
            const t = r.products?.low_stock_qty || ATTENTION_THRESHOLD
            return r.quantity <= t
          })
          .map(r => r.product_id)
        if (ids.length === 0) return []
        pq = pq.in('id', ids).limit(PAGE_LIMIT)
      } else {
        // 'all' mode — uses ALL_TAB_LIMIT (virtualized in render)
        pq = pq.order('name').limit(ALL_TAB_LIMIT)
      }

      const [productsRes, inventoryRes] = await Promise.all([
        pq,
        supabase.from('inventory')
          .select('product_id, quantity')
          .eq('tenant_id', tenant.id)
          .eq('store_id', store.id),
      ])

      if (productsRes.error) throw productsRes.error

      const stockMap = {}
      ;(inventoryRes.data || []).forEach(i => { stockMap[i.product_id] = i.quantity })

      const catMap = {}
      categories.forEach(c => { catMap[c.id] = c.name })

      return (productsRes.data || []).map(p => ({
        ...p,
        qty: stockMap[p.id] ?? 0,
        category_name: catMap[p.category_id] || '',
        hasInventoryRecord: stockMap[p.id] !== undefined,
      }))
    },
    enabled: !!tenant?.id && !!store?.id && queryMode !== 'idle',
    staleTime: 15000,
  })

  // Categorize each row
  const classify = (r) => {
    const threshold = r.low_stock_qty || ATTENTION_THRESHOLD
    if (r.qty < 0) return 'negative'
    if (r.qty === 0) return 'oos'
    if (r.qty <= threshold) return 'low'
    return 'normal'
  }

  // Sort the loaded rows
  const sorted = useMemo(() => {
    const list = [...rows]
    if (sort === 'low_first') list.sort((a, b) => a.qty - b.qty)
    else if (sort === 'high_first') list.sort((a, b) => b.qty - a.qty)
    else list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return list
  }, [rows, sort])

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
    qc.invalidateQueries({ queryKey: ['stock-rows'] })
    qc.invalidateQueries({ queryKey: ['stock-summary'] })
  }

  return (
    <div className="max-w-[1100px] mx-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[22px] font-bold text-[#1F1F1F]">📦 Stock Center</div>
          <div className="text-[12px] text-[#666] mt-1">
            Total {summary.total} · Need attention <span className="text-[#CF1322] font-bold">{summary.attention}</span> · Normal <span className="text-[#15803D] font-bold">{summary.normal}</span>
          </div>
        </div>
        <button onClick={() => window.location.href = '/smart-receive'}
          className="rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
          🤖 Smart Receive
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
          placeholder="🔍 Search by name or SKU (type 2+ characters)..."
          className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-3 text-[14px] outline-none focus:border-[#006AFF]"/>
        {searchInput && (
          <button onClick={() => { setSearchInput(''); setSearch('') }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-[12px] cursor-pointer"
            style={{background:'#E5E5E5', color:'#666', border:'none'}}>✕</button>
        )}
      </div>

      {/* Filters: Tab + Category + Sort */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <TabBtn active={tab==='attention' && !search && !categoryId}
          onClick={() => { setTab('attention'); setCategoryId(''); setSearchInput(''); setSearch('') }}
          count={summary.attention} alert>
          ⚠️ Attention
        </TabBtn>
        <TabBtn active={tab==='all' && !search && !categoryId}
          onClick={() => { setTab('all'); setCategoryId(''); setSearchInput(''); setSearch('') }}>
          All ({summary.total})
        </TabBtn>

        <select value={categoryId}
          onChange={e => { setCategoryId(e.target.value); setTab(''); setSearchInput(''); setSearch('') }}
          className="border rounded-lg px-3 py-2 text-[12px] font-bold outline-none cursor-pointer"
          style={{
            background:'#FFFFFF',
            color: categoryId ? '#006AFF' : '#1F1F1F',
            borderColor: categoryId ? '#006AFF' : '#E5E5E5'
          }}>
          <option value="">📁 All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>📁 {c.name}</option>)}
        </select>

        <div className="ml-auto">
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg px-3 py-2 text-[12px] outline-none cursor-pointer">
            <option value="low_first">Stock low → high</option>
            <option value="high_first">Stock high → low</option>
            <option value="name">Name A → Z</option>
          </select>
        </div>
      </div>

      {/* Active filter pill */}
      {(search || categoryId) && (
        <div className="mb-3 text-[12px] text-[#666] flex items-center gap-2 flex-wrap">
          <span className="font-bold">Showing:</span>
          {search && (
            <span className="px-2 py-1 rounded font-bold" style={{background:'#E6F0FF', color:'#006AFF'}}>
              🔍 "{search}"
            </span>
          )}
          {categoryId && (
            <span className="px-2 py-1 rounded font-bold" style={{background:'#E6F0FF', color:'#006AFF'}}>
              📁 {categories.find(c => c.id === categoryId)?.name}
            </span>
          )}
          <button onClick={() => { setSearchInput(''); setSearch(''); setCategoryId(''); setTab('attention') }}
            className="text-[#CF1322] font-bold cursor-pointer hover:underline"
            style={{background:'none', border:'none', padding:0}}>
            Clear
          </button>
        </div>
      )}

      {/* Selection action bar (shows when items selected) */}
      {selectedIds.size > 0 && (
        <div className="mb-3 rounded-xl px-4 py-3 flex items-center gap-3"
          style={{background:'#E6F0FF', border:'1px solid #006AFF'}}>
          <div className="flex-1">
            <div className="text-[13px] font-bold text-[#006AFF]">
              {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} selected
            </div>
            <div className="text-[11px] text-[#666]">
              Create purchase orders to restock these items
            </div>
          </div>
          <button onClick={() => setSelectedIds(new Set())}
            className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Clear
          </button>
          <button onClick={() => setShowCreatePO(true)}
            className="rounded-lg px-4 py-2 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
            style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
            📋 Create Purchase Order →
          </button>
        </div>
      )}

      {/* List / Empty / Loading */}
      {queryMode === 'idle' ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center">
          <div className="text-[48px] mb-2">📦</div>
          <div className="text-[16px] font-bold text-[#1F1F1F] mb-1">Search to begin</div>
          <div className="text-[13px] text-[#666] max-w-[400px] mx-auto">
            With {summary.total} products, type a name/SKU above, pick a category, or click <span className="font-bold">⚠️ Attention</span> to see items that need help.
          </div>
        </div>
      ) : isLoading || isFetching ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center text-[#666] text-[13px]">
          Loading...
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center">
          <div className="text-[48px] mb-2">{tab === 'attention' ? '🎉' : '🤷'}</div>
          <div className="text-[14px] font-bold text-[#1F1F1F] mb-1">
            {search ? 'No products match this search'
             : tab === 'attention' ? 'All stock looks good!'
             : 'No products in this filter'}
          </div>
          <div className="text-[12px] text-[#666]">
            {search ? 'Try a shorter search'
             : tab === 'attention' ? 'Nothing needs your attention right now.'
             : 'Try a different category'}
          </div>
        </div>
      ) : (
        <>
          {sorted.length >= PAGE_LIMIT && queryMode !== 'all' && (
            <div className="mb-3 rounded-lg px-4 py-3 text-[12px]"
              style={{background:'#FEF3C7', border:'1px solid #FCD34D', color:'#B45309'}}>
              ⚠️ Showing first {PAGE_LIMIT} results. Refine search or category to narrow down.
            </div>
          )}
          {sorted.length >= ALL_TAB_LIMIT && queryMode === 'all' && (
            <div className="mb-3 rounded-lg px-4 py-3 text-[12px]"
              style={{background:'#FEF3C7', border:'1px solid #FCD34D', color:'#B45309'}}>
              ⚠️ Hit the {ALL_TAB_LIMIT}-row cap. If you have more, use search or category.
            </div>
          )}
          <VirtualList rows={sorted} classify={classify}
            onQuickAdjust={quickAdjust}
            onSet={(p) => setAdjusting({ product: p, currentQty: p.qty })}
            onHistory={(p) => setHistoryFor(p)}
            onOpen={(p) => setDetailFor(p)}
            selectedIds={selectedIds}
            onToggleSelect={(id) => {
              setSelectedIds(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }}/>
        </>
      )}

      {/* Side panel — Stock detail */}
      {detailFor && (
        <StockDetailPanel
          product={detailFor}
          onClose={() => setDetailFor(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['stock-rows'] })
            qc.invalidateQueries({ queryKey: ['stock-summary'] })
          }}
        />
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

      {/* Create PO from selection */}
      {showCreatePO && (
        <CreatePOModal
          initialItems={
            sorted
              .filter(p => selectedIds.has(p.id))
              .map(p => ({
                product_id:   p.id,
                product_name: p.name,
                product_sku:  p.sku,
                quantity:     '1',
                unit_cost:    String(p.cost || 0),
              }))
          }
          onClose={() => setShowCreatePO(false)}
          onCreated={() => {
            setShowCreatePO(false)
            setSelectedIds(new Set())
            toast.success('Purchase order created — view it under Purchase Orders')
            qc.invalidateQueries({ queryKey: ['stock-rows'] })
          }}
        />
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
// ────────────────────────────────────────────────
// VirtualList — incremental rendering for large lists.
// Renders first 100, then loads 100 more on demand. Keeps DOM small
// and scroll smooth even when there are thousands of rows.
function VirtualList({ rows, classify, onQuickAdjust, onSet, onHistory, onOpen, selectedIds, onToggleSelect }) {
  const [visibleCount, setVisibleCount] = useState(100)

  // Reset visible count whenever filter changes (different list arrives)
  useEffect(() => { setVisibleCount(100) }, [rows.length, rows[0]?.id])

  const visible = rows.slice(0, visibleCount)
  const hasMore = visibleCount < rows.length

  return (
    <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
      {visible.map((p, i) => (
        <StockRow
          key={p.id} product={p} cls={classify(p)}
          onQuickAdjust={(delta) => onQuickAdjust(p, delta)}
          onSet={() => onSet(p)}
          onHistory={() => onHistory(p)}
          onOpen={() => onOpen(p)}
          isSelected={selectedIds?.has(p.id)}
          onToggleSelect={onToggleSelect ? () => onToggleSelect(p.id) : null}
          isLast={i === visible.length - 1 && !hasMore}
        />
      ))}
      {hasMore && (
        <button onClick={() => setVisibleCount(c => c + 100)}
          className="w-full px-4 py-3 text-[13px] font-bold cursor-pointer active:scale-[0.99]"
          style={{background:'#F5F5F5', color:'#006AFF', border:'none', borderTop:'1px solid #E5E5E5'}}>
          Show 100 more · {rows.length - visibleCount} remaining
        </button>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────
function StockRow({ product, cls, onQuickAdjust, onSet, onHistory, onOpen, isLast, isSelected, onToggleSelect }) {
  const badge = {
    negative: { bg:'#FEE2E2', color:'#CF1322', dot:'#CF1322', label: `${product.qty}` },
    oos:      { bg:'#FEE2E2', color:'#CF1322', dot:'#CF1322', label: 'Out' },
    low:      { bg:'#FEF3C7', color:'#B45309', dot:'#F59E0B', label: `${product.qty}` },
    normal:   { bg:'#DCFCE7', color:'#15803D', dot:'#15803D', label: `${product.qty}` },
  }[cls]

  return (
    <div className={`flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] transition-colors ${!isLast ? 'border-b border-[#E5E5E5]' : ''}`}
      style={isSelected ? { background:'#E6F0FF' } : {}}>
      {/* Checkbox for batch PO selection */}
      {onToggleSelect && (
        <button onClick={(e) => { e.stopPropagation(); onToggleSelect() }}
          className="w-5 h-5 rounded flex items-center justify-center cursor-pointer flex-shrink-0 transition-all"
          style={isSelected
            ? { background:'#006AFF', border:'2px solid #006AFF', color:'#FFFFFF' }
            : { background:'#FFFFFF', border:'2px solid #E5E5E5', color:'transparent' }}>
          <span className="text-[11px] font-bold leading-none">✓</span>
        </button>
      )}

      {/* Clickable area: image + info opens detail panel */}
      <div onClick={onOpen} className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
        <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
          style={{ background:'#F5F5F5', border:'1px solid #E5E5E5' }}>
          {product.image_url
            ? <img src={product.image_url} alt="" className="w-full h-full object-cover"/>
            : <span className="text-[14px] font-bold text-[#999]">{product.name?.substring(0,2).toUpperCase()}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-[#1F1F1F] truncate">{product.name}</div>
          <div className="text-[11px] text-[#666] mt-0.5 truncate">
            {product.sku || '—'}{product.category_name ? ` · ${product.category_name}` : ''}
          </div>
        </div>
      </div>

      {/* Stock badge — also clickable */}
      <div onClick={onOpen} className="flex items-center gap-1 px-2.5 py-1 rounded-lg flex-shrink-0 cursor-pointer"
        style={{ background: badge.bg, color: badge.color }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: badge.dot }}/>
        <span className="text-[13px] font-bold font-mono">{badge.label}</span>
      </div>

      {/* Open detail panel */}
      <button onClick={onOpen}
        className="w-9 h-9 rounded-lg text-[16px] cursor-pointer active:scale-[0.96] flex-shrink-0"
        style={{ background:'#F5F5F5', color:'#666', border:'1px solid #E5E5E5' }}
        title="Manage this item">›</button>
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
