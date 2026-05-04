// src/pages/backoffice/DashboardPage.jsx
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

const MENU = [
  { to:'/orders',     icon:'🔍', label:'Orders',      desc:'View & search orders',         color:'#6366f1' },
  { to:'/products',   icon:'📦', label:'Products',    desc:'Manage inventory & pricing',   color:'#16a34a' },
  { to:'/categories', icon:'📁', label:'Categories',  desc:'Organize product categories',  color:'#0891b2' },
  { to:'/customers',  icon:'👥', label:'Customers',   desc:'Member & customer management', color:'#8b5cf6' },
  { to:'/invoices',   icon:'📄', label:'Invoices',    desc:'View all invoices',            color:'#d97706' },
  { to:'/business',   icon:'🏢', label:'B2B',         desc:'Business customers & credit',  color:'#dc2626' },
  { to:'/marketing',  icon:'🎯', label:'Marketing',   desc:'Promotions & campaigns',       color:'#ec4899' },
  { to:'/loyalty',    icon:'🏷️', label:'Loyalty',     desc:'Points & membership tiers',    color:'#f59e0b' },
  { to:'/cardcenter', icon:'💳', label:'Card Center', desc:'Payment & card transactions',  color:'#0284c7' },
  { to:'/reports',    icon:'📊', label:'Reports',     desc:'Sales & inventory reports',    color:'#7c3aed' },
  { to:'/settings',   icon:'⚙️', label:'Settings',    desc:'Store & system settings',      color:'#475569' },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user, store, tenant } = useAuthStore()

  const { data: stats = {} } = useQuery({
    queryKey: ['dashboard-stats', tenant?.id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const [orders, products, customers] = await Promise.all([
        supabase.from('orders').select('id, grand_total', { count: 'exact' }).eq('tenant_id', tenant.id).gte('created_at', today),
        supabase.from('products').select('id', { count: 'exact' }).eq('tenant_id', tenant.id).eq('is_active', true),
        supabase.from('customers').select('id', { count: 'exact' }).eq('tenant_id', tenant.id),
      ])
      return {
        todayOrders:    orders.count    || 0,
        todayRevenue:   orders.data?.reduce((s,o) => s+(o.grand_total||0), 0) || 0,
        totalProducts:  products.count  || 0,
        totalCustomers: customers.count || 0,
      }
    },
    enabled: !!tenant?.id,
  })

  return (
    <div className="h-full overflow-auto p-6" style={{background:'#f0f2f5'}}>
      <div className="mb-6">
        <div className="text-[22px] font-bold text-slate-800">Back Office</div>
        <div className="text-[13px] text-slate-400 mt-0.5">{store?.name} · Welcome, {user?.name}</div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          ["Today's Orders",   stats.todayOrders,                          '#6366f1', '🛒'],
          ["Today's Revenue",  `$${(stats.todayRevenue||0).toFixed(2)}`,  '#16a34a', '💰'],
          ['Total Products',   stats.totalProducts,                        '#0891b2', '📦'],
          ['Customers',        stats.totalCustomers,                       '#8b5cf6', '👥'],
        ].map(([label, value, color, icon]) => (
          <div key={label} className="rounded-2xl p-4"
            style={{background:'#fff', border:'1.5px solid #e2e8f0'}}>
            <div className="flex justify-between items-start mb-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
              <span className="text-[18px]">{icon}</span>
            </div>
            <div className="text-[26px] font-bold" style={{color}}>{value}</div>
          </div>
        ))}
      </div>

      {/* Menu */}
      <div className="grid grid-cols-4 gap-3">
        {MENU.map(item => (
          <button key={item.to} onClick={() => navigate(item.to)}
            className="rounded-2xl p-4 text-left cursor-pointer border-none transition-all"
            style={{background:'#fff', border:'1.5px solid #e2e8f0'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=item.color;e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow=`0 6px 20px ${item.color}20`}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='none'}}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[20px] mb-3"
              style={{background:`${item.color}12`}}>
              {item.icon}
            </div>
            <div className="text-[14px] font-bold text-slate-800 mb-0.5">{item.label}</div>
            <div className="text-[11px] text-slate-400">{item.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
