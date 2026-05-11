// src/pages/business/QuickCreateCompanyModal.jsx
// Phase 1: simple single-page company create form
// Phase 2 will replace this with a proper multi-step wizard

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import DualInput from '@/components/ui/DualInput'

export default function QuickCreateCompanyModal({ onClose, onCreated }) {
  const { tenant } = useAuthStore()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    company_name:     '',
    trade_name:       '',
    contact_name:     '',
    contact_email:    '',
    contact_phone:    '',
    billing_address:  '',
    billing_city:     '',
    billing_state:    '',
    billing_zip:      '',
    payment_terms:    'net_30',
    credit_limit:     '',
    opening_balance:  '',
    tier:             'standard',
  })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const save = async () => {
    if (!form.company_name.trim()) { toast.error('Company name required'); return }
    setSaving(true)
    try {
      const payload = {
        tenant_id:       tenant.id,
        company_name:    form.company_name.trim(),
        trade_name:      form.trade_name || null,
        contact_name:    form.contact_name || null,
        contact_email:   form.contact_email || null,
        contact_phone:   form.contact_phone || null,
        billing_address: form.billing_address || null,
        billing_city:    form.billing_city || null,
        billing_state:   form.billing_state || null,
        billing_zip:     form.billing_zip || null,
        payment_terms:   form.payment_terms,
        credit_limit:    parseFloat(form.credit_limit) || 0,
        opening_balance: parseFloat(form.opening_balance) || 0,
        tier:            form.tier,
        is_active:       true,
      }
      const { error } = await supabase.from('business_customers').insert(payload)
      if (error) {
        toast.error('Failed: ' + error.message)
        console.error('[Business] Create error:', error)
        return
      }
      toast.success('Company created ✓')
      onCreated()
    } catch (err) {
      toast.error('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.5)'}}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width:'720px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0"
          style={{borderBottom:'1px solid #E5E5E5'}}>
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">New Company</div>
            <div className="text-[16px] font-bold text-[#1F1F1F]">{form.company_name || 'Untitled company'}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Quick tip about wizard coming */}
          <div className="rounded-lg p-2.5 text-[11px] flex items-start gap-2"
            style={{background:'#E6F0FF', color:'#006AFF', border:'1px solid #B3D1FF'}}>
            <span>💡</span>
            <span>
              <strong>Quick form for now.</strong> Detailed setup (multi-contacts, multi-addresses, payment methods, notes)
              comes in the next update — for now, save the basics here and add the rest via the company detail page.
            </span>
          </div>

          {/* Company info */}
          <Section title="Company info">
            <div className="grid grid-cols-2 gap-3">
              <DualInput label="Company name *" value={form.company_name}
                onChange={v => set('company_name', v)}
                placeholder="ACME Corp" kbTitle="Company name"/>
              <DualInput label="Trade name / DBA" value={form.trade_name}
                onChange={v => set('trade_name', v)}
                placeholder="(optional)" kbTitle="Trade name"/>
            </div>
          </Section>

          {/* Primary contact */}
          <Section title="Primary contact">
            <div className="grid grid-cols-2 gap-3">
              <DualInput label="Contact name" value={form.contact_name}
                onChange={v => set('contact_name', v)}
                placeholder="John Smith" kbTitle="Contact name"/>
              <DualInput label="Phone" mode="phone" value={form.contact_phone}
                onChange={v => set('contact_phone', v)}
                placeholder="(555) 123-4567" kbTitle="Phone"/>
              <DualInput label="Email" mode="email" value={form.contact_email}
                onChange={v => set('contact_email', v)}
                placeholder="john@acme.com" kbTitle="Email"/>
            </div>
          </Section>

          {/* Billing address */}
          <Section title="Billing address">
            <DualInput label="Street address" value={form.billing_address}
              onChange={v => set('billing_address', v)}
              placeholder="123 Main St" kbTitle="Billing address"/>
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
            <div className="mt-2 text-[10px] text-[#666]">
              💡 Delivery address will default to this. You can override per invoice.
            </div>
          </Section>

          {/* Financial */}
          <Section title="Financial">
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
              💡 <strong>Opening balance</strong> = what this company already owes you when you set them up
              (existing debt from before using this system). Leave $0 if starting fresh.
            </div>
          </Section>

          {/* Tier */}
          <Section title="Customer tier">
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
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex gap-2 flex-shrink-0"
          style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving || !form.company_name.trim()}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer text-white disabled:opacity-40"
            style={{background:'#006AFF', border:'none'}}>
            {saving ? 'Creating...' : '+ Create Company'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-2">{title}</div>
      {children}
    </div>
  )
}
