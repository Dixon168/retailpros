// src/pages/payroll/PayrollPage.jsx
// Payroll & time clock report. Manager can:
//  - View hours + earnings by employee for day / week / month / custom range
//  - Edit a specific clock-in/out time and the rate
//  - Print a payroll summary
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays, subDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import { printReceipt } from '@/lib/receipt'
import ManagerOverrideModal from '@/components/pos/ManagerOverrideModal'
import { logOverride } from '@/lib/auditOverride'
import toast from 'react-hot-toast'

const PRESETS = [
  { id:'today',     label:'Today',     fn:() => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { id:'yesterday', label:'Yesterday', fn:() => ({ from: startOfDay(subDays(new Date(),1)), to: endOfDay(subDays(new Date(),1)) }) },
  { id:'week',      label:'This Week', fn:() => ({ from: startOfWeek(new Date(),{weekStartsOn:1}), to: endOfWeek(new Date(),{weekStartsOn:1}) }) },
  { id:'lastweek',  label:'Last Week', fn:() => ({ from: startOfWeek(subDays(new Date(),7),{weekStartsOn:1}), to: endOfWeek(subDays(new Date(),7),{weekStartsOn:1}) }) },
  { id:'month',     label:'This Month',fn:() => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) },
  { id:'lastmonth', label:'Last Month',fn:() => {
    const d = subDays(startOfMonth(new Date()), 1)
    return { from: startOfMonth(d), to: endOfMonth(d) }
  }},
]

export default function PayrollPage() {
  const qc = useQueryClient()
  const { tenant, store, user: me, can } = useAuthStore()
  const { activeEmployee } = useEmployeeStore()
  const [preset, setPreset] = useState('week')
  const [customFrom, setCustomFrom] = useState(null)
  const [customTo, setCustomTo]     = useState(null)
  const [editing, setEditing] = useState(null) // entry being edited
  const [override, setOverride] = useState(null)
  // Track which approver authorized the currently-open edit modal (if any)
  const [editApprover, setEditApprover] = useState(null)

  // Attempt to open the edit modal for a time entry.
  // Reads payroll.manage permission:
  //   allow  → open immediately
  //   prompt → open ManagerOverrideModal, then open editor on approve
  //   deny   → toast error
  const tryEdit = (entry) => {
    const v = can('payroll.manage')
    if (v === 'allow') { setEditApprover(null); setEditing(entry); return }
    if (v === 'prompt') {
      setOverride({
        permission:'payroll.manage',
        action:`edit a time-clock entry for ${entry.user_name || 'this employee'}`,
        onApprove: (approver) => {
          toast.success(`✓ Approved by ${approver.name}`)
          logOverride({
            tenantId: tenant?.id,
            permission:'payroll.manage',
            actionLabel:`edit time entry (${entry.id})`,
            requestedBy: activeEmployee
              ? { id: activeEmployee.id, name: activeEmployee.name }
              : { id: me?.id, name: me?.name },
            approver,
            amount: entry.earned_amount,
            notes: `Entry ${entry.id} · ${entry.user_name}`,
          })
          setEditApprover(approver)
          setEditing(entry)
        },
      })
      return
    }
    toast.error("You don't have permission to edit time entries")
  }

  const { from, to } = useMemo(() => {
    if (preset === 'custom' && customFrom && customTo) {
      return { from: startOfDay(new Date(customFrom)), to: endOfDay(new Date(customTo)) }
    }
    return PRESETS.find(p => p.id === preset)?.fn() || PRESETS[2].fn()
  }, [preset, customFrom, customTo])

  // Entries in window
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['payroll', tenant?.id, from?.toISOString(), to?.toISOString()],
    queryFn: async () => {
      const { data } = await supabase.from('time_clock_entries')
        .select('*, users:user_id(name, employee_code, role, hourly_rate)')
        .eq('tenant_id', tenant.id)
        .gte('clock_in_at', from.toISOString())
        .lte('clock_in_at', to.toISOString())
        .order('clock_in_at', { ascending: false })
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Group by employee
  const byEmployee = useMemo(() => {
    const m = {}
    entries.forEach(e => {
      const id = e.user_id
      if (!m[id]) m[id] = {
        id, name: e.users?.name || 'Unknown',
        code: e.users?.employee_code, role: e.users?.role,
        rate: e.users?.hourly_rate, entries:[], hours:0, earned:0, openEntries:0,
      }
      m[id].entries.push(e)
      if (e.duration_min) m[id].hours += e.duration_min / 60
      if (e.earned_amount) m[id].earned += Number(e.earned_amount)
      if (!e.clock_out_at) m[id].openEntries++
    })
    return Object.values(m).sort((a,b) => b.earned - a.earned)
  }, [entries])

  const totals = useMemo(() => {
    const hours  = byEmployee.reduce((s,e) => s + e.hours, 0)
    const earned = byEmployee.reduce((s,e) => s + e.earned, 0)
    return { hours, earned, employees: byEmployee.length }
  }, [byEmployee])

  const handlePrint = () => {
    const html = buildPayrollHTML({ storeName: store?.name, from, to, byEmployee, totals })
    printReceipt(html, 1)
  }

  return (
    <div className="h-full overflow-y-auto bg-[#FAFAFA] p-6">
      <div className="max-w-[1100px] mx-auto">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <div className="text-[20px] font-bold text-[#1F1F1F]">💰 Payroll & Time Clock</div>
            <div className="text-[12px] text-[#666] mt-1">Hours worked + earnings by employee</div>
          </div>
          <button onClick={handlePrint}
            className="rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer border-none"
            style={{background:'#1F1F1F', color:'#fff'}}>
            🖨 Print Payroll Report
          </button>
        </div>

        {/* Date pickers */}
        <div className="bg-[#FFFFFF] rounded-2xl p-4 mb-4" style={{border:'1px solid #E5E5E5'}}>
          <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-2">Period</div>
          <div className="flex gap-1.5 flex-wrap">
            {PRESETS.map(p => (
              <button key={p.id} onClick={()=>setPreset(p.id)}
                className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border"
                style={preset===p.id
                  ? {background:'#1F1F1F', color:'#fff', borderColor:'#1F1F1F'}
                  : {background:'#fff', color:'#666', borderColor:'#E5E5E5'}}>
                {p.label}
              </button>
            ))}
            <button onClick={()=>setPreset('custom')}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border"
              style={preset==='custom'
                ? {background:'#1F1F1F', color:'#fff', borderColor:'#1F1F1F'}
                : {background:'#fff', color:'#666', borderColor:'#E5E5E5'}}>
              Custom...
            </button>
          </div>
          {preset === 'custom' && (
            <div className="flex gap-2 mt-3 items-center">
              <input type="date" value={customFrom||''} onChange={e=>setCustomFrom(e.target.value)}
                className="rounded-lg px-3 py-2 text-[12px] outline-none cursor-pointer"
                style={{border:'1.5px solid #E5E5E5'}}/>
              <span className="text-[#666] text-[11px]">→</span>
              <input type="date" value={customTo||''} onChange={e=>setCustomTo(e.target.value)}
                className="rounded-lg px-3 py-2 text-[12px] outline-none cursor-pointer"
                style={{border:'1.5px solid #E5E5E5'}}/>
            </div>
          )}
          <div className="text-[10px] text-[#999] mt-2 font-mono">
            {format(from, 'EEE MMM d, yyyy')} → {format(to, 'EEE MMM d, yyyy')}
          </div>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <KPI label="Total Hours"   value={totals.hours.toFixed(1)+'h'}      color="#3b82f6"/>
          <KPI label="Total Payroll" value={`$${totals.earned.toFixed(2)}`}    color="#16a34a"/>
          <KPI label="Employees"     value={totals.employees}                  color="#9333ea"/>
        </div>

        {/* Per-employee summary cards */}
        {isLoading ? (
          <div className="text-[12px] text-[#999] text-center py-8">Loading…</div>
        ) : byEmployee.length === 0 ? (
          <div className="bg-[#FFFFFF] rounded-2xl py-12 text-center" style={{border:'1px solid #E5E5E5'}}>
            <div className="text-[40px] mb-2 opacity-30">⏰</div>
            <div className="text-[13px] text-[#666]">No time-clock activity in this period</div>
          </div>
        ) : byEmployee.map(emp => (
          <div key={emp.id} className="bg-[#FFFFFF] rounded-2xl mb-3" style={{border:'1px solid #E5E5E5'}}>
            <div className="flex items-center gap-3 px-4 py-3" style={{borderBottom:'1px solid #F1F5F9'}}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[14px] font-bold text-white"
                style={{background:'#006AFF'}}>{emp.name.charAt(0)}</div>
              <div className="flex-1">
                <div className="text-[14px] font-bold flex items-center gap-2">
                  {emp.name}
                  {emp.openEntries > 0 && (
                    <span className="rounded-full px-2 py-0.5 text-[9px] font-bold animate-pulse" style={{background:'#dcfce7', color:'#15803d'}}>
                      ⏰ Clocked in
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[#666] flex gap-2 mt-0.5">
                  {emp.code && <span className="font-mono">{emp.code}</span>}
                  {emp.role && <span className="capitalize">{emp.role}</span>}
                  <span className="font-mono">${Number(emp.rate||0).toFixed(2)}/hr</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[18px] font-bold font-mono">${emp.earned.toFixed(2)}</div>
                <div className="text-[10px] text-[#666] font-mono">{emp.hours.toFixed(2)}h · {emp.entries.length} shifts</div>
              </div>
            </div>
            <div className="divide-y divide-[#F1F5F9]">
              {emp.entries.map(e => (
                <div key={e.id} className="flex items-center px-4 py-2 gap-3 hover:bg-[#FAFAFA]">
                  <div className="flex-1">
                    <div className="text-[12px] font-mono">
                      {format(new Date(e.clock_in_at), 'EEE MMM d · h:mm a')}
                      {e.clock_out_at && <> → {format(new Date(e.clock_out_at), 'h:mm a')}</>}
                      {!e.clock_out_at && <span className="ml-2 text-green-600 font-bold">· still working</span>}
                    </div>
                    {e.edit_note && (
                      <div className="text-[10px] text-[#9333ea] mt-0.5 italic">
                        edited: {e.edit_note}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-[11px] font-mono w-[80px]">
                    {e.duration_min != null
                      ? `${Math.floor(e.duration_min/60)}h ${e.duration_min%60}m`
                      : <span className="text-[#999]">—</span>}
                  </div>
                  <div className="text-right text-[12px] font-mono font-bold w-[80px]">
                    {e.earned_amount != null ? `$${Number(e.earned_amount).toFixed(2)}` : <span className="text-[#999]">—</span>}
                  </div>
                  <button onClick={()=>tryEdit(e)}
                    className="rounded-md px-2 py-1 text-[10px] cursor-pointer"
                    style={{background:'#F1F5F9', color:'#475569', border:'1px solid #E5E5E5'}}>Edit</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditEntryModal entry={editing} editorId={me?.id} approver={editApprover}
          onClose={()=>{ setEditing(null); setEditApprover(null) }}
          onSaved={()=>{ qc.invalidateQueries({queryKey:['payroll']}); setEditing(null); setEditApprover(null) }}/>
      )}

      {override && (
        <ManagerOverrideModal
          permission={override.permission}
          action={override.action}
          onApprove={override.onApprove}
          onClose={() => setOverride(null)}/>
      )}
    </div>
  )
}


function KPI({ label, value, color }) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{background:'#fff', border:'1px solid #E5E5E5'}}>
      <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-[22px] font-bold font-mono" style={{color}}>{value}</div>
    </div>
  )
}


function EditEntryModal({ entry, editorId, approver, onClose, onSaved }) {
  const fmtLocal = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = n => String(n).padStart(2,'0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const [ci, setCi]     = useState(fmtLocal(entry.clock_in_at))
  const [co, setCo]     = useState(fmtLocal(entry.clock_out_at))
  const [rate, setRate] = useState(String(entry.hourly_rate || 0))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!ci) { toast.error('Clock-in required'); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('fn_edit_time_entry', {
      p_entry_id: entry.id,
      p_clock_in: new Date(ci).toISOString(),
      p_clock_out: co ? new Date(co).toISOString() : null,
      p_hourly_rate: parseFloat(rate) || 0,
      p_editor_id: editorId,
      p_note: note || null,
    })
    setSaving(false)
    if (error || !data?.success) {
      toast.error(data?.message || error?.message || 'Save failed')
      return
    }
    toast.success('✓ Time entry updated')
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.5)'}} onClick={onClose}>
      <div className="bg-white rounded-2xl" style={{width:'480px'}} onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 flex justify-between" style={{background:'#1F1F1F', borderRadius:'1rem 1rem 0 0'}}>
          <div className="text-[15px] font-bold text-white">✏️ Edit Time Entry</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 border-none text-white text-[18px] flex items-center justify-center cursor-pointer">✕</button>
        </div>
        <div className="p-5 space-y-3">
          {approver && (
            <div className="rounded-lg px-3 py-2 text-[11px]"
              style={{background:'#faf5ff', border:'1px solid #e9d5ff', color:'#7c2d92'}}>
              🔐 <b>Manager Override active:</b> approved by {approver.name}
            </div>
          )}
          <div>
            <SLabel>Clock In *</SLabel>
            <input type="datetime-local" value={ci} onChange={e=>setCi(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{border:'1.5px solid #E5E5E5'}}/>
          </div>
          <div>
            <SLabel>Clock Out (blank = still working)</SLabel>
            <input type="datetime-local" value={co} onChange={e=>setCo(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{border:'1.5px solid #E5E5E5'}}/>
          </div>
          <div>
            <SLabel>Hourly rate (for this entry)</SLabel>
            <div className="flex items-center rounded-lg px-3" style={{border:'1.5px solid #E5E5E5'}}>
              <span className="text-[14px] text-[#666] mr-1">$</span>
              <input type="number" step="0.25" min="0" value={rate} onChange={e=>setRate(e.target.value)}
                className="flex-1 py-2 outline-none border-none bg-transparent text-[13px] font-mono"/>
              <span className="text-[11px] text-[#666]">/hr</span>
            </div>
          </div>
          <div>
            <SLabel>Edit reason (optional)</SLabel>
            <input value={note} onChange={e=>setNote(e.target.value)}
              placeholder="e.g. Forgot to clock out"
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{border:'1.5px solid #E5E5E5'}}/>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={onClose}
              className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
              style={{background:'#fff', color:'#666', border:'1px solid #E5E5E5'}}>Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex-1 rounded-lg py-2.5 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-50"
              style={{background:'#1F1F1F'}}>{saving ? 'Saving…' : '✓ Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SLabel({ children }) {
  return <div className="text-[10px] font-bold text-[#1F1F1F] uppercase tracking-wider mb-1">{children}</div>
}


// ──────────────────────────────────────────────────────────────
// Payroll report HTML (3 1/8" thermal)
// ──────────────────────────────────────────────────────────────
function buildPayrollHTML({ storeName, from, to, byEmployee, totals }) {
  const dash = '<div style="text-align:center;color:#888;margin:6px 0;">- - - - - - - - - - - - - - -</div>'
  const dbl  = '<div style="text-align:center;color:#444;margin:6px 0;">============================</div>'

  const rows = byEmployee.map(e => `
    <div style="font-weight:bold;margin-top:4px;">${esc(e.name)}${e.code ? ` <span style="font-family:monospace;font-size:9px;color:#666;">(${esc(e.code)})</span>` : ''}</div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;">
      <span>${esc(e.role || '')} · $${Number(e.rate||0).toFixed(2)}/hr · ${e.entries.length} shifts</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-weight:bold;font-family:monospace;">
      <span>${e.hours.toFixed(2)}h worked</span>
      <span>$${e.earned.toFixed(2)}</span>
    </div>
  `).join(dash)

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Payroll</title>
<style>
  @page { margin: 5mm; size: 80mm auto; }
  body { font-family: ui-monospace, 'Courier New', monospace; font-size: 11px; max-width: 80mm; margin: 0 auto; padding: 6px; color: #000; }
  .center { text-align: center; }
  .row { display: flex; justify-content: space-between; }
  .title { font-size: 14px; font-weight: 900; text-align: center; letter-spacing: 1px; }
  .small { font-size: 10px; color: #666; }
  .total { font-size: 13px; font-weight: 900; border-top: 1px solid #444; padding-top: 6px; margin-top: 6px; }
</style></head><body>

<div class="title">${esc((storeName || 'STORE').toUpperCase())}</div>
<div class="center small">PAYROLL REPORT</div>
<div class="center small">${format(from,'MMM d, yyyy')} → ${format(to,'MMM d, yyyy')}</div>
${dash}

${rows || '<div class="center small" style="padding:20px 0;">No activity in this period</div>'}

${dbl}
<div class="row total"><span>EMPLOYEES</span><span>${totals.employees}</span></div>
<div class="row total"><span>TOTAL HOURS</span><span>${totals.hours.toFixed(2)}h</span></div>
<div class="row total"><span>TOTAL PAYROLL</span><span>$${totals.earned.toFixed(2)}</span></div>

${dash}
<div class="center small">Printed ${new Date().toLocaleString()}</div>

</body></html>`
}

const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
