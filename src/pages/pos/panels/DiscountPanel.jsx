// src/pages/pos/panels/DiscountPanel.jsx
// 整单折扣面板

import { useState } from 'react'
import NumPad from '@/components/ui/NumPad'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { Overlay } from './SerialPanel'
import toast from 'react-hot-toast'

export default function DiscountPanel() {
  const { totals, setOrderDiscount } = useCartStore()
  const { can, maxDiscountPct } = useAuthStore()
  const [mode, setMode] = useState('pct')   // 'pct' | 'amt'
  const [value, setValue] = useState('')
  const { subtotal } = totals()

  const close = () => useCartStore.setState({ showDiscPanel: false })

  // 权限检查
  const maxPct = maxDiscountPct()
  const canDiscount = can('can_discount') && maxPct > 0

  const discAmt = (() => {
    const v = parseFloat(value) || 0
    if (mode === 'pct') return subtotal * (v / 100)
    return Math.min(v, subtotal)
  })()

  const apply = () => {
    const v = parseFloat(value) || 0
    if (v <= 0) { toast.error('Enter a discount value'); return }
    if (!canDiscount) { toast.error('No permission to discount'); return }
    if (mode === 'pct' && v > maxPct) {
      toast.error(`Max discount: ${maxPct}%`)
      return
    }
    setOrderDiscount({ type: mode, value: v })
    close()
  }

  return (
    <Overlay onClose={close}>
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 w-[360px]">
        <div className="text-[15px] font-bold mb-1">✂️ Order Discount</div>
        <div className="text-[11px] font-mono text-[#999999] mb-4">
          APPLY TO ENTIRE ORDER
          {!canDiscount && ' · NO PERMISSION'}
        </div>

        {/* 模式切换 */}
        <div className="flex gap-1.5 mb-4">
          {[
            { id: 'pct', label: '% Percentage' },
            { id: 'amt', label: '$ Fixed Amount' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setMode(tab.id)}
              className={`flex-1 py-2 rounded-lg text-[11px] border transition-all cursor-pointer
                font-sans ${mode === tab.id
                  ? 'border-pink-500/40 bg-pink-500/8 text-pink-400'
                  : 'border-[#E5E5E5] bg-[#F5F5F5] text-[#666666]'
                }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 输入 */}
        <div className="flex gap-2 items-center mb-3">
          <button onClick={() => setShowPad(true)} disabled={!canDiscount}
            className="flex-1 rounded-lg px-3 py-3 text-[20px] font-mono text-right cursor-pointer border disabled:opacity-40"
            style={{background:'#F5F5F5', borderColor:'#E5E5E5', color: value ? '#f472b6' : '#999999'}}>
            {value || '0'}
          </button>
          <div className="rounded-lg px-3 py-3 text-[14px] font-bold"
            style={{background:'#F5F5F5', border:'1px solid #E5E5E5', color:'#666666'}}>
            {mode === 'pct' ? '%' : '$'}
          </div>
        </div>
        {showPad && (
          <NumPad title={mode==='pct'?'Discount %':'Discount $'}
            value={value} onChange={setValue}
            prefix={mode==='amt'?'$':''} suffix={mode==='pct'?'%':''}
            allowNegative={false} allowDecimal={true}
            onConfirm={v=>{setValue(String(v));setShowPad(false)}}
            onClose={()=>setShowPad(false)}/>
        )}

        {/* 折扣预览 */}
        <div className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
          px-3 py-2.5 flex justify-between mb-4">
          <div className="text-center">
            <div className="text-[10px] text-[#999999]">Subtotal</div>
            <div className="text-[13px] font-bold text-[#00B23B] font-mono">
              ${subtotal.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-[#999999]">Discount</div>
            <div className="text-[13px] font-bold text-[#CF1322] font-mono">
              -${discAmt.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-[#999999]">After</div>
            <div className="text-[13px] font-bold font-mono">
              ${(subtotal - discAmt).toFixed(2)}
            </div>
          </div>
        </div>

        {maxPct < 100 && canDiscount && (
          <div className="text-[10px] font-mono text-[#999999] mb-4 text-center">
            Max discount: {maxPct}%
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={close}
            className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
              py-2.5 text-[13px] text-[#666666] font-sans">
            Cancel
          </button>
          <button onClick={apply} disabled={!canDiscount}
            className="flex-[2] bg-pink-500 border-none rounded-[9px] py-2.5
              text-[13px] font-bold text-white disabled:opacity-40
              disabled:cursor-not-allowed font-sans">
            ✓ Apply
          </button>
        </div>
      </div>
    </Overlay>
  )
}
