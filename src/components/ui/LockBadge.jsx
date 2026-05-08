// src/components/ui/LockBadge.jsx
// 锁状态徽章 — 显示在正在被编辑的记录上

import { useEffect, useState } from 'react'

/**
 * <LockBadge lockStatus lockedByName onForceRelease />
 *
 * lockStatus: 'free' | 'mine' | 'others' | 'checking'
 */
export function LockBadge({ lockStatus, lockedByName, onForceRelease, compact = false }) {
  if (lockStatus === 'free' || lockStatus === 'checking') return null

  if (lockStatus === 'mine') {
    return (
      <span className={`inline-flex items-center gap-1 font-mono font-bold rounded
        bg-green-500/10 border border-green-500/20 text-green-400
        ${compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-green-400
          animate-pulse inline-block" />
        Editing
      </span>
    )
  }

  // lockStatus === 'others'
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono font-bold rounded
      bg-red-500/10 border border-red-500/20 text-red-400
      ${compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'}`}>
      🔒
      {compact
        ? 'Locked'
        : `Locked by ${lockedByName || 'another terminal'}`
      }
    </span>
  )
}

/**
 * <LockBlocker> — 覆盖在被锁定的区域上，防止操作
 */
export function LockBlocker({ lockStatus, lockedByName, onDismiss }) {
  if (lockStatus !== 'others') return null

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center
      bg-[rgba(7,9,15,0.75)] backdrop-blur-[2px] rounded-xl">
      <div className="bg-[#0d1117] border border-red-500/30 rounded-[14px]
        p-6 text-center max-w-[300px] shadow-md">
        <div className="text-3xl mb-3">🔒</div>
        <div className="text-[14px] font-bold mb-2">Record Locked</div>
        <div className="text-[12px] text-[#8899b0] mb-4">
          <span className="text-red-400 font-semibold">
            {lockedByName || 'Another terminal'}
          </span>
          {' '}is currently editing this record.
        </div>
        <div className="text-[10px] font-mono text-[#3d5068]">
          The lock will expire automatically if inactive.
        </div>
        {onDismiss && (
          <button onClick={onDismiss}
            className="mt-4 bg-[#111827] border border-[#1e2d42] rounded-lg
              px-4 py-2 text-[11px] text-[#8899b0] hover:text-white transition-colors w-full">
            View Only (Read-only mode)
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * <ConflictToast> — 乐观锁冲突时的提示
 */
export function ConflictToast({ show, onRefresh, onDismiss }) {
  if (!show) return null

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50
      bg-[#0d1117] border border-yellow-500/40 rounded-[12px]
      px-5 py-4 flex items-center gap-4 shadow-md
      animate-[fadeUp_0.3s_ease_both] min-w-[380px]">
      <div className="text-2xl">⚠️</div>
      <div className="flex-1">
        <div className="text-[13px] font-bold text-yellow-400">Record Changed</div>
        <div className="text-[11px] text-[#8899b0] mt-0.5">
          Another terminal modified this record while you were editing.
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onDismiss}
          className="bg-[#111827] border border-[#1e2d42] rounded-lg px-3 py-1.5
            text-[11px] text-[#8899b0] hover:text-white transition-colors">
          Discard
        </button>
        <button onClick={onRefresh}
          className="bg-yellow-500 border-none rounded-lg px-3 py-1.5
            text-[11px] font-bold text-black">
          Reload
        </button>
      </div>
    </div>
  )
}
