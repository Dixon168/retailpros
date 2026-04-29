// src/pages/products/ProductForm.jsx
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

const TYPES = [
  { id:'unit',       label:'Unit',        desc:'Sell by qty',      emoji:'📦' },
  { id:'weight',     label:'Weight',      desc:'Sell by lb/kg',    emoji:'⚖️' },
  { id:'serialized', label:'Serialized',  desc:'Track serials',    emoji:'🔢' },
  { id:'service',    label:'Service',     desc:'Labor / service',  emoji:'🔧' },
]
const UNITS    = ['ea','lb','kg','oz','g','l','ml','ft','m','hr','pair','box','case','pack','roll']
const EMOJIS   = ['📦','📱','💻','🎧','⌚','🍎','🍌','🍇','🥛','🍞','🥤','💧','🔧','🏷️','🛡️','🔌','💊','🧴','👕','👟','🖥️','⌨️','🖱️','📷','🎮']

export function ProductForm({ initial = {}, tenantId, onSave, onClose }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    id:              initial.id              || null,
    name:            initial.name            || '',
    sku:             initial.sku             || '',
    barcode:         initial.barcode         || '',
    type:            initial.type            || 'unit',
    unit:            initial.unit            || 'ea',
    price:           initial.price           || '',
    cost:            initial.cost            || '',
    description:     initial.description     || '',
    track_inventory: initial.track_inventory ?? true,
    emoji:           initial.emoji           || '📦',
    init_qty:        '',
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const margin = form.price && form.cost
    ? (((parseFloat(form.price) - parseFloat(form.cost)) / parseFloat(form.price)) * 100).toFixed(1)
    : null

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Product name is required'); return }
    if (!form.price)       { toast.error('Price is required'); return }
    setSaving(true)
    try {
      const payload = {
        tenant_id:       tenantId,
        name:            form.name.trim(),
        sku:             form.sku     || null,
        barcode:         form.barcode || null,
        type:            form.type,
        unit:            form.unit,
        price:           parseFloat(form.price) || 0,
        cost:            parseFloat(form.cost)  || 0,
        description:     form.description       || null,
        track_inventory: form.track_inventory,
        emoji:           form.emoji,
        is_active:       true,
      }
      if (form.id) {
        const { error } = await supabase.from('products').update(payload).eq('id', form.id)
        if (error) throw error
        toast.success('Product updated')
      } else {
        const { data, error } = await supabase.from('products').insert(payload).select().single()
        if (error) throw error
        if (data?.id && form.track_inventory && form.type !== 'service') {
          await supabase.from('inventory').insert({
            tenant_id:  tenantId,
            product_id: data.id,
            quantity:   parseFloat(form.init_qty) || 0,
          })
        }
        toast.success('Product added!')
      }
      onSave?.()
    } catch (err) {
      toast.error('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50
      flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[540px]
        max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1e2d42] flex items-center justify-between sticky top-0 bg-[#0d1117] z-10">
          <div className="text-[15px] font-bold">
            {form.id ? '✏️ Edit Product' : '📦 New Product'}
          </div>
          <button onClick={onClose}
            className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer w-7 h-7 flex items-center justify-center rounded">
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">

          {/* Type selector */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">
              Product Type
            </div>
            <div className="grid grid-cols-4 gap-2">
              {TYPES.map(t => (
                <div key={t.id} onClick={() => set('type', t.id)}
                  className={`border rounded-[9px] p-2.5 cursor-pointer transition-all text-center ${
                    form.type === t.id
                      ? 'border-blue-500/50 bg-blue-500/8'
                      : 'border-[#1e2d42] bg-[#111827] hover:border-[#243347]'
                  }`}>
                  <div className="text-[18px] mb-1">{t.emoji}</div>
                  <div className={`text-[11px] font-bold ${form.type === t.id ? 'text-blue-400' : 'text-[#e8edf5]'}`}>
                    {t.label}
                  </div>
                  <div className="text-[9px] text-[#3d5068] mt-0.5">{t.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Emoji picker */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Icon</div>
            <div className="flex gap-1.5 flex-wrap">
              {EMOJIS.map(e => (
                <button key={e} onClick={() => set('emoji', e)}
                  className={`w-8 h-8 rounded-lg text-[16px] border transition-all cursor-pointer ${
                    form.emoji === e
                      ? 'border-blue-500/50 bg-blue-500/10'
                      : 'border-[#1e2d42] bg-[#111827] hover:border-[#243347]'
                  }`}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">
              Product Name *
            </div>
            <input
              value={form.name} onChange={e => set('name', e.target.value)}
              autoFocus placeholder="e.g. iPhone 15 Pro, Fuji Apple, Screen Repair"
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5
                text-[13px] outline-none focus:border-blue-500/40 transition-colors placeholder-[#3d5068]"
            />
          </div>

          {/* SKU + Barcode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">SKU</div>
              <input value={form.sku} onChange={e => set('sku', e.target.value)}
                placeholder="APL-IP15P"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5
                  text-[13px] font-mono outline-none focus:border-blue-500/40 transition-colors placeholder-[#3d5068]"/>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Barcode</div>
              <input value={form.barcode} onChange={e => set('barcode', e.target.value)}
                placeholder="012345678901"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5
                  text-[13px] font-mono outline-none focus:border-blue-500/40 transition-colors placeholder-[#3d5068]"/>
            </div>
          </div>

          {/* Price + Cost + Unit */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">
                {form.type === 'weight' ? `Price / ${form.unit}` : 'Sell Price *'}
              </div>
              <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3
                focus-within:border-blue-500/40 transition-colors">
                <span className="text-[#3d5068] mr-1 text-sm">$</span>
                <input type="number" value={form.price} onChange={e => set('price', e.target.value)}
                  placeholder="0.00" step="0.01" min="0"
                  className="flex-1 bg-transparent border-none outline-none py-2.5 text-[13px]
                    font-mono placeholder-[#3d5068]"/>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Cost</div>
              <div className="flex items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3
                focus-within:border-blue-500/40 transition-colors">
                <span className="text-[#3d5068] mr-1 text-sm">$</span>
                <input type="number" value={form.cost} onChange={e => set('cost', e.target.value)}
                  placeholder="0.00" step="0.01" min="0"
                  className="flex-1 bg-transparent border-none outline-none py-2.5 text-[13px]
                    font-mono placeholder-[#3d5068]"/>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Unit</div>
              <select value={form.unit} onChange={e => set('unit', e.target.value)}
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5
                  text-[13px] text-[#e8edf5] outline-none focus:border-blue-500/40">
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* Margin preview */}
          {margin && (
            <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-4 py-2.5
              flex justify-between items-center">
              <span className="text-[11px] text-[#3d5068]">Margin</span>
              <span className="font-mono text-[12px] font-bold text-green-400">
                {margin}%
                <span className="text-[#3d5068] ml-2 font-normal">
                  (${(parseFloat(form.price) - parseFloat(form.cost)).toFixed(2)} per {form.unit})
                </span>
              </span>
            </div>
          )}

          {/* Opening stock - new products only */}
          {!form.id && form.type !== 'service' && form.track_inventory && (
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">
                Opening Stock
              </div>
              <input type="number" value={form.init_qty} onChange={e => set('init_qty', e.target.value)}
                placeholder="0" min="0"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5
                  text-[13px] font-mono outline-none focus:border-blue-500/40 transition-colors placeholder-[#3d5068]"/>
              <div className="text-[10px] text-[#3d5068] mt-1">Starting inventory quantity</div>
            </div>
          )}

          {/* Description */}
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">
              Description <span className="text-[#3d5068] normal-case font-normal">(optional)</span>
            </div>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} placeholder="Optional product description..."
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5
                text-[12px] outline-none focus:border-blue-500/40 transition-colors resize-none placeholder-[#3d5068]"/>
          </div>

          {/* Track inventory toggle */}
          {form.type !== 'service' && (
            <label className="flex items-center gap-3 bg-[#111827] border border-[#1e2d42]
              rounded-[9px] px-4 py-3 cursor-pointer">
              <input type="checkbox" checked={form.track_inventory}
                onChange={e => set('track_inventory', e.target.checked)}
                className="w-4 h-4 accent-blue-500"/>
              <div>
                <div className="text-[13px] font-semibold">Track Inventory</div>
                <div className="text-[10px] text-[#3d5068] mt-0.5">
                  Show stock levels and low stock alerts
                </div>
              </div>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4 sticky bottom-0 bg-[#0d1117]">
          <button onClick={onClose}
            className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-3
              text-[13px] text-[#8899b0] cursor-pointer hover:text-white transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-[2] bg-gradient-to-r from-blue-600 to-blue-700 border-none
              rounded-[9px] py-3 text-[13px] font-bold text-white cursor-pointer
              disabled:opacity-50 hover:from-blue-500 hover:to-blue-600 transition-all">
            {saving ? '⏳ Saving...' : form.id ? '✓ Update Product' : '✓ Add Product'}
          </button>
        </div>
      </div>
    </div>
  )
}
