-- ============================================================
-- 🔓 允许负库存 — 警告但不拦截
-- 复制全部内容 → Supabase SQL Editor → 点 Run
-- 安全：可以重复跑
--
-- 改动：
-- 1. fn_deduct_inventory_atomic — 不再拒绝，允许扣到负数
-- 2. fn_submit_order_atomic — 收集所有警告返回前端显示
-- ============================================================

-- ── PART 1: 库存扣减允许负数 ──
CREATE OR REPLACE FUNCTION fn_deduct_inventory_atomic(
  p_tenant_id   UUID,
  p_store_id    UUID,
  p_product_id  UUID,
  p_quantity    NUMERIC,
  p_unit        TEXT DEFAULT 'ea'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_current  NUMERIC;
  v_warning  TEXT := NULL;
BEGIN
  SELECT quantity INTO v_current
  FROM inventory
  WHERE tenant_id = p_tenant_id
    AND store_id  = p_store_id
    AND product_id = p_product_id
  FOR UPDATE;

  -- 如果库存记录不存在 → 创建一条（允许负库存）
  IF v_current IS NULL THEN
    INSERT INTO inventory (tenant_id, store_id, product_id, quantity)
    VALUES (p_tenant_id, p_store_id, p_product_id, -p_quantity);
    RETURN jsonb_build_object(
      'success',   true,
      'remaining', -p_quantity,
      'warning',   'Inventory record was missing — created with negative quantity'
    );
  END IF;

  -- 库存不够 → 不拒绝，只警告
  IF v_current < p_quantity THEN
    v_warning := 'Stock went negative: was ' || v_current || ', sold ' || p_quantity || ' (now ' || (v_current - p_quantity) || ')';
  END IF;

  -- 直接扣，允许变负数
  UPDATE inventory
  SET quantity = quantity - p_quantity,
      version  = version + 1,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND store_id  = p_store_id
    AND product_id = p_product_id;

  RETURN jsonb_build_object(
    'success',   true,
    'remaining', v_current - p_quantity,
    'warning',   v_warning
  );
END;
$$;


-- ── PART 2: 订单提交时收集所有警告 ──
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
BEGIN
  SELECT fn_generate_order_number(p_tenant_id) INTO v_order_number;
  v_order_id := gen_random_uuid();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- 序列号商品 → 仍然必须有序列号（不能负卖）
    IF v_item->>'serial_number' IS NOT NULL AND v_item->>'serial_number' != '' THEN
      SELECT fn_claim_serial_atomic(
        p_tenant_id,
        v_item->>'serial_number',
        v_order_id,
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

    -- 普通商品（非服务）→ 扣库存（允许负数）
    ELSIF COALESCE(v_item->>'product_type', 'product') NOT IN ('service') THEN
      SELECT fn_deduct_inventory_atomic(
        p_tenant_id,
        p_store_id,
        (v_item->>'product_id')::UUID,
        (v_item->>'quantity')::NUMERIC,
        COALESCE(v_item->>'unit', 'ea')
      ) INTO v_inv_result;

      -- 收集警告（但不阻止订单）
      IF v_inv_result->>'warning' IS NOT NULL THEN
        v_warnings := array_append(v_warnings,
          (v_item->>'product_name') || ': ' || (v_inv_result->>'warning')
        );
      END IF;
    END IF;
  END LOOP;

  -- 写入订单主记录
  INSERT INTO orders (
    id, tenant_id, store_id, order_number, cashier_id, terminal_id,
    customer_id, status, subtotal, discount_amount, tax_amount, total,
    amount_paid, balance_due, tax_breakdown, points_earned, version
  ) VALUES (
    v_order_id, p_tenant_id, p_store_id, v_order_number, p_cashier_id, p_terminal_id,
    NULLIF(p_order_data->>'customer_id', '')::UUID,
    'completed',
    (p_order_data->>'subtotal')::NUMERIC,
    COALESCE((p_order_data->>'discount_amount')::NUMERIC, 0),
    (p_order_data->>'tax_amount')::NUMERIC,
    (p_order_data->>'total')::NUMERIC,
    (p_order_data->>'amount_paid')::NUMERIC,
    GREATEST(0, (p_order_data->>'total')::NUMERIC - (p_order_data->>'amount_paid')::NUMERIC),
    COALESCE(p_order_data->'tax_breakdown', '[]'::JSONB),
    COALESCE((p_order_data->>'points_earned')::INTEGER, 0),
    1
  );

  -- 写入订单明细
  INSERT INTO order_items (
    tenant_id, order_id, product_id, product_name, product_sku,
    product_type, serial_number, quantity, unit, unit_price,
    discount_amount, tax_amount, line_total
  )
  SELECT
    p_tenant_id, v_order_id,
    NULLIF(item->>'product_id', '')::UUID,
    item->>'product_name',
    item->>'product_sku',
    COALESCE(item->>'product_type', 'product'),
    NULLIF(item->>'serial_number', ''),
    (item->>'quantity')::NUMERIC,
    COALESCE(item->>'unit', 'ea'),
    (item->>'unit_price')::NUMERIC,
    COALESCE((item->>'discount_amount')::NUMERIC, 0),
    COALESCE((item->>'tax_amount')::NUMERIC, 0),
    (item->>'line_total')::NUMERIC
  FROM jsonb_array_elements(p_items) AS item;

  -- 写入付款记录
  INSERT INTO order_payments (tenant_id, order_id, method, amount, reference)
  SELECT p_tenant_id, v_order_id, pay->>'method', (pay->>'amount')::NUMERIC, pay->>'reference'
  FROM jsonb_array_elements(p_payments) AS pay;

  -- 更新客户积分
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
-- 现在所有结账都不会因库存不足被拦
-- 库存可以变负数，订单完成后会显示警告 toast
-- 商家在库存页面看到负数后自己处理（盘点、补货）
