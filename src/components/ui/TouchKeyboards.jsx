// src/components/ui/TouchKeyboards.jsx
// Square-style touchscreen keyboards: white background, 8px radius, black/blue accents

import { useState } from 'react'

export function QWERTYKeyboard({ value, onChange, onClose, title='Enter Text', mode='text', placeholder='' }) {
  const [shift, setShift] = useState(false)

  const press = (k) => onChange((value || '') + k)
  const back  = () => onChange((value || '').slice(0, -1))
  const space = () => onChange((value || '') + ' ')

  const letterRows = shift
    ? [['Q','W','E','R','T','Y','U','I','O','P'],
       ['A','S','D','F','G','H','J','K','L'],
       ['Z','X','C','V','B','N','M']]
    : [['q','w','e','r','t','y','u','i','o','p'],
       ['a','s','d','f','g','h','j','k','l'],
       ['z','x','c','v','b','n','m']]

  const numberRow = ['1','2','3','4','5','6','7','8','9','0']

  const Key = ({ label, onClick, wide, danger, accent }) => {
    const styles = danger
      ? { background:'#FFFFFF', color:'#CF1322', border:'1px solid #E5E5E5' }
      : accent
      ? { background:'#FFFFFF', color:'#006AFF', border:'1px solid #E5E5E5', fontWeight:700 }
      : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }
    return (
      <button onClick={onClick}
        className={`${wide ? 'flex-[2]' : 'flex-1'} h-14 rounded-lg text-[18px] font-semibold cursor-pointer active:scale-[0.96] transition-transform select-none`}
        style={styles}>
        {label}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.45)'}}>
      <div className="w-full max-w-[760px] rounded-2xl max-h-[92vh] overflow-y-auto"
        style={{background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.25)'}}>

        <div className="px-6 py-4 flex items-center justify-between"
          style={{borderBottom:'1px solid #E5E5E5'}}>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{color:'#666666'}}>{title}</div>
            <div className="text-[22px] font-mono truncate min-h-[30px]" style={{color:'#1F1F1F'}}>
              {value || <span style={{color:'#999999'}}>{placeholder}</span>}
              <span style={{color:'#006AFF'}} className="animate-pulse">|</span>
            </div>
          </div>
          <button onClick={onClose}
            className="w-10 h-10 rounded-lg cursor-pointer text-[18px] flex items-center justify-center flex-shrink-0"
            style={{background:'#F5F5F5', color:'#666666', border:'none'}}>
            ✕
          </button>
        </div>

        {mode === 'email' && (
          <div className="px-3 pt-3 flex gap-1.5 flex-wrap">
            {['@gmail.com','@yahoo.com','@outlook.com','@icloud.com','@hotmail.com'].map(d => (
              <button key={d} onClick={() => onChange((value || '') + d)}
                className="px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer active:scale-[0.96]"
                style={{background:'#E6F0FF', color:'#006AFF', border:'1px solid #006AFF'}}>
                {d}
              </button>
            ))}
          </div>
        )}

        <div className="p-3 space-y-1.5">
          <div className="flex gap-1.5">
            {numberRow.map(k => <Key key={k} label={k} onClick={() => press(k)}/>)}
          </div>

          {letterRows.map((row, i) => (
            <div key={i} className="flex gap-1.5 px-1">
              {i === 2 && (
                <button onClick={() => setShift(s => !s)}
                  className="px-3 h-14 rounded-lg text-[16px] font-semibold cursor-pointer active:scale-[0.96]"
                  style={shift
                    ? { background:'#006AFF', color:'#FFFFFF', border:'none' }
                    : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }}>
                  ⇧
                </button>
              )}
              {row.map(k => <Key key={k} label={k} onClick={() => press(k)}/>)}
              {i === 2 && <Key label="⌫" onClick={back} danger/>}
            </div>
          ))}

          <div className="flex gap-1.5">
            <Key label="@" onClick={() => press('@')} accent/>
            <Key label="." onClick={() => press('.')} accent/>
            <Key label="_" onClick={() => press('_')} accent/>
            <Key label="-" onClick={() => press('-')} accent/>
            <button onClick={space}
              className="flex-[4] h-14 rounded-lg text-[14px] font-semibold cursor-pointer active:scale-[0.96] select-none"
              style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
              space
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <button onClick={() => onChange('')}
              disabled={!value}
              className="h-12 rounded-lg text-[14px] font-semibold cursor-pointer disabled:opacity-40"
              style={{background:'#FFFFFF', color:'#666666', border:'1px solid #E5E5E5'}}>
              Clear
            </button>
            <button onClick={onClose}
              className="h-12 rounded-lg text-[15px] font-semibold cursor-pointer"
              style={{background:'#000000', color:'#FFFFFF', border:'none'}}>
              Done
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

export function NumericKeypad({ value, onChange, onClose, title='Enter Number', placeholder='', allowPlus=true, formatPhone=true, allowDecimal=false, allowNegative=false }) {

  const press = (k) => {
    // Decimal: one max
    if (k === '.') {
      if (!allowDecimal) return
      if ((value || '').includes('.')) return
      // Don't allow leading "."; auto-prefix 0
      if (!value || value === '-') {
        onChange((value || '') + '0.')
        return
      }
      onChange((value || '') + '.')
      return
    }
    // Negative: toggle prefix
    if (k === '-') {
      if (!allowNegative) return
      const v = value || ''
      if (v.startsWith('-')) onChange(v.slice(1))   // remove
      else onChange('-' + v)                          // add
      return
    }
    const next = (value || '') + k
    const digits = next.replace(/[^\d]/g,'')
    if (digits.length > 15) return
    onChange(next)
  }
  const back = () => onChange((value || '').slice(0, -1))

  const display = (v) => {
    if (!v || !formatPhone) return v
    if (v.startsWith('+')) return v
    const d = v.replace(/\D/g, '')
    if (d.length <= 3) return `(${d}`
    if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
    if (d.length <= 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
    return `+${d.slice(0, d.length-10)} (${d.slice(-10,-7)}) ${d.slice(-7,-4)}-${d.slice(-4)}`
  }

  const Key = ({ label, onClick, danger }) => {
    const styles = danger
      ? { background:'#FFFFFF', color:'#CF1322', border:'1px solid #E5E5E5' }
      : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }
    return (
      <button onClick={onClick}
        className="h-16 rounded-lg text-[26px] font-semibold cursor-pointer active:scale-[0.96] transition-transform select-none"
        style={styles}>
        {label}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.45)'}}>
      <div className="w-full max-w-[440px] rounded-2xl max-h-[92vh] overflow-y-auto"
        style={{background:'#FFFFFF', boxShadow:'0 20px 50px rgba(0,0,0,0.25)'}}>

        <div className="px-6 py-4 flex items-center justify-between"
          style={{borderBottom:'1px solid #E5E5E5'}}>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{color:'#666666'}}>{title}</div>
            <div className="text-[26px] font-mono font-semibold min-h-[34px]" style={{color:'#1F1F1F'}}>
              {value ? display(value) : <span style={{color:'#999999', fontWeight:'normal'}}>{placeholder}</span>}
              <span style={{color:'#006AFF'}} className="animate-pulse">|</span>
            </div>
          </div>
          <button onClick={onClose}
            className="w-10 h-10 rounded-lg cursor-pointer text-[18px] flex items-center justify-center flex-shrink-0"
            style={{background:'#F5F5F5', color:'#666666', border:'none'}}>
            ✕
          </button>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-3 gap-2.5">
            {['1','2','3','4','5','6','7','8','9'].map(k => (
              <Key key={k} label={k} onClick={() => press(k)}/>
            ))}
            {/* Bottom row: priority — negative > decimal > plus > blank */}
            {allowNegative
              ? <Key label="±" onClick={() => press('-')}/>
              : allowDecimal
              ? <Key label="." onClick={() => press('.')}/>
              : allowPlus
              ? <Key label="+" onClick={() => press('+')}/>
              : <div/>}
            <Key label="0" onClick={() => press('0')}/>
            <Key label="⌫" onClick={back} danger/>
          </div>

          {/* Second row of special keys when BOTH negative AND decimal enabled */}
          {(allowNegative && allowDecimal) && (
            <div className="grid grid-cols-3 gap-2.5 mt-2.5">
              <Key label="." onClick={() => press('.')}/>
              <div/>
              <div/>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 mt-3">
            <button onClick={() => onChange('')}
              disabled={!value}
              className="h-12 rounded-lg text-[14px] font-semibold cursor-pointer disabled:opacity-40"
              style={{background:'#FFFFFF', color:'#666666', border:'1px solid #E5E5E5'}}>
              Clear
            </button>
            <button onClick={onClose}
              className="h-12 rounded-lg text-[15px] font-semibold cursor-pointer"
              style={{background:'#000000', color:'#FFFFFF', border:'none'}}>
              Done
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
