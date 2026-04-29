-- ============================================================
-- RetailPOS — 完整数据库重构补丁 v4
-- 执行顺序：在之前所有补丁之后执行
-- 包含：B2C/B2B客户分离、折扣等级、支付配置、
--       信用卡交易、挂单、Batch Close、平台收费
-- ============================================================

-- ── 新增枚举类型 ──
DO $$ BEGIN
  CREATE TYPE b2c_tier    AS ENUM ('regular','silver','gold','vip');
  CREATE TYPE b2b_tier    AS ENUM ('standard','wholesale','preferred','contract');
  CREATE TYPE order_status_ext AS ENUM (
    'completed','held','needs_recharge',
    'voided','partial_void',
    'refunded','partially_refunded'
  );
  CREATE TYPE card_tx_status AS ENUM (
    'authorized','captured','settled',
    'voided','refunded','partially_refunded','declined'
  );
  CREATE TYPE refund_mode AS ENUM ('free','scan','by_order');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 1. B2C 零售客人（重命名 + 清理 customers 表）
-- ============================================================

-- 保留现有 customers 表作为 retail_customers，清理 B2B 字段
-- 用 ALTER + 新表方式，不破坏现有外键

-- 给现有 customers 表加 B2C 专用字段
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier        b2c_tier DEFAULT 'regular';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier_discount DECIMAL(5,4) DEFAULT 1.0000;
  -- 1.0 = 原价，0.95 = 95折

-- 移除 customers 表上不属于 B2C 的字段（用 DEFAULT 清空即可，不真正 DROP 避免破坏）
-- credit_enabled / credit_limit / billing_cycle 在 B2C 端不显示，逻辑层忽略

-- ============================================================
-- 2. B2B 商家客户（全新表）
-- ============================================================

CREATE TABLE IF NOT EXISTS business_customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- 编号
  code            TEXT,                         -- B-0001，自动生成

  -- 公司信息
  company_name    TEXT NOT NULL,
  trade_name      TEXT,                         -- DBA 名称
  tax_id          TEXT,                         -- EIN / Tax ID
  website         TEXT,

  -- 主联系人
  contact_name    TEXT NOT NULL,
  contact_email   TEXT,
  contact_phone   TEXT,
  contact_mobile  TEXT,

  -- 账单地址（Invoice 抬头）
  billing_address TEXT,
  billing_city    TEXT,
  billing_state   TEXT,
  billing_zip     TEXT,
  billing_country TEXT DEFAULT 'US',

  -- 账期设置
  payment_terms   TEXT DEFAULT 'net30',         -- net30/net60/net90/cod/prepaid
  credit_enabled  BOOLEAN DEFAULT true,
  credit_limit    DECIMAL(10,2) DEFAULT 0,       -- 0 = 无限制
  credit_balance  DECIMAL(10,2) DEFAULT 0,       -- 当前欠款（正数=欠钱）

  -- 折扣等级
  tier            b2b_tier DEFAULT 'standard',
  tier_discount   DECIMAL(5,4) DEFAULT 1.0000,   -- 1.0=原价, 0.85=85折
  custom_discount DECIMAL(5,4),                  -- 特殊覆盖，NULL=用等级折扣

  -- 账期提醒
  reminder_days_before INT DEFAULT 7,
  ar_email        TEXT,                          -- 发送 Invoice / 催款的邮箱

  -- 统计（触发器维护）
  total_spent     DECIMAL(10,2) DEFAULT 0,
  invoice_count   INT DEFAULT 0,
  overdue_amount  DECIMAL(10,2) DEFAULT 0,

  is_active       BOOLEAN DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, code)
);

-- 自动生成 B2B 编号
CREATE OR REPLACE FUNCTION fn_generate_business_customer_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 3) AS INTEGER)), 0) + 1
  INTO v_num FROM business_customers WHERE tenant_id = NEW.tenant_id;
  NEW.code := 'B-' || LPAD(v_num::TEXT, 4, '0');
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_business_customer_code
  BEFORE INSERT ON business_customers
  FOR EACH ROW WHEN (NEW.code IS NULL)
  EXECUTE FUNCTION fn_generate_business_customer_code();

CREATE TRIGGER trg_business_customers_updated_at
  BEFORE UPDATE ON business_customers
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- ── B2B 多联系人 ──
CREATE TABLE IF NOT EXISTS business_contacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id      UUID NOT NULL REFERENCES business_customers(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  title            TEXT,                        -- 职位
  email            TEXT,
  phone            TEXT,
  role             TEXT DEFAULT 'contact',      -- billing/purchasing/owner/contact
  is_primary       BOOLEAN DEFAULT false,
  receive_invoice  BOOLEAN DEFAULT false,       -- 是否接收 Invoice 邮件
  receive_reminder BOOLEAN DEFAULT false,       -- 是否接收催款邮件
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── B2B 多送货地址 ──
CREATE TABLE IF NOT EXISTS business_addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES business_customers(id) ON DELETE CASCADE,
  label       TEXT,                             -- 仓库/办公室/门店
  address     TEXT NOT NULL,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  country     TEXT DEFAULT 'US',
  contact_name  TEXT,
  contact_phone TEXT,
  is_default  BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- invoices 表加 business_customer_id 外键
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS
  business_customer_id UUID REFERENCES business_customers(id) ON DELETE SET NULL;

-- ============================================================
-- 3. 折扣等级配置（Settings 里管理）
-- ============================================================

CREATE TABLE IF NOT EXISTS discount_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_type TEXT NOT NULL,                  -- 'b2c' | 'b2b'
  tier_key      TEXT NOT NULL,                  -- 'regular'/'silver'/'gold'/'vip' 或 'standard'/'wholesale' 等
  tier_name     TEXT NOT NULL,                  -- 显示名称
  discount_rate DECIMAL(5,4) NOT NULL DEFAULT 1.0000, -- 1.0=原价，0.9=9折
  color         TEXT DEFAULT '#3b82f6',         -- 前端显示颜色
  sort_order    INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, customer_type, tier_key)
);

-- 插入默认折扣等级
CREATE OR REPLACE FUNCTION fn_init_discount_tiers(p_tenant_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  -- B2C 等级
  INSERT INTO discount_tiers (tenant_id, customer_type, tier_key, tier_name, discount_rate, color, sort_order)
  VALUES
    (p_tenant_id, 'b2c', 'regular', 'Regular', 1.0000, '#8899b0', 1),
    (p_tenant_id, 'b2c', 'silver',  'Silver',  0.9800, '#94a3b8', 2),
    (p_tenant_id, 'b2c', 'gold',    'Gold',    0.9500, '#f59e0b', 3),
    (p_tenant_id, 'b2c', 'vip',     'VIP',     0.9000, '#8b5cf6', 4)
  ON CONFLICT (tenant_id, customer_type, tier_key) DO NOTHING;

  -- B2B 等级
  INSERT INTO discount_tiers (tenant_id, customer_type, tier_key, tier_name, discount_rate, color, sort_order)
  VALUES
    (p_tenant_id, 'b2b', 'standard',   'Standard',   1.0000, '#8899b0', 1),
    (p_tenant_id, 'b2b', 'wholesale',  'Wholesale',  0.9000, '#06b6d4', 2),
    (p_tenant_id, 'b2b', 'preferred',  'Preferred',  0.8500, '#10b981', 3),
    (p_tenant_id, 'b2b', 'contract',   'Contract',   0.8000, '#3b82f6', 4)
  ON CONFLICT (tenant_id, customer_type, tier_key) DO NOTHING;
END; $$;

-- ── 折扣计算函数（POS 收银时调用）──
-- 返回最终折扣率，处理活动折扣 vs 客户等级折扣的优先级
CREATE OR REPLACE FUNCTION fn_calc_discount(
  p_customer_discount  DECIMAL,   -- 客户等级折扣率，如 0.90
  p_promo_discount     DECIMAL,   -- 活动折扣率，如 0.95（NULL=无活动）
  p_promo_stackable    BOOLEAN,   -- 活动是否允许叠加
  p_promo_priority     TEXT       -- 'promo_first' | 'customer_first'
)
RETURNS DECIMAL LANGUAGE plpgsql AS $$
BEGIN
  -- 没有客户折扣也没有活动
  IF p_customer_discount = 1.0 AND p_promo_discount IS NULL THEN
    RETURN 1.0;
  END IF;

  -- 只有客户折扣
  IF p_promo_discount IS NULL THEN
    RETURN p_customer_discount;
  END IF;

  -- 只有活动折扣（客户是 regular/standard）
  IF p_customer_discount = 1.0 THEN
    RETURN p_promo_discount;
  END IF;

  -- 两个都有
  IF p_promo_stackable THEN
    -- 叠加：两个折扣相乘，如 0.90 × 0.95 = 0.855
    RETURN p_customer_discount * p_promo_discount;
  ELSIF p_promo_priority = 'promo_first' THEN
    -- 活动优先：取更大折扣（数值更小）
    RETURN LEAST(p_customer_discount, p_promo_discount);
  ELSE
    -- 客户折扣优先
    RETURN p_customer_discount;
  END IF;
END; $$;

-- ============================================================
-- 4. 支付配置（CardPointe 凭证）
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,

  -- CardPointe 商家凭证（平台管理员填写）
  cp_merchant_id  TEXT,
  cp_username     TEXT,
  cp_password     TEXT,                        -- 加密存储
  cp_endpoint     TEXT DEFAULT 'https://fts.cardconnect.com',
  cp_hsn          TEXT,                        -- 终端 HSN（Hardware Serial Number，PAX 用）

  -- 状态
  is_configured   BOOLEAN DEFAULT false,
  configured_at   TIMESTAMPTZ,
  configured_by   UUID,                        -- 哪个平台管理员填的

  -- 退款设置（商家自己设）
  refund_days_limit        INTEGER DEFAULT NULL,  -- NULL=无限制
  require_pin_for_refund   BOOLEAN DEFAULT true,
  require_pin_for_void     BOOLEAN DEFAULT true,

  -- Batch Close 设置
  auto_batch_close         BOOLEAN DEFAULT true,
  auto_batch_close_time    TEXT DEFAULT '02:00', -- UTC HH:MM

  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 平台自己的收费配置（收商家订阅费，存在单独的 platform_config 表）
CREATE TABLE IF NOT EXISTS platform_payment_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cp_merchant_id  TEXT,                        -- 你自己的 MID
  cp_username     TEXT,
  cp_password     TEXT,
  cp_endpoint     TEXT DEFAULT 'https://fts.cardconnect.com',
  is_live         BOOLEAN DEFAULT false,       -- false=沙盒，true=生产
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 预插入一条空记录，等你填
INSERT INTO platform_payment_config (id) VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. 信用卡交易记录
-- ============================================================

CREATE TABLE IF NOT EXISTS card_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id),
  terminal_id     UUID REFERENCES terminals(id),
  terminal_name   TEXT,

  -- 关联订单或 Invoice
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_number    TEXT,
  invoice_id      UUID REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_number  TEXT,

  -- Batch 关联
  batch_id        UUID,

  -- CardPointe 返回字段
  cp_retref       TEXT,                        -- Reference Number，Void/Refund 时用
  cp_authcode     TEXT,
  cp_resptext     TEXT,
  cp_respcode     TEXT,
  cp_token        TEXT,                        -- 卡 Token，补收时用

  -- 卡信息（脱敏）
  card_type       TEXT,                        -- VISA/MC/AMEX/DISC
  masked_pan      TEXT,                        -- ****1234
  card_holder     TEXT,
  entry_mode      TEXT,                        -- CHIP/TAP/SWIPE/MANUAL

  -- 金额
  amount          DECIMAL(10,2) NOT NULL,
  tip_amount      DECIMAL(10,2) DEFAULT 0,
  refunded_amount DECIMAL(10,2) DEFAULT 0,

  -- 状态
  status          card_tx_status DEFAULT 'authorized',

  -- 操作人
  created_by      UUID REFERENCES users(id),
  voided_by       UUID REFERENCES users(id),
  voided_by_name  TEXT,
  authorized_by   UUID REFERENCES users(id),  -- PIN 授权人（无权限时）
  authorized_by_name TEXT,

  -- 时间
  authorized_at   TIMESTAMPTZ DEFAULT NOW(),
  settled_at      TIMESTAMPTZ,
  voided_at       TIMESTAMPTZ,

  receipt_printed BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_tx_tenant   ON card_transactions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_tx_order    ON card_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_card_tx_invoice  ON card_transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_card_tx_terminal ON card_transactions(terminal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_tx_retref   ON card_transactions(cp_retref);
CREATE INDEX IF NOT EXISTS idx_card_tx_status   ON card_transactions(tenant_id, status);

-- ── 退款明细（每笔退款独立记录）──
CREATE TABLE IF NOT EXISTS refund_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  terminal_id     UUID REFERENCES terminals(id),
  terminal_name   TEXT,

  -- 关联
  original_order_id   UUID REFERENCES orders(id) ON DELETE SET NULL,
  original_order_number TEXT,
  refund_order_id     UUID REFERENCES orders(id) ON DELETE SET NULL,
  card_tx_id          UUID REFERENCES card_transactions(id) ON DELETE SET NULL,
  original_card_tx_id UUID REFERENCES card_transactions(id) ON DELETE SET NULL,

  -- 退款信息
  mode            refund_mode NOT NULL,         -- free/scan/by_order
  amount          DECIMAL(10,2) NOT NULL,
  reason          TEXT,
  items           JSONB DEFAULT '[]',           -- [{product_id, name, qty, amount}]

  -- 权限
  refunded_by     UUID REFERENCES users(id),
  refunded_by_name TEXT,
  authorized_by   UUID REFERENCES users(id),   -- PIN授权人
  authorized_by_name TEXT,

  -- CardPointe 退款结果
  cp_retref       TEXT,
  cp_authcode     TEXT,

  receipt_printed BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. Batch Close 结算历史
-- ============================================================

CREATE TABLE IF NOT EXISTS batch_closes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  terminal_id     UUID REFERENCES terminals(id),
  terminal_name   TEXT,

  -- 结算信息
  batch_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  triggered_by    TEXT DEFAULT 'auto',         -- 'auto' | 'manual'
  triggered_by_user UUID REFERENCES users(id),
  triggered_by_name TEXT,

  -- CardPointe 返回
  cp_batchid      TEXT,
  cp_resptext     TEXT,

  -- 汇总金额
  total_sales     DECIMAL(10,2) DEFAULT 0,
  total_refunds   DECIMAL(10,2) DEFAULT 0,
  total_voids     DECIMAL(10,2) DEFAULT 0,
  net_amount      DECIMAL(10,2) DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,

  -- 状态
  status          TEXT DEFAULT 'success',       -- success/failed/partial
  error_message   TEXT,
  receipt_printed BOOLEAN DEFAULT false,

  closed_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_closes_terminal
  ON batch_closes(terminal_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_closes_tenant
  ON batch_closes(tenant_id, batch_date DESC);

-- Batch Close 后更新交易状态
CREATE OR REPLACE FUNCTION fn_settle_batch_transactions(
  p_batch_id  UUID,
  p_tenant_id UUID,
  p_terminal_id UUID
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE card_transactions SET
    status     = 'settled',
    batch_id   = p_batch_id,
    settled_at = NOW(),
    updated_at = NOW()
  WHERE tenant_id   = p_tenant_id
    AND terminal_id = p_terminal_id
    AND status      = 'authorized';
END; $$;

-- ============================================================
-- 7. 挂单（Held Orders）
-- ============================================================

CREATE TABLE IF NOT EXISTS held_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id),
  terminal_id     UUID REFERENCES terminals(id),
  terminal_name   TEXT,

  -- 挂单信息
  label           TEXT,                        -- 可选备注，如"等取货"
  held_by         UUID REFERENCES users(id),
  held_by_name    TEXT,
  held_at         TIMESTAMPTZ DEFAULT NOW(),

  -- 购物车完整快照
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   TEXT,
  cart_snapshot   JSONB NOT NULL,              -- 完整购物车数据
  subtotal        DECIMAL(10,2) DEFAULT 0,
  total           DECIMAL(10,2) DEFAULT 0,
  item_count      INTEGER DEFAULT 0,

  -- 状态
  status          TEXT DEFAULT 'held',         -- held / completed / cancelled
  resumed_at      TIMESTAMPTZ,
  resumed_by      UUID REFERENCES users(id),
  resumed_terminal_id UUID REFERENCES terminals(id),
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES users(id),

  -- 不设过期时间，永久保留直到手动处理
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_held_orders_tenant
  ON held_orders(tenant_id, status, held_at DESC);
CREATE INDEX IF NOT EXISTS idx_held_orders_terminal
  ON held_orders(terminal_id, status);

-- ============================================================
-- 8. orders 表补充字段
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  status_ext      TEXT DEFAULT 'completed';   -- 使用上面的 order_status_ext 值

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  recharge_amount DECIMAL(10,2) DEFAULT 0;    -- 需要补收的金额

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  refunded_amount DECIMAL(10,2) DEFAULT 0;

-- ============================================================
-- 9. 平台订阅收费记录
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id         TEXT REFERENCES plans(id),
  amount          DECIMAL(10,2) NOT NULL,
  billing_period  TEXT,                        -- '2024-01' 格式
  cp_retref       TEXT,                        -- CardPointe 交易号
  cp_token        TEXT,                        -- 存储的卡 Token
  masked_pan      TEXT,
  card_type       TEXT,
  status          TEXT DEFAULT 'success',      -- success/failed/refunded
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 存储商家的订阅信用卡 Token（不存卡号）
CREATE TABLE IF NOT EXISTS tenant_payment_methods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  cp_token        TEXT NOT NULL,               -- CardPointe token
  masked_pan      TEXT,
  card_type       TEXT,
  expiry          TEXT,
  card_holder     TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. RLS 策略
-- ============================================================

ALTER TABLE business_customers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_addresses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_tiers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_configs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_closes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE held_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

-- 统一 RLS 模板
DO $$
DECLARE
  tbl TEXT;
  tbls TEXT[] := ARRAY[
    'business_customers','business_contacts','business_addresses',
    'discount_tiers','payment_configs','card_transactions',
    'refund_records','batch_closes','held_orders','subscription_payments'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('
      CREATE POLICY "tenant_isolation_%s" ON %s FOR ALL
      USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))',
      tbl, tbl);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 11. 更新现有 promotions 表（加叠加规则字段）
-- ============================================================

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS
  stackable       BOOLEAN DEFAULT false;       -- 是否可与客户折扣叠加

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS
  stack_priority  TEXT DEFAULT 'promo_first';  -- promo_first | customer_first

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS
  applies_to_b2c  BOOLEAN DEFAULT true;

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS
  applies_to_b2b  BOOLEAN DEFAULT false;

-- ============================================================
-- 12. 初始化触发器
-- ============================================================

CREATE TRIGGER trg_business_customers_updated_at2
  BEFORE UPDATE ON business_customers
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_payment_configs_updated_at
  BEFORE UPDATE ON payment_configs
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_card_transactions_updated_at
  BEFORE UPDATE ON card_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- ============================================================
-- 完成
-- ============================================================
SELECT 'v4 patch applied successfully' AS status;

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'retail_customers_view','business_customers','business_contacts',
    'business_addresses','discount_tiers','payment_configs',
    'card_transactions','refund_records','batch_closes',
    'held_orders','subscription_payments','tenant_payment_methods',
    'platform_payment_config','batch_closes'
  )
ORDER BY table_name;
