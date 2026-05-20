// src/pages/purchase-orders/PurchaseOrdersPage.jsx
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import CreatePOModal from './CreatePOModal'
import POReceiveModal from './POReceiveModal'
import LowStockPanel from './LowStockPanel'
import { ProductDetailInline } from '@/pages/products/ProductDetailInline'

const STATUS_BADGE = {
  draft:     { bg:'#F5F5F5', color:'#666', label:'Draft' },
  ordered:   { bg:'#E6F0FF', color:'#006AFF', label:'Ordered' },
  partial:   { bg:'#FEF3C7', color:'#B45309', label:'Partial' },
  received:  { bg:'#DCFCE7', color:'#15803D', label:'Received' },
  cancelled: { bg:'#FEE2E2', color:'#CF1322', label:'Cancelled' },
}

export default function PurchaseOrdersPage() {
  const { tenant, store } = useAuthStore()
  const qc = useQueryClient()
  const [showCreate, setShowCreate]     = useState(false)
  const [presetItems, setPresetItems]   = useState(null)  // pre-fill from low-stock
  const [receivingPo, setReceivingPo]   = useState(null)
  const [editingPo, setEditingPo]       = useState(null)  // edit an open PO
  const [detailProductId, setDetailProductId] = useState(null)  // product detail popup
  // Main view tab — 'lowstock' (reorder list) is the default since that's
  // the most common entry point; 'orders' shows the PO list.
  const [view, setView]                 = useState('lowstock')
  // Within the orders view: open vs history sub-tab.
  const [statusFilter, setStatusFilter] = useState('open')  // open | history | all
  const [search, setSearch]             = useState('')

  // ── List of POs (with vendor name joined) ──
  const { data: pos = [], isLoading } = useQuery({
    queryKey: ['purchase-orders-list', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_po_with_vendor')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(200)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const filtered = useMemo(() => {
    let list = pos
    if (statusFilter === 'open') {
      list = list.filter(p => ['draft', 'ordered', 'partial'].includes(p.status))
    } else if (statusFilter === 'history') {
      list = list.filter(p => ['received', 'cancelled'].includes(p.status))
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(p =>
        p.po_number?.toLowerCase().includes(q) ||
        p.vendor_name?.toLowerCase().includes(q)
      )
    }
    return list
  }, [pos, statusFilter, search])

  const counts = useMemo(() => ({
    all: pos.length,
    open: pos.filter(p => ['draft', 'ordered', 'partial'].includes(p.status)).length,
    history: pos.filter(p => ['received', 'cancelled'].includes(p.status)).length,
  }), [pos])

  // Build a PO from selected low-stock items
  const buildPOFromLowStock = (items) => {
    setPresetItems(items)
    setShowCreate(true)
    setView('orders')
  }

  return (
    <div className="max-w-[1200px] mx-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[22px] font-bold text-[#1F1F1F]">📋 Purchase Center</div>
          <div className="text-[12px] text-[#666] mt-1">
            Open <span className="text-[#006AFF] font-bold">{counts.open}</span> · History <span className="text-[#15803D] font-bold">{counts.history}</span>
          </div>
        </div>
        <button onClick={() => { setPresetItems(null); setShowCreate(true) }}
          className="rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
          + New Purchase Order
        </button>
      </div>

      {/* Top-level view tabs: Low-stock reorder (default) vs Orders list */}
      <div className="flex gap-2 mb-4 border-b border-[#E5E5E5]">
        <ViewTab active={view==='lowstock'} onClick={() => setView('lowstock')}>
          ⚠️ Low Stock · Reorder
        </ViewTab>
        <ViewTab active={view==='orders'} onClick={() => setView('orders')}>
          📋 Purchase Orders
        </ViewTab>
      </div>

      {view === 'lowstock' ? (
        <LowStockPanel onBuildPO={buildPOFromLowStock} onOpenDetail={setDetailProductId} />
      ) : (
      <>
      {/* Search + open/history filter */}
      <div className="mb-4 space-y-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search by PO number or vendor name..."
          className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-3 text-[14px] outline-none focus:border-[#006AFF]"/>

        <div className="flex gap-2">
          <FilterTab active={statusFilter==='open'} onClick={() => setStatusFilter('open')} count={counts.open} highlight>
            ⏳ Open
          </FilterTab>
          <FilterTab active={statusFilter==='history'} onClick={() => setStatusFilter('history')} count={counts.history}>
            📚 History
          </FilterTab>
          <FilterTab active={statusFilter==='all'} onClick={() => setStatusFilter('all')} count={counts.all}>
            All
          </FilterTab>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center text-[#666] text-[13px]">
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center">
          <div className="text-[48px] mb-2 opacity-30">📋</div>
          <div className="text-[14px] font-bold text-[#1F1F1F] mb-1">
            {pos.length === 0 ? 'No purchase orders yet' : 'No POs match your filter'}
          </div>
          {pos.length === 0 && (
            <button onClick={() => { setPresetItems(null); setShowCreate(true) }}
              className="mt-3 rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              Create your first PO
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
          {/* Header row */}
          <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]"
            style={{gridTemplateColumns:'1.3fr 1.3fr 1fr 1fr 1fr 1fr 1.5fr'}}>
            {['PO Number', 'Vendor', 'Items / Qty', 'Status', 'Order Date', 'Expected', 'Total / Action'].map(h => (
              <div key={h} className="px-3.5 py-2.5 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {filtered.map(po => {
            const st = STATUS_BADGE[po.status] || STATUS_BADGE.draft
            return (
              <div key={po.id}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA]"
                style={{gridTemplateColumns:'1.3fr 1.3fr 1fr 1fr 1fr 1fr 1.5fr'}}>
                <div className="px-3.5 py-3 font-mono text-[13px] font-bold text-[#006AFF]">
                  {po.po_number}
                </div>
                <div className="px-3.5 py-3 text-[13px] text-[#1F1F1F] truncate">
                  {po.vendor_name || '—'}
                </div>
                <div className="px-3.5 py-3 text-[12px] text-[#666]">
                  <span className="font-bold text-[#1F1F1F]">{po.item_count || 0}</span> items
                  <span className="text-[#999]"> · </span>
                  <span className="font-mono">{(po.total_qty || 0)} qty</span>
                </div>
                <div className="px-3.5 py-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{background:st.bg, color:st.color}}>
                    {st.label}
                  </span>
                </div>
                <div className="px-3.5 py-3 text-[12px] text-[#666]">
                  {po.ordered_at ? new Date(po.ordered_at).toLocaleDateString() : '—'}
                </div>
                <div className="px-3.5 py-3 text-[12px] text-[#666]">
                  {po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '—'}
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-1.5">
                  <span className="font-mono text-[13px] font-bold text-[#1F1F1F]">
                    ${(po.total || 0).toFixed(2)}
                  </span>
                  <button onClick={() => setReceivingPo(po)}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                    style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
                    Details ›
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      </>
      )}

      {/* Create PO modal */}
      {showCreate && (
        <CreatePOModal
          initialItems={presetItems}
          onClose={() => { setShowCreate(false); setPresetItems(null) }}
          onCreated={() => {
            setShowCreate(false)
            setPresetItems(null)
            qc.invalidateQueries({ queryKey: ['purchase-orders-list'] })
            qc.invalidateQueries({ queryKey: ['lowstock-list'] })
          }}
        />
      )}

      {/* Edit PO modal — reuses CreatePOModal in edit mode */}
      {editingPo && (
        <CreatePOModal
          editPo={editingPo}
          onClose={() => setEditingPo(null)}
          onCreated={() => {
            setEditingPo(null)
            qc.invalidateQueries({ queryKey: ['purchase-orders-list'] })
            qc.invalidateQueries({ queryKey: ['lowstock-list'] })
          }}
        />
      )}

      {/* View / receive PO modal */}
      {receivingPo && (
        <POReceiveModal
          po={receivingPo}
          onClose={() => setReceivingPo(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['purchase-orders-list'] })
            qc.invalidateQueries({ queryKey: ['stock-rows'] })
            qc.invalidateQueries({ queryKey: ['stock-summary'] })
            qc.invalidateQueries({ queryKey: ['lowstock-list'] })
          }}
        />
      )}

      {/* Product detail popup (from the low-stock list › button) */}
      {detailProductId && (
        <ProductDetailPopup
          productId={detailProductId}
          tenantId={tenant?.id}
          storeId={store?.id}
          onClose={() => setDetailProductId(null)}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['lowstock-list'] })}
        />
      )}
    </div>
  )
}

// Fetches the full product then shows ProductDetailInline in a centered popup
function ProductDetailPopup({ productId, tenantId, storeId, onClose, onRefresh }) {
  const { data: product } = useQuery({
    queryKey: ['po-detail-product', productId],
    queryFn: async () => {
      const { data } = await supabase.from('products')
        .select('*, inventory(quantity, avg_cost, store_id), subcategories(id, name, category_id, categories(id, name, emoji, color))')
        .eq('id', productId).single()
      return data
    },
    enabled: !!productId,
  })

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.5)'}} onClick={onClose}>
      <div className="bg-white rounded-2xl overflow-hidden shadow-2xl w-full max-w-[900px]"
        style={{maxHeight:'90vh'}} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E5E5]">
          <div className="text-[15px] font-bold text-[#1F1F1F]">{product?.name || 'Loading...'}</div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full border-none cursor-pointer text-[16px] flex items-center justify-center"
            style={{background:'#F5F5F5', color:'#666'}}>✕</button>
        </div>
        <div className="overflow-y-auto" style={{maxHeight:'calc(90vh - 56px)'}}>
          {product && (
            <ProductDetailInline product={product} tenantId={tenantId} storeId={storeId} onRefresh={onRefresh} />
          )}
        </div>
      </div>
    </div>
  )
}

function ViewTab({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className="px-4 py-2.5 text-[13px] font-bold cursor-pointer border-none bg-transparent relative"
      style={{ color: active ? '#006AFF' : '#666' }}>
      {children}
      {active && <div className="absolute left-0 right-0 -bottom-px h-0.5" style={{background:'#006AFF'}}/>}
    </button>
  )
}

function FilterTab({ active, onClick, count, highlight, children }) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 rounded-lg text-[13px] font-bold cursor-pointer active:scale-[0.96]"
      style={active
        ? { background:'#006AFF', color:'#FFFFFF', border:'none' }
        : { background:'#FFFFFF', color: highlight ? '#006AFF' : '#1F1F1F', border:'1px solid #E5E5E5' }}>
      {children} <span className="ml-1 opacity-75">({count})</span>
    </button>
  )
}
