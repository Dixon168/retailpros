-- ════════════════════════════════════════════════════════════════════
-- Member (VIP) fields + member-card top-up history
-- ════════════════════════════════════════════════════════════════════
-- The Members page (customers) already references these columns and a
-- customer_topups table, but they were never created. This adds them.
--
-- Member cards are SEPARATE from gift cards (member_cards table). Member
-- cards live on the customer record: customers.card_number + card_balance.
-- Top-ups are logged in customer_topups, which (like gift cards) tracks
-- the top-up amount vs the payment amount so promos ("top up $100, get
-- $20 free") work: paid_amount = cash (financial income), amount = loaded
-- to card (balance / usage data), bonus = free.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Member fields on customers ──────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_number      TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_balance     NUMERIC(10,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_expire_date DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS member_level     TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS member_since     DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday         DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender           TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referrer         TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notify_method    TEXT;

-- One member card number per member (unique within a tenant when set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_card
  ON customers(tenant_id, card_number)
  WHERE card_number IS NOT NULL AND card_number <> '';

-- Lookups by phone (search a member by phone)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone
  ON customers(tenant_id, phone) WHERE phone IS NOT NULL;


-- ── 2. customer_topups — member-card top-up history ────────────────
CREATE TABLE IF NOT EXISTS customer_topups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount        NUMERIC(10,2) NOT NULL,            -- 充值金额 — loaded onto the card
  paid_amount   NUMERIC(10,2),                     -- 付款金额 — cash collected (income)
  bonus_amount  NUMERIC(10,2) DEFAULT 0,           -- free / promo amount
  method        TEXT DEFAULT 'cash',               -- cash | card | transfer
  balance_after NUMERIC(10,2),
  note          TEXT,
  staff_id      UUID,
  staff_name    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_topups_cust
  ON customer_topups(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_topups_tenant_dt
  ON customer_topups(tenant_id, created_at DESC);

-- If the table already existed (older build), make sure the new
-- promo columns are present too.
ALTER TABLE customer_topups ADD COLUMN IF NOT EXISTS paid_amount   NUMERIC(10,2);
ALTER TABLE customer_topups ADD COLUMN IF NOT EXISTS bonus_amount  NUMERIC(10,2) DEFAULT 0;
ALTER TABLE customer_topups ADD COLUMN IF NOT EXISTS balance_after NUMERIC(10,2);

-- Backfill paid_amount = amount for any old rows (no promo recorded)
UPDATE customer_topups SET paid_amount = amount WHERE paid_amount IS NULL;


-- ── 3. RLS (match the rest of the app: tenant-scoped) ──────────────
ALTER TABLE customer_topups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_topups_tenant ON customer_topups;
CREATE POLICY customer_topups_tenant ON customer_topups
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));


NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────
SELECT 'customers.card_number' AS section,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='card_number')::TEXT AS ok
UNION ALL SELECT 'customers.card_balance',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='card_balance')::TEXT
UNION ALL SELECT 'customers.birthday',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='birthday')::TEXT
UNION ALL SELECT 'customers.notify_method',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='notify_method')::TEXT
UNION ALL SELECT 'customer_topups table',
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='customer_topups')::TEXT
UNION ALL SELECT 'customer_topups.paid_amount',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customer_topups' AND column_name='paid_amount')::TEXT;
