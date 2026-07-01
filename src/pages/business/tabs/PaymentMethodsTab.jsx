// src/pages/business/tabs/PaymentMethodsTab.jsx
// Phase 1 scope: only Check on File is fully supported.
// Credit Card support is a future addition (Stripe integration needed).

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import DualInput from '@/components/ui/DualInput'

export default function PaymentMethodsTab({ customerId, tenantId, onChanged }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)

  const { data: methods = [], isLoading } = useQuery({
    queryKey: ['company-payment-methods', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('business_payment_methods')
        .select('*').eq('business_customer_id', customerId).eq('is_active', true)
        .order('is_default', { ascending: false }).order('created_at')
      return data || []
    },
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['company-payment-methods', customerId] })
    qc.invalidateQueries({ queryKey: ['company-tab-counts', customerId] })
    onChanged?.()
  }

  const deactivate = async (m) => {
    if (!confirm(`Remove ${m.nickname || m.method_type}?\nThis won't delete past payment history — just removes the on-file method.`)) return
    const { error } = await supabase.from('business_payment_methods')
      .update({ is_active: false }).eq('id', m.id)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Payment method removed')
    refresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[12px] font-bold text-[#1F1F1F]">
            {methods.length} method{methods.length !== 1 ? 's' : ''} on file
          </div>
          <div className="text-[10px] text-[#666] mt-0.5">
            Securely stored info for faster Check / future card payments
          </div>
        </div>
        <button onClick={() => setEditing('new')}
          className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
          + Add Payment Method
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-[12px] text-[#999]">Loading...</div>
      ) : methods.length === 0 ? (
        <div className="rounded-lg p-8 text-center text-[12px] text-[#999]"
          style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
          <div className="text-[36px] mb-2 opacity-30">💳</div>
          No payment methods on file. Add a Check on file for faster reconciliation.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {methods.map(m => (
            <div key={m.id} className="rounded-lg p-3"
              style={{background:'#FFFFFF', border:'1px solid #E5E5E5'}}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                  style={m.method_type === 'check'
                    ? {background:'#eef0fc', color:'#5E6AD2'}
                    : {background:'#F3E8FF', color:'#7C3AED'}}>
                  {m.method_type === 'check' ? '🏦 Check' : m.method_type === 'card' ? '💳 Card' : '🔄 ACH'}
                </span>
                {m.is_default && (
                  <span className="text-[9px] font-bold uppercase text-[#059669]">⭐ Default</span>
                )}
              </div>
              <div className="text-[13px] font-bold text-[#1F1F1F]">{m.nickname || `${m.method_type.toUpperCase()} on file`}</div>
              {m.method_type === 'check' && (
                <div className="text-[11px] text-[#666] mt-1 space-y-0.5">
                  {m.bank_name && <div>🏦 {m.bank_name}</div>}
                  {m.holder_name && <div>👤 {m.holder_name}</div>}
                  {m.routing_last4 && <div>Routing: •••• {m.routing_last4}</div>}
                  {m.account_last4 && <div>Account: •••• {m.account_last4}</div>}
                </div>
              )}
              {m.method_type === 'card' && (
                <div className="text-[11px] text-[#666] mt-1 space-y-0.5">
                  {m.card_brand && <div>{m.card_brand.toUpperCase()} •••• {m.card_last4}</div>}
                  {m.card_exp_month && <div>Exp: {String(m.card_exp_month).padStart(2,'0')}/{m.card_exp_year}</div>}
                  {m.holder_name && <div>👤 {m.holder_name}</div>}
                </div>
              )}
              {m.notes && <div className="text-[10px] text-[#999] mt-2 italic">{m.notes}</div>}
              <div className="flex gap-1.5 mt-2">
                <button onClick={() => setEditing(m)}
                  className="flex-1 rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                  style={{background:'#FFFFFF', color:'#5E6AD2', border:'1px solid #5E6AD2'}}>
                  Edit
                </button>
                <button onClick={() => deactivate(m)}
                  className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                  style={{background:'#FFFFFF', color:'#dc2626', border:'1px solid #FECACA'}}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-lg p-2.5 text-[10px] flex items-start gap-2"
        style={{background:'#eef0fc', color:'#5E6AD2', border:'1px solid #B3D1FF'}}>
        <span>🔒</span>
        <span>
          <strong>Security:</strong> Only last 4 digits of routing/account numbers are stored — never full numbers.
          Credit card support requires payment processor integration (coming later).
        </span>
      </div>

      {editing && (
        <PaymentMethodFormModal
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

function PaymentMethodFormModal({ initial, customerId, tenantId, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    method_type:  initial?.method_type || 'check',
    nickname:     initial?.nickname    || '',
    holder_name:  initial?.holder_name || '',
    bank_name:    initial?.bank_name   || '',
    routing_last4: initial?.routing_last4 || '',
    account_last4: initial?.account_last4 || '',
    notes:        initial?.notes       || '',
    is_default:   initial?.is_default  ?? false,
  })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const save = async () => {
    if (form.method_type === 'check' && !form.bank_name.trim() && !form.holder_name.trim()) {
      toast.error('Bank name or holder name required'); return
    }
    setSaving(true)
    try {
      // Sanitize last4 fields: only keep last 4 digits
      const cleanLast4 = (s) => (s || '').replace(/\D/g, '').slice(-4)
      const payload = {
        tenant_id: tenantId,
        business_customer_id: customerId,
        method_type:  form.method_type,
        nickname:     form.nickname || null,
        holder_name:  form.holder_name || null,
        bank_name:    form.bank_name || null,
        routing_last4: cleanLast4(form.routing_last4) || null,
        account_last4: cleanLast4(form.account_last4) || null,
        notes:        form.notes || null,
        is_default:   form.is_default,
        is_active:    true,
      }
      let error
      if (initial?.id) {
        ({ error } = await supabase.from('business_payment_methods').update(payload).eq('id', initial.id))
      } else {
        ({ error } = await supabase.from('business_payment_methods').insert(payload))
      }
      if (error) { toast.error('Failed: ' + error.message); return }
      toast.success(initial?.id ? 'Payment method updated' : 'Payment method added')
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
            {initial?.id ? 'Edit payment method' : 'New payment method'}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>
        <div className="p-5 space-y-3">
          {/* Type */}
          <div>
            <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Method type</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => set('method_type', 'check')}
                className="rounded-lg py-2.5 text-[12px] font-bold cursor-pointer active:scale-[0.97]"
                style={form.method_type === 'check'
                  ? { background:'#5E6AD2', color:'#FFFFFF', border:'none' }
                  : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
                🏦 Check on file
              </button>
              <button disabled
                className="rounded-lg py-2.5 text-[12px] font-bold opacity-40 cursor-not-allowed"
                style={{ background:'#FFFFFF', color:'#999', border:'1px solid #E5E5E5' }}
                title="Credit card support requires Stripe integration — coming later">
                💳 Card (coming later)
              </button>
            </div>
          </div>

          <DualInput label="Nickname (e.g. 'Main Chase checking')" value={form.nickname}
            onChange={v => set('nickname', v)}
            placeholder="Main account" kbTitle="Nickname"/>

          {form.method_type === 'check' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <DualInput label="Bank name" value={form.bank_name} onChange={v => set('bank_name', v)}
                  placeholder="Chase, BofA, etc" kbTitle="Bank name"/>
                <DualInput label="Holder name (on check)" value={form.holder_name} onChange={v => set('holder_name', v)}
                  placeholder="ACME Corp" kbTitle="Holder name"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DualInput label="Routing # (last 4 only)" mode="numeric" value={form.routing_last4}
                  onChange={v => set('routing_last4', v.replace(/\D/g, '').slice(-4))}
                  placeholder="1234" kbTitle="Routing last 4"/>
                <DualInput label="Account # (last 4 only)" mode="numeric" value={form.account_last4}
                  onChange={v => set('account_last4', v.replace(/\D/g, '').slice(-4))}
                  placeholder="6789" kbTitle="Account last 4"/>
              </div>
              <div className="rounded-lg p-2 text-[10px]"
                style={{background:'#FFF7ED', color:'#B45309', border:'1px solid #F59E0B'}}>
                🔒 Only last 4 digits stored — for identification when reconciling payments.
              </div>
            </>
          )}

          <DualInput label="Notes (optional)" multiline value={form.notes} onChange={v => set('notes', v)}
            placeholder="e.g. Hands checks at end of month. Bookkeeper Maria handles it."
            kbTitle="Notes"/>

          <label className="flex items-center gap-2 text-[12px] cursor-pointer">
            <input type="checkbox" checked={form.is_default}
              onChange={e => set('is_default', e.target.checked)}
              className="accent-[#5E6AD2]"/>
            <span>⭐ Use as default payment method</span>
          </label>
        </div>
        <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer text-white disabled:opacity-40"
            style={{background:'#5E6AD2', border:'none'}}>
            {saving ? 'Saving...' : initial?.id ? '✓ Save' : '+ Save Method'}
          </button>
        </div>
      </div>
    </div>
  )
}
