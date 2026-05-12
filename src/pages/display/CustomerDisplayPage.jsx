// src/pages/display/CustomerDisplayPage.jsx
// Customer-facing display for a second screen (副屏) on the same browser as
// the POS. Listens to BroadcastChannel for cart updates and renders:
//
//  1. IDLE         — Logo + welcome + promo carousel + language switcher
//  2. ACTIVE       — Live cart with items, totals, member info / join-CTA
//  3. PAYMENT      — Big "Please Pay $X" with optional tip/sig/email/sms
//  4. THANK YOU    — Order complete confirmation
//
// State is driven entirely by what the POS publishes. The display has no
// local state beyond UI animations and language preference.

import { useEffect, useState, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { getDisplaySync, EVT } from '@/lib/displaySync'
import { APP_VERSION } from '@/lib/version'

const T = {
  en: {
    welcome: 'Welcome',
    thankyou: 'Thank you for shopping with us',
    your_total: 'Your Total',
    subtotal: 'Subtotal',
    tax: 'Tax',
    discount: 'Discount',
    coupon: 'Coupon',
    member: 'Member',
    points: 'points',
    join_member: 'Join our rewards & save on every visit',
    enter_phone: 'Enter your phone',
    no_items: 'Ready to start',
    ask_associate: 'Ask the associate to begin',
    items: 'items',
    total: 'Total',
    please_pay: 'Please Pay',
    select_tip: 'Add a Tip?',
    no_tip: 'No Tip',
    custom_tip: 'Custom',
    sign_here: 'Sign Here',
    submit: 'Submit',
    clear: 'Clear',
    skip: 'Skip',
    order_complete: 'Order Complete',
    receipt_via: 'How would you like your receipt?',
    email: 'Email',
    sms: 'SMS',
    none: 'No Receipt',
    enter_email: 'Enter email address',
    enter_phone_long: 'Enter phone number',
  },
  zh: {
    welcome: '欢迎光临',
    thankyou: '感谢您的光顾',
    your_total: '总计',
    subtotal: '小计',
    tax: '税',
    discount: '折扣',
    coupon: '优惠券',
    member: '会员',
    points: '积分',
    join_member: '加入会员，购物有惊喜',
    enter_phone: '输入手机号',
    no_items: '准备开始',
    ask_associate: '请告知收银员',
    items: '件',
    total: '总计',
    please_pay: '请支付',
    select_tip: '添加小费',
    no_tip: '不加小费',
    custom_tip: '自定义',
    sign_here: '请签名',
    submit: '提交',
    clear: '清除',
    skip: '跳过',
    order_complete: '订单完成',
    receipt_via: '收据接收方式',
    email: '电邮',
    sms: '短信',
    none: '不要收据',
    enter_email: '输入邮箱',
    enter_phone_long: '输入手机号',
  },
}

export default function CustomerDisplayPage() {
  const params = useParams()
  const [search] = useSearchParams()
  const terminalId = params.terminalId || search.get('terminal') || 'default'
  const tenantId   = search.get('tenant') || null

  const [lang,       setLang]       = useState(localStorage.getItem('display_lang') || 'en')
  const [cartState,  setCartState]  = useState(null)
  const [mode,       setMode]       = useState('idle')   // idle | active | payment | thankyou | tip | sig | contact
  const [promoIdx,   setPromoIdx]   = useState(0)
  const [clockNow,   setClockNow]   = useState(new Date())
  const t = T[lang] || T.en

  // ── Load tenant display settings (logo, promo images, feature toggles) ──
  const { data: settings } = useQuery({
    queryKey: ['display-settings', tenantId],
    queryFn: async () => {
      if (!tenantId) return null
      const { data } = await supabase.from('tenants')
        .select('name, display_settings, notification_settings')
        .eq('id', tenantId).maybeSingle()
      return data
    },
    enabled: !!tenantId,
  })

  const ds  = settings?.display_settings || {}
  const promos = Array.isArray(ds.promo_images) ? ds.promo_images : []

  // ── Subscribe to POS broadcasts ──
  useEffect(() => {
    const sync = getDisplaySync(terminalId)

    const u1 = sync.subscribe(EVT.CART_STATE, (data) => {
      setCartState(data)
      // Auto mode based on cart content (unless POS explicitly set a mode)
      if (data?.items?.length > 0) setMode(m => m === 'thankyou' || m === 'idle' ? 'active' : m)
      else setMode(m => m === 'thankyou' ? 'thankyou' : 'idle')
    })
    const u2 = sync.subscribe(EVT.PAYMENT_OPEN, () => setMode('payment'))
    const u3 = sync.subscribe(EVT.PAYMENT_CLOSE, () => setMode('active'))
    const u4 = sync.subscribe(EVT.REQUEST_TIP, () => setMode('tip'))
    const u5 = sync.subscribe(EVT.REQUEST_SIG, () => setMode('sig'))
    const u6 = sync.subscribe(EVT.REQUEST_CONTACT, () => setMode('contact'))
    const u7 = sync.subscribe(EVT.ORDER_DONE, () => {
      setMode('thankyou')
      // Auto-return to idle after 5 seconds
      setTimeout(() => setMode('idle'), 5000)
    })

    // Announce we're alive so POS can re-publish current state
    sync.publish(EVT.DISPLAY_HELLO, { terminalId })

    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7() }
  }, [terminalId])

  // ── Promo carousel — only when idle ──
  useEffect(() => {
    if (mode !== 'idle' || promos.length < 2) return
    const t = setInterval(() => setPromoIdx(i => (i + 1) % promos.length), 5000)
    return () => clearInterval(t)
  }, [mode, promos.length])

  // ── Clock for idle screen ──
  useEffect(() => {
    if (mode !== 'idle') return
    const t = setInterval(() => setClockNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [mode])

  const switchLang = (newLang) => {
    setLang(newLang)
    localStorage.setItem('display_lang', newLang)
    getDisplaySync(terminalId).publish(EVT.LANG_CHANGED, { lang: newLang })
  }

  // ── Helpers ──
  const fmt = (n) => '$' + Number(n || 0).toFixed(2)
  const storeName = cartState?.store?.name || settings?.name || 'RetailPOS'
  const logoUrl = cartState?.store?.logo_url || ds.logo_url

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden"
      style={{background:'linear-gradient(135deg, #f8fafc 0%, #e6f0ff 100%)'}}>

      {/* ── Header (always visible) ── */}
      <div className="flex items-center justify-between px-6 py-3 flex-shrink-0"
        style={{background:'#fff', borderBottom:'2px solid #006AFF', boxShadow:'0 2px 8px rgba(0,0,0,0.04)'}}>
        <div className="flex items-center gap-3">
          {logoUrl
            ? <img src={logoUrl} alt={storeName} className="h-10 w-auto object-contain"/>
            : <div className="text-[28px] font-black" style={{color:'#006AFF', fontFamily:'Righteous, sans-serif'}}>RP</div>}
          <div className="text-[18px] font-bold" style={{color:'#1F1F1F'}}>{storeName}</div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => switchLang('en')}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer border-2 transition-all"
            style={lang==='en'
              ? {background:'#006AFF', color:'#fff', borderColor:'#006AFF'}
              : {background:'#fff', color:'#666', borderColor:'#e5e5e5'}}>
            EN
          </button>
          <button onClick={() => switchLang('zh')}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer border-2 transition-all"
            style={lang==='zh'
              ? {background:'#006AFF', color:'#fff', borderColor:'#006AFF'}
              : {background:'#fff', color:'#666', borderColor:'#e5e5e5'}}>
            中文
          </button>
        </div>
      </div>

      {/* ── Body — switches based on mode ── */}
      <div className="flex-1 overflow-hidden">
        {mode === 'idle'     && <IdleScreen t={t} promos={promos} promoIdx={promoIdx} storeName={storeName} now={clockNow}/>}
        {mode === 'active'   && <ActiveScreen t={t} state={cartState} fmt={fmt} settings={ds}/>}
        {mode === 'payment'  && <PaymentScreen t={t} state={cartState} fmt={fmt}/>}
        {mode === 'tip'      && <TipScreen t={t} state={cartState} fmt={fmt} terminalId={terminalId}/>}
        {mode === 'sig'      && <SignatureScreen t={t} state={cartState} fmt={fmt} terminalId={terminalId}/>}
        {mode === 'contact'  && <ContactScreen t={t} state={cartState} terminalId={terminalId}/>}
        {mode === 'thankyou' && <ThankYouScreen t={t} state={cartState}/>}
      </div>
    </div>
  )
}


// ── 1. IDLE — Welcome + promo carousel + clock ──
function IdleScreen({ t, promos, promoIdx, storeName, now }) {
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center relative">
      {promos.length > 0 ? (
        <div className="w-full max-w-3xl rounded-3xl overflow-hidden shadow-2xl mb-6"
          style={{aspectRatio:'16/9'}}>
          <img src={promos[promoIdx]} alt="" className="w-full h-full object-cover transition-opacity"/>
        </div>
      ) : (
        <div className="text-[100px] mb-2">👋</div>
      )}

      <div className="text-[64px] font-black mb-1 leading-tight" style={{color:'#1F1F1F', fontFamily:'Righteous, sans-serif'}}>
        {storeName}
      </div>
      <div className="text-[28px] font-bold mb-2" style={{color:'#006AFF', fontFamily:'Righteous, sans-serif'}}>
        {t.welcome}
      </div>
      <div className="text-[16px] text-[#666] mb-1">{greeting}</div>
      <div className="text-[14px] text-[#999]">
        {now.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'})} · {now.toLocaleDateString()}
      </div>

      <div className="mt-6 text-[14px] text-[#94a3b8]">
        {t.ask_associate}
      </div>

      {/* Powered-by footer (very subtle, doesn't compete with store branding) */}
      <div className="absolute bottom-3 left-0 right-0 text-center text-[9px] font-mono"
        style={{color:'#cbd5e1'}}>
        Powered by RetailPOS · v{appVersion()}
      </div>
    </div>
  )
}

// Lightweight helper — version pulled from /lib/version on the side
function appVersion() {
  try { return APP_VERSION } catch { return '1.0.0' }
}


// ── 2. ACTIVE — Live cart with items + totals ──
function ActiveScreen({ t, state, fmt, settings }) {
  const items = state?.items || []
  const totals = state?.totals || { subtotal:0, discountAmt:0, taxAmount:0, grandTotal:0 }
  const customer = state?.customer
  const totalQty = items.reduce((s,i) => s + i.qty, 0)

  return (
    <div className="h-full flex flex-col">
      {/* Member / Join CTA */}
      {customer ? (
        <div className="flex-shrink-0 mx-6 mt-4 rounded-2xl px-5 py-3"
          style={{background:'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)'}}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-bold text-[#7c2d12] uppercase tracking-wider">{t.member}</div>
              <div className="text-[20px] font-bold" style={{color:'#1F1F1F'}}>👋 {customer.name}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[#7c2d12] uppercase">{t.points}</div>
              <div className="text-[24px] font-bold font-mono" style={{color:'#1F1F1F'}}>
                {(customer.loyalty_points || 0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      ) : settings?.show_join_cta !== false ? (
        <div className="flex-shrink-0 mx-6 mt-4 rounded-2xl px-5 py-3 text-center"
          style={{background:'#1F1F1F', color:'#FFD700'}}>
          <div className="text-[14px] font-bold">⭐ {t.join_member}</div>
        </div>
      ) : null}

      {/* Item list (scrollable) */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[#999] text-[14px]">
            {t.no_items}...
          </div>
        ) : items.map(item => (
          <div key={item.id} className="flex items-center gap-3 py-3 border-b border-slate-100">
            {item.image_url
              ? <img src={item.image_url} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0"/>
              : <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{background:'#f1f5f9', color:'#94a3b8'}}>
                  <span className="text-[10px] font-bold">{item.name.substring(0,2).toUpperCase()}</span>
                </div>}
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold truncate" style={{color:'#1F1F1F'}}>{item.name}</div>
              <div className="text-[11px] text-[#666] font-mono">
                {fmt(item.unitPrice)} × {item.qty}
              </div>
            </div>
            <div className="text-[16px] font-bold font-mono" style={{color:'#1F1F1F'}}>
              {fmt(item.unitPrice * item.qty)}
            </div>
          </div>
        ))}
      </div>

      {/* Totals (sticky bottom) */}
      <div className="flex-shrink-0 px-6 py-4 mx-6 mb-6 rounded-3xl shadow-2xl"
        style={{background:'#fff', border:'2px solid #006AFF'}}>
        <div className="space-y-1 mb-3">
          <Row l={`${t.subtotal} (${totalQty} ${t.items})`} v={fmt(totals.subtotal)}/>
          {totals.discountAmt > 0 && <Row l={t.discount} v={`-${fmt(totals.discountAmt)}`} color="#dc2626"/>}
          <Row l={t.tax} v={fmt(totals.taxAmount)}/>
        </div>
        <div className="flex justify-between items-baseline pt-3 border-t-2 border-slate-200">
          <div className="text-[14px] uppercase tracking-wider font-bold" style={{color:'#666'}}>{t.total}</div>
          <div className="text-[48px] font-black font-mono" style={{color:'#006AFF', fontFamily:'Righteous, sans-serif'}}>
            {fmt(totals.grandTotal)}
          </div>
        </div>
      </div>
    </div>
  )
}


// ── 3. PAYMENT — Big "Please Pay $X" while POS handles payment ──
function PaymentScreen({ t, state, fmt }) {
  const total = state?.totals?.grandTotal || 0
  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      <div className="text-[20px] text-[#666] mb-2 uppercase tracking-widest">{t.please_pay}</div>
      <div className="text-[140px] font-black font-mono leading-none mb-4"
        style={{color:'#006AFF', fontFamily:'Righteous, sans-serif'}}>
        {fmt(total)}
      </div>
      <div className="text-[14px] text-[#999] animate-pulse">⟳ Processing...</div>
    </div>
  )
}


// ── 4. TIP — Big tap targets for tip selection ──
function TipScreen({ t, state, fmt, terminalId }) {
  const subtotal = state?.totals?.subtotal || 0
  const PRESETS = [15, 18, 20, 25]
  const [customTip, setCustomTip] = useState('')
  const [mode, setMode] = useState('preset')

  const sendTip = (amount) => {
    getDisplaySync(terminalId).publish(EVT.TIP_SELECTED, { amount })
  }

  if (mode === 'custom') {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8">
        <div className="text-[20px] mb-4 font-bold">{t.custom_tip}</div>
        <div className="text-[64px] font-black font-mono mb-4" style={{color:'#006AFF'}}>
          ${customTip || '0'}
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4" style={{maxWidth:'320px'}}>
          {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map(k => (
            <button key={k} onClick={() => {
              if (k === '⌫') setCustomTip(p => p.slice(0,-1))
              else if (k === '.' && customTip.includes('.')) return
              else setCustomTip(p => p + k)
            }}
              className="rounded-2xl text-[28px] font-bold cursor-pointer border-2 active:scale-95"
              style={{background: k === '⌫' ? '#fef2f2' : '#fff', borderColor:'#e5e5e5', height:'80px', minWidth:'80px'}}>
              {k}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={() => setMode('preset')}
            className="rounded-xl px-6 py-3 text-[14px] font-bold cursor-pointer border-2"
            style={{background:'#fff', borderColor:'#e5e5e5', color:'#666'}}>
            ← Back
          </button>
          <button onClick={() => sendTip(parseFloat(customTip)||0)}
            disabled={!customTip || parseFloat(customTip) <= 0}
            className="rounded-xl px-8 py-3 text-[16px] font-bold cursor-pointer border-none text-white disabled:opacity-40"
            style={{background:'#006AFF'}}>
            ✓ {t.submit}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      <div className="text-[28px] font-bold mb-2">{t.select_tip}</div>
      <div className="text-[14px] text-[#666] mb-8">{t.subtotal}: {fmt(subtotal)}</div>

      <div className="grid grid-cols-2 gap-4 mb-6" style={{maxWidth:'480px', width:'100%'}}>
        {PRESETS.map(pct => {
          const amt = subtotal * (pct/100)
          return (
            <button key={pct} onClick={() => sendTip(+amt.toFixed(2))}
              className="rounded-3xl cursor-pointer border-2 active:scale-95 transition-all"
              style={{
                background:'linear-gradient(135deg, #fff 0%, #f0f9ff 100%)',
                borderColor:'#006AFF', padding:'28px 16px',
              }}>
              <div className="text-[44px] font-black" style={{color:'#006AFF'}}>{pct}%</div>
              <div className="text-[18px] font-mono mt-1" style={{color:'#666'}}>{fmt(amt)}</div>
            </button>
          )
        })}
      </div>

      <div className="flex gap-3" style={{width:'100%', maxWidth:'480px'}}>
        <button onClick={() => sendTip(0)}
          className="flex-1 rounded-xl py-4 text-[16px] font-bold cursor-pointer border-2"
          style={{background:'#fff', borderColor:'#e5e5e5', color:'#666'}}>
          {t.no_tip}
        </button>
        <button onClick={() => setMode('custom')}
          className="flex-1 rounded-xl py-4 text-[16px] font-bold cursor-pointer border-2"
          style={{background:'#fff', borderColor:'#80B2FF', color:'#006AFF'}}>
          {t.custom_tip}
        </button>
      </div>
    </div>
  )
}


// ── 5. SIGNATURE — Canvas pad ──
function SignatureScreen({ t, state, fmt, terminalId }) {
  const total = state?.totals?.grandTotal || 0
  const [strokes, setStrokes] = useState([])
  const [drawing, setDrawing] = useState(false)

  const submit = () => {
    if (strokes.length === 0) return
    // Convert SVG to a data URL string and send
    const svg = renderSvg(strokes)
    getDisplaySync(terminalId).publish(EVT.SIG_COMPLETE, { signature: svg })
  }

  const start = (e) => {
    const pt = getPoint(e)
    setStrokes(s => [...s, [pt]])
    setDrawing(true)
  }
  const move = (e) => {
    if (!drawing) return
    e.preventDefault()
    const pt = getPoint(e)
    setStrokes(s => {
      const copy = s.slice()
      copy[copy.length-1] = [...copy[copy.length-1], pt]
      return copy
    })
  }
  const end = () => setDrawing(false)

  const getPoint = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top
    return [Math.round(x), Math.round(y)]
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      <div className="text-[24px] font-bold mb-2">{t.sign_here}</div>
      <div className="text-[14px] text-[#666] mb-4">{fmt(total)}</div>

      <div className="rounded-2xl overflow-hidden mb-4 touch-none select-none"
        style={{background:'#fff', border:'3px dashed #006AFF', width:'100%', maxWidth:'640px', height:'280px', cursor:'crosshair'}}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}>
        <svg width="100%" height="100%" viewBox="0 0 640 280" preserveAspectRatio="none">
          {strokes.map((stroke, i) => (
            <polyline key={i} fill="none" stroke="#1F1F1F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
              points={stroke.map(p => p.join(',')).join(' ')}/>
          ))}
        </svg>
      </div>

      <div className="flex gap-3" style={{width:'100%', maxWidth:'640px'}}>
        <button onClick={() => setStrokes([])}
          className="flex-1 rounded-xl py-4 text-[16px] font-bold cursor-pointer border-2"
          style={{background:'#fff', borderColor:'#e5e5e5', color:'#666'}}>
          {t.clear}
        </button>
        <button onClick={submit} disabled={strokes.length === 0}
          className="flex-[2] rounded-xl py-4 text-[16px] font-bold cursor-pointer border-none text-white disabled:opacity-40"
          style={{background:'#006AFF'}}>
          ✓ {t.submit}
        </button>
      </div>
    </div>
  )
}

function renderSvg(strokes) {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 280'>${
    strokes.map(s => `<polyline fill='none' stroke='#1F1F1F' stroke-width='3' stroke-linecap='round' stroke-linejoin='round' points='${s.map(p=>p.join(',')).join(' ')}'/>`).join('')
  }</svg>`
}


// ── 6. CONTACT — Customer enters email/sms ──
function ContactScreen({ t, state, terminalId }) {
  const [channel, setChannel] = useState(null)  // null | 'email' | 'sms'
  const [value, setValue] = useState('')

  const submit = () => {
    if (!value) return
    getDisplaySync(terminalId).publish(EVT.CONTACT_ENTERED, { channel, value })
  }
  const skip = () => {
    getDisplaySync(terminalId).publish(EVT.CONTACT_ENTERED, { channel: null, value: null })
  }

  if (!channel) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8">
        <div className="text-[28px] font-bold mb-8">{t.receipt_via}</div>
        <div className="grid grid-cols-2 gap-4 mb-4" style={{maxWidth:'480px', width:'100%'}}>
          <button onClick={() => setChannel('email')}
            className="rounded-3xl cursor-pointer border-2 active:scale-95 py-8"
            style={{background:'#f0fdf4', borderColor:'#10b981'}}>
            <div className="text-[48px] mb-2">📧</div>
            <div className="text-[18px] font-bold" style={{color:'#15803d'}}>{t.email}</div>
          </button>
          <button onClick={() => setChannel('sms')}
            className="rounded-3xl cursor-pointer border-2 active:scale-95 py-8"
            style={{background:'#faf5ff', borderColor:'#9333ea'}}>
            <div className="text-[48px] mb-2">📱</div>
            <div className="text-[18px] font-bold" style={{color:'#7c3aed'}}>{t.sms}</div>
          </button>
        </div>
        <button onClick={skip}
          className="rounded-xl px-6 py-3 text-[14px] font-bold cursor-pointer border-2"
          style={{background:'#fff', borderColor:'#e5e5e5', color:'#666'}}>
          {t.none}
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      <div className="text-[20px] font-bold mb-2">
        {channel === 'email' ? '📧 ' + t.enter_email : '📱 ' + t.enter_phone_long}
      </div>
      <input type={channel === 'email' ? 'email' : 'tel'}
        value={value} onChange={e => setValue(e.target.value)}
        autoFocus
        placeholder={channel === 'email' ? 'customer@example.com' : '(555) 123-4567'}
        className="rounded-2xl px-6 py-4 text-[20px] font-mono text-center mb-4 outline-none"
        style={{width:'100%', maxWidth:'480px', border:'2px solid #80B2FF', background:'#fff'}}/>
      <div className="flex gap-3" style={{width:'100%', maxWidth:'480px'}}>
        <button onClick={() => setChannel(null)}
          className="rounded-xl px-6 py-3 text-[14px] font-bold cursor-pointer border-2"
          style={{background:'#fff', borderColor:'#e5e5e5', color:'#666'}}>
          ← Back
        </button>
        <button onClick={submit} disabled={!value}
          className="flex-1 rounded-xl py-3 text-[16px] font-bold cursor-pointer border-none text-white disabled:opacity-40"
          style={{background:'#006AFF'}}>
          ✓ {t.submit}
        </button>
      </div>
    </div>
  )
}


// ── 7. THANK YOU — Order complete confirmation ──
function ThankYouScreen({ t, state }) {
  const customer = state?.customer
  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center">
      <div className="text-[160px] mb-4 animate-bounce" style={{animationDuration:'2s'}}>✅</div>
      <div className="text-[40px] font-black mb-2" style={{color:'#10b981', fontFamily:'Righteous, sans-serif'}}>
        {t.order_complete}
      </div>
      <div className="text-[18px] text-[#666]">{t.thankyou}</div>
      {customer && (
        <div className="mt-6 text-[14px] text-[#666]">
          👋 {customer.name} · {customer.loyalty_points} {t.points}
        </div>
      )}
    </div>
  )
}


// ── Small row helper ──
function Row({ l, v, color }) {
  return (
    <div className="flex justify-between items-baseline text-[14px]">
      <span style={{color:'#666'}}>{l}</span>
      <span className="font-mono font-bold" style={{color: color || '#1F1F1F'}}>{v}</span>
    </div>
  )
}
