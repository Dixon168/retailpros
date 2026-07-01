// src/pages/pos/panels/WeightPanel.jsx
// 称重输入面板 - 数字键盘输入重量

import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { Overlay } from './SerialPanel'

export default function WeightPanel() {
  const { pendingProduct, confirmWeight } = useCartStore()
  const [input, setInput] = useState('')

  const close = () => useCartStore.setState({ showWtPanel: false, pendingProduct: null })

  const weight = parseFloat(input) || 0
  const lineTotal = weight * (pendingProduct?.price || 0)

  const press = (val) => {
    if (val === '.' && input.includes('.')) return
    if (input === '0' && val !== '.') { setInput(val); return }
    setInput(prev => prev + val)
  }

  const del = () => setInput(prev => prev.slice(0, -1))

  const confirm = () => {
    if (weight <= 0) return
    confirmWeight(weight)
  }

  const KEYS = ['7','8','9','4','5','6','1','2','3','.','0','⌫']
  // decimal already included above

  return (
    <Overlay onClose={close}>
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 w-[320px]">
        <div className="text-[15px] font-bold mb-1">⚖️ Enter Weight</div>
        <div className="text-[11px] font-mono text-[#999999] mb-4">
          {pendingProduct?.name?.toUpperCase()} · ${pendingProduct?.price?.toFixed(2)}/lb
        </div>

        {/* 重量显示 */}
        <div className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[10px] p-4 text-center mb-4">
          <div className="text-[40px] font-bold font-mono text-[#00B23B] leading-none">
            {input || '0.00'}
          </div>
          <div className="text-[14px] text-[#666666] mt-1">pounds (lb)</div>
          <div className="text-[12px] font-mono text-[#999999] mt-1.5">
            = ${lineTotal.toFixed(2)}
          </div>
        </div>

        {/* 数字键盘 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {KEYS.map(k => (
            <button
              key={k}
              onClick={() => k === '⌫' ? del() : press(k)}
              className={`bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] py-3.5
                text-[16px] font-semibold font-mono text-center transition-all
                hover:bg-[#F5F5F5] hover:border-[#E5E5E5] active:scale-95
                ${k === '⌫' ? 'text-[#dc2626]' : k === '.' ? 'text-cyan-400' : 'text-[#1F1F1F]'}`}>
              {k}
            </button>
          ))}
        </div>

        {/* 按钮 */}
        <div className="flex gap-2">
          <button onClick={close}
            className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
              py-2.5 text-[13px] text-[#666666] font-sans">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={weight <= 0}
            className="flex-[2] bg-green-500 border-none rounded-[9px] py-2.5
              text-[13px] font-bold text-white disabled:opacity-40
              disabled:cursor-not-allowed font-sans">
            ✓ Add to Cart
          </button>
        </div>
      </div>
    </Overlay>
  )
}
