-- ============================================================
-- 🔧 修复：orders.terminal_id 外键太严格
-- 复制全部内容 → Supabase SQL Editor → 点 Run
-- 安全：可以重复跑
--
-- 改动：
-- 1. 让 terminal_id 可以是 NULL（外键 ON DELETE SET NULL）
-- 2. fn_submit_order_atomic 在写订单前检查 terminal_id 是否真实存在
--    不存在就改成 NULL
-- ============================================================

-- ── PART 1: 放宽外键约束 ──
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_terminal_id_fkey;
ALTER TABLE orders ALTER COLUMN terminal_id DROP NOT NULL;
ALTER TABLE orders
  ADD CONSTRAINT orders_terminal_id_fkey
  FOREIGN KEY (terminal_id) REFERENCES terminals(id)
  ON DELETE SET NULL;


-- ── PART 2: 重写 fn_submit_order_atomic — 自动验证 terminal_id ──
CREATE OR REPLACE FUNCTION fn_submit_order_atomic(
  p_tenant_id    UUID,
  p_store_id     UUID,
  p_cashier_id   UUID,
  p_terminal_id  UUID,
  p_order_data   JSONB,
  p_items        JSONB,
  p_payments     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item          JSONB;
  v_order_id      UUID;
  v_order_number  TEXT;
  v_sn_result     JSONB;
  v_inv_result    JSONB;
  v_warnings      TEXT[] := ARRAY[]::TEXT[];
  v_terminal_id   UUID;
BEGIN
  SELECT fn_generate_order_number(p_tenant_id) INTO v_order_number;
  v_order_id := gen_random_uuid();

  -- 检查 terminal_id 是否真实存在 — 不存在就用 NULL
  IF p_terminal_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM terminals WHERE id = p_terminal_id AND tenant_id = p_tenant_id
  ) THEN
    v_terminal_id := p_terminal_id;
  ELSE
    v_terminal_id := NULL;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF v_item->>'serial_number' IS NOT NULL AND v_item->>'serial_number' != '' THEN
      SELECT fn_claim_serial_atomic(
        p_tenant_id, v_item->>'serial_number', v_order_id,
        p_cashier_id,
        NULLIF(p_order_data->>'customer_id', '')::UUID,
        (v_item->>'unit_price')::NUMERIC
      ) INTO v_sn_result;

      IF NOT (v_sn_result->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object(
          'success', false,
          'message', v_sn_result->>'message',
          'step',    'serial_check'
        );
      END IF;

    ELSIF COALESCE(v_item->>'product_type', 'product') NOT IN ('service') THEN
      SELECT fn_deduct_inventory_atomic(
        p_tenant_id, p_store_id,
        (v_item->>'product_id')::UUID,
        (v_item->>'quantity')::NUMERIC,
        COALESCE(v_item->>'unit', 'ea')
      ) INTO v_inv_result;

      IF v_inv_result->>'warning' IS NOT NULL THEN
        v_warnings := array_append(v_warnings,
          (v_item->>'product_name') || ': ' || (v_inv_result->>'warning')
        );
      END IF;
    END IF;
  END LOOP;

  -- 写入订单（terminal_id 用经过验证的值，可能是 NULL）
  INSERT INTO orders (
    id, tenant_id, store_id, order_number, cashier_id, terminal_id,
    customer_id, status, subtotal, discount_amount, tax_amount, total,
    amount_paid, tax_breakdown, points_earned, version
  ) VALUES (
    v_order_id, p_tenant_id, p_store_id, v_order_number, p_cashier_id, v_terminal_id,
    NULLIF(p_order_data->>'customer_id', '')::UUID,
    'completed',
    (p_order_data->>'subtotal')::NUMERIC,
    COALESCE((p_order_data->>'discount_amount')::NUMERIC, 0),
    (p_order_data->>'tax_amount')::NUMERIC,
    (p_order_data->>'total')::NUMERIC,
    (p_order_data->>'amount_paid')::NUMERIC,
    COALESCE(p_order_data->'tax_breakdown', '[]'::JSONB),
    COALESCE((p_order_data->>'points_earned')::INTEGER, 0),
    1
  );

  INSERT INTO order_items (
    tenant_id, order_id, product_id, product_name, product_sku,
    product_type, serial_number, quantity, unit, unit_price,
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
    COALESCE((item->>'discount_amount')::NUMERIC, 0),
    COALESCE((item->>'tax_amount')::NUMERIC, 0),
    (item->>'line_total')::NUMERIC
  FROM jsonb_array_elements(p_items) AS item;

  INSERT INTO order_payments (tenant_id, order_id, method, amount, reference)
  SELECT p_tenant_id, v_order_id, pay->>'method', (pay->>'amount')::NUMERIC, pay->>'reference'
  FROM jsonb_array_elements(p_payments) AS pay;

  IF (p_order_data->>'customer_id') IS NOT NULL
     AND (p_order_data->>'customer_id') != ''
     AND COALESCE((p_order_data->>'points_earned')::INTEGER, 0) > 0 THEN
    UPDATE customers
    SET loyalty_points = COALESCE(loyalty_points, 0) + (p_order_data->>'points_earned')::INTEGER,
        total_spent    = COALESCE(total_spent, 0) + (p_order_data->>'total')::NUMERIC,
        order_count    = COALESCE(order_count, 0) + 1,
        last_order_at  = NOW(),
        version        = version + 1,
        updated_at     = NOW()
    WHERE id = (p_order_data->>'customer_id')::UUID
      AND tenant_id = p_tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'success',       true,
    'order_id',      v_order_id,
    'order_number',  v_order_number,
    'warnings',      to_jsonb(v_warnings)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', SQLERRM,
    'step',    'unknown'
  );
END;
$$;

-- ✅ 跑完看到 "Success. No rows returned"
