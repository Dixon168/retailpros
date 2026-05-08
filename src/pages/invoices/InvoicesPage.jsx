// src/pages/invoices/InvoicesPage.jsx
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useReactToPrint } from 'react-to-print'
import { useLock, TERMINAL_ID, getTerminalName } from '@/hooks/useLock'
import { LockBadge, LockBlocker, ConflictToast } from '@/components/ui/LockBadge'
import toast from 'react-hot-toast'

const STATUS_STYLE = {
  draft:   { bg:'rgba(61,80,104,0.2)',   color:'#666666', label:'DRAFT' },
  sent:    { bg:'rgba(59,130,246,0.12)', color:'#3b82f6', label:'SENT' },
  viewed:  { bg:'rgba(6,182,212,0.12)',  color:'#06b6d4', label:'VIEWED' },
  partial: { bg:'rgba(245,158,11,0.12)', color:'#f59e0b', label:'PARTIAL' },
  paid:    { bg:'rgba(16,185,129,0.12)', color:'#10b981', label:'PAID' },
  overdue: { bg:'rgba(239,68,68,0.12)',  color:'#ef4444', label:'OVERDUE' },
  void:    { bg:'rgba(61,80,104,0.2)',   color:'#999999', label:'VOID' },
}

export default function InvoicesPage() {
  const { tenant, store, user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [docView, setDocView] = useState('invoice')
  const [conflictVisible, setConflictVisible] = useState(false)
  const printRef = useRef()

  const terminalName = getTerminalName(user?.name, store?.name)

  // Lock for currently selected invoice
  const { lockStatus, lockedByName, acquire, release, isLocked, isMine } = useLock(
    tenant?.id,
    'invoice',
    selected?.id,
    { terminalName }
  )

  // When selecting an invoice, try to acquire lock
  const handleSelect = async (inv) => {
    // Release previous lock first
    if (selected?.id && selected.id !== inv.id) await release()
    setSelected(inv)
    // Silently try to acquire (non-blocking — user can still view)
    await acquire()
  }

  // When recording payment, must hold lock
  const handleRecordPayment = async () => {
    if (isLocked) {
      toast.error(`🔒 Locked by ${lockedByName}`)
      return
    }
    if (!isMine) {
      const ok = await acquire()
      if (!ok) return
    }
    toast.success('Payment recorded')
  }

  const { data: invoices=[], isLoading } = useQuery({
    queryKey: ['invoices', tenant?.id, search, statusFilter],
    queryFn: async () => {
      let q = supabase.from('invoices')
        .select('*, business_customers(company_name,contact_email,code), invoice_items(*)')
        .eq('tenant_id', tenant.id)
      if(search) q = q.or(`invoice_number.ilike.%${search}%`)
      if(statusFilter !== 'all') q = q.eq('status', statusFilter)
      const { data } = await q.order('created_at', { ascending: false }).limit(50)
      return data||[]
    },
    enabled: !!tenant?.id,
  })

  const handlePrint = useReactToPrint({ content: () => printRef.current })

  const totalOutstanding = invoices
    .filter(i => ['sent','partial','overdue'].includes(i.status))
    .reduce((s,i) => s+(i.balance_due||0), 0)

  return (
    <div className="flex h-full bg-[#FAFAFA]">
      {/* Invoice list */}
      <div className="w-[320px] bg-[#FFFFFF] border-r border-[#E5E5E5] flex flex-col flex-shrink-0">
        <div className="p-3.5 border-b border-[#E5E5E5]">
          <div className="flex items-center gap-2 bg-[#F5F5F5] border border-[#E5E5E5] rounded-[9px] px-3 mb-2.5 focus-within:border-cyan-500/30 transition-colors">
            <span className="text-[#999999]">🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search invoices..."
              className="bg-transparent border-none outline-none py-2 text-[12px] text-[#1F1F1F] flex-1 font-sans placeholder-[#999999]"/>
          </div>
          <div className="flex gap-1 flex-wrap">
            {['all','draft','sent','partial','paid','overdue'].map(s => (
              <button key={s} onClick={()=>setStatusFilter(s)}
                className={`px-2 py-0.5 rounded text-[9px] font-mono border transition-all capitalize ${
                  statusFilter===s
                    ? `border-current` + (STATUS_STYLE[s] ? '' : ' border-cyan-500/40 bg-cyan-500/8 text-cyan-400')
                    : 'border-[#E5E5E5] bg-[#F5F5F5] text-[#666666]'
                }`}
                style={statusFilter===s && STATUS_STYLE[s] ? {
                  borderColor: STATUS_STYLE[s].color + '60',
                  background: STATUS_STYLE[s].bg,
                  color: STATUS_STYLE[s].color,
                } : {}}>
                {s === 'all' ? 'All' : STATUS_STYLE[s]?.label || s}
              </button>
            ))}
          </div>
        </div>

        {/* Outstanding */}
        <div className="px-4 py-2.5 border-b border-[#E5E5E5] flex justify-between items-center">
          <span className="text-[10px] text-[#999999] font-mono uppercase">Outstanding</span>
          <span className="text-[14px] font-bold font-mono text-[#CF1322]">${totalOutstanding.toFixed(2)}</span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? Array(5).fill(0).map((_,i) => (
            <div key={i} className="h-[72px] bg-[#F5F5F5] rounded-[10px] mb-1.5 animate-pulse"/>
          )) : invoices.map(inv => {
            const ss = STATUS_STYLE[inv.status] || STATUS_STYLE.draft
            return (
              <div key={inv.id} onClick={()=>handleSelect(inv)}
                className={`px-3 py-3 rounded-[10px] cursor-pointer border mb-1 transition-all ${selected?.id===inv.id?'bg-[#F5F5F5] border-cyan-500/40':'border-transparent hover:bg-[#F5F5F5]'}`}>
                <div className="flex justify-between items-start mb-1">
                  <span className="font-mono text-[12px] font-bold text-cyan-400">{inv.invoice_number}</span>
                  <span className="font-mono text-[13px] font-bold"
                    style={{color: inv.balance_due>0?'#f59e0b':'#10b981'}}>
                    ${inv.total?.toFixed(2)}
                  </span>
                </div>
                <div className="text-[12px] font-semibold mb-1">{inv.business_customers?.company_name||'—'}</div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                    style={{background:ss.bg, color:ss.color}}>{ss.label}</span>
                  <span className="text-[10px] text-[#999999] ml-auto">
                    {inv.due_date ? `Due ${new Date(inv.due_date).toLocaleDateString()}` : new Date(inv.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="p-3 border-t border-[#E5E5E5]">
          <button className="w-full bg-cyan-500 border-none rounded-[9px] py-2.5 text-[12px] font-bold text-white">+ New Invoice</button>
        </div>
      </div>

      {/* Detail / Preview */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2.5 px-5 py-3 bg-[#FFFFFF] border-b border-[#E5E5E5] flex-shrink-0">
            <span className="font-mono text-[14px] font-bold text-cyan-400">{selected.invoice_number}</span>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
              style={{background:STATUS_STYLE[selected.status]?.bg, color:STATUS_STYLE[selected.status]?.color}}>
              {STATUS_STYLE[selected.status]?.label}
            </span>
            {/* Lock status badge */}
            <LockBadge lockStatus={lockStatus} lockedByName={lockedByName} />
            <div className="flex-1"/>
            {/* View toggle */}
            <div className="flex bg-[#F5F5F5] border border-[#E5E5E5] rounded-[7px] overflow-hidden">
              {[['invoice','Invoice'],['packing','Packing Slip']].map(([id,label]) => (
                <button key={id} onClick={()=>setDocView(id)}
                  className={`px-3 py-1.5 text-[11px] transition-all ${docView===id?'bg-[#F5F5F5] text-white':'text-[#666666] hover:text-[#1F1F1F]'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={()=>toast.success('Email sent!')} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#666666] hover:border-blue-500/30 hover:text-[#006AFF] transition-all flex items-center gap-1.5">
              📧 Email
            </button>
            <button onClick={handlePrint} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#666666] hover:border-blue-500/30 hover:text-[#006AFF] transition-all">
              🖨 Print
            </button>
            <button onClick={()=>toast.success('PDF downloaded')} className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#666666] hover:border-blue-500/30 hover:text-[#006AFF] transition-all">
              ⬇ PDF
            </button>
            <button onClick={handleRecordPayment}
              disabled={isLocked}
              className="bg-green-500 border-none rounded-lg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed">
              💰 Record Payment
            </button>
          </div>

          {/* A4 Preview */}
          <div className="flex-1 overflow-auto bg-[#F5F5F5] p-6 flex justify-center">
            <div ref={printRef} style={{fontFamily:'sans-serif'}}>
              {docView === 'invoice'
                ? <InvoiceA4 invoice={selected} />
                : <PackingSlipA4 invoice={selected} />
              }
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[#FAFAFA]">
          <div className="text-center text-[#999999]">
            <div className="text-5xl mb-4 opacity-20">📄</div>
            <div className="text-[14px]">Select an invoice to preview</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── A4 Invoice Document ──
function InvoiceA4({ invoice: inv }) {
  const items = inv.invoice_items || []
  const ss = STATUS_STYLE[inv.status]

  return (
    <div style={{
      width:'794px', minHeight:'1123px', background:'#fff',
      color:'#1a1a2e', padding:'48px', fontFamily:'Syne, sans-serif',
      boxShadow:'0 4px 40px rgba(0,0,0,0.4)', position:'relative'
    }}>
      {/* Header */}
      <div style={{display:'flex', justifyContent:'space-between', marginBottom:'32px'}}>
        <div>
          <div style={{fontSize:'22px', fontWeight:800}}>RetailPOS Store</div>
          <div style={{fontSize:'11px', color:'#666', marginTop:'6px', lineHeight:1.7}}>
            123 Main Street<br/>Los Angeles, CA 90001<br/>Tel: (213) 555-0100<br/>EIN: 12-3456789
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:'32px', fontWeight:800, color:'#3b82f6', letterSpacing:'-1px'}}>INVOICE</div>
          <div style={{fontFamily:'monospace', fontSize:'13px', color:'#666', marginTop:'4px'}}>{inv.invoice_number}</div>
          <div style={{fontFamily:'monospace', fontSize:'11px', color:'#999', marginTop:'2px'}}>
            Issue: {inv.issue_date ? new Date(inv.issue_date).toLocaleDateString() : '—'}
          </div>
          <div style={{fontFamily:'monospace', fontSize:'11px', color:'#999'}}>
            Due: {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
          </div>
          {inv.status && <div style={{marginTop:'6px', display:'inline-block', padding:'3px 10px', borderRadius:'5px', fontSize:'11px', fontWeight:700, background:ss?.bg, color:ss?.color}}>
            {ss?.label}
          </div>}
        </div>
      </div>

      {/* Status bar */}
      <div style={{background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:'8px', padding:'10px 16px', display:'flex', justifyContent:'space-between', marginBottom:'24px'}}>
        {[['Invoice Total', `$${inv.total?.toFixed(2)}`, '#3b82f6'],
          ['Amount Paid', `$${inv.amount_paid?.toFixed(2)||'0.00'}`, '#10b981'],
          ['Balance Due', `$${inv.balance_due?.toFixed(2)||inv.total?.toFixed(2)}`, '#f59e0b'],
        ].map(([l,v,c]) => (
          <div key={l} style={{textAlign:'center'}}>
            <div style={{fontSize:'9px', color:'#666', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'3px'}}>{l}</div>
            <div style={{fontSize:'14px', fontWeight:700, color:c}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Addresses */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'24px', marginBottom:'24px'}}>
        {[
          ['Bill To', inv.billing_address_snapshot || inv.customers],
          ['Ship To', inv.shipping_address_snapshot || inv.customers],
        ].map(([title, addr]) => (
          <div key={title}>
            <div style={{fontSize:'9px', letterSpacing:'2px', textTransform:'uppercase', color:'#999', marginBottom:'8px'}}>{title}</div>
            <div style={{fontSize:'14px', fontWeight:700}}>{inv.business_customers?.company_name||'—'}</div>
            <div style={{fontSize:'11px', color:'#666', marginTop:'4px', lineHeight:1.6}}>
              {typeof addr === 'object' && addr?.address ? addr.address : inv.business_customers?.contact_email||''}
            </div>
          </div>
        ))}
      </div>

      <div style={{height:'1px', background:'#e5e7eb', marginBottom:'20px'}}/>

      {/* Items table */}
      <table style={{width:'100%', borderCollapse:'collapse', marginBottom:'20px'}}>
        <thead>
          <tr style={{background:'#f8fafc', borderBottom:'2px solid #e5e7eb'}}>
            {['Description','Qty','Unit Price','Discount','Tax','Amount'].map(h => (
              <th key={h} style={{padding:'8px 12px', fontSize:'10px', textTransform:'uppercase', color:'#666', textAlign: h==='Description'?'left':'right', letterSpacing:'0.5px'}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={6} style={{padding:'20px', textAlign:'center', color:'#999', fontSize:'12px'}}>No items</td></tr>
          ) : items.map((item, i) => (
            <tr key={item.id||i} style={{borderBottom:'1px solid #f3f4f6'}}>
              <td style={{padding:'10px 12px', fontSize:'12px'}}>
                <div style={{fontWeight:600}}>{item.description}</div>
                {item.serial_number && <div style={{fontSize:'10px', color:'#9ca3af', marginTop:'2px'}}>SN: {item.serial_number}</div>}
              </td>
              <td style={{padding:'10px 12px', textAlign:'right', fontSize:'12px', fontFamily:'monospace'}}>{item.quantity} {item.unit}</td>
              <td style={{padding:'10px 12px', textAlign:'right', fontSize:'12px', fontFamily:'monospace'}}>${item.unit_price?.toFixed(2)}</td>
              <td style={{padding:'10px 12px', textAlign:'right', fontSize:'12px', fontFamily:'monospace', color:'#10b981'}}>
                {item.discount_pct > 0 ? `-${item.discount_pct}%` : '—'}
              </td>
              <td style={{padding:'10px 12px', textAlign:'right', fontSize:'12px', fontFamily:'monospace'}}>${item.tax_amount?.toFixed(2)||'0.00'}</td>
              <td style={{padding:'10px 12px', textAlign:'right', fontSize:'12px', fontFamily:'monospace', fontWeight:600}}>${item.line_total?.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{display:'flex', justifyContent:'flex-end', marginBottom:'24px'}}>
        <div style={{width:'280px'}}>
          {[
            ['Subtotal', `$${inv.subtotal?.toFixed(2)}`],
            ...(inv.discount_amount > 0 ? [['Discount', `-$${inv.discount_amount?.toFixed(2)}`]] : []),
            ['Tax', `$${inv.tax_amount?.toFixed(2)}`],
          ].map(([l,v]) => (
            <div key={l} style={{display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid #f3f4f6'}}>
              <span style={{fontSize:'12px', color:'#666'}}>{l}</span>
              <span style={{fontSize:'12px', fontFamily:'monospace', fontWeight:600}}>{v}</span>
            </div>
          ))}
          <div style={{display:'flex', justifyContent:'space-between', padding:'10px 0', marginTop:'4px', background:'#f8fafc', borderRadius:'6px'}}>
            <span style={{fontSize:'14px', fontWeight:800, color:'#1a1a2e'}}>TOTAL</span>
            <span style={{fontSize:'18px', fontFamily:'monospace', fontWeight:800, color:'#3b82f6'}}>${inv.total?.toFixed(2)}</span>
          </div>
          {inv.balance_due > 0 && (
            <div style={{display:'flex', justifyContent:'space-between', padding:'10px', marginTop:'6px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'6px'}}>
              <span style={{fontSize:'13px', fontWeight:800, color:'#92400e'}}>BALANCE DUE</span>
              <span style={{fontSize:'16px', fontFamily:'monospace', fontWeight:800, color:'#f59e0b'}}>${inv.balance_due?.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {inv.notes && (
        <div style={{background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'6px', padding:'12px', marginBottom:'16px', fontSize:'11px', color:'#92400e'}}>
          📝 {inv.notes}
        </div>
      )}
      <div style={{borderTop:'1px solid #e5e7eb', paddingTop:'14px', display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#9ca3af'}}>
        <div><strong style={{color:'#E5E5E5'}}>Payment Methods:</strong> Cash · Card · Check · Bank Transfer</div>
        <div style={{textAlign:'right'}}>Thank you for your business!</div>
      </div>
    </div>
  )
}

// ── A4 Packing Slip ──
function PackingSlipA4({ invoice: inv }) {
  const items = inv.invoice_items || []
  return (
    <div style={{width:'794px', minHeight:'600px', background:'#fff', color:'#1a1a2e', padding:'48px', fontFamily:'sans-serif', boxShadow:'0 4px 40px rgba(0,0,0,0.4)'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'24px', paddingBottom:'16px', borderBottom:'2px solid #1a1a2e'}}>
        <div>
          <div style={{fontSize:'28px', fontWeight:800, letterSpacing:'-1px'}}>PACKING SLIP</div>
          <div style={{fontSize:'12px', color:'#666', marginTop:'4px', fontFamily:'monospace'}}>
            {inv.invoice_number} · {new Date(inv.created_at).toLocaleDateString()}
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:'14px', fontWeight:700}}>RetailPOS Store</div>
          <div style={{fontSize:'11px', color:'#666', marginTop:'3px'}}>123 Main Street<br/>Los Angeles, CA 90001</div>
        </div>
      </div>

      <div style={{marginBottom:'20px'}}>
        <div style={{fontSize:'9px', letterSpacing:'2px', textTransform:'uppercase', color:'#999', marginBottom:'8px'}}>Ship To</div>
        <div style={{fontSize:'14px', lineHeight:1.7}}>
          <strong>{inv.business_customers?.company_name||'—'}</strong><br/>
          {inv.business_customers?.contact_email||''}
        </div>
      </div>

      <table style={{width:'100%', borderCollapse:'collapse'}}>
        <thead>
          <tr style={{background:'#f8fafc', borderBottom:'2px solid #e5e7eb'}}>
            {['Item Description','Unit','Quantity'].map((h,i) => (
              <th key={h} style={{padding:'10px 14px', fontSize:'10px', textTransform:'uppercase', color:'#666', letterSpacing:'0.5px', textAlign: i===2?'right':'left'}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id||i} style={{borderBottom:'1px solid #f3f4f6'}}>
              <td style={{padding:'11px 14px', fontSize:'13px', fontWeight:600}}>{item.description}</td>
              <td style={{padding:'11px 14px', fontSize:'13px'}}>{item.unit||'ea'}</td>
              <td style={{padding:'11px 14px', fontSize:'13px', fontFamily:'monospace', fontWeight:600, textAlign:'right'}}>{item.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{marginTop:'32px', borderTop:'1px solid #e5e7eb', paddingTop:'16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'24px'}}>
        {[['Packed By','Date'],['Received By','Date Received']].map(([l1,l2]) => (
          <div key={l1}>
            <div style={{fontSize:'9px', color:'#999', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'8px'}}>{l1}</div>
            <div style={{borderBottom:'1px solid #d1d5db', height:'28px', marginBottom:'6px'}}/>
            <div style={{fontSize:'9px', color:'#999', letterSpacing:'1px', textTransform:'uppercase', marginBottom:'8px'}}>{l2}</div>
            <div style={{borderBottom:'1px solid #d1d5db', height:'28px'}}/>
          </div>
        ))}
      </div>
      <div style={{marginTop:'20px', textAlign:'center', fontSize:'10px', color:'#9ca3af'}}>
        This packing slip does not show prices. Reference {inv.invoice_number} for invoice details.
      </div>
    </div>
  )
}
