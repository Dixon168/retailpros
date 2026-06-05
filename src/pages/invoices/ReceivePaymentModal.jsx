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
    <div className="b2b-theme fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
      <div className="card overflow-hidden flex flex-col" style={{
        width:'780px', maxWidth:'100%', maxHeight:'92vh'
      }}>
        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid rgba(0,0,0,0.06)'}}>
          <div>
            <div className="label">Receive Payment</div>
            <div className="font-display text-xl text-ink">Record cash, check, ACH, or card</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg cursor-pointer text-base bg-black/[.04] hover:bg-black/[.08] border-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-sand/30">
          {/* Customer + date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Company *</FieldLabel>
              <select value={customerId} onChange={e => { setCustomerId(e.target.value); setAllocations({}) }}
                className="input cursor-pointer">
                <option value="">— Select company —</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Payment date</FieldLabel>
              <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="input cursor-pointer"/>
            </div>
          </div>

          {/* Method + reference */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Payment method</FieldLabel>
              <div className="grid grid-cols-3 gap-1.5">
                {PAYMENT_METHODS.map(m => (
                  <button key={m.value} type="button" onClick={() => setMethod(m.value)}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition active:scale-[.97] truncate ${
                      method === m.value
                        ? 'bg-moss-50 text-moss-700 border-moss-600'
                        : 'bg-white text-ink border-black/[.1] hover:bg-sand/60'
                    }`}>
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
            <div className="rounded-2xl p-10 text-center border border-dashed border-black/15 bg-white">
              <div className="font-display text-lg text-ink mb-1">Pick a company</div>
              <p className="text-sm text-ink/55">Their open invoices will appear here for you to allocate this payment against.</p>
            </div>
          ) : openInvoices.length === 0 ? (
            <div className="rounded-2xl p-10 text-center bg-moss-50 border border-moss-600/30">
              <div className="font-display text-lg text-moss-800">No outstanding invoices</div>
              <p className="text-sm text-moss-700/70 mt-1">This company is all caught up.</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-ink">
                  Outstanding invoices ({openInvoices.length}) · Total owed
                  <span className="ml-1 tabular-nums text-clay">{$}${totalOpen.toFixed(2)}</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => autoApply(totalOpen)}
                    className="rounded-lg border border-moss-600 text-moss-700 bg-white px-2.5 py-1 text-xs font-semibold cursor-pointer hover:bg-moss-50">
                    Pay all
                  </button>
                  <button onClick={() => setAllocations({})}
                    className="rounded-lg border border-black/[.1] text-ink/60 bg-white px-2.5 py-1 text-xs font-semibold cursor-pointer hover:bg-sand/60">
                    Clear
                  </button>
                </div>
              </div>

              <div className="card overflow-hidden">
                <div className="grid bg-sand/60 border-b border-black/[.06]"
                  style={{gridTemplateColumns:'1.2fr 1fr 1fr 100px 120px'}}>
                  {['Invoice', 'Due Date', 'Total', 'Balance', 'Apply'].map((h,i) => (
                    <div key={h} className={`px-3 py-2.5 text-xs uppercase tracking-wide font-semibold text-ink/50 ${i>=2 && i<=3 ? 'text-right' : ''}`}>{h}</div>
                  ))}
                </div>
                <div className="divide-y divide-black/[.06]">
                  {openInvoices.map(inv => {
                    const overdue = inv.due_date && new Date(inv.due_date) < new Date()
                    const allocAmt = parseFloat(allocations[inv.id] || 0)
                    const wouldClose = allocAmt > 0 && allocAmt >= (inv.balance_due || 0) - 0.01
                    return (
                      <div key={inv.id} className={`grid items-center transition-colors ${allocAmt > 0 ? 'bg-moss-50/60' : 'bg-white hover:bg-sand/40'}`}
                        style={{gridTemplateColumns:'1.2fr 1fr 1fr 100px 120px'}}>
                        <div className="px-3 py-3 font-semibold text-ink tabular-nums">
                          {inv.invoice_number}
                        </div>
                        <div className={`px-3 py-3 text-sm ${overdue ? 'text-clay font-semibold' : 'text-ink/65'}`}>
                          {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                        </div>
                        <div className="px-3 py-3 text-right tabular-nums text-sm text-ink/65">
                          {$}${(inv.total || 0).toFixed(2)}
                        </div>
                        <div className="px-3 py-3 text-right tabular-nums font-semibold text-clay">
                          {$}${(inv.balance_due || 0).toFixed(2)}
                        </div>
                        <div className="px-2 py-2">
                          <DualInput compact mode="decimal" prefix={$}
                            value={allocations[inv.id] || ''}
                            onChange={(v) => setAlloc(inv.id, v)}
                            placeholder="0.00"
                            kbTitle={`Apply to ${inv.invoice_number}`}/>
                          {wouldClose && (
                            <div className="text-[9px] text-moss-700 font-semibold mt-0.5 text-center">→ paid in full</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="bg-sand/60 border-t border-black/[.06] px-4 py-3.5 flex justify-between items-center">
                  <span className="text-sm font-semibold text-ink">Total payment</span>
                  <span className={`tabular-nums text-2xl font-display font-semibold ${
                    totalAllocated > 0 ? 'text-moss-700' : 'text-ink/30'
                  }`}>
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
        <div className="px-6 py-4 flex gap-2 flex-shrink-0 bg-white" style={{borderTop:'1px solid rgba(0,0,0,0.06)'}}>
          <button onClick={onClose} className="btn-outline flex-1">Cancel</button>
          <button onClick={submit} disabled={saving || totalAllocated <= 0 || !customerId} className="btn-primary flex-1">
            {saving ? 'Saving…' : `Receive ${$}${totalAllocated.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ children }) {
  return <div className="label">{children}</div>
}
