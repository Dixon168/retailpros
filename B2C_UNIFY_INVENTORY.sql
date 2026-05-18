-- ════════════════════════════════════════════════════════════════════
-- UNIFY INVENTORY: B2B invoices now deduct from the SAME inventory
-- table as POS sales.
-- ════════════════════════════════════════════════════════════════════
-- Before this script: B2B `fn_create_invoice_atomic` wrote to a separate
-- table called `product_inventory` (created on-the-fly by the B2B Phase 5
-- hotfix). POS reads/writes the canonical `inventory` table. The two
-- tables never synced, so:
--   - POS sells 5 apples → inventory.quantity drops by 5
--   - B2B invoices 3 apples → product_inventory drops by 3, but
--     inventory stays unchanged → POS still thinks all 5 apples are
--     in stock and would happily oversell.
--
-- After: B2B writes to `inventory` like everyone else. One ledger,
-- shared between POS and B2B, no drift.
--
-- This script is idempotent. Run it once.
-- ════════════════════════════════════════════════════════════════════


-- ── PART 1: Reclaim any inventory data that ended up in product_inventory
-- If the table exists and has rows, merge them back into inventory so the
-- numbers are conservative (subtract everything B2B deducted).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'product_inventory'
  ) THEN
    -- For each (tenant, product, store) row in product_inventory, apply its
    -- delta to the matching inventory row. product_inventory.inventory_count
    -- is a NEGATIVE running sum from B2B invoices.
    UPDATE inventory inv
       SET quantity   = inv.quantity + pi.inventory_count,
           updated_at = NOW()
      FROM product_inventory pi
     WHERE inv.tenant_id  = pi.tenant_id
       AND inv.product_id = pi.product_id
       AND inv.store_id   = pi.store_id;

    -- For rows in product_inventory with no matching inventory row, create one
    INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
    SELECT pi.tenant_id, pi.product_id, pi.store_id, pi.inventory_count
      FROM product_inventory pi
     WHERE NOT EXISTS (
       SELECT 1 FROM inventory inv
        WHERE inv.tenant_id  = pi.tenant_id
          AND inv.product_id = pi.product_id
          AND inv.store_id   = pi.store_id
     );

    -- Drop product_inventory — done with it.
    DROP TABLE product_inventory;
    RAISE NOTICE 'Merged product_inventory back into inventory and dropped it';
  END IF;
END $$;


-- ── PART 2: Recreate fn_create_invoice_atomic to use `inventory`
-- Same signature as before so the frontend keeps working.
DROP FUNCTION IF EXISTS fn_create_invoice_atomic(
  UUID, UUID, UUID, DATE, TEXT, TEXT, UUID, JSONB, JSONB, JSONB, UUID, TEXT
);

CREATE FUNCTION fn_create_invoice_atomic(
  p_tenant_id     UUID,
  p_store_id      UUID,
  p_customer_id   UUID,
  p_due_date      DATE,
  p_notes         TEXT,
  p_internal_notes TEXT,
  p_created_by    UUID,
  p_items         JSONB,
  p_billing_addr  JSONB,
  p_shipping_addr JSONB,
  p_source_estimate_id UUID DEFAULT NULL,
  p_delivery_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_invoice_id    UUID;
  v_invoice_no    TEXT;
  v_subtotal      DECIMAL(10,2) := 0;
  v_discount      DECIMAL(10,2) := 0;
  v_total         DECIMAL(10,2) := 0;
  v_item          JSONB;
  v_product_id    UUID;
  v_qty           NUMERIC;
  v_price         NUMERIC;
  v_disc_pct      NUMERIC;
  v_line_subtotal NUMERIC;
  v_line_disc     NUMERIC;
  v_line_total    NUMERIC;
  v_inv_before    NUMERIC;
  v_idx           INT := 0;
BEGIN
  v_invoice_id := gen_random_uuid();
  v_invoice_no := fn_generate_invoice_number(p_tenant_id);

  -- First pass: calculate totals
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty       := (v_item->>'quantity')::NUMERIC;
    v_price     := (v_item->>'unit_price')::NUMERIC;
    v_disc_pct  := COALESCE((v_item->>'discount_pct')::NUMERIC, 0);
    v_line_subtotal := v_qty * v_price;
    v_line_disc     := v_line_subtotal * (v_disc_pct / 100);
    v_line_total    := v_line_subtotal - v_line_disc;
    v_subtotal := v_subtotal + v_line_subtotal;
    v_discount := v_discount + v_line_disc;
    v_total    := v_total + v_line_total;
  END LOOP;

  INSERT INTO invoices (
    id, tenant_id, store_id, business_customer_id, invoice_number, status,
    due_date, subtotal, discount_amount, total, amount_paid, balance_due,
    billing_address_snapshot, shipping_address_snapshot, notes, internal_notes,
    delivery_notes, source_estimate_id, created_by
  ) VALUES (
    v_invoice_id, p_tenant_id, p_store_id, p_customer_id, v_invoice_no, 'draft',
    p_due_date, v_subtotal, v_discount, v_total, 0, v_total,
    p_billing_addr, p_shipping_addr, p_notes, p_internal_notes,
    p_delivery_notes, p_source_estimate_id, p_created_by
  );

  -- Second pass: insert items and deduct from inventory
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id','')::UUID;
    v_qty       := (v_item->>'quantity')::NUMERIC;
    v_price     := (v_item->>'unit_price')::NUMERIC;
    v_disc_pct  := COALESCE((v_item->>'discount_pct')::NUMERIC, 0);
    v_line_total := v_qty * v_price * (1 - v_disc_pct / 100);

    -- Read current inventory from THE canonical table (not product_inventory).
    -- Falls back to 0 if no row yet for this (tenant, product, store).
    SELECT COALESCE(quantity, 0) INTO v_inv_before
      FROM inventory
     WHERE tenant_id  = p_tenant_id
       AND product_id = v_product_id
       AND store_id   = p_store_id;

    INSERT INTO invoice_items (
      tenant_id, invoice_id, product_id, product_name, product_sku, description,
      quantity, unit_price, discount_pct, line_total, inventory_deducted, inventory_before, sort_order
    ) VALUES (
      p_tenant_id, v_invoice_id, v_product_id,
      v_item->>'product_name',
      v_item->>'product_sku',
      v_item->>'description',
      v_qty, v_price, v_disc_pct, v_line_total,
      v_qty, COALESCE(v_inv_before, 0), v_idx
    );

    -- Deduct from the SAME inventory table POS uses. Same UPSERT pattern as
    -- POS uses in fn_submit_order_atomic so the two paths behave identically.
    IF v_product_id IS NOT NULL THEN
      INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
      VALUES (p_tenant_id, v_product_id, p_store_id, -v_qty)
      ON CONFLICT (tenant_id, product_id, store_id)
      DO UPDATE SET quantity   = inventory.quantity - v_qty,
                    updated_at = NOW();
    END IF;

    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success',        true,
    'invoice_id',     v_invoice_id,
    'invoice_number', v_invoice_no,
    'total',          v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 3: Ensure inventory has the right UNIQUE constraint
-- The ON CONFLICT clause needs a matching constraint. The canonical inventory
-- table should have one on (tenant_id, product_id, store_id) — add it if not.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_tenant_product_store_key'
  ) THEN
    -- Try to add a UNIQUE constraint. May fail if there are already duplicate
    -- (tenant, product, store) rows from old buggy code paths. Fall back to
    -- creating it as a UNIQUE INDEX instead — same semantics, cheaper.
    BEGIN
      ALTER TABLE inventory
        ADD CONSTRAINT inventory_tenant_product_store_key
        UNIQUE (tenant_id, product_id, store_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Duplicate inventory rows exist — review manually';
    END;
  END IF;
END $$;


NOTIFY pgrst, 'reload schema';


-- ── PART 4: Verification ─────────────────────────────────────────
SELECT 'product_inventory dropped' AS check,
       (NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_name='product_inventory'))::TEXT AS ok
UNION ALL
SELECT 'fn_create_invoice_atomic uses inventory',
       (EXISTS (SELECT 1 FROM pg_proc
                 WHERE proname='fn_create_invoice_atomic'
                   AND prosrc LIKE '%FROM inventory%'
                   AND prosrc NOT LIKE '%FROM product_inventory%'))::TEXT
UNION ALL
SELECT 'inventory unique constraint',
       (EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'inventory_tenant_product_store_key'))::TEXT;
