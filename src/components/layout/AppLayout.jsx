// src/components/layout/AppLayout.jsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { OpenShiftModal, CloseShiftModal } from '@/components/pos/ShiftModal'

const NAV = [
  { to:'/orders',     icon:'🔍', label:'Orders' },
  { to:'/products',   icon:'📦', label:'Products' },
  { to:'/categories', icon:'📁', label:'Categories' },
  { to:'/customers',  icon:'👥', label:'Customers' },
  { to:'/invoices',   icon:'📄', label:'Invoices' },
  { to:'/business',   icon:'🏢', label:'B2B' },
  { to:'/marketing',  icon:'🎯', label:'Marketing' },
  { to:'/loyalty',    icon:'🏷️', label:'Loyalty' },
  { to:'/cardcenter', icon:'💳', label:'Card Center' },
  { to:'/reports',    icon:'📊', label:'Reports' },
  { to:'/settings',   icon:'⚙️', label:'Settings' },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const { user, tenant, store, signOut } = useAuthStore()
  const [showShiftOpen,  setShowShiftOpen]  = useState(false)
  const [showShiftClose, setShowShiftClose] = useState(false)
  const [showUserMenu,   setShowUserMenu]   = useState(false)

  return (
    <div className="flex flex-col h-screen" style={{background:'#f0f2f5'}}>

      {/* ── Top nav bar ── */}
      <header className="flex items-center px-4 gap-1 flex-shrink-0"
        style={{height:'52px', background:'#1e293b', borderBottom:'1px solid #334155'}}>

        {/* Logo */}
        <div className="text-[15px] font-black text-white mr-3 flex-shrink-0">
          RetailPOS
          <span className="ml-1.5 text-[9px] font-medium px-1.5 py-0.5 rounded"
            style={{background:'rgba(99,102,241,0.3)', color:'#a5b4fc'}}>
            BACK OFFICE
          </span>
        </div>

        {/* Nav items */}
        <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium
                 whitespace-nowrap transition-all cursor-pointer no-underline flex-shrink-0 ${
                   isActive
                     ? 'text-white'
                     : 'text-slate-400 hover:text-white hover:bg-white/10'
                 }`
              }
              style={({ isActive }) => isActive ? {background:'rgba(99,102,241,0.25)', color:'#fff'} : {}}>
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">

          {/* Back to POS */}
          <button onClick={() => navigate('/pos')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border transition-all flex-shrink-0"
            style={{background:'rgba(99,102,241,0.15)', borderColor:'rgba(99,102,241,0.4)', color:'#818cf8'}}>
            ← POS
          </button>

          {/* User */}
          <div className="relative">
            <button onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer border transition-all"
              style={{background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.12)'}}>
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                {user?.name?.charAt(0)||'U'}
              </div>
              <span className="text-[12px] text-slate-300">{user?.name}</span>
              <span className="text-slate-500 text-[10px]">▾</span>
            </button>
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-1 rounded-xl shadow-xl z-50 overflow-hidden"
                style={{background:'#1e293b', border:'1px solid #334155', minWidth:'160px'}}>
                <div className="px-3 py-2 border-b" style={{borderColor:'#334155'}}>
                  <div className="text-[12px] font-semibold text-white">{user?.name}</div>
                  <div className="text-[10px] text-slate-400">{user?.role} · {store?.name}</div>
                </div>
                <button onClick={() => { setShowShiftOpen(true); setShowUserMenu(false) }}
                  className="w-full text-left px-3 py-2 text-[12px] text-slate-300 hover:bg-white/10 cursor-pointer border-none bg-transparent transition-colors">
                  🟢 Open Shift
                </button>
                <button onClick={() => { setShowShiftClose(true); setShowUserMenu(false) }}
                  className="w-full text-left px-3 py-2 text-[12px] text-slate-300 hover:bg-white/10 cursor-pointer border-none bg-transparent transition-colors">
                  🔴 Close Shift
                </button>
                <div className="border-t" style={{borderColor:'#334155'}}/>
                <button onClick={() => signOut()}
                  className="w-full text-left px-3 py-2 text-[12px] text-red-400 hover:bg-red-500/10 cursor-pointer border-none bg-transparent transition-colors">
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Page content ── */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {showShiftOpen  && <OpenShiftModal  onClose={() => setShowShiftOpen(false)} />}
      {showShiftClose && <CloseShiftModal onClose={() => setShowShiftClose(false)} />}
    </div>
  )
}
