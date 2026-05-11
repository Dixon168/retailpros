-- ════════════════════════════════════════════════════════════════════
-- B2C PHASE 7 — Loyalty points redemption at checkout
-- ════════════════════════════════════════════════════════════════════
-- 1. Add tenant-level loyalty settings (redeem rate, minimums)
-- 2. Add order column to track points used (orders.points_redeemed
--    already exists from MASTER_SETUP)
-- 3. Update fn_submit_order_atomic to deduct redeemed points
--    from customer.loyalty_points
-- Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── PART 1: Tenant loyalty settings ─────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS points_redeem_rate      INTEGER DEFAULT 100;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS redeem_min_pts          INTEGER DEFAULT 100;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS redeem_max_pts_per_txn  INTEGER DEFAULT 0;   -- 0 = unlimited
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS redeem_max_cash_per_txn NUMERIC(10,2) DEFAULT 0;  -- 0 = unlimited
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS redeem_max_pct_per_txn  INTEGER DEFAULT 0;   -- 0 = unlimited

COMMENT ON COLUMN tenants.points_redeem_rate      IS 'Points needed per $1 of discount. Default 100 (i.e. 100 pts = $1).';
COMMENT ON COLUMN tenants.redeem_min_pts          IS 'Minimum points required per redemption.';
COMMENT ON COLUMN tenants.redeem_max_pts_per_txn  IS 'Cap on points used per transaction. 0 = unlimited.';
COMMENT ON COLUMN tenants.redeem_max_cash_per_txn IS 'Cap on cash value of points used. 0 = unlimited.';
COMMENT ON COLUMN tenants.redeem_max_pct_per_txn  IS 'Cap on points discount as % of cart total. 0 = unlimited.';


-- ── PART 2: Make sure orders.points_redeemed exists ─────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_redeemed INTEGER DEFAULT 0;


-- ── PART 3: Add a default value column-write for points_redeemed ────
-- The RPC fn_submit_order_atomic uses an INSERT that doesn't yet
-- include points_redeemed. Rather than rewriting the long RPC, we add
-- a BEFORE INSERT trigger that copies the value out of any row that has
-- been INSERTed without setting it but where it was passed via
-- p_order_data->>'points_redeemed' (visible via current_setting or NEW).
--
-- Simpler and safer approach: just patch fn_submit_order_atomic
-- in-place to include the new field in its INSERT.

-- This block dynamically updates the INSERT statement inside the RPC body
-- (only if the function exists and doesn't already mention points_redeemed).
DO $patch$
DECLARE
  v_src    TEXT;
  v_new    TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_submit_order_atomic'
   LIMIT 1;

  IF v_src IS NULL THEN
    RAISE NOTICE 'fn_submit_order_atomic not found — skipping patch';
    RETURN;
  END IF;

  IF v_src ILIKE '%points_redeemed%' THEN
    RAISE NOTICE 'fn_submit_order_atomic already mentions points_redeemed — skipping';
    RETURN;
  END IF;

  -- Add points_redeemed to the column list and value list inside the orders INSERT
  v_new := replace(
    v_src,
    'tax_breakdown, points_earned, version',
    'tax_breakdown, points_earned, points_redeemed, version'
  );
  v_new := replace(
    v_new,
    E'COALESCE((p_order_data->>''points_earned'')::INTEGER, 0),\n    1',
    E'COALESCE((p_order_data->>''points_earned'')::INTEGER, 0),\n    COALESCE((p_order_data->>''points_redeemed'')::INTEGER, 0),\n    1'
  );

  IF v_new = v_src THEN
    RAISE NOTICE 'Could not patch fn_submit_order_atomic — INSERT pattern did not match. Manual fix needed.';
    RETURN;
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'fn_submit_order_atomic patched to include points_redeemed in INSERT';
END $patch$;


-- ── PART 4: Trigger to deduct redeemed points from customer ──────────
CREATE OR REPLACE FUNCTION fn_apply_points_redemption() RETURNS TRIGGER
LANGUAGE plpgsql AS $func$
BEGIN
  -- Deduct redeemed points from customer balance on order completion
  IF NEW.customer_id IS NOT NULL
     AND COALESCE(NEW.points_redeemed, 0) > 0 THEN
    UPDATE customers
       SET loyalty_points = GREATEST(0, COALESCE(loyalty_points, 0) - NEW.points_redeemed),
           updated_at     = NOW()
     WHERE id = NEW.customer_id
       AND tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_apply_points_redemption ON orders;
CREATE TRIGGER trg_apply_points_redemption
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_apply_points_redemption();


-- ── PART 4: Reload PostgREST schema ─────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ── VERIFY ──────────────────────────────────────────────────────────
SELECT 'tenants settings' AS section, column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'tenants'
   AND column_name IN ('points_redeem_rate','redeem_min_pts','redeem_max_pts_per_txn','redeem_max_cash_per_txn','redeem_max_pct_per_txn')
UNION ALL
SELECT 'orders.points_redeemed', column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'orders' AND column_name = 'points_redeemed'
ORDER BY section, column_name;
