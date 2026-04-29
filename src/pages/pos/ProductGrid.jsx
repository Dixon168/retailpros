// src/pages/pos/ProductGrid.jsx
// 商品网格 - 支持件装/称重/序列号三种类型

import { useCartStore } from '@/stores/cartStore'

// 商品类型图标映射
const TYPE_ICONS = {
  unit: null,
  weight: '⚖️',
  serialized: '🔢',
  service: '🔧',
}

// 商品类型徽章样式
const TYPE_BADGE = {
  unit: null,
  weight: { bg: 'rgba(16,185,129,0.15)', color: '#10b981', label: 'LB' },
  serialized: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: 'SN' },
  service: { bg: 'rgba(139,92,246,0.15)', color: '#8b5cf6', label: 'SVC' },
}

export default function ProductGrid({ products }) {
  const { addProduct } = useCartStore()

  if (products.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-[#3d5068]">
          <div className="text-4xl mb-3 opacity-30">📦</div>
          <div className="text-sm">No products found</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-3.5 scrollbar-thin
      scrollbar-thumb-[#1e2d42] scrollbar-track-transparent">
      <div className="grid gap-2" style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))'
      }}>
        {products.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            onAdd={() => addProduct(product)}
          />
        ))}
      </div>
    </div>
  )
}

function ProductCard({ product, onAdd }) {
  const badge = TYPE_BADGE[product.type]

  const formatPrice = () => {
    if (product.type === 'weight') return `$${product.price.toFixed(2)}/${product.unit || 'lb'}`
    return `$${product.price.toFixed(2)}`
  }

  return (
    <button
      onClick={onAdd}
      className="relative bg-[#0d1117] border border-[#1e2d42] rounded-[10px] p-3
        text-left cursor-pointer transition-all duration-150 group
        hover:border-blue-500/30 hover:bg-[#111827] hover:-translate-y-px
        active:scale-[0.97]"
    >
      {/* 类型徽章 */}
      {badge && (
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[8px]
          font-mono font-bold"
          style={{ background: badge.bg, color: badge.color }}>
          {badge.label}
        </div>
      )}

      {/* 商品图片/表情 */}
      <div className="w-full h-[68px] rounded-lg bg-[#1a2236] flex items-center
        justify-center text-[28px] mb-2">
        {product.image_url
          ? <img src={product.image_url} alt={product.name}
              className="w-full h-full object-cover rounded-lg" />
          : <span>{getProductEmoji(product)}</span>
        }
      </div>

      {/* 商品名 */}
      <div className="text-[11px] font-semibold text-[#e8edf5] leading-tight mb-1
        line-clamp-2">
        {product.name}
      </div>

      {/* 价格 */}
      <div className={`text-[13px] font-bold ${
        product.type === 'weight' ? 'text-green-400' : 'text-blue-400'
      }`}>
        {formatPrice()}
      </div>

      {/* SKU */}
      {product.sku && (
        <div className="text-[9px] font-mono text-[#3d5068] mt-0.5">{product.sku}</div>
      )}
    </button>
  )
}

// 根据分类返回表情符号（可以从数据库的categories.icon读取）
function getProductEmoji(product) {
  const name = product.name?.toLowerCase() || ''
  if (name.includes('iphone') || name.includes('phone')) return '📱'
  if (name.includes('macbook') || name.includes('laptop')) return '💻'
  if (name.includes('airpods')) return '🎧'
  if (name.includes('apple')) return '🍎'
  if (name.includes('banana')) return '🍌'
  if (name.includes('grape')) return '🍇'
  if (name.includes('milk')) return '🥛'
  if (name.includes('bread')) return '🍞'
  if (name.includes('cola') || name.includes('drink')) return '🥤'
  if (product.type === 'service') return '🔧'
  return '📦'
}
