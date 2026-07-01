// src/components/ui/DualInput.jsx
// A real <input> that ALSO has a small ⌨️ button to open the touch keyboard.
// Works equally well with a physical keyboard (typing) and on touchscreens (tap ⌨️).

import { useState } from 'react'
import { QWERTYKeyboard, NumericKeypad } from './TouchKeyboards'

/**
 * DualInput — typed input + touch keyboard fallback.
 *
 * Props:
 *   value         — current value (string)
 *   onChange      — (newValue: string) => void
 *   placeholder   — input placeholder
 *   label         — optional label rendered above
 *   required      — bool, shows red asterisk
 *   multiline     — bool, render <textarea> instead
 *   mode          — 'text' (default), 'email', 'numeric', 'phone', 'decimal'
 *                    text/email/phone open QWERTY (with email shortcuts when 'email')
 *                    numeric/decimal open NumericKeypad
 *                    phone opens NumericKeypad with phone-format
 *   prefix        — optional, like '$' (rendered inside the input box, before the input)
 *   kbTitle       — title shown on the touch keyboard (defaults to label)
 *   className     — extra classes for the input
 *   autoFocus     — focus on mount
 *   compact       — bool, smaller padding (for inline use in tables)
 */
export default function DualInput({
  value,
  onChange,
  placeholder,
  label,
  required,
  multiline,
  mode = 'text',
  prefix,
  kbTitle,
  className = '',
  autoFocus,
  compact,
  allowNegative = false,   // touch-keyboard shows ± toggle
  inputProps = {},
}) {
  const [showKB, setShowKB] = useState(false)

  const isNumKB    = mode === 'numeric' || mode === 'decimal' || mode === 'phone'
  const inputType  = mode === 'email' ? 'email'
                   : mode === 'phone' ? 'tel'
                   : mode === 'numeric' || mode === 'decimal' ? 'text'  // we want native KB to behave; numeric on mobile via inputMode below
                   : 'text'
  const inputMode  = mode === 'numeric' ? 'numeric'
                   : mode === 'decimal' ? 'decimal'
                   : mode === 'phone'   ? 'tel'
                   : mode === 'email'   ? 'email'
                   : 'text'

  const baseInputCls = `flex-1 bg-transparent border-none outline-none ${
    compact ? 'px-2 py-1.5 text-[12px]' : 'px-3 py-2.5 text-[13px]'
  } ${
    mode === 'numeric' || mode === 'decimal' || mode === 'phone' ? 'font-mono' : ''
  }`

  const containerCls = `flex items-stretch w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg overflow-hidden focus-within:border-[#5E6AD2] transition-colors ${className}`

  return (
    <>
      <div>
        {label && (
          <div className="text-[11px] font-bold text-[#1F1F1F] mb-1.5">
            {label}{required && <span className="text-[#dc2626]"> *</span>}
          </div>
        )}
        <div className={containerCls} style={{ minHeight: multiline ? '70px' : 'auto' }}>
          {prefix && !multiline && (
            <div className={`flex items-center font-bold text-[#666] pl-3 ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
              {prefix}
            </div>
          )}
          {multiline ? (
            <textarea value={value || ''} onChange={e => onChange(e.target.value)}
              placeholder={placeholder} autoFocus={autoFocus}
              rows={3}
              className={baseInputCls + ' resize-none'}
              {...inputProps}/>
          ) : (
            <input value={value || ''} onChange={e => onChange(e.target.value)}
              placeholder={placeholder} autoFocus={autoFocus}
              type={inputType} inputMode={inputMode}
              className={baseInputCls}
              {...inputProps}/>
          )}
          <button type="button" onClick={() => setShowKB(true)}
            tabIndex={-1}
            className={`flex items-center justify-center cursor-pointer hover:bg-[#E5E5E5] transition-colors ${compact ? 'px-2' : 'px-3'}`}
            style={{ borderLeft:'1px solid #E5E5E5', background:'#FAFAFA', color:'#666', fontSize: compact ? '12px' : '14px' }}
            title="Open on-screen keyboard">
            ⌨️
          </button>
        </div>
      </div>

      {showKB && !isNumKB && (
        <QWERTYKeyboard
          value={value || ''}
          onChange={onChange}
          onClose={() => setShowKB(false)}
          title={kbTitle || label || 'Edit'}
          placeholder={placeholder}
          mode={mode === 'email' ? 'email' : 'text'}
        />
      )}
      {showKB && isNumKB && (
        <NumericKeypad
          value={value || ''}
          onChange={onChange}
          onClose={() => setShowKB(false)}
          title={kbTitle || label || 'Edit'}
          placeholder={placeholder || '0'}
          formatPhone={mode === 'phone'}
          allowPlus={mode === 'phone'}
          allowDecimal={mode === 'decimal'}
          allowNegative={allowNegative && mode === 'decimal'}
        />
      )}
    </>
  )
}
