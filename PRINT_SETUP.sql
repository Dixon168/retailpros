-- ============================================================
-- 🖨️ Printing setup — adds logo_url + website to stores
-- 复制全部 → Supabase SQL Editor → Run
-- 安全：可重复跑
-- ============================================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS website  TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS tax_id   TEXT;

-- ✅ 完成
