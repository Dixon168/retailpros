// src/pages/backoffice/DashboardPage.jsx
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

const MENU = [
  { to:'/orders',        icon:'🔍', label:'Orders',         desc:'View & search orders',         color:'#5E6AD2' },
  { to:'/products',      icon:'📦', label:'Products',       desc:'Manage inventory & pricing',   color:'#16a34a' },
  { to:'/categories',    icon:'📁', label:'Categories',     desc:'Organize product categories',  color:'#0891b2' },
  { to:'/customers',     icon:'👥', label:'Customers',      desc:'Member & customer management', color:'#5E6AD2' },
  { to:'/b2b-center',    icon:'💼', label:'B2B Center',     desc:'Estimates, invoices, payments, A/R', color:'#d97706' },
  { to:'/marketing',     icon:'🎯', label:'Promotions',     desc:'Promotions & campaigns',       color:'#ec4899' },
  { to:'/loyalty',       icon:'⭐', label:'Loyalty',        desc:'Points & membership tiers',    color:'#f59e0b' },
  { to:'/cardcenter',    icon:'💳', label:'Card Center',    desc:'Payment & card transactions',  color:'#0284c7' },
  { to:'/reports',       icon:'📊', label:'Reports',        desc:'Sales & inventory reports',    color:'#5E6AD2' },
  { to:'/smart-receive', icon:'🤖', label:'Smart Receive',  desc:'AI-powered inventory intake',  color:'#16a34a' },
  { to:'/settings',      icon:'⚙️', label:'Settings',       desc:'Store & system settings',      color:'#666666' },
]

const QUICK_QUESTIONS = [
  "Best selling product?",
  "Low stock alerts?",
  "Today vs yesterday revenue?",
  "Highest margin products?",
  "Total inventory value?",
  "Any reorder suggestions?",
]

async function askAI(question, context) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are a retail business analyst assistant for a store called "${context.storeName}".

Current business data:
- Today's orders: ${context.todayOrders}
- Today's revenue: $${context.todayRevenue?.toFixed(2)}
- Total active products: ${context.totalProducts}
- Total customers: ${context.totalCustomers}
- Top products this month: ${JSON.stringify(context.topProducts)}
- Low stock products: ${JSON.stringify(context.lowStock)}
- Recent 7-day revenue: ${JSON.stringify(context.weekRevenue)}

Answer this question concisely and helpfully (2-4 sentences max, use numbers from the data):
"${question}"

Be direct, specific, and actionable. Use $ for currency. If data is limited, say so briefly.`
      }]
    })
  })
  const d = await res.json()
  return d.content?.[0]?.text || 'Unable to analyze at this time.'
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user, store, tenant } = useAuthStore()

  // AI Chat state
  const [messages, setMessages]   = useState([
    { role:'ai', text:`Hi ${user?.name?.split(' ')[0]||'there'}! 👋 I'm your AI sales analyst. Ask me anything about your store performance, inventory, or sales trends.` }
  ])
  const [input, setInput]         = useState('')
  const [thinking, setThinking]   = useState(false)
  const chatEndRef                = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [messages])

  const { data: stats = {} } = useQuery({
    queryKey: ['dashboard-stats', tenant?.id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0]
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

      const [orders, products, customers, topProds, lowStock, weekOrders, yesterdayOrders, b2bToday, overdue] = await Promise.all([
        supabase.from('orders').select('id,total', {count:'exact'}).eq('tenant_id',tenant.id).gte('created_at',today),
        supabase.from('products').select('id',{count:'exact'}).eq('tenant_id',tenant.id).eq('is_active',true),
        supabase.from('customers').select('id',{count:'exact'}).eq('tenant_id',tenant.id),
        // Top products this month
        supabase.from('order_items').select('product_id, quantity, products(name)')
          .eq('tenant_id',tenant.id).gte('created_at',monthStart).limit(200),
        // Low stock
        supabase.from('products').select('name, low_stock_qty, inventory(quantity)')
          .eq('tenant_id',tenant.id).eq('is_active',true).eq('track_inventory',true).limit(500),
        // Last 7 days revenue
        supabase.from('orders').select('total, created_at')
          .eq('tenant_id',tenant.id)
          .gte('created_at', new Date(Date.now()-7*86400000).toISOString()),
        supabase.from('orders').select('total').eq('tenant_id',tenant.id).gte('created_at',yesterday).lt('created_at',today),
        // B2B invoiced today
        supabase.from('invoices').select('total, status').eq('tenant_id',tenant.id).gte('created_at',today),
        // Overdue A/R
        supabase.from('invoices').select('balance_due, due_date, status').eq('tenant_id',tenant.id),
      ])

      // Aggregate top products
      const prodMap = {}
      topProds.data?.forEach(r => {
        const name = r.products?.name || r.product_id
        prodMap[name] = (prodMap[name]||0) + (r.quantity||0)
      })
      const topProducts = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,qty])=>({name,qty}))

      // Low stock list
      const lowStockList = (lowStock.data||[])
        .map(p=>({name:p.name, qty: p.inventory?.reduce((a,i)=>a+(i.quantity||0),0)||0, threshold: p.low_stock_qty ?? 5}))
        .filter(p=>p.qty<=p.threshold).slice(0,5)
      const lowStockCount = (lowStock.data||[])
        .filter(p => (p.inventory?.reduce((a,i)=>a+(i.quantity||0),0)||0) <= (p.low_stock_qty ?? 5)).length

      // 7-day revenue by day
      const dayMap = {}
      weekOrders.data?.forEach(o => {
        const day = o.created_at?.split('T')[0]
        if (day) dayMap[day] = (dayMap[day]||0) + (o.total||0)
      })
      const weekRevenue = Object.entries(dayMap).sort((a,b)=>a[0].localeCompare(b[0])).map(([day,rev])=>({day,rev}))

      // B2B invoiced today (exclude draft/void)
      const b2bToday_ = (b2bToday.data||[])
        .filter(i => !['draft','void'].includes(i.status))
        .reduce((s,i)=>s+(i.total||0),0)

      // Overdue A/R
      const todayMid = new Date(); todayMid.setHours(0,0,0,0)
      let overdueAmt = 0, overdueCount = 0
      ;(overdue.data||[]).forEach(i => {
        const bal = i.balance_due || 0
        if (bal <= 0 || ['paid','void','draft'].includes(i.status)) return
        const due = i.due_date ? new Date(i.due_date) : null
        if (due) { due.setHours(0,0,0,0); if (due < todayMid) { overdueAmt += bal; overdueCount++ } }
      })

      const retailRevenue = orders.data?.reduce((s,o)=>s+(o.total||0),0) || 0

      return {
        todayOrders:     orders.count    || 0,
        todayRevenue:    retailRevenue,
        retailRevenue,
        b2bRevenue:      b2bToday_,
        totalToday:      retailRevenue + b2bToday_,
        yesterdayRevenue: yesterdayOrders.data?.reduce((s,o)=>s+(o.total||0),0) || 0,
        totalProducts:   products.count  || 0,
        totalCustomers:  customers.count || 0,
        topProducts,
        lowStock:        lowStockList,
        lowStockCount,
        overdueAmt,
        overdueCount,
        weekRevenue,
      }
    },
    enabled: !!tenant?.id,
  })

  const handleAsk = async (q) => {
    const question = q || input.trim()
    if (!question || thinking) return
    setInput('')
    setMessages(m => [...m, { role:'user', text: question }])
    setThinking(true)

    try {
      const answer = await askAI(question, {
        storeName:       store?.name || 'My Store',
        todayOrders:     stats.todayOrders,
        todayRevenue:    stats.todayRevenue,
        yesterdayRevenue:stats.yesterdayRevenue,
        totalProducts:   stats.totalProducts,
        totalCustomers:  stats.totalCustomers,
        topProducts:     stats.topProducts,
        lowStock:        stats.lowStock,
        weekRevenue:     stats.weekRevenue,
      })
      setMessages(m => [...m, { role:'ai', text: answer }])
    } catch(e) {
      setMessages(m => [...m, { role:'ai', text:'Sorry, I had trouble analyzing that. Please try again.' }])
    } finally {
      setThinking(false)
    }
  }

  // 7-day chart
  const weekData = stats.weekRevenue || []
  const maxRev = Math.max(...weekData.map(d=>d.rev), 1)

  const revenueChange = stats.yesterdayRevenue > 0
    ? ((stats.todayRevenue - stats.yesterdayRevenue) / stats.yesterdayRevenue * 100).toFixed(1)
    : null

  return (
    <div className="h-full overflow-auto" style={{background:'#FFFFFF'}}>
      <div className="p-6" style={{maxWidth:'1400px', margin:'0 auto'}}>

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[22px] font-bold text-slate-800">🏠 Store Overview</div>
            <div className="text-[13px] text-slate-400 mt-0.5">
              All channels combined · {store?.name} · {new Date().toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})}
            </div>
          </div>
        </div>

        {/* Channel drill-down banner */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button onClick={() => navigate('/pos-dashboard')}
            className="rounded-2xl p-4 cursor-pointer border-2 text-left transition-all hover:shadow-md"
            style={{background:'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', borderColor:'#dee2f8'}}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider font-bold" style={{color:'#1e40af'}}>Retail POS</div>
                <div className="text-[18px] font-bold mt-0.5" style={{color:'#1e3a8a'}}>🛒 Walk-in Sales</div>
                <div className="text-[11px] text-slate-600 mt-1">Today's orders, tips, refunds, top products</div>
              </div>
              <div className="text-[28px]">→</div>
            </div>
          </button>
          <button onClick={() => navigate('/b2b-center')}
            className="rounded-2xl p-4 cursor-pointer border-2 text-left transition-all hover:shadow-md"
            style={{background:'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)', borderColor:'#fdba74'}}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider font-bold" style={{color:'#9a3412'}}>B2B Invoicing</div>
                <div className="text-[18px] font-bold mt-0.5" style={{color:'#7c2d12'}}>💼 Business Accounts</div>
                <div className="text-[11px] text-slate-600 mt-1">A/R aging, top customers, estimates, payments</div>
              </div>
              <div className="text-[28px]">→</div>
            </div>
          </button>
        </div>

        {/* All-channel total + retail/B2B split */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          {[
            ["Today · All Channels", `$${(stats.totalToday||0).toFixed(2)}`, '#1F1F1F', '🏪', null],
            ['🛒 Retail Today',      `$${(stats.retailRevenue||0).toFixed(2)}`, '#5E6AD2', '', revenueChange],
            ['💼 B2B Today',         `$${(stats.b2bRevenue||0).toFixed(2)}`, '#d97706', '', null],
            ["Today's Orders",       stats.todayOrders, '#16a34a', '🧾', null],
          ].map(([label, value, color, icon, change]) => (
            <div key={label} className="rounded-2xl p-4 shadow-sm" style={{background:'#fff', border:'1.5px solid #e2e8f0'}}>
              <div className="flex justify-between items-start mb-2">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
                {icon && <span className="text-[20px]">{icon}</span>}
              </div>
              <div className="text-[26px] font-bold" style={{color}}>{value}</div>
              {change !== null && change !== undefined && (
                <div className={`text-[11px] font-semibold mt-1 ${parseFloat(change)>=0?'text-green-600':'text-red-500'}`}>
                  {parseFloat(change)>=0?'↑':'↓'} {Math.abs(change)}% vs yesterday
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Attention strip — overdue A/R + low stock */}
        {(stats.overdueCount > 0 || stats.lowStockCount > 0) && (
          <div className="flex items-center gap-3 rounded-xl px-4 py-2.5 mb-5 flex-wrap"
            style={{background:'#FEF3C7', border:'1px solid #FCD34D'}}>
            <span className="text-[14px]">⚠️</span>
            <span className="text-[12px] font-bold text-[#B45309]">Needs attention:</span>
            {stats.overdueCount > 0 && (
              <button onClick={() => navigate('/b2b-center')}
                className="text-[12px] text-[#92400E] cursor-pointer bg-transparent border-none">
                💼 <span className="font-bold">${(stats.overdueAmt||0).toFixed(0)}</span> overdue ({stats.overdueCount}) →
              </button>
            )}
            {stats.lowStockCount > 0 && (
              <button onClick={() => navigate('/purchase-orders')}
                className="text-[12px] text-[#92400E] cursor-pointer bg-transparent border-none">
                📦 <span className="font-bold">{stats.lowStockCount}</span> low stock →
              </button>
            )}
          </div>
        )}

        {/* Main layout: Menu + AI Assistant */}
        <div className="grid gap-6" style={{gridTemplateColumns:'1fr 380px'}}>

          {/* Left: Menu grid + 7-day chart */}
          <div className="flex flex-col gap-6">
            {/* 7-day revenue chart */}
            {weekData.length > 0 && (
              <div className="rounded-2xl p-5 shadow-sm" style={{background:'#fff', border:'1.5px solid #e2e8f0'}}>
                <div className="text-[13px] font-bold text-slate-700 mb-4">Revenue — Last 7 Days</div>
                <div className="flex items-end gap-2" style={{height:'80px'}}>
                  {weekData.map((d,i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[9px] font-mono text-slate-400">{d.rev>0?`$${Math.round(d.rev)}`:''}</div>
                      <div className="w-full rounded-t transition-all"
                        style={{
                          height:`${Math.max(4,(d.rev/maxRev)*56)}px`,
                          background: i===weekData.length-1
                            ? '#5E6AD2'
                            : '#93c5fd',
                        }}/>
                      <div className="text-[9px] text-slate-400">
                        {new Date(d.day).toLocaleDateString([],{weekday:'short'})}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Menu grid */}
            <div className="grid grid-cols-3 gap-3">
              {MENU.map(item => (
                <button key={item.to} onClick={() => navigate(item.to)}
                  className="rounded-2xl p-4 text-left cursor-pointer border-none transition-all"
                  style={{background:'#fff', border:'1.5px solid #e2e8f0'}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=item.color;e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow=`0 6px 20px ${item.color}20`}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='none'}}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[18px] mb-2.5"
                    style={{background:`${item.color}12`}}>
                    {item.icon}
                  </div>
                  <div className="text-[13px] font-bold text-slate-800 mb-0.5">{item.label}</div>
                  <div className="text-[10px] text-slate-400">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: AI Sales Assistant */}
          <div className="rounded-2xl overflow-hidden shadow-sm flex flex-col"
            style={{background:'#FAFAFA', border:'1.5px solid #E5E5E5', height:'fit-content', maxHeight:'680px'}}>

            {/* Header */}
            <div className="px-4 py-3.5 flex items-center gap-3 border-b" style={{borderColor:'#E5E5E5'}}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[16px]"
                style={{background:'#000000'}}>
                🤖
              </div>
              <div>
                <div className="text-[13px] font-bold text-white">AI Sales Assistant</div>
                <div className="text-[10px] text-slate-400">Powered by Claude AI</div>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400"/>
                <span className="text-[10px] text-[#00B23B]">Online</span>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" style={{minHeight:'200px', maxHeight:'380px'}}>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role==='user'?'justify-end':'justify-start'}`}>
                  <div className="rounded-2xl px-3.5 py-2.5 max-w-[85%]"
                    style={msg.role==='user'
                      ? {background:'#000000', color:'#fff'}
                      : {background:'#E5E5E5', color:'#e2e8f0'}}>
                    {msg.role==='ai' && (
                      <div className="text-[10px] text-indigo-400 font-semibold mb-1">🤖 AI Analyst</div>
                    )}
                    <div className="text-[12px] leading-relaxed">{msg.text}</div>
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-3" style={{background:'#E5E5E5'}}>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        {[0,1,2].map(i=>(
                          <div key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-400"
                            style={{animation:`bounce 0.6s ${i*0.15}s infinite`}}/>
                        ))}
                      </div>
                      <span className="text-[11px] text-slate-400">Analyzing your data...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {/* Quick questions */}
            <div className="px-4 pb-2 grid gap-1.5 border-t pt-3" style={{borderColor:'#E5E5E5', gridTemplateColumns:'1fr 1fr'}}>
              {QUICK_QUESTIONS.map((q,i) => (
                <button key={i} onClick={() => handleAsk(q)}
                  disabled={thinking}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg cursor-pointer border-none transition-all disabled:opacity-40 text-left"
                  style={{background:'rgba(99,102,241,0.12)', color:'#dee2f8', border:'1px solid rgba(99,102,241,0.2)'}}>
                  {q}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="p-3 border-t" style={{borderColor:'#E5E5E5'}}>
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key==='Enter' && handleAsk()}
                  placeholder="Ask about sales, inventory, trends..."
                  disabled={thinking}
                  className="flex-1 rounded-xl px-3 py-2.5 text-[12px] outline-none border-none"
                  style={{background:'#E5E5E5', color:'#e2e8f0'}}
                />
                <button onClick={() => handleAsk()} disabled={!input.trim() || thinking}
                  className="rounded-xl w-10 h-10 flex items-center justify-center cursor-pointer border-none disabled:opacity-40 flex-shrink-0"
                  style={{background:'#000000'}}>
                  <span className="text-white text-[14px]">→</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  )
}
