// src/components/pos/GiftCardPanel.jsx
// Gift Card management — 4 tabs: Sell (issue) / Lookup / Top-up / History
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

const TABS = [
  { id:'sell',    label:'Sell',     icon:'➕' },
  { id:'lookup',  label:'Lookup',   icon:'🔍' },
  { id:'topup',   label:'Top-up',   icon:'⬆️' },
  { id:'history', label:'History',  icon:'📋' },
]

export default function GiftCardPanel({ onClose }) {
  const { tenant, user } = useAuthStore()
  const [tab, setTab] = useState('sell')

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
          {tab === 'sell'    && <SellTab    tenant={tenant} user={user} onDone={onClose}/>}
          {tab === 'lookup'  && <LookupTab  tenant={tenant}/>}
          {tab === 'topup'   && <TopupTab   tenant={tenant} user={user}/>}
          {tab === 'history' && <HistoryTab tenant={tenant}/>}
        </div>
      </div>
    </div>
  )
}


// ──────────────────────────────────────────────────────────────
// SELL — issue a new gift card
// ──────────────────────────────────────────────────────────────
function SellTab({ tenant, user, onDone }) {
  const qc = useQueryClient()
  const [card, setCard] = useState('')
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [expireDays, setExpireDays] = useState('')  // empty = use tenant default
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  const defaultExpire = tenant?.gift_card_default_expire_days

  const submit = async () => {
    const num = card.trim()
    const amt = parseFloat(amount)
    if (!num) { toast.error('Card number required'); return }
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return }

    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('fn_create_gift_card', {
        p_tenant_id:       tenant.id,
        p_card_number:     num,
        p_amount:          amt,
        p_expire_days:     expireDays ? parseInt(expireDays) : null,
        p_recipient_name:  recipient || null,
        p_recipient_phone: phone || null,
        p_note:            note || null,
        p_user_id:         user?.id || null,
      })
      if (error || !data?.success) {
        toast.error(data?.message || error?.message || 'Failed to create card')
        return
      }
      toast.success(`✓ Card ${num} issued — $${amt.toFixed(2)}`)
      qc.invalidateQueries({ queryKey:['gift-cards'] })
      qc.invalidateQueries({ queryKey:['member-cards'] })
      setResult({ card_number: num, balance: amt, expires_at: data.expires_at })
    } catch (e) {
      console.error('Gift card create:', e)
      toast.error(e?.message || 'Failed to create card')
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    return (
      <div className="text-center py-6">
        <div className="text-[48px] mb-3">🎉</div>
        <div className="text-[18px] font-bold mb-2">Gift Card Issued</div>
        <div className="rounded-xl p-5 inline-block text-left"
          style={{background:'linear-gradient(135deg,#fff7ed 0%,#fed7aa 100%)', border:'2px solid #ea580c'}}>
          <div className="text-[10px] font-bold text-[#ea580c] uppercase tracking-widest mb-1">Gift Card</div>
          <div className="font-mono text-[22px] font-bold text-[#1F1F1F] tracking-wider mb-2">{result.card_number}</div>
          <div className="text-[28px] font-bold text-[#ea580c] mb-1">${Number(result.balance).toFixed(2)}</div>
          {result.expires_at && (
            <div className="text-[11px] text-[#92400e]">
              Expires {new Date(result.expires_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
            </div>
          )}
        </div>
        <div className="mt-5 flex gap-2 justify-center">
          <button onClick={()=>{setResult(null); setCard(''); setAmount(''); setRecipient(''); setPhone(''); setNote(''); setExpireDays('')}}
            className="rounded-lg px-4 py-2.5 text-[12px] font-bold cursor-pointer border-none"
            style={{background:'#006AFF', color:'#FFFFFF'}}>
            + Issue Another
          </button>
          <button onClick={onDone}
            className="rounded-lg px-4 py-2.5 text-[12px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>
            Done
          </button>
        </div>
        <div className="mt-3 text-[10px] text-[#666]">
          💡 Make sure the customer paid for this card before handing it over. Add the value to their current order with the cashier flow.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <FLbl>Card Number * <span className="text-[#666] font-normal">(scan or type)</span></FLbl>
      <input autoFocus value={card}
        onChange={e=>setCard(e.target.value.toUpperCase().replace(/\s/g,''))}
        placeholder="GC-12345678"
        className="w-full rounded-lg px-3 py-3 text-[16px] outline-none font-mono font-bold tracking-wider"
        style={{border:'2px solid #80B2FF', background:'#FFFFFF', color:'#1F1F1F'}}/>

      <FLbl>Initial Amount *</FLbl>
      <div className="flex items-center rounded-lg px-3"
        style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF'}}>
        <span className="text-[16px] text-[#666] mr-1">$</span>
        <input type="number" step="0.01" min="0" value={amount}
          onChange={e=>setAmount(e.target.value)}
          placeholder="50.00"
          className="flex-1 py-3 text-[16px] outline-none border-none bg-transparent font-mono font-bold"
          style={{color:'#1F1F1F'}}/>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {[10,25,50,100,200].map(v=>(
          <button key={v} onClick={()=>setAmount(String(v))}
            className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #80B2FF'}}>
            ${v}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FLbl>Recipient name <span className="text-[#666] font-normal">(optional)</span></FLbl>
          <input value={recipient} onChange={e=>setRecipient(e.target.value)}
            placeholder="To: Jane"
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF', color:'#1F1F1F'}}/>
        </div>
        <div>
          <FLbl>Phone <span className="text-[#666] font-normal">(optional)</span></FLbl>
          <input value={phone} onChange={e=>setPhone(e.target.value)}
            placeholder="(555) 555-5555" inputMode="tel"
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
            style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF', color:'#1F1F1F'}}/>
        </div>
      </div>

      <div>
        <FLbl>Expires in
          {defaultExpire != null
            ? <span className="text-[#666] font-normal"> (blank = {defaultExpire} days from default)</span>
            : <span className="text-[#666] font-normal"> (blank = never)</span>
          }
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

      <div>
        <FLbl>Note <span className="text-[#666] font-normal">(optional)</span></FLbl>
        <input value={note} onChange={e=>setNote(e.target.value)}
          placeholder="Happy birthday, etc."
          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF', color:'#1F1F1F'}}/>
      </div>

      <button onClick={submit} disabled={saving || !card || !amount}
        className="w-full rounded-lg py-3 text-[14px] font-bold cursor-pointer border-none disabled:opacity-50 mt-2"
        style={{background:'#006AFF', color:'#FFFFFF'}}>
        {saving ? 'Issuing...' : `🎁 Issue Card${amount ? ` · $${parseFloat(amount).toFixed(2)}` : ''}`}
      </button>

      <div className="rounded-lg p-3 text-[11px]"
        style={{background:'#FEF3C7', color:'#92400e', border:'1px solid #FCD34D'}}>
        💡 <b>Important:</b> Issuing a card does NOT charge the customer. After issuing, ring it up as a regular cart item (or add the amount to their payment) so it gets paid for.
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
// TOP-UP — add funds to an existing card
// ──────────────────────────────────────────────────────────────
function TopupTab({ tenant, user }) {
  const qc = useQueryClient()
  const [card, setCard] = useState('')
  const [lookup, setLookup] = useState(null)
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  const doLookup = async () => {
    const num = card.trim()
    if (!num) { toast.error('Enter a card number'); return }
    const { data } = await supabase.rpc('fn_lookup_gift_card', {
      p_tenant_id: tenant.id, p_card_number: num,
    })
    if (!data?.success) { toast.error(data?.message || 'Card not found'); setLookup(null); return }
    setLookup(data.card)
  }

  const submit = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast.error('Enter a valid top-up amount'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('fn_topup_gift_card', {
        p_tenant_id:   tenant.id,
        p_card_number: lookup.card_number,
        p_amount:      amt,
        p_user_id:     user?.id || null,
      })
      if (error || !data?.success) {
        toast.error(data?.message || error?.message || 'Top-up failed')
        return
      }
      toast.success(`✓ Topped up $${amt.toFixed(2)} — new balance $${data.balance.toFixed(2)}`)
      qc.invalidateQueries({ queryKey:['gift-cards'] })
      qc.invalidateQueries({ queryKey:['gift-card-history'] })
      // Refresh the local lookup so user sees the new balance
      setLookup({ ...lookup, balance: data.balance, status:'active' })
      setAmount('')
    } catch (e) {
      console.error('Gift card topup:', e)
      toast.error(e?.message || 'Top-up failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {!lookup && (
        <>
          <FLbl>Card to top up</FLbl>
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
              Find Card
            </button>
          </div>
        </>
      )}

      {lookup && (
        <>
          <CardDetail card={lookup}/>

          <div className="mt-2">
            <FLbl>Top-up Amount</FLbl>
            <div className="flex items-center rounded-lg px-3"
              style={{border:'1.5px solid #e2e8f0', background:'#FFFFFF'}}>
              <span className="text-[16px] text-[#666] mr-1">$</span>
              <input autoFocus type="number" step="0.01" min="0" value={amount}
                onChange={e=>setAmount(e.target.value)}
                placeholder="25.00"
                className="flex-1 py-3 text-[16px] outline-none border-none bg-transparent font-mono font-bold"
                style={{color:'#1F1F1F'}}/>
            </div>
            <div className="mt-1.5 flex gap-1.5 flex-wrap">
              {[10,25,50,100,200].map(v=>(
                <button key={v} onClick={()=>setAmount(String(v))}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer"
                  style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #80B2FF'}}>
                  ${v}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <button onClick={()=>{setLookup(null); setCard(''); setAmount('')}}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>
              Different Card
            </button>
            <button onClick={submit} disabled={saving || !amount}
              className="flex-[2] rounded-lg py-3 text-[14px] font-bold cursor-pointer border-none disabled:opacity-50"
              style={{background:'#006AFF', color:'#FFFFFF'}}>
              {saving ? 'Adding...' : `⬆️ Add ${amount ? `$${parseFloat(amount).toFixed(2)}` : 'Funds'}`}
            </button>
          </div>

          <div className="rounded-lg p-3 text-[11px]"
            style={{background:'#FEF3C7', color:'#92400e', border:'1px solid #FCD34D'}}>
            💡 Don't forget to ring up the top-up amount as part of the customer's order to take payment.
          </div>
        </>
      )}
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
