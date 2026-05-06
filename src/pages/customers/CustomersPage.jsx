// src/pages/customers/CustomersPage.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import NumPad from '@/components/ui/NumPad'
import toast from 'react-hot-toast'

const TIER_STYLE = {
  regular:   { bg:'#f1f5f9', color:'#475569', label:'Regular' },
  vip:       { bg:'#fef9c3', color:'#ca8a04', label:'VIP' },
  silver:    { bg:'#f1f5f9', color:'#64748b', label:'Silver' },
  gold:      { bg:'#fffbeb', color:'#d97706', label:'Gold' },
  platinum:  { bg:'#e0e7ff', color:'#6366f1', label:'Platinum' },
  wholesale: { bg:'#eff6ff', color:'#2563eb', label:'Wholesale' },
  staff:     { bg:'#f0fdf4', color:'#16a34a', label:'Staff' },
}

export default function CustomersPage() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState('all')
  const [selected, setSelected]     = useState(null)
  const [activeTab, setActiveTab]   = useState('details')
  const [showAdd, setShowAdd]       = useState(false)
  const [showTopup, setShowTopup]   = useState(false)
  const [showEdit, setShowEdit]     = useState(false)

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', tenant?.id, search, filter],
    queryFn: async () => {
      let q = supabase.from('customers')
        .select('id,code,name,phone,email,loyalty_points,credit_balance,is_active,created_at,card_number,card_balance,card_expire_date,member_level,member_since,birthday,gender')
        .eq('tenant_id', tenant.id).eq('is_active', true)
      if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%,code.ilike.%${search}%,card_number.ilike.%${search}%,email.ilike.%${search}%`)
      if (filter === 'vip')       q = q.eq('member_level', 'Level 4 - Platinum')
      if (filter === 'owes')      q = q.gt('credit_balance',0)
      if (filter === 'balance')   q = q.gt('card_balance',0)
      if (filter === 'expiring') {
        const soon = new Date(Date.now()+30*86400000).toISOString().split('T')[0]
        q = q.lte('card_expire_date', soon).gte('card_expire_date', new Date().toISOString().split('T')[0])
      }
      const { data } = await q.order('name').limit(100)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const totalBalance = customers.reduce((s,c)=>s+(c.card_balance||0),0)
  const totalPoints  = customers.reduce((s,c)=>s+(c.loyalty_points||0),0)

  return (
    <div className="h-full flex" style={{background:'#f0f2f5'}}>

      {/* ── Left: List ── */}
      <div className="flex flex-col flex-shrink-0" style={{width:'380px', borderRight:'1px solid #e2e8f0', background:'#fff'}}>

        {/* Search + Add */}
        <div className="p-3 border-b" style={{borderColor:'#f1f5f9'}}>
          <div className="flex gap-2 mb-2">
            <div className="flex-1 flex items-center rounded-xl px-3 gap-2"
              style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}>
              <span className="text-slate-400">🔍</span>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Name, phone, card#, code..."
                className="flex-1 border-none outline-none py-2 text-[13px] bg-transparent"/>
            </div>
            <button onClick={()=>setShowAdd(true)}
              className="rounded-xl px-3 py-2 text-[12px] font-bold text-white cursor-pointer border-none"
              style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
              + New
            </button>
          </div>
          {/* Filters */}
          <div className="flex gap-1.5 flex-wrap">
            {[['all','All'],['vip','VIP'],['balance','Has Balance'],['owes','Owes'],['expiring','Expiring']].map(([id,label])=>(
              <button key={id} onClick={()=>setFilter(id)}
                className="px-2.5 py-1 rounded-lg text-[10px] font-semibold cursor-pointer border transition-all"
                style={filter===id ? {background:'#6366f1',borderColor:'#6366f1',color:'#fff'} : {background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-px flex-shrink-0" style={{background:'#f1f5f9'}}>
          {[
            ['Members', customers.length, '#6366f1'],
            ['Total Balance', `$${totalBalance.toFixed(0)}`, '#16a34a'],
            ['Total Points', totalPoints.toLocaleString(), '#f59e0b'],
          ].map(([l,v,c])=>(
            <div key={l} className="px-3 py-2 text-center" style={{background:'#f8fafc'}}>
              <div className="text-[9px] text-slate-400 uppercase">{l}</div>
              <div className="text-[14px] font-bold" style={{color:c}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Customer list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400 text-[12px]">Loading...</div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-slate-300">
              <div className="text-[40px] mb-2">👥</div>
              <div className="text-[13px]">No customers found</div>
            </div>
          ) : customers.map(c => {
            const ts = TIER_STYLE[c.tier||c.member_level?.split(' ')[0]?.toLowerCase()] || TIER_STYLE.regular
            const initials = c.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()
            const isSelected = selected?.id === c.id
            const isExpiring = c.card_expire_date && new Date(c.card_expire_date) < new Date(Date.now()+30*86400000)
            return (
              <div key={c.id} onClick={()=>{setSelected(c);setActiveTab('details')}}
                className="flex items-center gap-3 px-3 py-3 cursor-pointer border-b transition-all"
                style={{
                  borderColor:'#f8fafc',
                  background: isSelected ? '#f0f4ff' : '#fff',
                  borderLeft: isSelected ? '3px solid #6366f1' : '3px solid transparent',
                }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0"
                  style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-slate-800 truncate">{c.name}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={ts}>
                      {ts.label}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {c.phone || c.email || c.code}
                    {c.card_number && <span className="ml-1.5 font-mono">· #{c.card_number}</span>}
                  </div>
                  <div className="flex gap-2 mt-0.5">
                    {(c.card_balance||0) > 0 && (
                      <span className="text-[10px] font-bold" style={{color:'#16a34a'}}>
                        💳 ${c.card_balance.toFixed(2)}
                      </span>
                    )}
                    {(c.loyalty_points||0) > 0 && (
                      <span className="text-[10px] font-bold" style={{color:'#9333ea'}}>
                        💎 {c.loyalty_points}pts
                      </span>
                    )}
                    {isExpiring && (
                      <span className="text-[10px] font-bold text-red-500">⚠️ Expiring</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right: Detail ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-300">
            <div className="text-[64px] mb-4">👥</div>
            <div className="text-[16px] font-semibold">Select a customer</div>
            <div className="text-[12px] mt-1">Click a customer to view details</div>
          </div>
        ) : (
          <CustomerDetail
            customer={selected}
            tenantId={tenant?.id}
            userId={user?.id}
            userName={user?.name}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onTopup={() => setShowTopup(true)}
            onEdit={() => setShowEdit(true)}
            onRefresh={() => {
              qc.invalidateQueries(['customers'])
              qc.invalidateQueries(['customer-detail', selected.id])
            }}
          />
        )}
      </div>

      {/* Modals */}
      {showAdd && (
        <AddCustomerModal tenantId={tenant?.id}
          onSave={(c) => { qc.invalidateQueries(['customers']); setSelected(c); setShowAdd(false) }}
          onClose={() => setShowAdd(false)}/>
      )}
      {showTopup && selected && (
        <TopupModal customer={selected} tenantId={tenant?.id}
          userId={user?.id} userName={user?.name}
          onSave={(updated) => {
            setSelected(s => ({...s, card_balance: updated.card_balance}))
            qc.invalidateQueries(['customers'])
            qc.invalidateQueries(['customer-topups', selected.id])
            setShowTopup(false)
          }}
          onClose={() => setShowTopup(false)}/>
      )}
      {showEdit && selected && (
        <EditCustomerModal customer={selected} tenantId={tenant?.id}
          onSave={(updated) => {
            setSelected(updated)
            qc.invalidateQueries(['customers'])
            setShowEdit(false)
          }}
          onClose={() => setShowEdit(false)}/>
      )}
    </div>
  )
}

// ── Customer Detail ──
function CustomerDetail({ customer: c, tenantId, userId, userName, activeTab, setActiveTab, onTopup, onEdit, onRefresh }) {
  const ts = TIER_STYLE[c.tier||c.member_level?.split(' ')[0]?.toLowerCase()] || TIER_STYLE.regular
  const isExpired  = c.card_expire_date && new Date(c.card_expire_date) < new Date()
  const isExpiring = c.card_expire_date && !isExpired && new Date(c.card_expire_date) < new Date(Date.now()+30*86400000)

  const TABS = ['Details','Transactions','Points','Top-up History']

  const { data: orders = [] } = useQuery({
    queryKey: ['customer-orders', c.id],
    queryFn: async () => {
      const { data } = await supabase.from('orders')
        .select('id,order_number,grand_total,created_at,status,refund_status')
        .eq('customer_id', c.id).order('created_at',{ascending:false}).limit(50)
      return data || []
    },
    enabled: activeTab === 'Transactions',
  })

  const { data: pointsLog = [] } = useQuery({
    queryKey: ['customer-points', c.id],
    queryFn: async () => {
      const { data } = await supabase.from('customer_points_log')
        .select('*').eq('customer_id', c.id)
        .order('created_at',{ascending:false}).limit(50)
      return data || []
    },
    enabled: activeTab === 'Points',
  })

  const { data: topups = [] } = useQuery({
    queryKey: ['customer-topups', c.id],
    queryFn: async () => {
      const { data } = await supabase.from('customer_topups')
        .select('*').eq('customer_id', c.id)
        .order('created_at',{ascending:false}).limit(50)
      return data || []
    },
    enabled: activeTab === 'Top-up History',
  })

  return (
    <div className="flex flex-col h-full">
      {/* Customer header card */}
      <div className="p-5 flex-shrink-0" style={{background:'#fff', borderBottom:'1px solid #e2e8f0'}}>
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-[24px] font-black text-white flex-shrink-0"
            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
            {c.name.charAt(0)}
          </div>
          {/* Info */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[20px] font-black text-slate-800">{c.name}</div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={ts}>{ts.label}</span>
            </div>
            <div className="flex flex-wrap gap-3 text-[12px] text-slate-500">
              {c.card_number && <span className="font-mono font-bold">#{c.card_number}</span>}
              {c.phone && <span>📱 {c.phone}</span>}
              {c.email && <span>✉️ {c.email}</span>}
              {c.birthday && <span>🎂 {new Date(c.birthday).toLocaleDateString()}</span>}
            </div>
          </div>
          {/* Action buttons */}
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={onTopup}
              className="rounded-xl px-3 py-2 text-[12px] font-bold cursor-pointer border-none"
              style={{background:'#dcfce7', color:'#16a34a'}}>
              💳 Top Up
            </button>
            <button onClick={onEdit}
              className="rounded-xl px-3 py-2 text-[12px] font-bold cursor-pointer border-none"
              style={{background:'#e0e7ff', color:'#6366f1'}}>
              ✏️ Edit
            </button>
          </div>
        </div>

        {/* Balance cards */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          {[
            ['💳 Card Balance', `$${(c.card_balance||0).toFixed(2)}`, c.card_balance>0?'#16a34a':'#94a3b8', '#f0fdf4','#86efac'],
            ['💎 Points', `${(c.loyalty_points||0).toLocaleString()}`, c.loyalty_points>0?'#9333ea':'#94a3b8', '#fdf4ff','#e9d5ff'],
            ['🏷️ Member Since', c.member_since ? new Date(c.member_since).toLocaleDateString() : '—', '#6366f1','#f0f4ff','#c7d2fe'],
            ['📅 Expires', c.card_expire_date ? new Date(c.card_expire_date).toLocaleDateString() : '—',
              isExpired?'#dc2626':isExpiring?'#f59e0b':'#64748b',
              isExpired?'#fef2f2':isExpiring?'#fffbeb':'#f8fafc',
              isExpired?'#fca5a5':isExpiring?'#fde047':'#e2e8f0'],
          ].map(([label,value,color,bg,border])=>(
            <div key={label} className="rounded-xl p-3 text-center"
              style={{background:bg, border:`1.5px solid ${border}`}}>
              <div className="text-[10px] text-slate-400 mb-1">{label}</div>
              <div className="text-[16px] font-black" style={{color}}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b flex-shrink-0" style={{background:'#fff', borderColor:'#e2e8f0'}}>
        {TABS.map(tab=>(
          <button key={tab} onClick={()=>setActiveTab(tab)}
            className="px-4 py-2.5 text-[12px] font-semibold cursor-pointer border-none border-b-2 transition-all"
            style={{
              background:'transparent',
              borderBottomColor: activeTab===tab ? '#6366f1' : 'transparent',
              color: activeTab===tab ? '#6366f1' : '#64748b',
            }}>
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-5">

        {/* ── DETAILS ── */}
        {activeTab === 'Details' && (
          <div className="grid grid-cols-2 gap-4">
            <InfoCard title="Personal Info">
              {[
                ['Full Name', c.name],
                ['Gender', c.gender || '—'],
                ['Birthday', c.birthday ? new Date(c.birthday).toLocaleDateString() : '—'],
                ['Phone', c.phone || '—'],
                ['Email', c.email || '—'],
                ['Company', c.company || '—'],
              ].map(([l,v])=><InfoRow key={l} label={l} value={v}/>)}
            </InfoCard>
            <InfoCard title="Membership">
              {[
                ['Card #', c.card_number || '—'],
                ['Member Code', c.code || '—'],
                
                ['Level', c.member_level || '—'],
                ['Member Since', c.member_since ? new Date(c.member_since).toLocaleDateString() : '—'],
                ['Expire Date', c.card_expire_date ? new Date(c.card_expire_date).toLocaleDateString() : '—'],
                ['Referrer', c.referrer || '—'],
              ].map(([l,v])=><InfoRow key={l} label={l} value={v}/>)}
            </InfoCard>
            <InfoCard title="Balance & Points">
              {[
                ['Card Balance', `$${(c.card_balance||0).toFixed(2)}`],
                ['Points Balance', `${(c.loyalty_points||0).toLocaleString()} pts`],
                ['Credit Owed', `$${(c.credit_balance||0).toFixed(2)}`],
              ].map(([l,v])=><InfoRow key={l} label={l} value={v}/>)}
            </InfoCard>
            <InfoCard title="Address & Notes">
              {[
                ['Address', c.billing_address || '—'],
                ['Notes', c.notes || '—'],
              ].map(([l,v])=><InfoRow key={l} label={l} value={v}/>)}
            </InfoCard>
          </div>
        )}

        {/* ── TRANSACTIONS ── */}
        {activeTab === 'Transactions' && (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                ['Total Spent', `$${orders.reduce((s,o)=>s+(o.grand_total||0),0).toFixed(2)}`, '#16a34a'],
                ['Transactions', orders.length, '#6366f1'],
                ['Avg Order', orders.length>0?`$${(orders.reduce((s,o)=>s+(o.grand_total||0),0)/orders.length).toFixed(2)}`:'—', '#f59e0b'],
              ].map(([l,v,c2])=>(
                <div key={l} className="rounded-xl p-3 text-center" style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
                  <div className="text-[10px] text-slate-400 mb-1">{l}</div>
                  <div className="text-[18px] font-black" style={{color:c2}}>{v}</div>
                </div>
              ))}
            </div>
            {orders.length === 0 ? <EmptyState msg="No transactions yet"/> : (
              <table className="w-full border-collapse rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                <thead><tr>
                  {['Date','Order #','Amount','Status'].map(h=>(
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-500"
                      style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{orders.map((o,i)=>{
                  const status = o.refund_status==='full'?'Refunded':o.refund_status==='partial'?'Part.Refund':o.status==='voided'?'Voided':'Completed'
                  const sc = {Refunded:'#9333ea','Part.Refund':'#2563eb',Voided:'#64748b',Completed:'#16a34a'}
                  return (
                    <tr key={i} className="hover:bg-blue-50/30" style={{borderBottom:'1px solid #f1f5f9'}}>
                      <td className="px-3 py-2.5 text-[12px] text-slate-600">{new Date(o.created_at).toLocaleDateString()} {new Date(o.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td>
                      <td className="px-3 py-2.5 text-[12px] font-mono font-bold" style={{color:'#6366f1'}}>{o.order_number}</td>
                      <td className="px-3 py-2.5 text-[13px] font-bold font-mono">${(o.grand_total||0).toFixed(2)}</td>
                      <td className="px-3 py-2.5"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{background:`${sc[status]}20`,color:sc[status]}}>{status}</span></td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
          </div>
        )}

        {/* ── POINTS ── */}
        {activeTab === 'Points' && (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                ['Current Balance', `${(c.loyalty_points||0).toLocaleString()} pts`, '#9333ea'],
                ['Total Earned', `${pointsLog.filter(p=>p.type==='earn').reduce((s,p)=>s+(p.points||0),0).toLocaleString()} pts`, '#16a34a'],
                ['Total Redeemed', `${pointsLog.filter(p=>p.type==='redeem').reduce((s,p)=>s+Math.abs(p.points||0),0).toLocaleString()} pts`, '#f59e0b'],
              ].map(([l,v,c2])=>(
                <div key={l} className="rounded-xl p-3 text-center" style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
                  <div className="text-[10px] text-slate-400 mb-1">{l}</div>
                  <div className="text-[18px] font-black" style={{color:c2}}>{v}</div>
                </div>
              ))}
            </div>
            {pointsLog.length === 0 ? <EmptyState msg="No points history yet"/> : (
              <table className="w-full border-collapse rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                <thead><tr>
                  {['Date','Type','Points','Balance','Note'].map(h=>(
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-500"
                      style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{pointsLog.map((p,i)=>(
                  <tr key={i} className="hover:bg-purple-50/30" style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td className="px-3 py-2.5 text-[11px] text-slate-500">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{background:p.type==='earn'?'#dcfce7':p.type==='redeem'?'#fdf4ff':'#f1f5f9', color:p.type==='earn'?'#16a34a':p.type==='redeem'?'#9333ea':'#64748b'}}>
                        {(p.type||'earn').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[13px] font-bold font-mono"
                      style={{color:p.points>0?'#16a34a':'#dc2626'}}>
                      {p.points>0?'+':''}{p.points}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] font-mono">{p.balance?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-400">{p.note||'—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}

        {/* ── TOP-UP HISTORY ── */}
        {activeTab === 'Top-up History' && (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                ['Total Topped Up', `$${topups.reduce((s,t)=>s+(t.amount||0),0).toFixed(2)}`, '#16a34a'],
                ['Times', topups.length, '#6366f1'],
              ].map(([l,v,c2])=>(
                <div key={l} className="rounded-xl p-3 text-center" style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
                  <div className="text-[10px] text-slate-400 mb-1">{l}</div>
                  <div className="text-[18px] font-black" style={{color:c2}}>{v}</div>
                </div>
              ))}
            </div>
            {topups.length === 0 ? <EmptyState msg="No top-up history yet"/> : (
              <table className="w-full border-collapse rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                <thead><tr>
                  {['Date','Amount','Method','Staff','Note'].map(h=>(
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-500"
                      style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{topups.map((t,i)=>(
                  <tr key={i} className="hover:bg-green-50/30" style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td className="px-3 py-2.5 text-[11px] text-slate-500">{new Date(t.created_at).toLocaleDateString()} {new Date(t.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td>
                    <td className="px-3 py-2.5 text-[14px] font-black font-mono text-green-600">+${(t.amount||0).toFixed(2)}</td>
                    <td className="px-3 py-2.5"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize" style={{background:'#eff6ff',color:'#2563eb'}}>{t.method||'cash'}</span></td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-500">{t.staff_name||'—'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-400">{t.note||'—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Top Up Modal ──
function TopupModal({ customer, tenantId, userId, userName, onSave, onClose }) {
  const [amount,  setAmount]  = useState('')
  const [method,  setMethod]  = useState('cash')
  const [note,    setNote]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [showPad, setShowPad] = useState(true)

  const handleSave = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast.error('Enter amount'); return }
    setSaving(true)
    try {
      const newBal = (customer.card_balance||0) + amt
      await supabase.from('customers').update({ card_balance: newBal }).eq('id', customer.id)
      await supabase.from('customer_topups').insert({
        tenant_id: tenantId, customer_id: customer.id,
        amount: amt, method, note: note||null,
        staff_id: userId, staff_name: userName,
      })
      toast.success(`✓ Topped up $${amt.toFixed(2)}`)
      onSave({ card_balance: newBal })
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{background:'rgba(15,23,42,0.6)', backdropFilter:'blur(6px)'}}>
      <div className="rounded-2xl overflow-hidden shadow-2xl w-[400px]"
        style={{background:'#fff'}}>

        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'linear-gradient(135deg,#16a34a,#15803d)'}}>
          <div>
            <div className="text-[16px] font-bold text-white">💳 Top Up Balance</div>
            <div className="text-[11px] text-green-200">{customer.name} · Current: ${(customer.card_balance||0).toFixed(2)}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white flex items-center justify-center">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Amount display */}
          <button onClick={() => setShowPad(true)}
            className="w-full rounded-2xl py-4 text-center cursor-pointer border-2 transition-all"
            style={{border: amount?'2px solid #86efac':'2px dashed #e2e8f0', background: amount?'#f0fdf4':'#f8fafc'}}>
            <div className="text-[11px] text-slate-400 mb-1">Top Up Amount</div>
            <div className="text-[36px] font-black font-mono" style={{color: amount?'#16a34a':'#94a3b8'}}>
              ${amount ? parseFloat(amount).toFixed(2) : '0.00'}
            </div>
          </button>

          {/* Quick amounts */}
          <div className="grid grid-cols-4 gap-2">
            {[20, 50, 100, 200].map(q => (
              <button key={q} onClick={() => setAmount(String(q))}
                className="rounded-xl py-2.5 text-[13px] font-bold cursor-pointer border-2 transition-all"
                style={parseFloat(amount)===q
                  ? {background:'#16a34a', borderColor:'#16a34a', color:'#fff'}
                  : {background:'#f0fdf4', borderColor:'#86efac', color:'#16a34a'}}>
                ${q}
              </button>
            ))}
          </div>

          {/* Method */}
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Payment Method</div>
            <div className="flex gap-2">
              {[['cash','💵 Cash'],['card','💳 Card'],['transfer','🏦 Transfer']].map(([m,l])=>(
                <button key={m} onClick={()=>setMethod(m)}
                  className="flex-1 rounded-xl py-2 text-[11px] font-bold cursor-pointer border-2 transition-all"
                  style={method===m
                    ? {background:'#e0e7ff', borderColor:'#6366f1', color:'#6366f1'}
                    : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Note (optional)</div>
            <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional note..."
              className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
              style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
          </div>

          {/* Preview */}
          {amount && (
            <div className="rounded-xl p-3" style={{background:'#f0fdf4', border:'1px solid #86efac'}}>
              <div className="flex justify-between text-[12px]">
                <span className="text-slate-500">Current Balance</span>
                <span className="font-mono">${(customer.card_balance||0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[12px] mt-1">
                <span className="text-slate-500">Top Up</span>
                <span className="font-mono text-green-600">+${parseFloat(amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[14px] font-bold mt-2 pt-2" style={{borderTop:'1px solid #86efac'}}>
                <span>New Balance</span>
                <span className="font-mono text-green-700">${((customer.card_balance||0)+parseFloat(amount)).toFixed(2)}</span>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border"
              style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>Cancel</button>
            <button onClick={handleSave} disabled={saving || !amount}
              className="flex-[2] rounded-xl py-3 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
              style={{background:'linear-gradient(135deg,#16a34a,#15803d)'}}>
              {saving ? '⏳' : `✓ Top Up $${amount ? parseFloat(amount).toFixed(2) : '0.00'}`}
            </button>
          </div>
        </div>
      </div>

      {showPad && (
        <NumPad title="Top Up Amount" prefix="$"
          value={amount} onChange={setAmount}
          allowNegative={false} allowDecimal={true}
          onConfirm={v => { setAmount(v.toFixed(2)); setShowPad(false) }}
          onClose={() => setShowPad(false)}/>
      )}
    </div>
  )
}

// ── Add Customer Modal ──
function AddCustomerModal({ tenantId, onSave, onClose }) {
  const { data: memberLevels = [] } = useQuery({
    queryKey: ['member-levels'],
    queryFn: async () => {
      const { data } = await supabase.from('member_levels')
        .select('id,name,discount_pct').order('sort_order')
      return data || []
    },
  })
  const [form, setForm] = useState({
    name:'', phone:'', email:'', birthday:'',
    gender:'', address:'', notes:'',
    card_number:'', member_level:'', card_expire_date:'',
  })
  const setF = (k,v) => setForm(f=>({...f,[k]:v}))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }
    if (!form.phone.trim()) { toast.error('Phone required'); return }
    setSaving(true)
    try {
      const code = 'C' + Date.now().toString().slice(-6)
      // Minimal safe payload - only fields we know exist
      const payload = {
        tenant_id:    tenantId,
        code,
        name:         form.name.trim(),
        phone:        form.phone || null,
        email:        form.email || null,
        is_active:    true,
      }
      // Add optional fields safely
      // type removed - has DB constraint
      if (form.notes)            payload.notes            = form.notes
      if (form.card_number)      payload.card_number      = form.card_number
      if (form.member_level)     payload.member_level     = form.member_level
      if (form.card_expire_date) payload.card_expire_date = form.card_expire_date
      if (form.birthday)         payload.birthday         = form.birthday
      if (form.address)          payload.billing_address  = form.address
      if (form.gender)           payload.gender           = form.gender

      console.log('Inserting customer payload:', payload)
      const { data, error } = await supabase.from('customers').insert(payload).select().single()
      if (error) { console.error('Insert error:', error); throw error }
      toast.success(`✓ ${form.name} added!`)
      onSave(data)
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{background:'rgba(15,23,42,0.6)', backdropFilter:'blur(6px)'}}>
      <div className="rounded-2xl overflow-hidden shadow-2xl w-[560px] max-h-[90vh] flex flex-col"
        style={{background:'#fff'}}>

        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0"
          style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
          <div className="text-[16px] font-bold text-white">➕ New Customer</div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white flex items-center justify-center">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Basic */}
          <div className="rounded-xl p-4" style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
            <div className="text-[11px] font-bold text-slate-500 uppercase mb-3">Basic Information</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Full Name *</div>
                <input value={form.name} onChange={e=>setF('name',e.target.value)} placeholder="Customer name" autoFocus
                  className="w-full rounded-xl px-3 py-2.5 text-[14px] font-semibold outline-none"
                  style={{border:'1.5px solid #a5b4fc',background:'#fff'}}/>
              </div>
              {[['phone','Phone','tel'],['email','Email','email'],['birthday','Birthday','date']].map(([k,l,t])=>(
                <div key={k}>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">{l}</div>
                  <input type={t} value={form[k]} onChange={e=>setF(k,e.target.value)} placeholder={l}
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{border:'1.5px solid #e2e8f0',background:'#fff'}}/>
                </div>
              ))}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Gender</div>
                <select value={form.gender} onChange={e=>setF('gender',e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#fff'}}>
                  <option value="">— Select —</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Membership */}
          <div className="rounded-xl p-4" style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
            <div className="text-[11px] font-bold text-slate-500 uppercase mb-3">Membership</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Card Number</div>
                <input value={form.card_number} onChange={e=>setF('card_number',e.target.value)} placeholder="e.g. 168"
                  className="w-full rounded-xl px-3 py-2 text-[13px] font-mono outline-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#fff'}}/>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Member Level</div>
                <select value={form.member_level} onChange={e=>setF('member_level',e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#fff'}}>
                  {memberLevels.length === 0 && <option value="Level 1 - Regular">Level 1 - Regular (default)</option>}
                  {memberLevels.map(l=>(
                    <option key={l.id} value={l.name}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Expire Date</div>
                <input type="date" value={form.card_expire_date} onChange={e=>setF('card_expire_date',e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#fff'}}/>
              </div>

            </div>
          </div>

          {/* Address/Notes */}
          <div className="rounded-xl p-4" style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
            <div className="text-[11px] font-bold text-slate-500 uppercase mb-3">Additional</div>
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Address</div>
                <input value={form.address} onChange={e=>setF('address',e.target.value)} placeholder="Address"
                  className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#fff'}}/>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Notes</div>
                <textarea value={form.notes} onChange={e=>setF('notes',e.target.value)} rows={2}
                  placeholder="Internal notes" className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#fff'}}/>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 pt-3 flex gap-3 flex-shrink-0" style={{borderTop:'1px solid #f1f5f9'}}>
          <button onClick={onClose}
            className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border"
            style={{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>Cancel</button>
          <button onClick={handleSave} disabled={saving||!form.name.trim()||!form.phone.trim()}
            className="flex-[2] rounded-xl py-3 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
            {saving ? '⏳ Saving...' : '✓ Add Customer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Customer Modal ──
function EditCustomerModal({ customer, tenantId, onSave, onClose }) {
  const { data: memberLevels = [] } = useQuery({
    queryKey: ['member-levels'],
    queryFn: async () => {
      const { data } = await supabase.from('member_levels')
        .select('id,name,discount_pct').order('sort_order')
      return data || []
    },
  })
  const [form, setForm] = useState({
    name: customer.name||'', phone: customer.phone||'', email: customer.email||'',
    company: customer.company||'', birthday: customer.birthday||'',
    gender: customer.gender||'', address: customer.billing_address||'',
    notes: customer.notes||'',
    card_number: customer.card_number||'', member_level: customer.member_level||'',
    card_expire_date: customer.card_expire_date||'', referrer: customer.referrer||'',
  })
  const setF = (k,v) => setForm(f=>({...f,[k]:v}))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }
    if (!form.phone.trim()) { toast.error('Phone required'); return }
    setSaving(true)
    try {
      const payload = {
        name:             form.name.trim(),
        phone:            form.phone || null,
        email:            form.email || null,
        gender:           form.gender || null,
        type:             'regular',
        notes:            form.notes || null,
        card_number:      form.card_number || null,
        member_level:     form.member_level || 'Level 1',
        card_expire_date: form.card_expire_date || null,
        referrer:         form.referrer || null,
        billing_address:  form.address || null,
      }
      if (form.birthday) payload.birthday = form.birthday
      const { data, error } = await supabase.from('customers').update(payload)
        .eq('id', customer.id).select().single()
      if (error) throw error
      toast.success('✓ Updated!')
      onSave(data)
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{background:'rgba(15,23,42,0.6)', backdropFilter:'blur(6px)'}}>
      <div className="rounded-2xl overflow-hidden shadow-2xl w-[560px] max-h-[90vh] flex flex-col"
        style={{background:'#fff'}}>
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0"
          style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
          <div className="text-[16px] font-bold text-white">✏️ Edit — {customer.name}</div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white flex items-center justify-center">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div className="rounded-xl p-4" style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
            <div className="text-[11px] font-bold text-slate-500 uppercase mb-3">Basic Info</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Full Name *</div>
                <input value={form.name} onChange={e=>setF('name',e.target.value)} autoFocus
                  className="w-full rounded-xl px-3 py-2.5 text-[14px] font-semibold outline-none"
                  style={{border:'1.5px solid #a5b4fc',background:'#fff'}}/>
              </div>
              {[['phone','Phone','tel'],['email','Email','email'],['company','Company','text'],['birthday','Birthday','date'],['referrer','Referrer','text']].map(([k,l,t])=>(
                <div key={k}>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">{l}</div>
                  <input type={t} value={form[k]} onChange={e=>setF(k,e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{border:'1.5px solid #e2e8f0',background:'#fff'}}/>
                </div>
              ))}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Gender</div>
                <select value={form.gender} onChange={e=>setF('gender',e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#fff'}}>
                  <option value="">—</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4" style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
            <div className="text-[11px] font-bold text-slate-500 uppercase mb-3">Membership</div>
            <div className="grid grid-cols-2 gap-3">
              {[['card_number','Card Number'],['card_expire_date','Expire Date']].map(([k,l])=>(
                <div key={k}>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">{l}</div>
                  <input type={k==='card_expire_date'?'date':'text'} value={form[k]} onChange={e=>setF(k,e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{border:'1.5px solid #e2e8f0',background:'#fff'}}/>
                </div>
              ))}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Member Level</div>
                <select value={form.member_level} onChange={e=>setF('member_level',e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#fff'}}>
                  {memberLevels.length === 0 && <option value="Level 1 - Regular">Level 1 - Regular (default)</option>}
                  {memberLevels.map(l=>(
                    <option key={l.id} value={l.name}>{l.name}</option>
                  ))}
                </select>
              </div>

            </div>
          </div>
          <div className="rounded-xl p-4" style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
            <div className="text-[11px] font-bold text-slate-500 uppercase mb-3">Address & Notes</div>
            <div className="flex flex-col gap-3">
              <input value={form.address} onChange={e=>setF('address',e.target.value)} placeholder="Address"
                className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                style={{border:'1.5px solid #e2e8f0',background:'#fff'}}/>
              <textarea value={form.notes} onChange={e=>setF('notes',e.target.value)} rows={2}
                placeholder="Notes" className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
                style={{border:'1.5px solid #e2e8f0',background:'#fff'}}/>
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 pt-3 flex gap-3 flex-shrink-0" style={{borderTop:'1px solid #f1f5f9'}}>
          <button onClick={onClose}
            className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border"
            style={{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-[2] rounded-xl py-3 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
            {saving ? '⏳ Saving...' : '✓ Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──
function InfoCard({ title, children }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
      <div className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider"
        style={{background:'#f8fafc',borderBottom:'1px solid #f1f5f9'}}>{title}</div>
      <div className="px-4 py-3 bg-white">{children}</div>
    </div>
  )
}
function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between py-1.5" style={{borderBottom:'1px solid #f8fafc'}}>
      <span className="text-[12px] text-slate-400">{label}</span>
      <span className="text-[12px] font-semibold text-slate-700 text-right ml-4 max-w-[60%]">{value}</span>
    </div>
  )
}
function EmptyState({ msg }) {
  return (
    <div className="flex flex-col items-center py-12 text-slate-300">
      <div className="text-[40px] mb-2">📭</div>
      <div className="text-[13px]">{msg}</div>
    </div>
  )
}
