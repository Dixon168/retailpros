// src/hooks/useSafeAsyncSubmit.js
//
// Hook for buttons that talk to Supabase. Wraps an async function with:
//   1. A loading flag your button can disable on
//   2. A 10-second watchdog — if your operation hasn't finished, the
//      button automatically unsticks and shows a toast suggesting retry.
//   3. Proper try/catch/finally so the flag always resets even if your
//      async fn throws an uncaught error.
//
// USAGE
//   const { saving, run } = useSafeAsyncSubmit()
//
//   <button disabled={saving} onClick={() => run(async () => {
//     const { error } = await supabase.from('x').insert(...)
//     if (error) throw new Error(error.message)
//     toast.success('Saved')
//   })}>
//     {saving ? 'Saving...' : 'Save'}
//   </button>
//
// The watchdog only logs/toasts a warning — it doesn't cancel your
// in-flight request (browsers can't always cancel a Supabase fetch
// mid-flight). It just unsticks the UI so the user can try again.

import { useCallback, useRef, useState } from 'react'
import toast from 'react-hot-toast'

const DEFAULT_TIMEOUT_MS = 10_000

export function useSafeAsyncSubmit(opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, timeoutMessage } = opts
  const [saving, setSaving] = useState(false)
  // Track whether we already unstuck via the watchdog so we don't
  // double-toast when the real promise eventually resolves.
  const stuckRef = useRef(false)

  const run = useCallback(async (asyncFn) => {
    if (saving) return  // already in-flight; ignore double-clicks
    setSaving(true)
    stuckRef.current = false

    const watchdog = setTimeout(() => {
      stuckRef.current = true
      setSaving(false)
      toast.error(
        timeoutMessage ||
        '⏱️ This is taking longer than expected. Check your connection and try again.',
        { duration: 5000 }
      )
    }, timeoutMs)

    try {
      await asyncFn()
    } catch (err) {
      // Only show the error if the watchdog hasn't already toasted.
      // Otherwise we'd get two error toasts back to back.
      if (!stuckRef.current) {
        console.error('[useSafeAsyncSubmit] error:', err)
        toast.error(err?.message || 'Something went wrong')
      }
    } finally {
      clearTimeout(watchdog)
      // If watchdog already unstuck, don't toggle again
      if (!stuckRef.current) setSaving(false)
    }
  }, [saving, timeoutMs, timeoutMessage])

  return { saving, run }
}
