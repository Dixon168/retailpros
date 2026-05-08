// src/pages/business/BusinessCustomersPage.jsx
// B2B 商家客户管理 — Invoice 端专用

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

const TIER_STYLE = {
  standard:  { bg: 'rgba(136,153,176,0.12)', color: '#666666', label: 'Standard' },
  wholesale: { bg: 'rgba(6,182,212,0.12)',   color: '#06b6d4', label: 'Wholesale' },
  preferred: { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', label: 'Preferred' },
  contract:  { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6', label: 'Contract'  },
}
const TERMS = ['net30','net60','net90','cod','prepaid']

export default function BusinessCustomersPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [search,   setSearch]   = useState('')
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editForm, setEditForm] = useState(null)

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['business-customers', tenant?.id, search],
    queryFn: async () => {
      let q = supabase.from('business_customers')
        .select('*, business_contacts(*), business_addresses(*)')
        .eq('tenant_id', tenant.id).eq('is_active', true)
      if (search) q = q.or(
        `company_name.ilike.%${search}%,contact_name.ilike.%${search}%,code.ilike.%${search}%,contact_phone.ilike.%${search}%`
      )
      const { data } = await q.order('company_name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const totalOwed = customers.reduce((s,c) => s + (c.credit_balance||0), 0)
  const overdue   = customers.filter(c => c.overdue_amount > 0).length

  return (
    <div className="flex h-full bg-[#FAFAFA]">

      {/* ── Customer list ── */}
      <div className="w-[300px] bg-[#FFFFFF] border-r border-[#E5E5E5] flex flex-col flex-shrink-0">

        {/* Search */}
        <div className="p-3.5 border-b border-[#E5E5E5]">
          <div className="flex items-center gap-2 bg-[#F5F5F5] border border-[#E5E5E5]
            rounded-[9px] px-3 mb-2.5 focus-within:border-cyan-500/30 transition-colors">
            <span className="text-[#999999]">🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Company, contact, code..."
              className="bg-transparent border-none outline-none py-2 text-[12px]
                text-[#1F1F1F] flex-1 font-sans placeholder-[#999999]"/>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-1.5">
            {[
              ['Accounts',  customers.length,       undefined],
              ['Owed',      `$${totalOwed.toFixed(0)}`, '#ef4444'],
              ['Overdue',   overdue,                 overdue > 0 ? '#f59e0b' : '#999999'],
            ].map(([l,v,c]) => (
              <div key={l} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg
                p-2 text-center">
                <div className="text-[9px] font-mono text-[#999999] uppercase">{l}</div>
                <div className="text-[13px] font-bold mt-0.5" style={{ color: c }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading
            ? Array(5).fill(0).map((_,i) => (
                <div key={i} className="h-[72px] bg-[#F5F5F5] rounded-[10px] mb-1.5 animate-pulse"/>
              ))
            : customers.map(c => {
                const ts = TIER_STYLE[c.tier] || TIER_STYLE.standard
                return (
                  <div key={c.id} onClick={() => setSelected(c)}
                    className={`px-3 py-2.5 rounded-[10px] cursor-pointer border mb-1
                      transition-all ${selected?.id === c.id
                        ? 'bg-[#F5F5F5] border-cyan-500/40'
                        : 'border-transparent hover:bg-[#F5F5F5]'
                      }`}>
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold truncate">{c.company_name}</div>
                        <div className="text-[10px] text-[#999999] mt-0.5 font-mono">
                          {c.code} · {c.contact_name}
                        </div>
                      </div>
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5
                        rounded ml-2 flex-shrink-0"
                        style={{ background: ts.bg, color: ts.color }}>
                        {ts.label}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded
                        bg-[#F5F5F5] text-[#666666] uppercase">{c.payment_terms}</span>
                      {c.credit_balance > 0 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded
                          bg-red-500/10 text-[#CF1322]">
                          Owes ${c.credit_balance.toFixed(0)}
                        </span>
                      )}
                      {c.overdue_amount > 0 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded
                          bg-yellow-500/10 text-[#FA8C16]">OVERDUE</span>
                      )}
                    </div>
                  </div>
                )
              })
          }
        </div>

        <div className="p-3 border-t border-[#E5E5E5]">
          <button onClick={() => { setEditForm({}); setShowForm(true) }}
            className="w-full bg-cyan-500 border-none rounded-[9px] py-2.5
              text-[12px] font-bold text-white">
            + New Business Account
          </button>
        </div>
      </div>

      {/* ── Detail ── */}
      {selected
        ? <BusinessDetail
            customer={selected}
            onClose={() => setSelected(null)}
            onEdit={() => { setEditForm(selected); setShowForm(true) }}
            tenantId={tenant?.id}
          />
        : (
          <div className="flex-1 flex items-center justify-center bg-[#FAFAFA]">
            <div className="text-center text-[#999999]">
              <div className="text-5xl mb-4 opacity-20">🏢</div>
              <div className="text-[14px]">Select a business account</div>
            </div>
          </div>
        )
      }

      {/* ── Create / Edit form ── */}
      {showForm && (
        <BusinessForm
          initial={editForm}
          tenantId={tenant?.id}
          onSave={async (data) => {
            if (data.id) {
              await supabase.from('business_customers')
                .update({ ...data, updated_at: new Date().toISOString() })
                .eq('id', data.id)
              toast.success('Account updated')
            } else {
              await supabase.from('business_customers')
                .insert({ ...data, tenant_id: tenant.id })
              toast.success('Account created')
            }
            qc.invalidateQueries(['business-customers'])
            setShowForm(false)
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

// ── Business Detail ──
function BusinessDetail({ customer: c, onClose, onEdit, tenantId }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState('overview')
  const ts = TIER_STYLE[c.tier] || TIER_STYLE.standard

  const { data: invoices = [] } = useQuery({
    queryKey: ['business-invoices', c.id],
    queryFn: async () => {
      const { data } = await supabase.from('invoices')
        .select('*')
        .eq('business_customer_id', c.id)
        .order('created_at', { ascending: false })
        .limit(20)
      return data || []
    },
    enabled: tab === 'invoices',
  })

  const TABS = ['overview','contacts','addresses','invoices']

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#FAFAFA]">

      {/* Header */}
      <div className="bg-[#FFFFFF] border-b border-[#E5E5E5] px-6 py-4
        flex gap-4 items-start flex-shrink-0">
        <div className="w-[52px] h-[52px] rounded-[13px] bg-gradient-to-br
          from-cyan-500 to-blue-600 flex items-center justify-center
          text-[20px] font-bold text-white flex-shrink-0">
          {c.company_name?.charAt(0)}
        </div>
        <div className="flex-1">
          <div className="text-[20px] font-bold">{c.company_name}</div>
          {c.trade_name && (
            <div className="text-[11px] text-[#999999] mt-0.5">DBA: {c.trade_name}</div>
          )}
          <div className="flex gap-2 mt-2 flex-wrap">
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
              style={{ background: ts.bg, color: ts.color }}>{ts.label}</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded
              bg-[#F5F5F5] text-[#666666] uppercase">{c.payment_terms}</span>
            {c.tax_id && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded
                bg-[#F5F5F5] text-[#666666]">EIN: {c.tax_id}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit}
            className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5
              text-[11px] text-[#666666] hover:border-blue-500/30 hover:text-[#006AFF]
              transition-all">Edit</button>
          <button onClick={() => toast.success('Creating invoice...')}
            className="bg-cyan-500 border-none rounded-lg px-3 py-1.5
              text-[11px] font-bold text-white">+ Invoice</button>
          {c.credit_balance > 0 && (
            <button onClick={() => toast.success('Recording payment...')}
              className="bg-green-500 border-none rounded-lg px-3 py-1.5
                text-[11px] font-bold text-white">💰 Record Payment</button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 border-b border-[#E5E5E5] bg-[#FFFFFF] flex-shrink-0">
        {[
          ['Total Spent', `$${(c.total_spent||0).toFixed(0)}`,    '#3b82f6'],
          ['Invoices',    c.invoice_count || 0,                   undefined],
          ['Outstanding', `$${(c.credit_balance||0).toFixed(2)}`, c.credit_balance > 0 ? '#ef4444' : '#10b981'],
          ['Credit Limit', c.credit_limit > 0 ? `$${c.credit_limit.toFixed(0)}` : 'Unlimited', '#666666'],
          ['Overdue',     `$${(c.overdue_amount||0).toFixed(2)}`, c.overdue_amount > 0 ? '#f59e0b' : '#999999'],
        ].map(([l,v,color]) => (
          <div key={l} className="px-4 py-3 border-r border-[#E5E5E5] last:border-0">
            <div className="text-[9px] font-mono text-[#999999] uppercase tracking-wider mb-1">{l}</div>
            <div className="text-[16px] font-bold" style={{ color }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex bg-[#FFFFFF] border-b border-[#E5E5E5] px-6 flex-shrink-0">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-3 px-4 text-[12px] capitalize border-b-2 transition-all ${
              tab === t
                ? 'text-cyan-400 border-cyan-400'
                : 'text-[#666666] border-transparent hover:text-[#1F1F1F]'
            }`}>{t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">

        {tab === 'overview' && (
          <div className="grid grid-cols-2 gap-4">
            <InfoCard title="Contact">
              <IRow label="Contact Name" value={c.contact_name}/>
              <IRow label="Email"        value={c.contact_email || '—'}/>
              <IRow label="Phone"        value={c.contact_phone || '—'}/>
              <IRow label="Mobile"       value={c.contact_mobile || '—'}/>
              <IRow label="AR Email"     value={c.ar_email || '—'}/>
            </InfoCard>
            <InfoCard title="Billing & Credit">
              <IRow label="Payment Terms" value={c.payment_terms?.toUpperCase()}/>
              <IRow label="Credit Limit"  value={c.credit_limit > 0 ? `$${c.credit_limit.toFixed(2)}` : 'Unlimited'}/>
              <IRow label="Current Owed"  value={`$${(c.credit_balance||0).toFixed(2)}`} valueColor={c.credit_balance > 0 ? '#ef4444' : '#10b981'}/>
              <IRow label="Tier Discount" value={`${Math.round((1-(c.tier_discount||1))*100)}% off`}/>
              <IRow label="Reminder"      value={`${c.reminder_days_before || 7} days before`}/>
            </InfoCard>
            <InfoCard title="Billing Address" className="col-span-2">
              {c.billing_address
                ? <div className="text-[12px] text-[#666666] leading-7">
                    {c.billing_address}<br/>
                    {c.billing_city}, {c.billing_state} {c.billing_zip}
                  </div>
                : <div className="text-[12px] text-[#999999]">No billing address</div>
              }
            </InfoCard>
          </div>
        )}

        {tab === 'contacts' && (
          <div>
            <div className="flex justify-between mb-4">
              <div className="text-[14px] font-bold">Contacts</div>
              <button onClick={() => toast.success('Add contact')}
                className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5
                  text-[11px] text-[#666666] hover:border-cyan-500/30 hover:text-cyan-400 transition-all">
                + Add Contact
              </button>
            </div>
            {(c.business_contacts || []).length === 0
              ? <div className="text-center py-8 text-[#999999] text-sm">No contacts added</div>
              : (c.business_contacts || []).map(contact => (
                  <div key={contact.id} className="bg-[#FFFFFF] border border-[#E5E5E5]
                    rounded-[10px] px-4 py-3.5 mb-2.5 flex items-center gap-4">
                    <div className="w-9 h-9 rounded-[9px] bg-gradient-to-br from-blue-500
                      to-purple-600 flex items-center justify-center text-[13px] font-bold
                      text-white flex-shrink-0">
                      {contact.name?.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <div className="text-[13px] font-bold">{contact.name}</div>
                      <div className="text-[11px] text-[#999999] mt-0.5">
                        {contact.title && `${contact.title} · `}
                        {contact.email || contact.phone || '—'}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {contact.receive_invoice && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded
                          bg-[#006AFF]/10 text-[#006AFF]">Invoices</span>
                      )}
                      {contact.receive_reminder && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded
                          bg-yellow-500/10 text-[#FA8C16]">Reminders</span>
                      )}
                      {contact.is_primary && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded
                          bg-green-500/10 text-[#00B23B]">Primary</span>
                      )}
                    </div>
                  </div>
                ))
            }
          </div>
        )}

        {tab === 'addresses' && (
          <div>
            <div className="flex justify-between mb-4">
              <div className="text-[14px] font-bold">Ship-to Addresses</div>
              <button onClick={() => toast.success('Add address')}
                className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5
                  text-[11px] text-[#666666] hover:border-cyan-500/30 hover:text-cyan-400 transition-all">
                + Add Address
              </button>
            </div>
            {(c.business_addresses || []).length === 0
              ? <div className="text-center py-8 text-[#999999] text-sm">No addresses added</div>
              : (c.business_addresses || []).map(addr => (
                  <div key={addr.id} className="bg-[#FFFFFF] border border-[#E5E5E5]
                    rounded-[10px] px-4 py-3.5 mb-2.5 flex items-center gap-4">
                    <span className="text-2xl">📦</span>
                    <div className="flex-1">
                      <div className="text-[13px] font-bold">
                        {addr.label || 'Shipping Address'}
                        {addr.is_default && (
                          <span className="ml-2 text-[9px] font-mono px-1.5 py-0.5 rounded
                            bg-[#006AFF]/10 text-[#006AFF]">DEFAULT</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#999999] mt-0.5">
                        {addr.address}, {addr.city}, {addr.state} {addr.zip}
                      </div>
                      {addr.contact_name && (
                        <div className="text-[10px] text-[#999999] mt-0.5">
                          Attn: {addr.contact_name} {addr.contact_phone && `· ${addr.contact_phone}`}
                        </div>
                      )}
                    </div>
                  </div>
                ))
            }
          </div>
        )}

        {tab === 'invoices' && (
          <div>
            {invoices.length === 0
              ? <div className="text-center py-12 text-[#999999]">No invoices yet</div>
              : invoices.map(inv => {
                  const statusColor = {
                    paid:'#10b981', partial:'#f59e0b',
                    overdue:'#ef4444', sent:'#06b6d4', draft:'#666666'
                  }[inv.status] || '#666666'
                  return (
                    <div key={inv.id} className="flex items-center gap-3 bg-[#FFFFFF]
                      border border-[#E5E5E5] rounded-[10px] px-4 py-3 mb-2
                      hover:border-[#E5E5E5] cursor-pointer transition-colors">
                      <div className="flex-1">
                        <div className="font-mono text-[12px] font-bold text-cyan-400">
                          {inv.invoice_number}
                        </div>
                        <div className="text-[10px] text-[#999999] mt-0.5">
                          {new Date(inv.created_at).toLocaleDateString()}
                          {inv.due_date && ` · Due ${new Date(inv.due_date).toLocaleDateString()}`}
                        </div>
                      </div>
                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded"
                        style={{ background:`${statusColor}18`, color: statusColor }}>
                        {inv.status?.toUpperCase()}
                      </span>
                      <div className="text-right">
                        <div className="font-mono text-[13px] font-bold">${inv.total?.toFixed(2)}</div>
                        {inv.balance_due > 0 && (
                          <div className="text-[10px] font-mono text-[#CF1322]">
                            Due ${inv.balance_due.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
            }
          </div>
        )}
      </div>
    </div>
  )
}

// ── Business Form ──
function BusinessForm({ initial = {}, tenantId, onSave, onClose }) {
  const [form, setForm] = useState({
    id:              initial.id || null,
    company_name:    initial.company_name    || '',
    trade_name:      initial.trade_name      || '',
    tax_id:          initial.tax_id          || '',
    contact_name:    initial.contact_name    || '',
    contact_email:   initial.contact_email   || '',
    contact_phone:   initial.contact_phone   || '',
    ar_email:        initial.ar_email        || '',
    payment_terms:   initial.payment_terms   || 'net30',
    credit_limit:    initial.credit_limit    || '',
    tier:            initial.tier            || 'standard',
    billing_address: initial.billing_address || '',
    billing_city:    initial.billing_city    || '',
    billing_state:   initial.billing_state   || '',
    billing_zip:     initial.billing_zip     || '',
    notes:           initial.notes           || '',
  })
  const [saving, setSaving] = useState(false)
  const u = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const { data: tiers = [] } = useQuery({
    queryKey: ['b2b-tiers', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('discount_tiers')
        .select('*').eq('tenant_id', tenantId).eq('customer_type','b2b')
        .order('sort_order')
      return data || []
    },
    enabled: !!tenantId,
  })

  const handleSave = async () => {
    if (!form.company_name.trim() || !form.contact_name.trim()) {
      toast.error('Company name and contact name are required')
      return
    }
    setSaving(true)
    try {
      // Apply tier discount from discount_tiers table
      const selectedTier = tiers.find(t => t.tier_key === form.tier)
      await onSave({
        ...form,
        credit_limit:    parseFloat(form.credit_limit) || 0,
        tier_discount:   selectedTier?.discount_rate || 1.0,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm z-50
      flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl w-[560px]
        max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        <div className="px-5 py-4 border-b border-[#E5E5E5] flex justify-between">
          <div className="text-[15px] font-bold">
            {form.id ? '✏️ Edit Account' : '🏢 New Business Account'}
          </div>
          <button onClick={onClose} className="text-[#999999] hover:text-[#1F1F1F] text-xl">✕</button>
        </div>

        <div className="p-5">
          <Section title="Company">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company Name *" value={form.company_name}
                onChange={v => u('company_name', v)} colSpan />
              <Field label="DBA / Trade Name" value={form.trade_name}
                onChange={v => u('trade_name', v)}/>
              <Field label="Tax ID / EIN" value={form.tax_id}
                onChange={v => u('tax_id', v)} mono/>
            </div>
          </Section>

          <Section title="Primary Contact">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact Name *" value={form.contact_name}
                onChange={v => u('contact_name', v)} colSpan/>
              <Field label="Email" value={form.contact_email}
                onChange={v => u('contact_email', v)}/>
              <Field label="Phone" value={form.contact_phone}
                onChange={v => u('contact_phone', v)} mono/>
              <Field label="AR Email (Invoices)" value={form.ar_email}
                onChange={v => u('ar_email', v)} colSpan/>
            </div>
          </Section>

          <Section title="Account Terms">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FLabel>Payment Terms</FLabel>
                <select value={form.payment_terms} onChange={e => u('payment_terms', e.target.value)}
                  className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
                    px-3 py-2.5 text-[13px] text-[#1F1F1F] outline-none
                    focus:border-[#006AFF]">
                  {TERMS.map(t => (
                    <option key={t} value={t}>{t.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <Field label="Credit Limit (0 = unlimited)" value={form.credit_limit}
                onChange={v => u('credit_limit', v)} mono type="number"/>
              <div>
                <FLabel>Discount Tier</FLabel>
                <select value={form.tier} onChange={e => u('tier', e.target.value)}
                  className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
                    px-3 py-2.5 text-[13px] text-[#1F1F1F] outline-none
                    focus:border-[#006AFF]">
                  {tiers.length > 0
                    ? tiers.map(t => (
                        <option key={t.tier_key} value={t.tier_key}>
                          {t.tier_name} ({Math.round((1-t.discount_rate)*100)}% off)
                        </option>
                      ))
                    : Object.entries(TIER_STYLE).map(([k,v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))
                  }
                </select>
              </div>
            </div>
          </Section>

          <Section title="Billing Address">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Street Address" value={form.billing_address}
                onChange={v => u('billing_address', v)} colSpan/>
              <Field label="City" value={form.billing_city}
                onChange={v => u('billing_city', v)}/>
              <div className="grid grid-cols-2 gap-2">
                <Field label="State" value={form.billing_state}
                  onChange={v => u('billing_state', v)}/>
                <Field label="ZIP" value={form.billing_zip}
                  onChange={v => u('billing_zip', v)} mono/>
              </div>
            </div>
          </Section>

          <div>
            <FLabel>Notes</FLabel>
            <textarea value={form.notes} onChange={e => u('notes', e.target.value)} rows={2}
              className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
                px-3 py-2.5 text-[12px] outline-none focus:border-[#006AFF] resize-none"/>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2 border-t border-[#E5E5E5] pt-4">
          <button onClick={onClose}
            className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
              py-3 text-[13px] text-[#666666]">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-[2] bg-gradient-to-r from-cyan-500 to-blue-600 border-none
              rounded-[9px] py-3 text-[13px] font-bold text-white disabled:opacity-50">
            {saving ? 'Saving...' : form.id ? '✓ Update Account' : '✓ Create Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──
function InfoCard({ title, children, className='' }) {
  return (
    <div className={`bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4 ${className}`}>
      <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  )
}
function IRow({ label, value, valueColor }) {
  return (
    <div className="flex justify-between items-start mb-2 last:mb-0">
      <span className="text-[11px] text-[#999999]">{label}</span>
      <span className="text-[12px] font-semibold text-right max-w-[60%]"
        style={{ color: valueColor }}>{value}</span>
    </div>
  )
}
function Section({ title, children }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] font-bold text-[#666666] uppercase tracking-wider mb-3">
        {title}
      </div>
      {children}
    </div>
  )
}
function FLabel({ children }) {
  return <div className="text-[10px] font-mono text-[#999999] uppercase tracking-wider mb-1.5">{children}</div>
}
function Field({ label, value, onChange, colSpan, mono, type='text' }) {
  return (
    <div className={colSpan ? 'col-span-2' : ''}>
      <FLabel>{label}</FLabel>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className={`w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
          px-3 py-2.5 text-[13px] outline-none focus:border-[#006AFF]
          transition-colors ${mono ? 'font-mono' : ''}`}/>
    </div>
  )
}
