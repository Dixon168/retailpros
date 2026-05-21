// src/pages/pos/POSPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import { openCashDrawer } from '@/lib/cashDrawer'
import { useHeldOrdersStore } from '@/stores/heldOrdersStore'
import { useAuthStore } from '@/stores/authStore'
import CartPanel from './CartPanel'
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
import GiftCardPanel from '@/components/pos/GiftCardPanel'
import { OpenShiftModal } from '@/components/pos/ShiftModal'
import CloseShiftFlow from '@/components/pos/CloseShiftFlow'
import { useTerminalStore } from '@/stores/terminalStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import PinKeypadModal from '@/components/pos/PinKeypadModal'
import ManagerOverrideModal from '@/components/pos/ManagerOverrideModal'
import { logOverride } from '@/lib/auditOverride'
import { ProductForm } from '@/pages/products/ProductForm'
import { PhotoViewer } from '@/components/ui/ProductPhoto'
import { ProductQuickInfo } from '@/components/pos/ProductQuickInfo'
import { getDisplaySync, EVT } from '@/lib/displaySync'
import { APP_VERSION } from '@/lib/version'
import toast from 'react-hot-toast'

export default function POSPage() {
  const navigate    = useNavigate()
  const { user, tenant, store, can } = useAuthStore()
  const qc = useQueryClient()
  const {
    loadTaxGroups, showSnPanel, showWtPanel, showPricePanel,
    showCustPanel, showDiscPanel, showPayPanel, selectedItemId, items
  } = useCartStore()

  const [searchQuery,    setSearchQuery]    = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [selectedTag,    setSelectedTag]    = useState('')  // filter by product tag
  const [showRefund,     setShowRefund]     = useState(false)
  const [refundPreload,  setRefundPreload]  = useState(null)
  const [showHold,       setShowHold]       = useState(false)
  const [showRecall,     setShowRecall]     = useState(false)
  const [showPoints,     setShowPoints]     = useState(false)
  const [showGiftCard,   setShowGiftCard]   = useState(false)
  const [showOpenItem,   setShowOpenItem]   = useState(false)
  const [showOpenShift,  setShowOpenShift]  = useState(false)
  const [showCloseShift, setShowCloseShift] = useState(false)
  const [pinMode,        setPinMode]        = useState(null)  // 'signin' | 'clockin' | 'clockout' | null
  const [override,       setOverride]       = useState(null)  // { permission, action, onApprove }
  const [highlightProductId, setHighlightProductId] = useState(null)  // scanned product to flash
  const [editingProduct,     setEditingProduct]     = useState(null)  // product object opened for full edit
  const [quickInfoProduct,   setQuickInfoProduct]   = useState(null)  // product showing in read-only preview
  const [photoViewProduct,   setPhotoViewProduct]   = useState(null)  // product to zoom (no perm)

  /**
   * Run an action that may require permission.
   * - allow  → run immediately
   * - prompt → open ManagerOverrideModal, run on PIN verify
   * - deny   → red toast, don't run
   * Optional `actionLabel` is shown in the override modal (e.g. "process this refund")
   */
  const guard = (permission, actionLabel, fn) => {
    const v = can(permission)
    if (v === 'allow') return fn()
    if (v === 'prompt') {
      setOverride({
        permission, action: actionLabel,
        onApprove: (approver) => {
          toast.success(`✓ Approved by ${approver.name}`)
          // Audit log — fire-and-forget
          logOverride({
            tenantId: tenant?.id, storeId: store?.id, terminalId: terminal?.id,
            permission, actionLabel,
            requestedBy: activeEmployee
              ? { id: activeEmployee.id, name: activeEmployee.name }
              : { id: user?.id, name: user?.name },
            approver,
          })
          fn(approver)
        },
      })
      return
    }
    toast.error(`You don't have permission to ${actionLabel}`)
  }
  const { currentShift, shiftOpen, terminal } = useTerminalStore()
  const { activeEmployee, clockedIn, clockedInAt, signOut } = useEmployeeStore()
  const [time,           setTime]           = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { if (tenant?.id) loadTaxGroups(tenant.id) }, [tenant?.id])

  // ── Customer Display sync ──
  // Subscribe to cartStore changes and publish to BroadcastChannel so a
  // /display tab on the secondary monitor stays in lockstep with the POS.
  // The Display tab will receive every cart update, customer change, and
  // totals recalc in real time without any latency.
  useEffect(() => {
    if (!terminal?.id && !tenant?.id) return
    const sync = getDisplaySync(terminal?.id || tenant?.id || 'default')
    const publishState = () => {
      const s = useCartStore.getState()
      const totals = s.totals()
      sync.publish(EVT.CART_STATE, {
        items: s.items.map(i => {
          const bulk = s.lineBulk(i)
          return {
            id: i.id, name: i.name, qty: i.qty,
            unitPrice: i.unitPrice, image_url: i.image_url,
            itemDiscount: i.itemDiscount, note: i.note,
            // Send bulk info so display can show the discount + breakdown.
            // Keep the shape lean — Display only needs lineTotal + savings + hint.
            bulk: bulk ? {
              lineTotal: bulk.lineTotal,
              savings:   bulk.savings,
              breakdown: bulk.breakdown,
              hint:      bulk.hint,
            } : null,
          }
        }),
        customer: s.customer ? {
          id: s.customer.id, name: s.customer.name,
          loyalty_points: s.customer.loyalty_points,
          tier_name: s.customer.tier_name,
        } : null,
        orderDiscount: s.orderDiscount,
        appliedCoupon: s.appliedCoupon ? { code: s.appliedCoupon.code } : null,
        totals: {
          subtotal: totals.subtotal,
          discountAmt: totals.orderDiscountAmt + (totals.couponDiscountAmt||0),
          bulkSavings: totals.bulkSavings || 0,
          taxAmount: totals.taxAmount,
          grandTotal: totals.grandTotal,
        },
        store: { name: store?.name, logo_url: store?.logo_url },
        ts: Date.now(),
      })
    }
    // Publish current state immediately for any already-open Display tab
    publishState()
    // Re-publish whenever the cart store changes
    const unsub = useCartStore.subscribe(publishState)
    return () => { unsub() }
  }, [terminal?.id, tenant?.id, store?.name, store?.logo_url])

  // Auto-open Refund with preloaded order if /pos?refund=<order_id>
  useEffect(() => {
    if (!tenant?.id) return
    const params = new URLSearchParams(window.location.search)
    const refundId = params.get('refund')
    if (!refundId) return
    ;(async () => {
      const { data, error } = await supabase.from('orders')
        .select('*, order_items(*, products(name, unit, price, image_url)), customers(name)')
        .eq('id', refundId).eq('tenant_id', tenant.id).maybeSingle()
      if (error || !data) {
        toast.error('Could not load order for refund')
      } else {
        setRefundPreload(data)
        setShowRefund(true)
      }
      // Clean the URL so reloading doesn't re-trigger
      window.history.replaceState({}, '', '/pos')
    })()
  }, [tenant?.id])

  // Restore a held order into the cart if /pos?resume=<held_id>
  useEffect(() => {
    if (!tenant?.id) return
    const params = new URLSearchParams(window.location.search)
    const resumeId = params.get('resume')
    if (!resumeId) return
    ;(async () => {
      await useHeldOrdersStore.getState().restoreHeldToCart({ heldOrderId: resumeId })
      // Clean the URL so reloading doesn't re-trigger the restore
      window.history.replaceState({}, '', '/pos')
    })()
  }, [tenant?.id])

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categories')
        .select('id, name, color').eq('tenant_id', tenant.id).order('sort_order')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // All distinct tags across active products — powers the POS tag filter.
  const { data: allTags = [] } = useQuery({
    queryKey: ['pos-tags', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('products')
        .select('tags').eq('tenant_id', tenant.id).eq('is_active', true)
      const set = new Set()
      ;(data || []).forEach(p => (p.tags || []).forEach(t => t && set.add(t)))
      return [...set].sort()
    },
    enabled: !!tenant?.id,
  })

  const { data: products = [] } = useQuery({
    queryKey: ['pos-products', tenant?.id, store?.id, searchQuery, activeCategory, selectedTag],
    queryFn: async () => {
      let q = supabase.from('products')
        .select(`*,
                 inventory(quantity, store_id),
                 promotions(type,is_active,sale_start,sale_end,sale_type,sale_value,bulk_tiers,time_rules),
                 subcategories(id, name, categories(id, name, emoji, color))`)
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .neq('is_enabled', false)
      if (searchQuery)
        q = q.or(`name.ilike.%${searchQuery}%,sku.ilike.%${searchQuery}%,upc.eq.${searchQuery}`)
      if (activeCategory !== 'all')
        q = q.eq('category_id', activeCategory)
      if (selectedTag)
        q = q.contains('tags', [selectedTag])
      const { data } = await q.order('sort_order').order('name').limit(80)
      // Filter inventory[] to only the current store so qty shows per-store
      return (data || []).map(p => ({
        ...p,
        inventory: store?.id
          ? (p.inventory || []).filter(i => i.store_id === store.id)
          : (p.inventory || []),
      }))
    },
    enabled: !!tenant?.id,
  })

  const handleBarcodeInput = useCallback((e) => {
    if (e.key === 'Enter' && searchQuery.length > 3) {
      const match = products.find(p => p.upc === searchQuery || p.sku === searchQuery)
      if (match) {
        useCartStore.getState().addProduct(match)
        setSearchQuery('')
        // If the scanned product is filtered out by the current category,
        // switch to 'all' so it becomes visible for the highlight
        if (activeCategory !== 'all' && match.category_id !== activeCategory) {
          setActiveCategory('all')
        }
        // Trigger the scroll-to-and-highlight effect
        setHighlightProductId(match.id)
        toast.success(`✓ ${match.name}`, { duration: 1500 })
      } else {
        toast.error(`No product found for "${searchQuery}"`)
      }
    }
  }, [searchQuery, products, activeCategory])

  // Auto-clear the highlight after a few seconds so it doesn't linger
  useEffect(() => {
    if (!highlightProductId) return
    const t = setTimeout(() => setHighlightProductId(null), 3000)
    return () => clearTimeout(t)
  }, [highlightProductId])

  const selectedItem = items.find(i => i.id === selectedItemId)

  const { t } = useLang()
  // Cash drawer enabled? Cached at render — checked again on click
  const drawerEnabled = (() => {
    try { return JSON.parse(localStorage.getItem('cashDrawerSettings') || '{}').enabled === true }
    catch { return false }
  })()

  const handleOpenDrawer = () => guard('pos.refund', 'open the cash drawer', async () => {
    const r = await openCashDrawer()
    if (r.ok) toast.success('💰 Drawer opened')
    else toast.error(r.msg)
  })

  const QUICK_BTNS = [
    { id:'member',  label:t('member'),   icon:'👥', action: () => useCartStore.setState({ showCustPanel: true }) },
    { id:'points',  label:t('points'),   icon:'⭐', action: () => guard('pos.points_redeem', 'redeem loyalty points', () => setShowPoints(true)) },
    { id:'openitem',label:t('openItem'), icon:'✏️', action: () => guard('pos.price_override', 'use an open-price item', () => setShowOpenItem(true)) },
    { id:'return',  label:t('return'),   icon:'↩️', action: () => guard('pos.refund', 'process a refund', () => setShowRefund(true)) },
    { id:'hold', label:t('hold'), icon:'📌', action: async () => {
      const { items, customer, totals } = useCartStore.getState()
      if (items.length === 0) { toast.error('Cart is empty'); return }
      const { tenant, store, terminal, user } = useAuthStore.getState()
      const { activeEmployee } = useEmployeeStore.getState()
      const empId   = activeEmployee?.id   || user?.id
      const empName = activeEmployee?.name || user?.name
      const ok = await useHeldOrdersStore.getState().holdCurrentCart({
        tenantId: tenant?.id, storeId: store?.id,
        terminalId: terminal?.id, terminalName: terminal?.name,
        userId: empId, userName: empName,
        label: customer?.name || null,
      })
      if (ok) toast.success('📌 Order held')
    }},
    { id:'giftcard', label:'Gift Card', icon:'🎁', action: () => guard('pos.gift_card', 'manage gift cards', () => setShowGiftCard(true)) },
    ...(drawerEnabled ? [
      { id:'drawer', label:'Cash Drawer', icon:'💰', action: handleOpenDrawer },
    ] : []),
    { id:'orders',  label:t('orders'),   icon:'📋', action: () => { window.location.href='/orders' } },
  ]

  return (
    <div className="flex flex-col overflow-hidden" style={{height:'100vh', background:'#FFFFFF'}}>

      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between px-4 py-0 flex-shrink-0"
        style={{height:'44px', background:'#1F1F1F', borderBottom:'1px solid #2A2A2A'}}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="text-[15px] font-bold tracking-tight text-white">RetailPOS</div>
            <span className="text-[8px] font-mono px-1 py-0.5 rounded" style={{background:'rgba(0,106,255,0.25)', color:'#80B2FF'}}>
              v{APP_VERSION}
            </span>
          </div>
          <div className="w-px h-4 bg-slate-600"/>
          <div className="flex items-center gap-1.5">
            <span className="text-[14px]">🏪</span>
            <span className="text-[13px] font-bold text-white">{store?.name || 'Main Store'}</span>
          </div>
          <div className="w-px h-4 bg-slate-600"/>
          <div className="text-[12px] text-slate-400">{user?.name}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[13px] font-mono text-slate-400">
            {time.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
          </div>
          <LangSwitcher/>

          {/* 📺 Open Customer Display — pops the customer-facing screen in a
              new window that can be dragged to a second monitor. The cart
              state mirrors live via BroadcastChannel. */}
          <button onClick={() => {
            const tid = terminal?.id || tenant?.id || 'default'
            const url = `/display/${tid}?tenant=${tenant?.id || ''}`
            const w = window.open(url, 'rpos-display',
              'popup,width=1024,height=768,toolbar=no,menubar=no,location=no,status=no')
            if (!w) toast.error('Pop-up blocked — please allow pop-ups for this site')
            else toast.success('📺 Customer display opened — drag to second monitor')
          }}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-bold cursor-pointer border transition-all"
            style={{background:'rgba(0,106,255,0.12)', borderColor:'rgba(0,106,255,0.4)', color:'#60a5fa'}}
            title="Open customer-facing display (second monitor)">
            📺
          </button>

          {/* Employee signed in (PIN auth — separate from clock state) */}
          {activeEmployee ? (
            <button onClick={() => {
              if (confirm(`Sign out ${activeEmployee.name}?\n\nThis only signs out of the app — it does NOT clock you out.`)) {
                signOut()
                toast.success('Signed out')
              }
            }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border transition-all"
              style={{background:'rgba(59,130,246,0.15)', borderColor:'rgba(59,130,246,0.45)', color:'#60a5fa'}}
              title={`Signed in: ${activeEmployee.name}\nTap to sign out`}>
              👤 {activeEmployee.name.split(' ')[0]}
            </button>
          ) : (
            <button onClick={() => setPinMode('signin')}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border transition-all"
              style={{background:'rgba(59,130,246,0.15)', borderColor:'rgba(59,130,246,0.45)', color:'#60a5fa'}}>
              👤 Sign In
            </button>
          )}

          {/* Clock In / Out — totally independent from sign-in */}
          {clockedIn ? (
            <button onClick={() => setPinMode('clockout')}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border transition-all"
              style={{background:'rgba(16,185,129,0.15)', borderColor:'rgba(16,185,129,0.45)', color:'#34d399'}}
              title={clockedInAt ? `Clocked in since ${new Date(clockedInAt).toLocaleTimeString()}` : 'Clocked in'}>
              <span className="w-2 h-2 rounded-full" style={{background:'#10b981', boxShadow:'0 0 6px #10b981'}}/>
              ⏰ Clocked In
            </button>
          ) : (
            <button onClick={() => setPinMode('clockin')}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border transition-all"
              style={{background:'rgba(168,85,247,0.15)', borderColor:'rgba(168,85,247,0.45)', color:'#c084fc'}}>
              ⏰ Clock In
            </button>
          )}

          {shiftOpen ? (
            <button onClick={() => guard('pos.close_shift', 'close the shift', () => setShowCloseShift(true))}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border transition-all"
              style={{background:'rgba(34,197,94,0.15)', borderColor:'rgba(34,197,94,0.45)', color:'#4ade80'}}
              title={`Shift open since ${new Date(currentShift?.opened_at).toLocaleTimeString()}\nFloat: $${Number(currentShift?.opening_amount||0).toFixed(2)}`}>
              <span className="w-2 h-2 rounded-full" style={{background:'#22c55e', boxShadow:'0 0 6px #22c55e'}}/>
              Shift Open
            </button>
          ) : (
            <button onClick={() => guard('pos.open_shift', 'open a shift', () => setShowOpenShift(true))}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border transition-all"
              style={{background:'rgba(234,88,12,0.15)', borderColor:'rgba(234,88,12,0.45)', color:'#fb923c'}}
              title="Click to open shift and enter opening cash float">
              ☀️ Open Shift
            </button>
          )}
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

          {/* Search bar — narrow search/scan box + horizontal tag buttons */}
          <div className="px-3 py-2 flex-shrink-0 flex items-center gap-2" style={{background:'#FFFFFF'}}>
            {/* Search box — fixed narrow width, enough to type / scan */}
            <div className="flex items-center gap-2 rounded-xl px-3 shadow-sm flex-shrink-0"
              style={{background:'#fff', border:'1.5px solid #e2e8f0', width:'260px'}}>
              <span className="text-slate-400 text-[15px]">🔍</span>
              <input
                type="text" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleBarcodeInput}
                placeholder="Search or scan..."
                className="flex-1 border-none outline-none text-slate-700 text-[13px] py-2.5 bg-transparent placeholder-slate-400 min-w-0"
                autoFocus
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')}
                  className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-[14px]">✕</button>
              )}
            </div>

            {/* Tag filter — horizontal scrollable button strip. Click to
                filter the grid to one tag; click again (or All) to clear. */}
            {allTags.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto flex-1 min-w-0 items-center">
                <button onClick={() => setSelectedTag('')}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all cursor-pointer whitespace-nowrap flex-shrink-0"
                  style={!selectedTag
                    ? {background:'#1F1F1F', color:'#fff', border:'1.5px solid #1F1F1F'}
                    : {background:'#fff', color:'#64748b', border:'1.5px solid #e2e8f0'}}>
                  🏷️ All
                </button>
                {allTags.map(t => (
                  <button key={t}
                    onClick={() => setSelectedTag(selectedTag === t ? '' : t)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all cursor-pointer whitespace-nowrap flex-shrink-0"
                    style={selectedTag === t
                      ? {background:'#006AFF', color:'#fff', border:'1.5px solid #006AFF'}
                      : {background:'#fff', color:'#64748b', border:'1.5px solid #e2e8f0'}}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Category tabs */}
          <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto flex-shrink-0">
            <button onClick={() => setActiveCategory('all')}
              className="px-3 py-1 rounded-lg text-[12px] font-semibold border transition-all cursor-pointer whitespace-nowrap"
              style={activeCategory==='all'
                ? {background:'#1F1F1F', color:'#fff', border:'1.5px solid #1F1F1F'}
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
          <ProductGrid products={products} highlightId={highlightProductId}
            onPhotoClick={(product) => {
              // Always open the read-only Quick Info first. Editing is a
              // deliberate second tap from inside the preview, which
              // prevents the cashier from accidentally entering edit
              // mode on a product they only wanted to glance at.
              setQuickInfoProduct(product)
            }}/>
        </div>

        {/* Right: Cart */}
        <div className="flex-shrink-0 h-full overflow-hidden flex" style={{width:'420px'}}>
          <CartPanel onRefund={() => setShowRefund(true)} onHold={() => setShowHold(true)} />

        </div>
      </div>

      {/* ── BOTTOM QUICK BUTTONS ── */}
      <div className="flex-shrink-0 px-3 py-2" style={{background:'#1F1F1F', borderTop:'1px solid #2A2A2A'}}>
        <div className="flex gap-2">
          {QUICK_BTNS.map(btn => (
            <button key={btn.id} onClick={btn.action}
              className="flex-1 rounded-lg py-2.5 flex flex-col items-center gap-1 cursor-pointer border transition-all active:scale-95"
              style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', minHeight:'52px'}}>
              <span className="text-[18px] leading-none">{btn.icon}</span>
              <span className="text-[10px] font-semibold leading-none" style={{color:'#cbd5e1'}}>{btn.label}</span>
            </button>
          ))}
          {Array(4).fill(0).map((_,i) => (
            <button key={`slot-${i}`}
              className="flex-1 rounded-lg py-2.5 flex flex-col items-center gap-1 opacity-20 cursor-not-allowed border"
              style={{background:'transparent', border:'1px dashed rgba(255,255,255,0.2)', minHeight:'52px'}}>
              <span className="text-[14px] text-slate-500 leading-none">+</span>
              <span className="text-[10px] text-slate-500 leading-none">Slot</span>
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
      {showRefund     && <RefundPanel
        preloadOrder={refundPreload}
        onClose={() => { setShowRefund(false); setRefundPreload(null) }} />}

    {showPoints && <PointsRedeemModal onClose={() => setShowPoints(false)}/>}

    {showGiftCard && <GiftCardPanel onClose={() => setShowGiftCard(false)}/>}

    {showOpenShift && <OpenShiftModal onClose={() => setShowOpenShift(false)}/>}

    {pinMode && (
      <PinKeypadModal mode={pinMode}
        onClose={() => setPinMode(null)}/>
    )}

    {override && (
      <ManagerOverrideModal
        permission={override.permission}
        action={override.action}
        onApprove={override.onApprove}
        onClose={() => setOverride(null)}/>
    )}

    {showCloseShift && (
      <CloseShiftFlow
        shift={currentShift}
        tenantId={tenant?.id}
        storeInfo={store}
        cashier={activeEmployee?.name || user?.name}
        terminalName={terminal?.name}
        onClose={() => setShowCloseShift(false)}
      />
    )}

    {showOpenItem && (
      <OpenItemModal
        tenantId={tenant?.id}
        onAdd={(item) => { useCartStore.getState().addProduct(item); setShowOpenItem(false) }}
        onClose={() => setShowOpenItem(false)}/>
    )}

    {editingProduct && (
      <ProductForm initial={editingProduct} tenantId={tenant?.id} storeId={store?.id}
        onSave={() => {
          qc.invalidateQueries({ queryKey:['pos-products'] })
          setEditingProduct(null)
          toast.success('✓ Product saved')
        }}
        onClose={() => setEditingProduct(null)}/>
    )}

    {photoViewProduct && (
      <PhotoViewer product={photoViewProduct}
        onClose={() => setPhotoViewProduct(null)}/>
    )}

    {/* Quick Info preview — read-only product view. Tapping Edit triggers
        the permission flow and opens the full ProductForm. */}
    {quickInfoProduct && (
      <ProductQuickInfo
        product={quickInfoProduct}
        storeId={store?.id}
        canEdit={can('inventory.products') !== 'deny'}
        canSeeCost={can('inventory.products') !== 'deny'}
        onClose={() => setQuickInfoProduct(null)}
        onEdit={(product) => {
          const v = can('inventory.products')
          if (v === 'allow') {
            setQuickInfoProduct(null)
            setEditingProduct(product)
            return
          }
          if (v === 'prompt') {
            setOverride({
              permission:'inventory.products',
              action:`edit "${product.name}"`,
              onApprove: (approver) => {
                toast.success(`✓ Approved by ${approver.name}`)
                logOverride({
                  tenantId: tenant?.id,
                  permission:'inventory.products',
                  actionLabel:`edit product ${product.name} from POS`,
                  requestedBy: activeEmployee
                    ? { id: activeEmployee.id, name: activeEmployee.name }
                    : { id: user?.id, name: user?.name },
                  approver,
                  notes: `Product ${product.id}`,
                })
                setQuickInfoProduct(null)
                setEditingProduct(product)
              },
            })
            return
          }
          // Deny — toast + close
          toast.error('You do not have permission to edit products')
        }}/>
    )}
    </div>
  )
}
