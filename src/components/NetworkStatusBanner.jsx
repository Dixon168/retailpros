// src/components/NetworkStatusBanner.jsx
// Top-of-app banner that shows when connection is unstable.
// Quiet when online, prominent red when offline.

import { useNetworkStatus } from '@/lib/offline/useNetworkStatus'

export default function NetworkStatusBanner() {
  const { online, recheck } = useNetworkStatus()

  if (online) return null   // Don't show anything when everything works fine

  // Offline / unreachable — show red banner
  return (
    <div
      className="w-full px-4 py-2 flex items-center justify-center gap-3 text-[12px] font-bold"
      style={{
        background: '#dc2626',
        color: '#FFFFFF',
        position: 'relative',
        zIndex: 50,
      }}
      role="status"
    >
      <span style={{ fontSize: '14px' }}>🔴</span>
      <span>OFFLINE — connection lost. Cash transactions only (saved locally and synced when online).</span>
      <button onClick={recheck}
        className="rounded px-2 py-0.5 text-[10px] font-bold cursor-pointer"
        style={{ background: '#FFFFFF', color: '#dc2626', border: 'none' }}>
        Retry
      </button>
    </div>
  )
}
