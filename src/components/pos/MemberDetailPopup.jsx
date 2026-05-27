// src/components/pos/MemberDetailPopup.jsx
// In-POS member detail view. Opens over the POS, closes back to it
// without touching cart state. Read-only summary + recent activity, so
// the cashier can verify who they're serving without leaving POS.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export default function MemberDetailPopup({ customer, tenantId, onClose, onEdit }) {
  if (!customer) return null

  // Recent purchases (last 10) and recent top-ups (last 10) for context
  const { data: orders = [] } = useQuery({
    queryKey: ['member-detail-orders', customer.id],
    queryFn: async () => {
      const { data } = await supabase.from('orders')
        .select('id, order_number, total, status, refund_status, created_at')
        .eq('tenant_id', tenantId).eq('customer_id', customer.id)
        .order('created_at', { ascending: false }).limit(10)
      return data || []
    },
    enabled: !!customer?.id && !!tenantId,
  })
  const { data: topups = [] } = useQuery({
    queryKey: ['member-detail-topups', customer.id],
    queryFn: async () => {
      const { data } = await supabase.from('customer_topups')
        .select('id, amount, paid_amount, bonus_amount, balance_after, method, created_at')
        .eq('tenant_id', tenantId).eq('customer_id', customer.id)
        .order('created_at', { ascending: false }).limit(10)
      return data || []
    },
    enabled: !!customer?.id && !!tenantId,
  })

  const fmtDate = (d) => new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
  const fmtDateTime = (d) => new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{background:'rgba(0,0,0,0.55)'}}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rounded-2xl overflow-hidden shadow-xl flex flex-col w-[680px] max-w-[96vw] max-h-[90vh]"
        style={{background:'#fff'}}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{background:'#000', color:'#fff'}}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-[18px] font-black flex-shrink-0"
              style={{background:'rgba(255,255,255,0.18)'}}>
              {(customer.name||'?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-[16px] font-bold truncate">{customer.name}</div>
              <div className="text-[11px] text-white/70">
                {customer.phone || customer.email || '—'}
                {customer.code ? ` · ${customer.code}` : ''}
                {customer.is_active === false ? ' · INACTIVE' : ''}
              </div>
            </div>
          </div>
          <button onClick={onClose} title="Back to POS"
            className="w-9 h-9 rounded-full bg-white/20 border-none cursor-pointer text-white text-[18px] flex items-center justify-center flex-shrink-0">✕</button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-px flex-shrink-0" style={{background:'#f1f5f9'}}>
          {[
            ['Card Balance',  customer.card_balance > 0 ? `$${Number(customer.card_balance).toFixed(2)}` : '—', '#16a34a'],
            ['Loyalty Points', customer.loyalty_points || 0, '#7c3aed'],
            ['Credit / Owes', customer.credit_balance > 0 ? `$${Number(customer.credit_balance).toFixed(2)}` : '—', '#dc2626'],
            ['Card #',         customer.card_number || '—', '#0f172a'],
          ].map(([l,v,c]) => (
            <div key={l} className="p-3" style={{background:'#fff'}}>
              <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400">{l}</div>
              <div className="text-[16px] font-bold mt-0.5 font-mono" style={{color:c}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{background:'#fafafa'}}>

          {/* Member profile */}
          <div className="rounded-xl p-4" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2">Profile</div>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[12px]">
              {[
                ['Phone', customer.phone],
                ['Email', customer.email],
                ['Member Level', customer.member_level],
                ['Member Since', customer.member_since ? fmtDate(customer.member_since) : null],
                ['Birthday', customer.birthday ? fmtDate(customer.birthday) : null],
                ['Gender', customer.gender],
                ['Card Expires', customer.card_expire_date ? fmtDate(customer.card_expire_date) : null],
                ['Tier', customer.tier],
              ].filter(([_,v])=>v).map(([l,v]) => (
                <div key={l} className="flex justify-between gap-3">
                  <span className="text-slate-500">{l}</span>
                  <span className="font-semibold text-slate-800 text-right">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent orders */}
          <div className="rounded-xl overflow-hidden" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
            <div className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-slate-500"
              style={{background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>
              Recent Purchases ({orders.length})
            </div>
            {orders.length === 0 ? (
              <div className="px-4 py-4 text-[12px] text-slate-400 text-center">No purchases yet</div>
            ) : orders.map(o => (
              <div key={o.id} className="px-4 py-2.5 flex items-center justify-between border-b border-slate-100 last:border-0">
                <div className="min-w-0">
                  <div className="text-[12px] font-bold">{o.order_number}</div>
                  <div className="text-[10px] text-slate-400">{fmtDateTime(o.created_at)} · {o.status}{o.refund_status ? ` · ${o.refund_status}` : ''}</div>
                </div>
                <div className="text-[13px] font-mono font-bold flex-shrink-0">${Number(o.total||0).toFixed(2)}</div>
              </div>
            ))}
          </div>

          {/* Recent top-ups */}
          {topups.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
              <div className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-slate-500"
                style={{background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>
                Card Activity ({topups.length})
              </div>
              {topups.map(t => (
                <div key={t.id} className="px-4 py-2.5 flex items-center justify-between border-b border-slate-100 last:border-0">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold">
                      {Number(t.amount) >= 0 ? `+$${Number(t.amount).toFixed(2)} loaded` : `−$${Math.abs(t.amount).toFixed(2)} reversed`}
                      {Number(t.bonus_amount||0) > 0 && <span className="text-[#d97706] ml-1.5">(+${Number(t.bonus_amount).toFixed(2)} bonus)</span>}
                    </div>
                    <div className="text-[10px] text-slate-400">{fmtDateTime(t.created_at)} · {t.method}</div>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 flex-shrink-0">bal ${Number(t.balance_after||0).toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex items-center gap-2 flex-shrink-0" style={{borderTop:'1px solid #e2e8f0', background:'#fff'}}>
          <button onClick={onClose}
            className="flex-1 rounded-xl py-3 text-[13px] font-bold cursor-pointer border-2"
            style={{background:'#fff', borderColor:'#cbd5e1', color:'#475569'}}>
            ← Back to POS
          </button>
          {onEdit && (
            <button onClick={onEdit}
              className="rounded-xl px-5 py-3 text-[13px] font-bold cursor-pointer border-none text-white"
              style={{background:'#006AFF'}}>
              ✎ Edit Member
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
