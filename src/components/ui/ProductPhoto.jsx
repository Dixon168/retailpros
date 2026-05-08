// src/components/ui/ProductPhoto.jsx
// 统一产品图片组件 — 有图显示图，无图显示灰色占位

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
      className={`${sz} rounded-[8px] bg-[#1a2236] border border-[#1e2d42] flex items-center justify-center overflow-hidden flex-shrink-0 ${onClick ? 'cursor-pointer hover:border-blue-500/40 transition-colors' : ''} ${className}`}>
      {imageUrl
        ? <img src={imageUrl} alt={name} className="w-full h-full object-cover"/>
        : <span className="font-bold text-[#3d5068]">{initials}</span>
      }
    </div>
  )
}

// Large photo viewer overlay
export function PhotoViewer({ product, onClose }) {
  if (!product) return null
  const qty = product.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const avgCost = product.inventory?.[0]?.avg_cost || product.cost || 0
  const margin = product.price > 0 ? ((product.price - avgCost) / product.price * 100).toFixed(1) : 0

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-6"
      onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl overflow-hidden max-w-[480px] w-full"
        onClick={e => e.stopPropagation()}>

        {/* Photo */}
        <div className="w-full aspect-square bg-[#111827] flex items-center justify-center overflow-hidden relative">
          {product.image_url
            ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain"/>
            : (
              <div className="flex flex-col items-center justify-center text-[#3d5068]">
                <div className="text-[64px] font-bold opacity-20">{product.name?.substring(0,2).toUpperCase()}</div>
                <div className="text-[12px] mt-2">No photo</div>
              </div>
            )
          }
          <button onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 bg-black/40 border border-[#243347] rounded-full flex items-center justify-center text-[#8899b0] hover:text-white cursor-pointer border-none">
            ✕
          </button>
        </div>

        {/* Product info */}
        <div className="p-4">
          <div className="text-[17px] font-bold mb-1">{product.name}</div>
          {product.description && (
            <div className="text-[12px] text-[#8899b0] mb-3">{product.description}</div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Price',    `$${parseFloat(product.price||0).toFixed(2)}`, 'text-blue-400'],
              ['Cost',     `$${parseFloat(avgCost).toFixed(2)}`,          'text-[#8899b0]'],
              ['Margin',   `${margin}%`,                                   parseFloat(margin)>=30?'text-green-400':parseFloat(margin)>=10?'text-yellow-400':'text-red-400'],
              ['On Hand',  product.type==='service' ? '—' : `${qty} ${product.unit||'ea'}`, qty<=5&&product.type!=='service'?'text-red-400':'text-[#e8edf5]'],
              ['SKU',      product.sku||'—',                               'text-[#8899b0]'],
              ['Type',     product.type?.toUpperCase(),                    'text-[#8899b0]'],
            ].map(([l,v,c]) => (
              <div key={l} className="bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2">
                <div className="text-[9px] font-mono text-[#3d5068] uppercase mb-0.5">{l}</div>
                <div className={`text-[13px] font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
