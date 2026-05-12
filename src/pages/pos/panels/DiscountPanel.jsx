// src/pages/pos/panels/DiscountPanel.jsx
// 整单折扣面板

import { useState } from 'react'
import NumPad from '@/components/ui/NumPad'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import { Overlay } from './SerialPanel'
import ManagerOverrideModal from '@/components/pos/ManagerOverrideModal'
import { logOverride } from '@/lib/auditOverride'
import toast from 'react-hot-toast'

export default function DiscountPanel() {
  const { totals, setOrderDiscount } = useCartStore()
  const { can, maxDiscountPct, user, tenant, store } = useAuthStore()
  const { activeEmployee } = useEmployeeStore()
  const [mode, setMode]       = useState('pct')   // 'pct' | 'amt'
  const [value, setValue]     = useState('')
  const [showPad, setShowPad] = useState(false)
  const [override, setOverride] = useState(null)
  const { subtotal } = totals()

  const close = () => useCartStore.setState({ showDiscPanel: false })

  // Permission lookup is tri-state ('allow' / 'prompt' / 'deny')
  const discountPerm = can('pos.discount')
  const maxPct       = maxDiscountPct()
  const canDiscount  = discountPerm !== 'deny' && (maxPct > 0 || discountPerm === 'prompt')

  const discAmt = (() => {
    const v = parseFloat(value) || 0
    if (mode === 'pct') return subtotal * (v / 100)
    return Math.min(v, subtotal)
  })()

  // Equivalent % of the discount amount — used to compare $-discounts to maxPct
  const effectivePct = (() => {
    if (mode === 'pct') return parseFloat(value) || 0
    if (subtotal <= 0) return 0
    return ((parseFloat(value) || 0) / subtotal) * 100
  })()

  const applyDiscount = (approver) => {
    setOrderDiscount({ type: mode, value: parseFloat(value) })
    if (approver) {
      logOverride({
        tenantId: tenant?.id, storeId: store?.id,
        permission:'pos.discount',
        actionLabel: `apply ${mode==='pct'?value+'%':'$'+value} discount (exceeds ${maxPct}% cap)`,
        requestedBy: activeEmployee
          ? { id: activeEmployee.id, name: activeEmployee.name }
          : { id: user?.id, name: user?.name },
        approver,
        amount: discAmt,
        notes: `Subtotal $${subtotal.toFixed(2)} · discount ${mode==='pct'?value+'%':'$'+value}`,
      })
    }
    close()
  }

  const apply = () => {
    const v = parseFloat(value) || 0
    if (v <= 0) { toast.error('Enter a discount value'); return }
    if (discountPerm === 'deny') { toast.error("You don't have permission to apply discounts"); return }

    // Within cap → just apply
    if (effectivePct <= maxPct) {
      applyDiscount(null)
      return
    }

    // Over the cap — needs a manager override (only if perm is 'prompt' or
    // if user happens to have 'allow' for pos.discount but a low max_pct)
    setOverride({
      permission:'pos.discount',
      action: `apply this ${effectivePct.toFixed(1)}% discount (your cap is ${maxPct}%)`,
      onApprove: (approver) => {
        toast.success(`✓ Approved by ${approver.name}`)
        applyDiscount(approver)
      },
    })
  }

  return (
    <Overlay onClose={close}>
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 w-[360px]">
        <div className="text-[15px] font-bold mb-1">✂️ Order Discount</div>
        <div className="text-[11px] font-mono text-[#999999] mb-4">
          APPLY TO ENTIRE ORDER
          {discountPerm === 'deny' && ' · NO PERMISSION'}
          {discountPerm === 'prompt' && ' · NEEDS APPROVAL'}
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
          <div className="text-[10px] mb-3 text-center rounded-md px-2 py-1.5"
            style={effectivePct > maxPct
              ? { background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a' }
              : { color:'#999999', fontFamily:'monospace' }}>
            {effectivePct > maxPct
              ? `⚠️ ${effectivePct.toFixed(1)}% exceeds your ${maxPct}% cap — manager approval required`
              : `Max discount: ${maxPct}%`}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={close}
            className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
              py-2.5 text-[13px] text-[#666666] font-sans">
            Cancel
          </button>
          <button onClick={apply} disabled={!canDiscount}
            className="flex-[2] border-none rounded-[9px] py-2.5
              text-[13px] font-bold text-white disabled:opacity-40
              disabled:cursor-not-allowed font-sans"
            style={{background: effectivePct > maxPct ? '#9333ea' : '#ec4899'}}>
            {effectivePct > maxPct ? '🔐 Apply with Override' : '✓ Apply'}
          </button>
        </div>
      </div>

      {override && (
        <ManagerOverrideModal
          permission={override.permission}
          action={override.action}
          onApprove={override.onApprove}
          onClose={() => setOverride(null)}/>
      )}
    </Overlay>
  )
}
