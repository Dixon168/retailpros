// src/components/pos/PointsRedeemModal.jsx
import { useState, useEffect } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import NumPad from '@/components/ui/NumPad'
import toast from 'react-hot-toast'

export function PointsRedeemModal({ onClose }) {
  const { tenant } = useAuthStore()
  const { items, customer, totals, setOrderDiscount } = useCartStore()
  const [mode, setMode]           = useState(null) // 'cash' | 'product'
  const [ptsInput, setPtsInput]   = useState('')
  const [showPad, setShowPad]     = useState(false)
  const [productQtys, setProductQtys] = useState({})

  const { grandTotal } = totals()

  // Points rate and limits from tenant settings
  const REDEEM_RATE   = tenant?.points_redeem_rate      || 100
  const MIN_PTS       = tenant?.redeem_min_pts          || 100
  const MAX_PTS_TXN   = tenant?.redeem_max_pts_per_txn  || 0   // 0 = unlimited
  const MAX_CASH_TXN  = tenant?.redeem_max_cash_per_txn || 0
  const MAX_PCT_TXN   = tenant?.redeem_max_pct_per_txn  || 0

  const customerPts = customer?.loyalty_points || 0

  // Calculate effective max
  const maxByPts     = MAX_PTS_TXN > 0 ? Math.min(customerPts, MAX_PTS_TXN) : customerPts
  const maxByCash    = MAX_CASH_TXN > 0 ? Math.min(maxByPts, MAX_CASH_TXN * REDEEM_RATE) : maxByPts
  const maxByPct     = MAX_PCT_TXN > 0 ? Math.min(maxByCash, Math.floor(grandTotal * MAX_PCT_TXN/100 * REDEEM_RATE)) : maxByCash
  const maxByOrder   = Math.floor(grandTotal * REDEEM_RATE)
  const effectiveMax = Math.min(maxByPct, maxByOrder)
  const maxCashValue = effectiveMax / REDEEM_RATE
  const ptsNum        = parseInt(ptsInput) || 0
  const cashDeduct    = ptsNum / REDEEM_RATE
  const remaining     = customerPts - ptsNum

  // Products in cart that allow redemption
  const redeemableItems = items.filter(item =>
    item.points_redeem && item.redeem_points_required > 0 && item.qty > 0
  )

  const totalPtsForProducts = Object.entries(productQtys).reduce((s, [id, qty]) => {
    const item = redeemableItems.find(i => i.id === id)
    return s + (item?.redeem_points_required || 0) * qty
  }, 0)

  const totalProductValue = Object.entries(productQtys).reduce((s, [id, qty]) => {
    const item = redeemableItems.find(i => i.id === id)
    return s + (item?.unitPrice || 0) * qty
  }, 0)

  if (!customer) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}
        onClick={onClose}>
        <div className="w-full rounded-t-3xl sm:rounded-xl p-6 text-center shadow-md"
          style={{background:'#fff', maxWidth:'380px'}} onClick={e=>e.stopPropagation()}>
          <div className="text-[36px] mb-3">💎</div>
          <div className="text-[16px] font-bold text-slate-800 mb-2">Select a Member First</div>
          <div className="text-[12px] text-slate-500 mb-4">Add a member to the cart to use points</div>
          <button onClick={onClose}
            className="w-full rounded-xl py-3 text-[13px] font-semibold cursor-pointer border"
            style={{background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
            Close
          </button>
        </div>
      </div>
    )
  }

  const applyPtsCash = () => {
    if (ptsNum <= 0) { toast.error('Enter points to use'); return }
    if (ptsNum < MIN_PTS) { toast.error(`Minimum ${MIN_PTS} pts required`); return }
    if (ptsNum > customerPts) { toast.error('Not enough points'); return }
    if (ptsNum > effectiveMax) { toast.error(`Max ${effectiveMax.toLocaleString()} pts per transaction`); return }
    if (cashDeduct > grandTotal) { toast.error(`Max deduct is $${grandTotal.toFixed(2)}`); return }
    // Apply as order discount
    setOrderDiscount({ type: 'points_cash', pts: ptsNum, amount: cashDeduct })
    toast.success(`✓ ${ptsNum} pts → -$${cashDeduct.toFixed(2)} applied`)
    onClose()
  }

  const applyPtsProduct = () => {
    const used = Object.values(productQtys).some(q => q > 0)
    if (!used) { toast.error('Select products to redeem'); return }
    if (totalPtsForProducts > customerPts) { toast.error('Not enough points'); return }
    // Apply free items discount
    setOrderDiscount({ type: 'points_product', pts: totalPtsForProducts, amount: totalProductValue, items: productQtys })
    toast.success(`✓ ${totalPtsForProducts} pts → ${Object.values(productQtys).reduce((s,q)=>s+q,0)} free item(s)`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}
      onClick={onClose}>
      <div className="w-full rounded-t-3xl sm:rounded-xl overflow-hidden shadow-md"
        style={{background:'#fff', maxWidth:'420px'}}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4" style={{background:'#000000'}}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[16px] font-bold text-white">💎 Use Points</div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white text-[16px] flex items-center justify-center">
              ✕
            </button>
          </div>
          {/* Customer points summary */}
          <div className="rounded-xl px-4 py-3" style={{background:'rgba(255,255,255,0.15)'}}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] text-purple-200">{customer.name}</div>
                <div className="text-[24px] font-black text-white">{customerPts.toLocaleString()} pts</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-purple-200">Cash value</div>
                <div className="text-[20px] font-bold text-yellow-300">${maxCashValue.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4">
          {/* Mode selector */}
          {!mode && (
            <div className="flex flex-col gap-3">
              <div className="text-[12px] font-semibold text-slate-500 mb-1">How would you like to use points?</div>

              {/* Cash deduct */}
              <button onClick={() => setMode('cash')}
                className="flex items-center gap-4 p-4 rounded-2xl text-left cursor-pointer border-2 transition-all"
                style={{border:'2px solid #e2e8f0'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor='#006AFF';e.currentTarget.style.background='#faf5ff'}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.background='#fff'}}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[24px] flex-shrink-0"
                  style={{background:'#f0fdf4'}}>💵</div>
                <div>
                  <div className="text-[14px] font-bold text-slate-800">Deduct from Total</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Use {REDEEM_RATE} pts = $1.00 off the order
                  </div>
                  <div className="text-[11px] font-semibold mt-1" style={{color:'#16a34a'}}>
                    Max: ${maxCashValue.toFixed(2)} off
                    {MAX_PTS_TXN > 0 && <span className="ml-2 text-amber-600">· Limit: {MAX_PTS_TXN.toLocaleString()} pts/txn</span>}
                  </div>
                </div>
                <span className="ml-auto text-slate-300 text-[20px]">›</span>
              </button>

              {/* Free products */}
              {redeemableItems.length > 0 && (
                <button onClick={() => setMode('product')}
                  className="flex items-center gap-4 p-4 rounded-2xl text-left cursor-pointer border-2 transition-all"
                  style={{border:'2px solid #e2e8f0'}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#f59e0b';e.currentTarget.style.background='#fffbeb'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.background='#fff'}}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[24px] flex-shrink-0"
                    style={{background:'#fffbeb'}}>🎁</div>
                  <div>
                    <div className="text-[14px] font-bold text-slate-800">Get Free Products</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Redeem points for specific products
                    </div>
                    <div className="text-[11px] font-semibold mt-1" style={{color:'#f59e0b'}}>
                      {redeemableItems.length} item{redeemableItems.length!==1?'s':''} in cart eligible
                    </div>
                  </div>
                  <span className="ml-auto text-slate-300 text-[20px]">›</span>
                </button>
              )}
            </div>
          )}

          {/* Cash mode */}
          {mode === 'cash' && (
            <div>
              <button onClick={() => setMode(null)}
                className="flex items-center gap-1 text-slate-400 bg-transparent border-none cursor-pointer text-[12px] mb-3">
                ‹ Back
              </button>
              <div className="text-[13px] font-semibold text-slate-600 mb-3">
                Enter points to use ({REDEEM_RATE} pts = $1.00)
              </div>

              {/* Points input */}
              <button onClick={() => setShowPad(true)}
                className="w-full rounded-2xl py-4 text-center cursor-pointer border-2 mb-3 transition-all"
                style={{
                  border: ptsNum > 0 ? '2px solid #006AFF' : '2px dashed #e2e8f0',
                  background: ptsNum > 0 ? '#faf5ff' : '#f8fafc',
                }}>
                <div className="text-[32px] font-black font-mono" style={{color: ptsNum > 0 ? '#006AFF' : '#94a3b8'}}>
                  {ptsNum > 0 ? ptsNum.toLocaleString() : '0'}
                </div>
                <div className="text-[11px] text-slate-400">points</div>
              </button>

              {/* Quick select */}
              <div className="flex gap-2 mb-4">
                {[100, 500, Math.floor(effectiveMax/2), effectiveMax].filter((v,i,a)=>v>0&&a.indexOf(v)===i).map(q=>(
                  <button key={q} onClick={() => setPtsInput(String(Math.min(q, effectiveMax)))}
                    className="flex-1 rounded-xl py-2 text-[11px] font-semibold cursor-pointer border transition-all"
                    style={{
                      background: ptsNum===Math.min(q,Math.floor(grandTotal*REDEEM_RATE)) ? '#006AFF' : '#f8fafc',
                      borderColor: ptsNum===Math.min(q,Math.floor(grandTotal*REDEEM_RATE)) ? '#006AFF' : '#e2e8f0',
                      color: ptsNum===Math.min(q,Math.floor(grandTotal*REDEEM_RATE)) ? '#fff' : '#64748b',
                    }}>
                    {q===customerPts ? 'MAX' : q.toLocaleString()}
                  </button>
                ))}
              </div>

              {/* Summary */}
              {ptsNum > 0 && (
                <div className="rounded-xl p-3 mb-4" style={{background:'#f0fdf4', border:'1px solid #86efac'}}>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="text-slate-500">Points used</span>
                    <span className="font-bold text-purple-600">{ptsNum.toLocaleString()} pts</span>
                  </div>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="text-slate-500">Cash deduct</span>
                    <span className="font-bold text-green-600">-${cashDeduct.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="text-slate-500">Remaining pts</span>
                    <span className="font-semibold text-slate-600">{remaining.toLocaleString()} pts</span>
                  </div>
                  <div className="flex justify-between text-[13px] font-bold pt-2"
                    style={{borderTop:'1px solid #86efac'}}>
                    <span className="text-slate-700">Pay after deduct</span>
                    <span className="font-mono" style={{color:'#006AFF'}}>${Math.max(0, grandTotal-cashDeduct).toFixed(2)}</span>
                  </div>
                </div>
              )}

              <button onClick={applyPtsCash}
                disabled={ptsNum<=0 || ptsNum<MIN_PTS || ptsNum>customerPts || ptsNum>effectiveMax || cashDeduct>grandTotal}
                className="w-full rounded-2xl py-4 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                style={{background:'#000000'}}>
                💎 Apply {ptsNum>0 ? `${ptsNum.toLocaleString()} pts → -$${cashDeduct.toFixed(2)}` : 'Points'}
              </button>
            </div>
          )}

          {/* Product mode */}
          {mode === 'product' && (
            <div>
              <button onClick={() => setMode(null)}
                className="flex items-center gap-1 text-slate-400 bg-transparent border-none cursor-pointer text-[12px] mb-3">
                ‹ Back
              </button>
              <div className="flex flex-col gap-2 mb-4">
                {redeemableItems.map(item => {
                  const maxQty = Math.min(item.qty, Math.floor(customerPts / item.redeem_points_required))
                  const qty    = productQtys[item.id] || 0
                  return (
                    <div key={item.id} className="flex items-center gap-3 rounded-xl p-3"
                      style={{
                        background: qty > 0 ? '#fffbeb' : '#f8fafc',
                        border: `1.5px solid ${qty>0 ? '#fde047' : '#e2e8f0'}`,
                      }}>
                      <div className="flex-1">
                        <div className="text-[13px] font-semibold text-slate-700">{item.name}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          <span className="font-bold text-amber-600">{item.redeem_points_required} pts</span>
                          {' '}= free · max {maxQty}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setProductQtys(q=>({...q,[item.id]:Math.max(0,(q[item.id]||0)-1)}))}
                          className="w-8 h-8 rounded-lg border cursor-pointer text-[16px] flex items-center justify-center"
                          style={{background:'#f8fafc',borderColor:'#e2e8f0'}}>−</button>
                        <span className="w-8 text-center text-[14px] font-bold" style={{color:qty>0?'#f59e0b':'#94a3b8'}}>
                          {qty}
                        </span>
                        <button onClick={() => setProductQtys(q=>({...q,[item.id]:Math.min(maxQty,(q[item.id]||0)+1)}))}
                          disabled={qty>=maxQty}
                          className="w-8 h-8 rounded-lg border cursor-pointer text-[16px] flex items-center justify-center disabled:opacity-40"
                          style={{background:'#f8fafc',borderColor:'#e2e8f0'}}>+</button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {totalPtsForProducts > 0 && (
                <div className="rounded-xl p-3 mb-4" style={{background:'#fffbeb', border:'1px solid #fde047'}}>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="text-slate-500">Points needed</span>
                    <span className="font-bold text-amber-600">{totalPtsForProducts.toLocaleString()} pts</span>
                  </div>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="text-slate-500">Free products value</span>
                    <span className="font-bold text-green-600">-${totalProductValue.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-slate-500">Remaining pts</span>
                    <span className="font-semibold">{(customerPts-totalPtsForProducts).toLocaleString()} pts</span>
                  </div>
                </div>
              )}

              <button onClick={applyPtsProduct}
                disabled={totalPtsForProducts===0 || totalPtsForProducts>customerPts}
                className="w-full rounded-2xl py-4 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
                🎁 Redeem {totalPtsForProducts>0 ? `${totalPtsForProducts.toLocaleString()} pts` : 'Points'}
              </button>
            </div>
          )}
        </div>
      </div>

      {showPad && (
        <NumPad title="Points to Use" subtitle={`Max: ${Math.floor(grandTotal*REDEEM_RATE).toLocaleString()} pts`}
          value={ptsInput} onChange={setPtsInput}
          suffix=" pts" allowNegative={false} allowDecimal={false}
          onConfirm={v => { setPtsInput(String(Math.min(v, effectiveMax))); setShowPad(false) }}
          onClose={() => setShowPad(false)}/>
      )}
    </div>
  )
}
