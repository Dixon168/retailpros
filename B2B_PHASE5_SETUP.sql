-- ════════════════════════════════════════════════════════════════════
-- B2B PHASE 5 — Delivery address selection + delivery notes
-- ════════════════════════════════════════════════════════════════════
-- Adds delivery_notes column to invoices + estimates and updates the
-- create / convert RPCs to accept and persist these notes.
-- shipping_address_snapshot JSONB already exists on both tables.
-- Safe to re-run: idempotent ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════

-- ── PART 1: schema additions ────────────────────────────────────────
ALTER TABLE invoices  ADD COLUMN IF NOT EXISTS delivery_notes TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

COMMENT ON COLUMN invoices.delivery_notes  IS
  'Delivery / shipping instructions (visible on packing slip — e.g. dock #, buzzer, time window).';
COMMENT ON COLUMN estimates.delivery_notes IS
  'Delivery / shipping instructions carried forward when estimate is converted to invoice.';


-- ── PART 2: fn_create_estimate_atomic — add p_delivery_notes ────────
CREATE OR REPLACE FUNCTION fn_create_estimate_atomic(
  p_tenant_id     UUID,
  p_store_id      UUID,
  p_customer_id   UUID,
  p_valid_until   DATE,
  p_notes         TEXT,
  p_internal_notes TEXT,
  p_created_by    UUID,
  p_items         JSONB,
  p_billing_addr  JSONB,
  p_shipping_addr JSONB,
  p_delivery_notes TEXT DEFAULT NULL          -- NEW (Phase 5)
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_estimate_id   UUID;
  v_estimate_no   TEXT;
  v_subtotal      DECIMAL(10,2) := 0;
  v_discount      DECIMAL(10,2) := 0;
  v_total         DECIMAL(10,2) := 0;
  v_item          JSONB;
  v_qty           NUMERIC;
  v_price         NUMERIC;
  v_disc_pct      NUMERIC;
  v_line_subtotal NUMERIC;
  v_line_disc     NUMERIC;
  v_line_total    NUMERIC;
  v_idx           INT := 0;
BEGIN
  v_estimate_id := gen_random_uuid();
  v_estimate_no := fn_generate_estimate_number(p_tenant_id);

  -- Compute totals
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

  -- Insert estimate header
  INSERT INTO estimates (
    id, tenant_id, store_id, business_customer_id, estimate_number, status,
    valid_until, subtotal, discount_amount, total, notes, internal_notes,
    billing_address_snapshot, shipping_address_snapshot, delivery_notes, created_by
  ) VALUES (
    v_estimate_id, p_tenant_id, p_store_id, p_customer_id, v_estimate_no, 'draft',
    p_valid_until, v_subtotal, v_discount, v_total, p_notes, p_internal_notes,
    p_billing_addr, p_shipping_addr, p_delivery_notes, p_created_by
  );

  -- Insert items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty       := (v_item->>'quantity')::NUMERIC;
    v_price     := (v_item->>'unit_price')::NUMERIC;
    v_disc_pct  := COALESCE((v_item->>'discount_pct')::NUMERIC, 0);
    v_line_total := v_qty * v_price * (1 - v_disc_pct / 100);
    INSERT INTO estimate_items (
      tenant_id, estimate_id, product_id, product_name, product_sku, description,
      quantity, unit_price, discount_pct, line_total, sort_order
    ) VALUES (
      p_tenant_id, v_estimate_id,
      NULLIF(v_item->>'product_id','')::UUID,
      v_item->>'product_name',
      v_item->>'product_sku',
      v_item->>'description',
      v_qty, v_price, v_disc_pct, v_line_total, v_idx
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success',         true,
    'estimate_id',     v_estimate_id,
    'estimate_number', v_estimate_no,
    'total',           v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 3: fn_create_invoice_atomic — add p_delivery_notes ─────────
CREATE OR REPLACE FUNCTION fn_create_invoice_atomic(
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
  p_delivery_notes TEXT DEFAULT NULL          -- NEW (Phase 5)
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

  -- Compute totals first
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

  -- Insert items + deduct inventory
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id','')::UUID;
    v_qty       := (v_item->>'quantity')::NUMERIC;
    v_price     := (v_item->>'unit_price')::NUMERIC;
    v_disc_pct  := COALESCE((v_item->>'discount_pct')::NUMERIC, 0);
    v_line_total := v_qty * v_price * (1 - v_disc_pct / 100);

    -- Snapshot inventory_before
    SELECT COALESCE(inventory_count, 0) INTO v_inv_before
      FROM product_inventory
     WHERE tenant_id = p_tenant_id AND product_id = v_product_id AND store_id = p_store_id;

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

    -- Deduct inventory (negative-allowed by ALLOW_NEGATIVE_INVENTORY policy)
    IF v_product_id IS NOT NULL THEN
      INSERT INTO product_inventory (tenant_id, product_id, store_id, inventory_count)
      VALUES (p_tenant_id, v_product_id, p_store_id, -v_qty)
      ON CONFLICT (tenant_id, product_id, store_id)
      DO UPDATE SET inventory_count = product_inventory.inventory_count - v_qty,
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


-- ── PART 4: fn_convert_estimate_to_invoice — carry delivery_notes ───
CREATE OR REPLACE FUNCTION fn_convert_estimate_to_invoice(
  p_tenant_id   UUID,
  p_estimate_id UUID,
  p_due_date    DATE,
  p_user_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_est    estimates%ROWTYPE;
  v_items  JSONB;
  v_result JSONB;
BEGIN
  SELECT * INTO v_est FROM estimates
   WHERE id = p_estimate_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Estimate not found');
  END IF;
  IF v_est.status = 'converted' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Estimate already converted');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'product_id',   product_id,
    'product_name', product_name,
    'product_sku',  product_sku,
    'description',  description,
    'quantity',     quantity,
    'unit_price',   unit_price,
    'discount_pct', discount_pct
  ) ORDER BY sort_order)
  INTO v_items
  FROM estimate_items WHERE estimate_id = p_estimate_id;

  -- Create invoice — carry delivery_notes through (Phase 5)
  v_result := fn_create_invoice_atomic(
    p_tenant_id,                   -- p_tenant_id
    v_est.store_id,                -- p_store_id
    v_est.business_customer_id,    -- p_customer_id
    p_due_date,                    -- p_due_date
    v_est.notes,                   -- p_notes
    v_est.internal_notes,          -- p_internal_notes
    p_user_id,                     -- p_created_by
    v_items,                       -- p_items
    v_est.billing_address_snapshot,  -- p_billing_addr
    v_est.shipping_address_snapshot, -- p_shipping_addr
    p_estimate_id,                 -- p_source_estimate_id
    v_est.delivery_notes           -- p_delivery_notes (NEW)
  );

  IF NOT (v_result->>'success')::BOOLEAN THEN
    RETURN v_result;
  END IF;

  UPDATE estimates
     SET status = 'converted',
         converted_invoice_id = (v_result->>'invoice_id')::UUID,
         updated_at = NOW()
   WHERE id = p_estimate_id;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── VERIFY ─────────────────────────────────────────────────────────
-- Run this and confirm both rows show TRUE in the "exists" column.
SELECT
  table_name,
  column_name,
  data_type,
  TRUE AS exists
FROM information_schema.columns
WHERE column_name = 'delivery_notes'
  AND table_name IN ('invoices','estimates')
ORDER BY table_name;
