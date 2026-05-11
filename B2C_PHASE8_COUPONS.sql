-- ════════════════════════════════════════════════════════════════════
-- PHASE 8 — Coupons system
-- ════════════════════════════════════════════════════════════════════
-- Adds:
--   - coupons table          : the coupon definitions (name, code, value, expiry, etc.)
--   - coupon_redemptions table : log of every successful redemption (which order, when)
--   - fn_validate_coupon RPC : validate a code against the rules and return info
--   - orders.coupon_id / coupon_code / coupon_discount columns
--   - patch fn_submit_order_atomic to record coupon_id when present
--   - trigger to insert a coupon_redemptions row + bump times_used on order INSERT
--
-- Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── PART 1: coupons table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,                        -- "Summer 2026"
  code         TEXT NOT NULL,                        -- "SUMMER10" (case-insensitive lookup)
  discount_type TEXT NOT NULL CHECK (discount_type IN ('pct','amt')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value >= 0),
  use_type     TEXT NOT NULL DEFAULT 'recurring' CHECK (use_type IN ('one_time','recurring')),
  -- 'one_time' = each customer can only use it once (per-customer dedup)
  -- 'recurring' = unlimited uses per customer

  max_uses     INTEGER,                              -- NULL = unlimited TOTAL uses across all customers
  times_used   INTEGER NOT NULL DEFAULT 0,           -- counter, auto-incremented by trigger
  min_subtotal NUMERIC(10,2),                        -- NULL = no minimum; else require subtotal >= this
  expires_at   TIMESTAMPTZ,                          -- NULL = never expires
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID,
  UNIQUE (tenant_id, code)
);

-- Case-insensitive code lookup
CREATE INDEX IF NOT EXISTS idx_coupons_code_lower ON coupons(tenant_id, LOWER(code));


-- ── PART 2: coupon_redemptions log ──────────────────────────────────
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  coupon_id     UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id   UUID,                                -- NULL = walk-in
  discount_amount NUMERIC(10,2) NOT NULL,
  redeemed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_redemptions_coupon  ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_customer ON coupon_redemptions(customer_id);


-- ── PART 3: order columns to track which coupon was applied ─────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id        UUID REFERENCES coupons(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount  NUMERIC(10,2) DEFAULT 0;


-- ── PART 4: validate-coupon RPC ─────────────────────────────────────
-- Returns:
--   { success: true, coupon: { id, code, name, discount_type, discount_value, discount_amount } }
--   or { success: false, message: "..." }
CREATE OR REPLACE FUNCTION fn_validate_coupon(
  p_tenant_id   UUID,
  p_code        TEXT,
  p_subtotal    NUMERIC,
  p_customer_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_c           coupons%ROWTYPE;
  v_used_count  INT;
  v_amount      NUMERIC(10,2);
BEGIN
  SELECT * INTO v_c
    FROM coupons
   WHERE tenant_id = p_tenant_id
     AND LOWER(code) = LOWER(TRIM(p_code))
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Coupon code not found');
  END IF;

  IF NOT v_c.is_active THEN
    RETURN jsonb_build_object('success', false, 'message', 'This coupon is disabled');
  END IF;

  IF v_c.expires_at IS NOT NULL AND v_c.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'message', 'This coupon has expired');
  END IF;

  IF v_c.min_subtotal IS NOT NULL AND p_subtotal < v_c.min_subtotal THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Minimum order subtotal: $' || v_c.min_subtotal::TEXT
    );
  END IF;

  IF v_c.max_uses IS NOT NULL AND v_c.times_used >= v_c.max_uses THEN
    RETURN jsonb_build_object('success', false, 'message', 'This coupon has reached its usage limit');
  END IF;

  -- Per-customer dedup for one-time use
  IF v_c.use_type = 'one_time' AND p_customer_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_used_count
      FROM coupon_redemptions
     WHERE coupon_id = v_c.id AND customer_id = p_customer_id;
    IF v_used_count > 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'This customer has already used this coupon');
    END IF;
  END IF;

  -- Compute discount amount in dollars
  IF v_c.discount_type = 'pct' THEN
    v_amount := ROUND(p_subtotal * (v_c.discount_value / 100.0), 2);
  ELSE
    v_amount := LEAST(v_c.discount_value, p_subtotal);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'coupon', jsonb_build_object(
      'id',             v_c.id,
      'code',           v_c.code,
      'name',           v_c.name,
      'discount_type',  v_c.discount_type,
      'discount_value', v_c.discount_value,
      'discount_amount', v_amount,
      'use_type',       v_c.use_type
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', 'Error: ' || SQLERRM);
END;
$func$;


-- ── PART 5: patch fn_submit_order_atomic to write coupon fields ─────
DO $patch$
DECLARE
  v_src TEXT;
  v_new TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_submit_order_atomic'
   LIMIT 1;

  IF v_src IS NULL THEN
    RAISE NOTICE 'fn_submit_order_atomic not found — skipping coupon patch';
    RETURN;
  END IF;

  IF v_src ILIKE '%coupon_id%' THEN
    RAISE NOTICE 'fn_submit_order_atomic already mentions coupon_id — skipping';
    RETURN;
  END IF;

  -- Append coupon_id, coupon_code, coupon_discount to the column list
  v_new := replace(
    v_src,
    'points_redeemed, version',
    'points_redeemed, coupon_id, coupon_code, coupon_discount, version'
  );
  -- Append the corresponding values into the VALUES list (after points_redeemed value, before the trailing `1`)
  v_new := replace(
    v_new,
    E'COALESCE((p_order_data->>''points_redeemed'')::INTEGER, 0),\n    1',
    E'COALESCE((p_order_data->>''points_redeemed'')::INTEGER, 0),\n    NULLIF(p_order_data->>''coupon_id'','''')::UUID,\n    p_order_data->>''coupon_code'',\n    COALESCE((p_order_data->>''coupon_discount'')::NUMERIC, 0),\n    1'
  );

  IF v_new = v_src THEN
    RAISE NOTICE 'Could not patch fn_submit_order_atomic — INSERT pattern did not match. Manual fix needed.';
    RETURN;
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'fn_submit_order_atomic patched to include coupon fields';
END $patch$;


-- ── PART 6: trigger to log redemption + bump counter ────────────────
CREATE OR REPLACE FUNCTION fn_log_coupon_redemption() RETURNS TRIGGER
LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.coupon_id IS NOT NULL AND COALESCE(NEW.coupon_discount, 0) > 0 THEN
    INSERT INTO coupon_redemptions
      (tenant_id, coupon_id, order_id, customer_id, discount_amount)
    VALUES
      (NEW.tenant_id, NEW.coupon_id, NEW.id, NEW.customer_id, NEW.coupon_discount);

    UPDATE coupons
       SET times_used = COALESCE(times_used, 0) + 1
     WHERE id = NEW.coupon_id;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_log_coupon_redemption ON orders;
CREATE TRIGGER trg_log_coupon_redemption
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_coupon_redemption();


-- ── PART 7: PostgREST reload ────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ── VERIFY ──────────────────────────────────────────────────────────
SELECT 'coupons table' AS section, COUNT(*)::TEXT AS info
  FROM information_schema.tables WHERE table_name = 'coupons'
UNION ALL
SELECT 'coupon_redemptions table', COUNT(*)::TEXT
  FROM information_schema.tables WHERE table_name = 'coupon_redemptions'
UNION ALL
SELECT 'orders coupon cols', string_agg(column_name, ', ')
  FROM information_schema.columns
 WHERE table_name = 'orders' AND column_name IN ('coupon_id','coupon_code','coupon_discount')
UNION ALL
SELECT 'fn_validate_coupon', CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='fn_validate_coupon') THEN 'exists' ELSE 'MISSING' END
UNION ALL
SELECT 'trg_log_coupon_redemption', CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_log_coupon_redemption') THEN 'exists' ELSE 'MISSING' END;
