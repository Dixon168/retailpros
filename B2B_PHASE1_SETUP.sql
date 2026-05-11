-- ============================================================
-- 💼 B2B Phase 1 — schema upgrade for multi-contact/address/payment/notes
-- 复制全部 → Supabase SQL Editor → Run
-- 安全：可重复跑，向后兼容
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. business_contacts — rename business_id → business_customer_id
--    (matches invoices.business_customer_id naming convention)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='business_contacts' AND column_name='business_id') THEN
    ALTER TABLE business_contacts RENAME COLUMN business_id TO business_customer_id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_business_contacts_customer
  ON business_contacts(business_customer_id);

-- ─────────────────────────────────────────────────────────────
-- 2. business_addresses — rename business_id → business_customer_id
--    + add type (billing/delivery/shipping)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='business_addresses' AND column_name='business_id') THEN
    ALTER TABLE business_addresses RENAME COLUMN business_id TO business_customer_id;
  END IF;
END $$;

-- Address type: billing / delivery / shipping (or null = general)
ALTER TABLE business_addresses
  ADD COLUMN IF NOT EXISTS type TEXT;

-- Constraint after column exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='business_addresses_type_check') THEN
    ALTER TABLE business_addresses
      ADD CONSTRAINT business_addresses_type_check
      CHECK (type IS NULL OR type IN ('billing','delivery','shipping'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_business_addresses_customer
  ON business_addresses(business_customer_id);

-- ─────────────────────────────────────────────────────────────
-- 3. business_payment_methods — store Check on File details
--    (no full credit card numbers for now — only last 4 + holder)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_payment_methods (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_customer_id  UUID NOT NULL REFERENCES business_customers(id) ON DELETE CASCADE,
  -- Type of payment method
  method_type           TEXT NOT NULL CHECK (method_type IN ('check', 'card', 'ach')),
  -- Common fields
  nickname              TEXT,                -- "Main checking account", "Owner's Amex"
  holder_name           TEXT,                -- Name on the check/card
  is_default            BOOLEAN DEFAULT false,
  -- Check-specific
  bank_name             TEXT,
  routing_last4         TEXT,                -- last 4 of routing # (display only)
  account_last4         TEXT,                -- last 4 of account # (display only)
  -- Card-specific (future — only last 4 + expiry for now, no PAN storage)
  card_brand            TEXT,                -- visa / mc / amex / disc
  card_last4            TEXT,
  card_exp_month        INTEGER,
  card_exp_year         INTEGER,
  -- ACH-specific (future)
  ach_provider          TEXT,                -- e.g. dwolla, plaid id (future)
  -- Audit
  notes                 TEXT,
  is_active             BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  created_by            UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_business_payment_methods_customer
  ON business_payment_methods(business_customer_id) WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────
-- 4. business_notes — special notes per company
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_notes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_customer_id  UUID NOT NULL REFERENCES business_customers(id) ON DELETE CASCADE,
  note                  TEXT NOT NULL,
  is_pinned             BOOLEAN DEFAULT false,  -- show on top
  is_alert              BOOLEAN DEFAULT false,  -- highlight as warning (e.g. "DO NOT EXTEND CREDIT")
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  created_by            UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_business_notes_customer
  ON business_notes(business_customer_id);

-- ─────────────────────────────────────────────────────────────
-- 5. business_customers — opening balance + computed fields
-- ─────────────────────────────────────────────────────────────
ALTER TABLE business_customers
  ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(10,2) DEFAULT 0;

-- ─────────────────────────────────────────────────────────────
-- 6. View: business_customers with computed financial info
--    For list page — joins balance + invoice counts + last activity
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_business_customer_list AS
SELECT
  bc.*,
  -- Primary contact phone (for search)
  COALESCE(
    bc.contact_phone,
    (SELECT phone FROM business_contacts bcon
       WHERE bcon.business_customer_id = bc.id AND bcon.is_primary = true LIMIT 1),
    (SELECT phone FROM business_contacts bcon
       WHERE bcon.business_customer_id = bc.id LIMIT 1)
  ) AS effective_phone,
  -- Open invoices count + balance
  (SELECT COUNT(*) FROM invoices i
     WHERE i.business_customer_id = bc.id
       AND i.status NOT IN ('paid','void','draft')
       AND COALESCE(i.balance_due, 0) > 0
  ) AS open_invoice_count,
  COALESCE(
    (SELECT SUM(balance_due) FROM invoices i
       WHERE i.business_customer_id = bc.id
         AND i.status NOT IN ('paid','void','draft')
    ),
    0
  ) + COALESCE(bc.opening_balance, 0) AS computed_balance,
  -- Overdue count
  (SELECT COUNT(*) FROM invoices i
     WHERE i.business_customer_id = bc.id
       AND i.status NOT IN ('paid','void','draft')
       AND i.due_date < CURRENT_DATE
       AND COALESCE(i.balance_due, 0) > 0
  ) AS overdue_invoice_count,
  -- Last activity (latest invoice or payment)
  GREATEST(
    COALESCE((SELECT MAX(created_at) FROM invoices WHERE business_customer_id = bc.id), bc.created_at),
    COALESCE((SELECT MAX(created_at) FROM received_payments WHERE business_customer_id = bc.id), bc.created_at)
  ) AS last_activity_at
FROM business_customers bc;

-- ─────────────────────────────────────────────────────────────
-- 7. View: business_customer_full
--    For detail page — joins everything needed for the drill-down
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_business_customer_full AS
SELECT
  bc.*,
  (SELECT COUNT(*) FROM business_contacts WHERE business_customer_id = bc.id) AS contact_count,
  (SELECT COUNT(*) FROM business_addresses WHERE business_customer_id = bc.id) AS address_count,
  (SELECT COUNT(*) FROM business_payment_methods
     WHERE business_customer_id = bc.id AND is_active = true) AS payment_method_count,
  (SELECT COUNT(*) FROM business_notes WHERE business_customer_id = bc.id) AS note_count,
  (SELECT COUNT(*) FROM business_notes
     WHERE business_customer_id = bc.id AND is_alert = true) AS alert_note_count
FROM business_customers bc;

-- ✅ 完成
