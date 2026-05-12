// src/pages/auth/LoginPage.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { APP_VERSION_LABEL, APP_COPYRIGHT } from '@/lib/version'
import { useTerminalStore } from '@/stores/terminalStore'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const { signIn, resolveSessionConflict, sessionConflict } = useAuthStore()
  const { terminal } = useTerminalStore()
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e?.preventDefault()
    if (!email || !password) { toast.error('Enter email and password'); return }
    setLoading(true)
    try {
      const result = await signIn(email, password, terminal?.name || 'Unknown terminal')
      if (result?.success) navigate('/pos')
      // if needsConflictResolution → sessionConflict state triggers the modal below
    } catch (err) {
      toast.error(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleKick = async (kick) => {
    setLoading(true)
    await resolveSessionConflict(kick)
    setLoading(false)
    if (kick) navigate('/pos')
  }

  // ── Session conflict modal ──
  if (sessionConflict) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center px-4">
        <div className="w-full max-w-[380px]">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-7 shadow-sm">
            <div className="text-3xl text-center mb-4">⚠️</div>
            <div className="text-[16px] font-bold text-center mb-2 text-[#1F1F1F]">Already Signed In</div>
            <div className="text-[13px] text-[#666666] text-center mb-5 leading-relaxed">
              This account is currently active on{' '}
              <span className="text-[#FA8C16] font-bold">
                {sessionConflict.existing_terminal}
              </span>
              <br/>
              Last active:{' '}
              {sessionConflict.last_active_at
                ? format(new Date(sessionConflict.last_active_at), 'MMM d, h:mm a')
                : '—'
              }
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleKick(true)}
                disabled={loading}
                className="w-full bg-[#FA8C16] hover:bg-[#D97706]
                  border-none rounded-[8px] py-3 text-[14px] font-semibold text-white
                  disabled:opacity-50 transition-colors"
              >
                {loading ? '⏳ Signing in...' : '⚡ Sign in here (sign out other device)'}
              </button>
              <button
                onClick={() => handleKick(false)}
                disabled={loading}
                className="w-full bg-[#FFFFFF] border border-[#E5E5E5] hover:bg-[#F5F5F5] rounded-[8px]
                  py-3 text-[14px] text-[#666666] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Normal login ──
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="text-[32px] font-extrabold text-[#1F1F1F] tracking-tight mb-2">RetailPOS</div>
          <div className="text-[13px] text-[#666666]">Sign in to your account</div>
          {terminal?.name && (
            <div className="text-[10px] font-mono text-[#999999] mt-2">
              🖥️ {terminal.name}
            </div>
          )}
        </div>

        <form onSubmit={handleLogin}
          className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-7 shadow-sm">
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-[#666666] mb-2
              uppercase tracking-wider">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@store.com" autoFocus
              className="w-full bg-[#FFFFFF] border border-[#E5E5E5] rounded-[8px]
                px-3.5 py-2.5 text-[14px] text-[#1F1F1F] outline-none focus:border-[#006AFF]
                focus:ring-2 focus:ring-[#E6F0FF] transition-all placeholder-[#999999]"/>
          </div>
          <div className="mb-6">
            <label className="block text-[11px] font-semibold text-[#666666] mb-2
              uppercase tracking-wider">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#FFFFFF] border border-[#E5E5E5] rounded-[8px]
                px-3.5 py-2.5 text-[14px] text-[#1F1F1F] outline-none focus:border-[#006AFF]
                focus:ring-2 focus:ring-[#E6F0FF] transition-all placeholder-[#999999]"/>
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-[#000000] hover:bg-[#1F1F1F] border-none
              rounded-[8px] py-3 text-[14px] font-semibold text-white
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>

        {/* Software branding — subtle, bottom of login card */}
        <div className="text-center pt-4 border-t border-slate-100 text-[10px] text-slate-400">
          {APP_VERSION_LABEL} · {APP_COPYRIGHT}
        </div>
      </div>
    </div>
  )
}
