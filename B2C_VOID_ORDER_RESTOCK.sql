-- ════════════════════════════════════════════════════════════════════
-- POS order void — restore inventory
-- ════════════════════════════════════════════════════════════════════
-- Policy (Dixon): when a POS order is voided, all the items it sold go
-- back into stock. Previously POS voids only flipped the order status and
-- did NOT restock (unlike invoice voids). This RPC restocks atomically.
--
-- It restores quantity per order_item (minus anything already returned),
-- skips non-inventory lines (services, card top-ups/reversals — these
-- have product_id NULL or product_type 'service'), and marks the order
-- voided. Serialized items are returned to 'in_stock'.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_void_order(
  p_tenant_id  UUID,
  p_order_id   UUID,
  p_user_id    UUID DEFAULT NULL,
  p_user_name  TEXT DEFAULT NULL,
  p_approved_by      UUID DEFAULT NULL,
  p_approved_by_name TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_store_id UUID; v_status TEXT; v_order_no TEXT; v_item RECORD; v_restocked INT := 0;
BEGIN
  SELECT store_id, status, order_number INTO v_store_id, v_status, v_order_no
    FROM orders WHERE id = p_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order not found');
  END IF;
  IF v_status = 'voided' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order already voided');
  END IF;

  -- Restore inventory for each real product line (skip services / cards /
  -- already-returned qty). order_items.quantity is what was sold; subtract
  -- returned_qty so we don't double-restock items already returned.
  FOR v_item IN
    SELECT product_id, serial_number,
           (quantity - COALESCE(returned_qty,0)) AS qty
      FROM order_items
     WHERE order_id = p_order_id
       AND product_id IS NOT NULL
       AND COALESCE(product_type,'product') <> 'service'
       AND (quantity - COALESCE(returned_qty,0)) > 0
  LOOP
    IF v_item.serial_number IS NOT NULL AND v_item.serial_number <> '' THEN
      -- Serialized: put the serial back in stock
      UPDATE serial_numbers SET status='in_stock', order_id=NULL
       WHERE tenant_id=p_tenant_id AND serial=v_item.serial_number;
    END IF;
    INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
    VALUES (p_tenant_id, v_item.product_id, v_store_id, v_item.qty)
    ON CONFLICT (tenant_id, product_id, store_id)
    DO UPDATE SET quantity = inventory.quantity + v_item.qty, updated_at = NOW();
    v_restocked := v_restocked + 1;
  END LOOP;

  UPDATE orders SET
      status = 'voided',
      voided_at = NOW(),
      voided_by = p_user_id,
      voided_by_name = p_user_name,
      voided_approved_by = p_approved_by,
      voided_approved_by_name = p_approved_by_name
   WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_number', v_order_no,
    'lines_restocked', v_restocked, 'message', 'Order voided — inventory restored');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;

NOTIFY pgrst, 'reload schema';

SELECT 'fn_void_order' AS section, EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_void_order')::TEXT AS ok;
