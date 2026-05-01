// src/pages/pos/CartPanel.jsx
import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ProductPhoto, PhotoViewer } from '@/components/ui/ProductPhoto'
import toast from 'react-hot-toast'

// ── Side action buttons (left column) ──
const SIDE_BTNS = [
  { id:'inc',    icon:'＋',   label:'Inc qty' },
  { id:'dec',    icon:'－',   label:'Dec qty' },
  { id:'custom', icon:'⊞',   label:'Custom qty' },
  { id:'delete', icon:'🗑',   label:'Delete', danger:true },
  { id:'disc',   icon:'+/−', label:'Discount' },
  { id:'price',  icon:'$',   label:'Change price' },
  { id:'single', icon:'$≡',  label:'Single price' },
  { id:'staff',  icon:'👤',  label:'Service' },
  { id:'remark', icon:'📝',  label:'Remark' },
]

export default function CartPanel({ onRefund }) {
  const { user, tenant } = useAuthStore()
  const {
    items, customer, orderDiscount, totals,
    updateQty, removeItem, setItemNote, setItemEmployee,
    setItemPrice, setItemDiscount, setItemQty,
    selectedItemId,
  } = useCartStore()

  const [activeAction, setActiveAction] = useState(null) // which side btn is active
  const [inputVal,     setInputVal]     = useState('')
  const [discType,     setDiscType]     = useState('pct')
  const [photoViewer,  setPhotoViewer]  = useState(null)

  const { subtotal, orderDiscountAmt, taxAmount, grandTotal } = totals()
  const selectedItem = items.find(i => i.id === selectedItemId)

  // Load staff
  const { data: staffList = [] } = useQuery({
    queryKey: ['staff', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, name, role').eq('tenant_id', tenant.id).eq('is_active', true).order('name')
      return data || []
    },
    enabled: !!tenant?.id && activeAction === 'staff',
  })

  const openPanel = k => useCartStore.setState({ [k]: true })

  const selectItem = (id) => {
    useCartStore.setState({ selectedItemId: selectedItemId === id ? null : id })
    setActiveAction(null)
    setInputVal('')
  }

  const handleSideBtn = (id) => {
    if (!selectedItem && !['disc'].includes(id)) {
      toast.error('Select an item first')
      return
    }
    setActiveAction(activeAction === id ? null : id)
    setInputVal('')

    // Instant actions
    if (id === 'inc' && selectedItem) {
      setItemQty(selectedItem.id, selectedItem.qty + 1)
      setActiveAction(null)
    }
    if (id === 'dec' && selectedItem) {
      const n = selectedItem.qty - 1
      if (n <= 0) removeItem(selectedItem.id)
      else setItemQty(selectedItem.id, n)
      setActiveAction(null)
    }
    if (id === 'delete' && selectedItem) {
      removeItem(selectedItem.id)
      useCartStore.setState({ selectedItemId: null })
      setActiveAction(null)
    }
  }

  const applyAction = () => {
    if (!selectedItem) return
    const v = parseFloat(inputVal)

    if (activeAction === 'custom' && v > 0) {
      setItemQty(selectedItem.id, v)
      toast.success(`Qty set to ${v}`)
    }
    if (activeAction === 'price' && v > 0) {
      setItemPrice(selectedItem.id, v)
      toast.success(`Price changed to $${v.toFixed(2)}`)
    }
    if (activeAction === 'single' && v > 0) {
      setItemPrice(selectedItem.id, v)
      toast.success(`Unit price set to $${v.toFixed(2)}`)
    }
    if (activeAction === 'disc') {
      if (!v || v <= 0) { toast.error('Enter discount value'); return }
      setItemDiscount(selectedItem.id, { type: discType, value: v })
      toast.success('Discount applied')
    }
    if (activeAction === 'remark') {
      setItemNote(selectedItem.id, inputVal)
      toast.success('Note saved')
    }
    setActiveAction(null)
    setInputVal('')
  }

  // Generate order number
  const orderNum = `#A${new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'2-digit'}).replace(/\//g,'')}${String(items.length).padStart(4,'0')}`

  return (
    <div className="flex h-full bg-white w-full">

      {/* ── LEFT: Side action buttons ── */}
      <div className="w-[70px] bg-[#f8f9fa] border-r border-[#e5e7eb] flex flex-col py-1 flex-shrink-0">
        {SIDE_BTNS.map(btn => (
          <button key={btn.id}
            onClick={() => handleSideBtn(btn.id)}
            className={`flex flex-col items-center justify-center py-2.5 px-1 cursor-pointer
              border-none transition-all text-center
              ${activeAction === btn.id
                ? 'bg-blue-50 border-l-2 border-blue-500'
                : 'bg-transparent hover:bg-gray-100'
              }
              ${btn.danger ? 'hover:bg-red-50' : ''}
            `}>
            <span className={`text-[16px] mb-0.5 leading-none ${
              btn.danger ? 'text-red-500' :
              activeAction === btn.id ? 'text-blue-600' : 'text-gray-600'
            }`}>{btn.icon}</span>
            <span className={`text-[9px] leading-tight font-medium ${
              btn.danger ? 'text-red-500' :
              activeAction === btn.id ? 'text-blue-600' : 'text-gray-500'
            }`} style={{fontSize:'9px'}}>{btn.label}</span>
          </button>
        ))}
      </div>

      {/* ── RIGHT: Cart content ── */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{background:'#fff'}}>

        {/* Invoice header */}
        <div className="px-3 py-2 border-b border-[#e5e7eb] flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-[11px] font-mono font-bold text-gray-800">
              {orderNum}
            </div>
            <div className="text-[9px] text-gray-400">
              {new Date().toLocaleString()} · {user?.name}
            </div>
          </div>
          <div className="text-[11px] font-bold text-blue-600">
            #{String(items.length).padStart(4,'0')}
          </div>
        </div>

        {/* Customer bar */}
        <div
          onClick={() => openPanel('showCustPanel')}
          className="px-3 py-1.5 border-b border-[#e5e7eb] flex items-center gap-2 cursor-pointer hover:bg-gray-50 flex-shrink-0">
          <span className="text-[13px]">👤</span>
          <span className="text-[11px] text-gray-600 flex-1">
            {customer?.name || 'Walk-in Customer'}
          </span>
          {customer?.tier && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 font-bold">
              {customer.tier.toUpperCase()}
            </span>
          )}
          <span className="text-gray-400 text-[12px]">›</span>
        </div>

        {/* Active action input panel */}
        {activeAction && !['inc','dec','delete','staff'].includes(activeAction) && (
          <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 flex-shrink-0">
            <div className="text-[10px] font-bold text-blue-700 mb-1.5">
              {{
                custom: '📦 Custom Quantity',
                disc:   '✂️ Item Discount',
                price:  '$ Change Price',
                single: '$≡ Unit Price',
                remark: '📝 Remark',
              }[activeAction]}
              {selectedItem && <span className="ml-1 text-blue-500 font-normal">— {selectedItem.name}</span>}
            </div>

            {activeAction === 'disc' && (
              <div className="flex gap-1.5 mb-1.5">
                <button onClick={() => setDiscType('pct')}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold border cursor-pointer ${discType==='pct'?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300'}`}>
                  %
                </button>
                <button onClick={() => setDiscType('amt')}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold border cursor-pointer ${discType==='amt'?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-300'}`}>
                  $
                </button>
              </div>
            )}

            {activeAction === 'remark' ? (
              <textarea value={inputVal} onChange={e => setInputVal(e.target.value)}
                rows={2} placeholder="Add note..." autoFocus
                className="w-full border border-blue-300 rounded px-2 py-1 text-[12px] outline-none resize-none bg-white"/>
            ) : (
              <input type={activeAction==='remark'?'text':'number'}
                value={inputVal} onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => e.key==='Enter' && applyAction()}
                placeholder={activeAction==='custom'?'Qty...':activeAction==='disc'?`${discType==='pct'?'%':'$'} value...`:'Amount...'}
                autoFocus
                className="w-full border border-blue-300 rounded px-2 py-1.5 text-[13px] font-mono outline-none bg-white"/>
            )}

            <div className="flex gap-1.5 mt-1.5">
              <button onClick={applyAction}
                className="flex-1 bg-blue-600 text-white rounded px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none">
                ✓ Apply
              </button>
              <button onClick={() => { setActiveAction(null); setInputVal('') }}
                className="bg-white border border-gray-300 rounded px-2 py-1.5 text-[11px] text-gray-600 cursor-pointer">
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Staff picker */}
        {activeAction === 'staff' && selectedItem && (
          <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 flex-shrink-0">
            <div className="text-[10px] font-bold text-blue-700 mb-1.5">👤 Select Staff</div>
            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
              {staffList.map(s => (
                <button key={s.id}
                  onClick={() => {
                    setItemEmployee(selectedItem.id, { id: s.id, name: s.name })
                    setActiveAction(null)
                    toast.success(`Staff: ${s.name}`)
                  }}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-left transition-all ${
                    selectedItem.employee?.id===s.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white border-gray-200 hover:border-blue-400'
                  }`}>
                  <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-600 flex-shrink-0">
                    {s.name.charAt(0)}
                  </div>
                  <span className="text-[11px] font-medium">{s.name}</span>
                  <span className="text-[9px] text-gray-400 ml-auto">{s.role}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setActiveAction(null)}
              className="mt-1.5 w-full bg-white border border-gray-300 rounded py-1 text-[10px] text-gray-500 cursor-pointer">
              Cancel
            </button>
          </div>
        )}

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-300">
              <div className="text-[40px] mb-2">🛒</div>
              <div className="text-[12px]">Cart is empty</div>
            </div>
          ) : (
            items.map(item => {
              const isSelected = item.id === selectedItemId
              const linePrice = item.itemDiscount
                ? item.itemDiscount.type === 'pct'
                  ? item.unitPrice * (1 - item.itemDiscount.value/100)
                  : Math.max(0, item.unitPrice - item.itemDiscount.value)
                : item.unitPrice
              const lineTotal = linePrice * item.qty
              const qty = item.imageUrl ? null : null

              return (
                <div key={item.id}
                  onClick={() => selectItem(item.id)}
                  className={`px-3 py-2 border-b border-[#f0f0f0] cursor-pointer transition-all ${
                    isSelected ? 'bg-red-50 border-l-4 border-l-red-400' : 'hover:bg-gray-50'
                  }`}>
                  <div className="flex items-start gap-2">
                    {/* Photo */}
                    <div onClick={e => { e.stopPropagation(); setPhotoViewer(item) }}
                      className="w-8 h-8 rounded bg-gray-100 border border-gray-200 overflow-hidden flex-shrink-0 flex items-center justify-center cursor-pointer hover:opacity-80">
                      {item.imageUrl
                        ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover"/>
                        : <span className="text-[9px] font-bold text-gray-400">{item.name?.substring(0,2).toUpperCase()}</span>
                      }
                    </div>

                    {/* Name + details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <div className="text-[12px] font-semibold text-gray-800 leading-tight">{item.name}</div>
                        <div className="text-[12px] font-bold text-gray-800 flex-shrink-0">${lineTotal.toFixed(2)}</div>
                      </div>

                      {/* Stock info */}
                      {item.stockQty !== undefined && (
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          Stock: {item.stockQty}
                        </div>
                      )}

                      {/* Serial */}
                      {item.serialNumber && (
                        <div className="text-[9px] font-mono text-yellow-600 mt-0.5">SN: {item.serialNumber}</div>
                      )}

                      {/* Weight */}
                      {item.type === 'weight' && (
                        <div className="text-[9px] text-green-600 mt-0.5">{item.qty} {item.unit} × ${item.unitPrice.toFixed(2)}/{item.unit}</div>
                      )}

                      {/* Bottom row: qty + price + badges */}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-gray-500">{item.type!=='weight'?`${item.qty} ×`:''} ${item.unitPrice.toFixed(2)}</span>
                        {item.itemDiscount && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-600 font-bold">
                            {item.itemDiscount.type==='pct'?`-${item.itemDiscount.value}%`:`-$${item.itemDiscount.value}`}
                          </span>
                        )}
                        {item.priceOverridden && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-bold">CUSTOM</span>
                        )}
                        {item.employee && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">{item.employee.name}</span>
                        )}
                        {item.note && (
                          <span className="text-[9px] text-gray-400 italic truncate max-w-[80px]">"{item.note}"</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Totals */}
        <div className="flex-shrink-0" style={{borderTop:'1.5px solid #e2e8f0'}}>
          <div className="px-3 py-2 space-y-1">
            <div className="flex justify-between text-[12px] text-gray-600">
              <span>Subtotal</span>
              <span className="font-mono">${subtotal.toFixed(2)}</span>
            </div>
            {orderDiscountAmt > 0 && (
              <div className="flex justify-between text-[12px] text-green-600">
                <span>Discount price</span>
                <span className="font-mono">-${orderDiscountAmt.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-[12px] text-gray-600">
              <span>Tax</span>
              <span className="font-mono">${taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[12px] text-gray-500">
              <span>Tip</span>
              <span className="font-mono">$0.00</span>
            </div>
            <div className="flex justify-between text-[12px] text-gray-500 cursor-pointer hover:text-gray-700">
              <span>Remark</span>
              <span>›</span>
            </div>
          </div>

          {/* Action row */}
          <div className="px-3 pb-2 flex gap-1.5">
            <button onClick={() => items.length > 0 ? useCartStore.setState({ showHoldForm: true }) : toast.error('Cart is empty')}
              className="flex-1 rounded-lg py-2 text-[11px] font-bold cursor-pointer transition-colors" style={{background:'#f0f9ff', border:'1px solid #bae6fd', color:'#0369a1'}}>
              📌 Hold
            </button>
            <button onClick={onRefund}
              className="flex-1 rounded-lg py-2 text-[11px] font-bold cursor-pointer transition-colors" style={{background:'#faf5ff', border:'1px solid #e9d5ff', color:'#7c3aed'}}>
              ↩️ Refund
            </button>
            <button onClick={() => useCartStore.setState({ showDiscPanel: true })}
              className="flex-1 rounded-lg py-2 text-[11px] font-bold cursor-pointer transition-colors" style={{background:'#fff7ed', border:'1px solid #fed7aa', color:'#c2410c'}}>
              ✂️ Disc
            </button>
            <button onClick={() => useCartStore.getState().clearCart()}
              className="flex-1 rounded-lg py-2 text-[11px] font-bold cursor-pointer transition-colors" style={{background:'#fff1f2', border:'1px solid #fecdd3', color:'#e11d48'}}>
              🗑 Clear
            </button>
          </div>

          {/* PAY button */}
          <div className="px-3 pb-3">
            <button
              onClick={() => useCartStore.setState({ showPayPanel: true })}
              disabled={items.length === 0}
              className="w-full rounded-xl py-4 text-[16px] font-black text-white cursor-pointer
                border-none disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              style={{background: items.length > 0 ? 'linear-gradient(135deg,#4f46e5,#6366f1)' : '#cbd5e1', letterSpacing:'1px'}}>
              PAY ${grandTotal.toFixed(2)}
            </button>
          </div>
        </div>
      </div>

      {photoViewer && (
        <PhotoViewer
          product={{ name: photoViewer.name, image_url: photoViewer.imageUrl, price: photoViewer.unitPrice }}
          onClose={() => setPhotoViewer(null)}
        />
      )}
    </div>
  )
}
