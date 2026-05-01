// src/pages/products/ProductsPage.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { ProductForm } from './ProductForm'

export default function ProductsPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [showReceive, setShowReceive] = useState(null)
  const [showAdjust, setShowAdjust] = useState(null)

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', tenant?.id, search, filterType],
    queryFn: async () => {
      let q = supabase.from('products')
        .select('*, inventory(quantity, avg_cost), tax_groups(name)')
        .eq('tenant_id', tenant.id).eq('is_active', true)
      if (search) q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%,upc.ilike.%${search}%`)
      if (filterType !== 'all' && filterType !== 'low') q = q.eq('type', filterType)
      const { data } = await q.order('name').limit(200)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const getQty = p => p.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const displayed = filterType === 'low'
    ? products.filter(p => getQty(p) <= 5 && p.type !== 'service')
    : products
  const lowStock = products.filter(p => getQty(p) <= 5 && p.type !== 'service').length

  const handleDelete = async id => {
    if (!confirm('Archive this product?')) return
    await supabase.from('products').update({ is_active: false }).eq('id', id)
    qc.invalidateQueries(['products'])
  }

  const TYPE_COLOR = { unit:'#3b82f6', weight:'#10b981', serialized:'#f59e0b', service:'#8b5cf6' }

  return (
    <div className="flex h-full bg-[#07090f]">
      {/* Sidebar */}
      <div className="w-[180px] bg-[#0d1117] border-r border-[#1e2d42] p-3 flex-shrink-0">
        <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-widest px-2 mb-2">Filter</div>
        {[['all','All Products',null],['unit','Unit','#3b82f6'],['weight','Weight','#10b981'],['serialized','Serialized','#f59e0b'],['service','Service','#8b5cf6']].map(([id,label,color]) => (
          <div key={id} onClick={() => setFilterType(id)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-[12px] mb-0.5 transition-all ${filterType===id?'bg-[#1a2236] text-white':'text-[#8899b0] hover:bg-[#111827] hover:text-white'}`}>
            {color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:color}}/>}
            {label}
          </div>
        ))}
        <div className="h-px bg-[#1e2d42] my-3"/>
        <div onClick={() => setFilterType('low')}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-[12px] transition-all ${filterType==='low'?'bg-red-500/10 text-red-400':'text-[#8899b0] hover:bg-[#111827]'}`}>
          <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"/>
          Low Stock
          {lowStock > 0 && <span className="ml-auto text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded font-mono">{lowStock}</span>}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#1e2d42] bg-[#0d1117] flex-shrink-0">
          <div className="flex gap-5 mr-2">
            {[['Products', products.length, ''],['Low Stock', lowStock, 'text-red-400'],['Value', '$'+products.reduce((s,p)=>{const q=getQty(p);return s+q*(p.inventory?.[0]?.avg_cost||p.cost||0)},0).toFixed(0), 'text-green-400']].map(([l,v,c]) => (
              <div key={l}><div className="text-[9px] font-mono text-[#3d5068] uppercase">{l}</div><div className={`text-[17px] font-bold ${c}`}>{v}</div></div>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 flex-1 focus-within:border-blue-500/40 transition-colors">
            <span className="text-[#3d5068]">🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, SKU, UPC..."
              className="bg-transparent border-none outline-none text-[#e8edf5] text-[12px] py-2 flex-1 placeholder-[#3d5068]"/>
          </div>
          <button onClick={()=>{setEditProduct(null);setShowForm(true)}}
            className="bg-blue-500 border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white cursor-pointer hover:bg-blue-600 transition-colors">
            + Add Product
          </button>
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <div className="grid grid-cols-4 gap-3">
              {Array(8).fill(0).map((_,i) => (
                <div key={i} className="bg-[#0d1117] border border-[#1e2d42] rounded-[12px] h-[200px] animate-pulse"/>
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#3d5068]">
              <div className="text-6xl mb-4 opacity-20">📦</div>
              <div className="text-[16px] font-semibold mb-2">No products yet</div>
              <div className="text-[12px] mb-4">Add your first product to get started</div>
              <button onClick={()=>{setEditProduct(null);setShowForm(true)}}
                className="bg-blue-500 border-none rounded-lg px-5 py-2.5 text-[12px] font-bold text-white cursor-pointer">
                + Add Product
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {displayed.map(p => {
                const qty = getQty(p)
                const avgCost = p.inventory?.[0]?.avg_cost || p.cost || 0
                const margin = p.price > 0 ? ((p.price - avgCost) / p.price * 100) : 0
                const profit = p.price - avgCost
                const isLow = qty <= 5 && p.type !== 'service'
                const typeColor = TYPE_COLOR[p.type] || '#3b82f6'
                return (
                  <div key={p.id} className="bg-[#0d1117] border border-[#1e2d42] rounded-[12px] overflow-hidden hover:border-[#243347] transition-all group">
                    {/* Image */}
                    <div className="h-[120px] bg-[#111827] flex items-center justify-center relative overflow-hidden">
                      {p.image_url
                        ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover"/>
                        : <span className="text-[48px] opacity-60">{p.emoji||'📦'}</span>
                      }
                      <div className="absolute top-2 left-2">
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                          style={{background:`${typeColor}22`,color:typeColor}}>
                          {p.type?.toUpperCase()}
                        </span>
                      </div>
                      {isLow && (
                        <div className="absolute top-2 right-2 bg-red-500/20 border border-red-500/30 rounded px-1.5 py-0.5 text-[9px] text-red-400 font-mono">LOW</div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-3">
                      <div className="text-[13px] font-bold truncate mb-0.5">{p.name}</div>
                      <div className="text-[10px] text-[#3d5068] font-mono mb-2">{p.sku || p.upc || '—'}</div>

                      {/* Price row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[15px] font-bold text-blue-400 font-mono">${parseFloat(p.price||0).toFixed(2)}</div>
                        <div className={`text-[11px] font-mono font-bold ${margin>=30?'text-green-400':margin>=10?'text-yellow-400':'text-red-400'}`}>
                          {margin.toFixed(1)}%
                        </div>
                      </div>

                      {/* Stock */}
                      {p.type !== 'service' && (
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-[10px] text-[#3d5068]">Stock</span>
                          <span className={`text-[12px] font-mono font-bold ${isLow?'text-red-400':'text-[#e8edf5]'}`}>
                            {qty} {p.unit}
                          </span>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={()=>setShowReceive(p)}
                          className="flex-1 bg-green-500/10 border border-green-500/20 rounded-md py-1.5 text-[9px] font-bold text-green-400 cursor-pointer hover:bg-green-500/15 transition-colors">
                          + Receive
                        </button>
                        <button onClick={()=>setShowAdjust(p)}
                          className="flex-1 bg-yellow-500/10 border border-yellow-500/20 rounded-md py-1.5 text-[9px] font-bold text-yellow-400 cursor-pointer hover:bg-yellow-500/15 transition-colors">
                          Adjust
                        </button>
                        <button onClick={()=>{setEditProduct(p);setShowForm(true)}}
                          className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-md py-1.5 text-[9px] font-bold text-[#8899b0] cursor-pointer hover:text-blue-400 hover:border-blue-500/30 transition-colors">
                          Edit
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showForm && (
        <ProductForm initial={editProduct||{}} tenantId={tenant?.id}
          onSave={()=>{qc.invalidateQueries(['products']);setShowForm(false);setEditProduct(null)}}
          onClose={()=>{setShowForm(false);setEditProduct(null)}}/>
      )}
      {showReceive && (
        <ReceiveModal product={showReceive} tenantId={tenant?.id}
          onSave={()=>{qc.invalidateQueries(['products']);setShowReceive(null)}}
          onClose={()=>setShowReceive(null)}/>
      )}
      {showAdjust && (
        <AdjustModal product={showAdjust} tenantId={tenant?.id}
          onSave={()=>{qc.invalidateQueries(['products']);setShowAdjust(null)}}
          onClose={()=>setShowAdjust(null)}/>
      )}
    </div>
  )
}

// ── Receive Inventory Modal ──
function ReceiveModal({ product: p, tenantId, onSave, onClose }) {
  const [form, setForm] = useState({ vendor_id:'', cost:'', qty:'', notes:'' })
  const [serials, setSerials] = useState([])
  const [serialInput, setSerialInput] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(prev=>({...prev,[k]:v}))

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('id,name').eq('tenant_id', tenantId).eq('is_active', true).order('name')
      return data || []
    },
    enabled: !!tenantId,
  })

  const needsSerials = p.type === 'serialized'
  const qty = parseInt(form.qty) || 0
  const serialsComplete = !needsSerials || serials.length === qty

  const addSerial = () => {
    if (!serialInput.trim()) return
    if (serials.includes(serialInput.trim())) { alert('Duplicate serial number'); return }
    if (serials.length >= qty) { alert('Already entered all serial numbers'); return }
    setSerials(prev => [...prev, serialInput.trim().toUpperCase()])
    setSerialInput('')
  }

  const handleSave = async () => {
    if (!form.qty || qty <= 0) { alert('Enter quantity'); return }
    if (needsSerials && serials.length < qty) { alert(`Enter all ${qty} serial numbers`); return }
    setSaving(true)
    try {
      const cost = parseFloat(form.cost) || 0
      // Update inventory quantity
      const { data: inv } = await supabase.from('inventory')
        .select('id, quantity, avg_cost').eq('product_id', p.id).maybeSingle()
      if (inv) {
        const newQty = (inv.quantity || 0) + qty
        const newAvgCost = ((inv.avg_cost||0) * (inv.quantity||0) + cost * qty) / newQty
        await supabase.from('inventory').update({ quantity: newQty, avg_cost: newAvgCost, updated_at: new Date().toISOString() }).eq('id', inv.id)
      } else {
        await supabase.from('inventory').insert({ tenant_id: tenantId, product_id: p.id, quantity: qty, avg_cost: cost })
      }
      // Save serial numbers
      if (needsSerials && serials.length > 0) {
        await supabase.from('serial_numbers').insert(
          serials.map(s => ({ tenant_id: tenantId, product_id: p.id, serial: s, status: 'in_stock' }))
        )
      }
      // Log receiving
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId, action: 'inventory.receive',
        new_data: { product_id: p.id, product_name: p.name, qty, cost, vendor_id: form.vendor_id, notes: form.notes, serials }
      })
      onSave()
    } catch(err) { alert('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[480px] max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1e2d42] flex items-center justify-between sticky top-0 bg-[#0d1117]">
          <div>
            <div className="text-[15px] font-bold">📥 Receive Inventory</div>
            <div className="text-[11px] text-[#3d5068] mt-0.5">{p.name}</div>
          </div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {/* Vendor */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Vendor</div>
            <select value={form.vendor_id} onChange={e=>set('vendor_id',e.target.value)}
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] text-[#e8edf5] outline-none focus:border-blue-500/40">
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          {/* Cost + Qty */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Cost per Unit</div>
              <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 focus-within:border-blue-500/40">
                <span className="text-[#3d5068] mr-1">$</span>
                <input type="number" value={form.cost} onChange={e=>set('cost',e.target.value)} placeholder="0.00" step="0.01"
                  className="flex-1 bg-transparent border-none outline-none py-2.5 text-[13px] font-mono placeholder-[#3d5068]"/>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Quantity</div>
              <input type="number" value={form.qty} onChange={e=>set('qty',e.target.value)} placeholder="0" min="1"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] font-mono outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
            </div>
          </div>
          {/* Total cost preview */}
          {form.cost && form.qty && (
            <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-4 py-2.5 flex justify-between">
              <span className="text-[11px] text-[#3d5068]">Total Cost</span>
              <span className="font-mono text-[12px] font-bold text-green-400">
                ${(parseFloat(form.cost)*parseInt(form.qty)).toFixed(2)}
              </span>
            </div>
          )}
          {/* Serial numbers */}
          {needsSerials && qty > 0 && (
            <div>
              <div className="flex justify-between mb-1.5">
                <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider">
                  Serial Numbers
                </div>
                <span className={`text-[10px] font-mono ${serials.length === qty ? 'text-green-400' : 'text-yellow-400'}`}>
                  {serials.length}/{qty}
                </span>
              </div>
              <div className="flex gap-2 mb-2">
                <input value={serialInput} onChange={e=>setSerialInput(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&addSerial()}
                  placeholder="Scan or type serial number..."
                  className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 text-[12px] font-mono outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
                <button onClick={addSerial}
                  className="bg-blue-500 border-none rounded-[9px] px-3 py-2 text-[11px] font-bold text-white cursor-pointer">
                  Add
                </button>
              </div>
              <div className="max-h-[120px] overflow-y-auto flex flex-col gap-1">
                {serials.map((s,i) => (
                  <div key={i} className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5">
                    <span className="text-[10px] text-[#3d5068] font-mono w-5">{i+1}.</span>
                    <span className="flex-1 font-mono text-[11px] text-green-400">{s}</span>
                    <button onClick={()=>setSerials(prev=>prev.filter((_,j)=>j!==i))}
                      className="text-[#3d5068] hover:text-red-400 text-[11px] bg-transparent border-none cursor-pointer">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Notes */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Notes (optional)</div>
            <input value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="PO number, notes..."
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[12px] outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4 sticky bottom-0 bg-[#0d1117]">
          <button onClick={onClose} className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-3 text-[13px] text-[#8899b0] cursor-pointer">Cancel</button>
          <button onClick={handleSave} disabled={saving || (needsSerials && serials.length < qty)}
            className="flex-[2] bg-gradient-to-r from-green-600 to-green-700 border-none rounded-[9px] py-3 text-[13px] font-bold text-white cursor-pointer disabled:opacity-40">
            {saving ? '⏳ Saving...' : `✓ Receive ${form.qty||0} ${p.unit||'units'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Adjust Inventory Modal ──
function AdjustModal({ product: p, tenantId, onSave, onClose }) {
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const adjustQty = parseInt(qty) || 0

  const handleSave = async () => {
    if (!qty) { alert('Enter adjustment quantity'); return }
    if (!reason.trim()) { alert('Enter a reason'); return }
    setSaving(true)
    try {
      const { data: inv } = await supabase.from('inventory')
        .select('id, quantity').eq('product_id', p.id).maybeSingle()
      const currentQty = inv?.quantity || 0
      const newQty = Math.max(0, currentQty + adjustQty)
      if (inv) {
        await supabase.from('inventory').update({ quantity: newQty, updated_at: new Date().toISOString() }).eq('id', inv.id)
      } else {
        await supabase.from('inventory').insert({ tenant_id: tenantId, product_id: p.id, quantity: newQty })
      }
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId, action: 'inventory.adjust',
        new_data: { product_id: p.id, product_name: p.name, adjustment: adjustQty, reason, before: currentQty, after: newQty }
      })
      onSave()
    } catch(err) { alert('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const REASONS = ['Damaged','Expired','Theft/Shrinkage','Received without PO','Count correction','Transfer out','Transfer in','Other']

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[400px]" onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1e2d42] flex items-center justify-between">
          <div>
            <div className="text-[15px] font-bold">⚖️ Adjust Inventory</div>
            <div className="text-[11px] text-[#3d5068] mt-0.5">{p.name}</div>
          </div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">
              Adjustment Quantity (use - to decrease)
            </div>
            <input type="number" value={qty} onChange={e=>setQty(e.target.value)}
              placeholder="+5 or -3" autoFocus
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-3 text-[18px] font-mono text-center outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
            {qty && (
              <div className={`mt-1.5 text-center text-[11px] font-mono ${adjustQty>=0?'text-green-400':'text-red-400'}`}>
                {adjustQty >= 0 ? `+${adjustQty}` : adjustQty} units
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Reason *</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {REASONS.map(r => (
                <button key={r} onClick={()=>setReason(r)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] border transition-all cursor-pointer ${
                    reason===r ? 'border-blue-500/40 bg-blue-500/10 text-blue-400' : 'border-[#1e2d42] bg-[#111827] text-[#8899b0] hover:border-[#243347]'
                  }`}>{r}</button>
              ))}
            </div>
            <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Or type a custom reason..."
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 text-[12px] outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4">
          <button onClick={onClose} className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-3 text-[13px] text-[#8899b0] cursor-pointer">Cancel</button>
          <button onClick={handleSave} disabled={saving || !qty || !reason}
            className={`flex-[2] border-none rounded-[9px] py-3 text-[13px] font-bold text-white cursor-pointer disabled:opacity-40 ${
              adjustQty < 0 ? 'bg-gradient-to-r from-red-600 to-red-700' : 'bg-gradient-to-r from-blue-600 to-blue-700'
            }`}>
            {saving ? '⏳ Saving...' : `${adjustQty>=0?'+':''}${adjustQty} ${p.unit||'units'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
