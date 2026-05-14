// src/components/layout/AppLayout.jsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { APP_VERSION_LABEL } from '@/lib/version'
import NetworkStatusBanner from '@/components/NetworkStatusBanner'
import NetworkStatusDot from '@/components/NetworkStatusDot'
import { LangSwitcher } from '@/components/ui/LangSwitcher'
import { OpenShiftModal, CloseShiftModal } from '@/components/pos/ShiftModal'

const NAV_GROUPS = [
  // ─────────────────────────────────────
  // 🏠 OVERVIEW — top-level summary pages
  // ─────────────────────────────────────
  {
    group: 'Overview',
    items: [
      { to:'/backoffice', icon:'🏠', label:'Store Overview' },
      { to:'/reports',    icon:'📊', label:'All Reports' },
      { to:'/payroll',    icon:'💰', label:'Payroll' },
    ]
  },

  // ─────────────────────────────────────
  // 🛒 RETAIL POS — walk-in customers
  // ─────────────────────────────────────
  {
    group: '🛒 Retail POS',
    items: [
      { to:'/pos-dashboard', icon:'📊', label:'POS Dashboard' },
      { to:'/pos-reports',   icon:'📈', label:'POS Reports' },
      { to:'/orders',        icon:'🧾', label:'Orders / Recall' },
      { to:'/customers',     icon:'👥', label:'Members' },
      { to:'/loyalty',       icon:'⭐', label:'Loyalty' },
      { to:'/marketing',     icon:'🎯', label:'Promotions' },
      { to:'/cardcenter',    icon:'💳', label:'Card Center' },
    ]
  },

  // ─────────────────────────────────────
  // 💼 B2B INVOICING — business accounts
  // ─────────────────────────────────────
  {
    group: '💼 B2B Invoicing',
    items: [
      { to:'/b2b-center',       icon:'📊', label:'B2B Dashboard' },
      { to:'/b2b-reports',      icon:'📈', label:'B2B Reports' },
      { to:'/business',         icon:'🏢', label:'Companies' },
      { to:'/estimates',        icon:'📝', label:'Estimates' },
      { to:'/invoices',         icon:'📄', label:'Invoices' },
      { to:'/payments',         icon:'💰', label:'Payments' },
      { to:'/reports/ar-aging', icon:'💸', label:'A/R Aging' },
    ]
  },

  // ─────────────────────────────────────
  // 📦 INVENTORY — shared between POS + B2B
  // ─────────────────────────────────────
  {
    group: '📦 Inventory',
    items: [
      { to:'/products',        icon:'📦', label:'Products' },
      { to:'/categories',      icon:'📁', label:'Categories' },
      { to:'/stock-levels',    icon:'📊', label:'Stock Center' },
      { to:'/purchase-orders', icon:'📋', label:'Purchase Orders' },
      { to:'/vendors',         icon:'🚚', label:'Vendors' },
      { to:'/smart-receive',   icon:'🤖', label:'Smart Receive' },
      { to:'/barcode',         icon:'🏷️', label:'Barcode Print' },
    ]
  },

  // ─────────────────────────────────────
  // ⚙️ SYSTEM
  // ─────────────────────────────────────
  {
    group: 'System',
    items: [
      { to:'/settings',   icon:'⚙️', label:'Settings' },
    ]
  },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const { user, tenant, store, signOut } = useAuthStore()
  const [showShiftOpen,  setShowShiftOpen]  = useState(false)
  const [showShiftClose, setShowShiftClose] = useState(false)
  const [collapsed,      setCollapsed]      = useState(false)

  return (
    <div className="flex h-screen" style={{background:'#FFFFFF'}}>

      {/* ── Left Sidebar ── */}
      <div className="flex flex-col flex-shrink-0 transition-all"
        style={{
          width: collapsed ? '56px' : '200px',
          background:'#1F1F1F',
          borderRight:'1px solid #2A2A2A',
        }}>

        {/* Logo */}
        <div className="flex items-center gap-2 px-3 py-3.5 border-b" style={{borderColor:'#2A2A2A', minHeight:'52px'}}>
          {!collapsed && (
            <>
              <div className="text-[15px] font-bold text-white">RetailPOS</div>
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded ml-1 flex-shrink-0"
                style={{background:'rgba(0,106,255,0.2)', color:'#80B2FF'}}>
                BACK OFFICE
              </span>
            </>
          )}
          <button onClick={() => setCollapsed(!collapsed)}
            className="ml-auto bg-transparent border-none cursor-pointer text-[14px] flex-shrink-0 transition-colors"
            style={{color:'#999999'}}>
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {/* Store-name banner — shows which store the user is currently working in */}
        {!collapsed && store?.name && (
          <div className="px-3 py-2.5 border-b" style={{borderColor:'#2A2A2A', background:'#161616'}}>
            <div className="text-[8px] uppercase tracking-widest mb-0.5" style={{color:'#666'}}>Current Store</div>
            <div className="text-[12px] font-bold text-white truncate flex items-center gap-1">
              🏪 {store.name}
            </div>
            {tenant?.name && tenant.name !== store.name && (
              <div className="text-[9px] truncate mt-0.5" style={{color:'#999'}}>{tenant.name}</div>
            )}
          </div>
        )}

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_GROUPS.map(group => (
            <div key={group.group} className="mb-1">
              {!collapsed && (
                <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
                  style={{color:'#666666'}}>
                  {group.group}
                </div>
              )}
              {group.items.map(item => (
                <NavLink key={item.to} to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 cursor-pointer no-underline transition-all mx-1.5 rounded-lg mb-0.5 ${
                      collapsed ? 'justify-center px-1.5 py-2.5' : 'px-2.5 py-2'
                    } ${isActive ? 'text-white' : 'hover:bg-white/8'}`
                  }
                  style={({ isActive }) => isActive
                    ? {background:'#006AFF'}
                    : {color:'#999999'}}
                  title={collapsed ? item.label : ''}>
                  <span className="text-[16px] flex-shrink-0">{item.icon}</span>
                  {!collapsed && <span className="text-[12px] font-medium">{item.label}</span>}
                </NavLink>
              ))}
              {!collapsed && <div className="mx-3 my-1" style={{borderTop:'1px solid #2A2A2A'}}/>}
            </div>
          ))}
        </nav>

        {/* Bottom: POS button + User */}
        <div className="border-t p-2" style={{borderColor:'#2A2A2A'}}>
          {/* Network status — visible when expanded */}
          {!collapsed && (
            <div className="mb-2 px-1">
              <NetworkStatusDot />
            </div>
          )}
          {/* Back to POS */}
          {!collapsed && (
            <div className="mb-2 px-1">
              <LangSwitcher dark/>
            </div>
          )}
          <button onClick={() => window.location.href='/pos'}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer border-none mb-1.5 transition-all"
            style={{background:'rgba(0,106,255,0.15)', color:'#80B2FF'}}
            title={collapsed ? 'POS' : ''}>
            <span className="text-[15px] flex-shrink-0">🖥️</span>
            {!collapsed && <span className="text-[12px] font-semibold">← POS</span>}
          </button>

          {/* User info */}
          <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${collapsed?'justify-center':''}`}
            style={{background:'rgba(255,255,255,0.06)'}}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
              style={{background:'#006AFF'}}>
              {user?.name?.charAt(0)||'U'}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-white truncate">{user?.name}</div>
                <div className="text-[9px] truncate" style={{color:'#999999'}}>{store?.name}</div>
              </div>
            )}
            {!collapsed && (
              <button onClick={() => signOut()}
                className="bg-transparent border-none cursor-pointer text-[11px] flex-shrink-0 transition-colors hover:text-[#CF1322]"
                style={{color:'#666666'}}
                title="Sign out">
                ⏻
              </button>
            )}
          </div>
        </div>

        {/* Software version footer — bottom of sidebar */}
        {!collapsed && (
          <div className="px-3 py-2 text-center" style={{borderTop:'1px solid #2A2A2A', background:'#161616'}}>
            <div className="text-[9px] font-mono" style={{color:'#666'}}>
              {APP_VERSION_LABEL}
            </div>
          </div>
        )}
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <NetworkStatusBanner />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {showShiftOpen  && <OpenShiftModal  onClose={() => setShowShiftOpen(false)} />}
      {showShiftClose && <CloseShiftModal onClose={() => setShowShiftClose(false)} />}
    </div>
  )
}
