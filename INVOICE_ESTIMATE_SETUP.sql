-- ============================================================
-- 📋 Estimate + Invoice + Payment System — Step 1 数据库
-- 复制全部内容 → Supabase SQL Editor → Run
-- 安全：可以重复跑
-- ============================================================

-- ── PART 1: estimate_status enum ──
DO $$ BEGIN
  CREATE TYPE estimate_status AS ENUM ('draft','sent','accepted','declined','expired','converted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PART 2: estimates table (NEW) ──
CREATE TABLE IF NOT EXISTS estimates (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id                 UUID REFERENCES stores(id),
  business_customer_id     UUID REFERENCES business_customers(id) ON DELETE SET NULL,
  estimate_number          TEXT NOT NULL,
  status                   estimate_status DEFAULT 'draft',
  estimate_date            DATE DEFAULT CURRENT_DATE,
  valid_until              DATE,
  subtotal                 DECIMAL(10,2) DEFAULT 0,
  discount_amount          DECIMAL(10,2) DEFAULT 0,
  tax_amount               DECIMAL(10,2) DEFAULT 0,
  total                    DECIMAL(10,2) DEFAULT 0,
  billing_address_snapshot JSONB,
  shipping_address_snapshot JSONB,
  notes                    TEXT,
  internal_notes           TEXT,
  converted_invoice_id     UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_by               UUID REFERENCES users(id),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, estimate_number)
);

CREATE INDEX IF NOT EXISTS idx_estimates_customer ON estimates(business_customer_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(tenant_id, status);


-- ── PART 3: estimate_items (NEW) ──
CREATE TABLE IF NOT EXISTS estimate_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estimate_id  UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_sku  TEXT,
  description  TEXT,
  quantity     DECIMAL(10,3) NOT NULL,
  unit         TEXT DEFAULT 'ea',
  unit_price   DECIMAL(10,2) NOT NULL,
  discount_pct DECIMAL(5,2) DEFAULT 0,
  line_total   DECIMAL(10,2) NOT NULL,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate ON estimate_items(estimate_id);


-- ── PART 4: invoice_items add columns ──
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS product_sku  TEXT;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS description  TEXT;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_pct DECIMAL(5,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sort_order   INT DEFAULT 0;


-- ── PART 5: invoices add columns ──
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_date         DATE DEFAULT CURRENT_DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_estimate_id   UUID REFERENCES estimates(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS internal_notes       TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by           UUID REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at              TIMESTAMPTZ;


-- ── PART 6: payments header + allocations (NEW) ──
-- A single received_payment can pay multiple invoices.
CREATE TABLE IF NOT EXISTS received_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id             UUID REFERENCES stores(id),
  business_customer_id UUID NOT NULL REFERENCES business_customers(id) ON DELETE RESTRICT,
  payment_number       TEXT NOT NULL,
  payment_date         DATE DEFAULT CURRENT_DATE,
  payment_method       TEXT NOT NULL,                  -- 'cash','check','ach','card','bank_transfer','other'
  reference_number     TEXT,                            -- check# / ACH ref / etc
  amount               DECIMAL(10,2) NOT NULL,
  notes                TEXT,
  received_by          UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, payment_number)
);

CREATE INDEX IF NOT EXISTS idx_recvpay_customer ON received_payments(business_customer_id);
CREATE INDEX IF NOT EXISTS idx_recvpay_date ON received_payments(tenant_id, payment_date DESC);


-- One row per (payment, invoice) — how this payment is allocated across invoices.
CREATE TABLE IF NOT EXISTS payment_allocations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id  UUID NOT NULL REFERENCES received_payments(id) ON DELETE CASCADE,
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount      DECIMAL(10,2) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_payalloc_invoice ON payment_allocations(invoice_id);


-- ── PART 7: helper — generate document numbers ──
CREATE OR REPLACE FUNCTION fn_generate_estimate_number(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $func$
DECLARE
  v_count INT;
  v_date  TEXT;
BEGIN
  v_date := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COUNT(*) INTO v_count FROM estimates
   WHERE tenant_id = p_tenant_id AND estimate_number LIKE 'EST-' || v_date || '-%';
  RETURN 'EST-' || v_date || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
END;
$func$;

CREATE OR REPLACE FUNCTION fn_generate_invoice_number(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $func$
DECLARE
  v_count INT;
  v_date  TEXT;
BEGIN
  v_date := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COUNT(*) INTO v_count FROM invoices
   WHERE tenant_id = p_tenant_id AND invoice_number LIKE 'INV-' || v_date || '-%';
  RETURN 'INV-' || v_date || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
END;
$func$;

CREATE OR REPLACE FUNCTION fn_generate_payment_number(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $func$
DECLARE
  v_count INT;
  v_date  TEXT;
BEGIN
  v_date := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COUNT(*) INTO v_count FROM received_payments
   WHERE tenant_id = p_tenant_id AND payment_number LIKE 'PMT-' || v_date || '-%';
  RETURN 'PMT-' || v_date || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
END;
$func$;


-- ── PART 8: fn_create_estimate_atomic ──
CREATE OR REPLACE FUNCTION fn_create_estimate_atomic(
  p_tenant_id     UUID,
  p_store_id      UUID,
  p_customer_id   UUID,
  p_valid_until   DATE,
  p_notes         TEXT,
  p_internal_notes TEXT,
  p_created_by    UUID,
  p_items         JSONB,    -- [{product_id, product_name, product_sku, quantity, unit_price, discount_pct, description}]
  p_billing_addr  JSONB,
  p_shipping_addr JSONB
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
    billing_address_snapshot, shipping_address_snapshot, created_by
  ) VALUES (
    v_estimate_id, p_tenant_id, p_store_id, p_customer_id, v_estimate_no, 'draft',
    p_valid_until, v_subtotal, v_discount, v_total, p_notes, p_internal_notes,
    p_billing_addr, p_shipping_addr, p_created_by
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


-- ── PART 9: fn_create_invoice_atomic (with stock deduction) ──
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
  p_source_estimate_id UUID DEFAULT NULL
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

  -- Insert invoice header (compute totals as we go)
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
    source_estimate_id, created_by
  ) VALUES (
    v_invoice_id, p_tenant_id, p_store_id, p_customer_id, v_invoice_no, 'draft',
    p_due_date, v_subtotal, v_discount, v_total, 0, v_total,
    p_billing_addr, p_shipping_addr, p_notes, p_internal_notes,
    p_source_estimate_id, p_created_by
  );

  -- Insert items + deduct inventory
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id','')::UUID;
    v_qty       := (v_item->>'quantity')::NUMERIC;
    v_price     := (v_item->>'unit_price')::NUMERIC;
    v_disc_pct  := COALESCE((v_item->>'discount_pct')::NUMERIC, 0);
    v_line_total := v_qty * v_price * (1 - v_disc_pct / 100);

    INSERT INTO invoice_items (
      tenant_id, invoice_id, product_id, product_name, product_sku, description,
      quantity, unit_price, discount_pct, line_total, sort_order
    ) VALUES (
      p_tenant_id, v_invoice_id, v_product_id,
      v_item->>'product_name',
      v_item->>'product_sku',
      v_item->>'description',
      v_qty, v_price, v_disc_pct, v_line_total, v_idx
    );

    -- Deduct inventory if it's a real product
    IF v_product_id IS NOT NULL THEN
      SELECT quantity INTO v_inv_before FROM inventory
       WHERE tenant_id = p_tenant_id AND store_id = p_store_id
         AND product_id = v_product_id FOR UPDATE;

      IF v_inv_before IS NULL THEN
        -- Allow negative inventory: insert with -qty
        INSERT INTO inventory (tenant_id, store_id, product_id, quantity)
        VALUES (p_tenant_id, p_store_id, v_product_id, -v_qty);
        v_inv_before := 0;
      ELSE
        UPDATE inventory
           SET quantity = quantity - v_qty,
               version = version + 1,
               updated_at = NOW()
         WHERE tenant_id = p_tenant_id AND store_id = p_store_id AND product_id = v_product_id;
      END IF;

      -- Write inventory_adjustments history
      INSERT INTO inventory_adjustments (
        tenant_id, store_id, product_id, qty_change, qty_before, qty_after,
        reason, notes, adjusted_by
      ) VALUES (
        p_tenant_id, p_store_id, v_product_id, -v_qty, v_inv_before, v_inv_before - v_qty,
        'Sold on invoice ' || v_invoice_no, NULL, p_created_by
      );
    END IF;

    v_idx := v_idx + 1;
  END LOOP;

  -- Update business_customer aggregates
  UPDATE business_customers
     SET total_spent  = COALESCE(total_spent, 0) + v_total,
         invoice_count = COALESCE(invoice_count, 0) + 1,
         credit_balance = COALESCE(credit_balance, 0) + v_total,
         updated_at = NOW()
   WHERE id = p_customer_id;

  RETURN jsonb_build_object(
    'success',         true,
    'invoice_id',      v_invoice_id,
    'invoice_number',  v_invoice_no,
    'total',           v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 10: fn_convert_estimate_to_invoice ──
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
  v_est RECORD;
  v_items JSONB;
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

  -- Build items JSONB from estimate_items
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

  -- Create invoice (which deducts stock)
  v_result := fn_create_invoice_atomic(
    p_tenant_id, v_est.store_id, v_est.business_customer_id, p_due_date,
    v_est.notes, v_est.internal_notes, p_user_id, v_items,
    v_est.billing_address_snapshot, v_est.shipping_address_snapshot,
    p_estimate_id
  );

  IF NOT (v_result->>'success')::BOOLEAN THEN
    RETURN v_result;
  END IF;

  -- Mark estimate as converted
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


-- ── PART 11: fn_receive_payment_atomic (one payment, multiple invoices) ──
CREATE OR REPLACE FUNCTION fn_receive_payment_atomic(
  p_tenant_id      UUID,
  p_store_id       UUID,
  p_customer_id    UUID,
  p_payment_date   DATE,
  p_method         TEXT,           -- 'cash','check','ach','card','bank_transfer','other'
  p_reference      TEXT,
  p_notes          TEXT,
  p_user_id        UUID,
  p_allocations    JSONB           -- [{invoice_id, amount}]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_payment_id   UUID;
  v_payment_no   TEXT;
  v_total_amount DECIMAL(10,2) := 0;
  v_alloc        JSONB;
  v_inv_id       UUID;
  v_alloc_amt    DECIMAL(10,2);
  v_inv          RECORD;
  v_new_paid     DECIMAL(10,2);
  v_new_status   TEXT;
BEGIN
  v_payment_id := gen_random_uuid();
  v_payment_no := fn_generate_payment_number(p_tenant_id);

  -- Sum total
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_total_amount := v_total_amount + (v_alloc->>'amount')::DECIMAL(10,2);
  END LOOP;

  IF v_total_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Payment amount must be > 0');
  END IF;

  -- Insert payment header
  INSERT INTO received_payments (
    id, tenant_id, store_id, business_customer_id, payment_number,
    payment_date, payment_method, reference_number, amount, notes, received_by
  ) VALUES (
    v_payment_id, p_tenant_id, p_store_id, p_customer_id, v_payment_no,
    p_payment_date, p_method, p_reference, v_total_amount, p_notes, p_user_id
  );

  -- Apply each allocation to its invoice
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_inv_id    := (v_alloc->>'invoice_id')::UUID;
    v_alloc_amt := (v_alloc->>'amount')::DECIMAL(10,2);

    IF v_alloc_amt <= 0 THEN CONTINUE; END IF;

    -- Lock invoice and update
    SELECT * INTO v_inv FROM invoices
     WHERE id = v_inv_id AND tenant_id = p_tenant_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice % not found', v_inv_id;
    END IF;

    -- Insert allocation row
    INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount)
    VALUES (p_tenant_id, v_payment_id, v_inv_id, v_alloc_amt);

    -- Recompute invoice paid + status
    v_new_paid := COALESCE(v_inv.amount_paid, 0) + v_alloc_amt;
    v_new_status :=
      CASE
        WHEN v_new_paid >= v_inv.total THEN 'paid'
        WHEN v_new_paid > 0           THEN 'partial'
        ELSE v_inv.status
      END;

    UPDATE invoices
       SET amount_paid = v_new_paid,
           balance_due = GREATEST(v_inv.total - v_new_paid, 0),
           status = v_new_status,
           updated_at = NOW()
     WHERE id = v_inv_id;
  END LOOP;

  -- Update customer credit_balance and overdue_amount
  UPDATE business_customers
     SET credit_balance = GREATEST(COALESCE(credit_balance, 0) - v_total_amount, 0),
         updated_at = NOW()
   WHERE id = p_customer_id;

  RETURN jsonb_build_object(
    'success',        true,
    'payment_id',     v_payment_id,
    'payment_number', v_payment_no,
    'amount',         v_total_amount
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 12: helper view — invoices with customer info + days overdue ──
CREATE OR REPLACE VIEW v_invoice_with_customer AS
SELECT
  i.*,
  bc.company_name,
  bc.contact_name AS customer_contact,
  bc.contact_email AS customer_email,
  bc.payment_terms,
  CASE
    WHEN i.status = 'paid' THEN 0
    WHEN i.due_date IS NULL THEN 0
    WHEN i.due_date < CURRENT_DATE THEN (CURRENT_DATE - i.due_date)
    ELSE 0
  END AS days_overdue
FROM invoices i
LEFT JOIN business_customers bc ON bc.id = i.business_customer_id;


CREATE OR REPLACE VIEW v_estimate_with_customer AS
SELECT
  e.*,
  bc.company_name,
  bc.contact_name AS customer_contact,
  bc.contact_email AS customer_email
FROM estimates e
LEFT JOIN business_customers bc ON bc.id = e.business_customer_id;


-- ✅ 完成
