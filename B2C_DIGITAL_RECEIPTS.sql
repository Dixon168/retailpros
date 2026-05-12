-- ════════════════════════════════════════════════════════════════════
-- Digital Receipts queue
-- ════════════════════════════════════════════════════════════════════
-- Stores Email/SMS receipt requests for a backend worker to process.
-- The frontend code already wraps this with a localStorage fallback so
-- it's safe to run before the table existed (older orders' queued
-- requests will gracefully save locally), but having the table lets a
-- worker (Supabase Edge Function, n8n, Zapier, etc.) actually deliver
-- the receipts via SendGrid / Twilio / your preferred provider.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS digital_receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  channel       TEXT NOT NULL CHECK (channel IN ('email','sms')),
  recipient     TEXT NOT NULL,            -- email address or E.164 phone
  order_number  TEXT,                     -- for tracing/debugging
  html_content  TEXT NOT NULL,            -- the 80mm receipt HTML

  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','sending','sent','failed')),
  sent_at       TIMESTAMPTZ,
  error_message TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_digital_receipts_queued
  ON digital_receipts (tenant_id, status, created_at)
  WHERE status IN ('queued','failed');

CREATE INDEX IF NOT EXISTS idx_digital_receipts_recipient
  ON digital_receipts (recipient, created_at DESC);


-- Auto-touch updated_at
CREATE OR REPLACE FUNCTION fn_touch_digital_receipts() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_touch_digital_receipts ON digital_receipts;
CREATE TRIGGER trg_touch_digital_receipts BEFORE UPDATE ON digital_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_touch_digital_receipts();


NOTIFY pgrst, 'reload schema';

-- Verify
SELECT 'digital_receipts table' AS section,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='digital_receipts')::TEXT AS ok;
