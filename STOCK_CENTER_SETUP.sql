-- ============================================================
-- 📦 Stock Center 升级 — 数据库准备
-- 复制全部内容 → Supabase SQL Editor → 点 Run
-- 安全：可以重复跑
-- ============================================================

-- 1. 给 products 表加 low_stock_qty (如果不存在)
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_qty INTEGER DEFAULT 5;

-- 2. 视图：每个商品最近 7 天卖了多少
CREATE OR REPLACE VIEW v_product_sales_7d AS
SELECT
  oi.product_id,
  o.tenant_id,
  o.store_id,
  COALESCE(SUM(oi.quantity), 0) AS units_sold,
  COALESCE(SUM(oi.line_total), 0) AS revenue,
  COUNT(DISTINCT o.id) AS order_count
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.created_at >= NOW() - INTERVAL '7 days'
  AND o.status NOT IN ('cancelled', 'voided')
GROUP BY oi.product_id, o.tenant_id, o.store_id;

-- 3. 视图：每天卖多少（用于绘 sparkline）
CREATE OR REPLACE VIEW v_product_daily_sales_7d AS
SELECT
  oi.product_id,
  o.tenant_id,
  o.store_id,
  DATE(o.created_at) AS sale_date,
  COALESCE(SUM(oi.quantity), 0) AS units
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.created_at >= NOW() - INTERVAL '7 days'
  AND o.status NOT IN ('cancelled', 'voided')
GROUP BY oi.product_id, o.tenant_id, o.store_id, DATE(o.created_at);

-- ✅ 跑完看到 "Success"
