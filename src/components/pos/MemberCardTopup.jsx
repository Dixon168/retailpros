// src/components/pos/MemberCardTopup.jsx
// POS "Top Up → Member Card" flow. Search a member by card #, phone, or
// name, then reuse the SAME TopupModal as the Members page so the feature
// and UX are identical. Member cards are separate from gift cards.
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useCartStore } from '@/stores/cartStore'
import { TopupModal } from '@/pages/customers/CustomersPage'
import toast from 'react-hot-toast'

export default function MemberCardTopup({ onClose }) {
  const { tenant, user } = useAuthStore()
  const [search, setSearch]   = useState('')
  const [results, setResults] = useState(null)   // null = not searched yet
  const [loading, setLoading] = useState(false)
  const [picked, setPicked]   = useState(null)    // member chosen → opens TopupModal

  const doSearch = async () => {
    const term = search.trim()
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

  return (
    <>
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.5)', display: picked ? 'none' : 'flex'}}
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
              <div className="rounded-xl px-4 py-6 text-center"
                style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                <div className="text-[28px] mb-2">🔍</div>
                <div className="text-[13px] font-bold mb-1" style={{color:'#1F1F1F'}}>No member found for “{search.trim()}”</div>
                <div className="text-[12px] text-slate-500 mb-3">Member cards are tied to a member. Add them first, then top up.</div>
                <a href="/customers" target="_blank" rel="noreferrer"
                  className="inline-block rounded-lg px-4 py-2.5 text-[12px] font-bold cursor-pointer no-underline"
                  style={{background:'#006AFF', color:'#fff'}}>
                  + Add a member on the Members page
                </a>
                <div className="text-[10px] text-slate-400 mt-2">Opens in a new tab — add the member, then come back and search again.</div>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
                {results.map(m => (
                  <button key={m.id} onClick={()=>setPicked(m)}
                    className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer border-none border-b border-slate-100 last:border-0 text-left hover:bg-blue-50/40 transition-all"
                    style={{background:'transparent'}}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-[16px] font-black"
                      style={{background:'#eff6ff', color:'#006AFF'}}>
                      {(m.name||'?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold truncate" style={{color:'#1F1F1F'}}>{m.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {m.card_number ? `Card #${m.card_number}` : 'No card #'}{m.phone ? ` · ${m.phone}` : ''}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[10px] text-slate-400 uppercase">Balance</div>
                      <div className="text-[15px] font-bold font-mono" style={{color:'#16a34a'}}>${(m.card_balance||0).toFixed(2)}</div>
                    </div>
                  </button>
                ))}
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
    </>
  )
}
