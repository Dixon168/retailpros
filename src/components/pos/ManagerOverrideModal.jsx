// src/components/pos/ManagerOverrideModal.jsx
// Pops up when a cashier tries to do something their role marks as 'prompt'.
// A user with the SAME permission set to 'allow' must enter their PIN.
//
// Usage:
//   <ManagerOverrideModal
//     permission="pos.refund"
//     action="process this refund"
//     onApprove={(approver) => { ... do the thing, log who approved ... }}
//     onClose={() => setShowOverride(null)}
//   />

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { labelFor } from '@/lib/permissions'
import toast from 'react-hot-toast'

export default function ManagerOverrideModal({ permission, action, onApprove, onClose }) {
  const { tenant } = useAuthStore()
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
      // Look up the PIN
      const { data: pinResult, error: pinErr } = await supabase.rpc('fn_pin_login', {
        p_tenant_id: tenant.id, p_pin: pin
      })
      if (pinErr || !pinResult?.success) {
        throw new Error(pinResult?.message || pinErr?.message || 'Invalid PIN')
      }
      const u = pinResult.user
      // Admin/Owner always passes. Otherwise the approver must have 'allow' for this exact permission.
      const role = u.role?.toLowerCase()
      const v = u.permissions?.[permission]
      const hasAllow = role === 'admin' || role === 'owner' || v === 'allow' || v === true
      if (!hasAllow) {
        // The person whose PIN this is doesn't have allow-level access either
        throw new Error(`${u.name} can't approve this — needs a manager`)
      }
      onApprove(u)
      onClose()
    } catch (e) {
      toast.error(e.message)
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-3"
      style={{background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)'}}
      onClick={onClose}>
      <div className="rounded-3xl overflow-hidden shadow-2xl w-full"
        style={{maxWidth:'380px', background:'#FFFFFF'}}
        onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'linear-gradient(135deg,#7c2d12 0%,#451a03 100%)'}}>
          <div>
            <div className="text-[15px] font-bold text-white">🔐 Manager Override</div>
            <div className="text-[10px] text-amber-200 mt-0.5">Required to {action}</div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
        </div>

        <div className="px-6 py-5">
          <div className="rounded-lg px-3 py-2 mb-4 text-[11px]"
            style={{background:'#fffbeb', border:'1px solid #fde047', color:'#92400e'}}>
            ⚠️ <b>Action requires approval:</b> {labelFor(permission)}
            <div className="text-[10px] mt-1 opacity-80">
              An authorized employee must enter their PIN. The override is logged.
            </div>
          </div>

          <div className="flex justify-center gap-2 mb-4 h-10 items-center">
            {Array(Math.max(4, pin.length)).fill(0).map((_, i) => (
              <div key={i} className="rounded-full transition-all"
                style={{
                  width: i < pin.length ? '14px' : '12px',
                  height: i < pin.length ? '14px' : '12px',
                  background: i < pin.length ? '#dc2626' : '#E5E5E5',
                }}/>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {['1','2','3','4','5','6','7','8','9'].map(k => (
              <button key={k} onClick={()=>press(k)} disabled={busy}
                className="rounded-xl text-[22px] font-bold cursor-pointer border-2 active:scale-90 transition-transform"
                style={{background:'#F8FAFC', borderColor:'#E5E5E5', color:'#1F1F1F', height:'52px'}}>
                {k}
              </button>
            ))}
            <button onClick={()=>setPin('')} disabled={busy || !pin}
              className="rounded-xl text-[12px] font-bold cursor-pointer border-2 disabled:opacity-40"
              style={{background:'#fff7ed', borderColor:'#fed7aa', color:'#ea580c', height:'52px'}}>
              Clear
            </button>
            <button onClick={()=>press('0')} disabled={busy}
              className="rounded-xl text-[22px] font-bold cursor-pointer border-2 active:scale-90 transition-transform"
              style={{background:'#F8FAFC', borderColor:'#E5E5E5', color:'#1F1F1F', height:'52px'}}>
              0
            </button>
            <button onClick={()=>press('⌫')} disabled={busy || !pin}
              className="rounded-xl text-[20px] font-bold cursor-pointer border-2 disabled:opacity-40"
              style={{background:'#fff1f2', borderColor:'#fecdd3', color:'#ef4444', height:'52px'}}>
              ⌫
            </button>
          </div>
          <button onClick={submit} disabled={busy || pin.length < 3}
            className="w-full mt-4 rounded-xl py-3 text-[14px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background:'#dc2626'}}>
            {busy ? '⏳ Verifying…' : '✓ Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}
