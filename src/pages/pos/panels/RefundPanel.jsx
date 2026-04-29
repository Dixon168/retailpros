// src/pages/pos/panels/RefundPanel.jsx
// 退款面板 — 三种模式 + PIN授权

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useCartStore } from '@/stores/cartStore'
import { cpRefund, cpVoid } from '@/lib/cardpointe'
import { Overlay } from './SerialPanel'
import toast from 'react-hot-toast'

export default function RefundPanel({ onClose, preloadOrder = null }) {
  const { user, tenant, can } = useAuthStore()
  const [mode, setMode]         = useState(preloadOrder ? 'by_order' : null)
  const [step, setStep]         = useState('select') // select|items|pin|processing|done
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState(false)
  const [authUser, setAuthUser] = useState(null)

  // Free mode
  const [freeAmount, setFreeAmount] = useState('')
  const [freeReason, setFreeReason] = useState('')

  // Scan mode
  const [scannedItems, setScannedItems] = useState([])
  const [scanInput, setScanInput]       = useState('')

  // By order mode
  const [orderSearch,  setOrderSearch]  = useState('')
  const [selectedOrder, setSelectedOrder] = useState(preloadOrder)
  const [selectedItems, setSelectedItems] = useState({}) // { itemId: qty }

  const needsAuth = !can('can_refund')

  // ── Search orders (mode 3) ──
  const { data: orderResults = [] } = useQuery({
    queryKey: ['refund-order-search', orderSearch],
    queryFn: async () => {
      if (orderSearch.length < 3) return []
      const { data } = await supabase.from('orders')
        .select('*, order_items(*), card_transactions(*)')
        .eq('tenant_id', tenant.id)
        .ilike('order_number', `%${orderSearch}%`)
        .limit(10)
      return data || []
    },
    enabled: orderSearch.length >= 3,
  })

  // ── PIN verification ──
  const verifyPin = async () => {
    if (pinInput.length < 4) return
    setPinError(false)

    const { data: user_match } = await supabase
      .from('users')
      .select('id, name, permissions, role')
      .eq('tenant_id', tenant.id)
      .eq('pin', pinInput)
      .eq('is_active', true)
      .maybeSingle()

    if (!user_match) {
      setPinError(true)
      setPinInput('')
      return
    }

    // Check this user has refund permission
    const hasRefund = user_match.role === 'owner' || user_match.role === 'manager'
      || user_match.permissions?.can_refund === true

    if (!hasRefund) {
      setPinError(true)
      setPinInput('')
      toast.error(`${user_match.name} does not have refund permission`)
      return
    }

    setAuthUser(user_match)
    setStep('processing')
    await processRefund(user_match)
  }

  const handleContinue = async () => {
    if (needsAuth) {
      setStep('pin')
    } else {
      setStep('processing')
      await processRefund(user)
    }
  }

  // ── Process refund ──
  const processRefund = async (authorizedUser) => {
    try {
      let refundAmount = 0
      let items = []

      if (mode === 'free') {
        refundAmount = parseFloat(freeAmount)
        if (!refundAmount || refundAmount <= 0) {
          toast.error('Enter a valid amount')
          setStep('select')
          return
        }
      } else if (mode === 'scan') {
        items        = scannedItems
        refundAmount = items.reduce((s, i) => s + i.amount, 0)
      } else if (mode === 'by_order') {
        items = selectedOrder.order_items
          .filter(i => (selectedItems[i.id] || 0) > 0)
          .map(i => ({
            product_id:   i.product_id,
            product_name: i.product_name,
            qty:          selectedItems[i.id],
            unit_price:   i.unit_price,
            amount:       selectedItems[i.id] * i.unit_price,
          }))
        refundAmount = items.reduce((s, i) => s + i.amount, 0)
        if (refundAmount <= 0) {
          toast.error('Select items to refund')
          setStep('items')
          return
        }
      }

      // Find the card transaction to refund
      const cardTx = selectedOrder?.card_transactions?.find(
        t => t.status === 'settled' && t.amount >= refundAmount
      ) || selectedOrder?.card_transactions?.find(
        t => t.status === 'authorized' && t.amount >= refundAmount
      )

      if (!cardTx) {
        toast.error('No eligible card transaction found for this refund')
        setStep('items')
        return
      }

      let cpResult
      if (cardTx.status === 'authorized') {
        // Not yet settled → Void
        cpResult = await cpVoid({ tenantId: tenant.id, retref: cardTx.cp_retref, amount: refundAmount })
      } else {
        // Settled → Refund
        cpResult = await cpRefund({ tenantId: tenant.id, retref: cardTx.cp_retref, amount: refundAmount })
      }

      if (!cpResult.success) {
        toast.error(`Refund declined: ${cpResult.errorMessage}`)
        setStep('items')
        return
      }

      // Record refund
      await supabase.from('refund_records').insert({
        tenant_id:          tenant.id,
        original_order_id:  selectedOrder?.id || null,
        original_order_number: selectedOrder?.order_number || null,
        card_tx_id:         cardTx.id,
        original_card_tx_id: cardTx.id,
        mode,
        amount:             refundAmount,
        reason:             freeReason || null,
        items:              items,
        refunded_by:        user.id,
        refunded_by_name:   user.name,
        authorized_by:      authorizedUser?.id || null,
        authorized_by_name: authorizedUser?.name || null,
        cp_retref:          cpResult.retref,
        cp_authcode:        cpResult.authcode,
      })

      // Update card transaction
      await supabase.from('card_transactions')
        .update({
          status:          cardTx.status === 'authorized' ? 'voided' : 'refunded',
          refunded_amount: refundAmount,
          voided_by:       user.id,
          voided_by_name:  user.name,
          voided_at:       new Date().toISOString(),
        })
        .eq('id', cardTx.id)

      setStep('done')
      toast.success(`Refund processed: $${refundAmount.toFixed(2)}`)

      // Print refund receipt
      setTimeout(() => { window.print() }, 500)

    } catch (err) {
      toast.error(`Refund error: ${err.message}`)
      setStep('items')
    }
  }

  const MODES = [
    { id: 'free',     icon: '💵', label: 'Free Amount', desc: 'Enter any amount to refund' },
    { id: 'scan',     icon: '📷', label: 'Scan Items',  desc: 'Scan products to return' },
    { id: 'by_order', icon: '🧾', label: 'By Order',    desc: 'Select from original order' },
  ]

  return (
    <Overlay onClose={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[520px]
        max-h-[90vh] overflow-y-auto">

        <div className="px-5 py-4 border-b border-[#1e2d42] flex justify-between items-center">
          <div className="text-[15px] font-bold">↩️ Refund</div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl">✕</button>
        </div>

        <div className="px-5 py-5">

          {/* ── Step: Select mode ── */}
          {step === 'select' && !mode && (
            <div>
              <div className="text-[11px] font-mono text-[#3d5068] uppercase tracking-wider mb-3">
                Select Refund Type
              </div>
              <div className="flex flex-col gap-2">
                {MODES.map(m => (
                  <button key={m.id} onClick={() => { setMode(m.id); setStep('items') }}
                    className="flex items-center gap-3 bg-[#111827] border border-[#1e2d42]
                      rounded-[10px] px-4 py-3.5 hover:border-blue-500/30 transition-all text-left">
                    <span className="text-2xl">{m.icon}</span>
                    <div>
                      <div className="text-[13px] font-bold">{m.label}</div>
                      <div className="text-[11px] text-[#3d5068] mt-0.5">{m.desc}</div>
                    </div>
                    <span className="ml-auto text-[#3d5068]">›</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Mode 1: Free amount ── */}
          {step === 'items' && mode === 'free' && (
            <div>
              <div className="text-[13px] font-bold mb-4">💵 Free Amount Refund</div>
              <div className="mb-3">
                <div className="text-[10px] font-mono text-[#3d5068] uppercase mb-1.5">Refund Amount</div>
                <div className="flex items-center bg-[#111827] border border-[#1e2d42]
                  rounded-[9px] px-3.5 focus-within:border-red-500/40 transition-colors">
                  <span className="text-[#3d5068] font-bold mr-2">$</span>
                  <input type="number" value={freeAmount}
                    onChange={e => setFreeAmount(e.target.value)}
                    autoFocus
                    className="flex-1 bg-transparent border-none outline-none py-3
                      text-[20px] font-bold font-mono text-right"/>
                </div>
              </div>
              <div className="mb-5">
                <div className="text-[10px] font-mono text-[#3d5068] uppercase mb-1.5">Reason (optional)</div>
                <input value={freeReason} onChange={e => setFreeReason(e.target.value)}
                  placeholder="Reason for refund..."
                  className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
                    px-3.5 py-2.5 text-[12px] outline-none focus:border-blue-500/40"/>
              </div>
              <BtnRow onBack={() => { setMode(null); setStep('select') }} onNext={handleContinue}
                nextLabel={`Refund $${parseFloat(freeAmount||0).toFixed(2)}`}
                nextDisabled={!freeAmount || parseFloat(freeAmount) <= 0}
                danger />
            </div>
          )}

          {/* ── Mode 2: Scan items ── */}
          {step === 'items' && mode === 'scan' && (
            <div>
              <div className="text-[13px] font-bold mb-4">📷 Scan Items to Return</div>
              <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42]
                rounded-[9px] px-3 mb-3 focus-within:border-blue-500/40 transition-colors">
                <span className="text-[#3d5068]">📷</span>
                <input value={scanInput}
                  onChange={e => setScanInput(e.target.value)}
                  placeholder="Scan barcode..."
                  className="bg-transparent border-none outline-none py-2.5 text-[12px]
                    text-[#e8edf5] flex-1 font-mono placeholder-[#3d5068]"
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter' || !scanInput) return
                    const { data: prod } = await supabase.from('products')
                      .select('id, name, price').eq('barcode', scanInput).maybeSingle()
                    if (prod) {
                      setScannedItems(prev => {
                        const ex = prev.find(i => i.product_id === prod.id)
                        if (ex) return prev.map(i => i.product_id === prod.id
                          ? { ...i, qty: i.qty + 1, amount: (i.qty + 1) * i.unit_price }
                          : i)
                        return [...prev, { product_id: prod.id, product_name: prod.name,
                          qty: 1, unit_price: prod.price, amount: prod.price }]
                      })
                    } else {
                      toast.error('Product not found')
                    }
                    setScanInput('')
                  }}
                />
              </div>
              {scannedItems.length > 0 && (
                <div className="mb-4">
                  {scannedItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-3 bg-[#111827]
                      border border-[#1e2d42] rounded-[8px] px-3 py-2.5 mb-1.5">
                      <div className="flex-1">
                        <div className="text-[12px] font-semibold">{item.product_name}</div>
                        <div className="text-[10px] font-mono text-[#3d5068]">
                          ${item.unit_price.toFixed(2)} each
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setScannedItems(p =>
                          p.map(s => s.product_id === item.product_id
                            ? { ...s, qty: Math.max(1, s.qty - 1), amount: Math.max(1, s.qty - 1) * s.unit_price }
                            : s))}
                          className="w-6 h-6 bg-[#1a2236] rounded text-[#8899b0]">−</button>
                        <span className="font-mono text-[12px] w-6 text-center">{item.qty}</span>
                        <button onClick={() => setScannedItems(p =>
                          p.map(s => s.product_id === item.product_id
                            ? { ...s, qty: s.qty + 1, amount: (s.qty + 1) * s.unit_price }
                            : s))}
                          className="w-6 h-6 bg-[#1a2236] rounded text-[#8899b0]">+</button>
                        <span className="font-mono text-[12px] font-bold w-16 text-right">
                          -${item.amount.toFixed(2)}
                        </span>
                        <button onClick={() => setScannedItems(p => p.filter(s => s.product_id !== item.product_id))}
                          className="text-[#3d5068] hover:text-red-400 ml-1">✕</button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between mt-3 px-1">
                    <span className="text-[12px] text-[#8899b0]">Total Refund</span>
                    <span className="font-mono text-[14px] font-bold text-red-400">
                      -${scannedItems.reduce((s,i) => s + i.amount, 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
              <BtnRow onBack={() => { setMode(null); setStep('select') }} onNext={handleContinue}
                nextLabel="Process Refund" nextDisabled={scannedItems.length === 0} danger />
            </div>
          )}

          {/* ── Mode 3: By order ── */}
          {step === 'items' && mode === 'by_order' && (
            <div>
              <div className="text-[13px] font-bold mb-4">🧾 Refund by Order</div>

              {!selectedOrder ? (
                <>
                  <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42]
                    rounded-[9px] px-3 mb-3 focus-within:border-blue-500/40 transition-colors">
                    <span className="text-[#3d5068]">🔍</span>
                    <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)}
                      placeholder="Search order number..."
                      className="bg-transparent border-none outline-none py-2.5 text-[12px]
                        text-[#e8edf5] flex-1 font-sans placeholder-[#3d5068]" autoFocus/>
                  </div>
                  {orderResults.map(o => (
                    <div key={o.id} onClick={() => setSelectedOrder(o)}
                      className="flex items-center gap-3 bg-[#111827] border border-[#1e2d42]
                        rounded-[9px] px-3.5 py-3 mb-1.5 cursor-pointer hover:border-blue-500/30">
                      <div className="flex-1">
                        <div className="font-mono text-[12px] font-bold text-blue-400">{o.order_number}</div>
                        <div className="text-[10px] text-[#3d5068] mt-0.5">
                          {o.order_items?.length} items · ${o.total?.toFixed(2)}
                        </div>
                      </div>
                      <span className="text-[#3d5068]">›</span>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px]
                    px-3.5 py-2.5 mb-3 flex justify-between items-center">
                    <div>
                      <div className="font-mono text-[12px] font-bold text-blue-400">
                        {selectedOrder.order_number}
                      </div>
                      <div className="text-[10px] text-[#3d5068]">Total: ${selectedOrder.total?.toFixed(2)}</div>
                    </div>
                    <button onClick={() => setSelectedOrder(null)}
                      className="text-[10px] text-[#8899b0] hover:text-white">Change</button>
                  </div>

                  <div className="text-[10px] font-mono text-[#3d5068] uppercase mb-2">
                    Select items to refund
                  </div>
                  {selectedOrder.order_items?.map(item => {
                    const max = item.quantity
                    const selected_qty = selectedItems[item.id] || 0
                    return (
                      <div key={item.id} className="flex items-center gap-3 bg-[#111827]
                        border border-[#1e2d42] rounded-[8px] px-3 py-2.5 mb-1.5">
                        <div className="flex-1">
                          <div className="text-[12px] font-semibold">{item.product_name}</div>
                          <div className="text-[10px] font-mono text-[#3d5068]">
                            Max: {max} × ${item.unit_price?.toFixed(2)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setSelectedItems(p => ({ ...p, [item.id]: Math.max(0, (p[item.id]||0) - 1) }))}
                            className="w-6 h-6 bg-[#1a2236] rounded text-[#8899b0]">−</button>
                          <span className="font-mono text-[12px] w-6 text-center">{selected_qty}</span>
                          <button onClick={() => setSelectedItems(p => ({ ...p, [item.id]: Math.min(max, (p[item.id]||0) + 1) }))}
                            className="w-6 h-6 bg-[#1a2236] rounded text-[#8899b0]">+</button>
                          <span className="font-mono text-[11px] text-red-400 w-14 text-right">
                            {selected_qty > 0 ? `-$${(selected_qty * item.unit_price).toFixed(2)}` : ''}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  {Object.values(selectedItems).some(q => q > 0) && (
                    <div className="flex justify-between mt-3 px-1">
                      <span className="text-[12px] text-[#8899b0]">Total Refund</span>
                      <span className="font-mono text-[14px] font-bold text-red-400">
                        -${selectedOrder.order_items
                          ?.reduce((s,i) => s + (selectedItems[i.id]||0) * i.unit_price, 0)
                          .toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="mt-4">
                    <BtnRow onBack={() => { setMode(null); setStep('select') }} onNext={handleContinue}
                      nextLabel="Process Refund"
                      nextDisabled={!Object.values(selectedItems).some(q => q > 0)}
                      danger />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step: PIN authorization ── */}
          {step === 'pin' && (
            <div className="text-center">
              <div className="text-2xl mb-3">🔐</div>
              <div className="text-[14px] font-bold mb-1">Authorization Required</div>
              <div className="text-[12px] text-[#8899b0] mb-5">
                Enter PIN of a user with refund permission
              </div>
              <div className="grid grid-cols-3 gap-2 max-w-[200px] mx-auto mb-3">
                {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k, i) => (
                  <button key={i}
                    onClick={() => {
                      if (k === '⌫') setPinInput(p => p.slice(0,-1))
                      else if (k !== '') setPinInput(p => p.length < 6 ? p + k : p)
                    }}
                    className={`py-3 rounded-lg font-mono text-[16px] font-bold transition-all
                      ${k === '' ? 'invisible' : 'bg-[#111827] border border-[#1e2d42] text-[#e8edf5] hover:bg-[#1a2236]'}`}>
                    {k}
                  </button>
                ))}
              </div>
              <div className="font-mono text-[20px] tracking-widest mb-4 h-8">
                {'●'.repeat(pinInput.length)}
              </div>
              {pinError && (
                <div className="text-[11px] text-red-400 mb-3">
                  Invalid PIN or insufficient permissions
                </div>
              )}
              <div className="flex gap-2 max-w-[300px] mx-auto">
                <button onClick={() => setStep('items')}
                  className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-2.5 text-[12px] text-[#8899b0]">
                  Cancel
                </button>
                <button onClick={verifyPin} disabled={pinInput.length < 4}
                  className="flex-[2] bg-red-500 border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white disabled:opacity-40">
                  Authorize
                </button>
              </div>
            </div>
          )}

          {/* ── Step: Processing ── */}
          {step === 'processing' && (
            <div className="text-center py-8">
              <div className="text-3xl mb-3 animate-pulse">⚙️</div>
              <div className="text-[14px] font-bold">Processing Refund...</div>
            </div>
          )}

          {/* ── Step: Done ── */}
          {step === 'done' && (
            <div className="text-center py-6">
              <div className="text-4xl mb-3">✅</div>
              <div className="text-[15px] font-bold mb-2">Refund Complete</div>
              <div className="text-[12px] text-[#8899b0] mb-5">
                Receipt is printing...
              </div>
              <button onClick={onClose}
                className="bg-blue-500 border-none rounded-[9px] px-8 py-2.5 text-[13px] font-bold text-white">
                Done
              </button>
            </div>
          )}

        </div>
      </div>
    </Overlay>
  )
}

function BtnRow({ onBack, onNext, nextLabel, nextDisabled, danger }) {
  return (
    <div className="flex gap-2 mt-2">
      <button onClick={onBack}
        className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-2.5 text-[13px] text-[#8899b0]">
        ← Back
      </button>
      <button onClick={onNext} disabled={nextDisabled}
        className={`flex-[2] border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white
          disabled:opacity-40 disabled:cursor-not-allowed ${
          danger ? 'bg-gradient-to-r from-red-500 to-red-600' : 'bg-blue-500'
        }`}>
        {nextLabel}
      </button>
    </div>
  )
}
