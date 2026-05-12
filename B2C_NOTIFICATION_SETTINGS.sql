-- ════════════════════════════════════════════════════════════════════
-- tenants.notification_settings — JSONB column for all notification
-- trigger configs (receipt mode, invoice auto-email, birthday coupon,
-- low-stock alert, daily summary, etc.). One column, all settings.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS notification_settings JSONB NOT NULL DEFAULT '{}'::JSONB;

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT 'notification_settings column' AS section,
       EXISTS(
         SELECT 1 FROM information_schema.columns
          WHERE table_name='tenants' AND column_name='notification_settings'
       )::TEXT AS exists;
