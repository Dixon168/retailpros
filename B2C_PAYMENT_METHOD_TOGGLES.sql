-- ════════════════════════════════════════════════════════════════════
-- B2C_PAYMENT_METHOD_TOGGLES.sql
-- Merchant-configurable list of which payment methods show in POS.
-- Adds enabled_payment_methods (JSONB array of method ids) to
-- payment_configs. Default = cash + credit_card (the two universally
-- safe ones); the merchant turns on Card (PAX), Gift, Member, Check,
-- Bank Transfer as needed.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE payment_configs
  ADD COLUMN IF NOT EXISTS enabled_payment_methods JSONB
    DEFAULT '["cash","credit_card"]'::jsonb;

-- Backfill: any tenant that already has a payment_configs row but no
-- methods list gets the sane default. Doesn't disturb anything else.
UPDATE payment_configs
   SET enabled_payment_methods = '["cash","credit_card"]'::jsonb
 WHERE enabled_payment_methods IS NULL;

NOTIFY pgrst, 'reload schema';

SELECT 'enabled_payment_methods column'
  AS section,
  EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_name='payment_configs'
       AND column_name='enabled_payment_methods'
  )::TEXT AS ok;
