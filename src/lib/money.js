// src/lib/money.js
//
// Centralized money formatting. Pulls the currency symbol from the
// tenant's settings (set in Settings → Store → Currency) and falls
// back to '$' if not configured.
//
// USAGE
//   import { formatMoney } from '@/lib/money'
//   formatMoney(12.5)         → "$12.50"
//   formatMoney(null)         → "$0.00"
//   formatMoney(12.5, { sign: true })  → "+$12.50"
//
// In React components, use the useMoney() hook for live updates when
// the tenant settings change:
//   const { $, format } = useMoney()
//   <div>{format(item.price)}</div>
//
// THE DB CONTRACT
// tenants.currency_symbol  TEXT  (e.g. '$', '¥', '€', 'CHF ')
// tenants.currency_code    TEXT  (e.g. 'USD', 'CNY', 'EUR') — for receipts/exports

import { useAuthStore } from '@/stores/authStore'

// Module-level cache. Reads from authStore which is hydrated at app boot.
// Synchronous getter so it's safe to call from anywhere — including
// non-React contexts like the receipt builder and toast messages.
function readSymbol() {
  try {
    const s = useAuthStore.getState().tenant?.currency_symbol
    return s || '$'
  } catch {
    return '$'
  }
}

/**
 * Format a number as money. Always returns a string with the configured
 * currency symbol and 2 decimal places. Handles null/undefined gracefully.
 *
 * @param {number|string|null|undefined} value
 * @param {object} [opts]
 * @param {boolean} [opts.sign]   — prefix '+' for positives (good for adjustments)
 * @param {boolean} [opts.bare]   — return number without symbol ("12.50")
 * @param {number}  [opts.decimals=2]
 * @returns {string}
 */
export function formatMoney(value, opts = {}) {
  const { sign = false, bare = false, decimals = 2 } = opts
  const n = Number(value || 0)
  const abs = Math.abs(n).toFixed(decimals)
  const symbol = bare ? '' : readSymbol()
  if (n < 0) return `-${symbol}${abs}`
  if (sign && n > 0) return `+${symbol}${abs}`
  return `${symbol}${abs}`
}

// Convenience for templates that just want the symbol
export function moneySymbol() {
  return readSymbol()
}

// React hook — re-renders when the tenant config changes
import { useMemo } from 'react'
export function useMoney() {
  const tenant = useAuthStore(s => s.tenant)
  return useMemo(() => {
    const sym = tenant?.currency_symbol || '$'
    return {
      $: sym,
      code: tenant?.currency_code || 'USD',
      format: (v, opts) => formatMoney(v, opts),
    }
  }, [tenant?.currency_symbol, tenant?.currency_code])
}
