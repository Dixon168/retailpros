-- ════════════════════════════════════════════════════════════════════
-- B2B Invoice inventory lifecycle: deduct on send, restore on void
-- ════════════════════════════════════════════════════════════════════
-- Already applied to Dixon's DB on May 18 (commit 0751994).
-- Recorded in schema_migrations as 'B2C_INVOICE_LIFECYCLE'.
-- Saved here so the migration is reproducible on a fresh deployment.
-- ════════════════════════════════════════════════════════════════════

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

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id','')::UUID;
    v_qty       := (v_item->>'quantity')::NUMERIC;
    v_price     := (v_item->>'unit_price')::NUMERIC;
    v_disc_pct  := COALESCE((v_item->>'discount_pct')::NUMERIC, 0);
    v_line_total := v_qty * v_price * (1 - v_disc_pct / 100);
    SELECT COALESCE(quantity, 0) INTO v_inv_before
      FROM inventory
     WHERE tenant_id = p_tenant_id AND product_id = v_product_id AND store_id = p_store_id;

    INSERT INTO invoice_items (
      tenant_id, invoice_id, product_id, product_name, product_sku, description,
      quantity, unit_price, discount_pct, line_total, inventory_deducted, inventory_before, sort_order
    ) VALUES (
      p_tenant_id, v_invoice_id, v_product_id,
      v_item->>'product_name', v_item->>'product_sku', v_item->>'description',
      v_qty, v_price, v_disc_pct, v_line_total,
      0, COALESCE(v_inv_before, 0), v_idx
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_no, 'total', v_total, 'status', 'draft',
    'message', 'Draft saved. Inventory will deduct when you send the invoice.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


DROP FUNCTION IF EXISTS fn_send_invoice(UUID, UUID, UUID);
CREATE FUNCTION fn_send_invoice(p_tenant_id UUID, p_invoice_id UUID, p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_store_id UUID; v_status TEXT; v_item RECORD; v_available NUMERIC;
BEGIN
  SELECT store_id, status INTO v_store_id, v_status
    FROM invoices WHERE id = p_invoice_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Invoice not found'); END IF;
  IF v_status != 'draft' THEN
    RETURN jsonb_build_object('success', false, 'message', format('Cannot send — invoice is %s, not draft', v_status));
  END IF;

  FOR v_item IN SELECT product_id, product_name, quantity FROM invoice_items
    WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL LOOP
    SELECT COALESCE(quantity, 0) INTO v_available FROM inventory
     WHERE tenant_id = p_tenant_id AND product_id = v_item.product_id AND store_id = v_store_id;
    IF v_available < v_item.quantity THEN
      RETURN jsonb_build_object('success', false,
        'message', format('Insufficient stock for %s — need %s, have %s',
                          v_item.product_name, v_item.quantity, COALESCE(v_available, 0)));
    END IF;
  END LOOP;

  FOR v_item IN SELECT product_id, quantity FROM invoice_items
    WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL LOOP
    INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
    VALUES (p_tenant_id, v_item.product_id, v_store_id, -v_item.quantity)
    ON CONFLICT (tenant_id, product_id, store_id)
    DO UPDATE SET quantity = inventory.quantity - v_item.quantity, updated_at = NOW();
    UPDATE invoice_items SET inventory_deducted = v_item.quantity
     WHERE invoice_id = p_invoice_id AND product_id = v_item.product_id;
  END LOOP;

  UPDATE invoices SET status='sent', sent_at=NOW(), sent_by=p_user_id, updated_at=NOW()
   WHERE id = p_invoice_id;
  RETURN jsonb_build_object('success', true, 'message', 'Invoice sent — inventory deducted');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END; $func$;


DROP FUNCTION IF EXISTS fn_void_invoice(UUID, UUID, UUID, TEXT);
CREATE FUNCTION fn_void_invoice(p_tenant_id UUID, p_invoice_id UUID, p_user_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_store_id UUID; v_status TEXT; v_inv_no TEXT; v_item RECORD;
BEGIN
  SELECT store_id, status, invoice_number INTO v_store_id, v_status, v_inv_no
    FROM invoices WHERE id = p_invoice_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Invoice not found'); END IF;
  IF v_status = 'voided' THEN RETURN jsonb_build_object('success', false, 'message', 'Already voided'); END IF;
  IF v_status = 'paid' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cannot void a paid invoice — issue a credit note instead');
  END IF;

  FOR v_item IN SELECT product_id, inventory_deducted FROM invoice_items
    WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL
      AND COALESCE(inventory_deducted, 0) > 0 LOOP
    INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
    VALUES (p_tenant_id, v_item.product_id, v_store_id, v_item.inventory_deducted)
    ON CONFLICT (tenant_id, product_id, store_id)
    DO UPDATE SET quantity = inventory.quantity + v_item.inventory_deducted, updated_at = NOW();
    UPDATE invoice_items SET inventory_deducted = 0
     WHERE invoice_id = p_invoice_id AND product_id = v_item.product_id;
  END LOOP;

  UPDATE invoices SET status='voided', voided_at=NOW(), voided_by=p_user_id,
    voided_reason=p_reason, updated_at=NOW()
   WHERE id = p_invoice_id;
  RETURN jsonb_build_object('success', true, 'invoice_number', v_inv_no,
    'message', 'Invoice voided — inventory restored');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END; $func$;


ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_by       UUID REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at     TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_by     UUID REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_reason TEXT;

INSERT INTO schema_migrations (id, description, notes) VALUES
  ('B2C_INVOICE_LIFECYCLE', 'Invoice draft/send/void inventory lifecycle', 'P1.3+P1.4')
ON CONFLICT (id) DO UPDATE SET applied_at = NOW();

NOTIFY pgrst, 'reload schema';
