// src/pages/business/tabs/NotesTab.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import DualInput from '@/components/ui/DualInput'

export default function NotesTab({ customerId, tenantId, onChanged }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['company-notes', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('business_notes')
        .select('*').eq('business_customer_id', customerId)
        .order('is_pinned', { ascending: false })
        .order('is_alert', { ascending: false })
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['company-notes', customerId] })
    qc.invalidateQueries({ queryKey: ['company-alert-notes', customerId] })
    qc.invalidateQueries({ queryKey: ['company-tab-counts', customerId] })
    onChanged?.()
  }

  const deleteNote = async (n) => {
    if (!confirm('Delete this note?')) return
    const { error } = await supabase.from('business_notes').delete().eq('id', n.id)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Note deleted')
    refresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[12px] font-bold text-[#1F1F1F]">
            {notes.length} note{notes.length !== 1 ? 's' : ''}
          </div>
          <div className="text-[10px] text-[#666] mt-0.5">
            Pinned notes show at top · Alert notes show at top of detail page
          </div>
        </div>
        <button onClick={() => setEditing('new')}
          className="rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
          style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
          + Add Note
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-[12px] text-[#999]">Loading...</div>
      ) : notes.length === 0 ? (
        <div className="rounded-lg p-8 text-center text-[12px] text-[#999]"
          style={{background:'#FAFAFA', border:'1px dashed #E5E5E5'}}>
          <div className="text-[36px] mb-2 opacity-30">📝</div>
          No notes yet. Use notes for things like:
          <div className="mt-2 text-[11px] text-left max-w-[400px] mx-auto">
            • "Delivers to back loading dock only"<br/>
            • "DO NOT extend further credit until paid up"<br/>
            • "Owner Mike prefers calls over emails"
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(n => (
            <div key={n.id} className="rounded-lg p-3"
              style={n.is_alert
                ? { background:'#FEE2E2', border:'1px solid #dc2626' }
                : n.is_pinned
                  ? { background:'#FEF3C7', border:'1px solid #F59E0B' }
                  : { background:'#FFFFFF', border:'1px solid #E5E5E5' }
              }>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    {n.is_alert && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{background:'#dc2626', color:'#FFFFFF'}}>
                        ⚠️ Alert
                      </span>
                    )}
                    {n.is_pinned && !n.is_alert && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{background:'#F59E0B', color:'#FFFFFF'}}>
                        📌 Pinned
                      </span>
                    )}
                    <span className="text-[10px] text-[#666]">
                      {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                    </span>
                  </div>
                  <div className="text-[12px] text-[#1F1F1F] whitespace-pre-wrap">{n.note}</div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => setEditing(n)}
                    className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#5E6AD2', border:'1px solid #5E6AD2'}}>
                    Edit
                  </button>
                  <button onClick={() => deleteNote(n)}
                    className="rounded px-2 py-1 text-[10px] font-bold cursor-pointer"
                    style={{background:'#FFFFFF', color:'#dc2626', border:'1px solid #FECACA'}}>
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <NoteFormModal
          initial={editing === 'new' ? null : editing}
          customerId={customerId}
          tenantId={tenantId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
    </div>
  )
}

function NoteFormModal({ initial, customerId, tenantId, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    note:      initial?.note      || '',
    is_pinned: initial?.is_pinned ?? false,
    is_alert:  initial?.is_alert  ?? false,
  })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const save = async () => {
    if (!form.note.trim()) { toast.error('Note text required'); return }
    setSaving(true)
    try {
      const payload = {
        tenant_id: tenantId,
        business_customer_id: customerId,
        note:      form.note.trim(),
        is_pinned: form.is_pinned,
        is_alert:  form.is_alert,
      }
      let error
      if (initial?.id) {
        ({ error } = await supabase.from('business_notes').update(payload).eq('id', initial.id))
      } else {
        ({ error } = await supabase.from('business_notes').insert(payload))
      }
      if (error) { toast.error('Failed: ' + error.message); return }
      toast.success(initial?.id ? 'Note updated' : 'Note added')
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center p-4"
      style={{background:'rgba(0,0,0,0.5)'}}>
      <div className="rounded-2xl overflow-hidden" style={{
        width:'480px', maxWidth:'100%', background:'#FFFFFF',
        boxShadow:'0 20px 50px rgba(0,0,0,0.3)'
      }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{borderBottom:'1px solid #E5E5E5'}}>
          <div className="text-[15px] font-bold text-[#1F1F1F]">
            {initial?.id ? 'Edit note' : 'New note'}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg cursor-pointer text-[16px]"
            style={{background:'#F5F5F5', border:'none'}}>✕</button>
        </div>
        <div className="p-5 space-y-3">
          <DualInput multiline value={form.note} onChange={v => set('note', v)}
            placeholder="Write anything important about this customer..."
            kbTitle="Note"/>
          <label className="flex items-center gap-2 cursor-pointer rounded-lg p-2.5"
            style={{ background: form.is_pinned ? '#FEF3C7' : '#FAFAFA',
                     border: `1px solid ${form.is_pinned ? '#F59E0B' : '#E5E5E5'}` }}>
            <input type="checkbox" checked={form.is_pinned}
              onChange={e => set('is_pinned', e.target.checked)}
              className="accent-[#F59E0B]"/>
            <div>
              <div className="text-[12px] font-bold"
                style={{color: form.is_pinned ? '#B45309' : '#1F1F1F'}}>
                📌 Pin to top
              </div>
              <div className="text-[10px]" style={{color: form.is_pinned ? '#B45309' : '#666'}}>
                Pinned notes show first in this tab
              </div>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer rounded-lg p-2.5"
            style={{ background: form.is_alert ? '#FEE2E2' : '#FAFAFA',
                     border: `1px solid ${form.is_alert ? '#dc2626' : '#E5E5E5'}` }}>
            <input type="checkbox" checked={form.is_alert}
              onChange={e => set('is_alert', e.target.checked)}
              className="accent-[#dc2626]"/>
            <div>
              <div className="text-[12px] font-bold"
                style={{color: form.is_alert ? '#dc2626' : '#1F1F1F'}}>
                ⚠️ Mark as alert
              </div>
              <div className="text-[10px]" style={{color: form.is_alert ? '#dc2626' : '#666'}}>
                Alert notes show at the top of the company page in red
              </div>
            </div>
          </label>
        </div>
        <div className="px-5 py-4 flex gap-2" style={{background:'#FAFAFA', borderTop:'1px solid #E5E5E5'}}>
          <button onClick={onClose}
            className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer"
            style={{background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5'}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving || !form.note.trim()}
            className="flex-1 rounded-lg py-2.5 text-[12px] font-bold cursor-pointer text-white disabled:opacity-40"
            style={{background:'#5E6AD2', border:'none'}}>
            {saving ? 'Saving...' : initial?.id ? '✓ Save' : '+ Add Note'}
          </button>
        </div>
      </div>
    </div>
  )
}
