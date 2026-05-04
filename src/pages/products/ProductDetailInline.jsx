// src/pages/products/ProductDetailInline.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ReceiveModal } from './ReceiveModal'
import { AdjustModal } from './AdjustModal'
import NumPad from '@/components/ui/NumPad'
import toast from 'react-hot-toast'

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const TYPE_COLOR = { sale:'#6366f1', bulk:'#16a34a', time:'#d97706' }
const TYPE_ICON  = { sale:'🏷️', bulk:'📦', time:'⏰' }
const TYPE_NAME  = { sale:'Sale Pricing', bulk:'Bulk Pricing', time:'Time Based' }

function Th({ children }) {
  return <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
    style={{color:'#64748b', background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>{children}</th>
}
function Td({ children, mono, bold, color, center }) {
  return <td className={`px-3 py-2.5 text-[12px] border-b ${mono?'font-mono':''} ${bold?'font-bold':''} ${center?'text-center':''}`}
    style={{color: color||'#374151', borderColor:'#f1f5f9'}}>{children}</td>
}
function Empty({ msg }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-slate-300">
      <div className="text-3xl mb-2">📭</div>
      <div className="text-[12px]">{msg}</div>
    </div>
  )
}

export function ProductDetailInline({ product: p, tenantId, onRefresh }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState('info')
  const [showReceive, setShowReceive] = useState(false)
  const [showAdjust, setShowAdjust]   = useState(false)
  const [editing, setEditing]         = useState(false)

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: p.name, price: p.price, cost: p.cost,
    sku: p.sku||'', upc: p.upc||'', description: p.description||'',
  })
  const setF = (k,v) => setEditForm(f=>({...f,[k]:v}))
  const [saving, setSaving] = useState(false)
  const [showPricePad, setShowPricePad] = useState(false)
  const [showCostPad,  setShowCostPad]  = useState(false)

  // Promotion state
  const [promoType,  setPromoType]  = useState('sale')
  const [promoAdding, setPromoAdding] = useState(false)
  const [promoSaving, setPromoSaving] = useState(false)
  const [saleStart,  setSaleStart]  = useState('')
  const [saleEnd,    setSaleEnd]    = useState('')
  const [saleType,   setSaleType]   = useState('fixed')
  const [saleVal,    setSaleVal]    = useState('')
  const [bulkQty,    setBulkQty]    = useState('')
  const [bulkType,   setBulkType]   = useState('fixed')
  const [bulkVal,    setBulkVal]    = useState('')
  const [timeDays,   setTimeDays]   = useState([])
  const [timeStart,  setTimeStart]  = useState('')
  const [timeEnd,    setTimeEnd]    = useState('')
  const [timeType,   setTimeType]   = useState('fixed')
  const [timeVal,    setTimeVal]    = useState('')

  const qty     = p.inventory?.reduce((a,i) => a+(i.quantity||0), 0) || 0
  const avgCost = p.inventory?.[0]?.avg_cost || p.cost || 0
  const margin  = p.price > 0 ? ((p.price - avgCost) / p.price * 100).toFixed(1) : '0.0'

  const { data: receives = [], isLoading: loadingR } = useQuery({
    queryKey: ['product-receives', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_receives')
        .select('*, suppliers(name)').eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab === 'receiving',
  })
  const { data: adjustments = [], isLoading: loadingA } = useQuery({
    queryKey: ['product-adjustments', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_adjustments')
        .select('*').eq('product_id', p.id)
        .order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab === 'adjustments',
  })
  const { data: sales = [], isLoading: loadingS } = useQuery({
    queryKey: ['product-sales', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('order_items')
        .select('*, orders(order_number, created_at, customers(name))')
        .eq('product_id', p.id).order('created_at', { ascending: false }).limit(50)
      return data || []
    },
    enabled: tab === 'sales',
  })
  const { data: promos = [], isLoading: loadingP } = useQuery({
    queryKey: ['product-promos', p.id],
    queryFn: async () => {
      const { data } = await supabase.from('promotions').select('*')
        .eq('product_id', p.id).order('created_at', { ascending: false })
      return data || []
    },
    enabled: tab === 'promotions',
  })

  const handleSaveEdit = async () => {
    if (!editForm.name || !editForm.price) { toast.error('Name and price required'); return }
    setSaving(true)
    try {
      await supabase.from('products').update({
        name: editForm.name,
        price: parseFloat(editForm.price),
        cost: parseFloat(editForm.cost)||0,
        sku: editForm.sku||null,
        upc: editForm.upc||null,
        description: editForm.description||null,
      }).eq('id', p.id)
      toast.success('Product updated ✓')
      setEditing(false)
      onRefresh()
    } catch(err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const togglePromo = async (promo) => {
    await supabase.from('promotions').update({ is_active: !promo.is_active }).eq('id', promo.id)
    qc.invalidateQueries(['product-promos', p.id])
    qc.invalidateQueries(['promotions'])
  }
  const deletePromo = async (id) => {
    if (!confirm('Delete this promotion?')) return
    await supabase.from('promotions').delete().eq('id', id)
    qc.invalidateQueries(['product-promos', p.id])
    qc.invalidateQueries(['promotions'])
    toast.success('Promotion deleted')
  }
  const savePromo = async () => {
    setPromoSaving(true)
    try {
      const base = { tenant_id: tenantId, product_id: p.id, type: promoType, is_active: true }
      let payload
      if (promoType==='sale') {
        if (!saleStart||!saleEnd||!saleVal) { toast.error('Fill all fields'); setPromoSaving(false); return }
        payload = { ...base, name:`${p.name} Sale`, sale_start:saleStart, sale_end:saleEnd, sale_type:saleType, sale_value:parseFloat(saleVal) }
      } else if (promoType==='bulk') {
        if (!bulkQty||!bulkVal) { toast.error('Fill qty and value'); setPromoSaving(false); return }
        payload = { ...base, name:`${p.name} Bulk`, bulk_tiers:[{min_qty:parseInt(bulkQty),type:bulkType,value:parseFloat(bulkVal)}] }
      } else {
        if (!timeDays.length||!timeStart||!timeEnd||!timeVal) { toast.error('Fill all fields'); setPromoSaving(false); return }
        payload = { ...base, name:`${p.name} Time`, time_rules:[{days:timeDays,start_time:timeStart,end_time:timeEnd,type:timeType,value:parseFloat(timeVal)}] }
      }
      await supabase.from('promotions').insert(payload)
      qc.invalidateQueries(['product-promos', p.id])
      qc.invalidateQueries(['promotions'])
      setPromoAdding(false)
      setSaleVal(''); setBulkQty(''); setBulkVal(''); setTimeVal(''); setTimeDays([])
      toast.success('Promotion added ✓')
    } catch(err) { toast.error(err.message) }
    finally { setPromoSaving(false) }
  }

  const TABS = [
    { id:'info',        label:'📋 Info',        action: null },
    { id:'receiving',   label:'📥 Receiving',   count: receives.length,   action: () => setShowReceive(true), actionLabel:'+Receive' },
    { id:'adjustments', label:'⚖️ Adjustments', count: adjustments.length,action: () => setShowAdjust(true),  actionLabel:'Adjust' },
    { id:'sales',       label:'💰 Sales',        count: sales.length,      action: null },
    { id:'promotions',  label:'🏷️ Promotions',  count: promos.length,     action: () => setPromoAdding(!promoAdding), actionLabel:'+Add' },
  ]

  const tabBg = { info:'#e0e7ff', receiving:'#dcfce7', adjustments:'#fef9c3', sales:'#dbeafe', promotions:'#fdf4ff' }
  const tabColor = { info:'#6366f1', receiving:'#16a34a', adjustments:'#ca8a04', sales:'#2563eb', promotions:'#9333ea' }

  return (
    <div style={{background:'#f8fafc', borderTop:`2px solid ${tabColor[tab]||'#6366f1'}`}}>

      {/* Tab bar */}
      <div className="flex items-center border-b px-3" style={{background:'#fff', borderColor:'#e2e8f0'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 py-2.5 px-3 text-[12px] border-b-2 cursor-pointer bg-transparent whitespace-nowrap transition-all"
            style={{
              borderBottomColor: tab===t.id ? tabColor[t.id] : 'transparent',
              color: tab===t.id ? tabColor[t.id] : '#64748b',
              fontWeight: tab===t.id ? 600 : 400,
            }}>
            {t.label}
            {t.count > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{background: tab===t.id ? tabBg[t.id] : '#f1f5f9', color: tab===t.id ? tabColor[t.id] : '#94a3b8'}}>
                {t.count}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1"/>
        {/* Tab action button */}
        {tab !== 'info' && TABS.find(t=>t.id===tab)?.action && (
          <button onClick={TABS.find(t=>t.id===tab).action}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border mr-2"
            style={{background: tabBg[tab], borderColor: `${tabColor[tab]}60`, color: tabColor[tab]}}>
            {TABS.find(t=>t.id===tab).actionLabel}
          </button>
        )}
        {tab === 'info' && (
          <button onClick={() => { setEditing(!editing); setEditForm({name:p.name,price:p.price,cost:p.cost,sku:p.sku||'',upc:p.upc||'',description:p.description||''}) }}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer border mr-2"
            style={editing ? {background:'#fff1f2',borderColor:'#fecdd3',color:'#e11d48'} : {background:'#e0e7ff',borderColor:'#a5b4fc',color:'#6366f1'}}>
            {editing ? '✕ Cancel' : '✏️ Edit'}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4" style={{maxHeight:'380px', overflowY:'auto'}}>

        {/* ── INFO / EDIT ── */}
        {tab === 'info' && !editing && (
          <div className="grid gap-3" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
            <InfoCard title="Product Info">
              {[['Name',p.name],['Type',p.type?.toUpperCase()],['Unit',p.unit||'ea'],['SKU',p.sku||'—'],['UPC',p.upc||'—'],['Category',p.subcategories?.categories?.name||'—'],['Subcategory',p.subcategories?.name||'—'],['Description',p.description||'—'],['Tags',p.tags?.join(', ')||'—']].map(([l,v])=><IR key={l} l={l} v={v}/>)}
            </InfoCard>
            <InfoCard title="Pricing">
              {[['Sell Price',`$${parseFloat(p.price||0).toFixed(2)}`],['Cost',`$${parseFloat(p.cost||0).toFixed(2)}`],['Avg Cost',`$${parseFloat(avgCost).toFixed(2)}`],['Margin',`${margin}%`],['Profit/ea',`$${(parseFloat(p.price||0)-avgCost).toFixed(2)}`],['Stock Value',`$${(qty*avgCost).toFixed(2)}`],['VIP',p.allow_vip?'Yes':'No'],['VIP Price',p.vip_price?`$${p.vip_price}`:'% discount']].map(([l,v])=><IR key={l} l={l} v={v}/>)}
            </InfoCard>
            <InfoCard title="Points & Commission">
              {[['Points Mode',p.points_mode==='fixed'?'Fixed':'$ → Points'],['Points Value',p.points_mode==='fixed'?`${p.points_fixed||0} pts`:`$1 = ${p.points_rate||1} pts`],['Commission',p.commission_type==='none'?'None':p.commission_type],['Comm. Value',p.commission_type!=='none'?`${p.commission_type==='fixed'?'$':''}${p.commission_value||0}${p.commission_type!=='fixed'?'%':''}`:'—']].map(([l,v])=><IR key={l} l={l} v={v}/>)}
            </InfoCard>
            <InfoCard title="Checkout Settings">
              {[['Prompt Weight',p.prompt_weight?'✅':'✗'],['Prompt Price',p.prompt_price?'✅':'✗'],['Prompt Staff',p.prompt_sales?'✅':'✗'],['Serial Numbers',p.has_serial?'✅':'✗'],['Track Inventory',p.track_inventory?'✅':'✗']].map(([l,v])=><IR key={l} l={l} v={v}/>)}
            </InfoCard>
          </div>
        )}

        {/* ── INLINE EDIT ── */}
        {tab === 'info' && editing && (
          <div className="grid gap-4" style={{gridTemplateColumns:'repeat(2,1fr)'}}>
            <div className="flex flex-col gap-3">
              <FRow label="Product Name *">
                <input value={editForm.name} onChange={e=>setF('name',e.target.value)} autoFocus
                  className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
              </FRow>
              <FRow label="SKU">
                <input value={editForm.sku} onChange={e=>setF('sku',e.target.value)} placeholder="e.g. APL-001"
                  className="w-full rounded-xl px-3 py-2 text-[12px] font-mono outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
              </FRow>
              <FRow label="UPC / Barcode">
                <input value={editForm.upc} onChange={e=>setF('upc',e.target.value)} placeholder="e.g. 012345678901"
                  className="w-full rounded-xl px-3 py-2 text-[12px] font-mono outline-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
              </FRow>
              <FRow label="Description">
                <textarea value={editForm.description} onChange={e=>setF('description',e.target.value)} rows={2}
                  className="w-full rounded-xl px-3 py-2 text-[12px] outline-none resize-none"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc'}}/>
              </FRow>
            </div>
            <div className="flex flex-col gap-3">
              <FRow label="Selling Price *">
                <button onClick={()=>setShowPricePad(true)}
                  className="w-full rounded-xl px-3 py-2.5 text-left text-[16px] font-bold font-mono cursor-pointer"
                  style={{border:'1.5px solid #a5b4fc', background:'#eef2ff', color:'#6366f1'}}>
                  ${parseFloat(editForm.price||0).toFixed(2)}
                </button>
              </FRow>
              <FRow label="Cost Price">
                <button onClick={()=>setShowCostPad(true)}
                  className="w-full rounded-xl px-3 py-2.5 text-left text-[14px] font-mono cursor-pointer"
                  style={{border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#374151'}}>
                  ${parseFloat(editForm.cost||0).toFixed(2)}
                </button>
              </FRow>
              {editForm.price && editForm.cost && (
                <div className="rounded-xl p-3 grid grid-cols-3 gap-2 text-center"
                  style={{background:'#f0fdf4', border:'1px solid #86efac'}}>
                  {[
                    ['Margin', `${((parseFloat(editForm.price)-parseFloat(editForm.cost||0))/parseFloat(editForm.price)*100).toFixed(1)}%`, '#16a34a'],
                    ['Profit', `$${(parseFloat(editForm.price)-parseFloat(editForm.cost||0)).toFixed(2)}`, '#6366f1'],
                    ['Cost', `$${parseFloat(editForm.cost||0).toFixed(2)}`, '#64748b'],
                  ].map(([l,v,c])=>(
                    <div key={l}>
                      <div className="text-[9px] text-slate-400 uppercase">{l}</div>
                      <div className="text-[14px] font-bold" style={{color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={handleSaveEdit} disabled={saving}
                className="w-full rounded-xl py-3 text-[13px] font-bold text-white cursor-pointer border-none disabled:opacity-50 mt-2"
                style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                {saving ? '⏳ Saving...' : '✓ Save Changes'}
              </button>
            </div>
          </div>
        )}

        {/* ── RECEIVING ── */}
        {tab === 'receiving' && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[['Total Received',`${receives.reduce((s,r)=>s+(r.qty||0),0)} ${p.unit}`,'#16a34a'],['In Stock',`${qty} ${p.unit}`,qty<=5?'#dc2626':'#1e293b'],['Avg Cost',`$${parseFloat(avgCost).toFixed(2)}`,'#6366f1']].map(([l,v,c])=>(
                <div key={l} className="rounded-xl p-3 text-center" style={{background:'#fff',border:'1px solid #e2e8f0'}}>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {loadingR ? <div className="text-center py-4 text-slate-400 text-[12px]">Loading...</div>
            : receives.length === 0 ? <Empty msg="No receiving history yet"/>
            : <table className="w-full border-collapse rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                <thead><tr><Th>Date</Th><Th>Vendor</Th><Th>Qty</Th><Th>Cost/Unit</Th><Th>Total</Th><Th>Notes</Th></tr></thead>
                <tbody>{receives.map((r,i)=>(
                  <tr key={i} className="hover:bg-blue-50/30">
                    <Td>{new Date(r.created_at).toLocaleDateString()}</Td>
                    <Td>{r.suppliers?.name||'—'}</Td>
                    <Td mono bold color="#16a34a">+{r.qty} {p.unit}</Td>
                    <Td mono>${parseFloat(r.cost||0).toFixed(2)}</Td>
                    <Td mono bold color="#6366f1">${(r.qty*(r.cost||0)).toFixed(2)}</Td>
                    <Td color="#94a3b8">{r.notes||'—'}</Td>
                  </tr>
                ))}</tbody>
              </table>}
          </>
        )}

        {/* ── ADJUSTMENTS ── */}
        {tab === 'adjustments' && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[['Net Adjustment',`${adjustments.reduce((s,r)=>s+(r.qty_change||0),0)>0?'+':''}${adjustments.reduce((s,r)=>s+(r.qty_change||0),0)}`,adjustments.reduce((s,r)=>s+(r.qty_change||0),0)>=0?'#16a34a':'#dc2626'],['In Stock',`${qty} ${p.unit}`,qty<=5?'#dc2626':'#1e293b'],['Count',adjustments.length,'#6366f1']].map(([l,v,c])=>(
                <div key={l} className="rounded-xl p-3 text-center" style={{background:'#fff',border:'1px solid #e2e8f0'}}>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {loadingA ? <div className="text-center py-4 text-slate-400 text-[12px]">Loading...</div>
            : adjustments.length === 0 ? <Empty msg="No adjustments yet"/>
            : <table className="w-full border-collapse rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                <thead><tr><Th>Date</Th><Th>Change</Th><Th>Before</Th><Th>After</Th><Th>Reason</Th></tr></thead>
                <tbody>{adjustments.map((r,i)=>(
                  <tr key={i} className="hover:bg-blue-50/30">
                    <Td>{new Date(r.created_at).toLocaleDateString()}</Td>
                    <Td mono bold color={r.qty_change>=0?'#16a34a':'#dc2626'}>{r.qty_change>=0?'+':''}{r.qty_change}</Td>
                    <Td mono color="#94a3b8">{r.qty_before}</Td>
                    <Td mono bold>{r.qty_after}</Td>
                    <Td>{r.reason}</Td>
                  </tr>
                ))}</tbody>
              </table>}
          </>
        )}

        {/* ── SALES ── */}
        {tab === 'sales' && (
          <>
            <div className="grid grid-cols-4 gap-3 mb-3">
              {[['Units Sold',`${sales.reduce((s,r)=>s+(r.quantity||0),0)} ${p.unit}`,'#6366f1'],['Revenue',`$${sales.reduce((s,r)=>s+(r.line_total||0),0).toFixed(2)}`,'#16a34a'],['Transactions',sales.length,'#1e293b'],['In Stock',`${qty} ${p.unit}`,qty<=5?'#dc2626':'#1e293b']].map(([l,v,c])=>(
                <div key={l} className="rounded-xl p-3 text-center" style={{background:'#fff',border:'1px solid #e2e8f0'}}>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">{l}</div>
                  <div className="text-[16px] font-bold" style={{color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {loadingS ? <div className="text-center py-4 text-slate-400 text-[12px]">Loading...</div>
            : sales.length === 0 ? <Empty msg="No sales yet"/>
            : <table className="w-full border-collapse rounded-xl overflow-hidden" style={{border:'1px solid #e2e8f0'}}>
                <thead><tr><Th>Date</Th><Th>Order #</Th><Th>Customer</Th><Th>Qty</Th><Th>Unit Price</Th><Th>Total</Th></tr></thead>
                <tbody>{sales.map((r,i)=>(
                  <tr key={i} className="hover:bg-blue-50/30">
                    <Td>{new Date(r.orders?.created_at).toLocaleDateString()}</Td>
                    <Td mono color="#6366f1">{r.orders?.order_number||'—'}</Td>
                    <Td>{r.orders?.customers?.name||'Walk-in'}</Td>
                    <Td mono bold>{r.quantity} {p.unit}</Td>
                    <Td mono>${parseFloat(r.unit_price||0).toFixed(2)}</Td>
                    <Td mono bold color="#16a34a">${parseFloat(r.line_total||0).toFixed(2)}</Td>
                  </tr>
                ))}</tbody>
              </table>}
          </>
        )}

        {/* ── PROMOTIONS ── */}
        {tab === 'promotions' && (
          <div>
            {/* Running promotions list */}
            {loadingP ? <div className="text-center py-4 text-slate-400 text-[12px]">Loading...</div>
            : promos.length === 0 && !promoAdding ? <Empty msg="No promotions yet — click +Add to create"/>
            : promos.length > 0 && (
              <div className="flex flex-col gap-2 mb-4">
                {promos.map(promo => (
                  <div key={promo.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                    style={{background:'#fff', border:`1.5px solid ${promo.is_active?(TYPE_COLOR[promo.type]||'#6366f1')+'40':'#e2e8f0'}`}}>
                    <span className="text-[18px]">{TYPE_ICON[promo.type]||'🏷️'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-slate-700">{promo.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                          style={{background: TYPE_COLOR[promo.type]+'15', color: TYPE_COLOR[promo.type]}}>
                          {TYPE_NAME[promo.type]}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {promo.type==='sale' && `${promo.sale_type==='pct'?`${promo.sale_value}% off`:`$${promo.sale_value}`} · ${new Date(promo.sale_start).toLocaleDateString()} → ${new Date(promo.sale_end).toLocaleDateString()}`}
                        {promo.type==='bulk' && (promo.bulk_tiers||[]).map(t=>`Buy ${t.min_qty}+: ${t.type==='fixed'?`$${t.value}/ea`:`${t.value}% off`}`).join(' · ')}
                        {promo.type==='time' && (promo.time_rules||[]).map(r=>`${(r.days||[]).map(d=>DAYS[d]).join(',')} ${r.start_time}-${r.end_time}`).join(' · ')}
                      </div>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${promo.is_active?'bg-green-100 text-green-700':'bg-slate-100 text-slate-400'}`}>
                      {promo.is_active?'● ACTIVE':'● PAUSED'}
                    </span>
                    <button onClick={()=>togglePromo(promo)}
                      className="text-[10px] px-2.5 py-1 rounded-lg border cursor-pointer"
                      style={promo.is_active?{background:'#fff1f2',borderColor:'#fecdd3',color:'#e11d48'}:{background:'#dcfce7',borderColor:'#86efac',color:'#16a34a'}}>
                      {promo.is_active?'Pause':'On'}
                    </button>
                    <button onClick={()=>deletePromo(promo.id)}
                      className="text-slate-400 hover:text-red-500 bg-transparent border-none cursor-pointer text-[14px]">✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Add promotion form */}
            {promoAdding && (
              <div className="rounded-xl p-4" style={{background:'#f8fafc', border:'1.5px solid #e2e8f0'}}>
                <div className="text-[11px] font-bold text-slate-600 mb-3">New Promotion</div>
                {/* Type tabs */}
                <div className="flex gap-2 mb-4">
                  {[['sale','🏷️ Sale'],['bulk','📦 Bulk'],['time','⏰ Time']].map(([t,l])=>(
                    <button key={t} onClick={()=>setPromoType(t)}
                      className="flex-1 py-2 rounded-xl text-[11px] font-bold cursor-pointer border-2 transition-all"
                      style={promoType===t?{background:`${TYPE_COLOR[t]}12`,borderColor:TYPE_COLOR[t],color:TYPE_COLOR[t]}:{background:'#fff',borderColor:'#e2e8f0',color:'#64748b'}}>
                      {l}
                    </button>
                  ))}
                </div>

                {promoType==='sale' && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div><div className="text-[10px] text-slate-500 mb-1">Start</div>
                        <input type="datetime-local" value={saleStart} onChange={e=>setSaleStart(e.target.value)}
                          className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none" style={{border:'1.5px solid #c7d2fe',background:'#fff'}}/></div>
                      <div><div className="text-[10px] text-slate-500 mb-1">End</div>
                        <input type="datetime-local" value={saleEnd} onChange={e=>setSaleEnd(e.target.value)}
                          className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none" style={{border:'1.5px solid #c7d2fe',background:'#fff'}}/></div>
                    </div>
                    <div className="flex gap-2">
                      <select value={saleType} onChange={e=>setSaleType(e.target.value)}
                        className="rounded-lg px-2 py-2 text-[11px] outline-none" style={{border:'1.5px solid #c7d2fe',background:'#fff'}}>
                        <option value="fixed">$ Fixed Price</option>
                        <option value="pct">% Off</option>
                      </select>
                      <input type="number" value={saleVal} onChange={e=>setSaleVal(e.target.value)}
                        placeholder={saleType==='fixed'?'Sale price':'% off'} step="0.01"
                        className="flex-1 rounded-lg px-3 py-2 text-[12px] font-mono outline-none" style={{border:'1.5px solid #c7d2fe',background:'#fff'}}/>
                    </div>
                    {saleVal && <div className="text-[11px] flex items-center gap-2">
                      <span className="line-through text-slate-400">${parseFloat(p.price||0).toFixed(2)}</span>
                      <span className="font-bold text-indigo-600">→ ${saleType==='fixed'?parseFloat(saleVal).toFixed(2):(parseFloat(p.price||0)*(1-parseFloat(saleVal)/100)).toFixed(2)}</span>
                    </div>}
                  </div>
                )}

                {promoType==='bulk' && (
                  <div className="flex gap-2 items-center">
                    <span className="text-[11px] text-slate-600 whitespace-nowrap">Buy</span>
                    <input type="number" value={bulkQty} onChange={e=>setBulkQty(e.target.value)} placeholder="2" min="2"
                      className="w-16 rounded-lg px-2 py-2 text-[12px] font-mono outline-none" style={{border:'1.5px solid #86efac',background:'#fff'}}/>
                    <span className="text-[11px] text-slate-500">or more →</span>
                    <select value={bulkType} onChange={e=>setBulkType(e.target.value)}
                      className="rounded-lg px-2 py-2 text-[11px] outline-none" style={{border:'1.5px solid #86efac',background:'#fff'}}>
                      <option value="fixed">$ Each</option>
                      <option value="pct">% Off</option>
                    </select>
                    <input type="number" value={bulkVal} onChange={e=>setBulkVal(e.target.value)} placeholder="8.00" step="0.01"
                      className="flex-1 rounded-lg px-2 py-2 text-[12px] font-mono outline-none" style={{border:'1.5px solid #86efac',background:'#fff'}}/>
                  </div>
                )}

                {promoType==='time' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-1.5">
                      {DAYS.map((d,i)=>(
                        <button key={i} onClick={()=>setTimeDays(ds=>ds.includes(i)?ds.filter(x=>x!==i):[...ds,i].sort())}
                          className="w-9 h-8 rounded-lg text-[10px] font-bold cursor-pointer border-2 transition-all"
                          style={timeDays.includes(i)?{background:'#f59e0b',borderColor:'#f59e0b',color:'#fff'}:{background:'#fff',borderColor:'#e2e8f0',color:'#64748b'}}>
                          {d.substring(0,2)}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 items-center">
                      <input type="time" value={timeStart} onChange={e=>setTimeStart(e.target.value)}
                        className="rounded-lg px-2 py-1.5 text-[11px] outline-none" style={{border:'1.5px solid #fde047',background:'#fff'}}/>
                      <span className="text-slate-400 text-[11px]">to</span>
                      <input type="time" value={timeEnd} onChange={e=>setTimeEnd(e.target.value)}
                        className="rounded-lg px-2 py-1.5 text-[11px] outline-none" style={{border:'1.5px solid #fde047',background:'#fff'}}/>
                      <select value={timeType} onChange={e=>setTimeType(e.target.value)}
                        className="rounded-lg px-2 py-1.5 text-[11px] outline-none" style={{border:'1.5px solid #fde047',background:'#fff'}}>
                        <option value="fixed">$ Price</option>
                        <option value="pct">% Off</option>
                      </select>
                      <input type="number" value={timeVal} onChange={e=>setTimeVal(e.target.value)} placeholder="3.00" step="0.01"
                        className="w-20 rounded-lg px-2 py-1.5 text-[11px] font-mono outline-none" style={{border:'1.5px solid #fde047',background:'#fff'}}/>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-3">
                  <button onClick={()=>{setPromoAdding(false);setSaleVal('');setBulkQty('');setBulkVal('');setTimeVal('');setTimeDays([])}}
                    className="flex-1 rounded-xl py-2 text-[12px] text-slate-500 cursor-pointer border border-slate-200 bg-white">Cancel</button>
                  <button onClick={savePromo} disabled={promoSaving}
                    className="flex-[2] rounded-xl py-2 text-[12px] font-bold text-white cursor-pointer border-none disabled:opacity-50"
                    style={{background:`linear-gradient(135deg,${TYPE_COLOR[promoType]},${TYPE_COLOR[promoType]}dd)`}}>
                    {promoSaving?'⏳ Saving...':'✓ Add Promotion'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showReceive && (
        <ReceiveModal product={p} tenantId={tenantId}
          onSave={() => { qc.invalidateQueries(['product-receives',p.id]); onRefresh(); setShowReceive(false) }}
          onClose={() => setShowReceive(false)}/>
      )}
      {showAdjust && (
        <AdjustModal product={p} tenantId={tenantId}
          onSave={() => { qc.invalidateQueries(['product-adjustments',p.id]); onRefresh(); setShowAdjust(false) }}
          onClose={() => setShowAdjust(false)}/>
      )}
      {showPricePad && (
        <NumPad title="Selling Price" subtitle={p.name}
          value={String(editForm.price||'')} onChange={v=>setF('price',v)}
          prefix="$" allowNegative={false} allowDecimal={true}
          onConfirm={v=>{setF('price',v);setShowPricePad(false)}}
          onClose={()=>setShowPricePad(false)}/>
      )}
      {showCostPad && (
        <NumPad title="Cost Price" subtitle={p.name}
          value={String(editForm.cost||'')} onChange={v=>setF('cost',v)}
          prefix="$" allowNegative={false} allowDecimal={true}
          onConfirm={v=>{setF('cost',v);setShowCostPad(false)}}
          onClose={()=>setShowCostPad(false)}/>
      )}
    </div>
  )
}

function InfoCard({ title, children }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{background:'#fff', border:'1px solid #e2e8f0'}}>
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
        style={{background:'#f8fafc', borderBottom:'1px solid #f1f5f9', color:'#64748b'}}>{title}</div>
      <div className="px-3 py-2">{children}</div>
    </div>
  )
}
function IR({ l, v }) {
  return (
    <div className="flex justify-between items-start py-1" style={{borderBottom:'1px solid #f8fafc'}}>
      <span className="text-[11px] text-slate-400">{l}</span>
      <span className="text-[11px] font-semibold text-right ml-2 text-slate-700">{v}</span>
    </div>
  )
}
function FRow({ label, children }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  )
}
