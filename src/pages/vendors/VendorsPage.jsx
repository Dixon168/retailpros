// src/pages/vendors/VendorsPage.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { QWERTYKeyboard, NumericKeypad } from '@/components/ui/TouchKeyboards'

const PO_STATUS = {
  draft:     { bg:'#F5F5F5',  color:'#666666' },
  ordered:   { bg:'#E6F0FF',  color:'#006AFF' },
  partial:   { bg:'#FEF3C7',  color:'#B45309' },
  received:  { bg:'#DCFCE7',  color:'#15803D' },
  cancelled: { bg:'#FEE2E2',  color:'#CF1322' },
}

export default function VendorsPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers', tenant?.id, showInactive],
    queryFn: async () => {
      let q = supabase.from('suppliers').select('*').eq('tenant_id', tenant.id)
      if (!showInactive) q = q.eq('is_active', true)
      const { data } = await q.order('name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const { data: pos = [] } = useQuery({
    queryKey: ['purchase-orders', selectedVendor?.id],
    queryFn: async () => {
      const { data } = await supabase.from('purchase_orders')
        .select('*')
        .eq('supplier_id', selectedVendor.id).eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false }).limit(20)
      return data || []
    },
    enabled: !!selectedVendor?.id,
  })

  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) ||
           (s.contact_name || '').toLowerCase().includes(q) ||
           (s.email || '').toLowerCase().includes(q)
  })

  const totalSpend = pos.reduce((sum, p) => sum + (p.total || 0), 0)
  const pending = pos.filter(p => ['ordered', 'partial'].includes(p.status))

  const handleDeactivate = async (vendor) => {
    const { error } = await supabase.from('suppliers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', vendor.id)
    if (error) { toast.error(error.message); return }
    toast.success(`${vendor.name} deactivated`)
    if (selectedVendor?.id === vendor.id) setSelectedVendor(null)
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }

  const handleReactivate = async (vendor) => {
    const { error } = await supabase.from('suppliers')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', vendor.id)
    if (error) { toast.error(error.message); return }
    toast.success(`${vendor.name} reactivated`)
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }

  const handleDeleteForever = async (vendor) => {
    const { error } = await supabase.from('suppliers').delete().eq('id', vendor.id)
    if (error) {
      toast.error(error.message.includes('violates')
        ? 'Cannot delete: vendor has purchase orders. Deactivate instead.'
        : error.message)
      return
    }
    toast.success(`${vendor.name} permanently deleted`)
    if (selectedVendor?.id === vendor.id) setSelectedVendor(null)
    setConfirmDelete(null)
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }

  return (
    <div className="flex h-full bg-[#FAFAFA]">
      <div className="w-[300px] bg-[#FFFFFF] border-r border-[#E5E5E5] flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-[#E5E5E5] space-y-2">
          <div className="flex items-center gap-2 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3">
            <span className="text-[#999]">🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search vendors..."
              className="bg-transparent border-none outline-none py-2 text-[12px] flex-1"/>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-[#666] cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
              className="cursor-pointer accent-blue-500"/>
            Show inactive vendors
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="p-6 text-center text-[12px] text-[#999]">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-[36px] mb-2 opacity-40">🚚</div>
              <div className="text-[12px] text-[#999] mb-3">
                {search ? 'No vendors match your search' : 'No vendors yet'}
              </div>
              {!search && (
                <button onClick={() => setEditing('new')}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                  style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
                  + Add your first vendor
                </button>
              )}
            </div>
          ) : (
            filtered.map((s) => (
              <div key={s.id} onClick={() => setSelectedVendor(s)}
                className="p-3 rounded-lg cursor-pointer mb-1 transition-all active:scale-[0.99]"
                style={selectedVendor?.id === s.id
                  ? { background:'#E6F0FF', border:'1px solid #006AFF' }
                  : { background:'#FFFFFF', border:'1px solid transparent' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[14px] font-bold text-white flex-shrink-0"
                    style={{background:'#006AFF', opacity: s.is_active ? 1 : 0.4}}>
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate" style={{color: s.is_active ? '#1F1F1F' : '#999'}}>
                      {s.name}
                    </div>
                    <div className="text-[10px] text-[#999] truncate">
                      {s.contact_name || s.email || s.phone || '—'}
                    </div>
                  </div>
                  {!s.is_active && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{background:'#FEE2E2', color:'#CF1322'}}>OFF</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-3 border-t border-[#E5E5E5]">
          <button onClick={() => setEditing('new')}
            className="w-full rounded-lg py-2.5 text-[12px] font-bold cursor-pointer active:scale-[0.98]"
            style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
            + Add Vendor
          </button>
        </div>
      </div>

      {selectedVendor ? (
        <div className="flex-1 overflow-y-auto p-6 bg-[#FAFAFA]">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-[58px] h-[58px] rounded-xl flex items-center justify-center text-[22px] font-bold text-white flex-shrink-0"
              style={{background: selectedVendor.is_active ? '#006AFF' : '#999'}}>
              {selectedVendor.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="text-[20px] font-bold text-[#1F1F1F]">{selectedVendor.name}</div>
              <div className="text-[12px] text-[#666] mt-1">
                {[selectedVendor.email, selectedVendor.phone,
                  selectedVendor.city && `${selectedVendor.city}${selectedVendor.state ? ', ' + selectedVendor.state : ''}`
                ].filter(Boolean).join(' · ') || 'No contact info'}
              </div>
              <div className="flex gap-2 mt-2">
                {selectedVendor.payment_terms && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{background:'#FEF3C7', color:'#B45309'}}>{selectedVendor.payment_terms}</span>
                )}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={selectedVendor.is_active
                    ? {background:'#DCFCE7', color:'#15803D'}
                    : {background:'#FEE2E2', color:'#CF1322'}}>
                  {selectedVendor.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setEditing(selectedVendor)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
                ✏️ Edit
              </button>
              {selectedVendor.is_active ? (
                <button onClick={() => handleDeactivate(selectedVendor)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                  style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>
                  Deactivate
                </button>
              ) : (
                <button onClick={() => handleReactivate(selectedVendor)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                  style={{background:'#DCFCE7', color:'#15803D', border:'1px solid #BBF7D0'}}>
                  ↻ Reactivate
                </button>
              )}
              <button onClick={() => setConfirmDelete(selectedVendor)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#FFFFFF', color:'#CF1322', border:'1px solid #FECACA'}}>
                🗑 Delete
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-6">
            <Stat label="Total Spent" value={`$${totalSpend.toFixed(0)}`} color="#006AFF"/>
            <Stat label="Purchase Orders" value={pos.length}/>
            <Stat label="Pending POs" value={pending.length} color={pending.length > 0 ? '#F59E0B' : undefined}/>
            <Stat label="Avg Order" value={pos.length > 0 ? `$${(totalSpend/pos.length).toFixed(0)}` : '—'} color="#15803D"/>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <DetailCard title="Contact">
              <DetailRow label="Contact Name" value={selectedVendor.contact_name}/>
              <DetailRow label="Email" value={selectedVendor.email}/>
              <DetailRow label="Phone" value={selectedVendor.phone}/>
              <DetailRow label="Address" value={
                [selectedVendor.address, selectedVendor.city, selectedVendor.state, selectedVendor.zip]
                  .filter(Boolean).join(', ')
              }/>
            </DetailCard>
            <DetailCard title="Terms & Notes">
              <DetailRow label="Payment Terms" value={selectedVendor.payment_terms}/>
              <DetailRow label="Notes" value={selectedVendor.notes} multiline/>
            </DetailCard>
          </div>

          <div className="mb-2 flex justify-between items-center">
            <div className="text-[14px] font-bold text-[#1F1F1F]">📋 Purchase Orders</div>
            <button onClick={() => toast('PO module coming next — let me know when ready', { icon: 'ℹ️' })}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer active:scale-[0.96]"
              style={{background:'#F5F5F5', color:'#666', border:'1px solid #E5E5E5'}}>
              + New PO
            </button>
          </div>
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
            {pos.length === 0 ? (
              <div className="text-center py-10 text-[12px] text-[#999]">
                <div className="text-[36px] mb-2 opacity-30">📋</div>
                No purchase orders yet
              </div>
            ) : (
              <>
                <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]"
                  style={{gridTemplateColumns:'1.2fr 1fr 1fr 1fr 1fr 100px'}}>
                  {['PO Number','Status','Order Date','Expected','Amount','Actions'].map(h => (
                    <div key={h} className="px-3.5 py-2.5 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                  ))}
                </div>
                {pos.map(po => {
                  const st = PO_STATUS[po.status] || PO_STATUS.draft
                  return (
                    <div key={po.id} className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA]"
                      style={{gridTemplateColumns:'1.2fr 1fr 1fr 1fr 1fr 100px'}}>
                      <div className="px-3.5 py-3 font-mono text-[12px] font-bold text-[#006AFF]">{po.po_number}</div>
                      <div className="px-3.5 py-3">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded" style={{background:st.bg, color:st.color}}>
                          {po.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="px-3.5 py-3 text-[11px] text-[#666]">
                        {po.order_date ? new Date(po.order_date).toLocaleDateString() : '—'}
                      </div>
                      <div className="px-3.5 py-3 text-[11px] text-[#666]">
                        {po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '—'}
                      </div>
                      <div className="px-3.5 py-3 font-mono text-[12px] font-bold text-[#1F1F1F]">
                        ${po.total?.toFixed(2) || '0.00'}
                      </div>
                      <div className="px-3.5 py-3 flex gap-1.5">
                        <button onClick={() => toast('PO module coming next')}
                          className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                          style={{background:'#F5F5F5', color:'#666', border:'1px solid #E5E5E5'}}>View</button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[#FAFAFA]">
          <div className="text-center">
            <div className="text-[60px] mb-4 opacity-20">🚚</div>
            <div className="text-[14px] text-[#666] mb-1">Select a vendor to view details</div>
            <div className="text-[12px] text-[#999]">or</div>
            <button onClick={() => setEditing('new')}
              className="mt-2 rounded-lg px-4 py-2 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              + Add Your First Vendor
            </button>
          </div>
        </div>
      )}

      {editing && (
        <VendorFormModal
          vendor={editing === 'new' ? null : editing}
          tenantId={tenant.id}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: ['suppliers'] })
            if (saved) setSelectedVendor(saved)
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          vendor={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => handleDeleteForever(confirmDelete)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg p-3">
      <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-[20px] font-bold" style={{color: color || '#1F1F1F'}}>{value}</div>
    </div>
  )
}

function DetailCard({ title, children }) {
  return (
    <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-4">
      <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  )
}

function DetailRow({ label, value, multiline }) {
  if (multiline) {
    return (
      <div className="mb-2 last:mb-0">
        <div className="text-[10px] text-[#999] mb-1">{label}</div>
        <div className="text-[12px] text-[#1F1F1F] whitespace-pre-wrap">{value || '—'}</div>
      </div>
    )
  }
  return (
    <div className="flex justify-between gap-3 mb-2 last:mb-0">
      <span className="text-[11px] text-[#999] flex-shrink-0">{label}</span>
      <span className="text-[12px] font-semibold text-[#1F1F1F] text-right truncate">{value || '—'}</span>
    </div>
  )
}

function VendorFormModal({ vendor, tenantId, onClose, onSaved }) {
  const isNew = !vendor
  const [form, setForm] = useState({
    name:           vendor?.name           || '',
    contact_name:   vendor?.contact_name   || '',
    email:          vendor?.email          || '',
    phone:          vendor?.phone          || '',
    address:        vendor?.address        || '',
    city:           vendor?.city           || '',
    state:          vendor?.state          || '',
    zip:            vendor?.zip            || '',
    payment_terms:  vendor?.payment_terms  || '',
    notes:          vendor?.notes          || '',
  })
  const [saving, setSaving] = useState(false)
  const [showKB, setShowKB] = useState(null)
  const [showNumPad, setShowNumPad] = useState(null)

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { toast.error('Vendor name is required'); return }
    setSaving(true)
    const payload = { ...form, tenant_id: tenantId, updated_at: new Date().toISOString() }
    let result
    if (isNew) {
      result = await supabase.from('suppliers').insert(payload).select().single()
    } else {
      result = await supabase.from('suppliers').update(payload).eq('id', vendor.id).select().single()
    }
    setSaving(false)
    if (result.error) { toast.error(result.error.message); return }
    toast.success(isNew ? `${form.name} added` : `${form.name} updated`)
    onSaved(result.data)
  }

  const openKB = (field, label) => setShowKB({
    field, title: label, value: form[field], onChange: v => set(field, v),
  })
  const openNumPad = (field, label) => setShowNumPad({
    field, title: label, value: form[field], onChange: v => set(field, v),
  })

  return (
    <>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
        <div className="rounded-2xl overflow-hidden flex flex-col" style={{
          width:'520px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
          boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
        }}>
          <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
            <div>
              <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">
                {isNew ? 'New Vendor' : 'Edit Vendor'}
              </div>
              <div className="text-[16px] font-bold text-[#1F1F1F]">{form.name || 'Untitled'}</div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
              style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <FormField label="Vendor Name *" value={form.name} onTap={() => openKB('name', 'Vendor Name')} required/>
            <FormField label="Contact Person" value={form.contact_name} onTap={() => openKB('contact_name', 'Contact Person')}/>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Email" value={form.email} onTap={() => openKB('email', 'Email')}/>
              <FormField label="Phone" value={form.phone} onTap={() => openNumPad('phone', 'Phone Number')} mono/>
            </div>

            <FormField label="Street Address" value={form.address} onTap={() => openKB('address', 'Street Address')}/>

            <div className="grid grid-cols-3 gap-3">
              <FormField label="City" value={form.city} onTap={() => openKB('city', 'City')}/>
              <FormField label="State" value={form.state} onTap={() => openKB('state', 'State')}/>
              <FormField label="ZIP" value={form.zip} onTap={() => openNumPad('zip', 'ZIP Code')} mono/>
            </div>

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Payment Terms</div>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {['Net 15', 'Net 30', 'Net 60', 'COD'].map(t => (
                  <button key={t} onClick={() => set('payment_terms', form.payment_terms === t ? '' : t)}
                    className="px-2 py-2 rounded-lg text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                    style={form.payment_terms === t
                      ? { background:'#E6F0FF', color:'#006AFF', border:'1px solid #006AFF' }
                      : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
                    {t}
                  </button>
                ))}
              </div>
              <button onClick={() => openKB('payment_terms', 'Custom Payment Terms')}
                className="w-full text-left bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2 text-[12px] cursor-pointer"
                style={{color: form.payment_terms && !['Net 15','Net 30','Net 60','COD'].includes(form.payment_terms) ? '#1F1F1F' : '#999'}}>
                {form.payment_terms && !['Net 15','Net 30','Net 60','COD'].includes(form.payment_terms)
                  ? form.payment_terms
                  : 'Or tap to type custom terms...'}
              </button>
            </div>

            <FormField label="Notes" value={form.notes} onTap={() => openKB('notes', 'Notes')} multiline/>
          </div>

          <div className="px-5 py-4 flex gap-2 flex-shrink-0" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onClose}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              Cancel
            </button>
            <button onClick={save} disabled={saving || !form.name.trim()}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              {saving ? 'Saving...' : (isNew ? 'Add Vendor' : 'Save Changes')}
            </button>
          </div>
        </div>
      </div>

      {showKB && (
        <QWERTYKeyboard value={showKB.value} onChange={showKB.onChange}
          onClose={() => setShowKB(null)} title={showKB.title}
          mode={showKB.field === 'email' ? 'email' : 'text'}/>
      )}
      {showNumPad && (
        <NumericKeypad value={showNumPad.value} onChange={showNumPad.onChange}
          onClose={() => setShowNumPad(null)} title={showNumPad.title}
          formatPhone={showNumPad.field === 'phone'} allowPlus={showNumPad.field === 'phone'}/>
      )}
    </>
  )
}

function FormField({ label, value, onTap, required, multiline, mono }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">
        {label}{required && <span className="text-[#CF1322]"> *</span>}
      </div>
      <button onClick={onTap}
        className={`w-full text-left bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] cursor-pointer hover:border-[#006AFF] ${mono ? 'font-mono' : ''}`}
        style={{ color: value ? '#1F1F1F' : '#999', minHeight: multiline ? '60px' : 'auto', whiteSpace: multiline ? 'pre-wrap' : 'normal' }}>
        {value || `Tap to enter ${label.replace(' *', '').toLowerCase()}...`}
      </button>
    </div>
  )
}

function ConfirmDeleteModal({ vendor, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.55)'}}>
      <div className="rounded-2xl overflow-hidden" style={{
        width:'420px', maxWidth:'100%', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
      }}>
        <div className="p-5 text-center">
          <div className="text-[44px] mb-3">⚠️</div>
          <div className="text-[16px] font-bold text-[#1F1F1F] mb-1">Permanently delete vendor?</div>
          <div className="text-[13px] text-[#666] mb-3">
            <span className="font-bold">{vendor.name}</span> will be deleted forever. This cannot be undone.
          </div>
          <div className="rounded-lg px-3 py-2.5 text-[11px] mb-4"
            style={{background:'#FEF3C7', color:'#B45309', border:'1px solid #FCD34D'}}>
            💡 Tip: If this vendor has past purchase orders, deletion will fail.<br/>
            Use <strong>Deactivate</strong> instead — it hides from lists but keeps records.
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onCancel}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer text-white"
            style={{background:'#CF1322', border:'none'}}>
            🗑 Delete Forever
          </button>
        </div>
      </div>
    </div>
  )
}
