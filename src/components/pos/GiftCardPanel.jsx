// src/components/pos/GiftCardPanel.jsx
// Gift / member card management — 3 tabs: Load (sell+top-up unified) / Lookup / History
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

const TABS = [
  { id:'load',    label:'Sell / Top-up', icon:'💳' },
  { id:'lookup',  label:'Lookup',        icon:'🔍' },
  { id:'history', label:'History',       icon:'📋' },
]

export default function GiftCardPanel({ onClose }) {
  const { tenant, user } = useAuthStore()
  const [tab, setTab] = useState('load')

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.5)'}}
      onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col"
        style={{width:'620px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.3)'}}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{background:'#000000'}}>
          <div className="flex items-center gap-2">
            <span className="text-[22px]">🎁</span>
            <div>
              <div className="text-[16px] font-bold text-white">Gift Cards</div>
              <div className="text-[10px] text-white/60">Issue, look up, top up, and track usage</div>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5', background:'#FAFAFA'}}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className="flex-1 px-3 py-3 text-[12px] font-bold cursor-pointer border-none transition-all"
              style={tab===t.id
                ? { background:'#FFFFFF', color:'#006AFF', borderBottom:'3px solid #006AFF', marginBottom:'-1px' }
                : { background:'transparent', color:'#666' }}>
              <span className="mr-1">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5" style={{background:'#FAFAFA'}}>
          {tab === 'load'    && <LoadTab    tenant={tenant} user={user} onDone={onClose}/>}
          {tab === 'lookup'  && <LookupTab  tenant={tenant}/>}
          {tab === 'history' && <HistoryTab tenant={tenant}/>}
        </div>
      </div>
    </div>
  )
}


// ──────────────────────────────────────────────────────────────
// LOAD — unified Sell + Top-up.
// Enter a card number → look it up. If it exists, top it up. If not,
// create it as a new card. Both flows take a top-up amount (充值金额,
// goes on the card) and a payment amount (付款金额, cash collected —
// they differ for promos like "pay $100, get $120").
// ──────────────────────────────────────────────────────────────
function LoadTab({ tenant, user, onDone }) {
  const qc = useQueryClient()
  const [card, setCard]       = useState('')
  const [phase, setPhase]     = useState('find')  // 'find' | 'topup' | 'new' | 'done'
  const [existing, setExisting] = useState(null)  // found card
  const [finding, setFinding] = useState(false)

  // form fields (shared by topup + new)
  const [topupAmt, setTopupAmt] = useState('')    // 充值金额 — onto card
  const [payAmt, setPayAmt]     = useState('')    // 付款金额 — cash collected
  const [payTouched, setPayTouched] = useState(false)
  const [cardType, setCardType] = useState('gift')// 'gift' | 'member'
  const [recipient, setRecipient] = useState('')
  const [phone, setPhone]       = useState('')
  const [note, setNote]         = useState('')
  const [expireDays, setExpireDays] = useState('')
  const [saving, setSaving]     = useState(false)
  const [result, setResult]     = useState(null)

  const defaultExpire = tenant?.gift_card_default_expire_days

  // Keep payment in sync with top-up until the user edits payment themselves
  const setTopup = (v) => {
    setTopupAmt(v)
    if (!payTouched) setPayAmt(v)
  }

  const bonus = Math.max(0, (parseFloat(topupAmt)||0) - (parseFloat(payAmt)||0))

  const doFind = async () => {
    const num = card.trim()
    if (!num) { toast.error('Enter a card number'); return }
    setFinding(true)
    const { data } = await supabase.rpc('fn_lookup_gift_card', {
      p_tenant_id: tenant.id, p_card_number: num,
    })
    setFinding(false)
    if (data?.success) {
      setExisting(data.card)
      setCardType(data.card.card_type === 'member' ? 'member' : 'gift')
      setPhase('topup')
    } else {
      // Not found → offer to create as a new card
      setExisting(null)
      setPhase('new')
    }
  }

  const submit = async () => {
    const tAmt = parseFloat(topupAmt)
    const pAmt = payAmt === '' ? tAmt : parseFloat(payAmt)
    if (!tAmt || tAmt <= 0) { toast.error('Enter a valid top-up amount'); return }
    if (pAmt < 0) { toast.error('Payment amount cannot be negative'); return }

    setSaving(true)
    try {
      if (phase === 'topup') {
        const { data, error } = await supabase.rpc('fn_topup_gift_card', {
          p_tenant_id:   tenant.id,
          p_card_number: existing.card_number,
          p_amount:      tAmt,
          p_paid_amount: pAmt,
          p_user_id:     user?.id || null,
          p_note:        note || null,
        })
        if (error || !data?.success) { toast.error(data?.message || error?.message || 'Top-up failed'); return }
        toast.success(`✓ Loaded $${tAmt.toFixed(2)} — new balance $${data.balance.toFixed(2)}`)
        setResult({ mode:'topup', card_number: existing.card_number, balance: data.balance,
                    topup: tAmt, paid: pAmt, bonus: data.bonus_amount, card_type: cardType })
      } else {
        const { data, error } = await supabase.rpc('fn_create_gift_card', {
          p_tenant_id:       tenant.id,
          p_card_number:     card.trim(),
          p_amount:          tAmt,
          p_paid_amount:     pAmt,
          p_card_type:       cardType,
          p_expire_days:     expireDays ? parseInt(expireDays) : null,
          p_recipient_name:  cardType === 'member' ? (recipient || null) : null,
          p_recipient_phone: cardType === 'member' ? (phone || null) : null,
          p_note:            note || null,
          p_user_id:         user?.id || null,
        })
        if (error || !data?.success) { toast.error(data?.message || error?.message || 'Failed to create card'); return }
        toast.success(`✓ Card ${card.trim()} issued — $${tAmt.toFixed(2)}`)
        setResult({ mode:'new', card_number: card.trim(), balance: tAmt,
                    topup: tAmt, paid: pAmt, bonus: data.bonus_amount, expires_at: data.expires_at, card_type: cardType })
      }
      qc.invalidateQueries({ queryKey:['gift-cards'] })
      qc.invalidateQueries({ queryKey:['member-cards'] })
      qc.invalidateQueries({ queryKey:['gift-card-history'] })
      setPhase('done')
    } catch (e) {
      console.error('Card load:', e)
      toast.error(e?.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setCard(''); setPhase('find'); setExisting(null)
    setTopupAmt(''); setPayAmt(''); setPayTouched(false)
    setCardType('gift'); setRecipient(''); setPhone(''); setNote(''); setExpireDays('')
    setResult(null)
  }

  // ── DONE screen ──
  if (phase === 'done' && result) {
    const isMember = result.card_type === 'member'
    return (
      <div className="text-center py-6">
        <div className="text-[48px] mb-3">🎉</div>
        <div className="text-[18px] font-bold mb-2">
          {result.mode === 'new' ? (isMember ? 'Member Card Issued' : 'Gift Card Issued') : 'Card Loaded'}
        </div>
        <div className="rounded-xl p-5 inline-block text-left"
          style={{background:'linear-gradient(135deg,#fff7ed 0%,#fed7aa 100%)', border:'2px solid #ea580c'}}>
          <div className="text-[10px] font-bold text-[#ea580c] uppercase tracking-widest mb-1">
            {isMember ? 'Member Card' : 'Gift Card'}
          </div>
          <div className="font-mono text-[22px] font-bold text-[#1F1F1F] tracking-wider mb-2">{result.card_number}</div>
          <div className="text-[28px] font-bold text-[#ea580c] mb-1">${Number(result.balance).toFixed(2)}<span className="text-[12px] font-normal text-[#92400e]"> balance</span></div>
          <div className="text-[12px] text-[#92400e] space-y-0.5 mt-2 pt-2" style={{borderTop:'1px dashed #ea580c'}}>
            <div className="flex justify-between gap-6"><span>Loaded onto card:</span><span className="font-mono font-bold">${Number(result.topup).toFixed(2)}</span></div>
            <div className="flex justify-between gap-6"><span>Customer paid:</span><span className="font-mono font-bold">${Number(result.paid).toFixed(2)}</span></div>
            {result.bonus > 0 && (
              <div className="flex justify-between gap-6 text-[#16a34a] font-bold"><span>🎁 Free bonus:</span><span className="font-mono">${Number(result.bonus).toFixed(2)}</span></div>
            )}
          </div>
          {result.expires_at && (
            <div className="text-[11px] text-[#92400e] mt-2">
              Expires {new Date(result.expires_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
            </div>
          )}
        </div>
        <div className="mt-5 flex gap-2 justify-center">
          <button onClick={reset}
            className="rounded-lg px-4 py-2.5 text-[12px] font-bold cursor-pointer border-none"
            style={{background:'#006AFF', color:'#FFFFFF'}}>
            + Another Card
          </button>
          <button onClick={onDone}
            className="rounded-lg px-4 py-2.5 text-[12px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>
            Done
          </button>
        </div>
        <div className="mt-3 text-[10px] text-[#666]">
          💡 The <b>${Number(result.paid).toFixed(2)}</b> payment goes to financial income. The <b>${Number(result.topup).toFixed(2)}</b> is the card balance. Ring up the payment in the customer's order.
        </div>
      </div>
    )
  }

  // ── FIND phase: enter card number ──
  if (phase === 'find') {
    return (
      <div className="space-y-3">
        <FLbl>Card Number * <span className="text-[#666] font-normal">(scan or type — we'll find it or create it)</span></FLbl>
        <div className="flex gap-2">
          <input autoFocus value={card}
            onChange={e=>setCard(e.target.value.toUpperCase().replace(/\s/g,''))}
            onKeyDown={e=>{ if(e.key==='Enter') doFind() }}
            placeholder="GC-12345678 or scan"
            className="flex-1 rounded-lg px-3 py-3 text-[16px] outline-none font-mono font-bold tracking-wider"
            style={{border:'2px solid #80B2FF', background:'#FFFFFF', color:'#1F1F1F'}}/>
          <button onClick={doFind} disabled={finding || !card}
            className="rounded-lg px-5 py-3 text-[13px] font-bold cursor-pointer border-none disabled:opacity-50"
            style={{background:'#006AFF', color:'#FFFFFF'}}>
            {finding ? '...' : 'Continue →'}
          </button>
        </div>
        <div className="rounded-lg p-3 text-[11px]"
          style={{background:'#EFF6FF', color:'#1e40af', border:'1px solid #BFDBFE'}}>
          💳 Enter a card number. If it already exists you'll top it up; if it's new you'll create it. Selling and topping up are the same flow.
        </div>
      </div>
    )
  }

  // ── TOPUP or NEW phase: card-type + amounts + (member fields) ──
  const isNew = phase === 'new'
  return (
    <div className="space-y-3">
      {/* Found existing card banner OR new-card banner */}
      {existing ? (
        <CardDetail card={existing}/>
      ) : (
        <div className="rounded-lg px-3 py-2.5 text-[12px] flex items-center gap-2"
          style={{background:'#ECFDF5', color:'#065f46', border:'1px solid #6EE7B7'}}>
          <span>✨</span><span><b>New card</b> — <span className="font-mono font-bold">{card}</span> isn't in the system. Fill in below to create it.</span>
        </div>
      )}

      {/* Card type selector — only when creating a new card */}
      {isNew && (
        <div>
          <FLbl>Card Type</FLbl>
          <div className="flex gap-2">
            <button onClick={()=>setCardType('gift')}
              className="flex-1 rounded-lg py-2.5 text-[13px] font-bold cursor-pointer border-2 transition-all"
              style={cardType==='gift'
                ? {background:'#006AFF', color:'#fff', borderColor:'#006AFF'}
                : {background:'#fff', color:'#666', borderColor:'#e5e5e5'}}>
              🎁 Gift Card
            </button>
            <button onClick={()=>setCardType('member')}
              className="flex-1 rounded-lg py-2.5 text-[13px] font-bold cursor-pointer border-2 transition-all"
              style={cardType==='member'
                ? {background:'#006AFF', color:'#fff', borderColor:'#006AFF'}
                : {background:'#fff', color:'#666', borderColor:'#e5e5e5'}}>
              👤 Member Card
            </button>
          </div>
        </div>
      )}

      {/* Top-up amount (充值金额) */}
      <div>
        <FLbl>Top-up Amount <span className="text-[#666] font-normal">(充值金额 — goes onto the card)</span></FLbl>
        <div className="flex items-center rounded-lg px-3" style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF'}}>
          <span className="text-[16px] text-[#666] mr-1">$</span>
          <input autoFocus type="number" step="0.01" min="0" value={topupAmt}
            onChange={e=>setTopup(e.target.value)} placeholder="100.00"
            className="flex-1 py-3 text-[16px] outline-none border-none bg-transparent font-mono font-bold"
            style={{color:'#1F1F1F'}}/>
        </div>
        <div className="mt-1.5 flex gap-1.5 flex-wrap">
          {[10,25,50,100,200].map(v=>(
            <button key={v} onClick={()=>setTopup(String(v))}
              className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #80B2FF'}}>
              ${v}
            </button>
          ))}
        </div>
      </div>

      {/* Payment amount (付款金额) */}
      <div>
        <FLbl>Payment Amount <span className="text-[#666] font-normal">(付款金额 — cash collected)</span></FLbl>
        <div className="flex items-center rounded-lg px-3" style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF'}}>
          <span className="text-[16px] text-[#666] mr-1">$</span>
          <input type="number" step="0.01" min="0" value={payAmt}
            onChange={e=>{ setPayTouched(true); setPayAmt(e.target.value) }}
            placeholder="100.00"
            className="flex-1 py-3 text-[16px] outline-none border-none bg-transparent font-mono font-bold"
            style={{color:'#1F1F1F'}}/>
        </div>
        <div className="text-[10px] text-[#666] mt-1">Defaults to the top-up amount. Lower it for promos (e.g. pay $100, load $120).</div>
      </div>

      {/* Bonus indicator */}
      {bonus > 0 && (
        <div className="rounded-lg px-3 py-2 text-[12px] text-center font-bold"
          style={{background:'#dcfce7', color:'#166534', border:'1px solid #86efac'}}>
          🎁 Promo bonus: customer gets ${bonus.toFixed(2)} free
        </div>
      )}

      {/* Member-only fields */}
      {isNew && cardType === 'member' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FLbl>Member name</FLbl>
            <input value={recipient} onChange={e=>setRecipient(e.target.value)}
              placeholder="Jane Doe"
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF', color:'#1F1F1F'}}/>
          </div>
          <div>
            <FLbl>Phone</FLbl>
            <input value={phone} onChange={e=>setPhone(e.target.value)}
              placeholder="(555) 555-5555" inputMode="tel"
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
              style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF', color:'#1F1F1F'}}/>
          </div>
        </div>
      )}

      {/* Expiry — only for new cards */}
      {isNew && (
        <div>
          <FLbl>Expires in
            {defaultExpire != null
              ? <span className="text-[#666] font-normal"> (blank = {defaultExpire} days default)</span>
              : <span className="text-[#666] font-normal"> (blank = never)</span>}
          </FLbl>
          <div className="flex items-center gap-2">
            <input type="number" min="1" value={expireDays} onChange={e=>setExpireDays(e.target.value)}
              placeholder={defaultExpire != null ? String(defaultExpire) : 'Never'}
              className="w-32 rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
              style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF', color:'#1F1F1F'}}/>
            <span className="text-[12px] text-[#666]">days</span>
            <div className="flex gap-1.5">
              {[90,180,365,730].map(d=>(
                <button key={d} onClick={()=>setExpireDays(String(d))}
                  className="rounded-md px-2 py-1 text-[10px] font-bold cursor-pointer"
                  style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>
                  {d/365 < 1 ? `${d}d` : `${d/365}yr`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Note */}
      <div>
        <FLbl>Note <span className="text-[#666] font-normal">(optional)</span></FLbl>
        <input value={note} onChange={e=>setNote(e.target.value)}
          placeholder={bonus > 0 ? 'e.g. Top up $100 get $20 promo' : 'Happy birthday, etc.'}
          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF', color:'#1F1F1F'}}/>
      </div>

      <div className="flex gap-2 mt-2">
        <button onClick={reset}
          className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
          style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>
          ‹ Different Card
        </button>
        <button onClick={submit} disabled={saving || !topupAmt}
          className="flex-[2] rounded-lg py-3 text-[14px] font-bold cursor-pointer border-none disabled:opacity-50"
          style={{background:'#006AFF', color:'#FFFFFF'}}>
          {saving ? 'Saving...'
            : isNew
              ? `${cardType==='member'?'👤':'🎁'} Create + Load $${parseFloat(topupAmt||0).toFixed(2)}`
              : `⬆️ Top up $${parseFloat(topupAmt||0).toFixed(2)}`}
        </button>
      </div>

      <div className="rounded-lg p-3 text-[11px]"
        style={{background:'#FEF3C7', color:'#92400e', border:'1px solid #FCD34D'}}>
        💡 Collect the <b>payment amount</b> in the customer's order. The top-up amount is what lands on the card.
      </div>
    </div>
  )
}


// ──────────────────────────────────────────────────────────────
// LOOKUP — check balance + status
// ──────────────────────────────────────────────────────────────
function LookupTab({ tenant }) {
  const [card, setCard] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const submit = async () => {
    const num = card.trim()
    if (!num) { toast.error('Enter a card number'); return }
    setLookingUp(true); setError(null); setResult(null)
    const { data, error: rpcErr } = await supabase.rpc('fn_lookup_gift_card', {
      p_tenant_id:   tenant.id,
      p_card_number: num,
    })
    setLookingUp(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.success) { setError(data?.message || 'Not found'); return }
    setResult(data.card)
  }

  return (
    <div className="space-y-3">
      <FLbl>Card Number</FLbl>
      <div className="flex gap-2">
        <input autoFocus value={card}
          onChange={e=>setCard(e.target.value.toUpperCase().replace(/\s/g,''))}
          onKeyDown={e=>{ if(e.key==='Enter') submit() }}
          placeholder="GC-12345678 or scan"
          className="flex-1 rounded-lg px-3 py-3 text-[15px] outline-none font-mono font-bold tracking-wider"
          style={{border:'2px solid #80B2FF', background:'#FFFFFF', color:'#1F1F1F'}}/>
        <button onClick={submit} disabled={lookingUp || !card}
          className="rounded-lg px-5 py-3 text-[13px] font-bold cursor-pointer border-none disabled:opacity-50"
          style={{background:'#006AFF', color:'#FFFFFF'}}>
          {lookingUp ? '...' : '🔍 Look up'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-3 text-[13px] flex items-center gap-2"
          style={{background:'#FEE2E2', color:'#CF1322', border:'1px solid #FCA5A5'}}>
          <span>⚠️</span><span><b>Not found</b> — {error}</span>
        </div>
      )}

      {result && <CardDetail card={result}/>}
    </div>
  )
}



// ──────────────────────────────────────────────────────────────
// HISTORY — look up txn history for a specific card
// ──────────────────────────────────────────────────────────────
function HistoryTab({ tenant }) {
  const [card, setCard] = useState('')
  const [cardId, setCardId] = useState(null)
  const [cardInfo, setCardInfo] = useState(null)

  const doLookup = async () => {
    const num = card.trim()
    if (!num) { toast.error('Enter a card number'); return }
    const { data } = await supabase.rpc('fn_lookup_gift_card', {
      p_tenant_id: tenant.id, p_card_number: num,
    })
    if (!data?.success) { toast.error(data?.message || 'Not found'); return }
    setCardId(data.card.id); setCardInfo(data.card)
  }

  const { data: txns = [], isLoading } = useQuery({
    queryKey: ['gift-card-history', cardId],
    queryFn: async () => {
      const { data } = await supabase.from('gift_card_transactions')
        .select('*, users:user_id(name), orders:order_id(order_number)')
        .eq('card_id', cardId)
        .order('created_at', { ascending: false })
        .limit(100)
      return data || []
    },
    enabled: !!cardId,
  })

  const TYPE = {
    issue:  { icon:'🎁', label:'Issued',   color:'#006AFF' },
    redeem: { icon:'💳', label:'Redeemed', color:'#dc2626' },
    topup:  { icon:'⬆️', label:'Top-up',   color:'#15803d' },
    refund: { icon:'↩️', label:'Refund',   color:'#7c3aed' },
    void:   { icon:'🚫', label:'Voided',   color:'#64748b' },
    adjust: { icon:'⚖️', label:'Adjust',   color:'#ca8a04' },
  }

  return (
    <div className="space-y-3">
      {!cardId && (
        <>
          <FLbl>Card to look up history for</FLbl>
          <div className="flex gap-2">
            <input autoFocus value={card}
              onChange={e=>setCard(e.target.value.toUpperCase().replace(/\s/g,''))}
              onKeyDown={e=>{ if(e.key==='Enter') doLookup() }}
              placeholder="GC-12345678 or scan"
              className="flex-1 rounded-lg px-3 py-3 text-[15px] outline-none font-mono font-bold tracking-wider"
              style={{border:'2px solid #80B2FF', background:'#FFFFFF', color:'#1F1F1F'}}/>
            <button onClick={doLookup} disabled={!card}
              className="rounded-lg px-5 py-3 text-[13px] font-bold cursor-pointer border-none disabled:opacity-50"
              style={{background:'#006AFF', color:'#FFFFFF'}}>
              View History
            </button>
          </div>
        </>
      )}

      {cardInfo && (
        <>
          <CardDetail card={cardInfo}/>
          <div className="flex items-center justify-between mt-3 mb-1">
            <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">
              Transactions ({txns.length})
            </div>
            <button onClick={()=>{setCardId(null); setCardInfo(null); setCard('')}}
              className="rounded-md px-2.5 py-1 text-[11px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>
              Different Card
            </button>
          </div>

          <div className="rounded-xl overflow-hidden" style={{background:'#FFFFFF', border:'1px solid #E5E5E5'}}>
            {isLoading ? (
              <div className="text-[12px] text-[#999] py-4 text-center">Loading...</div>
            ) : txns.length === 0 ? (
              <div className="text-[12px] text-[#999] py-6 text-center">No transactions yet.</div>
            ) : txns.map(t=>{
              const ti = TYPE[t.type] || TYPE.adjust
              const positive = Number(t.amount) >= 0
              return (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-[#F1F5F9] last:border-0">
                  <div className="text-[16px] flex-shrink-0">{ti.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-bold" style={{color:ti.color}}>{ti.label}</span>
                      {t.orders?.order_number && (
                        <span className="text-[10px] font-mono text-[#666]">· {t.orders.order_number}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#999]">
                      {new Date(t.created_at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}
                      {t.users?.name && ` · by ${t.users.name}`}
                      {t.note && ` · ${t.note}`}
                    </div>
                    {/* When the cash paid differs from what was loaded (promo) */}
                    {(t.type==='topup'||t.type==='issue') && t.paid_amount != null && Number(t.bonus_amount) > 0 && (
                      <div className="text-[10px] font-bold mt-0.5" style={{color:'#16a34a'}}>
                        paid ${Number(t.paid_amount).toFixed(2)} · 🎁 +${Number(t.bonus_amount).toFixed(2)} free
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[13px] font-bold font-mono"
                      style={{color: positive ? '#15803d' : '#dc2626'}}>
                      {positive ? '+' : ''}{Number(t.amount).toFixed(2)}
                    </div>
                    <div className="text-[9px] text-[#999] font-mono">bal: ${Number(t.balance_after).toFixed(2)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}


// ──────────────────────────────────────────────────────────────
// CardDetail — pretty card display (reused)
// ──────────────────────────────────────────────────────────────
function CardDetail({ card }) {
  const STATUS = {
    active:   { label:'Active',   bg:'#dcfce7', color:'#15803d' },
    depleted: { label:'Depleted', bg:'#f1f5f9', color:'#64748b' },
    expired:  { label:'Expired',  bg:'#f1f5f9', color:'#64748b' },
    voided:   { label:'Voided',   bg:'#fee2e2', color:'#dc2626' },
  }
  const st = STATUS[card.status] || STATUS.active
  const exp = card.expires_at ? new Date(card.expires_at) : null
  const daysLeft = exp ? Math.ceil((exp - new Date()) / 86400000) : null

  return (
    <div className="rounded-xl p-4"
      style={{background:'linear-gradient(135deg,#fff7ed 0%,#fed7aa 100%)', border:'2px solid #ea580c'}}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="text-[10px] font-bold text-[#92400e] uppercase tracking-widest mb-0.5">Gift Card</div>
          <div className="font-mono text-[16px] font-bold text-[#1F1F1F] tracking-wider">{card.card_number}</div>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{background:st.bg, color:st.color}}>
          {st.label}
        </span>
      </div>
      <div className="text-[28px] font-bold text-[#ea580c] mb-1">${Number(card.balance||0).toFixed(2)}</div>
      <div className="text-[11px] text-[#92400e]">
        of ${Number(card.init_amount||0).toFixed(2)} initial
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[#1F1F1F]">
        {card.issued_at && (
          <div>
            <span className="text-[#92400e]">Issued:</span>{' '}
            {new Date(card.issued_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
          </div>
        )}
        {exp && (
          <div>
            <span className="text-[#92400e]">Expires:</span>{' '}
            {exp.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
            {card.status === 'active' && daysLeft !== null && (
              <span className={daysLeft < 30 ? 'text-[#dc2626] font-bold' : 'text-[#666]'}>
                {' '}({daysLeft >= 0 ? `${daysLeft}d left` : 'past due'})
              </span>
            )}
          </div>
        )}
        {!exp && (<div><span className="text-[#92400e]">Expires:</span> Never</div>)}
        {card.last_used_at && (
          <div className="col-span-2">
            <span className="text-[#92400e]">Last used:</span>{' '}
            {new Date(card.last_used_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
          </div>
        )}
        {card.recipient_name && (
          <div className="col-span-2">
            <span className="text-[#92400e]">To:</span> {card.recipient_name}
            {card.recipient_phone && <span> · {card.recipient_phone}</span>}
          </div>
        )}
        {card.note && (
          <div className="col-span-2 italic">"{card.note}"</div>
        )}
      </div>
    </div>
  )
}


function FLbl({ children }) {
  return <div className="text-[11px] font-bold text-[#1F1F1F] uppercase tracking-wider">{children}</div>
}
