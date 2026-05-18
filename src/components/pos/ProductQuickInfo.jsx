// src/components/pos/ProductQuickInfo.jsx
// Read-only product preview that opens when the cashier taps a product
// photo on the POS. This is the "look but don't touch" step before the
// full ProductForm — keeps cashiers from accidentally editing a product
// when they just wanted to check the price, stock, or category.
//
// If the cashier really wants to edit, they tap the Edit button which
// triggers the same permission flow as the old direct-open behavior.

export function ProductQuickInfo({ product: p, storeId, canEdit = true, canSeeCost = false, onEdit, onClose }) {
  if (!p) return null

  // Compute stock for the current store. Inventory is already filtered
  // by store_id upstream in POS, but be defensive in case the prop is
  // passed an unfiltered product object.
  const stockRows = Array.isArray(p.inventory) ? p.inventory : []
  const stockHere = stockRows
    .filter(i => !storeId || !i.store_id || i.store_id === storeId)
    .reduce((sum, i) => sum + Number(i.quantity || 0), 0)

  const lowStock      = stockHere <= (p.low_stock_threshold || 5)
  const outOfStock    = stockHere <= 0
  const margin        = p.cost && p.price ? ((p.price - p.cost) / p.price * 100) : null
  const subcatName    = p.subcategories?.name || p.subcategory?.name || null
  const categoryName  = p.subcategories?.categories?.name || p.category?.name || null
  const categoryEmoji = p.subcategories?.categories?.emoji || ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{background:'rgba(15,23,42,0.6)', backdropFilter:'blur(2px)'}} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden shadow-2xl w-full"
        style={{maxWidth:'520px', background:'#fff', maxHeight:'92vh'}}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between flex-shrink-0"
          style={{borderBottom:'1.5px solid #e2e8f0'}}>
          <div className="flex items-center gap-2">
            <span className="text-[18px]">📋</span>
            <div className="text-[14px] font-bold text-slate-800">Product Info</div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 bg-transparent border-none cursor-pointer hover:bg-slate-100 transition-all">
            ✕
          </button>
        </div>

        {/* Body — scrollable if long */}
        <div className="overflow-y-auto" style={{maxHeight:'calc(92vh - 130px)'}}>
          <div className="p-5">

            {/* Photo + Name + Price row */}
            <div className="flex gap-4 mb-5">
              <div className="rounded-2xl overflow-hidden flex-shrink-0"
                style={{width:'120px', height:'120px', background:'#f1f5f9', border:'1.5px solid #e2e8f0'}}>
                {p.image_url
                  ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover"/>
                  : <div className="w-full h-full flex items-center justify-center text-slate-400">
                      <span className="text-[32px]">📦</span>
                    </div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[18px] font-bold leading-tight mb-1" style={{color:'#1F1F1F'}}>
                  {p.name}
                </div>
                {p.description && (
                  <div className="text-[11px] text-slate-500 line-clamp-2 mb-2">
                    {p.description}
                  </div>
                )}
                <div className="text-[28px] font-bold font-mono leading-none mb-1" style={{color:'#006AFF'}}>
                  ${Number(p.price || 0).toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                  per {p.unit || 'ea'}
                </div>
              </div>
            </div>

            {/* Codes (SKU + UPC) */}
            {(p.sku || p.upc) && (
              <div className="grid grid-cols-2 gap-2 mb-4">
                {p.sku && (
                  <div className="rounded-xl px-3 py-2" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                    <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wider">SKU</div>
                    <div className="text-[12px] font-mono font-semibold text-slate-700 truncate">{p.sku}</div>
                  </div>
                )}
                {p.upc && (
                  <div className="rounded-xl px-3 py-2" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                    <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wider">UPC / Barcode</div>
                    <div className="text-[12px] font-mono font-semibold text-slate-700 truncate">{p.upc}</div>
                  </div>
                )}
              </div>
            )}

            {/* Stock at current store */}
            <div className="rounded-xl px-4 py-3 mb-3 flex items-center justify-between"
              style={outOfStock
                ? {background:'#fef2f2', border:'1.5px solid #fecaca'}
                : lowStock
                  ? {background:'#fefce8', border:'1.5px solid #fde047'}
                  : {background:'#f0fdf4', border:'1.5px solid #86efac'}}>
              <div className="flex items-center gap-2">
                <span className="text-[18px]">
                  {outOfStock ? '🚫' : lowStock ? '⚠️' : '✅'}
                </span>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider"
                    style={{color: outOfStock ? '#991b1b' : lowStock ? '#854d0e' : '#166534'}}>
                    {p.track_inventory === false ? 'Service / Not Tracked' : 'Stock (this store)'}
                  </div>
                  <div className="text-[18px] font-black font-mono"
                    style={{color: outOfStock ? '#991b1b' : lowStock ? '#854d0e' : '#166534'}}>
                    {p.track_inventory === false ? '∞' : `${stockHere} ${p.unit || 'ea'}`}
                  </div>
                </div>
              </div>
              {p.low_stock_threshold && p.track_inventory !== false && (
                <div className="text-right">
                  <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wider">Reorder At</div>
                  <div className="text-[13px] font-mono font-bold text-slate-600">≤ {p.low_stock_threshold}</div>
                </div>
              )}
            </div>

            {/* Cost + margin (only if user can see cost) */}
            {canSeeCost && p.cost > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="rounded-xl px-3 py-2 text-center" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}
                  title="Catalog Cost — what you entered when adding the product. For real per-unit cost, see Avg Cost (from receives).">
                  <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wider">Catalog Cost</div>
                  <div className="text-[14px] font-mono font-bold text-slate-700">${Number(p.cost).toFixed(2)}</div>
                </div>
                {margin !== null && (
                  <div className="rounded-xl px-3 py-2 text-center" style={{background:'#f0fdf4', border:'1px solid #86efac'}}>
                    <div className="text-[9px] uppercase text-green-700 font-bold tracking-wider">Margin</div>
                    <div className="text-[14px] font-mono font-bold text-green-700">{margin.toFixed(1)}%</div>
                  </div>
                )}
              </div>
            )}

            {/* Category + Tags */}
            {(categoryName || subcatName || (p.tags && p.tags.length > 0)) && (
              <div className="space-y-2 mb-3">
                {(categoryName || subcatName) && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wider mr-1">Category</div>
                    {categoryName && (
                      <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                        style={{background:'#e6f0ff', color:'#006AFF'}}>
                        {categoryEmoji} {categoryName}
                      </span>
                    )}
                    {subcatName && (
                      <>
                        <span className="text-slate-300">›</span>
                        <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                          style={{background:'#f1f5f9', color:'#475569'}}>
                          {subcatName}
                        </span>
                      </>
                    )}
                  </div>
                )}
                {p.tags && p.tags.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wider mr-1">Tags</div>
                    {p.tags.map(t => (
                      <span key={t} className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
                        style={{background:'#fef3c7', color:'#854d0e'}}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Special flags */}
            <div className="flex flex-wrap gap-1.5">
              {p.has_serial      && <Flag color="#dbeafe" textColor="#1d4ed8" icon="🔢" label="Serialized"/>}
              {p.prompt_weight   && <Flag color="#fce7f3" textColor="#9d174d" icon="⚖️" label="Weighed"/>}
              {p.prompt_price    && <Flag color="#e0e7ff" textColor="#3730a3" icon="💰" label="Open Price"/>}
              {p.prompt_sales    && <Flag color="#f0fdf4" textColor="#166534" icon="👤" label="Asks Cashier"/>}
              {p.tax_exempt      && <Flag color="#fef9c3" textColor="#713f12" icon="🆓" label="Tax Exempt"/>}
              {p.allow_vip       && <Flag color="#fae8ff" textColor="#86198f" icon="⭐" label="VIP Price"/>}
              {p.points_redeem   && <Flag color="#fef3c7" textColor="#854d0e" icon="🎁" label="Redeemable"/>}
              {p.points_redeemable === false && <Flag color="#f1f5f9" textColor="#475569" icon="🚫" label="No Points"/>}
            </div>
          </div>
        </div>

        {/* Footer — Close + Edit */}
        <div className="px-5 py-3 flex gap-3 flex-shrink-0"
          style={{borderTop:'1.5px solid #e2e8f0', background:'#f8fafc'}}>
          <button onClick={onClose}
            className="flex-1 rounded-xl py-3 text-[13px] font-bold cursor-pointer border-2 transition-all"
            style={{background:'#fff', borderColor:'#e2e8f0', color:'#475569'}}>
            ✕ Close
          </button>
          {canEdit && (
            <button onClick={() => onEdit?.(p)}
              className="flex-1 rounded-xl py-3 text-[13px] font-bold cursor-pointer border-none text-white transition-all"
              style={{background:'#006AFF'}}>
              ✏️ Edit Product
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Flag({ color, textColor, icon, label }) {
  return (
    <span className="rounded-md px-2 py-1 text-[10px] font-bold flex items-center gap-1"
      style={{background:color, color:textColor}}>
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  )
}
