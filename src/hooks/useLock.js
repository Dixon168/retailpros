// src/hooks/useLock.js
// 资源锁管理 Hook
// 原理：编辑某条记录时先申请锁，完成后释放。
//       其他终端通过 Supabase Realtime 实时收到锁状态变化。

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

// 每个浏览器 tab 的唯一标识（关闭就消失）
export const TERMINAL_ID = (() => {
  let id = sessionStorage.getItem('terminal_id')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('terminal_id', id)
  }
  return id
})()

// 终端显示名（从 auth 状态读取，这里先用 sessionStorage 缓存）
export const getTerminalName = (userName, storeName) =>
  `${storeName || 'Store'} — ${userName || 'Terminal'}`

/**
 * useLock(tenantId, resourceType, resourceId, options)
 *
 * 返回：
 *   { lockStatus, lockedBy, acquire, release, isLocked, isMine }
 *
 * lockStatus: 'free' | 'mine' | 'others' | 'checking'
 */
export function useLock(tenantId, resourceType, resourceId, options = {}) {
  const { autoAcquire = false, ttlSeconds = 300, terminalName = 'Terminal' } = options

  const [lockStatus, setLockStatus]   = useState('free')
  const [lockedByName, setLockedByName] = useState(null)
  const renewalTimer = useRef(null)
  const channelRef   = useRef(null)

  // ── 申请锁 ──
  const acquire = useCallback(async () => {
    if (!tenantId || !resourceId) return false

    setLockStatus('checking')
    const { data, error } = await supabase.rpc('fn_acquire_lock', {
      p_tenant_id:      tenantId,
      p_resource_type:  resourceType,
      p_resource_id:    resourceId,
      p_locked_by:      TERMINAL_ID,
      p_locked_by_name: terminalName,
      p_ttl_seconds:    ttlSeconds,
    })

    if (error || !data?.success) {
      const msg = data?.message || error?.message || 'Could not acquire lock'
      setLockStatus('others')
      setLockedByName(data?.locked_by_name || 'Another terminal')
      toast.error(`🔒 ${msg}`, { duration: 4000 })
      return false
    }

    setLockStatus('mine')
    setLockedByName(null)

    // 每 2 分钟自动续期（避免因为用户操作慢导致锁过期）
    renewalTimer.current = setInterval(() => {
      supabase.rpc('fn_acquire_lock', {
        p_tenant_id:      tenantId,
        p_resource_type:  resourceType,
        p_resource_id:    resourceId,
        p_locked_by:      TERMINAL_ID,
        p_locked_by_name: terminalName,
        p_ttl_seconds:    ttlSeconds,
      })
    }, 120_000)

    return true
  }, [tenantId, resourceType, resourceId, terminalName, ttlSeconds])

  // ── 释放锁 ──
  const release = useCallback(async () => {
    if (!tenantId || !resourceId) return

    clearInterval(renewalTimer.current)
    setLockStatus('free')
    setLockedByName(null)

    await supabase.rpc('fn_release_lock', {
      p_tenant_id:      tenantId,
      p_resource_type:  resourceType,
      p_resource_id:    resourceId,
      p_locked_by:      TERMINAL_ID,
    })
  }, [tenantId, resourceType, resourceId])

  // ── 订阅锁变化（Realtime）──
  useEffect(() => {
    if (!tenantId || !resourceId) return

    // 订阅 resource_locks 表的变化
    const channel = supabase
      .channel(`lock:${resourceType}:${resourceId}`)
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'resource_locks',
        filter: `resource_id=eq.${resourceId}`,
      }, (payload) => {
        if (payload.eventType === 'DELETE') {
          // 锁被释放
          setLockStatus('free')
          setLockedByName(null)
        } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const lock = payload.new
          if (lock.locked_by === TERMINAL_ID) {
            setLockStatus('mine')
          } else {
            setLockStatus('others')
            setLockedByName(lock.locked_by_name || 'Another terminal')
          }
        }
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tenantId, resourceType, resourceId])

  // ── 页面卸载时自动释放锁 ──
  useEffect(() => {
    const handleUnload = () => {
      if (lockStatus === 'mine') {
        // 用 sendBeacon 保证页面关闭时也能发出请求
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/fn_release_lock`
        navigator.sendBeacon(url, JSON.stringify({
          p_tenant_id:      tenantId,
          p_resource_type:  resourceType,
          p_resource_id:    resourceId,
          p_locked_by:      TERMINAL_ID,
        }))
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [lockStatus, tenantId, resourceType, resourceId])

  // ── 自动申请锁（可选）──
  useEffect(() => {
    if (autoAcquire && resourceId) acquire()
    return () => { if (autoAcquire) release() }
  }, [autoAcquire, resourceId])

  return {
    lockStatus,                       // 'free' | 'mine' | 'others' | 'checking'
    lockedByName,                     // 锁定者名称（其他终端时显示）
    acquire,
    release,
    isLocked: lockStatus === 'others', // 被别人锁定
    isMine:   lockStatus === 'mine',   // 我自己锁定的
  }
}

/**
 * useOptimisticVersion(initialVersion)
 * 跟踪记录的 version，提交时做乐观锁检查
 */
export function useOptimisticVersion(initialVersion = 1) {
  const [version, setVersion] = useState(initialVersion)

  const checkAndUpdate = useCallback(async (updateFn) => {
    try {
      const newVersion = await updateFn(version)
      if (newVersion) setVersion(newVersion)
      return true
    } catch (err) {
      if (err.isConflict) {
        toast.error(
          '⚠️ This record was modified by another terminal. Refreshing...',
          { duration: 5000 }
        )
        return false
      }
      throw err
    }
  }, [version])

  return { version, setVersion, checkAndUpdate }
}
