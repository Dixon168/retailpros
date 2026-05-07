// src/pages/pos/panels/PaymentPanel.jsx
import { useState, useEffect } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
import NumPad from '@/components/ui/NumPad'
import { Overlay } from './SerialPanel'
import { TERMINAL_ID } from '@/hooks/useLock'
import { paxSale, paxCancel, dollarsToCents } from '@/lib/pax'
import toast from 'react-hot-toast'

const PAX_STATE = {
  idle:       { icon: null,  label: null },
  waiting:    { icon: '📲', label: 'Waiting for card...' },
  processing: { icon: '⚙️', label: 'Processing...' },
  approved:   { icon: '✅', label: 'Card approved!' },
  declined:   { icon: '❌', label: 'Card declined' },
  cancelled:  { icon: '↩️', label: 'Cancelled' },
  error:      { icon: '⚠️', label: 'Error' },
}

// ── Custom NumPad with $ / % toggle ──
function DiscountNumPad({ adjTab, discMode, setDiscMode, value, onChange, onConfirm, onClose }) {
  const [input, setInput] = useState(value || '')

  const isDisc = adjTab === 'disc'
  const title = adjTab==='disc' ? 'Discount' : adjTab==='tip' ? 'Add Tip' : 'Surcharge'
  const icon  = adjTab==='disc' ? '✂️' : adjTab==='tip' ? '🙏' : '💼'

  const press = (k) => {
    if (k === '⌫') { setInput(i => i.slice(0,-1)); return }
    if (k === '.' && input.includes('.')) return
    if (input.length >= 7) return
    setInput(i => i + k)
  }

  const confirm = () => {
    const v = parseFloat(input) || 0
    if (v <= 0) return
    onConfirm(v)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}>
      <div className="rounded-3xl overflow-hidden shadow-2xl"
        style={{width:'340px', background:'#fff'}}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
          <div className="text-[16px] font-bold text-white">{icon} {title}</div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white flex items-center justify-center">✕</button>
        </div>

        {/* $ / % toggle - only for discount */}
        {isDisc && (
          <div className="flex gap-2 px-5 pt-4">
            <button onClick={() => { setDiscMode('pct'); setInput('') }}
              className="flex-1 py-3 rounded-xl text-[15px] font-black cursor-pointer border-2 transition-all"
              style={discMode==='pct'
                ? {background:'#e0e7ff', borderColor:'#6366f1', color:'#6366f1'}
                : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#94a3b8'}}>
              % Percent
            </button>
            <button onClick={() => { setDiscMode('amt'); setInput('') }}
              className="flex-1 py-3 rounded-xl text-[15px] font-black cursor-pointer border-2 transition-all"
              style={discMode==='amt'
                ? {background:'#dcfce7', borderColor:'#16a34a', color:'#16a34a'}
                : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#94a3b8'}}>
              $ Amount
            </button>
          </div>
        )}

        {/* Display */}
        <div className="px-5 py-4 text-center">
          <div className="text-[11px] text-slate-400 mb-1">
            {isDisc ? (discMode==='pct' ? 'Enter discount percentage' : 'Enter discount amount') :
             adjTab==='tip' ? 'Enter tip amount' : 'Enter surcharge amount'}
          </div>
          <div className="rounded-2xl py-4 flex items-center justify-center gap-1"
            style={{background:'#f0f4ff', border:'2px solid #a5b4fc'}}>
            {!isDisc || discMode==='amt' ? (
              <span className="text-[28px] font-black text-indigo-400">$</span>
            ) : null}
            <span className="text-[42px] font-black font-mono" style={{color:'#6366f1'}}>
              {input || '0'}
            </span>
            {isDisc && discMode==='pct' ? (
              <span className="text-[28px] font-black text-indigo-400">%</span>
            ) : null}
          </div>
        </div>

        {/* Keys */}
        <div className="px-4 pb-4 grid grid-cols-3 gap-2">
          {['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k => (
            <button key={k} onClick={() => press(k)}
              className="rounded-xl py-4 text-[20px] font-bold cursor-pointer border transition-all active:scale-95"
              style={k==='⌫'
                ? {background:'#fff1f2', borderColor:'#fecdd3', color:'#ef4444'}
                : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#1e293b', boxShadow:'0 2px 0 #d1d5db'}}>
              {k}
            </button>
          ))}
          <button onClick={confirm} disabled={!input || parseFloat(input)<=0}
            className="col-span-3 rounded-2xl py-4 text-[16px] font-black text-white cursor-pointer border-none disabled:opacity-40 mt-1"
            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow:'0 4px 16px rgba(99,102,241,0.35)'}}>
            ✓ Apply {isDisc && input ? (discMode==='pct'?`${input}% off`:`$${parseFloat(input).toFixed(2)} off`) :
                     input ? `$${parseFloat(input).toFixed(2)}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}


const METHODS = [
  { id:'cash',          icon:'💵', label:'Cash',        color:'#16a34a', bg:'#f0fdf4', border:'#86efac' },
  { id:'card',          icon:'💳', label:'Card',        color:'#2563eb', bg:'#eff6ff', border:'#93c5fd' },
  { id:'member_card',   icon:'🏷️', label:'VIP Card',   color:'#9333ea', bg:'#fdf4ff', border:'#d8b4fe' },
  { id:'gift_card',     icon:'🎁', label:'Gift Card',   color:'#ea580c', bg:'#fff7ed', border:'#fed7aa' },
  { id:'bank_transfer', icon:'🏦', label:'Transfer',    color:'#0891b2', bg:'#f0f9ff', border:'#7dd3fc' },
  { id:'check',         icon:'📝', label:'Check',       color:'#ca8a04', bg:'#fffbeb', border:'#fde047' },
  { id:'on_account',    icon:'📋', label:'On Account',  color:'#64748b', bg:'#f8fafc', border:'#cbd5e1' },
]

export default function PaymentPanel() {
  const { totals, payments, addPayment, removePayment, paidAmount, submitOrder, setOrderDiscount, orderDiscount } = useCartStore()
  const { user, tenant, store } = useAuthStore()
  const { terminal, paxOnline } = useTerminalStore()

  // Live totals
  const { subtotal, taxAmount, orderDiscountAmt, grandTotal } = totals()
  const { items, customer, tipAmount: storeTip } = useCartStore.getState()

  const [tip,        setTip]        = useState(0)
  const [taxExempt,  setTaxExempt]  = useState(false)

  // Adjustment states
  const [adjTab,     setAdjTab]     = useState(null) // null | 'disc' | 'tip' | 'fee'
  const [adjVal,     setAdjVal]     = useState('')
  const [discMode,   setDiscMode]   = useState('pct') // 'pct' | 'amt'
  const [feeLabel,   setFeeLabel]   = useState('Service Fee')
  const [feeAmt,     setFeeAmt]     = useState(0)
  const [showAdjPad, setShowAdjPad] = useState(false)

  // Payment input
  const [selMethod,  setSelMethod]  = useState('cash')
  const [payInput,   setPayInput]   = useState('')
  const [showPayPad, setShowPayPad] = useState(false)

  // PAX
  const [paxState,   setPaxState]   = useState('idle')
  const [paxResult,  setPaxResult]  = useState(null)
  const [processing, setProcessing] = useState(false)

  const paid       = paidAmount()
  const liveTax    = taxExempt ? 0 : taxAmount
  const liveTotal  = subtotal - orderDiscountAmt + liveTax + tip + feeAmt
  const remaining  = Math.max(0, liveTotal - paid)
  const change     = paid > liveTotal ? paid - liveTotal : 0

  useEffect(() => {
    setPayInput(remaining > 0 ? remaining.toFixed(2) : '')
  }, [remaining])

  const close = () => useCartStore.setState({ showPayPanel: false })

  // Apply adjustment
  const applyAdj = () => {
    const v = parseFloat(adjVal) || 0
    if (adjTab === 'disc_pct') {
      setOrderDiscount({ type:'pct', value:v })
      toast.success(`✂️ ${v}% discount applied`)
    } else if (adjTab === 'disc_amt') {
      setOrderDiscount({ type:'amt', value:v })
      toast.success(`✂️ $${v.toFixed(2)} discount applied`)
    } else if (adjTab === 'tip') {
      setTip(v)
      toast.success(`🙏 Tip $${v.toFixed(2)} added`)
    } else if (adjTab === 'fee') {
      setFeeAmt(v)
      toast.success(`💼 Fee $${v.toFixed(2)} added`)
    }
    setAdjVal('')
    setAdjTab(null)
  }

  // Card payment via PAX
  const handleCard = async () => {
    if (!terminal?.pax_enabled || !terminal?.pax_ip) {
      addPayment({ method:'card', amount: parseFloat(payInput)||remaining })
      setPayInput(remaining > parseFloat(payInput||0) ? (remaining - parseFloat(payInput||0)).toFixed(2) : '')
      return
    }
    const amount = parseFloat(payInput) || remaining
    if (amount <= 0) { toast.error('Enter amount first'); return }
    setPaxState('waiting'); setPaxResult(null)
    const orderRef = `POS-${Date.now().toString(36).toUpperCase()}`
    try {
      const result = await paxSale({ paxIp:terminal.pax_ip, paxPort:terminal.pax_port||10009, amountCents:dollarsToCents(amount), invoiceNum:orderRef })
      if (result.success) {
        setPaxState('approved'); setPaxResult(result)
        addPayment({ method:'card', amount, reference:result.approvalCode, cardType:result.cardType, maskedPan:result.maskedPan, paxTraceNum:result.traceNum })
        setTimeout(() => setPaxState('idle'), 2000)
      } else if (result.status === 'cancelled') {
        setPaxState('cancelled'); setTimeout(() => setPaxState('idle'), 2000)
      } else {
        setPaxState('declined'); toast.error('Card declined'); setTimeout(() => setPaxState('idle'), 3000)
      }
    } catch(e) {
      setPaxState('error'); toast.error('PAX error: ' + e.message); setTimeout(() => setPaxState('idle'), 3000)
    }
  }

  const handleAddPayment = () => {
    const amount = parseFloat(payInput) || remaining
    if (amount <= 0) { toast.error('Enter amount'); return }
    if (selMethod === 'card' && terminal?.pax_enabled) { handleCard(); return }
    addPayment({ method:selMethod, amount })
  }

  const handleComplete = async () => {
    if (paid < liveTotal && !payments.some(p => p.method === 'on_account')) {
      toast.error('Amount paid is less than total'); return
    }
    setProcessing(true)
    try {
      await submitOrder(store.id, user.id, tenant.id, TERMINAL_ID)
      close()
    } catch { toast.error('Failed to complete order') }
    finally { setProcessing(false) }
  }

  const enabledMethods = METHODS.filter(m => {
    if (m.id === 'card') return terminal?.accept_card !== false
    if (m.id === 'cash') return terminal?.accept_cash !== false
    if (m.id === 'check') return terminal?.accept_check !== false
    if (m.id === 'on_account') return terminal?.accept_on_account !== false
    return true
  })

  return (
    <Overlay onClose={paxState !== 'idle' ? undefined : close}>
      <div className="rounded-3xl overflow-hidden shadow-2xl flex"
        style={{width:'960px', height:'90vh', background:'#f0f2f5'}}>

        {/* ── LEFT: Order Summary ── */}
        <div className="flex flex-col flex-shrink-0"
          style={{width:'340px', background:'#fff', borderRight:'1px solid #e2e8f0'}}>

          {/* Header */}
          <div className="px-5 py-4 flex-shrink-0"
            style={{background:'linear-gradient(135deg,#1e293b,#334155)'}}>
            <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Order Summary</div>
            {customer ? (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-black text-white flex-shrink-0"
                  style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                  {customer.name.charAt(0)}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-white">{customer.name}</div>
                  {customer.loyalty_points > 0 && (
                    <div className="text-[10px] text-purple-300">💎 {customer.loyalty_points} pts</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-[13px] text-slate-300">Walk-in Customer</div>
            )}
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 py-2.5"
                style={{borderBottom:'1px solid #f1f5f9'}}>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-slate-800 truncate">{item.name}</div>
                  {item.note && <div className="text-[10px] text-indigo-500 truncate">📝 {item.note}</div>}
                  {item.itemDiscount && (
                    <div className="text-[10px] text-green-600">
                      ✂️ {item.itemDiscount.type==='pct' ? `-${item.itemDiscount.value}%` : `-$${item.itemDiscount.value}`}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 font-mono flex-shrink-0">×{item.qty}</div>
                <div className="text-[13px] font-bold font-mono flex-shrink-0"
                  style={{color: item.qty < 0 ? '#ef4444' : '#1e293b'}}>
                  ${Math.abs((() => {
                    const lp = item.itemDiscount
                      ? item.itemDiscount.type==='pct'
                        ? item.unitPrice*(1-item.itemDiscount.value/100)
                        : Math.max(0, item.unitPrice-item.itemDiscount.value)
                      : item.unitPrice
                    return lp * item.qty
                  })()).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          {/* Totals breakdown */}
          <div className="flex-shrink-0 px-4 pb-4">
            <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
              {/* Subtotal - always show */}
              <div className="flex justify-between px-4 py-2.5 text-[12px]" style={{borderBottom:'1px solid #f1f5f9'}}>
                <span className="text-slate-400">Subtotal</span>
                <span className="font-mono font-semibold text-slate-700">${subtotal.toFixed(2)}</span>
              </div>
              {/* Discount */}
              <div className="flex justify-between px-4 py-2.5 text-[12px]"
                style={{borderBottom:'1px solid #f1f5f9', background: orderDiscountAmt>0?'#f0fdf4':'transparent'}}>
                <span style={{color: orderDiscountAmt>0?'#16a34a':'#cbd5e1'}}>
                  ✂️ Discount {orderDiscount?.type==='pct'?`(${orderDiscount.value}%)`:orderDiscount?.type==='amt'?`($${orderDiscount.value})`:''}</span>
                <span className="font-mono font-bold" style={{color: orderDiscountAmt>0?'#16a34a':'#cbd5e1'}}>
                  {orderDiscountAmt>0?`-$${orderDiscountAmt.toFixed(2)}`:'-'}
                </span>
              </div>
              {/* Tax */}
              <div className="flex justify-between px-4 py-2.5 text-[12px]"
                style={{borderBottom:'1px solid #f1f5f9', background: taxExempt?'#eff6ff':'transparent'}}>
                <span style={{color: taxExempt?'#2563eb':'#64748b'}}>
                  {taxExempt?'🏛️ Tax (Exempt)':'Tax'}</span>
                <span className="font-mono font-semibold" style={{color: taxExempt?'#2563eb':'#64748b'}}>
                  {taxExempt?'$0.00':`$${taxAmount.toFixed(2)}`}
                </span>
              </div>
              {/* Tip - always show */}
              <div className="flex justify-between px-4 py-2.5 text-[12px]"
                style={{borderBottom:'1px solid #f1f5f9', background: tip>0?'#fffbeb':'transparent'}}>
                <span style={{color: tip>0?'#ca8a04':'#cbd5e1'}}>🙏 Tip</span>
                <span className="font-mono font-bold" style={{color: tip>0?'#ca8a04':'#cbd5e1'}}>
                  {tip>0?`$${tip.toFixed(2)}`:'-'}
                </span>
              </div>
              {/* Surcharge - always show */}
              <div className="flex justify-between px-4 py-2.5 text-[12px]"
                style={{borderBottom:'1px solid #f1f5f9', background: feeAmt>0?'#fdf4ff':'transparent'}}>
                <span style={{color: feeAmt>0?'#9333ea':'#cbd5e1'}}>💼 {feeLabel}</span>
                <span className="font-mono font-bold" style={{color: feeAmt>0?'#9333ea':'#cbd5e1'}}>
                  {feeAmt>0?`$${feeAmt.toFixed(2)}`:'-'}
                </span>
              </div>
              {/* TOTAL */}
              <div className="flex justify-between px-4 py-4 text-[22px] font-black"
                style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                <span className="text-white">TOTAL</span>
                <span className="font-mono text-white">${liveTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Paid / Remaining / Change */}
            {paid > 0 && (
              <div className="mt-3 rounded-xl px-4 py-3" style={{background:'#f0fdf4', border:'1.5px solid #86efac'}}>
                {payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-[12px] mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[14px]">{METHODS.find(m=>m.id===p.method)?.icon||'💰'}</span>
                      <span className="text-slate-600">Payment {i+1}</span>
                      <span className="text-[10px] text-slate-400 capitalize">{p.method.replace('_',' ')}</span>
                    </span>
                    <span className="font-mono font-bold text-green-700">${p.amount.toFixed(2)}</span>
                  </div>
                ))}
                {remaining > 0 && (
                  <div className="flex justify-between text-[13px] font-bold pt-2 mt-1"
                    style={{borderTop:'1px solid #86efac', color:'#dc2626'}}>
                    <span>Remaining</span>
                    <span className="font-mono">${remaining.toFixed(2)}</span>
                  </div>
                )}
                {change > 0 && (
                  <div className="flex justify-between text-[14px] font-black pt-2 mt-1"
                    style={{borderTop:'1px solid #86efac', color:'#2563eb'}}>
                    <span>Change</span>
                    <span className="font-mono">${change.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Payment Controls ── */}
        <div className="flex-1 flex flex-col overflow-y-auto">

          {/* Header */}
          <div className="px-6 py-4 flex items-center justify-between flex-shrink-0"
            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
            <div>
              <div className="text-[12px] text-indigo-200 uppercase tracking-wider">Payment</div>
              <div className="text-[36px] font-black text-white font-mono leading-none">${liveTotal.toFixed(2)}</div>
            </div>
            <div className="flex items-center gap-3">
              {terminal?.pax_enabled && (
                <div className={`text-[10px] font-bold px-3 py-1.5 rounded-full ${paxOnline?'bg-green-400/20 text-green-200':'bg-red-400/20 text-red-200'}`}>
                  PAX {paxOnline?'● ON':'○ OFF'}
                </div>
              )}
              <button onClick={close}
                className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 px-5 py-4 flex flex-col gap-4">

            {/* ── ADJUSTMENTS ── */}
            <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0', background:'#fff'}}>
              <div className="px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
                Invoice Adjustments
              </div>
              <div className="p-3">
                {/* Adjustment buttons */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['disc', '✂️', 'Discount', '#16a34a','#f0fdf4',
                      orderDiscount ? (orderDiscount.type==='pct'?`${orderDiscount.value}%`:`$${orderDiscount.value}`) : null],
                    ['tip',  '🙏', 'Tip',      '#ca8a04','#fffbeb', tip>0?`$${tip.toFixed(2)}`:null],
                    ['fee',  '💼', 'Surcharge','#9333ea','#fdf4ff', feeAmt>0?`$${feeAmt.toFixed(2)}`:null],
                  ].map(([id,icon,label,col,bg,applied]) => (
                    <button key={id}
                      onClick={() => { setAdjTab(id); setAdjVal(''); setShowAdjPad(true) }}
                      className="flex flex-col items-center py-3.5 rounded-xl cursor-pointer border-2 transition-all"
                      style={applied
                        ? {background:bg, borderColor:col}
                        : {background:'#f8fafc', borderColor:'#e2e8f0'}}>
                      <span className="text-[22px] mb-1">{icon}</span>
                      <div className="text-[11px] font-bold" style={{color:applied?col:'#64748b'}}>{label}</div>
                      {applied
                        ? <div className="text-[12px] font-black mt-0.5" style={{color:col}}>{applied}</div>
                        : <div className="text-[10px] text-slate-400 mt-0.5">Tap to set</div>
                      }
                      {applied && (
                        <button onClick={e=>{e.stopPropagation();
                          if(id==='disc') setOrderDiscount(null)
                          else if(id==='tip') setTip(0)
                          else setFeeAmt(0)
                        }} className="mt-1 text-[10px] px-2 py-0.5 rounded-full border-none cursor-pointer font-bold"
                          style={{background:'rgba(0,0,0,0.08)', color:col}}>✕ Remove</button>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tax Exempt toggle */}
                <button onClick={()=>setTaxExempt(!taxExempt)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer border-2 transition-all mt-2"
                  style={taxExempt
                    ? {background:'#eff6ff', borderColor:'#93c5fd'}
                    : {background:'#f8fafc', borderColor:'#e2e8f0'}}>
                  <span className="text-[20px]">🏛️</span>
                  <div className="flex-1 text-left">
                    <div className="text-[12px] font-bold" style={{color:taxExempt?'#2563eb':'#64748b'}}>Tax Exempt</div>
                    <div className="text-[10px]" style={{color:taxExempt?'#2563eb':'#94a3b8'}}>
                      {taxExempt ? 'Applied — no tax on this order' : 'Tap to apply'}
                    </div>
                  </div>
                  <div className={`w-10 h-6 rounded-full transition-all flex items-center px-1 ${taxExempt?'bg-blue-500 justify-end':'bg-slate-200 justify-start'}`}>
                    <div className="w-4 h-4 rounded-full bg-white shadow"/>
                  </div>
                </button>
              </div>
            </div>

            {/* ── PAYMENT METHODS ── */}
            <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0', background:'#fff'}}>
              <div className="px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
                Payment Method {payments.length > 0 && `— ${payments.length} added`}
              </div>
              <div className="p-3">
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {enabledMethods.map(m => (
                    <button key={m.id} onClick={()=>setSelMethod(m.id)}
                      className="flex flex-col items-center py-3 rounded-xl cursor-pointer border-2 transition-all"
                      style={selMethod===m.id
                        ? {background:m.bg, borderColor:m.color, color:m.color}
                        : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#94a3b8'}}>
                      <span className="text-[20px] mb-1">{m.icon}</span>
                      <span className="text-[10px] font-bold leading-tight text-center">{m.label}</span>
                      {m.id==='card' && terminal?.pax_enabled && (
                        <span className={`text-[8px] mt-0.5 ${paxOnline?'text-green-500':'text-red-400'}`}>
                          {paxOnline?'PAX ready':'offline'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* PAX overlay */}
                {paxState !== 'idle' && (
                  <div className="rounded-xl p-4 text-center mb-3"
                    style={{background:'#f0f4ff', border:'2px solid #a5b4fc'}}>
                    <div className="text-[32px] mb-2">{PAX_STATE[paxState]?.icon}</div>
                    <div className="text-[14px] font-bold text-slate-800">{PAX_STATE[paxState]?.label}</div>
                    {paxState==='waiting' && (
                      <button onClick={async()=>{ await paxCancel({paxIp:terminal.pax_ip,paxPort:terminal.pax_port}); setPaxState('idle') }}
                        className="mt-3 rounded-xl px-4 py-2 text-[12px] font-bold cursor-pointer border"
                        style={{background:'#fff1f2',borderColor:'#fca5a5',color:'#dc2626'}}>
                        Cancel
                      </button>
                    )}
                  </div>
                )}

                {/* Amount input */}
                {paxState === 'idle' && (
                  <>
                    <button onClick={()=>setShowPayPad(true)}
                      className="w-full rounded-2xl px-5 py-4 text-left cursor-pointer border-2 mb-3 transition-all"
                      style={{borderColor: payInput?'#a5b4fc':'#e2e8f0', background: payInput?'#eef2ff':'#f8fafc'}}>
                      <div className="text-[11px] text-slate-400 mb-0.5">Amount to Pay</div>
                      <div className="text-[32px] font-black font-mono"
                        style={{color: payInput?'#6366f1':'#94a3b8'}}>
                        ${payInput || remaining.toFixed(2)}
                      </div>
                    </button>

                    {/* Quick amounts */}
                    <div className="flex gap-2 mb-3">
                      {[
                        Math.ceil(remaining/5)*5,
                        Math.ceil(remaining/10)*10,
                        Math.ceil(remaining/20)*20,
                        remaining,
                      ].filter((v,i,a) => v>=remaining && a.indexOf(v)===i).slice(0,4).map(q => (
                        <button key={q} onClick={()=>setPayInput(q.toFixed(2))}
                          className="flex-1 rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border-2 transition-all"
                          style={parseFloat(payInput)===q
                            ? {background:'#e0e7ff',borderColor:'#6366f1',color:'#6366f1'}
                            : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                          {q===remaining ? 'Exact' : `$${q}`}
                        </button>
                      ))}
                    </div>

                    <button onClick={handleAddPayment}
                      className="w-full rounded-2xl py-4 text-[14px] font-bold text-white cursor-pointer border-none"
                      style={{background:`linear-gradient(135deg,${METHODS.find(m=>m.id===selMethod)?.color||'#6366f1'},${selMethod==='cash'?'#15803d':selMethod==='card'?'#1d4ed8':'#6366f1'})`, boxShadow:'0 4px 16px rgba(0,0,0,0.15)'}}>
                      {selMethod==='card' && terminal?.pax_enabled ? '💳 Charge Card' : `${METHODS.find(m=>m.id===selMethod)?.icon} Add Payment`}
                    </button>
                  </>
                )}

                {/* Payment list */}
                {payments.length > 0 && (
                  <div className="mt-3 rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                    {payments.map((p,i) => {
                      const m = METHODS.find(x=>x.id===p.method)
                      return (
                        <div key={i} className="flex items-center gap-3 px-4 py-3"
                          style={{borderBottom:i<payments.length-1?'1px solid #f1f5f9':'none', background:'#fff'}}>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[16px] flex-shrink-0"
                            style={{background:m?.bg||'#f8fafc'}}>
                            {m?.icon||'💰'}
                          </div>
                          <div className="flex-1">
                            <div className="text-[12px] font-bold text-slate-700">
                              Payment {i+1} — {m?.label||p.method}
                            </div>
                            {p.maskedPan && <div className="text-[10px] text-slate-400">•••• {p.maskedPan.slice(-4)}</div>}
                          </div>
                          <div className="text-[15px] font-black font-mono" style={{color:m?.color||'#1e293b'}}>
                            ${p.amount.toFixed(2)}
                          </div>
                          <button onClick={()=>removePayment(i)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center bg-transparent border cursor-pointer text-[12px]"
                            style={{borderColor:'#fecdd3', color:'#ef4444', background:'#fff1f2'}}>✕</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── COMPLETE BUTTON ── */}
          <div className="px-5 pb-5 flex-shrink-0">
            {remaining > 0 && paid > 0 && (
              <div className="rounded-xl px-4 py-2.5 mb-3 flex justify-between text-[13px] font-bold"
                style={{background:'#fef2f2', border:'1.5px solid #fca5a5', color:'#dc2626'}}>
                <span>Still Owing</span>
                <span className="font-mono">${remaining.toFixed(2)}</span>
              </div>
            )}
            {change > 0 && (
              <div className="rounded-xl px-4 py-2.5 mb-3 flex justify-between text-[15px] font-black"
                style={{background:'#eff6ff', border:'1.5px solid #93c5fd', color:'#2563eb'}}>
                <span>Change to Return</span>
                <span className="font-mono">${change.toFixed(2)}</span>
              </div>
            )}
            <button onClick={handleComplete}
              disabled={processing || (paid < liveTotal && !payments.some(p=>p.method==='on_account'))}
              className="w-full rounded-2xl py-5 text-[18px] font-black text-white cursor-pointer border-none disabled:opacity-40 transition-all"
              style={{background:'linear-gradient(135deg,#16a34a,#15803d)', boxShadow:'0 6px 24px rgba(22,163,74,0.4)'}}>
              {processing ? '⏳ Processing...' : `✓ Complete — $${liveTotal.toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>

      {/* NumPads */}
      {showAdjPad && (
        <DiscountNumPad
          adjTab={adjTab}
          discMode={discMode} setDiscMode={setDiscMode}
          value={adjVal} onChange={setAdjVal}
          onConfirm={v => {
            if (adjTab==='disc') {
              setOrderDiscount({type:discMode, value:v})
              toast.success(`✂️ ${discMode==='pct'?v+'%':'$'+v.toFixed(2)} discount applied`)
            } else if (adjTab==='tip') {
              setTip(v); toast.success(`🙏 Tip $${v.toFixed(2)}`)
            } else if (adjTab==='fee') {
              setFeeAmt(v); toast.success(`💼 Surcharge $${v.toFixed(2)}`)
            }
            setAdjVal(String(v)); setShowAdjPad(false)
          }}
          onClose={() => setShowAdjPad(false)}/>
      )}
      {showPayPad && (
        <NumPad title="Payment Amount" prefix="$"
          value={payInput} onChange={setPayInput}
          allowNegative={false} allowDecimal={true}
          onConfirm={v=>{setPayInput(v.toFixed(2));setShowPayPad(false)}}
          onClose={()=>setShowPayPad(false)}/>
      )}
    </Overlay>
  )
}
