// src/pages/pos/panels/SerialPanel.jsx
// 序列号输入弹层 - 电子产品收银时使用

import { useState, useRef, useEffect } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

export default function SerialPanel() {
  const { pendingProduct, confirmSerialNumber } = useCartStore()
  const { tenant, store } = useAuthStore()
  const [sn, setSn] = useState('')
  const [status, setStatus] = useState(null) // null | 'checking' | 'valid' | 'invalid' | 'sold'
  const inputRef = useRef(null)

  useEffect(() => {
    // 打开时自动聚焦输入框（方便扫码枪）
    setTimeout(() => inputRef.current?.focus(), 150)
  }, [])

  const close = () => useCartStore.setState({ showSnPanel: false, pendingProduct: null })

  // 验证序列号（检查是否在库存中）
  const validateSN = async (value) => {
    if (value.length < 4) { setStatus(null); return }
    setStatus('checking')

    const { data } = await supabase
      .from('serial_numbers')
      .select('id, status, product_id')
      .eq('tenant_id', tenant.id)
      .eq('serial_number', value.trim())
      .maybeSingle()

    if (!data) {
      setStatus('invalid') // 序列号不存在
    } else if (data.status === 'sold') {
      setStatus('sold')    // 已售出
    } else if (data.product_id !== pendingProduct.id) {
      setStatus('invalid') // 不属于该商品
    } else {
      setStatus('valid')   // 可以销售
    }
  }

  const handleInput = (e) => {
    const val = e.target.value
    setSn(val)
    // 防抖验证（输入停止300ms后验证）
    clearTimeout(window._snTimer)
    window._snTimer = setTimeout(() => validateSN(val), 300)
  }

  const handleConfirm = () => {
    if (!sn.trim() || sn.length < 4) return
    // 不强制要求验证通过（允许手动输入未登记的序列号）
    confirmSerialNumber(sn.trim().toUpperCase())
    setSn('')
    setStatus(null)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleConfirm()
    if (e.key === 'Escape') close()
  }

  const statusConfig = {
    checking: { color: '#666666', text: '⏳ Checking...' },
    valid:    { color: '#10b981', text: '✓ Serial number verified — in stock' },
    invalid:  { color: '#ef4444', text: '✗ Serial number not found in inventory' },
    sold:     { color: '#ef4444', text: '✗ This unit has already been sold' },
  }

  return (
    <Overlay onClose={close}>
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 w-[380px]">

        <div className="text-[15px] font-bold mb-1">🔢 Enter Serial Number</div>
        <div className="text-[11px] font-mono text-[#999999] mb-5">
          SERIALIZED PRODUCT · REQUIRED
        </div>

        {/* 商品信息 */}
        <div className="flex items-center gap-2.5 bg-[#F5F5F5] border border-[#E5E5E5]
          rounded-[9px] p-3 mb-4">
          <span className="text-[24px]">📦</span>
          <div>
            <div className="text-[13px] font-semibold">{pendingProduct?.name}</div>
            <div className="text-[10px] font-mono text-[#999999] mt-0.5">
              SKU: {pendingProduct?.sku}
            </div>
          </div>
        </div>

        {/* 输入框 */}
        <input
          ref={inputRef}
          value={sn}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Scan or type serial number..."
          className={`w-full bg-[#F5F5F5] border rounded-[9px] px-3.5 py-3
            text-[14px] font-mono text-[#1F1F1F] outline-none tracking-wider
            transition-colors mb-2 ${
              status === 'valid' ? 'border-green-500/50' :
              status === 'invalid' || status === 'sold' ? 'border-red-500/50' :
              'border-[#E5E5E5] focus:border-yellow-500/40'
            }`}
        />

        {/* 验证状态 */}
        {status && statusConfig[status] && (
          <div className="text-[11px] font-mono px-2.5 py-1.5 rounded-md mb-4"
            style={{
              background: `${statusConfig[status].color}15`,
              color: statusConfig[status].color
            }}>
            {statusConfig[status].text}
          </div>
        )}

        {/* 按钮 */}
        <div className="flex gap-2 mt-4">
          <button onClick={close}
            className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
              py-2.5 text-[13px] text-[#666666] hover:text-[#1F1F1F] transition-colors font-sans">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!sn.trim() || sn.length < 4}
            className="flex-[2] bg-green-500 border-none rounded-[9px] py-2.5
              text-[13px] font-bold text-white hover:bg-green-600
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors font-sans">
            ✓ Confirm
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// 通用遮罩层
export function Overlay({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm z-50
        flex items-center justify-center animate-fade-up"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      {/* Always-visible close button — top right of viewport. Cart stays intact. */}
      {onClose && (
        <button onClick={onClose}
          className="fixed top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center text-white cursor-pointer border-none z-[60] active:scale-90 transition-transform"
          style={{background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)', fontSize:'18px'}}
          aria-label="Close panel — your cart will be preserved">
          ✕
        </button>
      )}
      {children}
    </div>
  )
}
