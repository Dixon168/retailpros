// src/pages/pos/panels/PricePanel.jsx
// 自定义价格输入面板 - 数字键盘
// 触发：product.prompt_price = true
// 如果同时有 prompt_weight，在重量输入后弹出

import { useState } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { Overlay } from './SerialPanel'

export default function PricePanel() {
  const { pendingProduct, pendingWeight, confirmPrice } = useCartStore()
  const [input, setInput] = useState('')

  const close = () => useCartStore.setState({
    showPricePanel: false,
    pendingProduct: null,
    pendingWeight: null,
  })

  const price = parseFloat(input) || 0

  const press = (val) => {
    if (val === '.' && input.includes('.')) return
    if (val === '-') {
      // Toggle negative (for adjustments / discounts)
      setInput(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev)
      return
    }
    if (input === '0' && val !== '.') { setInput(val); return }
    if (input === '' && val === '.') { setInput('0.'); return }
    setInput(prev => prev + val)
  }

  const del = () => setInput(prev => prev.slice(0, -1) || '')

  const confirm = () => {
    if (price <= 0) return
    confirmPrice(price)
  }

  const KEYS = ['7','8','9','4','5','6','1','2','3','-','.','⌫']

  return (
    <Overlay onClose={close}>
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 w-[320px]">

        {/* Header */}
        <div className="text-[15px] font-bold mb-1">💲 Enter Price</div>
        <div className="text-[11px] font-mono text-[#999999] mb-4">
          {pendingProduct?.name?.toUpperCase()}
          {pendingWeight && (
            <span className="ml-2 text-[#00B23B]">
              · {pendingWeight} {pendingProduct?.unit || 'lb'}
            </span>
          )}
        </div>

        {/* Step indicator if both weight + price */}
        {pendingWeight && (
          <div className="flex items-center gap-2 mb-4 bg-[#F5F5F5] border border-[#E5E5E5]
            rounded-[9px] px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-[10px] font-bold text-black">✓</span>
              <span className="text-[11px] text-[#00B23B]">Weight: {pendingWeight} {pendingProduct?.unit||'lb'}</span>
            </div>
            <span className="text-[#999999] mx-1">→</span>
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-[#5E6AD2] flex items-center justify-center text-[10px] font-bold text-white">2</span>
              <span className="text-[11px] text-[#5E6AD2]">Enter Price</span>
            </div>
          </div>
        )}

        {/* Price display */}
        <div className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-[10px] p-4 mb-4 text-center">
          <div className="text-[11px] font-mono text-[#999999] mb-1">PRICE PER {pendingProduct?.unit?.toUpperCase() || 'EA'}</div>
          <div className="text-[36px] font-bold font-mono text-[#5E6AD2] min-h-[44px]">
            {input ? `$${input}` : <span className="text-[#999999]">$0.00</span>}
          </div>
          {pendingWeight && price > 0 && (
            <div className="text-[13px] font-mono text-[#00B23B] mt-1.5 border-t border-[#E5E5E5] pt-1.5">
              Total: ${(pendingWeight * price).toFixed(2)}
            </div>
          )}
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {KEYS.map(k => (
            <button
              key={k}
              onClick={() => k === '⌫' ? del() : press(k)}
              className={`py-3.5 rounded-[10px] text-[16px] font-bold font-mono
                border transition-all cursor-pointer active:scale-95 ${
                k === '⌫'
                  ? 'bg-red-500/10 border-red-500/20 text-[#dc2626] hover:bg-red-500/15'
                  : k === '-'
                  ? 'bg-yellow-500/10 border-yellow-500/20 text-[#FA8C16] hover:bg-yellow-500/15'
                  : 'bg-[#F5F5F5] border-[#E5E5E5] text-[#1F1F1F] hover:bg-[#F5F5F5] hover:border-[#E5E5E5]'
              }`}>
              {k}
            </button>
          ))}
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button onClick={close}
            className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[10px] py-3
              text-[13px] text-[#666666] cursor-pointer hover:text-[#1F1F1F] transition-colors">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={price <= 0}
            className="flex-[2] bg-[#5E6AD2] border-none
              rounded-[10px] py-3 text-[13px] font-bold text-white cursor-pointer
              disabled:opacity-40 disabled:cursor-not-allowed
              hover:from-blue-500 hover:to-blue-600 transition-all">
            ✓ Add ${price.toFixed(2)}{pendingWeight ? ` × ${pendingWeight}` : ''}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
