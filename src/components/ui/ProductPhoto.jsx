// src/components/ui/ProductPhoto.jsx
// 统一产品图片组件 — 有图显示图，无图显示灰色占位
import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import toast from 'react-hot-toast'

export function ProductPhoto({ imageUrl, name, size = 'md', className = '', onClick }) {
  const sizes = {
    xs:  'w-7 h-7 text-[10px]',
    sm:  'w-9 h-9 text-[11px]',
    md:  'w-10 h-10 text-[12px]',
    lg:  'w-16 h-16 text-[14px]',
    xl:  'w-24 h-24 text-[16px]',
    '2xl': 'w-32 h-32 text-[18px]',
  }
  const sz = sizes[size] || sizes.md
  const initials = name ? name.substring(0,2).toUpperCase() : '?'

  return (
    <div
      onClick={onClick}
      className={`${sz} rounded-[8px] bg-[#F5F5F5] border border-[#E5E5E5] flex items-center justify-center overflow-hidden flex-shrink-0 ${onClick ? 'cursor-pointer hover:border-blue-500/40 transition-colors' : ''} ${className}`}>
      {imageUrl
        ? <img src={imageUrl} alt={name} className="w-full h-full object-cover"/>
        : <span className="font-bold text-[#999999]">{initials}</span>
      }
    </div>
  )
}

// Large photo viewer overlay — now with qty stepper + Add to Cart
export function PhotoViewer({ product, onClose }) {
  if (!product) return null
  const { addProduct } = useCartStore()
  const [qty, setQty] = useState(1)
  const [showQtyPad, setShowQtyPad] = useState(false)

  const totalStock = product.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const avgCost = product.inventory?.[0]?.avg_cost || product.cost || 0
  const margin  = product.price > 0 ? ((product.price - avgCost) / product.price * 100).toFixed(1) : 0
  const isService = product.type === 'service'
  const isWeight  = product.type === 'weight'
  const tracksStock = !isService && !isWeight

  const handleAdd = () => {
    // For weight/serialized/prompt_price products, addProduct opens its own modal
    // and ignores the qty stepper — that's the right behavior. For regular items,
    // call addProduct qty times.
    if (isWeight || product.type === 'serialized' || product.prompt_weight || product.prompt_price) {
      addProduct(product)
      onClose()
      return
    }
    for (let i = 0; i < qty; i++) addProduct(product)
    toast.success(`Added ${qty} × ${product.name}`)
    onClose()
  }

  const dec = () => setQty(q => Math.max(1, q - 1))
  const inc = () => setQty(q => q + 1)

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-6"
      onClick={onClose}>
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden max-w-[480px] w-full flex flex-col"
        style={{maxHeight:'90vh'}}
        onClick={e => e.stopPropagation()}>

        {/* Photo */}
        <div className="w-full aspect-square bg-[#F5F5F5] flex items-center justify-center overflow-hidden relative flex-shrink-0"
          style={{maxHeight:'260px'}}>
          {product.image_url
            ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain"/>
            : (
              <div className="flex flex-col items-center justify-center text-[#999999]">
                <div className="text-[64px] font-bold opacity-20">{product.name?.substring(0,2).toUpperCase()}</div>
                <div className="text-[12px] mt-2">No photo</div>
              </div>
            )
          }
          <button onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 bg-black/40 rounded-full flex items-center justify-center text-white cursor-pointer border-none text-[14px] hover:bg-black/60">
            ✕
          </button>
        </div>

        {/* Product info — scroll if needed */}
        <div className="p-4 overflow-y-auto flex-1">
          <div className="text-[17px] font-bold mb-1">{product.name}</div>
          {product.description && (
            <div className="text-[12px] text-[#666666] mb-3">{product.description}</div>
          )}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              ['Price',    `$${parseFloat(product.price||0).toFixed(2)}`, 'text-[#006AFF]'],
              ['Cost',     `$${parseFloat(avgCost).toFixed(2)}`,          'text-[#666666]'],
              ['Margin',   `${margin}%`,                                   parseFloat(margin)>=30?'text-[#00B23B]':parseFloat(margin)>=10?'text-[#FA8C16]':'text-[#CF1322]'],
              ['On Hand',  isService ? '—' : `${totalStock} ${product.unit||'ea'}`, totalStock<=5&&!isService?'text-[#CF1322]':'text-[#1F1F1F]'],
              ['SKU',      product.sku||'—',                               'text-[#666666]'],
              ['Type',     product.type?.toUpperCase() || 'STD',          'text-[#666666]'],
            ].map(([l,v,c]) => (
              <div key={l} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2">
                <div className="text-[9px] font-mono text-[#999999] uppercase mb-0.5">{l}</div>
                <div className={`text-[13px] font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          {/* Points info */}
          {product.points_redeem && product.redeem_points_required > 0 && (
            <div className="rounded-lg px-3 py-2 mb-3 inline-flex items-center gap-1.5 text-[12px] font-bold"
              style={{background:'#FEF3C7', color:'#B45309', border:'1px solid #FCD34D'}}>
              <span>⭐</span>
              <span>Redeemable for {product.redeem_points_required} pts each</span>
            </div>
          )}
        </div>

        {/* ── ACTION BAR: qty stepper + Add to Cart ── */}
        <div className="px-4 py-3 flex items-center gap-3 flex-shrink-0"
          style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          {!isWeight && !isService && (
            <div className="flex items-center rounded-lg overflow-hidden"
              style={{background:'#FFFFFF', border:'1.5px solid #E5E5E5'}}>
              <button onClick={dec}
                className="w-12 h-12 flex items-center justify-center text-[22px] font-bold cursor-pointer border-none active:scale-90 transition-transform"
                style={{background:'#FFFFFF', color: qty <= 1 ? '#CCC' : '#1F1F1F'}}
                disabled={qty <= 1}>
                −
              </button>
              <div
                onClick={()=>setShowQtyPad(true)}
                className="w-14 h-12 flex items-center justify-center text-[18px] font-bold cursor-pointer select-none"
                style={{color:'#1F1F1F'}}
                title="Tap to enter quantity">
                {qty}
              </div>
              <button onClick={inc}
                className="w-12 h-12 flex items-center justify-center text-[22px] font-bold cursor-pointer border-none active:scale-90 transition-transform"
                style={{background:'#FFFFFF', color:'#1F1F1F'}}>
                +
              </button>
            </div>
          )}
          <button onClick={handleAdd}
            className="flex-1 rounded-lg py-3.5 text-[14px] font-bold cursor-pointer border-none active:scale-[0.97] transition-transform"
            style={{background:'#006AFF', color:'#FFFFFF', minHeight:'48px'}}>
            {isWeight ? '⚖️ Add (enter weight)' :
             product.type === 'serialized' ? '🔢 Add (enter serial)' :
             product.prompt_price ? '💲 Add (enter price)' :
             `+ Add ${qty > 1 ? `${qty} ` : ''}to Cart · $${(product.price * qty).toFixed(2)}`}
          </button>
        </div>
      </div>

      {/* Inline numpad to enter qty directly (no soft keyboard) */}
      {showQtyPad && (
        <QtyNumPad initial={qty} onConfirm={(v)=>{ setQty(v); setShowQtyPad(false) }} onClose={()=>setShowQtyPad(false)}/>
      )}
    </div>
  )
}

function QtyNumPad({ initial, onConfirm, onClose }) {
  const [input, setInput] = useState(String(initial || ''))
  const press = (k) => {
    if (k === '⌫') return setInput(i => i.slice(0, -1))
    if (input.length >= 4) return
    setInput(i => (i === '0' ? k : i + k))
  }
  const apply = () => {
    const v = parseInt(input)
    if (!v || v < 1) return onClose()
    onConfirm(v)
  }
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{background:'rgba(0,0,0,0.45)', backdropFilter:'blur(2px)'}}
      onClick={onClose}>
      <div className="rounded-2xl overflow-hidden shadow-xl" style={{width:'320px', background:'#fff'}}
        onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-3 flex items-center justify-between" style={{background:'#1F1F1F'}}>
          <div className="text-[15px] font-bold text-white">Enter Quantity</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[16px] flex items-center justify-center">✕</button>
        </div>
        <div className="px-5 py-4">
          <div className="rounded-lg py-4 text-center font-mono font-bold text-[36px]"
            style={{background:'#E6F0FF', border:'2px solid #80B2FF', color:'#006AFF'}}>
            {input || '0'}
          </div>
        </div>
        <div className="px-4 pb-4 grid grid-cols-3 gap-2">
          {['7','8','9','4','5','6','1','2','3','00','0','⌫'].map(k=>(
            <button key={k} onClick={()=>press(k)}
              className="rounded-xl py-4 text-[20px] font-bold cursor-pointer border-2 active:scale-95"
              style={k==='⌫'?{background:'#fff1f2',borderColor:'#fecdd3',color:'#ef4444'}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#1F1F1F'}}>
              {k}
            </button>
          ))}
          <button onClick={apply}
            disabled={!input || parseInt(input) < 1}
            className="col-span-3 rounded-xl py-3.5 text-[15px] font-bold text-white cursor-pointer border-none disabled:opacity-40 mt-1"
            style={{background:'#000000'}}>
            ✓ Set Qty {input ? `to ${input}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
