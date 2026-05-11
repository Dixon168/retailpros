// src/pages/business/CreateCompanyWizard.jsx
// Phase 2: 4-step wizard for creating a new B2B company.
//
// Steps:
//   1. Company info + primary contact
//   2. Addresses (billing + delivery, can mark "same as billing")
//   3. Financial details + additional contacts
//   4. Review + create
//
// On submit: creates the business_customer + extra contacts +
//            both addresses (billing + delivery with type='billing'/'delivery')

import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import DualInput from '@/components/ui/DualInput'

const STEPS = [
  { key: 'company',   label: 'Company',   icon: '🏢' },
  { key: 'addresses', label: 'Addresses', icon: '📍' },
  { key: 'details',   label: 'Details',   icon: '💳' },
  { key: 'review',    label: 'Review',    icon: '✅' },
]

export default function CreateCompanyWizard({ onClose, onCreated }) {
  const { tenant } = useAuthStore()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    // Step 1: Company + primary contact
    company_name:        '',
    trade_name:          '',
    primary_contact_name:  '',
    primary_contact_title: '',
    primary_contact_phone: '',
    primary_contact_email: '',

    // Step 2: Addresses
    billing_address:  '',
    billing_city:     '',
    billing_state:    '',
    billing_zip:      '',
    delivery_same_as_billing: true,
    delivery_address: '',
    delivery_city:    '',
    delivery_state:   '',
    delivery_zip:     '',
    delivery_attention_to: '',
    delivery_phone:        '',

    // Step 3: Financial + additional contacts
    payment_terms:    'net_30',
    credit_limit:     '',
    opening_balance:  '',
    tier:             'standard',
    additional_contacts: [],  // [{name, title, phone, email, role}]

    // Future (Phase 4): payment methods + notes (skipped here)
    initial_note:     '',
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // ── Validation per step ──
  const errors = useMemo(() => {
    const errs = {}
    if (step >= 0 && !form.company_name.trim()) errs.company_name = 'Company name required'
    if (step >= 1 && !form.delivery_same_as_billing) {
      if (!form.delivery_address.trim()) errs.delivery_address = 'Delivery address required (or check "same as billing")'
    }
    return errs
  }, [form, step])

  const canAdvance = (() => {
    if (step === 0) return form.company_name.trim().length > 0
    if (step === 1) return form.delivery_same_as_billing || form.delivery_address.trim().length > 0
    return true
  })()

  const addContact = () => {
    set('additional_contacts', [
      ...form.additional_contacts,
      { name: '', title: '', phone: '', email: '', role: 'contact' }
    ])
  }
  const updateContact = (idx, field, value) => {
    set('additional_contacts', form.additional_contacts.map((c, i) =>
      i === idx ? { ...c, [field]: value } : c
    ))
  }
  const removeContact = (idx) => {
    set('additional_contacts', form.additional_contacts.filter((_, i) => i !== idx))
  }

  const create = async () => {
    if (!form.company_name.trim()) { toast.error('Company name required'); setStep(0); return }
    setSaving(true)
    try {
      // 1. Insert business_customers row
      const { data: company, error: cErr } = await supabase.from('business_customers').insert({
        tenant_id:       tenant.id,
        company_name:    form.company_name.trim(),
        trade_name:      form.trade_name || null,
        contact_name:    form.primary_contact_name || null,
        contact_email:   form.primary_contact_email || null,
        contact_phone:   form.primary_contact_phone || null,
        billing_address: form.billing_address || null,
        billing_city:    form.billing_city    || null,
        billing_state:   form.billing_state   || null,
        billing_zip:     form.billing_zip     || null,
        payment_terms:   form.payment_terms,
        credit_limit:    parseFloat(form.credit_limit)    || 0,
        opening_balance: parseFloat(form.opening_balance) || 0,
        tier:            form.tier,
        is_active:       true,
      }).select().single()

      if (cErr) {
        toast.error('Failed to create company: ' + cErr.message)
        console.error('[Wizard] business_customers insert error:', cErr)
        setSaving(false)
        return
      }

      const customerId = company.id

      // 2. Insert addresses
      const addrRows = []
      if (form.billing_address) {
        addrRows.push({
          tenant_id: tenant.id, business_customer_id: customerId,
          type: 'billing', label: 'Billing',
          address: form.billing_address,
          city:    form.billing_city,
          state:   form.billing_state,
          zip:     form.billing_zip,
          is_default: true,
        })
      }
      if (!form.delivery_same_as_billing && form.delivery_address) {
        addrRows.push({
          tenant_id: tenant.id, business_customer_id: customerId,
          type: 'delivery', label: 'Delivery',
          address: form.delivery_address,
          city:    form.delivery_city,
          state:   form.delivery_state,
          zip:     form.delivery_zip,
          contact_name:  form.delivery_attention_to,
          contact_phone: form.delivery_phone,
        })
      }
      if (addrRows.length > 0) {
        const { error: aErr } = await supabase.from('business_addresses').insert(addrRows)
        if (aErr) console.warn('[Wizard] address insert failed:', aErr)
      }

      // 3. Insert contacts (primary as is_primary + any additional)
      const contactRows = []
      if (form.primary_contact_name) {
        contactRows.push({
          tenant_id: tenant.id, business_customer_id: customerId,
          name:  form.primary_contact_name,
          title: form.primary_contact_title || null,
          phone: form.primary_contact_phone || null,
          email: form.primary_contact_email || null,
          role:  'primary',
          is_primary: true,
        })
      }
      form.additional_contacts.forEach(c => {
        if (c.name?.trim()) {
          contactRows.push({
            tenant_id: tenant.id, business_customer_id: customerId,
            name:  c.name.trim(),
            title: c.title || null,
            phone: c.phone || null,
            email: c.email || null,
            role:  c.role || 'contact',
            is_primary: false,
          })
        }
      })
      if (contactRows.length > 0) {
        const { error: ctErr } = await supabase.from('business_contacts').insert(contactRows)
        if (ctErr) console.warn('[Wizard] contacts insert failed:', ctErr)
      }

      // 4. Insert initial note if any
      if (form.initial_note?.trim()) {
        await supabase.from('business_notes').insert({
          tenant_id: tenant.id, business_customer_id: customerId,
          note: form.initial_note.trim(),
        })
      }

      toast.success(`${company.company_name} created ✓`)
      onCreated(company)
    } catch (err) {
      toast.error('Error: ' + err.message)
      console.error('[Wizard] Unexpected error:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width: '760px', maxWidth: '100%', maxHeight: '92vh', background: '#FFFFFF',
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: '1px solid #E5E5E5' }}>
          <div className="flex-1">
            <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">New Company · Step {step + 1} of {STEPS.length}</div>
            <div className="text-[16px] font-bold text-[#1F1F1F]">
              {form.company_name || 'Untitled company'}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{ background: '#F5F5F5', border: 'none' }}>✕</button>
        </div>

        {/* Stepper */}
        <div className="px-5 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid #E5E5E5' }}>
          <div className="flex items-center gap-1">
            {STEPS.map((s, idx) => {
              const done = idx < step
              const current = idx === step
              return (
                <div key={s.key} className="flex items-center gap-1 flex-1">
                  <button
                    onClick={() => {
                      // Allow going back at any time, forward only if past step
                      if (idx < step || idx === step) setStep(idx)
                      else if (idx <= step + 1 && canAdvance) setStep(idx)
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
                    style={current
                      ? { background: '#006AFF', color: '#FFFFFF', border: 'none' }
                      : done
                        ? { background: '#DCFCE7', color: '#15803D', border: '1px solid #15803D' }
                        : { background: '#FFFFFF', color: '#999', border: '1px solid #E5E5E5' }
                    }>
                    <span>{done ? '✓' : s.icon}</span>
                    <span>{s.label}</span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <div className="flex-1 h-px" style={{ background: idx < step ? '#15803D' : '#E5E5E5' }}/>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Step 1: Company */}
          {step === 0 && (
            <div className="space-y-5">
              <Section title="🏢 Company">
                <div className="grid grid-cols-2 gap-3">
                  <DualInput label="Company name *" value={form.company_name}
                    onChange={v => set('company_name', v)}
                    placeholder="ACME Corp" kbTitle="Company name"/>
                  <DualInput label="Trade name / DBA" value={form.trade_name}
                    onChange={v => set('trade_name', v)}
                    placeholder="(optional)" kbTitle="Trade name"/>
                </div>
              </Section>

              <Section title="👤 Primary contact"
                hint="The main person you talk to. You can add more contacts in step 3.">
                <div className="grid grid-cols-2 gap-3">
                  <DualInput label="Name" value={form.primary_contact_name}
                    onChange={v => set('primary_contact_name', v)}
                    placeholder="John Smith" kbTitle="Contact name"/>
                  <DualInput label="Title / role" value={form.primary_contact_title}
                    onChange={v => set('primary_contact_title', v)}
                    placeholder="Owner, Buyer, AP..." kbTitle="Title"/>
                  <DualInput label="Phone" mode="phone" value={form.primary_contact_phone}
                    onChange={v => set('primary_contact_phone', v)}
                    placeholder="(555) 123-4567" kbTitle="Phone"/>
                  <DualInput label="Email" mode="email" value={form.primary_contact_email}
                    onChange={v => set('primary_contact_email', v)}
                    placeholder="john@acme.com" kbTitle="Email"/>
                </div>
              </Section>
            </div>
          )}

          {/* Step 2: Addresses */}
          {step === 1 && (
            <div className="space-y-5">
              <Section title="📍 Billing address"
                hint="Where invoices and statements get sent.">
                <DualInput label="Street address" value={form.billing_address}
                  onChange={v => set('billing_address', v)}
                  placeholder="123 Main St, Suite 200" kbTitle="Billing address"/>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <DualInput label="City" value={form.billing_city}
                    onChange={v => set('billing_city', v)}
                    placeholder="Brooklyn" kbTitle="City"/>
                  <DualInput label="State" value={form.billing_state}
                    onChange={v => set('billing_state', v)}
                    placeholder="NY" kbTitle="State"/>
                  <DualInput label="ZIP" mode="numeric" value={form.billing_zip}
                    onChange={v => set('billing_zip', v)}
                    placeholder="11209" kbTitle="ZIP"/>
                </div>
              </Section>

              <Section title="🚚 Delivery address"
                hint="Where you ship products. Often the same as billing.">
                <label className="flex items-center gap-2.5 p-3 rounded-lg cursor-pointer"
                  style={{
                    background: form.delivery_same_as_billing ? '#DCFCE7' : '#FAFAFA',
                    border: `1.5px solid ${form.delivery_same_as_billing ? '#15803D' : '#E5E5E5'}`
                  }}>
                  <input type="checkbox" checked={form.delivery_same_as_billing}
                    onChange={e => set('delivery_same_as_billing', e.target.checked)}
                    className="w-4 h-4 accent-[#15803D]"/>
                  <div>
                    <div className="text-[13px] font-bold"
                      style={{ color: form.delivery_same_as_billing ? '#15803D' : '#1F1F1F' }}>
                      Same as billing address
                    </div>
                    <div className="text-[11px]" style={{ color: form.delivery_same_as_billing ? '#15803D' : '#666' }}>
                      Uncheck to enter a different delivery address.
                    </div>
                  </div>
                </label>

                {!form.delivery_same_as_billing && (
                  <div className="mt-3 space-y-3 p-3 rounded-lg"
                    style={{ background: '#FAFAFA', border: '1px solid #E5E5E5' }}>
                    <DualInput label="Delivery street address *" value={form.delivery_address}
                      onChange={v => set('delivery_address', v)}
                      placeholder="456 Warehouse Way" kbTitle="Delivery address"/>
                    <div className="grid grid-cols-3 gap-3">
                      <DualInput label="City" value={form.delivery_city}
                        onChange={v => set('delivery_city', v)}
                        placeholder="Brooklyn" kbTitle="Delivery city"/>
                      <DualInput label="State" value={form.delivery_state}
                        onChange={v => set('delivery_state', v)}
                        placeholder="NY" kbTitle="Delivery state"/>
                      <DualInput label="ZIP" mode="numeric" value={form.delivery_zip}
                        onChange={v => set('delivery_zip', v)}
                        placeholder="11209" kbTitle="Delivery ZIP"/>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <DualInput label="Attention to (receiving person)" value={form.delivery_attention_to}
                        onChange={v => set('delivery_attention_to', v)}
                        placeholder="Receiving dock" kbTitle="Receiver"/>
                      <DualInput label="Delivery contact phone" mode="phone" value={form.delivery_phone}
                        onChange={v => set('delivery_phone', v)}
                        placeholder="(555) 999-8888" kbTitle="Delivery phone"/>
                    </div>
                  </div>
                )}
              </Section>
            </div>
          )}

          {/* Step 3: Details */}
          {step === 2 && (
            <div className="space-y-5">
              <Section title="💳 Financial">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Payment terms</div>
                    <select value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)}
                      className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none cursor-pointer">
                      <option value="cod">COD (cash on delivery)</option>
                      <option value="net_7">Net 7</option>
                      <option value="net_15">Net 15</option>
                      <option value="net_30">Net 30</option>
                      <option value="net_45">Net 45</option>
                      <option value="net_60">Net 60</option>
                    </select>
                  </div>
                  <DualInput label="Credit limit" mode="decimal" prefix="$"
                    value={form.credit_limit}
                    onChange={v => set('credit_limit', v)}
                    placeholder="0.00" kbTitle="Credit limit"/>
                  <DualInput label="Opening balance" mode="decimal" prefix="$"
                    value={form.opening_balance}
                    onChange={v => set('opening_balance', v)}
                    placeholder="0.00" kbTitle="Opening balance"/>
                </div>
                <div className="mt-2 text-[10px] text-[#666]">
                  💡 <strong>Opening balance</strong> = what this company already owes you when setting them up
                  (existing debt from before using this system).
                </div>
              </Section>

              <Section title="🎖️ Customer tier">
                <div className="flex gap-2">
                  {[
                    ['standard', 'Standard',  '#1F1F1F', '#FFFFFF'],
                    ['vip',      'VIP',       '#B45309', '#FEF3C7'],
                    ['wholesale','Wholesale', '#006AFF', '#E6F0FF'],
                  ].map(([val, label, color, bg]) => (
                    <button key={val} onClick={() => set('tier', val)}
                      className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer active:scale-[0.97]"
                      style={form.tier === val
                        ? { background: color, color: '#FFFFFF', border: 'none' }
                        : { background: bg, color: color, border: `1px solid ${color}33` }}>
                      {label}
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="👥 Additional contacts"
                hint="Add more people if needed — AP person, warehouse manager, etc.">
                {form.additional_contacts.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {form.additional_contacts.map((c, idx) => (
                      <div key={idx} className="rounded-lg p-3 grid gap-2"
                        style={{ background: '#FAFAFA', border: '1px solid #E5E5E5',
                                 gridTemplateColumns: '1fr 1fr 1fr 1fr 110px 32px' }}>
                        <input value={c.name} onChange={e => updateContact(idx, 'name', e.target.value)}
                          placeholder="Name *"
                          className="bg-[#FFFFFF] border border-[#E5E5E5] rounded px-2 py-1.5 text-[12px] outline-none focus:border-[#006AFF]"/>
                        <input value={c.title} onChange={e => updateContact(idx, 'title', e.target.value)}
                          placeholder="Title"
                          className="bg-[#FFFFFF] border border-[#E5E5E5] rounded px-2 py-1.5 text-[12px] outline-none focus:border-[#006AFF]"/>
                        <input value={c.phone} onChange={e => updateContact(idx, 'phone', e.target.value)}
                          placeholder="Phone"
                          className="bg-[#FFFFFF] border border-[#E5E5E5] rounded px-2 py-1.5 text-[12px] outline-none focus:border-[#006AFF]"/>
                        <input value={c.email} onChange={e => updateContact(idx, 'email', e.target.value)}
                          placeholder="Email"
                          className="bg-[#FFFFFF] border border-[#E5E5E5] rounded px-2 py-1.5 text-[12px] outline-none focus:border-[#006AFF]"/>
                        <select value={c.role} onChange={e => updateContact(idx, 'role', e.target.value)}
                          className="bg-[#FFFFFF] border border-[#E5E5E5] rounded px-2 py-1.5 text-[11px] outline-none cursor-pointer">
                          <option value="contact">Contact</option>
                          <option value="ap">A/P (billing)</option>
                          <option value="ar">A/R (collections)</option>
                          <option value="buyer">Buyer</option>
                          <option value="manager">Manager</option>
                          <option value="warehouse">Warehouse</option>
                        </select>
                        <button onClick={() => removeContact(idx)}
                          className="rounded text-[12px] cursor-pointer"
                          style={{ background: '#FEE2E2', color: '#CF1322', border: 'none' }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={addContact}
                  className="w-full rounded-lg py-2.5 text-[12px] font-bold cursor-pointer active:scale-[0.98]"
                  style={{ background: '#F5F5F5', color: '#1F1F1F',
                           border: '1.5px dashed #E5E5E5' }}>
                  + Add another contact
                </button>
              </Section>

              <Section title="📝 Initial note"
                hint="Optional — anything important to remember about this customer.">
                <DualInput multiline value={form.initial_note} onChange={v => set('initial_note', v)}
                  placeholder="e.g. Always orders Monday mornings. Prefers to be called instead of email."
                  kbTitle="Initial note"/>
              </Section>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg p-3" style={{ background: '#DCFCE7', border: '1px solid #15803D' }}>
                <div className="text-[12px] font-bold text-[#15803D]">
                  ✓ Almost done! Review the info below and click <strong>Create Company</strong> to save.
                </div>
              </div>

              <ReviewBlock title="🏢 Company" onEdit={() => setStep(0)}>
                <ReviewRow label="Name" value={form.company_name}/>
                {form.trade_name && <ReviewRow label="DBA" value={form.trade_name}/>}
                {form.primary_contact_name && (
                  <ReviewRow label="Primary contact"
                    value={`${form.primary_contact_name}${form.primary_contact_title ? ` (${form.primary_contact_title})` : ''} · ${form.primary_contact_phone || form.primary_contact_email || '—'}`}/>
                )}
              </ReviewBlock>

              <ReviewBlock title="📍 Addresses" onEdit={() => setStep(1)}>
                <ReviewRow label="Billing"
                  value={[form.billing_address, [form.billing_city, form.billing_state, form.billing_zip].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'}/>
                <ReviewRow label="Delivery"
                  value={form.delivery_same_as_billing
                    ? '(Same as billing)'
                    : [form.delivery_address, [form.delivery_city, form.delivery_state, form.delivery_zip].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'}/>
              </ReviewBlock>

              <ReviewBlock title="💳 Financial" onEdit={() => setStep(2)}>
                <ReviewRow label="Terms" value={(form.payment_terms || '').replace('_', ' ').toUpperCase()}/>
                <ReviewRow label="Credit limit" value={`$${(parseFloat(form.credit_limit) || 0).toFixed(2)}`}/>
                <ReviewRow label="Opening balance" value={`$${(parseFloat(form.opening_balance) || 0).toFixed(2)}`}/>
                <ReviewRow label="Tier" value={form.tier?.toUpperCase()}/>
                {form.additional_contacts.length > 0 && (
                  <ReviewRow label="Additional contacts"
                    value={`${form.additional_contacts.filter(c => c.name?.trim()).length} contacts`}/>
                )}
                {form.initial_note && <ReviewRow label="Note" value={form.initial_note}/>}
              </ReviewBlock>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex gap-2 flex-shrink-0 items-center"
          style={{ background: '#FAFAFA', borderTop: '1px solid #E5E5E5' }}>
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} disabled={saving}
              className="rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer"
              style={{ background: '#FFFFFF', color: '#1F1F1F', border: '1px solid #E5E5E5' }}>
              ← Back
            </button>
          )}
          <button onClick={onClose} disabled={saving}
            className="rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer"
            style={{ background: '#FFFFFF', color: '#666', border: '1px solid #E5E5E5' }}>
            Cancel
          </button>

          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep(step + 1)} disabled={!canAdvance}
              className="ml-auto rounded-lg px-5 py-3 text-[13px] font-bold cursor-pointer text-white disabled:opacity-40"
              style={{ background: '#006AFF', border: 'none' }}>
              Next: {STEPS[step + 1]?.label} →
            </button>
          ) : (
            <button onClick={create} disabled={saving || !form.company_name.trim()}
              className="ml-auto rounded-lg px-5 py-3 text-[13px] font-bold cursor-pointer text-white disabled:opacity-40"
              style={{ background: '#15803D', border: 'none' }}>
              {saving ? 'Creating...' : '✓ Create Company'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <div>
      <div className="text-[12px] font-bold text-[#1F1F1F] mb-1">{title}</div>
      {hint && <div className="text-[10px] text-[#666] mb-2">{hint}</div>}
      {children}
    </div>
  )
}

function ReviewBlock({ title, onEdit, children }) {
  return (
    <div className="rounded-lg p-3" style={{ background: '#FAFAFA', border: '1px solid #E5E5E5' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-bold text-[#1F1F1F]">{title}</div>
        <button onClick={onEdit}
          className="rounded px-2 py-0.5 text-[10px] font-bold cursor-pointer"
          style={{ background: '#FFFFFF', color: '#006AFF', border: '1px solid #006AFF' }}>
          Edit
        </button>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="text-[#666] font-bold uppercase tracking-wider min-w-[110px]">{label}</span>
      <span className="text-[#1F1F1F] flex-1">{value || '—'}</span>
    </div>
  )
}
