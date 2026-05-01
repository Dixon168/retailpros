// src/pages/pos/CartPanel.jsx
import { ProductPhoto, PhotoViewer } from '@/components/ui/ProductPhoto'
import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
import { useHeldOrdersStore } from '@/stores/heldOrdersStore'
import toast from 'react-hot-toast'

export default function CartPanel({ onRefund }) {
  const [photoViewer, setPhotoViewer] = useState(null)
  const { items, customer, orderDiscount, updateQty, removeItem, totals, submitOrder, selectedItemId } = useCartStore()
  const { user, tenant, store } = useAuthStore()
  const { terminal } = useTerminalStore()
  const { holdCurrentCart } = useHeldOrdersStore()
  const { subtotal, orderDiscountAmt, taxAmount, grandTotal } = totals()

  const [holdingOrder, setHoldingOrder] = useState(false)
  const [holdLabel,    setHoldLabel]    = useState('')
  const [showHoldForm, setShowHoldForm] = useState(false)

  const openPanel = (panel) => useCartStore.setState({ [panel]: true })

  // ── Hold current order ──
  const handleHold = async () => {
    if (items.length === 0) { toast.error('Cart is empty'); return }
    setHoldingOrder(true)
    const ok = await holdCurrentCart({
      tenantId:     tenant.id,
      storeId:      store.id,
      terminalId:   terminal?.id,
      terminalName: terminal?.name,
      userId:       user.id,
      userName:     user.name,
      label:        holdLabel || null,
    })
    setHoldingOrder(false)
    setShowHoldForm(false)
    setHoldLabel('')
  }

  return (
    <div className="w-[380px] bg-[#0d1117] border-l border-[#1e2d42] flex flex-col flex-shrink-0">

      {/* Customer bar */}
      <div className="px-3.5 py-2.5 border-b border-[#1e2d42]">
        <button onClick={() => openPanel('showCustPanel')}
          className="w-full flex items-center gap-2.5 bg-[#111827] border border-[#1e2d42]
            rounded-[9px] px-3 py-2 hover:border-purple-500/30 transition-colors">
          <span className="text-[14px]">👤</span>
          <div className="flex-1 text-left">
            <div className="text-[12px] font-semibold">
              {customer?.name || 'Walk-in Customer'}
            </div>
            <div className="text-[10px] font-mono text-[#3d5068] mt-0.5">
              {customer ? `${customer.code} · ${customer.tier || customer.type}` : 'Tap to select customer'}
            </div>
          </div>
          {customer?.tier_discount < 1 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono
              bg-purple-500/10 text-purple-400">
              {Math.round((1 - customer.tier_discount) * 100)}% off
            </span>
          )}
          {customer?.credit_balance > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono
              bg-red-500/10 text-red-400">
              Owes ${customer.credit_balance.toFixed(2)}
            </span>
          )}
          <span className="text-[#3d5068]">›</span>
        </button>
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5
        scrollbar-thin scrollbar-thumb-[#1e2d42]">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-[#3d5068]">
            <div className="text-4xl opacity-25 select-none">[ ]</div>
            <div className="text-[11px] text-center font-mono">
              Cart is empty<br/>
              <span className="text-[10px]">Tap a product or scan barcode</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map(item => (
              <CartItem key={item.id} item={item}
                onQtyChange={(qty) => updateQty(item.id, qty)}
                onRemove={() => removeItem(item.id)}
                onDiscount={() => useCartStore.setState({ pendingProduct: item, showDiscPanel: true })}
                onPhotoClick={(item) => setPhotoViewer(item)}
                onSelect={(item) => useCartStore.setState({ selectedItemId: selectedItemId===item.id ? null : item.id })}
                isSelected={selectedItemId===item.id}
              />
            ))}
          </div>
        )}
      </div>

      {photoViewer && <PhotoViewer product={photoViewer} onClose={() => setPhotoViewer(null)} />}

      {/* Action buttons row — Discount + Clear only */}
      <div className="px-3.5 py-2 border-t border-[#1e2d42] flex gap-1.5">
        <ActionBtn icon="✂️" label="Discount" onClick={() => openPanel('showDiscPanel')} />
        <ActionBtn icon="🗑" label="Clear"
          onClick={() => useCartStore.getState().clearCart()} danger />
      </div>

      {/* Hold form inline */}
      {showHoldForm && (
        <div className="px-3.5 pb-2 border-b border-[#1e2d42]">
          <div className="flex gap-2">
            <input
              value={holdLabel}
              onChange={e => setHoldLabel(e.target.value)}
              placeholder="Note (optional)..."
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleHold()}
              className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-lg
                px-3 py-2 text-[12px] outline-none focus:border-yellow-500/40
                placeholder-[#3d5068]"
            />
            <button onClick={handleHold} disabled={holdingOrder}
              className="bg-yellow-500 border-none rounded-lg px-3 py-2
                text-[11px] font-bold text-black disabled:opacity-50">
              {holdingOrder ? '...' : 'Hold'}
            </button>
            <button onClick={() => { setShowHoldForm(false); setHoldLabel('') }}
              className="bg-[#111827] border border-[#1e2d42] rounded-lg px-2 py-2
                text-[11px] text-[#8899b0]">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Totals */}
      <div className="px-3.5 py-3 border-t border-[#1e2d42]">
        <TotalRow label="Subtotal" value={`$${subtotal.toFixed(2)}`} />

        {/* Customer tier discount */}
        {customer?.tier_discount < 1 && (
          <TotalRow
            label={`${customer.tier?.toUpperCase() || 'VIP'} discount (${Math.round((1-customer.tier_discount)*100)}%)`}
            value={`-$${(subtotal * (1 - customer.tier_discount)).toFixed(2)}`}
            green
          />
        )}

        {orderDiscountAmt > 0 && (
          <TotalRow label="Order Discount" value={`-$${orderDiscountAmt.toFixed(2)}`} green />
        )}
        <TotalRow label="Tax" value={`$${taxAmount.toFixed(2)}`} muted />

        <div className="flex justify-between items-center bg-[#111827] border border-[#243347]
          rounded-[10px] px-3 py-2.5 mt-2">
          <span className="text-[13px] font-bold">Total</span>
          <span className="text-[20px] font-bold text-blue-400 font-mono">
            ${grandTotal.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Checkout */}
      <div className="px-3.5 pb-3.5 pt-2">

        {/* Hold + Refund — prominent invoice-level actions */}
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => items.length > 0 ? setShowHoldForm(true) : toast.error('Cart is empty')}
            className="flex-1 bg-[#1a2d1a] border border-green-500/30 rounded-[10px]
              py-2.5 text-[12px] font-bold text-green-400 cursor-pointer
              hover:bg-green-500/15 hover:border-green-500/50 transition-all
              flex items-center justify-center gap-2">
            📌 Hold Order
          </button>
          <button
            onClick={onRefund}
            className="flex-1 bg-[#1a1a2d] border border-purple-500/30 rounded-[10px]
              py-2.5 text-[12px] font-bold text-purple-400 cursor-pointer
              hover:bg-purple-500/15 hover:border-purple-500/50 transition-all
              flex items-center justify-center gap-2">
            ↩️ Refund
          </button>
        </div>

        <button onClick={() => openPanel('showPayPanel')}
          disabled={items.length === 0}
          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 border-none
            rounded-[11px] py-3.5 text-[14px] font-bold text-white cursor-pointer
            flex items-center justify-center gap-2
            shadow-[0_4px_20px_rgba(59,130,246,0.25)]
            hover:shadow-[0_6px_24px_rgba(59,130,246,0.35)]
            hover:-translate-y-px active:scale-[0.99]
            disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0
            transition-all duration-150">
          💳 Charge ${grandTotal.toFixed(2)}
        </button>
        <div className="flex gap-1.5 mt-2">
          <QuickPayBtn icon="💵" label="Cash"   onClick={() => openPanel('showPayPanel')} />
          <QuickPayBtn icon="💳" label="Card"   onClick={() => openPanel('showPayPanel')} />
          <QuickPayBtn icon="🏷️" label="Member" onClick={() => openPanel('showPayPanel')} />
        </div>
      </div>

      {/* Refund panel */}
    </div>
  )
}

function CartItem({ item, onQtyChange, onRemove, onDiscount, onPhotoClick, onSelect, isSelected }) {
  const lineTotal = item.unitPrice * item.qty
  return (
    <div onClick={() => onSelect && onSelect(item)}
      className={`rounded-[9px] p-2.5 transition-all cursor-pointer ${isSelected ? 'bg-blue-500/8 border border-blue-500/30' : 'bg-[#111827] border border-[#1e2d42] hover:border-[#243347]'}`}>
      <div className="flex items-start gap-2">
        <ProductPhoto imageUrl={item.imageUrl} name={item.name} size="sm" onClick={() => onPhotoClick && onPhotoClick(item)} className="mt-0.5"/>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold truncate">{item.name}</div>
          {item.serialNumber && (
            <div className="text-[9px] font-mono text-yellow-400 mt-0.5">SN: {item.serialNumber}</div>
          )}
          {item.type === 'weight' && (
            <div className="text-[9px] font-mono text-green-400 mt-0.5">
              {item.qty} {item.unit} × ${item.unitPrice.toFixed(2)}/{item.unit}
            </div>
          )}
          {item.discount && (
            <div className="text-[9px] font-mono text-pink-400 mt-0.5">
              {item.discount.type === 'pct' ? `-${item.discount.value}%` : `-$${item.discount.value}`} discount
            </div>
          )}
        </div>
        <button onClick={onRemove}
          className="text-[#3d5068] text-[13px] hover:text-red-400 transition-colors px-1">
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2 mt-2">
        {item.type !== 'weight' && item.type !== 'serialized' ? (
          <div className="flex items-center gap-1.5 bg-[#1a2236] rounded-md px-2 py-1">
            <button onClick={() => onQtyChange(item.qty - 1)}
              className="text-[#8899b0] text-[14px] w-4 h-4 flex items-center justify-center
                hover:text-white transition-colors">−</button>
            <span className="text-[12px] font-semibold font-mono min-w-[20px] text-center">
              {item.qty}
            </span>
            <button onClick={() => onQtyChange(item.qty + 1)}
              className="text-[#8899b0] text-[14px] w-4 h-4 flex items-center justify-center
                hover:text-white transition-colors">+</button>
          </div>
        ) : <div className="flex-1"/>}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={onDiscount}
            className="text-[9px] px-1.5 py-0.5 rounded font-mono
              bg-[#1a2236] border border-[#1e2d42] text-[#3d5068]
              hover:border-green-500/30 hover:text-green-400 transition-all">
            % disc
          </button>
          <div className="text-[13px] font-bold font-mono">${lineTotal.toFixed(2)}</div>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({ icon, label, onClick, danger }) {
  return (
    <button onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1 bg-[#111827]
        border border-[#1e2d42] rounded-lg py-1.5 text-[10px] text-[#8899b0]
        cursor-pointer transition-all font-sans
        ${danger
          ? 'hover:border-red-500/30 hover:text-red-400'
          : 'hover:border-blue-500/30 hover:text-blue-400'
        }`}>
      <span>{icon}</span><span>{label}</span>
    </button>
  )
}
function TotalRow({ label, value, green, muted }) {
  return (
    <div className="flex justify-between items-center mb-1.5">
      <span className="text-[11px] text-[#8899b0]">{label}</span>
      <span className={`text-[12px] font-mono ${
        green ? 'text-green-400' : muted ? 'text-[#8899b0]' : 'text-[#e8edf5]'
      }`}>{value}</span>
    </div>
  )
}
function QuickPayBtn({ icon, label, onClick }) {
  return (
    <button onClick={onClick}
      className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-lg py-1.5
        text-[10px] text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400
        transition-all text-center">
      {icon} {label}
    </button>
  )
}
