// src/pages/vendors/VendorsPage.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'
import { QWERTYKeyboard, NumericKeypad } from '@/components/ui/TouchKeyboards'
import DualInput from '@/components/ui/DualInput'

const PO_STATUS = {
  draft:     { bg:'#F5F5F5',  color:'#666666' },
  ordered:   { bg:'#eef0fc',  color:'#5E6AD2' },
  partial:   { bg:'#FEF3C7',  color:'#B45309' },
  received:  { bg:'#d1fae5',  color:'#059669' },
  cancelled: { bg:'#FEE2E2',  color:'#dc2626' },
}

export default function VendorsPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [payingPo, setPayingPo] = useState(null)       // PO being paid
  const [detailPo, setDetailPo] = useState(null)        // PO detail popup

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers', tenant?.id, showInactive],
    queryFn: async () => {
      let q = supabase.from('suppliers').select('*').eq('tenant_id', tenant.id)
      if (!showInactive) q = q.eq('is_active', true)
      const { data } = await q.order('name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const { data: pos = [] } = useQuery({
    queryKey: ['purchase-orders', selectedVendor?.id],
    queryFn: async () => {
      const { data } = await supabase.from('purchase_orders')
        .select('*')
        .eq('supplier_id', selectedVendor.id).eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false }).limit(20)
      return data || []
    },
    enabled: !!selectedVendor?.id,
  })

  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) ||
           (s.contact_name || '').toLowerCase().includes(q) ||
           (s.email || '').toLowerCase().includes(q)
  })

  const totalSpend = pos.reduce((sum, p) => sum + (p.total || 0), 0)
  const pending = pos.filter(p => ['ordered', 'partial'].includes(p.status))

  // ── AP (what we owe this vendor) ──
  // A PO counts toward "owed" once it has a balance. Open = still owing,
  // Completed = fully paid. Balance = sum of all outstanding balances.
  const owedBalance = pos.reduce((s, p) => {
    const bal = (p.po_balance_due != null)
      ? Number(p.po_balance_due)
      : Math.max(0, (p.total || 0) - (p.amount_paid || 0))
    return s + bal
  }, 0)
  const openPOs = pos.filter(p => {
    const bal = (p.po_balance_due != null) ? Number(p.po_balance_due) : (p.total || 0) - (p.amount_paid || 0)
    return bal > 0.005 && p.status !== 'cancelled'
  })
  const completedPOs = pos.filter(p => {
    const bal = (p.po_balance_due != null) ? Number(p.po_balance_due) : (p.total || 0) - (p.amount_paid || 0)
    return bal <= 0.005 && p.status !== 'cancelled'
  })

  const handleDeactivate = async (vendor) => {
    const { error } = await supabase.from('suppliers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', vendor.id)
    if (error) { toast.error(error.message); return }
    toast.success(`${vendor.name} deactivated`)
    if (selectedVendor?.id === vendor.id) setSelectedVendor(null)
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }

  const handleReactivate = async (vendor) => {
    const { error } = await supabase.from('suppliers')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', vendor.id)
    if (error) { toast.error(error.message); return }
    toast.success(`${vendor.name} reactivated`)
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }

  const handleDeleteForever = async (vendor) => {
    const { error } = await supabase.from('suppliers').delete().eq('id', vendor.id)
    if (error) {
      toast.error(error.message.includes('violates')
        ? 'Cannot delete: vendor has purchase orders. Deactivate instead.'
        : error.message)
      return
    }
    toast.success(`${vendor.name} permanently deleted`)
    if (selectedVendor?.id === vendor.id) setSelectedVendor(null)
    setConfirmDelete(null)
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }

  return (
    <div className="flex h-full bg-[#FAFAFA]">
      <div className="w-[300px] bg-[#FFFFFF] border-r border-[#E5E5E5] flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-[#E5E5E5] space-y-2">
          <div className="flex items-center gap-2 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3">
            <span className="text-[#999]">🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search vendors..."
              className="bg-transparent border-none outline-none py-2 text-[12px] flex-1"/>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-[#666] cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
              className="cursor-pointer accent-blue-500"/>
            Show inactive vendors
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="p-6 text-center text-[12px] text-[#999]">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-[36px] mb-2 opacity-40">🚚</div>
              <div className="text-[12px] text-[#999] mb-3">
                {search ? 'No vendors match your search' : 'No vendors yet'}
              </div>
              {!search && (
                <button onClick={() => setEditing('new')}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                  style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
                  + Add your first vendor
                </button>
              )}
            </div>
          ) : (
            filtered.map((s) => (
              <div key={s.id} onClick={() => setSelectedVendor(s)}
                className="p-3 rounded-lg cursor-pointer mb-1 transition-all active:scale-[0.99]"
                style={selectedVendor?.id === s.id
                  ? { background:'#eef0fc', border:'1px solid #5E6AD2' }
                  : { background:'#FFFFFF', border:'1px solid transparent' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[14px] font-bold text-white flex-shrink-0"
                    style={{background:'#5E6AD2', opacity: s.is_active ? 1 : 0.4}}>
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate" style={{color: s.is_active ? '#1F1F1F' : '#999'}}>
                      {s.name}
                    </div>
                    <div className="text-[10px] text-[#999] truncate">
                      {s.contact_name || s.email || s.phone || '—'}
                    </div>
                  </div>
                  {!s.is_active && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{background:'#FEE2E2', color:'#dc2626'}}>OFF</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-3 border-t border-[#E5E5E5]">
          <button onClick={() => setEditing('new')}
            className="w-full rounded-lg py-2.5 text-[12px] font-bold cursor-pointer active:scale-[0.98]"
            style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
            + Add Vendor
          </button>
        </div>
      </div>

      {selectedVendor ? (
        <div className="flex-1 overflow-y-auto p-6 bg-[#FAFAFA]">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-[58px] h-[58px] rounded-xl flex items-center justify-center text-[22px] font-bold text-white flex-shrink-0"
              style={{background: selectedVendor.is_active ? '#5E6AD2' : '#999'}}>
              {selectedVendor.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="text-[20px] font-bold text-[#1F1F1F]">{selectedVendor.name}</div>
              <div className="text-[12px] text-[#666] mt-1">
                {[selectedVendor.email, selectedVendor.phone,
                  selectedVendor.city && `${selectedVendor.city}${selectedVendor.state ? ', ' + selectedVendor.state : ''}`
                ].filter(Boolean).join(' · ') || 'No contact info'}
              </div>
              <div className="flex gap-2 mt-2">
                {selectedVendor.payment_terms && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{background:'#FEF3C7', color:'#B45309'}}>{selectedVendor.payment_terms}</span>
                )}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={selectedVendor.is_active
                    ? {background:'#d1fae5', color:'#059669'}
                    : {background:'#FEE2E2', color:'#dc2626'}}>
                  {selectedVendor.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setEditing(selectedVendor)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
                ✏️ Edit
              </button>
              {selectedVendor.is_active ? (
                <button onClick={() => handleDeactivate(selectedVendor)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                  style={{background:'#FFFFFF', color:'#666', border:'1px solid #E5E5E5'}}>
                  Deactivate
                </button>
              ) : (
                <button onClick={() => handleReactivate(selectedVendor)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                  style={{background:'#d1fae5', color:'#059669', border:'1px solid #BBF7D0'}}>
                  ↻ Reactivate
                </button>
              )}
              <button onClick={() => setConfirmDelete(selectedVendor)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#FFFFFF', color:'#dc2626', border:'1px solid #FECACA'}}>
                🗑 Delete
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-6">
            <Stat label="Balance Owed" value={`$${owedBalance.toFixed(2)}`} color={owedBalance > 0 ? '#dc2626' : '#059669'}/>
            <Stat label="Open POs" value={openPOs.length} color={openPOs.length > 0 ? '#F59E0B' : undefined}/>
            <Stat label="Completed POs" value={completedPOs.length} color="#059669"/>
            <Stat label="Total Spent" value={`$${totalSpend.toFixed(0)}`} color="#5E6AD2"/>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <DetailCard title="Contact">
              <DetailRow label="Contact Name" value={selectedVendor.contact_name}/>
              <DetailRow label="Email" value={selectedVendor.email}/>
              <DetailRow label="Phone" value={selectedVendor.phone}/>
              <DetailRow label="Address" value={
                [selectedVendor.address, selectedVendor.city, selectedVendor.state, selectedVendor.zip]
                  .filter(Boolean).join(', ')
              }/>
            </DetailCard>
            <DetailCard title="Terms & Notes">
              <DetailRow label="Payment Terms" value={selectedVendor.payment_terms}/>
              <DetailRow label="Notes" value={selectedVendor.notes} multiline/>
            </DetailCard>
          </div>

          <div className="mb-2 flex justify-between items-center">
            <div className="text-[14px] font-bold text-[#1F1F1F]">📋 Purchase Orders</div>
          </div>

          {pos.length === 0 ? (
            <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-center py-10 text-[12px] text-[#999]">
              <div className="text-[36px] mb-2 opacity-30">📋</div>
              No purchase orders yet
            </div>
          ) : (
            <div className="space-y-4">
              {/* Open POs (still owing) */}
              <POGroup
                title="🟠 Open · Owing"
                pos={openPOs}
                empty="No open balances — all paid up!"
                onPay={(po) => setPayingPo(po)}
                onDetail={(po) => setDetailPo(po)}
              />
              {/* Completed POs (fully paid) */}
              <POGroup
                title="✅ Completed · Paid"
                pos={completedPOs}
                empty="No completed POs yet"
                onPay={null}
                onDetail={(po) => setDetailPo(po)}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[#FAFAFA]">
          <div className="text-center">
            <div className="text-[60px] mb-4 opacity-20">🚚</div>
            <div className="text-[14px] text-[#666] mb-1">Select a vendor to view details</div>
            <div className="text-[12px] text-[#999]">or</div>
            <button onClick={() => setEditing('new')}
              className="mt-2 rounded-lg px-4 py-2 text-[13px] font-bold cursor-pointer active:scale-[0.96]"
              style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
              + Add Your First Vendor
            </button>
          </div>
        </div>
      )}

      {editing && (
        <VendorFormModal
          vendor={editing === 'new' ? null : editing}
          tenantId={tenant.id}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: ['suppliers'] })
            if (saved) setSelectedVendor(saved)
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          vendor={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => handleDeleteForever(confirmDelete)}
        />
      )}

      {payingPo && (
        <PayVendorModal
          po={payingPo}
          vendor={selectedVendor}
          tenantId={tenant.id}
          onClose={() => setPayingPo(null)}
          onPaid={() => {
            setPayingPo(null)
            qc.invalidateQueries({ queryKey: ['purchase-orders'] })
            qc.invalidateQueries({ queryKey: ['vendor-payments'] })
          }}
        />
      )}

      {detailPo && (
        <PODetailPopup
          po={detailPo}
          tenantId={tenant.id}
          onClose={() => setDetailPo(null)}
        />
      )}
    </div>
  )
}

// ── PO group (Open / Completed) ──
function POGroup({ title, pos, empty, onPay, onDetail }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider mb-1.5">{title} ({pos.length})</div>
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
        {pos.length === 0 ? (
          <div className="text-center py-6 text-[11px] text-[#999]">{empty}</div>
        ) : pos.map(po => {
          const total = po.total || 0
          const paid  = po.amount_paid || 0
          const bal   = (po.po_balance_due != null) ? Number(po.po_balance_due) : Math.max(0, total - paid)
          return (
            <div key={po.id} className="flex items-center gap-3 px-3.5 py-3 border-b border-[#E5E5E5] last:border-0 hover:bg-[#FAFAFA]">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[12px] font-bold text-[#5E6AD2]">{po.po_number}</div>
                <div className="text-[10px] text-[#999]">
                  {po.created_at ? new Date(po.created_at).toLocaleDateString() : ''}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[12px] text-[#1F1F1F]">Total ${total.toFixed(2)}</div>
                <div className="text-[10px] text-[#059669]">Paid ${paid.toFixed(2)}</div>
              </div>
              <div className="text-right w-[90px]">
                <div className="text-[9px] text-[#999] uppercase">Balance</div>
                <div className="font-mono text-[13px] font-bold" style={{color: bal > 0.005 ? '#dc2626' : '#059669'}}>
                  ${bal.toFixed(2)}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => onDetail(po)}
                  className="rounded px-2.5 py-1.5 text-[10px] font-bold cursor-pointer"
                  style={{background:'#F5F5F5', color:'#666', border:'1px solid #E5E5E5'}}>Detail</button>
                {onPay && bal > 0.005 && (
                  <button onClick={() => onPay(po)}
                    className="rounded px-2.5 py-1.5 text-[10px] font-bold cursor-pointer"
                    style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>💵 Pay</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Pay vendor modal: amount + method + remark, auto timestamp ──
const PAY_METHODS = [
  { id:'cash',     label:'Cash' },
  { id:'check',    label:'Check' },
  { id:'card',     label:'Card' },
  { id:'transfer', label:'Transfer' },
  { id:'other',    label:'Other' },
]
function PayVendorModal({ po, vendor, tenantId, onClose, onPaid }) {
  const { user } = useAuthStore()
  const total = po.total || 0
  const paid  = po.amount_paid || 0
  const bal   = (po.po_balance_due != null) ? Number(po.po_balance_due) : Math.max(0, total - paid)
  const [amount, setAmount] = useState(bal.toFixed(2))
  const [method, setMethod] = useState('cash')
  const [remark, setRemark] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast.error('Enter an amount'); return }
    if (amt > bal + 0.005) {
      if (!confirm(`Paying $${amt.toFixed(2)} is more than the $${bal.toFixed(2)} balance. Continue?`)) return
    }
    setSaving(true)
    const { data, error } = await supabase.rpc('fn_pay_vendor_po', {
      p_tenant_id:   tenantId,
      p_supplier_id: vendor.id,
      p_po_id:       po.id,
      p_amount:      amt,
      p_method:      method,
      p_remark:      remark || null,
      p_user_id:     user?.id || null,
    })
    setSaving(false)
    if (error || !data?.success) {
      toast.error(error?.message || data?.message || 'Payment failed')
      return
    }
    toast.success(`✓ Recorded $${amt.toFixed(2)} payment`)
    onPaid()
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}} onClick={onClose}>
      <div className="bg-white rounded-2xl overflow-hidden shadow-2xl w-full max-w-[420px]" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between" style={{background:'#5E6AD2'}}>
          <div>
            <div className="text-[12px] text-white/70">Pay {vendor?.name}</div>
            <div className="text-[15px] font-bold text-white font-mono">{po.po_number}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white text-[16px]">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {/* Balance summary */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg py-2" style={{background:'#F5F5F5'}}>
              <div className="text-[9px] text-[#999] uppercase">Total</div>
              <div className="font-mono text-[13px] font-bold">${total.toFixed(2)}</div>
            </div>
            <div className="rounded-lg py-2" style={{background:'#d1fae5'}}>
              <div className="text-[9px] text-[#059669] uppercase">Paid</div>
              <div className="font-mono text-[13px] font-bold text-[#059669]">${paid.toFixed(2)}</div>
            </div>
            <div className="rounded-lg py-2" style={{background:'#FEE2E2'}}>
              <div className="text-[9px] text-[#dc2626] uppercase">Balance</div>
              <div className="font-mono text-[13px] font-bold text-[#dc2626]">${bal.toFixed(2)}</div>
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase mb-1">Payment Amount</div>
            <div className="flex items-center rounded-xl px-3" style={{border:'1.5px solid #E5E5E5'}}>
              <span className="text-[#999] mr-1 text-[16px]">$</span>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g,''))}
                inputMode="decimal"
                className="flex-1 border-none outline-none py-2.5 text-[16px] font-mono font-bold bg-transparent"/>
            </div>
          </div>

          {/* Method */}
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase mb-1">Payment Type</div>
            <div className="grid grid-cols-3 gap-1.5">
              {PAY_METHODS.map(m => (
                <button key={m.id} onClick={() => setMethod(m.id)}
                  className="rounded-lg py-2 text-[12px] font-bold cursor-pointer border-2"
                  style={method===m.id
                    ? {background:'#eef0fc', borderColor:'#5E6AD2', color:'#5E6AD2'}
                    : {background:'#fff', borderColor:'#E5E5E5', color:'#666'}}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Remark */}
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase mb-1">Remark (optional)</div>
            <input value={remark} onChange={e => setRemark(e.target.value)}
              placeholder="e.g. check #1234, partial payment"
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none" style={{border:'1.5px solid #E5E5E5'}}/>
          </div>

          <div className="text-[10px] text-[#999]">🕐 Payment time is recorded automatically.</div>
        </div>
        <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#fff', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold text-white cursor-pointer disabled:opacity-40"
            style={{background:'#059669', border:'none'}}>
            {saving ? 'Saving...' : `✓ Record Payment`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PO detail popup: line items + payment history ──
function PODetailPopup({ po, tenantId, onClose }) {
  const { data: items = [] } = useQuery({
    queryKey: ['po-items', po.id],
    queryFn: async () => {
      const { data } = await supabase.from('purchase_order_items')
        .select('*').eq('po_id', po.id).order('created_at')
      return data || []
    },
    enabled: !!po.id,
  })
  const { data: payments = [] } = useQuery({
    queryKey: ['vendor-payments', po.id],
    queryFn: async () => {
      const { data } = await supabase.from('vendor_payments')
        .select('*').eq('po_id', po.id).order('paid_at', { ascending: false })
      return data || []
    },
    enabled: !!po.id,
  })

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.5)'}} onClick={onClose}>
      <div className="bg-white rounded-2xl overflow-hidden shadow-2xl w-full max-w-[560px]" style={{maxHeight:'85vh'}} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between border-b border-[#E5E5E5]">
          <div className="font-mono text-[15px] font-bold text-[#5E6AD2]">{po.po_number}</div>
          <button onClick={onClose} className="w-8 h-8 rounded-full border-none cursor-pointer text-[16px]" style={{background:'#F5F5F5', color:'#666'}}>✕</button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5" style={{maxHeight:'calc(85vh - 60px)'}}>
          {/* Items */}
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase mb-2">Items</div>
            <div className="border border-[#E5E5E5] rounded-xl overflow-hidden">
              {items.length === 0 ? (
                <div className="text-center py-4 text-[11px] text-[#999]">No items</div>
              ) : items.map(it => (
                <div key={it.id} className="flex justify-between px-3 py-2 border-b border-[#E5E5E5] last:border-0 text-[12px]">
                  <span className="font-bold text-[#1F1F1F]">{it.product_name}</span>
                  <span className="font-mono text-[#666]">{it.quantity} × ${(it.unit_cost||0).toFixed(2)} = ${((it.quantity||0)*(it.unit_cost||0)).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Payment history */}
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase mb-2">Payment History</div>
            <div className="border border-[#E5E5E5] rounded-xl overflow-hidden">
              {payments.length === 0 ? (
                <div className="text-center py-4 text-[11px] text-[#999]">No payments yet</div>
              ) : payments.map(p => (
                <div key={p.id} className="flex justify-between items-center px-3 py-2 border-b border-[#E5E5E5] last:border-0 text-[12px]">
                  <div>
                    <span className="font-mono font-bold text-[#059669]">${(p.amount||0).toFixed(2)}</span>
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold" style={{background:'#eef0fc', color:'#5E6AD2'}}>{p.method}</span>
                    {p.remark && <span className="ml-2 text-[#999]">{p.remark}</span>}
                  </div>
                  <span className="text-[10px] text-[#999]">{new Date(p.paid_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg p-3">
      <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-[20px] font-bold" style={{color: color || '#1F1F1F'}}>{value}</div>
    </div>
  )
}

function DetailCard({ title, children }) {
  return (
    <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-4">
      <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  )
}

function DetailRow({ label, value, multiline }) {
  if (multiline) {
    return (
      <div className="mb-2 last:mb-0">
        <div className="text-[10px] text-[#999] mb-1">{label}</div>
        <div className="text-[12px] text-[#1F1F1F] whitespace-pre-wrap">{value || '—'}</div>
      </div>
    )
  }
  return (
    <div className="flex justify-between gap-3 mb-2 last:mb-0">
      <span className="text-[11px] text-[#999] flex-shrink-0">{label}</span>
      <span className="text-[12px] font-semibold text-[#1F1F1F] text-right truncate">{value || '—'}</span>
    </div>
  )
}

function VendorFormModal({ vendor, tenantId, onClose, onSaved }) {
  const isNew = !vendor
  const [form, setForm] = useState({
    name:           vendor?.name           || '',
    contact_name:   vendor?.contact_name   || '',
    email:          vendor?.email          || '',
    phone:          vendor?.phone          || '',
    address:        vendor?.address        || '',
    city:           vendor?.city           || '',
    state:          vendor?.state          || '',
    zip:            vendor?.zip            || '',
    payment_terms:  vendor?.payment_terms  || '',
    notes:          vendor?.notes          || '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { toast.error('Vendor name is required'); return }
    setSaving(true)
    const payload = { ...form, tenant_id: tenantId, updated_at: new Date().toISOString() }
    let result
    if (isNew) {
      result = await supabase.from('suppliers').insert(payload).select().single()
    } else {
      result = await supabase.from('suppliers').update(payload).eq('id', vendor.id).select().single()
    }
    setSaving(false)
    if (result.error) { toast.error(result.error.message); return }
    toast.success(isNew ? `${form.name} added` : `${form.name} updated`)
    onSaved(result.data)
  }

  const isCustomTerms = form.payment_terms && !['Net 15','Net 30','Net 60','COD'].includes(form.payment_terms)

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        width:'520px', maxWidth:'100%', maxHeight:'92vh', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
      }}>
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">
              {isNew ? 'New Vendor' : 'Edit Vendor'}
            </div>
            <div className="text-[16px] font-bold text-[#1F1F1F]">{form.name || 'Untitled'}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <DualInput label="Vendor Name" required autoFocus
            value={form.name} onChange={v => set('name', v)}
            placeholder="e.g. Acme Foods"/>

          <DualInput label="Contact Person"
            value={form.contact_name} onChange={v => set('contact_name', v)}
            placeholder="e.g. John Smith"/>

          <div className="grid grid-cols-2 gap-3">
            <DualInput label="Email" mode="email"
              value={form.email} onChange={v => set('email', v)}
              placeholder="vendor@example.com"/>
            <DualInput label="Phone" mode="phone"
              value={form.phone} onChange={v => set('phone', v)}
              placeholder="(555) 123-4567"/>
          </div>

          <DualInput label="Street Address"
            value={form.address} onChange={v => set('address', v)}
            placeholder="123 Main St"/>

          <div className="grid grid-cols-3 gap-3">
            <DualInput label="City"
              value={form.city} onChange={v => set('city', v)}/>
            <DualInput label="State"
              value={form.state} onChange={v => set('state', v)}/>
            <DualInput label="ZIP" mode="numeric"
              value={form.zip} onChange={v => set('zip', v)}/>
          </div>

          <div>
            <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Payment Terms</div>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {['Net 15', 'Net 30', 'Net 60', 'COD'].map(t => (
                <button key={t} type="button" onClick={() => set('payment_terms', form.payment_terms === t ? '' : t)}
                  className="px-2 py-2 rounded-lg text-[11px] font-bold cursor-pointer active:scale-[0.96]"
                  style={form.payment_terms === t
                    ? { background:'#eef0fc', color:'#5E6AD2', border:'1px solid #5E6AD2' }
                    : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
                  {t}
                </button>
              ))}
            </div>
            <DualInput
              value={isCustomTerms ? form.payment_terms : ''}
              onChange={v => set('payment_terms', v)}
              placeholder="Or type custom terms..."
              kbTitle="Custom Payment Terms"/>
          </div>

          <DualInput label="Notes" multiline
            value={form.notes} onChange={v => set('notes', v)}
            placeholder="Any extra info about this vendor..."/>
        </div>

        <div className="px-5 py-4 flex gap-2 flex-shrink-0" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving || !form.name.trim()}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
            style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
            {saving ? 'Saving...' : (isNew ? 'Add Vendor' : 'Save Changes')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDeleteModal({ vendor, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.55)'}}>
      <div className="rounded-2xl overflow-hidden" style={{
        width:'420px', maxWidth:'100%', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
      }}>
        <div className="p-5 text-center">
          <div className="text-[44px] mb-3">⚠️</div>
          <div className="text-[16px] font-bold text-[#1F1F1F] mb-1">Permanently delete vendor?</div>
          <div className="text-[13px] text-[#666] mb-3">
            <span className="font-bold">{vendor.name}</span> will be deleted forever. This cannot be undone.
          </div>
          <div className="rounded-lg px-3 py-2.5 text-[11px] mb-4"
            style={{background:'#FEF3C7', color:'#B45309', border:'1px solid #FCD34D'}}>
            💡 Tip: If this vendor has past purchase orders, deletion will fail.<br/>
            Use <strong>Deactivate</strong> instead — it hides from lists but keeps records.
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onCancel}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer text-white"
            style={{background:'#dc2626', border:'none'}}>
            🗑 Delete Forever
          </button>
        </div>
      </div>
    </div>
  )
}
