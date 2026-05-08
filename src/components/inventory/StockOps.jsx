// src/components/inventory/StockOps.jsx
// Reusable inventory operations: Receive, Count, Write off, History
// Used by Stock Center side panel AND Products page StockPanel.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { NumericKeypad, QWERTYKeyboard } from '@/components/ui/TouchKeyboards'
import { ReceiveModal } from '@/pages/products/ReceiveModal'

// ────────────────────────────────────────────────
// Main entry — 4 buttons in a 2x2 grid
// ────────────────────────────────────────────────
export function StockOpsButtons({ product, currentQty, onChanged, compact = false }) {
  const { tenant, store, user } = useAuthStore()
  const [openOp, setOpenOp] = useState(null)  // 'receive' | 'count' | 'writeoff' | 'history'

  const handleSaved = () => {
    setOpenOp(null)
    onChanged?.()
  }

  return (
    <>
      <div className={compact ? 'grid grid-cols-4 gap-1.5' : 'grid grid-cols-2 gap-2'}>
        <OpBtn icon="📥" label="Receive" sub="Add stock" color="blue" compact={compact}
          onClick={() => setOpenOp('receive')}/>
        <OpBtn icon="🔢" label="Count" sub="Stocktake" color="green" compact={compact}
          onClick={() => setOpenOp('count')}/>
        <OpBtn icon="💔" label="Write off" sub="Damage / loss" color="red" compact={compact}
          onClick={() => setOpenOp('writeoff')}/>
        <OpBtn icon="📜" label="History" sub="Last 50" color="gray" compact={compact}
          onClick={() => setOpenOp('history')}/>
      </div>

      {openOp === 'receive' && (
        <ReceiveModal product={product} tenantId={tenant.id} storeId={store.id}
          onSave={handleSaved} onClose={() => setOpenOp(null)}/>
      )}
      {openOp === 'count' && (
        <CountModal product={product} currentQty={currentQty}
          tenantId={tenant.id} storeId={store.id} userId={user?.id}
          onClose={() => setOpenOp(null)} onSaved={handleSaved}/>
      )}
      {openOp === 'writeoff' && (
        <WriteOffModal product={product} currentQty={currentQty}
          tenantId={tenant.id} storeId={store.id} userId={user?.id}
          onClose={() => setOpenOp(null)} onSaved={handleSaved}/>
      )}
      {openOp === 'history' && (
        <HistoryModal product={product} tenantId={tenant.id} storeId={store.id}
          onClose={() => setOpenOp(null)}/>
      )}
    </>
  )
}

// ────────────────────────────────────────────────
function OpBtn({ icon, label, sub, color, compact, onClick }) {
  const palette = {
    blue:  { bg:'#FFFFFF', border:'#006AFF', icon:'#006AFF', text:'#006AFF' },
    green: { bg:'#FFFFFF', border:'#15803D', icon:'#15803D', text:'#15803D' },
    red:   { bg:'#FFFFFF', border:'#CF1322', icon:'#CF1322', text:'#CF1322' },
    gray:  { bg:'#FFFFFF', border:'#E5E5E5', icon:'#666666', text:'#1F1F1F' },
  }[color]

  if (compact) {
    return (
      <button onClick={onClick}
        className="rounded-lg py-2 px-1 text-center cursor-pointer active:scale-[0.96]"
        style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
        <div className="text-[16px]">{icon}</div>
        <div className="text-[10px] font-bold mt-0.5" style={{color: palette.text}}>{label}</div>
      </button>
    )
  }

  return (
    <button onClick={onClick}
      className="rounded-lg py-3 px-3 text-left cursor-pointer active:scale-[0.97]"
      style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
      <div className="flex items-center gap-2">
        <span className="text-[18px]">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold" style={{color: palette.text}}>{label}</div>
          <div className="text-[10px] text-[#999]">{sub}</div>
        </div>
      </div>
    </button>
  )
}

// ════════════════════════════════════════════════
// 🔢 Count Modal — Stocktake (set actual quantity)
// ════════════════════════════════════════════════
function CountModal({ product, currentQty, tenantId, storeId, userId, onClose, onSaved }) {
  const [counted, setCounted] = useState(String(currentQty))
  const [notes, setNotes] = useState('')
  const [showPad, setShowPad] = useState(false)
  const [showKB, setShowKB] = useState(false)
  const [saving, setSaving] = useState(false)

  const newQty = parseFloat(counted) || 0
  const diff = newQty - currentQty

  const save = async () => {
    setSaving(true)
    const { data, error } = await supabase.rpc('fn_adjust_inventory', {
      p_tenant_id: tenantId, p_store_id: storeId, p_product_id: product.id,
      p_new_qty: newQty, p_reason: 'Stocktake', p_notes: notes || null,
      p_user_id: userId || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    if (!data?.success) { toast.error(data?.message || 'Failed'); return }
    toast.success(`Counted ${product.name}: ${currentQty} → ${newQty}`)
    onSaved()
  }

  return (
    <>
      <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
        <div className="rounded-2xl overflow-hidden" style={{
          width:'440px', maxWidth:'100%', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
        }}>
          <ModalHeader icon="🔢" title="Stocktake" subtitle={product.name} onClose={onClose}/>

          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between bg-[#F5F5F5] rounded-lg px-4 py-3">
              <div>
                <div className="text-[10px] font-bold text-[#666] uppercase">System says</div>
                <div className="text-[18px] font-bold font-mono text-[#1F1F1F]">{currentQty}</div>
              </div>
              <span className="text-[20px] text-[#999]">→</span>
              <div className="text-right">
                <div className="text-[10px] font-bold text-[#666] uppercase">You counted</div>
                <button onClick={() => setShowPad(true)}
                  className="text-[18px] font-bold font-mono cursor-pointer"
                  style={{background:'none', border:'none', color:'#006AFF'}}>
                  {counted || '0'} ✏️
                </button>
              </div>
            </div>

            {diff !== 0 && (
              <div className="rounded-lg px-4 py-3"
                style={{
                  background: diff > 0 ? '#DCFCE7' : '#FEE2E2',
                  border: `1px solid ${diff > 0 ? '#BBF7D0' : '#FECACA'}`,
                  color: diff > 0 ? '#15803D' : '#CF1322',
                }}>
                <div className="text-[11px] font-bold uppercase">Adjustment</div>
                <div className="text-[16px] font-bold font-mono">
                  {diff > 0 ? '+' : ''}{diff}  {diff > 0 ? '(found)' : '(missing)'}
                </div>
              </div>
            )}

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Notes <span className="font-normal text-[#999]">(optional)</span></div>
              <button onClick={() => setShowKB(true)}
                className="w-full text-left bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] cursor-pointer"
                style={{color: notes ? '#1F1F1F' : '#999'}}>
                {notes || 'Tap to add notes...'}
              </button>
            </div>
          </div>

          <ModalFooter
            saveLabel={saving ? 'Saving...' : `Save count (${counted || '0'})`}
            onSave={save} onCancel={onClose}
            disabled={saving || newQty === currentQty}/>
        </div>
      </div>

      {showPad && <NumericKeypad value={counted} onChange={setCounted} onClose={() => setShowPad(false)}
        title="Counted Quantity" placeholder="0" formatPhone={false} allowPlus={false}/>}
      {showKB && <QWERTYKeyboard value={notes} onChange={setNotes} onClose={() => setShowKB(false)}
        title="Stocktake Notes" placeholder="Anything to remember..."/>}
    </>
  )
}

// ════════════════════════════════════════════════
// 💔 Write Off Modal — remove damaged / lost / etc.
// ════════════════════════════════════════════════
const WRITEOFF_REASONS = ['Damage', 'Expired', 'Lost / theft', 'Gift / sample', 'Quality issue', 'Other']

function WriteOffModal({ product, currentQty, tenantId, storeId, userId, onClose, onSaved }) {
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [showPad, setShowPad] = useState(false)
  const [showKB, setShowKB] = useState(false)
  const [saving, setSaving] = useState(false)

  const removeQty = parseFloat(qty) || 0
  const newQty = currentQty - removeQty

  const save = async () => {
    if (!reason) { toast.error('Pick a reason'); return }
    if (removeQty <= 0) { toast.error('Quantity must be > 0'); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('fn_adjust_inventory', {
      p_tenant_id: tenantId, p_store_id: storeId, p_product_id: product.id,
      p_new_qty: newQty, p_reason: reason, p_notes: notes || null,
      p_user_id: userId || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    if (!data?.success) { toast.error(data?.message || 'Failed'); return }
    toast.success(`Wrote off ${removeQty} ${product.name}`)
    onSaved()
  }

  return (
    <>
      <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
        <div className="rounded-2xl overflow-hidden" style={{
          width:'440px', maxWidth:'100%', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
        }}>
          <ModalHeader icon="💔" title="Write Off Stock" subtitle={product.name} onClose={onClose}/>

          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between bg-[#F5F5F5] rounded-lg px-4 py-3">
              <span className="text-[12px] text-[#666] font-bold">Currently in stock</span>
              <span className="text-[18px] font-bold font-mono text-[#1F1F1F]">{currentQty}</span>
            </div>

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Quantity to write off</div>
              <button onClick={() => setShowPad(true)}
                className="w-full text-left px-4 py-3 rounded-lg cursor-pointer"
                style={{background:'#FFF1F0', border:'2px solid #CF1322'}}>
                <div className="text-[10px] text-[#CF1322] font-bold uppercase">Tap to edit</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[26px] font-bold font-mono text-[#CF1322]">−{qty || '0'}</span>
                  <span className="text-[12px] text-[#666]">→ new stock: {newQty}</span>
                </div>
              </button>
            </div>

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">
                Reason <span className="text-[#CF1322]">*</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {WRITEOFF_REASONS.map(r => (
                  <button key={r} onClick={() => setReason(r)}
                    className="px-2 py-2 rounded-lg text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                    style={reason === r
                      ? {background:'#FFF1F0', border:'1px solid #CF1322', color:'#CF1322'}
                      : {background:'#FFFFFF', border:'1px solid #E5E5E5', color:'#1F1F1F'}}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Notes <span className="font-normal text-[#999]">(optional)</span></div>
              <button onClick={() => setShowKB(true)}
                className="w-full text-left bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] cursor-pointer"
                style={{color: notes ? '#1F1F1F' : '#999'}}>
                {notes || 'Tap to add notes...'}
              </button>
            </div>
          </div>

          <ModalFooter
            saveLabel={saving ? 'Saving...' : `Write off ${removeQty}`}
            saveColor="#CF1322"
            onSave={save} onCancel={onClose}
            disabled={saving || removeQty <= 0 || !reason}/>
        </div>
      </div>

      {showPad && <NumericKeypad value={qty} onChange={setQty} onClose={() => setShowPad(false)}
        title="Quantity to Write Off" placeholder="0" formatPhone={false} allowPlus={false}/>}
      {showKB && <QWERTYKeyboard value={notes} onChange={setNotes} onClose={() => setShowKB(false)}
        title="Write-off Notes" placeholder="What happened..."/>}
    </>
  )
}

// ════════════════════════════════════════════════
// 📜 History Modal — last 50 events
// ════════════════════════════════════════════════
function HistoryModal({ product, tenantId, storeId, onClose }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['stockops-history', product.id, storeId],
    queryFn: async () => {
      const [adjRes, salesRes] = await Promise.all([
        supabase.from('inventory_adjustments')
          .select('id, qty_change, qty_before, qty_after, reason, notes, created_at, users(name)')
          .eq('tenant_id', tenantId).eq('product_id', product.id)
          .order('created_at', { ascending: false }).limit(50),
        supabase.from('order_items')
          .select('quantity, line_total, created_at, orders!inner(order_number, store_id)')
          .eq('tenant_id', tenantId)
          .eq('product_id', product.id)
          .eq('orders.store_id', storeId)
          .order('created_at', { ascending: false }).limit(50),
      ])

      const merged = []
      ;(adjRes.data || []).forEach(a => merged.push({
        kind:'adjust', at:a.created_at,
        delta:a.qty_change, reason:a.reason, notes:a.notes,
        user:a.users?.name, qty_after:a.qty_after,
      }))
      ;(salesRes.data || []).forEach(s => merged.push({
        kind:'sale', at:s.created_at,
        delta:-Math.abs(s.quantity), order_number:s.orders?.order_number,
      }))
      merged.sort((a,b) => new Date(b.at) - new Date(a.at))
      return merged.slice(0, 50)
    },
  })

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width:'520px', maxWidth:'100%', maxHeight:'88vh', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
      }}>
        <ModalHeader icon="📜" title="Stock History" subtitle={product.name} onClose={onClose}/>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="p-8 text-center text-[#666] text-[13px]">Loading...</div>
          ) : history.length === 0 ? (
            <div className="p-12 text-center text-[#666] text-[13px]">
              <div className="text-[36px] mb-2">📭</div>
              No activity yet
            </div>
          ) : (
            <div className="space-y-1.5">
              {history.map((h, i) => <ActivityRow key={i} item={h}/>)}
            </div>
          )}
        </div>

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

// ────────────────────────────────────────────────
function ActivityRow({ item }) {
  const ago = relativeTime(item.at)
  if (item.kind === 'sale') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded text-[12px]" style={{background:'#FAFAFA'}}>
        <span className="text-[14px]">🛒</span>
        <span className="font-bold font-mono text-[#CF1322]">{item.delta}</span>
        <span className="flex-1 text-[#1F1F1F] truncate">Sold · {item.order_number}</span>
        <span className="text-[10px] text-[#999]">{ago}</span>
      </div>
    )
  }
  const isPositive = item.delta >= 0
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded text-[12px]" style={{background:'#FAFAFA'}}>
      <span className="text-[14px]">{isPositive ? '➕' : '➖'}</span>
      <span className="font-bold font-mono" style={{color: isPositive ? '#15803D' : '#CF1322'}}>
        {isPositive ? '+' : ''}{item.delta}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[#1F1F1F] truncate">{item.reason || 'Adjustment'}{item.user ? ` · ${item.user}` : ''}</div>
        {item.notes && <div className="text-[10px] text-[#999] italic truncate">"{item.notes}"</div>}
      </div>
      <span className="text-[10px] text-[#999] flex-shrink-0">{ago}</span>
    </div>
  )
}

function relativeTime(isoString) {
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff/86400)}d ago`
  return new Date(isoString).toLocaleDateString()
}

// ────────────────────────────────────────────────
// Shared modal pieces
// ────────────────────────────────────────────────
function ModalHeader({ icon, title, subtitle, onClose }) {
  return (
    <div className="px-5 py-4 flex items-center justify-between" style={{borderBottom:'1px solid #E5E5E5'}}>
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[24px] flex-shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">{title}</div>
          <div className="text-[15px] font-bold text-[#1F1F1F] truncate" style={{maxWidth:'320px'}}>{subtitle}</div>
        </div>
      </div>
      <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px] flex-shrink-0"
        style={{background:'#F5F5F5', border:'none'}}>✕</button>
    </div>
  )
}

function ModalFooter({ saveLabel, saveColor = '#006AFF', onSave, onCancel, disabled }) {
  return (
    <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
      <button onClick={onCancel}
        className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
        style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
        Cancel
      </button>
      <button onClick={onSave} disabled={disabled}
        className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
        style={{background: saveColor, color:'#FFFFFF', border:'none'}}>
        {saveLabel}
      </button>
    </div>
  )
}
