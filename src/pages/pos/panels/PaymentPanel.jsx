// src/pages/pos/panels/PaymentPanel.jsx
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import { Overlay } from './SerialPanel'
import { TERMINAL_ID } from '@/hooks/useLock'
import { paxSale, paxCancel, dollarsToCents } from '@/lib/pax'
import { calculateBulkPrice, getActiveBulkTiers } from '@/lib/bulkPricing'
import { openCashDrawer } from '@/lib/cashDrawer'
import {
  getPrintingSettings, buildReceiptHTML, printReceipt,
  sendEmailReceipt, sendSmsReceipt, isValidEmail, isValidPhone,
} from '@/lib/receipt'
import { QWERTYKeyboard, NumericKeypad } from '@/components/ui/TouchKeyboards'
import toast from 'react-hot-toast'

const PAX_STATE = {
  idle:       {},
  waiting:    { icon:'📲', label:'Waiting for card...' },
  processing: { icon:'⚙️', label:'Processing...' },
  approved:   { icon:'✅', label:'Approved!' },
  declined:   { icon:'❌', label:'Declined' },
  cancelled:  { icon:'↩️', label:'Cancelled' },
  error:      { icon:'⚠️', label:'Error' },
}

const METHODS = [
  { id:'cash',          icon:'💵', label:'Cash',       color:'#16a34a', bg:'#f0fdf4', border:'#86efac' },
  { id:'card',          icon:'💳', label:'Card',       color:'#2563eb', bg:'#eff6ff', border:'#93c5fd' },
  { id:'member_card',   icon:'🏷️', label:'VIP',       color:'#006AFF', bg:'#fdf4ff', border:'#d8b4fe' },
  { id:'gift_card',     icon:'🎁', label:'Gift',       color:'#ea580c', bg:'#fff7ed', border:'#fed7aa' },
  { id:'bank_transfer', icon:'🏦', label:'Transfer',   color:'#0891b2', bg:'#f0f9ff', border:'#7dd3fc' },
  { id:'check',         icon:'📝', label:'Check',      color:'#ca8a04', bg:'#fffbeb', border:'#fde047' },
  { id:'on_account',    icon:'📋', label:'Account',    color:'#64748b', bg:'#f8fafc', border:'#cbd5e1' },
]

function DiscountNumPad({ adjTab, discMode, setDiscMode, onConfirm, onClose }) {
  const [input, setInput] = useState('')
  const isDisc = adjTab === 'disc'
  const ICONS  = { disc:'✂️', tip:'🙏', fee:'💼' }
  const TITLES = { disc:'Discount', tip:'Tip', fee:'Surcharge' }
  const press  = k => {
    if (k==='⌫') { setInput(i=>i.slice(0,-1)); return }
    if (k==='.'&&input.includes('.')) return
    if (input.length>=7) return
    setInput(i=>i+k)
  }
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{background:'rgba(0,0,0,0.4)', backdropFilter:'blur(2px)'}}>
      <div className="rounded-lg overflow-hidden shadow-xl" style={{width:'360px', background:'#fff'}}>
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'#000000'}}>
          <div className="text-[18px] font-bold text-white">{ICONS[adjTab]} {TITLES[adjTab]}</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
        </div>
        {isDisc && (
          <div className="flex gap-2 px-5 pt-4">
            {[['pct','% Percent','#006AFF','#E6F0FF'],['amt','$ Amount','#16a34a','#dcfce7']].map(([m,l,c,b])=>(
              <button key={m} onClick={()=>setDiscMode(m)}
                className="flex-1 py-3 rounded-lg text-[14px] font-bold cursor-pointer border-2 transition-all"
                style={discMode===m?{background:b,borderColor:c,color:c}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#94a3b8'}}>
                {l}
              </button>
            ))}
          </div>
        )}
        <div className="px-5 py-3">
          <div className="rounded-lg py-4 flex items-center justify-center gap-2"
            style={{background:'#E6F0FF', border:'2px solid #80B2FF'}}>
            {(!isDisc||discMode==='amt') && <span className="text-[26px] font-bold text-indigo-400">$</span>}
            <span className="text-[44px] font-bold font-mono leading-none" style={{color:'#006AFF'}}>{input||'0'}</span>
            {isDisc&&discMode==='pct' && <span className="text-[26px] font-bold text-indigo-400">%</span>}
          </div>
        </div>
        <div className="px-4 pb-4 grid grid-cols-3 gap-2">
          {['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k=>(
            <button key={k} onClick={()=>press(k)}
              className="rounded-xl py-3.5 text-[20px] font-bold cursor-pointer border-2 active:scale-95"
              style={k==='⌫'?{background:'#fff1f2',borderColor:'#fecdd3',color:'#ef4444'}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#1F1F1F',boxShadow:'0 2px 0 #d1d5db'}}>
              {k}
            </button>
          ))}
          <button onClick={()=>setInput('')}
            disabled={!input}
            className="col-span-3 rounded-xl py-2.5 text-[13px] font-bold cursor-pointer border-2 disabled:opacity-40"
            style={{background:'#fff7ed',borderColor:'#fed7aa',color:'#ea580c'}}>
            ✕ Clear
          </button>
          <button onClick={()=>{ const v=parseFloat(input)||0; if(v>0) onConfirm(v) }}
            disabled={!input||parseFloat(input)<=0}
            className="col-span-3 rounded-lg py-4 text-[15px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background:'#000000'}}>
            ✓ Apply {isDisc&&input?(discMode==='pct'?`${input}%`:`$${parseFloat(input).toFixed(2)}`):input?`$${parseFloat(input).toFixed(2)}`:''}
          </button>
        </div>
      </div>
    </div>
  )
}

function PointsRedeemNumPad({ customerPts, maxRedeemable, redeemRate, currentPoints, onConfirm, onClose }) {
  const [input, setInput] = useState(currentPoints > 0 ? String(currentPoints) : '')
  const ptsNum    = parseInt(input) || 0
  const cashValue = ptsNum / redeemRate
  const remaining = customerPts - ptsNum
  const exceeds   = ptsNum > maxRedeemable
  const press = k => {
    if (k==='⌫') { setInput(i=>i.slice(0,-1)); return }
    if (input.length>=7) return
    setInput(i => (i==='0' ? k : i+k))
  }
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{background:'rgba(0,0,0,0.4)', backdropFilter:'blur(2px)'}}>
      <div className="rounded-lg overflow-hidden shadow-xl" style={{width:'420px', background:'#fff'}}>
        <div className="px-5 py-4 flex items-center justify-between" style={{background:'#000000'}}>
          <div className="text-[18px] font-bold text-white">⭐ Use Loyalty Points</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
        </div>

        {/* Balance preview */}
        <div className="px-5 pt-4 pb-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg px-3 py-2.5" style={{background:'#FEF3C7', border:'1px solid #FCD34D'}}>
            <div className="text-[10px] font-bold text-[#92400e] uppercase tracking-wider">Available</div>
            <div className="text-[18px] font-bold text-[#B45309] font-mono">{customerPts.toLocaleString()}<span className="text-[11px] ml-1 font-normal">pts</span></div>
          </div>
          <div className="rounded-lg px-3 py-2.5" style={{background:'#DCFCE7', border:'1px solid #86efac'}}>
            <div className="text-[10px] font-bold text-[#166534] uppercase tracking-wider">Max usable now</div>
            <div className="text-[18px] font-bold text-[#15803D] font-mono">{maxRedeemable.toLocaleString()}<span className="text-[11px] ml-1 font-normal">pts</span></div>
          </div>
        </div>
        <div className="px-5 pb-1 text-[10px] text-slate-500">
          Conversion: <b>{redeemRate} pts = $1.00</b>
        </div>

        {/* Entry display */}
        <div className="px-5 py-3">
          <div className="rounded-lg py-4 flex items-center justify-center gap-2"
            style={{background: exceeds?'#FEE2E2':'#FEF3C7', border: `2px solid ${exceeds?'#fca5a5':'#FCD34D'}`}}>
            <span className="text-[24px] font-bold" style={{color: exceeds?'#dc2626':'#B45309'}}>⭐</span>
            <span className="text-[40px] font-bold font-mono leading-none" style={{color: exceeds?'#dc2626':'#B45309'}}>{input||'0'}</span>
            <span className="text-[16px] font-bold text-[#B45309]">pts</span>
          </div>
          <div className="text-center mt-2 text-[12px]">
            {ptsNum > 0 && !exceeds && (
              <span className="text-slate-600">
                = <b className="text-[#15803D]">−${cashValue.toFixed(2)}</b> off
                <span className="text-slate-400 mx-1">·</span>
                {remaining.toLocaleString()} pts left after
              </span>
            )}
            {exceeds && (
              <span className="text-[#dc2626] font-bold">
                ⚠ Exceeds max ({maxRedeemable.toLocaleString()} pts)
              </span>
            )}
          </div>
        </div>

        {/* Numpad */}
        <div className="px-4 pb-4 grid grid-cols-3 gap-2">
          {['7','8','9','4','5','6','1','2','3','00','0','⌫'].map(k=>(
            <button key={k} onClick={()=>press(k)}
              className="rounded-xl py-3 text-[20px] font-bold cursor-pointer border-2 active:scale-95"
              style={k==='⌫'?{background:'#fff1f2',borderColor:'#fecdd3',color:'#ef4444'}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#1F1F1F'}}>
              {k}
            </button>
          ))}
          <button onClick={()=>setInput(String(maxRedeemable))}
            className="rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border-2"
            style={{background:'#DCFCE7', borderColor:'#86efac', color:'#15803D'}}>
            Use Max
          </button>
          <button onClick={()=>setInput('')}
            disabled={!input}
            className="rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border-2 disabled:opacity-40"
            style={{background:'#fff7ed',borderColor:'#fed7aa',color:'#ea580c'}}>
            Clear
          </button>
          <button onClick={()=>{ if (currentPoints > 0) onConfirm(0) ; else onClose() }}
            className="rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border-2"
            style={{background:'#f8fafc', borderColor:'#cbd5e1', color:'#64748b'}}>
            {currentPoints > 0 ? 'Remove' : 'Cancel'}
          </button>
          <button onClick={()=>{ if (!exceeds && ptsNum > 0) onConfirm(ptsNum) }}
            disabled={exceeds || ptsNum <= 0}
            className="col-span-3 rounded-lg py-3.5 text-[15px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background:'#000000'}}>
            ✓ Apply {ptsNum > 0 ? `${ptsNum} pts · −$${cashValue.toFixed(2)}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}


function CouponInputModal({ onConfirm, onClose }) {
  const [code, setCode] = useState('')
  const [validating, setValidating] = useState(false)

  const submit = async () => {
    const c = code.trim().toUpperCase()
    if (!c) { toast.error('Enter a coupon code'); return }
    setValidating(true)
    try { await onConfirm(c) } finally { setValidating(false) }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{background:'rgba(0,0,0,0.4)', backdropFilter:'blur(2px)'}}>
      <div className="rounded-lg overflow-hidden shadow-xl" style={{width:'420px', background:'#fff'}}>
        <div className="px-5 py-4 flex items-center justify-between" style={{background:'#000000'}}>
          <div className="text-[18px] font-bold text-white">🎫 Enter Coupon</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
        </div>
        <div className="px-5 py-5">
          <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">
            Type or scan the coupon code
          </div>
          <input autoFocus
            value={code}
            onChange={e=>setCode(e.target.value.toUpperCase().replace(/\s/g,''))}
            onKeyDown={e=>{ if(e.key==='Enter') submit() }}
            placeholder="SUMMER10"
            className="w-full rounded-lg px-4 py-3 text-[18px] outline-none font-mono font-bold tracking-wider text-center"
            style={{border:'2px solid #80B2FF', background:'#E6F0FF', color:'#006AFF'}}/>
          <div className="text-[10px] text-slate-400 mt-2 text-center">
            Codes are case-insensitive. Press Enter to apply.
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose}
            className="flex-1 rounded-lg py-2.5 text-[13px] font-bold cursor-pointer"
            style={{background:'#fff', color:'#666', border:'1px solid #e2e8f0'}}>
            Cancel
          </button>
          <button onClick={submit} disabled={validating || !code}
            className="flex-1 rounded-lg py-2.5 text-[13px] font-bold cursor-pointer border-none disabled:opacity-50"
            style={{background:'#000000', color:'#fff'}}>
            {validating ? 'Checking...' : '✓ Apply Coupon'}
          </button>
        </div>
      </div>
    </div>
  )
}


export default function PaymentPanel() {
  const { totals, payments, addPayment, removePayment, paidAmount, submitOrder, setOrderDiscount, orderDiscount, appliedCoupon, setAppliedCoupon } = useCartStore()
  const { user, tenant, store } = useAuthStore()
  const { terminal, paxOnline } = useTerminalStore()
  const { activeEmployee } = useEmployeeStore()
  // Effective cashier — if an employee is signed in via PIN, use them;
  // otherwise fall back to the tenant-owner login. This is who gets
  // credited on every order, receipt, and report.
  const effCashierId   = activeEmployee?.id   || user?.id
  const effCashierName = activeEmployee?.name || user?.name || user?.email || 'Cashier'
  const { subtotal, taxAmount, orderDiscountAmt, couponDiscountAmt = 0, grandTotal } = totals()
  const { items, customer } = useCartStore()

  const [tip,       setTip]       = useState(0)
  const [feeLabel,  setFeeLabel]  = useState('Surcharge')
  const [feeAmt,    setFeeAmt]    = useState(0)
  const [taxExempt, setTaxExempt] = useState(false)
  const [adjTab,    setAdjTab]    = useState(null)
  const [discMode,  setDiscMode]  = useState('pct')
  const [showAdjPad,setShowAdjPad]= useState(false)
  const [showTipModal, setShowTipModal] = useState(false)
  const [showPointsPad, setShowPointsPad] = useState(false)
  const [showCouponPad, setShowCouponPad] = useState(false)
  const [selMethod, setSelMethod] = useState('cash')
  const [payInput,  setPayInput]  = useState('')
  const [showPayPad,setShowPayPad]= useState(false)
  const [paxState,  setPaxState]  = useState('idle')
  const [processing,setProcessing]= useState(false)
  const [receiptPrompt, setReceiptPrompt] = useState(null)  // { html, orderNumber, settings } or null

  // ── Points-redemption settings & computed limits ──────────────────
  const REDEEM_RATE  = tenant?.points_redeem_rate     || 100  // 100 pts = $1
  const MIN_PTS      = tenant?.redeem_min_pts         || 100
  const MAX_PTS_TXN  = tenant?.redeem_max_pts_per_txn  || 0   // 0 = unlimited
  const MAX_CASH_TXN = tenant?.redeem_max_cash_per_txn || 0
  const MAX_PCT_TXN  = tenant?.redeem_max_pct_per_txn  || 0
  const customerPts  = customer?.loyalty_points       || 0
  // Is current orderDiscount actually a points redemption?
  const pointsOrderDiscount = orderDiscount?.type === 'points_cash' ? orderDiscount : null
  const currentPts = pointsOrderDiscount?.points_used || 0

  const liveTotal = subtotal - orderDiscountAmt - couponDiscountAmt + (taxExempt?0:taxAmount) + tip + feeAmt
  const paid      = paidAmount()
  const remaining = Math.max(0, liveTotal - paid)
  const change    = paid > liveTotal ? paid - liveTotal : 0

  // Max points the user can apply right now (in pts):
  //  - never more than they have
  //  - never more than per-txn pts limit (if set)
  //  - never more than the cash-cap allows (× rate)
  //  - never more than pct cap of (pre-points) subtotal allows
  //  - never more than what brings cart total to $0
  // Re-add the current points discount when computing "what the order would
  // be before any points applied" so max recomputes consistently.
  const cartBeforePoints = liveTotal + currentPts / REDEEM_RATE
  const capByPts    = MAX_PTS_TXN  > 0 ? Math.min(customerPts, MAX_PTS_TXN)             : customerPts
  const capByCash   = MAX_CASH_TXN > 0 ? Math.min(capByPts,  MAX_CASH_TXN * REDEEM_RATE) : capByPts
  const capByPct    = MAX_PCT_TXN  > 0 ? Math.min(capByCash, Math.floor(cartBeforePoints * (MAX_PCT_TXN/100) * REDEEM_RATE)) : capByCash
  const capByOrder  = Math.floor(cartBeforePoints * REDEEM_RATE)
  const maxRedeemable = Math.max(0, Math.min(capByPct, capByOrder))

  useEffect(() => { setPayInput(remaining>0 ? remaining.toFixed(2) : '') }, [remaining, selMethod])

  const close = () => useCartStore.setState({ showPayPanel: false })

  const applyAdj = (v) => {
    if      (adjTab==='disc') setOrderDiscount({type:discMode, value:v})
    else if (adjTab==='tip')  setTip(v)
    else if (adjTab==='fee')  setFeeAmt(v)
    setShowAdjPad(false)
  }

  const applyPoints = (pts) => {
    if (pts === 0) {
      setOrderDiscount(null)
      toast.success('Points removed')
    } else {
      if (pts < MIN_PTS) {
        toast.error(`Minimum ${MIN_PTS} pts required to redeem`)
        return
      }
      setOrderDiscount({
        type: 'points_cash',
        amount: pts / REDEEM_RATE,
        points_used: pts,
      })
      toast.success(`Applied ${pts} pts (−$${(pts/REDEEM_RATE).toFixed(2)})`)
    }
    setShowPointsPad(false)
  }

  const applyCouponCode = async (code) => {
    if (!code) { toast.error('Enter a coupon code'); return }
    const { data, error } = await supabase.rpc('fn_validate_coupon', {
      p_tenant_id:   tenant.id,
      p_code:        code,
      p_subtotal:    subtotal,
      p_customer_id: customer?.id || null,
    })
    if (error)            { toast.error('Error: ' + error.message); return }
    if (!data?.success)   { toast.error(data?.message || 'Invalid coupon'); return }
    setAppliedCoupon(data.coupon)
    setShowCouponPad(false)
  }

  const handleCardPax = async (amount) => {
    setPaxState('waiting')
    try {
      const r = await paxSale({ paxIp:terminal.pax_ip, paxPort:terminal.pax_port||10009, amountCents:dollarsToCents(amount), invoiceNum:`POS-${Date.now().toString(36).toUpperCase()}` })
      if (r.success) {
        setPaxState('approved')
        addPayment({ method:'card', amount, reference:r.approvalCode, cardType:r.cardType, maskedPan:r.maskedPan })
        setTimeout(()=>setPaxState('idle'),2000)
      } else { setPaxState(r.status==='cancelled'?'cancelled':'declined'); setTimeout(()=>setPaxState('idle'),2000) }
    } catch(e) { setPaxState('error'); toast.error('PAX: '+e.message); setTimeout(()=>setPaxState('idle'),3000) }
  }

  const handleAddPayment = async () => {
    const amount = parseFloat(payInput) || remaining
    if (amount<=0) { toast.error('Enter amount'); return }
    if (selMethod==='card' && terminal?.pax_enabled) { handleCardPax(amount); return }
    addPayment({ method:selMethod, amount })
    const newPaid = paid + amount
    if (newPaid >= liveTotal) setTimeout(()=>handleComplete(newPaid), 400)
  }

  const handleComplete = async (overridePaid) => {
    const totalPaid = overridePaid || paid
    if (totalPaid < liveTotal && !payments.some(p=>p.method==='on_account')) { toast.error('Payment incomplete'); return }
    setProcessing(true)

    // Watchdog: payment is the riskiest place to be stuck — customer is
    // standing at the counter. Unstick at 20s with a clear "try again"
    // toast. submitOrder is idempotent: it generates a new order_number
    // each call, so retrying after a network blip is safe (worst case
    // creates a duplicate order which the cashier voids).
    const watchdog = setTimeout(() => {
      setProcessing(false)
      toast.error('⏱️ Payment is taking too long — check connection and try again', { duration: 6000 })
    }, 20_000)

    // ── Capture order data BEFORE submitting (cart will be cleared) ──
    const snapshotItems = items.map(it => {
      // Bulk pricing takes priority over manual itemDiscount
      const bulkTiers = getActiveBulkTiers(it)
      if (bulkTiers.length > 0 && !it.itemDiscount && !it.discount) {
        const bp = calculateBulkPrice(it.qty, it.unitPrice, bulkTiers)
        return {
          name: it.name, qty: it.qty,
          line_total: bp.lineTotal,
          bulk_breakdown: bp.breakdown,
          bulk_savings: bp.savings,
        }
      }
      const d = it.itemDiscount
      const lp = d ? (d.type==='pct' ? it.unitPrice*(1-d.value/100) : Math.max(0,it.unitPrice-d.value)) : it.unitPrice
      return { name: it.name, qty: it.qty, line_total: lp * it.qty }
    })
    const totalBulkSavings = snapshotItems.reduce((s, i) => s + (i.bulk_savings || 0), 0)
    const snapshotPayments = payments.map(p => ({ method:p.method, amount:p.amount }))
    const orderSnapshot = {
      items: snapshotItems,
      payments: snapshotPayments,
      subtotal,
      discount: orderDiscountAmt,
      bulk_savings: totalBulkSavings,
      tax: taxExempt ? 0 : taxAmount,
      total: liveTotal,
      change,
      cashier_name: effCashierName,
      customer_name: customer?.name || 'Walk-in',
      date: new Date().toLocaleString(),
    }

    try {
      const result = await submitOrder(store.id, effCashierId, tenant.id, TERMINAL_ID)
      if (!result) { setProcessing(false); return }  // submitOrder returned null on error

      toast.success('✓ Order saved!')

      // ── Auto-open cash drawer if any cash was used ──
      // Only fires when (a) drawer is enabled, (b) "open_on_cash" is on,
      // and (c) at least one payment in this order was cash. Kicked off
      // BEFORE the receipt prints so the drawer opens immediately and
      // the cashier can start counting change while the printer warms up.
      try {
        const drawerCfg = JSON.parse(localStorage.getItem('cashDrawerSettings') || '{}')
        const hadCash = payments.some(p => p.method === 'cash' && Number(p.amount) > 0)
        if (drawerCfg.enabled && drawerCfg.open_on_cash && hadCash) {
          openCashDrawer()  // fire-and-forget — don't block receipt
        }
      } catch { /* ignore */ }

      // ── Receipt logic ──
      const settings = getPrintingSettings()
      const storeInfo = {
        name: store?.name,
        address: [store?.address, store?.city, store?.state, store?.zip].filter(Boolean).join(', '),
        phone: store?.phone,
      }
      const receiptOrder = { ...orderSnapshot, order_number: result.order_number }
      const html = buildReceiptHTML(receiptOrder, settings, storeInfo)

      if (settings.autoMode === 'auto') {
        // Auto print + auto close
        printReceipt(html, settings.copies || 1)
        setTimeout(() => { close(); window.location.href = '/pos' }, 600)
      } else if (settings.autoMode === 'manual' && !settings.enableEmail && !settings.enableSms) {
        // Skip prompt, just close
        close()
        window.location.href = '/pos'
      } else {
        // Show prompt: ask mode OR (manual mode + email/sms enabled)
        setReceiptPrompt({ html, orderNumber: result.order_number, settings })
        setProcessing(false)
        // Don't close yet — user will click an action in the modal
      }
    } catch (err) {
      console.error('Payment submit error:', err)
      toast.error(err?.message || 'Payment failed — see console')
      setProcessing(false)
    } finally {
      clearTimeout(watchdog)
    }
  }

  const finishAndClose = () => {
    setReceiptPrompt(null)
    close()
    window.location.href = '/pos'
  }

  const enabledMethods = METHODS.filter(m => {
    if (m.id==='card') return terminal?.accept_card !== false
    if (m.id==='cash') return terminal?.accept_cash !== false
    if (m.id==='check') return terminal?.accept_check !== false
    if (m.id==='on_account') return terminal?.accept_on_account !== false
    return true
  })

  return (
    <Overlay onClose={paxState!=='idle'?undefined:close}>
      {/* Full screen no-scroll container */}
      <div className="rounded-lg overflow-hidden shadow-xl"
        style={{width:'min(1080px, 96vw)', height:'min(88vh, 800px)', background:'#FFFFFF', display:'grid', gridTemplateRows:'auto 1fr auto', gridTemplateColumns:'260px minmax(0, 1fr) 240px'}}>

        {/* ══ HEADER - full width ══ */}
        <div className="col-span-3 flex items-center justify-between px-6 py-4"
          style={{background:'#000000', gridRow:'1', gridColumn:'1 / -1'}}>
          <div className="flex items-center gap-4">
            {customer ? (
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-[16px] font-bold text-white"
                  style={{background:'rgba(255,255,255,0.2)'}}>
                  {customer.name.charAt(0)}
                </div>
                <div>
                  <div className="text-[14px] font-bold text-white">{customer.name}</div>
                  {customer.loyalty_points>0 && <div className="text-[10px] text-white/80">💎 {customer.loyalty_points} pts</div>}
                </div>
              </div>
            ) : <div className="text-[14px] text-white/80">🚶 Walk-in</div>}
            <div className="w-px h-8 bg-white/20"/>
            <div>
              <div className="text-[11px] text-white/80 uppercase tracking-wider">Due Now</div>
              <div className="text-[36px] font-bold text-white font-mono leading-none">${remaining.toFixed(2)}</div>
            </div>
            {paid > 0 && <>
              <div className="w-px h-8 bg-white/20"/>
              <div>
                <div className="text-[11px] text-white/80">Paid</div>
                <div className="text-[20px] font-bold text-green-300 font-mono">${paid.toFixed(2)}</div>
              </div>
            </>}
          </div>
          <div className="flex items-center gap-3">
            {terminal?.pax_enabled && (
              <div className={`text-[10px] font-bold px-3 py-1.5 rounded-full ${paxOnline?'bg-green-400/20 text-green-200':'bg-red-400/20 text-red-200'}`}>
                PAX {paxOnline?'● ON':'○ OFF'}
              </div>
            )}
            <button onClick={close} className="w-10 h-10 rounded-full bg-white/20 border-none cursor-pointer text-white text-[20px] flex items-center justify-center">✕</button>
          </div>
        </div>

        {/* ══ COL 1: ORDER SUMMARY ══ */}
        <div className="flex flex-col overflow-hidden"
          style={{gridRow:'2', gridColumn:'1', background:'#fff', borderRight:'1px solid #e2e8f0', minHeight:0}}>

          {/* Items - scrollable but compact */}
          <div className="flex-1 overflow-y-auto px-3 py-2" style={{minHeight:0}}>
            {items.map((item,i)=>{
              const d = item.itemDiscount
              const lp = d ? d.type==='pct' ? item.unitPrice*(1-d.value/100) : Math.max(0,item.unitPrice-d.value) : item.unitPrice
              const total = lp * item.qty
              return (
                <div key={i} className="flex items-center gap-2 py-1.5"
                  style={{borderBottom:'1px solid #f8fafc'}}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-slate-700 truncate">{item.name}</div>
                    <div className="text-[10px] text-slate-400">${item.unitPrice.toFixed(2)} ×{Math.abs(item.qty)}</div>
                  </div>
                  <div className="text-[12px] font-bold font-mono flex-shrink-0"
                    style={{color:item.qty<0?'#ef4444':'#1F1F1F'}}>
                    ${Math.abs(total).toFixed(2)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Totals - always visible, compact */}
          <div className="flex-shrink-0 px-3 pb-3">
            <div className="rounded-lg overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
              {[
                ['Subtotal',   subtotal,         '#64748b', '#fff',     true],
                [orderDiscount?.type==='points_cash' ? `⭐ Points (${orderDiscount.points_used})` : '✂️ Disc',
                  -orderDiscountAmt, '#16a34a', orderDiscountAmt>0?'#f0fdf4':'#fff', true],
                ...(appliedCoupon ? [[`🎫 ${appliedCoupon.code}`, -couponDiscountAmt, '#c026d3', '#fdf4ff', true]] : []),
                [taxExempt?'🏛️ Tax':'Tax', taxExempt?0:taxAmount, taxExempt?'#2563eb':'#64748b', taxExempt?'#eff6ff':'#fff', true],
                ['🙏 Tip',     tip,               '#ca8a04', tip>0?'#fffbeb':'#fff', true],
                [`💼 Fee`,     feeAmt,            '#006AFF', feeAmt>0?'#fdf4ff':'#fff', true],
              ].map(([label,val,color,bg])=>(
                <div key={label} className="flex justify-between px-3 py-1.5 text-[11px]"
                  style={{borderBottom:'1px solid #f1f5f9', background:bg}}>
                  <span style={{color: val===0&&!label.includes('Subtotal')&&!label.includes('Tax')?'#cbd5e1':color}}>{label}</span>
                  <span className="font-mono font-bold"
                    style={{color: val===0&&!label.includes('Subtotal')&&!label.includes('Tax')?'#cbd5e1':color}}>
                    {val<0?`-$${Math.abs(val).toFixed(2)}`:val===0&&label!=='Subtotal'&&!label.includes('Tax')?'—':`$${Math.abs(val).toFixed(2)}`}
                  </span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-3"
                style={{background:'#000000'}}>
                <span className="text-[15px] font-bold text-white">TOTAL</span>
                <span className="text-[17px] font-bold font-mono text-white">${liveTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ══ COL 2: ADJUSTMENTS + PAYMENT ══ */}
        <div className="flex flex-col overflow-hidden px-4 py-3 gap-3"
          style={{gridRow:'2', gridColumn:'2', minHeight:0}}>

          {/* Adjustments - compact row */}
          <div className="rounded-lg overflow-hidden flex-shrink-0" style={{background:'#fff', border:'1.5px solid #e2e8f0'}}>
            <div className="px-4 py-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest"
              style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
              Invoice Adjustments
            </div>
            <div className="p-3 grid grid-cols-6 gap-2">
              {[
                ['disc','✂️','Discount','#16a34a','#f0fdf4', orderDiscount && orderDiscount.type !== 'points_cash' ?(orderDiscount.type==='pct'?`${orderDiscount.value}%`:`$${orderDiscount.value}`):null],
                ['tip', '🙏','Tip',     '#ca8a04','#fffbeb', tip>0?`$${tip.toFixed(2)}`:null],
                ['fee', '💼','Surcharge','#006AFF','#fdf4ff', feeAmt>0?`$${feeAmt.toFixed(2)}`:null],
              ].map(([id,icon,label,col,bg,applied])=>(
                <button key={id}
                  onClick={()=>{
                    if (id === 'tip') { setShowTipModal(true); return }
                    setAdjTab(id); setShowAdjPad(true)
                  }}
                  className="flex flex-col items-center py-3 rounded-xl cursor-pointer border-2 transition-all"
                  style={applied?{background:bg,borderColor:col}:{background:'#f8fafc',borderColor:'#e2e8f0'}}>
                  <span className="text-[20px]">{icon}</span>
                  <span className="text-[10px] font-bold mt-1" style={{color:applied?col:'#64748b'}}>{label}</span>
                  {applied
                    ? <span className="text-[11px] font-bold" style={{color:col}}>{applied}
                        <button onClick={e=>{e.stopPropagation(); if(id==='disc')setOrderDiscount(null); else if(id==='tip')setTip(0); else setFeeAmt(0)}}
                          className="ml-1 bg-transparent border-none cursor-pointer font-bold" style={{color:col}}>✕</button>
                      </span>
                    : <span className="text-[9px] text-slate-400">tap to set</span>
                  }
                </button>
              ))}
              {/* ── Coupon card (Phase 8) ── */}
              <button onClick={()=>setShowCouponPad(true)}
                className="flex flex-col items-center py-3 rounded-xl cursor-pointer border-2 transition-all"
                style={appliedCoupon
                  ? {background:'#fdf4ff', borderColor:'#c026d3'}
                  : {background:'#f8fafc', borderColor:'#e2e8f0'}}>
                <span className="text-[20px]">🎫</span>
                <span className="text-[10px] font-bold mt-1" style={{color: appliedCoupon ? '#c026d3' : '#64748b'}}>Coupon</span>
                {appliedCoupon
                  ? <span className="text-[11px] font-bold" style={{color:'#c026d3'}}>
                      {appliedCoupon.code}
                      <button onClick={e=>{e.stopPropagation(); setAppliedCoupon(null); toast.success('Coupon removed')}}
                        className="ml-1 bg-transparent border-none cursor-pointer font-bold" style={{color:'#c026d3'}}>✕</button>
                    </span>
                  : <span className="text-[9px] text-slate-400">scan or type</span>
                }
              </button>
              {/* ── Points card (Phase 7) ── */}
              <button
                onClick={()=>{
                  if (!customer) { toast.error('Select a customer first to use points'); return }
                  if (customerPts < MIN_PTS) { toast.error(`Customer needs at least ${MIN_PTS} pts (has ${customerPts})`); return }
                  if (maxRedeemable < MIN_PTS) { toast.error('Cart total too small to redeem points'); return }
                  setShowPointsPad(true)
                }}
                className="flex flex-col items-center py-3 rounded-xl cursor-pointer border-2 transition-all"
                style={currentPts>0
                  ? {background:'#FEF3C7', borderColor:'#FCD34D'}
                  : !customer || customerPts<MIN_PTS
                    ? {background:'#f8fafc', borderColor:'#e2e8f0', opacity:0.55}
                    : {background:'#f8fafc', borderColor:'#e2e8f0'}}>
                <span className="text-[20px]">⭐</span>
                <span className="text-[10px] font-bold mt-1" style={{color: currentPts>0 ? '#B45309' : '#64748b'}}>Points</span>
                {currentPts > 0
                  ? <span className="text-[11px] font-bold" style={{color:'#B45309'}}>
                      {currentPts} pts
                      <button onClick={e=>{e.stopPropagation(); setOrderDiscount(null)}}
                        className="ml-1 bg-transparent border-none cursor-pointer font-bold" style={{color:'#B45309'}}>✕</button>
                    </span>
                  : !customer
                    ? <span className="text-[9px] text-slate-400">no customer</span>
                    : customerPts < MIN_PTS
                      ? <span className="text-[9px] text-slate-400">{customerPts} pts</span>
                      : <span className="text-[9px] text-[#15803D] font-bold">{customerPts} avail</span>
                }
              </button>
              <button onClick={()=>setTaxExempt(!taxExempt)}
                className="flex flex-col items-center py-3 rounded-xl cursor-pointer border-2 transition-all"
                style={taxExempt?{background:'#eff6ff',borderColor:'#2563eb'}:{background:'#f8fafc',borderColor:'#e2e8f0'}}>
                <span className="text-[20px]">🏛️</span>
                <span className="text-[10px] font-bold mt-1" style={{color:taxExempt?'#2563eb':'#64748b'}}>Tax Exempt</span>
                <span className="text-[9px]" style={{color:taxExempt?'#2563eb':'#94a3b8'}}>{taxExempt?'ON':'tap to set'}</span>
              </button>
            </div>
          </div>

          {/* Payment method + input - fills remaining space */}
          <div className="rounded-lg overflow-hidden flex-1 flex flex-col" style={{background:'#fff', border:'1.5px solid #e2e8f0', minHeight:0}}>
            <div className="px-4 py-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest flex-shrink-0"
              style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
              Payment Method
            </div>
            <div className="flex-1 flex flex-col p-3 gap-3" style={{minHeight:0}}>
              {/* Method buttons */}
              <div className="flex-shrink-0 grid gap-2" style={{gridTemplateColumns:`repeat(${Math.min(enabledMethods.length,4)},1fr)`}}>
                {enabledMethods.map(m=>(
                  <button key={m.id} onClick={()=>setSelMethod(m.id)}
                    className="flex flex-col items-center py-3 rounded-xl cursor-pointer border-2 transition-all"
                    style={selMethod===m.id?{background:m.bg,borderColor:m.color}:{background:'#f8fafc',borderColor:'#e2e8f0'}}>
                    <span className="text-[20px]">{m.icon}</span>
                    <span className="text-[10px] font-bold mt-1"
                      style={{color:selMethod===m.id?m.color:'#64748b'}}>{m.label}</span>
                  </button>
                ))}
              </div>

              {/* PAX overlay */}
              {paxState!=='idle' && (
                <div className="rounded-xl p-4 text-center flex-shrink-0"
                  style={{background:'#E6F0FF', border:'2px solid #80B2FF'}}>
                  <div className="text-[32px]">{PAX_STATE[paxState]?.icon}</div>
                  <div className="text-[14px] font-bold text-slate-800">{PAX_STATE[paxState]?.label}</div>
                  {paxState==='waiting'&&(
                    <button onClick={async()=>{ await paxCancel({paxIp:terminal.pax_ip,paxPort:terminal.pax_port}); setPaxState('idle') }}
                      className="mt-2 rounded-xl px-4 py-2 text-[11px] font-bold cursor-pointer border"
                      style={{background:'#fff1f2',borderColor:'#fca5a5',color:'#dc2626'}}>Cancel</button>
                  )}
                </div>
              )}

              {/* Amount display + quick amounts */}
              {paxState==='idle' && remaining>0 && (
                <>
                  <button onClick={()=>setShowPayPad(true)}
                    className="flex-shrink-0 w-full rounded-lg px-4 py-4 text-left cursor-pointer border-2 transition-all"
                    style={{borderColor:'#80B2FF', background:'#E6F0FF'}}>
                    <div className="text-[10px] text-indigo-400 mb-0.5">Payment {payments.length+1} Amount</div>
                    <div className="text-[38px] font-bold font-mono leading-none" style={{color:'#006AFF'}}>
                      ${payInput||remaining.toFixed(2)}
                    </div>
                  </button>
                  <div className="flex-shrink-0 flex gap-2">
                    {[Math.ceil(remaining/5)*5, Math.ceil(remaining/10)*10, Math.ceil(remaining/20)*20, remaining]
                      .filter((v,i,a)=>v>=remaining&&a.indexOf(v)===i).slice(0,4)
                      .map(q=>(
                        <button key={q} onClick={()=>setPayInput(q.toFixed(2))}
                          className="flex-1 rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border-2 transition-all"
                          style={parseFloat(payInput)===q?{background:'#E6F0FF',borderColor:'#006AFF',color:'#006AFF'}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                          {q===remaining?'Exact':'$'+q}
                        </button>
                      ))
                    }
                  </div>
                  <button onClick={handleAddPayment}
                    className="flex-shrink-0 w-full rounded-lg py-4 text-[16px] font-bold text-white cursor-pointer border-none"
                    style={{background:METHODS.find(m=>m.id===selMethod)?.color||'#006AFF', boxShadow:'0 4px 16px rgba(0,0,0,0.2)'}}>
                    {METHODS.find(m=>m.id===selMethod)?.icon} Add {METHODS.find(m=>m.id===selMethod)?.label} — ${payInput||remaining.toFixed(2)}
                  </button>
                </>
              )}

              {paxState==='idle' && remaining<=0 && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-[48px] mb-2">✅</div>
                    <div className="text-[16px] font-bold text-green-600">Fully Paid!</div>
                    {change>0 && <div className="text-[14px] font-bold text-blue-600 mt-1">Change: ${change.toFixed(2)}</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══ COL 3: PAYMENTS LIST ══ */}
        <div className="flex flex-col overflow-hidden"
          style={{gridRow:'2', gridColumn:'3', background:'#fff', borderLeft:'1px solid #e2e8f0', minHeight:0}}>
          <div className="px-3 py-2.5 flex-shrink-0"
            style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Payments</div>
            <div className="text-[12px] font-bold mt-0.5" style={{color:paid>=liveTotal?'#16a34a':'#006AFF'}}>
              {paid>=liveTotal?'✓ Paid':payments.length===0?'None yet':`$${paid.toFixed(2)} paid`}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2" style={{minHeight:0}}>
            {payments.length===0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-300">
                <div className="text-[32px] mb-1">💳</div>
                <div className="text-[10px] text-center">Add payments</div>
              </div>
            ) : payments.map((p,i)=>{
              const m = METHODS.find(x=>x.id===p.method)
              return (
                <div key={i} className="rounded-lg p-3 flex-shrink-0"
                  style={{background:m?.bg||'#f8fafc', border:`1.5px solid ${m?.border||'#e2e8f0'}`}}>
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{color:m?.color}}>#{i+1} {m?.label}</span>
                    <button onClick={()=>removePayment(i)}
                      className="w-5 h-5 rounded-full border-none cursor-pointer text-[10px] font-bold flex items-center justify-center"
                      style={{background:'rgba(239,68,68,0.1)',color:'#ef4444'}}>✕</button>
                  </div>
                  <div className="text-[20px] font-bold font-mono" style={{color:m?.color}}>${p.amount.toFixed(2)}</div>
                  {p.maskedPan&&<div className="text-[9px] text-slate-400 mt-0.5">•••• {p.maskedPan.slice(-4)}</div>}
                </div>
              )
            })}
          </div>
          {remaining>0&&paid>0&&(
            <div className="p-2.5 flex-shrink-0">
              <div className="rounded-xl px-3 py-2" style={{background:'#fef2f2',border:'1.5px solid #fca5a5'}}>
                <div className="text-[9px] font-bold text-red-500">Still Owing</div>
                <div className="text-[18px] font-bold font-mono text-red-600">${remaining.toFixed(2)}</div>
              </div>
            </div>
          )}
          {change>0&&(
            <div className="p-2.5 flex-shrink-0">
              <div className="rounded-xl px-3 py-2" style={{background:'#eff6ff',border:'1.5px solid #93c5fd'}}>
                <div className="text-[9px] font-bold text-blue-500">Change</div>
                <div className="text-[18px] font-bold font-mono text-blue-600">${change.toFixed(2)}</div>
              </div>
            </div>
          )}
        </div>

        {/* ══ FOOTER - full width ══ */}
        <div className="col-span-3 px-6 py-4 flex items-center gap-4"
          style={{gridRow:'3', gridColumn:'1 / -1', background:'#fff', borderTop:'1px solid #e2e8f0'}}>
          <button onClick={close}
            className="rounded-lg px-6 py-3.5 text-[14px] font-bold cursor-pointer border-2"
            style={{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
            ← Back
          </button>
          <button onClick={()=>handleComplete()}
            disabled={processing||(paid<liveTotal&&!payments.some(p=>p.method==='on_account'))}
            className="flex-1 rounded-lg py-4 text-[18px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background:'#00B23B', boxShadow:'0 4px 20px rgba(22,163,74,0.35)'}}>
            {processing?'⏳ Processing...': remaining<=0 ? `✓ Complete Order — $${liveTotal.toFixed(2)}` : `Complete ($${paid.toFixed(2)} of $${liveTotal.toFixed(2)})`}
          </button>
        </div>
      </div>

      {showAdjPad && <DiscountNumPad adjTab={adjTab} discMode={discMode} setDiscMode={setDiscMode} onConfirm={applyAdj} onClose={()=>setShowAdjPad(false)}/>}
      {showTipModal && (
        <TipModal
          subtotal={subtotal}
          currentTip={tip}
          onApply={(amt) => { setTip(amt); setShowTipModal(false) }}
          onClose={() => setShowTipModal(false)}
        />
      )}
      {showPointsPad && (
        <PointsRedeemNumPad
          customerPts={customerPts}
          maxRedeemable={maxRedeemable}
          redeemRate={REDEEM_RATE}
          currentPoints={currentPts}
          onConfirm={applyPoints}
          onClose={()=>setShowPointsPad(false)}/>
      )}
      {showCouponPad && (
        <CouponInputModal
          onConfirm={applyCouponCode}
          onClose={()=>setShowCouponPad(false)}/>
      )}

      {showPayPad && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center"
          style={{background:'rgba(0,0,0,0.4)', backdropFilter:'blur(2px)'}}>
          <div className="rounded-lg overflow-hidden shadow-xl" style={{width:'360px',background:'#fff'}}>
            <div className="px-5 py-4 flex items-center justify-between"
              style={{background:METHODS.find(m=>m.id===selMethod)?.color||'#006AFF'}}>
              <div>
                <div className="text-[12px] text-white/70">Payment {payments.length+1}</div>
                <div className="text-[18px] font-bold text-white">{METHODS.find(m=>m.id===selMethod)?.icon} {METHODS.find(m=>m.id===selMethod)?.label}</div>
              </div>
              <button onClick={()=>setShowPayPad(false)} className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
            </div>
            <div className="px-5 py-3">
              <div className="text-[11px] text-slate-400 mb-1">Remaining: ${remaining.toFixed(2)}</div>
              <div className="rounded-lg py-4 flex items-center justify-center gap-1"
                style={{background:'#E6F0FF',border:'2px solid #80B2FF'}}>
                <span className="text-[26px] font-bold text-indigo-400">$</span>
                <span className="text-[44px] font-bold font-mono leading-none" style={{color:'#006AFF'}}>{payInput||'0'}</span>
              </div>
            </div>
            <div className="px-4 pb-4 grid grid-cols-3 gap-2">
              {['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k=>(
                <button key={k} onClick={()=>{
                  if(k==='⌫'){setPayInput(i=>i.slice(0,-1));return}
                  if(k==='.'&&payInput.includes('.'))return
                  setPayInput(i=>i+k)
                }}
                  className="rounded-xl py-3.5 text-[20px] font-bold cursor-pointer border-2 active:scale-95"
                  style={k==='⌫'?{background:'#fff1f2',borderColor:'#fecdd3',color:'#ef4444'}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#1F1F1F',boxShadow:'0 2px 0 #d1d5db'}}>
                  {k}
                </button>
              ))}
              <button onClick={()=>setPayInput('')}
                disabled={!payInput}
                className="col-span-3 rounded-xl py-2.5 text-[13px] font-bold cursor-pointer border-2 disabled:opacity-40"
                style={{background:'#fff7ed',borderColor:'#fed7aa',color:'#ea580c'}}>
                ✕ Clear
              </button>
              <button onClick={()=>{setPayInput(remaining.toFixed(2));setShowPayPad(false);setTimeout(()=>handleAddPayment(),50)}}
                className="col-span-3 rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border-2 mb-1"
                style={{background:'#f0fdf4',borderColor:'#86efac',color:'#16a34a'}}>
                Exact — ${remaining.toFixed(2)} (auto pay)
              </button>
              <button onClick={()=>{if(parseFloat(payInput)>0){setShowPayPad(false);setTimeout(()=>handleAddPayment(),50)}}}
                disabled={!payInput||parseFloat(payInput)<=0}
                className="col-span-3 rounded-lg py-4 text-[15px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                style={{background:'#00B23B'}}>
                ✓ Pay ${payInput?parseFloat(payInput).toFixed(2):'0.00'}
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptPrompt && (
        <ReceiptPromptModal
          html={receiptPrompt.html}
          orderNumber={receiptPrompt.orderNumber}
          settings={receiptPrompt.settings}
          tenantId={tenant?.id}
          customerId={customer?.id}
          customerEmail={customer?.email}
          customerPhone={customer?.phone}
          onDone={finishAndClose}
        />
      )}
    </Overlay>
  )
}

// ════════════════════════════════════════════════
// 🧾 ReceiptPromptModal — Square white-theme style
// ════════════════════════════════════════════════
function ReceiptPromptModal({ html, orderNumber, settings, tenantId, customerId, customerEmail, customerPhone, onDone }) {
  const [email, setEmail] = useState(customerEmail || '')
  const [phone, setPhone] = useState(customerPhone || '')
  const [busy,  setBusy]  = useState(false)
  const [done,  setDone]  = useState({ printChoice: null, emailed: false, smsed: false })
  const [showEmailKB, setShowEmailKB] = useState(false)
  const [showPhoneKB, setShowPhoneKB] = useState(false)
  const [quota, setQuota] = useState(null)  // { email_used, email_quota, sms_used, sms_quota, e_rate, s_rate }

  // Fetch quota status once on mount so we can show overage warnings
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { supabase } = await import('@/lib/supabase')
        const { data } = await supabase.from('tenant_messaging')
          .select('email_used_month, plan_email_quota, sms_used_month, plan_sms_quota, email_per_overage_cents, sms_per_overage_cents')
          .eq('tenant_id', tenantId).maybeSingle()
        if (alive && data) setQuota({
          email_used: data.email_used_month, email_quota: data.plan_email_quota,
          sms_used:   data.sms_used_month,   sms_quota:   data.plan_sms_quota,
          e_rate: data.email_per_overage_cents / 100,
          s_rate: data.sms_per_overage_cents / 100,
        })
      } catch {}
    })()
    return () => { alive = false }
  }, [tenantId])

  // True if THIS send would be an overage
  const emailIsOverage = quota && (quota.email_used >= quota.email_quota)
  const smsIsOverage   = quota && (quota.sms_used >= quota.sms_quota)

  const handlePrint = () => {
    printReceipt(html, settings.copies || 1)
    setDone(d => ({ ...d, printChoice: 'yes' }))
    toast.success(`Printing ${settings.copies||1} cop${settings.copies>1?'ies':'y'}...`)
  }
  const handleNoPrint = () => setDone(d => ({ ...d, printChoice: 'no' }))

  const cleanPhone = (p) => String(p||'').replace(/\D/g, '')

  // After successfully sending, if the customer is a member and didn't have
  // this contact on file yet, save it for next time. Best-effort, silent.
  const persistContactIfNew = async (field, value) => {
    if (!customerId || !value) return
    if (field === 'email' && customerEmail) return  // already had it
    if (field === 'phone' && customerPhone) return  // already had it
    try {
      const { supabase } = await import('@/lib/supabase')
      await supabase.from('customers').update({ [field]: value }).eq('id', customerId)
    } catch {}
  }

  const handleEmail = async () => {
    if (!isValidEmail(email)) { toast.error('Invalid email'); return }
    setBusy(true)
    const r = await sendEmailReceipt(email, html, orderNumber, tenantId)
    setBusy(false)
    if (r.ok) {
      toast.success(r.msg)
      setDone(d => ({ ...d, emailed:true }))
      persistContactIfNew('email', email)
    }
    else toast.error(r.msg)
  }

  const handleSms = async () => {
    const cleaned = cleanPhone(phone)
    if (!isValidPhone(cleaned)) { toast.error('Invalid phone (need 10+ digits)'); return }
    setBusy(true)
    const r = await sendSmsReceipt(cleaned, html, orderNumber, tenantId)
    setBusy(false)
    if (r.ok) {
      toast.success(r.msg)
      setDone(d => ({ ...d, smsed:true }))
      persistContactIfNew('phone', cleaned)
    }
    else toast.error(r.msg)
  }

  const displayPhone = (v) => {
    if (!v) return ''
    const d = v.replace(/\D/g,'')
    if (d.length === 0) return v.startsWith('+') ? v : ''
    if (d.length <= 3) return `(${d}`
    if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
    if (d.length <= 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
    return v
  }

  return (
    <>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4"
        style={{background:'rgba(0,0,0,0.45)'}}>
        <div className="rounded-lg overflow-hidden" style={{
          width:'520px', maxWidth:'100%', background:'#FFFFFF', maxHeight:'94vh', overflowY:'auto',
          boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
        }}>

          <div className="px-6 py-5 text-center" style={{background:'#FFFFFF', borderBottom:'1px solid #E5E5E5'}}>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-3" style={{background:'#E6F7EC'}}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="#00B23B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="text-[18px] font-semibold" style={{color:'#1F1F1F'}}>Order Complete</div>
            <div className="text-[12px] font-mono mt-1" style={{color:'#666666'}}>#{orderNumber}</div>
          </div>

          <div className="px-6 py-5 space-y-5" style={{background:'#FAFAFA'}}>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{color:'#666666'}}>Paper Receipt</div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={handlePrint} disabled={busy}
                  className="rounded-lg py-5 px-3 cursor-pointer active:scale-[0.98] transition-all disabled:opacity-50"
                  style={done.printChoice === 'yes'
                    ? { background:'#E6F7EC', border:'2px solid #00B23B', color:'#00B23B' }
                    : { background:'#FFFFFF', border:'1px solid #E5E5E5', color:'#1F1F1F' }}>
                  <div className="text-[28px] mb-1.5">🖨️</div>
                  <div className="text-[15px] font-semibold">{done.printChoice === 'yes' ? 'Printed ✓' : 'Print'}</div>
                  <div className="text-[11px] mt-0.5" style={{color: done.printChoice === 'yes' ? '#00B23B' : '#666666'}}>{settings.copies||1} cop{settings.copies>1?'ies':'y'}</div>
                </button>
                <button onClick={handleNoPrint} disabled={busy}
                  className="rounded-lg py-5 px-3 cursor-pointer active:scale-[0.98] transition-all disabled:opacity-50"
                  style={done.printChoice === 'no'
                    ? { background:'#F5F5F5', border:'2px solid #1F1F1F', color:'#1F1F1F' }
                    : { background:'#FFFFFF', border:'1px solid #E5E5E5', color:'#1F1F1F' }}>
                  <div className="text-[28px] mb-1.5">✕</div>
                  <div className="text-[15px] font-semibold">{done.printChoice === 'no' ? 'Skipped ✓' : 'No Print'}</div>
                  <div className="text-[11px] mt-0.5" style={{color:'#666666'}}>Skip paper</div>
                </button>
              </div>
            </div>

            {settings.enableEmail && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{color:'#666666'}}>Email Receipt</div>
                  {quota && (
                    emailIsOverage
                      ? <div className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{background:'#faf5ff', color:'#9333ea'}}>
                          ⚠️ +${quota.e_rate.toFixed(2)} overage
                        </div>
                      : <div className="text-[10px] px-2 py-0.5 rounded-full"
                          style={{background:'#f0fdf4', color:'#15803d'}}>
                          ✓ Free ({quota.email_quota - quota.email_used} left)
                        </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowEmailKB(true)} disabled={busy}
                    className="flex-1 rounded-lg px-4 py-3 text-left cursor-pointer disabled:opacity-50"
                    style={{background:'#FFFFFF', border:'1px solid #E5E5E5'}}>
                    <div className="text-[10px] font-semibold uppercase" style={{color:'#666666'}}>Tap to {email?'edit':'enter'}</div>
                    <div className="text-[15px] font-mono truncate min-h-[20px]" style={{color: email?'#1F1F1F':'#999999'}}>
                      {email || 'customer@example.com'}
                    </div>
                  </button>
                  <button onClick={handleEmail} disabled={busy || !email}
                    className="rounded-lg px-5 text-[14px] font-semibold cursor-pointer disabled:opacity-40 active:scale-[0.98]"
                    style={done.emailed
                      ? { background:'#00B23B', color:'#FFFFFF', border:'none', minWidth:'90px' }
                      : { background:'#006AFF', color:'#FFFFFF', border:'none', minWidth:'90px' }}>
                    {done.emailed ? 'Sent ✓' : 'Send'}
                  </button>
                </div>
              </div>
            )}

            {settings.enableSms && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{color:'#666666'}}>SMS Receipt</div>
                  {quota && (
                    smsIsOverage
                      ? <div className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{background:'#faf5ff', color:'#9333ea'}}>
                          ⚠️ +${quota.s_rate.toFixed(2)} overage
                        </div>
                      : <div className="text-[10px] px-2 py-0.5 rounded-full"
                          style={{background:'#f0fdf4', color:'#15803d'}}>
                          ✓ Free ({quota.sms_quota - quota.sms_used} left)
                        </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowPhoneKB(true)} disabled={busy}
                    className="flex-1 rounded-lg px-4 py-3 text-left cursor-pointer disabled:opacity-50"
                    style={{background:'#FFFFFF', border:'1px solid #E5E5E5'}}>
                    <div className="text-[10px] font-semibold uppercase" style={{color:'#666666'}}>Tap to {phone?'edit':'enter'}</div>
                    <div className="text-[15px] font-mono truncate min-h-[20px]" style={{color: phone?'#1F1F1F':'#999999'}}>
                      {phone ? displayPhone(phone) : '(555) 123-4567'}
                    </div>
                  </button>
                  <button onClick={handleSms} disabled={busy || !phone}
                    className="rounded-lg px-5 text-[14px] font-semibold cursor-pointer disabled:opacity-40 active:scale-[0.98]"
                    style={done.smsed
                      ? { background:'#00B23B', color:'#FFFFFF', border:'none', minWidth:'90px' }
                      : { background:'#006AFF', color:'#FFFFFF', border:'none', minWidth:'90px' }}>
                    {done.smsed ? 'Sent ✓' : 'Send'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="px-6 py-4" style={{background:'#FFFFFF', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onDone}
              className="w-full rounded-lg py-4 text-[15px] font-semibold cursor-pointer active:scale-[0.98]"
              style={{background:'#000000', color:'#FFFFFF', border:'none'}}>
              Done — Next Order
            </button>
          </div>
        </div>
      </div>

      {showEmailKB && (
        <QWERTYKeyboard value={email} onChange={setEmail} onClose={() => setShowEmailKB(false)}
          title="Customer Email" mode="email" placeholder="customer@example.com"/>
      )}

      {showPhoneKB && (
        <NumericKeypad value={phone} onChange={setPhone} onClose={() => setShowPhoneKB(false)}
          title="Customer Phone" placeholder="(555) 123-4567" formatPhone={true}/>
      )}
    </>
  )
}


// ════════════════════════════════════════════════════════════════
// 🙏 TipModal — preset % buttons + custom $ entry
// ════════════════════════════════════════════════════════════════
// Big-key Square-style tip selector. Defaults: 15% / 18% / 20% +
// custom $ + No tip. Calculates the $ amount live from the subtotal
// so the cashier and customer both see what the gratuity will be.
function TipModal({ subtotal, currentTip, onApply, onClose }) {
  // Presets
  const PRESETS = [15, 18, 20, 25]

  const [mode, setMode] = useState(currentTip > 0 ? 'custom' : 'preset')
  const [pct,  setPct]  = useState(18)
  const [customStr, setCustomStr] = useState(currentTip > 0 ? currentTip.toFixed(2) : '')

  // Compute the $ value to apply based on current mode
  const presetAmt = +(subtotal * (pct / 100)).toFixed(2)
  const customAmt = parseFloat(customStr) || 0
  const tipAmt = mode === 'preset' ? presetAmt : customAmt

  const press = (k) => {
    if (k === '.') {
      if (!customStr.includes('.')) setCustomStr(p => (p || '0') + '.')
    } else if (k === '⌫') {
      setCustomStr(p => p.slice(0, -1))
    } else {
      // Limit to two decimal places
      const parts = (customStr + k).split('.')
      if (parts[1] && parts[1].length > 2) return
      setCustomStr(p => p + k)
    }
  }

  return (
    <div className="fixed inset-0 z-[420] flex items-center justify-center p-3"
      style={{background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)'}}
      onClick={onClose}>
      <div className="rounded-3xl overflow-hidden shadow-2xl w-full"
        style={{maxWidth:'440px', background:'#fff'}}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'linear-gradient(135deg, #ca8a04 0%, #92400e 100%)'}}>
          <div>
            <div className="text-[16px] font-bold text-white">🙏 Add Gratuity</div>
            <div className="text-[11px] text-amber-100 mt-0.5">
              Subtotal: ${subtotal.toFixed(2)}
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px]">✕</button>
        </div>

        <div className="px-5 py-4">
          {/* Mode tabs */}
          <div className="flex gap-2 mb-4">
            <button onClick={()=>setMode('preset')}
              className="flex-1 rounded-lg py-2 text-[12px] font-bold cursor-pointer border-2 transition-all"
              style={mode==='preset'
                ? {background:'#fffbeb', borderColor:'#ca8a04', color:'#92400e'}
                : {background:'#fff', borderColor:'#e2e8f0', color:'#94a3b8'}}>
              % Percentage
            </button>
            <button onClick={()=>setMode('custom')}
              className="flex-1 rounded-lg py-2 text-[12px] font-bold cursor-pointer border-2 transition-all"
              style={mode==='custom'
                ? {background:'#fffbeb', borderColor:'#ca8a04', color:'#92400e'}
                : {background:'#fff', borderColor:'#e2e8f0', color:'#94a3b8'}}>
              $ Custom
            </button>
          </div>

          {mode === 'preset' && (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {PRESETS.map(p => {
                  const amt = (subtotal * (p / 100)).toFixed(2)
                  const selected = pct === p
                  return (
                    <button key={p} onClick={()=>setPct(p)}
                      className="rounded-2xl py-4 cursor-pointer border-2 transition-all active:scale-95"
                      style={selected
                        ? {background:'linear-gradient(135deg, #fef3c7 0%, #fde047 100%)', borderColor:'#ca8a04'}
                        : {background:'#fff', borderColor:'#e5e5e5'}}>
                      <div className="text-[24px] font-bold" style={{color: selected ? '#92400e' : '#1F1F1F'}}>
                        {p}%
                      </div>
                      <div className="text-[12px] font-mono mt-1" style={{color: selected ? '#92400e' : '#666'}}>
                        ${amt}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="rounded-xl px-4 py-3 mb-3 flex justify-between items-center"
                style={{background:'#fffbeb', border:'1px solid #fde68a'}}>
                <span className="text-[12px] font-bold text-[#92400e]">Tip amount</span>
                <span className="text-[20px] font-bold font-mono text-[#92400e]">${presetAmt.toFixed(2)}</span>
              </div>
            </>
          )}

          {mode === 'custom' && (
            <>
              <div className="rounded-2xl px-4 py-5 mb-3 text-center"
                style={{background:'#fffbeb', border:'2px solid #fde68a'}}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#92400e] mb-1">Custom Tip</div>
                <div className="text-[36px] font-bold font-mono text-[#92400e]">
                  ${customStr || '0'}
                  {!customStr && <span className="text-[14px] text-[#ca8a04]/50 ml-1">.00</span>}
                </div>
                {subtotal > 0 && customAmt > 0 && (
                  <div className="text-[10px] text-[#ca8a04] mt-1">
                    ≈ {((customAmt / subtotal) * 100).toFixed(1)}%
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map(k => (
                  <button key={k} onClick={()=>press(k)}
                    className="rounded-xl text-[20px] font-bold cursor-pointer border-2 active:scale-95"
                    style={{
                      background: k === '⌫' ? '#fff1f2' : '#f8fafc',
                      borderColor: k === '⌫' ? '#fecdd3' : '#e5e5e5',
                      color: k === '⌫' ? '#ef4444' : '#1f1f1f',
                      height:'52px',
                    }}>
                    {k}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button onClick={()=>{ onApply(0); }}
              className="flex-1 rounded-xl py-3 text-[13px] font-bold cursor-pointer border-2"
              style={{background:'#fff', borderColor:'#e5e5e5', color:'#666'}}>
              No Tip
            </button>
            <button onClick={()=>onApply(tipAmt)} disabled={tipAmt <= 0 && mode === 'custom'}
              className="flex-[2] rounded-xl py-3 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
              style={{background:'linear-gradient(135deg, #ca8a04 0%, #92400e 100%)'}}>
              ✓ Apply ${tipAmt.toFixed(2)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
