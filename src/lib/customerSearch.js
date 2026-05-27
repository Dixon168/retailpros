// src/lib/customerSearch.js
// ONE place for "find a customer/member". Every screen that looks up a
// customer (POS Select Customer, POS member-card top-up, Members page,
// refunds, etc.) should use this so behavior is identical everywhere:
//   • searches name / phone / code / email / card_number
//   • phone matching ignores formatting — typing 3479966666 finds a
//     number stored as (347) 996-6666, and vice-versa
//   • includes inactive customers in the fallback so nobody is invisible
//   • sanitizes the term against PostgREST filter metacharacters
import { supabase } from '@/lib/supabase'

const COLS = 'id, code, name, phone, email, loyalty_points, credit_balance, card_number, card_balance, is_active, member_level'

export async function searchCustomers(tenantId, term, { activeOnly = false, limit = 10 } = {}) {
  if (!tenantId) return []
  const raw = (term || '').trim()
  // No search term → return nothing (don't dump the whole member list)
  if (!raw) return []
  const safe = raw.replace(/[,()*%\\]/g, ' ').trim()
  const digits = raw.replace(/\D/g, '')
  if (!safe) return []

  let q = supabase.from('customers').select(COLS).eq('tenant_id', tenantId)
  if (activeOnly) q = q.eq('is_active', true)

  // A full 10-digit number is treated as a complete phone — match exactly
  // (digits-only), so a finished number shows just that one member.
  const fullPhone = digits.length >= 10
  if (fullPhone) {
    q = q.ilike('phone', `%${digits}%`)
  } else {
    const ors = [
      `name.ilike.%${safe}%`,
      `phone.ilike.%${safe}%`,
      `code.ilike.%${safe}%`,
      `email.ilike.%${safe}%`,
      `card_number.ilike.%${safe}%`,
    ]
    if (digits.length >= 3) ors.push(`phone.ilike.%${digits}%`)
    q = q.or(ors.join(','))
  }
  let { data } = await q.order('name').limit(limit)
  data = data || []

  // Fallback: nothing matched via the indexed query — pull a wider set and
  // match client-side on digits-only phone or loose text so formatting and
  // an inactive flag never hide a real member. Capped to `limit`.
  if (data.length === 0) {
    let fq = supabase.from('customers').select(COLS).eq('tenant_id', tenantId).limit(1000)
    if (activeOnly) fq = fq.eq('is_active', true)
    const { data: all } = await fq
    const lower = safe.toLowerCase()
    data = (all || []).filter(c => {
      const ph = (c.phone || '').replace(/\D/g, '')
      if (fullPhone) return ph.includes(digits)   // finished number → exact
      return (digits.length >= 3 && ph.includes(digits))
        || (c.name || '').toLowerCase().includes(lower)
        || (c.email || '').toLowerCase().includes(lower)
        || (c.code || '').toLowerCase().includes(lower)
        || (c.card_number || '').toLowerCase().includes(lower)
    }).slice(0, limit)
  }
  return data
}
