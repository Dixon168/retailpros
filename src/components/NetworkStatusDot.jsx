// src/components/NetworkStatusDot.jsx
// Tiny indicator showing connection + cache status. Sits in nav.

import { useEffect, useState } from 'react'
import { useNetworkStatus } from '@/lib/offline/useNetworkStatus'
import { getCacheStats } from '@/lib/offline/cacheSync'

function fmtAge(isoString) {
  if (!isoString) return 'never'
  const diff = Date.now() - new Date(isoString).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / 86400_000)}d ago`
}

export default function NetworkStatusDot() {
  const { online, lastChecked } = useNetworkStatus()
  const [stats, setStats] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const refresh = () => getCacheStats().then(s => { if (alive) setStats(s) }).catch(() => {})
    refresh()
    const t = setInterval(refresh, 15_000)
    return () => { alive = false; clearInterval(t) }
  }, [lastChecked])

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer"
        style={{
          background: open ? '#F5F5F5' : 'transparent',
          color: online ? '#15803D' : '#CF1322',
          border: 'none',
        }}
        title={online ? 'Online' : 'Offline (cached data only)'}>
        <span style={{ fontSize: '8px' }}>{online ? '🟢' : '🔴'}</span>
        {online ? 'Online' : 'Offline'}
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 z-[60] rounded-lg p-3 text-[11px]"
          style={{
            width: '230px',
            background: '#FFFFFF',
            border: '1px solid #E5E5E5',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}>
          <div className="flex items-center gap-2 mb-2">
            <span>{online ? '🟢' : '🔴'}</span>
            <span className="font-bold" style={{ color: online ? '#15803D' : '#CF1322' }}>
              {online ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="text-[#666] space-y-0.5">
            <div>Cache: {stats?.productCount ?? '...'} products</div>
            <div>{stats?.inventoryCount ?? '...'} inventory rows</div>
            <div>Last sync: {fmtAge(stats?.lastInc)}</div>
            {!online && (
              <div className="mt-2 p-2 rounded text-[10px]"
                style={{ background: '#FEE2E2', color: '#CF1322' }}>
                Working from cache.<br/>
                Card payments unavailable until online.
              </div>
            )}
          </div>
          <button onClick={() => setOpen(false)}
            className="w-full mt-2 rounded py-1 text-[10px] font-bold cursor-pointer"
            style={{ background: '#F5F5F5', color: '#1F1F1F', border: 'none' }}>
            Close
          </button>
        </div>
      )}
    </div>
  )
}
