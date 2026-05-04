// src/components/ui/NumPad.jsx
// Touch-friendly number pad with decimal and negative support

export default function NumPad({ title, subtitle, value, onChange, onConfirm, onClose, allowNegative = false, allowDecimal = true, prefix = '', suffix = '' }) {

  const handleKey = (key) => {
    if (key === 'DEL') {
      onChange(value.slice(0, -1) || '')
      return
    }
    if (key === 'CLR') {
      onChange('')
      return
    }
    if (key === '.' && !allowDecimal) return
    if (key === '.' && value.includes('.')) return
    if (key === '-') {
      if (!allowNegative) return
      // Toggle negative
      if (value === '' || value === '0') {
        onChange('-')
        return
      }
      if (value.startsWith('-')) onChange(value.slice(1))
      else onChange('-' + value)
      return
    }
    // Max 2 decimal places
    if (value.includes('.')) {
      const decimals = value.split('.')[1]
      if (decimals && decimals.length >= 2) return
    }
    onChange(value + key)
  }

  const ROWS = [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    [allowNegative ? '-' : '.', '0', '.'],
  ]
  // Fix rows based on flags
  const rows = [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    [
      allowNegative ? '-' : allowDecimal ? '.' : '00',
      '0',
      allowDecimal ? '.' : '00'
    ],
  ]

  const display = value || '0'
  const numVal = parseFloat(value)
  const isValid = value !== '' && value !== '-' && value !== '.' && !isNaN(numVal) && numVal !== 0

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      style={{background:'rgba(15,23,42,0.6)', backdropFilter:'blur(4px)'}}
      onClick={onClose}>
      <div className="w-full max-w-[320px] rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl"
        style={{background:'#fff'}} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 pt-5 pb-3 text-center"
          style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
          <div className="text-[13px] font-semibold text-indigo-200 mb-1">{title}</div>
          {subtitle && <div className="text-[11px] text-indigo-300">{subtitle}</div>}

          {/* Display */}
          <div className="mt-3 bg-white/15 rounded-2xl px-4 py-3 min-h-[56px] flex items-center justify-end">
            <span className="text-[13px] text-white/60 mr-1">{prefix}</span>
            <span className="text-[32px] font-bold text-white font-mono tracking-tight">
              <span style={{color: parseFloat(display) < 0 ? '#ef4444' : 'inherit'}}>{display}</span>
            </span>
            <span className="text-[13px] text-white/60 ml-1">{suffix}</span>
          </div>
        </div>

        {/* Keys */}
        <div className="p-3 grid gap-2" style={{gridTemplateColumns:'repeat(3,1fr)'}}>
          {rows.map((row, ri) =>
            row.map((key, ci) => (
              <button key={`${ri}-${ci}`} onClick={() => handleKey(key)}
                className="rounded-2xl py-4 text-[22px] font-bold cursor-pointer border-none transition-all active:scale-95"
                style={{
                  background: key === '-' ? '#fef2f2' : key === '.' ? '#f0f4ff' : '#f8fafc',
                  color: key === '-' ? '#ef4444' : key === '.' ? '#6366f1' : '#1e293b',
                  boxShadow: key === '-' ? '0 2px 0 #fecdd3' : key === '.' ? '0 2px 0 #c7d2fe' : '0 2px 0 #e2e8f0',
                  fontSize: '18px',
                }}>
                {key}
              </button>
            ))
          )}

          {/* Bottom row: CLR, DEL, Confirm */}
          <button onClick={() => handleKey('CLR')}
            className="rounded-2xl py-4 text-[13px] font-bold cursor-pointer border-none transition-all active:scale-95"
            style={{background:'#fff7ed', color:'#ea580c', boxShadow:'0 2px 0 #fed7aa'}}>
            CLR
          </button>
          <button onClick={() => handleKey('DEL')}
            className="rounded-2xl py-4 text-[22px] cursor-pointer border-none transition-all active:scale-95"
            style={{background:'#fef2f2', color:'#ef4444', boxShadow:'0 2px 0 #fecdd3'}}>
            ⌫
          </button>
          <button onClick={() => isValid && onConfirm(numVal)}
            disabled={!isValid || value === '-'}
            className="rounded-2xl py-4 text-[22px] cursor-pointer border-none transition-all active:scale-95 disabled:opacity-30"
            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', boxShadow:'0 2px 0 #a5b4fc'}}>
            ✓
          </button>
        </div>

        {/* Cancel */}
        <div className="px-3 pb-4">
          <button onClick={onClose}
            className="w-full rounded-2xl py-3 text-[13px] font-semibold cursor-pointer border-none"
            style={{background:'#f1f5f9', color:'#64748b'}}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
