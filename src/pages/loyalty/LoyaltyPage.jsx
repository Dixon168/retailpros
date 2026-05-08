// src/pages/loyalty/LoyaltyPage.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

export default function LoyaltyPage() {
  const { tenant } = useAuthStore()
  const [tab, setTab] = useState('overview')
  const [showRecharge, setShowRecharge] = useState(false)
  const [selectedCard, setSelectedCard] = useState(null)
  const [payAmt, setPayAmt] = useState('')
  const [faceAmt, setFaceAmt] = useState('')

  const { data: cards=[] } = useQuery({
    queryKey: ['member-cards', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('member_cards')
        .select('*, customers(name, type)').eq('tenant_id', tenant.id)
        .order('issued_at', { ascending: false })
      return data||[]
    },
    enabled: !!tenant?.id,
  })

  const { data: program } = useQuery({
    queryKey: ['loyalty-program', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('loyalty_programs')
        .select('*').eq('tenant_id', tenant.id).maybeSingle()
      return data
    },
    enabled: !!tenant?.id,
  })

  const { data: topCustomers=[] } = useQuery({
    queryKey: ['top-loyalty', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('customers')
        .select('id, name, type, loyalty_points, total_spent')
        .eq('tenant_id', tenant.id).gt('loyalty_points', 0)
        .order('loyalty_points', { ascending: false }).limit(10)
      return data||[]
    },
    enabled: !!tenant?.id,
  })

  const memberCards = cards.filter(c=>c.type==='member')
  const giftCards = cards.filter(c=>c.type==='gift')
  const totalBalance = cards.reduce((s,c)=>s+(c.balance||0), 0)

  const TABS = [
    { id:'overview', label:'Overview' },
    { id:'cards', label:'Cards' },
    { id:'leaderboard', label:'Points Board' },
    { id:'settings', label:'Program Settings' },
  ]

  return (
    <div className="p-6 overflow-y-auto h-full bg-[#FAFAFA]">
      <div className="flex justify-between items-center mb-5">
        <div className="text-[20px] font-bold">🏷️ Loyalty, Points & Cards</div>
        <button onClick={()=>toast.success('Issue new card')} className="bg-yellow-500 border-none rounded-lg px-4 py-2 text-[12px] font-bold text-black">+ Issue Card</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#E5E5E5] mb-5">
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2.5 text-[12px] border-b-2 transition-all ${tab===t.id?'text-[#FA8C16] border-yellow-400':'text-[#666666] border-transparent hover:text-[#1F1F1F]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          <div className="grid grid-cols-5 gap-3 mb-6">
            {[
              ['Active Cards', cards.filter(c=>c.status==='active').length, '#006AFF'],
              ['Card Balances', `$${totalBalance.toFixed(0)}`, '#10b981'],
              ['Member Cards', memberCards.length, undefined],
              ['Gift Cards', giftCards.length, '#10b981'],
              ['Members w/ Points', topCustomers.length, '#f59e0b'],
            ].map(([l,v,c]) => (
              <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[11px] p-3.5">
                <div className="text-[9px] font-mono text-[#999999] uppercase tracking-wider mb-1">{l}</div>
                <div className="text-[20px] font-bold" style={{color:c}}>{v}</div>
              </div>
            ))}
          </div>
          {/* Top points */}
          <div className="text-[13px] font-bold mb-3">🏆 Top Points Members</div>
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] overflow-hidden">
            {topCustomers.slice(0,5).map((c,i) => (
              <div key={c.id} className="flex items-center gap-4 px-4 py-3 border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5] transition-colors">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${i===0?'bg-yellow-500/20 text-[#FA8C16]':i===1?'bg-slate-500/20 text-slate-300':i===2?'bg-orange-500/20 text-[#FA8C16]':'bg-[#F5F5F5] text-[#999999]'}`}>{i+1}</div>
                <div className="flex-1 text-[13px] font-semibold">{c.name}</div>
                <div className="font-mono text-[13px] font-bold text-purple-400">{c.loyalty_points} pts</div>
                <div className="font-mono text-[11px] text-[#00B23B]">${(c.loyalty_points/100).toFixed(2)}</div>
                <div className="font-mono text-[11px] text-[#666666]">${c.total_spent?.toFixed(0)||'0'} total</div>
              </div>
            ))}
            {topCustomers.length === 0 && <div className="text-center py-8 text-[#999999] text-sm">No loyalty members yet</div>}
          </div>
        </div>
      )}

      {tab === 'cards' && (
        <div>
          <div className="flex gap-4 mb-4">
            {[['Member Cards', memberCards.length, '#006AFF'],['Gift Cards', giftCards.length, '#10b981']].map(([l,v,c]) => (
              <div key={l} className="flex-1 bg-[#FFFFFF] border border-[#E5E5E5] rounded-[10px] p-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{background:`${c}18`}}>
                  {l.includes('Member')?'👤':'🎁'}
                </div>
                <div>
                  <div className="text-[18px] font-bold" style={{color:c}}>{v}</div>
                  <div className="text-[10px] text-[#999999]">{l}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] overflow-hidden">
            <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]" style={{gridTemplateColumns:'1.5fr 1fr 1fr 1fr 80px'}}>
              {['Card Number','Customer','Balance','Status','Actions'].map(h => (
                <div key={h} className="px-3.5 py-2.5 font-mono text-[10px] text-[#999999] uppercase tracking-wider">{h}</div>
              ))}
            </div>
            {cards.map(card => (
              <div key={card.id} className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5] transition-colors" style={{gridTemplateColumns:'1.5fr 1fr 1fr 1fr 80px'}}>
                <div className="px-3.5 py-3 flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold" style={{color: card.type==='member'?'#006AFF':'#10b981'}}>{card.card_number}</span>
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded font-bold" style={{background: card.type==='member'?'rgba(139,92,246,0.12)':'rgba(16,185,129,0.12)', color: card.type==='member'?'#006AFF':'#10b981'}}>
                    {card.type.toUpperCase()}
                  </span>
                </div>
                <div className="px-3.5 py-3 text-[12px]">{card.customers?.name||'—'}</div>
                <div className="px-3.5 py-3 font-mono text-[13px] font-bold">${card.balance?.toFixed(2)||'0.00'}</div>
                <div className="px-3.5 py-3">
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded ${card.status==='active'?'bg-green-500/10 text-[#00B23B]':'bg-[#F5F5F5] text-[#666666]'}`}>
                    {card.status?.toUpperCase()}
                  </span>
                </div>
                <div className="px-3.5 py-3 flex gap-1.5">
                  <button onClick={()=>{setSelectedCard(card);setPayAmt('');setFaceAmt('');setShowRecharge(true)}}
                    className="bg-green-500/10 border border-green-500/20 rounded px-2 py-1 text-[10px] text-[#00B23B] font-bold">+$</button>
                  <button onClick={()=>toast.success('Card history')} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded px-2 py-1 text-[10px] text-[#666666]">Hist</button>
                </div>
              </div>
            ))}
            {cards.length === 0 && <div className="text-center py-8 text-[#999999] text-sm">No cards issued yet</div>}
          </div>
        </div>
      )}

      {tab === 'leaderboard' && (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] overflow-hidden">
          <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]" style={{gridTemplateColumns:'50px 2fr 1fr 1fr 1fr 1fr'}}>
            {['#','Customer','Points','Value','Spent','Tier'].map(h => (
              <div key={h} className="px-3.5 py-2.5 font-mono text-[10px] text-[#999999] uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {topCustomers.map((c,i) => (
            <div key={c.id} className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5] transition-colors" style={{gridTemplateColumns:'50px 2fr 1fr 1fr 1fr 1fr'}}>
              <div className="px-3.5 py-3">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${i===0?'bg-yellow-500/20 text-[#FA8C16]':i===1?'bg-slate-500/20 text-slate-300':i===2?'bg-orange-500/20 text-[#FA8C16]':'bg-[#F5F5F5] text-[#999999]'}`}>{i+1}</div>
              </div>
              <div className="px-3.5 py-3 text-[12px] font-semibold">{c.name}</div>
              <div className="px-3.5 py-3 font-mono text-[13px] font-bold text-purple-400">{c.loyalty_points}</div>
              <div className="px-3.5 py-3 font-mono text-[12px] text-[#00B23B]">${(c.loyalty_points/100).toFixed(2)}</div>
              <div className="px-3.5 py-3 font-mono text-[12px]">${c.total_spent?.toFixed(0)||'0'}</div>
              <div className="px-3.5 py-3">
                <span className="text-[9px] font-mono px-2 py-0.5 rounded" style={{background:c.type==='vip'?'rgba(245,158,11,0.1)':'rgba(16,185,129,0.1)', color:c.type==='vip'?'#f59e0b':'#10b981'}}>
                  {c.type?.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'settings' && (
        <div className="max-w-[600px]">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5 mb-4">
            <div className="flex justify-between mb-4">
              <div className="text-[13px] font-bold">🏷️ Points Earning Rules</div>
              <button onClick={()=>toast.success('Edit rules')} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#666666] hover:border-yellow-500/30 hover:text-[#FA8C16] transition-all">Edit</button>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[['Retail','1 pt','#10b981'],['Wholesale','0.5 pt','#06b6d4'],['VIP ⭐','2 pt','#f59e0b']].map(([type,pts,c]) => (
                <div key={type} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[10px] p-3.5 text-center">
                  <div className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{color:c}}>{type}</div>
                  <div className="text-[24px] font-bold" style={{color:c}}>{pts}</div>
                  <div className="text-[10px] text-[#999999] mt-1">per $1 spent</div>
                </div>
              ))}
            </div>
            <div className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[10px] p-3.5 flex gap-6">
              {[['100 pts','= $1.00 discount'],['Min Redeem','100 points'],['Expiry','Never']].map(([v,l]) => (
                <div key={l} className="text-center flex-1">
                  <div className="text-[16px] font-bold font-mono">{v}</div>
                  <div className="text-[10px] text-[#999999] mt-1">{l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5">
            <div className="flex justify-between mb-4">
              <div className="text-[13px] font-bold">🎁 Recharge Promotions</div>
              <button onClick={()=>toast.success('Add promo')} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#666666] hover:border-yellow-500/30 hover:text-[#FA8C16] transition-all">+ Add</button>
            </div>
            {[['Pay $80 → Get $100','Always active','25% bonus'],['Pay $200 → Get $250','VIP only','25% bonus']].map(([name,scope,bonus]) => (
              <div key={name} className="flex items-center gap-3 bg-[#F5F5F5] border border-green-500/20 rounded-[9px] px-3.5 py-3 mb-2">
                <div className="text-lg">🌟</div>
                <div className="flex-1"><div className="text-[12px] font-bold">{name}</div><div className="text-[10px] text-[#999999] mt-0.5">{scope} · {bonus}</div></div>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-green-500/10 text-[#00B23B]">ACTIVE</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recharge overlay */}
      {showRecharge && selectedCard && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm z-50 flex items-center justify-center" onClick={()=>setShowRecharge(false)}>
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl w-[400px]" onClick={e=>e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#E5E5E5]">
              <div className="text-[15px] font-bold">💳 Recharge Card</div>
              <div className="text-[11px] font-mono text-[#999999] mt-1">{selectedCard.card_number} · Balance: ${selectedCard.balance?.toFixed(2)}</div>
            </div>
            <div className="p-5">
              <div className="bg-gradient-to-br from-[#1a1f35] to-[#2d1b69] border border-purple-500/20 rounded-[12px] p-4 mb-4">
                <div className="text-[9px] font-mono text-purple-300/60 uppercase tracking-widest mb-2">{selectedCard.type.toUpperCase()} CARD</div>
                <div className="font-mono text-[13px] font-bold tracking-widest mb-1">{selectedCard.card_number}</div>
                <div className="text-[20px] font-bold text-purple-400">${selectedCard.balance?.toFixed(2)}</div>
                <div className="text-[11px] text-purple-300/50 mt-1">{selectedCard.customers?.name||'Unassigned'}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-2">Customer Pays</div>
                  <input value={payAmt} onChange={e=>setPayAmt(e.target.value)} type="number" className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2.5 text-[14px] font-mono outline-none text-right focus:border-yellow-500/40" placeholder="80.00"/>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-2">Card Receives</div>
                  <input value={faceAmt} onChange={e=>setFaceAmt(e.target.value)} type="number" className="w-full bg-[#F5F5F5] border border-green-500/30 rounded-[9px] px-3 py-2.5 text-[14px] font-mono outline-none text-right" placeholder="100.00"/>
                </div>
              </div>
              <div className="flex gap-1.5 mb-4">
                {[[40,50],[80,100],[160,200]].map(([p,f]) => (
                  <button key={p} onClick={()=>{setPayAmt(p);setFaceAmt(f)}} className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg py-2 text-[10px] font-mono text-[#666666] hover:border-yellow-500/30 hover:text-[#FA8C16] transition-all">
                    ${p}→${f}
                  </button>
                ))}
              </div>
              {faceAmt && payAmt && parseFloat(faceAmt) > parseFloat(payAmt) && (
                <div className="bg-green-500/8 border border-green-500/20 rounded-[9px] px-3.5 py-2.5 mb-4 text-[11px] text-[#00B23B]">
                  🎁 Bonus: ${(parseFloat(faceAmt)-parseFloat(payAmt)).toFixed(2)} extra ({((parseFloat(faceAmt)-parseFloat(payAmt))/parseFloat(payAmt)*100).toFixed(0)}% more value!)
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={()=>setShowRecharge(false)} className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] py-2.5 text-[13px] text-[#666666]">Cancel</button>
                <button onClick={()=>{setShowRecharge(false);toast.success(`Card recharged! +$${faceAmt||'0'}`)}} className="flex-[2] bg-gradient-to-r from-green-500 to-green-600 border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white">✓ Recharge</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
