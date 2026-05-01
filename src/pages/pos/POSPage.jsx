// src/pages/pos/POSPage.jsx
// POS 收银主界面
// 原则：所有操作不离开本页面，通过弹层完成

import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import CartPanel from './CartPanel'
import ProductGrid from './ProductGrid'
import SerialPanel from './panels/SerialPanel'
import WeightPanel from './panels/WeightPanel'
import PricePanel from './panels/PricePanel'
import CustomerPanel from './panels/CustomerPanel'
import DiscountPanel from './panels/DiscountPanel'
import PaymentPanel from './panels/PaymentPanel'

export default function POSPage() {
  const { user, tenant, store } = useAuthStore()
  const { loadTaxGroups, showSnPanel, showWtPanel, showPricePanel, showCustPanel, showDiscPanel, showPayPanel } = useCartStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')

  // 加载税率（门店配置）
  useEffect(() => {
    if (tenant?.id) loadTaxGroups(tenant.id)
  }, [tenant?.id])

  // 加载商品分类
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('sort_order')
      return data || []
    },
    enabled: !!tenant?.id
  })

  // 加载商品（支持搜索和分类过滤）
  const { data: products = [] } = useQuery({
    queryKey: ['pos-products', tenant?.id, searchQuery, activeCategory],
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true).neq('is_enabled', false)

      if (searchQuery) {
        q = q.or(`name.ilike.%${searchQuery}%,sku.ilike.%${searchQuery}%,barcode.eq.${searchQuery}`)
      }
      if (activeCategory !== 'all') {
        q = q.eq('category_id', activeCategory)
      }

      const { data } = await q.order('name').limit(60)
      return data || []
    },
    enabled: !!tenant?.id
  })

  // 扫码枪输入处理
  const handleBarcodeInput = useCallback((e) => {
    if (e.key === 'Enter' && searchQuery.length > 3) {
      // 检查是否匹配条码
      const match = products.find(p => p.barcode === searchQuery)
      if (match) {
        useCartStore.getState().addProduct(match)
        setSearchQuery('')
      }
    }
  }, [searchQuery, products])

  return (
    <div className="flex h-full bg-[#07090f] overflow-hidden">

      {/* ── 左侧：商品区 ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* 搜索栏 */}
        <div className="px-3.5 py-3 border-b border-[#1e2d42]">
          <div className="flex items-center gap-2 bg-[#0d1117] border border-[#1e2d42]
            rounded-[10px] px-3 focus-within:border-blue-500/40 transition-colors">
            <span className="text-[#3d5068] text-sm">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleBarcodeInput}
              placeholder="Search products or scan barcode..."
              className="flex-1 bg-transparent border-none outline-none text-[#e8edf5]
                text-[13px] py-2.5 font-sans placeholder-[#3d5068]"
              autoFocus
            />
            <button className="bg-blue-500/10 border border-blue-500/20 text-blue-400
              rounded-md px-2 py-1 text-[10px] font-mono hover:bg-blue-500/20 transition-colors">
              ⊡ SCAN
            </button>
          </div>
        </div>

        {/* 分类标签 */}
        <div className="flex gap-1.5 px-3.5 py-2.5 border-b border-[#1e2d42] overflow-x-auto
          scrollbar-none flex-shrink-0">
          <CategoryButton
            label="All"
            color="#3b82f6"
            active={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
          />
          {categories.map(cat => (
            <CategoryButton
              key={cat.id}
              label={cat.name}
              color={cat.color || '#6366f1'}
              active={activeCategory === cat.id}
              onClick={() => setActiveCategory(cat.id)}
            />
          ))}
        </div>

        {/* 商品网格 */}
        <ProductGrid products={products} />
      </div>

      {/* ── 右侧：购物车 ── */}
      <CartPanel />

      {/* ── 弹层面板（不离开页面）── */}
      {showSnPanel && <SerialPanel />}
      {showWtPanel && <WeightPanel />}
      {showPricePanel && <PricePanel />}
      {showCustPanel && <CustomerPanel />}
      {showDiscPanel && <DiscountPanel />}
      {showPayPanel && <PaymentPanel />}
    </div>
  )
}

// 分类按钮组件
function CategoryButton({ label, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px]
        whitespace-nowrap flex-shrink-0 transition-all duration-150 ${
        active
          ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
          : 'border-[#1e2d42] bg-[#111827] text-[#8899b0] hover:text-white hover:bg-[#1a2236]'
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: color }} />
      {label}
    </button>
  )
}
