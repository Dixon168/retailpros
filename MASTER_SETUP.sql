-- ============================================================
-- RetailPOS — MASTER SQL SETUP (FIXED VERSION)
-- Run this ONCE in Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enum types ──
DO $$ BEGIN
  CREATE TYPE plan_type        AS ENUM ('starter','business','enterprise');
  CREATE TYPE plan_status_type AS ENUM ('trial','active','suspended','cancelled');
  CREATE TYPE user_role        AS ENUM ('owner','manager','cashier');
  CREATE TYPE product_type     AS ENUM ('unit','weight','serialized','service');
  CREATE TYPE serial_status    AS ENUM ('in_stock','sold','returned','damaged');
  CREATE TYPE po_status        AS ENUM ('draft','ordered','partial','received','cancelled');
  CREATE TYPE customer_type    AS ENUM ('retail','wholesale','vip');
  CREATE TYPE billing_cycle    AS ENUM ('net15','net30','net60');
  CREATE TYPE order_status     AS ENUM ('open','completed','refunded','voided');
  CREATE TYPE pay_method       AS ENUM ('cash','card','check','bank_transfer','member_card','gift_card','on_account','other');
  CREATE TYPE b2c_tier         AS ENUM ('regular','silver','gold','vip');
  CREATE TYPE b2b_tier         AS ENUM ('standard','wholesale','preferred','contract');
  CREATE TYPE card_tx_status   AS ENUM ('authorized','captured','settled','voided','refunded','partially_refunded','declined');
  CREATE TYPE refund_mode      AS ENUM ('free','scan','by_order');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── updated_at trigger function ──
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                   TEXT NOT NULL,
  email                  TEXT,
  phone                  TEXT,
  plan_id                TEXT DEFAULT 'solo',
  plan                   plan_type DEFAULT 'starter',
  plan_status            plan_status_type DEFAULT 'trial',
  max_users              INTEGER DEFAULT 1,
  max_terminals          INTEGER DEFAULT 1,
  is_suspended           BOOLEAN DEFAULT false,
  suspended_reason       TEXT,
  notes                  TEXT,
  reseller_id            UUID,
  activated_at           TIMESTAMPTZ,
  trial_ends_at          TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  country     TEXT DEFAULT 'US',
  phone       TEXT,
  email       TEXT,
  tax_id      TEXT,
  receipt_header TEXT,
  receipt_footer TEXT DEFAULT 'Thank you for your business!',
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id    UUID REFERENCES stores(id),
  name        TEXT NOT NULL,
  email       TEXT,
  role        user_role DEFAULT 'cashier',
  pin         TEXT,
  permissions JSONB DEFAULT '{}',
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Terminals (must be before orders) ──
CREATE TABLE IF NOT EXISTS terminals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  device_fingerprint  TEXT,
  pax_ip              TEXT,
  pax_port            INTEGER DEFAULT 10009,
  pax_model           TEXT,
  pax_enabled         BOOLEAN DEFAULT false,
  accept_cash         BOOLEAN DEFAULT true,
  accept_card         BOOLEAN DEFAULT true,
  accept_check        BOOLEAN DEFAULT true,
  accept_member_card  BOOLEAN DEFAULT true,
  accept_on_account   BOOLEAN DEFAULT true,
  is_active           BOOLEAN DEFAULT true,
  last_seen_at        TIMESTAMPTZ,
  current_cashier_id  UUID,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tax_groups (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  state      TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tax_rates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tax_group_id UUID REFERENCES tax_groups(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  rate         DECIMAL(8,6) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES categories(id),
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id     UUID REFERENCES stores(id),
  category_id  UUID REFERENCES categories(id),
  name         TEXT NOT NULL,
  sku          TEXT,
  barcode      TEXT,
  description  TEXT,
  type         product_type DEFAULT 'unit',
  unit         TEXT DEFAULT 'ea',
  price        DECIMAL(10,2) NOT NULL DEFAULT 0,
  cost         DECIMAL(10,2) DEFAULT 0,
  tax_group_id UUID REFERENCES tax_groups(id),
  track_inventory BOOLEAN DEFAULT true,
  is_active    BOOLEAN DEFAULT true,
  emoji        TEXT DEFAULT '📦',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS inventory (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id    UUID REFERENCES stores(id),
  quantity    DECIMAL(10,3) DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 5,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS serial_numbers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  serial      TEXT NOT NULL,
  status      serial_status DEFAULT 'in_stock',
  order_id    UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, product_id, serial)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  address    TEXT,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id     UUID REFERENCES stores(id),
  supplier_id  UUID REFERENCES suppliers(id),
  po_number    TEXT NOT NULL,
  status       po_status DEFAULT 'draft',
  total        DECIMAL(10,2) DEFAULT 0,
  notes        TEXT,
  ordered_at   TIMESTAMPTZ,
  received_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_id       UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity    DECIMAL(10,3) NOT NULL,
  unit_cost   DECIMAL(10,2) NOT NULL,
  received    DECIMAL(10,3) DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── B2C Retail Customers ──
CREATE TABLE IF NOT EXISTS customers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code             TEXT,
  name             TEXT NOT NULL,
  email            TEXT,
  phone            TEXT,
  address          TEXT,
  city             TEXT,
  state            TEXT,
  zip              TEXT,
  type             customer_type DEFAULT 'retail',
  tier             b2c_tier DEFAULT 'regular',
  tier_discount    DECIMAL(5,4) DEFAULT 1.0000,
  loyalty_points   INTEGER DEFAULT 0,
  total_spent      DECIMAL(10,2) DEFAULT 0,
  order_count      INTEGER DEFAULT 0,
  credit_enabled   BOOLEAN DEFAULT false,
  credit_limit     DECIMAL(10,2) DEFAULT 0,
  credit_balance   DECIMAL(10,2) DEFAULT 0,
  notes            TEXT,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

-- ── B2B Business Customers ──
CREATE TABLE IF NOT EXISTS business_customers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code             TEXT,
  company_name     TEXT NOT NULL,
  trade_name       TEXT,
  tax_id           TEXT,
  contact_name     TEXT NOT NULL,
  contact_email    TEXT,
  contact_phone    TEXT,
  contact_mobile   TEXT,
  billing_address  TEXT,
  billing_city     TEXT,
  billing_state    TEXT,
  billing_zip      TEXT,
  billing_country  TEXT DEFAULT 'US',
  payment_terms    TEXT DEFAULT 'net30',
  credit_enabled   BOOLEAN DEFAULT true,
  credit_limit     DECIMAL(10,2) DEFAULT 0,
  credit_balance   DECIMAL(10,2) DEFAULT 0,
  tier             b2b_tier DEFAULT 'standard',
  tier_discount    DECIMAL(5,4) DEFAULT 1.0000,
  custom_discount  DECIMAL(5,4),
  ar_email         TEXT,
  reminder_days_before INTEGER DEFAULT 7,
  total_spent      DECIMAL(10,2) DEFAULT 0,
  invoice_count    INTEGER DEFAULT 0,
  overdue_amount   DECIMAL(10,2) DEFAULT 0,
  is_active        BOOLEAN DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS business_contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id     UUID NOT NULL REFERENCES business_customers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  title           TEXT,
  email           TEXT,
  phone           TEXT,
  role            TEXT DEFAULT 'contact',
  is_primary      BOOLEAN DEFAULT false,
  receive_invoice BOOLEAN DEFAULT false,
  receive_reminder BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_addresses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES business_customers(id) ON DELETE CASCADE,
  label         TEXT,
  address       TEXT NOT NULL,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  country       TEXT DEFAULT 'US',
  contact_name  TEXT,
  contact_phone TEXT,
  is_default    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Orders (terminal_id included from start) ──
CREATE TABLE IF NOT EXISTS orders (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id                  UUID NOT NULL REFERENCES stores(id),
  order_number              TEXT NOT NULL,
  customer_id               UUID REFERENCES customers(id),
  cashier_id                UUID REFERENCES users(id),
  terminal_id               UUID REFERENCES terminals(id),
  terminal_name             TEXT,
  status                    order_status DEFAULT 'open',
  status_ext                TEXT DEFAULT 'completed',
  shipping_address_snapshot JSONB,
  subtotal                  DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_amount           DECIMAL(10,2) DEFAULT 0,
  tax_amount                DECIMAL(10,2) DEFAULT 0,
  total                     DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_paid               DECIMAL(10,2) DEFAULT 0,
  balance_due               DECIMAL(10,2) GENERATED ALWAYS AS (total - amount_paid) STORED,
  tax_breakdown             JSONB DEFAULT '[]',
  points_earned             INT DEFAULT 0,
  points_redeemed           INT DEFAULT 0,
  promotion_id              UUID,
  recharge_amount           DECIMAL(10,2) DEFAULT 0,
  refunded_amount           DECIMAL(10,2) DEFAULT 0,
  notes                     TEXT,
  version                   INTEGER NOT NULL DEFAULT 1,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, order_number)
);

CREATE TABLE IF NOT EXISTS order_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_sku  TEXT,
  product_type product_type DEFAULT 'unit',
  serial_number TEXT,
  quantity     DECIMAL(10,3) NOT NULL,
  unit         TEXT DEFAULT 'ea',
  unit_price   DECIMAL(10,2) NOT NULL,
  discount_pct DECIMAL(5,2) DEFAULT 0,
  line_total   DECIMAL(10,2) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_payments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method     pay_method NOT NULL,
  amount     DECIMAL(10,2) NOT NULL,
  reference  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Invoices ──
CREATE TABLE IF NOT EXISTS invoices (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id             UUID REFERENCES stores(id),
  business_customer_id UUID REFERENCES business_customers(id) ON DELETE SET NULL,
  invoice_number       TEXT NOT NULL,
  status               TEXT DEFAULT 'draft',
  due_date             DATE,
  subtotal             DECIMAL(10,2) DEFAULT 0,
  tax_amount           DECIMAL(10,2) DEFAULT 0,
  discount_amount      DECIMAL(10,2) DEFAULT 0,
  total                DECIMAL(10,2) DEFAULT 0,
  amount_paid          DECIMAL(10,2) DEFAULT 0,
  balance_due          DECIMAL(10,2) DEFAULT 0,
  billing_address_snapshot JSONB,
  shipping_address_snapshot JSONB,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity     DECIMAL(10,3) NOT NULL,
  unit         TEXT DEFAULT 'ea',
  unit_price   DECIMAL(10,2) NOT NULL,
  line_total   DECIMAL(10,2) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method     TEXT NOT NULL,
  amount     DECIMAL(10,2) NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Promotions ──
CREATE TABLE IF NOT EXISTS promotions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  value           DECIMAL(10,2),
  min_amount      DECIMAL(10,2),
  stackable       BOOLEAN DEFAULT false,
  stack_priority  TEXT DEFAULT 'promo_first',
  applies_to_b2c  BOOLEAN DEFAULT true,
  applies_to_b2b  BOOLEAN DEFAULT false,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Loyalty ──
CREATE TABLE IF NOT EXISTS member_cards (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  card_number     TEXT NOT NULL,
  card_type       TEXT DEFAULT 'member',
  balance         DECIMAL(10,2) DEFAULT 0,
  points          INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, card_number)
);

CREATE TABLE IF NOT EXISTS loyalty_programs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  points_per_dollar DECIMAL(10,4) DEFAULT 1,
  redemption_rate DECIMAL(10,4) DEFAULT 0.01,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  order_id    UUID REFERENCES orders(id),
  type        TEXT NOT NULL,
  points      INTEGER NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Cash Drawers ──
CREATE TABLE IF NOT EXISTS cash_drawers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id),
  terminal_id     UUID REFERENCES terminals(id),
  terminal_name   TEXT,
  cashier_id      UUID REFERENCES users(id),
  opening_amount  DECIMAL(10,2) DEFAULT 0,
  closing_amount  DECIMAL(10,2),
  expected_amount DECIMAL(10,2),
  variance        DECIMAL(10,2),
  opened_at       TIMESTAMPTZ DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Audit Logs ──
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id),
  action     TEXT NOT NULL,
  table_name TEXT,
  record_id  UUID,
  old_data   JSONB,
  new_data   JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Resource Locks (concurrency) ──
CREATE TABLE IF NOT EXISTS resource_locks (
  resource_key  TEXT PRIMARY KEY,
  locked_by     TEXT NOT NULL,
  locked_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 seconds'
);

-- ── Plans ──
CREATE TABLE IF NOT EXISTS plans (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  max_users      INTEGER NOT NULL,
  max_terminals  INTEGER NOT NULL,
  price_monthly  DECIMAL(10,2) NOT NULL,
  price_yearly   DECIMAL(10,2),
  features       JSONB DEFAULT '{}',
  is_active      BOOLEAN DEFAULT true,
  sort_order     INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO plans (id, name, max_users, max_terminals, price_monthly, price_yearly, sort_order)
VALUES
  ('solo',   'Solo',   1, 1,  29.00,  290.00, 1),
  ('team',   'Team',   3, 3,  79.00,  790.00, 2),
  ('pro',    'Pro',    6, 6, 149.00, 1490.00, 3),
  ('custom', 'Custom', 0, 0,   0.00,    0.00, 4)
ON CONFLICT (id) DO NOTHING;

-- ── Platform Admins ──
CREATE TABLE IF NOT EXISTS platform_admins (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT DEFAULT 'admin',
  reseller_id   UUID,
  is_active     BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Resellers ──
CREATE TABLE IF NOT EXISTS resellers (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  commission_pct DECIMAL(5,2) DEFAULT 0,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Active Sessions ──
CREATE TABLE IF NOT EXISTS active_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terminal_id     UUID REFERENCES terminals(id) ON DELETE SET NULL,
  terminal_name   TEXT,
  session_token   TEXT NOT NULL UNIQUE,
  ip_address      TEXT,
  last_active_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '12 hours'
);

-- ── Impersonation Logs ──
CREATE TABLE IF NOT EXISTS impersonation_logs (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_admin_id    UUID REFERENCES platform_admins(id),
  platform_admin_name  TEXT,
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_name          TEXT,
  started_at           TIMESTAMPTZ DEFAULT NOW(),
  ended_at             TIMESTAMPTZ,
  duration_seconds     INTEGER,
  reason               TEXT
);

-- ── Platform Audit Logs ──
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id         UUID REFERENCES platform_admins(id),
  action           TEXT NOT NULL,
  target_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  details          JSONB DEFAULT '{}',
  ip_address       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Discount Tiers ──
CREATE TABLE IF NOT EXISTS discount_tiers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_type TEXT NOT NULL,
  tier_key      TEXT NOT NULL,
  tier_name     TEXT NOT NULL,
  discount_rate DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
  color         TEXT DEFAULT '#3b82f6',
  sort_order    INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, customer_type, tier_key)
);

-- ── Payment Configs ──
CREATE TABLE IF NOT EXISTS payment_configs (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  cp_merchant_id           TEXT,
  cp_username              TEXT,
  cp_password              TEXT,
  cp_endpoint              TEXT DEFAULT 'https://fts.cardconnect.com',
  cp_hsn                   TEXT,
  is_configured            BOOLEAN DEFAULT false,
  configured_at            TIMESTAMPTZ,
  configured_by            UUID,
  refund_days_limit        INTEGER DEFAULT NULL,
  require_pin_for_refund   BOOLEAN DEFAULT true,
  require_pin_for_void     BOOLEAN DEFAULT true,
  auto_batch_close         BOOLEAN DEFAULT true,
  auto_batch_close_time    TEXT DEFAULT '02:00',
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- ── Platform Payment Config ──
CREATE TABLE IF NOT EXISTS platform_payment_config (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cp_merchant_id TEXT,
  cp_username    TEXT,
  cp_password    TEXT,
  cp_endpoint    TEXT DEFAULT 'https://fts.cardconnect.com',
  is_live        BOOLEAN DEFAULT false,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO platform_payment_config (id) VALUES (uuid_generate_v4()) ON CONFLICT DO NOTHING;

-- ── Card Transactions ──
CREATE TABLE IF NOT EXISTS card_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id),
  terminal_id     UUID REFERENCES terminals(id),
  terminal_name   TEXT,
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_number    TEXT,
  invoice_id      UUID REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_number  TEXT,
  batch_id        UUID,
  cp_retref       TEXT,
  cp_authcode     TEXT,
  cp_resptext     TEXT,
  cp_respcode     TEXT,
  cp_token        TEXT,
  card_type       TEXT,
  masked_pan      TEXT,
  card_holder     TEXT,
  entry_mode      TEXT,
  amount          DECIMAL(10,2) NOT NULL,
  tip_amount      DECIMAL(10,2) DEFAULT 0,
  refunded_amount DECIMAL(10,2) DEFAULT 0,
  status          card_tx_status DEFAULT 'authorized',
  created_by      UUID REFERENCES users(id),
  voided_by       UUID REFERENCES users(id),
  voided_by_name  TEXT,
  authorized_by   UUID REFERENCES users(id),
  authorized_by_name TEXT,
  authorized_at   TIMESTAMPTZ DEFAULT NOW(),
  settled_at      TIMESTAMPTZ,
  voided_at       TIMESTAMPTZ,
  receipt_printed BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Refund Records ──
CREATE TABLE IF NOT EXISTS refund_records (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  terminal_id           UUID REFERENCES terminals(id),
  terminal_name         TEXT,
  original_order_id     UUID REFERENCES orders(id) ON DELETE SET NULL,
  original_order_number TEXT,
  refund_order_id       UUID REFERENCES orders(id) ON DELETE SET NULL,
  card_tx_id            UUID REFERENCES card_transactions(id) ON DELETE SET NULL,
  original_card_tx_id   UUID REFERENCES card_transactions(id) ON DELETE SET NULL,
  mode                  refund_mode NOT NULL,
  amount                DECIMAL(10,2) NOT NULL,
  reason                TEXT,
  items                 JSONB DEFAULT '[]',
  refunded_by           UUID REFERENCES users(id),
  refunded_by_name      TEXT,
  authorized_by         UUID REFERENCES users(id),
  authorized_by_name    TEXT,
  cp_retref             TEXT,
  cp_authcode           TEXT,
  receipt_printed       BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── Batch Closes ──
CREATE TABLE IF NOT EXISTS batch_closes (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  terminal_id        UUID REFERENCES terminals(id),
  terminal_name      TEXT,
  batch_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  triggered_by       TEXT DEFAULT 'auto',
  triggered_by_user  UUID REFERENCES users(id),
  triggered_by_name  TEXT,
  cp_batchid         TEXT,
  cp_resptext        TEXT,
  total_sales        DECIMAL(10,2) DEFAULT 0,
  total_refunds      DECIMAL(10,2) DEFAULT 0,
  total_voids        DECIMAL(10,2) DEFAULT 0,
  net_amount         DECIMAL(10,2) DEFAULT 0,
  transaction_count  INTEGER DEFAULT 0,
  status             TEXT DEFAULT 'success',
  error_message      TEXT,
  receipt_printed    BOOLEAN DEFAULT false,
  closed_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── Held Orders ──
CREATE TABLE IF NOT EXISTS held_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id),
  terminal_id     UUID REFERENCES terminals(id),
  terminal_name   TEXT,
  label           TEXT,
  held_by         UUID REFERENCES users(id),
  held_by_name    TEXT,
  held_at         TIMESTAMPTZ DEFAULT NOW(),
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   TEXT,
  cart_snapshot   JSONB NOT NULL DEFAULT '{}',
  subtotal        DECIMAL(10,2) DEFAULT 0,
  total           DECIMAL(10,2) DEFAULT 0,
  item_count      INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'held',
  resumed_at      TIMESTAMPTZ,
  resumed_by      UUID REFERENCES users(id),
  resumed_terminal_id UUID REFERENCES terminals(id),
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Subscription Payments ──
CREATE TABLE IF NOT EXISTS subscription_payments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id        TEXT REFERENCES plans(id),
  amount         DECIMAL(10,2) NOT NULL,
  billing_period TEXT,
  cp_retref      TEXT,
  cp_token       TEXT,
  masked_pan     TEXT,
  card_type      TEXT,
  status         TEXT DEFAULT 'success',
  failure_reason TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tenant Payment Methods ──
CREATE TABLE IF NOT EXISTS tenant_payment_methods (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  cp_token    TEXT NOT NULL,
  masked_pan  TEXT,
  card_type   TEXT,
  expiry      TEXT,
  card_holder TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_products_tenant    ON products(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_orders_tenant      ON orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_terminal    ON orders(terminal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_tenant   ON customers(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_card_tx_tenant     ON card_transactions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_tx_order      ON card_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_card_tx_terminal   ON card_transactions(terminal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_tx_status     ON card_transactions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_held_orders_tenant ON held_orders(tenant_id, status, held_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_closes_tenant ON batch_closes(tenant_id, batch_date DESC);
CREATE INDEX IF NOT EXISTS idx_batch_closes_term   ON batch_closes(terminal_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id, tenant_id);

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['tenants','stores','users','products','orders',
    'invoices','business_customers','payment_configs','card_transactions',
    'terminals','cash_drawers'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()', t, t);
  END LOOP;
END $$;

-- ── Auto-generate customer code ──
CREATE OR REPLACE FUNCTION fn_generate_customer_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 3) AS INTEGER)), 0) + 1
  INTO v_num FROM customers WHERE tenant_id = NEW.tenant_id;
  NEW.code := 'C-' || LPAD(v_num::TEXT, 4, '0');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_customer_code ON customers;
CREATE TRIGGER trg_customer_code BEFORE INSERT ON customers
  FOR EACH ROW WHEN (NEW.code IS NULL) EXECUTE FUNCTION fn_generate_customer_code();

-- ── Auto-generate B2B code ──
CREATE OR REPLACE FUNCTION fn_generate_business_customer_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 3) AS INTEGER)), 0) + 1
  INTO v_num FROM business_customers WHERE tenant_id = NEW.tenant_id;
  NEW.code := 'B-' || LPAD(v_num::TEXT, 4, '0');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_b2b_code ON business_customers;
CREATE TRIGGER trg_b2b_code BEFORE INSERT ON business_customers
  FOR EACH ROW WHEN (NEW.code IS NULL) EXECUTE FUNCTION fn_generate_business_customer_code();

-- ============================================================
-- KEY FUNCTIONS
-- ============================================================

-- Init discount tiers for new tenant
CREATE OR REPLACE FUNCTION fn_init_discount_tiers(p_tenant_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO discount_tiers (tenant_id, customer_type, tier_key, tier_name, discount_rate, color, sort_order)
  VALUES
    (p_tenant_id,'b2c','regular','Regular',1.0000,'#8899b0',1),
    (p_tenant_id,'b2c','silver', 'Silver', 0.9800,'#94a3b8',2),
    (p_tenant_id,'b2c','gold',   'Gold',   0.9500,'#f59e0b',3),
    (p_tenant_id,'b2c','vip',    'VIP',    0.9000,'#8b5cf6',4),
    (p_tenant_id,'b2b','standard',  'Standard',  1.0000,'#8899b0',1),
    (p_tenant_id,'b2b','wholesale', 'Wholesale', 0.9000,'#06b6d4',2),
    (p_tenant_id,'b2b','preferred', 'Preferred', 0.8500,'#10b981',3),
    (p_tenant_id,'b2b','contract',  'Contract',  0.8000,'#3b82f6',4)
  ON CONFLICT (tenant_id, customer_type, tier_key) DO NOTHING;
END; $$;

-- Check user quota
CREATE OR REPLACE FUNCTION fn_check_user_quota(p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_tenant tenants%ROWTYPE; v_count INTEGER; v_max INTEGER;
BEGIN
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  v_max := COALESCE(NULLIF(v_tenant.max_users,0), 999999);
  SELECT COUNT(*) INTO v_count FROM users WHERE tenant_id = p_tenant_id AND is_active = true;
  IF v_count >= v_max THEN
    RETURN jsonb_build_object('allowed',false,'current',v_count,'max',v_max,
      'message','User limit reached ('||v_count||'/'||v_max||'). Please upgrade your plan.');
  END IF;
  RETURN jsonb_build_object('allowed',true,'current',v_count,'max',v_max);
END; $$;

-- Check terminal quota
CREATE OR REPLACE FUNCTION fn_check_terminal_quota(p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_tenant tenants%ROWTYPE; v_count INTEGER; v_max INTEGER;
BEGIN
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  v_max := COALESCE(NULLIF(v_tenant.max_terminals,0), 999999);
  SELECT COUNT(*) INTO v_count FROM terminals WHERE tenant_id = p_tenant_id AND is_active = true;
  IF v_count >= v_max THEN
    RETURN jsonb_build_object('allowed',false,'current',v_count,'max',v_max,
      'message','Terminal limit reached ('||v_count||'/'||v_max||'). Please upgrade your plan.');
  END IF;
  RETURN jsonb_build_object('allowed',true,'current',v_count,'max',v_max);
END; $$;

-- Update quota (platform admin)
CREATE OR REPLACE FUNCTION fn_platform_update_quota(
  p_tenant_id UUID, p_plan_id TEXT DEFAULT NULL,
  p_max_users INTEGER DEFAULT NULL, p_max_terminals INTEGER DEFAULT NULL,
  p_admin_id UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tenants SET
    plan_id       = COALESCE(p_plan_id,       plan_id),
    max_users     = COALESCE(p_max_users,     max_users),
    max_terminals = COALESCE(p_max_terminals, max_terminals),
    updated_at    = NOW()
  WHERE id = p_tenant_id;
  INSERT INTO platform_audit_logs (admin_id, action, target_tenant_id, details)
  VALUES (p_admin_id, 'quota.update', p_tenant_id,
    jsonb_build_object('plan_id',p_plan_id,'max_users',p_max_users,'max_terminals',p_max_terminals,'reason',p_reason));
  RETURN jsonb_build_object('success',true);
END; $$;

-- Session conflict check
CREATE OR REPLACE FUNCTION fn_check_session_conflict(
  p_user_id UUID, p_tenant_id UUID, p_new_token TEXT, p_terminal_name TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_existing active_sessions%ROWTYPE;
BEGIN
  DELETE FROM active_sessions WHERE expires_at < NOW();
  SELECT * INTO v_existing FROM active_sessions
  WHERE user_id=p_user_id AND tenant_id=p_tenant_id AND expires_at>NOW()
  ORDER BY last_active_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('conflict',true,
      'existing_terminal',COALESCE(v_existing.terminal_name,'Unknown terminal'),
      'last_active_at',v_existing.last_active_at,'session_id',v_existing.id);
  END IF;
  INSERT INTO active_sessions(tenant_id,user_id,session_token,terminal_name)
  VALUES(p_tenant_id,p_user_id,p_new_token,p_terminal_name);
  RETURN jsonb_build_object('conflict',false);
END; $$;

-- Kick session
CREATE OR REPLACE FUNCTION fn_kick_session(
  p_session_id UUID, p_user_id UUID, p_new_token TEXT,
  p_tenant_id UUID, p_terminal_name TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM active_sessions WHERE id=p_session_id AND user_id=p_user_id;
  INSERT INTO active_sessions(tenant_id,user_id,session_token,terminal_name)
  VALUES(p_tenant_id,p_user_id,p_new_token,p_terminal_name);
END; $$;

-- End session
CREATE OR REPLACE FUNCTION fn_end_session(p_session_token TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN DELETE FROM active_sessions WHERE session_token=p_session_token; END; $$;

-- Terminal heartbeat
CREATE OR REPLACE FUNCTION fn_terminal_heartbeat(p_terminal_id UUID, p_cashier_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE terminals SET last_seen_at=NOW(),
    current_cashier_id=COALESCE(p_cashier_id,current_cashier_id)
  WHERE id=p_terminal_id;
END; $$;

-- Settle batch transactions
CREATE OR REPLACE FUNCTION fn_settle_batch_transactions(
  p_batch_id UUID, p_tenant_id UUID, p_terminal_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE card_transactions SET status='settled', batch_id=p_batch_id,
    settled_at=NOW(), updated_at=NOW()
  WHERE tenant_id=p_tenant_id AND terminal_id=p_terminal_id AND status='authorized';
END; $$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'stores','users','products','inventory','serial_numbers','categories',
    'tax_groups','tax_rates','suppliers','purchase_orders','purchase_order_items',
    'customers','business_customers','business_contacts','business_addresses',
    'orders','order_items','order_payments','invoices','invoice_items','invoice_payments',
    'promotions','member_cards','loyalty_programs','loyalty_transactions',
    'cash_drawers','audit_logs','terminals','discount_tiers','payment_configs',
    'card_transactions','refund_records','batch_closes','held_orders',
    'subscription_payments','active_sessions'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_%s" ON %s', t, t);
    EXECUTE format('CREATE POLICY "tenant_isolation_%s" ON %s FOR ALL
      USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))', t, t);
  END LOOP;
END $$;

-- Plans public read
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans_public" ON plans;
CREATE POLICY "plans_public" ON plans FOR SELECT USING (true);

-- Sessions own only
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sessions_own" ON active_sessions;
CREATE POLICY "sessions_own" ON active_sessions FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- DONE
-- ============================================================
SELECT 'RetailPOS database setup complete! ✓' AS status;
