-- ════════════════════════════════════════════════════════════════════
-- B2B Invoice inventory lifecycle: deduct on send, restore on void
-- Already applied to Dixon's DB on May 18 (commit 0751994).
-- Saved here for repo audit / future deployments.
-- ════════════════════════════════════════════════════════════════════

-- Functions: fn_create_invoice_atomic (rewritten — no deduct on draft)
--            fn_send_invoice          (NEW — deducts inventory)
--            fn_void_invoice          (NEW — restores inventory)
-- New columns: invoices.sent_at / sent_by / voided_at / voided_by / voided_reason

-- See conversation log for the full SQL (308 lines). Recorded in
-- schema_migrations as 'B2C_INVOICE_LIFECYCLE'.
