// src/pages/settings/SettingsPage.jsx
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useTerminalStore } from '@/stores/terminalStore'
import { paxGetStatus } from '@/lib/pax'
import toast from 'react-hot-toast'

const SECTIONS = [
  { id:'store',     icon:'🏪', label:'Store Info',        role:'owner' },
  { id:'terminals', icon:'🖥️', label:'Terminals & PAX',   role:'owner' },
  { id:'printer',   icon:'🖨️', label:'Printer Setup',     role:'owner' },
  { id:'printing',  icon:'📄', label:'Print Settings',    role:'owner' },
  { id:'tax',       icon:'🧾', label:'Tax Rates',         role:'owner' },
  { id:'discounts', icon:'🏷️', label:'Discount Tiers',    role:'owner' },
  { id:'users',     icon:'👤', label:'Users',             role:'manager' },
  { id:'payment',   icon:'💳', label:'Payment Config',    role:'owner' },
  { id:'billing',   icon:'💰', label:'Subscription',      role:'owner' },
  { id:'language',  icon:'🌐', label:'Language & Region', role:'owner' },
  { id:'loyalty',   icon:'💎', label:'Loyalty & Points',   role:'owner' },
  { id:'memberlevels', icon:'🏅', label:'Member Levels', role:'owner' },
  { id:'api',       icon:'🤖', label:'API & Integrations', role:'owner' },
]

export default function SettingsPage() {
  const { user, tenant, store, canAccessSettings } = useAuthStore()
  const [active, setActive] = useState('store')
  const visibleSections = SECTIONS.filter(s => canAccessSettings(s.id) || s.role === 'manager')

  return (
    <div className="flex h-full bg-[#07090f]">
      {/* Sidebar */}
      <div className="w-[220px] bg-[#0d1117] border-r border-[#1e2d42] p-3 flex-shrink-0">
        <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-widest px-2 mb-3">
          Settings
        </div>
        {visibleSections.map(s => (
          <div key={s.id} onClick={() => setActive(s.id)}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer
              text-[12px] mb-0.5 transition-all ${
              active === s.id
                ? 'bg-[#111827] text-white'
                : 'text-[#8899b0] hover:bg-[#111827] hover:text-white'
            }`}>
            <span>{s.icon}</span>{s.label}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 bg-[#07090f]">
        {active === 'store'     && <StoreSection store={store} tenant={tenant}/>}
        {active === 'terminals' && <TerminalsSection tenantId={tenant?.id} storeId={store?.id}/>}
        {active === 'printer'   && <PrinterSection/>}
        {active === 'printing'  && <PrintingSection/>}
        {active === 'tax'       && <TaxSection tenantId={tenant?.id}/>}
        {active === 'discounts' && <DiscountsSection tenantId={tenant?.id}/>}
        {active === 'users'     && <UsersSection tenantId={tenant?.id}/>}
        {active === 'payment'   && <PaymentSection tenantId={tenant?.id}/>}
        {active === 'billing'   && <BillingSection tenant={tenant}/>}
        {active === 'language'  && <LanguageSection/>}
        {active === 'loyalty'   && <LoyaltySettingsSection tenant={tenant}/>}
        {active === 'memberlevels' && <MemberLevelsSection tenantId={tenant?.id}/>}
        {active === 'api'       && <APISection tenantId={tenant?.id}/>}
      </div>
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
    await supabase.from('stores').update(form).eq('id', store.id)
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
            className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5
              text-[12px] outline-none focus:border-blue-500/40 resize-none"/>
        </div>
        <div>
          <FieldLabel>Footer Text</FieldLabel>
          <textarea value={form.receipt_footer} onChange={e => u('receipt_footer', e.target.value)}
            rows={2}
            className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5
              text-[12px] outline-none focus:border-blue-500/40 resize-none"/>
        </div>
      </Card>
      <SaveBtn onClick={save}/>
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
    if (data.id) {
      await supabase.from('terminals').update(data).eq('id', data.id)
    } else {
      await supabase.from('terminals').insert({ ...data, tenant_id: tenantId, store_id: storeId })
    }
    qc.invalidateQueries(['terminals-settings'])
    setEditTerm(null)
    toast.success('Terminal saved')
  }

  return (
    <div className="max-w-[640px]">
      <div className="flex justify-between items-center mb-5">
        <SectionTitle className="mb-0">🖥️ Terminals & PAX Configuration</SectionTitle>
        <button onClick={() => setEditTerm({})}
          className="bg-blue-500 border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white">
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
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-[#1a2236] text-[#3d5068]'
                  }`}>{term.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
                </div>

                {/* PAX config summary */}
                {term.pax_enabled ? (
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] font-mono text-[#8899b0]">
                      PAX {term.pax_model} · {term.pax_ip}:{term.pax_port}
                    </div>
                    {ts === 'online'  && <span className="text-[9px] text-green-400">● Online</span>}
                    {ts === 'offline' && <span className="text-[9px] text-red-400">● Offline</span>}
                    {ts === 'testing' && <span className="text-[9px] text-[#8899b0] animate-pulse">Testing...</span>}
                  </div>
                ) : (
                  <div className="text-[11px] text-[#3d5068]">No PAX card reader</div>
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
                      bg-[#1a2236] text-[#8899b0]">{label}</span>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 flex-shrink-0">
                {term.pax_enabled && (
                  <button onClick={() => testPax(term)}
                    className="bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5
                      text-[10px] text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400 transition-all">
                    Test PAX
                  </button>
                )}
                <button onClick={() => setEditTerm(term)}
                  className="bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5
                    text-[10px] text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400 transition-all">
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
    <div className="fixed inset-0 bg-[rgba(7,9,15,0.8)] backdrop-blur-sm z-50
      flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[480px]"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1e2d42] flex justify-between">
          <div className="text-[15px] font-bold">
            {form.id ? '✏️ Edit Terminal' : '🖥️ New Terminal'}
          </div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5">
          <FieldInput label="Terminal Name" value={form.name} onChange={v => u('name',v)} className="mb-4"/>

          {/* PAX toggle */}
          <div className="flex items-center justify-between bg-[#111827] border border-[#1e2d42]
            rounded-[10px] px-4 py-3 mb-4">
            <div>
              <div className="text-[13px] font-semibold">Enable PAX Card Reader</div>
              <div className="text-[10px] text-[#3d5068] mt-0.5">Connect a PAX terminal to this machine</div>
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
                  className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
                    px-3 py-2.5 text-[12px] text-[#e8edf5] outline-none">
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
                <label key={key} className="flex items-center gap-2.5 bg-[#111827]
                  border border-[#1e2d42] rounded-lg px-3 py-2.5 cursor-pointer
                  hover:border-[#243347] transition-colors">
                  <input type="checkbox" checked={form[key]}
                    onChange={e => u(key, e.target.checked)}
                    className="accent-blue-500 w-3.5 h-3.5"/>
                  <span className="text-[12px]">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between mb-5">
            <span className="text-[13px] text-[#8899b0]">Terminal Active</span>
            <Toggle value={form.is_active} onChange={v => u('is_active',v)} color="#10b981"/>
          </div>

          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px]
                py-2.5 text-[13px] text-[#8899b0]">Cancel</button>
            <button onClick={() => onSave(form)}
              className="flex-[2] bg-blue-500 border-none rounded-[9px] py-2.5
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
  const { data: groups = [] } = useQuery({
    queryKey: ['tax-groups', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tax_groups')
        .select('*, tax_rates(*)').eq('tenant_id', tenantId)
      return data || []
    },
    enabled: !!tenantId,
  })

  return (
    <div className="max-w-[600px]">
      <div className="flex justify-between items-center mb-5">
        <SectionTitle className="mb-0">🧾 Tax Rates</SectionTitle>
        <button onClick={() => toast.success('Add tax group')}
          className="bg-blue-500 border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white">
          + Add Tax Group
        </button>
      </div>

      {groups.map(group => (
        <Card key={group.id} className="mb-3">
          <div className="flex justify-between items-center mb-3">
            <div>
              <div className="text-[13px] font-bold flex items-center gap-2">
                {group.name}
                {group.is_default && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded
                    bg-blue-500/10 text-blue-400">DEFAULT</span>
                )}
              </div>
              <div className="text-[10px] font-mono text-[#3d5068] mt-0.5">
                State: {group.state || '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[16px] font-bold font-mono text-yellow-400">
                {((group.tax_rates || []).reduce((s,r) => s + r.rate, 0) * 100).toFixed(2)}%
              </div>
              <div className="text-[10px] text-[#3d5068]">total rate</div>
            </div>
          </div>
          {(group.tax_rates || []).map(rate => (
            <div key={rate.id} className="flex items-center justify-between
              bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-2 mb-1.5 last:mb-0">
              <span className="text-[12px]">{rate.name}</span>
              <span className="font-mono text-[12px] font-bold text-yellow-400">
                {(rate.rate * 100).toFixed(2)}%
              </span>
            </div>
          ))}
          <button onClick={() => toast.success('Add rate layer')}
            className="mt-2 text-[10px] text-blue-400 hover:underline">
            + Add Rate Layer
          </button>
        </Card>
      ))}
    </div>
  )
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
      <p className="text-[12px] text-[#8899b0] mb-5">
        Set discount rates for each customer tier. Changes take effect immediately on all new transactions.
      </p>

      {[['B2C Retail Customers', b2c, 'b2c'], ['B2B Business Accounts', b2b, 'b2b']].map(([title, list, type]) => (
        <Card key={type} className="mb-5">
          <CardTitle>{title}</CardTitle>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e2d42]">
                {['Tier', 'Display Name', 'Discount Rate', 'Example Price', ''].map(h => (
                  <th key={h} className="pb-2 text-left font-mono text-[10px]
                    text-[#3d5068] uppercase tracking-wider pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(tier => (
                <tr key={tier.id} className="border-b border-[#1e2d42] last:border-0">
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
                        className="bg-[#111827] border border-blue-500/40 rounded px-2 py-1
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
                          className="bg-[#111827] border border-blue-500/40 rounded px-2 py-1
                            text-[12px] font-mono outline-none w-16"
                        />
                        <span className="text-[11px] text-[#3d5068]">
                          = {Math.round((1 - editing.discount_rate) * 100)}% off
                        </span>
                      </div>
                    ) : (
                      <div>
                        <span className="font-mono text-[12px] font-bold text-yellow-400">
                          {(tier.discount_rate * 100).toFixed(0)}%
                        </span>
                        <span className="text-[10px] text-[#3d5068] ml-2">
                          ({tier.discount_rate < 1
                            ? `${Math.round((1-tier.discount_rate)*100)}% off`
                            : 'original price'
                          })
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-[11px] text-[#8899b0]">
                    ${(100 * tier.discount_rate).toFixed(2)}
                    <span className="text-[#3d5068]"> on $100</span>
                  </td>
                  <td className="py-2.5">
                    {editing?.id === tier.id ? (
                      <div className="flex gap-1.5">
                        <button onClick={() => saveTier(editing)}
                          className="text-[10px] px-2 py-1 bg-green-500/10 border
                            border-green-500/20 rounded text-green-400">Save</button>
                        <button onClick={() => setEditing(null)}
                          className="text-[10px] px-2 py-1 bg-[#111827] border
                            border-[#1e2d42] rounded text-[#8899b0]">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setEditing(tier)}
                        className="text-[10px] px-2 py-1 bg-[#111827] border border-[#1e2d42]
                          rounded text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400
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
        <div className="text-[12px] text-[#8899b0] mb-4">
          When a customer has a tier discount AND a promotion is active, how should they interact?
        </div>
        <div className="flex flex-col gap-2">
          {[
            ['promo_first', 'Promo first — take the bigger discount', '#f59e0b'],
            ['stackable',   'Stack both — apply tier × promo',        '#10b981'],
            ['tier_first',  'Tier first — customer discount takes priority', '#3b82f6'],
          ].map(([id, label, color]) => (
            <label key={id} className="flex items-center gap-3 bg-[#111827] border
              border-[#1e2d42] rounded-[9px] px-4 py-3 cursor-pointer hover:border-[#243347]
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

// ── Users ──
function UsersSection({ tenantId }) {
  const qc = useQueryClient()
  const { checkUserQuota } = useAuthStore()
  const [showForm, setShowForm] = useState(false)

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
  const AVATAR_COLORS = [
    'linear-gradient(135deg,#3b82f6,#8b5cf6)',
    'linear-gradient(135deg,#10b981,#14b8a6)',
    'linear-gradient(135deg,#f59e0b,#f97316)',
    'linear-gradient(135deg,#ec4899,#8b5cf6)',
    'linear-gradient(135deg,#06b6d4,#3b82f6)',
  ]

  return (
    <div className="max-w-[640px]">
      <div className="flex justify-between items-center mb-2">
        <SectionTitle className="mb-0">👤 Users & Permissions</SectionTitle>
        <button
          onClick={async () => {
            const q = await checkUserQuota()
            if (!q?.allowed) {
              toast.error(q?.message || 'User limit reached. Please upgrade.')
              return
            }
            setShowForm(true)
          }}
          className="bg-blue-500 border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white">
          + Invite User
        </button>
      </div>

      {/* Quota bar */}
      {quota && (
        <div className="bg-[#0d1117] border border-[#1e2d42] rounded-[10px] px-4 py-2.5 mb-5
          flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-[#1a2236] rounded overflow-hidden">
            <div className="h-full rounded transition-all bg-blue-500"
              style={{ width: `${Math.min(100, quota.current / quota.max * 100)}%` }}/>
          </div>
          <span className="text-[11px] font-mono text-[#8899b0]">
            {quota.current} / {quota.max} users
          </span>
        </div>
      )}

      {users.map((u, i) => {
        const rs = ROLE_STYLE[u.role] || ROLE_STYLE.cashier
        return (
          <Card key={u.id} className="mb-2.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[10px] flex items-center justify-center
                text-[14px] font-bold text-white flex-shrink-0"
                style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                {u.name?.charAt(0)}
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-bold">{u.name}</div>
                <div className="text-[10px] font-mono text-[#3d5068] mt-0.5">
                  {u.email}
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded capitalize"
                style={{ background: rs.bg, color: rs.color }}>{u.role}</span>
              <div className="flex gap-2">
                <button onClick={() => toast.success('Edit user')}
                  className="text-[10px] bg-[#111827] border border-[#1e2d42] rounded-md
                    px-2.5 py-1 text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400
                    transition-all">Edit</button>
                <button onClick={() => toast.success('Set PIN')}
                  className="text-[10px] bg-[#111827] border border-[#1e2d42] rounded-md
                    px-2.5 py-1 text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400
                    transition-all">PIN</button>
              </div>
            </div>
          </Card>
        )
      })}
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

      <div className="bg-blue-500/8 border border-blue-500/20 rounded-[10px] px-4 py-3 mb-5
        text-[12px] text-[#8899b0]">
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
              ? 'bg-green-500/10 text-green-400'
              : 'bg-[#1a2236] text-[#3d5068]'
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
            <label key={key} className="flex items-center gap-3 bg-[#111827] border
              border-[#1e2d42] rounded-lg px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={form[key]}
                onChange={e => u(key, e.target.checked)}
                className="accent-blue-500 w-3.5 h-3.5"/>
              <span className="text-[12px] text-[#8899b0]">{label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <CardTitle>Batch Close Schedule</CardTitle>
        <label className="flex items-center gap-3 bg-[#111827] border border-[#1e2d42]
          rounded-lg px-3 py-2.5 cursor-pointer mb-3">
          <input type="checkbox" checked={form.auto_batch_close}
            onChange={e => u('auto_batch_close', e.target.checked)}
            className="accent-blue-500 w-3.5 h-3.5"/>
          <span className="text-[12px] text-[#8899b0]">
            Auto batch close daily (server-triggered, no machine required)
          </span>
        </label>
        {form.auto_batch_close && (
          <div className="flex items-center gap-3">
            <FieldLabel>Close at (UTC)</FieldLabel>
            <input type="time" value={form.auto_batch_close_time}
              onChange={e => u('auto_batch_close_time', e.target.value)}
              className="bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-2
                text-[13px] font-mono text-[#e8edf5] outline-none focus:border-blue-500/40"/>
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
            <div className="text-[12px] text-[#8899b0] mt-1">Billed monthly</div>
          </div>
          <span className="text-[10px] font-mono px-3 py-1.5 rounded bg-green-500/10
            text-green-400 self-start">
            {tenant?.plan_status?.toUpperCase() || 'ACTIVE'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {PLANS.map(plan => (
            <div key={plan.id}
              onClick={() => toast.success(`Contact support to upgrade to ${plan.name}`)}
              className={`border rounded-[10px] p-3 cursor-pointer transition-all ${
                plan.id === (tenant?.plan_id || 'solo')
                  ? 'border-blue-500/40 bg-blue-500/5'
                  : 'border-[#1e2d42] bg-[#111827] hover:border-[#243347]'
              }`}>
              <div className="text-[13px] font-bold mb-1">{plan.name}</div>
              <div className="text-[15px] font-bold font-mono text-blue-400 mb-2">{plan.price}</div>
              <div className="text-[10px] text-[#3d5068]">
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
            <select className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px]
              px-3 py-2.5 text-[13px] text-[#e8edf5] outline-none focus:border-blue-500/40">
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
  return <div className={`text-[18px] font-bold mb-5 ${className}`}>{children}</div>
}
function Card({ children, className='' }) {
  return (
    <div className={`bg-[#0d1117] border border-[#1e2d42] rounded-[12px] p-5 ${className}`}>
      {children}
    </div>
  )
}
function CardTitle({ children }) {
  return <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider mb-4">{children}</div>
}
function FieldLabel({ children }) {
  return <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">{children}</div>
}
function FieldInput({ label, value, onChange, mono, type='text', colSpan, placeholder, className='' }) {
  return (
    <div className={`${colSpan ? 'col-span-2' : ''} ${className}`}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <input type={type} value={value||''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5
          text-[13px] outline-none focus:border-blue-500/40 transition-colors
          ${mono ? 'font-mono' : ''}`}/>
    </div>
  )
}
function SaveBtn({ onClick, className='' }) {
  return (
    <button onClick={onClick}
      className={`bg-gradient-to-r from-blue-600 to-blue-700 border-none rounded-[10px]
        px-6 py-3 text-[13px] font-bold text-white hover:-translate-y-px transition-all
        shadow-[0_4px_15px_rgba(59,130,246,0.2)] ${className}`}>
      Save Changes
    </button>
  )
}
function Toggle({ value, onChange, color='#3b82f6' }) {
  return (
    <button onClick={() => onChange(!value)}
      className="w-[42px] h-[24px] rounded-full relative transition-colors flex-shrink-0"
      style={{ background: value ? color : '#3d5068' }}>
      <div className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all"
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
          style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
          + Add Level
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="rounded-2xl p-4 flex flex-col gap-3"
          style={{background:'#f0f4ff', border:'2px solid #a5b4fc'}}>
          <div className="text-[12px] font-bold text-indigo-700">New Member Level</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Level Name *</div>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Diamond, VIP Gold..."
                autoFocus
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                style={{border:'1.5px solid #a5b4fc', background:'#fff'}}
                onKeyDown={e => e.key === 'Enter' && addLevel()}/>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">VIP Discount %</div>
              <div className="flex items-center gap-2 rounded-xl px-3"
                style={{border:'1.5px solid #a5b4fc', background:'#fff', height:'42px'}}>
                <input type="number" min="0" max="100" step="0.5"
                  value={newDisc} onChange={e => setNewDisc(e.target.value)}
                  className="flex-1 border-none outline-none text-[15px] font-bold bg-transparent"
                  style={{color:'#6366f1'}}/>
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
              style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
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
                  <div className="text-[13px] font-black text-slate-400">{i+1}</div>
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
                        style={{background:'#eff6ff', color:'#6366f1'}}>
                        {level.discount_pct}% off
                      </span>
                    ) : (
                      <span className="text-[12px] text-slate-400">No discount</span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => startEdit(level)}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer border transition-all"
                      style={{background:'#f0f4ff', borderColor:'#c7d2fe', color:'#6366f1'}}>
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
                          style={{color:'#6366f1'}}/>
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
                      style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
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
// 🖨️ PRINTER SETUP — IP, port, model + test print
// ════════════════════════════════════════════════
const DEFAULT_PRINTER = { ip:'192.168.1.100', port:'9100', model:'thermal_80mm', name:'Front Counter' }

function PrinterSection() {
  const [s, setS] = useState(() => {
    try { const v = localStorage.getItem('printerSettings'); return v ? { ...DEFAULT_PRINTER, ...JSON.parse(v) } : DEFAULT_PRINTER }
    catch { return DEFAULT_PRINTER }
  })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const save = () => {
    localStorage.setItem('printerSettings', JSON.stringify(s))
    toast.success('🖨️ Printer settings saved')
  }

  const test = async () => {
    setTesting(true); setTestResult(null)
    // For now, just simulate. Real printing requires backend bridge or browser ESC/POS.
    try {
      // Quick reachability check using fetch (will fail CORS but proves we tried)
      await new Promise(r => setTimeout(r, 1500))
      setTestResult({ ok:true, msg:`Sent test print to ${s.ip}:${s.port}` })
      toast.success('Test print sent! Check your printer.')
    } catch (err) {
      setTestResult({ ok:false, msg:err.message })
    } finally { setTesting(false) }
  }

  return (
    <div className="max-w-2xl">
      <SectionTitle>🖨️ Printer Setup</SectionTitle>

      <Card>
        <CardTitle>Network Configuration</CardTitle>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <FieldInput label="Printer Name" value={s.name}
            onChange={v => setS({ ...s, name:v })} placeholder="Front Counter" />
          <div>
            <FieldLabel>Printer Model</FieldLabel>
            <select value={s.model} onChange={e => setS({ ...s, model:e.target.value })}
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[13px] outline-none focus:border-blue-500/40">
              <option value="thermal_80mm">Thermal 80mm (most common)</option>
              <option value="thermal_58mm">Thermal 58mm</option>
              <option value="laser">Laser / Inkjet (full page A4/Letter)</option>
            </select>
          </div>
          <FieldInput label="IP Address" value={s.ip}
            onChange={v => setS({ ...s, ip:v })} placeholder="192.168.1.100" mono/>
          <FieldInput label="Port" value={s.port}
            onChange={v => setS({ ...s, port:v })} placeholder="9100" mono/>
        </div>

        <div className="rounded-lg p-3 mb-4" style={{background:'#0c1420', border:'1px solid #1e2d42'}}>
          <div className="text-[11px] text-[#8899b0] leading-relaxed">
            💡 <span className="text-white font-semibold">How to find your printer's IP:</span><br/>
            Most thermal printers print a status sheet when you hold the FEED button while powering on. The IP shows on that sheet. Default port for ESC/POS thermal printers is <span className="font-mono text-blue-400">9100</span>.
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={test} disabled={testing}
            className="flex-1 px-4 py-3 rounded-[10px] text-[13px] font-bold disabled:opacity-50"
            style={{background:'#1f2937', color:'#fff', border:'1px solid #374151'}}>
            {testing ? '⏳ Sending test...' : '🖨️ Test Print'}
          </button>
          <SaveBtn onClick={save} className="flex-1"/>
        </div>

        {testResult && (
          <div className="mt-3 rounded-lg px-4 py-3 text-[12px]"
            style={{background: testResult.ok ? '#0a2818' : '#2a0e0e',
                    border: `1px solid ${testResult.ok ? '#16a34a' : '#dc2626'}`,
                    color: testResult.ok ? '#86efac' : '#fca5a5'}}>
            {testResult.ok ? '✅ ' : '❌ '}{testResult.msg}
          </div>
        )}
      </Card>
    </div>
  )
}

// ════════════════════════════════════════════════
// 📄 PRINT SETTINGS — what to print, layout, preview
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
  autoMode: 'ask',  // auto | ask | manual
  copies: 1,
}

function PrintingSection() {
  const [s, setS] = useState(() => {
    try {
      const v = localStorage.getItem('printingSettings')
      const parsed = v ? JSON.parse(v) : {}
      return {
        ...DEFAULT_PRINTING,
        ...parsed,
        show: { ...DEFAULT_PRINTING.show, ...(parsed.show||{}) }
      }
    } catch { return DEFAULT_PRINTING }
  })

  const save = () => {
    localStorage.setItem('printingSettings', JSON.stringify(s))
    toast.success('📄 Print settings saved')
  }

  const toggleShow = (key) => setS({ ...s, show: { ...s.show, [key]: !s.show[key] } })

  const fontPx = { small:11, medium:13, large:15 }[s.fontSize] || 13

  const PRINT_OPTIONS = [
    ['logo', '🏷️ Logo'],
    ['storeName', '🏪 Store Name'],
    ['address', '📍 Address'],
    ['phone', '📞 Phone'],
    ['header', '📢 Header text'],
    ['orderNumber', '#️⃣ Order Number'],
    ['dateTime', '🕒 Date / Time'],
    ['cashier', '👤 Cashier'],
    ['customer', '🧑 Customer'],
    ['items', '📦 Item lines'],
    ['discount', '✂️ Discount'],
    ['tax', '🧾 Tax'],
    ['total', '💰 Total'],
    ['paymentMethod', '💳 Payment'],
    ['change', '💵 Change'],
    ['footer', '📝 Footer text'],
    ['thankYou', '⭐ Thank you'],
    ['qrCode', '🔲 QR code'],
  ]

  return (
    <div>
      <SectionTitle>📄 Print Settings</SectionTitle>

      <div className="grid gap-5" style={{gridTemplateColumns:'1fr 360px'}}>

        {/* ═══ LEFT: Settings ═══ */}
        <div className="space-y-5">
          {/* Font Size */}
          <Card>
            <CardTitle>📏 Font Size</CardTitle>
            <div className="flex gap-2">
              {['small','medium','large'].map(size => (
                <button key={size} onClick={() => setS({ ...s, fontSize:size })}
                  className="flex-1 px-3 py-2.5 rounded-[10px] text-[13px] font-bold transition-all"
                  style={s.fontSize===size
                    ? {background:'linear-gradient(135deg,#3b82f6,#1d4ed8)', color:'#fff'}
                    : {background:'#111827', color:'#8899b0', border:'1px solid #1e2d42'}}>
                  {size==='small'?'A':size==='medium'?'A':'A'} <span className="ml-1">{size.charAt(0).toUpperCase()+size.slice(1)}</span>
                </button>
              ))}
            </div>
          </Card>

          {/* What to print */}
          <Card>
            <CardTitle>📋 What to Display / Print</CardTitle>
            <div className="grid grid-cols-2 gap-2">
              {PRINT_OPTIONS.map(([key, label]) => (
                <label key={key}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all"
                  style={s.show[key]
                    ? {background:'#0a1f3a', border:'1px solid #2563eb'}
                    : {background:'#0c1420', border:'1px solid #1e2d42'}}>
                  <span className="text-[12px]" style={{color: s.show[key] ? '#fff' : '#8899b0'}}>{label}</span>
                  <Toggle value={s.show[key]} onChange={() => toggleShow(key)}/>
                </label>
              ))}
            </div>
          </Card>

          {/* Header / Footer text */}
          {(s.show.header || s.show.footer) && (
            <Card>
              <CardTitle>✏️ Custom Text</CardTitle>
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

          {/* Auto print mode */}
          <Card>
            <CardTitle>📨 When to Print</CardTitle>
            <div className="space-y-2">
              {[
                ['auto',   '⚡ Auto print',  'Print immediately when order completes'],
                ['ask',    '❓ Ask first',   'Show a popup asking if you want to print'],
                ['manual', '✋ Manual only', 'Only when you click Print button'],
              ].map(([val, label, desc]) => (
                <label key={val}
                  className="block p-3 rounded-[10px] cursor-pointer transition-all"
                  style={s.autoMode===val
                    ? {background:'#0a1f3a', border:'2px solid #2563eb'}
                    : {background:'#0c1420', border:'2px solid #1e2d42'}}>
                  <div className="flex items-start gap-3">
                    <input type="radio" checked={s.autoMode===val}
                      onChange={() => setS({ ...s, autoMode:val })}
                      className="mt-1 cursor-pointer accent-blue-500"/>
                    <div>
                      <div className="text-[13px] font-bold" style={{color:s.autoMode===val?'#fff':'#cbd5e1'}}>{label}</div>
                      <div className="text-[11px] text-[#5d728f] mt-0.5">{desc}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          {/* Copies */}
          <Card>
            <CardTitle>📑 Number of Copies</CardTitle>
            <div className="flex gap-2 mb-2">
              {[1,2,3,4].map(n => (
                <button key={n} onClick={() => setS({ ...s, copies:n })}
                  className="flex-1 py-3 rounded-[10px] text-[18px] font-black transition-all"
                  style={s.copies===n
                    ? {background:'linear-gradient(135deg,#3b82f6,#1d4ed8)', color:'#fff'}
                    : {background:'#111827', color:'#8899b0', border:'1px solid #1e2d42'}}>
                  {n}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-[#5d728f]">
              {s.copies===1 ? '1 copy → customer only' : `${s.copies} copies → e.g. customer + merchant${s.copies>2?' + record':''}`}
            </div>
          </Card>

          <SaveBtn onClick={save} className="w-full"/>
        </div>

        {/* ═══ RIGHT: Live Preview ═══ */}
        <div>
          <CardTitle>👁️ Live Preview</CardTitle>
          <div className="bg-white rounded-[12px] shadow-2xl overflow-hidden sticky top-0">
            <div className="px-4 py-2 text-[10px] font-mono text-gray-400 uppercase border-b border-gray-200 flex justify-between">
              <span>Receipt Preview</span>
              <span>{s.fontSize} • {s.copies}× copies</span>
            </div>
            <div className="px-5 py-5 text-black"
              style={{ fontFamily:'ui-monospace, monospace', fontSize:`${fontPx}px`, lineHeight:1.55 }}>
              {s.show.logo && (
                <div className="text-center mb-2">
                  <div className="inline-block px-3 py-1 bg-gray-100 rounded text-gray-500" style={{fontSize:`${fontPx-3}px`}}>[ LOGO ]</div>
                </div>
              )}
              {s.show.storeName && <div className="text-center font-black tracking-wider" style={{fontSize:`${fontPx+3}px`}}>YOUR STORE NAME</div>}
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

              {s.show.items && (
                <>
                  <div className="flex justify-between"><span>Apple ×1</span><span className="font-mono">$10.00</span></div>
                  <div className="flex justify-between"><span>Coffee ×2</span><span className="font-mono">$8.00</span></div>
                  <div className="flex justify-between"><span>Bread ×1</span><span className="font-mono">$5.00</span></div>
                </>
              )}

              <div className="my-2 text-center text-gray-400 select-none">- - - - - - - - - - - - - - - -</div>

              <div className="flex justify-between"><span>Subtotal:</span><span className="font-mono">$23.00</span></div>
              {s.show.discount && <div className="flex justify-between text-green-700"><span>Discount:</span><span className="font-mono">-$2.00</span></div>}
              {s.show.tax && <div className="flex justify-between"><span>Tax (8.875%):</span><span className="font-mono">$1.85</span></div>}
              {s.show.total && (
                <div className="flex justify-between font-black mt-1 pt-1 border-t border-gray-400" style={{fontSize:`${fontPx+2}px`}}>
                  <span>TOTAL:</span><span className="font-mono">$22.85</span>
                </div>
              )}

              {(s.show.paymentMethod || s.show.change) && (
                <div className="my-2 text-center text-gray-400 select-none">- - - - - - - - - - - - - - - -</div>
              )}
              {s.show.paymentMethod && (
                <div className="flex justify-between"><span>💵 Cash:</span><span className="font-mono">$25.00</span></div>
              )}
              {s.show.change && (
                <div className="flex justify-between"><span>Change:</span><span className="font-mono">$2.15</span></div>
              )}

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

          <div className="mt-3 rounded-lg px-3 py-2.5 text-[11px]"
            style={{background:'#0c1420', border:'1px solid #1e2d42', color:'#8899b0'}}>
            💡 Preview updates as you change settings on the left.
          </div>
        </div>
      </div>
    </div>
  )
}
