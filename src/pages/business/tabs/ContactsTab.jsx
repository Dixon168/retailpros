// src/pages/business/tabs/ContactsTab.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import DualInput from '@/components/ui/DualInput'

const ROLE_LABELS = {
  primary:   'Primary',
  contact:   'Contact',
  ap:        'A/P (billing)',
  ar:        'A/R (collections)',
  buyer:     'Buyer',
  manager:   'Manager',
  warehouse: 'Warehouse',
}

export default function ContactsTab({ customerId, tenantId, onChanged }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)  // null | 'new' | contact object

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['company-contacts', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('business_contacts')
        .select('*').eq('business_customer_id', customerId)
        .order('is_primary', { ascending: false }).order('name')
      return data || []
    },
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['company-contacts', customerId] })
    qc.invalidateQueries({ queryKey: ['company-tab-counts', customerId] })
    onChanged?.()
  }

  const deleteContact = async (c) => {
    if (c.is_primary) {
      toast.error('Cannot delete primary contact. Mark another as primary first.')
      return
    }
    if (!confirm(`Delete contact ${c.name}?`)) return
    const { error } = await supabase.from('business_contacts').delete().eq('id', c.id)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Contact deleted')
    refresh()
  }

  const setPrimary = async (c) => {
    // Unset current primary, set this one
    const r1 = await supabase.from('business_contacts').update({ is_primary: false })
      .eq('business_customer_id', customerId)
    if (r1.error) { toast.error('Failed: ' + r1.error.message); return }
    const { error } = await supabase.from('business_contacts').update({ is_primary: true }).eq('id', c.id)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success(`${c.name} is now the primary contact`)
    refresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] font-bold text-[#1F1F1F]">
          {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
        </div>
        <button onClick={() => setEditing('new')}
          className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
          + Add Contact
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-[12px] text-[#999]">Loading...</div>
      ) : contacts.length === 0 ? (
        <div className="rounded-lg p-8 text-center text-[12px] text-[#999]"
          style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
          No contacts yet. Add the first one with the button above.
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg overflow-hidden">
          {contacts.map(c => (
            <div key={c.id}
              className="px-3 py-3 border-b border-[#E5E5E5] last:border-0 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[13px] font-bold text-[#1F1F1F]">{c.name}</span>
                  {c.is_primary && (
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                      style={{background:'#FEF3C7', color:'#B45309'}}>
                      ⭐ Primary
                    </span>
                  )}
                  {c.role && c.role !== 'primary' && (
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                      style={{background:'#F5F5F5', color:'#666'}}>
                      {ROLE_LABELS[c.role] || c.role}
                    </span>
                  )}
                </div>
                {c.title && <div className="text-[10px] text-[#999]">{c.title}</div>}
                <div className="text-[11px] text-[#666] mt-1 flex gap-3 flex-wrap">
                  {c.phone && <span>📞 {c.phone}</span>}
                  {c.email && <span>✉️ {c.email}</span>}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {!c.is_primary && (
                  <button onClick={() => setPrimary(c)}
                    className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#B45309', border:'1px solid #FCD34D'}}
                    title="Mark as primary contact">
                    ⭐ Primary
                  </button>
                )}
                <button onClick={() => setEditing(c)}
                  className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                  style={{background:'#FFFFFF', color:'#5E6AD2', border:'1px solid #5E6AD2'}}>
                  Edit
                </button>
                {!c.is_primary && (
                  <button onClick={() => deleteContact(c)}
                    className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#dc2626', border:'1px solid #FECACA'}}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ContactFormModal
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

function ContactFormModal({ initial, customerId, tenantId, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name:  initial?.name  || '',
    title: initial?.title || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    role:  initial?.role  || 'contact',
    receive_invoice:  initial?.receive_invoice  ?? false,
    receive_reminder: initial?.receive_reminder ?? false,
  })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    try {
      const payload = {
        tenant_id: tenantId,
        business_customer_id: customerId,
        name:  form.name.trim(),
        title: form.title || null,
        phone: form.phone || null,
        email: form.email || null,
        role:  form.role,
        receive_invoice:  form.receive_invoice,
        receive_reminder: form.receive_reminder,
      }
      let error
      if (initial?.id) {
        ({ error } = await supabase.from('business_contacts').update(payload).eq('id', initial.id))
      } else {
        ({ error } = await supabase.from('business_contacts').insert(payload))
      }
      if (error) {
        toast.error('Failed: ' + error.message); return
      }
      toast.success(initial?.id ? 'Contact updated' : 'Contact added')
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
            {initial?.id ? 'Edit contact' : 'New contact'}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <DualInput label="Name *" value={form.name} onChange={v => set('name', v)}
              placeholder="John Smith" kbTitle="Contact name"/>
            <DualInput label="Title / role" value={form.title} onChange={v => set('title', v)}
              placeholder="Owner, Buyer..." kbTitle="Title"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DualInput label="Phone" mode="phone" value={form.phone} onChange={v => set('phone', v)}
              placeholder="(555) 123-4567" kbTitle="Phone"/>
            <DualInput label="Email" mode="email" value={form.email} onChange={v => set('email', v)}
              placeholder="john@acme.com" kbTitle="Email"/>
          </div>
          <div>
            <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Role</div>
            <select value={form.role} onChange={e => set('role', e.target.value)}
              className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none cursor-pointer">
              <option value="contact">Contact</option>
              <option value="ap">A/P (billing)</option>
              <option value="ar">A/R (collections)</option>
              <option value="buyer">Buyer</option>
              <option value="manager">Manager</option>
              <option value="warehouse">Warehouse</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={form.receive_invoice}
                onChange={e => set('receive_invoice', e.target.checked)}
                className="accent-[#5E6AD2]"/>
              <span>📧 Send invoices to this contact's email</span>
            </label>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={form.receive_reminder}
                onChange={e => set('receive_reminder', e.target.checked)}
                className="accent-[#5E6AD2]"/>
              <span>🔔 Send payment reminders to this contact</span>
            </label>
          </div>
        </div>
        <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving || !form.name.trim()}
            className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer text-white disabled:opacity-40"
            style={{background:'#5E6AD2', border:'none'}}>
            {saving ? 'Saving...' : initial?.id ? '✓ Save' : '+ Add Contact'}
          </button>
        </div>
      </div>
    </div>
  )
}
