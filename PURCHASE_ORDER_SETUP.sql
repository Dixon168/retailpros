-- ============================================================
-- 📦 Purchase Order (PO) System — Step 1 数据库
-- 复制全部内容 → Supabase SQL Editor → 点 Run
-- 安全：可以重复跑
-- ============================================================

-- ── PART 1: purchase_orders 加列 ──
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_by    UUID REFERENCES users(id);

-- ── PART 2: purchase_order_items 加列 ──
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS received_unit_cost DECIMAL(10,2);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS notes TEXT;

-- ── PART 3: 新建 vendor_product_pricing 表 ──
CREATE TABLE IF NOT EXISTS vendor_product_pricing (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendor_id           UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  last_cost           DECIMAL(10,2),       -- 上次买的单价
  avg_cost            DECIMAL(10,2),       -- 这家 vendor 的加权平均
  total_received_qty  DECIMAL(10,3) DEFAULT 0,
  total_received_cost DECIMAL(12,2) DEFAULT 0,
  last_received_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, vendor_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_vpp_product ON vendor_product_pricing(product_id);
CREATE INDEX IF NOT EXISTS idx_vpp_vendor  ON vendor_product_pricing(vendor_id);


-- ── PART 4: 函数 — 生成 PO 号 ──
CREATE OR REPLACE FUNCTION fn_generate_po_number(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $func$
DECLARE
  v_count INT;
  v_date  TEXT;
BEGIN
  v_date := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COUNT(*) INTO v_count
  FROM purchase_orders
  WHERE tenant_id = p_tenant_id
    AND po_number LIKE 'PO-' || v_date || '-%';
  RETURN 'PO-' || v_date || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
END;
$func$;


-- ── PART 5: 函数 — 创建 PO（直接 ordered 状态） ──
CREATE OR REPLACE FUNCTION fn_create_po_atomic(
  p_tenant_id     UUID,
  p_store_id      UUID,
  p_supplier_id   UUID,
  p_expected_date DATE,
  p_notes         TEXT,
  p_created_by    UUID,
  p_items         JSONB     -- [{product_id, product_name, quantity, unit_cost}]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_po_id      UUID;
  v_po_number  TEXT;
  v_total      DECIMAL(10,2) := 0;
  v_item       JSONB;
BEGIN
  v_po_id := gen_random_uuid();
  v_po_number := fn_generate_po_number(p_tenant_id);

  -- 算总额
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total +
      ((v_item->>'quantity')::NUMERIC * (v_item->>'unit_cost')::NUMERIC);
  END LOOP;

  -- 写 PO 头
  INSERT INTO purchase_orders (
    id, tenant_id, store_id, supplier_id, po_number, status,
    total, notes, expected_date, created_by, ordered_at
  ) VALUES (
    v_po_id, p_tenant_id, p_store_id, p_supplier_id, v_po_number, 'ordered',
    v_total, p_notes, p_expected_date, p_created_by, NOW()
  );

  -- 写 PO 行
  INSERT INTO purchase_order_items (
    tenant_id, po_id, product_id, product_name, quantity, unit_cost, received
  )
  SELECT
    p_tenant_id, v_po_id,
    NULLIF(item->>'product_id','')::UUID,
    item->>'product_name',
    (item->>'quantity')::NUMERIC,
    (item->>'unit_cost')::NUMERIC,
    0
  FROM jsonb_array_elements(p_items) AS item;

  RETURN jsonb_build_object(
    'success',   true,
    'po_id',     v_po_id,
    'po_number', v_po_number,
    'total',     v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 6: 函数 — 接收 PO（一键入库） ──
-- 接收：库存 +N、写 inventory_adjustments 历史、更新 vendor_pricing、更新 product.cost
CREATE OR REPLACE FUNCTION fn_receive_po_atomic(
  p_tenant_id  UUID,
  p_store_id   UUID,
  p_po_id      UUID,
  p_user_id    UUID,
  p_items      JSONB    -- [{po_item_id, product_id, qty_received, received_unit_cost, notes}]
                         -- For NEW items (not on original PO): {product_id, product_name, qty_received, received_unit_cost}
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_po          RECORD;
  v_item        JSONB;
  v_po_item     RECORD;
  v_qty         NUMERIC;
  v_cost        NUMERIC;
  v_product_id  UUID;
  v_product_name TEXT;
  v_inv_before  NUMERIC;
  v_total_received_lines INT := 0;
  v_total_partial_lines  INT := 0;
  v_new_status  po_status;
BEGIN
  -- 1. 验证 PO 存在
  SELECT * INTO v_po FROM purchase_orders
   WHERE id = p_po_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'PO not found');
  END IF;

  -- 2. 处理每一行
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty  := (v_item->>'qty_received')::NUMERIC;
    v_cost := (v_item->>'received_unit_cost')::NUMERIC;
    v_product_id := NULLIF(v_item->>'product_id','')::UUID;

    -- Skip 0 quantity rows (didn't receive)
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
    IF v_product_id IS NULL THEN CONTINUE; END IF;

    -- Get product name
    SELECT name INTO v_product_name FROM products WHERE id = v_product_id;

    -- (a) Update or insert PO line
    IF (v_item->>'po_item_id') IS NOT NULL AND (v_item->>'po_item_id') != '' THEN
      -- Existing PO line: bump received and store actual cost
      UPDATE purchase_order_items
         SET received = COALESCE(received, 0) + v_qty,
             received_unit_cost = v_cost,
             notes = COALESCE(v_item->>'notes', notes)
       WHERE id = (v_item->>'po_item_id')::UUID;
    ELSE
      -- New line added at receiving time (extra item from vendor)
      INSERT INTO purchase_order_items (
        tenant_id, po_id, product_id, product_name,
        quantity, unit_cost, received, received_unit_cost, notes
      ) VALUES (
        p_tenant_id, p_po_id, v_product_id, v_product_name,
        v_qty, v_cost, v_qty, v_cost,
        COALESCE(v_item->>'notes', 'Added at receiving')
      );
    END IF;

    -- (b) Update inventory (+qty)
    SELECT quantity INTO v_inv_before FROM inventory
     WHERE tenant_id = p_tenant_id AND store_id = p_store_id
       AND product_id = v_product_id FOR UPDATE;

    IF v_inv_before IS NULL THEN
      INSERT INTO inventory (tenant_id, store_id, product_id, quantity, avg_cost)
      VALUES (p_tenant_id, p_store_id, v_product_id, v_qty, v_cost);
      v_inv_before := 0;
    ELSE
      UPDATE inventory
         SET quantity = quantity + v_qty,
             avg_cost = CASE
               WHEN quantity + v_qty = 0 THEN avg_cost
               ELSE ((COALESCE(avg_cost,0) * quantity) + (v_cost * v_qty)) / (quantity + v_qty)
             END,
             version = version + 1,
             updated_at = NOW()
       WHERE tenant_id = p_tenant_id AND store_id = p_store_id AND product_id = v_product_id;
    END IF;

    -- (c) Write inventory_adjustments history
    INSERT INTO inventory_adjustments (
      tenant_id, store_id, product_id,
      qty_change, qty_before, qty_after,
      reason, notes, adjusted_by
    ) VALUES (
      p_tenant_id, p_store_id, v_product_id,
      v_qty, v_inv_before, v_inv_before + v_qty,
      'Received from PO ' || v_po.po_number,
      'Cost: $' || v_cost || ' from vendor',
      p_user_id
    );

    -- (d) Update vendor_product_pricing
    INSERT INTO vendor_product_pricing (
      tenant_id, vendor_id, product_id,
      last_cost, avg_cost, total_received_qty, total_received_cost, last_received_at
    ) VALUES (
      p_tenant_id, v_po.supplier_id, v_product_id,
      v_cost, v_cost, v_qty, v_cost * v_qty, NOW()
    )
    ON CONFLICT (tenant_id, vendor_id, product_id) DO UPDATE SET
      last_cost = v_cost,
      total_received_qty = vendor_product_pricing.total_received_qty + v_qty,
      total_received_cost = vendor_product_pricing.total_received_cost + (v_cost * v_qty),
      avg_cost = (vendor_product_pricing.total_received_cost + (v_cost * v_qty))
               / NULLIF(vendor_product_pricing.total_received_qty + v_qty, 0),
      last_received_at = NOW(),
      updated_at = NOW();

    -- (e) Recompute product.cost = weighted avg across ALL vendors
    UPDATE products SET cost = (
      SELECT COALESCE(SUM(total_received_cost) / NULLIF(SUM(total_received_qty), 0), cost)
      FROM vendor_product_pricing
      WHERE product_id = v_product_id AND tenant_id = p_tenant_id
    ),
    updated_at = NOW()
    WHERE id = v_product_id;

  END LOOP;

  -- 3. Update PO status: count fully-received vs partial lines
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(received,0) >= quantity) AS full_lines,
    COUNT(*) FILTER (WHERE COALESCE(received,0) > 0 AND COALESCE(received,0) < quantity) AS partial_lines,
    COUNT(*) AS total_lines
  INTO v_total_received_lines, v_total_partial_lines, v_total_partial_lines  -- reuse name; we want totals
  FROM purchase_order_items WHERE po_id = p_po_id;

  -- Determine new status
  SELECT
    CASE
      WHEN COUNT(*) FILTER (WHERE COALESCE(received,0) >= quantity) = COUNT(*) THEN 'received'
      WHEN COUNT(*) FILTER (WHERE COALESCE(received,0) > 0) > 0 THEN 'partial'
      ELSE v_po.status
    END::po_status
  INTO v_new_status
  FROM purchase_order_items WHERE po_id = p_po_id;

  UPDATE purchase_orders
     SET status = v_new_status,
         received_at = CASE WHEN v_new_status = 'received' THEN NOW() ELSE received_at END,
         updated_at = NOW()
   WHERE id = p_po_id;

  RETURN jsonb_build_object(
    'success',    true,
    'po_id',      p_po_id,
    'po_number',  v_po.po_number,
    'new_status', v_new_status
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 7: 视图 — 简化前端查询 ──
CREATE OR REPLACE VIEW v_po_with_vendor AS
SELECT
  po.*,
  s.name AS vendor_name,
  s.contact_name AS vendor_contact,
  s.phone AS vendor_phone,
  s.email AS vendor_email
FROM purchase_orders po
LEFT JOIN suppliers s ON s.id = po.supplier_id;

-- ✅ 跑完看到 "Success"
