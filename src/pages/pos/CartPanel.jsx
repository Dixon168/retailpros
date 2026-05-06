// src/pages/pos/CartPanel.jsx
import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PhotoViewer } from '@/components/ui/ProductPhoto'
import NumPad from '@/components/ui/NumPad'
import { TouchKeyboard } from '@/components/ui/TouchKeyboard'
import toast from 'react-hot-toast'

const SIDE_BTNS = [
  { id:'inc',    icon:'＋',  label:'Inc qty' },
  { id:'dec',    icon:'－',  label:'Dec qty' },
  { id:'custom', icon:'⊞',  label:'Custom qty' },
  { id:'delete', icon:'🗑',  label:'Delete',       danger: true },
  { id:'disc',   icon:'%$', label:'Discount' },
  { id:'price',  icon:'$',  label:'Change price' },
  { id:'single', icon:'$≡', label:'Single price' },
  { id:'staff',  icon:'👤', label:'Service' },
  { id:'remark', icon:'📝', label:'Remark' },
]

export default function CartPanel({ onRefund, onHold }) {
  const { user, tenant } = useAuthStore()
  const {
    items, customer, orderDiscount, totals,
    updateQty, removeItem, setItemNote, setItemEmployee,
    setItemPrice, setItemDiscount, setItemQty,
    selectedItemId,
  } = useCartStore()

  const [activeAction, setActiveAction] = useState(null)
  const [inputVal,     setInputVal]     = useState('')
  const [discType,     setDiscType]     = useState('pct')
  const [photoViewer,  setPhotoViewer]  = useState(null)
  const [showNumPad,   setShowNumPad]   = useState(false)

  const { subtotal, orderDiscountAmt, taxAmount, grandTotal } = totals()
  const selectedItem = items.find(i => i.id === selectedItemId)
  const hasSelection = !!selectedItem

  const { data: staffList = [] } = useQuery({
    queryKey: ['staff', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, name, role').eq('tenant_id', tenant.id).eq('is_active', true).order('name')
      return data || []
    },
    enabled: !!tenant?.id && activeAction === 'staff',
  })

  const selectItem = (id) => {
    const newId = selectedItemId === id ? null : id
    useCartStore.setState({ selectedItemId: newId })
    setActiveAction(null)
    setInputVal('')
    setShowNumPad(false)
  }

  const handleSideBtn = (id) => {
    if (!selectedItem && !['disc'].includes(id)) {
      toast('👆 Select an item first', { icon: 'ℹ️' })
      return
    }
    // Instant actions
    if (id === 'inc') {
      setItemQty(selectedItem.id, selectedItem.qty + 1)
      return
    }
    if (id === 'dec') {
      setItemQty(selectedItem.id, selectedItem.qty - 1)
      return
    }
    if (id === 'delete') {
      removeItem(selectedItem.id)
      useCartStore.setState({ selectedItemId: null })
      setActiveAction(null)
      return
    }
    // Auto-select last item if none selected
    if (!selectedItem && items.length > 0) {
      useCartStore.setState({ selectedItemId: items[items.length-1].id })
    }
    const newAction = activeAction === id ? null : id
    setActiveAction(newAction)
    setInputVal('')
    if (newAction && !['staff','remark','disc'].includes(newAction)) {
      setShowNumPad(true)
    } else {
      setShowNumPad(false)
    }
  }

  const applyAction = (val) => {
    const v = val !== undefined ? val : parseFloat(inputVal)
    const workItem = selectedItem || activeItem
    if (!workItem && activeAction !== 'disc') return
    if (activeAction === 'custom' && v !== 0 && !isNaN(v)) {
      setItemQty(selectedItem.id, v)
      toast.success(`Qty → ${v}`)
    }
    if ((activeAction === 'price' || activeAction === 'single') && v > 0) {
      setItemPrice(selectedItem.id, v)
      toast.success(`Price → $${v.toFixed(2)}`)
    }
    if (activeAction === 'disc') {
      if (!v || v <= 0) { toast.error('Enter discount value'); return }
      setItemDiscount(selectedItem?.id, { type: discType, value: v })
      toast.success('Discount applied')
    }
    if (activeAction === 'remark') {
      setItemNote(workItem.id, inputVal)
      toast.success('Note saved')
    }
    setActiveAction(null)
    setInputVal('')
  }

  const orderNum = `#A${new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'2-digit'}).replace(/\//g,'')}${String(items.length).padStart(4,'0')}`

  return (
    <div className="flex h-full w-full">

      {/* ── LEFT: Side action buttons ── */}
      <div className="flex-shrink-0 flex flex-col border-r"
        style={{width:'68px', background:'#f8fafc', borderColor:'#e2e8f0'}}>

        {/* Selection indicator */}
        <div className="px-1 py-2 text-center border-b" style={{borderColor:'#e2e8f0'}}>
          {hasSelection ? (
            <div>
              <div className="w-8 h-8 rounded-lg mx-auto overflow-hidden flex items-center justify-center mb-0.5"
                style={{background:'#e0e7ff'}}>
                {selectedItem.imageUrl
                  ? <img src={selectedItem.imageUrl} className="w-full h-full object-cover" alt=""/>
                  : <span className="text-[9px] font-bold text-indigo-600">{selectedItem.name?.substring(0,2).toUpperCase()}</span>
                }
              </div>
              <div className="text-[8px] font-semibold truncate text-indigo-600 leading-tight px-0.5">
                {selectedItem.name?.split(' ')[0]}
              </div>
            </div>
          ) : (
            <div className="text-[8px] text-slate-300 leading-tight py-2">
              Select<br/>item
            </div>
          )}
        </div>

        {/* Action buttons */}
        {SIDE_BTNS.map(btn => {
          const isActive   = activeAction === btn.id
          const isDisabled = !hasSelection && btn.id !== 'disc'
          return (
            <button key={btn.id} onClick={() => handleSideBtn(btn.id)}
              disabled={isDisabled}
              className="flex flex-col items-center justify-center py-2 px-1 cursor-pointer border-none transition-all text-center"
              style={{
                background: isActive ? '#6366f1' : isDisabled ? 'transparent' : 'transparent',
                borderLeft: isActive ? '3px solid #6366f1' : '3px solid transparent',
                opacity: isDisabled ? 0.25 : 1,
              }}
              onMouseEnter={e => { if (!isDisabled && !isActive) e.currentTarget.style.background = '#f1f5f9' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{
                fontSize: '15px',
                color: isActive ? '#fff' : btn.danger ? '#ef4444' : '#475569',
                lineHeight: 1,
                marginBottom: '2px',
              }}>{btn.icon}</span>
              <span style={{
                fontSize: '8.5px',
                fontWeight: 600,
                color: isActive ? '#fff' : btn.danger ? '#ef4444' : '#94a3b8',
                lineHeight: 1.2,
              }}>{btn.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── RIGHT: Cart ── */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{background:'#fff'}}>

        {/* Invoice header */}
        <div className="px-3 py-2 flex items-center gap-2 flex-shrink-0"
          style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
          <div className="flex-1">
            <div className="text-[11px] font-bold font-mono text-slate-700">{orderNum}</div>
            <div className="text-[9px] text-slate-400">{new Date().toLocaleString()} · {user?.name}</div>
          </div>
          <div className="text-[11px] font-bold text-indigo-500 mr-1">
            {items.length} item{items.length!==1?'s':''}
          </div>
          <button
            onClick={() => {
              if (items.length === 0) return
              if (window.confirm('Cancel this transaction and clear cart?')) {
                useCartStore.getState().clearCart()
                useCartStore.setState({ customer: null, selectedItemId: null })
              }
            }}
            disabled={items.length === 0}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer border disabled:opacity-30 transition-all"
            style={{background:'#fff1f2', borderColor:'#fca5a5', color:'#dc2626'}}>
            🗑 Cancel
          </button>
        </div>

        {/* Customer bar */}
        <div onClick={() => useCartStore.setState({ showCustPanel: true })}
          className="px-3 py-2 flex items-center gap-2 cursor-pointer flex-shrink-0"
          style={{borderBottom:'1px solid #f1f5f9'}}
          onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
          <span className="text-slate-400">👤</span>
          <span className="text-[12px] text-slate-600 flex-1">{customer?.name || 'Walk-in Customer'}</span>
          {customer?.tier && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
              style={{background:'#e0e7ff', color:'#6366f1'}}>{customer.tier.toUpperCase()}</span>
          )}
          <span className="text-slate-300 text-[12px]">›</span>
        </div>

        {/* Discount type selector — shows when disc action active */}
        {activeAction === 'disc' && (
          <div className="px-3 py-2 flex-shrink-0 flex items-center gap-2 animate-fadeIn"
            style={{background:'#eef2ff', borderBottom:'1px solid #c7d2fe'}}>
            <span className="text-[10px] font-semibold text-indigo-600">Type:</span>
            {[['pct','% Off'],['amt','$ Off']].map(([t,l]) => (
              <button key={t} onClick={() => { setDiscType(t); setShowNumPad(true) }}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer border-2 transition-all"
                style={discType===t ? {background:'#6366f1',borderColor:'#6366f1',color:'#fff'} : {background:'#fff',borderColor:'#c7d2fe',color:'#6366f1'}}>
                {l}
              </button>
            ))}
            <button onClick={() => { setActiveAction(null); setShowNumPad(false) }}
              className="ml-auto text-slate-400 bg-transparent border-none cursor-pointer text-[14px]">✕</button>
          </div>
        )}

        {/* Remark Popup */}
        {activeAction === 'remark' && (
          <div className="fixed inset-0 z-[200] flex items-end justify-center"
            style={{background:'rgba(15,23,42,0.5)', backdropFilter:'blur(3px)'}}>
            <div className="w-full shadow-2xl" style={{maxWidth:'480px', background:'#fff', borderRadius:'24px 24px 0 0'}}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <div className="text-[14px] font-bold text-slate-800">
                  📝 <span style={{color:'#6366f1'}}>{(selectedItem||activeItem)?.name}</span>
                </div>
                <button onClick={() => { setActiveAction(null); setInputVal('') }}
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 border-none cursor-pointer text-slate-500">✕</button>
              </div>
              {/* Text input */}
              <div className="px-4 pb-2">
                <textarea id="remark-input" autoFocus value={inputVal}
                  onChange={e => setInputVal(e.target.value)}
                  placeholder="Type here using any keyboard..."
                  rows={3}
                  className="w-full rounded-2xl px-4 py-3 text-[15px] outline-none resize-none"
                  style={{border:'2px solid #a5b4fc', background:'#f8f9ff', color:'#1e293b'}}/>
              </div>
              {/* Quick words */}
              <div className="px-4 pb-2 flex gap-1.5 flex-wrap">
                {['No','Less','Extra','Hot','Cold','Medium','Well done','No ice','Spicy','Mild','Large','Small'].map(w => (
                  <button key={w} onClick={() => {
                    const v = inputVal ? inputVal + ', ' + w : w
                    setInputVal(v)
                    document.getElementById('remark-input')?.focus()
                  }}
                    className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer border"
                    style={{background:'#eef2ff', borderColor:'#c7d2fe', color:'#6366f1'}}>
                    {w}
                  </button>
                ))}
              </div>
              {/* Custom keyboard */}
              <div className="px-2 pb-1 pt-1" style={{background:'#f8fafc'}}>
                {[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['z','x','c','v','b','n','m']].map((row,ri) => (
                  <div key={ri} className="flex gap-1 justify-center mb-1">
                    {row.map(k => (
                      <button key={k} onClick={() => {
                        const el = document.getElementById('remark-input')
                        const s = el?.selectionStart ?? inputVal.length
                        const e2 = el?.selectionEnd ?? inputVal.length
                        const val = inputVal.slice(0,s) + k + inputVal.slice(e2)
                        setInputVal(val)
                        setTimeout(() => { el?.focus(); el?.setSelectionRange(s+1,s+1) }, 0)
                      }}
                        className="rounded-xl text-[14px] font-medium cursor-pointer border"
                        style={{width:'32px', height:'36px', background:'#fff', borderColor:'#e2e8f0', color:'#1e293b', boxShadow:'0 2px 0 #d1d5db'}}>
                        {k}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="flex gap-1.5 justify-center mt-1 mb-1">
                  <button onClick={() => { const el=document.getElementById('remark-input'); const s=el?.selectionStart??inputVal.length; const v=inputVal.slice(0,s)+' '+inputVal.slice(s); setInputVal(v); setTimeout(()=>{el?.focus();el?.setSelectionRange(s+1,s+1)},0) }}
                    className="rounded-xl text-[11px] cursor-pointer border" style={{flex:4, height:'36px', background:'#fff', borderColor:'#e2e8f0', color:'#64748b'}}>space</button>
                  <button onClick={() => { const el=document.getElementById('remark-input'); const s=el?.selectionStart??inputVal.length; const v=s>0?inputVal.slice(0,s-1)+inputVal.slice(s):inputVal.slice(0,-1); setInputVal(v); setTimeout(()=>{el?.focus();el?.setSelectionRange(Math.max(0,s-1),Math.max(0,s-1))},0) }}
                    className="rounded-xl text-[16px] cursor-pointer border" style={{flex:1, height:'36px', background:'#fff1f2', borderColor:'#fecdd3', color:'#ef4444'}}>⌫</button>
                </div>
              </div>
              {/* Save */}
              <div className="px-4 pb-6 pt-2">
                <button onClick={() => {
                  const item = selectedItem || activeItem
                  if (item) setItemNote(item.id, inputVal)
                  setActiveAction(null)
                  setInputVal('')
                }}
                  className="w-full rounded-2xl py-4 text-[15px] font-bold text-white cursor-pointer border-none"
                  style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                  ✓ Save Note
                </button>
              </div>
            </div>
          </div>
        )}
