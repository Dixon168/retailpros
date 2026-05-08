// src/pages/pos/panels/ItemPanel.jsx
// 购物车 Item 操作面板 — 点击购物车产品弹出
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { ProductPhoto, PhotoViewer } from '@/components/ui/ProductPhoto'
import toast from 'react-hot-toast'

export default function ItemPanel({ item, onClose }) {
  const { tenant } = useAuthStore()
  const { setItemNote, setItemEmployee, setItemPrice, setItemDiscount, setItemQty, removeItem } = useCartStore()

  const [tab, setTab]           = useState('main')
  const [note, setNote]         = useState(item.note || '')
  const [customQty, setCustomQty] = useState(String(item.qty))
  const [discType, setDiscType] = useState('pct')
  const [discVal, setDiscVal]   = useState(item.itemDiscount?.value ? String(item.itemDiscount.value) : '')
  const [newPrice, setNewPrice] = useState(String(item.unitPrice))
  const [photoViewer, setPhotoViewer] = useState(false)

  // Load staff list
  const { data: staffList = [] } = useQuery({
    queryKey: ['staff', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, name, role').eq('tenant_id', tenant.id).eq('is_active', true).order('name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const lineTotal = () => {
    let price = item.unitPrice
    if (item.itemDiscount) {
      if (item.itemDiscount.type === 'pct') price = price * (1 - item.itemDiscount.value/100)
      else price = Math.max(0, price - item.itemDiscount.value)
    }
    return price * item.qty
  }

  const handleQtyInput = (v) => {
    setCustomQty(v)
    const n = parseFloat(v)
    if (n > 0) setItemQty(item.id, n)
  }

  const applyDiscount = () => {
    const v = parseFloat(discVal)
    if (!v || v <= 0) { toast.error('Enter discount value'); return }
    setItemDiscount(item.id, { type: discType, value: v })
    toast.success('Item discount applied')
  }

  const removeDiscount = () => {
    setItemDiscount(item.id, null)
    setDiscVal('')
    toast.success('Discount removed')
  }

  const applyPrice = () => {
    const p = parseFloat(newPrice)
    if (!p || p <= 0) { toast.error('Enter valid price'); return }
    setItemPrice(item.id, p)
    toast.success('Price updated')
  }

  const saveNote = () => {
    setItemNote(item.id, note)
    toast.success('Note saved')
  }

  const TABS = [
    { id: 'main',     label: 'Item' },
    { id: 'discount', label: '✂️ Discount' },
    { id: 'price',    label: '💲 Price' },
    { id: 'employee', label: '👤 Staff' },
    { id: 'note',     label: '📝 Note' },
  ]

  return (
    <div className="w-[220px] bg-[#FFFFFF] border-l border-[#E5E5E5] flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[#E5E5E5] flex items-center gap-2">
        <ProductPhoto
          imageUrl={item.imageUrl} name={item.name} size="sm"
          onClick={() => setPhotoViewer(true)}/>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold truncate">{item.name}</div>
          <div className="text-[10px] font-mono text-[#006AFF]">${lineTotal().toFixed(2)}</div>
        </div>
        <button onClick={onClose}
          className="text-[#999999] hover:text-[#1F1F1F] bg-transparent border-none cursor-pointer text-[14px]">✕</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#E5E5E5] overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-2.5 py-1.5 text-[10px] whitespace-nowrap border-b-2 cursor-pointer bg-transparent transition-all ${
              tab===t.id ? 'text-[#006AFF] border-blue-500' : 'text-[#999999] border-transparent'
            }`}>{t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3">

        {/* MAIN — Qty controls */}
        {tab === 'main' && (
          <div className="flex flex-col gap-3">
            {/* Qty */}
            <div>
              <div className="text-[9px] font-mono text-[#999999] uppercase mb-1.5">Quantity</div>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => { const n=item.qty-1; setCustomQty(String(Math.max(0,n))); setItemQty(item.id, Math.max(0,n)) }}
                  className="w-8 h-8 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg text-[16px] font-bold cursor-pointer hover:border-blue-500/40 hover:text-[#006AFF] transition-all flex items-center justify-center">−</button>
                <input
                  type="number" value={customQty}
                  onChange={e => handleQtyInput(e.target.value)}
                  className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-[14px] font-mono font-bold text-center outline-none focus:border-[#006AFF]"/>
                <button onClick={() => { const n=item.qty+1; setCustomQty(String(n)); setItemQty(item.id, n) }}
                  className="w-8 h-8 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg text-[16px] font-bold cursor-pointer hover:border-blue-500/40 hover:text-[#006AFF] transition-all flex items-center justify-center">+</button>
              </div>
              <div className="text-[10px] text-[#999999] text-center">{item.unit || 'ea'} × ${item.unitPrice.toFixed(2)}</div>
            </div>

            {/* Current discount */}
            {item.itemDiscount && (
              <div className="bg-pink-500/8 border border-pink-500/20 rounded-[9px] px-3 py-2 flex justify-between items-center">
                <div>
                  <div className="text-[9px] text-[#999999]">Item Discount</div>
                  <div className="text-[12px] font-bold text-pink-400">
                    {item.itemDiscount.type==='pct' ? `-${item.itemDiscount.value}%` : `-$${item.itemDiscount.value}`}
                  </div>
                </div>
                <button onClick={removeDiscount} className="text-[#999999] hover:text-[#CF1322] bg-transparent border-none cursor-pointer text-[12px]">✕</button>
              </div>
            )}

            {/* Employee */}
            {item.employee && (
              <div className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2 flex justify-between items-center">
                <div>
                  <div className="text-[9px] text-[#999999]">Staff</div>
                  <div className="text-[11px] font-bold">{item.employee.name}</div>
                </div>
                <button onClick={() => setItemEmployee(item.id, null)} className="text-[#999999] hover:text-[#CF1322] bg-transparent border-none cursor-pointer text-[12px]">✕</button>
              </div>
            )}

            {/* Price override */}
            {item.priceOverridden && (
              <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-[9px] px-3 py-2">
                <div className="text-[9px] text-[#999999]">Custom Price</div>
                <div className="text-[12px] font-bold text-[#FA8C16]">${item.unitPrice.toFixed(2)}</div>
              </div>
            )}

            {/* Note */}
            {item.note && (
              <div className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2">
                <div className="text-[9px] text-[#999999] mb-0.5">Note</div>
                <div className="text-[11px] text-[#666666]">{item.note}</div>
              </div>
            )}

            {/* Delete */}
            <button onClick={() => { removeItem(item.id); onClose() }}
              className="w-full bg-red-500/10 border border-red-500/20 rounded-[9px] py-2
                text-[11px] font-bold text-[#CF1322] cursor-pointer hover:bg-red-500/15 transition-colors mt-1">
              🗑 Remove Item
            </button>
          </div>
        )}

        {/* DISCOUNT */}
        {tab === 'discount' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-1.5">
              {[['pct','%'],['amt','$']].map(([t,l]) => (
                <button key={t} onClick={() => setDiscType(t)}
                  className={`flex-1 py-2 rounded-lg text-[11px] font-bold border cursor-pointer transition-all ${
                    discType===t ? 'bg-pink-500/15 border-pink-500/40 text-pink-400' : 'bg-[#F5F5F5] border-[#E5E5E5] text-[#666666]'
                  }`}>{l} {t==='pct'?'Percent':'Fixed'}</button>
              ))}
            </div>
            <div className="flex items-center bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 focus-within:border-pink-500/40">
              <span className="text-[#999999] mr-1 text-sm">{discType==='pct'?'%':'$'}</span>
              <input type="number" value={discVal} onChange={e=>setDiscVal(e.target.value)}
                placeholder="0" autoFocus
                className="flex-1 bg-transparent border-none outline-none py-2.5 text-[14px] font-mono placeholder-[#999999]"/>
            </div>
            {discVal && (
              <div className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2 text-center">
                <div className="text-[9px] text-[#999999]">After discount</div>
                <div className="text-[14px] font-bold text-pink-400">
                  ${Math.max(0, discType==='pct'
                    ? item.unitPrice * item.qty * (1-parseFloat(discVal)/100)
                    : item.unitPrice * item.qty - parseFloat(discVal)
                  ).toFixed(2)}
                </div>
              </div>
            )}
            <button onClick={applyDiscount} disabled={!discVal}
              className="w-full bg-pink-500 border-none rounded-[9px] py-2.5 text-[12px] font-bold text-white cursor-pointer disabled:opacity-40">
              ✓ Apply Discount
            </button>
            {item.itemDiscount && (
              <button onClick={removeDiscount}
                className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] py-2 text-[11px] text-[#CF1322] cursor-pointer">
                Remove Discount
              </button>
            )}
          </div>
        )}

        {/* PRICE OVERRIDE */}
        {tab === 'price' && (
          <div className="flex flex-col gap-3">
            <div className="text-[10px] text-[#999999] text-center">
              Original: <span className="text-[#666666] font-mono">${item.unitPrice.toFixed(2)}</span>
            </div>
            <div className="flex items-center bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 focus-within:border-yellow-500/40">
              <span className="text-[#999999] mr-1">$</span>
              <input type="number" value={newPrice} onChange={e=>setNewPrice(e.target.value)}
                step="0.01" autoFocus
                className="flex-1 bg-transparent border-none outline-none py-2.5 text-[16px] font-mono font-bold placeholder-[#999999]"/>
            </div>
            <button onClick={applyPrice} disabled={!newPrice}
              className="w-full bg-yellow-500 border-none rounded-[9px] py-2.5 text-[12px] font-bold text-black cursor-pointer disabled:opacity-40">
              ✓ Change Price
            </button>
            {item.priceOverridden && (
              <button onClick={() => { setItemPrice(item.id, item.originalPrice || item.unitPrice); setNewPrice(String(item.originalPrice || item.unitPrice)) }}
                className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] py-2 text-[11px] text-[#666666] cursor-pointer">
                Reset to Original
              </button>
            )}
          </div>
        )}

        {/* EMPLOYEE */}
        {tab === 'employee' && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[9px] font-mono text-[#999999] uppercase mb-1">Select Staff</div>
            {staffList.map(s => (
              <button key={s.id} onClick={() => { setItemEmployee(item.id, { id: s.id, name: s.name }); setTab('main') }}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-[9px] border cursor-pointer transition-all text-left ${
                  item.employee?.id===s.id
                    ? 'bg-[#006AFF]/10 border-blue-500/30 text-[#006AFF]'
                    : 'bg-[#F5F5F5] border-[#E5E5E5] text-[#1F1F1F] hover:border-[#E5E5E5]'
                }`}>
                <div className="w-6 h-6 rounded-full bg-[#F5F5F5] flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  {s.name.charAt(0)}
                </div>
                <div>
                  <div className="text-[12px] font-semibold">{s.name}</div>
                  <div className="text-[9px] text-[#999999]">{s.role}</div>
                </div>
                {item.employee?.id===s.id && <span className="ml-auto text-[#006AFF]">✓</span>}
              </button>
            ))}
            {item.employee && (
              <button onClick={() => setItemEmployee(item.id, null)}
                className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] py-2 text-[11px] text-[#CF1322] cursor-pointer mt-1">
                Remove Staff
              </button>
            )}
          </div>
        )}

        {/* NOTE */}
        {tab === 'note' && (
          <div className="flex flex-col gap-3">
            <textarea
              value={note} onChange={e => setNote(e.target.value)}
              rows={4} autoFocus placeholder="Add note for this item..."
              className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2.5 text-[12px] outline-none focus:border-[#006AFF] resize-none placeholder-[#999999]"/>
            <button onClick={saveNote}
              className="w-full bg-[#006AFF] border-none rounded-[9px] py-2.5 text-[12px] font-bold text-white cursor-pointer">
              ✓ Save Note
            </button>
            {note && (
              <button onClick={() => { setNote(''); setItemNote(item.id, '') }}
                className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] py-2 text-[11px] text-[#666666] cursor-pointer">
                Clear Note
              </button>
            )}
          </div>
        )}
      </div>

      {photoViewer && (
        <PhotoViewer product={{ ...item, name: item.name, image_url: item.imageUrl, price: item.unitPrice }} onClose={() => setPhotoViewer(false)}/>
      )}
    </div>
  )
}
