// src/pages/pos/panels/CustomerPanel.jsx
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { TouchKeyboard } from '@/components/ui/TouchKeyboard'
import toast from 'react-hot-toast'

export default function CustomerPanel() {
  const { setCustomer }    = useCartStore()
  const { tenant }         = useAuthStore()
  const qc                 = useQueryClient()
  const [search, setSearch]   = useState('')
  const [mode, setMode]       = useState('search') // 'search' | 'add'
  const [saving, setSaving]   = useState(false)
  const [showKB, setShowKB]   = useState(false)
  const [kbField, setKbField] = useState(null)
  const searchRef = useRef()

  const close = () => useCartStore.setState({ showCustPanel: false })

  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    birthday: '', gender: '', address: '',
    type: 'regular', notes: '',
  })
  const setF = (k, v) => setForm(f => ({...f, [k]: v}))

  useEffect(() => {
    if (mode === 'search') setTimeout(() => searchRef.current?.focus(), 100)
  }, [mode])

  const { data: customers = [] } = useQuery({
    queryKey: ['customer-search', tenant?.id, search],
    queryFn: async () => {
      let q = supabase.from('customers')
        .select('id, code, name, phone, email, type, credit_balance, loyalty_points, tier')
        .eq('tenant_id', tenant.id).eq('is_active', true)
      if (search)
        q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%,code.ilike.%${search}%,email.ilike.%${search}%`)
      const { data } = await q.order('name').limit(20)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const handleSelect = (customer) => {
    setCustomer(customer)
    close()
  }

  const handleAdd = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    try {
      // Generate customer code
      const code = 'C' + Date.now().toString().slice(-6)
      const { data, error } = await supabase.from('customers').insert({
        tenant_id:    tenant.id,
        code,
        name:         form.name.trim(),
        phone:        form.phone || null,
        email:        form.email || null,
        birthday:     form.birthday || null,
        gender:       form.gender || null,
        billing_address: form.address || null,
        type:         form.type,
        notes:        form.notes || null,
        is_active:    true,
        loyalty_points: 0,
        credit_balance: 0,
      }).select().single()
      if (error) throw error
      qc.invalidateQueries(['customer-search'])
      toast.success(`✓ ${form.name} added!`)
      handleSelect(data)
    } catch(e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const openKB = (field) => { setKbField(field); setShowKB(true) }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{background:'rgba(15,23,42,0.6)', backdropFilter:'blur(2px)'}}
      onClick={close}>
      <div className="rounded-2xl overflow-hidden shadow-md w-[480px] max-h-[90vh] flex flex-col"
        style={{background:'#fff'}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{background:'#000000'}}>
          <span className="text-[22px]">👥</span>
          <div className="flex-1">
            <div className="text-[16px] font-bold text-white">
              {mode === 'search' ? 'Select Customer' : 'Add New Customer'}
            </div>
            <div className="text-[11px] text-white/80">
              {mode === 'search' ? 'Search or add new' : 'Fill in customer details'}
            </div>
          </div>
          <button onClick={close}
            className="w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white flex items-center justify-center">✕</button>
        </div>

        {/* Tab switcher */}
        <div className="flex flex-shrink-0" style={{borderBottom:'1px solid #e2e8f0'}}>
          {[['search','🔍 Search'],['add','➕ New Customer']].map(([m,l])=>(
            <button key={m} onClick={()=>setMode(m)}
              className="flex-1 py-2.5 text-[12px] font-semibold cursor-pointer border-none border-b-2 transition-all"
              style={{
                background: mode===m ? '#E6F0FF' : '#fff',
                borderBottomColor: mode===m ? '#006AFF' : 'transparent',
                color: mode===m ? '#006AFF' : '#64748b',
              }}>
              {l}
            </button>
          ))}
        </div>

        {/* ── SEARCH MODE ── */}
        {mode === 'search' && (
          <>
            <div className="px-4 py-3 flex-shrink-0" style={{borderBottom:'1px solid #f1f5f9'}}>
              <div className="flex items-center gap-2 rounded-xl px-3"
                style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}>
                <span className="text-slate-400">🔍</span>
                <input ref={searchRef} autoFocus
                  value={search} onChange={e=>setSearch(e.target.value)}
                  placeholder="Search name, phone, email, code..."
                  className="flex-1 border-none outline-none py-2.5 text-[13px] bg-transparent"
                  style={{color:'#1F1F1F'}}/>
                {search && <button onClick={()=>setSearch('')}
                  className="text-slate-400 bg-transparent border-none cursor-pointer">✕</button>}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Walk-in option */}
              <button onClick={() => handleSelect(null)}
                className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer border-none text-left transition-all hover:bg-slate-50"
                style={{borderBottom:'1px solid #f1f5f9', background:'#fff'}}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[18px] flex-shrink-0"
                  style={{background:'#f1f5f9'}}>🚶</div>
                <div>
                  <div className="text-[13px] font-semibold text-slate-700">Walk-in Customer</div>
                  <div className="text-[11px] text-slate-400">No account needed</div>
                </div>
              </button>

              {customers.length === 0 && search && (
                <div className="flex flex-col items-center py-10 text-slate-400">
                  <div className="text-[32px] mb-2">😕</div>
                  <div className="text-[13px]">No customer found</div>
                  <button onClick={()=>setMode('add')}
                    className="mt-3 px-4 py-2 rounded-xl text-[12px] font-bold cursor-pointer border-none"
                    style={{background:'#E6F0FF', color:'#006AFF'}}>
                    + Add "{search}" as new customer
                  </button>
                </div>
              )}

              {customers.map(c => {
                const initials = c.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()
                const TIER_STYLE = {
                  vip:       {bg:'#fef9c3', color:'#ca8a04'},
                  silver:    {bg:'#f1f5f9', color:'#64748b'},
                  gold:      {bg:'#fffbeb', color:'#d97706'},
                  platinum:  {bg:'#E6F0FF', color:'#006AFF'},
                }
                const ts = TIER_STYLE[c.tier] || TIER_STYLE[c.type] || {bg:'#E6F0FF',color:'#006AFF'}
                return (
                  <button key={c.id} onClick={()=>handleSelect(c)}
                    className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer border-none text-left transition-all hover:bg-blue-50"
                    style={{borderBottom:'1px solid #f8fafc', background:'#fff'}}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[14px] font-bold text-white flex-shrink-0"
                      style={{background:'#000000'}}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-slate-800">{c.name}</span>
                        {c.tier && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase"
                            style={ts}>{c.tier}</span>
                        )}
                        {c.type === 'vip' && !c.tier && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-600">VIP</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {c.phone || c.email || '—'}
                      </div>
                      <div className="flex gap-2 mt-1">
                        {c.loyalty_points > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{background:'#fdf4ff', color:'#006AFF'}}>
                            💎 {c.loyalty_points} pts
                          </span>
                        )}
                        {c.credit_balance > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{background:'#fff1f2', color:'#e11d48'}}>
                            Owes ${c.credit_balance.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-slate-300 text-[18px]">›</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* ── ADD NEW MODE ── */}
        {mode === 'add' && (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-4">

              {/* Basic */}
              <div className="rounded-xl p-4" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Basic Info</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Full Name *</div>
                    <input value={form.name} onChange={e=>setF('name',e.target.value)}
                      placeholder="Customer name" autoFocus
                      className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none font-semibold"
                      style={{border:'1.5px solid #e2e8f0', background:'#fff'}}/>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Phone</div>
                    <input value={form.phone} onChange={e=>setF('phone',e.target.value)}
                      placeholder="Phone number" type="tel"
                      className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                      style={{border:'1.5px solid #e2e8f0', background:'#fff'}}/>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Email</div>
                    <input value={form.email} onChange={e=>setF('email',e.target.value)}
                      placeholder="Email address" type="email"
                      className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                      style={{border:'1.5px solid #e2e8f0', background:'#fff'}}/>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Birthday</div>
                    <input value={form.birthday} onChange={e=>setF('birthday',e.target.value)}
                      type="date"
                      className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                      style={{border:'1.5px solid #e2e8f0', background:'#fff'}}/>
                  </div>
                </div>
              </div>

              {/* Type */}
              <div className="rounded-xl p-4" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Customer Type</div>
                <div className="flex gap-2 flex-wrap">
                  {[
                    ['regular','👤 Regular','#f1f5f9','#666666'],
                    ['vip','⭐ VIP','#fef9c3','#ca8a04'],
                    ['wholesale','🏢 Wholesale','#eff6ff','#2563eb'],
                    ['staff','👔 Staff','#f0fdf4','#16a34a'],
                  ].map(([t,l,bg,color])=>(
                    <button key={t} onClick={()=>setF('type',t)}
                      className="flex-1 rounded-xl py-2 text-[12px] font-semibold cursor-pointer border-2 transition-all"
                      style={form.type===t
                        ? {background:bg, borderColor:color, color}
                        : {background:'#fff', borderColor:'#e2e8f0', color:'#64748b'}}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Address & Notes */}
              <div className="rounded-xl p-4" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Additional</div>
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Address</div>
                    <input value={form.address} onChange={e=>setF('address',e.target.value)}
                      placeholder="Address (optional)"
                      className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                      style={{border:'1.5px solid #e2e8f0', background:'#fff'}}/>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Notes</div>
                    <textarea value={form.notes} onChange={e=>setF('notes',e.target.value)}
                      placeholder="Internal notes (optional)" rows={2}
                      className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
                      style={{border:'1.5px solid #e2e8f0', background:'#fff'}}/>
                  </div>
                </div>
              </div>

              {/* Save button */}
              <button onClick={handleAdd} disabled={saving || !form.name.trim()}
                className="w-full rounded-2xl py-4 text-[15px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
                style={{background:'#000000'}}>
                {saving ? '⏳ Saving...' : '✓ Add Customer & Select'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
