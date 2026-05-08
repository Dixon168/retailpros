-- ============================================================
-- 📦 Stock Levels 页面 — 数据库准备
-- 复制全部内容 → Supabase SQL Editor → 点 Run
-- 安全：可以重复跑
-- ============================================================

-- 1. 给 inventory_adjustments 加列
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. 让 reason 可空（现在是可选的）
ALTER TABLE inventory_adjustments ALTER COLUMN reason DROP NOT NULL;

-- 3. 索引：查询某商品历史时快
CREATE INDEX IF NOT EXISTS idx_inv_adj_product ON inventory_adjustments(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_adj_tenant  ON inventory_adjustments(tenant_id, created_at DESC);

-- 4. 调整库存的原子函数（同时记录历史）
CREATE OR REPLACE FUNCTION fn_adjust_inventory(
  p_tenant_id   UUID,
  p_store_id    UUID,
  p_product_id  UUID,
  p_new_qty     NUMERIC,
  p_reason      TEXT DEFAULT NULL,
  p_notes       TEXT DEFAULT NULL,
  p_user_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_before NUMERIC;
  v_change NUMERIC;
BEGIN
  SELECT quantity INTO v_before
  FROM inventory
  WHERE tenant_id = p_tenant_id AND store_id = p_store_id AND product_id = p_product_id
  FOR UPDATE;

  IF v_before IS NULL THEN
    INSERT INTO inventory (tenant_id, store_id, product_id, quantity)
    VALUES (p_tenant_id, p_store_id, p_product_id, p_new_qty);
    v_before := 0;
  ELSE
    UPDATE inventory
    SET quantity = p_new_qty, version = version + 1, updated_at = NOW()
    WHERE tenant_id = p_tenant_id AND store_id = p_store_id AND product_id = p_product_id;
  END IF;

  v_change := p_new_qty - v_before;

  INSERT INTO inventory_adjustments
    (tenant_id, store_id, product_id, qty_change, qty_before, qty_after, reason, notes, adjusted_by)
  VALUES
    (p_tenant_id, p_store_id, p_product_id, v_change, v_before, p_new_qty, p_reason, p_notes, p_user_id);

  RETURN jsonb_build_object('success', true, 'before', v_before, 'after', p_new_qty, 'change', v_change);
END;
$func$;

-- ✅ 跑完看到 "Success"
