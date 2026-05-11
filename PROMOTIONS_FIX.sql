-- ============================================================
-- 🎁 Promotions schema — adds missing columns
-- 复制全部 → Supabase SQL Editor → Run
-- 安全：可重复跑
-- ============================================================

-- The promotions form supports types: sale / bulk / time
-- Add columns that the existing UI uses but were missing

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS product_id  UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS sale_start  TIMESTAMPTZ;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS sale_end    TIMESTAMPTZ;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS sale_type   TEXT;           -- 'fixed' | 'percent'
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS sale_value  DECIMAL(10,2);
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS bulk_tiers  JSONB DEFAULT '[]'::jsonb;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS time_rules  JSONB DEFAULT '[]'::jsonb;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

-- Index for filtering active promotions by date range
CREATE INDEX IF NOT EXISTS idx_promotions_active_dates
  ON promotions(tenant_id, is_active, sale_start, sale_end)
  WHERE is_active = true;

-- Index for product-specific promos
CREATE INDEX IF NOT EXISTS idx_promotions_product
  ON promotions(product_id) WHERE product_id IS NOT NULL;

-- ✅ 完成
