// src/lib/cardNumber.js
// Single source of truth for member-card-number handling:
//   • normalize() — trim and strip junk so '#1234', ' 1234 ', '1234 '
//     all become the same canonical '1234'
//   • checkAvailable(tenantId, card, excludeId?) — look up whether this
//     card number is already used by ANOTHER customer in the same tenant.
//     Returns { available, conflictName, conflictId }. Used to give the
//     cashier a live warning BEFORE they hit Save, so they don't trigger
//     the UNIQUE(tenant_id, card_number) constraint and they don't
//     accidentally assign a duplicate that would later match the wrong
//     person at the POS.
import { supabase } from '@/lib/supabase'

export function normalizeCard(raw) {
  // Members swipe / scan / type — accept whichever and strip prefixes,
  // spaces, dashes. Keep it case-insensitive for alphanumeric cards.
  return String(raw || '')
    .trim()
    .replace(/^#/, '')
    .replace(/[\s\-]/g, '')
    .toUpperCase()
}

export async function checkCardAvailable(tenantId, rawCard, excludeId = null) {
  const card = normalizeCard(rawCard)
  if (!card) return { available: false, reason: 'empty' }
  // Minimum length so a stray digit doesn't lock everyone out
  if (card.length < 2) return { available: false, reason: 'too_short' }

  let q = supabase.from('customers')
    .select('id, name, card_number')
    .eq('tenant_id', tenantId)
    .eq('card_number', card)
    .limit(1)
  if (excludeId) q = q.neq('id', excludeId)

  const { data } = await q
  const hit = data && data[0]
  if (hit) {
    return { available: false, reason: 'taken', conflictName: hit.name, conflictId: hit.id }
  }
  return { available: true }
}
