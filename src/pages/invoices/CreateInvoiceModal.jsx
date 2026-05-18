// src/pages/invoices/CreateInvoiceModal.jsx
//
// Dual-mode modal:
//   - CREATE: { onClose, onCreated, presetCustomerId } — fresh invoice
//   - EDIT:   { onClose, onCreated, editInvoiceId }    — load existing,
//             call fn_edit_invoice on save. Inventory auto-adjusts.
//             Voided/closed invoices are loaded read-only with a banner
//             instead of letting the user submit.

import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import DualInput from '@/components/ui/DualInput'
import EstimateProductPicker from '@/pages/estimates/EstimateProductPicker'

export default function CreateInvoiceModal({ onClose, onCreated, presetCustomerId, editInvoiceId }) {
  const { tenant, store, user } = useAuthStore()
  const isEdit = !!editInvoiceId
  const [customerId, setCustomerId]     = useState(presetCustomerId || '')
  const [dueDate, setDueDate]           = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [notes, setNotes]               = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [items, setItems]               = useState([])
  const [showProductPicker, setShowProductPicker] = useState(false)
  const [saving, setSaving]             = useState(false)
  // Set when we load an existing invoice — used to compute warnings and
  // to suppress the Pay Now toggle (you receive payment separately via
  // ReceivePaymentModal once the invoice is created)
  const [loadedInvoice, setLoadedInvoice] = useState(null)
  // Ref flag used by the customer-change useEffect below. Set true during
  // edit-mode hydration so we don't blow away the original ship-to.
  const skipShipResetRef = useRef(false)

  // ── Pay Now (optional) — when toggled on, save also Sends + Receives payment
  // ── in a single atomic backend call (fn_create_invoice_and_pay).
  const [payNow, setPayNow]               = useState(false)
  const [payAmount, setPayAmount]         = useState('')      // blank means "full amount"
  const [payMethod, setPayMethod]         = useState('cash')
  const [payReference, setPayReference]   = useState('')
  const [payDate, setPayDate]             = useState(() => new Date().toISOString().slice(0, 10))

  // Ship-to selection: 'billing' | 'saved' | 'custom'
  const [shipMode, setShipMode] = useState('billing')
  const [savedShipId, setSavedShipId] = useState('')
  const [customShip, setCustomShip] = useState({
    address:'', city:'', state:'', zip:'',
    contact_name:'', contact_phone:'', label:''
  })
  const setCS = (k, v) => setCustomShip(p => ({ ...p, [k]: v }))

  // Companies
  const { data: customers = [] } = useQuery({
    queryKey: ['business-customers-active', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('business_customers')
        .select('id, company_name, contact_name, payment_terms, billing_address, billing_city, billing_state, billing_zip')
        .eq('tenant_id', tenant.id).eq('is_active', true)
        .order('company_name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Saved delivery/shipping addresses for the selected company
  const { data: savedAddrs = [] } = useQuery({
    queryKey: ['business-ship-addresses', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('business_addresses')
        .select('id, type, label, address, city, state, zip, country, contact_name, contact_phone, is_default')
        .eq('business_customer_id', customerId)
        .in('type', ['delivery','shipping'])
        .order('is_default', { ascending: false })
        .order('type')
      return data || []
    },
    enabled: !!customerId,
  })

  // ── EDIT MODE: load the existing invoice + items, then hydrate state.
  // Only runs when editInvoiceId is set. Locked statuses (voided / closed)
  // still hydrate so the user can SEE the data, but the save button blocks.
  useEffect(() => {
    if (!editInvoiceId) return
    let cancelled = false
    ;(async () => {
      const { data: inv, error } = await supabase
        .from('invoices')
        .select('*, invoice_items(*)')
        .eq('id', editInvoiceId)
        .single()
      if (cancelled) return
      if (error || !inv) {
        toast.error('Could not load invoice for editing')
        onClose()
        return
      }
      setLoadedInvoice(inv)
      // ⚠️ Skip the customer-change-resets-shipMode useEffect for this one
      // hydration: we want to keep the shipping_address that was frozen
      // on the invoice when it was created. The flag is cleared at end
      // of this effect so future customer changes still reset properly.
      skipShipResetRef.current = true
      setCustomerId(inv.business_customer_id)
      setDueDate(inv.due_date || '')
      setNotes(inv.notes || '')
      setInternalNotes(inv.internal_notes || '')
      setDeliveryNotes(inv.delivery_notes || '')

      // Fetch real-time stock for all products on this invoice so the
      // stockWarnings UX reads truthfully (without this, every item
      // would show "out of stock" because stock_qty was null).
      const productIds = (inv.invoice_items || [])
        .map(it => it.product_id)
        .filter(Boolean)
      let stockMap = {}
      if (productIds.length > 0) {
        const { data: stockRows } = await supabase
          .from('inventory')
          .select('product_id, quantity')
          .eq('tenant_id', tenant.id)
          .eq('store_id', inv.store_id)
          .in('product_id', productIds)
        ;(stockRows || []).forEach(r => { stockMap[r.product_id] = r.quantity })
      }

      setItems((inv.invoice_items || [])
        .sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(it => ({
          // Same shape addProduct produces
          product_id:   it.product_id,
          product_name: it.product_name,
          product_sku:  it.product_sku,
          description:  it.description,
          quantity:     String(it.quantity),
          unit_price:   String(it.unit_price),
          discount_pct: String(it.discount_pct || 0),
          // Available stock + the qty already deducted by this invoice =
          // the "effective max" the user can sell. Pass that as stock_qty
          // so the warning bar shows realistic numbers.
          stock_qty: it.product_id
            ? (stockMap[it.product_id] || 0) + (it.inventory_deducted || 0)
            : null,
          is_custom:    !it.product_id,
        })))
      // Allow the ref to be released on next tick — the customer effect
      // will have fired by then.
      setTimeout(() => { skipShipResetRef.current = false }, 0)
    })()
    return () => { cancelled = true }
  }, [editInvoiceId])

  const isLocked = loadedInvoice?.status === 'voided'
                || loadedInvoice?.status === 'void'
                || loadedInvoice?.status === 'closed'

  // When company changes, reset ship-to to billing and clear picks.
  // Skipped during edit-mode hydration so we don't lose the invoice's
  // original ship-to data (see skipShipResetRef in the edit loader).
  useEffect(() => {
    if (skipShipResetRef.current) return
    setShipMode('billing')
    setSavedShipId('')
    setCustomShip({ address:'', city:'', state:'', zip:'', contact_name:'', contact_phone:'', label:'' })
  }, [customerId])

  // Auto-pick the default saved address when user switches to "saved"
  useEffect(() => {
    if (shipMode === 'saved' && !savedShipId && savedAddrs.length > 0) {
      setSavedShipId(savedAddrs[0].id)
    }
  }, [shipMode, savedAddrs, savedShipId])

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, total = 0
    items.forEach(it => {
      const qty = parseFloat(it.quantity) || 0
      const price = parseFloat(it.unit_price) || 0
      const dpct = parseFloat(it.discount_pct) || 0
      const lineSubtotal = qty * price
      const lineDisc = lineSubtotal * (dpct / 100)
      subtotal += lineSubtotal
      discount += lineDisc
      total += lineSubtotal - lineDisc
    })
    return { subtotal, discount, total }
  }, [items])

  const stockWarnings = useMemo(() =>
    // Only positive line items pull from stock. Negative qty (deposits,
    // refund credits) increase stock or have no inventory impact —
    // fn_send_invoice handles them safely.
    items.filter(i => (parseFloat(i.quantity) || 0) > 0
                      && (parseFloat(i.quantity) || 0) > (i.stock_qty || 0))
  , [items])

  const addProduct = (product) => {
    if (items.find(i => i.product_id === product.id)) {
      toast.error(`${product.name} is already in this invoice`)
      return
    }
    setItems([...items, {
      product_id:    product.id,
      product_name:  product.name,
      product_sku:   product.sku,
      quantity:      '1',
      unit_price:    String(product.price || 0),
      discount_pct:  '0',
      stock_qty:     product.stock_qty || 0,
    }])
    setShowProductPicker(false)
  }

  const updateItem = (idx, field, value) => {
    setItems(items.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }
  const removeItem = (idx) => setItems(items.filter((_, i) => i !== idx))

  const selectedCustomer = customers.find(c => c.id === customerId)

  // Build the shipping_address_snapshot JSONB we'll persist
  const buildShipSnapshot = () => {
    if (shipMode === 'billing') return null   // null → packing slip falls back to billing
    if (shipMode === 'saved') {
      const a = savedAddrs.find(x => x.id === savedShipId)
      if (!a) return null
      return {
        label:         a.label || (a.type === 'delivery' ? 'Delivery' : 'Shipping'),
        address:       a.address,
        city:          a.city,
        state:         a.state,
        zip:           a.zip,
        country:       a.country || 'US',
        contact_name:  a.contact_name,
        contact_phone: a.contact_phone,
        source_address_id: a.id,
      }
    }
    return {
      label:         customShip.label || 'One-time delivery',
      address:       customShip.address.trim(),
      city:          customShip.city.trim()  || null,
      state:         customShip.state.trim() || null,
      zip:           customShip.zip.trim()   || null,
      country:       'US',
      contact_name:  customShip.contact_name.trim()  || null,
      contact_phone: customShip.contact_phone.trim() || null,
      one_time: true,
    }
  }

  const create = async () => {
    if (!customerId) { toast.error('Please select a company'); return }
    if (items.length === 0) { toast.error('Add at least one item'); return }
    for (const it of items) {
      const qty = parseFloat(it.quantity)
      // Negative qty is OK (for deposits / refund credits), but ZERO means
      // user forgot to fill it in.
      if (isNaN(qty) || qty === 0) {
        toast.error(`${it.product_name || 'Line item'}: quantity must be non-zero`); return
      }
      if (it.is_custom && !it.product_name?.trim()) {
        toast.error('Custom line: name is required (e.g. "Service Fee", "Shipping")'); return
      }
    }
    if (shipMode === 'custom' && !customShip.address.trim()) {
      toast.error('Custom delivery address: street is required'); return
    }
    if (shipMode === 'saved' && !savedShipId) {
      toast.error('Pick a saved delivery address'); return
    }

    // ── EDIT MODE: branch off to fn_edit_invoice. No Pay Now in this path
    // (payment is a separate flow via ReceivePaymentModal). Locked invoices
    // (voided / closed) never reach here — UI hides the Save button.
    if (isEdit) {
      if (isLocked) {
        toast.error('This invoice is locked and cannot be edited')
        return
      }
      setSaving(true)
      const watchdog = setTimeout(() => {
        setSaving(false)
        toast.error('⏱️ Save is taking too long — check connection and try again')
      }, 20_000)
      try {
        const { data, error } = await supabase.rpc('fn_edit_invoice', {
          p_tenant_id:  tenant.id,
          p_invoice_id: editInvoiceId,
          p_user_id:    user?.id || null,
          p_items: items.map(it => ({
            product_id:   it.product_id,
            product_name: it.product_name,
            product_sku:  it.product_sku,
            description:  it.description,
            quantity:     parseFloat(it.quantity) || 0,
            unit_price:   parseFloat(it.unit_price) || 0,
            discount_pct: parseFloat(it.discount_pct) || 0,
          })),
          p_header: {
            due_date:       dueDate || null,
            notes:          notes || null,
            internal_notes: internalNotes || null,
            delivery_notes: deliveryNotes || null,
          },
        })
        if (error || !data?.success) {
          toast.error(error?.message || data?.message || 'Failed to save changes')
          return
        }
        toast.success(data.message || 'Invoice updated ✓')
        onCreated()
      } catch (e) {
        console.error('Edit invoice error:', e)
        toast.error(e?.message || 'Save failed')
      } finally {
        clearTimeout(watchdog)
        setSaving(false)
      }
      return  // skip the create-path code below
    }

    const customer = customers.find(c => c.id === customerId)
    const billingAddr = customer ? {
      address: customer.billing_address,
      city:    customer.billing_city,
      state:   customer.billing_state,
      zip:     customer.billing_zip,
    } : null
    const shipSnapshot = buildShipSnapshot()

    // Validate Pay Now amount if enabled
    if (payNow) {
      // Blank → full amount. Explicit 0 → same as toggle off (warn user).
      const raw = (payAmount || '').trim()
      const amt = raw === '' ? totals.total : parseFloat(raw)
      if (raw !== '' && (isNaN(amt) || amt <= 0)) {
        toast.error('Amount must be greater than 0 — or uncheck "Receive payment" to save as draft')
        return
      }
      if (amt > totals.total + 0.01) {
        toast.error(`Amount $${amt.toFixed(2)} can't exceed invoice total $${totals.total.toFixed(2)}`)
        return
      }
    }

    setSaving(true)
    const watchdog = setTimeout(() => {
      setSaving(false)
      toast.error('⏱️ Create is taking too long — check connection and try again')
    }, 20_000)  // 20s — Pay Now does 3 ops, give it room

    const commonArgs = {
      p_tenant_id:      tenant.id,
      p_store_id:       store.id,
      p_customer_id:    customerId,
      p_due_date:       dueDate || null,
      p_notes:          notes || null,
      p_internal_notes: internalNotes || null,
      p_created_by:     user?.id || null,
      p_items: items.map(it => ({
        product_id:   it.product_id,         // null for custom lines — RPC won't touch inventory
        product_name: it.product_name,
        product_sku:  it.product_sku,
        description:  it.description,
        quantity:     parseFloat(it.quantity) || 0,
        unit_price:   parseFloat(it.unit_price) || 0,
        discount_pct: parseFloat(it.discount_pct) || 0,
      })),
      p_billing_addr:  billingAddr,
      p_shipping_addr: shipSnapshot,
      p_source_estimate_id: null,
      p_delivery_notes: deliveryNotes || null,
    }

    try {
      let data, error
      if (payNow) {
        // Combo RPC: create → send → receive payment, all atomic
        // Blank → full amount; any positive number → that exact amount
        const raw = (payAmount || '').trim()
        const payAmt = raw === '' ? totals.total : parseFloat(raw)
        ;({ data, error } = await supabase.rpc('fn_create_invoice_and_pay', {
          ...commonArgs,
          p_payment_amount:    payAmt,
          p_payment_method:    payMethod,
          p_payment_reference: payReference || null,
          p_payment_notes:     null,
          p_payment_date:      payDate,
        }))
      } else {
        ;({ data, error } = await supabase.rpc('fn_create_invoice_atomic', commonArgs))
      }

      if (error || !data?.success) {
        toast.error(error?.message || data?.message || 'Failed to create invoice')
        return
      }

      // Different success messages depending on path
      if (payNow) {
        toast.success(data.message || `Created ${data.invoice_number} ✓`, { duration: 4000 })
      } else {
        toast.success(`Created ${data.invoice_number} — draft saved (send to deduct stock)`)
      }
      onCreated()
    } catch (e) {
      console.error('Create invoice error:', e)
      toast.error(e?.message || 'Create failed')
    } finally {
      clearTimeout(watchdog)
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}}>
        <div className="rounded-2xl overflow-hidden flex flex-col" style={{
          width:'820px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
          boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
        }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
            <div>
              <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">
                {isEdit
                  ? (isLocked ? '🔒 Invoice Locked' : `✏️ Edit Invoice`)
                  : 'New Invoice'}
              </div>
              <div className="text-[16px] font-bold text-[#1F1F1F]">
                {loadedInvoice?.invoice_number
                  ? `${loadedInvoice.invoice_number} · ${selectedCustomer?.company_name || ''}`
                  : (selectedCustomer?.company_name || 'Pick a company')}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
              style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          {/* Locked banner — only in edit mode for voided/closed invoices */}
          {isEdit && isLocked && (
            <div className="px-5 py-3 flex-shrink-0"
              style={{background: loadedInvoice?.status === 'closed' ? '#F3F4F6' : '#FEF2F2',
                      borderBottom: `1px solid ${loadedInvoice?.status === 'closed' ? '#D1D5DB' : '#FCA5A5'}`}}>
              <div className="text-[12px] font-bold text-[#1F1F1F]">
                {loadedInvoice?.status === 'closed' ? '🔒' : '⛔'}{' '}
                {loadedInvoice?.status === 'closed'
                  ? 'This invoice is closed and locked.'
                  : 'This invoice has been voided.'}
              </div>
              <div className="text-[11px] text-[#666] mt-0.5">
                {loadedInvoice?.status === 'closed'
                  ? 'No further changes are allowed. To make corrections, issue a credit memo.'
                  : 'The invoice has been cancelled and inventory has been restored.'}
              </div>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Company *</FieldLabel>
                <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                  disabled={isEdit}
                  title={isEdit ? 'Cannot change company on an existing invoice — void and recreate to change' : undefined}
                  className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none cursor-pointer disabled:bg-[#F0F0F0] disabled:cursor-not-allowed disabled:opacity-70"
                  style={{borderColor: customerId ? '#006AFF' : '#E5E5E5'}}>
                  <option value="">— Select company —</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.company_name}{c.contact_name ? ` · ${c.contact_name}` : ''}</option>
                  ))}
                </select>
                {customers.length === 0 && (
                  <div className="text-[11px] text-[#CF1322] mt-1">⚠️ No companies yet.</div>
                )}
                {selectedCustomer?.payment_terms && (
                  <div className="text-[10px] text-[#666] mt-1">
                    Default terms: <span className="font-bold uppercase">{selectedCustomer.payment_terms}</span>
                  </div>
                )}
              </div>
              <div>
                <FieldLabel>Due date</FieldLabel>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none cursor-pointer"/>
              </div>
            </div>

            {/* ── Ship-to section (Phase 5) ── */}
            {customerId && (
              <ShipToSection
                selectedCustomer={selectedCustomer}
                savedAddrs={savedAddrs}
                shipMode={shipMode}     setShipMode={setShipMode}
                savedShipId={savedShipId} setSavedShipId={setSavedShipId}
                customShip={customShip} setCS={setCS}
                deliveryNotes={deliveryNotes} setDeliveryNotes={setDeliveryNotes}
              />
            )}

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <FieldLabel>Items ({items.length})</FieldLabel>
                <div className="flex gap-2">
                  <button onClick={() => {
                    // Custom line — for deposits, fees, manual charges.
                    // product_id stays null so it never affects inventory.
                    setItems([...items, {
                      product_id:   null,
                      product_name: '',
                      product_sku:  '',
                      quantity:     '1',
                      unit_price:   '0',
                      discount_pct: '0',
                      stock_qty:    null,
                      is_custom:    true,
                    }])
                  }}
                    className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                    style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #006AFF'}}
                    title="Add a free-form line (deposit, service fee, manual charge). No inventory tracking.">
                    + Custom Line
                  </button>
                  <button onClick={() => setShowProductPicker(true)}
                    className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                    style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
                    + Add Product
                  </button>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="rounded-xl p-8 text-center"
                  style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
                  <div className="text-[36px] mb-2 opacity-30">📦</div>
                  <div className="text-[13px] text-[#666] mb-3">No items yet</div>
                  <button onClick={() => setShowProductPicker(true)}
                    className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer"
                    style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
                    + Add your first item
                  </button>
                </div>
              ) : (
                <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
                  <div className="grid bg-[#F5F5F5] border-b border-[#E5E5E5]"
                    style={{gridTemplateColumns:'1.4fr 70px 70px 80px 65px 90px 36px'}}>
                    {['Product','Stock','Qty','Price','Disc%','Subtotal',''].map(h => (
                      <div key={h} className="px-2 py-2 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
                    ))}
                  </div>
                  {items.map((item, idx) => {
                    const qty = parseFloat(item.quantity) || 0
                    const price = parseFloat(item.unit_price) || 0
                    const dpct = parseFloat(item.discount_pct) || 0
                    const sub = qty * price * (1 - dpct / 100)
                    const stockOK = (item.stock_qty || 0) >= qty
                    return (
                      <div key={idx} className="grid border-b border-[#E5E5E5] last:border-0 items-center"
                        style={{gridTemplateColumns:'1.4fr 70px 70px 80px 65px 90px 36px'}}>
                        <div className="px-2 py-2.5">
                          {item.is_custom ? (
                            <input
                              value={item.product_name}
                              onChange={e => updateItem(idx, 'product_name', e.target.value)}
                              placeholder="e.g. Service Fee, Shipping, Surcharge"
                              className="w-full text-[12px] font-bold text-[#1F1F1F] bg-transparent border-none outline-none placeholder:font-normal placeholder:text-[#999]"
                            />
                          ) : (
                            <>
                              <div className="text-[12px] font-bold text-[#1F1F1F] truncate">{item.product_name}</div>
                              {item.product_sku && (
                                <div className="text-[9px] text-[#999] font-mono">{item.product_sku}</div>
                              )}
                            </>
                          )}
                        </div>
                        <div className="px-2 py-2.5 text-right font-mono text-[11px]"
                          style={{color: stockOK ? '#15803D' : '#CF1322'}}>
                          {item.is_custom ? <span className="text-[#999]">—</span> : (item.stock_qty ?? 0)}
                        </div>
                        <div className="px-1 py-2.5">
                          <DualInput compact mode="decimal" allowNegative
                            value={item.quantity}
                            onChange={(v) => updateItem(idx, 'quantity', v)}
                            kbTitle={`Qty: ${item.product_name}`}/>
                        </div>
                        <div className="px-1 py-2.5">
                          <DualInput compact mode="decimal" prefix="$" allowNegative
                            value={item.unit_price}
                            onChange={(v) => updateItem(idx, 'unit_price', v)}
                            kbTitle={`Price: ${item.product_name}`}/>
                        </div>
                        <div className="px-1 py-2.5">
                          <DualInput compact mode="decimal"
                            value={item.discount_pct}
                            onChange={(v) => updateItem(idx, 'discount_pct', v)}
                            kbTitle={`Disc%: ${item.product_name}`}/>
                        </div>
                        <div className="px-2 py-2.5 text-right font-mono text-[12px] font-bold text-[#1F1F1F]">
                          ${sub.toFixed(2)}
                        </div>
                        <div className="px-1 py-2.5">
                          <button onClick={() => removeItem(idx)}
                            className="w-6 h-6 rounded text-[12px] cursor-pointer"
                            style={{background:'#FEE2E2', color:'#CF1322', border:'none'}}>×</button>
                        </div>
                      </div>
                    )
                  })}
                  <div className="bg-[#FAFAFA] border-t border-[#E5E5E5] px-4 py-3">
                    <div className="ml-auto max-w-[280px] text-[12px] space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[#666]">Subtotal</span>
                        <span className="font-mono">${totals.subtotal.toFixed(2)}</span>
                      </div>
                      {totals.discount > 0 && (
                        <div className="flex justify-between">
                          <span className="text-[#666]">Discount</span>
                          <span className="font-mono text-[#CF1322]">−${totals.discount.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between pt-1.5 border-t border-[#E5E5E5]">
                        <span className="font-bold">Total</span>
                        <span className="font-mono text-[16px] font-bold">${totals.total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {stockWarnings.length > 0 && (
                <div className="mt-2 rounded-lg px-3 py-2 text-[11px]"
                  style={{background:'#FEF3C7', color:'#B45309', border:'1px solid #FCD34D'}}>
                  ⚠️ <strong>{stockWarnings.length} item{stockWarnings.length > 1 ? 's' : ''}</strong> exceed{stockWarnings.length === 1 ? 's' : ''} current stock. Inventory will go negative.
                </div>
              )}

              <div className="mt-2 text-[11px] text-[#666] flex items-start gap-1.5 px-1">
                <span className="text-[12px]">💡</span>
                <span>Creating this invoice will <strong>deduct inventory immediately</strong>. (Use Estimate first if you want to quote without committing stock.)</span>
              </div>
            </div>

            {/* Notes — customer-visible and internal memo */}
            <div className="grid grid-cols-2 gap-3">
              <DualInput label="Notes (visible to customer)" multiline
                value={notes} onChange={setNotes}
                placeholder="e.g. Pay by check to ABC Company, terms net 30..."
                kbTitle="Customer Notes"/>
              <DualInput label="Internal memo (private)" multiline
                value={internalNotes} onChange={setInternalNotes}
                placeholder="Visible only to your team — not printed on invoice"
                kbTitle="Internal Memo"/>
            </div>
          </div>

          {/* ── Pay / Deposit (optional) ────────────────────────────────
              Single payment input. Amount entered determines the label:
                = 0 / blank  → no payment, save as draft
                < total      → "Deposit / Partial" (PARTIAL invoice)
                ≥ total      → "Pay in Full" (PAID invoice)
              When amount > 0, the create button atomically does:
              create draft → send (deduct stock) → record payment.        */}
          {totals.total > 0 && items.length > 0 && !isEdit && (() => {
            const enteredAmt = parseFloat(payAmount) || 0
            const isFull    = payNow && enteredAmt >= totals.total - 0.005
            const isPartial = payNow && enteredAmt > 0 && enteredAmt < totals.total
            const balance   = Math.max(0, totals.total - enteredAmt)
            const accentColor = isFull ? '#15803D' : isPartial ? '#B45309' : '#E5E5E5'
            const bgColor     = isFull ? '#F0FDF4' : isPartial ? '#FFFBEB' : '#FAFAFA'
            return (
              <div className="px-5 pb-4 flex-shrink-0">
                <div className="rounded-xl border" style={{borderColor: accentColor, background: bgColor}}>
                  <label className="flex items-center gap-3 px-4 py-3 cursor-pointer">
                    <input type="checkbox" checked={payNow}
                      onChange={e => { setPayNow(e.target.checked); if (!e.target.checked) setPayAmount('') }}
                      className="w-4 h-4 cursor-pointer"
                      style={{accentColor: isFull ? '#15803D' : '#B45309'}}/>
                    <div className="flex-1">
                      <div className="text-[13px] font-bold text-[#1F1F1F]">
                        💰 Receive payment / deposit now
                      </div>
                      <div className="text-[11px] text-[#666]">
                        {!payNow
                          ? 'Off — save as draft, customer pays later.'
                          : isFull
                          ? 'Pay in full — invoice will be marked PAID.'
                          : isPartial
                          ? `Deposit — invoice PARTIAL, $${balance.toFixed(2)} remaining.`
                          : 'Enter amount below — leave blank = full payment.'}
                      </div>
                    </div>
                  </label>
                  {payNow && (
                    <div className="px-4 pb-4 pt-1 border-t" style={{borderColor: accentColor === '#E5E5E5' ? '#E5E5E5' : (isFull ? '#86EFAC' : '#FCD34D')}}>
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                          <FieldLabel>Amount received {isPartial && '(Deposit)'}</FieldLabel>
                          <DualInput compact mode="decimal" prefix="$"
                            value={payAmount}
                            onChange={setPayAmount}
                            placeholder={totals.total.toFixed(2)}
                            kbTitle="Amount received"/>
                          <div className="text-[10px] text-[#666] mt-1">
                            Leave blank = full {`$${totals.total.toFixed(2)}`}. Less = deposit.
                          </div>
                        </div>
                        <div>
                          <FieldLabel>Method</FieldLabel>
                          <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                            className="w-full bg-white border border-[#E5E5E5] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#006AFF]">
                            <option value="cash">💵 Cash</option>
                            <option value="check">🏦 Check</option>
                            <option value="ach">🔄 ACH</option>
                            <option value="card">💳 Card</option>
                            <option value="bank_transfer">🏦 Bank Transfer</option>
                            <option value="other">📋 Other</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                          <FieldLabel>Reference / check #</FieldLabel>
                          <input value={payReference} onChange={e => setPayReference(e.target.value)}
                            placeholder="Optional"
                            className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#006AFF]"/>
                        </div>
                        <div>
                          <FieldLabel>Payment date</FieldLabel>
                          <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                            className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#006AFF]"/>
                        </div>
                      </div>
                      {/* Live preview — total / deposit / balance */}
                      <div className="mt-3 rounded-lg p-3 text-[12px] font-mono"
                        style={{background:'#FFFFFF', border:`1px solid ${isFull ? '#86EFAC' : '#FCD34D'}`}}>
                        <div className="flex justify-between text-[#666]">
                          <span>Total Due:</span>
                          <span>${totals.total.toFixed(2)}</span>
                        </div>
                        {enteredAmt > 0 && (
                          <div className="flex justify-between mt-1"
                            style={{color: isFull ? '#15803D' : '#B45309'}}>
                            <span>{isFull ? 'Paid in Full:' : 'Deposit:'}</span>
                            <span>−${Math.min(enteredAmt, totals.total).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between mt-1 pt-1 border-t border-[#E5E5E5] font-bold"
                          style={{color: balance <= 0.005 ? '#15803D' : '#CF1322'}}>
                          <span>Balance Due:</span>
                          <span>{balance <= 0.005 ? '✓ PAID' : `$${balance.toFixed(2)}`}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Footer */}
          <div className="px-5 py-4 flex gap-2 flex-shrink-0" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onClose}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              {isLocked ? 'Close' : 'Cancel'}
            </button>
            {/* Hide Save button entirely when invoice is locked. The user can
                still view all fields but cannot submit changes. */}
            {!isLocked && (
              <button onClick={create} disabled={saving || !customerId || items.length === 0}
                className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
                style={(() => {
                  // Edit mode: simple blue Save (no Pay Now logic here)
                  if (isEdit) {
                    return { background: '#006AFF', color: '#FFFFFF', border: 'none' }
                  }
                  const enteredAmt = parseFloat(payAmount) || 0
                  const isFull = payNow && enteredAmt >= totals.total - 0.005
                  const isPartial = payNow && enteredAmt > 0 && enteredAmt < totals.total
                  return {
                    background: isFull ? '#15803D' : isPartial ? '#B45309' : '#006AFF',
                    color: '#FFFFFF',
                    border: 'none',
                  }
                })()}>
                {(() => {
                  if (saving) return isEdit ? 'Saving...' : (payNow ? 'Processing...' : 'Creating...')
                  if (isEdit) return `💾 Save Changes · $${totals.total.toFixed(2)}`
                  const enteredAmt = parseFloat(payAmount) || 0
                  const isFull = payNow && enteredAmt >= totals.total - 0.005
                  const isPartial = payNow && enteredAmt > 0 && enteredAmt < totals.total
                  if (isFull)    return `💰 Create + Pay in Full · $${totals.total.toFixed(2)}`
                  if (isPartial) return `💰 Create + Deposit · $${enteredAmt.toFixed(2)}`
                  return `Create Invoice · $${totals.total.toFixed(2)}`
                })()}
              </button>
            )}
          </div>
        </div>
      </div>

      {showProductPicker && (
        <EstimateProductPicker
          title="Add Product to Invoice"
          excludeIds={items.map(i => i.product_id)}
          onPick={addProduct}
          onClose={() => setShowProductPicker(false)}
        />
      )}
    </>
  )
}

// ────────────────────────────────────────────────────────────────────
// Ship-To selector subcomponent (exported, reused by CreateEstimateModal)
// ────────────────────────────────────────────────────────────────────
export function ShipToSection({
  selectedCustomer, savedAddrs,
  shipMode, setShipMode,
  savedShipId, setSavedShipId,
  customShip, setCS,
  deliveryNotes, setDeliveryNotes,
}) {
  const hasSaved = savedAddrs.length > 0
  const billingPreview = selectedCustomer
    ? [selectedCustomer.billing_address,
       [selectedCustomer.billing_city, selectedCustomer.billing_state, selectedCustomer.billing_zip]
         .filter(Boolean).join(', ')]
        .filter(Boolean).join(' · ')
    : ''
  const picked = savedAddrs.find(a => a.id === savedShipId)

  const optBtn = (mode, label, sublabel) => {
    const active = shipMode === mode
    return (
      <button onClick={() => setShipMode(mode)}
        className="flex-1 rounded-lg px-3 py-2 text-left cursor-pointer active:scale-[0.98]"
        style={active
          ? { background:'#E6F0FF', border:'1.5px solid #006AFF' }
          : { background:'#FFFFFF', border:'1px solid #E5E5E5' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
            style={{ border: `2px solid ${active ? '#006AFF' : '#CCCCCC'}` }}>
            {active && <div className="w-1.5 h-1.5 rounded-full" style={{background:'#006AFF'}}/>}
          </div>
          <span className="text-[12px] font-bold text-[#1F1F1F]">{label}</span>
        </div>
        {sublabel && <div className="text-[10px] text-[#666] mt-0.5 pl-5 truncate">{sublabel}</div>}
      </button>
    )
  }

  return (
    <div className="rounded-xl p-4" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[11px] font-bold text-[#1F1F1F] uppercase tracking-wider">🚚 Ship To</div>
        <div className="text-[10px] text-[#666]">
          {hasSaved ? `${savedAddrs.length} saved address${savedAddrs.length>1?'es':''}` : 'No saved delivery addresses yet'}
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        {optBtn('billing', 'Same as billing', billingPreview || '—')}
        {hasSaved && optBtn('saved', 'Saved delivery', `Pick from ${savedAddrs.length}`)}
        {optBtn('custom', 'One-time custom', 'Different address this time')}
      </div>

      {shipMode === 'saved' && hasSaved && (
        <div>
          <select value={savedShipId} onChange={e => setSavedShipId(e.target.value)}
            className="w-full bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] outline-none cursor-pointer mb-2"
            style={{borderColor: savedShipId ? '#006AFF' : '#E5E5E5'}}>
            <option value="">— Pick an address —</option>
            {savedAddrs.map(a => {
              const cityLine = [a.city, a.state, a.zip].filter(Boolean).join(', ')
              const prefix = a.is_default ? '⭐ ' : (a.type === 'delivery' ? '🚚 ' : '📦 ')
              const lbl = a.label ? `${a.label} — ` : ''
              return <option key={a.id} value={a.id}>{prefix}{lbl}{a.address}{cityLine ? `, ${cityLine}` : ''}</option>
            })}
          </select>
          {picked && (
            <div className="rounded-lg px-3 py-2 text-[11px] text-[#1F1F1F]"
              style={{background:'#FFFFFF', border:'1px solid #E5E5E5'}}>
              <div className="font-bold">{picked.label || (picked.type === 'delivery' ? 'Delivery address' : 'Shipping address')}</div>
              <div>{picked.address}</div>
              <div>{[picked.city, picked.state, picked.zip].filter(Boolean).join(', ')}</div>
              {(picked.contact_name || picked.contact_phone) && (
                <div className="text-[#666] mt-0.5">
                  {picked.contact_name && <span>👤 {picked.contact_name}</span>}
                  {picked.contact_name && picked.contact_phone && <span> · </span>}
                  {picked.contact_phone && <span>📞 {picked.contact_phone}</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {shipMode === 'custom' && (
        <div className="space-y-2.5">
          <DualInput label="Address label (optional)" value={customShip.label} onChange={v => setCS('label', v)}
            placeholder="e.g. Job site, customer's warehouse" kbTitle="Label"/>
          <DualInput label="Street address *" value={customShip.address} onChange={v => setCS('address', v)}
            placeholder="123 Main St" kbTitle="Street"/>
          <div className="grid grid-cols-3 gap-2">
            <DualInput label="City" value={customShip.city} onChange={v => setCS('city', v)}
              placeholder="Brooklyn" kbTitle="City"/>
            <DualInput label="State" value={customShip.state} onChange={v => setCS('state', v)}
              placeholder="NY" kbTitle="State"/>
            <DualInput label="ZIP" mode="numeric" value={customShip.zip} onChange={v => setCS('zip', v)}
              placeholder="11209" kbTitle="ZIP"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <DualInput label="Contact at site" value={customShip.contact_name} onChange={v => setCS('contact_name', v)}
              placeholder="Receiving dock" kbTitle="Contact"/>
            <DualInput label="Phone" mode="phone" value={customShip.contact_phone} onChange={v => setCS('contact_phone', v)}
              placeholder="(555) 999-8888" kbTitle="Phone"/>
          </div>
          <div className="text-[10px] text-[#666] flex items-start gap-1">
            <span>💡</span>
            <span>This address is for this document only — it won't be saved to the company profile.</span>
          </div>
        </div>
      )}

      {/* Delivery notes — always shown */}
      <div className="mt-3 pt-3" style={{borderTop:'1px solid #E5E5E5'}}>
        <DualInput label="Delivery instructions (printed on packing slip)" multiline
          value={deliveryNotes} onChange={setDeliveryNotes}
          placeholder="e.g. Loading dock B, ring buzzer #2, deliver between 9am-2pm..."
          kbTitle="Delivery Notes"/>
      </div>
    </div>
  )
}

function FieldLabel({ children }) {
  return <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">{children}</div>
}
