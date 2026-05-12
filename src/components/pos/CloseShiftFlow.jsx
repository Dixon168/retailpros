// src/components/pos/CloseShiftFlow.jsx
// Smart close-shift wizard: preview activity, count cash, print report, close.
import { useEffect, useState } from 'react'
import NumPad from '@/components/ui/NumPad'
import { useTerminalStore } from '@/stores/terminalStore'
import { buildShiftSummary, buildShiftReportHTML } from '@/lib/shiftReport'
import { printReceipt } from '@/lib/receipt'
import toast from 'react-hot-toast'

const PAY_LABEL = {
  cash:'Cash', card:'Card', credit_card:'Credit Card', debit_card:'Debit Card',
  check:'Check', bank_transfer:'Bank Transfer',
  member_card:'VIP / Member', gift_card:'Gift Card',
  on_account:'On Account', other:'Other',
}
const PAY_COLOR = {
  cash:'#10b981', card:'#3b82f6', credit_card:'#3b82f6', debit_card:'#06b6d4',
  check:'#06b6d4', bank_transfer:'#0891b2',
  member_card:'#f59e0b', gift_card:'#ea580c', on_account:'#ec4899', other:'#64748b',
}

const fmt = n => `$${Number(n||0).toFixed(2)}`

export default function CloseShiftFlow({ shift, tenantId, storeInfo, cashier, terminalName, onClose }) {
  const { closeShift } = useTerminalStore()
  const [summary, setSummary] = useState(null)
  const [step, setStep]       = useState('loading') // 'loading' | 'review' | 'count' | 'done'
  const [counted, setCounted] = useState('')
  const [showPad, setShowPad] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const s = await buildShiftSummary({ shift, tenantId })
        if (!alive) return
        setSummary(s)
        setStep('review')
      } catch (e) {
        toast.error('Failed to load shift activity')
        onClose()
      }
    })()
    return () => { alive = false }
  }, [])

  const proceedToCount = () => setStep('count')

  const finalize = async ({ withReport }) => {
    const amt = parseFloat(counted) || 0
    setClosing(true)
    try {
      // Capture the report data BEFORE closing (uses live shift state)
      const finalSummary = await buildShiftSummary({
        shift, tenantId, closingAmount: amt,
      })
      if (withReport) {
        const html = buildShiftReportHTML({
          summary: finalSummary, storeInfo, cashier, terminalName,
        })
        printReceipt(html, 1)
      }
      // Now close the shift in DB
      await closeShift(amt)
      onClose()
    } catch (e) {
      toast.error('Failed to close: ' + e.message)
    } finally {
      setClosing(false)
    }
  }

  const reprintPreview = async () => {
    const amt = parseFloat(counted) || (summary?.expected || 0)
    const s = await buildShiftSummary({ shift, tenantId, closingAmount: amt })
    const html = buildShiftReportHTML({ summary: s, storeInfo, cashier, terminalName })
    printReceipt(html, 1)
    toast.success('Report sent to printer')
  }

  if (step === 'loading') return (
    <div className="fixed inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl px-6 py-5 text-[13px] font-mono">⏳ Loading shift activity…</div>
    </div>
  )

  if (!summary) return null

  const expected   = summary.expected
  const variance   = (parseFloat(counted) || 0) - expected
  const varianceOk = Math.abs(variance) < 0.01

  return (
    <div className="fixed inset-0 bg-[rgba(0,0,0,0.5)] backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl flex flex-col"
        style={{width:'560px', maxHeight:'92vh'}}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between rounded-t-2xl flex-shrink-0"
          style={{background:'linear-gradient(135deg,#1e293b 0%,#0f172a 100%)'}}>
          <div>
            <div className="text-[16px] font-bold text-white">🌙 Close Shift</div>
            <div className="text-[10px] text-slate-300 font-mono mt-0.5">
              {terminalName} · {cashier} · {Math.round((new Date() - new Date(summary.openedAt))/60_000)} min open
            </div>
          </div>
          <button onClick={onClose} disabled={closing}
            className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center">✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {step === 'review' && (
            <>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">📊 Activity Summary</div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <KPI label="Orders"     value={summary.orderCount}      color="#3b82f6"/>
                <KPI label="Gross"      value={fmt(summary.grossSales)} color="#10b981"/>
                <KPI label="Net"        value={fmt(summary.netSales)}   color="#1F1F1F"/>
                {summary.refundCount > 0 && (
                  <KPI label="Refunds" value={`-${fmt(summary.refundAmt)}`} color="#dc2626"/>
                )}
                {summary.voidCount > 0 && (
                  <KPI label="Voided" value={summary.voidCount} color="#64748b"/>
                )}
                <KPI label="Tax" value={fmt(summary.taxTotal)} color="#0891b2"/>
              </div>

              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">💳 Payment Breakdown</div>
              <div className="rounded-xl mb-4" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                {Object.keys(summary.payByMethod).length === 0 ? (
                  <div className="px-4 py-3 text-center text-[11px] text-slate-400">No payments yet</div>
                ) : Object.entries(summary.payByMethod).map(([m, v]) => (
                  <div key={m} className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 last:border-0">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:PAY_COLOR[m]||'#64748b'}}/>
                    <div className="flex-1 text-[12px] font-semibold">{PAY_LABEL[m]||m}</div>
                    <div className="text-right">
                      <div className="text-[12px] font-bold font-mono">{fmt(v.net)}</div>
                      {v.refunded > 0 && (
                        <div className="text-[10px] font-mono text-red-500">-{fmt(v.refunded)} refunded</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {(summary.discTotal > 0 || summary.couponTotal > 0 || summary.ptsRedeemed > 0) && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">🎟️ Discounts Given</div>
                  <div className="rounded-xl mb-4 px-4 py-2 space-y-1" style={{background:'#fdf4ff', border:'1px solid #f3e8ff'}}>
                    {summary.discTotal > 0   && <Row l="Total discount" v={`-${fmt(summary.discTotal)}`} color="#16a34a"/>}
                    {summary.couponTotal > 0 && <Row l="  via coupons"   v={`-${fmt(summary.couponTotal)}`} color="#c026d3"/>}
                    {summary.ptsRedeemed > 0 && <Row l="  via points"    v={`${summary.ptsRedeemed} pts redeemed`} color="#B45309"/>}
                  </div>
                </>
              )}

              {summary.byCashier && summary.byCashier.length > 1 && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">👤 By Employee</div>
                  <div className="rounded-xl mb-4" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                    {summary.byCashier.map(c => (
                      <div key={c.id} className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 last:border-0">
                        <div className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                          style={{background:'#006AFF'}}>{c.name.charAt(0).toUpperCase()}</div>
                        <div className="flex-1 text-[12px] font-semibold">{c.name}</div>
                        <div className="text-right">
                          <div className="text-[12px] font-bold font-mono">{fmt(c.gross)}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{c.orderCount} orders</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {summary.activity && summary.activity.length > 0 && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">📜 Who Did What</div>
                  <div className="rounded-xl mb-4 max-h-[280px] overflow-y-auto"
                    style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
                    {summary.activity.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2 border-b border-slate-100 last:border-0">
                        <span className="text-[15px] leading-tight">{a.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-[#1F1F1F] truncate">{a.detail}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {new Date(a.at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })} · {a.who}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <button onClick={proceedToCount}
                className="w-full rounded-lg py-3 text-[14px] font-bold text-white cursor-pointer border-none"
                style={{background:'#006AFF'}}>
                Next: Count Cash Drawer →
              </button>
            </>
          )}

          {step === 'count' && (
            <>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">💵 Cash Reconciliation</div>

              <div className="rounded-xl mb-3 px-4 py-3" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                <Row l="Opening float"  v={fmt(summary.opening)} mono/>
                <Row l="Cash sales (+)" v={fmt(summary.cashCollected)} mono color="#16a34a"/>
                {summary.cashRefunded > 0 && (
                  <Row l="Cash refunds (−)" v={`-${fmt(summary.cashRefunded)}`} mono color="#dc2626"/>
                )}
                <div className="border-t border-slate-200 mt-1.5 pt-1.5">
                  <Row l="Expected in drawer" v={fmt(expected)} bold mono color="#1F1F1F"/>
                </div>
              </div>

              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Count what's actually in the drawer</div>
              <button onClick={() => setShowPad(true)}
                className="w-full flex items-center rounded-xl px-4 py-3 mb-2 cursor-pointer"
                style={{background:'#f0fdf4', border:`2px solid ${counted ? '#22c55e' : '#bbf7d0'}`}}>
                <span className="text-[18px] font-bold text-emerald-700 mr-2">$</span>
                <span className="flex-1 text-[24px] font-bold font-mono text-right text-emerald-700">
                  {counted || '0.00'}
                </span>
              </button>
              <div className="text-[10px] text-slate-500 text-center mb-3">Tap to enter — uses a touch numpad</div>

              {counted && (
                <div className="rounded-xl px-4 py-3 mb-3 text-center"
                  style={{
                    background: varianceOk ? '#f0fdf4' : variance > 0 ? '#fffbeb' : '#fee2e2',
                    border:`1px solid ${varianceOk?'#bbf7d0':variance>0?'#fcd34d':'#fca5a5'}`,
                  }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1"
                    style={{color: varianceOk?'#15803d':variance>0?'#92400e':'#991b1b'}}>
                    {varianceOk ? '✓ Balanced' : variance > 0 ? '⚠ Over' : '⚠ Short'}
                  </div>
                  <div className="text-[20px] font-bold font-mono"
                    style={{color: varianceOk?'#15803d':variance>0?'#92400e':'#991b1b'}}>
                    {variance>=0?'+':''}{fmt(variance)}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mb-2">
                <button onClick={() => setStep('review')} disabled={closing}
                  className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
                  style={{background:'#f1f5f9', color:'#475569', border:'1px solid #e2e8f0'}}>
                  ‹ Back
                </button>
                <button onClick={reprintPreview} disabled={closing}
                  className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
                  style={{background:'#fff', color:'#006AFF', border:'1.5px solid #80B2FF'}}>
                  🖨 Preview Report
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => finalize({ withReport: false })} disabled={closing || !counted}
                  className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
                  style={{background:'#fff', color:'#1F1F1F', border:'1.5px solid #1F1F1F'}}>
                  Close (no print)
                </button>
                <button onClick={() => finalize({ withReport: true })} disabled={closing || !counted}
                  className="flex-1 rounded-lg py-3 text-[13px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                  style={{background:'#1F1F1F'}}>
                  {closing ? 'Closing…' : '🖨 Close + Print'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showPad && (
        <NumPad title="Count Cash" subtitle="Total $ in drawer" prefix="$"
          value={counted} onChange={setCounted}
          allowNegative={false} allowDecimal={true}
          onConfirm={v => { setCounted(typeof v === 'number' ? v.toFixed(2) : v); setShowPad(false) }}
          onClose={() => setShowPad(false)}/>
      )}
    </div>
  )
}

function KPI({ label, value, color }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-[15px] font-bold font-mono mt-0.5" style={{color}}>{value}</div>
    </div>
  )
}
function Row({ l, v, bold, mono, color }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-[11px]" style={{color: color || '#64748b', fontWeight: bold?'bold':'normal'}}>{l}</span>
      <span className={`text-[12px] ${mono?'font-mono':''} ${bold?'font-bold':''}`} style={{color: color || '#1F1F1F'}}>{v}</span>
    </div>
  )
}
