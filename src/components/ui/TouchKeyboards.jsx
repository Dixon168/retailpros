// src/components/ui/TouchKeyboards.jsx
// Touchscreen-friendly QWERTY keyboard and numeric keypad

import { useState } from 'react'

// ────────────────────────────────────────────────
// QWERTY Keyboard — for email / text input
// ────────────────────────────────────────────────
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

  const Key = ({ label, onClick, color='slate', wide, danger, primary, warn }) => {
    const styles = primary
      ? { background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff', boxShadow:'0 3px 0 #14532d' }
      : danger
      ? { background:'#fee2e2', color:'#dc2626', boxShadow:'0 3px 0 #fca5a5' }
      : warn
      ? { background:'#fef3c7', color:'#854d0e', boxShadow:'0 3px 0 #fcd34d' }
      : { background:'#f1f5f9', color:'#1e293b', boxShadow:'0 3px 0 #cbd5e1' }
    return (
      <button onClick={onClick}
        className={`${wide ? 'flex-[2]' : 'flex-1'} h-14 rounded-xl text-[18px] font-bold cursor-pointer border-none active:scale-95 transition-transform select-none`}
        style={styles}>
        {label}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[500] flex flex-col items-center justify-end"
      style={{background:'rgba(15,23,42,0.85)', backdropFilter:'blur(8px)'}}>
      <div className="w-full max-w-[760px] bg-white rounded-t-3xl shadow-2xl">

        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-200">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{title}</div>
            <div className="text-[22px] font-mono text-slate-900 truncate min-h-[30px]">
              {value || <span className="text-slate-300">{placeholder}</span>}
              <span className="text-blue-500 animate-pulse">|</span>
            </div>
          </div>
          <button onClick={onClose}
            className="w-10 h-10 rounded-full bg-gray-100 border-none cursor-pointer text-[18px] flex items-center justify-center flex-shrink-0">
            ✕
          </button>
        </div>

        {/* Quick email domains */}
        {mode === 'email' && (
          <div className="px-3 pt-3 flex gap-1.5 flex-wrap">
            {['@gmail.com','@yahoo.com','@outlook.com','@icloud.com','@hotmail.com'].map(d => (
              <button key={d} onClick={() => onChange((value || '') + d)}
                className="px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-2 active:scale-95"
                style={{background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8'}}>
                {d}
              </button>
            ))}
          </div>
        )}

        {/* Keys */}
        <div className="p-3 space-y-1.5">
          {/* Number row */}
          <div className="flex gap-1.5">
            {numberRow.map(k => <Key key={k} label={k} onClick={() => press(k)}/>)}
          </div>

          {/* Letter rows */}
          {letterRows.map((row, i) => (
            <div key={i} className="flex gap-1.5 px-1">
              {/* Shift on row 2 (index 2) */}
              {i === 2 && (
                <button onClick={() => setShift(s => !s)}
                  className="px-3 h-14 rounded-xl text-[16px] font-bold cursor-pointer border-none active:scale-95"
                  style={shift
                    ? { background:'#3b82f6', color:'#fff', boxShadow:'0 3px 0 #1d4ed8' }
                    : { background:'#e2e8f0', color:'#1e293b', boxShadow:'0 3px 0 #94a3b8' }}>
                  ⇧
                </button>
              )}
              {row.map(k => <Key key={k} label={k} onClick={() => press(k)}/>)}
              {/* Backspace on row 2 */}
              {i === 2 && <Key label="⌫" onClick={back} danger/>}
            </div>
          ))}

          {/* Symbols + space */}
          <div className="flex gap-1.5">
            <Key label="@" onClick={() => press('@')} warn/>
            <Key label="." onClick={() => press('.')} warn/>
            <Key label="_" onClick={() => press('_')} warn/>
            <Key label="-" onClick={() => press('-')} warn/>
            <button onClick={space}
              className="flex-[4] h-14 rounded-xl text-[14px] font-bold cursor-pointer border-none active:scale-95 select-none"
              style={{background:'#f1f5f9', color:'#1e293b', boxShadow:'0 3px 0 #cbd5e1'}}>
              space
            </button>
          </div>

          {/* Action row */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button onClick={() => onChange('')}
              disabled={!value}
              className="h-12 rounded-xl text-[14px] font-bold cursor-pointer border-2 disabled:opacity-40"
              style={{background:'#fff7ed', borderColor:'#fed7aa', color:'#ea580c'}}>
              ✕ Clear
            </button>
            <button onClick={onClose}
              className="h-12 rounded-xl text-[15px] font-black text-white cursor-pointer border-none"
              style={{background:'linear-gradient(135deg,#16a34a,#15803d)', boxShadow:'0 3px 0 #14532d'}}>
              ✓ Done
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
// Numeric Keypad — for phone / number input
// ────────────────────────────────────────────────
export function NumericKeypad({ value, onChange, onClose, title='Enter Number', placeholder='', allowPlus=true, formatPhone=true }) {

  const press = (k) => {
    let next = (value || '') + k
    // Strip non-digits except leading + for length check
    const digits = next.replace(/[^\d]/g,'')
    if (digits.length > 15) return
    onChange(next)
  }
  const back = () => onChange((value || '').slice(0, -1))

  // Format US phone for display: (555) 123-4567
  const display = (v) => {
    if (!v || !formatPhone) return v
    if (v.startsWith('+')) return v
    const d = v.replace(/\D/g, '')
    if (d.length <= 3) return `(${d}`
    if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
    if (d.length <= 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
    return `+${d.slice(0, d.length-10)} (${d.slice(-10,-7)}) ${d.slice(-7,-4)}-${d.slice(-4)}`
  }

  return (
    <div className="fixed inset-0 z-[500] flex flex-col items-center justify-end"
      style={{background:'rgba(15,23,42,0.85)', backdropFilter:'blur(8px)'}}>
      <div className="w-full max-w-[440px] bg-white rounded-t-3xl shadow-2xl">

        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-200">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{title}</div>
            <div className="text-[26px] font-mono font-bold text-slate-900 min-h-[34px]">
              {value ? display(value) : <span className="text-slate-300 font-normal">{placeholder}</span>}
              <span className="text-blue-500 animate-pulse">|</span>
            </div>
          </div>
          <button onClick={onClose}
            className="w-10 h-10 rounded-full bg-gray-100 border-none cursor-pointer text-[18px] flex items-center justify-center flex-shrink-0">
            ✕
          </button>
        </div>

        {/* Keypad */}
        <div className="p-4">
          <div className="grid grid-cols-3 gap-3">
            {['1','2','3','4','5','6','7','8','9'].map(k => (
              <button key={k} onClick={() => press(k)}
                className="h-16 rounded-2xl text-[28px] font-bold cursor-pointer border-none active:scale-95 transition-transform select-none"
                style={{background:'#f1f5f9', color:'#1e293b', boxShadow:'0 4px 0 #cbd5e1'}}>
                {k}
              </button>
            ))}
            <button onClick={() => allowPlus && press('+')}
              className="h-16 rounded-2xl text-[28px] font-bold cursor-pointer border-none active:scale-95"
              style={allowPlus
                ? { background:'#fef3c7', color:'#854d0e', boxShadow:'0 4px 0 #fcd34d' }
                : { background:'#e5e7eb', color:'#9ca3af', boxShadow:'0 4px 0 #9ca3af' }}>
              +
            </button>
            <button onClick={() => press('0')}
              className="h-16 rounded-2xl text-[28px] font-bold cursor-pointer border-none active:scale-95"
              style={{background:'#f1f5f9', color:'#1e293b', boxShadow:'0 4px 0 #cbd5e1'}}>
              0
            </button>
            <button onClick={back}
              className="h-16 rounded-2xl text-[22px] font-bold cursor-pointer border-none active:scale-95"
              style={{background:'#fee2e2', color:'#dc2626', boxShadow:'0 4px 0 #fca5a5'}}>
              ⌫
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <button onClick={() => onChange('')}
              disabled={!value}
              className="h-12 rounded-2xl text-[14px] font-bold cursor-pointer border-2 disabled:opacity-40"
              style={{background:'#fff7ed', borderColor:'#fed7aa', color:'#ea580c'}}>
              ✕ Clear
            </button>
            <button onClick={onClose}
              className="h-12 rounded-2xl text-[15px] font-black text-white cursor-pointer border-none"
              style={{background:'linear-gradient(135deg,#16a34a,#15803d)', boxShadow:'0 4px 0 #14532d'}}>
              ✓ Done
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
