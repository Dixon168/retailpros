// src/components/pos/OpenItemModal.jsx
import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import NumPad from '@/components/ui/NumPad'
import { TouchKeyboard } from '@/components/ui/TouchKeyboard'

export function OpenItemModal({ tenantId, onAdd, onClose }) {
  const [name,      setName]      = useState('Open Item')
  const [price,     setPrice]     = useState('')
  const [taxed,     setTaxed]     = useState(false)
  const [taxRateId, setTaxRateId] = useState('')
  const [showNumPad,setShowNumPad]= useState(false)
  const [showKB,    setShowKB]    = useState(false)
  const nameRef = useRef()

  useEffect(() => {
    // Select all text in name field on open
    setTimeout(() => { nameRef.current?.select() }, 100)
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

  const selectedTax = taxRates.find(t => t.id === taxRateId)
  const priceNum    = parseFloat(price) || 0
  const taxAmt      = taxed && selectedTax ? priceNum * selectedTax.rate : 0
  const totalAmt    = priceNum + taxAmt

  const handleAdd = () => {
    if (!price || priceNum <= 0) return

    // Build a pseudo-product object that cartStore can handle
    const item = {
      id:             `open-item-${Date.now()}`,
      name:           name.trim() || 'Open Item',
      price:          priceNum,
      unit:           'ea',
      type:           'unit',
      track_inventory: false,
      is_open_item:   true,
      tax_rate_id:    taxed ? taxRateId : null,
      tax_rate:       taxed ? selectedTax?.rate : 0,
      tax_name:       taxed ? selectedTax?.name : null,
    }
    onAdd(item)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{background:'rgba(15,23,42,0.65)', backdropFilter:'blur(6px)'}}
      onClick={onClose}>
      <div className="w-full rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl"
        style={{background:'#fff', maxWidth:'400px'}}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
          <div>
            <div className="text-[16px] font-bold text-white">✏️ Open Item</div>
            <div className="text-[11px] text-indigo-200 mt-0.5">Add custom product to cart</div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/20 border-none cursor-pointer text-white text-[16px]">
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">

          {/* Item Name */}
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Item Name
            </div>
            <button onClick={() => setShowKB(true)}
              className="w-full rounded-xl px-4 py-3 text-left cursor-pointer border-2 transition-all"
              style={{border:'2px solid #e2e8f0', background:'#f8fafc'}}>
              <span className="text-[15px] font-semibold" style={{color: name && name !== 'Open Item' ? '#1e293b' : '#94a3b8'}}>
                {name || 'Tap to enter name...'}
              </span>
            </button>
          </div>

          {/* Price */}
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Price *
            </div>
            <button onClick={() => setShowNumPad(true)}
              className="w-full rounded-xl px-4 py-3.5 text-left cursor-pointer border-2 transition-all"
              style={{
                border: price ? '2px solid #a5b4fc' : '2px dashed #e2e8f0',
                background: price ? '#eef2ff' : '#f8fafc',
              }}>
              {price ? (
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-indigo-400 font-semibold">$</span>
                  <span className="text-[28px] font-black font-mono" style={{color:'#6366f1'}}>
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
            <div className="flex flex-col gap-2">
              {/* No tax option */}
              <label className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
                style={{
                  background: !taxed ? '#f0fdf4' : '#f8fafc',
                  border: !taxed ? '2px solid #86efac' : '2px solid #e2e8f0',
                }}>
                <input type="radio" checked={!taxed} onChange={() => setTaxed(false)}
                  className="accent-green-500 w-4 h-4"/>
                <span className="text-[13px] font-semibold" style={{color: !taxed ? '#16a34a' : '#64748b'}}>
                  No Tax
                </span>
              </label>

              {/* Tax options */}
              {taxRates.map(tr => (
                <label key={tr.id}
                  className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
                  style={{
                    background: taxed && taxRateId === tr.id ? '#eff6ff' : '#f8fafc',
                    border: taxed && taxRateId === tr.id ? '2px solid #93c5fd' : '2px solid #e2e8f0',
                  }}>
                  <input type="radio"
                    checked={taxed && taxRateId === tr.id}
                    onChange={() => { setTaxed(true); setTaxRateId(tr.id) }}
                    className="accent-blue-500 w-4 h-4"/>
                  <div className="flex-1">
                    <span className="text-[13px] font-semibold"
                      style={{color: taxed && taxRateId === tr.id ? '#2563eb' : '#64748b'}}>
                      {tr.name}
                    </span>
                  </div>
                  <span className="text-[12px] font-mono font-bold"
                    style={{color: taxed && taxRateId === tr.id ? '#2563eb' : '#94a3b8'}}>
                    {(tr.rate * 100).toFixed(2)}%
                  </span>
                </label>
              ))}

              {taxRates.length === 0 && (
                <div className="text-[11px] text-slate-400 px-2">
                  No tax rates configured. Add them in Settings.
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          {price && (
            <div className="rounded-xl p-4" style={{background:'#f8fafc', border:'1px solid #e2e8f0'}}>
              <div className="flex justify-between text-[12px] text-slate-500 mb-1">
                <span>Price</span>
                <span className="font-mono">${priceNum.toFixed(2)}</span>
              </div>
              {taxed && selectedTax && (
                <div className="flex justify-between text-[12px] text-slate-500 mb-1">
                  <span>{selectedTax.name} ({(selectedTax.rate*100).toFixed(2)}%)</span>
                  <span className="font-mono">+${taxAmt.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-[15px] font-bold pt-2"
                style={{borderTop:'1px solid #e2e8f0', color:'#1e293b'}}>
                <span>Total</span>
                <span className="font-mono" style={{color:'#6366f1'}}>${totalAmt.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Add button */}
        <div className="px-5 pb-5">
          <button onClick={handleAdd}
            disabled={!price || priceNum <= 0}
            className="w-full rounded-2xl py-4 text-[15px] font-bold text-white cursor-pointer border-none disabled:opacity-40 transition-all"
            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow:'0 4px 16px rgba(99,102,241,0.35)'}}>
            + Add to Cart — ${totalAmt.toFixed(2)}
          </button>
        </div>
      </div>

      {/* Keyboard */}
      {showKB && (
        <TouchKeyboard
          title="Item Name"
          value={name}
          onChange={setName}
          placeholder="Open Item"
          onDone={() => setShowKB(false)}
          onClose={() => setShowKB(false)}
        />
      )}

      {/* NumPad */}
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
    </div>
  )
}
