// src/pages/marketing/MarketingPage.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import EstimateProductPicker from '@/pages/estimates/EstimateProductPicker'

const TYPE_INFO = {
  sale: { label:'Sale Pricing',       icon:'🏷️', color:'#006AFF', bg:'#E6F0FF', desc:'Date range discount' },
  bulk: { label:'Bulk Pricing',       icon:'📦', color:'#16a34a', bg:'#dcfce7', desc:'Qty-based discount' },
  time: { label:'Time Based Pricing', icon:'⏰', color:'#d97706', bg:'#fef9c3', desc:'Day/hour discount' },
}
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function MarketingPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editPromo, setEditPromo] = useState(null)
  const [filterType, setFilterType] = useState('all')

  const { data: promos = [], isLoading } = useQuery({
    queryKey: ['promotions', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('promotions')
        .select('*, products(name, price, image_url)')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const displayed = filterType === 'all' ? promos : promos.filter(p => p.type === filterType)
  const activeNow = promos.filter(p => p.is_active).length

  const toggleActive = async (promo) => {
    const { error } = await supabase.from('promotions').update({ is_active: !promo.is_active }).eq('id', promo.id)
    if (error) { toast.error('Failed: ' + error.message); return }
    qc.invalidateQueries(['promotions'])
    toast.success(promo.is_active ? 'Promotion paused' : 'Promotion activated')
  }

  const deletePromo = async (id) => {
    if (!confirm('Delete this promotion?')) return
    const { error } = await supabase.from('promotions').delete().eq('id', id)
    if (error) { toast.error('Failed: ' + error.message); return }
    qc.invalidateQueries(['promotions'])
    toast.success('Deleted')
  }

  const formatSummary = (p) => {
    if (p.type === 'sale') {
      const val = p.sale_type === 'pct' ? `-${p.sale_value}%` : `$${p.sale_value}`
      const start = p.sale_start ? new Date(p.sale_start).toLocaleDateString() : '?'
      const end   = p.sale_end   ? new Date(p.sale_end).toLocaleDateString()   : '?'
      return `${val} · ${start} → ${end}`
    }
    if (p.type === 'bulk') {
      const tiers = p.bulk_tiers || []
      return tiers.map(t => {
        if (t.type === 'bundle_total') return `Buy ${t.min_qty} for $${Number(t.value).toFixed(2)}`
        if (t.type === 'pct')          return `Buy ${t.min_qty}+: -${t.value}%`
        return `Buy ${t.min_qty}+: $${Number(t.value).toFixed(2)}/ea`
      }).join(' · ')
    }
    if (p.type === 'time') {
      const rules = p.time_rules || []
      return rules.map(r => {
        const days = (r.days||[]).map(d => DAYS[d]).join(',')
        const val  = r.type==='pct' ? `-${r.value}%` : `$${r.value}`
        return `${days} ${r.start_time}-${r.end_time} ${val}`
      }).join(' · ')
    }
    return '—'
  }

  // ── Status: combines is_active flag with start/end dates ────────────
  const formatStatus = (p) => {
    const now = new Date()
    const start = p.sale_start ? new Date(p.sale_start) : null
    const end   = p.sale_end   ? new Date(p.sale_end)   : null

    if (!p.is_active)
      return { label: 'Paused', icon: '⏸', color: '#92400e', bg: '#fef3c7' }
    if (start && start > now) {
      const days = Math.ceil((start - now) / 86400000)
      return { label: `Upcoming · starts in ${days}d`, icon: '⏳', color: '#1e40af', bg: '#dbeafe' }
    }
    if (end && end < now) {
      const days = Math.floor((now - end) / 86400000)
      return { label: days === 0 ? 'Expired today' : `Expired · ${days}d ago`, icon: '⌛', color: '#64748b', bg: '#f1f5f9' }
    }
    if (end) {
      const days = Math.ceil((end - now) / 86400000)
      return { label: `Running · ${days}d left`, icon: '✅', color: '#15803d', bg: '#dcfce7' }
    }
    return { label: 'Running · no end date', icon: '✅', color: '#15803d', bg: '#dcfce7' }
  }

  // ── Date range pretty-print ─────────────────────────────────────────
  const fmtPromoDate = (d) => d
    ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const formatDateRange = (p) => {
    if (!p.sale_start) return null
    const start = fmtPromoDate(p.sale_start)
    const end   = p.sale_end ? fmtPromoDate(p.sale_end) : 'No end date'
    return `${start} → ${end}`
  }

  // ── Compute discount preview (e.g. "$10.00 → $8.00") for sale type ──
  const computeSalePrice = (p) => {
    if (p.type !== 'sale' || !p.products?.price) return null
    const base = p.products.price
    const val  = parseFloat(p.sale_value) || 0
    if (p.sale_type === 'pct') return Math.max(0, base * (1 - val/100))
    return Math.max(0, base - val)
  }

  return (
    <div className="flex flex-col h-full" style={{background:'#FFFFFF'}}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
        style={{background:'#fff', borderBottom:'1.5px solid #e2e8f0'}}>
        <div>
          <div className="text-[18px] font-bold text-slate-800">Promotions</div>
          <div className="text-[12px] text-slate-400 mt-0.5">
            {promos.length} total · <span className="text-green-600 font-medium">{activeNow} active</span>
          </div>
        </div>
        <button onClick={() => { setEditPromo(null); setShowForm(true) }}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white cursor-pointer border-none"
          style={{background:'#000000'}}>
          + New Promotion
        </button>
      </div>

      {/* Type filter */}
      <div className="flex gap-3 px-6 py-3 flex-shrink-0" style={{background:'#fff', borderBottom:'1px solid #f1f5f9'}}>
        {[['all','All','#64748b'], ...Object.entries(TYPE_INFO).map(([k,v]) => [k, v.label, v.color])].map(([id, label, color]) => (
          <button key={id} onClick={() => setFilterType(id)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer border transition-all"
            style={filterType===id
              ? {background:`${color}18`, borderColor:`${color}50`, color}
              : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
            {TYPE_INFO[id]?.icon} {label}
            <span className="px-1.5 py-0.5 rounded-full text-[10px]"
              style={{background: filterType===id ? `${color}18` : '#f1f5f9', color: filterType===id ? color : '#94a3b8'}}>
              {id === 'all' ? promos.length : promos.filter(p => p.type === id).length}
            </span>
          </button>
        ))}
      </div>

      {/* Promo list */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {Array(6).fill(0).map((_,i) => (
              <div key={i} className="h-[140px] rounded-xl animate-pulse" style={{background:'#e2e8f0'}}/>
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="text-5xl mb-3 opacity-20">🏷️</div>
            <div className="text-[14px] font-semibold mb-1">No promotions yet</div>
            <div className="text-[12px] mb-4">Create your first promotion to boost sales</div>
            <button onClick={() => { setEditPromo(null); setShowForm(true) }}
              className="px-4 py-2 rounded-lg text-[12px] font-bold text-white cursor-pointer border-none"
              style={{background:'#006AFF'}}>
              + New Promotion
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {displayed.map(promo => {
              const ti = TYPE_INFO[promo.type] || TYPE_INFO.sale
              return (
                <div key={promo.id} className="rounded-xl overflow-hidden transition-all"
                  style={{background:'#fff', border:`1.5px solid ${promo.is_active ? ti.color+'40' : '#e2e8f0'}`,
                    boxShadow: promo.is_active ? `0 2px 12px ${ti.color}15` : 'none'}}>

                  {/* Card header */}
                  <div className="px-4 py-3 flex items-center justify-between"
                    style={{background: promo.is_active ? ti.bg : '#f8fafc', borderBottom:'1px solid #f1f5f9'}}>
                    <div className="flex items-center gap-2">
                      <span className="text-[18px]">{ti.icon}</span>
                      <div>
                        <div className="text-[11px] font-bold" style={{color: ti.color}}>{ti.label}</div>
                        {promo.is_active
                          ? <div className="text-[10px] font-semibold text-green-600">● Active</div>
                          : <div className="text-[10px] text-slate-400">● Paused</div>
                        }
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => toggleActive(promo)}
                        className="px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer border transition-all"
                        style={promo.is_active
                          ? {background:'#fef2f2', border:'1px solid #fecaca', color:'#dc2626'}
                          : {background:'#dcfce7', border:'1px solid #86efac', color:'#16a34a'}}>
                        {promo.is_active ? 'Pause' : 'Activate'}
                      </button>
                      <button onClick={() => { setEditPromo(promo); setShowForm(true) }}
                        className="px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer border"
                        style={{background:'#E6F0FF', border:'1px solid #80B2FF', color:'#006AFF'}}>
                        Edit
                      </button>
                      <button onClick={() => deletePromo(promo.id)}
                        className="px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer border"
                        style={{background:'#fff1f2', border:'1px solid #fecdd3', color:'#e11d48'}}>
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="px-4 py-3">
                    <div className="text-[14px] font-bold text-slate-800 mb-1.5">{promo.name}</div>

                    {/* Linked product */}
                    {promo.products && (
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <div className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {promo.products.image_url
                            ? <img src={promo.products.image_url} className="w-full h-full object-cover" alt=""/>
                            : <span className="text-[8px] font-bold text-slate-400">{promo.products.name?.substring(0,2)}</span>
                          }
                        </div>
                        <span className="text-[11px] text-slate-500 truncate">{promo.products.name}</span>
                        {promo.products.price != null && (
                          <span className="text-[11px] font-mono text-slate-400">${Number(promo.products.price).toFixed(2)}</span>
                        )}
                      </div>
                    )}

                    {/* Discount detail box */}
                    <div className="rounded-lg px-3 py-2 mb-2"
                      style={{background: ti.bg, border: `1px solid ${ti.color}30`}}>
                      {promo.type === 'sale' && (
                        <>
                          <div className="text-[15px] font-bold leading-tight" style={{color: ti.color}}>
                            {promo.sale_type === 'pct' ? `-${promo.sale_value}% OFF` : `$${promo.sale_value} OFF`}
                          </div>
                          {(() => {
                            const sp = computeSalePrice(promo)
                            if (sp == null) return null
                            return (
                              <div className="text-[10px] text-slate-600 mt-0.5 font-mono">
                                <span className="line-through opacity-60">${Number(promo.products.price).toFixed(2)}</span>
                                <span className="mx-1">→</span>
                                <span className="font-bold" style={{color: ti.color}}>${sp.toFixed(2)}</span>
                                <span className="text-slate-500"> each</span>
                              </div>
                            )
                          })()}
                        </>
                      )}
                      {promo.type === 'bulk' && (
                        <div className="space-y-0.5">
                          {(promo.bulk_tiers || []).map((t, i) => (
                            <div key={i} className="text-[11px] font-bold leading-snug" style={{color: ti.color}}>
                              {t.type === 'bundle_total'
                                ? `Buy ${t.min_qty} for $${Number(t.value).toFixed(2)}`
                                : t.type === 'pct'
                                ? `Buy ${t.min_qty}+: -${t.value}% off`
                                : `Buy ${t.min_qty}+: $${Number(t.value).toFixed(2)} each`}
                            </div>
                          ))}
                          {(!promo.bulk_tiers || promo.bulk_tiers.length === 0) && (
                            <div className="text-[10px] text-slate-400 italic">No tiers configured</div>
                          )}
                        </div>
                      )}
                      {promo.type === 'time' && (
                        <div className="space-y-0.5">
                          {(promo.time_rules || []).map((r, i) => (
                            <div key={i} className="text-[11px] font-bold leading-snug" style={{color: ti.color}}>
                              {(r.days || []).map(d => DAYS[d]).join(',')} · {r.start_time}–{r.end_time} · {r.type === 'pct' ? `-${r.value}%` : `$${r.value} off`}
                            </div>
                          ))}
                          {(!promo.time_rules || promo.time_rules.length === 0) && (
                            <div className="text-[10px] text-slate-400 italic">No time rules configured</div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Date range */}
                    {formatDateRange(promo) && (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mb-1.5">
                        <span>📅</span>
                        <span className="font-mono">{formatDateRange(promo)}</span>
                      </div>
                    )}

                    {/* Smart status badge (combines is_active + dates) */}
                    {(() => {
                      const st = formatStatus(promo)
                      return (
                        <div className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold"
                          style={{background: st.bg, color: st.color}}>
                          <span>{st.icon}</span>
                          <span>{st.label}</span>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showForm && (
        <PromotionForm
          initial={editPromo}
          tenantId={tenant?.id}
          onSave={() => { qc.invalidateQueries(['promotions']); setShowForm(false); setEditPromo(null) }}
          onClose={() => { setShowForm(false); setEditPromo(null) }}
        />
      )}
    </div>
  )
}

// ── Promotion Form ──
function PromotionForm({ initial, tenantId, onSave, onClose }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name:       initial?.name       || '',
    type:       initial?.type       || 'sale',
    product_id: initial?.product_id || '',
    is_active:  initial?.is_active  ?? true,
    // ── Schedule (now used by ALL types: sale, bulk, time) ──
    sale_start: initial?.sale_start ? new Date(initial.sale_start).toISOString().slice(0,16) : '',
    sale_end:   initial?.sale_end   ? new Date(initial.sale_end).toISOString().slice(0,16)   : '',
    no_end_date: initial?.id ? !initial.sale_end : false,  // "runs forever" mode
    // Sale-specific
    sale_type:  initial?.sale_type  || 'fixed',
    sale_value: initial?.sale_value || '',
    // Bulk
    bulk_tiers: initial?.bulk_tiers || [],
    // Time (within-day rules)
    time_rules: initial?.time_rules || [],
  })
  const set = (k,v) => setForm(p => ({...p,[k]:v}))

  // Bulk tier state — default to bundle_total since that's the most common
  // real-world pricing form ("Buy N for $X"), e.g. "Buy 3 for $21".
  const [newTier, setNewTier] = useState({ min_qty:'', type:'bundle_total', value:'' })
  // Time rule state
  const [newRule, setNewRule] = useState({ days:[], start_time:'', end_time:'', type:'fixed', value:'' })

  const [showProductPicker, setShowProductPicker] = useState(false)

  // Fetch only the currently selected product (for displaying name + price)
  const { data: selectedProduct } = useQuery({
    queryKey: ['promo-selected-product', form.product_id],
    queryFn: async () => {
      if (!form.product_id) return null
      const { data } = await supabase.from('products')
        .select('id, name, sku, barcode, price, image_url')
        .eq('id', form.product_id).single()
      return data
    },
    enabled: !!form.product_id,
  })

  const addTier = () => {
    if (!newTier.min_qty || !newTier.value) { toast.error('Fill all tier fields'); return }
    set('bulk_tiers', [...form.bulk_tiers, { ...newTier, min_qty: parseInt(newTier.min_qty), value: parseFloat(newTier.value) }]
      .sort((a,b) => a.min_qty - b.min_qty))
    setNewTier({ min_qty:'', type:'bundle_total', value:'' })
  }

  const toggleDay = (d) => {
    setNewRule(r => ({
      ...r,
      days: r.days.includes(d) ? r.days.filter(x=>x!==d) : [...r.days, d].sort()
    }))
  }

  const addRule = () => {
    if (!newRule.days.length || !newRule.start_time || !newRule.end_time || !newRule.value) {
      toast.error('Fill all rule fields'); return
    }
    set('time_rules', [...form.time_rules, { ...newRule, value: parseFloat(newRule.value) }])
    setNewRule({ days:[], start_time:'', end_time:'', type:'fixed', value:'' })
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }

    // All promotion types now require a start date
    if (!form.sale_start) { toast.error('Start date is required'); return }
    if (!form.no_end_date && !form.sale_end) { toast.error('End date required (or check "no end date")'); return }
    if (form.sale_end && form.sale_start && new Date(form.sale_end) <= new Date(form.sale_start)) {
      toast.error('End date must be after start date'); return
    }

    // Type-specific validations
    if (form.type === 'sale' && !form.sale_value) {
      toast.error('Enter sale price / discount'); return
    }
    if (form.type === 'bulk' && form.bulk_tiers.length === 0) {
      toast.error('Add at least one bulk tier'); return
    }
    if (form.type === 'time' && form.time_rules.length === 0) {
      toast.error('Add at least one time-of-day rule'); return
    }
    setSaving(true)
    try {
      const payload = {
        tenant_id:  tenantId,
        name:       form.name,
        type:       form.type,
        product_id: form.product_id || null,
        is_active:  form.is_active,
        sale_start: form.sale_start || null,
        sale_end:   form.no_end_date ? null : (form.sale_end || null),
        sale_type:  form.sale_type,
        sale_value: parseFloat(form.sale_value) || null,
        bulk_tiers: form.bulk_tiers,
        time_rules: form.time_rules,
        updated_at: new Date().toISOString(),
      }
      let error
      if (initial?.id) {
        ({ error } = await supabase.from('promotions').update(payload).eq('id', initial.id))
      } else {
        ({ error } = await supabase.from('promotions').insert(payload))
      }
      if (error) {
        toast.error('Save failed: ' + (error.message || 'Unknown error'))
        console.error('[Promotions] Save error:', error)
        return
      }
      toast.success(initial?.id ? 'Promotion updated ✓' : 'Promotion created ✓')
      onSave()
    } catch(err) {
      toast.error('Error: ' + err.message)
      console.error('[Promotions] Unexpected error:', err)
    }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{background:'rgba(15,23,42,0.6)', backdropFilter:'blur(4px)'}} onClick={onClose}>
      <div className="rounded-2xl w-[580px] max-h-[92vh] overflow-y-auto"
        style={{background:'#fff', boxShadow:'0 25px 60px rgba(0,0,0,0.2)'}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between sticky top-0 z-10"
          style={{background:'#fff', borderBottom:'1.5px solid #f1f5f9'}}>
          <div className="text-[16px] font-bold text-slate-800">
            {initial?.id ? 'Edit Promotion' : 'New Promotion'}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer text-[18px]">✕</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">

          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Promotion Name *</label>
            <input value={form.name} onChange={e=>set('name',e.target.value)} autoFocus
              placeholder="e.g. Summer Sale, Happy Hour, Buy 2 Get Discount"
              className="w-full rounded-xl px-4 py-2.5 text-[14px] outline-none transition-all"
              style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}
              onFocus={e=>e.target.style.borderColor='#006AFF'}
              onBlur={e=>e.target.style.borderColor='#e2e8f0'}/>
          </div>

          {/* Type selector */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Promotion Type *</label>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(TYPE_INFO).map(([id, ti]) => (
                <button key={id} onClick={() => set('type', id)}
                  className="rounded-xl p-3 text-center cursor-pointer border-2 transition-all"
                  style={form.type===id
                    ? {background: ti.bg, borderColor: ti.color}
                    : {background:'#f8fafc', borderColor:'#e2e8f0'}}>
                  <div className="text-[22px] mb-1">{ti.icon}</div>
                  <div className="text-[12px] font-bold" style={{color: form.type===id ? ti.color : '#E5E5E5'}}>{ti.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{ti.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Product selector */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Apply to Product <span className="text-slate-400 font-normal normal-case">(leave blank = all products)</span>
            </label>

            {selectedProduct ? (
              /* Selected product card */
              <div className="rounded-xl px-3 py-2.5 flex items-center gap-3"
                style={{ border: '1.5px solid #006AFF', background: '#E6F0FF' }}>
                <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden flex items-center justify-center"
                  style={{ background: '#FFFFFF', border: '1px solid #B3D1FF' }}>
                  {selectedProduct.image_url
                    ? <img src={selectedProduct.image_url} alt="" className="w-full h-full object-cover"/>
                    : <span className="text-[11px] font-bold text-[#006AFF]">{selectedProduct.name?.substring(0, 2).toUpperCase()}</span>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-[#1F1F1F] truncate">{selectedProduct.name}</div>
                  <div className="text-[10px] text-[#666] font-mono">
                    {selectedProduct.sku ? `SKU: ${selectedProduct.sku}` : ''}
                    {selectedProduct.barcode ? ` · UPC: ${selectedProduct.barcode}` : ''}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[14px] font-bold font-mono text-[#006AFF]">${(selectedProduct.price || 0).toFixed(2)}</div>
                </div>
                <button onClick={() => setShowProductPicker(true)}
                  className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold cursor-pointer flex-shrink-0"
                  style={{ background: '#FFFFFF', color: '#006AFF', border: '1px solid #006AFF' }}>
                  Change
                </button>
                <button onClick={() => set('product_id', '')}
                  className="rounded-lg px-2 py-1.5 text-[14px] cursor-pointer flex-shrink-0"
                  style={{ background: '#FFFFFF', color: '#CF1322', border: '1px solid #FECACA' }}
                  title="Clear (apply to all products)">
                  ✕
                </button>
              </div>
            ) : (
              /* Pick product button + "All products" hint */
              <button onClick={() => setShowProductPicker(true)}
                className="w-full rounded-xl px-4 py-3 text-[13px] font-bold cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98]"
                style={{ border: '1.5px dashed #B3D1FF', background: '#F5F5F5', color: '#006AFF' }}>
                <span className="text-[16px]">📷</span>
                <span>Scan barcode / Search / Browse categories</span>
              </button>
            )}
            {!selectedProduct && (
              <div className="mt-1.5 text-[10px] text-[#666]">
                💡 Leave empty to apply this promotion to <strong>all products</strong>
              </div>
            )}
          </div>

          {/* ── SCHEDULE (shared for ALL promotion types) ── */}
          <div className="rounded-xl p-4" style={{background:'#FAFAFA', border:'1.5px solid #E5E5E5'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[12px] font-bold text-[#1F1F1F]">📅 Schedule</div>
              <button onClick={() => {
                const now = new Date()
                // Round to nearest minute, format for datetime-local
                set('sale_start', new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16))
              }}
                className="rounded-md px-2 py-1 text-[10px] font-bold cursor-pointer"
                style={{background:'#FFFFFF', color:'#006AFF', border:'1px solid #006AFF'}}>
                ⚡ Start now
              </button>
            </div>

            {/* Start date */}
            <div className="mb-2.5">
              <label className="block text-[10px] text-[#666] font-bold uppercase mb-1">Start Date &amp; Time *</label>
              <input type="datetime-local" value={form.sale_start} onChange={e=>set('sale_start', e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
                style={{border:'1.5px solid #E5E5E5', background:'#FFFFFF'}}/>
            </div>

            {/* End date */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-[#666] font-bold uppercase">End Date &amp; Time</label>
                <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                  <input type="checkbox" checked={form.no_end_date}
                    onChange={e => set('no_end_date', e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#006AFF]"/>
                  <span className="text-[#666] font-bold">Runs forever (no end date)</span>
                </label>
              </div>
              <input type="datetime-local" value={form.sale_end} onChange={e=>set('sale_end', e.target.value)}
                disabled={form.no_end_date}
                className="w-full rounded-lg px-3 py-2 text-[12px] outline-none disabled:opacity-40 disabled:bg-[#F5F5F5]"
                style={{border:'1.5px solid #E5E5E5', background:'#FFFFFF'}}/>
            </div>

            {/* Computed status preview */}
            <PromoStatusPreview
              startsAt={form.sale_start}
              endsAt={form.no_end_date ? null : form.sale_end}
              enabled={form.is_active}
            />
          </div>

          {/* ── SALE PRICING (type-specific) ── */}
          {form.type === 'sale' && (
            <div className="rounded-xl p-4" style={{background:'#E6F0FF', border:'1.5px solid #B3D1FF'}}>
              <div className="text-[12px] font-bold text-indigo-700 mb-3">🏷️ Sale Pricing</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Discount Type</label>
                  <div className="flex gap-2">
                    {[['fixed','Fixed Price $'],['pct','Percentage %']].map(([t,l]) => (
                      <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="sale_type" value={t} checked={form.sale_type===t}
                          onChange={()=>set('sale_type',t)} className="accent-indigo-500"/>
                        <span className="text-[12px] text-slate-600">{l}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    {form.sale_type==='fixed' ? 'Sale Price ($) *' : 'Discount (%) *'}
                  </label>
                  <div className="flex items-center rounded-lg px-3" style={{border:'1.5px solid #B3D1FF', background:'#fff'}}>
                    <span className="text-slate-400 mr-1">{form.sale_type==='fixed'?'$':'%'}</span>
                    <input type="number" value={form.sale_value} onChange={e=>set('sale_value',e.target.value)}
                      placeholder={form.sale_type==='fixed'?'8.00':'10'} step="0.01"
                      className="flex-1 border-none outline-none py-2 text-[13px] font-mono bg-transparent"/>
                  </div>
                </div>
              </div>
              {form.sale_value && selectedProduct && (
                <div className="mt-3 flex items-center gap-3 text-[12px]">
                  <span className="text-slate-400 line-through">${selectedProduct.price.toFixed(2)}</span>
                  <span className="text-indigo-700 font-bold text-[14px]">
                    ${form.sale_type==='fixed'
                      ? parseFloat(form.sale_value).toFixed(2)
                      : (selectedProduct.price*(1-parseFloat(form.sale_value)/100)).toFixed(2)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{background:'#dcfce7', color:'#16a34a'}}>
                    Save ${form.sale_type==='fixed'
                      ? (selectedProduct.price-parseFloat(form.sale_value)).toFixed(2)
                      : (selectedProduct.price*parseFloat(form.sale_value)/100).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── BULK PRICING ── */}
          {form.type === 'bulk' && (
            <div className="rounded-xl p-4" style={{background:'#f0fdf4', border:'1.5px solid #86efac'}}>
              <div className="text-[12px] font-bold text-green-700 mb-3">📦 Bulk Pricing Tiers</div>

              {/* Existing tiers */}
              {form.bulk_tiers.length > 0 && (
                <div className="mb-3 flex flex-col gap-1.5">
                  {form.bulk_tiers.map((t,i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2"
                      style={{background:'#fff', border:'1px solid #bbf7d0'}}>
                      <span className="text-[12px] font-bold text-green-700">
                        {t.type === 'bundle_total' ? `Buy ${t.min_qty} for` : `Buy ${t.min_qty}+`}
                      </span>
                      <span className="text-[12px] text-slate-600 font-mono">
                        {t.type==='bundle_total'
                          ? `$${Number(t.value).toFixed(2)} total`
                          : t.type==='fixed' || t.type==='flat'
                          ? `$${Number(t.value).toFixed(2)}/ea`
                          : `${t.value}% off`}
                      </span>
                      {selectedProduct && (
                        <span className="text-[11px] text-slate-400">
                          {t.type === 'bundle_total'
                            ? `→ $${(t.value/t.min_qty).toFixed(2)}/ea`
                            : t.type === 'fixed' || t.type === 'flat'
                            ? `→ saves $${((selectedProduct.price - t.value)*t.min_qty).toFixed(2)}/${t.min_qty}-pack`
                            : `→ $${(selectedProduct.price*(1-t.value/100)).toFixed(2)}/ea`}
                        </span>
                      )}
                      <button onClick={() => set('bulk_tiers', form.bulk_tiers.filter((_,j)=>j!==i))}
                        className="ml-auto text-[#CF1322] hover:text-red-600 bg-transparent border-none cursor-pointer">✕</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add tier */}
              <div className="space-y-2">
                <div className="text-[11px] text-green-700 font-bold">+ Add a new tier</div>
                <div className="rounded-lg px-3 py-2 text-[10px] text-slate-500"
                  style={{background:'#fff', border:'1px solid #bbf7d0'}}>
                  💡 <b>Tip:</b> use "Buy N for $X" for natural pricing like
                  "<b>Buy 2 for $18</b>", "<b>Buy 3 for $21</b>" — POS will
                  automatically combine bundles when customer buys more
                  (4 items = 1× 3-pack + 1 single).
                </div>
                <div className="flex gap-2 items-end">
                  <div>
                    <div className="text-[10px] text-slate-500 mb-1">Buy</div>
                    <input type="number" value={newTier.min_qty} onChange={e=>setNewTier(t=>({...t,min_qty:e.target.value}))}
                      placeholder="2" min="2"
                      className="rounded-lg px-3 py-2 text-[13px] font-mono outline-none"
                      style={{border:'1.5px solid #86efac', background:'#fff', width:'70px'}}/>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 mb-1">Pricing</div>
                    <select value={newTier.type} onChange={e=>setNewTier(t=>({...t,type:e.target.value}))}
                      className="rounded-lg px-3 py-2 text-[12px] outline-none cursor-pointer"
                      style={{border:'1.5px solid #86efac', background:'#fff'}}>
                      <option value="bundle_total">for $X total ⭐</option>
                      <option value="fixed">at $X each</option>
                      <option value="pct">% off each</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] text-slate-500 mb-1">
                      {newTier.type==='bundle_total' ? 'Total $ for bundle' :
                       newTier.type==='fixed'        ? 'Price each ($)' :
                                                      'Discount (%)'}
                    </div>
                    <input type="number" value={newTier.value} onChange={e=>setNewTier(t=>({...t,value:e.target.value}))}
                      placeholder={newTier.type==='bundle_total'?'18.00':newTier.type==='fixed'?'9.00':'10'} step="0.01"
                      className="w-full rounded-lg px-3 py-2 text-[13px] font-mono outline-none"
                      style={{border:'1.5px solid #86efac', background:'#fff'}}/>
                  </div>
                  <button onClick={addTier}
                    className="rounded-lg px-4 py-2 text-[12px] font-bold text-white cursor-pointer border-none"
                    style={{background:'#16a34a'}}>
                    + Add
                  </button>
                </div>
                {/* Live preview */}
                {newTier.min_qty && newTier.value && (
                  <div className="text-[11px] text-green-700 font-mono">
                    Preview:
                    {newTier.type === 'bundle_total' && ` Buy ${newTier.min_qty} for $${Number(newTier.value).toFixed(2)} (= $${(Number(newTier.value)/Number(newTier.min_qty)).toFixed(2)}/ea)`}
                    {newTier.type === 'fixed' && ` Buy ${newTier.min_qty}+ at $${Number(newTier.value).toFixed(2)} each`}
                    {newTier.type === 'pct' && ` Buy ${newTier.min_qty}+ → ${newTier.value}% off each`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TIME BASED PRICING ── */}
          {form.type === 'time' && (
            <div className="rounded-xl p-4" style={{background:'#fffbeb', border:'1.5px solid #fde047'}}>
              <div className="text-[12px] font-bold text-amber-700 mb-3">⏰ Time Based Rules</div>

              {/* Existing rules */}
              {form.time_rules.length > 0 && (
                <div className="mb-3 flex flex-col gap-1.5">
                  {form.time_rules.map((r,i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2"
                      style={{background:'#fff', border:'1px solid #fde047'}}>
                      <span className="text-[11px] font-bold text-amber-700">
                        {(r.days||[]).map(d=>DAYS[d]).join(', ')}
                      </span>
                      <span className="text-[11px] text-slate-500">{r.start_time} – {r.end_time}</span>
                      <span className="text-[11px] font-semibold text-amber-700">
                        {r.type==='fixed' ? `$${r.value}` : `${r.value}% off`}
                      </span>
                      <button onClick={() => set('time_rules', form.time_rules.filter((_,j)=>j!==i))}
                        className="ml-auto text-[#CF1322] hover:text-red-600 bg-transparent border-none cursor-pointer">✕</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Day picker */}
              <div className="mb-3">
                <div className="text-[10px] text-slate-500 mb-1.5">Days of Week</div>
                <div className="flex gap-1.5">
                  {DAYS.map((d,i) => (
                    <button key={i} onClick={() => toggleDay(i)}
                      className="w-9 h-9 rounded-lg text-[11px] font-bold cursor-pointer border-2 transition-all"
                      style={newRule.days.includes(i)
                        ? {background:'#f59e0b', borderColor:'#f59e0b', color:'#fff'}
                        : {background:'#fff', borderColor:'#e2e8f0', color:'#64748b'}}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time + value */}
              <div className="grid grid-cols-4 gap-2 items-end">
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">Start Time</div>
                  <input type="time" value={newRule.start_time}
                    onChange={e=>setNewRule(r=>({...r,start_time:e.target.value}))}
                    className="w-full rounded-lg px-2 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #fde047', background:'#fff'}}/>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">End Time</div>
                  <input type="time" value={newRule.end_time}
                    onChange={e=>setNewRule(r=>({...r,end_time:e.target.value}))}
                    className="w-full rounded-lg px-2 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #fde047', background:'#fff'}}/>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">Type</div>
                  <select value={newRule.type} onChange={e=>setNewRule(r=>({...r,type:e.target.value}))}
                    className="w-full rounded-lg px-2 py-2 text-[12px] outline-none"
                    style={{border:'1.5px solid #fde047', background:'#fff'}}>
                    <option value="fixed">Fixed $</option>
                    <option value="pct">% Off</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">{newRule.type==='fixed'?'Price':'% Off'}</div>
                  <div className="flex gap-1">
                    <input type="number" value={newRule.value}
                      onChange={e=>setNewRule(r=>({...r,value:e.target.value}))}
                      placeholder={newRule.type==='fixed'?'3.00':'10'} step="0.01"
                      className="flex-1 rounded-lg px-2 py-2 text-[12px] font-mono outline-none"
                      style={{border:'1.5px solid #fde047', background:'#fff'}}/>
                    <button onClick={addRule}
                      className="rounded-lg px-3 py-2 text-[11px] font-bold text-white cursor-pointer border-none"
                      style={{background:'#d97706'}}>
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Enable / pause toggle — separate from schedule */}
          <label className="flex items-center gap-3 cursor-pointer rounded-xl px-4 py-3"
            style={{background: form.is_active ? '#DCFCE7' : '#FEF3C7',
                    border: `1.5px solid ${form.is_active ? '#15803D' : '#F59E0B'}`}}>
            <input type="checkbox" checked={form.is_active} onChange={e=>set('is_active',e.target.checked)}
              className="w-4 h-4 accent-[#15803D]"/>
            <div className="flex-1">
              <div className="text-[13px] font-semibold"
                style={{color: form.is_active ? '#15803D' : '#B45309'}}>
                {form.is_active ? '✓ Enabled' : '⏸ Paused'}
              </div>
              <div className="text-[11px]" style={{color: form.is_active ? '#15803D' : '#B45309'}}>
                {form.is_active
                  ? 'Will run during the scheduled window above.'
                  : 'Manually paused — will NOT run even if schedule says it should.'}
              </div>
            </div>
          </label>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3 sticky bottom-0" style={{background:'#fff', borderTop:'1px solid #f1f5f9', paddingTop:'16px'}}>
          <button onClick={onClose}
            className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border transition-all"
            style={{background:'#f8fafc', border:'1.5px solid #e2e8f0', color:'#64748b'}}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-[2] rounded-xl py-3 text-[13px] font-bold text-white cursor-pointer border-none disabled:opacity-50 transition-all"
            style={{background:'#000000'}}>
            {saving ? '⏳ Saving...' : initial?.id ? '✓ Update Promotion' : '✓ Create Promotion'}
          </button>
        </div>
      </div>

      {showProductPicker && (
        <EstimateProductPicker
          title="Pick product for this promotion"
          excludeIds={[]}
          onPick={(p) => {
            set('product_id', p.id)
            setShowProductPicker(false)
          }}
          onClose={() => setShowProductPicker(false)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PromoStatusPreview — small inline preview of the effective status
// based on schedule + enabled flag. Renders right under the date inputs.
// ─────────────────────────────────────────────────────────────
function PromoStatusPreview({ startsAt, endsAt, enabled }) {
  if (!startsAt) {
    return (
      <div className="mt-3 rounded-lg p-2 text-[11px]"
        style={{background:'#FFFFFF', border:'1px dashed #E5E5E5', color:'#999'}}>
        ⓘ Pick a start date to see when this promo will be live
      </div>
    )
  }

  const now = new Date()
  const start = new Date(startsAt)
  const end   = endsAt ? new Date(endsAt) : null

  let label, color, bg, icon, hint
  if (!enabled) {
    label = 'Paused (won\'t run)'
    icon = '⏸'
    color = '#B45309'; bg = '#FEF3C7'
    hint = 'Enable the toggle below to allow this promo to run.'
  } else if (now < start) {
    const minutesUntil = Math.round((start - now) / 60000)
    const ago = formatDuration(minutesUntil, true)
    label = `Scheduled — starts in ${ago}`
    icon = '📅'
    color = '#006AFF'; bg = '#E6F0FF'
    hint = `Begins ${start.toLocaleString()}`
  } else if (!end || now <= end) {
    icon = '✅'
    color = '#15803D'; bg = '#DCFCE7'
    if (end) {
      const minutesLeft = Math.round((end - now) / 60000)
      label = `Live now — ends in ${formatDuration(minutesLeft, false)}`
      hint = `Ends ${end.toLocaleString()}`
    } else {
      label = 'Live now — runs forever'
      hint = 'No end date set'
    }
  } else {
    label = 'Expired'
    icon = '⏰'
    color = '#999'; bg = '#F5F5F5'
    hint = `Ended ${end.toLocaleString()}`
  }

  return (
    <div className="mt-3 rounded-lg px-3 py-2 flex items-center gap-2"
      style={{background: bg, border: `1px solid ${color}33`}}>
      <span style={{fontSize: '14px'}}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold" style={{color}}>{label}</div>
        <div className="text-[10px]" style={{color: '#666'}}>{hint}</div>
      </div>
    </div>
  )
}

function formatDuration(minutes, future) {
  if (minutes < 1) return future ? 'less than a minute' : 'now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}
