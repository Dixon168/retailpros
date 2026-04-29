// src/pages/customers/CustomersPage.jsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useLock, getTerminalName } from '@/hooks/useLock'
import { LockBadge, LockBlocker } from '@/components/ui/LockBadge'
import toast from 'react-hot-toast'

const TYPE_COLORS = {
  vip:       { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b' },
  wholesale: { bg: 'rgba(6,182,212,0.12)',   color: '#06b6d4' },
  retail:    { bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
}

export default function CustomersPage() {
  const { tenant } = useAuthStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)

  const { data: customers=[], isLoading } = useQuery({
    queryKey: ['customers', tenant?.id, search, filter],
    queryFn: async () => {
      let q = supabase.from('customers')
        .select('*').eq('tenant_id', tenant.id).eq('is_active', true)
      if(search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%,code.ilike.%${search}%,company.ilike.%${search}%`)
      if(filter==='owes') q = q.gt('credit_balance', 0)
      if(filter==='vip') q = q.eq('type','vip')
      if(filter==='wholesale') q = q.eq('type','wholesale')
      const { data } = await q.order('name').limit(100)
      return data||[]
    },
    enabled: !!tenant?.id,
  })

  const totalOwed = customers.reduce((s,c)=>s+(c.credit_balance||0),0)

  return (
    <div className="flex h-full bg-[#07090f]">
      {/* Customer list */}
      <div className="w-[300px] bg-[#0d1117] border-r border-[#1e2d42] flex flex-col">
        <div className="p-3.5 border-b border-[#1e2d42]">
          <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 mb-2.5 focus-within:border-purple-500/30 transition-colors">
            <span className="text-[#3d5068]">🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Name, phone, or code..."
              className="bg-transparent border-none outline-none py-2 text-[12px] text-[#e8edf5] flex-1 font-sans placeholder-[#3d5068]"/>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {[['all','All'],['owes','Owes'],['vip','VIP'],['wholesale','Wholesale']].map(([id,label]) => (
              <button key={id} onClick={()=>setFilter(id)}
                className={`px-2.5 py-1 rounded-md text-[10px] border transition-all ${filter===id?'border-purple-500/40 bg-purple-500/8 text-purple-400':'border-[#1e2d42] bg-[#111827] text-[#8899b0]'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="flex border-b border-[#1e2d42]">
          {[['Customers', customers.length, undefined], ['Total Owed', `$${totalOwed.toFixed(0)}`, '#ef4444']].map(([l,v,c]) => (
            <div key={l} className="flex-1 px-3 py-2.5 text-center border-r border-[#1e2d42] last:border-0">
              <div className="text-[9px] font-mono text-[#3d5068] uppercase">{l}</div>
              <div className="text-[14px] font-bold mt-0.5" style={{color:c}}>{v}</div>
            </div>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? Array(6).fill(0).map((_,i) => (
            <div key={i} className="h-[72px] bg-[#111827] rounded-[10px] mb-1.5 animate-pulse"/>
          )) : customers.map(c => {
            const tc = TYPE_COLORS[c.type]
            const init = c.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()
            return (
              <div key={c.id} onClick={()=>setSelected(c)}
                className={`px-3 py-2.5 rounded-[10px] cursor-pointer border mb-1 transition-all ${selected?.id===c.id?'bg-[#111827] border-purple-500/40':'border-transparent hover:bg-[#111827]'}`}>
                <div className="flex items-center gap-2.5 mb-1.5">
                  <div className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0"
                    style={{background:'linear-gradient(135deg,#8b5cf6,#3b82f6)'}}>{init}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate">{c.name}</div>
                    <div className="text-[10px] font-mono text-[#3d5068] mt-0.5">{c.code} · {c.phone||c.email||'—'}</div>
                  </div>
                </div>
                <div className="flex gap-1.5 pl-[46px]">
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded" style={{background:tc?.bg,color:tc?.color}}>{c.type.toUpperCase()}</span>
                  {c.credit_balance > 0 && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">Owes ${c.credit_balance.toFixed(0)}</span>}
                  {c.loyalty_points > 0 && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">{c.loyalty_points} pts</span>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="p-3 border-t border-[#1e2d42]">
          <button className="w-full bg-purple-500 border-none rounded-[9px] py-2.5 text-[12px] font-bold text-white">+ New Customer</button>
        </div>
      </div>

      {/* Detail */}
      {selected
        ? <CustomerDetail customer={selected} onClose={()=>setSelected(null)} />
        : (
          <div className="flex-1 flex items-center justify-center bg-[#07090f]">
            <div className="text-center text-[#3d5068]">
              <div className="text-5xl mb-4 opacity-20">👥</div>
              <div className="text-[14px]">Select a customer to view details</div>
            </div>
          </div>
        )
      }
    </div>
  )
}

function CustomerDetail({ customer: c, onClose }) {
  const { tenant, store, user } = useAuthStore()
  const qc = useQueryClient()
  const [tab, setTab] = useState('overview')
  const tc = TYPE_COLORS[c.type]

  const terminalName = getTerminalName(user?.name, store?.name)
  const { lockStatus, lockedByName, acquire, release, isLocked, isMine } = useLock(
    tenant?.id, 'customer', c.id, { terminalName }
  )

  const handleRecordPayment = async () => {
    if (isLocked) { toast.error(`🔒 Locked by ${lockedByName}`); return }
    if (!isMine) { const ok = await acquire(); if (!ok) return }
    toast.success('Payment recorded!')
  }

  // Orders + Invoices history
  const { data: orders=[] } = useQuery({
    queryKey: ['customer-orders', c.id],
    queryFn: async () => {
      const [ordersRes, invoicesRes] = await Promise.all([
        supabase.from('orders').select('*').eq('customer_id', c.id).eq('tenant_id', tenant.id).order('created_at', {ascending:false}).limit(15),
        supabase.from('invoices').select('*').eq('customer_id', c.id).eq('tenant_id', tenant.id).order('created_at', {ascending:false}).limit(15),
      ])
      const combined = [
        ...(ordersRes.data||[]).map(o=>({...o, _type:'order'})),
        ...(invoicesRes.data||[]).map(i=>({...i, _type:'invoice'})),
      ].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
      return combined
    },
    enabled: tab === 'orders' || tab === 'payment',
  })

  // Outstanding (unpaid)
  const outstanding = orders.filter(o =>
    (o._type==='order' && o.balance_due > 0) ||
    (o._type==='invoice' && o.balance_due > 0)
  )

  const TABS = [
    { id:'overview', label:'Overview' },
    { id:'orders', label:'Orders & Invoices' },
    { id:'payment', label:'Payment' },
    { id:'loyalty', label:'Loyalty & Cards' },
  ]

  return (
    <div className="flex-1 flex flex-col bg-[#07090f] overflow-hidden">
      {/* Customer header */}
      <div className="bg-[#0d1117] border-b border-[#1e2d42] px-6 py-4 flex gap-4 items-start flex-shrink-0">
        <div className="w-[54px] h-[54px] rounded-[14px] flex items-center justify-center text-[20px] font-bold text-white flex-shrink-0"
          style={{background:'linear-gradient(135deg,#8b5cf6,#3b82f6)'}}>
          {c.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="text-[20px] font-bold">{c.name}</div>
          <div className="text-[12px] text-[#8899b0] mt-1">{c.company||''} · Joined {new Date(c.created_at).toLocaleDateString()}</div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded" style={{background:tc?.bg,color:tc?.color}}>{c.type.toUpperCase()}</span>
            {c.credit_enabled && <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-green-500/10 text-green-400">Credit Enabled</span>}
            {c.loyalty_points > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-400">{c.loyalty_points} pts</span>}
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">{c.billing_cycle?.toUpperCase()||'NET30'}</span>
          </div>
        </div>
        <div className="flex gap-2 items-start">
          <button onClick={()=>toast.success('Email sent')} className="bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5 text-[11px] text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400 transition-all">📧 Remind</button>
          <LockBadge lockStatus={lockStatus} lockedByName={lockedByName} />
          <button onClick={()=>setTab('payment')} className="bg-green-500 border-none rounded-lg px-3 py-1.5 text-[11px] font-bold text-white">💰 Pay Balance</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 border-b border-[#1e2d42] bg-[#0d1117] flex-shrink-0">
        {[
          ['Total Spent', `$${(c.total_spent||0).toFixed(0)}`, '#3b82f6'],
          ['Orders', c.order_count||0, undefined],
          ['Outstanding', `$${(c.credit_balance||0).toFixed(2)}`, c.credit_balance>0?'#ef4444':'#10b981'],
          ['Points', c.loyalty_points||0, '#8b5cf6'],
          ['Avg Order', c.order_count>0?`$${((c.total_spent||0)/c.order_count).toFixed(0)}`:'—', '#06b6d4'],
        ].map(([label,value,color]) => (
          <div key={label} className="px-4 py-3 border-r border-[#1e2d42] last:border-0">
            <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-wider mb-1">{label}</div>
            <div className="text-[17px] font-bold" style={{color}}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex bg-[#0d1117] border-b border-[#1e2d42] px-6 flex-shrink-0">
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`py-3 px-4 text-[12px] border-b-2 transition-all ${tab===t.id?'text-purple-400 border-purple-400':'text-[#8899b0] border-transparent hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">

        {tab === 'overview' && (
          <div className="grid grid-cols-2 gap-4">
            <InfoCard title="Contact">
              {[['Name', c.name],['Company', c.company||'—'],['Email', c.email||'—'],['Phone', c.phone||'—'],['Code', c.code||'—']].map(([l,v]) => (
                <InfoRow key={l} label={l} value={v}/>
              ))}
            </InfoCard>
            <InfoCard title="Credit & Terms">
              {[['Credit Enabled', c.credit_enabled?'Yes':'No'],['Credit Limit', c.credit_limit>0?`$${c.credit_limit.toFixed(2)}`:'Unlimited'],['Current Balance', `$${(c.credit_balance||0).toFixed(2)}`],['Account Terms', c.billing_cycle?.toUpperCase()||'NET30'],['Reminder', `${c.reminder_days_before||7} days before`]].map(([l,v]) => (
                <InfoRow key={l} label={l} value={v}/>
              ))}
            </InfoCard>
            <InfoCard title="Billing Address" className="col-span-1">
              <div className="text-[12px] text-[#8899b0] leading-6">
                {c.billing_address||'—'}<br/>
                {c.billing_city && `${c.billing_city}, ${c.billing_state} ${c.billing_zip}`}
              </div>
            </InfoCard>
            <InfoCard title="Shipping Address">
              <div className="text-[12px] text-[#8899b0] leading-6">
                {c.shipping_address||'—'}<br/>
                {c.shipping_city && `${c.shipping_city}, ${c.shipping_state} ${c.shipping_zip}`}
              </div>
            </InfoCard>
          </div>
        )}

        {tab === 'orders' && (
          <div className="flex flex-col gap-2">
            {orders.length === 0
              ? <div className="text-center py-12 text-[#3d5068]">No history yet</div>
              : orders.map(item => (
                <HistoryItem key={item.id} item={item} />
              ))
            }
          </div>
        )}

        {tab === 'payment' && (
          <div className="max-w-[560px]">
            <div className="bg-[#0d1117] border border-[#1e2d42] rounded-[12px] p-4 mb-4">
              <div className="flex justify-between items-center mb-3">
                <div className="text-[13px] font-bold">Select Orders to Pay</div>
                <div className="text-[11px] text-red-400 font-mono">
                  Outstanding: ${outstanding.reduce((s,o)=>s+(o.balance_due||0),0).toFixed(2)}
                </div>
              </div>
              {outstanding.length === 0 ? (
                <div className="text-center py-6 text-[#3d5068] text-sm">✓ All paid up!</div>
              ) : outstanding.map(item => (
                <div key={item.id} className="flex items-center gap-3 bg-[#111827] border border-[#1e2d42] rounded-[8px] px-3 py-2.5 mb-2">
                  <input type="checkbox" defaultChecked className="accent-green-500"/>
                  <div className="flex-1">
                    <div className="font-mono text-[11px]" style={{color:item._type==='invoice'?'#06b6d4':'#3b82f6'}}>
                      {item._type==='invoice'?item.invoice_number:item.order_number}
                    </div>
                    <div className="text-[10px] text-[#3d5068] mt-0.5">
                      {item._type==='invoice'?'Invoice':'Order'} · {new Date(item.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{background:item._type==='invoice'?'rgba(6,182,212,0.1)':'rgba(59,130,246,0.1)',color:item._type==='invoice'?'#06b6d4':'#3b82f6'}}>
                    {item._type.toUpperCase()}
                  </span>
                  <div className="font-mono text-[12px] font-bold text-red-400">
                    ${(item.balance_due||0).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>

            {outstanding.length > 0 && (
              <>
                <div className="flex justify-between items-center bg-[#111827] border border-[#1e2d42] rounded-[9px] px-4 py-3 mb-3">
                  <span className="text-[12px] text-[#8899b0]">Selected Total</span>
                  <span className="text-[18px] font-bold font-mono text-green-400">
                    ${outstanding.reduce((s,o)=>s+(o.balance_due||0),0).toFixed(2)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[['💵','Cash'],['📝','Check'],['🏦','Transfer']].map(([icon,label]) => (
                    <div key={label} className="bg-[#111827] border border-[#1e2d42] rounded-[8px] py-2.5 text-center cursor-pointer hover:border-blue-500/30 transition-all">
                      <div className="text-[16px] mb-1">{icon}</div>
                      <div className="text-[10px] text-[#8899b0]">{label}</div>
                    </div>
                  ))}
                </div>
                <button onClick={handleRecordPayment}
                  disabled={isLocked}
                  className="w-full bg-gradient-to-r from-green-500 to-green-600 border-none rounded-[9px] py-3 text-[13px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed">
                  ✓ Record Payment
                </button>
              </>
            )}
          </div>
        )}

        {tab === 'loyalty' && (
          <div className="max-w-[500px]">
            <div className="bg-gradient-to-br from-[#1a1f35] to-[#2d1b69] border border-purple-500/20 rounded-[12px] p-5 text-center mb-4">
              <div className="text-[9px] font-mono text-purple-300/60 uppercase tracking-widest mb-2">Loyalty Points</div>
              <div className="text-[48px] font-bold font-mono bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                {c.loyalty_points||0}
              </div>
              <div className="text-[12px] text-[#8899b0] mt-1">points</div>
              <div className="text-[12px] text-green-400 mt-1">${((c.loyalty_points||0)/100).toFixed(2)} redeemable value</div>
            </div>
            <InfoCard title="Member Cards">
              <div className="text-[12px] text-[#3d5068] py-2">
                Card details load from member_cards table
              </div>
            </InfoCard>
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryItem({ item }) {
  const isInvoice = item._type === 'invoice'
  const status = item.status
  const statusColor = {
    completed: '#3b82f6', paid: '#10b981', partial: '#f59e0b',
    overdue: '#ef4444', sent: '#06b6d4', draft: '#8899b0',
  }[status] || '#8899b0'

  return (
    <div className="flex items-center gap-3 bg-[#0d1117] border border-[#1e2d42] rounded-[10px] px-4 py-3 hover:border-[#243347] transition-colors cursor-pointer">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[16px] flex-shrink-0"
        style={{background: isInvoice ? 'rgba(6,182,212,0.12)' : 'rgba(59,130,246,0.12)'}}>
        {isInvoice ? '📄' : '🛒'}
      </div>
      <div className="flex-1">
        <div className="font-mono text-[12px] font-bold" style={{color: isInvoice ? '#06b6d4' : '#3b82f6'}}>
          {isInvoice ? item.invoice_number : item.order_number}
        </div>
        <div className="text-[10px] text-[#3d5068] mt-0.5">
          {new Date(item.created_at).toLocaleDateString()} · {isInvoice ? 'Invoice' : 'POS Order'}
        </div>
      </div>
      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded"
        style={{background:`${statusColor}18`, color: statusColor}}>
        {status?.toUpperCase()}
      </span>
      <div className="text-right">
        <div className="font-mono text-[13px] font-bold">${item.total?.toFixed(2)}</div>
        {item.balance_due > 0 && (
          <div className="text-[10px] font-mono text-red-400">Due ${item.balance_due?.toFixed(2)}</div>
        )}
      </div>
    </div>
  )
}

function InfoCard({ title, children, className='' }) {
  return (
    <div className={`bg-[#0d1117] border border-[#1e2d42] rounded-[12px] p-4 ${className}`}>
      <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  )
}
function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-start mb-2 last:mb-0">
      <span className="text-[11px] text-[#3d5068]">{label}</span>
      <span className="text-[12px] font-semibold text-right max-w-[60%]">{value}</span>
    </div>
  )
}
