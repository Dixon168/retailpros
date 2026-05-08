// src/components/pos/ShiftModal.jsx
// 开班 / 收班 弹窗

import { useState } from 'react'
import NumPad from '@/components/ui/NumPad'
import { useTerminalStore } from '@/stores/terminalStore'
import { useAuthStore } from '@/stores/authStore'

export function OpenShiftModal({ onClose }) {
  const { openShift, terminal } = useTerminalStore()
  const { user, tenant, store } = useAuthStore()
  const [amount, setAmount]   = useState('')
  const [loading, setLoading] = useState(false)
  const [showPad, setShowPad] = useState(false)

  const QUICK = [0, 50, 100, 200, 300, 500]

  const handleOpen = async () => {
    setLoading(true)
    try {
      await openShift(tenant.id, store.id, user.id, parseFloat(amount) || 0)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm z-50
      flex items-center justify-center">
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[380px]">

        <div className="px-6 py-5 border-b border-[#1e2d42]">
          <div className="text-[16px] font-bold">☀️ Open Shift</div>
          <div className="text-[11px] text-[#3d5068] font-mono mt-1">
            {terminal?.name} · {user?.name}
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="text-[11px] font-bold text-[#8899b0] uppercase
            tracking-wider mb-2">Opening Float (Cash in Drawer)</div>

          {/* Amount input */}
          <button onClick={() => setShowPad(true)}
            className="w-full flex items-center rounded-[10px] px-4 mb-3 cursor-pointer border"
            style={{background:'#111827', borderColor: amount ? '#22c55e' : '#1e2d42'}}>
            <span className="text-[#3d5068] text-lg font-bold mr-2">$</span>
            <span className="flex-1 py-3 text-[22px] font-bold font-mono text-right"
              style={{color: amount ? '#fff' : '#3d5068'}}>
              {amount || '0.00'}
            </span>
          </button>
          {showPad && (
            <NumPad title="Opening Float" prefix="$"
              value={amount} onChange={setAmount}
              allowNegative={false} allowDecimal={true}
              onConfirm={v=>{setAmount(v.toFixed(2));setShowPad(false)}}
              onClose={()=>setShowPad(false)}/>
          )}

          {/* Quick amounts */}
          <div className="grid grid-cols-3 gap-1.5 mb-5">
            {QUICK.map(q => (
              <button key={q} onClick={() => setAmount(q.toFixed(2))}
                className="bg-[#111827] border border-[#1e2d42] rounded-lg py-2
                  text-[12px] font-mono text-[#8899b0] hover:border-green-500/30
                  hover:text-green-400 transition-all">
                ${q}
              </button>
            ))}
          </div>

          <button onClick={handleOpen} disabled={loading}
            className="w-full bg-gradient-to-r from-green-500 to-green-600 border-none
              rounded-[10px] py-3.5 text-[14px] font-bold text-white disabled:opacity-50">
            {loading ? '⏳ Opening...' : '✓ Open Shift'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CloseShiftModal({ onClose }) {
  const { closeShift, currentShift, terminal } = useTerminalStore()
  const { user } = useAuthStore()
  const [amount, setAmount]   = useState('')
  const [loading, setLoading] = useState(false)

  const shiftDuration = currentShift
    ? Math.round((Date.now() - new Date(currentShift.opened_at)) / 60_000)
    : 0

  const handleClose = async () => {
    setLoading(true)
    try {
      await closeShift(parseFloat(amount) || 0)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm z-50
      flex items-center justify-center">
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[400px]">

        <div className="px-6 py-5 border-b border-[#1e2d42]">
          <div className="text-[16px] font-bold">🌙 Close Shift</div>
          <div className="text-[11px] text-[#3d5068] font-mono mt-1">
            {terminal?.name} · {user?.name} · {shiftDuration} min
          </div>
        </div>

        <div className="px-6 py-5">
          {/* Shift summary */}
          <div className="bg-[#111827] border border-[#1e2d42] rounded-[10px]
            px-4 py-3.5 mb-4">
            <div className="text-[11px] font-bold text-[#8899b0] uppercase
              tracking-wider mb-2.5">Shift Summary</div>
            {[
              ['Opened At',    new Date(currentShift?.opened_at).toLocaleTimeString()],
              ['Opening Float', `$${(currentShift?.opening_amount || 0).toFixed(2)}`],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between mb-1.5">
                <span className="text-[11px] text-[#3d5068]">{l}</span>
                <span className="text-[12px] font-mono">{v}</span>
              </div>
            ))}
          </div>

          <div className="text-[11px] font-bold text-[#8899b0] uppercase
            tracking-wider mb-2">Actual Cash in Drawer</div>

          <div className="flex items-center bg-[#111827] border border-[#1e2d42]
            rounded-[10px] px-4 mb-5 focus-within:border-blue-500/40 transition-colors">
            <span className="text-[#3d5068] text-lg font-bold mr-2">$</span>
            <input
              autoFocus
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-transparent border-none outline-none py-3
                text-[22px] font-bold font-mono text-right"
            />
          </div>

          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px]
                py-2.5 text-[13px] text-[#8899b0]">
              Cancel
            </button>
            <button onClick={handleClose} disabled={loading || !amount}
              className="flex-[2] bg-gradient-to-r from-blue-600 to-blue-700
                border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white
                disabled:opacity-40">
              {loading ? '⏳ Closing...' : '✓ Close Shift & Print Report'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
