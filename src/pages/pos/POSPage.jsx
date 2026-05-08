// src/pages/pos/POSPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import { useHeldOrdersStore } from '@/stores/heldOrdersStore'
import { useAuthStore } from '@/stores/authStore'
import CartPanel from './CartPanel'
import { VoiceOrderButton } from '@/components/pos/VoiceOrder'
import { OpenItemModal } from '@/components/pos/OpenItemModal'
import { LangSwitcher } from '@/components/ui/LangSwitcher'
import { useLang } from '@/lib/i18n'
import { HoldModal } from '@/components/pos/HoldModal'
import { PointsRedeemModal } from '@/components/pos/PointsRedeemModal'
import { RecallPanel } from '@/components/pos/RecallPanel'
import ProductGrid from './ProductGrid'
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
  const [showHold,       setShowHold]       = useState(false)
  const [showRecall,     setShowRecall]     = useState(false)
  const [showPoints,     setShowPoints]     = useState(false)
  const [showOpenItem,   setShowOpenItem]   = useState(false)
  const [time,           setTime]           = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { if (tenant?.id) loadTaxGroups(tenant.id) }, [tenant?.id])

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('id, name, color').eq('tenant_id', tenant.id).order('sort_order')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const { data: products = [] } = useQuery({
    queryKey: ['pos-products', tenant?.id, searchQuery, activeCategory],
    queryFn: async () => {
      let q = supabase.from('products')
        .select('*, inventory(quantity), promotions(type,is_active,sale_start,sale_end,sale_type,sale_value,bulk_tiers,time_rules)')
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

  const handleBarcodeInput = useCallback((e) => {
    if (e.key === 'Enter' && searchQuery.length > 3) {
      const match = products.find(p => p.upc === searchQuery || p.sku === searchQuery)
      if (match) { useCartStore.getState().addProduct(match); setSearchQuery('') }
    }
  }, [searchQuery, products])

  const selectedItem = items.find(i => i.id === selectedItemId)

  const { t } = useLang()
  const QUICK_BTNS = [
    { id:'member',  label:t('member'),   icon:'👥', action: () => useCartStore.setState({ showCustPanel: true }) },
    { id:'points',  label:t('points'),   icon:'💎', action: () => setShowPoints(true) },
    { id:'openitem',label:t('openItem'), icon:'✏️', action: () => setShowOpenItem(true) },
    { id:'return',  label:t('return'),   icon:'↩️', action: () => setShowRefund(true) },
    { id:'hold', label:t('hold'), icon:'📌', action: async () => {
      const { items, customer, totals } = useCartStore.getState()
      if (items.length === 0) { toast.error('Cart is empty'); return }
      const { tenant, store, terminal, user } = useAuthStore.getState()
      const ok = await useHeldOrdersStore.getState().holdCurrentCart({
        tenantId: tenant?.id, storeId: store?.id,
        terminalId: terminal?.id, terminalName: terminal?.name,
        userId: user?.id, userName: user?.name,
        label: customer?.name || null,
      })
      if (ok) toast.success('📌 Order held')
    }},
    { id:'recall',  label:t('recall'),   icon:'📋', action: () => { window.location.href='/orders' } },
    { id:'orders',  label:t('orders'),   icon:'🔍', action: () => { window.location.href='/orders' } },
  ]

  return (
    <div className="flex flex-col overflow-hidden" style={{height:'100vh', background:'#FFFFFF'}}>

      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between px-4 py-0 flex-shrink-0"
        style={{height:'44px', background:'#1e293b', borderBottom:'1px solid #334155'}}>
        <div className="flex items-center gap-3">
          <div className="text-[15px] font-black tracking-tight text-white">RetailPOS</div>
          <div className="w-px h-4 bg-slate-600"/>
          <div className="text-[12px] text-slate-400">{store?.name || 'Main Store'}</div>
          <div className="w-px h-4 bg-slate-600"/>
          <div className="text-[12px] text-slate-400">{user?.name}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[13px] font-mono text-slate-400">
            {time.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
          </div>
          <LangSwitcher/>
          <button onClick={() => window.location.href='/backoffice'}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border transition-all"
            style={{background:'rgba(99,102,241,0.15)', borderColor:'rgba(99,102,241,0.4)', color:'#818cf8'}}>
            ⚙ Back Office
          </button>
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div className="flex overflow-hidden" style={{flex:'1 1 0', minHeight:0}}>

        {/* Left: Products */}
        <div className="flex flex-col flex-1 overflow-hidden" style={{background:'#FFFFFF'}}>

          {/* Search bar */}
          <div className="px-3 py-2 flex-shrink-0" style={{background:'#FFFFFF'}}>
            <div className="flex items-center gap-2 rounded-xl px-3 shadow-sm"
              style={{background:'#fff', border:'1.5px solid #e2e8f0'}}>
              <span className="text-slate-400 text-[15px]">🔍</span>
              <input
                type="text" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleBarcodeInput}
                placeholder="Search products or scan barcode..."
                className="flex-1 border-none outline-none text-slate-700 text-[13px] py-2.5 bg-transparent placeholder-slate-400"
                autoFocus
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')}
                  className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-[14px]">✕</button>
              )}
            </div>
            <VoiceOrderButton products={products || []} />
          </div>

          {/* Category tabs */}
          <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto flex-shrink-0">
            <button onClick={() => setActiveCategory('all')}
              className="px-3 py-1 rounded-lg text-[12px] font-semibold border transition-all cursor-pointer whitespace-nowrap"
              style={activeCategory==='all'
                ? {background:'#1e293b', color:'#fff', border:'1.5px solid #1e293b'}
                : {background:'#fff', color:'#64748b', border:'1.5px solid #e2e8f0'}}>
              All
            </button>
            {categories.map(c => (
              <button key={c.id} onClick={() => setActiveCategory(c.id)}
                className="px-3 py-1 rounded-lg text-[12px] font-semibold border transition-all cursor-pointer whitespace-nowrap"
                style={activeCategory===c.id
                  ? {background: c.color||'#4f46e5', color:'#fff', border:`1.5px solid ${c.color||'#4f46e5'}`}
                  : {background:'#fff', color:'#64748b', border:'1.5px solid #e2e8f0'}}>
                {c.name}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <ProductGrid products={products} />
        </div>

        {/* Right: Cart */}
        <div className="flex-shrink-0 h-full overflow-hidden flex" style={{width:'420px'}}>
          <CartPanel onRefund={() => setShowRefund(true)} onHold={() => setShowHold(true)} />

        </div>
      </div>

      {/* ── BOTTOM QUICK BUTTONS ── */}
      <div className="flex-shrink-0 px-3 py-1.5" style={{background:'#1e293b', borderTop:'1px solid #334155'}}>
        <div className="flex gap-2">
          {QUICK_BTNS.map(btn => (
            <button key={btn.id} onClick={btn.action}
              className="flex-1 rounded-lg py-1.5 flex flex-col items-center gap-0.5 cursor-pointer border transition-all"
              style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)'}}>
              <span className="text-[14px]">{btn.icon}</span>
              <span className="text-[9px] font-medium" style={{color:'#94a3b8'}}>{btn.label}</span>
            </button>
          ))}
          {Array(4).fill(0).map((_,i) => (
            <button key={`slot-${i}`}
              className="flex-1 rounded-lg py-1.5 flex flex-col items-center gap-0.5 opacity-20 cursor-not-allowed border"
              style={{background:'transparent', border:'1px dashed rgba(255,255,255,0.2)'}}>
              <span className="text-[12px] text-slate-500">+</span>
              <span className="text-[9px] text-slate-500">Slot</span>
            </button>
          ))}
        </div>
      </div>

      {/* Panels */}
      {showSnPanel    && <SerialPanel />}
      {showWtPanel    && <WeightPanel />}
      {showPricePanel && <PricePanel />}
      {showCustPanel  && <CustomerPanel />}
      {showDiscPanel  && <DiscountPanel />}
      {showPayPanel   && <PaymentPanel />}
      {showRefund     && <RefundPanel onClose={() => setShowRefund(false)} />}

    {showPoints && <PointsRedeemModal onClose={() => setShowPoints(false)}/>}

    {showOpenItem && (
      <OpenItemModal
        tenantId={tenant?.id}
        onAdd={(item) => { useCartStore.getState().addProduct(item); setShowOpenItem(false) }}
        onClose={() => setShowOpenItem(false)}/>
    )}
    </div>
  )
}
