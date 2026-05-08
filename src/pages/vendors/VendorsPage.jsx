// src/pages/vendors/VendorsPage.jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

const PO_STATUS = {
  draft:     { bg:'rgba(61,80,104,0.2)',   color:'#666666' },
  ordered:   { bg:'rgba(59,130,246,0.12)', color:'#3b82f6' },
  partial:   { bg:'rgba(245,158,11,0.12)', color:'#f59e0b' },
  received:  { bg:'rgba(16,185,129,0.12)', color:'#10b981' },
  cancelled: { bg:'rgba(239,68,68,0.12)',  color:'#ef4444' },
}

export default function VendorsPage() {
  const { tenant, store } = useAuthStore()
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [search, setSearch] = useState('')

  const { data: suppliers=[], isLoading } = useQuery({
    queryKey: ['suppliers', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers')
        .select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('name')
      return data||[]
    },
    enabled: !!tenant?.id,
  })

  const { data: pos=[] } = useQuery({
    queryKey: ['purchase-orders', selectedVendor?.id],
    queryFn: async () => {
      const { data } = await supabase.from('purchase_orders')
        .select('*, purchase_order_items(*, products(name))')
        .eq('supplier_id', selectedVendor.id).eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false }).limit(20)
      return data||[]
    },
    enabled: !!selectedVendor?.id,
  })

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.contact_name||'').toLowerCase().includes(search.toLowerCase())
  )

  const totalPOs = pos.length
  const totalSpend = pos.reduce((s,p)=>s+(p.total||0), 0)
  const pending = pos.filter(p=>['ordered','partial'].includes(p.status))

  const AVATAR_COLORS = [
    'linear-gradient(135deg,#3b82f6,#006AFF)',
    'linear-gradient(135deg,#10b981,#06b6d4)',
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#ec4899,#006AFF)',
    'linear-gradient(135deg,#14b8a6,#3b82f6)',
  ]

  return (
    <div className="flex h-full bg-[#FAFAFA]">
      {/* Vendor list */}
      <div className="w-[280px] bg-[#FFFFFF] border-r border-[#E5E5E5] flex flex-col flex-shrink-0">
        <div className="p-3.5 border-b border-[#E5E5E5]">
          <div className="flex items-center gap-2 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 focus-within:border-orange-500/30 transition-colors">
            <span className="text-[#999999]">🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search vendors..."
              className="bg-transparent border-none outline-none py-2.5 text-[12px] text-[#1F1F1F] flex-1 font-sans placeholder-[#999999]"/>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filtered.map((s,i) => (
            <div key={s.id} onClick={()=>setSelectedVendor(s)}
              className={`p-3 rounded-[10px] cursor-pointer border mb-1 transition-all ${selectedVendor?.id===s.id?'bg-[#F5F5F5] border-orange-500/40':'border-transparent hover:bg-[#F5F5F5]'}`}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[14px] font-bold text-white flex-shrink-0"
                  style={{background: AVATAR_COLORS[i % AVATAR_COLORS.length]}}>
                  {s.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold truncate">{s.name}</div>
                  <div className="text-[10px] text-[#999999] mt-0.5">{s.email||s.phone||'—'}</div>
                </div>
              </div>
              <div className="flex gap-1.5 pl-[46px]">
                {s.payment_terms && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-yellow-500/10 text-[#FA8C16]">{s.payment_terms}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-[#E5E5E5]">
          <button className="w-full bg-orange-500 border-none rounded-[9px] py-2.5 text-[12px] font-bold text-white" onClick={()=>toast.success('Add vendor form')}>+ Add Vendor</button>
        </div>
      </div>

      {/* Detail */}
      {selectedVendor ? (
        <div className="flex-1 overflow-y-auto p-6 bg-[#FAFAFA]">
          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            <div className="w-[58px] h-[58px] rounded-[14px] flex items-center justify-center text-[22px] font-bold text-white flex-shrink-0"
              style={{background: AVATAR_COLORS[suppliers.findIndex(s=>s.id===selectedVendor.id) % AVATAR_COLORS.length]}}>
              {selectedVendor.name.charAt(0)}
            </div>
            <div className="flex-1">
              <div className="text-[20px] font-bold">{selectedVendor.name}</div>
              <div className="text-[12px] text-[#666666] mt-1">
                {[selectedVendor.email, selectedVendor.phone, selectedVendor.city && `${selectedVendor.city}, ${selectedVendor.state}`].filter(Boolean).join(' · ')}
              </div>
              <div className="flex gap-2 mt-2">
                {selectedVendor.payment_terms && <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-yellow-500/10 text-[#FA8C16]">{selectedVendor.payment_terms}</span>}
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-green-500/10 text-[#00B23B]">Active</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>toast.success('Edit vendor')} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#666666] hover:border-blue-500/30 hover:text-[#006AFF] transition-all">Edit</button>
              <button onClick={()=>toast.success('Creating PO...')} className="bg-orange-500 border-none rounded-lg px-3 py-1.5 text-[11px] font-bold text-white">+ New PO</button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              ['Total Spent', `$${totalSpend.toFixed(0)}`, '#3b82f6'],
              ['Purchase Orders', totalPOs, undefined],
              ['Pending POs', pending.length, pending.length>0?'#f59e0b':undefined],
              ['Avg Order', totalPOs>0?`$${(totalSpend/totalPOs).toFixed(0)}`:'—', '#10b981'],
            ].map(([l,v,c]) => (
              <div key={l} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[11px] p-3.5">
                <div className="text-[9px] font-mono text-[#999999] uppercase tracking-wider mb-1">{l}</div>
                <div className="text-[20px] font-bold" style={{color:c}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Contact + Terms */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
              <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-3">Contact</div>
              {[
                ['Contact Name', selectedVendor.contact_name||'—'],
                ['Email', selectedVendor.email||'—'],
                ['Phone', selectedVendor.phone||'—'],
                ['Address', [selectedVendor.address, selectedVendor.city, selectedVendor.state].filter(Boolean).join(', ')||'—'],
              ].map(([l,v]) => (
                <div key={l} className="flex justify-between mb-2 last:mb-0">
                  <span className="text-[11px] text-[#999999]">{l}</span>
                  <span className="text-[12px] font-semibold text-right max-w-[55%]">{v}</span>
                </div>
              ))}
            </div>
            <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] p-4">
              <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-3">Payment Terms</div>
              {[
                ['Terms', selectedVendor.payment_terms||'—'],
                ['Currency', 'USD'],
                ['Notes', selectedVendor.notes||'—'],
              ].map(([l,v]) => (
                <div key={l} className="flex justify-between mb-2 last:mb-0">
                  <span className="text-[11px] text-[#999999]">{l}</span>
                  <span className="text-[12px] font-semibold text-right max-w-[60%] text-[#666666]">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Purchase Orders */}
          <div className="mb-2 flex justify-between items-center">
            <div className="text-[14px] font-bold">📋 Purchase Orders</div>
            <button onClick={()=>toast.success('New PO')} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#666666] hover:border-orange-500/30 hover:text-[#FA8C16] transition-all">+ New PO</button>
          </div>
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-[12px] overflow-hidden">
            <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]"
              style={{gridTemplateColumns:'1.2fr 1fr 1fr 1fr 1fr 100px'}}>
              {['PO Number','Status','Order Date','Expected','Amount','Actions'].map(h => (
                <div key={h} className="px-3.5 py-2.5 font-mono text-[10px] text-[#999999] uppercase tracking-wider">{h}</div>
              ))}
            </div>
            {pos.length === 0 ? (
              <div className="text-center py-8 text-[#999999] text-sm">No purchase orders yet</div>
            ) : pos.map(po => {
              const st = PO_STATUS[po.status]||PO_STATUS.draft
              return (
                <div key={po.id} className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5] transition-colors cursor-pointer"
                  style={{gridTemplateColumns:'1.2fr 1fr 1fr 1fr 1fr 100px'}}>
                  <div className="px-3.5 py-3 font-mono text-[12px] font-bold text-[#006AFF]">{po.po_number}</div>
                  <div className="px-3.5 py-3">
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded" style={{background:st.bg,color:st.color}}>{po.status.toUpperCase()}</span>
                  </div>
                  <div className="px-3.5 py-3 text-[11px] text-[#666666]">{po.order_date?new Date(po.order_date).toLocaleDateString():'—'}</div>
                  <div className="px-3.5 py-3 text-[11px] text-[#666666]">{po.expected_date?new Date(po.expected_date).toLocaleDateString():'—'}</div>
                  <div className="px-3.5 py-3 font-mono text-[12px] font-bold" style={{color:['ordered','partial'].includes(po.status)?'#f59e0b':undefined}}>
                    ${po.total?.toFixed(2)||'0.00'}
                  </div>
                  <div className="px-3.5 py-3 flex gap-1.5">
                    <button onClick={()=>toast.success(`Opening ${po.po_number}`)} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded px-2 py-1 text-[10px] text-[#666666] hover:text-[#006AFF] transition-all">View</button>
                    {['ordered','partial'].includes(po.status) && (
                      <button onClick={()=>toast.success('Receive stock')} className="bg-green-500/10 border border-green-500/20 rounded px-2 py-1 text-[10px] text-[#00B23B]">Recv</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[#FAFAFA]">
          <div className="text-center text-[#999999]">
            <div className="text-5xl mb-4 opacity-20">🚚</div>
            <div className="text-[14px]">Select a vendor to view details</div>
          </div>
        </div>
      )}
    </div>
  )
}
