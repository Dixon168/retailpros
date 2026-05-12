-- ════════════════════════════════════════════════════════════════════
-- Approver audit trail for manager-override actions
-- ════════════════════════════════════════════════════════════════════
-- Whenever a cashier triggers a 'prompt' permission and a manager
-- enters their PIN, we store the approver alongside the action.
-- ════════════════════════════════════════════════════════════════════

-- Voided orders: who approved the void
ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided_approved_by      UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided_approved_by_name TEXT;

-- Refunded orders: who approved the refund
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_approved_by      UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_approved_by_name TEXT;

-- refund_records: same fields so reports per-refund see it too
ALTER TABLE refund_records ADD COLUMN IF NOT EXISTS approved_by      UUID;
ALTER TABLE refund_records ADD COLUMN IF NOT EXISTS approved_by_name TEXT;

-- order_adjustments (voids show up here too): approver columns
ALTER TABLE order_adjustments ADD COLUMN IF NOT EXISTS approved_by      UUID;
ALTER TABLE order_adjustments ADD COLUMN IF NOT EXISTS approved_by_name TEXT;


-- A standalone audit log of EVERY override (sale-level price/discount
-- overrides won't show up in voids/refunds, so we want a dedicated table)
CREATE TABLE IF NOT EXISTS override_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id      UUID REFERENCES stores(id) ON DELETE SET NULL,
  terminal_id   UUID REFERENCES terminals(id) ON DELETE SET NULL,

  permission    TEXT NOT NULL,           -- e.g. 'pos.refund', 'pos.void'
  action_label  TEXT,                    -- human-readable, e.g. 'process this refund'

  requested_by_user_id UUID,             -- cashier who tried the action
  requested_by_name    TEXT,
  approved_by_user_id  UUID,             -- manager whose PIN was used
  approved_by_name     TEXT,

  order_id      UUID,                    -- if the action was tied to an order
  order_number  TEXT,
  amount        NUMERIC(10,2),           -- if monetary (refund amount, void amount, etc.)
  notes         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_override_approvals_tenant_dt
  ON override_approvals(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_override_approvals_order
  ON override_approvals(order_id);


NOTIFY pgrst, 'reload schema';

SELECT 'override_approvals' AS section,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='override_approvals')::TEXT AS ok
UNION ALL SELECT 'orders.voided_approved_by',
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='voided_approved_by')::TEXT
UNION ALL SELECT 'orders.refunded_approved_by',
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='refunded_approved_by')::TEXT
UNION ALL SELECT 'refund_records.approved_by',
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='refund_records' AND column_name='approved_by')::TEXT
UNION ALL SELECT 'order_adjustments.approved_by',
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='order_adjustments' AND column_name='approved_by')::TEXT;
