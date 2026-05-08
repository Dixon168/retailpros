// src/lib/offline/useNetworkStatus.js
// Lightweight hook to track online/offline status.
// Provides:
//   - online: navigator.onLine
//   - lastOnlineAt: timestamp of last online (null if always online)
//   - reachable: not just navigator.onLine but actual Supabase reachability
//
// We periodically ping a tiny endpoint. If that fails for 2 consecutive tries,
// we mark as offline even if navigator.onLine is true (captive portals etc).

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// Singleton-ish state so all components see the same status
let _status = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  reachable: typeof navigator !== 'undefined' ? navigator.onLine : true,
  lastChecked: null,
}
const _listeners = new Set()
const notify = () => _listeners.forEach(fn => fn(_status))

let _checkInterval = null
let _consecutiveFails = 0

async function checkReachable() {
  try {
    // Use a HEAD request to a known cheap endpoint
    // Supabase /auth/v1/health is usually quick
    const url = supabase.supabaseUrl + '/auth/v1/health'
    const ctrl = new AbortController()
    const timeoutId = setTimeout(() => ctrl.abort(), 4000)
    const r = await fetch(url, {
      method: 'GET', signal: ctrl.signal,
      headers: { 'apikey': supabase.supabaseKey || '' },
    })
    clearTimeout(timeoutId)
    return r.ok || r.status === 401  // 401 still means we reached server
  } catch {
    return false
  }
}

async function refreshStatus() {
  const navOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
  if (!navOnline) {
    _status = { online: false, reachable: false, lastChecked: Date.now() }
    _consecutiveFails = 0
    notify()
    return
  }
  const ok = await checkReachable()
  if (ok) {
    _consecutiveFails = 0
    _status = { online: true, reachable: true, lastChecked: Date.now() }
  } else {
    _consecutiveFails++
    // Need 2 fails in a row before marking offline (avoid flapping)
    if (_consecutiveFails >= 2) {
      _status = { online: navOnline, reachable: false, lastChecked: Date.now() }
    }
  }
  notify()
}

function startMonitoring() {
  if (_checkInterval) return
  // Listen to browser online/offline events (instant)
  const handler = () => refreshStatus()
  window.addEventListener('online', handler)
  window.addEventListener('offline', handler)
  // Also poll every 30s when online (catches captive portal cases)
  _checkInterval = setInterval(() => {
    refreshStatus()
  }, 30000)
  // Initial check
  refreshStatus()
}

export function useNetworkStatus() {
  const [status, setStatus] = useState(_status)
  useEffect(() => {
    startMonitoring()
    _listeners.add(setStatus)
    return () => { _listeners.delete(setStatus) }
  }, [])

  const recheck = useCallback(() => refreshStatus(), [])

  return {
    online: status.online && status.reachable,  // user-facing "online" means: can actually reach API
    rawNavigatorOnline: status.online,
    reachable: status.reachable,
    lastChecked: status.lastChecked,
    recheck,
  }
}
