-- ============================================================
-- RetailPOS — Products V2 Patch
-- 分类管理 + 标签 + VIP价 + 积分 + 多税 + 序列号追踪
-- ============================================================

-- ── 1. 分类表重建（支持2级）──
DROP TABLE IF EXISTS subcategories CASCADE;

CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  emoji       TEXT DEFAULT '📁',
  color       TEXT DEFAULT '#3b82f6',
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS subcategories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  emoji       TEXT DEFAULT '📂',
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, category_id, name)
);

-- ── 2. Products 新增字段 ──
ALTER TABLE products ADD COLUMN IF NOT EXISTS upc              TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url        TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS prompt_weight    BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS prompt_price     BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_serial       BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory_id   UUID REFERENCES subcategories(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order       INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags             TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_vip        BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vip_price        DECIMAL(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS points_mode      TEXT DEFAULT 'amount'; -- 'fixed' | 'amount'
ALTER TABLE products ADD COLUMN IF NOT EXISTS points_fixed     INTEGER DEFAULT 0;     -- fixed mode: X points per purchase
ALTER TABLE products ADD COLUMN IF NOT EXISTS points_rate      DECIMAL(8,4) DEFAULT 1.0; -- amount mode: X points per $1

-- ── 3. 产品多税关联表 ──
CREATE TABLE IF NOT EXISTS product_tax_rates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tax_rate_id UUID NOT NULL REFERENCES tax_rates(id) ON DELETE CASCADE,
  UNIQUE(product_id, tax_rate_id)
);

-- ── 4. 产品标签表（全局标签库）──
CREATE TABLE IF NOT EXISTS product_tags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#3b82f6',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

-- ── 5. 库存表加 avg_cost ──
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS avg_cost DECIMAL(10,4) DEFAULT 0;

-- ── 6. 收货记录表 ──
CREATE TABLE IF NOT EXISTS inventory_receives (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vendor_id   UUID REFERENCES suppliers(id),
  qty         DECIMAL(10,3) NOT NULL,
  cost        DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_cost  DECIMAL(10,2) GENERATED ALWAYS AS (qty * cost) STORED,
  notes       TEXT,
  received_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. 库存调整记录表 ──
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_change  DECIMAL(10,3) NOT NULL,
  qty_before  DECIMAL(10,3) NOT NULL,
  qty_after   DECIMAL(10,3) NOT NULL,
  reason      TEXT NOT NULL,
  adjusted_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. Storage bucket for product images ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DO $$ BEGIN
  CREATE POLICY "Public read product images"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'product-images');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth upload product images"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth update product images"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 9. RLS ──
ALTER TABLE categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcategories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_tax_rates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_receives  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'categories','subcategories','product_tax_rates',
    'product_tags','inventory_receives','inventory_adjustments'
  ]) LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS "tenant_isolation_%s" ON %s;
      CREATE POLICY "tenant_isolation_%s" ON %s FOR ALL
      USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))',
      t, t, t, t);
  END LOOP;
END $$;

-- ── 10. 积分计算函数 ──
CREATE OR REPLACE FUNCTION fn_calc_product_points(
  p_product_id  UUID,
  p_amount_paid DECIMAL
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_prod products%ROWTYPE;
  v_global_rate DECIMAL DEFAULT 1.0;
BEGIN
  SELECT * INTO v_prod FROM products WHERE id = p_product_id;

  IF v_prod.points_mode = 'fixed' THEN
    RETURN COALESCE(v_prod.points_fixed, 0);
  ELSE
    -- amount mode: use product rate or global default
    RETURN FLOOR(p_amount_paid * COALESCE(NULLIF(v_prod.points_rate, 0), v_global_rate));
  END IF;
END; $$;

-- ── 11. 序列号查询视图 ──
CREATE OR REPLACE VIEW serial_number_status AS
SELECT
  sn.id,
  sn.serial,
  sn.status,
  p.name    AS product_name,
  p.sku     AS product_sku,
  t.tenant_id,
  oi.id     AS order_item_id,
  o.order_number,
  o.created_at AS sold_at,
  c.name    AS customer_name
FROM serial_numbers sn
JOIN products p ON p.id = sn.product_id
JOIN tenants t  ON t.id = p.tenant_id
LEFT JOIN order_items oi ON oi.serial_number = sn.serial AND oi.product_id = sn.product_id
LEFT JOIN orders o ON o.id = oi.order_id
LEFT JOIN customers c ON c.id = o.customer_id;

-- ── 12. Indexes ──
CREATE INDEX IF NOT EXISTS idx_products_category    ON products(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_products_tags        ON products USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_products_tenant_sort ON products(tenant_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_serial_numbers_serial ON serial_numbers(tenant_id, serial);
CREATE INDEX IF NOT EXISTS idx_inv_receives_product  ON inventory_receives(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_adjust_product    ON inventory_adjustments(product_id, created_at DESC);

-- ── 13. Sample categories (can delete later) ──
-- Run fn_init_categories after inserting your tenant
CREATE OR REPLACE FUNCTION fn_init_sample_categories(p_tenant_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_cat_id UUID;
BEGIN
  -- Electronics
  INSERT INTO categories (tenant_id, name, emoji, color, sort_order)
  VALUES (p_tenant_id, 'Electronics', '📱', '#3b82f6', 1)
  RETURNING id INTO v_cat_id;
  INSERT INTO subcategories (tenant_id, category_id, name, sort_order) VALUES
    (p_tenant_id, v_cat_id, 'Phones', 1),
    (p_tenant_id, v_cat_id, 'Computers', 2),
    (p_tenant_id, v_cat_id, 'Accessories', 3);

  -- Grocery
  INSERT INTO categories (tenant_id, name, emoji, color, sort_order)
  VALUES (p_tenant_id, 'Grocery', '🛒', '#10b981', 2)
  RETURNING id INTO v_cat_id;
  INSERT INTO subcategories (tenant_id, category_id, name, sort_order) VALUES
    (p_tenant_id, v_cat_id, 'Produce', 1),
    (p_tenant_id, v_cat_id, 'Dairy', 2),
    (p_tenant_id, v_cat_id, 'Beverages', 3);

  -- Services
  INSERT INTO categories (tenant_id, name, emoji, color, sort_order)
  VALUES (p_tenant_id, 'Services', '🔧', '#8b5cf6', 3)
  RETURNING id INTO v_cat_id;
  INSERT INTO subcategories (tenant_id, category_id, name, sort_order) VALUES
    (p_tenant_id, v_cat_id, 'Repair', 1),
    (p_tenant_id, v_cat_id, 'Installation', 2);

EXCEPTION WHEN unique_violation THEN NULL;
END; $$;

SELECT 'Products V2 patch applied ✓' AS status;
