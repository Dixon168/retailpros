-- ════════════════════════════════════════════════════════════════════
-- B2C_FIX_CUSTOMER_LAST_ORDER.sql
-- The fn_submit_order_atomic function writes customers.last_order_at on
-- every order that has a customer attached, but the column was never
-- created on the customers table. Result: any sale with a member
-- selected fails with "column last_order_at of relation customers does
-- not exist".
-- Fix: add the column (nullable timestamp). Idempotent.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS last_order_at TIMESTAMPTZ;

-- Backfill from each customer's most-recent completed order so the
-- column is meaningful right away (not just NULL until the next sale).
UPDATE customers c
   SET last_order_at = sub.last_order
  FROM (
    SELECT customer_id, MAX(created_at) AS last_order
      FROM orders
     WHERE customer_id IS NOT NULL
       AND status = 'completed'
     GROUP BY customer_id
  ) sub
 WHERE c.id = sub.customer_id
   AND c.last_order_at IS NULL;

NOTIFY pgrst, 'reload schema';

SELECT 'customers.last_order_at column' AS section,
  EXISTS(SELECT 1 FROM information_schema.columns
     WHERE table_name='customers' AND column_name='last_order_at')::TEXT AS ok;
