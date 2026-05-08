// src/pages/inventory/StockDetailPanel.jsx
// Side panel that opens when a product is clicked in Stock Center.
// Shows: stock + adjust, 7-day trend, recent activity, quick edits, and link to full edit.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { NumericKeypad, QWERTYKeyboard } from '@/components/ui/TouchKeyboards'

const REASONS = ['Damage / loss', 'Stocktake', 'Return to vendor', 'Gift / sample', 'Found stock', 'Other']

export default function StockDetailPanel({ product, onClose, onChanged }) {
  const { tenant, store, user } = useAuthStore()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [editing, setEditing] = useState(null)         // 'name' | 'sku' | 'price' | 'cost' | 'low_stock_qty'
  const [showSetPad, setShowSetPad] = useState(false)
  const [showKB, setShowKB] = useState(null)           // for editing string fields

  // Fetch fresh detail (includes inventory + 7d sales)
  const { data: detail, isLoading } = useQuery({
    queryKey: ['stock-detail', product.id],
    queryFn: async () => {
      const [productRes, invRes, salesRes, dailyRes, activityRes] = await Promise.all([
        supabase.from('products')
          .select('id, name, sku, barcode, type, unit, price, cost, low_stock_qty, emoji, image_url')
          .eq('id', product.id).single(),
        supabase.from('inventory')
          .select('quantity').eq('tenant_id', tenant.id).eq('store_id', store.id).eq('product_id', product.id)
          .maybeSingle(),
        supabase.from('v_product_sales_7d')
          .select('units_sold, revenue, order_count')
          .eq('product_id', product.id).eq('tenant_id', tenant.id).eq('store_id', store.id)
          .maybeSingle(),
        supabase.from('v_product_daily_sales_7d')
          .select('sale_date, units')
          .eq('product_id', product.id).eq('tenant_id', tenant.id).eq('store_id', store.id)
          .order('sale_date'),
        // Recent activity: combine adjustments + sales
        supabase.from('inventory_adjustments')
          .select('id, qty_change, qty_before, qty_after, reason, notes, created_at, users(name)')
          .eq('tenant_id', tenant.id).eq('product_id', product.id)
          .order('created_at', { ascending: false }).limit(10),
      ])

      // Get recent sales too
      const { data: salesItems } = await supabase
        .from('order_items')
        .select('quantity, line_total, created_at, orders!inner(order_number, store_id, tenant_id)')
        .eq('tenant_id', tenant.id)
        .eq('product_id', product.id)
        .eq('orders.store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(10)

      // Merge activity (adjustments + sales) into one timeline
      const activity = []
      ;(activityRes.data || []).forEach(a => activity.push({
        kind: 'adjust', at: a.created_at,
        delta: a.qty_change, reason: a.reason, notes: a.notes,
        user: a.users?.name, qty_after: a.qty_after,
      }))
      ;(salesItems || []).forEach(s => activity.push({
        kind: 'sale', at: s.created_at,
        delta: -Math.abs(s.quantity), order_number: s.orders?.order_number,
        amount: s.line_total,
      }))
      activity.sort((a, b) => new Date(b.at) - new Date(a.at))

      return {
        product:   productRes.data,
        qty:       invRes.data?.quantity ?? 0,
        sales7d:   salesRes.data || { units_sold: 0, revenue: 0, order_count: 0 },
        dailySales: dailyRes.data || [],
        activity:  activity.slice(0, 15),
      }
    },
    enabled: !!product?.id && !!tenant?.id && !!store?.id,
  })

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ['stock-detail', product.id] })
    qc.invalidateQueries({ queryKey: ['stock-rows'] })
    qc.invalidateQueries({ queryKey: ['stock-summary'] })
    onChanged?.()
  }

  if (isLoading || !detail) {
    return <PanelShell onClose={onClose}><div className="p-8 text-center text-[#666] text-[13px]">Loading...</div></PanelShell>
  }

  const p = detail.product
  const qty = detail.qty
  const threshold = p.low_stock_qty || 5
  const stockState = qty < 0 ? 'negative' : qty === 0 ? 'oos' : qty <= threshold ? 'low' : 'normal'
  const stockColor = {
    negative: { bg:'#FEE2E2', color:'#CF1322', dot:'#CF1322', label: `${qty}` },
    oos:      { bg:'#FEE2E2', color:'#CF1322', dot:'#CF1322', label: 'Out of stock' },
    low:      { bg:'#FEF3C7', color:'#B45309', dot:'#F59E0B', label: `${qty}  (low)` },
    normal:   { bg:'#DCFCE7', color:'#15803D', dot:'#15803D', label: `${qty}` },
  }[stockState]

  // ── Quick adjust ──
  const adjust = async (newQty, reason = null, notes = null) => {
    const { data, error } = await supabase.rpc('fn_adjust_inventory', {
      p_tenant_id:  tenant.id, p_store_id: store.id, p_product_id: p.id,
      p_new_qty: newQty, p_reason: reason, p_notes: notes, p_user_id: user?.id || null,
    })
    if (error) { toast.error(error.message); return }
    if (!data?.success) { toast.error(data?.message || 'Failed'); return }
    toast.success(`${p.name}: ${qty} → ${newQty}`)
    refetchAll()
  }

  // ── Inline field save ──
  const saveField = async (field, value) => {
    const update = { [field]: value }
    if (field === 'price' || field === 'cost' || field === 'low_stock_qty') {
      update[field] = parseFloat(value) || 0
    }
    const { error } = await supabase.from('products').update(update).eq('id', p.id)
    if (error) { toast.error(error.message); return }
    toast.success('Updated')
    setEditing(null)
    refetchAll()
  }

  // 7-day sparkline
  const buildSparkline = () => {
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const found = detail.dailySales.find(x => x.sale_date === key)
      days.push({ date: key, units: found?.units || 0, label: d.toLocaleDateString('en-US', { weekday: 'short' }) })
    }
    return days
  }
  const spark = buildSparkline()
  const maxUnits = Math.max(1, ...spark.map(d => d.units))

  return (
    <PanelShell onClose={onClose}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-5 py-4 flex items-start gap-3" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
            style={{background:'#F5F5F5', border:'1px solid #E5E5E5'}}>
            {p.image_url
              ? <img src={p.image_url} alt="" className="w-full h-full object-cover"/>
              : <span className="text-[18px]">{p.emoji || '📦'}</span>}
          </div>
          <div className="flex-1 min-w-0">
            {editing === 'name' ? (
              <EditableText value={p.name} onSave={v => saveField('name', v)} onCancel={() => setEditing(null)} setShowKB={setShowKB}/>
            ) : (
              <div className="flex items-start gap-2">
                <div className="text-[16px] font-bold text-[#1F1F1F] truncate flex-1">{p.name}</div>
                <button onClick={() => setEditing('name')} className="text-[11px] text-[#006AFF] cursor-pointer flex-shrink-0" style={{background:'none', border:'none'}}>edit</button>
              </div>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              {editing === 'sku' ? (
                <EditableText value={p.sku || ''} onSave={v => saveField('sku', v)} onCancel={() => setEditing(null)} setShowKB={setShowKB} small/>
              ) : (
                <>
                  <span className="text-[11px] text-[#666] font-mono">{p.sku || '— no SKU'}</span>
                  <button onClick={() => setEditing('sku')} className="text-[10px] text-[#006AFF] cursor-pointer" style={{background:'none', border:'none'}}>edit</button>
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px] flex-shrink-0"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Stock + Quick adjust ── */}
          <Section title="Stock">
            <div className="rounded-lg p-4 mb-3" style={{background: stockColor.bg, border:`1px solid ${stockColor.dot}`}}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{color: stockColor.color, opacity:0.7}}>Current</div>
                  <div className="text-[28px] font-bold font-mono" style={{color: stockColor.color}}>
                    {stockColor.label}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#666]">Low alert at</div>
                  {editing === 'low_stock_qty' ? (
                    <EditableNum value={p.low_stock_qty || 5} onSave={v => saveField('low_stock_qty', v)} onCancel={() => setEditing(null)}/>
                  ) : (
                    <div className="flex items-center gap-2 justify-end">
                      <span className="text-[18px] font-bold font-mono text-[#1F1F1F]">{p.low_stock_qty || 5}</span>
                      <button onClick={() => setEditing('low_stock_qty')} className="text-[11px] text-[#006AFF] cursor-pointer" style={{background:'none', border:'none'}}>edit</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => adjust(qty - 1, 'Quick -1')}
                className="rounded-lg py-2.5 text-[14px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#FEE2E2', color:'#CF1322', border:'1px solid #FECACA'}}>− 1</button>
              <button onClick={() => adjust(qty + 1, 'Quick +1')}
                className="rounded-lg py-2.5 text-[14px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#DCFCE7', color:'#15803D', border:'1px solid #BBF7D0'}}>+ 1</button>
              <button onClick={() => setShowSetPad(true)}
                className="rounded-lg py-2.5 text-[14px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>Set...</button>
            </div>
          </Section>

          {/* ── 7-day sales trend ── */}
          <Section title="Last 7 days">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Stat label="Sold" value={`${detail.sales7d.units_sold || 0}`} unit="units"/>
              <Stat label="Revenue" value={`$${(detail.sales7d.revenue || 0).toFixed(2)}`}/>
              <Stat label="Orders" value={`${detail.sales7d.order_count || 0}`}/>
            </div>
            <div className="rounded-lg p-3" style={{background:'#F5F5F5', border:'1px solid #E5E5E5'}}>
              <div className="flex items-end justify-between gap-1.5 h-[60px]">
                {spark.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="flex-1 w-full flex items-end">
                      <div className="w-full rounded-sm transition-all"
                        style={{
                          height: `${Math.max(4, (d.units / maxUnits) * 100)}%`,
                          background: d.units > 0 ? '#006AFF' : '#E5E5E5',
                        }}
                        title={`${d.label}: ${d.units} sold`}/>
                    </div>
                    <div className="text-[9px] text-[#999] font-bold">{d.label[0]}</div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* ── Pricing ── */}
          <Section title="Pricing">
            <div className="grid grid-cols-2 gap-3">
              <PriceField label="Sell price" value={p.price} editing={editing === 'price'}
                onEdit={() => setEditing('price')} onSave={v => saveField('price', v)} onCancel={() => setEditing(null)}/>
              <PriceField label="Cost" value={p.cost} editing={editing === 'cost'}
                onEdit={() => setEditing('cost')} onSave={v => saveField('cost', v)} onCancel={() => setEditing(null)}/>
            </div>
            <button onClick={() => navigate(`/products?edit=${p.id}`)}
              className="mt-3 w-full rounded-lg py-2.5 text-[12px] font-bold cursor-pointer active:scale-[0.98]"
              style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #006AFF'}}>
              Edit full details →
            </button>
          </Section>

          {/* ── Recent activity ── */}
          <Section title="Recent activity">
            {detail.activity.length === 0 ? (
              <div className="text-center text-[12px] text-[#999] py-6">No activity yet</div>
            ) : (
              <div className="space-y-1.5">
                {detail.activity.map((a, i) => <ActivityRow key={i} item={a}/>)}
              </div>
            )}
          </Section>

        </div>
      </div>

      {showSetPad && (
        <SetQtyModal
          product={p} currentQty={qty}
          onClose={() => setShowSetPad(false)}
          onSave={(newQty, reason, notes) => {
            adjust(newQty, reason, notes)
            setShowSetPad(false)
          }}
        />
      )}

      {showKB && (
        <QWERTYKeyboard value={showKB.value} onChange={showKB.onChange}
          onClose={() => setShowKB(null)} title={showKB.title}/>
      )}
    </PanelShell>
  )
}

// ─── Sub-components ───

function PanelShell({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-[300] flex justify-end" style={{background:'rgba(0,0,0,0.35)'}} onClick={onClose}>
      <div className="bg-[#FFFFFF] flex flex-col"
        style={{width:'min(480px, 95vw)', height:'100vh', boxShadow:'-4px 0 20px rgba(0,0,0,0.1)'}}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#666] mb-2">{title}</div>
      {children}
    </div>
  )
}

function Stat({ label, value, unit }) {
  return (
    <div className="rounded-lg p-2.5" style={{background:'#F5F5F5', border:'1px solid #E5E5E5'}}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-[#666]">{label}</div>
      <div className="text-[16px] font-bold text-[#1F1F1F] truncate">{value}</div>
      {unit && <div className="text-[10px] text-[#999]">{unit}</div>}
    </div>
  )
}

function PriceField({ label, value, editing, onEdit, onSave, onCancel }) {
  return (
    <div className="rounded-lg p-3" style={{background:'#F5F5F5', border:'1px solid #E5E5E5'}}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#666] mb-1">{label}</div>
      {editing ? (
        <EditableNum value={value} onSave={onSave} onCancel={onCancel} prefix="$"/>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-[18px] font-bold font-mono text-[#1F1F1F]">${(value || 0).toFixed(2)}</span>
          <button onClick={onEdit} className="text-[11px] text-[#006AFF] cursor-pointer" style={{background:'none', border:'none'}}>edit</button>
        </div>
      )}
    </div>
  )
}

function EditableText({ value: initial, onSave, onCancel, setShowKB, small }) {
  const [v, setV] = useState(initial)
  return (
    <div className="flex items-center gap-1">
      <input value={v} onChange={e => setV(e.target.value)} autoFocus
        onClick={() => setShowKB?.({ value: v, onChange: setV, title: 'Edit' })}
        className={`flex-1 bg-[#FFFFFF] border border-[#006AFF] rounded px-2 py-1 outline-none ${small ? 'text-[11px]' : 'text-[14px] font-bold'}`}/>
      <button onClick={() => onSave(v)} className="px-2 py-1 rounded text-[11px] font-bold cursor-pointer"
        style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>✓</button>
      <button onClick={onCancel} className="px-2 py-1 rounded text-[11px] cursor-pointer"
        style={{background:'#F5F5F5', color:'#666', border:'1px solid #E5E5E5'}}>✕</button>
    </div>
  )
}

function EditableNum({ value: initial, onSave, onCancel, prefix }) {
  const [v, setV] = useState(String(initial))
  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="text-[14px] font-bold text-[#666]">{prefix}</span>}
      <input type="number" inputMode="decimal" value={v} onChange={e => setV(e.target.value)} autoFocus
        className="flex-1 bg-[#FFFFFF] border border-[#006AFF] rounded px-2 py-1 text-[14px] font-bold font-mono outline-none"/>
      <button onClick={() => onSave(v)} className="px-2 py-1 rounded text-[11px] font-bold cursor-pointer"
        style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>✓</button>
      <button onClick={onCancel} className="px-2 py-1 rounded text-[11px] cursor-pointer"
        style={{background:'#F5F5F5', color:'#666', border:'1px solid #E5E5E5'}}>✕</button>
    </div>
  )
}

function ActivityRow({ item }) {
  const ago = relativeTime(item.at)
  if (item.kind === 'sale') {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded text-[12px]" style={{background:'#FAFAFA'}}>
        <span className="text-[12px]">🛒</span>
        <span className="font-bold font-mono text-[#CF1322]">{item.delta}</span>
        <span className="flex-1 text-[#1F1F1F] truncate">Sold · {item.order_number}</span>
        <span className="text-[10px] text-[#999]">{ago}</span>
      </div>
    )
  }
  // adjust
  const isPositive = item.delta >= 0
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded text-[12px]" style={{background:'#FAFAFA'}}>
      <span className="text-[12px]">{isPositive ? '➕' : '➖'}</span>
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

// ─── Set Qty modal (inline within panel) ───
function SetQtyModal({ product, currentQty, onClose, onSave }) {
  const [newQty, setNewQty] = useState(String(currentQty))
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [showPad, setShowPad] = useState(false)
  const [showNotesKB, setShowNotesKB] = useState(false)
  const change = (parseFloat(newQty) || 0) - currentQty

  return (
    <>
      <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
        <div className="rounded-2xl overflow-hidden" style={{
          width:'440px', maxWidth:'100%', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
        }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{borderBottom:'1px solid #E5E5E5'}}>
            <div>
              <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">Set Stock Quantity</div>
              <div className="text-[15px] font-bold text-[#1F1F1F] truncate" style={{maxWidth:'320px'}}>{product.name}</div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]" style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between bg-[#F5F5F5] rounded-lg px-4 py-3">
              <span className="text-[12px] text-[#666] font-bold">Current</span>
              <span className="text-[18px] font-bold font-mono text-[#1F1F1F]">{currentQty}</span>
            </div>

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">New quantity</div>
              <button onClick={() => setShowPad(true)} className="w-full text-left px-4 py-3 rounded-lg cursor-pointer"
                style={{background:'#F5F5F5', border:'2px solid #006AFF'}}>
                <div className="text-[10px] text-[#006AFF] font-bold uppercase">Tap to edit</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[26px] font-bold font-mono text-[#1F1F1F]">{newQty || '0'}</span>
                  {change !== 0 && (
                    <span className="text-[13px] font-bold font-mono" style={{color: change > 0 ? '#15803D' : '#CF1322'}}>
                      ({change > 0 ? '+' : ''}{change})
                    </span>
                  )}
                </div>
              </button>
            </div>

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Reason <span className="font-normal text-[#999]">(optional)</span></div>
              <div className="grid grid-cols-2 gap-1.5">
                {REASONS.map(r => (
                  <button key={r} onClick={() => setReason(reason === r ? '' : r)}
                    className="px-2 py-2 rounded-lg text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                    style={reason === r
                      ? {background:'#E6F0FF', border:'1px solid #006AFF', color:'#006AFF'}
                      : {background:'#FFFFFF', border:'1px solid #E5E5E5', color:'#1F1F1F'}}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Notes <span className="font-normal text-[#999]">(optional)</span></div>
              <button onClick={() => setShowNotesKB(true)}
                className="w-full text-left bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] cursor-pointer"
                style={{color: notes ? '#1F1F1F' : '#999'}}>
                {notes || 'Tap to add notes...'}
              </button>
            </div>
          </div>

          <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onClose}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>Cancel</button>
            <button onClick={() => onSave(parseFloat(newQty) || 0, reason || null, notes || null)}
              disabled={newQty === String(currentQty)}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              Save Adjustment
            </button>
          </div>
        </div>
      </div>

      {showPad && (
        <NumericKeypad value={newQty} onChange={setNewQty} onClose={() => setShowPad(false)}
          title="New Stock Quantity" placeholder="0" formatPhone={false} allowPlus={false}/>
      )}
      {showNotesKB && (
        <QWERTYKeyboard value={notes} onChange={setNotes} onClose={() => setShowNotesKB(false)}
          title="Adjustment Notes" placeholder="Why are you making this change?"/>
      )}
    </>
  )
}
