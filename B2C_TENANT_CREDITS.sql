-- ════════════════════════════════════════════════════════════════════
-- Tenant Credits — usage tracking + balance + topups for Email / SMS
-- ════════════════════════════════════════════════════════════════════
-- - tenant_credits: per-tenant balance + lifetime usage counters
-- - credit_topups: every top-up event (manual or paid) for audit
-- - Trigger on digital_receipts: auto-decrement balance + bump counters
--   when a new row is inserted. If balance would go negative, the
--   insert is rejected so the frontend can react ("Out of credits").
-- - Seed: every existing tenant gets 100 free emails + 20 free SMS
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tenant_credits (
  tenant_id        UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  email_balance    INTEGER NOT NULL DEFAULT 0,
  sms_balance      INTEGER NOT NULL DEFAULT 0,

  email_used_lifetime INTEGER NOT NULL DEFAULT 0,
  sms_used_lifetime   INTEGER NOT NULL DEFAULT 0,
  email_used_month    INTEGER NOT NULL DEFAULT 0,
  sms_used_month      INTEGER NOT NULL DEFAULT 0,

  month_reset_at   DATE NOT NULL DEFAULT date_trunc('month', NOW())::DATE,

  email_low_threshold INTEGER NOT NULL DEFAULT 10,
  sms_low_threshold   INTEGER NOT NULL DEFAULT 10,

  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS credit_topups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  channel           TEXT NOT NULL CHECK (channel IN ('email','sms')),
  credits_added     INTEGER NOT NULL CHECK (credits_added > 0),
  price_paid_cents  INTEGER NOT NULL DEFAULT 0,    -- 0 = free / manual

  payment_method    TEXT NOT NULL CHECK (payment_method IN ('manual','card','free','signup_bonus')),
  payment_status    TEXT NOT NULL DEFAULT 'completed'
                    CHECK (payment_status IN ('pending','completed','failed','refunded')),
  payment_intent_id TEXT,                          -- e.g. Stripe pi_xxx
  notes             TEXT,

  added_by_user_id  UUID REFERENCES users(id),
  added_by_name     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_credit_topups_tenant ON credit_topups(tenant_id, created_at DESC);


-- ── Trigger: on digital_receipts INSERT, decrement balance + bump counters ──
-- Rolls back the insert (raises exception) if balance would go negative.
CREATE OR REPLACE FUNCTION fn_decrement_credit_on_receipt()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE
  v_balance INTEGER;
BEGIN
  -- Make sure the row exists for this tenant
  INSERT INTO tenant_credits (tenant_id) VALUES (NEW.tenant_id)
    ON CONFLICT (tenant_id) DO NOTHING;

  -- Monthly counter reset
  UPDATE tenant_credits
     SET email_used_month = 0, sms_used_month = 0,
         month_reset_at = date_trunc('month', NOW())::DATE
   WHERE tenant_id = NEW.tenant_id
     AND month_reset_at < date_trunc('month', NOW())::DATE;

  IF NEW.channel = 'email' THEN
    SELECT email_balance INTO v_balance FROM tenant_credits WHERE tenant_id = NEW.tenant_id;
    IF v_balance <= 0 THEN
      RAISE EXCEPTION 'Out of email credits — please top up'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE tenant_credits
       SET email_balance = email_balance - 1,
           email_used_lifetime = email_used_lifetime + 1,
           email_used_month = email_used_month + 1,
           updated_at = NOW()
     WHERE tenant_id = NEW.tenant_id;

  ELSIF NEW.channel = 'sms' THEN
    SELECT sms_balance INTO v_balance FROM tenant_credits WHERE tenant_id = NEW.tenant_id;
    IF v_balance <= 0 THEN
      RAISE EXCEPTION 'Out of SMS credits — please top up'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE tenant_credits
       SET sms_balance = sms_balance - 1,
           sms_used_lifetime = sms_used_lifetime + 1,
           sms_used_month = sms_used_month + 1,
           updated_at = NOW()
     WHERE tenant_id = NEW.tenant_id;
  END IF;

  RETURN NEW;
END
$func$;

DROP TRIGGER IF EXISTS trg_decrement_credit_on_receipt ON digital_receipts;
CREATE TRIGGER trg_decrement_credit_on_receipt
  BEFORE INSERT ON digital_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_decrement_credit_on_receipt();


-- ── RPC: add credits to a tenant (manual top-up) ──
-- Owner/admin calls this from the Settings UI to bump credits without
-- going through Stripe. Records a credit_topups row for audit.
CREATE OR REPLACE FUNCTION fn_add_credits(
  p_tenant_id    UUID,
  p_channel      TEXT,
  p_credits      INTEGER,
  p_price_cents  INTEGER DEFAULT 0,
  p_method       TEXT DEFAULT 'manual',
  p_notes        TEXT DEFAULT NULL,
  p_added_by_id  UUID DEFAULT NULL,
  p_added_by_name TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF p_credits <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Credits must be positive');
  END IF;
  IF p_channel NOT IN ('email','sms') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Channel must be email or sms');
  END IF;

  -- Ensure row exists
  INSERT INTO tenant_credits (tenant_id) VALUES (p_tenant_id)
    ON CONFLICT (tenant_id) DO NOTHING;

  -- Bump the balance
  IF p_channel = 'email' THEN
    UPDATE tenant_credits SET email_balance = email_balance + p_credits, updated_at = NOW()
     WHERE tenant_id = p_tenant_id
    RETURNING email_balance INTO v_new_balance;
  ELSE
    UPDATE tenant_credits SET sms_balance = sms_balance + p_credits, updated_at = NOW()
     WHERE tenant_id = p_tenant_id
    RETURNING sms_balance INTO v_new_balance;
  END IF;

  -- Audit row
  INSERT INTO credit_topups (
    tenant_id, channel, credits_added, price_paid_cents,
    payment_method, payment_status, notes,
    added_by_user_id, added_by_name, completed_at
  ) VALUES (
    p_tenant_id, p_channel, p_credits, COALESCE(p_price_cents, 0),
    p_method, 'completed', p_notes,
    p_added_by_id, p_added_by_name, NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'credits_added', p_credits
  );
END
$func$;


-- ── Seed: every existing tenant gets a row + free welcome credits ──
INSERT INTO tenant_credits (tenant_id, email_balance, sms_balance)
SELECT id, 100, 20 FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- Audit log for the welcome bonus
INSERT INTO credit_topups (tenant_id, channel, credits_added, payment_method, payment_status, notes, completed_at)
SELECT t.id, 'email', 100, 'signup_bonus', 'completed', 'Welcome bonus — 100 emails free', NOW()
  FROM tenants t
  LEFT JOIN credit_topups tu ON tu.tenant_id = t.id AND tu.payment_method = 'signup_bonus' AND tu.channel = 'email'
 WHERE tu.id IS NULL;

INSERT INTO credit_topups (tenant_id, channel, credits_added, payment_method, payment_status, notes, completed_at)
SELECT t.id, 'sms', 20, 'signup_bonus', 'completed', 'Welcome bonus — 20 SMS free', NOW()
  FROM tenants t
  LEFT JOIN credit_topups tu ON tu.tenant_id = t.id AND tu.payment_method = 'signup_bonus' AND tu.channel = 'sms'
 WHERE tu.id IS NULL;


NOTIFY pgrst, 'reload schema';

-- ── Verify ──
SELECT 'tenant_credits' AS section,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='tenant_credits')::TEXT AS exists
UNION ALL SELECT 'credit_topups',
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='credit_topups')::TEXT
UNION ALL SELECT 'fn_add_credits',
       EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_add_credits')::TEXT
UNION ALL SELECT 'trg_decrement_credit_on_receipt',
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_decrement_credit_on_receipt')::TEXT
UNION ALL SELECT 'seeded tenant_credits rows',
       (SELECT COUNT(*)::TEXT FROM tenant_credits);
