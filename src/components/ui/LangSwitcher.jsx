// src/components/ui/LangSwitcher.jsx
import { useState } from 'react'
import { LANGS, useLangStore } from '@/lib/i18n'

export function LangSwitcher() {
  const { lang, setLang } = useLangStore()
  const [open, setOpen]   = useState(false)
  const current = LANGS.find(l => l.code === lang) || LANGS[0]

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl cursor-pointer border transition-all"
        style={{
          background: open ? '#e0e7ff' : '#f8fafc',
          borderColor: open ? '#a5b4fc' : '#e2e8f0',
          color: '#475569',
        }}>
        <span className="text-[14px]">{current.flag}</span>
        <span className="text-[11px] font-bold">{current.label}</span>
        <span className="text-[9px] text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}/>
          <div className="absolute right-0 top-full mt-1 rounded-xl overflow-hidden shadow-xl z-50"
            style={{background:'#fff', border:'1.5px solid #e2e8f0', minWidth:'140px'}}>
            {LANGS.map(l => (
              <button key={l.code}
                onClick={() => { setLang(l.code); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 cursor-pointer border-none text-left transition-all"
                style={{
                  background: lang === l.code ? '#f0f4ff' : '#fff',
                  borderBottom: '1px solid #f1f5f9',
                }}>
                <span className="text-[16px]">{l.flag}</span>
                <div>
                  <div className="text-[12px] font-semibold" style={{color: lang===l.code ? '#6366f1' : '#1e293b'}}>
                    {l.name}
                  </div>
                </div>
                {lang === l.code && <span className="ml-auto text-[10px] text-indigo-500">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
