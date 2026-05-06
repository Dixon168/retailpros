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
