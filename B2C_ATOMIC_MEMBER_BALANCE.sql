-- ════════════════════════════════════════════════════════════════════
-- Atomic member-card balance changes (fix race condition)
-- ════════════════════════════════════════════════════════════════════
-- The member-card top-up / reversal was done client-side as read-then-
-- write (read balance, add, write back). Two registers topping up the
-- same member at once would overwrite each other and LOSE money. These
-- RPCs do the balance change atomically in the database with FOR UPDATE,
-- the same way gift cards already work, and log the customer_topups row
-- in the same transaction.
-- ════════════════════════════════════════════════════════════════════

-- ── Member top-up (atomic) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_member_topup(
  p_tenant_id   UUID,
  p_customer_id UUID,
  p_amount      NUMERIC,                 -- 充值金额 onto the card
  p_paid_amount NUMERIC DEFAULT NULL,    -- 付款金额 collected
  p_bonus       NUMERIC DEFAULT 0,
  p_user_id     UUID DEFAULT NULL,
  p_order_id    UUID DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE v_bal NUMERIC(10,2); v_new NUMERIC(10,2); v_paid NUMERIC(10,2);
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be > 0');
  END IF;
  SELECT COALESCE(card_balance,0) INTO v_bal FROM customers
   WHERE id = p_customer_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Member not found');
  END IF;
  v_paid := COALESCE(p_paid_amount, p_amount);
  v_new  := v_bal + p_amount;
  UPDATE customers SET card_balance = v_new WHERE id = p_customer_id;
  INSERT INTO customer_topups
    (tenant_id, customer_id, amount, paid_amount, bonus_amount, balance_after, method, note, staff_id, order_id)
  VALUES
    (p_tenant_id, p_customer_id, p_amount, v_paid, COALESCE(p_bonus,0), v_new,
     'order', p_note, p_user_id, p_order_id);
  RETURN jsonb_build_object('success', true, 'balance', v_new, 'previous_balance', v_bal);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── Member reversal (atomic) — pull a top-up back off the card ─────
CREATE OR REPLACE FUNCTION fn_member_reverse(
  p_tenant_id   UUID,
  p_customer_id UUID,
  p_amount      NUMERIC,                 -- top-up amount to pull back
  p_allow_negative BOOLEAN DEFAULT FALSE,
  p_user_id     UUID DEFAULT NULL,
  p_order_id    UUID DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE v_bal NUMERIC(10,2); v_new NUMERIC(10,2);
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be > 0');
  END IF;
  SELECT COALESCE(card_balance,0) INTO v_bal FROM customers
   WHERE id = p_customer_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Member not found');
  END IF;
  IF v_bal < p_amount AND NOT p_allow_negative THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Insufficient card balance to reverse — manager override required',
      'balance', v_bal, 'needed', p_amount);
  END IF;
  v_new := v_bal - p_amount;
  UPDATE customers SET card_balance = v_new WHERE id = p_customer_id;
  INSERT INTO customer_topups
    (tenant_id, customer_id, amount, paid_amount, bonus_amount, balance_after, method, note, staff_id, order_id)
  VALUES
    (p_tenant_id, p_customer_id, -p_amount, NULL, 0, v_new, 'reversal', p_note, p_user_id, p_order_id);
  RETURN jsonb_build_object('success', true, 'balance', v_new, 'went_negative', v_new < 0);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── Card-activation failures log (financial safety net) ────────────
-- If a card load/reversal can't complete after the sale is already
-- finalized, we record it here so nothing is silently lost and staff can
-- reconcile. (The UI also alerts the cashier.)
CREATE TABLE IF NOT EXISTS card_activation_failures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id    UUID,
  order_number TEXT,
  kind        TEXT,                    -- topup | reversal
  card_kind   TEXT,                    -- gift | member
  detail      JSONB,                   -- the cardTopup / cardReversal payload
  error       TEXT,
  resolved    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE card_activation_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS caf_tenant ON card_activation_failures;
CREATE POLICY caf_tenant ON card_activation_failures
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));


-- ── Atomic inventory restore (used by product refunds) ─────────────
CREATE OR REPLACE FUNCTION fn_restore_inventory(
  p_tenant_id  UUID,
  p_product_id UUID,
  p_store_id   UUID,
  p_qty        NUMERIC
) RETURNS JSONB LANGUAGE plpgsql AS $func$
BEGIN
  IF p_product_id IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;
  INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
  VALUES (p_tenant_id, p_product_id, p_store_id, p_qty)
  ON CONFLICT (tenant_id, product_id, store_id)
  DO UPDATE SET quantity = inventory.quantity + p_qty, updated_at = NOW();
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


NOTIFY pgrst, 'reload schema';

SELECT 'fn_member_topup'   AS section, EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_member_topup')::TEXT AS ok
UNION ALL SELECT 'fn_member_reverse', EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_member_reverse')::TEXT
UNION ALL SELECT 'fn_restore_inventory', EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_restore_inventory')::TEXT
UNION ALL SELECT 'card_activation_failures', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='card_activation_failures')::TEXT;
