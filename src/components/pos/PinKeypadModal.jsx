// src/components/pos/PinKeypadModal.jsx
// Reusable PIN keypad. Caller decides what to do with the PIN:
//
//   mode='signin'    → Sign in to the app (no clock effect)
//   mode='clockin'   → Verify PIN + clock in for payroll
//   mode='clockout'  → Verify PIN + clock out for payroll
//
// On success, `onSuccess(user, action)` is called with details.
//
// Touch-friendly 10-key — no soft keyboard. Auto-hidden dots reveal length.
import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import toast from 'react-hot-toast'

const MODES = {
  signin: {
    title:'🔐 Sign In',
    subtitle:'Enter your PIN to use this terminal',
    submitLabel:'✓ Sign In',
    color:'#5E6AD2',
    gradient:'linear-gradient(135deg,#1e293b 0%,#0f172a 100%)',
  },
  clockin: {
    title:'⏰ Clock In',
    subtitle:'Enter your PIN to start your shift',
    submitLabel:'✓ Clock In',
    color:'#10b981',
    gradient:'linear-gradient(135deg,#065f46 0%,#064e3b 100%)',
  },
  clockout: {
    title:'🌙 Clock Out',
    subtitle:'Enter your PIN to end your shift',
    submitLabel:'✓ Clock Out',
    color:'#9333ea',
    gradient:'linear-gradient(135deg,#581c87 0%,#3b0764 100%)',
  },
}

export default function PinKeypadModal({ mode = 'signin', onSuccess, onClose }) {
  const cfg = MODES[mode] || MODES.signin
  const { tenant, store } = useAuthStore()
  const { terminal } = useTerminalStore()
  const { signInWithPin, verifyPin, clockIn, clockOut } = useEmployeeStore()
  const [pin, setPin]   = useState('')
  const [busy, setBusy] = useState(false)

  const press = (k) => {
    if (k === '⌫') return setPin(p => p.slice(0, -1))
    if (pin.length >= 8) return
    setPin(p => p + k)
  }

  const submit = async () => {
    if (pin.length < 3) { toast.error('PIN too short'); return }
    setBusy(true)
    try {
      let user, info = {}
      if (mode === 'signin') {
        user = await signInWithPin(tenant.id, pin)
      } else if (mode === 'clockin') {
        user = await verifyPin(tenant.id, pin)
        info = await clockIn({
          tenantId: tenant.id, storeId: store?.id,
          terminalId: terminal?.id, userId: user.id,
        })
        const hr = info.duration_min ? Math.floor(info.duration_min/60) : 0
        const mn = info.duration_min ? info.duration_min%60 : 0
        toast.success(`✓ ${user.name} clocked in`)
      } else if (mode === 'clockout') {
        user = await verifyPin(tenant.id, pin)
        info = await clockOut({ userId: user.id })
        const h = Math.floor((info.duration_min||0)/60)
        const m = (info.duration_min||0) % 60
        toast.success(`✓ ${user.name} clocked out — ${h}h ${m}m worked · $${Number(info.earned_amount||0).toFixed(2)}`)
      }
      onSuccess?.(user, info)
      onClose()
    } catch (e) {
      toast.error(e.message)
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center"
      style={{background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)'}}>
      <div className="rounded-3xl overflow-hidden shadow-2xl"
        style={{width:'360px', background:'#FFFFFF'}}>
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background: cfg.gradient}}>
          <div>
            <div className="text-[15px] font-bold text-white">{cfg.title}</div>
            <div className="text-[10px] text-white/70 mt-0.5">{terminal?.name || 'Terminal'} · {store?.name}</div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
        </div>

        <div className="px-6 py-5">
          <div className="flex justify-center gap-2 mb-5 h-12 items-center">
            {Array(Math.max(4, pin.length)).fill(0).map((_, i) => (
              <div key={i} className="rounded-full transition-all"
                style={{
                  width: i < pin.length ? '14px' : '12px',
                  height: i < pin.length ? '14px' : '12px',
                  background: i < pin.length ? cfg.color : '#E5E5E5',
                }}/>
            ))}
          </div>
          <div className="text-[10px] text-center text-slate-500 mb-4">{cfg.subtitle}</div>

          <div className="grid grid-cols-3 gap-2.5">
            {['1','2','3','4','5','6','7','8','9'].map(k => (
              <button key={k} onClick={()=>press(k)} disabled={busy}
                className="rounded-xl text-[22px] font-bold cursor-pointer border-2 active:scale-90 transition-transform"
                style={{background:'#F8FAFC', borderColor:'#E5E5E5', color:'#1F1F1F', height:'56px'}}>
                {k}
              </button>
            ))}
            <button onClick={()=>setPin('')} disabled={busy || !pin}
              className="rounded-xl text-[12px] font-bold cursor-pointer border-2 disabled:opacity-40"
              style={{background:'#fff7ed', borderColor:'#fed7aa', color:'#ea580c', height:'56px'}}>
              Clear
            </button>
            <button onClick={()=>press('0')} disabled={busy}
              className="rounded-xl text-[22px] font-bold cursor-pointer border-2 active:scale-90 transition-transform"
              style={{background:'#F8FAFC', borderColor:'#E5E5E5', color:'#1F1F1F', height:'56px'}}>
              0
            </button>
            <button onClick={()=>press('⌫')} disabled={busy || !pin}
              className="rounded-xl text-[20px] font-bold cursor-pointer border-2 disabled:opacity-40"
              style={{background:'#fff1f2', borderColor:'#fecdd3', color:'#ef4444', height:'56px'}}>
              ⌫
            </button>
          </div>
          <button onClick={submit} disabled={busy || pin.length < 3}
            className="w-full mt-4 rounded-xl py-3.5 text-[15px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background: cfg.color}}>
            {busy ? '⏳ Working…' : cfg.submitLabel}
          </button>
          <div className="text-[10px] text-slate-400 text-center mt-3">
            Ask your manager if you don't have a PIN
          </div>
        </div>
      </div>
    </div>
  )
}
