// src/pages/invoices/ReceivePaymentModal.jsx
// Receive a single payment from a customer and allocate across multiple invoices.
// QuickBooks-style: one payment can cover multiple invoices.

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import DualInput from '@/components/ui/DualInput'

const PAYMENT_METHODS = [
  { value: 'cash',          label: '💵 Cash' },
  { value: 'check',         label: '🏦 Check' },
  { value: 'ach',           label: '🔄 ACH' },
  { value: 'card',          label: '💳 Card' },
  { value: 'bank_transfer', label: '🏦 Bank Transfer' },
  { value: 'other',         label: '📋 Other' },
]

export default function ReceivePaymentModal({ presetCustomerId, presetInvoiceId, onClose, onDone }) {
  const { tenant, store, user } = useAuthStore()
  const qc = useQueryClient()
  const $ = tenant?.currency_symbol || '$'  // used in toast messages below
  const [customerId, setCustomerId]   = useState(presetCustomerId || '')
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [method, setMethod]           = useState('check')
  const [reference, setReference]     = useState('')
  const [notes, setNotes]              = useState('')
  // allocations: { [invoiceId]: stringAmount }
  const [allocations, setAllocations] = useState({})
  const [saving, setSaving]            = useState(false)

  // Customers (only those with outstanding invoices ideally, but easier to show all)
  const { data: customers = [] } = useQuery({
    queryKey: ['business-customers-active', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('business_customers')
        .select('id, company_name, contact_name')
        .eq('tenant_id', tenant.id).eq('is_active', true)
        .order('company_name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Open invoices for the selected customer
  // Excludes drafts — drafts haven't been "issued" to the customer so they
  // shouldn't be paid yet. Also: receiving payment on a draft skips the
  // 'sent' state entirely, which means fn_send_invoice never runs and
  // inventory never deducts. User must Send the invoice first.
  const { data: openInvoices = [] } = useQuery({
    queryKey: ['open-invoices', customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, due_date, total, amount_paid, balance_due, status')
        .eq('tenant_id', tenant.id)
        .eq('business_customer_id', customerId)
        .not('status', 'in', '(draft,paid,void,voided)')
        .order('due_date', { ascending: true, nullsFirst: false })
      return data || []
    },
    enabled: !!customerId,
  })

  // When customer changes or list loads, auto-prefill if presetInvoiceId matches
  useEffect(() => {
    if (presetInvoiceId && openInvoices.find(i => i.id === presetInvoiceId)) {
      const inv = openInvoices.find(i => i.id === presetInvoiceId)
      setAllocations({ [presetInvoiceId]: String((inv.balance_due || 0).toFixed(2)) })
    }
  }, [openInvoices, presetInvoiceId])

  const totalAllocated = useMemo(() =>
    Object.values(allocations).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [allocations]
  )

  const totalOpen = useMemo(() =>
    openInvoices.reduce((s, i) => s + (i.balance_due || 0), 0),
    [openInvoices]
  )

  const setAlloc = (invoiceId, value) => {
    setAllocations(prev => {
      const next = { ...prev }
      if (!value || parseFloat(value) === 0) {
        delete next[invoiceId]
      } else {
        next[invoiceId] = value
      }
      return next
    })
  }

  // Auto-apply across oldest first, up to a target amount
  const autoApply = (totalAmount) => {
    if (!totalAmount || totalAmount <= 0) return
    let remaining = totalAmount
    const next = {}
    // Already sorted by due_date asc
    for (const inv of openInvoices) {
      if (remaining <= 0) break
      const balance = inv.balance_due || 0
      if (balance <= 0) continue
      const apply = Math.min(remaining, balance)
      next[inv.id] = apply.toFixed(2)
      remaining -= apply
    }
    setAllocations(next)
  }

  const submit = async () => {
    if (!customerId) { toast.error('Pick a company'); return }
    if (totalAllocated <= 0) { toast.error('Allocate payment to at least one invoice'); return }

    const allocList = Object.entries(allocations)
      .map(([invoice_id, amount]) => ({ invoice_id, amount: parseFloat(amount) || 0 }))
      .filter(a => a.amount > 0)

    if (allocList.length === 0) { toast.error('No valid allocations'); return }

    // Validate: each allocation should not exceed invoice balance
    for (const alloc of allocList) {
      const inv = openInvoices.find(i => i.id === alloc.invoice_id)
      if (alloc.amount > (inv?.balance_due || 0) + 0.01) {  // small tolerance
        toast.error(`${inv?.invoice_number}: payment ${$}${alloc.amount} > balance ${$}${inv?.balance_due}`)
        return
      }
    }

    setSaving(true)
    // Watchdog: payment is high-stakes (customer waiting). Auto-unstick at
    // 15s so the user isn't trapped if the RPC hangs.
    const watchdog = setTimeout(() => {
      setSaving(false)
      toast.error('⏱️ Payment is taking too long — check connection and try again')
    }, 15_000)
    try {
      const { data, error } = await supabase.rpc('fn_receive_payment_atomic', {
        p_tenant_id:     tenant.id,
        p_store_id:      store.id,
        p_customer_id:   customerId,
        p_payment_date:  paymentDate,
        p_method:        method,
        p_reference:     reference || null,
        p_notes:         notes || null,
        p_user_id:       user?.id || null,
        p_allocations:   allocList,
      })
      if (error || !data?.success) {
        toast.error(error?.message || data?.message || 'Failed to record payment')
        return
      }
      toast.success(`Payment ${data.payment_number} recorded — ${$}${data.amount}`)
      // Invalidate ALL invoice-related queries because the payment may have
      // touched multiple invoices (allocated across them). The detail-modal's
      // refetch only covers one — these cover the rest.
      qc.invalidateQueries({ queryKey: ['invoices-list'] })
      qc.invalidateQueries({ queryKey: ['invoice-detail'] })
      qc.invalidateQueries({ queryKey: ['open-invoices'] })
      qc.invalidateQueries({ queryKey: ['customers'] })  // outstanding balance
      qc.invalidateQueries({ queryKey: ['received-payments'] })
      onDone()
    } catch (err) {
      console.error('Receive payment error:', err)
      toast.error(err?.message || 'Payment failed — see console')
    } finally {
      clearTimeout(watchdog)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width:'780px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">Receive Payment</div>
            <div className="text-[16px] font-bold text-[#1F1F1F]">Record cash, check, ACH, or card</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Customer + date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Company *</FieldLabel>
              <select value={customerId} onChange={e => { setCustomerId(e.target.value); setAllocations({}) }}
                className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none cursor-pointer"
                style={{borderColor: customerId ? '#006AFF' : '#E5E5E5'}}>
                <option value="">— Select company —</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Payment date</FieldLabel>
              <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none cursor-pointer"/>
            </div>
          </div>

          {/* Method + reference */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Payment method</FieldLabel>
              <div className="grid grid-cols-3 gap-1.5">
                {PAYMENT_METHODS.map(m => (
                  <button key={m.value} type="button" onClick={() => setMethod(m.value)}
                    className="px-2 py-2 rounded-lg text-[11px] font-bold cursor-pointer active:scale-[0.96] truncate"
                    style={method === m.value
                      ? { background:'#E6F0FF', color:'#006AFF', border:'1px solid #006AFF' }
                      : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <DualInput label="Reference # (check #, ACH ref...)"
                value={reference} onChange={setReference}
                placeholder={method === 'check' ? 'Check number' : 'Reference number'}
                kbTitle="Reference Number"/>
            </div>
          </div>

          {/* Open invoices */}
          {!customerId ? (
            <div className="rounded-xl p-8 text-center"
              style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
              <div className="text-[36px] mb-2 opacity-30">🏢</div>
              <div className="text-[13px] text-[#666]">Select a company to see their open invoices</div>
            </div>
          ) : openInvoices.length === 0 ? (
            <div className="rounded-xl p-8 text-center"
              style={{background:'#DCFCE7', border:'1px solid #15803D'}}>
              <div className="text-[36px] mb-2">✅</div>
              <div className="text-[13px] font-bold text-[#15803D]">No outstanding invoices for this company</div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-bold text-[#1F1F1F]">
                  Outstanding invoices ({openInvoices.length}) · Total owed: <span className="font-mono">{$}${totalOpen.toFixed(2)}</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => autoApply(totalOpen)}
                    className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #006AFF'}}>
                    💯 Pay all
                  </button>
                  <button onClick={() => setAllocations({})}
                    className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
                <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
                  style={{gridTemplateColumns:'1.2fr 1fr 1fr 100px 110px'}}>
                  {['Invoice #', 'Due Date', 'Total', 'Balance', 'Apply'].map(h => (
                    <div key={h} className="px-3 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                  ))}
                </div>
                {openInvoices.map(inv => {
                  const overdue = inv.due_date && new Date(inv.due_date) < new Date()
                  const allocAmt = parseFloat(allocations[inv.id] || 0)
                  const wouldClose = allocAmt > 0 && allocAmt >= (inv.balance_due || 0) - 0.01
                  return (
                    <div key={inv.id} className="grid border-b border-[#E5E5E5] last:border-0 items-center"
                      style={{gridTemplateColumns:'1.2fr 1fr 1fr 100px 110px',
                              background: allocAmt > 0 ? '#F0F8FF' : '#FFFFFF'}}>
                      <div className="px-3 py-2.5 font-mono text-[12px] font-bold text-[#006AFF]">
                        {inv.invoice_number}
                      </div>
                      <div className="px-3 py-2.5 text-[11px]"
                        style={{color: overdue ? '#CF1322' : '#666'}}>
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                        {overdue && <span className="ml-1 text-[9px] font-bold">⚠️</span>}
                      </div>
                      <div className="px-3 py-2.5 text-right font-mono text-[12px] text-[#666]">
                        {$}${(inv.total || 0).toFixed(2)}
                      </div>
                      <div className="px-3 py-2.5 text-right font-mono text-[12px] font-bold text-[#CF1322]">
                        {$}${(inv.balance_due || 0).toFixed(2)}
                      </div>
                      <div className="px-2 py-2">
                        <DualInput compact mode="decimal" prefix={$}
                          value={allocations[inv.id] || ''}
                          onChange={(v) => setAlloc(inv.id, v)}
                          placeholder="0.00"
                          kbTitle={`Apply to ${inv.invoice_number}`}/>
                        {wouldClose && (
                          <div className="text-[9px] text-[#15803D] font-bold mt-0.5 text-center">→ PAID</div>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div className="bg-[#FAFAFA] border-t border-[#E5E5E5] px-4 py-3 flex justify-between items-center">
                  <span className="text-[12px] font-bold text-[#1F1F1F]">Total payment</span>
                  <span className="font-mono text-[18px] font-bold"
                    style={{color: totalAllocated > 0 ? '#15803D' : '#999'}}>
                    {$}${totalAllocated.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <DualInput label="Memo / notes (optional)" multiline
            value={notes} onChange={setNotes}
            placeholder="e.g. Check #1234 for invoice INV-001 + INV-002"
            kbTitle="Payment Memo"/>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex gap-2 flex-shrink-0" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving || totalAllocated <= 0 || !customerId}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
            style={{background:'#15803D', color:'#FFFFFF', border:'none'}}>
            {saving ? 'Saving...' : `💰 Receive ${$}${totalAllocated.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ children }) {
  return <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">{children}</div>
}
