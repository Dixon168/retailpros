// src/pages/estimates/EstimatesPage.jsx
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import CreateEstimateModal from './CreateEstimateModal'
import EstimateDetailModal from './EstimateDetailModal'

const STATUS_BADGE = {
  draft:     { bg:'#F5F5F5', color:'#666',    label:'Draft' },
  sent:      { bg:'#eef0fc', color:'#5E6AD2', label:'Sent' },
  accepted:  { bg:'#d1fae5', color:'#059669', label:'Accepted' },
  declined:  { bg:'#FEE2E2', color:'#dc2626', label:'Declined' },
  expired:   { bg:'#FEF3C7', color:'#B45309', label:'Expired' },
  converted: { bg:'#eef0fc', color:'#5E6AD2', label:'→ Invoice' },
}

export default function EstimatesPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [showCreate, setShowCreate]     = useState(false)
  const [viewingEst, setViewingEst]     = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch]             = useState('')

  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ['estimates-list', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_estimate_with_customer')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(200)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const filtered = useMemo(() => {
    let list = estimates
    if (statusFilter === 'open') {
      list = list.filter(e => ['draft', 'sent'].includes(e.status))
    } else if (statusFilter === 'accepted') {
      list = list.filter(e => e.status === 'accepted')
    } else if (statusFilter === 'converted') {
      list = list.filter(e => e.status === 'converted')
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(e =>
        e.estimate_number?.toLowerCase().includes(q) ||
        e.company_name?.toLowerCase().includes(q)
      )
    }
    return list
  }, [estimates, statusFilter, search])

  const counts = useMemo(() => ({
    all: estimates.length,
    open: estimates.filter(e => ['draft', 'sent'].includes(e.status)).length,
    accepted: estimates.filter(e => e.status === 'accepted').length,
    converted: estimates.filter(e => e.status === 'converted').length,
  }), [estimates])

  return (
    <div className="max-w-[1200px] mx-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[22px] font-bold text-[#1F1F1F]">📝 Estimates</div>
          <div className="text-[12px] text-[#666] mt-1">
            Quote your customers — turn into invoices when accepted
          </div>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
          + New Estimate
        </button>
      </div>

      {/* Search + filter */}
      <div className="mb-4 space-y-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search by estimate number or company name..."
          className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-4 py-3 text-[14px] outline-none focus:border-[#5E6AD2]"/>
        <div className="flex gap-2 flex-wrap">
          <FilterTab active={statusFilter==='all'}      onClick={() => setStatusFilter('all')}      count={counts.all}>All</FilterTab>
          <FilterTab active={statusFilter==='open'}     onClick={() => setStatusFilter('open')}     count={counts.open}     highlight>📋 Open</FilterTab>
          <FilterTab active={statusFilter==='accepted'} onClick={() => setStatusFilter('accepted')} count={counts.accepted} highlight>✅ Accepted</FilterTab>
          <FilterTab active={statusFilter==='converted'} onClick={() => setStatusFilter('converted')} count={counts.converted}>→ Converted</FilterTab>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center text-[#666] text-[13px]">
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-12 text-center">
          <div className="text-[48px] mb-2 opacity-30">📝</div>
          <div className="text-[14px] font-bold text-[#1F1F1F] mb-1">
            {estimates.length === 0 ? 'No estimates yet' : 'No estimates match your filter'}
          </div>
          {estimates.length === 0 && (
            <button onClick={() => setShowCreate(true)}
              className="mt-3 rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer"
              style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
              Create your first estimate
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
          <div className="grid border-b border-[#E5E5E5] bg-[#F5F5F5]"
            style={{gridTemplateColumns:'1.3fr 1.4fr 1fr 1fr 1fr 110px'}}>
            {['Estimate #', 'Company', 'Status', 'Date', 'Valid Until', 'Total'].map(h => (
              <div key={h} className="px-3.5 py-2.5 text-[10px] text-[#666] font-bold uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {filtered.map(est => {
            const st = STATUS_BADGE[est.status] || STATUS_BADGE.draft
            const expired = est.valid_until && new Date(est.valid_until) < new Date() && est.status !== 'converted' && est.status !== 'declined'
            return (
              <div key={est.id} onClick={() => setViewingEst(est)}
                className="grid border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA] cursor-pointer"
                style={{gridTemplateColumns:'1.3fr 1.4fr 1fr 1fr 1fr 110px'}}>
                <div className="px-3.5 py-3 font-mono text-[13px] font-bold text-[#5E6AD2]">
                  {est.estimate_number}
                </div>
                <div className="px-3.5 py-3 text-[13px] text-[#1F1F1F] truncate">
                  {est.company_name || '—'}
                </div>
                <div className="px-3.5 py-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{background:st.bg, color:st.color}}>
                    {st.label}
                  </span>
                </div>
                <div className="px-3.5 py-3 text-[12px] text-[#666]">
                  {est.estimate_date ? new Date(est.estimate_date).toLocaleDateString() : '—'}
                </div>
                <div className="px-3.5 py-3 text-[12px]"
                  style={{ color: expired ? '#dc2626' : '#666' }}>
                  {est.valid_until ? new Date(est.valid_until).toLocaleDateString() : '—'}
                  {expired && <span className="ml-1 text-[10px] font-bold">⚠️</span>}
                </div>
                <div className="px-3.5 py-3 text-right font-mono text-[13px] font-bold text-[#1F1F1F]">
                  ${(est.total || 0).toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateEstimateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            qc.invalidateQueries({ queryKey: ['estimates-list'] })
          }}
        />
      )}

      {/* View modal */}
      {viewingEst && (
        <EstimateDetailModal
          estimate={viewingEst}
          onClose={() => setViewingEst(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['estimates-list'] })
            qc.invalidateQueries({ queryKey: ['invoices-list'] })
          }}
        />
      )}
    </div>
  )
}

function FilterTab({ active, onClick, count, highlight, children }) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 rounded-lg text-[13px] font-bold cursor-pointer active:scale-[0.96]"
      style={active
        ? { background:'#5E6AD2', color:'#FFFFFF', border:'none' }
        : { background:'#FFFFFF', color: highlight ? '#5E6AD2' : '#1F1F1F', border:'1px solid #E5E5E5' }}>
      {children} <span className="ml-1 opacity-75">({count})</span>
    </button>
  )
}
