// src/pages/pos/panels/PaymentPanel.jsx
import { useState, useEffect } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
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
  { id:'cash',          icon:'💵', label:'Cash',       color:'#16a34a', bg:'#f0fdf4', border:'#86efac' },
  { id:'card',          icon:'💳', label:'Card',       color:'#2563eb', bg:'#eff6ff', border:'#93c5fd' },
  { id:'member_card',   icon:'🏷️', label:'VIP Card',  color:'#9333ea', bg:'#fdf4ff', border:'#d8b4fe' },
  { id:'gift_card',     icon:'🎁', label:'Gift Card',  color:'#ea580c', bg:'#fff7ed', border:'#fed7aa' },
  { id:'bank_transfer', icon:'🏦', label:'Transfer',   color:'#0891b2', bg:'#f0f9ff', border:'#7dd3fc' },
  { id:'check',         icon:'📝', label:'Check',      color:'#ca8a04', bg:'#fffbeb', border:'#fde047' },
  { id:'on_account',    icon:'📋', label:'On Account', color:'#64748b', bg:'#f8fafc', border:'#cbd5e1' },
]

// ── Discount NumPad ──
function DiscountNumPad({ adjTab, discMode, setDiscMode, onConfirm, onClose }) {
  const [input, setInput] = useState('')
  const isDisc  = adjTab === 'disc'
  const ICONS   = { disc:'✂️', tip:'🙏', fee:'💼' }
  const TITLES  = { disc:'Discount', tip:'Add Tip', fee:'Surcharge' }

  const press = k => {
    if (k==='⌫') { setInput(i=>i.slice(0,-1)); return }
    if (k==='.' && input.includes('.')) return
    if (input.length >= 7) return
    setInput(i=>i+k)
  }

  const confirm = () => {
    const v = parseFloat(input) || 0
    if (v <= 0) { toast.error('Enter a value'); return }
    onConfirm(v)
  }

  const preview = isDisc && input
    ? discMode==='pct' ? `${input}% off` : `$${parseFloat(input).toFixed(2)} off`
    : input ? `$${parseFloat(input).toFixed(2)}` : ''

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}>
      <div className="rounded-3xl overflow-hidden shadow-2xl" style={{width:'360px', background:'#fff'}}>
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
          <div className="text-[18px] font-bold text-white">{ICONS[adjTab]} {TITLES[adjTab]}</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
        </div>

        {isDisc && (
          <div className="flex gap-2 px-5 pt-4">
            {[['pct','% Percent','#6366f1','#e0e7ff'],['amt','$ Amount','#16a34a','#dcfce7']].map(([m,l,c,b])=>(
              <button key={m} onClick={()=>{ setDiscMode(m); setInput('') }}
                className="flex-1 py-3.5 rounded-2xl text-[15px] font-black cursor-pointer border-2 transition-all"
                style={discMode===m ? {background:b,borderColor:c,color:c} : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#94a3b8'}}>
                {l}
              </button>
            ))}
          </div>
        )}

        <div className="px-5 py-4">
          <div className="rounded-2xl py-5 flex items-center justify-center gap-2 mb-1"
            style={{background:'#f0f4ff', border:'2px solid #a5b4fc'}}>
            {(!isDisc || discMode==='amt') && <span className="text-[28px] font-black text-indigo-400">$</span>}
            <span className="text-[48px] font-black font-mono leading-none" style={{color:'#6366f1'}}>
              {input || '0'}
            </span>
            {isDisc && discMode==='pct' && <span className="text-[28px] font-black text-indigo-400">%</span>}
          </div>
        </div>

        <div className="px-4 pb-5 grid grid-cols-3 gap-2.5">
          {['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k=>(
            <button key={k} onClick={()=>press(k)}
              className="rounded-2xl py-4 text-[22px] font-bold cursor-pointer border-2 transition-all active:scale-95"
              style={k==='⌫'
                ? {background:'#fff1f2',borderColor:'#fecdd3',color:'#ef4444'}
                : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#1e293b',boxShadow:'0 3px 0 #d1d5db'}}>
              {k}
            </button>
          ))}
          <button onClick={confirm} disabled={!input||parseFloat(input)<=0}
            className="col-span-3 rounded-2xl py-5 text-[16px] font-black text-white cursor-pointer border-none disabled:opacity-40"
            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow:'0 4px 16px rgba(99,102,241,0.35)'}}>
            ✓ Apply {preview}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Payment Panel ──
export default function PaymentPanel() {
  const { totals, payments, addPayment, removePayment, paidAmount, submitOrder,
          setOrderDiscount, orderDiscount } = useCartStore()
  const { user, tenant, store }  = useAuthStore()
  const { terminal, paxOnline }  = useTerminalStore()

  const { subtotal, taxAmount, orderDiscountAmt, grandTotal } = totals()
  const { items, customer } = useCartStore()

  const [tip,       setTip]      = useState(0)
  const [feeLabel,  setFeeLabel] = useState('Surcharge')
  const [feeAmt,    setFeeAmt]   = useState(0)
  const [taxExempt, setTaxExempt]= useState(false)

  const [adjTab,    setAdjTab]   = useState(null)
  const [discMode,  setDiscMode] = useState('pct')
  const [showAdjPad,setShowAdjPad]= useState(false)

  const [selMethod, setSelMethod]= useState('cash')
  const [payInput,  setPayInput] = useState('')
  const [showPayPad,setShowPayPad]= useState(false)

  const [paxState,  setPaxState] = useState('idle')
  const [processing,setProcessing]=useState(false)

  const liveTotal  = subtotal - orderDiscountAmt + (taxExempt?0:taxAmount) + tip + feeAmt
  const paid       = paidAmount()
  const remaining  = Math.max(0, liveTotal - paid)
  const change     = paid > liveTotal ? paid - liveTotal : 0

  // Auto-set amount to remaining when method changes or payment added
  useEffect(() => {
    setPayInput(remaining > 0 ? remaining.toFixed(2) : '')
  }, [remaining, selMethod])

  const close = () => useCartStore.setState({ showPayPanel: false })

  const applyAdj = (v) => {
    if (adjTab==='disc')     { setOrderDiscount({type:discMode, value:v}); }
    else if (adjTab==='tip') { setTip(v) }
    else if (adjTab==='fee') { setFeeAmt(v) }
    setShowAdjPad(false)
  }

  const handleCardPax = async (amount) => {
    setPaxState('waiting')
    const ref = `POS-${Date.now().toString(36).toUpperCase()}`
    try {
      const r = await paxSale({ paxIp:terminal.pax_ip, paxPort:terminal.pax_port||10009, amountCents:dollarsToCents(amount), invoiceNum:ref })
      if (r.success) {
        setPaxState('approved')
        addPayment({ method:'card', amount, reference:r.approvalCode, cardType:r.cardType, maskedPan:r.maskedPan, paxTraceNum:r.traceNum })
        setTimeout(()=>setPaxState('idle'), 2000)
      } else if (r.status==='cancelled') {
        setPaxState('cancelled'); setTimeout(()=>setPaxState('idle'),2000)
      } else {
        setPaxState('declined'); toast.error('Card declined'); setTimeout(()=>setPaxState('idle'),3000)
      }
    } catch(e) {
      setPaxState('error'); toast.error('PAX: '+e.message); setTimeout(()=>setPaxState('idle'),3000)
    }
  }

  const handleAddPayment = async () => {
    const amount = parseFloat(payInput) || remaining
    if (amount <= 0) { toast.error('Enter amount'); return }
    if (selMethod==='card' && terminal?.pax_enabled) { handleCardPax(amount); return }
    addPayment({ method:selMethod, amount })
    // Auto-complete if fully paid
    const newPaid = paid + amount
    if (newPaid >= liveTotal) {
      setTimeout(() => handleComplete(newPaid), 300)
    }
  }

  const handleComplete = async (overridePaid) => {
    const totalPaid = overridePaid || paid
    if (totalPaid < liveTotal && !payments.some(p=>p.method==='on_account')) {
      toast.error('Amount paid is less than total'); return
    }
    setProcessing(true)
    try {
      await submitOrder(store.id, user.id, tenant.id, TERMINAL_ID)
      toast.success('✓ Order complete!')
      close()
      window.location.href = '/pos'
    } catch { toast.error('Failed to complete order') }
    finally { setProcessing(false) }
  }

  const enabledMethods = METHODS.filter(m => {
    if (m.id==='card')       return terminal?.accept_card !== false
    if (m.id==='cash')       return terminal?.accept_cash !== false
    if (m.id==='check')      return terminal?.accept_check !== false
    if (m.id==='on_account') return terminal?.accept_on_account !== false
    return true
  })

  const getItemTotal = (item) => {
    const d = item.itemDiscount
    const lp = d ? d.type==='pct' ? item.unitPrice*(1-d.value/100) : Math.max(0,item.unitPrice-d.value) : item.unitPrice
    return lp * item.qty
  }

  return (
    <Overlay onClose={paxState!=='idle' ? undefined : close}>
      <div className="rounded-3xl overflow-hidden shadow-2xl flex"
        style={{width:'1100px', height:'92vh', background:'#f0f2f5'}}>

        {/* ══ COL 1: ORDER SUMMARY (narrow) ══ */}
        <div className="flex flex-col flex-shrink-0"
          style={{width:'300px', background:'#fff', borderRight:'1px solid #e2e8f0'}}>

          {/* Customer header */}
          <div className="px-4 py-3 flex-shrink-0"
            style={{background:'linear-gradient(135deg,#1e293b,#334155)', borderBottom:'1px solid #243347'}}>
            {customer ? (
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[14px] font-black text-white"
                  style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                  {customer.name.charAt(0)}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-white">{customer.name}</div>
                  {customer.loyalty_points>0 && <div className="text-[10px] text-purple-300">💎 {customer.loyalty_points} pts</div>}
                </div>
              </div>
            ) : (
              <div className="text-[13px] text-slate-400">🚶 Walk-in</div>
            )}
          </div>

          {/* Items list */}
          <div className="flex-1 overflow-y-auto py-2">
            {items.map((item,i) => (
              <div key={i} className="flex items-start gap-2 px-4 py-2.5"
                style={{borderBottom:'1px solid #f8fafc'}}>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-slate-800 truncate">{item.name}</div>
                  <div className="text-[10px] text-slate-400">${item.unitPrice.toFixed(2)} × {Math.abs(item.qty)}</div>
                  {item.note && <div className="text-[10px] text-indigo-500 truncate">📝 {item.note}</div>}
                </div>
                <div className="text-[13px] font-bold font-mono flex-shrink-0"
                  style={{color:item.qty<0?'#ef4444':'#1e293b'}}>
                  ${Math.abs(getItemTotal(item)).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          {/* Totals - always visible */}
          <div className="flex-shrink-0 px-4 pb-4">
            <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
              {[
                ['Subtotal',                   subtotal,          '#64748b', '#fff',     false],
                ['✂️ Discount',                 -orderDiscountAmt, '#16a34a', orderDiscountAmt>0?'#f0fdf4':'#fff', orderDiscountAmt>0],
                [taxExempt?'🏛️ Tax (Exempt)':'Tax', taxExempt?0:(taxAmount), taxExempt?'#2563eb':'#64748b', taxExempt?'#eff6ff':'#fff', false],
                ['🙏 Tip',                      tip,               '#ca8a04', tip>0?'#fffbeb':'#fff', tip>0],
                [`💼 ${feeLabel}`,              feeAmt,            '#9333ea', feeAmt>0?'#fdf4ff':'#fff', feeAmt>0],
              ].map(([label,val,color,bg])=>(
                <div key={label} className="flex justify-between px-4 py-2 text-[12px]"
                  style={{borderBottom:'1px solid #f1f5f9', background:bg}}>
                  <span style={{color: val===0&&!label.includes('Tax')?'#cbd5e1':color}}>{label}</span>
                  <span className="font-mono font-semibold"
                    style={{color: val===0&&!label.includes('Tax')?'#cbd5e1':color}}>
                    {val<0?'-$'+Math.abs(val).toFixed(2): val===0&&!label.includes('Subtotal')&&!label.includes('Tax')?'—':'$'+Math.abs(val).toFixed(2)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-4"
                style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                <span className="text-[18px] font-black text-white">TOTAL</span>
                <span className="text-[20px] font-black font-mono text-white">${liveTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ══ COL 2: ADJUSTMENTS + PAYMENT INPUT (wide) ══ */}
        <div className="flex-1 flex flex-col overflow-y-auto">

          {/* Header */}
          <div className="px-6 py-4 flex items-center justify-between flex-shrink-0"
            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
            <div>
              <div className="text-[12px] text-indigo-200 uppercase tracking-wider">Payment Due</div>
              <div className="text-[42px] font-black text-white font-mono leading-none">${remaining.toFixed(2)}</div>
              {paid > 0 && <div className="text-[12px] text-indigo-200 mt-0.5">Paid: ${paid.toFixed(2)} of ${liveTotal.toFixed(2)}</div>}
            </div>
            <div className="flex items-center gap-3">
              {terminal?.pax_enabled && (
                <div className={`text-[10px] font-bold px-3 py-1.5 rounded-full ${paxOnline?'bg-green-400/20 text-green-200':'bg-red-400/20 text-red-200'}`}>
                  PAX {paxOnline?'● ON':'○ OFF'}
                </div>
              )}
              <button onClick={close}
                className="w-10 h-10 rounded-full bg-white/20 border-none cursor-pointer text-white text-[20px] flex items-center justify-center">
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 px-6 py-5 flex flex-col gap-5">

            {/* Adjustments row */}
            <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0', background:'#fff'}}>
              <div className="px-5 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
                Invoice Adjustments
              </div>
              <div className="p-4 grid grid-cols-4 gap-3">
                {[
                  ['disc','✂️','Discount', '#16a34a','#f0fdf4',
                    orderDiscount?(orderDiscount.type==='pct'?`${orderDiscount.value}%`:`$${orderDiscount.value}`):null],
                  ['tip', '🙏','Tip',      '#ca8a04','#fffbeb', tip>0?`$${tip.toFixed(2)}`:null],
                  ['fee', '💼','Surcharge','#9333ea','#fdf4ff', feeAmt>0?`$${feeAmt.toFixed(2)}`:null],
                ].map(([id,icon,label,col,bg,applied])=>(
                  <button key={id}
                    onClick={()=>{ setAdjTab(id); setShowAdjPad(true) }}
                    className="flex flex-col items-center py-4 rounded-2xl cursor-pointer border-2 transition-all"
                    style={applied?{background:bg,borderColor:col}:{background:'#f8fafc',borderColor:'#e2e8f0'}}>
                    <span className="text-[24px] mb-1.5">{icon}</span>
                    <span className="text-[12px] font-bold" style={{color:applied?col:'#64748b'}}>{label}</span>
                    {applied
                      ? <span className="text-[13px] font-black mt-1" style={{color:col}}>{applied}</span>
                      : <span className="text-[10px] text-slate-400 mt-1">Tap to set</span>
                    }
                    {applied && (
                      <button onClick={e=>{e.stopPropagation();
                        if(id==='disc') setOrderDiscount(null)
                        else if(id==='tip') setTip(0)
                        else setFeeAmt(0)
                      }} className="mt-2 text-[10px] px-2.5 py-1 rounded-full font-bold border-none cursor-pointer"
                        style={{background:'rgba(0,0,0,0.1)', color:col}}>✕ Remove</button>
                    )}
                  </button>
                ))}
                {/* Tax exempt toggle */}
                <button onClick={()=>setTaxExempt(!taxExempt)}
                  className="flex flex-col items-center py-4 rounded-2xl cursor-pointer border-2 transition-all"
                  style={taxExempt?{background:'#eff6ff',borderColor:'#2563eb'}:{background:'#f8fafc',borderColor:'#e2e8f0'}}>
                  <span className="text-[24px] mb-1.5">🏛️</span>
                  <span className="text-[12px] font-bold" style={{color:taxExempt?'#2563eb':'#64748b'}}>Tax Exempt</span>
                  <span className="text-[10px] mt-1" style={{color:taxExempt?'#2563eb':'#94a3b8'}}>
                    {taxExempt?'Applied':'Tap to apply'}
                  </span>
                  {taxExempt && (
                    <span className="mt-2 text-[10px] px-2.5 py-1 rounded-full font-bold"
                      style={{background:'#dbeafe', color:'#2563eb'}}>✓ ON</span>
                  )}
                </button>
              </div>
            </div>

            {/* Payment Method + Input */}
            <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0', background:'#fff'}}>
              <div className="px-5 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
                Select Payment Method
              </div>
              <div className="p-4">
                {/* Method grid */}
                <div className="grid grid-cols-4 gap-2.5 mb-4">
                  {enabledMethods.map(m=>(
                    <button key={m.id} onClick={()=>setSelMethod(m.id)}
                      className="flex flex-col items-center py-3.5 rounded-2xl cursor-pointer border-2 transition-all"
                      style={selMethod===m.id
                        ? {background:m.bg, borderColor:m.color}
                        : {background:'#f8fafc', borderColor:'#e2e8f0'}}>
                      <span className="text-[22px] mb-1">{m.icon}</span>
                      <span className="text-[11px] font-bold leading-tight text-center"
                        style={{color:selMethod===m.id?m.color:'#64748b'}}>
                        {m.id==='card'&&terminal?.pax_enabled?`Card\n(PAX)`:m.label}
                      </span>
                      {m.id==='card'&&terminal?.pax_enabled&&(
                        <span className={`text-[9px] mt-0.5 ${paxOnline?'text-green-500':'text-red-400'}`}>
                          {paxOnline?'ready':'offline'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* PAX overlay */}
                {paxState!=='idle' && (
                  <div className="rounded-2xl p-5 text-center mb-4"
                    style={{background:'#f0f4ff', border:'2px solid #a5b4fc'}}>
                    <div className="text-[40px] mb-2">{PAX_STATE[paxState]?.icon}</div>
                    <div className="text-[16px] font-bold text-slate-800">{PAX_STATE[paxState]?.label}</div>
                    {paxState==='waiting' && (
                      <button onClick={async()=>{ await paxCancel({paxIp:terminal.pax_ip,paxPort:terminal.pax_port}); setPaxState('idle') }}
                        className="mt-3 rounded-xl px-5 py-2.5 text-[12px] font-bold cursor-pointer border"
                        style={{background:'#fff1f2',borderColor:'#fca5a5',color:'#dc2626'}}>
                        Cancel
                      </button>
                    )}
                  </div>
                )}

                {/* Amount input */}
                {paxState==='idle' && (
                  <>
                    <button onClick={()=>setShowPayPad(true)}
                      className="w-full rounded-2xl px-5 py-5 text-left cursor-pointer border-2 mb-3 transition-all"
                      style={{borderColor:'#a5b4fc', background:'#eef2ff'}}>
                      <div className="text-[11px] text-indigo-400 mb-1">
                        {remaining>0 ? `Amount for Payment ${payments.length+1}` : '✓ Fully Paid'}
                      </div>
                      <div className="text-[40px] font-black font-mono leading-none"
                        style={{color:'#6366f1'}}>
                        ${payInput || remaining.toFixed(2)}
                      </div>
                    </button>

                    {/* Quick amounts */}
                    {remaining > 0 && (
                      <div className="flex gap-2 mb-4">
                        {[
                          Math.ceil(remaining/5)*5,
                          Math.ceil(remaining/10)*10,
                          Math.ceil(remaining/20)*20,
                          remaining,
                        ].filter((v,i,a)=>v>=remaining&&a.indexOf(v)===i).slice(0,4).map(q=>(
                          <button key={q} onClick={()=>setPayInput(q.toFixed(2))}
                            className="flex-1 rounded-xl py-3 text-[13px] font-bold cursor-pointer border-2 transition-all"
                            style={parseFloat(payInput)===q
                              ? {background:'#e0e7ff',borderColor:'#6366f1',color:'#6366f1'}
                              : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                            {q===remaining?'Exact':'$'+q}
                          </button>
                        ))}
                      </div>
                    )}

                    {remaining > 0 && (
                      <button onClick={handleAddPayment} disabled={paxState!=='idle'}
                        className="w-full rounded-2xl py-5 text-[16px] font-black text-white cursor-pointer border-none disabled:opacity-40"
                        style={{
                          background:`linear-gradient(135deg,${METHODS.find(m=>m.id===selMethod)?.color||'#6366f1'}, #1e293b)`,
                          boxShadow:'0 6px 24px rgba(0,0,0,0.2)'
                        }}>
                        {METHODS.find(m=>m.id===selMethod)?.icon} Add {selMethod==='card'&&terminal?.pax_enabled?'Card Payment':`${METHODS.find(m=>m.id===selMethod)?.label} Payment`} — ${payInput||remaining.toFixed(2)}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Complete button */}
          <div className="px-6 pb-6 flex-shrink-0">
            {change > 0 && (
              <div className="rounded-2xl px-5 py-3 mb-3 flex justify-between text-[16px] font-black"
                style={{background:'#eff6ff', border:'2px solid #93c5fd', color:'#2563eb'}}>
                <span>💵 Change to Return</span>
                <span className="font-mono">${change.toFixed(2)}</span>
              </div>
            )}
            <button onClick={()=>handleComplete()}
              disabled={processing||(paid<liveTotal&&!payments.some(p=>p.method==='on_account'))}
              className="w-full rounded-2xl py-6 text-[20px] font-black text-white cursor-pointer border-none disabled:opacity-40"
              style={{background:'linear-gradient(135deg,#16a34a,#15803d)', boxShadow:'0 6px 24px rgba(22,163,74,0.4)'}}>
              {processing ? '⏳ Processing...' : remaining<=0 ? `✓ Complete Order — $${liveTotal.toFixed(2)}` : `Complete (${payments.length} payment${payments.length!==1?'s':''} — $${paid.toFixed(2)} of $${liveTotal.toFixed(2)})`}
            </button>
          </div>
        </div>

        {/* ══ COL 3: PAYMENTS LIST (narrow right) ══ */}
        <div className="flex flex-col flex-shrink-0"
          style={{width:'240px', background:'#fff', borderLeft:'1px solid #e2e8f0'}}>

          <div className="px-4 py-3 flex-shrink-0"
            style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Payments</div>
            <div className="text-[13px] font-black mt-0.5" style={{color: paid>=liveTotal?'#16a34a':'#6366f1'}}>
              {paid>=liveTotal ? '✓ Fully Paid' : `$${paid.toFixed(2)} of $${liveTotal.toFixed(2)}`}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {payments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-300">
                <div className="text-[36px] mb-2">💳</div>
                <div className="text-[11px] text-center">No payments yet</div>
              </div>
            ) : payments.map((p,i) => {
              const m = METHODS.find(x=>x.id===p.method)
              return (
                <div key={i} className="rounded-2xl p-3 mb-2.5"
                  style={{background:m?.bg||'#f8fafc', border:`1.5px solid ${m?.border||'#e2e8f0'}`}}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[16px]">{m?.icon||'💰'}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider"
                        style={{color:m?.color||'#64748b'}}>
                        #{i+1}
                      </span>
                    </div>
                    <button onClick={()=>removePayment(i)}
                      className="w-6 h-6 rounded-full border-none cursor-pointer text-[11px] font-bold flex items-center justify-center"
                      style={{background:'rgba(239,68,68,0.1)', color:'#ef4444'}}>✕</button>
                  </div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-1">
                    {m?.label||p.method}
                  </div>
                  <div className="text-[20px] font-black font-mono" style={{color:m?.color||'#1e293b'}}>
                    ${p.amount.toFixed(2)}
                  </div>
                  {p.maskedPan && (
                    <div className="text-[10px] text-slate-400 mt-0.5">•••• {p.maskedPan.slice(-4)}</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Balance summary */}
          {payments.length > 0 && (
            <div className="p-3 flex-shrink-0" style={{borderTop:'1px solid #f1f5f9'}}>
              <div className="rounded-xl p-3" style={{background: remaining<=0?'#f0fdf4':'#fef2f2', border:`1.5px solid ${remaining<=0?'#86efac':'#fca5a5'}`}}>
                {remaining > 0 ? (
                  <>
                    <div className="text-[10px] font-bold text-red-500 mb-1">Remaining</div>
                    <div className="text-[22px] font-black font-mono text-red-600">${remaining.toFixed(2)}</div>
                  </>
                ) : (
                  <>
                    <div className="text-[10px] font-bold text-green-600 mb-1">✓ Paid in Full</div>
                    {change > 0 && (
                      <>
                        <div className="text-[10px] text-blue-500 font-bold">Change</div>
                        <div className="text-[20px] font-black font-mono text-blue-600">${change.toFixed(2)}</div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* NumPads */}
      {showAdjPad && (
        <DiscountNumPad adjTab={adjTab} discMode={discMode} setDiscMode={setDiscMode}
          onConfirm={applyAdj} onClose={()=>setShowAdjPad(false)}/>
      )}
      {showPayPad && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}>
          <div className="rounded-3xl overflow-hidden shadow-2xl" style={{width:'360px', background:'#fff'}}>
            <div className="px-5 py-4 flex items-center justify-between"
              style={{background:`linear-gradient(135deg,${METHODS.find(m=>m.id===selMethod)?.color||'#6366f1'},#1e293b)`}}>
              <div>
                <div className="text-[13px] text-white/70">Payment {payments.length+1}</div>
                <div className="text-[18px] font-bold text-white">{METHODS.find(m=>m.id===selMethod)?.icon} {METHODS.find(m=>m.id===selMethod)?.label}</div>
              </div>
              <button onClick={()=>setShowPayPad(false)}
                className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
            </div>
            <div className="px-5 py-4">
              <div className="text-[11px] text-slate-400 mb-1">Remaining: ${remaining.toFixed(2)}</div>
              <div className="rounded-2xl py-5 flex items-center justify-center gap-1 mb-1"
                style={{background:'#f0f4ff', border:'2px solid #a5b4fc'}}>
                <span className="text-[28px] font-black text-indigo-400">$</span>
                <span className="text-[48px] font-black font-mono leading-none" style={{color:'#6366f1'}}>
                  {payInput||'0'}
                </span>
              </div>
            </div>
            <div className="px-4 pb-5 grid grid-cols-3 gap-2.5">
              {['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k=>(
                <button key={k} onClick={()=>{
                  if(k==='⌫'){setPayInput(i=>i.slice(0,-1));return}
                  if(k==='.'&&payInput.includes('.'))return
                  setPayInput(i=>i+k)
                }}
                  className="rounded-2xl py-4 text-[22px] font-bold cursor-pointer border-2 active:scale-95"
                  style={k==='⌫'
                    ? {background:'#fff1f2',borderColor:'#fecdd3',color:'#ef4444'}
                    : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#1e293b',boxShadow:'0 3px 0 #d1d5db'}}>
                  {k}
                </button>
              ))}
              <button onClick={()=>{
                setPayInput(remaining.toFixed(2))
                setShowPayPad(false)
              }}
                className="col-span-3 rounded-2xl py-3 text-[13px] font-bold cursor-pointer border-2 mb-1"
                style={{background:'#f0fdf4',borderColor:'#86efac',color:'#16a34a'}}>
                Use Exact Amount — ${remaining.toFixed(2)}
              </button>
              <button onClick={()=>{
                if(parseFloat(payInput)>0){ setShowPayPad(false) }
              }}
                disabled={!payInput||parseFloat(payInput)<=0}
                className="col-span-3 rounded-2xl py-5 text-[16px] font-black text-white cursor-pointer border-none disabled:opacity-40"
                style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow:'0 4px 16px rgba(99,102,241,0.35)'}}>
                ✓ Set ${payInput?parseFloat(payInput).toFixed(2):'0.00'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Overlay>
  )
}
