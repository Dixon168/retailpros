// src/pages/pos/ProductGrid.jsx
import { useState, useRef, useEffect } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { PhotoViewer } from '@/components/ui/ProductPhoto'

const TYPE_BADGE = {
  weight:     { bg: '#dcfce7', color: '#16a34a', label: 'LB' },
  serialized: { bg: '#fef9c3', color: '#ca8a04', label: 'SN' },
  service:    { bg: '#ede9fe', color: '#006AFF', label: 'SVC' },
}

export default function ProductGrid({ products, highlightId, onPhotoClick }) {
  const { addProduct } = useCartStore()
  const [photoViewer, setPhotoViewer] = useState(null)
  const cardRefs = useRef({})  // { [productId]: HTMLElement }

  // If parent passes onPhotoClick, that overrides the default zoom behavior.
  // Otherwise fall back to the built-in PhotoViewer modal (zoom).
  const handlePhotoClick = (product) => {
    if (onPhotoClick) onPhotoClick(product)
    else setPhotoViewer(product)
  }

  // When highlightId changes, scroll the matched card into view.
  // We also re-run on products change so the scroll succeeds even if the
  // grid is being repopulated (e.g. after a category auto-switch).
  useEffect(() => {
    if (!highlightId) return
    // Try a few times in case the ref isn't attached yet (grid still rendering)
    let tries = 0
    const tick = () => {
      const el = cardRefs.current[highlightId]
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else if (tries++ < 8) {
        setTimeout(tick, 60)
      }
    }
    tick()
  }, [highlightId, products])

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
              highlighted={highlightId === product.id}
              cardRef={el => { cardRefs.current[product.id] = el }}
              onAdd={() => addProduct(product)}
              onPhotoClick={() => handlePhotoClick(product)}
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

function ProductCard({ product, onAdd, onPhotoClick, highlighted, cardRef }) {
  const badge  = TYPE_BADGE[product.type]
  const qty    = product.inventory?.reduce((a,i) => a+(i.quantity||0), 0) ?? null
  const lowThreshold = product.low_stock_qty || 5
  const isService = product.type === 'service'
  const isWeight  = product.type === 'weight'
  const tracksStock = !isService && !isWeight && qty !== null

  // Stock state: 'out' / 'low' / 'ok' / 'untracked'
  const stockState = !tracksStock ? 'untracked'
                   : qty <= 0 ? 'out'
                   : qty <= lowThreshold ? 'low'
                   : 'ok'

  const stockBadge = {
    out:  { bg:'#FEE2E2', color:'#CF1322', label: qty < 0 ? `${qty}` : 'OUT', dot:'#CF1322' },
    low:  { bg:'#FEF3C7', color:'#B45309', label:`Only ${qty}`, dot:'#F59E0B' },
    ok:   { bg:'#DCFCE7', color:'#15803D', label:String(qty), dot:'#15803D' },
    untracked: null,
  }[stockState]

  // Check active promotion (client-side, using local time)
  const getActivePrice = () => {
    const promos = product.promotions || []
    const now = new Date()
    let best = product.price

    for (const p of promos) {
      if (!p.is_active) continue
      if (p.type === 'sale' && p.sale_start && p.sale_end) {
        if (now >= new Date(p.sale_start) && now <= new Date(p.sale_end)) {
          const calc = p.sale_type === 'pct'
            ? product.price * (1 - p.sale_value/100)
            : p.sale_value
          if (calc < best) best = calc
        }
      }
      if (p.type === 'time' && p.time_rules) {
        for (const r of p.time_rules) {
          const dow = now.getDay()
          const t   = now.toTimeString().slice(0,5)
          if ((r.days||[]).includes(dow) && t >= r.start_time && t <= r.end_time) {
            const calc = r.type === 'pct'
              ? product.price * (1 - r.value/100)
              : r.value
            if (calc < best) best = calc
          }
        }
      }
    }
    return best
  }

  const activePrice = getActivePrice()
  const onPromo     = activePrice < product.price

  const formatPrice = () => {
    const p = onPromo ? activePrice : product.price
    return product.type === 'weight'
      ? `$${p.toFixed(2)}/${product.unit||'lb'}`
      : `$${p.toFixed(2)}`
  }

  return (
    <div ref={cardRef}
      className="rounded-xl overflow-hidden transition-all duration-300 cursor-pointer group relative"
      style={{
        background:'#fff',
        border: highlighted ? '3px solid #006AFF' : '1.5px solid #e2e8f0',
        boxShadow: highlighted
          ? '0 0 0 4px rgba(0,106,255,0.18), 0 4px 12px rgba(0,106,255,0.3)'
          : '0 1px 3px rgba(0,0,0,0.06)',
        transform: highlighted ? 'scale(1.04)' : 'scale(1)',
        zIndex: highlighted ? 5 : 1,
      }}
      onMouseEnter={e => !highlighted && (e.currentTarget.style.borderColor='#006AFF')}
      onMouseLeave={e => !highlighted && (e.currentTarget.style.borderColor='#e2e8f0')}>

      {/* Scan flash overlay — fades out */}
      {highlighted && (
        <div className="absolute inset-0 pointer-events-none rounded-xl z-20"
          style={{
            background:'radial-gradient(circle, rgba(0,106,255,0.18) 0%, transparent 70%)',
            animation:'scanflash 1.4s ease-out',
          }}/>
      )}
      {highlighted && (
        <div className="absolute -top-1 -right-1 z-30 px-2 py-0.5 rounded-full text-[9px] font-bold text-white"
          style={{background:'#006AFF', boxShadow:'0 2px 6px rgba(0,106,255,0.5)'}}>
          📷 Scanned
        </div>
      )}

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
        {/* Stock badge — top-left of photo */}
        {stockBadge && (
          <div className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1"
            style={{background: stockBadge.bg, color: stockBadge.color}}>
            <span className="w-1.5 h-1.5 rounded-full" style={{background: stockBadge.dot}}/>
            {stockBadge.label}
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
          style={{color:'#1F1F1F'}}>
          {product.name}
        </div>
        <div>
          {onPromo && (
            <div className="text-[10px] line-through text-slate-400 font-mono">
              ${product.price.toFixed(2)}
            </div>
          )}
          <div className="text-[13px] font-bold"
            style={{color: onPromo ? '#dc2626' : isWeight ? '#16a34a' : '#4f46e5'}}>
            {formatPrice()}
            {onPromo && <span className="ml-1 text-[9px] px-1 py-0.5 rounded" style={{background:'#fee2e2',color:'#dc2626'}}>SALE</span>}
          </div>
          {product.points_redeem && product.redeem_points_required > 0 && (
            <div className="mt-1 text-[9px] font-bold inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded"
              style={{background:'#FEF3C7', color:'#B45309'}}>
              <span>⭐</span>
              <span>{product.redeem_points_required} pts</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
