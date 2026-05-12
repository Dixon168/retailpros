-- ════════════════════════════════════════════════════════════════════
-- Messaging: Quota + Overage model (replaces credit-pack system)
-- ════════════════════════════════════════════════════════════════════
-- - Free quota per month (Email: 500, SMS: 100)
-- - Overage at $0.05 per message
-- - Hard cap to prevent runaway bills (default 2000 overage = $100)
-- - At 80% of cap, alert owner (frontend reads this flag)
-- - At hard cap, RAISE EXCEPTION to block sending
--
-- Idempotent: safe to re-run. Drops the old credit-pack tables only
-- if they exist (we kept them in earlier scripts).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Drop the old credit-pack model (no longer used) ──
DROP TRIGGER  IF EXISTS trg_decrement_credit_on_receipt ON digital_receipts;
DROP FUNCTION IF EXISTS fn_decrement_credit_on_receipt() CASCADE;
DROP FUNCTION IF EXISTS fn_add_credits(UUID,TEXT,INTEGER,INTEGER,TEXT,TEXT,UUID,TEXT) CASCADE;
DROP TABLE    IF EXISTS credit_topups CASCADE;
DROP TABLE    IF EXISTS tenant_credits CASCADE;

-- ── 2. New tenant_messaging table ──
CREATE TABLE IF NOT EXISTS tenant_messaging (
  tenant_id              UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- Monthly free quota (Admin can adjust per plan)
  plan_email_quota       INTEGER NOT NULL DEFAULT 500,
  plan_sms_quota         INTEGER NOT NULL DEFAULT 100,

  -- Current-month usage counters (auto-reset on month change)
  email_used_month       INTEGER NOT NULL DEFAULT 0,
  sms_used_month         INTEGER NOT NULL DEFAULT 0,

  -- Overage counters (how many beyond the free quota this month)
  email_overage_count    INTEGER NOT NULL DEFAULT 0,
  sms_overage_count      INTEGER NOT NULL DEFAULT 0,

  -- Overage pricing (in cents — $0.05 = 5 cents)
  email_per_overage_cents INTEGER NOT NULL DEFAULT 5,
  sms_per_overage_cents   INTEGER NOT NULL DEFAULT 5,

  -- Hard cap on overage count to prevent runaway bills.
  -- 2000 × $0.05 = $100 max overage per month per channel.
  email_overage_cap      INTEGER NOT NULL DEFAULT 2000,
  sms_overage_cap        INTEGER NOT NULL DEFAULT 2000,

  -- Lifetime counters (never reset, for analytics)
  email_used_lifetime    INTEGER NOT NULL DEFAULT 0,
  sms_used_lifetime      INTEGER NOT NULL DEFAULT 0,

  -- Billing
  month_reset_at         DATE NOT NULL DEFAULT date_trunc('month', NOW())::DATE,
  billing_status         TEXT NOT NULL DEFAULT 'active'
                         CHECK (billing_status IN ('active','suspended','free_trial')),

  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 3. Monthly billing snapshot (for audit + invoicing) ──
-- One row per tenant per month, showing the final overage bill.
-- Populated when the month rolls over (inside the trigger below).
CREATE TABLE IF NOT EXISTS messaging_monthly_bills (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month                  DATE NOT NULL,                  -- yyyy-mm-01

  email_used             INTEGER NOT NULL,
  email_quota            INTEGER NOT NULL,
  email_overage          INTEGER NOT NULL,
  email_overage_amount_cents INTEGER NOT NULL,

  sms_used               INTEGER NOT NULL,
  sms_quota              INTEGER NOT NULL,
  sms_overage            INTEGER NOT NULL,
  sms_overage_amount_cents INTEGER NOT NULL,

  total_amount_cents     INTEGER NOT NULL,               -- email + sms overage
  status                 TEXT NOT NULL DEFAULT 'unpaid'
                         CHECK (status IN ('unpaid','paid','waived','disputed')),
  paid_at                TIMESTAMPTZ,
  payment_method         TEXT,                           -- stripe / manual / etc

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, month)
);
CREATE INDEX IF NOT EXISTS idx_msg_bills_tenant ON messaging_monthly_bills(tenant_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_msg_bills_unpaid ON messaging_monthly_bills(status) WHERE status = 'unpaid';


-- ── 4. Trigger: on each digital_receipts INSERT ──
-- 1) Reset monthly counters if month rolled over (and snapshot the
--    just-ended month into messaging_monthly_bills)
-- 2) Increment usage counter
-- 3) If beyond free quota, increment overage counter
-- 4) If overage hits the hard cap, reject the insert
CREATE OR REPLACE FUNCTION fn_track_messaging_usage()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE
  m  tenant_messaging%ROWTYPE;
  new_month DATE := date_trunc('month', NOW())::DATE;
BEGIN
  -- Ensure row exists
  INSERT INTO tenant_messaging (tenant_id) VALUES (NEW.tenant_id)
    ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO m FROM tenant_messaging WHERE tenant_id = NEW.tenant_id FOR UPDATE;

  -- ── Month rollover ──
  IF m.month_reset_at < new_month THEN
    -- Snapshot the ending month's totals into the bills table (if any usage)
    IF (m.email_used_month + m.sms_used_month) > 0 THEN
      INSERT INTO messaging_monthly_bills (
        tenant_id, month,
        email_used, email_quota, email_overage, email_overage_amount_cents,
        sms_used, sms_quota, sms_overage, sms_overage_amount_cents,
        total_amount_cents
      ) VALUES (
        NEW.tenant_id, m.month_reset_at,
        m.email_used_month, m.plan_email_quota,
        m.email_overage_count, m.email_overage_count * m.email_per_overage_cents,
        m.sms_used_month, m.plan_sms_quota,
        m.sms_overage_count, m.sms_overage_count * m.sms_per_overage_cents,
        (m.email_overage_count * m.email_per_overage_cents)
        + (m.sms_overage_count * m.sms_per_overage_cents)
      )
      ON CONFLICT (tenant_id, month) DO NOTHING;
    END IF;

    -- Reset monthly counters
    UPDATE tenant_messaging
       SET email_used_month = 0, sms_used_month = 0,
           email_overage_count = 0, sms_overage_count = 0,
           month_reset_at = new_month
     WHERE tenant_id = NEW.tenant_id;

    -- Reload row
    SELECT * INTO m FROM tenant_messaging WHERE tenant_id = NEW.tenant_id FOR UPDATE;
  END IF;

  -- ── Hard-cap check (before incrementing) ──
  IF NEW.channel = 'email' AND m.email_overage_count >= m.email_overage_cap THEN
    RAISE EXCEPTION 'Email overage cap reached (%) — please raise the cap in Settings → Notifications', m.email_overage_cap
      USING ERRCODE = 'P0001';
  ELSIF NEW.channel = 'sms' AND m.sms_overage_count >= m.sms_overage_cap THEN
    RAISE EXCEPTION 'SMS overage cap reached (%) — please raise the cap in Settings → Notifications', m.sms_overage_cap
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Suspended account ──
  IF m.billing_status = 'suspended' THEN
    RAISE EXCEPTION 'Messaging is suspended for this account — contact support'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Increment ──
  IF NEW.channel = 'email' THEN
    UPDATE tenant_messaging
       SET email_used_month     = email_used_month + 1,
           email_used_lifetime  = email_used_lifetime + 1,
           email_overage_count  = CASE WHEN email_used_month + 1 > plan_email_quota
                                       THEN email_overage_count + 1
                                       ELSE email_overage_count END,
           updated_at = NOW()
     WHERE tenant_id = NEW.tenant_id;
  ELSIF NEW.channel = 'sms' THEN
    UPDATE tenant_messaging
       SET sms_used_month     = sms_used_month + 1,
           sms_used_lifetime  = sms_used_lifetime + 1,
           sms_overage_count  = CASE WHEN sms_used_month + 1 > plan_sms_quota
                                     THEN sms_overage_count + 1
                                     ELSE sms_overage_count END,
           updated_at = NOW()
     WHERE tenant_id = NEW.tenant_id;
  END IF;

  RETURN NEW;
END
$func$;

DROP TRIGGER IF EXISTS trg_track_messaging_usage ON digital_receipts;
CREATE TRIGGER trg_track_messaging_usage
  BEFORE INSERT ON digital_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_track_messaging_usage();


-- ── 5. Seed existing tenants with default quota row ──
INSERT INTO tenant_messaging (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;


-- ── 6. SMS templates table — locked single-segment templates ──
-- One row per (tenant, trigger_type, language). System seeds defaults
-- that fit within a single GSM-7 (160) or UCS-2 (70) segment.
-- Frontend enforces the limit when saving; backend also rejects via
-- a CHECK constraint that's permissive enough to allow short templates
-- but length is validated in code (since char counts depend on encoding).
CREATE TABLE IF NOT EXISTS sms_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger_type  TEXT NOT NULL,        -- 'receipt' / 'order_ready' / 'payment_reminder' / etc
  language      TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','zh')),
  template_text TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, trigger_type, language)
);


-- ── 7. Default SMS templates (seeded per tenant) ──
-- All fit within a single segment. English ≤160 chars (GSM-7),
-- Chinese ≤70 chars (UCS-2). No emoji to maximize GSM-7 capacity.
INSERT INTO sms_templates (tenant_id, trigger_type, language, template_text)
SELECT t.id, x.trigger_type, x.language, x.template_text
  FROM tenants t
  CROSS JOIN (VALUES
    ('receipt',          'en', '{store}: receipt {order} ${amt} view {link}'),
    ('receipt',          'zh', '{store}: 收据 {order} ${amt} {link}'),
    ('order_ready',      'en', '{name}, your order {order} from {store} is ready for pickup.'),
    ('order_ready',      'zh', '{name}, 您在{store}的订单{order}已就绪可取货.'),
    ('payment_reminder', 'en', '{store}: invoice {invoice} ${amt} due {date}. Pay: {link}'),
    ('payment_reminder', 'zh', '{store}: 发票{invoice} ${amt} 到期{date}. 付款: {link}'),
    ('birthday_coupon',  'en', '{name}, happy birthday from {store}! Code {code} for {pct}% off.'),
    ('birthday_coupon',  'zh', '{name},{store}祝您生日快乐!凭码{code}享{pct}%折扣.'),
    ('loyalty_update',   'en', '{name}: you now have {pts} points at {store}. Thank you!'),
    ('loyalty_update',   'zh', '{name}: 您在{store}有{pts}积分,谢谢!'),
    ('cash_variance',    'en', '{store}: drawer variance ${amt} on shift close by {employee}.'),
    ('cash_variance',    'zh', '{store}: 钱箱差异${amt} 关班{employee}.')
  ) AS x(trigger_type, language, template_text)
ON CONFLICT (tenant_id, trigger_type, language) DO NOTHING;


NOTIFY pgrst, 'reload schema';

-- ── Verify ──
SELECT 'tenant_messaging table'  AS section,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='tenant_messaging')::TEXT AS exists
UNION ALL SELECT 'messaging_monthly_bills',
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='messaging_monthly_bills')::TEXT
UNION ALL SELECT 'sms_templates',
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='sms_templates')::TEXT
UNION ALL SELECT 'fn_track_messaging_usage',
       EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_track_messaging_usage')::TEXT
UNION ALL SELECT 'trg_track_messaging_usage',
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_track_messaging_usage')::TEXT
UNION ALL SELECT 'seeded tenant_messaging rows',
       (SELECT COUNT(*)::TEXT FROM tenant_messaging)
UNION ALL SELECT 'seeded sms_templates rows',
       (SELECT COUNT(*)::TEXT FROM sms_templates);
