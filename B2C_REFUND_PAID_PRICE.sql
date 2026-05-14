-- ════════════════════════════════════════════════════════════════════
-- Add paid_unit_price to order_items for accurate refunds
-- ════════════════════════════════════════════════════════════════════
-- Before this change: refunds used unit_price (sticker price), which
-- meant customers who bought with a bulk promo got OVER-refunded on
-- returns. Example: bought "3 for $21" ($7/ea actual), returned 1
-- → refund $10 instead of $7 = lose $3 per return.
--
-- After: paid_unit_price stores what the customer ACTUALLY paid per
-- unit (lineTotal / qty after bulk/discount). Refunds use this field
-- and match what the customer paid, which is the ShopRite / grocery
-- industry standard.
--
-- bulk_savings: an audit trail of how much was saved per line by bulk
-- pricing. Useful for reports ("revenue lost to bulk promos this month").
-- ════════════════════════════════════════════════════════════════════

-- Part 1: schema
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS paid_unit_price NUMERIC(12,4);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS bulk_savings NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Part 2: backfill historical orders (legacy = paid sticker price)
UPDATE order_items
   SET paid_unit_price = unit_price
 WHERE paid_unit_price IS NULL;

ALTER TABLE order_items
  ALTER COLUMN paid_unit_price SET DEFAULT 0;


-- Part 3: patch fn_submit_order_atomic to capture the new fields.
-- We re-declare the whole function (CREATE OR REPLACE). The only changes
-- from the previous version are the two new column references.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_submit_order_atomic(
  p_tenant_id   UUID,
  p_store_id    UUID,
  p_cashier_id  UUID,
  p_terminal_id TEXT,
  p_order_data  JSONB,
  p_items       JSONB,
  p_payments    JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_order_id      UUID;
  v_order_number  TEXT;
  v_seq           INTEGER;
BEGIN
  -- Assign order_number: per-tenant daily incrementing sequence
  -- Example: 20260514-0001
  SELECT COALESCE(MAX(
    NULLIF(SPLIT_PART(order_number, '-', 2), '')::INTEGER
  ), 0) + 1
    INTO v_seq
    FROM orders
   WHERE tenant_id = p_tenant_id
     AND order_number LIKE TO_CHAR(NOW(), 'YYYYMMDD') || '-%';

  v_order_number := TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(v_seq::TEXT, 4, '0');

  -- Insert the order row
  INSERT INTO orders (
    tenant_id, store_id, cashier_id, terminal_id, order_number,
    customer_id, subtotal, discount_amount, tax_amount, total,
    amount_paid, points_earned, points_redeemed,
    coupon_id, coupon_code, coupon_discount,
    tax_breakdown, status
  ) VALUES (
    p_tenant_id, p_store_id, p_cashier_id, p_terminal_id, v_order_number,
    NULLIF(p_order_data->>'customer_id', '')::UUID,
    COALESCE((p_order_data->>'subtotal')::NUMERIC, 0),
    COALESCE((p_order_data->>'discount_amount')::NUMERIC, 0),
    COALESCE((p_order_data->>'tax_amount')::NUMERIC, 0),
    COALESCE((p_order_data->>'total')::NUMERIC, 0),
    COALESCE((p_order_data->>'amount_paid')::NUMERIC, 0),
    COALESCE((p_order_data->>'points_earned')::INTEGER, 0),
    COALESCE((p_order_data->>'points_redeemed')::INTEGER, 0),
    NULLIF(p_order_data->>'coupon_id', '')::UUID,
    NULLIF(p_order_data->>'coupon_code', ''),
    COALESCE((p_order_data->>'coupon_discount')::NUMERIC, 0),
    COALESCE(p_order_data->'tax_breakdown', '[]'::JSONB),
    'completed'
  ) RETURNING id INTO v_order_id;

  -- Insert order_items INCLUDING the new paid_unit_price and bulk_savings
  INSERT INTO order_items (
    tenant_id, order_id, product_id, product_name, product_sku,
    product_type, serial_number, quantity, unit, unit_price,
    paid_unit_price, bulk_savings,
    discount_amount, tax_amount, line_total
  )
  SELECT
    p_tenant_id, v_order_id,
    NULLIF(item->>'product_id', '')::UUID,
    item->>'product_name', item->>'product_sku',
    COALESCE(item->>'product_type', 'product'),
    NULLIF(item->>'serial_number', ''),
    (item->>'quantity')::NUMERIC,
    COALESCE(item->>'unit', 'ea'),
    (item->>'unit_price')::NUMERIC,
    -- paid_unit_price: what the customer actually paid per unit.
    -- Falls back to unit_price for code paths that don't send it yet.
    COALESCE((item->>'paid_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
    COALESCE((item->>'bulk_savings')::NUMERIC, 0),
    COALESCE((item->>'discount_amount')::NUMERIC, 0),
    COALESCE((item->>'tax_amount')::NUMERIC, 0),
    (item->>'line_total')::NUMERIC
  FROM jsonb_array_elements(p_items) AS item;

  -- Insert payments
  INSERT INTO order_payments (tenant_id, order_id, method, amount, reference)
  SELECT p_tenant_id, v_order_id, pay->>'method', (pay->>'amount')::NUMERIC, pay->>'reference'
  FROM jsonb_array_elements(p_payments) AS pay;

  -- Award loyalty points if applicable
  IF (p_order_data->>'customer_id') IS NOT NULL
     AND (p_order_data->>'customer_id') != ''
     AND COALESCE((p_order_data->>'points_earned')::INTEGER, 0) > 0 THEN
    UPDATE customers
       SET loyalty_points = COALESCE(loyalty_points, 0) +
                            (p_order_data->>'points_earned')::INTEGER
     WHERE id = (p_order_data->>'customer_id')::UUID
       AND tenant_id = p_tenant_id;
  END IF;

  -- Deduct redeemed points if applicable
  IF (p_order_data->>'customer_id') IS NOT NULL
     AND (p_order_data->>'customer_id') != ''
     AND COALESCE((p_order_data->>'points_redeemed')::INTEGER, 0) > 0 THEN
    UPDATE customers
       SET loyalty_points = GREATEST(0, COALESCE(loyalty_points, 0) -
                                       (p_order_data->>'points_redeemed')::INTEGER)
     WHERE id = (p_order_data->>'customer_id')::UUID
       AND tenant_id = p_tenant_id;
  END IF;

  -- Decrement inventory for each item with track_inventory=true
  UPDATE inventory inv
     SET quantity   = inv.quantity - sub.qty_change,
         updated_at = NOW()
    FROM (
      SELECT NULLIF(item->>'product_id','')::UUID AS product_id,
             SUM((item->>'quantity')::NUMERIC) AS qty_change
        FROM jsonb_array_elements(p_items) AS item
       WHERE item->>'product_id' IS NOT NULL
         AND COALESCE(item->>'product_type', 'product') NOT IN ('service')
       GROUP BY 1
    ) AS sub
   WHERE inv.product_id = sub.product_id
     AND inv.store_id   = p_store_id
     AND inv.tenant_id  = p_tenant_id;

  RETURN jsonb_build_object(
    'order_id',     v_order_id,
    'order_number', v_order_number
  );
END;
$fn$;

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT 'paid_unit_price exists' AS check,
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name='order_items' AND column_name='paid_unit_price')::TEXT AS ok
UNION ALL
SELECT 'bulk_savings exists',
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name='order_items' AND column_name='bulk_savings')::TEXT
UNION ALL
SELECT 'rows with NULL paid_unit_price',
       (SELECT COUNT(*)::TEXT FROM order_items WHERE paid_unit_price IS NULL)
UNION ALL
SELECT 'fn_submit_order_atomic exists',
       EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_submit_order_atomic')::TEXT;

