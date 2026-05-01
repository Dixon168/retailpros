// src/pages/pos/POSPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import CartPanel from './CartPanel'
import ProductGrid from './ProductGrid'
import ItemPanel from './panels/ItemPanel'
import SerialPanel from './panels/SerialPanel'
import WeightPanel from './panels/WeightPanel'
import PricePanel from './panels/PricePanel'
import CustomerPanel from './panels/CustomerPanel'
import DiscountPanel from './panels/DiscountPanel'
import PaymentPanel from './panels/PaymentPanel'
import RefundPanel from './panels/RefundPanel'

export default function POSPage() {
  const navigate    = useNavigate()
  const { user, tenant, store } = useAuthStore()
  const {
    loadTaxGroups, showSnPanel, showWtPanel, showPricePanel,
    showCustPanel, showDiscPanel, showPayPanel, selectedItemId, items
  } = useCartStore()

  const [searchQuery,    setSearchQuery]    = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [showRefund,     setShowRefund]     = useState(false)
  const [time,           setTime]           = useState(new Date())

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { if (tenant?.id) loadTaxGroups(tenant.id) }, [tenant?.id])

  // Categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('id, name, color').eq('tenant_id', tenant.id).order('sort_order')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Products
  const { data: products = [] } = useQuery({
    queryKey: ['pos-products', tenant?.id, searchQuery, activeCategory],
    queryFn: async () => {
      let q = supabase.from('products')
        .select('*, inventory(quantity)')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .neq('is_enabled', false)

      if (searchQuery)
        q = q.or(`name.ilike.%${searchQuery}%,sku.ilike.%${searchQuery}%,upc.eq.${searchQuery}`)
      if (activeCategory !== 'all')
        q = q.eq('category_id', activeCategory)

      const { data } = await q.order('sort_order').order('name').limit(80)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Barcode scan
  const handleBarcodeInput = useCallback((e) => {
    if (e.key === 'Enter' && searchQuery.length > 3) {
      const match = products.find(p => p.upc === searchQuery || p.sku === searchQuery)
      if (match) { useCartStore.getState().addProduct(match); setSearchQuery('') }
    }
  }, [searchQuery, products])

  const selectedItem = items.find(i => i.id === selectedItemId)

  // Quick action buttons config
  const QUICK_BTNS = [
    { id:'member',  label:'Member',    icon:'👥', action: () => useCartStore.setState({ showCustPanel: true }) },
    { id:'vip',     label:'VIP Card',  icon:'🏷️', action: () => useCartStore.setState({ showCustPanel: true }) },
    { id:'gift',    label:'Gift Card', icon:'🎁', action: () => {} },
    { id:'points',  label:'Points',    icon:'⭐', action: () => {} },
    { id:'recall',  label:'Recall',    icon:'📋', action: () => {} },
    { id:'orders',  label:'Orders',    icon:'🔍', action: () => navigate('/orders') },
    // Slots 7-10 reserved for future
  ]

  return (
    <div className="flex flex-col h-full bg-[#07090f] overflow-hidden">

      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0d1117]
        border-b border-[#1e2d42] flex-shrink-0 h-[46px]">
        <div className="flex items-center gap-3">
          <div className="text-[14px] font-black tracking-tight"
            style={{background:'linear-gradient(135deg,#fff,#06b6d4)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
            RetailPOS
          </div>
          <div className="h-3.5 w-px bg-[#1e2d42]"/>
          <div className="text-[12px] text-[#8899b0]">{store?.name || 'Main Store'}</div>
          <div className="h-3.5 w-px bg-[#1e2d42]"/>
          <div className="text-[11px] text-[#3d5068]">{user?.name}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[13px] font-mono text-[#3d5068]">
            {time.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
          </div>
          <button
            onClick={() => navigate('/products')}
            className="bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5
              text-[11px] text-[#8899b0] cursor-pointer hover:text-white hover:border-[#243347]
              transition-all flex items-center gap-1.5">
            ⚙️ Back Office
          </button>
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Product area */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Search */}
          <div className="px-3 py-2 border-b border-[#1e2d42] flex-shrink-0">
            <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42]
              rounded-[9px] px-3 focus-within:border-blue-500/40 transition-colors">
              <span className="text-[#3d5068]">🔍</span>
              <input
                type="text" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleBarcodeInput}
                placeholder="Search or scan barcode..."
                className="flex-1 bg-transparent border-none outline-none text-[#e8edf5]
                  text-[12px] py-2 placeholder-[#3d5068]"
                autoFocus
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')}
                  className="text-[#3d5068] hover:text-white bg-transparent border-none cursor-pointer">✕</button>
              )}
            </div>
          </div>

          {/* Category tabs */}
          <div className="flex gap-1.5 px-3 py-2 border-b border-[#1e2d42] overflow-x-auto flex-shrink-0">
            <button onClick={() => setActiveCategory('all')}
              className={`px-3 py-1 rounded-md text-[11px] font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                activeCategory==='all'
                  ? 'bg-blue-500/15 border-blue-500/40 text-blue-400'
                  : 'bg-[#111827] border-[#1e2d42] text-[#8899b0] hover:text-white'
              }`}>All</button>
            {categories.map(c => (
              <button key={c.id} onClick={() => setActiveCategory(c.id)}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                  activeCategory===c.id
                    ? 'border-opacity-50 text-white'
                    : 'bg-[#111827] border-[#1e2d42] text-[#8899b0] hover:text-white'
                }`}
                style={activeCategory===c.id ? {
                  background:`${c.color||'#3b82f6'}18`,
                  borderColor:`${c.color||'#3b82f6'}50`,
                  color: c.color||'#3b82f6'
                } : {}}>
                {c.name}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <ProductGrid products={products} />
        </div>

        {/* Center: Cart */}
        <CartPanel onRefund={() => setShowRefund(true)} />

        {/* Right: Item panel (shows when item selected) */}
        {selectedItem && (
          <ItemPanel
            item={selectedItem}
            onClose={() => useCartStore.setState({ selectedItemId: null })}
          />
        )}
      </div>

      {/* ── BOTTOM QUICK BUTTONS ── */}
      <div className="flex-shrink-0 bg-[#0d1117] border-t border-[#1e2d42] px-3 py-2">
        <div className="flex gap-2">
          {QUICK_BTNS.map(btn => (
            <button key={btn.id} onClick={btn.action}
              className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-2
                flex flex-col items-center gap-0.5 cursor-pointer
                hover:border-blue-500/30 hover:bg-[#1a2236] transition-all group">
              <span className="text-[16px]">{btn.icon}</span>
              <span className="text-[9px] font-mono text-[#3d5068] group-hover:text-[#8899b0] transition-colors">
                {btn.label}
              </span>
            </button>
          ))}
          {/* Reserved slots */}
          {Array(4).fill(0).map((_,i) => (
            <button key={`slot-${i}`}
              className="flex-1 bg-[#0d1117] border border-dashed border-[#1e2d42] rounded-[9px] py-2
                flex flex-col items-center gap-0.5 opacity-30 cursor-not-allowed">
              <span className="text-[14px] text-[#3d5068]">+</span>
              <span className="text-[9px] font-mono text-[#3d5068]">Slot</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── PANELS ── */}
      {showSnPanel    && <SerialPanel />}
      {showWtPanel    && <WeightPanel />}
      {showPricePanel && <PricePanel />}
      {showCustPanel  && <CustomerPanel />}
      {showDiscPanel  && <DiscountPanel />}
      {showPayPanel   && <PaymentPanel />}
      {showRefund     && <RefundPanel onClose={() => setShowRefund(false)} />}
    </div>
  )
}

function CategoryButton({ label, color, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1 rounded-md text-[11px] font-semibold border transition-all
        cursor-pointer whitespace-nowrap ${
        active ? '' : 'bg-[#111827] border-[#1e2d42] text-[#8899b0] hover:text-white'
      }`}
      style={active ? {
        background: `${color}18`, borderColor: `${color}50`, color
      } : {}}>
      {label}
    </button>
  )
}
