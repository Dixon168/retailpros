// src/pages/terminal/TerminalSetup.jsx
// 终端首次启动配置向导
// 触发条件：localStorage 里没有 terminalId，或找不到对应的数据库记录

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
import { paxGetStatus } from '@/lib/pax'

const PAX_MODELS = [
  { id: 'A920',    label: 'PAX A920 (Android, handheld)' },
  { id: 'A920Pro', label: 'PAX A920Pro (Android, large screen)' },
  { id: 'A80',     label: 'PAX A80 (countertop)' },
  { id: 'A35',     label: 'PAX A35 (countertop, PIN pad)' },
  { id: 'S300',    label: 'PAX S300 (PIN pad)' },
  { id: 'E600',    label: 'PAX E600 (all-in-one)' },
  { id: 'IM30',    label: 'PAX IM30 (smart POS)' },
  { id: 'other',   label: 'Other PAX model' },
]

export default function TerminalSetup({ onComplete }) {
  const { tenant, store: defaultStore } = useAuthStore()
  const { register } = useTerminalStore()

  const [step, setStep] = useState(1)       // 1=基本信息, 2=PAX配置, 3=测试连接
  const [form, setForm] = useState({
    name:       '',
    storeId:    defaultStore?.id || '',
    paxEnabled: false,
    paxIp:      '',
    paxPort:    '10009',
    paxModel:   'A920',
  })
  const [paxTestResult, setPaxTestResult] = useState(null) // null | 'testing' | 'ok' | 'fail'
  const [saving, setSaving] = useState(false)

  // 门店列表
  const { data: stores = [] } = useQuery({
    queryKey: ['stores', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('stores')
        .select('id, name').eq('tenant_id', tenant.id).eq('is_active', true)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  // 测试 PAX 连接
  const testPax = async () => {
    if (!form.paxIp) return
    setPaxTestResult('testing')
    const result = await paxGetStatus({
      paxIp:   form.paxIp,
      paxPort: parseInt(form.paxPort) || 10009,
    })
    setPaxTestResult(result.online ? 'ok' : 'fail')
  }

  // 完成注册（含配额检查）
  const handleFinish = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      // ── 配额检查 ──
      const { checkTerminalQuota } = useAuthStore.getState()
      const quota = await checkTerminalQuota()
      if (!quota?.allowed) {
        toast.error(quota?.message || 'Terminal limit reached. Please upgrade your plan.')
        setSaving(false)
        return
      }
      await register(tenant.id, form.storeId, {
        name:       form.name.trim(),
        paxIp:      form.paxEnabled ? form.paxIp : null,
        paxPort:    parseInt(form.paxPort) || 10009,
        paxModel:   form.paxEnabled ? form.paxModel : null,
        paxEnabled: form.paxEnabled && !!form.paxIp,
      })
      onComplete?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#07090f] flex items-center justify-center p-4">
      <div className="w-full max-w-[480px]">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-[32px] font-extrabold bg-gradient-to-r from-white to-cyan-400
            bg-clip-text text-transparent mb-2">RetailPOS</div>
          <div className="text-[13px] text-[#3d5068]">Terminal Setup</div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 mb-7">
          {[
            [1, 'Terminal Info'],
            [2, 'Card Reader'],
            [3, 'Confirm'],
          ].map(([n, label], i) => (
            <div key={n} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center
                  text-[11px] font-bold transition-all ${
                  step >= n
                    ? 'bg-blue-500 text-white'
                    : 'bg-[#111827] border border-[#1e2d42] text-[#3d5068]'
                }`}>{n}</div>
                <div className={`text-[9px] mt-1 font-mono uppercase tracking-wider ${
                  step >= n ? 'text-blue-400' : 'text-[#3d5068]'
                }`}>{label}</div>
              </div>
              {i < 2 && (
                <div className={`h-px flex-1 mb-4 transition-all ${
                  step > n ? 'bg-blue-500' : 'bg-[#1e2d42]'
                }`}/>
              )}
            </div>
          ))}
        </div>

        <div className="bg-[#0d1117] border border-[#1e2d42] rounded-2xl p-6">

          {/* ── Step 1: 基本信息 ── */}
          {step === 1 && (
            <div>
              <div className="text-[15px] font-bold mb-4">🖥️ Name This Terminal</div>

              <div className="mb-4">
                <Label>Terminal Name</Label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={e => update('name', e.target.value)}
                  placeholder="e.g. Front Counter, Terminal 1, Warehouse"
                  className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
                    px-3.5 py-2.5 text-[13px] outline-none focus:border-blue-500/40
                    transition-colors placeholder-[#3d5068]"
                />
                <div className="text-[10px] text-[#3d5068] mt-1.5">
                  This name appears in reports and shift summaries
                </div>
              </div>

              <div className="mb-5">
                <Label>Store</Label>
                <select
                  value={form.storeId}
                  onChange={e => update('storeId', e.target.value)}
                  className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
                    px-3.5 py-2.5 text-[13px] outline-none focus:border-blue-500/40
                    text-[#e8edf5]"
                >
                  <option value="">Select store...</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!form.name.trim() || !form.storeId}
                className="w-full bg-blue-500 border-none rounded-[10px] py-3
                  text-[13px] font-bold text-white disabled:opacity-40
                  disabled:cursor-not-allowed"
              >
                Next: Card Reader →
              </button>
            </div>
          )}

          {/* ── Step 2: PAX 配置 ── */}
          {step === 2 && (
            <div>
              <div className="text-[15px] font-bold mb-1">💳 Card Reader (PAX)</div>
              <div className="text-[11px] text-[#3d5068] mb-4">
                Configure the PAX terminal connected to this machine
              </div>

              {/* Enable toggle */}
              <div className="flex items-center justify-between bg-[#111827]
                border border-[#1e2d42] rounded-[10px] px-4 py-3 mb-4">
                <div>
                  <div className="text-[13px] font-semibold">Enable PAX Card Reader</div>
                  <div className="text-[10px] text-[#3d5068] mt-0.5">
                    This terminal accepts credit/debit cards via PAX
                  </div>
                </div>
                <button
                  onClick={() => update('paxEnabled', !form.paxEnabled)}
                  className="w-[42px] h-[24px] rounded-full relative transition-colors flex-shrink-0"
                  style={{ background: form.paxEnabled ? '#3b82f6' : '#3d5068' }}
                >
                  <div className="absolute top-[3px] w-[18px] h-[18px] rounded-full
                    bg-white transition-all"
                    style={{ left: form.paxEnabled ? '21px' : '3px' }}
                  />
                </button>
              </div>

              {form.paxEnabled && (
                <div>
                  <div className="mb-3">
                    <Label>PAX IP Address (LAN)</Label>
                    <input
                      value={form.paxIp}
                      onChange={e => { update('paxIp', e.target.value); setPaxTestResult(null) }}
                      placeholder="192.168.1.50"
                      className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
                        px-3.5 py-2.5 text-[13px] font-mono outline-none
                        focus:border-blue-500/40 transition-colors placeholder-[#3d5068]"
                    />
                    <div className="text-[10px] text-[#3d5068] mt-1.5">
                      Find PAX IP: Settings → Network → IP Address on the PAX screen
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <Label>Port</Label>
                      <input
                        value={form.paxPort}
                        onChange={e => update('paxPort', e.target.value)}
                        className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
                          px-3.5 py-2.5 text-[13px] font-mono outline-none focus:border-blue-500/40"
                      />
                    </div>
                    <div>
                      <Label>PAX Model</Label>
                      <select
                        value={form.paxModel}
                        onChange={e => update('paxModel', e.target.value)}
                        className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
                          px-3.5 py-2.5 text-[12px] outline-none text-[#e8edf5]"
                      >
                        {PAX_MODELS.map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Test button */}
                  <button
                    onClick={testPax}
                    disabled={!form.paxIp || paxTestResult === 'testing'}
                    className="w-full bg-[#111827] border border-[#243347] rounded-[9px]
                      py-2.5 text-[12px] text-[#8899b0] disabled:opacity-40
                      hover:border-blue-500/30 hover:text-blue-400 transition-all mb-2"
                  >
                    {paxTestResult === 'testing' ? '⏳ Testing connection...' : '🔌 Test Connection'}
                  </button>

                  {paxTestResult === 'ok' && (
                    <div className="bg-green-500/8 border border-green-500/20 rounded-[8px]
                      px-3 py-2 text-[11px] text-green-400 flex items-center gap-2">
                      <span>✓</span> PAX is online and responding
                    </div>
                  )}
                  {paxTestResult === 'fail' && (
                    <div className="bg-red-500/8 border border-red-500/20 rounded-[8px]
                      px-3 py-2 text-[11px] text-red-400">
                      ✗ Cannot reach PAX at {form.paxIp}:{form.paxPort}
                      <div className="text-[10px] text-red-400/60 mt-1">
                        Check: same WiFi/LAN? PAX powered on? IP correct?
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-5">
                <button onClick={() => setStep(1)}
                  className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px]
                    py-2.5 text-[13px] text-[#8899b0]">
                  ← Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={form.paxEnabled && !form.paxIp}
                  className="flex-[2] bg-blue-500 border-none rounded-[9px] py-2.5
                    text-[13px] font-bold text-white disabled:opacity-40"
                >
                  Next: Confirm →
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: 确认 ── */}
          {step === 3 && (
            <div>
              <div className="text-[15px] font-bold mb-4">✅ Confirm Setup</div>

              <div className="bg-[#111827] border border-[#1e2d42] rounded-[10px] p-4 mb-4">
                <Row label="Terminal Name" value={form.name} />
                <Row label="Store" value={stores.find(s => s.id === form.storeId)?.name || '—'} />
                <div className="h-px bg-[#1e2d42] my-2.5" />
                <Row label="Card Reader"
                  value={form.paxEnabled ? `PAX ${form.paxModel}` : 'Not configured'}
                  valueColor={form.paxEnabled ? '#10b981' : '#8899b0'}
                />
                {form.paxEnabled && <>
                  <Row label="PAX IP" value={`${form.paxIp}:${form.paxPort}`} mono />
                  <Row label="Connection"
                    value={paxTestResult === 'ok' ? '✓ Verified' : 'Not tested'}
                    valueColor={paxTestResult === 'ok' ? '#10b981' : '#f59e0b'}
                  />
                </>}
              </div>

              <div className="bg-blue-500/6 border border-blue-500/15 rounded-[9px]
                px-3.5 py-3 text-[11px] text-[#8899b0] mb-5">
                💡 This device will be remembered as <strong className="text-white">{form.name}</strong>.
                You can update PAX settings anytime in Settings → Terminal.
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep(2)}
                  className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px]
                    py-2.5 text-[13px] text-[#8899b0]">
                  ← Back
                </button>
                <button
                  onClick={handleFinish}
                  disabled={saving}
                  className="flex-[2] bg-gradient-to-r from-blue-600 to-blue-700
                    border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white
                    disabled:opacity-50"
                >
                  {saving ? '⏳ Registering...' : '✓ Start Using RetailPOS'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="text-center text-[10px] text-[#3d5068] mt-4">
          This is a one-time setup. Terminal info is stored on this device.
        </div>
      </div>
    </div>
  )
}

// ── Small helpers ──
function Label({ children }) {
  return (
    <div className="text-[10px] font-bold font-mono text-[#3d5068] uppercase
      tracking-wider mb-1.5">
      {children}
    </div>
  )
}
function Row({ label, value, mono, valueColor }) {
  return (
    <div className="flex justify-between items-center mb-2 last:mb-0">
      <span className="text-[11px] text-[#3d5068]">{label}</span>
      <span className={`text-[12px] font-semibold ${mono ? 'font-mono' : ''}`}
        style={{ color: valueColor }}>
        {value}
      </span>
    </div>
  )
}
