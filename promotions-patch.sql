-- ============================================================
-- RetailPOS — Promotions System
-- 3 types: Sale Pricing / Bulk Pricing / Time Based Pricing
-- All use store local timezone
-- ============================================================

-- ── Store timezone (add to stores table) ──
ALTER TABLE stores ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';

-- ── Main promotions table (patch existing or create new) ──
CREATE TABLE IF NOT EXISTS promotions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add all new columns safely
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS product_id    UUID REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS type          TEXT DEFAULT 'sale';
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS sale_start    TIMESTAMPTZ;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS sale_end      TIMESTAMPTZ;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS sale_type     TEXT DEFAULT 'fixed';
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS sale_value    DECIMAL(10,2);
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS bulk_tiers    JSONB DEFAULT '[]';
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS time_rules    JSONB DEFAULT '[]';
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS applies_to    TEXT DEFAULT 'product';
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS category_id   UUID REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS min_order_amt DECIMAL(10,2);
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS priority      INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_promotions_product  ON promotions(product_id, is_active);
CREATE INDEX IF NOT EXISTS idx_promotions_tenant   ON promotions(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_promotions_type     ON promotions(tenant_id, type, is_active);

-- Disable RLS for now
ALTER TABLE promotions DISABLE ROW LEVEL SECURITY;

-- ── Function: get active price for a product (uses store timezone) ──
CREATE OR REPLACE FUNCTION fn_get_active_price(
  p_product_id UUID,
  p_tenant_id  UUID,
  p_quantity   DECIMAL DEFAULT 1,
  p_timezone   TEXT DEFAULT 'America/New_York'
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_product     products%ROWTYPE;
  v_now_local   TIMESTAMPTZ;
  v_time_local  TIME;
  v_dow         INTEGER; -- 0=Sun, 1=Mon...6=Sat
  v_best_price  DECIMAL(10,2);
  v_promo_name  TEXT;
  v_promo_type  TEXT;
  rec           RECORD;
  tier          JSONB;
  rule          JSONB;
  calc_price    DECIMAL(10,2);
BEGIN
  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  v_best_price := v_product.price;
  v_now_local  := NOW() AT TIME ZONE p_timezone;
  v_time_local := v_now_local::TIME;
  v_dow        := EXTRACT(DOW FROM v_now_local); -- 0=Sun

  FOR rec IN
    SELECT * FROM promotions
    WHERE tenant_id = p_tenant_id
      AND (product_id = p_product_id OR product_id IS NULL)
      AND is_active = true
    ORDER BY priority DESC
  LOOP

    -- ── Sale Pricing ──
    IF rec.type = 'sale' AND rec.sale_start IS NOT NULL THEN
      IF v_now_local BETWEEN (rec.sale_start AT TIME ZONE p_timezone)
                         AND (rec.sale_end   AT TIME ZONE p_timezone) THEN
        IF rec.sale_type = 'fixed' THEN
          calc_price := rec.sale_value;
        ELSE
          calc_price := v_product.price * (1 - rec.sale_value / 100);
        END IF;
        IF calc_price < v_best_price THEN
          v_best_price := calc_price;
          v_promo_name := rec.name;
          v_promo_type := 'sale';
        END IF;
      END IF;
    END IF;

    -- ── Bulk Pricing ──
    IF rec.type = 'bulk' AND p_quantity >= 2 THEN
      FOR tier IN SELECT * FROM jsonb_array_elements(rec.bulk_tiers)
      LOOP
        IF p_quantity >= (tier->>'min_qty')::DECIMAL THEN
          IF tier->>'type' = 'fixed' THEN
            calc_price := (tier->>'value')::DECIMAL;
          ELSE
            calc_price := v_product.price * (1 - (tier->>'value')::DECIMAL / 100);
          END IF;
          IF calc_price < v_best_price THEN
            v_best_price := calc_price;
            v_promo_name := rec.name;
            v_promo_type := 'bulk';
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- ── Time Based Pricing ──
    IF rec.type = 'time' THEN
      FOR rule IN SELECT * FROM jsonb_array_elements(rec.time_rules)
      LOOP
        IF v_dow = ANY(ARRAY(SELECT jsonb_array_elements_text(rule->'days')::INTEGER))
           AND v_time_local BETWEEN (rule->>'start_time')::TIME
                                AND (rule->>'end_time')::TIME
        THEN
          IF rule->>'type' = 'fixed' THEN
            calc_price := (rule->>'value')::DECIMAL;
          ELSE
            calc_price := v_product.price * (1 - (rule->>'value')::DECIMAL / 100);
          END IF;
          IF calc_price < v_best_price THEN
            v_best_price := calc_price;
            v_promo_name := rec.name;
            v_promo_type := 'time';
          END IF;
        END IF;
      END LOOP;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'original_price', v_product.price,
    'active_price',   v_best_price,
    'on_promo',       v_best_price < v_product.price,
    'promo_name',     v_promo_name,
    'promo_type',     v_promo_type,
    'savings',        v_product.price - v_best_price
  );
END;
$$;

SELECT 'Promotions patch applied ✓' AS status;

-- Add user tracking to inventory_adjustments
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS user_name TEXT;

-- Add cashier to orders if not exists  
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cashier_id UUID REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cashier_name TEXT;
