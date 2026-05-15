-- ════════════════════════════════════════════════════════════════════
-- BUG SWEEP: ensure all required columns exist on inventory tables
-- ════════════════════════════════════════════════════════════════════
-- This script is IDEMPOTENT — safe to run multiple times. It addresses
-- the cluster of bugs Dixon reported on May 14: Save buttons stuck on
-- "Saving...", missing receive/adjustment history, Total Received showing
-- 0 while In Stock shows 19, etc. Root causes were a mix of:
--   - missing store_id columns on inventory_receives / inventory_adjustments
--   - missing is_enabled column on products (Disable/Enable toggle silently
--     no-op'd because PostgREST rejected the unknown column)
--   - frontend joining 'suppliers' when the real FK is 'vendors'
--   - frontend not checking the Supabase { error } return on writes
--
-- The frontend changes are in commits a6ee2f3 → e08bcc5. This SQL covers
-- the schema side.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. products.is_enabled ─────────────────────────────────────────
-- Used by the Disable/Enable button on the products grid. The column
-- never existed in any migration, so updates failed silently.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill existing rows: assume enabled.
UPDATE products SET is_enabled = TRUE WHERE is_enabled IS NULL;


-- ── 2. inventory_receives.store_id ─────────────────────────────────
-- Was missing on a fraction of deployments. We need this so each store
-- has its own receive history (multi-store deployments).
ALTER TABLE inventory_receives
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

-- Backfill: if a tenant has only one store, attribute all NULL store_id
-- receives to that store. Multi-store deployments get manual review.
UPDATE inventory_receives ir
   SET store_id = (
     SELECT s.id FROM stores s
      WHERE s.tenant_id = ir.tenant_id
      LIMIT 1
   )
 WHERE ir.store_id IS NULL
   AND (SELECT COUNT(*) FROM stores s WHERE s.tenant_id = ir.tenant_id) = 1;


-- ── 3. inventory_adjustments.store_id ──────────────────────────────
-- Same as above but for adjustments.
ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

UPDATE inventory_adjustments ia
   SET store_id = (
     SELECT s.id FROM stores s
      WHERE s.tenant_id = ia.tenant_id
      LIMIT 1
   )
 WHERE ia.store_id IS NULL
   AND (SELECT COUNT(*) FROM stores s WHERE s.tenant_id = ia.tenant_id) = 1;


-- ── 4. inventory_adjustments.notes (used by Adjust modal) ──────────
ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS notes TEXT;


-- ── 5. Indexes for the report queries ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inv_receives_store
  ON inventory_receives(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inv_adjustments_store
  ON inventory_adjustments(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_enabled
  ON products(tenant_id, is_enabled) WHERE is_active = TRUE;


-- ── 6. Reload PostgREST schema cache ───────────────────────────────
-- Without this, the API will keep returning "column does not exist"
-- errors even after we add the columns. NOTIFY tells PostgREST to
-- re-introspect the schema immediately.
NOTIFY pgrst, 'reload schema';


-- ── 7. Verification — run this last and check all 'ok' ──────────────
SELECT 'products.is_enabled column' AS check,
       (EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='products' AND column_name='is_enabled'))::TEXT AS ok
UNION ALL
SELECT 'inventory_receives.store_id',
       (EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='inventory_receives' AND column_name='store_id'))::TEXT
UNION ALL
SELECT 'inventory_adjustments.store_id',
       (EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='inventory_adjustments' AND column_name='store_id'))::TEXT
UNION ALL
SELECT 'inventory_adjustments.notes',
       (EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='inventory_adjustments' AND column_name='notes'))::TEXT
UNION ALL
SELECT 'receives with NULL store_id',
       (SELECT COUNT(*)::TEXT FROM inventory_receives WHERE store_id IS NULL)
UNION ALL
SELECT 'adjustments with NULL store_id',
       (SELECT COUNT(*)::TEXT FROM inventory_adjustments WHERE store_id IS NULL)
UNION ALL
SELECT 'products with NULL is_enabled',
       (SELECT COUNT(*)::TEXT FROM products WHERE is_enabled IS NULL);
