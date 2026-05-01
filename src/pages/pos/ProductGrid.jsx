// src/pages/pos/ProductGrid.jsx
import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { PhotoViewer } from '@/components/ui/ProductPhoto'

const TYPE_BADGE = {
  weight:     { bg: '#dcfce7', color: '#16a34a', label: 'LB' },
  serialized: { bg: '#fef9c3', color: '#ca8a04', label: 'SN' },
  service:    { bg: '#ede9fe', color: '#7c3aed', label: 'SVC' },
}

export default function ProductGrid({ products }) {
  const { addProduct } = useCartStore()
  const [photoViewer, setPhotoViewer] = useState(null)

  if (products.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-slate-400">
          <div className="text-[40px] mb-2 opacity-30">📦</div>
          <div className="text-[13px]">No products found</div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 pb-3"
        style={{scrollbarWidth:'thin', scrollbarColor:'#cbd5e1 transparent'}}>
        <div className="grid gap-2" style={{ gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))' }}>
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
  const badge  = TYPE_BADGE[product.type]
  const qty    = product.inventory?.reduce((a,i) => a+(i.quantity||0), 0) ?? null
  const isLow  = qty !== null && qty <= (product.low_stock_qty || 5) && product.type !== 'service'

  const formatPrice = () =>
    product.type === 'weight'
      ? `$${product.price.toFixed(2)}/${product.unit||'lb'}`
      : `$${product.price.toFixed(2)}`

  return (
    <div className="rounded-xl overflow-hidden transition-all duration-150 cursor-pointer group"
      style={{background:'#fff', border:'1.5px solid #e2e8f0', boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}
      onMouseEnter={e => e.currentTarget.style.borderColor='#6366f1'}
      onMouseLeave={e => e.currentTarget.style.borderColor='#e2e8f0'}>

      {/* Photo */}
      <div className="relative w-full overflow-hidden flex items-center justify-center"
        style={{height:'80px', background:'#f8fafc'}}
        onClick={onPhotoClick}>
        {badge && (
          <div className="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded text-[8px] font-bold"
            style={{background: badge.bg, color: badge.color}}>
            {badge.label}
          </div>
        )}
        {isLow && (
          <div className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[8px] font-bold"
            style={{background:'#fee2e2', color:'#dc2626'}}>
            LOW
          </div>
        )}
        {product.image_url
          ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover"/>
          : (
            <div className="flex items-center justify-center w-full h-full">
              <span className="text-[22px] font-bold" style={{color:'#94a3b8'}}>
                {product.name?.substring(0,2).toUpperCase()}
              </span>
            </div>
          )
        }
      </div>

      {/* Info */}
      <div onClick={onAdd} className="p-2">
        <div className="text-[12px] font-semibold leading-tight mb-1 line-clamp-2"
          style={{color:'#1e293b'}}>
          {product.name}
        </div>
        <div className="text-[13px] font-bold"
          style={{color: product.type==='weight' ? '#16a34a' : '#4f46e5'}}>
          {formatPrice()}
        </div>
        {product.type !== 'service' && qty !== null && (
          <div className="text-[10px] mt-0.5 font-medium"
            style={{color: isLow ? '#dc2626' : '#94a3b8'}}>
            {isLow ? '⚠ ' : ''}{qty} {product.unit||'ea'}
          </div>
        )}
      </div>
    </div>
  )
}
