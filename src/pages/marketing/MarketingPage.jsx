// src/pages/marketing/MarketingPage.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

const PROMO_TYPE_INFO = {
  quantity_price:   { icon:'📊', label:'Quantity Price',    color:'#f59e0b' },
  buy_get_free:     { icon:'🎁', label:'Buy & Get Free',    color:'#10b981' },
  time_special:     { icon:'⏰', label:'Time Special',       color:'#06b6d4' },
  product_discount: { icon:'🏷️', label:'Product Discount',  color:'#3b82f6' },
  order_discount:   { icon:'💸', label:'Order Discount',    color:'#8b5cf6' },
}

export default function MarketingPage() {
  const { tenant } = useAuthStore()
  const [showForm, setShowForm] = useState(false)

  const { data: promos=[], refetch } = useQuery({
    queryKey: ['promotions', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('promotions')
        .select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false })
      return data||[]
    },
    enabled: !!tenant?.id,
  })

  const toggle = async (promo) => {
    await supabase.from('promotions').update({ is_active: !promo.is_active }).eq('id', promo.id)
    refetch()
    toast.success(promo.is_active ? 'Promotion paused' : 'Promotion enabled')
  }

  const active = promos.filter(p => p.is_active)
  const upcoming = promos.filter(p => !p.is_active && p.start_date && new Date(p.start_date) > new Date())
  const ended = promos.filter(p => !p.is_active && (!p.start_date || new Date(p.start_date) <= new Date()))

  return (
    <div className="p-6 overflow-y-auto h-full bg-[#07090f]">
      <div className="flex justify-between items-center mb-5">
        <div className="text-[20px] font-bold">🎯 Marketing Promotions</div>
        <button onClick={()=>setShowForm(true)} className="bg-pink-500 border-none rounded-lg px-4 py-2 text-[12px] font-bold text-white">+ New Promotion</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          ['Active Now', active.length, '#10b981'],
          ['Upcoming', upcoming.length, '#3b82f6'],
          ['Total', promos.length, undefined],
          ['Ended', ended.length, '#3d5068'],
        ].map(([l,v,c]) => (
          <div key={l} className="bg-[#0d1117] border border-[#1e2d42] rounded-[11px] p-4">
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1">{l}</div>
            <div className="text-[22px] font-bold" style={{color:c}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Promo cards */}
      <div className="grid gap-3" style={{gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))'}}>
        {promos.map(promo => {
          const ti = PROMO_TYPE_INFO[promo.type]||{}
          return (
            <div key={promo.id} className="bg-[#0d1117] border border-[#1e2d42] rounded-[14px] overflow-hidden hover:-translate-y-0.5 transition-all"
              style={{borderTop:`2px solid ${ti.color||'#3b82f6'}`}}>
              <div className="p-4 border-b border-[#1e2d42] flex items-start gap-3">
                <div className="w-[40px] h-[40px] rounded-[9px] flex items-center justify-center text-[18px] flex-shrink-0"
                  style={{background:`${ti.color||'#3b82f6'}18`}}>
                  {ti.icon}
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-bold">{promo.name}</div>
                  <div className="text-[10px] font-mono mt-0.5" style={{color:ti.color}}>{ti.label}</div>
                </div>
                {/* Toggle */}
                <button onClick={()=>toggle(promo)}
                  className="w-[34px] h-[18px] rounded-full relative flex-shrink-0 transition-colors"
                  style={{background: promo.is_active ? '#10b981' : '#3d5068'}}>
                  <div className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all"
                    style={{left: promo.is_active ? '18px' : '2px'}}/>
                </button>
              </div>
              <div className="p-4">
                {/* Rules display */}
                {promo.discount_type && promo.discount_value && (
                  <div className="bg-[#111827] border border-[#1e2d42] rounded-lg p-2.5 mb-2 text-[12px]">
                    💰 {promo.discount_value}{promo.discount_type==='percentage'?'%':' USD'} off
                    {promo.applies_to !== 'all' && ` (${promo.applies_to})`}
                  </div>
                )}
                {promo.start_date && (
                  <div className="bg-[#111827] border border-[#1e2d42] rounded-lg p-2.5 mb-2 text-[11px] text-[#8899b0]">
                    📅 {new Date(promo.start_date).toLocaleDateString()}
                    {promo.end_date && ` → ${new Date(promo.end_date).toLocaleDateString()}`}
                  </div>
                )}
                <div className="flex justify-between items-center mt-3">
                  <span className="text-[11px] text-[#8899b0]">
                    <span className="w-1.5 h-1.5 rounded-full inline-block mr-1.5"
                      style={{background: promo.is_active ? '#10b981' : '#3d5068',
                              boxShadow: promo.is_active ? '0 0 4px #10b981' : 'none'}}/>
                    {promo.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={()=>toast.success('Edit promo')}
                    className="bg-[#111827] border border-[#1e2d42] rounded-md px-2.5 py-1 text-[10px] text-[#8899b0] hover:border-pink-500/30 hover:text-pink-400 transition-all">
                    Edit
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {promos.length === 0 && (
          <div className="col-span-full text-center py-16 text-[#3d5068]">
            <div className="text-4xl mb-3 opacity-20">🎯</div>
            <div className="text-[14px]">No promotions yet</div>
            <button onClick={()=>setShowForm(true)} className="mt-3 bg-pink-500 border-none rounded-lg px-4 py-2 text-[11px] font-bold text-white">Create First Promotion</button>
          </div>
        )}
      </div>

      {/* New promo form overlay */}
      {showForm && (
        <div className="fixed inset-0 bg-[rgba(7,9,15,0.8)] backdrop-blur-sm z-50 flex items-center justify-center"
          onClick={()=>setShowForm(false)}>
          <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[520px] max-h-[85vh] overflow-y-auto"
            onClick={e=>e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#1e2d42] flex justify-between">
              <div className="text-[15px] font-bold">🎯 New Promotion</div>
              <button onClick={()=>setShowForm(false)} className="text-[#3d5068] hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5">
              <div className="mb-4">
                <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider mb-2">Name</div>
                <input className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] outline-none focus:border-pink-500/40 transition-colors" placeholder="e.g. Summer Sale"/>
              </div>
              <div className="mb-4">
                <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider mb-2">Type</div>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(PROMO_TYPE_INFO).map(([id,{icon,label,color}]) => (
                    <div key={id} className="bg-[#111827] border border-[#1e2d42] rounded-[9px] p-3 cursor-pointer hover:border-pink-500/30 transition-all text-center">
                      <div className="text-[18px] mb-1">{icon}</div>
                      <div className="text-[10px] text-[#8899b0]">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider mb-2">Start Date</div>
                  <input type="date" className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[12px] font-mono outline-none focus:border-pink-500/40"/>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider mb-2">End Date</div>
                  <input type="date" className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[12px] font-mono outline-none focus:border-pink-500/40"/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider mb-2">Discount Type</div>
                  <select className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[12px] outline-none text-[#e8edf5]">
                    <option>Percentage (%)</option>
                    <option>Fixed Amount ($)</option>
                  </select>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider mb-2">Value</div>
                  <input type="number" className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3 py-2.5 text-[12px] outline-none focus:border-pink-500/40" placeholder="10"/>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={()=>setShowForm(false)} className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-2.5 text-[13px] text-[#8899b0]">Cancel</button>
                <button onClick={()=>{setShowForm(false);toast.success('Promotion created!')}} className="flex-[2] bg-pink-500 border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white">✓ Create Promotion</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
