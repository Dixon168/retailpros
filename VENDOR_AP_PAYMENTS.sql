-- ════════════════════════════════════════════════════════════════════
-- Vendor AP (Accounts Payable) — simple version
-- Per Dixon: each PO has Detail / Pay. Pay records type + remark + time.
-- Vendor page shows Open PO / Completed PO / Balance.
--
-- "Owed" = total of received POs minus what's been paid.
-- A PO is "paid/completed" when amount_paid >= total.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Track payment on each PO ─────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0;

-- balance_due is derived: total - amount_paid
ALTER TABLE purchase_orders
  DROP COLUMN IF EXISTS po_balance_due;
ALTER TABLE purchase_orders
  ADD COLUMN po_balance_due DECIMAL(10,2)
  GENERATED ALWAYS AS (GREATEST(total - amount_paid, 0)) STORED;

-- ── 2. Vendor payment records ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_payments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  po_id       UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  amount      DECIMAL(10,2) NOT NULL,
  method      TEXT NOT NULL DEFAULT 'cash',  -- cash | check | card | transfer | other
  remark      TEXT,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_payments_tenant   ON vendor_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_supplier ON vendor_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_po       ON vendor_payments(po_id);

ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_payments_tenant ON vendor_payments;
CREATE POLICY vendor_payments_tenant ON vendor_payments
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

-- ── 3. Record a vendor payment (atomic): insert + bump PO amount_paid ─
CREATE OR REPLACE FUNCTION fn_pay_vendor_po(
  p_tenant_id   UUID,
  p_supplier_id UUID,
  p_po_id       UUID,
  p_amount      NUMERIC,
  p_method      TEXT,
  p_remark      TEXT,
  p_user_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total    NUMERIC;
  v_paid     NUMERIC;
  v_new_paid NUMERIC;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be greater than 0');
  END IF;

  -- Record the payment
  INSERT INTO vendor_payments (tenant_id, supplier_id, po_id, amount, method, remark, created_by)
  VALUES (p_tenant_id, p_supplier_id, p_po_id, p_amount, COALESCE(p_method,'cash'), p_remark, p_user_id);

  -- Bump the PO's amount_paid
  IF p_po_id IS NOT NULL THEN
    SELECT total, amount_paid INTO v_total, v_paid
      FROM purchase_orders
     WHERE id = p_po_id AND tenant_id = p_tenant_id
     FOR UPDATE;

    v_new_paid := COALESCE(v_paid, 0) + p_amount;

    UPDATE purchase_orders
       SET amount_paid = v_new_paid,
           updated_at  = NOW()
     WHERE id = p_po_id AND tenant_id = p_tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'success',     true,
    'new_paid',    v_new_paid,
    'po_total',    v_total,
    'balance',     GREATEST(COALESCE(v_total,0) - COALESCE(v_new_paid,0), 0)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT 'amount_paid column' AS check,
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name='purchase_orders' AND column_name='amount_paid')::TEXT AS ok
UNION ALL
SELECT 'vendor_payments table',
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='vendor_payments')::TEXT
UNION ALL
SELECT 'fn_pay_vendor_po',
       EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_pay_vendor_po')::TEXT;

-- ── 4. Refresh the PO view to expose payment fields too ─────────────
-- DROP first: CREATE OR REPLACE can't reorder/rename existing view columns
-- (po.* now includes amount_paid + po_balance_due, which shifts positions).
DROP VIEW IF EXISTS v_po_with_vendor;
CREATE VIEW v_po_with_vendor AS
SELECT
  po.*,
  s.name         AS vendor_name,
  s.contact_name AS vendor_contact,
  s.phone        AS vendor_phone,
  s.email        AS vendor_email,
  COALESCE(agg.item_count, 0)    AS item_count,
  COALESCE(agg.total_qty, 0)     AS total_qty,
  COALESCE(agg.received_qty, 0)  AS received_qty
FROM purchase_orders po
LEFT JOIN suppliers s ON s.id = po.supplier_id
LEFT JOIN (
  SELECT po_id,
         COUNT(*)      AS item_count,
         SUM(quantity) AS total_qty,
         SUM(received) AS received_qty
  FROM purchase_order_items
  GROUP BY po_id
) agg ON agg.po_id = po.id;

NOTIFY pgrst, 'reload schema';
