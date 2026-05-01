// src/pages/pos/ProductGrid.jsx
import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { ProductPhoto, PhotoViewer } from '@/components/ui/ProductPhoto'

const TYPE_BADGE = {
  weight:     { bg: 'rgba(16,185,129,0.15)', color: '#10b981', label: 'LB' },
  serialized: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: 'SN' },
  service:    { bg: 'rgba(139,92,246,0.15)', color: '#8b5cf6', label: 'SVC' },
}

export default function ProductGrid({ products }) {
  const { addProduct } = useCartStore()
  const [photoViewer, setPhotoViewer] = useState(null)

  if (products.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-[#3d5068]">
          <div className="text-[13px]">No products found</div>
        </div>
      </div>
    )
  }

  return (
    <>
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
              onPhotoClick={() => setPhotoViewer(product)}
            />
          ))}
        </div>
      </div>
      {photoViewer && (
        <PhotoViewer product={photoViewer} onClose={() => setPhotoViewer(null)}/>
      )}
    </>
  )
}

function ProductCard({ product, onAdd, onPhotoClick }) {
  const badge = TYPE_BADGE[product.type]
  const qty   = product.inventory?.reduce((a,i) => a+(i.quantity||0), 0) ?? null
  const isLow = qty !== null && qty <= (product.low_stock_qty || 5) && product.type !== 'service'

  const formatPrice = () => {
    if (product.type === 'weight') return `$${product.price.toFixed(2)}/${product.unit||'lb'}`
    return `$${product.price.toFixed(2)}`
  }

  return (
    <div className="relative bg-[#111827] border border-[#1e2d42] rounded-[10px]
      overflow-hidden transition-all duration-150
      hover:border-blue-500/40 hover:bg-[#1a2236] cursor-pointer">

      {/* Type badge */}
      {badge && (
        <div className="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded text-[8px]
          font-mono font-bold" style={{ background: badge.bg, color: badge.color }}>
          {badge.label}
        </div>
      )}

      {/* Low stock badge */}
      {isLow && (
        <div className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[8px]
          font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/30">
          LOW
        </div>
      )}

      {/* Product photo — click to enlarge */}
      <div
        onClick={onPhotoClick}
        className="w-full h-[80px] bg-[#1e2d42] flex items-center justify-center
          cursor-pointer hover:opacity-90 transition-opacity overflow-hidden">
        {product.image_url
          ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover"/>
          : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-[22px] font-bold text-[#3d5068]">
                {product.name?.substring(0,2).toUpperCase()}
              </span>
            </div>
          )
        }
      </div>

      {/* Info + Add button */}
      <button
        onClick={onAdd}
        className="w-full p-2.5 text-left cursor-pointer bg-transparent border-none
          active:scale-[0.98] transition-transform">
        <div className="text-[12px] font-semibold text-white leading-tight mb-1 line-clamp-2">
          {product.name}
        </div>
        <div className={`text-[13px] font-bold ${
          product.type === 'weight' ? 'text-green-400' : 'text-blue-400'
        }`}>
          {formatPrice()}
        </div>
        {/* Stock qty */}
        {product.type !== 'service' && qty !== null && (
          <div className={`text-[9px] font-mono mt-0.5 ${isLow ? 'text-red-400' : 'text-[#3d5068]'}`}>
            {isLow ? '⚠ ' : ''}{qty} {product.unit||'ea'}
          </div>
        )}
      </button>
    </div>
  )
}
