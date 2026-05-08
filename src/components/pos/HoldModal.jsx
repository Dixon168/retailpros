// src/components/pos/HoldModal.jsx
import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useHeldOrdersStore } from '@/stores/heldOrdersStore'
import { useCartStore } from '@/stores/cartStore'
import { TouchKeyboard } from '@/components/ui/TouchKeyboard'

export function HoldModal({ onClose }) {
  const { user, tenant, store, terminal } = useAuthStore()
  const { holdCurrentCart } = useHeldOrdersStore()
  const { items, customer, totals } = useCartStore()
  const [label, setLabel]     = useState('')
  const [showKB, setShowKB]   = useState(false)
  const [saving, setSaving]   = useState(false)

  const { grandTotal } = totals()

  const handleHold = async () => {
    setSaving(true)
    const ok = await holdCurrentCart({
      tenantId:     tenant?.id,
      storeId:      store?.id,
      terminalId:   terminal?.id,
      terminalName: terminal?.name,
      userId:       user?.id,
      userName:     user?.name,
      label:        label.trim() || customer?.name || null,
    })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}
      onClick={onClose}>
      <div className="w-full rounded-t-3xl sm:rounded-xl overflow-hidden shadow-md"
        style={{background:'#fff', maxWidth:'380px'}}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center gap-3"
          style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
          <span className="text-[24px]">📌</span>
          <div>
            <div className="text-[16px] font-bold text-white">Hold Order</div>
            <div className="text-[11px] text-amber-200">Save cart for later</div>
          </div>
          <button onClick={onClose}
            className="ml-auto w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white text-[16px] flex items-center justify-center">
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">

          {/* Cart summary */}
          <div className="rounded-xl p-4" style={{background:'#fafafa', border:'1px solid #e2e8f0'}}>
            <div className="flex justify-between text-[12px] text-slate-500 mb-2">
              <span>{items.length} item{items.length!==1?'s':''}</span>
              <span className="font-bold font-mono" style={{color:'#f59e0b'}}>${grandTotal.toFixed(2)}</span>
            </div>
            <div className="flex flex-col gap-1">
              {items.slice(0,3).map((item,i) => (
                <div key={i} className="flex justify-between text-[11px]">
                  <span className="text-slate-600 truncate">{item.name}</span>
                  <span className="text-slate-400 font-mono ml-2">×{item.qty}</span>
                </div>
              ))}
              {items.length > 3 && (
                <div className="text-[11px] text-slate-400">+{items.length-3} more...</div>
              )}
            </div>
          </div>

          {/* Label */}
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Label (optional)
            </div>
            <button onClick={() => setShowKB(true)}
              className="w-full rounded-xl px-4 py-3 text-left cursor-pointer border-2 transition-all"
              style={{
                border: label ? '2px solid #fcd34d' : '2px dashed #e2e8f0',
                background: label ? '#fffbeb' : '#f8fafc',
              }}>
              <span className="text-[14px]" style={{color: label ? '#92400e' : '#94a3b8'}}>
                {label || (customer?.name ? `For ${customer.name}` : 'Table 3, Customer name...')}
              </span>
            </button>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border"
              style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
              Cancel
            </button>
            <button onClick={handleHold} disabled={saving}
              className="flex-[2] rounded-xl py-3.5 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
              style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
              {saving ? '⏳ Holding...' : '📌 Hold Order'}
            </button>
          </div>
        </div>
      </div>

      {showKB && (
        <TouchKeyboard
          title="Order Label"
          value={label}
          onChange={setLabel}
          placeholder="Table 3, John, etc..."
          onDone={() => setShowKB(false)}
          onClose={() => setShowKB(false)}/>
      )}
    </div>
  )
}
