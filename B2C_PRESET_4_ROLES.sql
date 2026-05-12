-- ════════════════════════════════════════════════════════════════════
-- Preset 4 roles: Admin / Manager / Cashier / Employee
-- ════════════════════════════════════════════════════════════════════
-- Replaces the previous 3-role seed (Owner / Manager / Cashier) with a
-- cleaner 4-role lineup that maps naturally to small retail:
--
--   Admin    — full access, every permission allow, max disc 100%
--   Manager  — runs the store; most things allow, sensitive ones prompt
--   Cashier  — front of house; daily POS allow, sensitive ones prompt
--   Employee — basic register access, almost everything else deny
--
-- Safe to re-run: uses INSERT ... ON CONFLICT (tenant_id, name).
-- Existing role rows get UPDATED with the new permissions JSONB.
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE t RECORD;
DECLARE v_admin    JSONB;
DECLARE v_manager  JSONB;
DECLARE v_cashier  JSONB;
DECLARE v_employee JSONB;
BEGIN

-- ── ADMIN: every permission 'allow' ─────────────────────────────────
v_admin := jsonb_build_object(
  'pos.access', 'allow', 'pos.discount', 'allow', 'pos.price_override', 'allow',
  'pos.tip', 'allow', 'pos.surcharge', 'allow', 'pos.tax_exempt', 'allow',
  'pos.coupon', 'allow', 'pos.points_redeem', 'allow', 'pos.gift_card', 'allow',
  'pos.refund', 'allow', 'pos.void', 'allow', 'pos.cash_drawer', 'allow',
  'pos.open_shift', 'allow', 'pos.close_shift', 'allow', 'pos.hold_recall', 'allow',
  'b2b.access', 'allow', 'b2b.companies', 'allow', 'b2b.estimates', 'allow',
  'b2b.invoices', 'allow', 'b2b.payments', 'allow', 'b2b.ar_aging', 'allow',
  'inventory.products', 'allow', 'inventory.categories', 'allow',
  'inventory.stock_adjust', 'allow', 'inventory.receive', 'allow',
  'inventory.purchase_order', 'allow', 'inventory.barcode_print', 'allow',
  'reports.view', 'allow', 'reports.financial', 'allow',
  'reports.export', 'allow', 'reports.payroll', 'allow',
  'payroll.view', 'allow', 'payroll.manage', 'allow',
  'marketing.promotions', 'allow', 'loyalty.config', 'allow',
  'loyalty.adjust', 'allow', 'customers.manage', 'allow',
  'settings.store', 'allow', 'settings.users', 'allow', 'settings.roles', 'allow',
  'settings.tax', 'allow', 'settings.coupons', 'allow',
  'settings.payment', 'allow', 'settings.terminals', 'allow'
);

-- ── MANAGER: most things allow, the 3 most sensitive are prompt ─────
-- Manager runs the store. Can do everything except touch payment
-- processor config, redefine roles, or reconfigure terminals — those
-- get a manager-override prompt (the admin's PIN).
v_manager := jsonb_build_object(
  'pos.access', 'allow', 'pos.discount', 'allow', 'pos.price_override', 'allow',
  'pos.tip', 'allow', 'pos.surcharge', 'allow', 'pos.tax_exempt', 'allow',
  'pos.coupon', 'allow', 'pos.points_redeem', 'allow', 'pos.gift_card', 'allow',
  'pos.refund', 'allow', 'pos.void', 'allow', 'pos.cash_drawer', 'allow',
  'pos.open_shift', 'allow', 'pos.close_shift', 'allow', 'pos.hold_recall', 'allow',
  'b2b.access', 'allow', 'b2b.companies', 'allow', 'b2b.estimates', 'allow',
  'b2b.invoices', 'allow', 'b2b.payments', 'allow', 'b2b.ar_aging', 'allow',
  'inventory.products', 'allow', 'inventory.categories', 'allow',
  'inventory.stock_adjust', 'allow', 'inventory.receive', 'allow',
  'inventory.purchase_order', 'allow', 'inventory.barcode_print', 'allow',
  'reports.view', 'allow', 'reports.financial', 'allow',
  'reports.export', 'allow', 'reports.payroll', 'allow',
  'payroll.view', 'allow', 'payroll.manage', 'allow',
  'marketing.promotions', 'allow', 'loyalty.config', 'allow',
  'loyalty.adjust', 'allow', 'customers.manage', 'allow',
  'settings.store', 'allow', 'settings.users', 'allow',
  'settings.roles', 'prompt',          -- admin must approve role edits
  'settings.tax', 'allow', 'settings.coupons', 'allow',
  'settings.payment', 'prompt',         -- admin must approve payment cfg
  'settings.terminals', 'prompt'        -- admin must approve terminal cfg
);

-- ── CASHIER: full POS day-to-day; sensitive POS ops are 'prompt' ────
-- Can ring sales, take coupons, redeem points, sell gift cards. For
-- refunds, voids, price overrides, close-shift, surcharge, tax-exempt
-- → needs a manager PIN. Cannot touch B2B / inventory / settings.
v_cashier := jsonb_build_object(
  'pos.access', 'allow',
  'pos.discount', 'allow',             -- limited by max_discount_pct
  'pos.price_override', 'prompt',       -- manager must approve
  'pos.tip', 'allow', 'pos.surcharge', 'prompt', 'pos.tax_exempt', 'prompt',
  'pos.coupon', 'allow', 'pos.points_redeem', 'allow', 'pos.gift_card', 'allow',
  'pos.refund', 'prompt',               -- manager must approve
  'pos.void', 'prompt',                  -- manager must approve
  'pos.cash_drawer', 'allow', 'pos.hold_recall', 'allow',
  'pos.open_shift', 'allow',             -- can start register in the morning
  'pos.close_shift', 'prompt',           -- but manager closes the till
  'b2b.access', 'deny', 'b2b.companies', 'deny', 'b2b.estimates', 'deny',
  'b2b.invoices', 'deny', 'b2b.payments', 'deny', 'b2b.ar_aging', 'deny',
  'inventory.products', 'deny', 'inventory.categories', 'deny',
  'inventory.stock_adjust', 'deny', 'inventory.receive', 'deny',
  'inventory.purchase_order', 'deny', 'inventory.barcode_print', 'allow',
  'reports.view', 'deny', 'reports.financial', 'deny',
  'reports.export', 'deny', 'reports.payroll', 'deny',
  'payroll.view', 'allow',               -- can see own hours
  'payroll.manage', 'deny',
  'marketing.promotions', 'deny', 'loyalty.config', 'deny',
  'loyalty.adjust', 'deny',
  'customers.manage', 'allow',           -- can sign up new members
  'settings.store', 'deny', 'settings.users', 'deny', 'settings.roles', 'deny',
  'settings.tax', 'deny', 'settings.coupons', 'deny',
  'settings.payment', 'deny', 'settings.terminals', 'deny'
);

-- ── EMPLOYEE: bare-bones — sale & basic register, almost no overrides ─
-- For brand-new staff / part-timers. Can sell things and clock in/out.
-- Even small things (coupons, gift cards) need manager approval.
v_employee := jsonb_build_object(
  'pos.access', 'allow',                -- can use the register
  'pos.discount', 'prompt',             -- needs approval to give discounts
  'pos.price_override', 'deny',          -- absolutely not
  'pos.tip', 'allow', 'pos.surcharge', 'deny', 'pos.tax_exempt', 'deny',
  'pos.coupon', 'prompt',                -- needs approval to use coupons
  'pos.points_redeem', 'prompt',         -- needs approval to redeem points
  'pos.gift_card', 'prompt',             -- needs approval to sell/topup
  'pos.refund', 'deny',                  -- never
  'pos.void', 'deny',                    -- never
  'pos.cash_drawer', 'prompt',           -- no-sale drawer open needs approval
  'pos.hold_recall', 'allow',            -- can park / resume tickets
  'pos.open_shift', 'deny',              -- doesn't open the till
  'pos.close_shift', 'deny',             -- doesn't close it either
  'b2b.access', 'deny', 'b2b.companies', 'deny', 'b2b.estimates', 'deny',
  'b2b.invoices', 'deny', 'b2b.payments', 'deny', 'b2b.ar_aging', 'deny',
  'inventory.products', 'deny', 'inventory.categories', 'deny',
  'inventory.stock_adjust', 'deny', 'inventory.receive', 'deny',
  'inventory.purchase_order', 'deny', 'inventory.barcode_print', 'deny',
  'reports.view', 'deny', 'reports.financial', 'deny',
  'reports.export', 'deny', 'reports.payroll', 'deny',
  'payroll.view', 'allow',               -- can see their own hours
  'payroll.manage', 'deny',
  'marketing.promotions', 'deny', 'loyalty.config', 'deny',
  'loyalty.adjust', 'deny',
  'customers.manage', 'deny',
  'settings.store', 'deny', 'settings.users', 'deny', 'settings.roles', 'deny',
  'settings.tax', 'deny', 'settings.coupons', 'deny',
  'settings.payment', 'deny', 'settings.terminals', 'deny'
);

FOR t IN SELECT id FROM tenants LOOP
  -- Admin (replaces Owner; keep as is_system because Admin is conceptually
  -- the system superuser slot)
  INSERT INTO roles (tenant_id, name, description, is_system, max_discount_pct, permissions)
    VALUES (t.id, 'Admin',
            'Full access — every feature and every setting',
            TRUE, 100, v_admin)
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET permissions      = EXCLUDED.permissions,
          description      = EXCLUDED.description,
          max_discount_pct = EXCLUDED.max_discount_pct,
          is_system        = TRUE;

  -- Manager
  INSERT INTO roles (tenant_id, name, description, is_system, max_discount_pct, permissions)
    VALUES (t.id, 'Manager',
            'Runs the store — most things allow; admin approves payment/role/terminal changes',
            TRUE, 50, v_manager)
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET permissions      = EXCLUDED.permissions,
          description      = EXCLUDED.description,
          max_discount_pct = EXCLUDED.max_discount_pct,
          is_system        = TRUE;

  -- Cashier
  INSERT INTO roles (tenant_id, name, description, is_system, max_discount_pct, permissions)
    VALUES (t.id, 'Cashier',
            'Front of house — daily POS allow; manager approves refunds/voids/close-shift',
            TRUE, 10, v_cashier)
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET permissions      = EXCLUDED.permissions,
          description      = EXCLUDED.description,
          max_discount_pct = EXCLUDED.max_discount_pct,
          is_system        = TRUE;

  -- Employee
  INSERT INTO roles (tenant_id, name, description, is_system, max_discount_pct, permissions)
    VALUES (t.id, 'Employee',
            'Basic register — sales only; manager approval for almost everything',
            TRUE, 0, v_employee)
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET permissions      = EXCLUDED.permissions,
          description      = EXCLUDED.description,
          max_discount_pct = EXCLUDED.max_discount_pct,
          is_system        = TRUE;
END LOOP;

-- ── Migrate any users still on the old 'Owner' role to 'Admin' ──
-- Owner row gets repurposed but in case the system also has user.role='owner'
-- references, point them to admin so they don't end up with no role match.
UPDATE users SET role = 'admin' WHERE LOWER(role) = 'owner';

-- Old 'Owner' system role row (if still present) gets demoted: we mark
-- it non-system so the admin can delete it manually from Settings →
-- Roles. We don't drop it automatically so any users still on it stay
-- functional until reassigned.
UPDATE roles SET is_system = FALSE
  WHERE LOWER(name) = 'owner'
    AND tenant_id IN (SELECT DISTINCT tenant_id FROM roles WHERE LOWER(name) = 'admin');

END $$;

NOTIFY pgrst, 'reload schema';

-- ── Verify ──
SELECT name,
       max_discount_pct AS max_disc,
       (SELECT COUNT(*) FROM jsonb_each(permissions) WHERE value::TEXT = '"allow"')  AS allow_cnt,
       (SELECT COUNT(*) FROM jsonb_each(permissions) WHERE value::TEXT = '"prompt"') AS prompt_cnt,
       (SELECT COUNT(*) FROM jsonb_each(permissions) WHERE value::TEXT = '"deny"')   AS deny_cnt,
       is_system
  FROM roles
 WHERE is_system = TRUE
 ORDER BY CASE LOWER(name)
            WHEN 'admin'    THEN 1
            WHEN 'manager'  THEN 2
            WHEN 'cashier'  THEN 3
            WHEN 'employee' THEN 4
            ELSE 5
          END;
