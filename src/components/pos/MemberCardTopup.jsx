// src/components/pos/MemberCardTopup.jsx
// POS "Top Up → Member Card" flow. Search a member by card #, phone, or
// name, then reuse the SAME TopupModal as the Members page. If a card
// number isn't found, the cashier can — without leaving this popup —
// either create a full new member (card pre-filled) or assign the card to
// an existing member, then continue to top up. Member cards are separate
// from gift cards.
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useCartStore } from '@/stores/cartStore'
import { TopupModal, AddCustomerModal } from '@/pages/customers/CustomersPage'
import toast from 'react-hot-toast'

export default function MemberCardTopup({ onClose }) {
  const { tenant, user } = useAuthStore()
  const [search, setSearch]   = useState('')
  const [results, setResults] = useState(null)   // null = not searched yet
  const [loading, setLoading] = useState(false)
  const [picked, setPicked]   = useState(null)    // member chosen → TopupModal
  const [addNew, setAddNew]   = useState(false)    // create new member (card pre-filled)
  const [assignMode, setAssignMode] = useState(false) // assign this card to an existing member
  const [assignSearch, setAssignSearch] = useState('')
  const [assignResults, setAssignResults] = useState(null)
  const [assigning, setAssigning] = useState(false)
  const [assignTo, setAssignTo] = useState(null)        // member id being assigned a card inline
  const [assignCardNum, setAssignCardNum] = useState('')

  // Assign a typed card number to an existing member (in the result list),
  // then continue straight to top-up. Verifies the number isn't taken.
  const assignCardInline = async (m) => {
    const num = assignCardNum.trim()
    if (!num) { toast.error('Enter a card number'); return }
    setAssigning(true)
    const { data: clash } = await supabase.from('customers')
      .select('id').eq('tenant_id', tenant.id).eq('card_number', num).maybeSingle()
    if (clash) { setAssigning(false); toast.error(`Card #${num} is already used by another member`); return }
    const { error } = await supabase.from('customers').update({ card_number: num }).eq('id', m.id)
    setAssigning(false)
    if (error) { toast.error(error.message); return }
    toast.success(`✓ Card #${num} assigned to ${m.name}`)
    setAssignTo(null)
    setPicked({ ...m, card_number: num })   // straight to top-up
  }

  // Does the searched term look like a card number? (4–6 digits, vs a
  // 10-digit phone or a typed name.) Used only to tailor the prompt.
  const term = search.trim()
  const looksLikeCard = /^\d{1,9}$/.test(term) && term.length <= 8

  const doSearch = async () => {
    if (!term) { toast.error('Enter card #, phone, or name'); return }
    setLoading(true)
    const { data } = await supabase.from('customers')
      .select('id, name, phone, card_number, card_balance, member_level, loyalty_points')
      .eq('tenant_id', tenant.id).eq('is_active', true)
      .or(`name.ilike.%${term}%,phone.ilike.%${term}%,card_number.ilike.%${term}%`)
      .order('name').limit(25)
    setLoading(false)
    setResults(data || [])
  }

  // Search existing members to attach this card number to
  const doAssignSearch = async () => {
    const q = assignSearch.trim()
    if (!q) { toast.error('Enter phone or name'); return }
    const { data } = await supabase.from('customers')
      .select('id, name, phone, card_number, card_balance')
      .eq('tenant_id', tenant.id).eq('is_active', true)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .order('name').limit(25)
    setAssignResults(data || [])
  }

  // Attach the searched card number to an existing member, then continue
  const assignCardTo = async (m) => {
    if (m.card_number && String(m.card_number).trim()) {
      toast.error(`${m.name} already has card #${m.card_number}`); return
    }
    setAssigning(true)
    const { error } = await supabase.from('customers')
      .update({ card_number: term }).eq('id', m.id)
    setAssigning(false)
    if (error) { toast.error(error.message); return }
    toast.success(`✓ Card #${term} assigned to ${m.name}`)
    setAssignMode(false); setAssignResults(null); setAssignSearch('')
    setPicked({ ...m, card_number: term })   // straight to top-up
  }

  return (
    <>
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.5)', display: (picked || addNew) ? 'none' : 'flex'}}
      onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col"
        style={{width:'560px', maxWidth:'100%', maxHeight:'90vh', background:'#fff', boxShadow:'0 20px 50px rgba(0,0,0,0.3)'}}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{background:'#006AFF'}}>
          <div className="flex items-center gap-2">
            <span className="text-[22px]">👤</span>
            <div>
              <div className="text-[16px] font-bold text-white">Member Card Top-up</div>
              <div className="text-[10px] text-white/70">Search a member, then top up their card</div>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
        </div>

        {/* Search */}
        <div className="p-5 flex flex-col gap-3 overflow-y-auto" style={{background:'#FAFAFA'}}>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Find member <span className="font-normal normal-case text-slate-400">— phone, card number, or name</span>
          </div>
          <div className="flex gap-2">
            <input autoFocus value={search}
              onChange={e=>setSearch(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') doSearch() }}
              placeholder="Enter phone number, card number, or name to look up"
              className="flex-1 rounded-lg px-3 py-3 text-[15px] outline-none font-bold"
              style={{border:'2px solid #80B2FF', background:'#fff', color:'#1F1F1F'}}/>
            <button onClick={doSearch} disabled={loading || !search}
              className="rounded-lg px-5 py-3 text-[13px] font-bold cursor-pointer border-none disabled:opacity-50"
              style={{background:'#006AFF', color:'#fff'}}>
              {loading ? '...' : '🔍 Search'}
            </button>
          </div>

          {/* Results */}
          {results !== null && (
            results.length === 0 ? (
              assignMode ? (
                // ── Assign this card to an existing member ──
                <div className="rounded-xl p-4" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[13px] font-bold">👤 Assign card #{term} to a member</div>
                    <button onClick={()=>{setAssignMode(false); setAssignResults(null)}}
                      className="text-[11px] text-slate-400 bg-transparent border-none cursor-pointer">‹ Back</button>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input autoFocus value={assignSearch}
                      onChange={e=>setAssignSearch(e.target.value)}
                      onKeyDown={e=>{ if(e.key==='Enter') doAssignSearch() }}
                      placeholder="Find member by phone or name"
                      className="flex-1 rounded-lg px-3 py-2.5 text-[14px] outline-none"
                      style={{border:'1.5px solid #80B2FF', background:'#fff'}}/>
                    <button onClick={doAssignSearch}
                      className="rounded-lg px-4 py-2.5 text-[12px] font-bold cursor-pointer border-none text-white"
                      style={{background:'#006AFF'}}>🔍</button>
                  </div>
                  {assignResults !== null && (assignResults.length === 0 ? (
                    <div className="text-[12px] text-slate-400 py-3 text-center">No member found — try the other option, create a new member.</div>
                  ) : (
                    <div className="rounded-lg overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                      {assignResults.map(m => {
                        const taken = m.card_number && String(m.card_number).trim()
                        return (
                          <div key={m.id} className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 last:border-0">
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-bold truncate">{m.name}</div>
                              <div className="text-[10px] text-slate-500">{m.phone || 'no phone'}{taken ? ` · already has #${m.card_number}` : ''}</div>
                            </div>
                            <button onClick={()=>assignCardTo(m)} disabled={assigning || taken}
                              className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white disabled:opacity-40"
                              style={{background:'#16a34a'}}>
                              Assign card
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                // ── Card/term not found: offer create-new OR assign-to-existing ──
                <div className="rounded-xl px-4 py-5 text-center" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                  <div className="text-[28px] mb-2">🔍</div>
                  <div className="text-[13px] font-bold mb-1" style={{color:'#1F1F1F'}}>
                    {looksLikeCard ? `Card #${term} isn't linked to a member yet` : `No member found for “${term}”`}
                  </div>
                  <div className="text-[12px] text-slate-500 mb-4">A member card must belong to a member. What would you like to do?</div>
                  <div className="flex flex-col gap-2">
                    <button onClick={()=>setAddNew(true)}
                      className="rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer border-none text-white"
                      style={{background:'#006AFF'}}>
                      ➕ Create a new member{looksLikeCard ? ` (card #${term})` : ''}
                    </button>
                    <button onClick={()=>{ setAssignMode(true); setAssignSearch(''); setAssignResults(null) }}
                      className="rounded-lg px-4 py-3 text-[13px] font-bold cursor-pointer"
                      style={{background:'#fff', color:'#006AFF', border:'1.5px solid #80B2FF'}}>
                      👤 Assign this card to an existing member
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-3">All done here — you won't leave this window.</div>
                </div>
              )
            ) : (
              <div className="rounded-xl overflow-hidden" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                {results.map(m => {
                  const hasCard = !!(m.card_number && String(m.card_number).trim())
                  return (
                  <div key={m.id}
                    className="w-full flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 text-left transition-all"
                    style={{background: hasCard ? 'transparent' : '#fffbeb'}}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-[16px] font-black"
                      style={{background: hasCard ? '#eff6ff' : '#fef3c7', color: hasCard ? '#006AFF' : '#d97706'}}>
                      {(m.name||'?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold truncate" style={{color:'#1F1F1F'}}>{m.name}</div>
                      {hasCard ? (
                        <div className="text-[11px] text-slate-500">
                          Card #{m.card_number}{m.phone ? ` · ${m.phone}` : ''}
                        </div>
                      ) : (
                        <div className="text-[11px] font-bold" style={{color:'#d97706'}}>
                          ⚠️ No card number — must add a card before topping up{m.phone ? ` · ${m.phone}` : ''}
                        </div>
                      )}
                    </div>
                    {hasCard ? (
                      <button onClick={()=>setPicked(m)}
                        className="rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer border-none text-white flex-shrink-0"
                        style={{background:'#006AFF'}}>
                        Top up · ${(m.card_balance||0).toFixed(2)}
                      </button>
                    ) : assignTo === m.id ? (
                      <div className="flex gap-1.5 flex-shrink-0">
                        <input autoFocus value={assignCardNum}
                          onChange={e=>setAssignCardNum(e.target.value.replace(/\s/g,''))}
                          onKeyDown={e=>{ if(e.key==='Enter') assignCardInline(m) }}
                          placeholder="Card #"
                          className="w-24 rounded-lg px-2 py-2 text-[12px] outline-none font-mono"
                          style={{border:'1.5px solid #80B2FF'}}/>
                        <button onClick={()=>assignCardInline(m)} disabled={assigning}
                          className="rounded-lg px-3 py-2 text-[11px] font-bold cursor-pointer border-none text-white"
                          style={{background:'#16a34a'}}>✓</button>
                      </div>
                    ) : (
                      <button onClick={()=>{ setAssignTo(m.id); setAssignCardNum('') }}
                        className="rounded-lg px-3 py-2 text-[11px] font-bold cursor-pointer flex-shrink-0"
                        style={{background:'#fff', color:'#d97706', border:'1px solid #fcd34d'}}>
                        + Add card
                      </button>
                    )}
                  </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>

      {/* Reuse the exact same TopupModal as the Members page — but in POS
          we add to the cart instead of charging immediately. The balance
          activates only when the whole order is paid in full. Rendered as a
          sibling so cancelling it returns cleanly to the search. */}
      {picked && (
        <TopupModal customer={picked} tenantId={tenant?.id} userId={user?.id} userName={user?.name}
          onAddToCart={(payload) => {
            useCartStore.getState().addCardTopup(payload)
            toast.success('🛒 Added to order — pay to activate')
            setPicked(null); onClose()
          }}
          onClose={() => setPicked(null)}/>
      )}

      {/* Create a full new member in-popup (card # pre-filled), then go
          straight to top-up for the newly created member. */}
      {addNew && (
        <AddCustomerModal tenantId={tenant?.id} prefillCard={looksLikeCard ? term : ''}
          onSave={(newCustomer) => {
            setAddNew(false)
            if (newCustomer?.card_number) {
              setPicked(newCustomer)   // continue to top-up
            } else {
              toast('Member created. Add a card number to top up.', { icon:'ℹ️' })
              setResults(null); setSearch('')
            }
          }}
          onClose={() => setAddNew(false)}/>
      )}
    </>
  )
}
