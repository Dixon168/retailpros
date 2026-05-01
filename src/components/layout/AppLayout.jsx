// src/components/layout/AppLayout.jsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
import { useState, useEffect } from 'react'
import TerminalSetup from '@/pages/terminal/TerminalSetup'
import { OpenShiftModal, CloseShiftModal } from '@/components/pos/ShiftModal'

const NAV_ITEMS = [
  { to: '/pos',        icon: '🛒', label: 'POS' },
  { to: '/orders',     icon: '🔍', label: 'Orders' },
  { to: '/products',   icon: '📦', label: 'Products' },
  { to: '/categories',  icon: '📁', label: 'Categories' },
  { to: '/customers',  icon: '👥', label: 'Customers' },
  { to: '/invoices',   icon: '📄', label: 'Invoices' },
  { to: '/business',   icon: '🏢', label: 'B2B' },
  { to: '/marketing',  icon: '🎯', label: 'Marketing' },
  { to: '/loyalty',    icon: '🏷️', label: 'Loyalty' },
  { to: '/cardcenter', icon: '💳', label: 'Card Center' },
  { to: '/reports',    icon: '📊', label: 'Reports' },
  { to: '/settings',   icon: '⚙️', label: 'Settings' },
]

export default function AppLayout() {
  const { user, tenant, store, stores, switchStore, signOut } = useAuthStore()
  const { terminal, isRegistered, shiftOpen, paxOnline, initialize } = useTerminalStore()

  const [showStoreMenu,  setShowStoreMenu]  = useState(false)
  const [showSetup,      setShowSetup]      = useState(false)
  const [showOpenShift,  setShowOpenShift]  = useState(false)
  const [showCloseShift, setShowCloseShift] = useState(false)
  const navigate = useNavigate()

  // Initialize terminal on mount
  useEffect(() => {
    if (!tenant?.id) return
    initialize(tenant.id).then(({ found }) => {
      if (!found) setShowSetup(true)
    })
  }, [tenant?.id])

  const handleSignOut = async () => { await signOut(); navigate('/login') }

  // If terminal not registered, show setup wizard
  if (showSetup) {
    return <TerminalSetup onComplete={() => setShowSetup(false)} />
  }

  return (
    <div className="flex flex-col h-screen bg-[#07090f]">
      {/* ── Topbar ── */}
      <header className="h-14 bg-[#0d1117] border-b border-[#1e2d42] flex items-center
        px-5 gap-4 flex-shrink-0 z-40">

        <span className="font-bold text-[15px] bg-gradient-to-r from-white to-cyan-400
          bg-clip-text text-transparent mr-2">RetailPOS</span>

        <nav className="flex gap-1 flex-1">
          {NAV_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-xs transition-all duration-150 flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-blue-500/10 text-blue-400'
                    : 'text-[#8899b0] hover:text-white hover:bg-[#111827]'
                }`}>
              <span>{item.icon}</span><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          {/* PAX status dot */}
          {terminal?.pax_enabled && (
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                paxOnline ? 'bg-green-400 shadow-[0_0_5px_#10b981]' : 'bg-red-400'
              }`}/>
              <span className="text-[9px] font-mono text-[#3d5068]">
                PAX {terminal.pax_ip}
              </span>
            </div>
          )}

          {/* Shift open/close */}
          <button
            onClick={() => shiftOpen ? setShowCloseShift(true) : setShowOpenShift(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border
              text-[10px] font-mono transition-all ${
              shiftOpen
                ? 'border-green-500/30 bg-green-500/6 text-green-400 hover:bg-green-500/10'
                : 'border-[#1e2d42] bg-[#111827] text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400'
            }`}
          >
            {shiftOpen ? '🟢 SHIFT OPEN' : '⭕ OPEN SHIFT'}
          </button>

          {/* Terminal name */}
          <div className="text-[10px] font-mono text-[#3d5068] px-2 py-1
            bg-[#111827] border border-[#1e2d42] rounded-lg">
            🖥️ {terminal?.name || 'Terminal'}
          </div>

          {/* Store switcher */}
          {stores.length > 1 && (
            <div className="relative">
              <button onClick={() => setShowStoreMenu(!showStoreMenu)}
                className="bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5
                  text-xs text-[#8899b0] hover:border-blue-500/40 transition-all flex items-center gap-2">
                🏪 {store?.name}<span className="text-[10px]">▾</span>
              </button>
              {showStoreMenu && (
                <div className="absolute right-0 top-full mt-1 bg-[#0d1117] border
                  border-[#1e2d42] rounded-xl shadow-2xl py-1 min-w-[160px] z-50">
                  {stores.map(s => (
                    <button key={s.id}
                      onClick={() => { switchStore(s.id); setShowStoreMenu(false) }}
                      className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                        s.id === store?.id
                          ? 'text-blue-400 bg-blue-500/5'
                          : 'text-[#8899b0] hover:bg-[#111827] hover:text-white'
                      }`}>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* User */}
          <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42]
            rounded-lg px-3 py-1.5 cursor-pointer hover:border-[#243347] transition-all"
            onClick={handleSignOut} title="Click to sign out">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-purple-600
              flex items-center justify-center text-[10px] font-bold text-white">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <span className="text-xs text-[#8899b0]">{user?.name}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* Shift modals */}
      {showOpenShift  && <OpenShiftModal  onClose={() => setShowOpenShift(false)} />}
      {showCloseShift && <CloseShiftModal onClose={() => setShowCloseShift(false)} />}
    </div>
  )
}
