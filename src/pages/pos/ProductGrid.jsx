// src/pages/pos/ProductGrid.jsx
import { useState, useRef, useEffect } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { supabase } from '@/lib/supabase'
import { PhotoViewer } from '@/components/ui/ProductPhoto'
import toast from 'react-hot-toast'

const TYPE_BADGE = {
  weight:     { bg: '#d1fae5', color: '#16a34a', label: 'LB' },
  serialized: { bg: '#fef9c3', color: '#ca8a04', label: 'SN' },
  service:    { bg: '#ede9fe', color: '#5E6AD2', label: 'SVC' },
}

export default function ProductGrid({ products, highlightId, onPhotoClick, searchQuery, tenantId, onWalkinAdded }) {
  const { addProduct } = useCartStore()
  const [photoViewer, setPhotoViewer] = useState(null)
  const [walkinPrice, setWalkinPrice] = useState('')
  const [walkinSaving, setWalkinSaving] = useState(false)
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

  // ── Walk-in item creation ───────────────────────────────────────
  // Cashier searches / scans and gets no match. Instead of a dead-end
  // "no products found", let them ring it up right here: they type a
  // price, we create a bare product on the fly (name = whatever they
  // typed, or "Walk-in item" if empty) and add it to the cart. Product
  // stays in the catalog so the same barcode / SKU will find it next
  // time. Big round-trip killer — no need to close POS, go to Products,
  // create the item, come back, re-scan.
  const createWalkin = async () => {
    const price = parseFloat(walkinPrice)
    if (!price || price <= 0) {
      toast.error('Enter a price first')
      return
    }
    if (!tenantId) { toast.error('Tenant not loaded'); return }
    setWalkinSaving(true)
    try {
      // Reasonable defaults; the merchant can edit later in Products
      const term = (searchQuery || '').trim()
      // If they scanned a barcode / SKU (numeric-ish), use it as UPC and give
      // the item a generic name; otherwise use what they typed as the name.
      const looksLikeBarcode = /^[0-9]{6,}$/.test(term)
      const name  = term && !looksLikeBarcode ? term : `Walk-in item ($${price.toFixed(2)})`
      const upc   = looksLikeBarcode ? term : null
      const sku   = 'WI-' + Date.now().toString().slice(-6)

      const { data, error } = await supabase.from('products').insert({
        tenant_id:  tenantId,
        name,
        sku,
        upc,
        price,
        is_active:  true,
        is_enabled: true,
      }).select().single()
      if (error) throw error

      // Push into cart immediately so cashier can keep working
      addProduct({
        ...data,
        // Cart expects `inventory` shape even if we didn't seed a stock row
        inventory: [],
        promotions: [],
      })
      toast.success(`Added: ${name}`)
      setWalkinPrice('')
      onWalkinAdded && onWalkinAdded()
    } catch (e) {
      toast.error(e.message || 'Could not add walk-in item')
    } finally {
      setWalkinSaving(false)
    }
  }

  if (products.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md w-full">
          <div className="text-[40px] mb-2 opacity-30">📦</div>
          <div className="text-[14px] font-semibold text-slate-500 mb-1">
            {searchQuery ? `No product matches "${searchQuery}"` : 'No products found'}
          </div>
          {/* Walk-in creation — always shown when there's a search term
              since that's when the cashier hit a dead-end. */}
          {searchQuery && tenantId && (
            <>
              <div className="text-[12px] text-slate-400 mb-4">
                Ring it up as a walk-in item — we'll save it to your catalog.
              </div>
              <div className="rounded-lg p-4 mx-auto text-left"
                style={{background:'#eef0fc', border:'1px solid #dee2f8', maxWidth:'320px'}}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Price
                </div>
                <div className="flex gap-2">
                  <div className="flex items-center flex-1 rounded-md bg-white border border-slate-300 px-2.5"
                    style={{minWidth:0}}>
                    <span className="text-slate-400 font-mono">$</span>
                    <input type="number" inputMode="decimal" step="0.01" min="0"
                      value={walkinPrice} onChange={e => setWalkinPrice(e.target.value)}
                      autoFocus placeholder="0.00"
                      onKeyDown={e => { if (e.key === 'Enter') createWalkin() }}
                      className="flex-1 min-w-0 py-2 px-1 text-[15px] font-mono outline-none border-none bg-transparent"/>
                  </div>
                  <button onClick={createWalkin}
                    disabled={walkinSaving || !parseFloat(walkinPrice)}
                    className="rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer text-white border-none disabled:opacity-40"
                    style={{background:'#5E6AD2'}}>
                    {walkinSaving ? '…' : 'Add to cart'}
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-2">
                  Named "{searchQuery}" · saved with SKU auto-generated
                </div>
              </div>
            </>
          )}
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
    out:  { bg:'#FEE2E2', color:'#dc2626', label: qty < 0 ? `${qty}` : 'OUT', dot:'#dc2626' },
    low:  { bg:'#FEF3C7', color:'#B45309', label:`Only ${qty}`, dot:'#F59E0B' },
    ok:   { bg:'#d1fae5', color:'#059669', label:String(qty), dot:'#059669' },
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
        border: highlighted ? '3px solid #5E6AD2' : '1.5px solid #e2e8f0',
        boxShadow: highlighted
          ? '0 0 0 4px rgba(0,106,255,0.18), 0 4px 12px rgba(0,106,255,0.3)'
          : '0 1px 3px rgba(0,0,0,0.06)',
        transform: highlighted ? 'scale(1.04)' : 'scale(1)',
        zIndex: highlighted ? 5 : 1,
      }}
      onMouseEnter={e => !highlighted && (e.currentTarget.style.borderColor='#5E6AD2')}
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
          style={{background:'#5E6AD2', boxShadow:'0 2px 6px rgba(0,106,255,0.5)'}}>
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
