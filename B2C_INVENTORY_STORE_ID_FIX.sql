-- ════════════════════════════════════════════════════════════════════
-- BUG FIX: Inventory rows missing store_id
-- ════════════════════════════════════════════════════════════════════
-- Some inventory rows were created without store_id (legacy code).
-- POS filters inventory by store_id, so these rows show as 'out of
-- stock' in every store even when quantity > 0.
--
-- Fix: backfill any NULL store_id rows to the tenant's first (or only)
-- store. Then add a NOT NULL constraint going forward.
-- ════════════════════════════════════════════════════════════════════

-- 1) Show which rows are affected before we touch anything
SELECT 'Inventory rows with NULL store_id' AS check,
       COUNT(*)::TEXT AS count
  FROM inventory
 WHERE store_id IS NULL;

-- 2) Backfill: set store_id to the tenant's primary store
UPDATE inventory inv
   SET store_id = (
     SELECT id FROM stores
      WHERE tenant_id = inv.tenant_id
      ORDER BY created_at ASC
      LIMIT 1
   )
 WHERE inv.store_id IS NULL;

-- 3) Also fix any inventory_receives rows missing store_id
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='inventory_receives' AND column_name='store_id'
  ) THEN
    UPDATE inventory_receives ir
       SET store_id = (
         SELECT id FROM stores
          WHERE tenant_id = ir.tenant_id
          ORDER BY created_at ASC
          LIMIT 1
       )
     WHERE ir.store_id IS NULL;
  ELSE
    ALTER TABLE inventory_receives ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE inventory_receives ir
       SET store_id = (
         SELECT id FROM stores
          WHERE tenant_id = ir.tenant_id
          ORDER BY created_at ASC
          LIMIT 1
       );
  END IF;
END
$do$;

NOTIFY pgrst, 'reload schema';

-- 4) Verify after backfill
SELECT 'Inventory rows with NULL store_id (after fix)' AS check,
       COUNT(*)::TEXT AS count
  FROM inventory
 WHERE store_id IS NULL
UNION ALL
SELECT 'Inventory rows total',
       COUNT(*)::TEXT
  FROM inventory;
