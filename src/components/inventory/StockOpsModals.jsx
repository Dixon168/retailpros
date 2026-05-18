// src/components/inventory/StockOpsModals.jsx
// Three reusable modals for inventory operations:
//   • CountModal      — physical stocktake: set new qty, optionally pick reason
//   • WriteOffModal   — damage / loss / theft: deduct N
//   • HistoryModal    — last 50 inventory adjustments + sales for one product

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import DualInput from '@/components/ui/DualInput'

const COUNT_REASONS    = ['Stocktake', 'Found stock', 'Manual correction', 'Other']
const WRITEOFF_REASONS = ['Damage', 'Expired', 'Theft / shrinkage', 'Sample / gift', 'Other']

// ════════════════════════════════════════════════
// CountModal — used for "I just counted, the real number is N"
// ════════════════════════════════════════════════
export function CountModal({ product, currentQty, onClose, onSaved }) {
  const { tenant, store, user } = useAuthStore()
  const [newQty, setNewQty]     = useState(String(currentQty))
  const [reason, setReason]     = useState('Stocktake')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)

  const change = (parseFloat(newQty) || 0) - currentQty

  const save = async () => {
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('fn_adjust_inventory', {
        p_tenant_id:  tenant.id,
        p_store_id:   store.id,
        p_product_id: product.id,
        p_new_qty:    parseFloat(newQty) || 0,
        p_reason:     reason || null,
        p_notes:      notes || null,
        p_user_id:    user?.id || null,
      })
      if (error) { toast.error(error.message); return }
      toast.success(`Counted: ${product.name} → ${newQty}`)
      onSaved()
    } catch (e) {
      console.error('StockOps adjust:', e)
      toast.error(e?.message || 'Adjust failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
      <div className="rounded-2xl overflow-hidden" style={{
        width:'440px', maxWidth:'100%', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
      }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">🔢 Count Stock</div>
            <div className="text-[15px] font-bold text-[#1F1F1F] truncate" style={{maxWidth:'320px'}}>{product.name}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]" style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-[12px] text-[#666]">
            Got a real-life count? Enter the actual number you have on hand. The system stock will be updated to match.
          </div>

          <div className="flex items-center justify-between bg-[#F5F5F5] rounded-lg px-4 py-3">
            <span className="text-[12px] text-[#666] font-bold">System currently has</span>
            <span className="text-[18px] font-bold font-mono text-[#1F1F1F]">{currentQty}</span>
          </div>

          <div>
            <DualInput label="Actual count (real-life)" mode="decimal" autoFocus
              value={newQty} onChange={setNewQty}
              kbTitle="Actual Stock Count" placeholder="0"/>
            {change !== 0 && (
              <div className="mt-1.5 text-[12px] font-bold font-mono"
                style={{color: change > 0 ? '#15803D' : '#CF1322'}}>
                Difference: {change > 0 ? '+' : ''}{change}
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Reason</div>
            <div className="grid grid-cols-2 gap-1.5">
              {COUNT_REASONS.map(r => (
                <button key={r} type="button" onClick={() => setReason(r)}
                  className="px-2 py-2 rounded-lg text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                  style={reason === r
                    ? {background:'#E6F0FF', border:'1px solid #006AFF', color:'#006AFF'}
                    : {background:'#FFFFFF', border:'1px solid #E5E5E5', color:'#1F1F1F'}}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          <DualInput
            label={<>Notes <span className="font-normal text-[#999]">(optional)</span></>}
            value={notes} onChange={setNotes}
            placeholder="Anything to remember..."
            kbTitle="Count Notes"/>
        </div>

        <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>Cancel</button>
          <button onClick={save} disabled={saving || newQty === String(currentQty)}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
            style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
            {saving ? 'Saving...' : 'Save Count'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════
// WriteOffModal — used for damage, loss, theft, etc
// ════════════════════════════════════════════════
export function WriteOffModal({ product, currentQty, onClose, onSaved }) {
  const { tenant, store, user } = useAuthStore()
  const [qty, setQty]           = useState('1')
  const [reason, setReason]     = useState('Damage')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)

  const writeOffQty = parseFloat(qty) || 0
  const newStock = currentQty - writeOffQty

  const save = async () => {
    if (writeOffQty <= 0) { toast.error('Enter a quantity to write off'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('fn_adjust_inventory', {
        p_tenant_id:  tenant.id,
        p_store_id:   store.id,
        p_product_id: product.id,
        p_new_qty:    newStock,
        p_reason:     `Write off: ${reason}`,
        p_notes:      notes || null,
        p_user_id:    user?.id || null,
      })
      if (error) { toast.error(error.message); return }
      toast.success(`Wrote off ${writeOffQty} × ${product.name}`)
      onSaved()
    } catch (e) {
      console.error('Writeoff:', e)
      toast.error(e?.message || 'Write-off failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
      <div className="rounded-2xl overflow-hidden" style={{
        width:'440px', maxWidth:'100%', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
      }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div>
            <div className="text-[11px] font-bold text-[#CF1322] uppercase tracking-wider">💔 Write Off</div>
            <div className="text-[15px] font-bold text-[#1F1F1F] truncate" style={{maxWidth:'320px'}}>{product.name}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]" style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-[12px] text-[#666]">
            Remove damaged, expired, lost, or stolen items from stock. This is recorded in the activity log.
          </div>

          <div className="flex items-center justify-between bg-[#F5F5F5] rounded-lg px-4 py-3">
            <span className="text-[12px] text-[#666] font-bold">Current stock</span>
            <span className="text-[18px] font-bold font-mono text-[#1F1F1F]">{currentQty}</span>
          </div>

          <div>
            <DualInput label="How many to write off?" mode="decimal" autoFocus
              value={qty} onChange={setQty}
              kbTitle="Quantity to Write Off" placeholder="1"/>
            <div className="mt-1.5 text-[12px] font-mono text-[#666]">
              → New stock will be: <span className="font-bold text-[#CF1322]">{newStock}</span>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Reason</div>
            <div className="grid grid-cols-2 gap-1.5">
              {WRITEOFF_REASONS.map(r => (
                <button key={r} type="button" onClick={() => setReason(r)}
                  className="px-2 py-2 rounded-lg text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                  style={reason === r
                    ? {background:'#FEE2E2', border:'1px solid #CF1322', color:'#CF1322'}
                    : {background:'#FFFFFF', border:'1px solid #E5E5E5', color:'#1F1F1F'}}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          <DualInput
            label={<>Notes <span className="font-normal text-[#999]">(optional)</span></>}
            value={notes} onChange={setNotes}
            placeholder="What happened? (e.g. dropped on floor, expired)"
            kbTitle="Write Off Notes"/>
        </div>

        <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>Cancel</button>
          <button onClick={save} disabled={saving || writeOffQty <= 0}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
            style={{background:'#CF1322', color:'#FFFFFF', border:'none'}}>
            {saving ? 'Saving...' : 'Confirm Write Off'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════
// HistoryModal — last 50 stock movements for a product
// ════════════════════════════════════════════════
export function HistoryModal({ product, onClose }) {
  const { tenant, store } = useAuthStore()

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['stock-history', product.id, store?.id],
    queryFn: async () => {
      const [adjRes, salesRes] = await Promise.all([
        supabase.from('inventory_adjustments')
          .select('id, qty_change, qty_before, qty_after, reason, notes, created_at, users(name)')
          .eq('tenant_id', tenant.id)
          .eq('product_id', product.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('order_items')
          .select('quantity, line_total, created_at, orders!inner(order_number, store_id, tenant_id)')
          .eq('tenant_id', tenant.id)
          .eq('product_id', product.id)
          .eq('orders.store_id', store.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ])
      const items = []
      ;(adjRes.data || []).forEach(a => items.push({
        kind: 'adjust', at: a.created_at, delta: a.qty_change,
        reason: a.reason, notes: a.notes, user: a.users?.name,
      }))
      ;(salesRes.data || []).forEach(s => items.push({
        kind: 'sale', at: s.created_at, delta: -Math.abs(s.quantity),
        order_number: s.orders?.order_number, amount: s.line_total,
      }))
      items.sort((a, b) => new Date(b.at) - new Date(a.at))
      return items.slice(0, 50)
    },
    enabled: !!product?.id && !!tenant?.id && !!store?.id,
  })

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width:'520px', maxWidth:'100%', maxHeight:'88vh', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
      }}>
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">📜 Stock History</div>
            <div className="text-[15px] font-bold text-[#1F1F1F] truncate" style={{maxWidth:'400px'}}>{product.name}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]" style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="p-8 text-center text-[#666] text-[13px]">Loading...</div>
          ) : history.length === 0 ? (
            <div className="p-12 text-center text-[#666] text-[13px]">
              <div className="text-[36px] mb-2">📭</div>No activity yet
            </div>
          ) : (
            <div className="space-y-1.5">
              {history.map((h, i) => {
                const isPositive = h.delta >= 0
                const ago = relativeTime(h.at)
                if (h.kind === 'sale') {
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded text-[12px]" style={{background:'#FAFAFA'}}>
                      <span className="text-[14px]">🛒</span>
                      <span className="font-bold font-mono text-[#CF1322]">{h.delta}</span>
                      <span className="flex-1 text-[#1F1F1F] truncate">Sold · {h.order_number}</span>
                      <span className="text-[10px] text-[#999]">{ago}</span>
                    </div>
                  )
                }
                return (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded text-[12px]" style={{background:'#FAFAFA'}}>
                    <span className="text-[14px]">{isPositive ? '➕' : '➖'}</span>
                    <span className="font-bold font-mono" style={{color: isPositive ? '#15803D' : '#CF1322'}}>
                      {isPositive ? '+' : ''}{h.delta}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[#1F1F1F] truncate">{h.reason || 'Adjustment'}{h.user ? ` · ${h.user}` : ''}</div>
                      {h.notes && <div className="text-[10px] text-[#999] italic truncate">"{h.notes}"</div>}
                    </div>
                    <span className="text-[10px] text-[#999] flex-shrink-0">{ago}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 flex-shrink-0" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="w-full rounded-lg py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#1F1F1F', color:'#FFFFFF', border:'none'}}>Close</button>
        </div>
      </div>
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
