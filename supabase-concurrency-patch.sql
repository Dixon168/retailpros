-- ============================================================
-- RetailPOS — 并发控制补丁
-- 解决多机器同时操作同一订单/库存的竞态问题
-- 执行方式：在 Supabase SQL Editor 粘贴运行
-- ============================================================

-- ── 1. 给关键表加 version 字段（乐观锁）──
-- version 每次更新 +1，如果提交时 version 不匹配说明已被其他机器修改

ALTER TABLE orders      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invoices    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE inventory   ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE serial_numbers ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE member_cards   ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ── 2. 创建分布式锁表 ──
-- 用于在提交订单时锁定资源，防止两台机器同时操作

CREATE TABLE IF NOT EXISTS resource_locks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,  -- 'order' | 'invoice' | 'serial' | 'inventory'
  resource_id   UUID NOT NULL,
  locked_by     UUID NOT NULL,  -- terminal_id（前端生成的唯一标识）
  locked_by_name TEXT,          -- 显示给用户的终端名称，如 "Terminal 1 - John"
  locked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  UNIQUE (tenant_id, resource_type, resource_id)
);

-- 索引：快速查询过期锁
CREATE INDEX IF NOT EXISTS idx_resource_locks_expires
  ON resource_locks(expires_at);

-- ── 3. 获取锁的原子函数 ──
-- 返回 true = 成功拿到锁, false = 被其他人锁定

CREATE OR REPLACE FUNCTION fn_acquire_lock(
  p_tenant_id     UUID,
  p_resource_type TEXT,
  p_resource_id   UUID,
  p_locked_by     UUID,
  p_locked_by_name TEXT DEFAULT NULL,
  p_ttl_seconds   INTEGER DEFAULT 300  -- 默认5分钟自动过期
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing resource_locks%ROWTYPE;
  v_result   JSONB;
BEGIN
  -- 先清理所有过期的锁
  DELETE FROM resource_locks WHERE expires_at < NOW();

  -- 检查是否已有未过期的锁
  SELECT * INTO v_existing
  FROM resource_locks
  WHERE tenant_id     = p_tenant_id
    AND resource_type = p_resource_type
    AND resource_id   = p_resource_id
  FOR UPDATE SKIP LOCKED;  -- 跳过已被其他事务锁定的行

  IF FOUND THEN
    -- 锁已存在
    IF v_existing.locked_by = p_locked_by THEN
      -- 自己的锁：续期并返回成功
      UPDATE resource_locks
      SET expires_at = NOW() + (p_ttl_seconds || ' seconds')::INTERVAL
      WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'success', true,
        'lock_id', v_existing.id,
        'message', 'Lock renewed'
      );
    ELSE
      -- 别人的锁：返回失败和锁定者信息
      RETURN jsonb_build_object(
        'success',        false,
        'locked_by_name', v_existing.locked_by_name,
        'locked_at',      v_existing.locked_at,
        'expires_at',     v_existing.expires_at,
        'message',        COALESCE(v_existing.locked_by_name, 'Another terminal') ||
                          ' is currently editing this record'
      );
    END IF;
  END IF;

  -- 没有锁：插入新锁
  INSERT INTO resource_locks
    (tenant_id, resource_type, resource_id, locked_by, locked_by_name, expires_at)
  VALUES
    (p_tenant_id, p_resource_type, p_resource_id, p_locked_by, p_locked_by_name,
     NOW() + (p_ttl_seconds || ' seconds')::INTERVAL);

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Lock acquired'
  );

EXCEPTION WHEN unique_violation THEN
  -- 极端情况下的竞争（两个请求几乎同时到达）
  RETURN jsonb_build_object(
    'success', false,
    'message', 'Lock conflict, please try again'
  );
END;
$$;

-- ── 4. 释放锁的函数 ──

CREATE OR REPLACE FUNCTION fn_release_lock(
  p_tenant_id     UUID,
  p_resource_type TEXT,
  p_resource_id   UUID,
  p_locked_by     UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM resource_locks
  WHERE tenant_id     = p_tenant_id
    AND resource_type = p_resource_type
    AND resource_id   = p_resource_id
    AND locked_by     = p_locked_by;  -- 只能释放自己的锁

  RETURN FOUND;
END;
$$;

-- ── 5. 原子性库存扣减（含并发检查）──
-- 一次数据库往返完成：检查库存 → 扣减 → 返回结果
-- 使用 FOR UPDATE 行级锁，保证同一时刻只有一个事务修改

CREATE OR REPLACE FUNCTION fn_deduct_inventory_atomic(
  p_tenant_id  UUID,
  p_store_id   UUID,
  p_product_id UUID,
  p_qty        NUMERIC,
  p_unit       TEXT DEFAULT 'ea'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_inv inventory%ROWTYPE;
BEGIN
  -- 加行锁读取库存（其他并发事务会等待）
  SELECT * INTO v_inv
  FROM inventory
  WHERE tenant_id  = p_tenant_id
    AND store_id   = p_store_id
    AND product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Inventory record not found');
  END IF;

  IF v_inv.quantity < p_qty THEN
    RETURN jsonb_build_object(
      'success',   false,
      'message',   'Insufficient stock',
      'available', v_inv.quantity,
      'requested', p_qty
    );
  END IF;

  -- 扣减库存，同时更新 version
  UPDATE inventory
  SET
    quantity   = quantity - p_qty,
    version    = version + 1,
    updated_at = NOW()
  WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'success',   true,
    'remaining', v_inv.quantity - p_qty
  );
END;
$$;

-- ── 6. 原子性序列号锁定（含并发检查）──
-- 防止同一序列号同时卖给两个客户

CREATE OR REPLACE FUNCTION fn_claim_serial_atomic(
  p_tenant_id    UUID,
  p_serial_number TEXT,
  p_order_id     UUID,
  p_cashier_id   UUID,
  p_customer_id  UUID DEFAULT NULL,
  p_sold_price   NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_sn serial_numbers%ROWTYPE;
BEGIN
  -- 加行锁（其他并发事务在此等待）
  SELECT * INTO v_sn
  FROM serial_numbers
  WHERE tenant_id     = p_tenant_id
    AND serial_number = p_serial_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Serial number not found: ' || p_serial_number);
  END IF;

  -- 检查状态
  IF v_sn.status != 'in_stock' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Serial number already ' || v_sn.status || ': ' || p_serial_number
    );
  END IF;

  -- 原子性更新为已售
  UPDATE serial_numbers
  SET
    status      = 'sold',
    order_id    = p_order_id,
    customer_id = p_customer_id,
    sold_by     = p_cashier_id,
    sold_at     = NOW(),
    sold_price  = p_sold_price,
    version     = version + 1,
    updated_at  = NOW()
  WHERE id = v_sn.id;

  RETURN jsonb_build_object('success', true, 'serial_id', v_sn.id);
END;
$$;

-- ── 7. 乐观锁更新订单（version 匹配才更新）──
-- 前端传入它读到的 version，如果数据库里 version 已变说明被别人改过

CREATE OR REPLACE FUNCTION fn_update_order_optimistic(
  p_order_id       UUID,
  p_tenant_id      UUID,
  p_expected_version INTEGER,
  p_updates        JSONB       -- 要更新的字段
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_version INTEGER;
BEGIN
  -- 读取当前 version（不加锁，乐观）
  SELECT version INTO v_current_version
  FROM orders
  WHERE id = p_order_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order not found');
  END IF;

  IF v_current_version != p_expected_version THEN
    -- version 不匹配：已被其他终端修改
    RETURN jsonb_build_object(
      'success',          false,
      'conflict',         true,
      'current_version',  v_current_version,
      'expected_version', p_expected_version,
      'message',          'This order was modified by another terminal. Please refresh and try again.'
    );
  END IF;

  -- version 匹配：安全更新
  UPDATE orders
  SET
    status         = COALESCE((p_updates->>'status')::TEXT, status),
    amount_paid    = COALESCE((p_updates->>'amount_paid')::NUMERIC, amount_paid),
    balance_due    = COALESCE((p_updates->>'balance_due')::NUMERIC, balance_due),
    version        = version + 1,
    updated_at     = NOW()
  WHERE id = p_order_id AND tenant_id = p_tenant_id AND version = p_expected_version;

  IF NOT FOUND THEN
    -- 极端竞争情况（两个请求同时通过了version检查）
    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'message', 'Concurrent update conflict. Please refresh and try again.'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'new_version', p_expected_version + 1);
END;
$$;

-- ── 8. 完整原子性下单函数（核心）──
-- 在单个事务内完成：扣库存 + 锁序列号 + 写订单 + 写明细 + 写支付
-- 全部成功才提交，任何一步失败全部回滚

CREATE OR REPLACE FUNCTION fn_submit_order_atomic(
  p_tenant_id    UUID,
  p_store_id     UUID,
  p_cashier_id   UUID,
  p_terminal_id  UUID,
  p_order_data   JSONB,   -- 订单主记录字段
  p_items        JSONB,   -- 订单明细数组
  p_payments     JSONB    -- 支付方式数组
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item          JSONB;
  v_payment       JSONB;
  v_order_id      UUID;
  v_order_number  TEXT;
  v_sn_result     JSONB;
  v_inv_result    JSONB;
BEGIN
  -- ── Step 1: 生成订单号 ──
  SELECT fn_generate_order_number(p_tenant_id) INTO v_order_number;
  v_order_id := gen_random_uuid();

  -- ── Step 2: 逐项检查并锁定资源 ──
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- 序列号商品：原子锁定序列号
    IF v_item->>'serial_number' IS NOT NULL AND v_item->>'serial_number' != '' THEN
      SELECT fn_claim_serial_atomic(
        p_tenant_id,
        v_item->>'serial_number',
        v_order_id,
        p_cashier_id,
        (p_order_data->>'customer_id')::UUID,
        (v_item->>'unit_price')::NUMERIC
      ) INTO v_sn_result;

      IF NOT (v_sn_result->>'success')::BOOLEAN THEN
        -- 序列号已被卖出，回滚整个事务
        RETURN jsonb_build_object(
          'success', false,
          'message', v_sn_result->>'message',
          'step',    'serial_check'
        );
      END IF;

    -- 非序列号、非服务商品：扣减库存
    ELSIF v_item->>'product_type' NOT IN ('service') THEN
      SELECT fn_deduct_inventory_atomic(
        p_tenant_id,
        p_store_id,
        (v_item->>'product_id')::UUID,
        (v_item->>'quantity')::NUMERIC,
        COALESCE(v_item->>'unit', 'ea')
      ) INTO v_inv_result;

      IF NOT (v_inv_result->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object(
          'success', false,
          'message', v_inv_result->>'message',
          'step',    'inventory_check',
          'product', v_item->>'product_name'
        );
      END IF;
    END IF;
  END LOOP;

  -- ── Step 3: 写入订单主记录 ──
  INSERT INTO orders (
    id, tenant_id, store_id, order_number, cashier_id, terminal_id,
    customer_id, status, subtotal, discount_amount, tax_amount, total,
    amount_paid, balance_due, tax_breakdown, points_earned, version
  ) VALUES (
    v_order_id,
    p_tenant_id,
    p_store_id,
    v_order_number,
    p_cashier_id,
    p_terminal_id,
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

  -- ── Step 4: 写入订单明细 ──
  INSERT INTO order_items (
    tenant_id, order_id, product_id, product_name, product_sku,
    product_type, serial_number, quantity, unit, unit_price,
    discount_amount, tax_amount, line_total
  )
  SELECT
    p_tenant_id,
    v_order_id,
    (item->>'product_id')::UUID,
    item->>'product_name',
    item->>'product_sku',
    item->>'product_type',
    NULLIF(item->>'serial_number', ''),
    (item->>'quantity')::NUMERIC,
    COALESCE(item->>'unit', 'ea'),
    (item->>'unit_price')::NUMERIC,
    COALESCE((item->>'discount_amount')::NUMERIC, 0),
    COALESCE((item->>'tax_amount')::NUMERIC, 0),
    (item->>'line_total')::NUMERIC
  FROM jsonb_array_elements(p_items) AS item;

  -- ── Step 5: 写入支付记录 ──
  INSERT INTO order_payments (tenant_id, order_id, method, amount, reference)
  SELECT
    p_tenant_id,
    v_order_id,
    pay->>'method',
    (pay->>'amount')::NUMERIC,
    pay->>'reference'
  FROM jsonb_array_elements(p_payments) AS pay;

  -- ── Step 6: 更新客户积分（如有客户）──
  IF (p_order_data->>'customer_id') IS NOT NULL AND (p_order_data->>'points_earned')::INTEGER > 0 THEN
    UPDATE customers
    SET
      loyalty_points = loyalty_points + (p_order_data->>'points_earned')::INTEGER,
      total_spent    = total_spent + (p_order_data->>'total')::NUMERIC,
      order_count    = order_count + 1,
      last_order_at  = NOW(),
      version        = version + 1,
      updated_at     = NOW()
    WHERE id = (p_order_data->>'customer_id')::UUID
      AND tenant_id = p_tenant_id;
  END IF;

  -- ── 全部成功 ──
  RETURN jsonb_build_object(
    'success',       true,
    'order_id',      v_order_id,
    'order_number',  v_order_number
  );

-- 任何异常 → 整个事务自动回滚
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', SQLERRM,
    'step',    'unknown'
  );
END;
$$;

-- ── 9. RLS: resource_locks 只能看自己租户的锁 ──
ALTER TABLE resource_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation on resource_locks"
  ON resource_locks
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ── 10. 自动清理过期锁（定时任务，Supabase 用 pg_cron 扩展）──
-- 如果 Supabase 项目启用了 pg_cron，取消下面注释：
-- SELECT cron.schedule('cleanup-expired-locks', '*/5 * * * *',
--   'DELETE FROM resource_locks WHERE expires_at < NOW()');

-- ── 完成 ──
-- 验证：
SELECT 'Concurrency control patch applied successfully' AS status;
SELECT routine_name FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_name LIKE 'fn_%'
  ORDER BY routine_name;
