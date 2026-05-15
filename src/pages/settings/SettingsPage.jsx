// src/pages/settings/SettingsPage.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import { useTerminalStore } from '@/stores/terminalStore'
import { paxGetStatus } from '@/lib/pax'
import { openCashDrawer, getCashDrawerSettings, saveCashDrawerSettings } from '@/lib/cashDrawer'
import { PERMISSION_GROUPS, ALL_PERMISSIONS } from '@/lib/permissions'
import ManagerOverrideModal from '@/components/pos/ManagerOverrideModal'
import { logOverride } from '@/lib/auditOverride'
import { analyzeSms, renderTemplate, segmentStatus, SAMPLE_VARS } from '@/lib/smsLength'
import { APP_NAME, APP_VERSION, APP_COPYRIGHT } from '@/lib/version'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

const SECTIONS = [
  { id:'store',     icon:'🏪', label:'Store Info',        role:'owner' },
  { id:'terminals', icon:'🖥️', label:'Terminals & PAX',   role:'owner' },
  { id:'printer',   icon:'🖨️', label:'Printer Setup',     role:'owner' },
  { id:'cashdrawer',icon:'💰', label:'Cash Drawer',       role:'owner' },
  { id:'printing',  icon:'📄', label:'Print Settings',    role:'owner' },
  { id:'tax',       icon:'🧾', label:'Tax Rates',         role:'owner' },
  { id:'coupons',   icon:'🎫', label:'Coupons',           role:'owner' },
  { id:'discounts', icon:'🏷️', label:'Discount Tiers',    role:'owner' },
  { id:'users',     icon:'👤', label:'Employees',          role:'manager' },
  { id:'roles',     icon:'🛡️', label:'Roles & Permissions',role:'owner' },
  { id:'payment',   icon:'💳', label:'Payment Config',    role:'owner' },
  { id:'billing',   icon:'💰', label:'Subscription',      role:'owner' },
  { id:'language',  icon:'🌐', label:'Language & Region', role:'owner' },
  { id:'loyalty',   icon:'💎', label:'Loyalty & Points',   role:'owner' },
  { id:'memberlevels', icon:'🏅', label:'Member Levels', role:'owner' },
  { id:'notifications', icon:'📨', label:'Notifications', role:'owner' },
  { id:'display',   icon:'📺', label:'Customer Display', role:'owner' },
  { id:'api',       icon:'🤖', label:'API & Integrations', role:'owner' },
]

export default function SettingsPage() {
  const nav = useNavigate()
  const { user, tenant, store, canAccessSettings, can } = useAuthStore()
  const { activeEmployee } = useEmployeeStore()
  const [active, setActive] = useState('store')
  const [override, setOverride] = useState(null)
  const [unlockedSections, setUnlockedSections] = useState(new Set())  // sections approved this session
  const visibleSections = SECTIONS.filter(s => canAccessSettings(s.id) || s.role === 'manager')

  // Click a section. If it requires prompt, pop override. Allow → switch.
  const trySwitch = (sectionId) => {
    const permKey = `settings.${sectionId}`
    const v = can(permKey)
    // If already unlocked this session, just switch
    if (unlockedSections.has(sectionId) || v === 'allow' || v == null) {
      setActive(sectionId); return
    }
    if (v === 'prompt') {
      setOverride({
        permission: permKey,
        action: `access ${SECTIONS.find(s=>s.id===sectionId)?.label || sectionId} settings`,
        onApprove: (approver) => {
          toast.success(`✓ Approved by ${approver.name}`)
          logOverride({
            tenantId: tenant?.id,
            permission: permKey,
            actionLabel:`open ${sectionId} settings`,
            requestedBy: activeEmployee
              ? { id: activeEmployee.id, name: activeEmployee.name }
              : { id: user?.id, name: user?.name },
            approver,
          })
          setUnlockedSections(prev => new Set([...prev, sectionId]))
          setActive(sectionId)
        },
      })
      return
    }
    // deny
    toast.error("You don't have permission to access these settings")
  }

  return (
    <div className="flex h-full bg-[#FAFAFA]">
      {/* Sidebar */}
      <div className="w-[220px] bg-[#FFFFFF] border-r border-[#E5E5E5] p-3 flex-shrink-0">
        {/* Header with close button */}
        <div className="flex items-center justify-between px-2 mb-3">
          <div className="text-[9px] font-mono text-[#999999] uppercase tracking-widest">
            Settings
          </div>
          <button onClick={() => nav('/backoffice')}
            title="Back to Store Overview"
            className="w-6 h-6 rounded-md flex items-center justify-center cursor-pointer border-none transition-all hover:bg-slate-100"
            style={{background:'transparent', color:'#999999', fontSize:'14px'}}>
            ✕
          </button>
        </div>
        {visibleSections.map(s => {
          const v = can(`settings.${s.id}`)
          const isPrompt = v === 'prompt' && !unlockedSections.has(s.id)
          const isUnlocked = unlockedSections.has(s.id)
          return (
            <div key={s.id} onClick={() => trySwitch(s.id)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer
                text-[12px] mb-0.5 transition-all ${
                active === s.id
                  ? 'bg-[#000000] text-white font-semibold'
                  : 'text-[#1F1F1F] hover:bg-[#F5F5F5]'
              }`}>
              <span>{s.icon}</span>
              <span className="flex-1">{s.label}</span>
              {isPrompt && <span title="Requires manager approval" className="text-[11px]">🔐</span>}
              {isUnlocked && <span title="Approved this session" className="text-[10px]" style={{color:'#10b981'}}>✓</span>}
            </div>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 bg-[#FAFAFA]">
        {active === 'store'     && <StoreSection store={store} tenant={tenant}/>}
        {active === 'terminals' && <TerminalsSection tenantId={tenant?.id} storeId={store?.id}/>}
        {active === 'printer'   && <PrinterSection/>}
        {active === 'cashdrawer'&& <CashDrawerSection/>}
        {active === 'printing'  && <PrintingSection/>}
        {active === 'tax'       && <TaxSection tenantId={tenant?.id}/>}
        {active === 'coupons'   && <CouponsSection tenantId={tenant?.id} userId={user?.id}/>}
        {active === 'discounts' && <DiscountsSection tenantId={tenant?.id}/>}
        {active === 'users'     && <UsersSection tenantId={tenant?.id}/>}
        {active === 'roles'     && <RolesSection tenantId={tenant?.id} userId={user?.id}/>}
        {active === 'payment'   && <PaymentSection tenantId={tenant?.id}/>}
        {active === 'billing'   && <BillingSection tenant={tenant}/>}
        {active === 'language'  && <LanguageSection/>}
        {active === 'loyalty'   && <LoyaltySettingsSection tenant={tenant}/>}
        {active === 'memberlevels' && <MemberLevelsSection tenantId={tenant?.id}/>}
        {active === 'notifications' && <NotificationsSection tenantId={tenant?.id} userId={user?.id} userName={user?.name}/>}
        {active === 'display' && <DisplaySection tenantId={tenant?.id}/>}
        {active === 'api'       && <APISection tenantId={tenant?.id}/>}
      </div>

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

// ── Store Info ──
function StoreSection({ store, tenant }) {
  const [form, setForm] = useState({
    name:           store?.name           || '',
    phone:          store?.phone          || '',
    email:          store?.email          || '',
    address:        store?.address        || '',
    city:           store?.city           || '',
    state:          store?.state          || '',
    zip:            store?.zip            || '',
    tax_id:         store?.tax_id         || '',
    receipt_header: store?.receipt_header || '',
    receipt_footer: store?.receipt_footer || 'Thank you for your business!',
  })
  const u = (k,v) => setForm(p => ({...p,[k]:v}))

  const save = async () => {
    const { error } = await supabase.from('stores').update(form).eq('id', store.id)
    if (error) { toast.error(`Couldn't save: ${error.message}`); return }
    toast.success('Store settings saved')
  }

  return (
    <div className="max-w-[560px]">
      <SectionTitle>🏪 Store Information</SectionTitle>
      <Card>
        <CardTitle>Business Details</CardTitle>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Store Name',  'name'],
            ['Phone',       'phone'],
            ['Email',       'email'],
            ['Tax ID (EIN)','tax_id'],
            ['Address',     'address'],
            ['City',        'city'],
          ].map(([label, key]) => (
            <FieldInput key={key} label={label} value={form[key]}
              onChange={v => u(key, v)}/>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <FieldInput label="State" value={form.state} onChange={v => u('state', v)}/>
            <FieldInput label="ZIP"   value={form.zip}   onChange={v => u('zip', v)} mono/>
          </div>
        </div>
      </Card>
      <Card className="mt-4">
        <CardTitle>Receipt Template</CardTitle>
        <div className="mb-3">
          <FieldLabel>Header Text</FieldLabel>
          <textarea value={form.receipt_header} onChange={e => u('receipt_header', e.target.value)}
            rows={2} placeholder="Store name, address, phone..."
            className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2.5
              text-[12px] outline-none focus:border-[#006AFF] resize-none"/>
        </div>
        <div>
          <FieldLabel>Footer Text</FieldLabel>
          <textarea value={form.receipt_footer} onChange={e => u('receipt_footer', e.target.value)}
            rows={2}
            className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 py-2.5
              text-[12px] outline-none focus:border-[#006AFF] resize-none"/>
        </div>
      </Card>
      <SaveBtn onClick={save}/>

      {/* About — software info */}
      <Card>
        <CardTitle>About</CardTitle>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[12px]">
          <span className="text-[#666]">Software</span>
          <span className="font-semibold text-right">{APP_NAME}</span>
          <span className="text-[#666]">Version</span>
          <span className="font-mono text-right">v{APP_VERSION}</span>
          <span className="text-[#666]">Copyright</span>
          <span className="text-right text-[#666]">{APP_COPYRIGHT}</span>
          <span className="text-[#666]">Store ID</span>
          <span className="font-mono text-right text-[#999] text-[10px]">{store?.id}</span>
          <span className="text-[#666]">Tenant ID</span>
          <span className="font-mono text-right text-[#999] text-[10px]">{tenant?.id}</span>
        </div>
      </Card>
    </div>
  )
}

// ── Terminals & PAX ──
function TerminalsSection({ tenantId, storeId }) {
  const qc = useQueryClient()
  const [editTerm, setEditTerm] = useState(null)
  const [testStatus, setTestStatus] = useState({}) // { termId: 'online'|'offline'|'testing' }

  const { data: terminals = [] } = useQuery({
    queryKey: ['terminals-settings', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('terminals').select('*')
        .eq('tenant_id', tenantId).order('name')
      return data || []
    },
    enabled: !!tenantId,
  })

  const testPax = async (term) => {
    setTestStatus(p => ({...p, [term.id]: 'testing'}))
    const r = await paxGetStatus({ paxIp: term.pax_ip, paxPort: term.pax_port })
    setTestStatus(p => ({...p, [term.id]: r.online ? 'online' : 'offline'}))
  }

  const saveTerm = async (data) => {
    const r = data.id
      ? await supabase.from('terminals').update(data).eq('id', data.id)
      : await supabase.from('terminals').insert({ ...data, tenant_id: tenantId, store_id: storeId })
    if (r.error) { toast.error(`Save failed: ${r.error.message}`); return }
    qc.invalidateQueries(['terminals-settings'])
    setEditTerm(null)
    toast.success('Terminal saved')
  }

  return (
    <div className="max-w-[640px]">
      <div className="flex justify-between items-center mb-5">
        <SectionTitle className="mb-0">🖥️ Terminals & PAX Configuration</SectionTitle>
        <button onClick={() => setEditTerm({})}
          className="bg-[#006AFF] border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white">
          + Add Terminal
        </button>
      </div>

      {terminals.map(term => {
        const ts = testStatus[term.id]
        return (
          <Card key={term.id} className="mb-3">
            <div className="flex items-start gap-3">
              <div className="text-2xl mt-0.5">🖥️</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-[14px] font-bold">{term.name}</div>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    term.is_active
                      ? 'bg-green-500/10 text-[#00B23B]'
                      : 'bg-[#F5F5F5] text-[#999999]'
                  }`}>{term.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
                </div>

                {/* PAX config summary */}
                {term.pax_enabled ? (
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] font-mono text-[#666666]">
                      PAX {term.pax_model} · {term.pax_ip}:{term.pax_port}
                    </div>
                    {ts === 'online'  && <span className="text-[9px] text-[#00B23B]">● Online</span>}
                    {ts === 'offline' && <span className="text-[9px] text-[#CF1322]">● Offline</span>}
                    {ts === 'testing' && <span className="text-[9px] text-[#666666] animate-pulse">Testing...</span>}
                  </div>
                ) : (
                  <div className="text-[11px] text-[#999999]">No PAX card reader</div>
                )}

                {/* Payment methods */}
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {[
                    [term.accept_cash,        '💵 Cash'],
                    [term.accept_card,        '💳 Card'],
                    [term.accept_check,       '📝 Check'],
                    [term.accept_member_card, '🏷️ Member'],
                    [term.accept_on_account,  '📋 Account'],
                  ].filter(([en]) => en !== false).map(([, label]) => (
                    <span key={label} className="text-[9px] font-mono px-1.5 py-0.5 rounded
                      bg-[#F5F5F5] text-[#666666]">{label}</span>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 flex-shrink-0">
                {term.pax_enabled && (
                  <button onClick={() => testPax(term)}
                    className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5
                      text-[10px] text-[#666666] hover:border-blue-500/30 hover:text-[#006AFF] transition-all">
                    Test PAX
                  </button>
                )}
                <button onClick={() => setEditTerm(term)}
                  className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5
                    text-[10px] text-[#666666] hover:border-blue-500/30 hover:text-[#006AFF] transition-all">
                  Edit
                </button>
              </div>
            </div>
          </Card>
        )
      })}

      {/* Edit form */}
      {editTerm !== null && (
        <TerminalEditForm
          initial={editTerm}
          onSave={saveTerm}
          onClose={() => setEditTerm(null)}
        />
      )}
    </div>
  )
}

function TerminalEditForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    id:                 initial.id          || null,
    name:               initial.name        || '',
    pax_enabled:        initial.pax_enabled ?? false,
    pax_ip:             initial.pax_ip      || '',
    pax_port:           initial.pax_port    || 10009,
    pax_model:          initial.pax_model   || 'A920',
    accept_cash:        initial.accept_cash        ?? true,
    accept_card:        initial.accept_card        ?? true,
    accept_check:       initial.accept_check       ?? true,
    accept_member_card: initial.accept_member_card ?? true,
    accept_on_account:  initial.accept_on_account  ?? true,
    is_active:          initial.is_active   ?? true,
  })
  const u = (k,v) => setForm(p => ({...p,[k]:v}))
  const PAX_MODELS = ['A920','A920Pro','A80','A35','S300','E600','IM30']

  return (
    <div className="fixed inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm z-50
      flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl w-[480px]"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#E5E5E5] flex justify-between">
          <div className="text-[15px] font-bold">
            {form.id ? '✏️ Edit Terminal' : '🖥️ New Terminal'}
          </div>
          <button onClick={onClose} className="text-[#999999] hover:text-[#1F1F1F] text-xl">✕</button>
        </div>
        <div className="p-5">
          <FieldInput label="Terminal Name" value={form.name} onChange={v => u('name',v)} className="mb-4"/>

          {/* PAX toggle */}
          <div className="flex items-center justify-between bg-[#F5F5F5] border border-[#E5E5E5]
            rounded-[10px] px-4 py-3 mb-4">
            <div>
              <div className="text-[13px] font-semibold">Enable PAX Card Reader</div>
              <div className="text-[10px] text-[#999999] mt-0.5">Connect a PAX terminal to this machine</div>
            </div>
            <Toggle value={form.pax_enabled} onChange={v => u('pax_enabled', v)} color="#3b82f6"/>
          </div>

          {form.pax_enabled && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <FieldInput label="PAX IP Address" value={form.pax_ip}
                onChange={v => u('pax_ip',v)} mono colSpan/>
              <FieldInput label="Port" value={form.pax_port}
                onChange={v => u('pax_port', parseInt(v)||10009)} mono type="number"/>
              <div>
                <FieldLabel>PAX Model</FieldLabel>
                <select value={form.pax_model} onChange={e => u('pax_model',e.target.value)}
                  className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
                    px-3 py-2.5 text-[12px] text-[#1F1F1F] outline-none">
                  {PAX_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Payment methods */}
          <div className="mb-4">
            <FieldLabel>Accepted Payment Methods</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['accept_cash',        '💵 Cash'],
                ['accept_card',        '💳 Card (PAX)'],
                ['accept_check',       '📝 Check'],
                ['accept_member_card', '🏷️ Member Card'],
                ['accept_on_account',  '📋 On Account'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2.5 bg-[#F5F5F5]
                  border border-[#E5E5E5] rounded-lg px-3 py-2.5 cursor-pointer
                  hover:border-[#E5E5E5] transition-colors">
                  <input type="checkbox" checked={form[key]}
                    onChange={e => u(key, e.target.checked)}
                    className="accent-blue-500 w-3.5 h-3.5"/>
                  <span className="text-[12px]">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between mb-5">
            <span className="text-[13px] text-[#666666]">Terminal Active</span>
            <Toggle value={form.is_active} onChange={v => u('is_active',v)} color="#10b981"/>
          </div>

          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
                py-2.5 text-[13px] text-[#666666]">Cancel</button>
            <button onClick={() => onSave(form)}
              className="flex-[2] bg-[#006AFF] border-none rounded-[9px] py-2.5
                text-[13px] font-bold text-white">Save Terminal</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tax Rates ──
function TaxSection({ tenantId }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null) // { id, name, ratePct }
  const [adding, setAdding]   = useState(false)
  const [newRate, setNewRate] = useState({ name:'', ratePct:'' })

  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['tax-rates-flat', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tax_rates')
        .select('id, name, rate')
        .eq('tenant_id', tenantId)
        .order('name')
      return data || []
    },
    enabled: !!tenantId,
  })

  const startEdit = (r) => setEditing({
    id: r.id,
    name: r.name,
    ratePct: (r.rate * 100).toFixed(4).replace(/\.?0+$/, ''),  // 0.0825 → "8.25"
  })

  const saveEdit = async () => {
    if (!editing.name.trim()) { toast.error('Name required'); return }
    const pct = parseFloat(editing.ratePct)
    if (isNaN(pct) || pct < 0 || pct > 100) { toast.error('Rate must be 0–100'); return }
    const { error } = await supabase.from('tax_rates')
      .update({ name: editing.name.trim(), rate: pct / 100 })
      .eq('id', editing.id)
    if (error) { toast.error('Save failed: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['tax-rates-flat'] })
    qc.invalidateQueries({ queryKey: ['tax-rates'] })  // refresh product form too
    setEditing(null)
    toast.success('Tax rate updated')
  }

  const addRate = async () => {
    if (!newRate.name.trim()) { toast.error('Name required'); return }
    const pct = parseFloat(newRate.ratePct || '0')
    if (isNaN(pct) || pct < 0 || pct > 100) { toast.error('Rate must be 0–100'); return }
    const { error } = await supabase.from('tax_rates')
      .insert({ tenant_id: tenantId, name: newRate.name.trim(), rate: pct / 100 })
    if (error) { toast.error('Add failed: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['tax-rates-flat'] })
    qc.invalidateQueries({ queryKey: ['tax-rates'] })
    setNewRate({ name:'', ratePct:'' })
    setAdding(false)
    toast.success('Tax rate added')
  }

  const deleteRate = async (r) => {
    // Check if any products use this rate
    const { count } = await supabase.from('product_tax_rates')
      .select('id', { count:'exact', head:true })
      .eq('tax_rate_id', r.id)
    const inUse = count || 0
    const msg = inUse > 0
      ? `"${r.name}" is currently applied to ${inUse} product${inUse>1?'s':''}.\nDelete it? Those products will no longer have this tax.`
      : `Delete "${r.name}"?`
    if (!confirm(msg)) return
    const { error } = await supabase.from('tax_rates').delete().eq('id', r.id)
    if (error) { toast.error('Delete failed: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['tax-rates-flat'] })
    qc.invalidateQueries({ queryKey: ['tax-rates'] })
    toast.success('Tax rate deleted')
  }

  return (
    <div className="max-w-[600px]">
      <div className="flex justify-between items-center mb-2">
        <SectionTitle className="mb-0">🧾 Tax Rates</SectionTitle>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="bg-[#006AFF] border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white cursor-pointer active:scale-[0.97]">
            + Add Tax Rate
          </button>
        )}
      </div>
      <p className="text-[12px] text-[#666666] mb-4">
        Click any name or rate to edit. These show up as checkboxes on each product.
      </p>

      <Card>
        {/* Add-new row */}
        {adding && (
          <div className="flex items-center gap-2 mb-3 p-2 rounded-lg"
            style={{background:'#E6F0FF', border:'1.5px solid #006AFF'}}>
            <input autoFocus value={newRate.name}
              onChange={e=>setNewRate(p=>({...p, name:e.target.value}))}
              onKeyDown={e=>{ if(e.key==='Enter') addRate(); if(e.key==='Escape'){setAdding(false); setNewRate({name:'',ratePct:''})} }}
              placeholder="Name (e.g. Tax 3, City Tax, ...)"
              className="flex-1 rounded-md px-2.5 py-1.5 text-[12px] outline-none"
              style={{border:'1px solid #80B2FF', background:'#FFFFFF', color:'#1F1F1F'}}/>
            <input value={newRate.ratePct}
              onChange={e=>setNewRate(p=>({...p, ratePct:e.target.value}))}
              onKeyDown={e=>{ if(e.key==='Enter') addRate() }}
              placeholder="0.00" type="number" step="0.01" min="0" max="100"
              className="w-20 rounded-md px-2.5 py-1.5 text-[12px] outline-none font-mono text-right"
              style={{border:'1px solid #80B2FF', background:'#FFFFFF', color:'#1F1F1F'}}/>
            <span className="text-[12px] font-bold text-[#006AFF]">%</span>
            <button onClick={addRate}
              className="rounded-md px-2.5 py-1.5 text-[11px] font-bold cursor-pointer"
              style={{background:'#15803d', color:'#fff', border:'none'}}>Save</button>
            <button onClick={()=>{setAdding(false); setNewRate({name:'',ratePct:''})}}
              className="rounded-md px-2 py-1.5 text-[11px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>✕</button>
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="text-[12px] text-[#999] py-4 text-center">Loading...</div>
        ) : rates.length === 0 && !adding ? (
          <div className="text-[12px] text-[#999] py-6 text-center">
            No tax rates yet. Click <b>+ Add Tax Rate</b> to create your first one.
          </div>
        ) : rates.map(r => (
          <div key={r.id} className="flex items-center gap-2 py-2 border-b border-[#E5E5E5] last:border-0">
            {editing?.id === r.id ? (
              <>
                <input autoFocus value={editing.name}
                  onChange={e=>setEditing(p=>({...p, name:e.target.value}))}
                  onKeyDown={e=>{ if(e.key==='Enter') saveEdit(); if(e.key==='Escape') setEditing(null) }}
                  className="flex-1 rounded-md px-2.5 py-1.5 text-[12px] outline-none"
                  style={{border:'1.5px solid #006AFF', background:'#FFFFFF', color:'#1F1F1F'}}/>
                <input value={editing.ratePct}
                  onChange={e=>setEditing(p=>({...p, ratePct:e.target.value}))}
                  onKeyDown={e=>{ if(e.key==='Enter') saveEdit(); if(e.key==='Escape') setEditing(null) }}
                  type="number" step="0.01" min="0" max="100"
                  className="w-20 rounded-md px-2.5 py-1.5 text-[12px] outline-none font-mono text-right"
                  style={{border:'1.5px solid #006AFF', background:'#FFFFFF', color:'#1F1F1F'}}/>
                <span className="text-[12px] font-bold text-[#FA8C16]">%</span>
                <button onClick={saveEdit}
                  className="rounded-md px-2.5 py-1.5 text-[11px] font-bold cursor-pointer"
                  style={{background:'#15803d', color:'#fff', border:'none'}}>Save</button>
                <button onClick={()=>setEditing(null)}
                  className="rounded-md px-2 py-1.5 text-[11px] font-bold cursor-pointer"
                  style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>✕</button>
              </>
            ) : (
              <>
                <button onClick={()=>startEdit(r)}
                  className="flex-1 text-left rounded-md px-2.5 py-1.5 text-[13px] cursor-pointer"
                  style={{background:'transparent', border:'1px solid transparent', color:'#1F1F1F'}}
                  onMouseEnter={e=>{e.currentTarget.style.background='#F5F5F5'; e.currentTarget.style.borderColor='#E5E5E5'}}
                  onMouseLeave={e=>{e.currentTarget.style.background='transparent'; e.currentTarget.style.borderColor='transparent'}}>
                  {r.name}
                </button>
                <button onClick={()=>startEdit(r)}
                  className="rounded-md px-2.5 py-1.5 text-[13px] font-mono font-bold cursor-pointer"
                  style={{background:'#fef9c3', color:'#FA8C16', border:'1px solid #fde68a'}}>
                  {(r.rate * 100).toFixed(2)}%
                </button>
                <button onClick={()=>deleteRate(r)}
                  className="rounded-md px-2 py-1.5 text-[12px] cursor-pointer"
                  style={{background:'#FEE2E2', color:'#CF1322', border:'1px solid #FECACA'}}
                  title="Delete this tax rate">✕</button>
              </>
            )}
          </div>
        ))}

        {rates.length > 0 && (
          <div className="mt-3 pt-3 flex items-center justify-between" style={{borderTop:'1px dashed #E5E5E5'}}>
            <span className="text-[11px] text-[#666]">
              {rates.length} tax rate{rates.length>1?'s':''} configured
            </span>
            <span className="text-[11px] text-[#666] font-mono">
              Sum: <span className="font-bold text-[#FA8C16]">{(rates.reduce((s,r)=>s+r.rate,0)*100).toFixed(2)}%</span>
            </span>
          </div>
        )}
      </Card>

      <div className="mt-4 rounded-lg p-3 text-[11px]" style={{background:'#FAFAFA', border:'1px solid #E5E5E5', color:'#666'}}>
        💡 <b>How it works:</b> Each tax rate becomes a checkbox on every product. When you create or edit a product, tick the boxes for the taxes that apply. Multiple taxes stack (e.g. state + city).
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// 🎫 Coupons — full CRUD
// ────────────────────────────────────────────────────────────────────
function CouponsSection({ tenantId, userId }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null) // coupon obj or null

  const empty = {
    name:'', code:'', discount_type:'pct', discount_value:'',
    use_type:'recurring', max_uses:'', min_subtotal:'',
    expires_at:'', is_active:true,
  }
  const [form, setForm] = useState(empty)
  const setF = (k,v) => setForm(p=>({...p, [k]:v}))

  const { data: coupons = [], isLoading } = useQuery({
    queryKey: ['coupons', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('coupons')
        .select('*').eq('tenant_id', tenantId)
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!tenantId,
  })

  const startAdd  = () => { setForm(empty); setEditing(null); setAdding(true) }
  const startEdit = (c) => {
    setForm({
      name:           c.name,
      code:           c.code,
      discount_type:  c.discount_type,
      discount_value: String(c.discount_value),
      use_type:       c.use_type,
      max_uses:       c.max_uses != null ? String(c.max_uses) : '',
      min_subtotal:   c.min_subtotal != null ? String(c.min_subtotal) : '',
      expires_at:     c.expires_at ? new Date(c.expires_at).toISOString().slice(0,10) : '',
      is_active:      c.is_active,
    })
    setEditing(c); setAdding(true)
  }
  const cancel = () => { setAdding(false); setEditing(null); setForm(empty) }

  const save = async () => {
    if (!form.name.trim())  { toast.error('Name required'); return }
    if (!form.code.trim())  { toast.error('Code required'); return }
    const val = parseFloat(form.discount_value)
    if (isNaN(val) || val <= 0) { toast.error('Discount value must be > 0'); return }
    if (form.discount_type === 'pct' && val > 100) { toast.error('Percent must be ≤ 100'); return }

    const payload = {
      tenant_id:      tenantId,
      name:           form.name.trim(),
      code:           form.code.trim().toUpperCase(),
      discount_type:  form.discount_type,
      discount_value: val,
      use_type:       form.use_type,
      max_uses:       form.max_uses ? parseInt(form.max_uses) : null,
      min_subtotal:   form.min_subtotal ? parseFloat(form.min_subtotal) : null,
      expires_at:     form.expires_at ? new Date(form.expires_at + 'T23:59:59').toISOString() : null,
      is_active:      form.is_active,
    }

    let err
    if (editing) {
      const { error } = await supabase.from('coupons').update(payload).eq('id', editing.id)
      err = error
    } else {
      const { error } = await supabase.from('coupons').insert({ ...payload, created_by: userId })
      err = error
    }
    if (err) {
      if (err.code === '23505') toast.error(`Code "${payload.code}" already exists`)
      else toast.error('Save failed: ' + err.message)
      return
    }
    qc.invalidateQueries({ queryKey: ['coupons'] })
    toast.success(editing ? 'Coupon updated ✓' : 'Coupon created ✓')
    cancel()
  }

  const remove = async (c) => {
    const usedTxt = c.times_used > 0 ? `\n\nIt has been used ${c.times_used} time${c.times_used>1?'s':''} — history will be kept but the coupon won't be usable again.` : ''
    if (!confirm(`Delete coupon "${c.name}" (${c.code})?${usedTxt}`)) return
    const { error } = await supabase.from('coupons').delete().eq('id', c.id)
    if (error) { toast.error('Delete failed: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['coupons'] })
    toast.success('Coupon deleted')
  }

  const toggleActive = async (c) => {
    const { error } = await supabase.from('coupons').update({ is_active: !c.is_active }).eq('id', c.id)
    if (error) { toast.error('Failed: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['coupons'] })
  }

  // Status pill
  const statusOf = (c) => {
    if (!c.is_active) return { label: 'Paused', bg:'#fef3c7', color:'#92400e' }
    if (c.expires_at && new Date(c.expires_at) < new Date()) return { label:'Expired', bg:'#f1f5f9', color:'#64748b' }
    if (c.max_uses != null && c.times_used >= c.max_uses) return { label:'Used up', bg:'#f1f5f9', color:'#64748b' }
    return { label:'Active', bg:'#dcfce7', color:'#15803d' }
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : null

  return (
    <div className="max-w-[760px]">
      <div className="flex justify-between items-center mb-2">
        <SectionTitle className="mb-0">🎫 Coupons</SectionTitle>
        {!adding && (
          <button onClick={startAdd}
            className="bg-[#006AFF] border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white cursor-pointer active:scale-[0.97]">
            + Add Coupon
          </button>
        )}
      </div>
      <p className="text-[12px] text-[#666666] mb-4">
        Coupon codes for cashiers to apply at checkout. Codes are case-insensitive when redeemed.
      </p>

      {/* ── Add / Edit form ── */}
      {adding && (
        <Card className="mb-4" style={{background:'#E6F0FF', border:'2px solid #006AFF'}}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-bold text-[#006AFF]">
              {editing ? '✏️ Edit Coupon' : '➕ New Coupon'}
            </div>
            <button onClick={cancel}
              className="text-[14px] cursor-pointer bg-transparent border-none text-[#666]">✕</button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <FLabel>Name *</FLabel>
              <input value={form.name} onChange={e=>setF('name', e.target.value)}
                placeholder="e.g. Summer 2026"
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{border:'1.5px solid #80B2FF', background:'#fff', color:'#1F1F1F'}}/>
            </div>
            <div>
              <FLabel>Code *</FLabel>
              <input value={form.code}
                onChange={e=>setF('code', e.target.value.toUpperCase().replace(/\s/g,''))}
                placeholder="SUMMER10"
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
                style={{border:'1.5px solid #80B2FF', background:'#fff', color:'#1F1F1F'}}/>
              <div className="text-[10px] text-[#666] mt-1">Cashiers will type or scan this. Auto-uppercased.</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <FLabel>Discount type *</FLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {[['pct','% Percent','#16a34a'],['amt','$ Amount','#006AFF']].map(([id,lbl,col])=>(
                  <button key={id} onClick={()=>setF('discount_type', id)}
                    className="rounded-lg py-2 text-[12px] font-bold cursor-pointer border-2"
                    style={form.discount_type===id
                      ? {background:col, color:'#fff', borderColor:col}
                      : {background:'#fff', color:'#64748b', borderColor:'#e2e8f0'}}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <FLabel>Discount value *</FLabel>
              <div className="flex items-center rounded-lg px-3"
                style={{border:'1.5px solid #80B2FF', background:'#fff'}}>
                {form.discount_type === 'amt' && <span className="text-[14px] text-[#666] mr-1">$</span>}
                <input value={form.discount_value} onChange={e=>setF('discount_value', e.target.value)}
                  type="number" step="0.01" min="0"
                  max={form.discount_type==='pct' ? 100 : undefined}
                  placeholder={form.discount_type==='pct' ? '10' : '5.00'}
                  className="flex-1 py-2 text-[13px] outline-none border-none bg-transparent font-mono"
                  style={{color:'#1F1F1F'}}/>
                {form.discount_type === 'pct' && <span className="text-[14px] text-[#666] ml-1">%</span>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <FLabel>Use type</FLabel>
              <select value={form.use_type} onChange={e=>setF('use_type', e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none cursor-pointer"
                style={{border:'1.5px solid #e2e8f0', background:'#fff', color:'#1F1F1F'}}>
                <option value="recurring">Recurring (unlimited per customer)</option>
                <option value="one_time">One-time per customer</option>
              </select>
            </div>
            <div>
              <FLabel>Total uses limit (blank = ∞)</FLabel>
              <input value={form.max_uses} onChange={e=>setF('max_uses', e.target.value.replace(/\D/g,''))}
                placeholder="e.g. 100" inputMode="numeric"
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
                style={{border:'1.5px solid #e2e8f0', background:'#fff', color:'#1F1F1F'}}/>
            </div>
            <div>
              <FLabel>Min subtotal $ (blank = none)</FLabel>
              <input value={form.min_subtotal} onChange={e=>setF('min_subtotal', e.target.value)}
                type="number" step="0.01" min="0" placeholder="20.00"
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
                style={{border:'1.5px solid #e2e8f0', background:'#fff', color:'#1F1F1F'}}/>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <FLabel>Expires (blank = never)</FLabel>
              <input value={form.expires_at} onChange={e=>setF('expires_at', e.target.value)}
                type="date"
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none cursor-pointer"
                style={{border:'1.5px solid #e2e8f0', background:'#fff', color:'#1F1F1F'}}/>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e=>setF('is_active', e.target.checked)}
                  className="w-4 h-4"/>
                <span className="text-[12px] font-semibold text-[#1F1F1F]">Active (cashiers can use it)</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={cancel}
              className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
              style={{background:'#fff', color:'#666', border:'1px solid #E5E5E5'}}>
              Cancel
            </button>
            <button onClick={save}
              className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer border-none"
              style={{background:'#006AFF', color:'#fff'}}>
              {editing ? '✓ Update Coupon' : '+ Create Coupon'}
            </button>
          </div>
        </Card>
      )}

      {/* ── List ── */}
      <Card>
        {isLoading ? (
          <div className="text-[12px] text-[#999] py-4 text-center">Loading...</div>
        ) : coupons.length === 0 && !adding ? (
          <div className="text-[12px] text-[#999] py-8 text-center">
            No coupons yet. Click <b>+ Add Coupon</b> to create your first one.
          </div>
        ) : coupons.map(c => {
          const st = statusOf(c)
          return (
            <div key={c.id} className="flex items-center gap-3 py-2 border-b border-[#E5E5E5] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold text-[#1F1F1F]">{c.name}</span>
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-mono font-bold"
                    style={{background:'#1F1F1F', color:'#fff'}}>{c.code}</span>
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                    style={{background:st.bg, color:st.color}}>{st.label}</span>
                </div>
                <div className="text-[11px] text-[#666] mt-0.5 flex gap-3 flex-wrap">
                  <span><b>{c.discount_type==='pct' ? `${c.discount_value}%` : `$${Number(c.discount_value).toFixed(2)}`}</b> off</span>
                  <span>{c.use_type === 'one_time' ? '🔒 1× per customer' : '∞ recurring'}</span>
                  {c.max_uses != null && <span>📊 {c.times_used}/{c.max_uses} used</span>}
                  {c.max_uses == null && c.times_used > 0 && <span>📊 {c.times_used} used</span>}
                  {c.min_subtotal != null && <span>💰 min ${Number(c.min_subtotal).toFixed(2)}</span>}
                  {c.expires_at && <span>📅 expires {fmtDate(c.expires_at)}</span>}
                </div>
              </div>
              <button onClick={()=>toggleActive(c)}
                className="rounded-md px-2.5 py-1.5 text-[11px] font-bold cursor-pointer border"
                style={c.is_active
                  ? {background:'#fef3c7', color:'#92400e', borderColor:'#fde68a'}
                  : {background:'#dcfce7', color:'#15803d', borderColor:'#86efac'}}>
                {c.is_active ? 'Pause' : 'Resume'}
              </button>
              <button onClick={()=>startEdit(c)}
                className="rounded-md px-2.5 py-1.5 text-[11px] font-bold cursor-pointer"
                style={{background:'#E6F0FF', color:'#006AFF', border:'1px solid #80B2FF'}}>
                Edit
              </button>
              <button onClick={()=>remove(c)}
                className="rounded-md px-2 py-1.5 text-[12px] cursor-pointer"
                style={{background:'#FEE2E2', color:'#CF1322', border:'1px solid #FECACA'}}
                title="Delete coupon">✕</button>
            </div>
          )
        })}
      </Card>

      <div className="mt-4 rounded-lg p-3 text-[11px]" style={{background:'#FAFAFA', border:'1px solid #E5E5E5', color:'#666'}}>
        💡 <b>How it works:</b> At checkout, cashier opens 🎫 Coupon, types or scans the code, and the discount applies on top of any item-level pricing. Coupons stack with loyalty points but not with order-level manual discount (only one of those at a time).
      </div>
    </div>
  )
}

function FLabel({ children }) {
  return <div className="text-[10px] font-bold text-[#1F1F1F] uppercase tracking-wider mb-1">{children}</div>
}


// ── Discount Tiers ──
function DiscountsSection({ tenantId }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null) // { id, tier_name, discount_rate }

  const { data: tiers = [] } = useQuery({
    queryKey: ['discount-tiers', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('discount_tiers')
        .select('*').eq('tenant_id', tenantId).order('customer_type').order('sort_order')
      return data || []
    },
    enabled: !!tenantId,
  })

  const saveTier = async (tier) => {
    await supabase.from('discount_tiers')
      .update({ tier_name: tier.tier_name, discount_rate: parseFloat(tier.discount_rate) })
      .eq('id', tier.id)
    qc.invalidateQueries(['discount-tiers'])
    setEditing(null)
    toast.success('Tier updated')
  }

  const b2c = tiers.filter(t => t.customer_type === 'b2c')
  const b2b = tiers.filter(t => t.customer_type === 'b2b')

  return (
    <div className="max-w-[600px]">
      <SectionTitle>🏷️ Discount Tiers</SectionTitle>
      <p className="text-[12px] text-[#666666] mb-5">
        Set discount rates for each customer tier. Changes take effect immediately on all new transactions.
      </p>

      {[['B2C Retail Customers', b2c, 'b2c'], ['B2B Business Accounts', b2b, 'b2b']].map(([title, list, type]) => (
        <Card key={type} className="mb-5">
          <CardTitle>{title}</CardTitle>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E5E5E5]">
                {['Tier', 'Display Name', 'Discount Rate', 'Example Price', ''].map(h => (
                  <th key={h} className="pb-2 text-left font-mono text-[10px]
                    text-[#999999] uppercase tracking-wider pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(tier => (
                <tr key={tier.id} className="border-b border-[#E5E5E5] last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded"
                      style={{ background: `${tier.color}18`, color: tier.color }}>
                      {tier.tier_key?.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    {editing?.id === tier.id ? (
                      <input
                        value={editing.tier_name}
                        onChange={e => setEditing(p => ({...p, tier_name: e.target.value}))}
                        className="bg-[#F5F5F5] border border-blue-500/40 rounded px-2 py-1
                          text-[12px] outline-none w-24"
                      />
                    ) : (
                      <span className="text-[12px] font-semibold">{tier.tier_name}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    {editing?.id === tier.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number" step="0.01" min="0" max="1"
                          value={editing.discount_rate}
                          onChange={e => setEditing(p => ({...p, discount_rate: e.target.value}))}
                          className="bg-[#F5F5F5] border border-blue-500/40 rounded px-2 py-1
                            text-[12px] font-mono outline-none w-16"
                        />
                        <span className="text-[11px] text-[#999999]">
                          = {Math.round((1 - editing.discount_rate) * 100)}% off
                        </span>
                      </div>
                    ) : (
                      <div>
                        <span className="font-mono text-[12px] font-bold text-[#FA8C16]">
                          {(tier.discount_rate * 100).toFixed(0)}%
                        </span>
                        <span className="text-[10px] text-[#999999] ml-2">
                          ({tier.discount_rate < 1
                            ? `${Math.round((1-tier.discount_rate)*100)}% off`
                            : 'original price'
                          })
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-[11px] text-[#666666]">
                    ${(100 * tier.discount_rate).toFixed(2)}
                    <span className="text-[#999999]"> on $100</span>
                  </td>
                  <td className="py-2.5">
                    {editing?.id === tier.id ? (
                      <div className="flex gap-1.5">
                        <button onClick={() => saveTier(editing)}
                          className="text-[10px] px-2 py-1 bg-green-500/10 border
                            border-green-500/20 rounded text-[#00B23B]">Save</button>
                        <button onClick={() => setEditing(null)}
                          className="text-[10px] px-2 py-1 bg-[#F5F5F5] border
                            border-[#E5E5E5] rounded text-[#666666]">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setEditing(tier)}
                        className="text-[10px] px-2 py-1 bg-[#F5F5F5] border border-[#E5E5E5]
                          rounded text-[#666666] hover:border-blue-500/30 hover:text-[#006AFF]
                          transition-all">Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <Card>
        <CardTitle>Promo + Tier Stacking Rules</CardTitle>
        <div className="text-[12px] text-[#666666] mb-4">
          When a customer has a tier discount AND a promotion is active, how should they interact?
        </div>
        <div className="flex flex-col gap-2">
          {[
            ['promo_first', 'Promo first — take the bigger discount', '#f59e0b'],
            ['stackable',   'Stack both — apply tier × promo',        '#10b981'],
            ['tier_first',  'Tier first — customer discount takes priority', '#3b82f6'],
          ].map(([id, label, color]) => (
            <label key={id} className="flex items-center gap-3 bg-[#F5F5F5] border
              border-[#E5E5E5] rounded-[9px] px-4 py-3 cursor-pointer hover:border-[#E5E5E5]
              transition-colors">
              <input type="radio" name="stack_rule" defaultChecked={id==='promo_first'}
                className="accent-yellow-500"/>
              <span className="text-[12px]">{label}</span>
              <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ background:`${color}18`, color }}>
                {id.replace('_',' ').toUpperCase()}
              </span>
            </label>
          ))}
        </div>
        <SaveBtn onClick={() => toast.success('Stacking rules saved')} className="mt-4"/>
      </Card>
    </div>
  )
}

// ── Users / Employees (full implementation) ──
function UsersSection({ tenantId }) {
  const qc = useQueryClient()
  const { checkUserQuota, user: me } = useAuthStore()
  const [editing, setEditing] = useState(null) // user obj or 'new'

  const { data: users = [] } = useQuery({
    queryKey: ['users-settings', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('*')
        .eq('tenant_id', tenantId).order('name')
      return data || []
    },
    enabled: !!tenantId,
  })

  const { data: quota } = useQuery({
    queryKey: ['user-quota', tenantId],
    queryFn: async () => {
      const { data } = await supabase.rpc('fn_check_user_quota', { p_tenant_id: tenantId })
      return data
    },
    enabled: !!tenantId,
  })

  const ROLE_STYLE = {
    owner:   { bg:'rgba(245,158,11,0.1)', color:'#f59e0b' },
    manager: { bg:'rgba(59,130,246,0.1)', color:'#3b82f6' },
    cashier: { bg:'rgba(16,185,129,0.1)', color:'#10b981' },
  }
  const AVATAR_COLORS = ['#3b82f6','#10b981','#006AFF','#ec4899','#06b6d4']

  const newEmployee = () => {
    setEditing({
      _new: true,
      name:'', email:'', phone:'', role:'cashier', pin:'',
      employee_code:'', hourly_rate:0, is_active:true,
    })
  }

  const toggleActive = async (u) => {
    const { error } = await supabase.from('users').update({ is_active: !u.is_active }).eq('id', u.id)
    if (error) { toast.error('Failed: ' + error.message); return }
    qc.invalidateQueries({ queryKey:['users-settings'] })
    toast.success(u.is_active ? 'Employee deactivated' : 'Employee reactivated')
  }

  return (
    <div className="max-w-[760px]">
      <div className="flex justify-between items-center mb-2">
        <SectionTitle className="mb-0">👤 Employees</SectionTitle>
        <button onClick={async () => {
            const q = await checkUserQuota()
            if (!q?.allowed) { toast.error(q?.message || 'User limit reached'); return }
            newEmployee()
          }}
          className="bg-[#006AFF] border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white cursor-pointer">
          + Add Employee
        </button>
      </div>
      <p className="text-[12px] text-[#666666] mb-4">
        Employees clock in/out at any POS terminal using their PIN. Hourly rate is used for payroll reports.
      </p>

      {quota && (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[10px] px-4 py-2.5 mb-4 flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-[#F5F5F5] rounded overflow-hidden">
            <div className="h-full rounded transition-all bg-[#006AFF]"
              style={{ width: `${Math.min(100, quota.current / quota.max * 100)}%` }}/>
          </div>
          <span className="text-[11px] font-mono text-[#666666]">{quota.current} / {quota.max} users</span>
        </div>
      )}

      {editing && (
        <EmployeeForm employee={editing} tenantId={tenantId} editorId={me?.id}
          onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey:['users-settings'] }); setEditing(null) }}/>
      )}

      {users.map((u, i) => {
        const rs = ROLE_STYLE[u.role] || ROLE_STYLE.cashier
        return (
          <Card key={u.id} className="mb-2.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-[14px] font-bold text-white flex-shrink-0"
                style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length], opacity: u.is_active?1:0.4 }}>
                {u.name?.charAt(0)?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-[13px] font-bold" style={{textDecoration: u.is_active?'none':'line-through', opacity: u.is_active?1:0.6}}>{u.name}</div>
                  {u.pin && <span className="rounded px-1.5 py-0.5 text-[9px] font-mono font-bold" style={{background:'#1F1F1F', color:'#fff'}}>PIN ••••</span>}
                  {!u.is_active && <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{background:'#FEE2E2', color:'#DC2626'}}>INACTIVE</span>}
                </div>
                <div className="text-[10px] text-[#999999] mt-0.5 flex gap-3 flex-wrap">
                  {u.employee_code && <span className="font-mono">{u.employee_code}</span>}
                  {u.email && <span>{u.email}</span>}
                  {u.hourly_rate > 0 && <span className="font-mono text-[#16a34a]">${Number(u.hourly_rate).toFixed(2)}/hr</span>}
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded capitalize" style={{ background: rs.bg, color: rs.color }}>{u.role}</span>
              <button onClick={() => setEditing(u)}
                className="text-[10px] bg-[#F5F5F5] border border-[#E5E5E5] rounded-md px-3 py-1.5 text-[#666666] hover:border-blue-500/30 hover:text-[#006AFF] transition-all cursor-pointer">
                Edit
              </button>
              <button onClick={() => toggleActive(u)}
                className="text-[10px] bg-[#F5F5F5] border border-[#E5E5E5] rounded-md px-2 py-1.5 text-[#666666] hover:border-red-500/30 hover:text-red-500 transition-all cursor-pointer">
                {u.is_active ? '⏸' : '▶'}
              </button>
            </div>
          </Card>
        )
      })}

      {users.length === 0 && (
        <div className="text-center py-8 text-[#999]">
          <div className="text-[40px] mb-2 opacity-30">👤</div>
          <div className="text-[13px]">No employees yet. Click <b>+ Add Employee</b> to add your first one.</div>
        </div>
      )}
    </div>
  )
}


function EmployeeForm({ employee, tenantId, editorId, onClose, onSaved }) {
  const [form, setForm] = useState({ ...employee })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const isNew = !!employee._new

  // Load available roles dynamically (system + any custom roles)
  const { data: availableRoles = [] } = useQuery({
    queryKey: ['roles-list', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('roles')
        .select('id, name, description, is_system')
        .eq('tenant_id', tenantId)
        .order('is_system', { ascending: false })
        .order('name')
      return data || []
    },
    enabled: !!tenantId,
  })

  const save = async () => {
    if (!form.name?.trim()) { toast.error('Name required'); return }
    if (form.pin && !/^\d{3,8}$/.test(form.pin)) { toast.error('PIN must be 3–8 digits'); return }
    if (form.hourly_rate != null && form.hourly_rate < 0) { toast.error('Hourly rate must be ≥ 0'); return }

    setSaving(true)
    let error
    if (isNew) {
      // Create new user. Server-side fn_check_user_quota guards count.
      const payload = {
        tenant_id: tenantId,
        name: form.name.trim(),
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        role: form.role || 'cashier',
        pin: form.pin?.trim() || null,
        employee_code: form.employee_code?.trim() || null,
        hourly_rate: parseFloat(form.hourly_rate) || 0,
        is_active: form.is_active !== false,
        id: crypto.randomUUID(),  // local UUID; not linked to Supabase auth
      }
      const r = await supabase.from('users').insert(payload)
      error = r.error
    } else {
      const { id } = form
      const payload = {
        name: form.name.trim(),
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        role: form.role,
        pin: form.pin?.trim() || null,
        employee_code: form.employee_code?.trim() || null,
        hourly_rate: parseFloat(form.hourly_rate) || 0,
        is_active: form.is_active,
      }
      const r = await supabase.from('users').update(payload).eq('id', id)
      error = r.error
    }
    setSaving(false)
    if (error) {
      if (error.code === '23505' && error.message.includes('pin')) {
        toast.error('That PIN is already in use by another employee')
      } else {
        toast.error('Save failed: ' + error.message)
      }
      return
    }
    toast.success(isNew ? '✓ Employee added' : '✓ Updated')
    onSaved()
  }

  return (
    <Card className="mb-4" style={{background:'#E6F0FF', border:'2px solid #006AFF'}}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-bold text-[#006AFF]">
          {isNew ? '➕ New Employee' : `✏️ Edit: ${employee.name}`}
        </div>
        <button onClick={onClose} className="text-[14px] cursor-pointer bg-transparent border-none text-[#666]">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <SLabel>Name *</SLabel>
          <input value={form.name} onChange={e=>set('name', e.target.value)}
            placeholder="John Smith"
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{border:'1.5px solid #80B2FF', background:'#fff'}}/>
        </div>
        <div>
          <SLabel>Employee code</SLabel>
          <input value={form.employee_code || ''} onChange={e=>set('employee_code', e.target.value.toUpperCase())}
            placeholder="EMP-001"
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
            style={{border:'1.5px solid #80B2FF', background:'#fff'}}/>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <SLabel>Email</SLabel>
          <input value={form.email || ''} onChange={e=>set('email', e.target.value)} type="email"
            placeholder="optional"
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{border:'1.5px solid #80B2FF', background:'#fff'}}/>
        </div>
        <div>
          <SLabel>Phone</SLabel>
          <input value={form.phone || ''} onChange={e=>set('phone', e.target.value)}
            placeholder="(555) 555-5555"
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none font-mono"
            style={{border:'1.5px solid #80B2FF', background:'#fff'}}/>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <SLabel>Role</SLabel>
          <div className="flex flex-wrap gap-1.5">
            {availableRoles.map(r => {
              const key = r.name.toLowerCase()
              const selected = (form.role || '').toLowerCase() === key
              return (
                <button key={r.id} onClick={()=>set('role', key)}
                  className="rounded-lg px-3 py-2 text-[11px] font-bold cursor-pointer border-2"
                  style={selected
                    ? {background:'#006AFF', color:'#fff', borderColor:'#006AFF'}
                    : {background:'#fff', color:'#64748b', borderColor:'#e2e8f0'}}>
                  {r.name}
                  {!r.is_system && <span className="ml-1 opacity-60">·custom</span>}
                </button>
              )
            })}
            {availableRoles.length === 0 && (
              <div className="text-[10px] text-[#999]">Loading roles…</div>
            )}
          </div>
          <div className="text-[10px] text-[#666] mt-1">
            {availableRoles.find(r => r.name.toLowerCase() === (form.role||'').toLowerCase())?.description || 'Pick a role — manage roles in 🛡️ Roles & Permissions'}
          </div>
        </div>
        <div>
          <SLabel>Hourly rate</SLabel>
          <div className="flex items-center rounded-lg px-3"
            style={{border:'1.5px solid #80B2FF', background:'#fff'}}>
            <span className="text-[14px] text-[#666] mr-1">$</span>
            <input type="number" step="0.25" min="0" value={form.hourly_rate||0}
              onChange={e=>set('hourly_rate', e.target.value)}
              className="flex-1 py-2 text-[13px] outline-none border-none bg-transparent font-mono"/>
            <span className="text-[11px] text-[#666] ml-1">/hr</span>
          </div>
          <div className="text-[10px] text-[#666] mt-1">Used for payroll calculation</div>
        </div>
      </div>

      <div className="mb-3">
        <SLabel>PIN <span className="text-[#666] font-normal">(3–8 digits — used for clock-in)</span></SLabel>
        <input value={form.pin || ''} onChange={e=>set('pin', e.target.value.replace(/\D/g,''))}
          placeholder="e.g. 1234"
          inputMode="numeric" maxLength={8}
          className="w-full rounded-lg px-3 py-2 text-[16px] outline-none font-mono font-bold tracking-widest text-center"
          style={{border:'1.5px solid #80B2FF', background:'#fff', color:'#006AFF'}}/>
      </div>

      <label className="flex items-center gap-2 cursor-pointer mb-3">
        <input type="checkbox" checked={form.is_active !== false} onChange={e=>set('is_active', e.target.checked)}/>
        <span className="text-[12px] font-semibold">Active (can clock in)</span>
      </label>

      <div className="flex gap-2">
        <button onClick={onClose}
          className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
          style={{background:'#fff', color:'#666', border:'1px solid #E5E5E5'}}>Cancel</button>
        <button onClick={save} disabled={saving}
          className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer border-none disabled:opacity-50"
          style={{background:'#006AFF', color:'#fff'}}>
          {saving ? 'Saving…' : isNew ? '+ Add Employee' : '✓ Save Changes'}
        </button>
      </div>
    </Card>
  )
}

function SLabel({ children }) {
  return <div className="text-[10px] font-bold text-[#1F1F1F] uppercase tracking-wider mb-1">{children}</div>
}


// ════════════════════════════════════════════════════════
// 🛡️ RolesSection — manage roles and their permissions
// ════════════════════════════════════════════════════════
function RolesSection({ tenantId, userId }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null) // role obj or 'new' placeholder
  const [creating, setCreating] = useState(false)

  const { data: roles = [] } = useQuery({
    queryKey: ['roles', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('roles')
        .select('*').eq('tenant_id', tenantId)
        .order('is_system', { ascending: false })
        .order('name')
      return data || []
    },
    enabled: !!tenantId,
  })

  // Count employees in each role so we don't allow deleting roles in use
  const { data: roleCounts = {} } = useQuery({
    queryKey: ['role-counts', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('role').eq('tenant_id', tenantId)
      const counts = {}
      ;(data||[]).forEach(u => {
        const k = (u.role||'').toLowerCase()
        counts[k] = (counts[k]||0) + 1
      })
      return counts
    },
    enabled: !!tenantId,
  })

  const startNew = () => {
    setEditing({
      name:'', description:'', is_system:false,
      max_discount_pct: 0,
      permissions: { 'pos.access':true },  // sane default
    })
    setCreating(true)
  }
  const startEdit = (r) => { setEditing({...r}); setCreating(false) }
  const cancel    = () => { setEditing(null); setCreating(false) }

  const save = async () => {
    if (!editing.name?.trim()) { toast.error('Role name required'); return }
    const payload = {
      name: editing.name.trim(),
      description: editing.description?.trim() || null,
      max_discount_pct: parseInt(editing.max_discount_pct) || 0,
      permissions: editing.permissions || {},
    }
    let error
    if (creating) {
      const r = await supabase.from('roles').insert({ ...payload, tenant_id: tenantId, is_system: false })
      error = r.error
    } else {
      // System roles: only permissions + max_discount_pct can change, not name
      const updateFields = editing.is_system
        ? { permissions: payload.permissions, max_discount_pct: payload.max_discount_pct, description: payload.description }
        : payload
      const r = await supabase.from('roles').update(updateFields).eq('id', editing.id)
      error = r.error
    }
    if (error) {
      if (error.code === '23505') toast.error('A role with that name already exists')
      else toast.error('Save failed: ' + error.message)
      return
    }
    qc.invalidateQueries({ queryKey:['roles'] })
    qc.invalidateQueries({ queryKey:['roles-list'] })
    toast.success(creating ? '✓ Role created' : '✓ Saved')
    cancel()
  }

  const remove = async (r) => {
    if (r.is_system) { toast.error('System roles cannot be deleted'); return }
    const inUse = roleCounts[r.name.toLowerCase()] || 0
    if (inUse > 0) { toast.error(`${inUse} employee(s) still use this role. Reassign them first.`); return }
    if (!window.confirm(`Delete role "${r.name}"? This can't be undone.`)) return
    const { error } = await supabase.from('roles').delete().eq('id', r.id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey:['roles'] })
    qc.invalidateQueries({ queryKey:['roles-list'] })
    toast.success('Deleted')
  }

  // Owner is special — should always have everything
  // Owner OR Admin role is the system superuser — can't have its permissions reduced
  const isProtected = (r) => r.is_system && ['owner','admin'].includes(r.name.toLowerCase())

  return (
    <div className="max-w-[920px]">
      <div className="flex justify-between items-center mb-2">
        <SectionTitle className="mb-0">🛡️ Roles & Permissions</SectionTitle>
        {!editing && (
          <button onClick={startNew}
            className="bg-[#006AFF] border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white cursor-pointer">
            + Add Custom Role
          </button>
        )}
      </div>
      <p className="text-[12px] text-[#666666] mb-4">
        Roles bundle permissions together. Assign one to each employee. System roles
        (Owner / Manager / Cashier) can be edited but not deleted. Owner always has full access.
      </p>

      {editing && (
        <RoleEditor role={editing} setRole={setEditing}
          onSave={save} onCancel={cancel} creating={creating}
          isProtected={isProtected(editing)}/>
      )}

      {!editing && (
        <div className="space-y-2.5">
          {roles.map(r => {
            const inUse = roleCounts[r.name.toLowerCase()] || 0
            const cnt = { allow:0, prompt:0, deny:0 }
            Object.values(r.permissions || {}).forEach(v => {
              if (v === true || v === 'allow') cnt.allow++
              else if (v === 'prompt') cnt.prompt++
              else cnt.deny++
            })
            return (
              <div key={r.id} className="bg-[#FFFFFF] rounded-xl p-4"
                style={{border: r.is_system ? '1.5px solid #80B2FF' : '1px solid #E5E5E5'}}>
                <div className="flex items-center gap-3">
                  <div className="text-[20px]">🛡️</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-[14px] font-bold">{r.name}</div>
                      {r.is_system
                        ? <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{background:'#E6F0FF', color:'#006AFF'}}>SYSTEM</span>
                        : <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{background:'#fef3c7', color:'#92400e'}}>CUSTOM</span>}
                      {inUse > 0 && (
                        <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{background:'#dcfce7', color:'#15803d'}}>
                          {inUse} employee{inUse>1?'s':''}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#666] mt-0.5">
                      {r.description || <span className="opacity-60">No description</span>}
                    </div>
                    <div className="text-[10px] mt-1 font-mono flex gap-2">
                      <span style={{color:'#15803d'}}>✓ Allow: {cnt.allow}</span>
                      <span style={{color:'#ca8a04'}}>? Prompt: {cnt.prompt}</span>
                      <span style={{color:'#991b1b'}}>✗ Deny: {cnt.deny}</span>
                      <span className="text-[#999]">· max disc: {r.max_discount_pct}%</span>
                    </div>
                  </div>
                  <button onClick={() => startEdit(r)}
                    className="rounded-md px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                    style={{background:'#F1F5F9', color:'#475569', border:'1px solid #E5E5E5'}}>
                    Edit
                  </button>
                  {!r.is_system && (
                    <button onClick={() => remove(r)}
                      className="rounded-md px-2 py-1.5 text-[12px] cursor-pointer"
                      style={{background:'#FEE2E2', color:'#CF1322', border:'1px solid #FCA5A5'}}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {roles.length === 0 && (
            <div className="text-center py-8 text-[#999]">
              <div className="text-[40px] mb-2 opacity-30">🛡️</div>
              <div className="text-[13px]">No roles yet. Run B2C_ROLES_PERMISSIONS.sql to seed the system roles.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function RoleEditor({ role, setRole, onSave, onCancel, creating, isProtected }) {
  const set = (k, v) => setRole(p => ({...p, [k]: v}))
  const setPerm = (key, val) => setRole(p => ({...p, permissions: {...(p.permissions||{}), [key]: val}}))

  const isOwner = isProtected
  // Normalize a value to tri-state string
  const norm = (v) => {
    if (v === true)  return 'allow'
    if (v === false) return 'deny'
    if (v === 'allow' || v === 'deny' || v === 'prompt') return v
    return 'deny'
  }
  const permVal = (key) => isOwner ? 'allow' : norm(role.permissions?.[key])
  const allInGroup = (group, val) => {
    if (isOwner) return
    const next = {...(role.permissions||{})}
    group.items.forEach(([k]) => { next[k] = val })
    setRole(p => ({...p, permissions: next}))
  }

  return (
    <div className="bg-[#FFFFFF] rounded-2xl p-5 mb-4" style={{border:'2px solid #006AFF'}}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-[15px] font-bold text-[#006AFF]">
            {creating ? '➕ New Role' : `✏️ Edit Role: ${role.name}`}
          </div>
          {isOwner && (
            <div className="text-[10px] text-[#92400e] mt-1 rounded px-2 py-1 inline-block" style={{background:'#fef3c7'}}>
              ⚠️ {role.name} role always has full access — permissions cannot be reduced
            </div>
          )}
        </div>
        <button onClick={onCancel}
          className="w-8 h-8 rounded-full border-none cursor-pointer text-[14px]"
          style={{background:'#F1F5F9', color:'#64748b'}}>✕</button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div>
          <SLabel>Role name {role.is_system && <span className="text-[#999] font-normal">(system role, locked)</span>}</SLabel>
          <input value={role.name||''} onChange={e=>set('name', e.target.value)}
            disabled={role.is_system}
            placeholder="e.g. Floor Supervisor"
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{border:'1.5px solid #80B2FF', background: role.is_system?'#f1f5f9':'#fff'}}/>
        </div>
        <div className="col-span-2">
          <SLabel>Description</SLabel>
          <input value={role.description||''} onChange={e=>set('description', e.target.value)}
            placeholder="When to assign this role"
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{border:'1.5px solid #80B2FF', background:'#fff'}}/>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <div>
          <SLabel>Max discount this role can apply</SLabel>
          <div className="flex items-center gap-2">
            <input type="range" min="0" max="100" step="5"
              value={role.max_discount_pct||0}
              onChange={e=>set('max_discount_pct', parseInt(e.target.value))}
              disabled={isOwner}
              className="flex-1 cursor-pointer"/>
            <div className="rounded-md px-3 py-1.5 text-[13px] font-mono font-bold w-[60px] text-center"
              style={{background:'#E6F0FF', color:'#006AFF'}}>
              {isOwner ? '100' : (role.max_discount_pct||0)}%
            </div>
          </div>
          <div className="text-[10px] text-[#666] mt-1">
            Cap on % off a cashier with this role can give. 0 = none.
          </div>
        </div>
      </div>

      {/* Permission groups */}
      <div className="space-y-3">
        {PERMISSION_GROUPS.map(group => {
          const totalInGroup = group.items.length
          const cnt = { allow:0, deny:0, prompt:0 }
          group.items.forEach(([k]) => {
            const v = isOwner ? 'allow' : norm(role.permissions?.[k])
            cnt[v] = (cnt[v]||0) + 1
          })
          return (
            <div key={group.id} className="rounded-xl overflow-hidden"
              style={{border:'1px solid #E5E5E5'}}>
              <div className="px-4 py-2.5 flex items-center justify-between"
                style={{background:'#FAFAFA', borderBottom:'1px solid #E5E5E5'}}>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[18px]">{group.icon}</span>
                  <div>
                    <div className="text-[13px] font-bold">{group.title}</div>
                    <div className="text-[10px] text-[#666]">{group.description}</div>
                  </div>
                </div>
                <div className="text-[10px] font-mono mr-3 flex gap-1.5">
                  <span style={{color:'#15803d'}}>✓{cnt.allow}</span>
                  <span style={{color:'#ca8a04'}}>?{cnt.prompt}</span>
                  <span style={{color:'#991b1b'}}>✗{cnt.deny}</span>
                </div>
                {!isOwner && (
                  <div className="flex gap-1">
                    <button onClick={()=>allInGroup(group, 'allow')}
                      className="rounded px-2 py-1 text-[10px] cursor-pointer"
                      style={{background:'#dcfce7', color:'#15803d', border:'1px solid #86efac'}}>All ✓</button>
                    <button onClick={()=>allInGroup(group, 'prompt')}
                      className="rounded px-2 py-1 text-[10px] cursor-pointer"
                      style={{background:'#fefce8', color:'#ca8a04', border:'1px solid #fde047'}}>All ?</button>
                    <button onClick={()=>allInGroup(group, 'deny')}
                      className="rounded px-2 py-1 text-[10px] cursor-pointer"
                      style={{background:'#fef2f2', color:'#991b1b', border:'1px solid #fecaca'}}>None</button>
                  </div>
                )}
              </div>
              <div className="p-2 grid grid-cols-1 gap-1">
                {group.items.map(item => {
                  const [key, label, desc, opts] = item
                  const sensitive = opts?.sensitive
                  const val = permVal(key)
                  const STATES = [
                    { id:'allow',  label:'✓ Allow',   bg:'#dcfce7', fg:'#15803d', border:'#86efac' },
                    { id:'prompt', label:'? Prompt',  bg:'#fefce8', fg:'#ca8a04', border:'#fde047' },
                    { id:'deny',   label:'✗ Deny',    bg:'#fef2f2', fg:'#991b1b', border:'#fecaca' },
                  ]
                  return (
                    <div key={key}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                      style={{
                        background: val === 'allow' ? '#f0fdf4' : val === 'prompt' ? '#fffbeb' : '#fff',
                        border: '1px solid ' + (val === 'allow' ? '#bbf7d0' : val === 'prompt' ? '#fde047' : '#E5E5E5'),
                        opacity: isOwner ? 0.85 : 1,
                      }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold flex items-center gap-1.5">
                          <span style={{color:'#1F1F1F'}}>{label}</span>
                          {sensitive && <span title="Sensitive permission"
                            className="text-[9px] rounded px-1.5 py-0.5 font-bold"
                            style={{background:'#fef2f2', color:'#dc2626'}}>!</span>}
                        </div>
                        {desc && <div className="text-[10px] text-[#666] mt-0.5">{desc}</div>}
                        <div className="text-[9px] font-mono text-[#999] mt-0.5">{key}</div>
                      </div>
                      <div className="flex rounded-lg overflow-hidden flex-shrink-0" style={{border:'1px solid #E5E5E5'}}>
                        {STATES.map(s => {
                          const active = val === s.id
                          return (
                            <button key={s.id}
                              onClick={() => !isOwner && setPerm(key, s.id)}
                              disabled={isOwner}
                              className="px-2.5 py-1.5 text-[10px] font-bold cursor-pointer border-none transition-all disabled:cursor-not-allowed"
                              style={{
                                background: active ? s.bg : '#fff',
                                color: active ? s.fg : '#94a3b8',
                                borderLeft: '1px solid #E5E5E5',
                              }}>
                              {s.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 mt-5">
        <button onClick={onCancel}
          className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
          style={{background:'#fff', color:'#666', border:'1px solid #E5E5E5'}}>Cancel</button>
        <button onClick={onSave}
          className="flex-1 rounded-lg py-2.5 text-[12px] font-bold text-white cursor-pointer border-none"
          style={{background:'#006AFF'}}>
          {creating ? '+ Create Role' : '✓ Save Changes'}
        </button>
      </div>
    </div>
  )
}


// ── Payment Config ──
function PaymentSection({ tenantId }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    cp_merchant_id: '', cp_username: '', cp_password: '', cp_endpoint: 'https://fts.cardconnect.com',
    refund_days_limit: '', require_pin_for_refund: true, require_pin_for_void: true,
    auto_batch_close: true, auto_batch_close_time: '02:00',
  })
  const [loaded, setLoaded] = useState(false)
  const u = (k,v) => setForm(p => ({...p,[k]:v}))

  useQuery({
    queryKey: ['payment-config', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('payment_configs')
        .select('*').eq('tenant_id', tenantId).maybeSingle()
      if (data) { setForm(f => ({ ...f, ...data })); setLoaded(true) }
      return data
    },
    enabled: !!tenantId && !loaded,
  })

  const save = async () => {
    await supabase.from('payment_configs').upsert({
      ...form, tenant_id: tenantId,
      is_configured: !!(form.cp_merchant_id && form.cp_username),
      configured_at: new Date().toISOString(),
    })
    qc.invalidateQueries(['payment-config'])
    toast.success('Payment configuration saved')
  }

  return (
    <div className="max-w-[560px]">
      <SectionTitle>💳 Card Payment Configuration</SectionTitle>

      <div className="bg-[#006AFF]/8 border border-blue-500/20 rounded-[10px] px-4 py-3 mb-5
        text-[12px] text-[#666666]">
        💡 CardPointe credentials are provided by RetailPOS support. Contact us to get your merchant account set up.
      </div>

      <Card className="mb-4">
        <CardTitle>CardPointe / First Data Credentials</CardTitle>
        <div className="grid grid-cols-2 gap-3">
          <FieldInput label="Merchant ID (MID)" value={form.cp_merchant_id}
            onChange={v => u('cp_merchant_id',v)} mono colSpan placeholder="Your MID"/>
          <FieldInput label="API Username" value={form.cp_username}
            onChange={v => u('cp_username',v)} placeholder="API username"/>
          <FieldInput label="API Password" value={form.cp_password}
            onChange={v => u('cp_password',v)} type="password" placeholder="API password"/>
          <FieldInput label="API Endpoint" value={form.cp_endpoint}
            onChange={v => u('cp_endpoint',v)} mono colSpan/>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
            form.cp_merchant_id && form.cp_username
              ? 'bg-green-500/10 text-[#00B23B]'
              : 'bg-[#F5F5F5] text-[#999999]'
          }`}>
            {form.cp_merchant_id && form.cp_username ? '✓ Configured' : 'Not configured'}
          </span>
        </div>
      </Card>

      <Card className="mb-4">
        <CardTitle>Refund Settings</CardTitle>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <FieldInput label="Refund Days Limit (blank = unlimited)"
            value={form.refund_days_limit} onChange={v => u('refund_days_limit',v)}
            type="number" colSpan placeholder="Leave blank for unlimited"/>
        </div>
        <div className="flex flex-col gap-2">
          {[
            ['require_pin_for_refund', 'Require PIN authorization for refunds'],
            ['require_pin_for_void',   'Require PIN authorization for voids'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 bg-[#F5F5F5] border
              border-[#E5E5E5] rounded-lg px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={form[key]}
                onChange={e => u(key, e.target.checked)}
                className="accent-blue-500 w-3.5 h-3.5"/>
              <span className="text-[12px] text-[#666666]">{label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <CardTitle>Batch Close Schedule</CardTitle>
        <label className="flex items-center gap-3 bg-[#F5F5F5] border border-[#E5E5E5]
          rounded-lg px-3 py-2.5 cursor-pointer mb-3">
          <input type="checkbox" checked={form.auto_batch_close}
            onChange={e => u('auto_batch_close', e.target.checked)}
            className="accent-blue-500 w-3.5 h-3.5"/>
          <span className="text-[12px] text-[#666666]">
            Auto batch close daily (server-triggered, no machine required)
          </span>
        </label>
        {form.auto_batch_close && (
          <div className="flex items-center gap-3">
            <FieldLabel>Close at (UTC)</FieldLabel>
            <input type="time" value={form.auto_batch_close_time}
              onChange={e => u('auto_batch_close_time', e.target.value)}
              className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2
                text-[13px] font-mono text-[#1F1F1F] outline-none focus:border-[#006AFF]"/>
          </div>
        )}
      </Card>

      <SaveBtn onClick={save}/>
    </div>
  )
}

// ── Billing ──
function BillingSection({ tenant }) {
  const PLANS = [
    { id:'solo',   name:'Solo',   users:1, terminals:1, price:'$29/mo' },
    { id:'team',   name:'Team',   users:3, terminals:3, price:'$79/mo' },
    { id:'pro',    name:'Pro',    users:6, terminals:6, price:'$149/mo' },
  ]
  return (
    <div className="max-w-[520px]">
      <SectionTitle>💰 Subscription & Billing</SectionTitle>
      <Card className="mb-4">
        <div className="flex justify-between mb-4">
          <div>
            <div className="text-[16px] font-bold">
              {tenant?.plan_id?.toUpperCase() || 'SOLO'} Plan
            </div>
            <div className="text-[12px] text-[#666666] mt-1">Billed monthly</div>
          </div>
          <span className="text-[10px] font-mono px-3 py-1.5 rounded bg-green-500/10
            text-[#00B23B] self-start">
            {tenant?.plan_status?.toUpperCase() || 'ACTIVE'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {PLANS.map(plan => (
            <div key={plan.id}
              onClick={() => toast.success(`Contact support to upgrade to ${plan.name}`)}
              className={`border rounded-[10px] p-3 cursor-pointer transition-all ${
                plan.id === (tenant?.plan_id || 'solo')
                  ? 'border-blue-500/40 bg-[#006AFF]/5'
                  : 'border-[#E5E5E5] bg-[#F5F5F5] hover:border-[#E5E5E5]'
              }`}>
              <div className="text-[13px] font-bold mb-1">{plan.name}</div>
              <div className="text-[15px] font-bold font-mono text-[#006AFF] mb-2">{plan.price}</div>
              <div className="text-[10px] text-[#999999]">
                {plan.users} user{plan.users>1?'s':''}<br/>
                {plan.terminals} terminal{plan.terminals>1?'s':''}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ── Language ──
function LanguageSection() {
  return (
    <div className="max-w-[400px]">
      <SectionTitle>🌐 Language & Region</SectionTitle>
      <Card>
        {[
          ['Interface Language', ['English','中文 (Chinese)','Español (Spanish)','한국어 (Korean)']],
          ['Currency', ['USD — US Dollar']],
          ['Date Format', ['MM/DD/YYYY','DD/MM/YYYY','YYYY-MM-DD']],
          ['Time Format', ['12 Hour (AM/PM)','24 Hour']],
        ].map(([label, options]) => (
          <div key={label} className="mb-4 last:mb-0">
            <FieldLabel>{label}</FieldLabel>
            <select className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px]
              px-3 py-2.5 text-[13px] text-[#1F1F1F] outline-none focus:border-[#006AFF]">
              {options.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        ))}
        <SaveBtn onClick={() => toast.success('Language saved')}/>
      </Card>
    </div>
  )
}

// ── Shared UI helpers ──
function SectionTitle({ children, className='' }) {
  return <div className={`text-[20px] font-bold mb-5 text-[#1F1F1F] ${className}`}>{children}</div>
}
function Card({ children, className='' }) {
  return (
    <div className={`bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-5 mb-5 ${className}`}>
      {children}
    </div>
  )
}
function CardTitle({ children }) {
  return <div className="text-[11px] font-bold text-[#999999] uppercase tracking-wider mb-3">{children}</div>
}
function FieldLabel({ children }) {
  return <div className="text-[11px] font-semibold text-[#666666] mb-1.5">{children}</div>
}
function FieldInput({ label, value, onChange, mono, type='text', colSpan, placeholder, className='' }) {
  return (
    <div className={`${colSpan ? 'col-span-2' : ''} ${className}`}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <input type={type} value={value||''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-[#FFFFFF] border border-[#E5E5E5] rounded-[8px] px-3 py-2.5
          text-[14px] text-[#1F1F1F] outline-none focus:border-[#006AFF] focus:ring-2 focus:ring-[#E6F0FF] transition-all
          ${mono ? 'font-mono' : ''}`}/>
    </div>
  )
}
function SaveBtn({ onClick, className='' }) {
  return (
    <button onClick={onClick}
      className={`bg-[#000000] hover:bg-[#1F1F1F] border-none rounded-[8px]
        px-6 py-3 text-[14px] font-semibold text-white transition-colors ${className}`}>
      Save Changes
    </button>
  )
}
function Toggle({ value, onChange, color='#006AFF' }) {
  return (
    <button onClick={() => onChange(!value)}
      className="w-[42px] h-[24px] rounded-full relative transition-colors flex-shrink-0 border-none cursor-pointer"
      style={{ background: value ? color : '#D1D1D1' }}>
      <div className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all shadow-sm"
        style={{ left: value ? '21px' : '3px' }}/>
    </button>
  )
}

// ── Member Levels ──
function MemberLevelsSection({ tenantId }) {
  const [levels,   setLevels]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [editId,   setEditId]   = useState(null)  // which row is editing
  const [editName, setEditName] = useState('')
  const [editDisc, setEditDisc] = useState('')
  const [adding,   setAdding]   = useState(false)  // show add form
  const [newName,  setNewName]  = useState('')
  const [newDisc,  setNewDisc]  = useState('0')
  const [saving,   setSaving]   = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('member_levels').select('*').order('sort_order')
    if (!data?.length && tenantId) {
      const defaults = [
        { tenant_id:tenantId, name:'Level 1 - Regular',  discount_pct:0, sort_order:0, is_default:true  },
        { tenant_id:tenantId, name:'Level 2 - Silver',   discount_pct:0, sort_order:1, is_default:false },
        { tenant_id:tenantId, name:'Level 3 - Gold',     discount_pct:0, sort_order:2, is_default:false },
        { tenant_id:tenantId, name:'Level 4 - Platinum', discount_pct:0, sort_order:3, is_default:false },
      ]
      const { data: created } = await supabase.from('member_levels').insert(defaults).select()
      setLevels(created || [])
    } else {
      setLevels(data || [])
    }
    setLoading(false)
  }

  useEffect(() => { if (tenantId) load() }, [tenantId])

  const startEdit = (level) => {
    setEditId(level.id)
    setEditName(level.name)
    setEditDisc(String(level.discount_pct || 0))
  }

  const saveEdit = async () => {
    if (!editName.trim()) { toast.error('Name required'); return }
    setSaving(true)
    await supabase.from('member_levels').update({
      name: editName.trim(),
      discount_pct: parseFloat(editDisc) || 0,
    }).eq('id', editId)
    setLevels(l => l.map(x => x.id === editId
      ? {...x, name: editName.trim(), discount_pct: parseFloat(editDisc)||0}
      : x))
    setEditId(null)
    setSaving(false)
    toast.success('✓ Saved')
  }

  const cancelEdit = () => setEditId(null)

  const addLevel = async () => {
    if (!newName.trim()) { toast.error('Name required'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.from('member_levels').insert({
        tenant_id: tenantId,
        name: newName.trim(),
        discount_pct: parseFloat(newDisc) || 0,
        sort_order: levels.length,
        is_default: false,
      }).select().single()
      if (error) throw error
      setLevels(l => [...l, data])
      setNewName(''); setNewDisc('0'); setAdding(false)
      toast.success(`✓ ${data.name} added`)
    } catch(e) {
      toast.error('Error: ' + e.message)
      console.error('addLevel error:', e)
    } finally {
      setSaving(false)
    }
  }

  const deleteLevel = async (id, isDefault) => {
    if (isDefault) { toast.error('Cannot delete default Level 1'); return }
    if (!window.confirm('Delete this level?')) return
    await supabase.from('member_levels').delete().eq('id', id)
    setLevels(l => l.filter(x => x.id !== id))
    toast.success('Deleted')
  }

  if (loading) return <div className="text-slate-400 p-4 text-[13px]">Loading...</div>

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <SectionTitle>🏅 Member Levels</SectionTitle>
        <button onClick={() => { setAdding(true); setNewName(''); setNewDisc('0') }}
          disabled={adding}
          className="rounded-xl px-4 py-2 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
          style={{background:'#000000'}}>
          + Add Level
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="rounded-2xl p-4 flex flex-col gap-3"
          style={{background:'#E6F0FF', border:'2px solid #80B2FF'}}>
          <div className="text-[12px] font-bold text-indigo-700">New Member Level</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Level Name *</div>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Diamond, VIP Gold..."
                autoFocus
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                style={{border:'1.5px solid #80B2FF', background:'#fff'}}
                onKeyDown={e => e.key === 'Enter' && addLevel()}/>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">VIP Discount %</div>
              <div className="flex items-center gap-2 rounded-xl px-3"
                style={{border:'1.5px solid #80B2FF', background:'#fff', height:'42px'}}>
                <input type="number" min="0" max="100" step="0.5"
                  value={newDisc} onChange={e => setNewDisc(e.target.value)}
                  className="flex-1 border-none outline-none text-[15px] font-bold bg-transparent"
                  style={{color:'#006AFF'}}/>
                <span className="text-[13px] text-slate-400 font-semibold">%</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">0% = no discount</div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAdding(false)}
              className="px-4 py-2 rounded-xl text-[12px] font-semibold cursor-pointer border"
              style={{background:'#fff', borderColor:'#e2e8f0', color:'#64748b'}}>
              Cancel
            </button>
            <button onClick={addLevel} disabled={saving || !newName.trim()}
              className="px-5 py-2 rounded-xl text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
              style={{background:'#000000'}}>
              {saving ? '⏳' : '✓ Save Level'}
            </button>
          </div>
        </div>
      )}

      {/* Levels list */}
      <div className="rounded-2xl overflow-hidden" style={{border:'1.5px solid #e2e8f0'}}>
        {/* Header */}
        <div className="grid px-5 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
          style={{gridTemplateColumns:'36px 1fr 140px 100px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>
          <div>#</div>
          <div>Level Name</div>
          <div>VIP Discount</div>
          <div>Actions</div>
        </div>

        <div className="bg-white divide-y" style={{borderColor:'#f1f5f9'}}>
          {levels.map((level, i) => (
            <div key={level.id}>
              {/* View row */}
              {editId !== level.id && (
                <div className="grid items-center px-5 py-3.5 gap-3"
                  style={{gridTemplateColumns:'36px 1fr 140px 100px',
                    background: level.is_default ? '#f0fdf4' : '#fff'}}>
                  <div className="text-[13px] font-bold text-slate-400">{i+1}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[16px]">{level.is_default ? '👤' : '⭐'}</span>
                    <span className="text-[14px] font-semibold text-slate-800">{level.name}</span>
                    {level.is_default && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{background:'#dcfce7', color:'#16a34a'}}>DEFAULT</span>
                    )}
                  </div>
                  <div>
                    {level.discount_pct > 0 ? (
                      <span className="text-[13px] font-bold px-2.5 py-1 rounded-lg"
                        style={{background:'#eff6ff', color:'#006AFF'}}>
                        {level.discount_pct}% off
                      </span>
                    ) : (
                      <span className="text-[12px] text-slate-400">No discount</span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => startEdit(level)}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer border transition-all"
                      style={{background:'#E6F0FF', borderColor:'#B3D1FF', color:'#006AFF'}}>
                      ✏️ Edit
                    </button>
                    {!level.is_default && (
                      <button onClick={() => deleteLevel(level.id, level.is_default)}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer border"
                        style={{background:'#fff1f2', borderColor:'#fecdd3', color:'#e11d48'}}>
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Edit row */}
              {editId === level.id && (
                <div className="px-5 py-4" style={{background:'#fffbeb', borderLeft:'3px solid #f59e0b'}}>
                  <div className="text-[11px] font-bold text-amber-600 mb-3">Editing Level {i+1}</div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Level Name</div>
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        autoFocus
                        className="w-full rounded-xl px-3 py-2.5 text-[13px] font-semibold outline-none"
                        style={{border:'1.5px solid #fde047', background:'#fff'}}
                        readOnly={level.is_default}/>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Discount %</div>
                      <div className="flex items-center gap-2 rounded-xl px-3"
                        style={{border:'1.5px solid #fde047', background:'#fff', height:'42px'}}>
                        <input type="number" min="0" max="100" step="0.5"
                          value={editDisc} onChange={e => setEditDisc(e.target.value)}
                          disabled={level.is_default}
                          className="flex-1 border-none outline-none text-[15px] font-bold bg-transparent"
                          style={{color:'#006AFF'}}/>
                        <span className="text-[13px] text-slate-400">%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={cancelEdit}
                      className="px-4 py-2 rounded-xl text-[12px] font-semibold cursor-pointer border"
                      style={{background:'#fff', borderColor:'#e2e8f0', color:'#64748b'}}>
                      Cancel
                    </button>
                    <button onClick={saveEdit} disabled={saving}
                      className="px-5 py-2 rounded-xl text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                      style={{background:'#006AFF'}}>
                      {saving ? '⏳' : '✓ Save Changes'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl px-4 py-3 flex gap-2 text-[11px]"
        style={{background:'#eff6ff', border:'1px solid #bfdbfe', color:'#3730a3'}}>
        ℹ️ <span>Discount % applies automatically at POS checkout for customers with that level. Level 1 is always the default.</span>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════
// 🖨️ PRINTER SETUP — Square white theme
// ════════════════════════════════════════════════
const DEFAULT_PRINTER = {
  name:    'Receipt Printer',        // friendly label
  windows_name: '',                  // exact Windows printer name (for cashier reference)
  ip:      '',                       // optional — for cashier reference / future direct printing
  paper:   '80mm',                   // 80mm / 58mm / a4
  station: '',                       // which station this is bound to (terminal ID)
}

function PrinterSection() {
  // Read terminal_id from terminalStore so per-station settings are bound to
  // the right station automatically. Same machine running 2 browsers can
  // hold 2 different configs (key includes terminal_id).
  const { terminalId } = useTerminalStore()
  const storageKey = `printerSettings:${terminalId || 'default'}`

  const [s, setS] = useState(() => {
    try { const v = localStorage.getItem(storageKey); return v ? { ...DEFAULT_PRINTER, ...JSON.parse(v) } : DEFAULT_PRINTER }
    catch { return DEFAULT_PRINTER }
  })
  // Detect station change → reload its settings
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey)
      setS(v ? { ...DEFAULT_PRINTER, ...JSON.parse(v) } : DEFAULT_PRINTER)
    } catch { setS(DEFAULT_PRINTER) }
  }, [storageKey])

  const save = () => {
    // Always write back the station ID so the cashier knows what they configured
    const toSave = { ...s, station: terminalId || 'default' }
    localStorage.setItem(storageKey, JSON.stringify(toSave))
    // Also write to the legacy key the receipt code reads — keeps existing
    // print path working without changes.
    localStorage.setItem('printerSettings', JSON.stringify(toSave))
    setS(toSave)
    toast.success('Printer saved for this station')
  }

  const test = () => {
    // Open a tiny test page and let the browser print dialog pop up.
    // On first use the cashier should pick the receipt printer and check
    // "Set as default" so Chrome remembers it for this site.
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Test Print</title>
      <style>
        body{font-family:monospace;font-size:12px;padding:10px;max-width:80mm;margin:0 auto;line-height:1.6;}
        .c{text-align:center;}.b{font-weight:bold;}.dash{text-align:center;color:#888;margin:6px 0;}
      </style></head><body>
        <div class="c b" style="font-size:14px;">★ TEST PRINT ★</div>
        <div class="dash">- - - - - - - - - - - - - - - -</div>
        <div>Station: <b>${(terminalId || 'default')}</b></div>
        <div>Printer: <b>${s.name || '—'}</b></div>
        <div>Win Name: <b>${s.windows_name || '—'}</b></div>
        <div>IP: <b>${s.ip || '—'}</b></div>
        <div>Paper: <b>${s.paper}</b></div>
        <div>Time: ${new Date().toLocaleString()}</div>
        <div class="dash">- - - - - - - - - - - - - - - -</div>
        <div class="c">If this prints, you're set! ✓</div>
        <div class="c" style="margin-top:8px;color:#666;font-size:10px;">
          First time: pick your printer in the dialog and<br/>check "Set as default" so Chrome remembers it.
        </div>
      </body></html>`
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow.document
    doc.open(); doc.write(html); doc.close()
    iframe.contentWindow.focus()
    setTimeout(() => {
      try { iframe.contentWindow.print() } catch (e) { console.error(e) }
      setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 1500)
    }, 200)
    toast.success('Print dialog opening — pick your receipt printer')
  }

  return (
    <div className="max-w-2xl">
      <SectionTitle>🖨️ Receipt Printer (this station)</SectionTitle>

      {/* Station badge */}
      <div className="rounded-lg p-3 mb-4 flex items-center gap-3"
        style={{background:'#eff6ff', border:'1px solid #80B2FF'}}>
        <span className="text-[20px]">📍</span>
        <div className="flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{color:'#1e40af'}}>
            Configuring station:
          </div>
          <div className="text-[14px] font-mono font-bold" style={{color:'#1e3a8a'}}>
            {terminalId || 'default'}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 text-right max-w-[180px]">
          Each station saves its own printer.<br/>Other terminals are unaffected.
        </div>
      </div>

      <Card>
        <CardTitle>Printer Identity</CardTitle>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <FieldInput label="Friendly Name" value={s.name}
            onChange={v => setS({ ...s, name:v })} placeholder="Front Counter Receipt" />
          <div>
            <FieldLabel>Paper Size</FieldLabel>
            <select value={s.paper} onChange={e => setS({ ...s, paper:e.target.value })}
              className="w-full bg-white border border-[#E5E5E5] rounded-[8px] px-3 py-2.5 text-[14px] text-[#1F1F1F] outline-none focus:border-[#006AFF]">
              <option value="80mm">80mm thermal (standard)</option>
              <option value="58mm">58mm thermal (compact)</option>
              <option value="a4">A4 / Letter (full page)</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <FieldLabel>Windows Printer Name <span style={{color:'#999'}}>(optional, for reference)</span></FieldLabel>
          <input type="text" value={s.windows_name}
            onChange={e => setS({ ...s, windows_name:e.target.value })}
            placeholder='e.g. "EPSON TM-T88VI Receipt"'
            className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[8px] px-3 py-2.5 text-[14px] outline-none focus:border-[#006AFF] font-mono"/>
          <div className="text-[10px] text-slate-400 mt-1">
            Copy the exact name from Windows Settings → Printers & Scanners.
            This is just a label so the cashier knows which printer to pick in the print dialog.
          </div>
        </div>

        <div>
          <FieldLabel>Printer IP / USB <span style={{color:'#999'}}>(optional)</span></FieldLabel>
          <input type="text" value={s.ip}
            onChange={e => setS({ ...s, ip:e.target.value })}
            placeholder="192.168.1.100 or USB001"
            className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-[8px] px-3 py-2.5 text-[14px] outline-none focus:border-[#006AFF] font-mono"/>
          <div className="text-[10px] text-slate-400 mt-1">
            For your reference / troubleshooting only. Browser always asks Windows
            for the printer list — this field doesn't change print behavior.
          </div>
        </div>
      </Card>

      {/* Setup instructions */}
      <Card className="mt-4">
        <CardTitle>📋 Setup Instructions</CardTitle>
        <ol className="text-[12px] leading-relaxed space-y-2" style={{color:'#475569'}}>
          <li><b>1.</b> Install the thermal printer in Windows like any normal printer (USB or network). Print a Windows test page from <i>Settings → Printers & Scanners → [your printer] → Manage → Print test page</i>. Get this working first.</li>
          <li><b>2.</b> In Windows: right-click the printer → Printing preferences → set paper to <b>80mm Receipt</b> (or whatever size you bought). Turn margins to 0.</li>
          <li><b>3.</b> Come back here: enter the Windows printer name above (helps you remember), pick paper size, and Save.</li>
          <li><b>4.</b> Click <b>Test Print</b> below. A print dialog opens — <b>pick your receipt printer</b> and check "<b>Save as default</b>". Done.</li>
          <li><b>5.</b> From now on, every POS payment auto-prints to the same printer for this station.</li>
        </ol>
      </Card>

      <div className="flex gap-3 mt-4">
        <button onClick={test}
          className="flex-1 px-4 py-3 rounded-[8px] text-[14px] font-semibold cursor-pointer border-2"
          style={{background:'#FFFFFF', color:'#006AFF', borderColor:'#006AFF'}}>
          🖨️ Test Print
        </button>
        <SaveBtn onClick={save} className="flex-1"/>
      </div>

      {/* Status / saved info */}
      {s.station && (
        <div className="mt-4 rounded-lg p-3 text-[12px]"
          style={{background:'#dcfce7', border:'1px solid #86efac', color:'#166534'}}>
          ✓ <b>Saved for station {s.station}</b>
          {s.windows_name && <> — print dialog should show <span className="font-mono font-bold">"{s.windows_name}"</span> as a choice</>}.
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════
// 📄 PRINT SETTINGS — Square white theme + live preview
// ════════════════════════════════════════════════
const DEFAULT_PRINTING = {
  fontSize: 'medium',
  show: {
    logo: false, storeName: true, address: true, phone: true,
    header: false, orderNumber: true, dateTime: true,
    cashier: true, customer: true,
    items: true, discount: true, tax: true, total: true,
    paymentMethod: true, change: true,
    footer: true, thankYou: true, qrCode: false,
  },
  headerText: 'Welcome!',
  footerText: 'Returns within 30 days with receipt.',
  autoMode: 'ask',
  copies: 1,
  enableEmail: false,
  enableSms: false,
}

// ════════════════════════════════════════════════
// 💰 CASH DRAWER — opens via receipt printer ESC/POS
// ════════════════════════════════════════════════
function CashDrawerSection() {
  const [s, setS] = useState(() => getCashDrawerSettings())
  const [testing, setTesting] = useState(false)

  const save = () => {
    saveCashDrawerSettings(s)
    toast.success('Cash drawer settings saved')
  }

  const test = async () => {
    setTesting(true)
    const r = await openCashDrawer()
    setTesting(false)
    if (r.ok) toast.success('✓ Drawer command sent')
    else toast.error(r.msg)
  }

  return (
    <div className="max-w-2xl">
      <SectionTitle>💰 Cash Drawer</SectionTitle>

      {/* Enable toggle */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <CardTitle>Enable Cash Drawer</CardTitle>
            <div className="text-[11px] text-slate-500">Show drawer button on POS + auto-open on cash payment</div>
          </div>
          <button onClick={() => setS({ ...s, enabled: !s.enabled })}
            className="w-12 h-6 rounded-full transition-all cursor-pointer border-none"
            style={{background: s.enabled ? '#16a34a' : '#cbd5e1'}}>
            <div className="w-5 h-5 bg-white rounded-full shadow transition-all"
              style={{marginLeft: s.enabled ? '24px' : '2px'}}/>
          </button>
        </div>

        {s.enabled && (
          <>
            <div className="mb-4">
              <FieldLabel>How is the drawer connected?</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['printer', '🖨️ Via Receipt Printer', 'Drawer plugged into the back of your thermal printer (RJ11/RJ12 cable). Recommended ⭐'],
                  ['manual',  '🔑 Manual Only',          'No electronic control. Only the manager key opens it.'],
                ].map(([val, label, desc]) => (
                  <button key={val} onClick={() => setS({ ...s, method: val })}
                    className="rounded-lg p-3 text-left cursor-pointer border-2 transition-all"
                    style={s.method === val
                      ? {background:'#eff6ff', borderColor:'#006AFF'}
                      : {background:'#fff', borderColor:'#e5e5e5'}}>
                    <div className="text-[12px] font-bold mb-1"
                      style={{color: s.method === val ? '#1e40af' : '#1F1F1F'}}>{label}</div>
                    <div className="text-[10px] text-slate-500 leading-snug">{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {s.method === 'printer' && (
              <>
                <div className="mb-4">
                  <FieldLabel>Auto-open drawer when…</FieldLabel>
                  <div className="space-y-2">
                    {[
                      ['open_on_cash',   '💵 After a cash payment', 'Drawer pops open automatically when cashier hits Pay with cash'],
                      ['open_on_refund', '↩️ After a cash refund',   'Drawer pops open when refunding to cash'],
                    ].map(([key, label, desc]) => (
                      <label key={key} className="flex items-start gap-3 cursor-pointer p-2 rounded hover:bg-slate-50">
                        <input type="checkbox" checked={!!s[key]}
                          onChange={() => setS({ ...s, [key]: !s[key] })}
                          className="mt-0.5 w-4 h-4 cursor-pointer"/>
                        <div className="flex-1">
                          <div className="text-[12px] font-semibold">{label}</div>
                          <div className="text-[10px] text-slate-500">{desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Advanced */}
                <details className="rounded-lg p-3" style={{background:'#fafafa', border:'1px solid #e5e5e5'}}>
                  <summary className="text-[12px] font-bold cursor-pointer text-slate-600">
                    ⚙️ Advanced: ESC/POS command bytes
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <FieldInput label="Pulse on (t1)" value={s.command_t1}
                      onChange={v => setS({ ...s, command_t1: v })} placeholder="25" mono/>
                    <FieldInput label="Pulse off (t2)" value={s.command_t2}
                      onChange={v => setS({ ...s, command_t2: v })} placeholder="250" mono/>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-2">
                    Most printers use ESC p 0 <b>25 250</b>. If your drawer won't open, try <b>50 50</b>
                    or check your printer manual for the correct pulse values.
                  </div>
                </details>
              </>
            )}
          </>
        )}
      </Card>

      {/* Setup help */}
      {s.enabled && s.method === 'printer' && (
        <Card className="mt-4">
          <CardTitle>📋 Setup Help</CardTitle>
          <ol className="text-[12px] leading-relaxed space-y-2" style={{color:'#475569'}}>
            <li><b>1.</b> Plug the drawer's RJ11/RJ12 cable into the <b>DK port</b> on the back of your thermal printer (NOT the network port — different jack).</li>
            <li><b>2.</b> Make sure your receipt printer is set up correctly first (see Printer Setup section).</li>
            <li><b>3.</b> Click <b>Test Open</b> below. If your drawer pops, you're done ✓</li>
            <li><b>4.</b> If nothing happens: check the Advanced section — try pulse 50/50 instead of 25/250. Some printers also need <i>"Raw Printer Mode"</i> in Windows driver settings (right-click printer → Properties → Advanced).</li>
          </ol>
        </Card>
      )}

      <div className="flex gap-3 mt-4">
        {s.enabled && s.method === 'printer' && (
          <button onClick={test} disabled={testing}
            className="flex-1 px-4 py-3 rounded-[8px] text-[14px] font-semibold cursor-pointer border-2 disabled:opacity-50"
            style={{background:'#FFFFFF', color:'#16a34a', borderColor:'#16a34a'}}>
            {testing ? 'Opening…' : '💰 Test Open Drawer'}
          </button>
        )}
        <SaveBtn onClick={save} className="flex-1"/>
      </div>
    </div>
  )
}


// ════════════════════════════════════════════════
// 📄 PRINT SETTINGS — Square white theme + live preview
// ════════════════════════════════════════════════
function PrintingSection() {
  const [s, setS] = useState(() => {
    try {
      const v = localStorage.getItem('printingSettings')
      const parsed = v ? JSON.parse(v) : {}
      return { ...DEFAULT_PRINTING, ...parsed, show: { ...DEFAULT_PRINTING.show, ...(parsed.show||{}) } }
    } catch { return DEFAULT_PRINTING }
  })

  const save = () => {
    localStorage.setItem('printingSettings', JSON.stringify(s))
    toast.success('Print settings saved')
  }

  const toggleShow = (key) => setS({ ...s, show: { ...s.show, [key]: !s.show[key] } })

  const fontPx = { small:11, medium:13, large:15 }[s.fontSize] || 13

  const PRINT_OPTIONS = [
    ['logo', 'Logo'], ['storeName', 'Store Name'], ['address', 'Address'], ['phone', 'Phone'],
    ['header', 'Header text'], ['orderNumber', 'Order Number'], ['dateTime', 'Date / Time'],
    ['cashier', 'Cashier'], ['customer', 'Customer'],
    ['items', 'Item lines'], ['discount', 'Discount'], ['tax', 'Tax'], ['total', 'Total'],
    ['paymentMethod', 'Payment'], ['change', 'Change'],
    ['footer', 'Footer text'], ['thankYou', 'Thank you'], ['qrCode', 'QR code'],
  ]

  return (
    <div>
      <SectionTitle>Print Settings</SectionTitle>

      <div className="grid gap-5" style={{gridTemplateColumns:'1fr 360px'}}>

        <div className="space-y-5">
          <Card>
            <CardTitle>Font Size</CardTitle>
            <div className="flex gap-2">
              {['small','medium','large'].map(size => (
                <button key={size} onClick={() => setS({ ...s, fontSize:size })}
                  className="flex-1 px-3 py-2.5 rounded-[8px] text-[13px] font-semibold cursor-pointer transition-all"
                  style={s.fontSize===size
                    ? { background:'#006AFF', color:'#FFFFFF', border:'none' }
                    : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
                  {size.charAt(0).toUpperCase()+size.slice(1)}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle>What to Display / Print</CardTitle>
            <div className="grid grid-cols-2 gap-2">
              {PRINT_OPTIONS.map(([key, label]) => (
                <label key={key}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-[8px] cursor-pointer transition-all"
                  style={s.show[key]
                    ? { background:'#E6F0FF', border:'1px solid #006AFF' }
                    : { background:'#FFFFFF', border:'1px solid #E5E5E5' }}>
                  <span className="text-[13px] font-medium" style={{color: s.show[key] ? '#006AFF' : '#1F1F1F'}}>{label}</span>
                  <Toggle value={s.show[key]} onChange={() => toggleShow(key)}/>
                </label>
              ))}
            </div>
          </Card>

          {(s.show.header || s.show.footer) && (
            <Card>
              <CardTitle>Custom Text</CardTitle>
              <div className="grid grid-cols-1 gap-3">
                {s.show.header && (
                  <FieldInput label="Header Text (top of receipt)" value={s.headerText}
                    onChange={v => setS({ ...s, headerText:v })} placeholder="Welcome!" />
                )}
                {s.show.footer && (
                  <FieldInput label="Footer Text (bottom of receipt)" value={s.footerText}
                    onChange={v => setS({ ...s, footerText:v })} placeholder="Returns within 30 days." />
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardTitle>When to Print</CardTitle>
            <div className="space-y-2">
              {[
                ['auto',   'Auto print',  'Print immediately when order completes'],
                ['ask',    'Ask first',   'Show a popup asking if you want to print'],
                ['manual', 'Manual only', 'Only when you click Print button'],
              ].map(([val, label, desc]) => (
                <label key={val}
                  className="block p-3 rounded-[8px] cursor-pointer transition-all"
                  style={s.autoMode===val
                    ? { background:'#E6F0FF', border:'2px solid #006AFF' }
                    : { background:'#FFFFFF', border:'1px solid #E5E5E5' }}>
                  <div className="flex items-start gap-3">
                    <input type="radio" checked={s.autoMode===val}
                      onChange={() => setS({ ...s, autoMode:val })}
                      className="mt-1 cursor-pointer accent-[#006AFF]"/>
                    <div>
                      <div className="text-[14px] font-semibold" style={{color: s.autoMode===val ? '#006AFF' : '#1F1F1F'}}>{label}</div>
                      <div className="text-[12px] mt-0.5" style={{color:'#666666'}}>{desc}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle>Number of Copies</CardTitle>
            <div className="flex gap-2 mb-2">
              {[1,2,3,4].map(n => (
                <button key={n} onClick={() => setS({ ...s, copies:n })}
                  className="flex-1 py-3 rounded-[8px] text-[18px] font-semibold cursor-pointer transition-all"
                  style={s.copies===n
                    ? { background:'#006AFF', color:'#FFFFFF', border:'none' }
                    : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
                  {n}
                </button>
              ))}
            </div>
            <div className="text-[12px]" style={{color:'#666666'}}>
              {s.copies===1 ? '1 copy → customer only' : `${s.copies} copies → e.g. customer + merchant${s.copies>2?' + record':''}`}
            </div>
          </Card>

          <Card>
            <CardTitle>Digital Receipt (Email / SMS)</CardTitle>

            <label className="flex items-center justify-between gap-3 px-3 py-3 rounded-[8px] cursor-pointer mb-2"
              style={s.enableEmail
                ? { background:'#E6F0FF', border:'1px solid #006AFF' }
                : { background:'#FFFFFF', border:'1px solid #E5E5E5' }}>
              <div className="flex items-start gap-3 flex-1">
                <span className="text-[20px]">📧</span>
                <div>
                  <div className="text-[14px] font-semibold" style={{color: s.enableEmail ? '#006AFF' : '#1F1F1F'}}>Email Receipt</div>
                  <div className="text-[12px]" style={{color:'#666666'}}>Send HTML receipt to customer's email</div>
                </div>
              </div>
              <Toggle value={s.enableEmail} onChange={v => setS({ ...s, enableEmail:v })}/>
            </label>

            <label className="flex items-center justify-between gap-3 px-3 py-3 rounded-[8px] cursor-pointer"
              style={s.enableSms
                ? { background:'#E6F0FF', border:'1px solid #006AFF' }
                : { background:'#FFFFFF', border:'1px solid #E5E5E5' }}>
              <div className="flex items-start gap-3 flex-1">
                <span className="text-[20px]">💬</span>
                <div>
                  <div className="text-[14px] font-semibold" style={{color: s.enableSms ? '#006AFF' : '#1F1F1F'}}>SMS Receipt</div>
                  <div className="text-[12px]" style={{color:'#666666'}}>Send a text message with receipt link</div>
                </div>
              </div>
              <Toggle value={s.enableSms} onChange={v => setS({ ...s, enableSms:v })}/>
            </label>

            {(s.enableEmail || s.enableSms) && s.autoMode === 'ask' && (
              <div className="mt-3 rounded-[8px] px-3 py-2.5 text-[12px]"
                style={{background:'#E6F7EC', border:'1px solid #00B23B', color:'#00B23B'}}>
                <span style={{fontWeight:600}}>Ask popup will include</span> Email{s.enableSms?' + SMS':''} input field{s.enableSms?'s':''} alongside Print/Skip options.
              </div>
            )}

            {(s.enableEmail || s.enableSms) && s.autoMode !== 'ask' && (
              <div className="mt-3 rounded-[8px] px-3 py-2.5 text-[12px]"
                style={{background:'#FFF7E6', border:'1px solid #FA8C16', color:'#FA8C16'}}>
                <span style={{fontWeight:600}}>Note:</span> Digital receipts only ask the customer when "Ask first" mode is selected. Switch "When to Print" to "Ask first" to use this.
              </div>
            )}
          </Card>

          <SaveBtn onClick={save} className="w-full"/>
        </div>

        <div>
          <CardTitle>Live Preview</CardTitle>
          <div className="rounded-[12px] overflow-hidden sticky top-0"
            style={{background:'#FFFFFF', border:'1px solid #E5E5E5'}}>
            <div className="px-4 py-2 text-[10px] font-mono uppercase flex justify-between"
              style={{color:'#999999', borderBottom:'1px solid #E5E5E5', background:'#FAFAFA'}}>
              <span>Receipt Preview</span>
              <span>{s.fontSize} · {s.copies}× copies</span>
            </div>
            <div className="px-5 py-5"
              style={{ fontFamily:'ui-monospace, monospace', fontSize:`${fontPx}px`, lineHeight:1.55, color:'#000' }}>
              {s.show.logo && (
                <div className="text-center mb-2">
                  <div className="inline-block px-3 py-1 rounded text-gray-500"
                    style={{background:'#F5F5F5', fontSize:`${fontPx-3}px`}}>[ LOGO ]</div>
                </div>
              )}
              {s.show.storeName && <div className="text-center font-bold tracking-wider" style={{fontSize:`${fontPx+3}px`}}>YOUR STORE NAME</div>}
              {s.show.address && <div className="text-center text-gray-700">123 Main Street</div>}
              {s.show.address && <div className="text-center text-gray-700">East Atlantic Beach, NY 11561</div>}
              {s.show.phone && <div className="text-center text-gray-700">(555) 123-4567</div>}
              <div className="my-2 text-center text-gray-400 select-none">- - - - - - - - - - - - - - - -</div>
              {s.show.header && s.headerText && <div className="text-center font-bold mb-2">{s.headerText}</div>}
              {s.show.orderNumber && <div className="flex justify-between"><span>Order #:</span><span className="font-mono">ORD-20260507-0001</span></div>}
              {s.show.dateTime && <div className="flex justify-between"><span>Date:</span><span className="font-mono">05/07/26 14:32</span></div>}
              {s.show.cashier && <div className="flex justify-between"><span>Cashier:</span><span>John D.</span></div>}
              {s.show.customer && <div className="flex justify-between"><span>Customer:</span><span>Walk-in</span></div>}
              <div className="my-2 text-center text-gray-400 select-none">- - - - - - - - - - - - - - - -</div>
              {s.show.items && (<>
                <div className="flex justify-between"><span>Apple ×1</span><span className="font-mono">$10.00</span></div>
                <div className="flex justify-between"><span>Coffee ×2</span><span className="font-mono">$8.00</span></div>
                <div className="flex justify-between"><span>Bread ×1</span><span className="font-mono">$5.00</span></div>
              </>)}
              <div className="my-2 text-center text-gray-400 select-none">- - - - - - - - - - - - - - - -</div>
              <div className="flex justify-between"><span>Subtotal:</span><span className="font-mono">$23.00</span></div>
              {s.show.discount && <div className="flex justify-between" style={{color:'#00B23B'}}><span>Discount:</span><span className="font-mono">-$2.00</span></div>}
              {s.show.tax && <div className="flex justify-between"><span>Tax (8.875%):</span><span className="font-mono">$1.85</span></div>}
              {s.show.total && (
                <div className="flex justify-between font-bold mt-1 pt-1 border-t border-gray-400" style={{fontSize:`${fontPx+2}px`}}>
                  <span>TOTAL:</span><span className="font-mono">$22.85</span>
                </div>
              )}
              {(s.show.paymentMethod || s.show.change) && <div className="my-2 text-center text-gray-400 select-none">- - - - - - - - - - - - - - - -</div>}
              {s.show.paymentMethod && <div className="flex justify-between"><span>Cash:</span><span className="font-mono">$25.00</span></div>}
              {s.show.change && <div className="flex justify-between"><span>Change:</span><span className="font-mono">$2.15</span></div>}
              <div className="my-3 text-center text-gray-400 select-none">- - - - - - - - - - - - - - - -</div>
              {s.show.thankYou && <div className="text-center font-bold">★ Thank you! ★</div>}
              {s.show.footer && s.footerText && <div className="text-center text-gray-700 mt-1" style={{fontSize:`${fontPx-1}px`}}>{s.footerText}</div>}
              {s.show.qrCode && (
                <div className="text-center mt-3">
                  <div className="inline-block w-20 h-20 bg-black p-1.5">
                    <div className="grid grid-cols-7 gap-px h-full">
                      {[1,1,1,0,1,1,1,1,0,1,0,0,0,1,1,0,1,1,1,0,1,1,0,0,1,1,0,1,1,0,1,0,0,1,1,1,0,1,1,1,0,1,1,1,1,0,1,1,1].map((v,i) => (
                        <div key={i} style={{background: v ? '#fff' : '#000'}}/>
                      ))}
                    </div>
                  </div>
                  <div className="mt-1 text-gray-500" style={{fontSize:`${fontPx-3}px`}}>Scan for digital receipt</div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 rounded-[8px] px-3 py-2.5 text-[12px]"
            style={{background:'#F5F5F5', border:'1px solid #E5E5E5', color:'#666666'}}>
            Preview updates as you change settings on the left.
          </div>
        </div>
      </div>
    </div>
  )
}


// ════════════════════════════════════════════════════════════════════
// 📨 NotificationsSection — quota + overage model
// ════════════════════════════════════════════════════════════════════
// Shows the owner: monthly free quota, used, overage, projected bill,
// per-trigger settings, SMS template editor with character counter.

function NotificationsSection({ tenantId, userId, userName }) {
  const qc = useQueryClient()
  const [templateModal, setTemplateModal] = useState(null) // trigger_type or null
  const [capModal, setCapModal] = useState(null)           // 'email' | 'sms' | null

  // ── Usage / quota ──
  const { data: m } = useQuery({
    queryKey: ['tenant-messaging', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tenant_messaging')
        .select('*').eq('tenant_id', tenantId).maybeSingle()
      return data || {
        plan_email_quota: 500, plan_sms_quota: 100,
        email_used_month: 0, sms_used_month: 0,
        email_overage_count: 0, sms_overage_count: 0,
        email_per_overage_cents: 5, sms_per_overage_cents: 5,
        email_overage_cap: 2000, sms_overage_cap: 2000,
        email_used_lifetime: 0, sms_used_lifetime: 0,
        billing_status: 'active',
      }
    },
    enabled: !!tenantId,
    refetchInterval: 30000,  // refresh every 30s
  })

  // ── Recent monthly bills ──
  const { data: bills = [] } = useQuery({
    queryKey: ['messaging-bills', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('messaging_monthly_bills')
        .select('*').eq('tenant_id', tenantId)
        .order('month', { ascending: false }).limit(12)
      return data || []
    },
    enabled: !!tenantId,
  })

  // ── Notification trigger settings ──
  const { data: tenant } = useQuery({
    queryKey: ['tenant-notif', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tenants')
        .select('notification_settings').eq('id', tenantId).single()
      return data
    },
    enabled: !!tenantId,
  })

  const defaults = {
    receipt:           { mode: 'ask' },
    invoice:           { mode: 'auto_email' },
    estimate:          { mode: 'auto_email' },
    payment_reminder:  { mode: 'off', days_before: 3 },
    birthday_coupon:   { mode: 'off', days_before: 5 },
    order_ready:       { mode: 'off' },
    low_stock_alert:   { mode: 'off', email_to: '' },
    daily_summary:     { mode: 'off', hour: 23, email_to: '' },
    loyalty_update:    { mode: 'off' },
    cash_variance:     { mode: 'off', email_to: '' },
    welcome_member:    { mode: 'off' },
  }
  const settings = { ...defaults, ...(tenant?.notification_settings || {}) }

  const updateSetting = async (key, patch) => {
    const next = { ...settings, [key]: { ...settings[key], ...patch } }
    const { error } = await supabase.from('tenants')
      .update({ notification_settings: next }).eq('id', tenantId)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['tenant-notif', tenantId] })
  }

  // Derived values
  const eUsed = m?.email_used_month || 0
  const eQuota = m?.plan_email_quota || 500
  const eOverage = m?.email_overage_count || 0
  const eRate = (m?.email_per_overage_cents || 5) / 100
  const eOverageBill = (eOverage * (m?.email_per_overage_cents || 5)) / 100
  const eRemaining = Math.max(0, eQuota - eUsed)
  const ePct = Math.min(100, (eUsed / eQuota) * 100)
  const eCap = m?.email_overage_cap || 2000

  const sUsed = m?.sms_used_month || 0
  const sQuota = m?.plan_sms_quota || 100
  const sOverage = m?.sms_overage_count || 0
  const sRate = (m?.sms_per_overage_cents || 5) / 100
  const sOverageBill = (sOverage * (m?.sms_per_overage_cents || 5)) / 100
  const sRemaining = Math.max(0, sQuota - sUsed)
  const sPct = Math.min(100, (sUsed / sQuota) * 100)
  const sCap = m?.sms_overage_cap || 2000

  const totalBill = eOverageBill + sOverageBill
  const monthLabel = format(new Date(), 'MMMM yyyy')

  return (
    <div className="max-w-[920px]">
      <SectionTitle>📨 Notifications & Messaging</SectionTitle>
      <p className="text-[12px] text-[#666] mb-4">
        Free monthly quota included. Overage at <b>${eRate.toFixed(2)}/email</b> and <b>${sRate.toFixed(2)}/SMS</b>.
        SMS templates are locked to a single segment to prevent multi-charge.
      </p>

      {/* ── Month header + total bill ── */}
      <div className="rounded-2xl p-4 mb-4"
        style={{background:'linear-gradient(135deg,#1F1F1F 0%,#3a3a3a 100%)', color:'#fff'}}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider opacity-70">This Month</div>
            <div className="text-[18px] font-bold">{monthLabel}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider opacity-70">Overage bill</div>
            <div className="text-[28px] font-bold font-mono" style={{color: totalBill > 0 ? '#fde047' : '#a3e635'}}>
              ${totalBill.toFixed(2)}
            </div>
          </div>
        </div>
        {totalBill > 0 && (
          <div className="text-[11px] opacity-80">
            Will be billed at end of {monthLabel} • {eOverage} email + {sOverage} SMS over quota
          </div>
        )}
        {totalBill === 0 && (
          <div className="text-[11px] opacity-80">✓ Within free quota — no charges</div>
        )}
      </div>

      {/* ── Quota cards ── */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <QuotaCard
          icon="📧" name="Email"
          used={eUsed} quota={eQuota} pct={ePct}
          overage={eOverage} rate={eRate} bill={eOverageBill}
          remaining={eRemaining} cap={eCap}
          onEditCap={() => setCapModal('email')}
        />
        <QuotaCard
          icon="💬" name="SMS"
          used={sUsed} quota={sQuota} pct={sPct}
          overage={sOverage} rate={sRate} bill={sOverageBill}
          remaining={sRemaining} cap={sCap}
          onEditCap={() => setCapModal('sms')}
        />
      </div>

      {/* ── SMS Templates section ── */}
      <div className="rounded-xl p-3 mb-5"
        style={{background:'#fffbeb', border:'1px solid #fde68a'}}>
        <div className="flex items-start gap-3">
          <span className="text-[20px]">🔒</span>
          <div className="flex-1">
            <div className="text-[12px] font-bold text-[#92400e]">SMS Templates — Locked to Single Segment</div>
            <div className="text-[11px] text-[#92400e]/80 mt-0.5">
              English templates limited to 160 chars (GSM-7). Chinese to 70 chars (UCS-2).
              Anything over gets rejected to prevent multi-charge.
            </div>
            <button onClick={()=>setTemplateModal('all')}
              className="mt-2 rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white"
              style={{background:'#92400e'}}>
              📝 Edit SMS Templates
            </button>
          </div>
        </div>
      </div>

      {/* ── Triggers ── */}
      <div className="text-[13px] font-bold mb-2">🔔 Where & When to Send</div>
      <p className="text-[11px] text-[#666] mb-3">
        Each enabled trigger sends 1 message per event. Counts toward your monthly quota.
      </p>

      <div className="space-y-2.5 mb-6">
        <TriggerRow
          icon="🧾" title="Receipt" desc="When customer completes checkout" channels="📧 📱"
          options={[
            ['ask',        'Ask customer (default)'],
            ['auto_email', 'Auto-email if member has email'],
            ['off',        'Off — print only'],
          ]}
          value={settings.receipt.mode}
          onChange={v => updateSetting('receipt', { mode: v })}
        />
        <TriggerRow
          icon="📄" title="B2B Invoice" desc="When you create / send a wholesale invoice" channels="📧"
          options={[
            ['auto_email', 'Auto-email when created'],
            ['ask',        'Ask each time'],
            ['off',        'Off — manual only'],
          ]}
          value={settings.invoice.mode}
          onChange={v => updateSetting('invoice', { mode: v })}
        />
        <TriggerRow
          icon="📝" title="B2B Estimate" desc="When you create / send a quote" channels="📧"
          options={[
            ['auto_email', 'Auto-email when created'],
            ['ask',        'Ask each time'],
            ['off',        'Off'],
          ]}
          value={settings.estimate.mode}
          onChange={v => updateSetting('estimate', { mode: v })}
        />
        <TriggerRow
          icon="💰" title="Payment Reminder" desc="For unpaid B2B invoices before due date" channels="📧 📱"
          options={[['off','Off'],['on','Send reminder before due']]}
          value={settings.payment_reminder.mode}
          onChange={v => updateSetting('payment_reminder', { mode: v })}
          extra={settings.payment_reminder.mode !== 'off' && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
              <span className="text-[11px] text-[#666]">Send</span>
              <input type="number" min="1" max="30" value={settings.payment_reminder.days_before||3}
                onChange={e => updateSetting('payment_reminder', { days_before: parseInt(e.target.value)||3 })}
                className="w-14 rounded px-2 py-1 text-[12px] text-center font-mono"
                style={{border:'1px solid #80B2FF'}}/>
              <span className="text-[11px] text-[#666]">days before due date</span>
            </div>
          )}
        />
        <TriggerRow
          icon="🎂" title="Birthday Coupon" desc="Auto-send loyalty members a coupon" channels="📧 📱"
          options={[['off','Off'],['on','Send on birthday']]}
          value={settings.birthday_coupon.mode}
          onChange={v => updateSetting('birthday_coupon', { mode: v })}
          extra={settings.birthday_coupon.mode !== 'off' && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
              <span className="text-[11px] text-[#666]">Send</span>
              <input type="number" min="0" max="14" value={settings.birthday_coupon.days_before||5}
                onChange={e => updateSetting('birthday_coupon', { days_before: parseInt(e.target.value)||0 })}
                className="w-14 rounded px-2 py-1 text-[12px] text-center font-mono"
                style={{border:'1px solid #80B2FF'}}/>
              <span className="text-[11px] text-[#666]">days before birthday</span>
            </div>
          )}
        />
        <TriggerRow icon="📦" title="Order Ready" desc="'Your order is ready' SMS" channels="📱"
          options={[['off','Off'],['on','Manual button on each order']]}
          value={settings.order_ready.mode}
          onChange={v => updateSetting('order_ready', { mode: v })}
        />
        <TriggerRow icon="📦" title="Low Stock Alert" desc="Email owner when items drop below threshold" channels="📧"
          options={[['off','Off'],['on','Daily check, email if low']]}
          value={settings.low_stock_alert.mode}
          onChange={v => updateSetting('low_stock_alert', { mode: v })}
          extra={settings.low_stock_alert.mode !== 'off' && (
            <div className="mt-2 pt-2 border-t border-slate-100">
              <input type="email" value={settings.low_stock_alert.email_to||''}
                onChange={e => updateSetting('low_stock_alert', { email_to: e.target.value })}
                placeholder="Send to: owner@store.com"
                className="w-full rounded px-2 py-1.5 text-[12px]"
                style={{border:'1px solid #80B2FF'}}/>
            </div>
          )}
        />
        <TriggerRow icon="📊" title="Daily Summary Report" desc="Email today's totals at end of day" channels="📧"
          options={[['off','Off'],['on','Email automatically']]}
          value={settings.daily_summary.mode}
          onChange={v => updateSetting('daily_summary', { mode: v })}
          extra={settings.daily_summary.mode !== 'off' && (
            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100">
              <input type="email" value={settings.daily_summary.email_to||''}
                onChange={e => updateSetting('daily_summary', { email_to: e.target.value })}
                placeholder="Send to: owner@store.com"
                className="rounded px-2 py-1.5 text-[12px]"
                style={{border:'1px solid #80B2FF'}}/>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#666]">at</span>
                <input type="time" value={`${String(settings.daily_summary.hour||23).padStart(2,'0')}:00`}
                  onChange={e => updateSetting('daily_summary', { hour: parseInt(e.target.value.split(':')[0])||23 })}
                  className="flex-1 rounded px-2 py-1.5 text-[12px]"
                  style={{border:'1px solid #80B2FF'}}/>
              </div>
            </div>
          )}
        />
        <TriggerRow icon="⭐" title="Loyalty Update" desc="Notify member when earning / redeeming" channels="📧 📱"
          options={[['off','Off'],['earn_only','Only when they earn'],['both','Both earn & redeem']]}
          value={settings.loyalty_update.mode}
          onChange={v => updateSetting('loyalty_update', { mode: v })}
        />
        <TriggerRow icon="🚨" title="Cash Variance Alert" desc="When shift closes with variance > $5" channels="📧 📱"
          options={[['off','Off'],['on','Email on every variance']]}
          value={settings.cash_variance.mode}
          onChange={v => updateSetting('cash_variance', { mode: v })}
          extra={settings.cash_variance.mode !== 'off' && (
            <div className="mt-2 pt-2 border-t border-slate-100">
              <input type="email" value={settings.cash_variance.email_to||''}
                onChange={e => updateSetting('cash_variance', { email_to: e.target.value })}
                placeholder="Send alert to: owner@store.com"
                className="w-full rounded px-2 py-1.5 text-[12px]"
                style={{border:'1px solid #80B2FF'}}/>
            </div>
          )}
        />
        <TriggerRow icon="👋" title="Welcome New Member" desc="Send welcome email on signup" channels="📧"
          options={[['off','Off'],['on','Send on first signup']]}
          value={settings.welcome_member.mode}
          onChange={v => updateSetting('welcome_member', { mode: v })}
        />
      </div>

      {/* ── Recent monthly bills ── */}
      {bills.length > 0 && (
        <>
          <div className="text-[13px] font-bold mb-2">📜 Past Months</div>
          <div className="rounded-xl overflow-hidden mb-4" style={{border:'1px solid #E5E5E5'}}>
            <table className="w-full text-[12px]">
              <thead style={{background:'#FAFAFA'}}>
                <tr>
                  <th className="text-left px-3 py-2 font-bold">Month</th>
                  <th className="text-right px-3 py-2 font-bold">Email used</th>
                  <th className="text-right px-3 py-2 font-bold">Email overage</th>
                  <th className="text-right px-3 py-2 font-bold">SMS used</th>
                  <th className="text-right px-3 py-2 font-bold">SMS overage</th>
                  <th className="text-right px-3 py-2 font-bold">Total</th>
                  <th className="text-left px-3 py-2 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(b => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold">{format(new Date(b.month), 'MMM yyyy')}</td>
                    <td className="px-3 py-2 text-right font-mono">{b.email_used}/{b.email_quota}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{color: b.email_overage > 0 ? '#dc2626' : '#999'}}>
                      {b.email_overage > 0 ? `+${b.email_overage} ($${(b.email_overage_amount_cents/100).toFixed(2)})` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{b.sms_used}/{b.sms_quota}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{color: b.sms_overage > 0 ? '#dc2626' : '#999'}}>
                      {b.sms_overage > 0 ? `+${b.sms_overage} ($${(b.sms_overage_amount_cents/100).toFixed(2)})` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">${(b.total_amount_cents/100).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{
                          background: b.status==='paid'?'#dcfce7':b.status==='unpaid'?'#fef3c7':'#f1f5f9',
                          color: b.status==='paid'?'#15803d':b.status==='unpaid'?'#92400e':'#64748b',
                        }}>
                        {b.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {templateModal && (
        <SmsTemplatesModal tenantId={tenantId} onClose={()=>setTemplateModal(null)}/>
      )}
      {capModal && (
        <CapModal channel={capModal} tenantId={tenantId} current={m}
          onClose={()=>setCapModal(null)}
          onSave={() => { qc.invalidateQueries({queryKey:['tenant-messaging',tenantId]}); setCapModal(null) }}/>
      )}
    </div>
  )
}


function QuotaCard({ icon, name, used, quota, pct, overage, rate, bill, remaining, cap, onEditCap }) {
  // Color based on usage / overage state
  const overCap = overage >= cap
  const status = overCap ? 'over'
    : overage > 0 ? 'overage'
    : pct >= 90 ? 'nearly'
    : pct >= 70 ? 'warning'
    : 'safe'
  const borderColor = {safe:'#10b981', warning:'#f59e0b', nearly:'#ef4444', overage:'#9333ea', over:'#7f1d1d'}[status]
  const barFill = {safe:'#10b981', warning:'#f59e0b', nearly:'#ef4444', overage:'#9333ea', over:'#7f1d1d'}[status]
  const bgTint = {safe:'#f0fdf4', warning:'#fffbeb', nearly:'#fef2f2', overage:'#faf5ff', over:'#fef2f2'}[status]

  return (
    <div className="rounded-2xl overflow-hidden" style={{border:`2px solid ${borderColor}`}}>
      <div className="px-4 py-3" style={{background: bgTint}}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">{icon}</span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#666]">{name}</span>
          </div>
          <span className="text-[10px] font-mono text-[#666]">{used}/{quota}</span>
        </div>

        {/* Progress bar */}
        <div className="rounded-full h-2 overflow-hidden mb-2" style={{background:'#e5e5e5'}}>
          <div className="h-full transition-all" style={{width:`${pct}%`, background: barFill}}/>
        </div>

        <div className="flex justify-between text-[11px]">
          <span style={{color:'#666'}}>
            {remaining > 0 ? `${remaining} left in free quota` : 'Free quota used'}
          </span>
          <span className="font-bold" style={{color: borderColor}}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Overage row */}
      <div className="px-4 py-2 text-[11px]" style={{background:'#fff', borderTop:'1px solid #e5e5e5'}}>
        <div className="flex justify-between items-baseline">
          <span style={{color:'#666'}}>Overage this month:</span>
          <span className="font-mono font-bold" style={{color: overage > 0 ? '#9333ea' : '#999'}}>
            {overage > 0 ? `+${overage} = $${bill.toFixed(2)}` : '0'}
          </span>
        </div>
      </div>
      <div className="px-4 py-1.5 text-[10px] flex justify-between items-center" style={{background:'#fafafa'}}>
        <span style={{color:'#999'}}>Hard cap: {cap} overage (${(cap*rate).toFixed(0)}/mo max)</span>
        <button onClick={onEditCap}
          className="bg-transparent border-none cursor-pointer text-[10px] underline"
          style={{color:'#006AFF'}}>edit</button>
      </div>
      {overCap && (
        <div className="px-4 py-2 text-[10px]" style={{background:'#fee2e2', color:'#991b1b', borderTop:'1px solid #fca5a5'}}>
          ❌ Hard cap reached — {name} sending is blocked. Raise the cap to continue.
        </div>
      )}
    </div>
  )
}


function TriggerRow({ icon, title, desc, channels, options, value, onChange, extra }) {
  return (
    <div className="rounded-xl p-3 transition-all"
      style={{background:'#fff', border:'1px solid #E5E5E5'}}>
      <div className="flex items-start gap-3">
        <span className="text-[24px] mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold">{title}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{background:'#f1f5f9', color:'#64748b'}}>{channels}</span>
          </div>
          <div className="text-[11px] text-[#666] mt-0.5">{desc}</div>
          {extra}
        </div>
        <select value={value} onChange={e => onChange(e.target.value)}
          className="rounded-lg px-2.5 py-1.5 text-[11px] cursor-pointer outline-none font-semibold"
          style={{
            border: '1.5px solid ' + (value === 'off' ? '#e5e5e5' : '#80B2FF'),
            background: value === 'off' ? '#fff' : '#E6F0FF',
            color: value === 'off' ? '#94a3b8' : '#006AFF',
            minWidth:'170px',
          }}>
          {options.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}


// ── Cap edit modal — change hard cap for email or sms ──
function CapModal({ channel, tenantId, current, onClose, onSave }) {
  const isEmail = channel === 'email'
  const field = isEmail ? 'email_overage_cap' : 'sms_overage_cap'
  const rate = isEmail ? (current?.email_per_overage_cents||5) : (current?.sms_per_overage_cents||5)
  const [cap, setCap] = useState(current?.[field] || 2000)
  const [busy, setBusy] = useState(false)

  const maxBill = (cap * rate / 100).toFixed(0)

  const save = async () => {
    setBusy(true)
    const { error } = await supabase.from('tenant_messaging')
      .update({ [field]: cap }).eq('tenant_id', tenantId)
    setBusy(false)
    if (error) { toast.error(error.message); return }
    toast.success(`✓ ${isEmail?'Email':'SMS'} overage cap updated`)
    onSave()
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-3"
      style={{background:'rgba(0,0,0,0.55)', backdropFilter:'blur(4px)'}}
      onClick={onClose}>
      <div className="rounded-3xl overflow-hidden shadow-2xl w-full"
        style={{maxWidth:'420px', background:'#fff'}}
        onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'linear-gradient(135deg,#1F1F1F 0%,#3a3a3a 100%)'}}>
          <div>
            <div className="text-[16px] font-bold text-white">🛡️ {isEmail?'Email':'SMS'} Overage Cap</div>
            <div className="text-[10px] opacity-70 text-white mt-0.5">Maximum overage before sending is blocked</div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px]">✕</button>
        </div>
        <div className="p-5">
          <div className="text-[11px] text-[#666] mb-2">Maximum extra messages allowed beyond your free monthly quota.</div>
          <input type="number" min="0" max="100000" value={cap}
            onChange={e=>setCap(parseInt(e.target.value)||0)}
            className="w-full rounded-xl px-4 py-3 text-[24px] font-bold font-mono text-center"
            style={{border:'2px solid #80B2FF'}}/>
          <div className="rounded-xl mt-3 px-4 py-3" style={{background:'#fffbeb', border:'1px solid #fde68a'}}>
            <div className="text-[11px] text-[#92400e]">
              <b>Max bill per month:</b> ${maxBill}
            </div>
            <div className="text-[10px] text-[#92400e]/80 mt-0.5">
              ({cap} × ${(rate/100).toFixed(2)} per overage)
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={onClose}
              className="flex-1 rounded-xl py-3 text-[13px] font-bold cursor-pointer border-2"
              style={{background:'#fff', borderColor:'#e5e5e5', color:'#666'}}>
              Cancel
            </button>
            <button onClick={save} disabled={busy}
              className="flex-1 rounded-xl py-3 text-[13px] font-bold cursor-pointer border-none text-white disabled:opacity-40"
              style={{background:'#006AFF'}}>
              {busy ? '⏳' : '✓ Save Cap'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


// ── SMS template editor — character counting with hard limit ──
function SmsTemplatesModal({ tenantId, onClose }) {
  const qc = useQueryClient()
  const { data: rows = [] } = useQuery({
    queryKey: ['sms-templates', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('sms_templates')
        .select('*').eq('tenant_id', tenantId)
        .order('trigger_type').order('language')
      return data || []
    },
    enabled: !!tenantId,
  })

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-3"
      style={{background:'rgba(0,0,0,0.55)', backdropFilter:'blur(4px)'}}
      onClick={onClose}>
      <div className="rounded-3xl overflow-hidden shadow-2xl w-full flex flex-col"
        style={{maxWidth:'640px', maxHeight:'90vh', background:'#fff'}}
        onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0"
          style={{background:'linear-gradient(135deg,#92400e 0%,#451a03 100%)'}}>
          <div>
            <div className="text-[16px] font-bold text-white">📝 SMS Templates</div>
            <div className="text-[10px] text-amber-100 mt-0.5">Locked to single segment — can't exceed</div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px]">✕</button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          <div className="rounded-xl p-3 mb-4 text-[11px]"
            style={{background:'#fffbeb', border:'1px solid #fde68a', color:'#92400e'}}>
            <b>Available variables:</b> {'{store} {name} {order} {invoice} {amt} {date} {link} {code} {pct} {pts} {employee}'}
          </div>

          {rows.length === 0 ? (
            <div className="text-center py-8 text-[12px] text-[#999]">No templates yet — run the messaging SQL first</div>
          ) : (
            rows.map(row => (
              <TemplateEditor key={row.id} row={row}
                onSave={() => qc.invalidateQueries({queryKey:['sms-templates',tenantId]})}/>
            ))
          )}
        </div>
      </div>
    </div>
  )
}


function TemplateEditor({ row, onSave }) {
  const [text, setText] = useState(row.template_text)
  const [busy, setBusy] = useState(false)

  const rendered = renderTemplate(text, SAMPLE_VARS)
  const analysis = analyzeSms(rendered, 1)
  const status = segmentStatus(analysis, 1)

  const colors = {
    safe:  { fg:'#15803d', bg:'#f0fdf4', bar:'#10b981' },
    tight: { fg:'#92400e', bg:'#fffbeb', bar:'#f59e0b' },
    over:  { fg:'#991b1b', bg:'#fef2f2', bar:'#dc2626' },
  }[status]

  const pct = Math.min(100, (analysis.length / analysis.maxSingle) * 100)

  const save = async () => {
    if (analysis.isOverLimit) {
      toast.error('Template exceeds single SMS limit — shorten it first')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('sms_templates')
      .update({ template_text: text, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    setBusy(false)
    if (error) { toast.error(error.message); return }
    toast.success(`✓ ${row.trigger_type} (${row.language}) template saved`)
    onSave()
  }

  const reset = () => setText(row.template_text)

  const triggerLabels = {
    receipt:'🧾 Receipt', order_ready:'📦 Order Ready',
    payment_reminder:'💰 Payment Reminder', birthday_coupon:'🎂 Birthday',
    loyalty_update:'⭐ Loyalty', cash_variance:'🚨 Cash Variance',
  }

  return (
    <div className="rounded-xl mb-3 overflow-hidden" style={{border:'1px solid #E5E5E5'}}>
      <div className="px-3 py-2 flex items-center justify-between"
        style={{background:'#FAFAFA'}}>
        <span className="text-[12px] font-bold">
          {triggerLabels[row.trigger_type] || row.trigger_type}
          <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded"
            style={{background: row.language==='en'?'#dbeafe':'#fce7f3', color: row.language==='en'?'#1e40af':'#9f1239'}}>
            {row.language === 'en' ? 'English' : '中文'}
          </span>
        </span>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded"
          style={{background: colors.bg, color: colors.fg}}>
          {analysis.length}/{analysis.maxSingle} {analysis.encoding}
        </span>
      </div>

      <div className="p-3">
        <textarea value={text} onChange={e=>setText(e.target.value)} rows={2}
          className="w-full rounded-lg px-3 py-2 text-[12px] font-mono resize-none"
          style={{border: '2px solid ' + (analysis.isOverLimit ? '#dc2626' : '#80B2FF')}}/>

        {/* Progress bar */}
        <div className="rounded-full h-1.5 mt-2 overflow-hidden" style={{background:'#e5e5e5'}}>
          <div className="h-full transition-all" style={{width:`${pct}%`, background: colors.bar}}/>
        </div>

        {/* Preview */}
        <div className="text-[10px] text-[#999] mt-2">Preview with sample values:</div>
        <div className="text-[11px] font-mono mt-0.5 rounded-lg px-2 py-1.5"
          style={{background: colors.bg, color: colors.fg, border: `1px solid ${colors.bar}33`}}>
          {rendered || <span className="text-[#999]">(empty)</span>}
        </div>

        {analysis.isOverLimit && (
          <div className="text-[10px] mt-1.5 px-2 py-1 rounded"
            style={{background:'#fee2e2', color:'#991b1b'}}>
            ❌ Exceeds single SMS — would charge {analysis.segments}× — can't save
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <button onClick={reset}
            className="rounded-lg px-3 py-1.5 text-[11px] cursor-pointer border-2"
            style={{background:'#fff', borderColor:'#e5e5e5', color:'#666'}}>
            Reset
          </button>
          <button onClick={save} disabled={busy || analysis.isOverLimit || text === row.template_text}
            className="flex-1 rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border-none text-white disabled:opacity-40"
            style={{background:'#006AFF'}}>
            {busy ? '⏳' : '✓ Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// 📺 DisplaySection — Customer-Facing Display configuration
// ════════════════════════════════════════════════════════════════════
// Stored on tenants.display_settings JSONB. Includes interactive feature
// toggles (tip/sig/email/sms entry), the join-member CTA, and the promo
// image carousel shown when idle.

function DisplaySection({ tenantId }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  const { data: tenant } = useQuery({
    queryKey: ['tenant-display', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tenants')
        .select('display_settings').eq('id', tenantId).single()
      return data
    },
    enabled: !!tenantId,
  })

  const defaults = {
    enable_tip_on_display:      false,
    enable_signature_on_display:false,
    enable_email_on_display:    false,
    enable_sms_on_display:      false,
    show_join_cta:              true,
    show_promo_carousel:        true,
    promo_images:               [],   // array of URLs
    logo_url:                   '',
  }
  const settings = { ...defaults, ...(tenant?.display_settings || {}) }

  const update = async (patch) => {
    setBusy(true)
    const next = { ...settings, ...patch }
    const { error } = await supabase.from('tenants')
      .update({ display_settings: next }).eq('id', tenantId)
    setBusy(false)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey:['tenant-display', tenantId] })
  }

  // ── Image upload to Supabase storage ──
  const uploadImage = async (file) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('Image too large (max 2MB)'); return }
    setBusy(true)
    const ext = file.name.split('.').pop()
    const fname = `display-promo-${tenantId}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('public-uploads').upload(fname, file, { upsert:false })
    if (upErr) { setBusy(false); toast.error(upErr.message); return }
    const { data: { publicUrl } } = supabase.storage.from('public-uploads').getPublicUrl(fname)
    await update({ promo_images: [...(settings.promo_images||[]), publicUrl] })
    setBusy(false)
    toast.success('✓ Image uploaded')
  }

  const removeImage = (url) => {
    update({ promo_images: settings.promo_images.filter(u => u !== url) })
  }

  const previewDisplay = () => {
    const url = `/display?tenant=${tenantId}&terminal=preview`
    window.open(url, 'rpos-display-preview', 'popup,width=1024,height=768')
  }

  return (
    <div className="max-w-[860px]">
      <SectionTitle>📺 Customer-Facing Display</SectionTitle>
      <p className="text-[12px] text-[#666] mb-4">
        Configure the customer display that runs on a second monitor. Cart state
        syncs live from the POS. Toggle interactive features below.
      </p>

      {/* Preview + how-to */}
      <div className="rounded-2xl p-4 mb-5"
        style={{background:'linear-gradient(135deg, #006AFF 0%, #003a8c 100%)', color:'#fff'}}>
        <div className="flex items-start gap-3 mb-3">
          <span className="text-[28px]">📺</span>
          <div className="flex-1">
            <div className="text-[14px] font-bold">How to use</div>
            <div className="text-[12px] opacity-90 mt-1">
              1. In POS top bar, tap <b>📺</b> to open the display in a new window.<br/>
              2. Drag that window to your second monitor.<br/>
              3. Press <b>F11</b> on the display window to enter fullscreen.<br/>
              4. The display will mirror the cart in real-time.
            </div>
          </div>
        </div>
        <button onClick={previewDisplay}
          className="rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer border-none bg-white"
          style={{color:'#006AFF'}}>
          👁️ Preview Display in New Window
        </button>
      </div>

      {/* Interactive feature toggles */}
      <div className="text-[13px] font-bold mb-2">🎛️ Interactive Features</div>
      <p className="text-[11px] text-[#666] mb-3">
        Turn on features the customer can interact with on the display.
      </p>
      <div className="space-y-2 mb-5">
        <ToggleRow icon="💰" title="Tip selection on display"
          desc="Customer picks 15/18/20/25% or custom tip directly on the display"
          value={settings.enable_tip_on_display}
          onChange={v => update({ enable_tip_on_display: v })}/>
        <ToggleRow icon="✍️" title="Signature capture"
          desc="Customer signs on the display for credit card receipts (touch / mouse)"
          value={settings.enable_signature_on_display}
          onChange={v => update({ enable_signature_on_display: v })}/>
        <ToggleRow icon="📧" title="Email receipt entry"
          desc="Customer types their email on the display to receive a digital receipt"
          value={settings.enable_email_on_display}
          onChange={v => update({ enable_email_on_display: v })}/>
        <ToggleRow icon="📱" title="SMS receipt entry"
          desc="Customer types their phone on the display to receive an SMS receipt"
          value={settings.enable_sms_on_display}
          onChange={v => update({ enable_sms_on_display: v })}/>
      </div>

      {/* Branding & content */}
      <div className="text-[13px] font-bold mb-2">🎨 Branding & Content</div>
      <div className="space-y-2 mb-5">
        <ToggleRow icon="⭐" title="Show 'Join Rewards' CTA"
          desc="Non-member customers see a prompt to join your loyalty program"
          value={settings.show_join_cta}
          onChange={v => update({ show_join_cta: v })}/>
        <ToggleRow icon="🖼️" title="Promo image carousel"
          desc="Rotate through promo images on the idle/welcome screen (5s each)"
          value={settings.show_promo_carousel}
          onChange={v => update({ show_promo_carousel: v })}/>
      </div>

      {/* Promo images */}
      {settings.show_promo_carousel && (
        <>
          <div className="text-[13px] font-bold mb-2">📸 Promo Images</div>
          <p className="text-[11px] text-[#666] mb-3">
            Upload images to rotate on the idle screen. Recommended 1920×1080 (16:9).
            Max 2MB each.
          </p>

          <div className="grid grid-cols-3 gap-3 mb-3">
            {(settings.promo_images||[]).map((url, i) => (
              <div key={i} className="relative rounded-xl overflow-hidden group"
                style={{aspectRatio:'16/9', border:'1px solid #e5e5e5'}}>
                <img src={url} alt="" className="w-full h-full object-cover"/>
                <button onClick={() => removeImage(url)}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full cursor-pointer border-none text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{background:'rgba(220,38,38,0.95)'}}>
                  ✕
                </button>
              </div>
            ))}
            <label className="rounded-xl cursor-pointer flex flex-col items-center justify-center gap-1 transition-all"
              style={{aspectRatio:'16/9', background:'#f8fafc', border:'2px dashed #80B2FF'}}>
              <input type="file" accept="image/*" className="hidden"
                onChange={e => uploadImage(e.target.files?.[0])}/>
              <span className="text-[28px]">📤</span>
              <span className="text-[11px] font-bold" style={{color:'#006AFF'}}>
                {busy ? 'Uploading...' : 'Add image'}
              </span>
            </label>
          </div>
        </>
      )}
    </div>
  )
}


function ToggleRow({ icon, title, desc, value, onChange }) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all"
      style={value
        ? {background:'#E6F0FF', border:'1px solid #006AFF'}
        : {background:'#fff', border:'1px solid #e5e5e5'}}>
      <span className="text-[24px] flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold" style={{color: value ? '#006AFF' : '#1F1F1F'}}>{title}</div>
        <div className="text-[11px] text-[#666] mt-0.5">{desc}</div>
      </div>
      <div className="flex-shrink-0 ml-2">
        <button onClick={() => onChange(!value)}
          className="relative rounded-full cursor-pointer border-none transition-all"
          style={{
            width:'44px', height:'24px',
            background: value ? '#006AFF' : '#cbd5e1',
          }}>
          <div className="absolute top-0.5 transition-all rounded-full bg-white"
            style={{ width:'20px', height:'20px', left: value ? '22px' : '2px' }}/>
        </button>
      </div>
    </label>
  )
}
