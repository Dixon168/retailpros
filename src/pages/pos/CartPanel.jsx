// src/pages/pos/CartPanel.jsx
import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { useLang } from '@/lib/i18n'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PhotoViewer } from '@/components/ui/ProductPhoto'
import NumPad from '@/components/ui/NumPad'
import { TouchKeyboard } from '@/components/ui/TouchKeyboard'
import { calculateBulkPrice, getActiveBulkTiers } from '@/lib/bulkPricing'
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
  const { t } = useLang()
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

  const { subtotal, orderDiscountAmt, bulkSavings, taxAmount, grandTotal } = totals()
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
    const workItem = selectedItem
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
                style={{background:'#E6F0FF'}}>
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
                background: isActive ? '#006AFF' : isDisabled ? 'transparent' : 'transparent',
                borderLeft: isActive ? '3px solid #006AFF' : '3px solid transparent',
                opacity: isDisabled ? 0.25 : 1,
              }}
              onMouseEnter={e => { if (!isDisabled && !isActive) e.currentTarget.style.background = '#f1f5f9' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{
                fontSize: '15px',
                color: isActive ? '#fff' : btn.danger ? '#ef4444' : '#666666',
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
            🗑 {t('cancel')}
          </button>
        </div>

        {/* Customer bar */}
        <div onClick={() => useCartStore.setState({ showCustPanel: true })}
          className="px-3 py-2 flex items-center gap-2 cursor-pointer flex-shrink-0"
          style={{borderBottom:'1px solid #f1f5f9'}}
          onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
          <span className="text-slate-400">👤</span>
          <span className="text-[12px] text-slate-600 flex-1">{customer?.name || t('walkIn')}</span>
          {customer?.tier && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
              style={{background:'#E6F0FF', color:'#006AFF'}}>{customer.tier.toUpperCase()}</span>
          )}
          <span className="text-slate-300 text-[12px]">›</span>
        </div>

        {/* Discount type selector — shows when disc action active */}
        {activeAction === 'disc' && (
          <div className="px-3 py-2 flex-shrink-0 flex items-center gap-2 animate-fadeIn"
            style={{background:'#E6F0FF', borderBottom:'1px solid #B3D1FF'}}>
            <span className="text-[10px] font-semibold text-indigo-600">Type:</span>
            {[['pct','% Off'],['amt','$ Off']].map(([t,l]) => (
              <button key={t} onClick={() => { setDiscType(t); setShowNumPad(true) }}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer border-2 transition-all"
                style={discType===t ? {background:'#006AFF',borderColor:'#006AFF',color:'#fff'} : {background:'#fff',borderColor:'#B3D1FF',color:'#006AFF'}}>
                {l}
              </button>
            ))}
            <button onClick={() => { setActiveAction(null); setShowNumPad(false) }}
              className="ml-auto text-slate-400 bg-transparent border-none cursor-pointer text-[14px]">✕</button>
          </div>
        )}

        {/* Remark Popup */}
        {activeAction === 'remark' && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{background:'rgba(15,23,42,0.5)', backdropFilter:'blur(3px)'}}>
            <div className="w-full shadow-md" style={{maxWidth:'480px', background:'#fff', borderRadius:'24px 24px 0 0'}}>
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <div className="text-[14px] font-bold text-slate-800">
                  📝 <span style={{color:'#006AFF'}}>{(selectedItem)?.name}</span>
                </div>
                <button onClick={() => { setActiveAction(null); setInputVal('') }}
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 border-none cursor-pointer text-slate-500">✕</button>
              </div>
              <div className="px-4 pb-2">
                <textarea id="remark-input" autoFocus value={inputVal}
                  onChange={e => setInputVal(e.target.value)}
                  placeholder="Type here using any keyboard..."
                  rows={3}
                  className="w-full rounded-2xl px-4 py-3 text-[15px] outline-none resize-none"
                  style={{border:'2px solid #80B2FF', background:'#f8f9ff', color:'#1F1F1F'}}/>
              </div>
              <div className="px-4 pb-2 flex gap-1.5 flex-wrap">
                {['No','Less','Extra','Hot','Cold','Medium','Well done','No ice','Spicy','Mild'].map(w => (
                  <button key={w} onClick={() => {
                    const v = inputVal ? inputVal + ', ' + w : w
                    setInputVal(v)
                    document.getElementById('remark-input')?.focus()
                  }}
                    className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer border"
                    style={{background:'#E6F0FF', borderColor:'#B3D1FF', color:'#006AFF'}}>{w}</button>
                ))}
              </div>
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
                        style={{width:'32px',height:'36px',background:'#fff',borderColor:'#e2e8f0',color:'#1F1F1F',boxShadow:'0 2px 0 #d1d5db'}}>
                        {k}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="flex gap-1.5 justify-center mt-1 mb-1">
                  <button onClick={() => { const el=document.getElementById('remark-input'); const s=el?.selectionStart??inputVal.length; const v=inputVal.slice(0,s)+' '+inputVal.slice(s); setInputVal(v); setTimeout(()=>{el?.focus();el?.setSelectionRange(s+1,s+1)},0) }}
                    className="rounded-xl text-[11px] cursor-pointer border" style={{flex:4,height:'36px',background:'#fff',borderColor:'#e2e8f0',color:'#64748b'}}>space</button>
                  <button onClick={() => { const el=document.getElementById('remark-input'); const s=el?.selectionStart??inputVal.length; const v=s>0?inputVal.slice(0,s-1)+inputVal.slice(s):inputVal.slice(0,-1); setInputVal(v); setTimeout(()=>{el?.focus();el?.setSelectionRange(Math.max(0,s-1),Math.max(0,s-1))},0) }}
                    className="rounded-xl text-[16px] cursor-pointer border" style={{flex:1,height:'36px',background:'#fff1f2',borderColor:'#fecdd3',color:'#ef4444'}}>⌫</button>
                </div>
              </div>
              <div className="px-4 pb-6 pt-2">
                <button onClick={() => {
                  const item = selectedItem
                  if (item) setItemNote(item.id, inputVal)
                  setActiveAction(null)
                  setInputVal('')
                }}
                  className="w-full rounded-2xl py-4 text-[15px] font-bold text-white cursor-pointer border-none"
                  style={{background:'#000000'}}>
                  ✓ Save Note
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Staff picker */}
        {activeAction === 'staff' && selectedItem && (
          <div className="px-3 py-2.5 flex-shrink-0 animate-fadeIn"
            style={{background:'#E6F0FF', borderBottom:'1.5px solid #006AFF'}}>
            <div className="text-[10px] font-bold text-indigo-700 mb-2">👤 Select Staff — {selectedItem.name}</div>
            <div className="flex flex-col gap-1 max-h-[130px] overflow-y-auto">
              {staffList.map(s => (
                <button key={s.id}
                  onClick={() => {
                    setItemEmployee(selectedItem.id, { id: s.id, name: s.name })
                    setActiveAction(null)
                    toast.success(`Staff: ${s.name}`)
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-left border transition-all"
                  style={selectedItem.employee?.id===s.id
                    ? {background:'#006AFF', borderColor:'#006AFF', color:'#fff'}
                    : {background:'#fff', borderColor:'#e2e8f0', color:'#1F1F1F'}}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{background:'#E6F0FF', color:'#006AFF'}}>
                    {s.name.charAt(0)}
                  </div>
                  <span className="text-[12px] font-medium">{s.name}</span>
                  <span className="text-[10px] ml-auto" style={{color: selectedItem.employee?.id===s.id ? '#B3D1FF' : '#94a3b8'}}>{s.role}</span>
                </button>
              ))}
              {staffList.length === 0 && (
                <div className="text-[11px] text-slate-400 text-center py-2">No staff found</div>
              )}
            </div>
            <button onClick={() => setActiveAction(null)}
              className="w-full mt-2 rounded-lg py-1 text-[10px] text-slate-400 cursor-pointer border"
              style={{background:'#fff', borderColor:'#e2e8f0'}}>Cancel</button>
          </div>
        )}

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300">
              <div className="text-[48px] mb-2">🛒</div>
              <div className="text-[12px]">Cart is empty</div>
              <div className="text-[10px] mt-1 text-slate-200">Tap a product to add</div>
            </div>
          ) : (
            items.map(item => {
              const isSelected = item.id === selectedItemId

              // Determine the effective line price.
              // Priority: bulk promo > manual item discount > unit price.
              const bulkTiers = getActiveBulkTiers(item)
              const hasBulk   = bulkTiers.length > 0 && !item.itemDiscount && !item.discount && item.qty > 0
              const bulkInfo  = hasBulk ? calculateBulkPrice(item.qty, item.unitPrice, bulkTiers) : null

              const linePrice = item.itemDiscount
                ? item.itemDiscount.type === 'pct'
                  ? item.unitPrice * (1 - item.itemDiscount.value / 100)
                  : Math.max(0, item.unitPrice - item.itemDiscount.value)
                : item.unitPrice
              const lineTotal = bulkInfo ? bulkInfo.lineTotal : (linePrice * item.qty)

              return (
                <div key={item.id} onClick={() => selectItem(item.id)}
                  className="px-3 py-2.5 cursor-pointer transition-all"
                  style={{
                    borderBottom: '1px solid #f8fafc',
                    background: isSelected ? '#E6F0FF' : hasBulk ? '#f0fdf4' : 'transparent',
                    borderLeft: `3px solid ${isSelected ? '#006AFF' : hasBulk ? '#16a34a' : 'transparent'}`,
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = hasBulk ? '#dcfce7' : '#fafbff' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = hasBulk ? '#f0fdf4' : 'transparent' }}>

                  <div className="flex items-start gap-2.5">
                    {/* Photo */}
                    <div onClick={e => { e.stopPropagation(); setPhotoViewer(item) }}
                      className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center cursor-pointer"
                      style={{background:'#f1f5f9', border:`2px solid ${isSelected?'#80B2FF':'#e2e8f0'}`}}>
                      {item.imageUrl
                        ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover"/>
                        : <span className="text-[9px] font-bold text-slate-400">{item.name?.substring(0,2).toUpperCase()}</span>
                      }
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <div className="text-[13px] font-semibold leading-tight" style={{color: isSelected ? '#4338ca' : '#1F1F1F'}}>
                          {item.name}
                        </div>
                        <div className="text-[13px] font-bold font-mono flex-shrink-0"
                          style={{color: item.qty < 0 ? '#dc2626' : isSelected ? '#4338ca' : '#1F1F1F'}}>
                          {item.qty < 0 ? '-' : ''}${Math.abs(lineTotal).toFixed(2)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {hasBulk ? (
                          <>
                            <span className="text-[11px] font-mono text-green-700 font-bold">
                              {item.qty}× bulk
                            </span>
                            <span className="text-[10px] text-slate-400 line-through font-mono">
                              ${(item.unitPrice * item.qty).toFixed(2)}
                            </span>
                          </>
                        ) : (
                          <span className={`text-[11px] font-mono ${item.qty < 0 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                            {item.qty < 0 ? '↩ RETURN ' : ''}{item.qty} × ${item.unitPrice.toFixed(2)}
                          </span>
                        )}
                        {/* Stock badge — always show for tracked items */}
                        {(() => {
                          if (item.qty < 0) return null  // returns don't need stock check
                          if (item.type === 'service' || item.type === 'weight') return null
                          const stock = item.inventory?.reduce((a,i)=>a+(i.quantity||0),0)
                          if (stock === undefined || stock === null) return null

                          // Determine color state
                          let bg, color, dot, label
                          if (stock < 0) {
                            bg = '#FEE2E2'; color = '#CF1322'; dot = '#CF1322'
                            label = `Stock: ${stock} (oversold)`
                          } else if (item.qty > stock) {
                            bg = '#FEE2E2'; color = '#CF1322'; dot = '#CF1322'
                            label = `Over stock (${stock} left)`
                          } else if (stock === 0) {
                            bg = '#FEE2E2'; color = '#CF1322'; dot = '#CF1322'
                            label = 'Out of stock'
                          } else if (stock <= 5) {
                            bg = '#FEF3C7'; color = '#B45309'; dot = '#F59E0B'
                            label = `Stock: ${stock}`
                          } else {
                            bg = '#DCFCE7'; color = '#15803D'; dot = '#15803D'
                            label = `Stock: ${stock}`
                          }
                          return (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1"
                              style={{background: bg, color}}>
                              <span className="w-1 h-1 rounded-full" style={{background: dot}}/>
                              {label}
                            </span>
                          )
                        })()}
                        {item.itemDiscount && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                            style={{background:'#fdf2f8', color:'#db2777'}}>
                            {item.itemDiscount.type==='pct' ? `-${item.itemDiscount.value}%` : `-$${item.itemDiscount.value}`}
                          </span>
                        )}
                        {bulkInfo && bulkInfo.savings > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                            style={{background:'#dcfce7', color:'#166534'}}
                            title={bulkInfo.breakdown.map(b =>
                              b.bundleCount
                                ? `${b.bundleCount}× ${b.label}`
                                : `${b.count}× $${b.unitPrice.toFixed(2)}`
                            ).join(' + ')}>
                            🏷️ -${bulkInfo.savings.toFixed(2)}
                          </span>
                        )}
                        {item.points_redeem && item.redeem_points_required > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5"
                            style={{background:'#FEF3C7', color:'#B45309'}}>
                            ⭐ {item.redeem_points_required * item.qty} pts
                          </span>
                        )}
                        {item.priceOverridden && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                            style={{background:'#fefce8', color:'#ca8a04'}}>CUSTOM</span>
                        )}
                        {item.employee && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded"
                            style={{background:'#eff6ff', color:'#3b82f6'}}>{item.employee.name}</span>
                        )}
                        {item.note && (
                          <span className="text-[9px] text-slate-400 italic truncate max-w-[100px]">
                            "{item.note}"
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bulk breakdown — shows how the qty was split into bundles */}
                  {bulkInfo && bulkInfo.savings > 0 && (
                    <div className="mt-1.5 ml-12 text-[10px] flex flex-wrap gap-1.5 items-center">
                      {bulkInfo.breakdown.map((b, i) => (
                        <span key={i} className="font-mono"
                          style={{color: b.bundleCount ? '#166534' : '#94a3b8'}}>
                          {b.bundleCount
                            ? `${b.bundleCount}×(${b.label})`
                            : `${b.count}×$${b.unitPrice.toFixed(2)}`}
                          {i < bulkInfo.breakdown.length - 1 && <span className="text-slate-300 ml-1">+</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Smart upsell — "add N more to save $X" */}
                  {bulkInfo?.hint && (
                    <div className="mt-1.5 ml-12 rounded-lg px-2 py-1.5 flex items-center justify-between gap-2"
                      style={{background:'#fefce8', border:'1px solid #fde68a'}}>
                      <div className="text-[10px] flex-1">
                        <span className="font-bold" style={{color:'#854d0e'}}>💡 Add {bulkInfo.hint.addQty} more</span>
                        <span className="text-[#854d0e]"> → save ${bulkInfo.hint.savings.toFixed(2)}!</span>
                      </div>
                      <button onClick={(e) => {
                        e.stopPropagation()
                        updateQty(item.id, item.qty + bulkInfo.hint.addQty)
                      }}
                        className="rounded-md px-2 py-1 text-[10px] font-bold cursor-pointer border-none text-white"
                        style={{background:'#ca8a04'}}>
                        + {bulkInfo.hint.addQty}
                      </button>
                    </div>
                  )}

                  {/* Selected hint */}
                  {isSelected && (
                    <div className="mt-1.5 text-[9px] font-semibold" style={{color:'#006AFF'}}>
                      ← Use side buttons to modify
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Totals */}
        <div className="flex-shrink-0" style={{borderTop:'1.5px solid #e2e8f0'}}>
          <div className="px-3 py-2.5 space-y-1">
            {[
              ['Subtotal',       `$${subtotal.toFixed(2)}`,         '#E5E5E5'],
              ...(bulkSavings > 0 ? [['Bulk savings', `-$${bulkSavings.toFixed(2)}`, '#16a34a']] : []),
              ...(orderDiscountAmt > 0 ? [['Discount', `-$${orderDiscountAmt.toFixed(2)}`, '#16a34a']] : []),
              ['Tax',            `$${taxAmount.toFixed(2)}`,        '#E5E5E5'],
              ['Tip',            '$0.00',                           '#94a3b8'],
            ].map(([l,v,c]) => (
              <div key={l} className="flex justify-between">
                <span className="text-[12px]" style={{color:'#94a3b8'}}>{l}</span>
                <span className="text-[12px] font-mono font-semibold" style={{color:c}}>{v}</span>
              </div>
            ))}
            {/* You saved today badge */}
            {bulkSavings > 0 && (
              <div className="rounded-lg px-2 py-1 mt-1.5 text-center"
                style={{background:'#dcfce7', border:'1px solid #86efac'}}>
                <span className="text-[11px] font-bold" style={{color:'#166534'}}>
                  🎉 You saved ${bulkSavings.toFixed(2)} today!
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-0.5" style={{borderTop:'1px solid #f1f5f9'}}>
              <span className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">Remark ›</span>
            </div>
          </div>



          {/* PAY button */}
          <div className="px-3 pb-3">
            <button onClick={() => useCartStore.setState({ showPayPanel: true })}
              disabled={items.length === 0}
              className="w-full rounded-2xl py-4 text-[16px] font-bold text-white cursor-pointer border-none disabled:opacity-30 transition-all"
              style={{
                background: items.length > 0 ? '#4f46e5' : '#e2e8f0',
                letterSpacing: '1px',
                boxShadow: items.length > 0 ? '0 4px 20px rgba(99,102,241,0.4)' : 'none',
              }}>
              {t('pay')} ${grandTotal.toFixed(2)}
            </button>
          </div>
        </div>
      </div>



      {/* NumPad */}
      {showNumPad && activeAction && !['staff','remark','inc','dec','delete'].includes(activeAction) && (
        <NumPad
          title={{custom:'Set Quantity / Return', disc:'Item Discount', price:'Change Price', single:'Unit Price'}[activeAction] || 'Enter Value'}
          subtitle={activeAction==='custom' ? `${selectedItem?.name} · Enter negative to return` : selectedItem?.name}
          value={inputVal}
          onChange={setInputVal}
          prefix={['price','single'].includes(activeAction) ? '$' : activeAction==='disc' && discType==='amt' ? '$' : ''}
          suffix={activeAction==='disc' && discType==='pct' ? '%' : activeAction==='custom' ? ` ${selectedItem?.unit||'ea'}` : ''}
          allowNegative={activeAction === 'custom'}
          allowDecimal={activeAction !== 'custom'}
          onConfirm={(val) => applyAction(val)}
          onClose={() => { setShowNumPad(false); setActiveAction(null); setInputVal('') }}
        />
      )}

      {photoViewer && (
        <PhotoViewer
          product={{ name: photoViewer.name, image_url: photoViewer.imageUrl, price: photoViewer.unitPrice, inventory: photoViewer.inventory }}
          onClose={() => setPhotoViewer(null)}
        />
      )}
    </div>
  )
}
