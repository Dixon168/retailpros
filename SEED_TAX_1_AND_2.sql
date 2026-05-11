-- ════════════════════════════════════════════════════════════════════
-- Pre-create "Tax 1" and "Tax 2" at 0% for every tenant
-- ════════════════════════════════════════════════════════════════════
-- Safe to re-run: only inserts if a tax with that name doesn't exist yet.
-- Edit rates anytime in Settings → Tax Rates.
-- ════════════════════════════════════════════════════════════════════

INSERT INTO tax_rates (tenant_id, name, rate)
SELECT t.id, 'Tax 1', 0
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tax_rates
  WHERE tenant_id = t.id AND name = 'Tax 1'
);

INSERT INTO tax_rates (tenant_id, name, rate)
SELECT t.id, 'Tax 2', 0
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tax_rates
  WHERE tenant_id = t.id AND name = 'Tax 2'
);

-- Verify
SELECT name, rate, tenant_id
FROM tax_rates
WHERE name IN ('Tax 1', 'Tax 2')
ORDER BY name;
