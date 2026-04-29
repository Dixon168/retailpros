// src/pages/orders/OrderLookupPage.jsx
// 找单页面 — 全局订单查询，支持所有状态和打印

import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useHeldOrdersStore } from '@/stores/heldOrdersStore'
import { useReactToPrint } from 'react-to-print'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import toast from 'react-hot-toast'

const STATUS_STYLE = {
  completed:          { label: 'Completed',     bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  held:               { label: 'On Hold',       bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b' },
  needs_recharge:     { label: 'Needs Recharge',bg: 'rgba(239,68,68,0.12)',   color: '#ef4444' },
  voided:             { label: 'Voided',        bg: 'rgba(61,80,104,0.2)',    color: '#8899b0' },
  partial_void:       { label: 'Partial Void',  bg: 'rgba(249,115,22,0.12)', color: '#f97316' },
  refunded:           { label: 'Refunded',      bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  partially_refunded: { label: 'Part. Refunded',bg: 'rgba(20,184,166,0.12)', color: '#14b8a6' },
}

const DATE_PRESETS = [
  { id: 'today',   label: 'Today' },
  { id: '3days',   label: '3 Days' },
  { id: 'week',    label: 'This Week' },
  { id: 'month',   label: 'This Month' },
  { id: 'all',     label: 'All Time' },
]

function getRange(preset) {
  const now = new Date()
  switch (preset) {
    case 'today':  return [startOfDay(now), endOfDay(now)]
    case '3days':  return [startOfDay(subDays(now, 3)), endOfDay(now)]
    case 'week':   return [startOfDay(subDays(now, 7)), endOfDay(now)]
    case 'month':  return [startOfDay(subDays(now, 30)), endOfDay(now)]
    default:       return [null, null]
  }
}

export default function OrderLookupPage() {
  const { tenant, store, user } = useAuthStore()
  const { resumeHeldOrder, cancelHeldOrder } = useHeldOrdersStore()
  const printRef = useRef()

  const [search,      setSearch]      = useState('')
  const [statusFilter,setStatusFilter]= useState('all')
  const [datePreset,  setDatePreset]  = useState('today')
  const [selected,    setSelected]    = useState(null)
  const [printMode,   setPrintMode]   = useState('receipt') // receipt|invoice|packing

  const [dateFrom, dateTo] = getRange(datePreset)

  // ── 查询 POS 订单 ──
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['order-lookup', tenant?.id, search, statusFilter, datePreset],
    queryFn: async () => {
      let q = supabase.from('orders')
        .select(`
          *,
          users(name),
          customers(name, phone),
          terminals(name),
          order_items(product_name, quantity, unit, unit_price, line_total),
          order_payments(method, amount),
          card_transactions(id, status, amount, masked_pan, card_type, cp_retref)
        `)
        .eq('tenant_id', tenant.id)

      if (search) {
        q = q.or(`order_number.ilike.%${search}%`)
      }
      if (statusFilter !== 'all') {
        q = q.eq('status_ext', statusFilter)
      }
      if (dateFrom) q = q.gte('created_at', dateFrom.toISOString())
      if (dateTo)   q = q.lte('created_at', dateTo.toISOString())

      const { data } = await q.order('created_at', { ascending: false }).limit(100)
      return (data || []).map(o => ({ ...o, _source: 'pos' }))
    },
    enabled: !!tenant?.id,
  })

  // ── 查询挂单 ──
  const { data: heldOrders = [] } = useQuery({
    queryKey: ['held-lookup', tenant?.id, statusFilter],
    queryFn: async () => {
      if (statusFilter !== 'all' && statusFilter !== 'held') return []
      const { data } = await supabase.from('held_orders')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('status', 'held')
        .order('held_at', { ascending: false })
      return (data || []).map(o => ({ ...o, _source: 'held', status_ext: 'held' }))
    },
    enabled: !!tenant?.id,
  })

  // 合并显示
  const allOrders = [
    ...heldOrders,
    ...orders.filter(o => statusFilter === 'all' || statusFilter !== 'held'),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const handlePrint = useReactToPrint({ content: () => printRef.current })

  const handleResume = async (order) => {
    const ok = await resumeHeldOrder({
      heldOrderId: order.id,
      tenantId:    tenant.id,
      terminalId:  null,
      userId:      user.id,
    })
    if (ok) setSelected(null)
  }

  return (
    <div className="flex h-full bg-[#07090f]">

      {/* ── Left: Search + List ── */}
      <div className="w-[380px] bg-[#0d1117] border-r border-[#1e2d42] flex flex-col flex-shrink-0">

        {/* Search */}
        <div className="p-3.5 border-b border-[#1e2d42]">
          <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42]
            rounded-[9px] px-3 mb-3 focus-within:border-blue-500/40 transition-colors">
            <span className="text-[#3d5068]">🔍</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Order number, customer..."
              className="bg-transparent border-none outline-none py-2.5 text-[12px]
                text-[#e8edf5] flex-1 font-sans placeholder-[#3d5068]"
            />
          </div>

          {/* Date presets */}
          <div className="flex gap-1.5 mb-2.5">
            {DATE_PRESETS.map(p => (
              <button key={p.id} onClick={() => setDatePreset(p.id)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] border transition-all ${
                  datePreset === p.id
                    ? 'border-blue-500/40 bg-blue-500/8 text-blue-400'
                    : 'border-[#1e2d42] bg-[#111827] text-[#8899b0]'
                }`}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex gap-1 flex-wrap">
            {[['all','All'], ...Object.entries(STATUS_STYLE).map(([k,v]) => [k, v.label])].map(([k, label]) => (
              <button key={k} onClick={() => setStatusFilter(k)}
                className="px-2 py-0.5 rounded text-[9px] font-mono border transition-all"
                style={statusFilter === k && STATUS_STYLE[k] ? {
                  borderColor: STATUS_STYLE[k].color + '60',
                  background:  STATUS_STYLE[k].bg,
                  color:       STATUS_STYLE[k].color,
                } : statusFilter === k ? {
                  borderColor: '#3b82f680',
                  background: 'rgba(59,130,246,0.1)',
                  color: '#3b82f6',
                } : {
                  borderColor: '#1e2d42',
                  background: '#111827',
                  color: '#8899b0',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Order count */}
        <div className="px-4 py-2 border-b border-[#1e2d42] flex justify-between items-center">
          <span className="text-[10px] font-mono text-[#3d5068] uppercase">
            {allOrders.length} orders
          </span>
          <span className="text-[10px] font-mono text-[#3d5068]">
            Total: ${allOrders.reduce((s,o) => s + (o.total||0), 0).toFixed(2)}
          </span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading
            ? Array(5).fill(0).map((_,i) => (
                <div key={i} className="h-[80px] bg-[#111827] rounded-[10px] mb-1.5 animate-pulse"/>
              ))
            : allOrders.map(order => {
                const ss = STATUS_STYLE[order.status_ext] || STATUS_STYLE.completed
                const isHeld = order._source === 'held'
                return (
                  <div key={order.id}
                    onClick={() => setSelected(order)}
                    className={`px-3 py-3 rounded-[10px] cursor-pointer border mb-1.5 transition-all ${
                      selected?.id === order.id
                        ? 'bg-[#111827] border-blue-500/40'
                        : 'border-transparent hover:bg-[#111827]'
                    }`}>
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-mono text-[12px] font-bold text-blue-400">
                        {isHeld ? '📌' : ''} {order.order_number || 'HELD'}
                      </span>
                      <span className="font-mono text-[13px] font-bold">
                        ${(order.total || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8899b0] mb-1.5">
                      {order.customer_name || order.customers?.name || 'Walk-in'}
                      {order.label ? ` · ${order.label}` : ''}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                        style={{ background: ss.bg, color: ss.color }}>
                        {ss.label}
                      </span>
                      <span className="text-[9px] text-[#3d5068] ml-auto">
                        {format(new Date(order.created_at || order.held_at), 'MMM d, h:mm a')}
                      </span>
                    </div>
                  </div>
                )
              })
          }
        </div>
      </div>

      {/* ── Right: Order Detail ── */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Toolbar */}
          <div className="flex items-center gap-2.5 px-5 py-3 bg-[#0d1117]
            border-b border-[#1e2d42] flex-shrink-0">
            <span className="font-mono text-[14px] font-bold text-blue-400">
              {selected.order_number || 'HELD ORDER'}
            </span>
            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded"
              style={{
                background: STATUS_STYLE[selected.status_ext]?.bg || 'rgba(59,130,246,0.12)',
                color:      STATUS_STYLE[selected.status_ext]?.color || '#3b82f6',
              }}>
              {STATUS_STYLE[selected.status_ext]?.label || selected.status_ext}
            </span>
            <div className="flex-1"/>

            {/* Print mode toggle */}
            <div className="flex bg-[#111827] border border-[#1e2d42] rounded-[7px] overflow-hidden">
              {[['receipt','🖨 Receipt'],['invoice','📄 Invoice'],['packing','📦 Packing']].map(([id,label]) => (
                <button key={id} onClick={() => setPrintMode(id)}
                  className={`px-3 py-1.5 text-[10px] transition-all ${
                    printMode === id ? 'bg-[#1a2236] text-white' : 'text-[#8899b0] hover:text-white'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            <button onClick={handlePrint}
              className="bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5
                text-[11px] text-[#8899b0] hover:border-blue-500/30 hover:text-blue-400 transition-all">
              🖨 Print
            </button>

            {/* Action buttons based on status */}
            {selected._source === 'held' && (
              <>
                <button onClick={() => handleResume(selected)}
                  className="bg-green-500 border-none rounded-lg px-3 py-1.5
                    text-[11px] font-bold text-white">
                  ▶ Resume
                </button>
                <button onClick={() => cancelHeldOrder({ heldOrderId: selected.id, tenantId: tenant.id, userId: user.id })}
                  className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5
                    text-[11px] text-red-400">
                  🗑 Delete
                </button>
              </>
            )}
            {selected.status_ext === 'needs_recharge' && (
              <button onClick={() => toast.success('Opening recharge panel...')}
                className="bg-yellow-500 border-none rounded-lg px-3 py-1.5
                  text-[11px] font-bold text-black">
                💳 Recharge
              </button>
            )}
            {selected.status_ext === 'completed' && (
              <button onClick={() => toast.success('Opening refund panel...')}
                className="bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5
                  text-[11px] text-[#8899b0] hover:border-red-500/30 hover:text-red-400 transition-all">
                ↩ Refund
              </button>
            )}
          </div>

          {/* Order detail content */}
          <div className="flex-1 overflow-y-auto p-5 bg-[#07090f]">

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                ['Total',    `$${(selected.total||0).toFixed(2)}`,      '#3b82f6'],
                ['Paid',     `$${(selected.amount_paid||0).toFixed(2)}`, '#10b981'],
                ['Items',    selected.order_items?.length || selected.item_count || 0, undefined],
                ['Terminal', selected.terminals?.name || selected.terminal_name || '—', '#8899b0'],
              ].map(([l,v,c]) => (
                <div key={l} className="bg-[#0d1117] border border-[#1e2d42] rounded-[11px] p-3.5">
                  <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{ color: c }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Items */}
            <div className="bg-[#0d1117] border border-[#1e2d42] rounded-[12px] overflow-hidden mb-4">
              <div className="px-4 py-2.5 bg-[#111827] border-b border-[#1e2d42]">
                <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider">Items</div>
              </div>
              {(selected.order_items || selected.cart_snapshot?.items || []).map((item, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[#1e2d42] last:border-0">
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold">{item.product_name || item.name}</div>
                    <div className="text-[10px] font-mono text-[#3d5068] mt-0.5">
                      {item.quantity || item.qty} {item.unit || 'ea'} × ${(item.unit_price || item.unitPrice || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="font-mono text-[13px] font-bold">
                    ${(item.line_total || (item.qty || item.quantity) * (item.unitPrice || item.unit_price || 0)).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>

            {/* Payments */}
            {(selected.order_payments || []).length > 0 && (
              <div className="bg-[#0d1117] border border-[#1e2d42] rounded-[12px] overflow-hidden mb-4">
                <div className="px-4 py-2.5 bg-[#111827] border-b border-[#1e2d42]">
                  <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider">Payments</div>
                </div>
                {selected.order_payments.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[#1e2d42] last:border-0">
                    <div className="text-[18px]">
                      {{'cash':'💵','card':'💳','check':'📝','bank_transfer':'🏦','member_card':'🏷️','on_account':'📋'}[p.method]||'💰'}
                    </div>
                    <div className="flex-1 text-[12px] capitalize">{p.method.replace('_',' ')}</div>
                    <div className="font-mono text-[13px] font-bold">${p.amount.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Card transactions */}
            {(selected.card_transactions || []).length > 0 && (
              <div className="bg-[#0d1117] border border-[#1e2d42] rounded-[12px] overflow-hidden mb-4">
                <div className="px-4 py-2.5 bg-[#111827] border-b border-[#1e2d42]">
                  <div className="text-[11px] font-bold text-[#8899b0] uppercase tracking-wider">Card Transactions</div>
                </div>
                {selected.card_transactions.map((tx, i) => {
                  const txStatus = {
                    authorized: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', label: 'AUTHORIZED' },
                    settled:    { bg: 'rgba(16,185,129,0.1)', color: '#10b981', label: 'SETTLED' },
                    voided:     { bg: 'rgba(61,80,104,0.2)',  color: '#8899b0', label: 'VOIDED' },
                    refunded:   { bg: 'rgba(16,185,129,0.1)', color: '#10b981', label: 'REFUNDED' },
                    declined:   { bg: 'rgba(239,68,68,0.1)',  color: '#ef4444', label: 'DECLINED' },
                  }[tx.status] || { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', label: tx.status?.toUpperCase() }

                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[#1e2d42] last:border-0">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-bold">{tx.card_type} {tx.masked_pan}</span>
                          <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                            style={{ background: txStatus.bg, color: txStatus.color }}>
                            {txStatus.label}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-[#3d5068] mt-0.5">
                          Ref: {tx.cp_retref || '—'}
                        </div>
                        {tx.refunded_amount > 0 && (
                          <div className="text-[10px] font-mono text-green-400 mt-0.5">
                            Refunded: ${tx.refunded_amount.toFixed(2)}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[13px] font-bold">${tx.amount.toFixed(2)}</div>
                        {/* Void button — only if authorized (not settled) */}
                        {tx.status === 'authorized' && (
                          <button
                            onClick={() => toast.success(`Voiding ${tx.cp_retref}`)}
                            className="mt-1 text-[9px] px-2 py-0.5 rounded
                              bg-red-500/10 border border-red-500/20 text-red-400
                              hover:bg-red-500/15 transition-colors">
                            Void
                          </button>
                        )}
                        {tx.status === 'settled' && (
                          <button
                            onClick={() => toast.success(`Refunding ${tx.cp_retref}`)}
                            className="mt-1 text-[9px] px-2 py-0.5 rounded
                              bg-green-500/10 border border-green-500/20 text-green-400
                              hover:bg-green-500/15 transition-colors">
                            Refund
                          </button>
                        )}
                        {/* Settled — void disabled */}
                        {tx.status === 'settled' && (
                          <div className="text-[9px] font-mono text-[#3d5068] mt-0.5">
                            ✓ Settled
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Print target (hidden) */}
          <div className="hidden">
            <div ref={printRef}>
              {printMode === 'receipt' && <ThermalReceipt order={selected} />}
              {printMode === 'invoice' && <div>Invoice A4 — connects to InvoicePage component</div>}
              {printMode === 'packing' && <div>Packing Slip A4 — connects to InvoicePage component</div>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[#07090f]">
          <div className="text-center text-[#3d5068]">
            <div className="text-5xl mb-4 opacity-20">🔍</div>
            <div className="text-[14px]">Select an order to view details</div>
            <div className="text-[11px] font-mono mt-2 opacity-60">
              Search by order number or filter by status
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 热敏小票组件（ESC/POS 兼容 CSS）──
function ThermalReceipt({ order }) {
  return (
    <div style={{
      width: '80mm', fontFamily: 'monospace', fontSize: '12px',
      padding: '8px', color: '#000', background: '#fff',
    }}>
      <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>
        RetailPOS
      </div>
      <div style={{ textAlign: 'center', fontSize: '11px', marginBottom: '8px', borderBottom: '1px dashed #000', paddingBottom: '6px' }}>
        {format(new Date(order.created_at || order.held_at), 'MMM d, yyyy h:mm a')}
        <br/>Order: {order.order_number || 'HELD'}
        <br/>Terminal: {order.terminals?.name || order.terminal_name || '—'}
      </div>

      {/* Items */}
      {(order.order_items || order.cart_snapshot?.items || []).map((item, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ flex: 1 }}>
            {item.product_name || item.name}
            <br/>
            <span style={{ fontSize: '10px', color: '#666' }}>
              {item.quantity || item.qty} × ${(item.unit_price || item.unitPrice || 0).toFixed(2)}
            </span>
          </span>
          <span>${(item.line_total || (item.qty || item.quantity) * (item.unitPrice || item.unit_price || 0)).toFixed(2)}</span>
        </div>
      ))}

      <div style={{ borderTop: '1px dashed #000', marginTop: '6px', paddingTop: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Subtotal</span><span>${(order.subtotal || 0).toFixed(2)}</span>
        </div>
        {order.tax_amount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tax</span><span>${order.tax_amount.toFixed(2)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', marginTop: '4px' }}>
          <span>TOTAL</span><span>${(order.total || 0).toFixed(2)}</span>
        </div>
      </div>

      {/* Payments */}
      {(order.order_payments || []).length > 0 && (
        <div style={{ borderTop: '1px dashed #000', marginTop: '6px', paddingTop: '6px' }}>
          {order.order_payments.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
              <span>{p.method.replace('_', ' ').toUpperCase()}</span>
              <span>${p.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: '10px', marginTop: '10px', borderTop: '1px dashed #000', paddingTop: '6px' }}>
        Thank you for your business!
      </div>
    </div>
  )
}
