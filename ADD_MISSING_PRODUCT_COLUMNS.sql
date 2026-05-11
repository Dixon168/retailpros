-- ════════════════════════════════════════════════════════════════════
-- Hotfix: add missing products columns (loyalty points fields)
-- ════════════════════════════════════════════════════════════════════
-- The ProductForm payload was sending these three columns, but they
-- were never added in MASTER_SETUP or any patch — so saving a product
-- failed with PGRST204 ("Could not find the column in schema cache").
--
-- Safe to re-run — IF NOT EXISTS makes it idempotent.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS points_redeemable      BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS points_redeem          BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS redeem_points_required INTEGER;

COMMENT ON COLUMN products.points_redeemable      IS 'Whether customers can earn loyalty points buying this product.';
COMMENT ON COLUMN products.points_redeem          IS 'Whether customers can redeem points to get this product free.';
COMMENT ON COLUMN products.redeem_points_required IS 'How many points needed to redeem this product (if points_redeem=true).';

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'products'
  AND column_name IN ('points_redeemable', 'points_redeem', 'redeem_points_required')
ORDER BY column_name;
