// src/pages/inventory/CountModal.jsx
// "Count" — physical stocktake. User enters the actual quantity they counted.
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { NumericKeypad, QWERTYKeyboard } from '@/components/ui/TouchKeyboards'

export default function CountModal({ product, currentQty, tenantId, storeId, userId, onClose, onSaved }) {
  const [counted, setCounted] = useState(String(currentQty))
  const [notes, setNotes]     = useState('')
  const [showPad, setShowPad]   = useState(false)
  const [showNotesKB, setShowNotesKB] = useState(false)
  const [saving, setSaving]   = useState(false)

  const newQty = parseFloat(counted) || 0
  const diff   = newQty - currentQty

  const save = async () => {
    if (counted === '' || counted === String(currentQty)) {
      toast.error('No change to save')
      return
    }
    setSaving(true)
    const { data, error } = await supabase.rpc('fn_adjust_inventory', {
      p_tenant_id: tenantId, p_store_id: storeId, p_product_id: product.id,
      p_new_qty: newQty, p_reason: 'Stocktake',
      p_notes: notes || null, p_user_id: userId || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    if (!data?.success) { toast.error(data?.message || 'Failed'); return }
    toast.success(`${product.name} counted: ${currentQty} → ${newQty}`)
    onSaved()
  }

  return (
    <>
      <div className="fixed inset-0 z-[450] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.45)'}}>
        <div className="rounded-2xl overflow-hidden" style={{
          width:'440px', maxWidth:'100%', background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.25)'
        }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{borderBottom:'1px solid #E5E5E5'}}>
            <div>
              <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider">🔢 Stocktake</div>
              <div className="text-[15px] font-bold text-[#1F1F1F] truncate" style={{maxWidth:'320px'}}>{product.name}</div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]" style={{background:'#F5F5F5', border:'none'}}>✕</button>
          </div>

          <div className="p-5 space-y-4">
            <div className="rounded-lg p-4" style={{background:'#F5F5F5', border:'1px solid #E5E5E5'}}>
              <div className="text-[11px] font-bold text-[#666] uppercase tracking-wider mb-1">System has</div>
              <div className="text-[24px] font-bold font-mono text-[#1F1F1F]">{currentQty}</div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">You counted (actual quantity)</div>
              <button onClick={() => setShowPad(true)}
                className="w-full text-left px-4 py-4 rounded-lg cursor-pointer"
                style={{background:'#FFFFFF', border:'2px solid #006AFF'}}>
                <div className="text-[10px] text-[#006AFF] font-bold uppercase">Tap to enter actual count</div>
                <div className="flex items-baseline gap-3">
                  <span className="text-[32px] font-bold font-mono text-[#1F1F1F]">{counted || '0'}</span>
                  {diff !== 0 && counted !== '' && (
                    <span className="text-[14px] font-bold font-mono"
                      style={{color: diff > 0 ? '#15803D' : '#CF1322'}}>
                      ({diff > 0 ? '+' : ''}{diff} difference)
                    </span>
                  )}
                </div>
              </button>
            </div>

            {diff !== 0 && counted !== '' && (
              <div className="rounded-lg px-3 py-2 text-[12px]"
                style={{
                  background: diff < 0 ? '#FEE2E2' : '#FEF3C7',
                  color: diff < 0 ? '#CF1322' : '#B45309',
                  border: `1px solid ${diff < 0 ? '#FECACA' : '#FCD34D'}`,
                }}>
                {diff < 0
                  ? `${Math.abs(diff)} units missing — possible loss, theft, or sale not recorded`
                  : `${diff} units extra — possible found stock or receive not recorded`}
              </div>
            )}

            <div>
              <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">Notes <span className="font-normal text-[#999]">(optional)</span></div>
              <button onClick={() => setShowNotesKB(true)}
                className="w-full text-left bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg px-3 py-2.5 text-[13px] cursor-pointer"
                style={{color: notes ? '#1F1F1F' : '#999'}}>
                {notes || 'Tap to add notes...'}
              </button>
            </div>
          </div>

          <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
            <button onClick={onClose}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>Cancel</button>
            <button onClick={save} disabled={saving || counted === '' || counted === String(currentQty)}
              className="flex-1 rounded-lg py-3 text-[13px] font-bold cursor-pointer disabled:opacity-40"
              style={{background:'#006AFF', color:'#FFFFFF', border:'none'}}>
              {saving ? 'Saving...' : 'Save Count'}
            </button>
          </div>
        </div>
      </div>

      {showPad && (
        <NumericKeypad value={counted} onChange={setCounted} onClose={() => setShowPad(false)}
          title="Enter actual count" placeholder="0" formatPhone={false} allowPlus={false}/>
      )}
      {showNotesKB && (
        <QWERTYKeyboard value={notes} onChange={setNotes} onClose={() => setShowNotesKB(false)}
          title="Stocktake notes" placeholder="Anything special about this count?"/>
      )}
    </>
  )
}
