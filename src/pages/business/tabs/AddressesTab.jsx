// src/pages/business/tabs/AddressesTab.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import DualInput from '@/components/ui/DualInput'

const TYPE_LABELS = {
  billing:  { label:'📄 Billing',   bg:'#E6F0FF', color:'#006AFF' },
  delivery: { label:'🚚 Delivery',  bg:'#DCFCE7', color:'#15803D' },
  shipping: { label:'📦 Shipping',  bg:'#FEF3C7', color:'#B45309' },
}

export default function AddressesTab({ customerId, tenantId, onChanged }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)

  const { data: addresses = [], isLoading } = useQuery({
    queryKey: ['company-addresses', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('business_addresses')
        .select('*').eq('business_customer_id', customerId)
        .order('is_default', { ascending: false })
        .order('type')
      return data || []
    },
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['company-addresses', customerId] })
    qc.invalidateQueries({ queryKey: ['company-tab-counts', customerId] })
    onChanged?.()
  }

  const deleteAddress = async (a) => {
    if (!confirm(`Delete this address?\n${a.address}, ${a.city}`)) return
    const { error } = await supabase.from('business_addresses').delete().eq('id', a.id)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Address deleted')
    refresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] font-bold text-[#1F1F1F]">
          {addresses.length} address{addresses.length !== 1 ? 'es' : ''}
        </div>
        <button onClick={() => setEditing('new')}
          className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
          + Add Address
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-[12px] text-[#999]">Loading...</div>
      ) : addresses.length === 0 ? (
        <div className="rounded-lg p-8 text-center text-[12px] text-[#999]"
          style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
          No addresses yet. Add billing or delivery addresses with the button above.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {addresses.map(a => {
            const t = TYPE_LABELS[a.type] || { label: a.label || '📍 Other', bg:'#F5F5F5', color:'#666' }
            return (
              <div key={a.id} className="rounded-lg p-3"
                style={{background:'#FFFFFF', border:'1px solid #E5E5E5'}}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                    style={{background:t.bg, color:t.color}}>
                    {t.label}
                  </span>
                  {a.is_default && (
                    <span className="text-[9px] font-bold uppercase text-[#15803D]">⭐ Default</span>
                  )}
                </div>
                <div className="text-[12px] text-[#1F1F1F] mb-2">
                  <div className="font-bold">{a.label || (a.type ? `${a.type.charAt(0).toUpperCase() + a.type.slice(1)} address` : 'Address')}</div>
                  <div>{a.address}</div>
                  <div>{[a.city, a.state, a.zip].filter(Boolean).join(', ')}</div>
                  {a.country && a.country !== 'US' && <div>{a.country}</div>}
                </div>
                {(a.contact_name || a.contact_phone) && (
                  <div className="text-[10px] text-[#666] mb-2">
                    {a.contact_name && <div>👤 {a.contact_name}</div>}
                    {a.contact_phone && <div>📞 {a.contact_phone}</div>}
                  </div>
                )}
                <div className="flex gap-1.5">
                  <button onClick={() => setEditing(a)}
                    className="flex-1 rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #006AFF'}}>
                    Edit
                  </button>
                  <button onClick={() => deleteAddress(a)}
                    className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#CF1322', border:'1px solid #FECACA'}}>
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <AddressFormModal
          initial={editing === 'new' ? null : editing}
          customerId={customerId}
          tenantId={tenantId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
    </div>
  )
}

function AddressFormModal({ initial, customerId, tenantId, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    type:    initial?.type    || 'delivery',
    label:   initial?.label   || '',
    address: initial?.address || '',
    city:    initial?.city    || '',
    state:   initial?.state   || '',
    zip:     initial?.zip     || '',
    contact_name:  initial?.contact_name  || '',
    contact_phone: initial?.contact_phone || '',
    is_default: initial?.is_default ?? false,
  })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const save = async () => {
    if (!form.address.trim()) { toast.error('Address required'); return }
    setSaving(true)
    try {
      const payload = {
        tenant_id: tenantId,
        business_customer_id: customerId,
        type:    form.type,
        label:   form.label || null,
        address: form.address.trim(),
        city:    form.city  || null,
        state:   form.state || null,
        zip:     form.zip   || null,
        contact_name:  form.contact_name  || null,
        contact_phone: form.contact_phone || null,
        is_default:    form.is_default,
      }
      let error
      if (initial?.id) {
        ({ error } = await supabase.from('business_addresses').update(payload).eq('id', initial.id))
      } else {
        ({ error } = await supabase.from('business_addresses').insert(payload))
      }
      if (error) { toast.error('Failed: ' + error.message); return }
      toast.success(initial?.id ? 'Address updated' : 'Address added')
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.5)'}}>
      <div className="rounded-2xl overflow-hidden" style={{
        width:'520px', maxWidth:'100%', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
      }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div className="text-[15px] font-bold text-[#1F1F1F]">
            {initial?.id ? 'Edit address' : 'New address'}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Type</div>
            <div className="grid grid-cols-3 gap-2">
              {[['billing','📄 Billing'],['delivery','🚚 Delivery'],['shipping','📦 Shipping']].map(([val,label]) => (
                <button key={val} onClick={() => set('type', val)}
                  className="rounded-lg py-2 text-[11px] font-bold cursor-pointer active:scale-[0.97]"
                  style={form.type === val
                    ? { background:'#006AFF', color:'#FFFFFF', border:'none' }
                    : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <DualInput label="Custom label (optional)" value={form.label} onChange={v => set('label', v)}
            placeholder="e.g. Warehouse #2, Brooklyn store" kbTitle="Label"/>
          <DualInput label="Street address *" value={form.address} onChange={v => set('address', v)}
            placeholder="123 Main St" kbTitle="Address"/>
          <div className="grid grid-cols-3 gap-3">
            <DualInput label="City" value={form.city} onChange={v => set('city', v)}
              placeholder="Brooklyn" kbTitle="City"/>
            <DualInput label="State" value={form.state} onChange={v => set('state', v)}
              placeholder="NY" kbTitle="State"/>
            <DualInput label="ZIP" mode="numeric" value={form.zip} onChange={v => set('zip', v)}
              placeholder="11209" kbTitle="ZIP"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DualInput label="Contact at this address" value={form.contact_name} onChange={v => set('contact_name', v)}
              placeholder="Receiving dock" kbTitle="Contact name"/>
            <DualInput label="Phone" mode="phone" value={form.contact_phone} onChange={v => set('contact_phone', v)}
              placeholder="(555) 999-8888" kbTitle="Phone"/>
          </div>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer">
            <input type="checkbox" checked={form.is_default}
              onChange={e => set('is_default', e.target.checked)}
              className="accent-[#006AFF]"/>
            <span>⭐ Use as default {form.type} address</span>
          </label>
        </div>
        <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving || !form.address.trim()}
            className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer text-white disabled:opacity-40"
            style={{background:'#006AFF', border:'none'}}>
            {saving ? 'Saving...' : initial?.id ? '✓ Save' : '+ Add Address'}
          </button>
        </div>
      </div>
    </div>
  )
}
