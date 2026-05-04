// src/components/layout/AppLayout.jsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { OpenShiftModal, CloseShiftModal } from '@/components/pos/ShiftModal'

const NAV_GROUPS = [
  {
    group: 'Overview',
    items: [
      { to:'/backoffice', icon:'🏠', label:'Dashboard' },
      { to:'/orders',     icon:'🔍', label:'Orders' },
      { to:'/reports',    icon:'📊', label:'Reports' },
    ]
  },
  {
    group: 'Inventory',
    items: [
      { to:'/products',   icon:'📦', label:'Products' },
      { to:'/categories', icon:'📁', label:'Categories' },
      { to:'/vendors',    icon:'🚚', label:'Vendors' },
    ]
  },
  {
    group: 'Customers',
    items: [
      { to:'/customers',  icon:'👥', label:'Members' },
      { to:'/business',   icon:'🏢', label:'B2B' },
      { to:'/loyalty',    icon:'⭐', label:'Loyalty' },
    ]
  },
  {
    group: 'Sales',
    items: [
      { to:'/invoices',   icon:'📄', label:'Invoices' },
      { to:'/cardcenter', icon:'💳', label:'Card Center' },
    ]
  },
  {
    group: 'Marketing',
    items: [
      { to:'/marketing',  icon:'🎯', label:'Promotions' },
    ]
  },
  {
    group: 'System',
    items: [
      { to:'/settings',   icon:'⚙️', label:'Settings' },
    ]
  },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const { user, store, signOut } = useAuthStore()
  const [showShiftOpen,  setShowShiftOpen]  = useState(false)
  const [showShiftClose, setShowShiftClose] = useState(false)
  const [collapsed,      setCollapsed]      = useState(false)

  return (
    <div className="flex h-screen" style={{background:'#f0f2f5'}}>

      {/* ── Left Sidebar ── */}
      <div className="flex flex-col flex-shrink-0 transition-all"
        style={{
          width: collapsed ? '56px' : '200px',
          background:'#1e293b',
          borderRight:'1px solid #334155',
        }}>

        {/* Logo */}
        <div className="flex items-center gap-2 px-3 py-3.5 border-b" style={{borderColor:'#334155', minHeight:'52px'}}>
          {!collapsed && (
            <>
              <div className="text-[15px] font-black text-white">RetailPOS</div>
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded ml-1 flex-shrink-0"
                style={{background:'rgba(99,102,241,0.35)', color:'#a5b4fc'}}>
                BACK OFFICE
              </span>
            </>
          )}
          <button onClick={() => setCollapsed(!collapsed)}
            className="ml-auto text-slate-500 hover:text-white bg-transparent border-none cursor-pointer text-[14px] flex-shrink-0 transition-colors">
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_GROUPS.map(group => (
            <div key={group.group} className="mb-1">
              {!collapsed && (
                <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
                  style={{color:'#475569'}}>
                  {group.group}
                </div>
              )}
              {group.items.map(item => (
                <NavLink key={item.to} to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 cursor-pointer no-underline transition-all mx-1.5 rounded-lg mb-0.5 ${
                      collapsed ? 'justify-center px-1.5 py-2.5' : 'px-2.5 py-2'
                    } ${isActive ? 'text-white' : 'text-slate-400 hover:text-white hover:bg-white/8'}`
                  }
                  style={({ isActive }) => isActive ? {background:'rgba(99,102,241,0.25)'} : {}}
                  title={collapsed ? item.label : ''}>
                  <span className="text-[16px] flex-shrink-0">{item.icon}</span>
                  {!collapsed && <span className="text-[12px] font-medium">{item.label}</span>}
                </NavLink>
              ))}
              {!collapsed && <div className="mx-3 my-1" style={{borderTop:'1px solid #273548'}}/>}
            </div>
          ))}
        </nav>

        {/* Bottom: POS button + User */}
        <div className="border-t p-2" style={{borderColor:'#334155'}}>
          {/* Back to POS */}
          <button onClick={() => window.location.href='/pos'}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer border-none mb-1.5 transition-all"
            style={{background:'rgba(99,102,241,0.15)', color:'#818cf8'}}
            title={collapsed ? 'POS' : ''}>
            <span className="text-[15px] flex-shrink-0">🖥️</span>
            {!collapsed && <span className="text-[12px] font-semibold">← POS</span>}
          </button>

          {/* User info */}
          <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${collapsed?'justify-center':''}`}
            style={{background:'rgba(255,255,255,0.06)'}}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
              style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
              {user?.name?.charAt(0)||'U'}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-white truncate">{user?.name}</div>
                <div className="text-[9px] text-slate-400 truncate">{store?.name}</div>
              </div>
            )}
            {!collapsed && (
              <button onClick={() => signOut()}
                className="text-slate-500 hover:text-red-400 bg-transparent border-none cursor-pointer text-[11px] flex-shrink-0 transition-colors"
                title="Sign out">
                ⏻
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {showShiftOpen  && <OpenShiftModal  onClose={() => setShowShiftOpen(false)} />}
      {showShiftClose && <CloseShiftModal onClose={() => setShowShiftClose(false)} />}
    </div>
  )
}
