// src/pages/orders/OrderLookupPage.jsx
import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import { useHeldOrdersStore } from '@/stores/heldOrdersStore'
import ManagerOverrideModal from '@/components/pos/ManagerOverrideModal'
import { logOverride } from '@/lib/auditOverride'
import { useCartStore } from '@/stores/cartStore'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import toast from 'react-hot-toast'

// ── Status ──
const STATUS = {
  completed:     { label:'Completed',      bg:'#dcfce7', color:'#16a34a' },
  held:          { label:'On Hold',        bg:'#fef9c3', color:'#ca8a04' },
  voided:        { label:'Voided',         bg:'#f1f5f9', color:'#64748b' },
  refunded:      { label:'Refunded',       bg:'#fdf4ff', color:'#006AFF' },
  partial_refund:{ label:'Part. Refunded', bg:'#eff6ff', color:'#2563eb' },
}
function getStatus(o) {
  if (o._source==='held')           return 'held'
  if (o.status==='voided')          return 'voided'
  if (o.refund_status==='full')     return 'refunded'
  if (o.refund_status==='partial')  return 'partial_refund'
  return 'completed'
}

// ── Payment method icons ──
const PAY_ICON = {
  cash:'💵', card:'💳', credit_card:'💳', debit_card:'💳',
  member_card:'🏷️', vip_card:'🏷️', gift_card:'🎁',
  bank_transfer:'🏦', check:'📝', other:'💰',
}
const PAY_LABEL = {
  cash:'Cash', card:'Card', credit_card:'Credit Card', debit_card:'Debit Card',
  member_card:'VIP Card', vip_card:'VIP Card', gift_card:'Gift Card',
  bank_transfer:'Transfer', check:'Check', other:'Other',
}

// ── Payment filter groups ──
const PAY_FILTERS = [
  { id:'all',         label:'All',          icon:'📋' },
  { id:'cash',        label:'Cash',         icon:'💵' },
  { id:'card',        label:'Card',         icon:'💳' },
  { id:'member_card', label:'VIP Card',     icon:'🏷️' },
  { id:'gift_card',   label:'Gift Card',    icon:'🎁' },
  { id:'other',       label:'Other',        icon:'💰' },
]

const STATUS_FILTERS = [
  { id:'all',          label:'All' },
  { id:'completed',    label:'Paid' },
  { id:'held',         label:'Hold' },
  { id:'refunded',     label:'Refund' },
  { id:'partial_refund',label:'Part. Refund' },
  { id:'voided',       label:'Void' },
]

// ── Order Actions Component ──
function OrderActions({ order, tenantId, userId, onResume, onCancelHeld, onVoid, onRefund }) {
  const [addNote, setAddNote] = useState(false)
  const [note,    setNote]    = useState(order.staff_note || '')
  const [saving,  setSaving]  = useState(false)

  const st         = order._source === 'held' ? 'held' : (() => {
    if (order.status === 'voided')         return 'voided'
    if (order.refund_status === 'full')    return 'refunded'
    if (order.refund_status === 'partial') return 'partial_refund'
    if (order.status === 'needs_recharge') return 'needs_recharge'
    return 'completed'
  })()

  const payMethods  = (order.order_payments||[]).map(p => p.method)
  const hasCard     = payMethods.some(m => ['card','credit_card','debit_card'].includes(m))
  const hasCash     = payMethods.includes('cash')
  const hasMember   = payMethods.some(m => ['member_card','vip_card'].includes(m))
  const hasGift     = payMethods.includes('gift_card')
  const isSplit     = payMethods.length > 1

  const cardTxStatus = order.card_transactions?.[0]?.status
  const batchOpen    = cardTxStatus === 'authorized'
  const batchClosed  = cardTxStatus === 'settled'
  const batchUnknown = !cardTxStatus

  const saveNote = async () => {
    setSaving(true)
    const { error } = await supabase.from('orders').update({ staff_note: note }).eq('id', order.id)
    setSaving(false); setAddNote(false)
    if (error) { toast.error(`Couldn't save note: ${error.message}`); return }
    toast.success('Note saved')
  }

  return (
    <div className="flex flex-col gap-2 mt-3">

      {/* ── ON HOLD ── */}
      {st === 'held' && <>
        <div className="rounded-xl p-2.5 text-[11px] font-semibold text-center"
          style={{background:'#fffbeb', color:'#ca8a04', border:'1px solid #fde047'}}>
          📌 On Hold — resume to add/remove items
        </div>
        <button onClick={() => onResume(order)}
          className="w-full rounded-xl py-3 text-[13px] font-bold text-white cursor-pointer border-none"
          style={{background:'#006AFF'}}>
          ↩ Resume & Go to POS
        </button>
        <button onClick={onCancelHeld}
          className="w-full rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border"
          style={{background:'#fff1f2',borderColor:'#fca5a5',color:'#dc2626'}}>
          🗑 Cancel Held Order
        </button>
      </>}

      {/* ── NEEDS RECHARGE ── */}
      {st === 'needs_recharge' && <>
        <div className="rounded-xl p-3 text-[11px]"
          style={{background:'#fef2f2',border:'1px solid #fca5a5',color:'#dc2626'}}>
          <div className="font-bold mb-1">⚠️ Payment Incomplete</div>
          <div>Terminal disconnected mid-payment. Verify with PAX terminal before taking action.</div>
        </div>
        <button onClick={onVoid}
          className="w-full rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border"
          style={{background:'#fff1f2',borderColor:'#fca5a5',color:'#dc2626'}}>
          🚫 Void Incomplete Order
        </button>
        <button onClick={() => onResume(order)}
          className="w-full rounded-xl py-2.5 text-[12px] font-bold text-white cursor-pointer border-none"
          style={{background:'#000000'}}>
          🔄 Retry Payment in POS
        </button>
      </>}

      {/* ── COMPLETED ── */}
      {st === 'completed' && <>

        {/* Split payment notice */}
        {isSplit && (
          <div className="rounded-xl p-2.5 text-[10px]"
            style={{background:'#eff6ff',border:'1px solid #bfdbfe',color:'#2563eb'}}>
            💳 Split payment — all methods will be reversed on void/refund
          </div>
        )}

        {/* Card batch status */}
        {hasCard && (
          <div className="rounded-xl p-2.5 text-[11px]"
            style={{background: batchOpen?'#fffbeb':batchClosed?'#fef2f2':'#f8fafc',
                    border:`1px solid ${batchOpen?'#fde047':batchClosed?'#fca5a5':'#e2e8f0'}`}}>
            <div className="flex items-center gap-1.5 font-semibold"
              style={{color:batchOpen?'#ca8a04':batchClosed?'#dc2626':'#64748b'}}>
              💳 {batchOpen ? '🟡 Batch Open — void available'
                : batchClosed ? '🔴 Batch Closed — refund only'
                : '⚪ Batch status unknown — check terminal'}
            </div>
          </div>
        )}

        {/* Member card notice */}
        {hasMember && (
          <div className="rounded-xl p-2.5 text-[10px]"
            style={{background:'#fdf4ff',border:'1px solid #e9d5ff',color:'#006AFF'}}>
            🏷️ VIP Card payment — balance will be restored on void/refund
          </div>
        )}

        {/* Gift card notice */}
        {hasGift && (
          <div className="rounded-xl p-2.5 text-[10px]"
            style={{background:'#fff7ed',border:'1px solid #fed7aa',color:'#ea580c'}}>
            🎁 Gift Card payment — value will be restored on void/refund
          </div>
        )}

        {/* VOID — only if batch open or cash/member/gift */}
        {(!hasCard || batchOpen || batchUnknown) && (
          <button onClick={onVoid}
            className="w-full rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border"
            style={{background:'#fff1f2',borderColor:'#fca5a5',color:'#dc2626'}}>
            🚫 Void Order {hasCard && batchOpen ? '+ Void Card Auth' : ''}
          </button>
        )}

        {/* REFUND */}
        <button onClick={onRefund}
          className="w-full rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border"
          style={{background:'#fdf4ff',borderColor:'#e9d5ff',color:'#006AFF'}}>
          ↩ {batchClosed ? 'Process Card Refund' : 'Process Refund'}
        </button>
      </>}

      {/* ── PARTIAL REFUNDED ── */}
      {st === 'partial_refund' && <>
        <div className="rounded-xl p-2.5 text-[10px] font-semibold text-center"
          style={{background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe'}}>
          🔵 Partial Refund — more items can still be returned
        </div>
        {hasCard && (
          <div className="rounded-xl p-2.5 text-[10px]"
            style={{background: batchClosed?'#fef2f2':'#fffbeb',
                    border:`1px solid ${batchClosed?'#fca5a5':'#fde047'}`,
                    color: batchClosed?'#dc2626':'#ca8a04'}}>
            💳 {batchClosed ? '🔴 Batch Closed — card refund to original card' : '🟡 Batch Open — can void remaining'}
          </div>
        )}
        <button onClick={onRefund}
          className="w-full rounded-xl py-2.5 text-[12px] font-bold cursor-pointer border"
          style={{background:'#eff6ff',borderColor:'#bfdbfe',color:'#2563eb'}}>
          ↩ Continue Refund
        </button>
      </>}

      {/* ── FULLY REFUNDED ── */}
      {st === 'refunded' && (
        <div className="rounded-xl p-3 text-center text-[11px]"
          style={{background:'#fdf4ff',border:'1px solid #e9d5ff',color:'#006AFF'}}>
          🟣 Fully Refunded
          {order.refunded_at && (
            <div className="text-[10px] text-slate-400 mt-1">
              {format(new Date(order.refunded_at),'MMM d, h:mm a')} · by {order.refunded_by_name}
            </div>
          )}
          {order.refunded_approved_by_name && (
            <div className="text-[10px] mt-1" style={{color:'#9333ea'}}>
              🔐 Approved by <b>{order.refunded_approved_by_name}</b>
            </div>
          )}
        </div>
      )}

      {/* ── VOIDED ── */}
      {st === 'voided' && (
        <div className="rounded-xl p-3 text-center text-[11px]"
          style={{background:'#f1f5f9',border:'1px solid #e2e8f0',color:'#64748b'}}>
          🚫 Order Voided — no further action available
          {order.voided_at && (
            <div className="text-[10px] text-slate-400 mt-1">
              {format(new Date(order.voided_at),'MMM d, h:mm a')} · by {order.voided_by_name}
            </div>
          )}
          {order.voided_approved_by_name && (
            <div className="text-[10px] mt-1" style={{color:'#9333ea'}}>
              🔐 Approved by <b>{order.voided_approved_by_name}</b>
            </div>
          )}
        </div>
      )}

      {/* ── REPRINT (all completed/refunded) ── */}
      {['completed','refunded','partial_refund','voided'].includes(st) && (
        <button onClick={() => window.print()}
          className="w-full rounded-xl py-2 text-[11px] font-semibold cursor-pointer border"
          style={{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
          🖨️ Reprint Receipt
        </button>
      )}

      {/* ── ADD NOTE ── */}
      {!addNote ? (
        <button onClick={() => setAddNote(true)}
          className="w-full rounded-xl py-2 text-[11px] font-semibold cursor-pointer border"
          style={{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
          📝 {order.staff_note ? 'Edit Note' : 'Add Note'}
        </button>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{border:'1.5px solid #80B2FF'}}>
          <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2}
            placeholder="Add internal note..."
            className="w-full px-3 py-2 text-[12px] outline-none resize-none border-none"
            style={{background:'#f8f9ff'}}/>
          <div className="flex gap-2 px-3 pb-2">
            <button onClick={() => setAddNote(false)}
              className="flex-1 rounded-lg py-1.5 text-[11px] cursor-pointer border"
              style={{background:'#fff',borderColor:'#e2e8f0',color:'#64748b'}}>Cancel</button>
            <button onClick={saveNote} disabled={saving}
              className="flex-1 rounded-lg py-1.5 text-[11px] font-bold text-white cursor-pointer border-none"
              style={{background:'#006AFF'}}>
              {saving?'Saving...':'✓ Save Note'}
            </button>
          </div>
        </div>
      )}
      {order.staff_note && !addNote && (
        <div className="rounded-xl px-3 py-2 text-[10px]"
          style={{background:'#fffbeb',border:'1px solid #fde047',color:'#92400e'}}>
          📝 {order.staff_note}
        </div>
      )}
    </div>
  )
}


export default function OrderLookupPage() {
  const { tenant, user, can } = useAuthStore()
  const { activeEmployee } = useEmployeeStore()
  const effCashierId   = activeEmployee?.id   || user?.id
  const effCashierName = activeEmployee?.name || user?.name
  const { resumeHeldOrder, cancelHeldOrder } = useHeldOrdersStore()
  const qc = useQueryClient()
  const [override, setOverride] = useState(null)

  const guard = (permission, actionLabel, fn, extra = {}) => {
    const v = can(permission)
    if (v === 'allow') return fn(null)
    if (v === 'prompt') {
      setOverride({
        permission, action: actionLabel,
        onApprove: (approver) => {
          toast.success(`✓ Approved by ${approver.name}`)
          logOverride({
            tenantId: tenant?.id,
            permission, actionLabel,
            requestedBy: activeEmployee
              ? { id: activeEmployee.id, name: activeEmployee.name }
              : { id: user?.id, name: user?.name },
            approver,
            orderId: extra.orderId,
            orderNumber: extra.orderNumber,
            amount: extra.amount,
          })
          fn(approver)
        },
      })
      return
    }
    toast.error(`You don't have permission to ${actionLabel}`)
  }

  const [search,     setSearch]     = useState('')
  const [statusF,    setStatusF]    = useState('all')
  const [payF,       setPayF]       = useState('all')
  const [cashierF,   setCashierF]   = useState('all')
  const [dateMode,   setDateMode]   = useState('today') // today|3days|week|month|custom
  const [dateFrom,   setDateFrom]   = useState(format(new Date(),'yyyy-MM-dd'))
  const [dateTo,     setDateTo]     = useState(format(new Date(),'yyyy-MM-dd'))
  const [selected,   setSelected]   = useState(null)

  // Employees for the filter dropdown
  const { data: allEmployees = [] } = useQuery({
    queryKey: ['employees-list', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, name, role').eq('tenant_id', tenant.id)
        .order('name')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // Compute date range
  const range = (() => {
    const now = new Date()
    if (dateMode === 'today')  return [startOfDay(now), endOfDay(now)]
    if (dateMode === '3days')  return [startOfDay(subDays(now,3)), endOfDay(now)]
    if (dateMode === 'week')   return [startOfDay(subDays(now,7)), endOfDay(now)]
    if (dateMode === 'month')  return [startOfDay(subDays(now,30)), endOfDay(now)]
    if (dateMode === 'custom') return [startOfDay(new Date(dateFrom)), endOfDay(new Date(dateTo))]
    return [null, null]
  })()

  // ── Orders query ──
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders-lookup', tenant?.id, search, statusF, payF, cashierF, dateMode, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase.from('orders')
        .select(`*, customers(name,phone), users(name), terminals(name),
          order_items(product_name,quantity,unit,unit_price,line_total),
          order_payments(method,amount)`)
        .eq('tenant_id', tenant.id)
      if (search) q = q.or(`order_number.ilike.%${search}%`)
      if (cashierF !== 'all') q = q.eq('cashier_id', cashierF)
      if (range[0]) q = q.gte('created_at', range[0].toISOString())
      if (range[1]) q = q.lte('created_at', range[1].toISOString())
      const { data } = await q.order('created_at',{ascending:false}).limit(200)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  // ── Held orders ──
  const { data: heldRaw = [] } = useQuery({
    queryKey: ['held-lookup', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('held_orders')
        .select('*').eq('tenant_id', tenant.id).eq('status','held')
        .order('held_at',{ascending:false})
      return (data||[]).map(o=>({...o, _source:'held', created_at: o.held_at}))
    },
    enabled: !!tenant?.id,
  })

  // ── Filter ──
  const allOrders = [
    ...(statusF === 'all' || statusF === 'held' ? heldRaw : []),
    ...orders,
  ].sort((a,b) => new Date(b.created_at)-new Date(a.created_at))

  const filtered = allOrders.filter(o => {
    const st = getStatus(o)
    if (statusF !== 'all' && st !== statusF) return false
    if (payF !== 'all') {
      const methods = (o.order_payments||[]).map(p=>p.method)
      const match = payF==='card'
        ? methods.some(m=>['card','credit_card','debit_card'].includes(m))
        : methods.includes(payF)
      if (!match) return false
    }
    if (search && !o.order_number?.toLowerCase().includes(search.toLowerCase()) &&
        !o.customers?.name?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // ── Stats ──
  const totalAmt  = filtered.reduce((s,o) => s + (o.grand_total||o.total||0), 0)
  const paidCount = filtered.filter(o => getStatus(o)==='completed').length

  const handleResume = async (o) => {
    const cartItems = useCartStore.getState().items
    if (cartItems.length > 0) {
      if (!window.confirm('Current cart will be cleared. Resume this order?')) return
    }
    const ok = await resumeHeldOrder({ heldOrderId: o.id, tenantId: tenant.id, userId: user?.id })
    if (ok) {
      toast.success('↩ Returning to POS with held order...')
      setTimeout(() => { window.location.href = '/pos' }, 600)
    }
  }

  const handleVoid = async (o, approver) => {
    const payMethods = o.order_payments || []
    const total = parseFloat(o.grand_total || 0)
    const hasCash = payMethods.some(p => p.method === 'cash')
    const hasCard = payMethods.some(p => ['card','credit_card','debit_card'].includes(p.method))
    const hasMember = payMethods.some(p => ['member_card','vip_card'].includes(p.method))

    // Build confirmation message
    let msg = `Void order ${o.order_number}?\n\nAmount: $${total.toFixed(2)}\n`
    if (hasCash) msg += `\n💵 Cash — please return $${total.toFixed(2)} to customer from drawer`
    if (hasCard) msg += `\n💳 Card — authorization will be voided at terminal`
    if (hasMember) msg += `\n🏷️ VIP Card — balance will be restored to customer`
    msg += `\n\nThis void will be recorded on TODAY's report (${new Date().toLocaleDateString()})`
    if (approver) msg += `\n\nApproved by: ${approver.name}`

    if (!window.confirm(msg)) return

    try {
      // 1. Mark order as voided — include approver if any
      const { error: voidErr } = await supabase.from('orders').update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by: effCashierId,
        voided_by_name: effCashierName,
        ...(approver && {
          voided_approved_by:      approver.id,
          voided_approved_by_name: approver.name,
        }),
      }).eq('id', o.id)
      if (voidErr) throw new Error(`Void order: ${voidErr.message}`)

      // 2. Create adjustment record on TODAY (not original date)
      for (const p of payMethods) {
        const { error: adjErr } = await supabase.from('order_adjustments').insert({
          tenant_id:      tenant.id,
          order_id:       o.id,
          order_number:   o.order_number,
          type:           'void',
          amount:         -parseFloat(p.amount || 0),
          payment_method: p.method,
          reason:         `Void of order ${o.order_number} (original: ${new Date(o.created_at).toLocaleDateString()})${approver?` · approved by ${approver.name}`:''}`,
          staff_id:       effCashierId,
          staff_name:     effCashierName,
          ...(approver && {
            approved_by:      approver.id,
            approved_by_name: approver.name,
          }),
        })
        if (adjErr) throw new Error(`Adjustment: ${adjErr.message}`)
      }

      // 3. Restore member card balance if applicable
      if (hasMember && o.customer_id) {
        const memberPay = payMethods.filter(p => ['member_card','vip_card'].includes(p.method))
        const restoreAmt = memberPay.reduce((s,p) => s + parseFloat(p.amount||0), 0)
        if (restoreAmt > 0) {
          const { data: cust } = await supabase.from('customers')
            .select('card_balance').eq('id', o.customer_id).single()
          if (cust) {
            const { error: balErr } = await supabase.from('customers').update({
              card_balance: (cust.card_balance || 0) + restoreAmt
            }).eq('id', o.customer_id)
            if (balErr) throw new Error(`Restore balance: ${balErr.message}`)
          }
        }
      }

      toast.success(`✓ Order ${o.order_number} voided — recorded on today's report`)
      // Update side-panel and refetch the list so the row's status badge
      // changes immediately (was previously only updating selected).
      setSelected(s => s?.id===o.id ? {...s, status:'voided'} : s)
      qc.invalidateQueries({ queryKey: ['orders-lookup'] })
      qc.invalidateQueries({ queryKey: ['held-lookup'] })
    } catch(e) {
      toast.error('Void failed: ' + e.message)
    }
  }


  return (
    <div className="flex h-full" style={{background:'#FFFFFF'}}>

      {/* ── LEFT: Receipt Preview (small) ── */}
      <div className="flex flex-col flex-shrink-0"
        style={{width:'300px', background:'#fff', borderRight:'1px solid #e2e8f0'}}>

        {/* Header */}
        <div className="px-4 py-3 flex-shrink-0 flex items-center justify-between"
          style={{background:'#000000'}}>
          <div className="text-[14px] font-bold text-white">🧾 Receipt Preview</div>
          {selected && (
            <button onClick={()=>setSelected(null)}
              className="w-6 h-6 rounded-full bg-white/20 border-none cursor-pointer text-white text-[12px]">✕</button>
          )}
        </div>

        {/* Receipt content */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300 py-10">
              <div className="text-[48px] mb-3">🧾</div>
              <div className="text-[13px] font-semibold text-slate-400">No order selected</div>
              <div className="text-[11px] mt-1 text-slate-300 text-center px-4">
                Click 👁️ on any order to preview
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div className="rounded-2xl overflow-hidden shadow-sm" style={{border:'1px solid #e2e8f0', background:'#fff'}}>

                {/* Store header */}
                <div className="px-4 py-4 text-center" style={{background:'#1f1f1f'}}>
                  <div className="text-[14px] font-bold tracking-widest text-white">RETAILPOS</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Official Receipt</div>
                </div>

                {/* Invoice info */}
                <div className="px-4 py-3" style={{background:'#f8fafc', borderBottom:'1px dashed #e2e8f0'}}>
                  {[
                    ['Invoice #', selected._source==='held' ? '📌 HELD' : selected.order_number],
                    ['Date', format(new Date(selected.created_at),'MMM d, yyyy')],
                    ['Time', format(new Date(selected.created_at),'h:mm a')],
                    ...(selected.customers?.name ? [['Customer', selected.customers.name]] : []),
                    ...(selected.users?.name ? [['Staff', selected.users.name]] : []),
                  ].map(([l,v]) => (
                    <div key={l} className="flex justify-between text-[11px] mb-1.5">
                      <span className="text-slate-400">{l}</span>
                      <span className="font-semibold text-slate-700 text-right ml-2 max-w-[150px] truncate" style={l==='Invoice #'?{color:'#006AFF'}:{}}>{v}</span>
                    </div>
                  ))}
                </div>

                {/* Items header */}
                <div className="grid px-4 py-2 text-[9px] font-bold text-slate-400 uppercase"
                  style={{gridTemplateColumns:'1fr 28px 60px', borderBottom:'1px solid #f1f5f9', background:'#f8fafc'}}>
                  <div>Item</div><div className="text-center">Qty</div><div className="text-right">Amount</div>
                </div>

                {/* Items */}
                <div style={{borderBottom:'1px dashed #e2e8f0'}}>
                  {(selected._source==='held'
                    ? selected.cart_snapshot?.items||[]
                    : selected.order_items||[]
                  ).map((item,i,arr) => {
                    const name  = selected._source==='held' ? item.name : (item.product_name||'Item')
                    const qty   = selected._source==='held' ? item.qty  : item.quantity
                    const price = selected._source==='held' ? item.unitPrice : item.unit_price
                    const total = selected._source==='held' ? item.unitPrice*item.qty : item.line_total
                    return (
                      <div key={i} className="grid px-4 py-2 text-[11px]"
                        style={{gridTemplateColumns:'1fr 28px 60px', borderBottom:i<arr.length-1?'1px solid #f8fafc':'none'}}>
                        <div>
                          <div className="text-slate-800 font-semibold leading-tight">{name}</div>
                          <div className="text-[10px] text-slate-400">${parseFloat(price||0).toFixed(2)}</div>
                        </div>
                        <div className="text-center text-slate-500 font-mono self-center">×{qty}</div>
                        <div className="text-right font-bold font-mono text-slate-800 self-center">${parseFloat(total||0).toFixed(2)}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Subtotal / Tax / Discount / Total */}
                <div className="px-4 py-3" style={{borderBottom:'1px dashed #e2e8f0'}}>
                  {selected.subtotal > 0 && (
                    <div className="flex justify-between text-[11px] mb-1.5">
                      <span className="text-slate-400">Subtotal</span>
                      <span className="font-mono text-slate-700">${parseFloat(selected.subtotal).toFixed(2)}</span>
                    </div>
                  )}
                  {selected.tax_amount > 0 && (
                    <div className="flex justify-between text-[11px] mb-1.5">
                      <span className="text-slate-400">Tax</span>
                      <span className="font-mono text-slate-700">${parseFloat(selected.tax_amount).toFixed(2)}</span>
                    </div>
                  )}
                  {selected.discount_amount > 0 && (
                    <div className="flex justify-between text-[11px] mb-1.5">
                      <span className="text-slate-400">Discount</span>
                      <span className="font-mono text-green-600">-${parseFloat(selected.discount_amount).toFixed(2)}</span>
                    </div>
                  )}
                  {selected.tip_amount > 0 && (
                    <div className="flex justify-between text-[11px] mb-1.5">
                      <span className="text-slate-400">Tip</span>
                      <span className="font-mono text-slate-700">${parseFloat(selected.tip_amount).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-[15px] font-bold pt-2 mt-1"
                    style={{borderTop:'2px solid #1F1F1F'}}>
                    <span className="text-slate-800">TOTAL</span>
                    <span className="font-mono" style={{color:'#006AFF'}}>
                      ${parseFloat(selected.grand_total||selected.total||0).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Payment */}
                <div className="px-4 py-3" style={{borderBottom:'1px dashed #e2e8f0'}}>
                  <div className="text-[9px] font-bold text-slate-400 uppercase mb-2 tracking-wider">Payment</div>
                  {(selected.order_payments||[]).length > 0 ? (
                    selected.order_payments.map((p,i) => (
                      <div key={i} className="flex justify-between text-[11px] mb-1.5">
                        <span className="flex items-center gap-1.5">
                          <span>{PAY_ICON[p.method]||'💰'}</span>
                          <span className="text-slate-600">{PAY_LABEL[p.method]||p.method}</span>
                        </span>
                        <span className="font-mono font-bold text-slate-800">${parseFloat(p.amount||0).toFixed(2)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-[11px] text-slate-400">No payment recorded</div>
                  )}
                </div>

                {/* Order Status */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Status</div>
                  {(() => {
                    const ss = STATUS[getStatus(selected)]
                    return ss ? (
                      <span className="text-[11px] font-bold px-3 py-1.5 rounded-full" style={ss}>{ss.label}</span>
                    ) : null
                  })()}
                </div>
              </div>

              {/* Actions */}
              <OrderActions
                order={selected}
                tenantId={tenant?.id}
                userId={user?.id}
                onResume={handleResume}
                onCancelHeld={async () => {
                  if (!window.confirm('Cancel this held order?')) return
                  await cancelHeldOrder({ heldOrderId: selected.id, tenantId: tenant.id })
                  setSelected(null); toast.success('Cancelled')
                }}
                onVoid={() => guard('pos.void', 'void this order',
                  (approver) => handleVoid(selected, approver),
                  { orderId: selected.id, orderNumber: selected.order_number, amount: selected.grand_total||selected.total })}
                onRefund={() => guard('pos.refund', 'process this refund',
                  (approver) => {
                    if (approver) {
                      sessionStorage.setItem('refundApprover', JSON.stringify({ id: approver.id, name: approver.name }))
                    }
                    window.location.href = '/pos?refund=' + selected.id
                  },
                  { orderId: selected.id, orderNumber: selected.order_number, amount: selected.grand_total||selected.total })}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Filters + List (big) ── */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{background:'#fff'}}>

        {/* Filters */}
        <div className="flex-shrink-0 px-5 pt-4 pb-3" style={{borderBottom:'1px solid #f1f5f9'}}>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 flex items-center gap-2 rounded-xl px-3"
              style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}>
              <span className="text-slate-400">🔍</span>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Order # or customer..."
                className="flex-1 border-none outline-none py-2.5 text-[13px] bg-transparent"/>
              {search && <button onClick={()=>setSearch('')} className="text-slate-400 bg-transparent border-none cursor-pointer">✕</button>}
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-[11px] text-slate-400">{filtered.length} orders</div>
              <div className="text-[15px] font-bold" style={{color:'#006AFF'}}>${totalAmt.toFixed(2)}</div>
            </div>
          </div>

          <div className="flex gap-1.5 mb-3">
            {[['today','Today'],['3days','3 Days'],['week','Week'],['month','Month'],['custom','📅 Custom']].map(([id,label])=>(
              <button key={id} onClick={()=>setDateMode(id)}
                className="flex-1 py-2 rounded-xl text-[11px] font-semibold cursor-pointer border transition-all"
                style={dateMode===id?{background:'#006AFF',borderColor:'#006AFF',color:'#fff'}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                {label}
              </button>
            ))}
          </div>

          {dateMode==='custom' && (
            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">From</div>
                <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#f8fafc'}}/>
              </div>
              <div className="flex-1">
                <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">To</div>
                <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
                  style={{border:'1.5px solid #e2e8f0',background:'#f8fafc'}}/>
              </div>
            </div>
          )}

          <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1" style={{scrollbarWidth:'none'}}>
            {STATUS_FILTERS.map(f => {
              const count = f.id==='all' ? allOrders.length : allOrders.filter(o=>getStatus(o)===f.id).length
              return (
                <button key={f.id} onClick={()=>setStatusF(f.id)}
                  className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer border transition-all"
                  style={statusF===f.id?{background:'#1F1F1F',borderColor:'#1F1F1F',color:'#fff'}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                  {f.label}
                  <span className="text-[9px] px-1 rounded-full"
                    style={{background:statusF===f.id?'rgba(255,255,255,0.2)':'#e2e8f0'}}>{count}</span>
                </button>
              )
            })}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5 items-center" style={{scrollbarWidth:'none'}}>
            {PAY_FILTERS.map(f => (
              <button key={f.id} onClick={()=>setPayF(f.id)}
                className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer border transition-all"
                style={payF===f.id?{background:'#006AFF',borderColor:'#006AFF',color:'#fff'}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>
                {f.icon} {f.label}
              </button>
            ))}
            <div className="w-px h-5 bg-slate-300 mx-1 flex-shrink-0"/>
            <select value={cashierF} onChange={e=>setCashierF(e.target.value)}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer border outline-none"
              style={cashierF!=='all'
                ? {background:'#006AFF', borderColor:'#006AFF', color:'#fff'}
                : {background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b'}}>
              <option value="all">👥 All Employees</option>
              {allEmployees.map(e => (
                <option key={e.id} value={e.id}>👤 {e.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Column headers */}
        <div className="flex-shrink-0 grid px-5 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
          style={{gridTemplateColumns:'160px 130px 140px 100px 110px 90px 40px', borderBottom:'1.5px solid #e2e8f0', background:'#f8fafc'}}>
          <div>Order #</div>
          <div>Date & Time</div>
          <div>Customer</div>
          <div className="text-right">Amount</div>
          <div className="text-center">Status</div>
          <div className="text-center">Payment</div>
          <div></div>
        </div>

        {/* Order List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-slate-300">
              <div className="text-[48px] mb-3">📋</div>
              <div className="text-[14px]">No orders found</div>
            </div>
          ) : filtered.map(o => {
            const st = getStatus(o)
            const ss = STATUS[st] || STATUS.completed
            const isHeld = o._source === 'held'
            const isSelected = selected?.id === o.id
            const payMethods = o.order_payments || []
            return (
              <div key={o.id}
                className="grid items-center px-5 py-3 border-b cursor-pointer transition-all"
                style={{
                  gridTemplateColumns:'160px 130px 140px 100px 110px 90px 40px',
                  borderColor:'#f8fafc',
                  background: isSelected ? '#E6F0FF' : '#fff',
                  borderLeft: isSelected ? '3px solid #006AFF' : '3px solid transparent',
                }}
                onClick={() => setSelected(o)}>
                <div>
                  {isHeld
                    ? <span className="text-[12px] font-bold text-amber-600">📌 {o.label||'Held'}</span>
                    : <span className="text-[12px] font-bold font-mono" style={{color:'#006AFF'}}>{o.order_number}</span>
                  }
                </div>
                <div>
                  <div className="text-[12px] text-slate-700">{format(new Date(o.created_at),'MMM d, yyyy')}</div>
                  <div className="text-[11px] text-slate-400">{format(new Date(o.created_at),'h:mm a')}</div>
                </div>
                <div>
                  <div className="text-[12px] text-slate-700 truncate">{o.customers?.name || <span className="text-slate-400">Walk-in</span>}</div>
                  {o.users?.name && <div className="text-[10px] text-slate-400 truncate">{o.users.name}</div>}
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-bold font-mono">${parseFloat(o.grand_total||o.total||0).toFixed(2)}</div>
                  <div className="text-[10px] text-slate-400">{(o.order_items||o.cart_snapshot?.items||[]).length} items</div>
                </div>
                <div className="flex justify-center">
                  <span className="text-[9px] font-bold px-2 py-1 rounded-full" style={ss}>{ss.label}</span>
                </div>
                <div className="flex justify-center gap-0.5">
                  {payMethods.length > 0 ? payMethods.map((p,i) => (
                    <span key={i} className="text-[13px]">{PAY_ICON[p.method]||'💰'}</span>
                  )) : <span className="text-[11px] text-slate-300">—</span>}
                </div>
                <div className="flex justify-center">
                  <span className="text-[15px]" style={{color:isSelected?'#006AFF':'#cbd5e1'}}>👁️</span>
                </div>
              </div>
            )
          })}
        </div>
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
