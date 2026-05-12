// src/lib/auditOverride.js
// Persist a manager-override approval for the audit trail.
// Called from each guard() callback so we never lose the trace.

import { supabase } from './supabase'

export async function logOverride({
  tenantId, storeId, terminalId,
  permission, actionLabel,
  requestedBy,            // { id, name } — the cashier
  approver,               // { id, name } — the manager whose PIN unlocked it
  orderId = null, orderNumber = null,
  amount = null, notes = null,
}) {
  try {
    await supabase.from('override_approvals').insert({
      tenant_id:            tenantId,
      store_id:             storeId,
      terminal_id:          terminalId,
      permission,
      action_label:         actionLabel,
      requested_by_user_id: requestedBy?.id,
      requested_by_name:    requestedBy?.name,
      approved_by_user_id:  approver?.id,
      approved_by_name:     approver?.name,
      order_id:             orderId,
      order_number:         orderNumber,
      amount,
      notes,
    })
  } catch (e) {
    // Swallow — audit failures should not block the user's action
    console.warn('Override audit log failed:', e)
  }
}
