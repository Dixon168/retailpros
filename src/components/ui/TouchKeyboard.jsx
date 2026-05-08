// src/components/ui/TouchKeyboard.jsx
// Touch-friendly keyboard popup for text input
import { useState, useRef, useEffect } from 'react'

const ROWS_LOWER = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['⇧','z','x','c','v','b','n','m','⌫'],
  ['123','space','done'],
]
const ROWS_UPPER = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['⇧','Z','X','C','V','B','N','M','⌫'],
  ['123','space','done'],
]
const ROWS_NUM = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['-','/',':',';','(',')','$','&','@','"'],
  ['#+=','.', ',','?','!','\'','⌫'],
  ['ABC','space','done'],
]
const ROWS_SYM = [
  ['[',']','{','}','#','%','^','*','+','='],
  ['_','\\','|','~','<','>','€','£','¥','•'],
  ['123','.', ',','?','!','\'','⌫'],
  ['ABC','space','done'],
]

export function TouchKeyboard({ value, onChange, onDone, onClose, title, placeholder }) {
  const [layout, setLayout] = useState('lower') // lower|upper|num|sym
  const [caps, setCaps]     = useState(false)

  const rows = layout === 'lower' ? ROWS_LOWER
             : layout === 'upper' ? ROWS_UPPER
             : layout === 'num'   ? ROWS_NUM
             : ROWS_SYM

  const handleKey = (key) => {
    if (key === '⌫')    { onChange(value.slice(0, -1)); return }
    if (key === 'space') { onChange(value + ' '); return }
    if (key === 'done')  { onDone?.(); return }
    if (key === '⇧')    { setLayout(l => l === 'upper' ? 'lower' : 'upper'); return }
    if (key === '123')   { setLayout('num'); return }
    if (key === 'ABC')   { setLayout('lower'); return }
    if (key === '#+=')   { setLayout('sym'); return }
    onChange(value + key)
    // Auto revert to lower after typing uppercase
    if (layout === 'upper') setLayout('lower')
  }

  const KEY_STYLE = (key) => {
    const isSpecial = ['⇧','⌫','123','ABC','#+=','done','space'].includes(key)
    const isAction  = key === 'done'
    const isDelete  = key === '⌫'
    const isShift   = key === '⇧'
    return {
      background: isAction  ? '#000000'
                : isDelete  ? '#fef2f2'
                : isSpecial ? '#e2e8f0'
                : '#fff',
      color:      isAction  ? '#fff'
                : isDelete  ? '#ef4444'
                : isShift && layout === 'upper' ? '#006AFF'
                : '#1e293b',
      fontWeight: isSpecial ? 600 : 500,
      fontSize:   key === 'space' ? '11px'
                : isSpecial ? '12px'
                : '16px',
      flex: key === 'space' ? 4 : key === 'done' ? 2 : 1,
      minWidth: isSpecial ? '44px' : '32px',
      height: '44px',
      borderRadius: '10px',
      border: 'none',
      cursor: 'pointer',
      boxShadow: isAction ? 'none' : '0 2px 0 #d1d5db',
      transition: 'all 0.1s',
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end"
      style={{background:'rgba(15,23,42,0.5)', backdropFilter:'blur(2px)'}}
      onClick={e => { if(e.target === e.currentTarget) onClose?.() }}>

      {/* Display */}
      <div className="px-4 py-3 border-b flex items-center gap-3"
        style={{background:'#1e293b', borderColor:'#334155'}}>
        {title && <div className="text-[11px] text-slate-400 flex-shrink-0">{title}:</div>}
        <div className="flex-1 rounded-xl px-3 py-2 min-h-[40px] flex items-center"
          style={{background:'rgba(255,255,255,0.1)'}}>
          <span className="text-[15px] font-semibold text-white flex-1">
            {value || <span className="text-slate-500">{placeholder || 'Type here...'}</span>}
          </span>
          {/* Cursor blink */}
          <span className="w-0.5 h-5 bg-indigo-400 animate-pulse ml-0.5"/>
        </div>
        <button onClick={onClose}
          className="text-slate-400 bg-transparent border-none cursor-pointer text-[16px] flex-shrink-0">✕</button>
      </div>

      {/* Keys */}
      <div className="p-2 flex flex-col gap-1.5"
        style={{background:'#f1f5f9'}}>
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1.5 justify-center">
            {row.map((key, ki) => (
              <button key={ki} onClick={() => handleKey(key)}
                style={KEY_STYLE(key)}
                className="active:scale-95 transition-transform select-none">
                {key === 'space' ? 'space' : key === '⇧' ? (layout==='upper'?'⬆':'⇧') : key}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Hook for easy use
export function useTouchInput(initial = '') {
  const [value, setValue]     = useState(initial)
  const [showKB, setShowKB]   = useState(false)
  return { value, setValue, showKB, setShowKB, open: () => setShowKB(true), close: () => setShowKB(false) }
}
