// src/stores/terminalStore.js
// 终端状态管理
// 负责：终端注册、PAX配置、班次开/关、心跳

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import { paxGetStatus } from '@/lib/pax'
import toast from 'react-hot-toast'

// 浏览器指纹（用于自动识别已注册终端）
function getDeviceFingerprint() {
  const nav = navigator
  const parts = [
    nav.userAgent,
    nav.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    nav.hardwareConcurrency || '',
    nav.platform || '',
  ]
  // 简单 hash
  const str = parts.join('|')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

export const useTerminalStore = create(
  persist(
    (set, get) => ({
      // ── 终端数据 ──
      terminal: null,      // 当前终端完整记录（含 pax_ip 等配置）
      terminalId: null,    // 快速访问
      isRegistered: false,

      // ── 班次数据 ──
      currentShift: null,  // 当前开启的班次记录
      shiftOpen: false,

      // ── PAX 状态 ──
      paxOnline: false,
      paxChecking: false,
      paxLastChecked: null,

      // ── 初始化：尝试自动识别本机 ──
      initialize: async (tenantId) => {
        const fingerprint = getDeviceFingerprint()

        // 先用本地存储的 terminalId 查
        const storedId = get().terminalId
        if (storedId) {
          const { data } = await supabase
            .from('terminals')
            .select('*')
            .eq('id', storedId)
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .maybeSingle()

          if (data) {
            set({ terminal: data, terminalId: data.id, isRegistered: true })
            get()._startHeartbeat(data.id)
            get()._checkPax()
            return { found: true, terminal: data }
          }
        }

        // 用指纹匹配
        const { data: byFingerprint } = await supabase
          .from('terminals')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('device_fingerprint', fingerprint)
          .eq('is_active', true)
          .maybeSingle()

        if (byFingerprint) {
          set({
            terminal: byFingerprint,
            terminalId: byFingerprint.id,
            isRegistered: true
          })
          get()._startHeartbeat(byFingerprint.id)
          get()._checkPax()
          return { found: true, terminal: byFingerprint }
        }

        // 未找到 → 需要注册
        return { found: false, fingerprint }
      },

      // ── 注册新终端 ──
      register: async (tenantId, storeId, { name, paxIp, paxPort, paxModel, paxEnabled }) => {
        const fingerprint = getDeviceFingerprint()

        const { data, error } = await supabase
          .from('terminals')
          .insert({
            tenant_id:        tenantId,
            store_id:         storeId,
            name,
            device_fingerprint: fingerprint,
            pax_ip:           paxIp || null,
            pax_port:         paxPort || 10009,
            pax_model:        paxModel || null,
            pax_enabled:      paxEnabled && !!paxIp,
            last_seen_at:     new Date().toISOString(),
          })
          .select()
          .single()

        if (error) {
          toast.error('Failed to register terminal')
          throw error
        }

        set({ terminal: data, terminalId: data.id, isRegistered: true })
        get()._startHeartbeat(data.id)
        if (data.pax_enabled) get()._checkPax()

        toast.success(`✅ Terminal "${name}" registered`)
        return data
      },

      // ── 更新 PAX 配置 ──
      updatePaxConfig: async ({ paxIp, paxPort, paxModel, paxEnabled }) => {
        const { terminalId } = get()
        if (!terminalId) return

        const { data, error } = await supabase
          .from('terminals')
          .update({
            pax_ip:      paxIp,
            pax_port:    paxPort || 10009,
            pax_model:   paxModel,
            pax_enabled: paxEnabled && !!paxIp,
            updated_at:  new Date().toISOString(),
          })
          .eq('id', terminalId)
          .select()
          .single()

        if (error) { toast.error('Failed to update PAX config'); throw error }

        set({ terminal: data })
        if (data.pax_enabled) get()._checkPax()
        toast.success('PAX configuration saved')
        return data
      },

      // ── 开班 ──
      openShift: async (tenantId, storeId, cashierId, openingAmount) => {
        const { terminalId, terminal } = get()

        const { data, error } = await supabase
          .from('cash_drawers')
          .insert({
            tenant_id:      tenantId,
            store_id:       storeId,
            terminal_id:    terminalId,
            terminal_name:  terminal?.name,
            cashier_id:     cashierId,
            opening_amount: openingAmount,
            opened_at:      new Date().toISOString(),
          })
          .select()
          .single()

        if (error) { toast.error('Failed to open shift'); throw error }

        set({ currentShift: data, shiftOpen: true })

        // 更新终端的当前收银员
        await supabase.from('terminals').update({
          current_cashier_id: cashierId,
          last_seen_at: new Date().toISOString(),
        }).eq('id', terminalId)

        toast.success(`Shift opened — Float: $${openingAmount.toFixed(2)}`)
        return data
      },

      // ── 收班 ──
      closeShift: async (closingAmount) => {
        const { currentShift } = get()
        if (!currentShift) return

        // 计算应有现金（班次内所有现金支付）
        const { data: cashPayments } = await supabase
          .from('order_payments')
          .select('amount, orders!inner(created_at)')
          .eq('method', 'cash')
          .gte('orders.created_at', currentShift.opened_at)

        const cashTotal = cashPayments?.reduce((s, p) => s + p.amount, 0) || 0
        const expectedAmount = (currentShift.opening_amount || 0) + cashTotal
        const variance = closingAmount - expectedAmount

        const { data, error } = await supabase
          .from('cash_drawers')
          .update({
            closed_at:       new Date().toISOString(),
            closing_amount:  closingAmount,
            expected_amount: expectedAmount,
            variance:        variance,
          })
          .eq('id', currentShift.id)
          .select()
          .single()

        if (error) { toast.error('Failed to close shift'); throw error }

        set({ currentShift: null, shiftOpen: false })
        toast.success(
          variance === 0
            ? '✅ Shift closed — Cash balanced'
            : `⚠️ Shift closed — Variance: ${variance >= 0 ? '+' : ''}$${variance.toFixed(2)}`
        )
        return data
      },

      // ── 检查 PAX 状态 ──
      _checkPax: async () => {
        const { terminal } = get()
        if (!terminal?.pax_enabled || !terminal?.pax_ip) return

        set({ paxChecking: true })
        const result = await paxGetStatus({
          paxIp:   terminal.pax_ip,
          paxPort: terminal.pax_port || 10009,
        })
        set({
          paxOnline:      result.online,
          paxChecking:    false,
          paxLastChecked: new Date(),
        })
      },

      // ── 心跳（每60秒更新 last_seen_at）──
      _heartbeatTimer: null,
      _startHeartbeat: (terminalId) => {
        clearInterval(get()._heartbeatTimer)
        const timer = setInterval(() => {
          supabase.rpc('fn_terminal_heartbeat', { p_terminal_id: terminalId })
        }, 60_000)
        set({ _heartbeatTimer: timer })
      },

      // ── 重置（换机器用）──
      reset: () => {
        clearInterval(get()._heartbeatTimer)
        set({
          terminal: null, terminalId: null, isRegistered: false,
          currentShift: null, shiftOpen: false,
          paxOnline: false,
        })
      },
    }),
    {
      name: 'retailpos-terminal',
      // 持久化到 localStorage（localStorage 不随 sessionStorage 关闭而清空）
      partialize: (state) => ({
        terminalId: state.terminalId,
        // 不持久化 terminal 完整数据，每次启动重新从数据库加载
      })
    }
  )
)
