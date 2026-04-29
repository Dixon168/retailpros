// src/stores/authStore.js
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

let currentSessionToken = null

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null, tenant: null, store: null, stores: [], loading: true,
      sessionConflict: null,

      initialize: async () => {
        set({ loading: true })
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.user) await get().loadUserProfile(session.user.id)
        } catch (err) {
          console.error('Auth init error:', err)
        } finally {
          set({ loading: false })
        }
        supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session?.user) await get().loadUserProfile(session.user.id)
          else if (event === 'SIGNED_OUT') set({ user: null, tenant: null, store: null, stores: [] })
        })
      },

      loadUserProfile: async (userId) => {
        const { data: up } = await supabase
          .from('users').select('*, tenants(*)')
          .eq('id', userId).single()
        if (!up) return
        if (up.tenants?.is_suspended) {
          await supabase.auth.signOut()
          toast.error('Account suspended. Contact support.')
          return
        }
        const { data: storeList } = await supabase
          .from('stores').select('*')
          .eq('tenant_id', up.tenant_id).eq('is_active', true).order('name')
        const currentStore = storeList?.find(s => s.id === up.store_id) || storeList?.[0]
        set({ user: up, tenant: up.tenants, store: currentStore, stores: storeList || [] })
      },

      signIn: async (email, password, terminalName = null) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        const { data: up } = await supabase
          .from('users').select('id, tenant_id, is_active')
          .eq('id', data.user.id).single()
        if (!up?.is_active) {
          await supabase.auth.signOut()
          throw new Error('This account has been deactivated.')
        }
        // Session check disabled - go straight to login
        await get().loadUserProfile(data.user.id)
        return { success: true }
      },

      resolveSessionConflict: async (kick = true) => {
        const c = get().sessionConflict
        if (!c) return
        if (kick) {
          await supabase.rpc('fn_kick_session', {
            p_session_id: c.session_id, p_user_id: c.userId,
            p_new_token: c.newToken, p_tenant_id: c.tenantId,
            p_terminal_name: c.terminalName,
          })
          currentSessionToken = c.newToken
          const { data: { user } } = await supabase.auth.getUser()
          if (user) await get().loadUserProfile(user.id)
        } else {
          await supabase.auth.signOut()
        }
        set({ sessionConflict: null })
      },

      signOut: async () => {
        if (currentSessionToken) {
          await supabase.rpc('fn_end_session', { p_session_token: currentSessionToken })
          currentSessionToken = null
        }
        await supabase.auth.signOut()
        set({ user: null, tenant: null, store: null, stores: [], sessionConflict: null })
      },

      switchStore: (storeId) => {
        const s = get().stores.find(s => s.id === storeId)
        if (s) set({ store: s })
      },

      checkUserQuota: async () => {
        const { tenant } = get()
        if (!tenant?.id) return { allowed: false }
        const { data } = await supabase.rpc('fn_check_user_quota', { p_tenant_id: tenant.id })
        return data
      },

      checkTerminalQuota: async () => {
        const { tenant } = get()
        if (!tenant?.id) return { allowed: false }
        const { data } = await supabase.rpc('fn_check_terminal_quota', { p_tenant_id: tenant.id })
        return data
      },

      can: (permission) => {
        const { user } = get()
        if (!user) return false
        if (user.role === 'owner') return true
        if (user.role === 'manager') {
          const mp = ['can_discount','can_refund','can_void','can_view_reports',
            'can_manage_products','can_manage_customers','can_send_invoice','can_open_drawer']
          if (mp.includes(permission)) return true
        }
        return user.permissions?.[permission] === true
      },

      canAccessSettings: (section) => {
        const { user } = get()
        if (!user) return false
        if (user.role === 'owner') return true
        if (user.role === 'manager') return ['store','users'].includes(section)
        return false
      },

      maxDiscountPct: () => {
        const { user } = get()
        if (!user) return 0
        if (user.role === 'owner' || user.role === 'manager') return 100
        return user.permissions?.max_discount_pct || 0
      },

      planLimits: () => {
        const { tenant } = get()
        return {
          maxUsers:     tenant?.max_users     || tenant?.plans?.max_users     || 1,
          maxTerminals: tenant?.max_terminals || tenant?.plans?.max_terminals || 1,
          planId:       tenant?.plan_id  || 'solo',
          planName:     tenant?.plans?.name || 'Solo',
        }
      },
    }),
    {
      name: 'retailpos-auth',
      partialize: (s) => ({ user: s.user, tenant: s.tenant, store: s.store })
    }
  )
)
