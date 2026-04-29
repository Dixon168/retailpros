-- ============================================================
-- RetailPOS — MASTER SQL SETUP FILE
-- Run this ONCE in Supabase SQL Editor
-- All patches combined in correct order
-- ============================================================

-- ============================================================
-- RetailPOS SaaS — 完整数据库结构
-- Supabase / PostgreSQL | 版本 1.0 Final
-- 适用：多租户零售POS系统
-- 支持：多门店、多机器、离线收银、美国多州税、序列号追踪
--       会员积分、礼品卡、Invoice、客户账期、营销促销
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 枚举类型
-- ============================================================

CREATE TYPE plan_type           AS ENUM ('starter','business','enterprise');         -- 套餐类型
CREATE TYPE plan_status_type    AS ENUM ('trial','active','suspended','cancelled');  -- 套餐状态
CREATE TYPE user_role           AS ENUM ('owner','manager','cashier');               -- 员工角色
CREATE TYPE product_type        AS ENUM ('unit','weight','serialized','service');    -- 商品类型
CREATE TYPE serial_status       AS ENUM ('in_stock','sold','returned','damaged');    -- 序列号状态
CREATE TYPE po_status           AS ENUM ('draft','ordered','partial','received','cancelled'); -- 采购单状态
CREATE TYPE customer_type       AS ENUM ('retail','wholesale','vip');                -- 客户类型
CREATE TYPE billing_cycle       AS ENUM ('net15','net30','net60');                   -- 账期
CREATE TYPE order_status        AS ENUM ('open','completed','refunded','voided');    -- 订单状态
CREATE TYPE pay_method          AS ENUM ('cash','card','check','bank_transfer','member_card','gift_card','on_account','other'); -- 支付方式
CREATE TYPE invoice_status      AS ENUM ('draft','sent','viewed','partial','paid','overdue','void'); -- Invoice状态
CREATE TYPE invoice_type        AS ENUM ('invoice','quote','credit_note');           -- Invoice类型
CREATE TYPE card_type           AS ENUM ('member','gift');                           -- 卡片类型
CREATE TYPE card_status         AS ENUM ('active','inactive','expired');             -- 卡片状态
CREATE TYPE promo_type          AS ENUM ('quantity_price','buy_get_free','time_special','product_discount','order_discount'); -- 促销类型
CREATE TYPE discount_type       AS ENUM ('percentage','fixed_amount','fixed_price'); -- 折扣方式
CREATE TYPE promo_scope         AS ENUM ('all','category','product','customer_type'); -- 促销范围


-- ============================================================
-- 第1层：租户与员工认证
-- ============================================================

-- 租户主表
-- 每个购买系统的店家就是一个租户，数据完全隔离
CREATE TABLE tenants (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                    TEXT NOT NULL,                          -- 公司/店铺名称
  email                   TEXT UNIQUE NOT NULL,                   -- 登录邮箱
  phone                   TEXT,                                   -- 联系电话
  address                 TEXT,
  city                    TEXT,
  state                   TEXT,                                   -- 州（美国）
  zip                     TEXT,
  country                 TEXT DEFAULT 'US',
  logo_url                TEXT,                                   -- 店铺Logo URL
  plan                    plan_type DEFAULT 'starter',            -- 当前订阅套餐
  plan_status             plan_status_type DEFAULT 'trial',       -- 套餐状态
  trial_ends_at           TIMESTAMPTZ,                            -- 试用到期时间
  stripe_customer_id      TEXT,                                   -- Stripe客户ID（用于计费）
  stripe_subscription_id  TEXT,                                   -- Stripe订阅ID
  default_language        TEXT DEFAULT 'en',                      -- 默认界面语言
  supported_languages     TEXT[] DEFAULT ARRAY['en'],             -- 启用的语言列表
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE tenants IS '租户主表 - 每个购买系统的店家为一个租户，所有数据通过tenant_id隔离';


-- 门店表
-- 一个租户可以有多个门店，每个门店独立管理库存和收银
CREATE TABLE stores (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                                  -- 门店名称
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  phone           TEXT,
  email           TEXT,
  tax_id          TEXT,                                           -- 税号 EIN（用于Invoice抬头）
  receipt_header  TEXT,                                           -- 小票顶部自定义文字
  receipt_footer  TEXT,                                           -- 小票底部文字（感谢语/退换货政策等）
  logo_url        TEXT,                                           -- 门店Logo
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE stores IS '门店表 - 一个租户可拥有多个门店，库存和收银数据按门店隔离';


-- 员工账号表
-- 收银员通过PIN码快速切换，不需要每次重新登录
CREATE TABLE users (
  id              UUID PRIMARY KEY,                               -- 与Supabase Auth uid一致
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id),                    -- 归属门店，NULL=可访问所有门店
  email           TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,                                  -- 员工姓名
  role            user_role NOT NULL DEFAULT 'cashier',
  pin             TEXT,                                           -- 4位收银PIN码（收银台快速切换）
  language        TEXT DEFAULT 'en',                              -- 该员工的界面语言偏好
  permissions     JSONB NOT NULL DEFAULT '{
    "can_discount":          false,
    "max_discount_pct":      0,
    "can_refund":            false,
    "can_void":              false,
    "can_open_drawer":       true,
    "can_view_reports":      false,
    "can_manage_products":   false,
    "can_manage_customers":  false,
    "can_send_invoice":      false,
    "can_manage_promotions": false
  }'::jsonb,                                                      -- 细化权限控制
  is_active       BOOLEAN DEFAULT true,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE users IS '员工账号表 - PIN码用于收银台快速切换，permissions控制各功能权限';


-- ============================================================
-- 第2层：税务管理
-- 支持美国各州多层税率（州税+县税+市税）
-- 每个商品可以绑定不同税组，也可以设为免税
-- ============================================================

-- 税组表
-- 例如："California Sales Tax" 包含 State 6% + County 0.25% + City 1%
CREATE TABLE tax_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,          -- 税组名称，如 "California Sales Tax"
  state           TEXT,                   -- 适用州，如 CA / TX / NY
  is_default      BOOLEAN DEFAULT false,  -- 是否为系统默认税组
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE tax_groups IS '税组表 - 每个税组对应一个地区的完整税务规则';


-- 税率明细表
-- 每个税组可以有多层税率，按sequence顺序计算
CREATE TABLE tax_rates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tax_group_id    UUID NOT NULL REFERENCES tax_groups(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,          -- 税率名称，如 "State Tax" / "County Tax" / "City Tax"
  rate            DECIMAL(6,4) NOT NULL,  -- 税率小数，如 0.0600 = 6.00%
  sequence        INT DEFAULT 1,          -- 计算顺序（数字小的先算）
  is_compound     BOOLEAN DEFAULT false,  -- 复合税：在前层税金基础上再征税
  is_active       BOOLEAN DEFAULT true,
  UNIQUE(tax_group_id, sequence)
  -- 示例：California 合计 7.25%
  --   sequence=1  State Tax   0.0600  复合=否
  --   sequence=2  County Tax  0.0025  复合=否
  --   sequence=3  City Tax    0.0100  复合=否
);
COMMENT ON TABLE tax_rates IS '税率明细表 - 支持州税/县税/市税多层叠加，可设置复合税';


-- ============================================================
-- 第3层：商品管理
-- ============================================================

-- 商品分类表（支持多级分类）
CREATE TABLE categories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  name_i18n       JSONB DEFAULT '{}',     -- 多语言名称 {"zh":"水果","es":"Frutas"}
  color           TEXT DEFAULT '#6366f1', -- POS快捷按钮颜色（十六进制）
  icon            TEXT,
  parent_id       UUID REFERENCES categories(id), -- 父分类ID（支持无限级子分类）
  sort_order      INT DEFAULT 0,
  is_active       BOOLEAN DEFAULT true
);
COMMENT ON TABLE categories IS '商品分类 - 支持多级分类，颜色用于POS界面快捷按钮显示';


-- 商品主表
CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES categories(id),
  sku             TEXT,                   -- 商品编号（租户内唯一）
  barcode         TEXT,                   -- 条形码（租户内唯一，扫码枪使用）
  name            TEXT NOT NULL,          -- 商品名称
  name_i18n       JSONB DEFAULT '{}',     -- 多语言名称 {"zh":"苹果","es":"Manzana"}
  description     TEXT,
  type            product_type NOT NULL DEFAULT 'unit',
  -- unit:       普通件装（服装/杂货等，按件销售）
  -- weight:     称重商品（农产品等，收银时手动输入重量）
  -- serialized: 序列号电子产品（入库出库必须录入机身号）
  -- service:    服务项目（维修费等，不追踪库存）
  price           DECIMAL(10,2) NOT NULL DEFAULT 0, -- 销售单价（称重商品为每磅/公斤价格）
  unit            TEXT DEFAULT 'ea',      -- 单位：ea=件 / lb=磅 / kg=公斤 / oz=盎司
  cost            DECIMAL(10,2),          -- 成本价（用于毛利率计算）
  tax_group_id    UUID REFERENCES tax_groups(id), -- 绑定税组，NULL=该商品免税
  is_taxable      BOOLEAN DEFAULT true,
  track_inventory BOOLEAN DEFAULT true,   -- 是否追踪库存（服务类通常不追踪）
  image_url       TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, sku),
  UNIQUE(tenant_id, barcode)
);
COMMENT ON TABLE products IS '商品主表 - 支持件装/称重/序列号/服务四种类型，多语言名称';


-- 商品变体表
-- 用于同一商品的不同规格，如颜色/尺码
CREATE TABLE product_variants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,          -- 变体名称，如 "红色 / XL"
  sku             TEXT,
  barcode         TEXT,
  price_modifier  DECIMAL(10,2) DEFAULT 0, -- 价格调整（在主商品价格基础上加减）
  is_active       BOOLEAN DEFAULT true
);
COMMENT ON TABLE product_variants IS '商品变体 - 用于颜色/尺码等不同规格，price_modifier为价格差';


-- 库存表
-- 每个门店独立库存，序列号商品的库存数量由serial_numbers表自动统计
CREATE TABLE inventory (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id      UUID REFERENCES product_variants(id),
  quantity        DECIMAL(10,3) DEFAULT 0, -- 当前库存（序列号商品由触发器自动维护）
  low_stock_alert DECIMAL(10,3) DEFAULT 5, -- 低库存预警数量
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, product_id, variant_id)
);
COMMENT ON TABLE inventory IS '库存表 - 每门店独立，序列号商品库存由serial_numbers状态自动统计';


-- ============================================================
-- 第4层：序列号管理（电子产品专用）
-- 每台电子产品（手机/电脑等）有唯一机身号
-- 入库时逐个录入，销售时验证并绑定客户
-- ============================================================

CREATE TABLE serial_numbers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id            UUID NOT NULL REFERENCES stores(id),
  product_id          UUID NOT NULL REFERENCES products(id),
  serial_number       TEXT NOT NULL,      -- 机身号（序列号），租户内全局唯一
  model_number        TEXT,              -- 产品型号，如 iPhone 15 Pro / A2848
  status              serial_status DEFAULT 'in_stock',

  -- 入库信息
  received_at         TIMESTAMPTZ DEFAULT NOW(), -- 入库时间
  purchase_order_id   UUID,              -- 关联采购单（后续添加外键）
  cost_price          DECIMAL(10,2),     -- 入库成本价
  received_by         UUID REFERENCES users(id), -- 操作员工

  -- 销售信息（售出后填入）
  sold_at             TIMESTAMPTZ,       -- 售出时间
  order_id            UUID,              -- 关联POS订单（后续添加外键）
  invoice_id          UUID,              -- 关联Invoice（后续添加外键）
  customer_id         UUID,              -- 卖给哪个客户（后续添加外键）
  sold_price          DECIMAL(10,2),     -- 实际售价
  sold_by             UUID REFERENCES users(id), -- 销售员工

  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, serial_number)
);
COMMENT ON TABLE serial_numbers IS '序列号表 - 每台电子产品独立记录，追踪从入库到销售的完整生命周期';


-- ============================================================
-- 第5层：采购管理
-- ============================================================

-- 供应商表
CREATE TABLE suppliers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,          -- 供应商名称
  contact_name    TEXT,                   -- 联系人
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  payment_terms   TEXT,                   -- 付款条件，如 "Net 30"
  notes           TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE suppliers IS '供应商表 - 管理进货来源，与采购单关联';


-- 采购单主表
CREATE TABLE purchase_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID NOT NULL REFERENCES stores(id),
  supplier_id     UUID REFERENCES suppliers(id),
  po_number       TEXT NOT NULL,          -- 采购单号，如 PO-2024-0001
  status          po_status DEFAULT 'draft',
  order_date      DATE,                   -- 下单日期
  expected_date   DATE,                   -- 预计到货日期
  received_date   DATE,                   -- 实际收货日期
  subtotal        DECIMAL(10,2) DEFAULT 0,
  tax_amount      DECIMAL(10,2) DEFAULT 0,
  total           DECIMAL(10,2) DEFAULT 0,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, po_number)
);
COMMENT ON TABLE purchase_orders IS '采购单主表 - 记录进货信息，收货时触发库存更新和序列号录入';


-- 采购单明细表
CREATE TABLE purchase_order_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id     UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id            UUID NOT NULL REFERENCES products(id),
  variant_id            UUID REFERENCES product_variants(id),
  quantity_ordered      DECIMAL(10,3) NOT NULL DEFAULT 0, -- 采购数量
  quantity_received     DECIMAL(10,3) DEFAULT 0,          -- 实际收货数量（支持分批到货）
  unit_cost             DECIMAL(10,2) DEFAULT 0,          -- 采购单价
  line_total            DECIMAL(10,2) DEFAULT 0           -- 行小计
  -- 序列号商品的机身号录入在 serial_numbers 表中，通过 purchase_order_id 关联
);
COMMENT ON TABLE purchase_order_items IS '采购单明细 - 序列号商品收货时需在serial_numbers表逐一录入机身号';


-- 补充外键：serial_numbers 关联采购单
ALTER TABLE serial_numbers
  ADD CONSTRAINT fk_serial_po
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id);


-- ============================================================
-- 第6层：客户管理
-- POS和Invoice共用同一客户档案
-- 完整360°视图：基本信息/地址/账期/积分/卡/订单/Invoice
-- ============================================================

-- 客户主表
CREATE TABLE customers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                  TEXT,                   -- 客户编号，如 C-0001（自动生成）
  name                  TEXT NOT NULL,
  company               TEXT,                   -- 公司名称（批发客户）
  email                 TEXT,
  phone                 TEXT,
  type                  customer_type DEFAULT 'retail',

  -- 账单地址（固定，用于Invoice抬头）
  billing_address       TEXT,
  billing_city          TEXT,
  billing_state         TEXT,
  billing_zip           TEXT,

  -- 默认送货地址
  shipping_address      TEXT,
  shipping_city         TEXT,
  shipping_state        TEXT,
  shipping_zip          TEXT,

  -- 账期/赊账设置
  credit_enabled        BOOLEAN DEFAULT false,   -- 是否开启赊账功能
  credit_limit          DECIMAL(10,2) DEFAULT 0, -- 信用额度上限（0=不限额）
  credit_balance        DECIMAL(10,2) DEFAULT 0, -- 当前欠款余额（正数=客户欠钱）
  billing_cycle         billing_cycle DEFAULT 'net30', -- 账期类型

  -- 积分（与loyalty_transactions联动）
  loyalty_points        INT DEFAULT 0,           -- 当前积分余额

  -- 账期提醒设置
  reminder_days_before  INT DEFAULT 7,           -- 到期前几天发提醒邮件
  last_reminder_sent_at TIMESTAMPTZ,             -- 最后一次发送提醒时间

  -- 统计数据（由触发器自动维护）
  total_spent           DECIMAL(10,2) DEFAULT 0, -- 累计消费金额
  order_count           INT DEFAULT 0,           -- 累计订单次数

  is_active             BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);
COMMENT ON TABLE customers IS '客户主表 - POS和Invoice共用，360°视图包含账期/积分/卡/历史记录';


-- 客户送货地址历史表
-- 每次使用新地址自动保存，下次下单时显示历史地址供选择
CREATE TABLE customer_addresses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label           TEXT,                   -- 地址标签，如 "公司" / "仓库"
  address         TEXT NOT NULL,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  is_default      BOOLEAN DEFAULT false,  -- 是否为默认送货地址
  usage_count     INT DEFAULT 1,          -- 使用次数（按此排序，常用地址排前面）
  last_used_at    TIMESTAMPTZ DEFAULT NOW(), -- 最近使用时间
  created_at      TIMESTAMPTZ DEFAULT NOW()
  -- 业务逻辑：
  -- 下单选择地址时，若为新地址则自动创建记录
  -- 若地址已存在则更新 usage_count+1 和 last_used_at
  -- 下次下单时按 last_used_at 倒序显示历史地址
);
COMMENT ON TABLE customer_addresses IS '送货地址历史 - 新地址自动保存，按使用频率排序供下次选择';


-- 客户付款记录表（可一次性付多张订单的余额）
CREATE TABLE customer_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id),
  payment_number  TEXT NOT NULL,          -- 付款单号，如 PAY-2024-0001
  payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount    DECIMAL(10,2) NOT NULL, -- 本次付款总金额
  method          pay_method NOT NULL,    -- 付款方式
  reference       TEXT,                   -- 参考号（支票号/银行转账流水号）
  note            TEXT,
  processed_by    UUID REFERENCES users(id), -- 处理员工
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, payment_number)
);
COMMENT ON TABLE customer_payments IS '客户付款记录 - 支持一次付款分配到多张订单/Invoice';


-- 付款分配明细表
-- 一次付款可以分配给多张订单或Invoice
-- 默认按到期日最早的优先分配
CREATE TABLE customer_payment_allocations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_payment_id   UUID NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  order_id              UUID,             -- 分配到的POS订单（后续添加外键）
  invoice_id            UUID,             -- 分配到的Invoice（后续添加外键）
  amount                DECIMAL(10,2) NOT NULL -- 分配金额
  -- 示例：客户一次付款 $500
  -- 分配：订单#001 → $200，Invoice#003 → $300
  -- 系统自动更新各订单/Invoice的amount_paid和balance_due
);
COMMENT ON TABLE customer_payment_allocations IS '付款分配明细 - 将一次付款按金额分配到具体订单或Invoice';


-- ============================================================
-- 第7层：POS订单
-- ============================================================

-- 订单主表
CREATE TABLE orders (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id                    UUID NOT NULL REFERENCES stores(id),
  order_number                TEXT NOT NULL,  -- 订单号，如 ORD-20240115-0042
  customer_id                 UUID REFERENCES customers(id), -- 散客可为NULL
  cashier_id                  UUID REFERENCES users(id),
  status                      order_status DEFAULT 'open',

  -- 送货地址快照（下单时冻结，防止客户修改地址后影响历史记录）
  shipping_address_snapshot   JSONB,

  -- 金额汇总
  subtotal                    DECIMAL(10,2) NOT NULL DEFAULT 0, -- 小计（税前）
  discount_amount             DECIMAL(10,2) DEFAULT 0,          -- 整单折扣金额
  tax_amount                  DECIMAL(10,2) DEFAULT 0,          -- 税金合计
  total                       DECIMAL(10,2) NOT NULL DEFAULT 0, -- 应付总金额
  amount_paid                 DECIMAL(10,2) DEFAULT 0,          -- 已付金额
  balance_due                 DECIMAL(10,2) GENERATED ALWAYS AS (total - amount_paid) STORED, -- 欠款（自动计算）

  -- 税务明细快照（下单时冻结）
  tax_breakdown               JSONB DEFAULT '[]',
  -- 示例：[{"name":"State Tax","rate":0.06,"amount":60.00},
  --         {"name":"County Tax","rate":0.0025,"amount":2.50}]

  -- 积分
  points_earned               INT DEFAULT 0,   -- 本单赚取积分
  points_redeemed             INT DEFAULT 0,   -- 本单消耗积分

  -- 关联促销活动
  promotion_id                UUID,            -- 后续添加外键

  notes                       TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, order_number)
);
COMMENT ON TABLE orders IS 'POS订单主表 - balance_due自动计算，税务和地址信息下单时快照冻结';


-- 订单明细表
CREATE TABLE order_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES products(id),
  variant_id          UUID REFERENCES product_variants(id),
  serial_number_id    UUID REFERENCES serial_numbers(id), -- 序列号商品关联

  -- 商品信息快照（下单时冻结，防止商品改名/改价后影响历史）
  product_name        TEXT NOT NULL,
  product_sku         TEXT,
  product_type        product_type,
  serial_number       TEXT,            -- 机身号冗余存储（方便查询展示）

  -- 价格计算
  quantity            DECIMAL(10,3) NOT NULL DEFAULT 1, -- 数量（称重商品为重量）
  unit                TEXT DEFAULT 'ea',
  unit_price          DECIMAL(10,2) NOT NULL,
  original_price      DECIMAL(10,2),   -- 折扣前原价（用于展示折扣对比）
  discount_pct        DECIMAL(5,2) DEFAULT 0,   -- 单品折扣百分比
  discount_amount     DECIMAL(10,2) DEFAULT 0,  -- 单品折扣金额
  tax_amount          DECIMAL(10,2) DEFAULT 0,  -- 本行税金
  line_total          DECIMAL(10,2) NOT NULL,   -- 行合计（含税后）
  notes               TEXT
);
COMMENT ON TABLE order_items IS '订单明细表 - 商品信息快照确保历史记录不受商品修改影响';


-- 订单收款记录表（支持多种支付方式混合使用）
CREATE TABLE order_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method          pay_method NOT NULL,    -- 支付方式
  amount          DECIMAL(10,2) NOT NULL, -- 本次支付金额
  card_id         UUID,                   -- 会员卡/礼品卡支付时关联（后续添加外键）
  reference       TEXT,                   -- 参考号（支票号/卡末四位）
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE order_payments IS '订单收款记录 - 一笔订单可用多种支付方式组合（如部分现金+部分会员卡）';


-- ============================================================
-- 第8层：Invoice 开票系统
-- 支持 A4 打印和邮件发送
-- POS订单可直接转为Invoice，也可手动创建
-- ============================================================

-- Invoice 主表
CREATE TABLE invoices (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id                    UUID NOT NULL REFERENCES stores(id),
  invoice_number              TEXT NOT NULL,  -- Invoice编号，如 INV-2024-0001
  order_id                    UUID REFERENCES orders(id), -- 从POS订单生成时关联
  customer_id                 UUID REFERENCES customers(id),
  created_by                  UUID REFERENCES users(id),
  type                        invoice_type DEFAULT 'invoice',
  status                      invoice_status DEFAULT 'draft',

  -- 地址快照（发票时冻结）
  billing_address_snapshot    JSONB,   -- 账单地址
  shipping_address_snapshot   JSONB,  -- 送货地址

  -- 日期
  issue_date                  DATE NOT NULL DEFAULT CURRENT_DATE, -- 开票日期
  due_date                    DATE,           -- 付款截止日（根据账期自动计算）
  paid_date                   DATE,           -- 实际付清日期

  -- 金额
  subtotal                    DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_amount             DECIMAL(10,2) DEFAULT 0,
  tax_amount                  DECIMAL(10,2) DEFAULT 0,
  total                       DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_paid                 DECIMAL(10,2) DEFAULT 0,
  balance_due                 DECIMAL(10,2) GENERATED ALWAYS AS (total - amount_paid) STORED,

  tax_breakdown               JSONB DEFAULT '[]', -- 税务明细快照
  payment_terms               TEXT DEFAULT 'Net 30', -- 付款条件

  -- 内容
  notes                       TEXT,           -- 客户可见备注
  internal_notes              TEXT,           -- 内部备注（客户不可见）
  footer                      TEXT,           -- 底部文字

  -- 发送追踪
  sent_at                     TIMESTAMPTZ,    -- 发送给客户时间
  viewed_at                   TIMESTAMPTZ,    -- 客户查看时间
  last_reminder_sent_at       TIMESTAMPTZ,    -- 最后催款时间

  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, invoice_number)
);
COMMENT ON TABLE invoices IS 'Invoice主表 - 支持A4打印和邮件发送，追踪发送/查看/付款状态';


-- Invoice 明细表
CREATE TABLE invoice_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id),
  serial_number   TEXT,                   -- 序列号商品的机身号
  description     TEXT NOT NULL,          -- 商品/服务描述
  quantity        DECIMAL(10,3) NOT NULL DEFAULT 1,
  unit            TEXT DEFAULT 'ea',
  unit_price      DECIMAL(10,2) NOT NULL,
  discount_pct    DECIMAL(5,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  tax_group_id    UUID REFERENCES tax_groups(id),
  tax_amount      DECIMAL(10,2) DEFAULT 0,
  line_total      DECIMAL(10,2) NOT NULL,
  sort_order      INT DEFAULT 0           -- 显示顺序
);


-- Invoice 收款记录表
CREATE TABLE invoice_payments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id            UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_payment_id   UUID REFERENCES customer_payments(id), -- 关联统一付款记录
  amount                DECIMAL(10,2) NOT NULL,
  method                pay_method NOT NULL,
  reference             TEXT,
  payment_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE invoice_payments IS 'Invoice收款记录 - 支持部分付款，通过customer_payment_id关联跨单付款';


-- ============================================================
-- 第9层：营销活动管理
-- 专属营销页面，5种促销类型
-- 活动自动在POS收银时匹配生效
-- ============================================================

-- 促销活动主表
CREATE TABLE promotions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,          -- 活动名称
  description     TEXT,                   -- 活动描述
  type            promo_type NOT NULL,

  -- 时间控制
  start_date      TIMESTAMPTZ,            -- 活动开始时间
  end_date        TIMESTAMPTZ,            -- 活动结束时间
  days_of_week    INT[] DEFAULT ARRAY[0,1,2,3,4,5,6], -- 适用星期（0=周日，6=周六）
  start_time      TIME,                   -- 每天开始时间（用于时间段特价）
  end_time        TIME,                   -- 每天结束时间

  -- 适用范围
  applies_to      promo_scope DEFAULT 'all',
  category_ids    UUID[] DEFAULT ARRAY[]::UUID[], -- 指定分类
  product_ids     UUID[] DEFAULT ARRAY[]::UUID[], -- 指定商品
  customer_types  customer_type[],        -- 指定客户类型（如只对VIP生效）

  -- 简单折扣设置（product_discount 和 order_discount 使用）
  discount_type   discount_type,
  discount_value  DECIMAL(10,2),          -- 折扣值（百分比或金额）

  -- 复杂规则（JSON存储）
  rules           JSONB DEFAULT '[]',
  -- quantity_price（阶梯价）示例：
  -- [{"min_qty":1,"max_qty":1,"price":10.00},
  --  {"min_qty":2,"max_qty":3,"price":9.00},
  --  {"min_qty":4,"max_qty":null,"price":8.00}]
  --
  -- buy_get_free（买赠）示例：
  -- [{"buy_qty":2,"get_qty":1,"get_product_id":null}]
  -- get_product_id=null 表示赠送相同商品

  min_order_amount DECIMAL(10,2),         -- 满足最低金额才触发（整单折扣用）
  is_active       BOOLEAN DEFAULT true,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE promotions IS '促销活动表 - 支持阶梯价/买赠/时间段特价/单品折扣/整单折扣，POS收银时自动匹配';


-- ============================================================
-- 第10层：会员卡与礼品卡
-- 支持自定义卡号，充值面额≠支付金额（方便做充值活动）
-- 卡号可修改，余额历史完整保留
-- ============================================================

-- 卡片主表（会员卡和礼品卡共用）
CREATE TABLE member_cards (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id),  -- 发卡门店
  customer_id     UUID REFERENCES customers(id), -- 关联客户（礼品卡可为NULL）
  card_number     TEXT NOT NULL,          -- 卡号（自定义，可修改）
  type            card_type NOT NULL,     -- 会员卡/礼品卡
  status          card_status DEFAULT 'active',
  balance         DECIMAL(10,2) DEFAULT 0, -- 当前余额
  notes           TEXT,
  expires_at      TIMESTAMPTZ,            -- 过期时间（可选）
  issued_at       TIMESTAMPTZ DEFAULT NOW(),
  issued_by       UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, card_number)
);
COMMENT ON TABLE member_cards IS '会员卡/礼品卡表 - 卡号自定义可修改，余额变动通过card_transactions追踪';


-- 卡片交易记录表
-- 充值时：face_value（面值）可以大于 amount_paid（实付金额），方便做充值促销
-- 例如：充 $80，送 $100（face_value=100, amount_paid=80）
CREATE TABLE card_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  card_id         UUID NOT NULL REFERENCES member_cards(id),
  type            TEXT NOT NULL,          -- 'recharge'充值 / 'redeem'消费 / 'refund'退款 / 'adjustment'调整

  -- 充值字段（type='recharge' 时使用）
  face_value      DECIMAL(10,2),          -- 充入卡的面值（实际增加的余额）
  amount_paid     DECIMAL(10,2),          -- 客户实际支付金额（可小于face_value做促销）

  -- 消费字段（type='redeem' 时使用）
  redeem_amount   DECIMAL(10,2),          -- 本次消费金额

  -- 余额变化记录
  balance_before  DECIMAL(10,2) NOT NULL, -- 操作前余额
  balance_after   DECIMAL(10,2) NOT NULL, -- 操作后余额

  order_id        UUID REFERENCES orders(id),   -- 关联消费订单
  invoice_id      UUID REFERENCES invoices(id), -- 关联Invoice
  note            TEXT,
  processed_by    UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE card_transactions IS '卡片交易记录 - 充值支持面值≠实付（促销用），完整记录每次余额变化';


-- ============================================================
-- 第11层：积分系统
-- 自定义积分赚取和兑换规则
-- 支持不同客户类型不同积分倍率
-- ============================================================

-- 积分计划配置表（每个租户一套规则）
CREATE TABLE loyalty_programs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL DEFAULT 'Loyalty Program', -- 计划名称
  is_active             BOOLEAN DEFAULT true,

  -- 积分赚取规则（按客户类型分别设置）
  earn_rules            JSONB DEFAULT '{}',
  -- 示例：
  -- {
  --   "retail":    {"points_per_dollar": 1},
  --   "wholesale": {"points_per_dollar": 0.5},
  --   "vip":       {"points_per_dollar": 2}
  -- }
  -- 含义：零售客户消费$1赚1分，VIP消费$1赚2分

  -- 积分兑换规则
  points_per_redeem     DECIMAL(8,2) DEFAULT 100, -- 每X积分换$1折扣
  min_redeem_points     INT DEFAULT 100,           -- 最低兑换积分数
  redeem_rules          JSONB DEFAULT '{}',        -- 自定义兑换规则（扩展用）

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE loyalty_programs IS '积分计划配置 - 每租户一套，支持按客户类型设置不同积分倍率';


-- 积分交易记录表
CREATE TABLE loyalty_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id),
  type            TEXT NOT NULL,          -- 'earn'赚取 / 'redeem'兑换 / 'expire'过期 / 'adjustment'调整
  points          INT NOT NULL,           -- 积分变化量（正数=增加，负数=减少）
  balance_before  INT NOT NULL,           -- 操作前积分余额
  balance_after   INT NOT NULL,           -- 操作后积分余额
  order_id        UUID REFERENCES orders(id),
  invoice_id      UUID REFERENCES invoices(id),
  note            TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE loyalty_transactions IS '积分流水记录 - 每次积分变化（赚取/兑换/过期）完整记录';


-- ============================================================
-- 第12层：系统辅助
-- ============================================================

-- 收银班次/日结表
CREATE TABLE cash_drawers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID NOT NULL REFERENCES stores(id),
  cashier_id      UUID REFERENCES users(id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- 开班时间
  closed_at       TIMESTAMPTZ,                        -- 收班时间
  opening_amount  DECIMAL(10,2) DEFAULT 0,            -- 开班备用金
  closing_amount  DECIMAL(10,2),                      -- 收班实际现金
  expected_amount DECIMAL(10,2),                      -- 系统计算应有现金
  variance        DECIMAL(10,2),                      -- 差异（实际-应有）
  notes           TEXT
);
COMMENT ON TABLE cash_drawers IS '收银班次表 - 记录开/收班时间和现金差异，用于日结对账';


-- 操作日志表
CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id),
  store_id        UUID REFERENCES stores(id),
  action          TEXT NOT NULL,          -- 操作类型，如 'order.create' / 'invoice.send' / 'product.edit'
  entity_type     TEXT,                   -- 操作对象类型，如 'order' / 'invoice' / 'product'
  entity_id       UUID,                   -- 操作对象ID
  old_value       JSONB,                  -- 修改前的数据
  new_value       JSONB,                  -- 修改后的数据
  ip_address      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE audit_logs IS '操作日志 - 记录所有重要操作，用于追踪异常和审计';


-- ============================================================
-- 补充循环外键（之前因表顺序问题无法提前定义）
-- ============================================================

ALTER TABLE serial_numbers
  ADD CONSTRAINT fk_serial_order    FOREIGN KEY (order_id)    REFERENCES orders(id),
  ADD CONSTRAINT fk_serial_invoice  FOREIGN KEY (invoice_id)  REFERENCES invoices(id),
  ADD CONSTRAINT fk_serial_customer FOREIGN KEY (customer_id) REFERENCES customers(id);

ALTER TABLE customer_payment_allocations
  ADD CONSTRAINT fk_alloc_order   FOREIGN KEY (order_id)   REFERENCES orders(id),
  ADD CONSTRAINT fk_alloc_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id);

ALTER TABLE order_payments
  ADD CONSTRAINT fk_opay_card FOREIGN KEY (card_id) REFERENCES member_cards(id);

ALTER TABLE orders
  ADD CONSTRAINT fk_order_promo FOREIGN KEY (promotion_id) REFERENCES promotions(id);


-- ============================================================
-- 索引（查询性能优化）
-- ============================================================

-- 租户隔离索引（所有查询必须带 tenant_id）
CREATE INDEX idx_stores_tenant            ON stores(tenant_id);
CREATE INDEX idx_users_tenant             ON users(tenant_id);
CREATE INDEX idx_products_tenant          ON products(tenant_id);
CREATE INDEX idx_customers_tenant         ON customers(tenant_id);
CREATE INDEX idx_orders_tenant            ON orders(tenant_id);
CREATE INDEX idx_invoices_tenant          ON invoices(tenant_id);
CREATE INDEX idx_promotions_tenant        ON promotions(tenant_id);

-- 商品查询（扫码/SKU查找）
CREATE INDEX idx_products_barcode         ON products(tenant_id, barcode);
CREATE INDEX idx_products_sku             ON products(tenant_id, sku);
CREATE INDEX idx_products_category        ON products(category_id);
CREATE INDEX idx_products_active          ON products(tenant_id, is_active);

-- 序列号查询（机身号精确查找）
CREATE INDEX idx_serial_number            ON serial_numbers(tenant_id, serial_number);
CREATE INDEX idx_serial_status            ON serial_numbers(store_id, status);
CREATE INDEX idx_serial_product           ON serial_numbers(product_id, status);

-- 订单查询
CREATE INDEX idx_orders_customer          ON orders(customer_id);
CREATE INDEX idx_orders_status            ON orders(tenant_id, status);
CREATE INDEX idx_orders_created           ON orders(tenant_id, created_at DESC);
CREATE INDEX idx_orders_store             ON orders(store_id, created_at DESC);

-- Invoice查询（账期管理，按到期日排序）
CREATE INDEX idx_invoices_customer        ON invoices(customer_id);
CREATE INDEX idx_invoices_status          ON invoices(tenant_id, status);
CREATE INDEX idx_invoices_due_date        ON invoices(tenant_id, due_date);
CREATE INDEX idx_invoices_overdue         ON invoices(tenant_id, status, due_date) WHERE status IN ('sent','partial');

-- 客户查询
CREATE INDEX idx_customers_email          ON customers(tenant_id, email);
CREATE INDEX idx_customers_phone          ON customers(tenant_id, phone);
CREATE INDEX idx_customers_credit         ON customers(tenant_id, credit_balance) WHERE credit_balance > 0;

-- 会员卡查询（结账时快速查卡）
CREATE INDEX idx_member_cards_number      ON member_cards(tenant_id, card_number);
CREATE INDEX idx_member_cards_customer    ON member_cards(customer_id);

-- 积分查询
CREATE INDEX idx_loyalty_customer         ON loyalty_transactions(customer_id, created_at DESC);

-- 促销活动查询（POS收银时匹配活动）
CREATE INDEX idx_promotions_active        ON promotions(tenant_id, is_active, start_date, end_date);

-- 地址历史（按使用时间排序）
CREATE INDEX idx_customer_addresses       ON customer_addresses(customer_id, last_used_at DESC);

-- 日志查询
CREATE INDEX idx_audit_logs               ON audit_logs(tenant_id, created_at DESC);


-- ============================================================
-- Row Level Security（RLS）
-- 核心安全机制：确保租户只能访问自己的数据
-- ============================================================

ALTER TABLE tenants                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_groups                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE products                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE serial_numbers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payment_allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_payments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_cards                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_transactions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_programs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_drawers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                    ENABLE ROW LEVEL SECURITY;

-- 租户隔离策略（所有表都应用此策略）
-- 用户只能看到自己租户的数据
CREATE POLICY "租户数据隔离" ON orders
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- 收银员门店限制策略
-- 收银员只能看到自己门店的数据，店长和老板可以看所有门店
CREATE POLICY "收银员门店限制" ON orders
  FOR ALL USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('owner','manager')
    OR store_id = (SELECT store_id FROM users WHERE id = auth.uid())
  );


-- ============================================================
-- 触发器函数
-- ============================================================

-- 自动更新 updated_at 时间戳
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_update_updated_at IS '自动更新updated_at时间戳';

-- 绑定触发器到需要的表
CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_loyalty_programs_updated_at
  BEFORE UPDATE ON loyalty_programs FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();


-- 自动生成订单号：ORD-YYYYMMDD-XXXX
CREATE OR REPLACE FUNCTION fn_generate_order_number(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_date  TEXT := TO_CHAR(NOW(), 'YYYYMMDD');
  v_count INT;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count
  FROM orders
  WHERE tenant_id = p_tenant_id
    AND DATE(created_at) = CURRENT_DATE;
  RETURN 'ORD-' || v_date || '-' || LPAD(v_count::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_generate_order_number IS '自动生成订单号，格式：ORD-YYYYMMDD-XXXX，每天从0001重新计数';


-- 自动生成Invoice号：INV-YYYY-XXXX
CREATE OR REPLACE FUNCTION fn_generate_invoice_number(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_year  TEXT := TO_CHAR(NOW(), 'YYYY');
  v_count INT;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count
  FROM invoices
  WHERE tenant_id = p_tenant_id
    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
  RETURN 'INV-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_generate_invoice_number IS '自动生成Invoice号，格式：INV-YYYY-XXXX，每年从0001重新计数';


-- 自动生成客户编号：C-XXXX
CREATE OR REPLACE FUNCTION fn_generate_customer_code(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count
  FROM customers
  WHERE tenant_id = p_tenant_id;
  RETURN 'C-' || LPAD(v_count::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_generate_customer_code IS '自动生成客户编号，格式：C-XXXX';


-- 订单完成时自动更新客户统计数据
CREATE OR REPLACE FUNCTION fn_update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- 只在订单状态变为completed时执行
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.customer_id IS NOT NULL THEN
    UPDATE customers SET
      total_spent = total_spent + NEW.total,
      order_count = order_count + 1,
      updated_at  = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_update_customer_stats IS '订单完成时自动累加客户总消费金额和订单次数';

CREATE TRIGGER trg_order_customer_stats
  AFTER UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_update_customer_stats();


-- 销售时自动扣减库存（非序列号商品）
CREATE OR REPLACE FUNCTION fn_deduct_inventory_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  -- 序列号商品通过serial_numbers表管理，不在这里扣减
  IF NEW.product_type IN ('unit', 'weight', 'service') THEN
    UPDATE inventory SET
      quantity   = quantity - NEW.quantity,
      updated_at = NOW()
    WHERE product_id = NEW.product_id
      AND store_id   = (SELECT store_id FROM orders WHERE id = NEW.order_id)
      AND (
        (variant_id = NEW.variant_id) OR
        (variant_id IS NULL AND NEW.variant_id IS NULL)
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_deduct_inventory_on_sale IS '订单明细创建时自动扣减库存，序列号商品除外';

CREATE TRIGGER trg_inventory_on_sale
  AFTER INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION fn_deduct_inventory_on_sale();


-- 序列号售出时自动更新状态
CREATE OR REPLACE FUNCTION fn_update_serial_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  -- 当order_items插入序列号商品时，自动将该序列号标记为已售
  IF NEW.serial_number_id IS NOT NULL THEN
    UPDATE serial_numbers SET
      status      = 'sold',
      sold_at     = NOW(),
      order_id    = NEW.order_id,
      customer_id = (SELECT customer_id FROM orders WHERE id = NEW.order_id),
      sold_price  = NEW.unit_price,
      sold_by     = (SELECT cashier_id FROM orders WHERE id = NEW.order_id)
    WHERE id = NEW.serial_number_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_update_serial_on_sale IS '序列号商品售出时自动更新序列号状态为sold，并记录销售信息';

CREATE TRIGGER trg_serial_on_sale
  AFTER INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION fn_update_serial_on_sale();


-- 付款时自动更新订单已付金额
CREATE OR REPLACE FUNCTION fn_update_order_paid()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE orders SET
    amount_paid = (
      SELECT COALESCE(SUM(amount), 0)
      FROM order_payments
      WHERE order_id = NEW.order_id
    ),
    updated_at = NOW()
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_update_order_paid IS '收款记录创建时自动汇总更新订单的已付金额';

CREATE TRIGGER trg_order_paid_update
  AFTER INSERT ON order_payments
  FOR EACH ROW EXECUTE FUNCTION fn_update_order_paid();


-- Invoice付款时自动更新已付金额
CREATE OR REPLACE FUNCTION fn_update_invoice_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_total_paid DECIMAL(10,2);
  v_total      DECIMAL(10,2);
  v_new_status invoice_status;
BEGIN
  -- 汇总已付金额
  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM invoice_payments WHERE invoice_id = NEW.invoice_id;

  SELECT total INTO v_total FROM invoices WHERE id = NEW.invoice_id;

  -- 自动判断状态
  IF v_total_paid >= v_total THEN
    v_new_status := 'paid';
  ELSIF v_total_paid > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'sent';
  END IF;

  UPDATE invoices SET
    amount_paid = v_total_paid,
    status      = v_new_status,
    paid_date   = CASE WHEN v_new_status = 'paid' THEN CURRENT_DATE ELSE NULL END,
    updated_at  = NOW()
  WHERE id = NEW.invoice_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION fn_update_invoice_paid IS 'Invoice付款时自动更新已付金额和状态（sent/partial/paid）';

CREATE TRIGGER trg_invoice_paid_update
  AFTER INSERT ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION fn_update_invoice_paid();


-- ============================================================
-- 初始化种子数据（演示用）
-- ============================================================

-- 说明：实际部署时通过注册流程自动创建租户和默认数据
-- 以下为开发测试用的演示数据结构说明

-- 新租户注册时自动创建：
-- 1. tenants 记录
-- 2. 默认 stores 记录（第一家门店）
-- 3. 默认 tax_groups（根据选择的州）
-- 4. 默认 categories（Electronics/Produce/General）
-- 5. 默认 loyalty_programs 配置
-- 6. owner 用户账号

-- ============================================================
-- 完成
-- 共计30张表，覆盖：
-- 租户/门店/员工 | 税务 | 商品/库存/序列号
-- 采购 | 客户/地址/账期/付款
-- POS订单 | Invoice | 营销促销
-- 会员卡/礼品卡 | 积分 | 系统日志
-- ============================================================
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
-- ============================================================
-- RetailPOS — 终端管理 + PAX 刷卡机配置
-- 在 Supabase SQL Editor 执行
-- ============================================================

-- ── 1. 终端注册表 ──
CREATE TABLE IF NOT EXISTS terminals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  name                TEXT NOT NULL,              -- "Terminal 1" / "Front Counter"
  device_fingerprint  TEXT,                       -- 浏览器指纹，用于自动识别设备

  -- PAX 刷卡机配置（每台机器独立）
  pax_ip              TEXT,                       -- PAX 机器局域网 IP，如 192.168.1.50
  pax_port            INTEGER DEFAULT 10009,      -- PAX 默认端口
  pax_model           TEXT,                       -- 'A920' | 'A80' | 'S300' | 'E600' 等
  pax_enabled         BOOLEAN DEFAULT false,      -- 是否启用 PAX 刷卡

  -- 每台终端的支付方式配置
  accept_cash         BOOLEAN DEFAULT true,
  accept_card         BOOLEAN DEFAULT true,       -- 通过 PAX
  accept_check        BOOLEAN DEFAULT true,
  accept_member_card  BOOLEAN DEFAULT true,
  accept_on_account   BOOLEAN DEFAULT true,

  -- 当前状态
  is_active           BOOLEAN DEFAULT true,
  last_seen_at        TIMESTAMPTZ,
  current_cashier_id  UUID REFERENCES users(id),

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE terminals IS '收银终端表 - 每台机器独立注册，含PAX刷卡机IP配置';
COMMENT ON COLUMN terminals.pax_ip IS 'PAX机器的局域网IP地址，收银机直接HTTP调用此IP发起刷卡';
COMMENT ON COLUMN terminals.pax_port IS 'PAX HTTP端口，默认10009';
COMMENT ON COLUMN terminals.device_fingerprint IS '浏览器指纹，开机时自动匹配已注册终端';

-- ── 2. cash_drawers 加 terminal_id ──
ALTER TABLE cash_drawers ADD COLUMN IF NOT EXISTS terminal_id UUID REFERENCES terminals(id);
ALTER TABLE cash_drawers ADD COLUMN IF NOT EXISTS terminal_name TEXT; -- 冗余字段，报表用

-- ── 3. orders 记录来自哪台终端 ──
-- （terminal_id 已在 concurrency patch 里加了，这里加 terminal_name 冗余字段方便报表）
ALTER TABLE orders ADD COLUMN IF NOT EXISTS terminal_name TEXT;

-- ── 4. RLS ──
ALTER TABLE terminals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation on terminals"
  ON terminals FOR ALL
  USING (tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- ── 5. 更新时间触发器 ──
CREATE TRIGGER trg_terminals_updated_at
  BEFORE UPDATE ON terminals
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- ── 6. 终端心跳更新函数（每60秒调一次，记录在线状态）──
CREATE OR REPLACE FUNCTION fn_terminal_heartbeat(
  p_terminal_id UUID,
  p_cashier_id  UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE terminals
  SET
    last_seen_at       = NOW(),
    current_cashier_id = COALESCE(p_cashier_id, current_cashier_id)
  WHERE id = p_terminal_id;
END;
$$;

SELECT 'Terminals patch applied' AS status;
-- ============================================================
-- RetailPOS — 平台管理补丁
-- 套餐配额 + Session互踢 + Impersonation日志 + 代理商预留
-- 在 Supabase SQL Editor 执行
-- ============================================================

-- ── 1. 套餐定义表（你随时可以改价格和配额）──
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,           -- 'solo' | 'team' | 'pro' | 'custom'
  name            TEXT NOT NULL,              -- 显示名称
  max_users       INTEGER NOT NULL,           -- 最大账号数
  max_terminals   INTEGER NOT NULL,           -- 最大终端数
  price_monthly   DECIMAL(10,2) NOT NULL,     -- 月价格（美元）
  price_yearly    DECIMAL(10,2),              -- 年价格（可选）
  features        JSONB DEFAULT '{}',         -- 功能开关，预留扩展
  is_active       BOOLEAN DEFAULT true,       -- 是否在前台展示
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO plans (id, name, max_users, max_terminals, price_monthly, price_yearly, sort_order)
VALUES
  ('solo',   'Solo',   1,  1,  29.00,  290.00, 1),
  ('team',   'Team',   3,  3,  79.00,  790.00, 2),
  ('pro',    'Pro',    6,  6, 149.00, 1490.00, 3),
  ('custom', 'Custom', 0,  0,   0.00,    0.00, 4)  -- 0 = 无限制，你手动设置
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE plans IS '套餐定义 - 你可以随时改价格和配额，立即生效';
COMMENT ON COLUMN plans.max_users IS '0 = 无限制（Custom套餐用）';
COMMENT ON COLUMN plans.max_terminals IS '0 = 无限制';

-- ── 2. tenants 表补充字段 ──
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_id          TEXT REFERENCES plans(id) DEFAULT 'solo';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_users        INTEGER DEFAULT 1;   -- 实际生效配额（覆盖套餐默认值）
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_terminals    INTEGER DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_suspended     BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notes            TEXT;               -- 平台备注（售后用）
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reseller_id      UUID;               -- 代理商ID（预留）
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS activated_at     TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days';

-- ── 3. 平台超级管理员表 ──
-- 与普通用户完全分离，不在 users 表里
CREATE TABLE IF NOT EXISTS platform_admins (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  password_hash TEXT,                         -- bcrypt，Supabase Auth管理
  role         TEXT DEFAULT 'admin',          -- 'super_admin' | 'admin' | 'support'
  reseller_id  UUID,                          -- 代理商绑定（预留）
  is_active    BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE platform_admins IS '平台管理员 - 与商家账号完全分离，不受RLS限制';

-- ── 4. 代理商表（预留，先建结构不做功能）──
CREATE TABLE IF NOT EXISTS resellers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  commission_pct DECIMAL(5,2) DEFAULT 0,      -- 佣金比例
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE resellers IS '代理商表 - 预留结构，暂不启用功能';

-- ── 5. 活跃 Session 表（用于互踢逻辑）──
CREATE TABLE IF NOT EXISTS active_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terminal_id   UUID REFERENCES terminals(id) ON DELETE SET NULL,
  terminal_name TEXT,
  session_token TEXT NOT NULL UNIQUE,         -- 随机token，登录时生成
  ip_address    TEXT,
  user_agent    TEXT,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '12 hours'
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user
  ON active_sessions(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_expires
  ON active_sessions(expires_at);

COMMENT ON TABLE active_sessions IS '活跃会话表 - 用于检测同一账号多处登录，实现互踢';

-- ── 6. Impersonation 日志（平台登录商家的记录）──
CREATE TABLE IF NOT EXISTS impersonation_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id),
  platform_admin_name TEXT,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_name     TEXT,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  duration_seconds INTEGER,
  actions_taken   JSONB DEFAULT '[]',         -- 记录做了什么操作
  reason          TEXT                        -- 售后原因备注
);

COMMENT ON TABLE impersonation_logs IS '平台模拟登录日志 - 记录平台人员进入商家账号的所有操作';

-- ── 7. 平台操作日志 ──
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         UUID REFERENCES platform_admins(id),
  action           TEXT NOT NULL,             -- 'tenant.create' | 'tenant.suspend' | 'quota.change' 等
  target_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  details          JSONB DEFAULT '{}',
  ip_address       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. 配额检查函数 ──

-- 检查是否可以创建新用户
CREATE OR REPLACE FUNCTION fn_check_user_quota(p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_tenant   tenants%ROWTYPE;
  v_plan     plans%ROWTYPE;
  v_count    INTEGER;
  v_max      INTEGER;
BEGIN
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  SELECT * INTO v_plan   FROM plans   WHERE id = v_tenant.plan_id;

  -- 实际配额：tenant.max_users 覆盖套餐默认（0=无限制）
  v_max := COALESCE(
    NULLIF(v_tenant.max_users, 0),
    NULLIF(v_plan.max_users, 0),
    999999
  );

  SELECT COUNT(*) INTO v_count
  FROM users
  WHERE tenant_id = p_tenant_id AND is_active = true;

  IF v_count >= v_max THEN
    RETURN jsonb_build_object(
      'allowed',  false,
      'current',  v_count,
      'max',      v_max,
      'plan',     v_tenant.plan_id,
      'message',  'User limit reached (' || v_count || '/' || v_max || '). Please upgrade your plan.'
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'current', v_count, 'max', v_max);
END;
$$;

-- 检查是否可以注册新终端
CREATE OR REPLACE FUNCTION fn_check_terminal_quota(p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_tenant   tenants%ROWTYPE;
  v_plan     plans%ROWTYPE;
  v_count    INTEGER;
  v_max      INTEGER;
BEGIN
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  SELECT * INTO v_plan   FROM plans   WHERE id = v_tenant.plan_id;

  v_max := COALESCE(
    NULLIF(v_tenant.max_terminals, 0),
    NULLIF(v_plan.max_terminals, 0),
    999999
  );

  SELECT COUNT(*) INTO v_count
  FROM terminals
  WHERE tenant_id = p_tenant_id AND is_active = true;

  IF v_count >= v_max THEN
    RETURN jsonb_build_object(
      'allowed',  false,
      'current',  v_count,
      'max',      v_max,
      'plan',     v_tenant.plan_id,
      'message',  'Terminal limit reached (' || v_count || '/' || v_max || '). Please upgrade your plan.'
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'current', v_count, 'max', v_max);
END;
$$;

-- ── 9. 立即更新配额的函数（平台后台调用）──
CREATE OR REPLACE FUNCTION fn_platform_update_quota(
  p_tenant_id    UUID,
  p_plan_id      TEXT DEFAULT NULL,
  p_max_users    INTEGER DEFAULT NULL,
  p_max_terminals INTEGER DEFAULT NULL,
  p_admin_id     UUID DEFAULT NULL,
  p_reason       TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tenants SET
    plan_id       = COALESCE(p_plan_id,       plan_id),
    max_users     = COALESCE(p_max_users,     max_users),
    max_terminals = COALESCE(p_max_terminals, max_terminals),
    updated_at    = NOW()
  WHERE id = p_tenant_id;

  -- 记录平台操作日志
  INSERT INTO platform_audit_logs (admin_id, action, target_tenant_id, details)
  VALUES (p_admin_id, 'quota.update', p_tenant_id, jsonb_build_object(
    'plan_id',       p_plan_id,
    'max_users',     p_max_users,
    'max_terminals', p_max_terminals,
    'reason',        p_reason
  ));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── 10. Session 检查函数（登录时调用）──
CREATE OR REPLACE FUNCTION fn_check_session_conflict(
  p_user_id     UUID,
  p_tenant_id   UUID,
  p_new_token   TEXT,
  p_terminal_name TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_existing active_sessions%ROWTYPE;
BEGIN
  -- 清理过期 session
  DELETE FROM active_sessions WHERE expires_at < NOW();

  -- 查找该用户的活跃 session
  SELECT * INTO v_existing
  FROM active_sessions
  WHERE user_id   = p_user_id
    AND tenant_id = p_tenant_id
    AND expires_at > NOW()
  ORDER BY last_active_at DESC
  LIMIT 1;

  IF FOUND THEN
    -- 有冲突，返回冲突信息给前端决定
    RETURN jsonb_build_object(
      'conflict',       true,
      'existing_terminal', COALESCE(v_existing.terminal_name, 'Unknown terminal'),
      'last_active_at', v_existing.last_active_at,
      'session_id',     v_existing.id
    );
  END IF;

  -- 没有冲突，创建新 session
  INSERT INTO active_sessions
    (tenant_id, user_id, session_token, terminal_name)
  VALUES
    (p_tenant_id, p_user_id, p_new_token, p_terminal_name);

  RETURN jsonb_build_object('conflict', false);
END;
$$;

-- 踢掉旧 session（用户确认后调用）
CREATE OR REPLACE FUNCTION fn_kick_session(
  p_session_id UUID,
  p_user_id    UUID,
  p_new_token  TEXT,
  p_tenant_id  UUID,
  p_terminal_name TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  -- 删除旧 session
  DELETE FROM active_sessions WHERE id = p_session_id AND user_id = p_user_id;

  -- 创建新 session
  INSERT INTO active_sessions
    (tenant_id, user_id, session_token, terminal_name)
  VALUES
    (p_tenant_id, p_user_id, p_new_token, p_terminal_name);
END;
$$;

-- 登出时清理 session
CREATE OR REPLACE FUNCTION fn_end_session(p_session_token TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM active_sessions WHERE session_token = p_session_token;
END;
$$;

-- ── RLS ──
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own sessions"
  ON active_sessions FOR ALL
  USING (user_id = auth.uid());

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans are public readable"
  ON plans FOR SELECT USING (true);

SELECT 'Platform patch applied successfully' AS status;
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
