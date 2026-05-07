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
  const [adjTab,     setAdjTab]     = useState(null) // null | 'disc_pct' | 'disc_amt' | 'tip' | 'fee'
  const [adjVal,     setAdjVal]     = useState('')
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
              {[
                ['Subtotal', subtotal, '#1e293b', false],
                orderDiscountAmt > 0 ? ['✂️ Discount', -orderDiscountAmt, '#16a34a', false] : null,
                !taxExempt && taxAmount > 0 ? ['Tax', taxAmount, '#1e293b', false] : null,
                taxExempt ? ['🏛️ Tax Exempt', 0, '#2563eb', false] : null,
                tip > 0 ? ['🙏 Tip', tip, '#ca8a04', false] : null,
                feeAmt > 0 ? [`💼 ${feeLabel}`, feeAmt, '#9333ea', false] : null,
              ].filter(Boolean).map(([label, val, color]) => (
                <div key={label} className="flex justify-between px-4 py-2.5 text-[12px]"
                  style={{borderBottom:'1px solid #f1f5f9'}}>
                  <span style={{color:'#64748b'}}>{label}</span>
                  <span className="font-mono font-semibold" style={{color}}>
                    {val < 0 ? '-' : ''}${Math.abs(val).toFixed(2)}
                  </span>
                </div>
              ))}
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
                {/* Tab buttons */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    ['disc_pct', '✂️', 'Disc %',    '#16a34a','#f0fdf4','#86efac'],
                    ['disc_amt', '💰', 'Disc $',    '#2563eb','#eff6ff','#93c5fd'],
                    ['tip',      '🙏', 'Tip',       '#ca8a04','#fffbeb','#fde047'],
                    ['fee',      '💼', 'Fee',       '#9333ea','#fdf4ff','#d8b4fe'],
                  ].map(([id,icon,label,col,bg,bdr]) => (
                    <button key={id}
                      onClick={() => { setAdjTab(adjTab===id?null:id); setAdjVal('') }}
                      className="flex flex-col items-center py-3 rounded-xl cursor-pointer border-2 transition-all"
                      style={adjTab===id
                        ? {background:bg, borderColor:col, color:col}
                        : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#94a3b8'}}>
                      <span className="text-[20px] mb-1">{icon}</span>
                      <span className="text-[10px] font-bold">{label}</span>
                    </button>
                  ))}
                </div>

                {/* Applied badges */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {orderDiscount && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
                      style={{background:'#f0fdf4', color:'#16a34a', border:'1px solid #86efac'}}>
                      ✂️ {orderDiscount.type==='pct' ? `${orderDiscount.value}%` : `$${orderDiscount.value}`} off
                      <button onClick={()=>setOrderDiscount(null)} className="bg-transparent border-none cursor-pointer text-[12px]">✕</button>
                    </span>
                  )}
                  {tip > 0 && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
                      style={{background:'#fffbeb', color:'#ca8a04', border:'1px solid #fde047'}}>
                      🙏 Tip ${tip.toFixed(2)}
                      <button onClick={()=>setTip(0)} className="bg-transparent border-none cursor-pointer text-[12px]">✕</button>
                    </span>
                  )}
                  {feeAmt > 0 && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
                      style={{background:'#fdf4ff', color:'#9333ea', border:'1px solid #d8b4fe'}}>
                      💼 {feeLabel} ${feeAmt.toFixed(2)}
                      <button onClick={()=>setFeeAmt(0)} className="bg-transparent border-none cursor-pointer text-[12px]">✕</button>
                    </span>
                  )}
                  {taxExempt && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
                      style={{background:'#eff6ff', color:'#2563eb', border:'1px solid #93c5fd'}}>
                      🏛️ Tax Exempt
                      <button onClick={()=>setTaxExempt(false)} className="bg-transparent border-none cursor-pointer text-[12px]">✕</button>
                    </span>
                  )}
                  <button onClick={()=>setTaxExempt(!taxExempt)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer border transition-all"
                    style={taxExempt
                      ? {background:'#eff6ff',borderColor:'#93c5fd',color:'#2563eb'}
                      : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#94a3b8'}}>
                    🏛️ Tax Exempt
                  </button>
                </div>

                {/* Adjustment input */}
                {adjTab && adjTab !== 'tax_exempt' && (
                  <div className="flex gap-2 mt-2">
                    {adjTab === 'fee' && (
                      <input value={feeLabel} onChange={e=>setFeeLabel(e.target.value)}
                        className="rounded-xl px-3 py-2.5 text-[12px] outline-none border"
                        style={{width:'120px', borderColor:'#e2e8f0', background:'#f8fafc'}}
                        placeholder="Fee name"/>
                    )}
                    <button onClick={()=>setShowAdjPad(true)}
                      className="flex-1 rounded-xl px-4 py-3 text-left cursor-pointer border-2 transition-all"
                      style={{borderColor: adjVal?'#a5b4fc':'#e2e8f0', background: adjVal?'#eef2ff':'#f8fafc'}}>
                      <span className="text-[22px] font-black font-mono"
                        style={{color: adjVal?'#6366f1':'#94a3b8'}}>
                        {adjVal
                          ? (adjTab==='disc_pct' ? `${adjVal}%` : `$${parseFloat(adjVal).toFixed(2)}`)
                          : (adjTab==='disc_pct' ? '0%' : '$0.00')}
                      </span>
                    </button>
                    <button onClick={applyAdj} disabled={!adjVal}
                      className="rounded-xl px-5 text-[13px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                      style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                      ✓ Apply
                    </button>
                  </div>
                )}
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
        <NumPad title={adjTab==='disc_pct'?'Discount %':adjTab==='tip'?'Tip Amount':adjTab==='fee'?'Fee Amount':'Discount $'}
          prefix={adjTab!=='disc_pct'?'$':''} suffix={adjTab==='disc_pct'?'%':''}
          value={adjVal} onChange={setAdjVal}
          allowNegative={false} allowDecimal={true}
          onConfirm={v=>{setAdjVal(String(v));setShowAdjPad(false)}}
          onClose={()=>setShowAdjPad(false)}/>
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
