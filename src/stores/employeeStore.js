// src/stores/employeeStore.js
// Tracks who's signed in (PIN auth) on this terminal — separately from
// time-clock state. Signing in just grants access to the app; clocking
// in is a SEPARATE action that records payroll hours.
//
// Persists in localStorage so refreshing doesn't sign anyone out.
// Cleared on explicit sign-out.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

export const useEmployeeStore = create(
  persist(
    (set, get) => ({
      // Signed in at the terminal (PIN auth). NOT necessarily clocked in.
      activeEmployee: null,         // { id, name, role, employee_code, hourly_rate, permissions }
      signedInAt:     null,         // ISO of when they signed in to the app

      // Currently clocked in for payroll (independent of sign-in)
      clockedIn:      false,
      clockedInAt:    null,         // ISO of clock-in
      clockInEntryId: null,         // id of the open time_clock_entries row

      // ── PIN LOGIN — sign in to the app, nothing more ──
      signInWithPin: async (tenantId, pin) => {
        const { data, error } = await supabase.rpc('fn_pin_login', {
          p_tenant_id: tenantId, p_pin: pin
        })
        if (error || !data?.success) {
          throw new Error(data?.message || error?.message || 'Invalid PIN')
        }
        const u = data.user
        // Detect if they happen to ALREADY be clocked in (from earlier today)
        // so the UI can show the right state. But we don't clock anyone in here.
        const wasClockedIn = !!u.currently_clocked_in_entry
        set({
          activeEmployee: u,
          signedInAt: new Date().toISOString(),
          clockedIn: wasClockedIn,
          clockInEntryId: u.currently_clocked_in_entry || null,
          clockedInAt: wasClockedIn ? new Date().toISOString() : null,
        })
        toast.success(`Welcome, ${u.name}!`)
        return u
      },

      // Sign out of the app (doesn't affect clock state — they could
      // sign out while still clocked in, which is fine)
      signOut: () => {
        set({ activeEmployee: null, signedInAt: null })
      },

      // ── TIME CLOCK — independent of sign-in ──
      clockIn: async ({ tenantId, storeId, terminalId, userId }) => {
        const { data, error } = await supabase.rpc('fn_clock_in', {
          p_tenant_id: tenantId, p_user_id: userId,
          p_store_id: storeId, p_terminal_id: terminalId,
        })
        if (error || !data?.success) {
          throw new Error(data?.message || error?.message || 'Clock-in failed')
        }
        // If the user clocking in is the one currently signed in, update local state
        if (get().activeEmployee?.id === userId) {
          set({ clockedIn: true, clockedInAt: new Date().toISOString(), clockInEntryId: data.entry_id })
        }
        return data
      },

      clockOut: async ({ userId }) => {
        const { data, error } = await supabase.rpc('fn_clock_out', { p_user_id: userId })
        if (error || !data?.success) {
          throw new Error(data?.message || error?.message || 'Clock-out failed')
        }
        if (get().activeEmployee?.id === userId) {
          set({ clockedIn: false, clockedInAt: null, clockInEntryId: null })
        }
        return data
      },

      // Verify a PIN against a tenant — used when someone (not signed in)
      // wants to clock themselves in/out at a kiosk-style terminal.
      verifyPin: async (tenantId, pin) => {
        const { data, error } = await supabase.rpc('fn_pin_login', {
          p_tenant_id: tenantId, p_pin: pin
        })
        if (error || !data?.success) {
          throw new Error(data?.message || error?.message || 'Invalid PIN')
        }
        return data.user
      },

      reset: () => set({
        activeEmployee: null, signedInAt: null,
        clockedIn: false, clockedInAt: null, clockInEntryId: null,
      }),
    }),
    {
      name: 'retailpos-employee',
      partialize: (s) => ({
        activeEmployee: s.activeEmployee, signedInAt: s.signedInAt,
        clockedIn: s.clockedIn, clockedInAt: s.clockedInAt, clockInEntryId: s.clockInEntryId,
      }),
    }
  )
)
