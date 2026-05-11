-- ════════════════════════════════════════════════════════════════════
-- Add tax_exempt flag to products
-- ════════════════════════════════════════════════════════════════════
-- When true, the product is tax-exempt — no tax applies regardless of
-- which tax rates are linked via product_tax_rates.
-- Default false (i.e. taxable by default; the linked rates apply).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN products.tax_exempt IS
  'When true, no taxes apply to this product regardless of rates linked via product_tax_rates.';

-- Force PostgREST to reload its schema cache so the new column is visible to the API
NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'tax_exempt';
