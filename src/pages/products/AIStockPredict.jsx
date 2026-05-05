// src/pages/products/AIStockPredict.jsx
// AI inventory prediction panel - shown per product row
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

async function callClaudePredict(product, salesData, currentStock) {
  try {
    const totalQty  = salesData.reduce((s,r) => s+(r.quantity||0), 0)
    const daySpan   = salesData.length > 0
      ? Math.max(1, (Date.now() - new Date(salesData[salesData.length-1].created_at)) / 86400000)
      : 30
    const dailyAvg  = totalQty / daySpan

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `You are a retail inventory analyst. Analyze this product and give a brief prediction.

Product: ${product.name}
Unit: ${product.unit || 'ea'}
Current Stock: ${currentStock} ${product.unit || 'ea'}
Price: $${product.price}
Sales last 30 days: ${salesData.length} transactions, ${totalQty} units total
Daily average sold: ${dailyAvg.toFixed(1)} ${product.unit || 'ea'}/day

Respond with ONLY a JSON object (no markdown):
{
  "days_until_stockout": number or null (null if service/no sales),
  "status": "critical" | "low" | "ok" | "overstocked",
  "daily_avg": number,
  "reorder_qty": number,
  "insight": "one short sentence recommendation max 12 words",
  "action": "reorder_now" | "reorder_soon" | "monitor" | "clearance"
}`
        }]
      })
    })
    const d = await res.json()
    const text = d.content?.[0]?.text || '{}'
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch(e) {
    return null
  }
}

export function AIStockBadge({ product, onExpand, isExpanded }) {
  const qty = product.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0

  const { data: prediction, isLoading } = useQuery({
    queryKey: ['ai-predict', product.id],
    queryFn: async () => {
      const { data: sales } = await supabase.from('order_items')
        .select('quantity, created_at')
        .eq('product_id', product.id)
        .gte('created_at', new Date(Date.now()-30*86400000).toISOString())
        .order('created_at', { ascending: false })
      return callClaudePredict(product, sales||[], qty)
    },
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    enabled: product.type !== 'service' && product.track_inventory !== false,
    retry: 1,
  })

  if (product.type === 'service') return <td className="px-3 py-2"><span className="text-[11px] text-slate-300">—</span></td>

  const STATUS = {
    critical:    { bg:'#fee2e2', color:'#dc2626', dot:'🔴', label:'Critical' },
    low:         { bg:'#fff7ed', color:'#ea580c', dot:'🟠', label:'Low' },
    ok:          { bg:'#f0fdf4', color:'#16a34a', dot:'🟢', label:'Good' },
    overstocked: { bg:'#eff6ff', color:'#2563eb', dot:'🔵', label:'Overstocked' },
  }

  const s = prediction ? (STATUS[prediction.status] || STATUS.ok) : null

  return (
    <td className="px-3 py-2">
      <button onClick={onExpand}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 cursor-pointer border transition-all"
        style={isExpanded
          ? { background:'#1e293b', borderColor:'#334155', color:'#fff' }
          : { background: s?.bg||'#f8fafc', borderColor:'transparent', color: s?.color||'#94a3b8' }
        }>
        {isLoading ? (
          <span className="text-[10px] animate-pulse">🤖 ...</span>
        ) : prediction ? (
          <>
            <span className="text-[11px]">{s?.dot}</span>
            <span className="text-[10px] font-bold whitespace-nowrap">
              {prediction.days_until_stockout != null
                ? prediction.days_until_stockout <= 0 ? 'Out of stock'
                  : `${Math.round(prediction.days_until_stockout)}d left`
                : s?.label
              }
            </span>
          </>
        ) : (
          <span className="text-[10px] text-slate-400">🤖 Predict</span>
        )}
      </button>
    </td>
  )
}

export function AIStockPanel({ product, onClose }) {
  const qty = product.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const avgCost = product.inventory?.[0]?.avg_cost || product.cost || 0

  const qty2 = product.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0

  const { data: prediction, isLoading } = useQuery({
    queryKey: ['ai-predict', product.id],
    queryFn: async () => {
      const { data: sales } = await supabase.from('order_items')
        .select('quantity, created_at')
        .eq('product_id', product.id)
        .gte('created_at', new Date(Date.now()-30*86400000).toISOString())
        .order('created_at', { ascending: false })
      return callClaudePredict(product, sales||[], qty2)
    },
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    retry: 1,
  })

  const { data: salesHistory = [] } = useQuery({
    queryKey: ['ai-sales-hist', product.id],
    queryFn: async () => {
      const { data } = await supabase.from('order_items')
        .select('quantity, created_at')
        .eq('product_id', product.id)
        .gte('created_at', new Date(Date.now()-30*86400000).toISOString())
        .order('created_at', { ascending: true })
      return data || []
    },
  })

  // Build daily sales chart data
  const dailyMap = {}
  salesHistory.forEach(r => {
    const day = r.created_at?.split('T')[0]
    if (day) dailyMap[day] = (dailyMap[day]||0) + (r.quantity||0)
  })
  const last7 = [...Array(7)].map((_,i) => {
    const d = new Date(Date.now() - (6-i)*86400000)
    const key = d.toISOString().split('T')[0]
    return { day: d.toLocaleDateString([],{weekday:'short'}), qty: dailyMap[key]||0 }
  })
  const maxBar = Math.max(...last7.map(d=>d.qty), 1)

  const STATUS_CONFIG = {
    critical:    { bg:'#fef2f2', border:'#fca5a5', color:'#dc2626', label:'⚠️ Critical - Reorder Now',    btnBg:'#dc2626' },
    low:         { bg:'#fff7ed', border:'#fed7aa', color:'#ea580c', label:'🟠 Low Stock - Reorder Soon',   btnBg:'#ea580c' },
    ok:          { bg:'#f0fdf4', border:'#86efac', color:'#16a34a', label:'✅ Stock Level Good',           btnBg:'#16a34a' },
    overstocked: { bg:'#eff6ff', border:'#93c5fd', color:'#2563eb', label:'📦 Overstocked - Consider Sale', btnBg:'#2563eb' },
  }
  const sc = prediction ? (STATUS_CONFIG[prediction.status] || STATUS_CONFIG.ok) : null

  return (
    <tr>
      <td colSpan={11} className="p-0" style={{borderBottom:'2px solid #6366f1'}}>
        <div style={{background:'#0f172a'}}>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3 border-b" style={{borderColor:'#1e2d42'}}>
            <span className="text-[18px]">🤖</span>
            <div>
              <div className="text-[13px] font-bold text-white">AI Inventory Prediction</div>
              <div className="text-[11px] text-slate-400">{product.name} · Based on last 30 days sales</div>
            </div>
            <button onClick={onClose}
              className="ml-auto text-slate-500 hover:text-white bg-transparent border-none cursor-pointer text-[16px]">✕</button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8 gap-3">
              <div className="text-[22px] animate-spin">🤖</div>
              <div className="text-white text-[13px]">AI analyzing inventory patterns...</div>
            </div>
          ) : !prediction ? (
            <div className="text-center py-8 text-slate-400 text-[13px]">No prediction data available</div>
          ) : (
            <div className="p-5 grid gap-4" style={{gridTemplateColumns:'1fr 1fr'}}>

              {/* Left: Status + Metrics */}
              <div className="flex flex-col gap-3">
                {/* Status banner */}
                <div className="rounded-xl px-4 py-3" style={{background:sc?.bg, border:`1.5px solid ${sc?.border}`}}>
                  <div className="text-[14px] font-bold" style={{color:sc?.color}}>{sc?.label}</div>
                  {prediction.insight && (
                    <div className="text-[12px] mt-1" style={{color:sc?.color, opacity:0.8}}>{prediction.insight}</div>
                  )}
                </div>

                {/* Key metrics */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Current Stock',   `${qty} ${product.unit||'ea'}`,                        '#f8fafc', '#1e293b'],
                    ['Days Until Empty', prediction.days_until_stockout != null ? `${Math.round(Math.max(0,prediction.days_until_stockout))} days` : '—', '#fef9c3', '#ca8a04'],
                    ['Daily Avg Sales',  `${(prediction.daily_avg||0).toFixed(1)} ${product.unit||'ea'}/day`, '#f0f4ff', '#6366f1'],
                    ['Stock Value',      `$${(qty*avgCost).toFixed(2)}`,                        '#f0fdf4', '#16a34a'],
                  ].map(([label,value,bg,color]) => (
                    <div key={label} className="rounded-xl p-3" style={{background:bg, border:'1px solid #e2e8f0'}}>
                      <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{label}</div>
                      <div className="text-[16px] font-bold" style={{color}}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Reorder suggestion */}
                {(prediction.action === 'reorder_now' || prediction.action === 'reorder_soon') && (
                  <div className="rounded-xl p-3" style={{background:'#1e2d42', border:'1px solid #334155'}}>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">💡 AI Recommendation</div>
                    <div className="text-[13px] font-semibold text-white">
                      Reorder <span style={{color:'#86efac'}}>{prediction.reorder_qty} {product.unit||'ea'}</span>
                      {' '}({prediction.action === 'reorder_now' ? '2-week supply' : '2-week supply'})
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Est. cost: ${((prediction.reorder_qty||0) * avgCost).toFixed(2)}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: 7-day sales chart */}
              <div className="rounded-xl p-4" style={{background:'#1e2d42', border:'1px solid #334155'}}>
                <div className="text-[11px] font-semibold text-slate-400 mb-4">Sales — Last 7 Days</div>
                <div className="flex items-end gap-1.5 h-28">
                  {last7.map((d,i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[9px] font-mono text-slate-500">{d.qty>0?d.qty:''}</div>
                      <div className="w-full rounded-t transition-all"
                        style={{
                          height: `${Math.max(4, (d.qty/maxBar)*80)}px`,
                          background: d.qty > 0
                            ? 'linear-gradient(180deg,#6366f1,#8b5cf6)'
                            : '#334155',
                          minHeight: '4px',
                        }}/>
                      <div className="text-[9px] text-slate-500">{d.day}</div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-3 pt-3 border-t" style={{borderColor:'#334155'}}>
                  <div className="text-[10px] text-slate-400">
                    Total: <span className="text-white font-semibold">{last7.reduce((s,d)=>s+d.qty,0)} {product.unit}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Peak: <span className="text-indigo-400 font-semibold">{Math.max(...last7.map(d=>d.qty))} {product.unit}/day</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}
