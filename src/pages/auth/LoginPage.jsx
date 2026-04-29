// src/pages/auth/LoginPage.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
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
      <div className="min-h-screen bg-[#07090f] flex items-center justify-center px-4">
        <div className="w-full max-w-[380px]">
          <div className="bg-[#0d1117] border border-yellow-500/30 rounded-2xl p-7">
            <div className="text-3xl text-center mb-4">⚠️</div>
            <div className="text-[15px] font-bold text-center mb-2">Already Signed In</div>
            <div className="text-[12px] text-[#8899b0] text-center mb-5">
              This account is currently active on{' '}
              <span className="text-yellow-400 font-bold">
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
                className="w-full bg-gradient-to-r from-yellow-500 to-orange-500
                  border-none rounded-[10px] py-3 text-[13px] font-bold text-black
                  disabled:opacity-50"
              >
                {loading ? '⏳ Signing in...' : '⚡ Sign in here (sign out other device)'}
              </button>
              <button
                onClick={() => handleKick(false)}
                disabled={loading}
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[10px]
                  py-3 text-[13px] text-[#8899b0] disabled:opacity-50"
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
    <div className="min-h-screen bg-[#07090f] flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="text-[32px] font-extrabold bg-gradient-to-r from-white to-cyan-400
            bg-clip-text text-transparent tracking-tight mb-2">RetailPOS</div>
          <div className="text-[13px] text-[#3d5068]">Sign in to your account</div>
          {terminal?.name && (
            <div className="text-[10px] font-mono text-[#3d5068] mt-2">
              🖥️ {terminal.name}
            </div>
          )}
        </div>

        <form onSubmit={handleLogin}
          className="bg-[#0d1117] border border-[#1e2d42] rounded-2xl p-7">
          <div className="mb-4">
            <label className="block text-[11px] font-bold text-[#8899b0] mb-2
              uppercase tracking-wider">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@store.com" autoFocus
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
                px-3.5 py-2.5 text-[13px] outline-none focus:border-blue-500/40
                transition-colors placeholder-[#3d5068]"/>
          </div>
          <div className="mb-6">
            <label className="block text-[11px] font-bold text-[#8899b0] mb-2
              uppercase tracking-wider">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
                px-3.5 py-2.5 text-[13px] outline-none focus:border-blue-500/40
                transition-colors placeholder-[#3d5068]"/>
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 border-none
              rounded-[11px] py-3 text-[14px] font-bold text-white
              hover:shadow-[0_4px_20px_rgba(59,130,246,0.3)]
              disabled:opacity-50 disabled:cursor-not-allowed transition-all">
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>
      </div>
    </div>
  )
}
