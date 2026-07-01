// src/pages/products/AdjustModal.jsx
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import NumPad from '@/components/ui/NumPad'
import toast from 'react-hot-toast'

const REASONS = ['Damaged','Expired','Theft/Shrinkage','Received without PO','Count correction','Transfer out','Transfer in','Other']

export function AdjustModal({ product: p, tenantId, storeId, onSave, onClose }) {
  const [qty,        setQty]        = useState('')
  const [reason,     setReason]     = useState('')
  const [saving,     setSaving]     = useState(false)
  const [showNumPad, setShowNumPad] = useState(true)
  const adjustQty = parseFloat(qty) || 0

  // Restock settings — low-stock alert threshold + auto-restock qty.
  // Both live on the inventory row for this product+store. Loaded on
  // mount, saved alongside (or independently of) an adjustment.
  const [lowThreshold, setLowThreshold] = useState('')
  const [autoRestock,  setAutoRestock]  = useState('')
  const [savingSettings, setSavingSettings] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Both settings live on the products table (low_stock_qty added by
      // STOCK_CENTER_SETUP, auto_restock_qty by PO_AUTORESTOCK_EDIT).
      const { data } = await supabase.from('products')
        .select('low_stock_qty, auto_restock_qty')
        .eq('id', p.id).maybeSingle()
      if (cancelled) return
      setLowThreshold(data?.low_stock_qty != null ? String(data.low_stock_qty) : '5')
      setAutoRestock(data?.auto_restock_qty != null ? String(data.auto_restock_qty) : '0')
    })()
    return () => { cancelled = true }
  }, [p.id])

  const saveSettings = async () => {
    setSavingSettings(true)
    try {
      const { error } = await supabase.from('products').update({
        low_stock_qty:    parseInt(lowThreshold) || 0,
        auto_restock_qty: parseInt(autoRestock) || 0,
      }).eq('id', p.id)
      if (error) throw error
      toast.success('Restock settings saved')
      onSave?.()
    } catch (e) {
      console.error('Save settings:', e)
      toast.error(e.message || 'Could not save settings')
    } finally { setSavingSettings(false) }
  }

  const handleSave = async () => {
    if (!qty) { toast.error('Enter adjustment quantity'); return }
    if (!reason.trim()) { toast.error('Enter a reason'); return }
    setSaving(true)
    const watchdog = setTimeout(() => {
      setSaving(false)
      toast.error('⏱️ Adjust is taking too long — check connection and try again')
    }, 15_000)
    try {
      // Look up the inventory record for THIS store. The old code used
      // .eq('store_id', storeId || '') which sends '' (empty string), not
      // null — Postgres rejects that for a UUID column. Fixed to match the
      // ReceiveModal pattern (separate .eq vs .is null path).
      let invQuery = supabase.from('inventory')
        .select('id,quantity')
        .eq('product_id', p.id)
        .eq('tenant_id', tenantId)
      if (storeId) invQuery = invQuery.eq('store_id', storeId)
      else invQuery = invQuery.is('store_id', null)
      const { data: inv, error: readErr } = await invQuery.maybeSingle()
      if (readErr) throw new Error(`Couldn't read inventory: ${readErr.message}`)

      const currentQty = inv?.quantity || 0
      const newQty = Math.max(0, currentQty + adjustQty)

      if (inv) {
        const { error } = await supabase.from('inventory').update({
          quantity: newQty, updated_at: new Date().toISOString()
        }).eq('id', inv.id)
        if (error) throw new Error(`Couldn't update inventory: ${error.message}`)
      } else {
        const { error } = await supabase.from('inventory').insert({
          tenant_id: tenantId, store_id: storeId || null, product_id: p.id, quantity: newQty
        })
        if (error) throw new Error(`Couldn't create inventory row: ${error.message}`)
      }

      const { error: adjErr } = await supabase.from('inventory_adjustments').insert({
        tenant_id: tenantId,
        store_id:  storeId || null,
        product_id: p.id,
        qty_change: adjustQty,
        qty_before: currentQty,
        qty_after:  newQty,
        reason,
      })
      if (adjErr) throw new Error(`Couldn't save adjustment record: ${adjErr.message}`)

      toast.success(`Inventory adjusted: ${adjustQty>=0?'+':''}${adjustQty} ${p.unit||'units'}`)
      onSave()
    } catch(err) {
      console.error('Adjust save error:', err)
      toast.error(err.message || 'Adjust failed')
    }
    finally { clearTimeout(watchdog); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{background:'rgba(15,23,42,0.55)', backdropFilter:'blur(2px)'}} onClick={onClose}>
      <div className="rounded-2xl w-[400px] shadow-md"
        style={{background:'#fff'}} onClick={e=>e.stopPropagation()}>

        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'#fffbeb', borderBottom:'1.5px solid #fde047', borderRadius:'16px 16px 0 0'}}>
          <div>
            <div className="text-[15px] font-bold text-slate-800">⚖️ Adjust Inventory</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{p.name}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-[18px]">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Adjustment Qty <span className="text-slate-400 font-normal normal-case">(negative = decrease)</span>
            </div>
            <button onClick={()=>setShowNumPad(true)}
              className="w-full rounded-xl px-3 py-3 text-[22px] font-mono font-bold text-center cursor-pointer border-2 transition-all"
              style={{
                borderColor: adjustQty > 0 ? '#86efac' : adjustQty < 0 ? '#fca5a5' : '#e2e8f0',
                background:  adjustQty > 0 ? '#f0fdf4' : adjustQty < 0 ? '#fff1f2' : '#f8fafc',
                color:       adjustQty > 0 ? '#16a34a' : adjustQty < 0 ? '#dc2626' : '#94a3b8',
              }}>
              {qty ? `${adjustQty > 0 ? '+' : ''}${qty} ${p.unit||'units'}` : 'Tap to enter qty'}
            </button>
          </div>

          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Reason *</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {REASONS.map(r => (
                <button key={r} onClick={()=>setReason(r)}
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium border cursor-pointer transition-all"
                  style={reason===r
                    ? {background:'#eef0fc', borderColor:'#dee2f8', color:'#5E6AD2'}
                    : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
                  {r}
                </button>
              ))}
            </div>
            <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Or type a custom reason..."
              className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
              style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
          </div>

          {/* ── Restock settings ─────────────────────────────────────
              These don't change stock — they set the alert threshold and
              the qty to auto-fill when this product is reordered from the
              low-stock list. Saved with its own button so the user can
              update settings WITHOUT making an adjustment.              */}
          <div className="rounded-xl p-3" style={{background:'#F0F9FF', border:'1px solid #BAE6FD'}}>
            <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-2">
              📦 Restock Settings
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Low-stock alert at ≤</div>
                <input value={lowThreshold} onChange={e=>setLowThreshold(e.target.value.replace(/[^\d]/g,''))}
                  inputMode="numeric" placeholder="5"
                  className="w-full rounded-lg px-2.5 py-2 text-[13px] font-mono text-center outline-none"
                  style={{border:'1.5px solid #BAE6FD', background:'#fff'}}/>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Auto-restock qty</div>
                <input value={autoRestock} onChange={e=>setAutoRestock(e.target.value.replace(/[^\d]/g,''))}
                  inputMode="numeric" placeholder="0"
                  className="w-full rounded-lg px-2.5 py-2 text-[13px] font-mono text-center outline-none"
                  style={{border:'1.5px solid #BAE6FD', background:'#fff'}}/>
              </div>
            </div>
            <div className="text-[9px] text-slate-400 mt-1.5 leading-tight">
              When stock hits the alert level, this product shows in the low-stock list.
              "Auto-restock qty" pre-fills the order quantity when you build a PO.
            </div>
            <button onClick={saveSettings} disabled={savingSettings}
              className="w-full mt-2.5 rounded-lg py-2 text-[11px] font-bold cursor-pointer border-none disabled:opacity-40"
              style={{background:'#0EA5E9', color:'#fff'}}>
              {savingSettings ? 'Saving...' : 'Save Restock Settings'}
            </button>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2 pt-4" style={{borderTop:'1px solid #f1f5f9'}}>
          <button onClick={onClose}
            className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border"
            style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>Cancel</button>
          <button onClick={handleSave} disabled={saving||!qty||!reason}
            className="flex-[2] rounded-xl py-3 text-[13px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background: adjustQty < 0
              ? '#dc2626'
              : '#000000'}}>
            {saving ? '⏳ Saving...' : `${adjustQty>=0?'+':''}${adjustQty} ${p.unit||'units'}`}
          </button>
        </div>
      </div>

      {showNumPad && (
        <NumPad
          title="Inventory Adjustment"
          subtitle={`${p.name} · Current: ${p.inventory?.reduce((a,i)=>a+(i.quantity||0),0)||0} ${p.unit}`}
          value={qty}
          onChange={setQty}
          suffix={` ${p.unit||'units'}`}
          allowNegative={true}
          allowDecimal={p.unit !== 'ea'}
          onConfirm={(val) => { setQty(String(val)); setShowNumPad(false) }}
          onClose={() => setShowNumPad(false)}
        />
      )}
    </div>
  )
}
