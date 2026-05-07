// src/pages/pos/panels/PaymentPanel.jsx
// 支付面板 - 支持多种支付方式混合支付 + PAX 真实刷卡

import NumPad from '@/components/ui/NumPad'
import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
import { Overlay } from './SerialPanel'
import { TERMINAL_ID } from '@/hooks/useLock'
import { paxSale, paxCancel, dollarsToCents } from '@/lib/pax'
import toast from 'react-hot-toast'

// PAX 刷卡状态
const PAX_STATE = {
  idle:        { icon: null,  label: null },
  waiting:     { icon: '📲', label: 'Waiting for card...' },
  processing:  { icon: '⚙️', label: 'Processing payment...' },
  approved:    { icon: '✅', label: 'Card approved!' },
  declined:    { icon: '❌', label: 'Card declined' },
  cancelled:   { icon: '↩️', label: 'Cancelled' },
  error:       { icon: '⚠️', label: 'Communication error' },
}

export default function PaymentPanel() {
  const { totals, payments, addPayment, removePayment, paidAmount, submitOrder } = useCartStore()
  const { user, tenant, store } = useAuthStore()
  const { terminal, paxOnline } = useTerminalStore()
  const { grandTotal } = totals()

  const [selectedMethod, setSelectedMethod] = useState('cash')
  const [amountInput,  setAmountInput]      = useState(grandTotal.toFixed(2))
  const [showAmtPad,   setShowAmtPad]     = useState(false)
  const [showAdjust,   setShowAdjust]    = useState(false)
  const [adjType,      setAdjType]       = useState('disc_pct') // disc_pct|disc_amt|tip|tax_exempt
  const [adjValue,     setAdjValue]      = useState('')
  const [taxExempt,    setTaxExempt]     = useState(false)
  const [showAdjPad,   setShowAdjPad]    = useState(false)
  const [processing, setProcessing]         = useState(false)
  const [paxState, setPaxState]             = useState('idle')
  const [paxResult, setPaxResult]           = useState(null) // approved card result

  const close = () => useCartStore.setState({ showPayPanel: false })

  const paid      = paidAmount()
  const remaining = Math.max(0, grandTotal - paid)
  const change    = paid > grandTotal ? paid - grandTotal : 0

  const quickAmounts = [
    Math.ceil(remaining / 5) * 5,
    Math.ceil(remaining / 10) * 10,
    Math.ceil(remaining / 20) * 20,
  ].filter((v, i, arr) => arr.indexOf(v) === i && v >= remaining)

  // ── 点击 Card 支付：触发 PAX ──
  const handleCardMethod = async () => {
    if (!terminal?.pax_enabled || !terminal?.pax_ip) {
      // PAX 未配置 → 普通手动记录
      setSelectedMethod('card')
      return
    }

    const amount = parseFloat(amountInput) || remaining
    if (amount <= 0) { toast.error('Enter amount first'); return }

    setPaxState('waiting')
    setPaxResult(null)

    // 生成订单号（临时，用于 PAX 屏幕显示）
    const orderRef = `POS-${Date.now().toString(36).toUpperCase()}`

    try {
      const result = await paxSale({
        paxIp:       terminal.pax_ip,
        paxPort:     terminal.pax_port || 10009,
        amountCents: dollarsToCents(amount),
        invoiceNum:  orderRef,
      })

      if (result.success) {
        setPaxState('approved')
        setPaxResult(result)
        // 自动添加到支付列表
        addPayment({
          method:       'card',
          amount,
          reference:    result.approvalCode,
          cardType:     result.cardType,
          maskedPan:    result.maskedPan,
          entryMode:    result.entryMode,
          paxTraceNum:  result.traceNum,
          paxRefNum:    result.refNum,
        })
        const newRemaining = Math.max(0, remaining - amount)
        setAmountInput(newRemaining > 0 ? newRemaining.toFixed(2) : '')
        setTimeout(() => setPaxState('idle'), 2000)
      } else if (result.status === 'cancelled') {
        setPaxState('cancelled')
        toast('Payment cancelled on card reader', { icon: '↩️' })
        setTimeout(() => setPaxState('idle'), 2000)
      } else {
        setPaxState('declined')
        toast.error(`Card ${result.status.replace('declined_', '').replace(/_/g, ' ')}`)
        setTimeout(() => setPaxState('idle'), 3000)
      }
    } catch (err) {
      setPaxState('error')
      toast.error(`PAX error: ${err.message}`)
      setTimeout(() => setPaxState('idle'), 3000)
    }
  }

  // ── 取消 PAX 刷卡（用户在收银机上取消）──
  const handleCancelPax = async () => {
    if (!terminal?.pax_ip) return
    await paxCancel({ paxIp: terminal.pax_ip, paxPort: terminal.pax_port })
    setPaxState('idle')
  }

  const handleAddPayment = () => {
    const amount = parseFloat(amountInput)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }

    // Card 方法走 PAX 流程
    if (selectedMethod === 'card') { handleCardMethod(); return }

    addPayment({ method: selectedMethod, amount })
    const newRemaining = Math.max(0, remaining - amount)
    setAmountInput(newRemaining > 0 ? newRemaining.toFixed(2) : '')
  }

  const applyAdjustment = () => {
    const val = parseFloat(adjValue) || 0
    const { setOrderDiscount } = useCartStore.getState()
    if (adjType === 'disc_pct') {
      if (val <= 0 || val > 100) { toast.error('Enter 0-100%'); return }
      setOrderDiscount({ type: 'pct', value: val })
      toast.success(`✓ ${val}% discount applied`)
    } else if (adjType === 'disc_amt') {
      if (val <= 0) { toast.error('Enter amount'); return }
      setOrderDiscount({ type: 'amt', value: val })
      toast.success(`✓ $${val.toFixed(2)} discount applied`)
    } else if (adjType === 'tip') {
      if (val < 0) { toast.error('Invalid tip'); return }
      useCartStore.setState({ tipAmount: val })
      toast.success(`✓ Tip $${val.toFixed(2)} added`)
    } else if (adjType === 'tax_exempt') {
      setTaxExempt(true)
      useCartStore.setState({ taxExempt: true })
      toast.success('✓ Tax exempt applied')
    }
    setAdjValue('')
    setShowAdjust(false)
  }

  const removeAdjustment = (type) => {
    if (type === 'discount') {
      useCartStore.getState().setOrderDiscount(null)
      toast.success('Discount removed')
    } else if (type === 'tip') {
      useCartStore.setState({ tipAmount: 0 })
      toast.success('Tip removed')
    } else if (type === 'tax_exempt') {
      setTaxExempt(false)
      useCartStore.setState({ taxExempt: false })
      toast.success('Tax exempt removed')
    }
  }

  const handleComplete = async () => {
    if (paid < grandTotal) {
      const hasAccount = payments.some(p => p.method === 'on_account')
      if (!hasAccount) { toast.error('Amount paid is less than total'); return }
    }
    setProcessing(true)
    try {
      await submitOrder(store.id, user.id, tenant.id, TERMINAL_ID)
      close()
    } catch {
      toast.error('Failed to complete order')
    } finally {
      setProcessing(false)
    }
  }

  // 只显示该终端启用的支付方式
  const ALL_METHODS = [
    { id: 'cash',          icon: '💵', label: 'Cash',        enabled: terminal?.accept_cash         !== false },
    { id: 'card',          icon: '💳', label: terminal?.pax_enabled ? `Card (PAX ${terminal?.pax_model||''})` : 'Card', enabled: terminal?.accept_card !== false },
    { id: 'check',         icon: '📝', label: 'Check',       enabled: terminal?.accept_check        !== false },
    { id: 'bank_transfer', icon: '🏦', label: 'Transfer',    enabled: true },
    { id: 'member_card',   icon: '🏷️', label: 'Member Card', enabled: terminal?.accept_member_card  !== false },
    { id: 'on_account',    icon: '📋', label: 'On Account',  enabled: terminal?.accept_on_account   !== false },
  ].filter(m => m.enabled)

  return (
    <Overlay onClose={paxState !== 'idle' ? undefined : close}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[480px]
        max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1e2d42] flex justify-between items-start">
          <div>
            <div className="text-[16px] font-bold">💳 Payment</div>
            <div className="text-[24px] font-bold text-blue-400 font-mono mt-1">
              ${grandTotal.toFixed(2)}
            </div>
          </div>
          {/* Terminal + PAX status */}
          <div className="text-right">
            <div className="text-[10px] font-mono text-[#3d5068]">{terminal?.name || 'Terminal'}</div>
            {terminal?.pax_enabled && (
              <div className={`text-[9px] font-mono mt-1 px-2 py-0.5 rounded inline-block ${
                paxOnline
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-red-500/10 text-red-400'
              }`}>
                PAX {paxOnline ? 'ONLINE' : 'OFFLINE'}
              </div>
            )}
          </div>
        </div>

        {/* ── Invoice Adjustments ── */}
        {(() => {
          const { orderDiscount, tipAmount, taxExempt: cartTaxExempt } = useCartStore.getState()
          const hasAdj = orderDiscount || tipAmount > 0 || cartTaxExempt
          return (
            <div className="px-5 pt-3">
              {/* Applied adjustments */}
              {hasAdj && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {orderDiscount && (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                      style={{background:'#dcfce7', color:'#16a34a'}}>
                      ✂️ {orderDiscount.type==='pct' ? `${orderDiscount.value}% off` : `-$${orderDiscount.value}`}
                      <button onClick={() => removeAdjustment('discount')}
                        className="ml-1 bg-transparent border-none cursor-pointer text-[12px] text-green-600">✕</button>
                    </div>
                  )}
                  {tipAmount > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                      style={{background:'#fef9c3', color:'#ca8a04'}}>
                      🙏 Tip ${tipAmount.toFixed(2)}
                      <button onClick={() => removeAdjustment('tip')}
                        className="ml-1 bg-transparent border-none cursor-pointer text-[12px]">✕</button>
                    </div>
                  )}
                  {cartTaxExempt && (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                      style={{background:'#eff6ff', color:'#2563eb'}}>
                      🏛️ Tax Exempt
                      <button onClick={() => removeAdjustment('tax_exempt')}
                        className="ml-1 bg-transparent border-none cursor-pointer text-[12px]">✕</button>
                    </div>
                  )}
                </div>
              )}
              {/* Toggle button */}
              <button onClick={() => setShowAdjust(a => !a)}
                className="w-full rounded-xl py-2 text-[11px] font-semibold cursor-pointer border transition-all mb-3"
                style={{background: showAdjust?'#f0f4ff':'#f8fafc', borderColor: showAdjust?'#a5b4fc':'#1e2d42', color: showAdjust?'#6366f1':'#8899b0'}}>
                {showAdjust ? '▲ Hide' : '▼'} Invoice Adjustments
              </button>
              {/* Adjustment panel */}
              {showAdjust && (
                <div className="rounded-xl p-3 mb-3" style={{background:'#111827', border:'1px solid #1e2d42'}}>
                  {/* Type selector */}
                  <div className="grid grid-cols-2 gap-1.5 mb-3">
                    {[
                      ['disc_pct', '✂️ Discount %'],
                      ['disc_amt', '✂️ Discount $'],
                      ['tip',      '🙏 Add Tip'],
                      ['tax_exempt','🏛️ Tax Exempt'],
                    ].map(([id, label]) => (
                      <button key={id} onClick={() => { setAdjType(id); setAdjValue('') }}
                        className="py-2 rounded-lg text-[11px] font-semibold cursor-pointer border transition-all"
                        style={adjType===id
                          ? {background:'#6366f1', borderColor:'#6366f1', color:'#fff'}
                          : {background:'#0d1117', borderColor:'#1e2d42', color:'#8899b0'}}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* Value input */}
                  {adjType !== 'tax_exempt' ? (
                    <div className="flex gap-2">
                      <button onClick={() => setShowAdjPad(true)}
                        className="flex-1 rounded-xl px-3 py-2.5 text-left cursor-pointer border"
                        style={{background:'#0d1117', borderColor: adjValue?'#6366f1':'#1e2d42'}}>
                        <span className="text-[16px] font-bold font-mono" style={{color: adjValue?'#818cf8':'#3d5068'}}>
                          {adjValue ? (adjType==='disc_pct' ? `${adjValue}%` : `$${adjValue}`) : (adjType==='disc_pct'?'0%':'$0.00')}
                        </span>
                      </button>
                      <button onClick={applyAdjustment} disabled={!adjValue}
                        className="rounded-xl px-4 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                        style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                        Apply
                      </button>
                    </div>
                  ) : (
                    <button onClick={applyAdjustment}
                      className="w-full rounded-xl py-2.5 text-[12px] font-bold text-white cursor-pointer border-none"
                      style={{background:'linear-gradient(135deg,#2563eb,#1d4ed8)'}}>
                      🏛️ Apply Tax Exempt
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* PAX waiting overlay (inside panel) */}
        {paxState !== 'idle' && (
          <div className="mx-5 mt-4 mb-0 bg-[#111827] border border-[#243347]
            rounded-[12px] p-4 text-center">
            <div className="text-3xl mb-2">{PAX_STATE[paxState]?.icon}</div>
            <div className="text-[14px] font-bold mb-1">{PAX_STATE[paxState]?.label}</div>
            {paxState === 'waiting' && (
              <>
                <div className="text-[11px] text-[#8899b0] mb-3">
                  Insert, tap, or swipe card on PAX {terminal?.pax_model}
                  <br/>
                  <span className="font-mono text-[10px] text-[#3d5068]">
                    {terminal?.pax_ip}:{terminal?.pax_port}
                  </span>
                </div>
                <button onClick={handleCancelPax}
                  className="bg-red-500/10 border border-red-500/20 text-red-400
                    rounded-lg px-4 py-2 text-[11px] hover:bg-red-500/15 transition-colors">
                  Cancel Transaction
                </button>
              </>
            )}
            {paxState === 'approved' && paxResult && (
              <div className="text-[11px] text-[#8899b0] mt-1">
                <span className="text-green-400 font-bold">{paxResult.cardType}</span>
                {' '}···· {paxResult.maskedPan?.slice(-4)}
                {' · '}{paxResult.entryMode}
                {' · '}Auth: <span className="font-mono">{paxResult.approvalCode}</span>
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-4">
          {/* Payment method grid */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {ALL_METHODS.map(m => (
              <button
                key={m.id}
                onClick={() => {
                  setSelectedMethod(m.id)
                  if (m.id === 'card' && terminal?.pax_enabled) handleCardMethod()
                }}
                disabled={paxState === 'waiting' || paxState === 'processing'}
                className={`rounded-[9px] py-3 text-center transition-all cursor-pointer
                  border disabled:opacity-40 ${selectedMethod === m.id
                    ? 'border-blue-500/40 bg-blue-500/8'
                    : 'border-[#1e2d42] bg-[#111827] hover:border-[#243347]'
                  }`}
              >
                <div className="text-[18px] mb-1">{m.icon}</div>
                <div className={`text-[9px] leading-tight px-1 ${
                  selectedMethod === m.id ? 'text-blue-400' : 'text-[#8899b0]'
                }`}>{m.label}</div>
              </button>
            ))}
          </div>

          {/* Amount input (hidden when PAX is active) */}
          {selectedMethod !== 'card' || !terminal?.pax_enabled ? (
            <div className="mb-3">
              <div className="text-[11px] font-mono text-[#3d5068] mb-1.5">AMOUNT</div>
              <button onClick={() => setShowAmtPad(true)}
                className="w-full rounded-[9px] px-3.5 py-3 text-right cursor-pointer border transition-all"
                style={{background:'#111827', borderColor: amountInput ? '#3b82f6' : '#1e2d42'}}>
                <span className="text-[22px] font-mono font-bold"
                  style={{color: amountInput ? '#fff' : '#3d5068'}}>
                  ${amountInput || '0.00'}
                </span>
              </button>
              {showAdjPad && (
        <NumPad
          title={adjType==='disc_pct' ? 'Discount %' : adjType==='disc_amt' ? 'Discount $' : 'Tip Amount'}
          prefix={adjType!=='disc_pct' ? '$' : ''}
          suffix={adjType==='disc_pct' ? '%' : ''}
          value={adjValue}
          onChange={setAdjValue}
          allowNegative={false}
          allowDecimal={true}
          onConfirm={v => { setAdjValue(String(v)); setShowAdjPad(false) }}
          onClose={() => setShowAdjPad(false)}/>
      )}

      {showAmtPad && (
                <NumPad title="Payment Amount" prefix="$"
                  value={amountInput} onChange={setAmountInput}
                  allowNegative={false} allowDecimal={true}
                  onConfirm={v=>{setAmountInput(v.toFixed(2));setShowAmtPad(false)}}
                  onClose={()=>setShowAmtPad(false)}/>
              )}
              <div className="flex gap-1.5 mt-2">
                <button onClick={() => setAmountInput(remaining.toFixed(2))}
                  className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-lg
                    py-1.5 text-[11px] font-mono text-[#8899b0]
                    hover:border-blue-500/30 hover:text-blue-400 transition-all">
                  Exact
                </button>
                {quickAmounts.slice(0, 3).map(amt => (
                  <button key={amt} onClick={() => setAmountInput(amt.toFixed(2))}
                    className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-lg
                      py-1.5 text-[11px] font-mono text-[#8899b0]
                      hover:border-blue-500/30 hover:text-blue-400 transition-all">
                    ${amt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-[#3d5068] text-center py-2 mb-3">
              Amount: <span className="font-mono font-bold text-[#e8edf5]">
                ${(parseFloat(amountInput)||remaining).toFixed(2)}
              </span>
              {' · '}Tap "Card (PAX)" button above to charge
            </div>
          )}

          {/* Add payment button (non-PAX) */}
          {remaining > 0 && !(selectedMethod === 'card' && terminal?.pax_enabled) && (
            <button onClick={handleAddPayment}
              className="w-full bg-[#111827] border border-[#243347] rounded-[9px]
                py-2.5 text-[12px] text-blue-400 mb-3 hover:bg-[#1a2236] transition-colors">
              + Add Payment
            </button>
          )}

          {/* Payments list */}
          {payments.length > 0 && (
            <div className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2 mb-3">
              {payments.map((p, i) => (
                <div key={i} className="flex justify-between items-center py-1.5
                  border-b border-[#1e2d42] last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px]">
                      {ALL_METHODS.find(m => m.id === p.method)?.icon || '💳'}
                    </span>
                    <div>
                      <span className="text-[11px] text-[#8899b0]">
                        {ALL_METHODS.find(m => m.id === p.method)?.label || p.method}
                      </span>
                      {/* PAX card details */}
                      {p.cardType && (
                        <div className="text-[9px] font-mono text-[#3d5068]">
                          {p.cardType} ···{p.maskedPan?.slice(-4)} · {p.entryMode} · Auth:{p.reference}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-mono">${p.amount.toFixed(2)}</span>
                    <button onClick={() => removePayment(i)}
                      className="text-[#3d5068] hover:text-red-400 text-[11px]">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Change */}
          {change > 0 && (
            <div className="bg-green-500/8 border border-green-500/20 rounded-[9px]
              px-3.5 py-2.5 flex justify-between mb-3">
              <span className="text-[12px] text-green-400">Change Due</span>
              <span className="text-[16px] font-bold font-mono text-green-400">
                ${change.toFixed(2)}
              </span>
            </div>
          )}

          {/* Remaining */}
          {remaining > 0 && paid > 0 && (
            <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-[9px]
              px-3.5 py-2.5 flex justify-between mb-3">
              <span className="text-[12px] text-yellow-400">Remaining</span>
              <span className="text-[16px] font-bold font-mono text-yellow-400">
                ${remaining.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4">
          <button onClick={close} disabled={paxState === 'waiting'}
            className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px]
              py-3 text-[13px] text-[#8899b0] disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={handleComplete}
            disabled={processing || paxState === 'waiting' ||
              (paid < grandTotal && !payments.some(p => p.method === 'on_account'))}
            className="flex-[2] bg-gradient-to-r from-green-500 to-green-600
              border-none rounded-[9px] py-3 text-[13px] font-bold text-white
              disabled:opacity-40 disabled:cursor-not-allowed
              shadow-[0_4px_15px_rgba(16,185,129,0.25)] transition-all">
            {processing ? '⏳ Processing...' : '✓ Complete Order'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
