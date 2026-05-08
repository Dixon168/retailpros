// src/components/pos/OpenItemModal.jsx
import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import NumPad from '@/components/ui/NumPad'

export function OpenItemModal({ tenantId, onAdd, onClose }) {
  const [name,       setName]       = useState('')
  const [price,      setPrice]      = useState('')
  const [taxRateId,  setTaxRateId]  = useState('none') // 'none' | tax id
  const [showNumPad, setShowNumPad] = useState(false)
  const nameRef = useRef()

  useEffect(() => {
    setTimeout(() => { nameRef.current?.focus() }, 100)
  }, [])

  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tax_rates')
        .select('id, name, rate').eq('tenant_id', tenantId)
      return data || []
    },
    enabled: !!tenantId,
  })

  const selectedTax = taxRateId !== 'none' ? taxRates.find(t => t.id === taxRateId) : null
  const priceNum    = parseFloat(price) || 0
  const taxAmt      = selectedTax ? priceNum * selectedTax.rate : 0
  const totalAmt    = priceNum + taxAmt

  const handleAdd = () => {
    if (!price || priceNum <= 0) return
    onAdd({
      id:              `open-item-${Date.now()}`,
      name:            name.trim() || 'Open Item',
      price:           priceNum,
      unit:            'ea',
      track_inventory: false,
      is_open_item:    true,
      tax_rate_id:     selectedTax?.id || null,
      tax_rate:        selectedTax?.rate || 0,
      tax_name:        selectedTax?.name || null,
    })
  }

  return (
    <>
    {/* Backdrop - no close on click */}
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}>
      <div className="rounded-xl overflow-hidden shadow-md"
        style={{background:'#fff', width:'420px', maxHeight:'90vh', overflowY:'auto'}}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'#000000'}}>
          <div>
            <div className="text-[16px] font-bold text-white">✏️ Open Item</div>
            <div className="text-[11px] text-indigo-200">Custom product</div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 border-none cursor-pointer text-white text-[16px] flex items-center justify-center">
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">

          {/* Item Name - direct input */}
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Item Name
            </div>
            <input
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Open Item"
              className="w-full rounded-xl px-4 py-3 text-[15px] font-semibold outline-none"
              style={{border:'2px solid #80B2FF', background:'#f8f9ff', color:'#1e293b'}}
            />
          </div>

          {/* Price */}
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Price *
            </div>
            <button onClick={() => setShowNumPad(true)}
              className="w-full rounded-xl px-4 py-3.5 text-left cursor-pointer border-2 transition-all"
              style={{
                border: price ? '2px solid #80B2FF' : '2px dashed #e2e8f0',
                background: price ? '#E6F0FF' : '#f8fafc',
              }}>
              {price ? (
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-indigo-400 font-semibold">$</span>
                  <span className="text-[28px] font-black font-mono" style={{color:'#006AFF'}}>
                    {parseFloat(price).toFixed(2)}
                  </span>
                </div>
              ) : (
                <span className="text-[15px] text-slate-400">Tap to enter price...</span>
              )}
            </button>
          </div>

          {/* Tax */}
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Tax
            </div>
            <div className="flex flex-wrap gap-2">
              {/* No Tax */}
              <button
                onClick={() => setTaxRateId('none')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl cursor-pointer border-2 transition-all"
                style={{
                  background: taxRateId==='none' ? '#f0fdf4' : '#f8fafc',
                  borderColor: taxRateId==='none' ? '#86efac' : '#e2e8f0',
                }}>
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${taxRateId==='none' ? 'border-green-500 bg-green-500' : 'border-slate-300'}`}>
                  {taxRateId==='none' && <div className="w-2 h-2 rounded-full bg-white"/>}
                </div>
                <span className="text-[13px] font-semibold" style={{color: taxRateId==='none' ? '#16a34a' : '#64748b'}}>
                  No Tax
                </span>
              </button>

              {/* Tax options */}
              {taxRates.map((tr, i) => (
                <button key={tr.id}
                  onClick={() => setTaxRateId(tr.id)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl cursor-pointer border-2 transition-all"
                  style={{
                    background: taxRateId===tr.id ? '#eff6ff' : '#f8fafc',
                    borderColor: taxRateId===tr.id ? '#93c5fd' : '#e2e8f0',
                  }}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${taxRateId===tr.id ? 'border-blue-500 bg-blue-500' : 'border-slate-300'}`}>
                    {taxRateId===tr.id && <div className="w-2 h-2 rounded-full bg-white"/>}
                  </div>
                  <span className="text-[13px] font-semibold" style={{color: taxRateId===tr.id ? '#2563eb' : '#64748b'}}>
                    {tr.name}
                  </span>
                  <span className="text-[11px] font-bold font-mono px-1.5 py-0.5 rounded"
                    style={{background: taxRateId===tr.id ? '#dbeafe' : '#f1f5f9', color: taxRateId===tr.id ? '#2563eb' : '#94a3b8'}}>
                    {(tr.rate*100).toFixed(0)}%
                  </span>
                </button>
              ))}
            </div>
            {taxRates.length === 0 && (
              <div className="text-[11px] text-slate-400 mt-1">
                No tax rates — add in Settings
              </div>
            )}
          </div>

          {/* Summary */}
          {price && (
            <div className="rounded-xl p-4" style={{background:'#E6F0FF', border:'1.5px solid #B3D1FF'}}>
              <div className="flex justify-between text-[12px] text-slate-500 mb-1">
                <span>Price</span>
                <span className="font-mono">${priceNum.toFixed(2)}</span>
              </div>
              {selectedTax && (
                <div className="flex justify-between text-[12px] text-slate-500 mb-1">
                  <span>{selectedTax.name} ({(selectedTax.rate*100).toFixed(0)}%)</span>
                  <span className="font-mono text-blue-600">+${taxAmt.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-[15px] font-bold pt-2"
                style={{borderTop:'1px solid #B3D1FF', color:'#1e293b'}}>
                <span>Total</span>
                <span className="font-mono" style={{color:'#006AFF'}}>${totalAmt.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Add button */}
          <button onClick={handleAdd}
            disabled={!price || priceNum <= 0}
            className="w-full rounded-2xl py-4 text-[15px] font-bold text-white cursor-pointer border-none disabled:opacity-40"
            style={{background:'#000000', boxShadow:'0 4px 16px rgba(99,102,241,0.3)'}}>
            + Add to Cart — ${totalAmt.toFixed(2)}
          </button>
        </div>
      </div>
    </div>

    {/* NumPad - centered */}
    {showNumPad && (
      <NumPad
        title="Enter Price"
        subtitle={name || 'Open Item'}
        value={price}
        onChange={setPrice}
        prefix="$"
        allowNegative={false}
        allowDecimal={true}
        onConfirm={v => { setPrice(String(v)); setShowNumPad(false) }}
        onClose={() => setShowNumPad(false)}
      />
    )}
    </>
  )
}
