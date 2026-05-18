-- ════════════════════════════════════════════════════════════════════
-- B2B Invoice Edit + Close & Lock lifecycle
-- ════════════════════════════════════════════════════════════════════
-- Adds:
--   1. invoice_audit table — every field change tracked
--   2. invoices.closed_at / closed_by columns
--   3. fn_edit_invoice           — atomic edit with auto inventory adjust
--   4. fn_close_invoice          — manual lock (paid only)
--   5. fn_auto_close_paid_invoices — cron-style, locks after 90 days
--
-- Editing rules (QuickBooks style + extra guards):
--   - draft / sent / partial / paid → ALL editable
--   - voided / closed              → READ-ONLY
--
--   - Inventory auto-adjusts:
--       Was 10 Caymus, now 5 → +5 back to stock
--       Was 5, now 10        → -5 from stock (must have enough)
--       Failed stock check   → entire edit rolled back
--
--   - Money guard: cannot lower total below already-paid amount
--       Total $100, paid $80, edit makes total $50 → REJECTED
--       Tells user: 'Customer paid $80, total must be ≥ $80. Refund first.'
-- ════════════════════════════════════════════════════════════════════


-- ── PART 1: New columns + audit table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS invoice_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id),
  action       TEXT NOT NULL,                       -- 'edit' | 'close' | 'auto_close'
  changes      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {field: {from, to}, ...}
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_invoice ON invoice_audit(invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_audit_tenant  ON invoice_audit(tenant_id, created_at DESC);


-- ── PART 2: fn_edit_invoice — the heavy lifter
-- Atomically edits an existing invoice:
--   1. Lock invoice row
--   2. Block if voided/closed
--   3. Compute net inventory delta (old qtys minus new qtys per product)
--   4. Stock check (must have enough for any net increase)
--   5. Replace invoice_items rows with new payload
--   6. Apply inventory delta
--   7. Recompute totals, balance_due, status
--   8. Record full audit row with before/after snapshot
DROP FUNCTION IF EXISTS fn_edit_invoice(UUID, UUID, UUID, JSONB, JSONB);

CREATE FUNCTION fn_edit_invoice(
  p_tenant_id     UUID,
  p_invoice_id    UUID,
  p_user_id       UUID,
  p_items         JSONB,         -- new line items array
  p_header        JSONB          -- {due_date, notes, internal_notes, delivery_notes, discount_pct}
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_inv             RECORD;
  v_old_items       JSONB;
  v_new_items       JSONB := p_items;
  v_item            JSONB;
  v_product_id      UUID;
  v_qty             NUMERIC;
  v_price           NUMERIC;
  v_disc_pct        NUMERIC;
  v_line_total      NUMERIC;
  v_old_qty         NUMERIC;
  v_subtotal        NUMERIC := 0;
  v_discount_total  NUMERIC := 0;
  v_total           NUMERIC := 0;
  v_new_balance     NUMERIC;
  v_new_status      TEXT;
  v_idx             INT := 0;
  v_inv_before      NUMERIC;
  v_available       NUMERIC;
  v_changes         JSONB := '{}'::jsonb;
  v_old_total       NUMERIC;
  v_old_due_date    DATE;
  v_old_notes       TEXT;
  v_was_sent        BOOLEAN;
BEGIN
  -- Lock the invoice
  SELECT * INTO v_inv
    FROM invoices
   WHERE id = p_invoice_id AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invoice not found');
  END IF;

  -- Block terminal states
  IF v_inv.status = 'voided' OR v_inv.status = 'void' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cannot edit a voided invoice');
  END IF;
  IF v_inv.status = 'closed' THEN
    RETURN jsonb_build_object('success', false,
      'message', 'This invoice is closed and locked. Issue a credit memo to make corrections.');
  END IF;

  -- We only need to adjust inventory if the invoice was SENT (inventory was deducted).
  -- Drafts never deducted, so editing them is just a data change.
  v_was_sent := v_inv.status IN ('sent', 'viewed', 'partial', 'paid', 'overdue');

  v_old_total    := v_inv.total;
  v_old_due_date := v_inv.due_date;
  v_old_notes    := v_inv.notes;

  -- Snapshot old items for audit + inventory delta calculation
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id',   product_id,
    'product_name', product_name,
    'quantity',     quantity,
    'unit_price',   unit_price,
    'discount_pct', discount_pct,
    'line_total',   line_total,
    'inventory_deducted', inventory_deducted
  )), '[]'::jsonb)
    INTO v_old_items
    FROM invoice_items
   WHERE invoice_id = p_invoice_id;

  -- ── STEP 1: Compute new totals
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_new_items)
  LOOP
    v_qty      := (v_item->>'quantity')::NUMERIC;
    v_price    := (v_item->>'unit_price')::NUMERIC;
    v_disc_pct := COALESCE((v_item->>'discount_pct')::NUMERIC, 0);
    v_subtotal := v_subtotal + (v_qty * v_price);
    v_discount_total := v_discount_total + (v_qty * v_price * v_disc_pct / 100);
    v_total    := v_total + (v_qty * v_price * (1 - v_disc_pct / 100));
  END LOOP;

  -- ── STEP 2: Money guard — can't lower total below already-paid amount
  IF v_total + 0.005 < v_inv.amount_paid THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', format(
        'Customer paid $%s. New total $%s is less. Refund $%s first, then edit.',
        v_inv.amount_paid::TEXT,
        v_total::TEXT,
        (v_inv.amount_paid - v_total)::TEXT
      )
    );
  END IF;

  -- ── STEP 3: Stock pre-check (only if invoice is/was sent)
  -- We need to check NET stock needed per product, not per line:
  --   - sum all NEW lines per product (handles same product on multiple lines)
  --   - sum all OLD lines per product (was the previous deduction)
  --   - if new_total > old_total, the difference must be available in stock
  IF v_was_sent THEN
    FOR v_product_id, v_qty IN
      SELECT (it->>'product_id')::UUID, SUM((it->>'quantity')::NUMERIC)
        FROM jsonb_array_elements(v_new_items) it
       WHERE NULLIF(it->>'product_id','') IS NOT NULL
       GROUP BY (it->>'product_id')::UUID
    LOOP
      -- Sum old quantities for this product on this invoice
      SELECT COALESCE(SUM(quantity), 0) INTO v_old_qty
        FROM invoice_items
       WHERE invoice_id = p_invoice_id
         AND product_id = v_product_id;

      -- Net additional needed = new_total - old_total
      IF v_qty > v_old_qty THEN
        SELECT COALESCE(quantity, 0) INTO v_available
          FROM inventory
         WHERE tenant_id  = p_tenant_id
           AND product_id = v_product_id
           AND store_id   = v_inv.store_id;

        IF v_available < (v_qty - v_old_qty) THEN
          RETURN jsonb_build_object(
            'success', false,
            'message', format('Not enough stock for product — need %s more, have %s available',
                              (v_qty - v_old_qty)::TEXT,
                              COALESCE(v_available, 0)::TEXT)
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── STEP 4: Revert old inventory deductions (if any)
  IF v_was_sent THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_old_items)
    LOOP
      v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
      IF v_product_id IS NULL THEN CONTINUE; END IF;
      v_old_qty := COALESCE((v_item->>'inventory_deducted')::NUMERIC, 0);
      IF v_old_qty <> 0 THEN
        INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
        VALUES (p_tenant_id, v_product_id, v_inv.store_id, v_old_qty)
        ON CONFLICT (tenant_id, product_id, store_id)
        DO UPDATE SET quantity = inventory.quantity + v_old_qty, updated_at = NOW();
      END IF;
    END LOOP;
  END IF;

  -- ── STEP 5: Replace invoice items
  DELETE FROM invoice_items WHERE invoice_id = p_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_new_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    v_qty        := (v_item->>'quantity')::NUMERIC;
    v_price      := (v_item->>'unit_price')::NUMERIC;
    v_disc_pct   := COALESCE((v_item->>'discount_pct')::NUMERIC, 0);
    v_line_total := v_qty * v_price * (1 - v_disc_pct / 100);

    SELECT COALESCE(quantity, 0) INTO v_inv_before
      FROM inventory
     WHERE tenant_id = p_tenant_id AND product_id = v_product_id AND store_id = v_inv.store_id;

    INSERT INTO invoice_items (
      tenant_id, invoice_id, product_id, product_name, product_sku, description,
      quantity, unit_price, discount_pct, line_total,
      inventory_deducted, inventory_before, sort_order
    ) VALUES (
      p_tenant_id, p_invoice_id, v_product_id,
      v_item->>'product_name',
      v_item->>'product_sku',
      v_item->>'description',
      v_qty, v_price, v_disc_pct, v_line_total,
      -- Set inventory_deducted to the new qty IF the invoice was already sent
      -- (we just reverted the old deduction, about to apply new). For drafts,
      -- nothing was deducted.
      CASE WHEN v_was_sent AND v_product_id IS NOT NULL THEN v_qty ELSE 0 END,
      COALESCE(v_inv_before, 0),
      v_idx
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- ── STEP 6: Apply new inventory deductions
  IF v_was_sent THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_new_items)
    LOOP
      v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
      IF v_product_id IS NULL THEN CONTINUE; END IF;
      v_qty := (v_item->>'quantity')::NUMERIC;
      IF v_qty <> 0 THEN
        INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
        VALUES (p_tenant_id, v_product_id, v_inv.store_id, -v_qty)
        ON CONFLICT (tenant_id, product_id, store_id)
        DO UPDATE SET quantity = inventory.quantity - v_qty, updated_at = NOW();
      END IF;
    END LOOP;
  END IF;

  -- ── STEP 7: Recompute balance + status
  v_new_balance := v_total - v_inv.amount_paid;
  v_new_status :=
    CASE
      WHEN v_inv.status = 'draft' THEN 'draft'   -- stays draft if was draft
      WHEN v_new_balance <= 0.005 AND v_inv.amount_paid > 0 THEN 'paid'
      WHEN v_inv.amount_paid > 0 THEN 'partial'
      ELSE 'sent'    -- back to sent if no payment
    END;

  UPDATE invoices
     SET subtotal        = v_subtotal,
         discount_amount = v_discount_total,
         total           = v_total,
         balance_due     = v_new_balance,
         status          = v_new_status,
         due_date        = COALESCE((p_header->>'due_date')::DATE, due_date),
         notes           = COALESCE(p_header->>'notes', notes),
         internal_notes  = COALESCE(p_header->>'internal_notes', internal_notes),
         delivery_notes  = COALESCE(p_header->>'delivery_notes', delivery_notes),
         updated_at      = NOW()
   WHERE id = p_invoice_id;

  -- ── STEP 8: Build audit changes diff
  IF v_old_total <> v_total THEN
    v_changes := v_changes || jsonb_build_object('total',
      jsonb_build_object('from', v_old_total, 'to', v_total));
  END IF;
  IF v_inv.status <> v_new_status THEN
    v_changes := v_changes || jsonb_build_object('status',
      jsonb_build_object('from', v_inv.status, 'to', v_new_status));
  END IF;
  -- Always include the full items diff (front-end can render nicely)
  v_changes := v_changes || jsonb_build_object('items',
    jsonb_build_object('from', v_old_items, 'to', v_new_items));

  INSERT INTO invoice_audit (tenant_id, invoice_id, user_id, action, changes)
  VALUES (p_tenant_id, p_invoice_id, p_user_id, 'edit', v_changes);

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'total', v_total,
    'balance_due', v_new_balance,
    'status', v_new_status,
    'message', format('Invoice updated — new total $%s, balance $%s, status %s',
                      v_total::TEXT, v_new_balance::TEXT, v_new_status)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 3: fn_close_invoice — manual lock
DROP FUNCTION IF EXISTS fn_close_invoice(UUID, UUID, UUID);

CREATE FUNCTION fn_close_invoice(
  p_tenant_id  UUID,
  p_invoice_id UUID,
  p_user_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_status TEXT;
  v_inv_no TEXT;
BEGIN
  SELECT status, invoice_number INTO v_status, v_inv_no
    FROM invoices
   WHERE id = p_invoice_id AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invoice not found');
  END IF;
  IF v_status = 'closed' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Already closed');
  END IF;
  IF v_status <> 'paid' THEN
    RETURN jsonb_build_object('success', false,
      'message', format('Can only close paid invoices. This one is %s.', v_status));
  END IF;

  UPDATE invoices
     SET status      = 'closed',
         closed_at   = NOW(),
         closed_by   = p_user_id,
         auto_closed = false,
         updated_at  = NOW()
   WHERE id = p_invoice_id;

  INSERT INTO invoice_audit (tenant_id, invoice_id, user_id, action, changes)
  VALUES (p_tenant_id, p_invoice_id, p_user_id, 'close',
          jsonb_build_object('status', jsonb_build_object('from', v_status, 'to', 'closed')));

  RETURN jsonb_build_object('success', true, 'invoice_number', v_inv_no,
    'message', format('Invoice %s closed and locked', v_inv_no));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 4: fn_auto_close_paid_invoices — runs nightly via cron
-- Locks any 'paid' invoice that's been paid for >= 90 days
DROP FUNCTION IF EXISTS fn_auto_close_paid_invoices(UUID, INT);

CREATE FUNCTION fn_auto_close_paid_invoices(
  p_tenant_id UUID DEFAULT NULL,
  p_days      INT  DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_count INT;
  v_inv   RECORD;
BEGIN
  v_count := 0;
  FOR v_inv IN
    SELECT id, tenant_id, status
      FROM invoices
     WHERE status = 'paid'
       AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
       AND updated_at <= NOW() - (p_days || ' days')::INTERVAL
  LOOP
    UPDATE invoices
       SET status      = 'closed',
           closed_at   = NOW(),
           auto_closed = true,
           closed_by   = NULL,
           updated_at  = NOW()
     WHERE id = v_inv.id;

    INSERT INTO invoice_audit (tenant_id, invoice_id, user_id, action, changes, notes)
    VALUES (v_inv.tenant_id, v_inv.id, NULL, 'auto_close',
            jsonb_build_object('status', jsonb_build_object('from', v_inv.status, 'to', 'closed')),
            format('Auto-closed after %s days', p_days));

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'count', v_count,
    'message', format('Auto-closed %s invoices', v_count));
END;
$func$;


-- ── PART 5: Migration record
INSERT INTO schema_migrations (id, description, notes) VALUES
  ('B2C_INVOICE_EDIT_CLOSE', 'Edit invoice + Close & Lock + audit log', 'Editable B2B')
ON CONFLICT (id) DO UPDATE SET applied_at = NOW();

NOTIFY pgrst, 'reload schema';


-- ── Verification
SELECT 'invoice_audit table' AS check, EXISTS(
  SELECT 1 FROM information_schema.tables WHERE table_name='invoice_audit'
)::TEXT AS ok
UNION ALL
SELECT 'invoices.closed_at',  EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_name='invoices' AND column_name='closed_at')::TEXT
UNION ALL
SELECT 'fn_edit_invoice',     EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_edit_invoice')::TEXT
UNION ALL
SELECT 'fn_close_invoice',    EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_close_invoice')::TEXT
UNION ALL
SELECT 'fn_auto_close_paid_invoices', EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_auto_close_paid_invoices')::TEXT;
