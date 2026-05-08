// src/pages/products/ReceiveModal.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import NumPad from '@/components/ui/NumPad'
import toast from 'react-hot-toast'

export function ReceiveModal({ product: p, tenantId, onSave, onClose }) {
  const [form, setForm] = useState({ vendor_id:'', cost:'', qty:'', notes:'' })
  const [serials, setSerials] = useState([])
  const [serialInput, setSerialInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [showQtyPad, setShowQtyPad] = useState(false)
  const [showCostPad, setShowCostPad] = useState(false)
  const set = (k,v) => setForm(prev=>({...prev,[k]:v}))

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('id,name')
        .eq('tenant_id', tenantId).eq('is_active', true).order('name')
      return data || []
    },
    enabled: !!tenantId,
  })

  const needsSerials = p.has_serial || p.type === 'serialized'
  const qty = parseInt(form.qty) || 0
  const serialsComplete = !needsSerials || serials.length === qty

  const addSerial = () => {
    const s = serialInput.trim().toUpperCase()
    if (!s) return
    if (serials.includes(s)) { toast.error('Duplicate serial number'); return }
    if (serials.length >= qty) { toast.error('Already entered all serial numbers'); return }
    setSerials(prev => [...prev, s])
    setSerialInput('')
  }

  const handleSave = async () => {
    if (!form.qty || qty <= 0) { toast.error('Enter quantity'); return }
    if (needsSerials && serials.length < qty) { toast.error(`Enter all ${qty} serial numbers`); return }
    setSaving(true)
    try {
      const cost = parseFloat(form.cost) || 0
      const { data: inv } = await supabase.from('inventory')
        .select('id,quantity,avg_cost').eq('product_id', p.id).maybeSingle()
      if (inv) {
        const newQty = (inv.quantity||0) + qty
        const newAvgCost = ((inv.avg_cost||0)*(inv.quantity||0) + cost*qty) / newQty
        await supabase.from('inventory').update({ quantity: newQty, avg_cost: newAvgCost, updated_at: new Date().toISOString() }).eq('id', inv.id)
      } else {
        await supabase.from('inventory').insert({ tenant_id: tenantId, product_id: p.id, quantity: qty, avg_cost: cost })
      }
      if (needsSerials && serials.length > 0) {
        await supabase.from('serial_numbers').insert(serials.map(s => ({ tenant_id: tenantId, product_id: p.id, serial: s, status: 'in_stock' })))
      }
      await supabase.from('inventory_receives').insert({ tenant_id: tenantId, product_id: p.id, vendor_id: form.vendor_id||null, qty, cost, notes: form.notes||null })
      toast.success(`✓ Received ${qty} ${p.unit||'units'} of ${p.name}`)
      onSave()
    } catch(err) { toast.error('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{background:'rgba(15,23,42,0.55)', backdropFilter:'blur(2px)'}} onClick={onClose}>
      <div className="rounded-2xl w-[480px] max-h-[90vh] overflow-y-auto shadow-md"
        style={{background:'#fff'}} onClick={e=>e.stopPropagation()}>

        <div className="px-5 py-4 flex items-center justify-between sticky top-0"
          style={{background:'#f0fdf4', borderBottom:'1.5px solid #86efac', borderRadius:'16px 16px 0 0'}}>
          <div>
            <div className="text-[15px] font-bold text-slate-800">📥 Receive Inventory</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{p.name}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-[18px]">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Vendor</div>
            <select value={form.vendor_id} onChange={e=>set('vendor_id',e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
              style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#1e293b'}}>
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Cost per Unit</div>
              <button onClick={()=>setShowCostPad(true)}
                className="w-full rounded-xl px-3 py-2.5 text-[14px] font-mono font-bold text-left cursor-pointer"
                style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color: form.cost ? '#1e293b' : '#94a3b8'}}>
                ${form.cost || '0.00'}
              </button>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Quantity</div>
              <button onClick={()=>setShowQtyPad(true)}
                className="w-full rounded-xl px-3 py-2.5 text-[14px] font-mono font-bold text-center cursor-pointer"
                style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color: form.qty ? '#16a34a' : '#94a3b8'}}>
                {form.qty || '0'} {p.unit}
              </button>
            </div>
          </div>

          {form.cost && form.qty && (
            <div className="rounded-xl px-4 py-2.5 flex justify-between"
              style={{background:'#f0fdf4', border:'1px solid #86efac'}}>
              <span className="text-[12px] text-slate-500">Total Cost</span>
              <span className="font-mono text-[13px] font-bold text-green-600">${(parseFloat(form.cost)*qty).toFixed(2)}</span>
            </div>
          )}

          {needsSerials && qty > 0 && (
            <div>
              <div className="flex justify-between mb-1.5">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Serial Numbers</div>
                <span className={`text-[10px] font-mono font-bold ${serials.length===qty?'text-green-600':'text-amber-600'}`}>{serials.length}/{qty}</span>
              </div>
              <div className="flex gap-2 mb-2">
                <input value={serialInput} onChange={e=>setSerialInput(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&addSerial()} placeholder="Scan or type serial..."
                  className="flex-1 rounded-xl px-3 py-2 text-[12px] font-mono outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
                <button onClick={addSerial}
                  className="rounded-xl px-3 py-2 text-[11px] font-bold text-white cursor-pointer border-none"
                  style={{background:'#006AFF'}}>Add</button>
              </div>
              <div className="max-h-[120px] overflow-y-auto flex flex-col gap-1">
                {serials.map((s,i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-1.5"
                    style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                    <span className="text-[10px] text-slate-400 font-mono w-5">{i+1}.</span>
                    <span className="flex-1 font-mono text-[11px] font-semibold text-green-600">{s}</span>
                    <button onClick={()=>setSerials(prev=>prev.filter((_,j)=>j!==i))}
                      className="text-slate-400 hover:text-red-500 bg-transparent border-none cursor-pointer text-[11px]">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Notes (optional)</div>
            <input value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="PO number, notes..."
              className="w-full rounded-xl px-3 py-2.5 text-[12px] outline-none"
              style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2 sticky bottom-0 pt-4"
          style={{background:'#fff', borderTop:'1px solid #f1f5f9'}}>
          <button onClick={onClose}
            className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border"
            style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>Cancel</button>
          <button onClick={handleSave} disabled={saving||(needsSerials&&serials.length<qty)}
            className="flex-[2] rounded-xl py-3 text-[13px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background:'#00B23B'}}>
            {saving ? '⏳ Saving...' : `✓ Receive ${qty||0} ${p.unit||'units'}`}
          </button>
        </div>
      </div>

      {showQtyPad && (
        <NumPad title="Receive Quantity" subtitle={p.name}
          value={form.qty} onChange={v=>set('qty',v)}
          suffix={` ${p.unit}`} allowNegative={false} allowDecimal={false}
          onConfirm={v=>{set('qty',String(v));setShowQtyPad(false)}}
          onClose={()=>setShowQtyPad(false)}/>
      )}
      {showCostPad && (
        <NumPad title="Cost per Unit" subtitle={p.name}
          value={form.cost} onChange={v=>set('cost',v)}
          prefix="$" allowNegative={false} allowDecimal={true}
          onConfirm={v=>{set('cost',String(v));setShowCostPad(false)}}
          onClose={()=>setShowCostPad(false)}/>
      )}
    </div>
  )
}
