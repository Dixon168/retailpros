-- ============================================================
-- 🚚 Vendors 页面 — 数据库准备
-- 复制全部内容 → Supabase SQL Editor → 点 Run
-- 安全：可以重复跑
-- ============================================================

-- 给 suppliers 表加缺失的列
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name   TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city           TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS state          TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS zip            TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms  TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes          TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW();

-- 索引
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_active
  ON suppliers(tenant_id, is_active);

-- ✅ 完成
