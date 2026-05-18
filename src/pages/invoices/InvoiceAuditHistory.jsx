// src/pages/invoices/InvoiceAuditHistory.jsx
//
// Right-side drawer showing the complete edit history for one invoice.
// Reads from the invoice_audit table (populated by fn_edit_invoice +
// fn_close_invoice + fn_auto_close_paid_invoices).
//
// Each entry shows:
//   - When + who (or "System" for auto_close)
//   - What action (edit / close / auto_close)
//   - The diff: which fields changed, from what to what
//
// For the items diff specifically we show a side-by-side table so the
// user can scan before/after at a glance.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

const ACTION_LABEL = {
  edit:       { icon: '✏️', label: 'Edited',          color: '#006AFF' },
  close:      { icon: '🔒', label: 'Closed & Locked', color: '#374151' },
  auto_close: { icon: '🔒', label: 'Auto-Closed',     color: '#374151' },
}

function fmtDateTime(s) {
  if (!s) return ''
  try {
    return new Date(s).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return s }
}

function fmtMoney(v, $) {
  const n = parseFloat(v)
  if (isNaN(n)) return v
  return `${$ || '$'}${n.toFixed(2)}`
}

// Stringify a value for display — handles null / numbers / strings
function fmtValue(v, $) {
  if (v === null || v === undefined || v === '') return <span className="text-[#999] italic">empty</span>
  if (typeof v === 'number') return v.toFixed(2)
  return String(v)
}

// Render an items array as a compact table
function ItemsTable({ items, $ }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="text-[11px] text-[#999] italic">(no items)</div>
  }
  return (
    <table className="w-full text-[10px]" style={{borderCollapse:'collapse'}}>
      <thead>
        <tr style={{borderBottom:'1px solid #E5E5E5'}}>
          <th className="text-left py-1 pr-2 font-semibold text-[#666]">Item</th>
          <th className="text-right py-1 px-1 font-semibold text-[#666]">Qty</th>
          <th className="text-right py-1 px-1 font-semibold text-[#666]">Price</th>
          <th className="text-right py-1 pl-1 font-semibold text-[#666]">Line</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={i} style={{borderBottom:'1px dashed #F0F0F0'}}>
            <td className="py-1 pr-2 text-[#1F1F1F]">
              {it.product_name || <span className="text-[#999] italic">(unnamed)</span>}
            </td>
            <td className="py-1 px-1 text-right font-mono">{it.quantity}</td>
            <td className="py-1 px-1 text-right font-mono">{fmtMoney(it.unit_price, $)}</td>
            <td className="py-1 pl-1 text-right font-mono">{fmtMoney(it.line_total ?? (it.quantity * it.unit_price), $)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function InvoiceAuditHistory({ invoiceId, invoiceNumber, onClose }) {
  const { tenant } = useAuthStore()
  const $ = tenant?.currency_symbol || '$'

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['invoice-audit', invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_audit')
        .select('*, users(full_name, email)')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: false })
      if (error) { console.error('audit fetch:', error); return [] }
      return data || []
    },
    enabled: !!invoiceId,
  })

  return (
    <div className="fixed inset-0 z-[600] flex justify-end" style={{background:'rgba(0,0,0,0.45)'}}>
      <div className="w-full max-w-[480px] bg-white shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0"
          style={{borderBottom:'1px solid #E5E5E5'}}>
          <div>
            <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">📜 History</div>
            <div className="text-[15px] font-bold text-[#1F1F1F]">{invoiceNumber}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading ? (
            <div className="text-[13px] text-[#666]">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="rounded-lg p-6 text-center"
              style={{background:'#F9FAFB', border:'1px dashed #E5E5E5'}}>
              <div className="text-[32px] mb-2 opacity-40">📜</div>
              <div className="text-[13px] text-[#666]">No edits yet</div>
              <div className="text-[11px] text-[#999] mt-1">
                Any future changes will appear here.
              </div>
            </div>
          ) : (
            entries.map((e) => {
              const meta = ACTION_LABEL[e.action] || { icon: '•', label: e.action, color: '#666' }
              const userName = e.users?.full_name || e.users?.email
                || (e.action === 'auto_close' ? 'System (automatic)' : 'Unknown user')
              const changes = e.changes || {}
              return (
                <div key={e.id} className="rounded-xl p-4"
                  style={{background:'#FFFFFF', border:'1px solid #E5E5E5'}}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[18px]">{meta.icon}</span>
                      <span className="text-[13px] font-bold" style={{color: meta.color}}>{meta.label}</span>
                    </div>
                    <span className="text-[11px] text-[#999]">{fmtDateTime(e.created_at)}</span>
                  </div>
                  <div className="text-[11px] text-[#666] mb-3">by {userName}</div>

                  {/* Simple scalar changes (status, total, etc.) */}
                  {Object.entries(changes)
                    .filter(([k]) => k !== 'items')
                    .map(([field, val]) => (
                      <div key={field} className="text-[11px] mb-1.5">
                        <span className="font-semibold text-[#666]">{field}:</span>{' '}
                        <span className="line-through text-[#CF1322]">{fmtValue(val?.from, $)}</span>
                        <span className="mx-1 text-[#666]">→</span>
                        <span className="font-semibold text-[#15803D]">{fmtValue(val?.to, $)}</span>
                      </div>
                    ))}

                  {/* Items diff — side-by-side */}
                  {changes.items && (
                    <div className="mt-3 pt-3" style={{borderTop:'1px dashed #E5E5E5'}}>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#666] mb-2">
                        Line items
                      </div>
                      <div className="space-y-2">
                        <div className="rounded-lg p-2" style={{background:'#FEF2F2', border:'1px solid #FECACA'}}>
                          <div className="text-[10px] font-bold text-[#CF1322] mb-1">Before</div>
                          <ItemsTable items={changes.items.from} $={$}/>
                        </div>
                        <div className="rounded-lg p-2" style={{background:'#F0FDF4', border:'1px solid #86EFAC'}}>
                          <div className="text-[10px] font-bold text-[#15803D] mb-1">After</div>
                          <ItemsTable items={changes.items.to} $={$}/>
                        </div>
                      </div>
                    </div>
                  )}

                  {e.notes && (
                    <div className="mt-2 text-[11px] text-[#666] italic">{e.notes}</div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex-shrink-0" style={{borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="w-full rounded-lg py-2.5 text-[13px] font-bold cursor-pointer"
            style={{background:'#F5F5F5', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
