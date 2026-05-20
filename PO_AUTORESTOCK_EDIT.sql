-- ════════════════════════════════════════════════════════════════════
-- PO enhancements: auto-restock qty + edit existing PO
-- ════════════════════════════════════════════════════════════════════
-- 1. Adds inventory.auto_restock_qty — the quantity to pre-fill when
--    creating a PO from the low-stock list. Set per product per store.
-- 2. fn_edit_po — edit an open (draft/ordered/partial) PO's line items.
--    No audit log (per Dixon's choice — simple edit). Blocks editing
--    received/cancelled POs. Recomputes total.
-- ════════════════════════════════════════════════════════════════════


-- ── PART 1: auto_restock_qty column on products
-- Lives on products (next to low_stock_qty, added by STOCK_CENTER_SETUP)
-- since that's the field the rest of the app uses for low-stock logic.
-- Default 0 = "no suggestion, user types qty".
ALTER TABLE products ADD COLUMN IF NOT EXISTS auto_restock_qty INTEGER DEFAULT 0;


-- ── PART 2: fn_edit_po — edit line items on an open PO
DROP FUNCTION IF EXISTS fn_edit_po(UUID, UUID, UUID, DATE, TEXT, JSONB);

CREATE FUNCTION fn_edit_po(
  p_tenant_id   UUID,
  p_po_id       UUID,
  p_supplier_id UUID,
  p_expected_date DATE,
  p_notes       TEXT,
  p_items       JSONB     -- [{product_id, product_name, quantity, unit_cost}]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_status   po_status;
  v_total    DECIMAL(10,2) := 0;
  v_item     JSONB;
  v_received DECIMAL(10,3);
BEGIN
  -- Lock + load
  SELECT status INTO v_status
    FROM purchase_orders
   WHERE id = p_po_id AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'PO not found');
  END IF;
  IF v_status = 'received' THEN
    RETURN jsonb_build_object('success', false,
      'message', 'This PO is fully received and cannot be edited.');
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false,
      'message', 'This PO is cancelled and cannot be edited.');
  END IF;

  -- Guard: if PO is partially received, the new quantities for any product
  -- must not drop below what's already been received for that product.
  IF v_status = 'partial' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      SELECT COALESCE(SUM(received), 0) INTO v_received
        FROM purchase_order_items
       WHERE po_id = p_po_id
         AND product_id = NULLIF(v_item->>'product_id','')::UUID;
      IF (v_item->>'quantity')::NUMERIC < v_received THEN
        RETURN jsonb_build_object('success', false,
          'message', format('Cannot set %s qty below %s already received',
                            v_item->>'product_name', v_received::TEXT));
      END IF;
    END LOOP;
  END IF;

  -- Compute new total
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total +
      ((v_item->>'quantity')::NUMERIC * (v_item->>'unit_cost')::NUMERIC);
  END LOOP;

  -- Preserve received counts: we delete + re-insert items, but for any
  -- product that had received > 0, carry that forward so partial receives
  -- aren't lost.
  CREATE TEMP TABLE _old_received ON COMMIT DROP AS
    SELECT product_id, SUM(received) AS received
      FROM purchase_order_items
     WHERE po_id = p_po_id AND product_id IS NOT NULL
     GROUP BY product_id;

  DELETE FROM purchase_order_items WHERE po_id = p_po_id;

  INSERT INTO purchase_order_items (
    tenant_id, po_id, product_id, product_name, quantity, unit_cost, received
  )
  SELECT
    p_tenant_id, p_po_id,
    NULLIF(item->>'product_id','')::UUID,
    item->>'product_name',
    (item->>'quantity')::NUMERIC,
    (item->>'unit_cost')::NUMERIC,
    COALESCE((SELECT received FROM _old_received o
               WHERE o.product_id = NULLIF(item->>'product_id','')::UUID), 0)
  FROM jsonb_array_elements(p_items) AS item;

  -- Update header
  UPDATE purchase_orders
     SET supplier_id   = p_supplier_id,
         expected_date = p_expected_date,
         notes         = p_notes,
         total         = v_total,
         updated_at    = NOW()
   WHERE id = p_po_id;

  RETURN jsonb_build_object('success', true, 'po_id', p_po_id, 'total', v_total,
    'message', format('PO updated — new total $%s', v_total::TEXT));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 3: Migration record
INSERT INTO schema_migrations (id, description, notes) VALUES
  ('PO_AUTORESTOCK_EDIT', 'inventory.auto_restock_qty + fn_edit_po', 'PO enhancements')
ON CONFLICT (id) DO UPDATE SET applied_at = NOW();

NOTIFY pgrst, 'reload schema';


-- ── Verification (should return 2 rows, both 't')
SELECT 'products.auto_restock_qty' AS check, EXISTS(
  SELECT 1 FROM information_schema.columns
  WHERE table_name='products' AND column_name='auto_restock_qty'
)::TEXT AS ok
UNION ALL
SELECT 'fn_edit_po', EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_edit_po')::TEXT;
