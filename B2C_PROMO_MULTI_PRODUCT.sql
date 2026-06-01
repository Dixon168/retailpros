-- ════════════════════════════════════════════════════════════════════
-- B2C_PROMO_MULTI_PRODUCT.sql
-- One promotion, many products (the "Summer Sale — 30 items @ 20% off"
-- pattern). Adds a join table promotion_products. The old single-product
-- column promotions.product_id is preserved so existing promos keep
-- working; new promos can use the list OR a single product.
--
-- Conflict policy: a product can only appear in ONE ACTIVE promotion at
-- a time. We DO NOT enforce this with a hard DB constraint because the
-- merchant can have inactive / future / past promos sitting around with
-- overlapping products — that's fine. The UI checks the conflict and
-- refuses to add a product that's already in another active promo.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS promotion_products (
  promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  added_at     TIMESTAMPTZ DEFAULT NOW(),
  added_via    TEXT,    -- 'manual' | 'category:<name>' | 'csv' — informational
  PRIMARY KEY (promotion_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_products_product
  ON promotion_products(product_id);

CREATE INDEX IF NOT EXISTS idx_promo_products_promotion
  ON promotion_products(promotion_id);

-- ── Conflict-detection helper ────────────────────────────────────────
-- Given a list of product_ids and an optional "exclude this promo" id
-- (when editing), return rows of (product_id, conflicting_promotion_id,
-- conflicting_promotion_name) for each product already in ANOTHER active
-- promo. UI calls this before adding products to the list.
CREATE OR REPLACE FUNCTION fn_promo_conflicts(
  p_tenant_id   UUID,
  p_product_ids UUID[],
  p_exclude_id  UUID DEFAULT NULL
) RETURNS TABLE (
  product_id           UUID,
  conflict_promo_id    UUID,
  conflict_promo_name  TEXT
) AS $$
  -- Conflict #1: product already in another active promo's product list
  SELECT pp.product_id, p.id, p.name
    FROM promotion_products pp
    JOIN promotions p ON p.id = pp.promotion_id
   WHERE pp.product_id = ANY(p_product_ids)
     AND p.tenant_id   = p_tenant_id
     AND p.is_active   = true
     AND (p_exclude_id IS NULL OR p.id <> p_exclude_id)
  UNION
  -- Conflict #2: product is the single-product target of another active promo
  SELECT p.product_id, p.id, p.name
    FROM promotions p
   WHERE p.product_id = ANY(p_product_ids)
     AND p.tenant_id  = p_tenant_id
     AND p.is_active  = true
     AND (p_exclude_id IS NULL OR p.id <> p_exclude_id)
$$ LANGUAGE sql STABLE;

NOTIFY pgrst, 'reload schema';

SELECT 'promotion_products' AS section,
  EXISTS(SELECT 1 FROM information_schema.tables
     WHERE table_name='promotion_products')::TEXT AS ok
UNION ALL
SELECT 'fn_promo_conflicts',
  EXISTS(SELECT 1 FROM information_schema.routines
     WHERE routine_name='fn_promo_conflicts')::TEXT;
