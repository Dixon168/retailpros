-- ════════════════════════════════════════════════════════════════════
-- Roles + Permissions
-- ════════════════════════════════════════════════════════════════════
-- Replaces the hardcoded owner/manager/cashier permission logic with a
-- proper role table that owners can edit. Built-in roles can be edited
-- but not deleted. Custom roles can be added freely.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,                        -- 'Owner' | 'Manager' | 'Cashier' | custom
  description  TEXT,
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,       -- true for built-in 3
  permissions  JSONB NOT NULL DEFAULT '{}'::JSONB,   -- { "pos.discount": true, ... }
  max_discount_pct INTEGER DEFAULT 0,                -- max % discount (0 = none unless can_discount)
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);


CREATE OR REPLACE FUNCTION fn_touch_roles() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_touch_roles ON roles;
CREATE TRIGGER trg_touch_roles BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION fn_touch_roles();


-- ── Seed default roles for every existing tenant ────────────────────
-- Owner: full access
-- Manager: most things but no role/payment config
-- Cashier: POS only, no settings or reports

DO $$
DECLARE t RECORD;
DECLARE v_owner_perms   JSONB;
DECLARE v_manager_perms JSONB;
DECLARE v_cashier_perms JSONB;
BEGIN
  -- Owner: every flag true (we list them so the UI knows the universe of keys)
  v_owner_perms := jsonb_build_object(
    'pos.access', true, 'pos.discount', true, 'pos.price_override', true,
    'pos.tip', true, 'pos.surcharge', true, 'pos.tax_exempt', true,
    'pos.coupon', true, 'pos.points_redeem', true, 'pos.gift_card', true,
    'pos.refund', true, 'pos.void', true, 'pos.cash_drawer', true,
    'pos.open_shift', true, 'pos.close_shift', true, 'pos.hold_recall', true,
    'reports.view', true, 'reports.payroll', true, 'reports.export', true, 'reports.financial', true,
    'b2b.access', true, 'b2b.companies', true, 'b2b.estimates', true,
    'b2b.invoices', true, 'b2b.payments', true, 'b2b.ar_aging', true,
    'inventory.products', true, 'inventory.categories', true, 'inventory.stock_adjust', true,
    'inventory.receive', true, 'inventory.purchase_order', true, 'inventory.barcode_print', true,
    'settings.store', true, 'settings.users', true, 'settings.roles', true,
    'settings.tax', true, 'settings.payment', true, 'settings.coupons', true, 'settings.terminals', true,
    'marketing.promotions', true, 'loyalty.config', true, 'loyalty.adjust', true,
    'customers.manage', true,
    'payroll.view', true, 'payroll.manage', true
  );

  -- Manager: POS full + most inventory/customer/marketing + reports + B2B
  -- EXCLUDED: settings.roles, settings.payment, settings.terminals, payroll.manage
  v_manager_perms := jsonb_build_object(
    'pos.access', true, 'pos.discount', true, 'pos.price_override', true,
    'pos.tip', true, 'pos.surcharge', true, 'pos.tax_exempt', true,
    'pos.coupon', true, 'pos.points_redeem', true, 'pos.gift_card', true,
    'pos.refund', true, 'pos.void', true, 'pos.cash_drawer', true,
    'pos.open_shift', true, 'pos.close_shift', true, 'pos.hold_recall', true,
    'reports.view', true, 'reports.payroll', true, 'reports.export', true, 'reports.financial', false,
    'b2b.access', true, 'b2b.companies', true, 'b2b.estimates', true,
    'b2b.invoices', true, 'b2b.payments', true, 'b2b.ar_aging', true,
    'inventory.products', true, 'inventory.categories', true, 'inventory.stock_adjust', true,
    'inventory.receive', true, 'inventory.purchase_order', true, 'inventory.barcode_print', true,
    'settings.store', true, 'settings.users', true, 'settings.roles', false,
    'settings.tax', false, 'settings.payment', false, 'settings.coupons', true, 'settings.terminals', false,
    'marketing.promotions', true, 'loyalty.config', true, 'loyalty.adjust', true,
    'customers.manage', true,
    'payroll.view', true, 'payroll.manage', false
  );

  -- Cashier: POS only, basic items; no settings, no reports
  v_cashier_perms := jsonb_build_object(
    'pos.access', true, 'pos.discount', true, 'pos.price_override', false,
    'pos.tip', true, 'pos.surcharge', false, 'pos.tax_exempt', false,
    'pos.coupon', true, 'pos.points_redeem', true, 'pos.gift_card', true,
    'pos.refund', false, 'pos.void', false, 'pos.cash_drawer', true,
    'pos.open_shift', true, 'pos.close_shift', false, 'pos.hold_recall', true,
    'reports.view', false, 'reports.payroll', false, 'reports.export', false, 'reports.financial', false,
    'b2b.access', false, 'b2b.companies', false, 'b2b.estimates', false,
    'b2b.invoices', false, 'b2b.payments', false, 'b2b.ar_aging', false,
    'inventory.products', false, 'inventory.categories', false, 'inventory.stock_adjust', false,
    'inventory.receive', false, 'inventory.purchase_order', false, 'inventory.barcode_print', false,
    'settings.store', false, 'settings.users', false, 'settings.roles', false,
    'settings.tax', false, 'settings.payment', false, 'settings.coupons', false, 'settings.terminals', false,
    'marketing.promotions', false, 'loyalty.config', false, 'loyalty.adjust', false,
    'customers.manage', true,
    'payroll.view', true, 'payroll.manage', false
  );

  FOR t IN SELECT id FROM tenants LOOP
    INSERT INTO roles (tenant_id, name, description, is_system, max_discount_pct, permissions)
      VALUES (t.id, 'Owner',   'Full access including all settings',  TRUE, 100, v_owner_perms)
      ON CONFLICT (tenant_id, name) DO UPDATE SET is_system=TRUE;
    INSERT INTO roles (tenant_id, name, description, is_system, max_discount_pct, permissions)
      VALUES (t.id, 'Manager', 'Most POS + reports + employees; no payment/role config', TRUE, 50, v_manager_perms)
      ON CONFLICT (tenant_id, name) DO UPDATE SET is_system=TRUE;
    INSERT INTO roles (tenant_id, name, description, is_system, max_discount_pct, permissions)
      VALUES (t.id, 'Cashier', 'POS only — no refunds/voids/settings', TRUE, 10, v_cashier_perms)
      ON CONFLICT (tenant_id, name) DO UPDATE SET is_system=TRUE;
  END LOOP;
END $$;


-- ── Helper RPC: get effective permissions for a user ────────────────
-- Looks up the role of the user, then merges in any per-user overrides
-- stored in users.permissions (per-user overrides win)
CREATE OR REPLACE FUNCTION fn_user_permissions(p_user_id UUID) RETURNS JSONB
LANGUAGE plpgsql AS $func$
DECLARE
  v_u users%ROWTYPE;
  v_r roles%ROWTYPE;
  v_role_perms JSONB := '{}'::JSONB;
  v_user_perms JSONB := '{}'::JSONB;
BEGIN
  SELECT * INTO v_u FROM users WHERE id = p_user_id LIMIT 1;
  IF NOT FOUND THEN RETURN '{}'::JSONB; END IF;

  SELECT * INTO v_r FROM roles
   WHERE tenant_id = v_u.tenant_id AND LOWER(name) = LOWER(v_u.role)
   LIMIT 1;
  IF FOUND THEN v_role_perms := v_r.permissions; END IF;

  v_user_perms := COALESCE(v_u.permissions, '{}'::JSONB);
  -- Per-user overrides take precedence
  RETURN v_role_perms || v_user_perms;
END;
$func$;


-- ── Patch fn_pin_login to include resolved permissions + max_discount_pct ──
CREATE OR REPLACE FUNCTION fn_pin_login(p_tenant_id UUID, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_u users%ROWTYPE;
  v_open UUID;
  v_perms JSONB;
  v_role roles%ROWTYPE;
  v_max_disc INTEGER;
BEGIN
  IF TRIM(COALESCE(p_pin,'')) = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Enter a PIN');
  END IF;
  SELECT * INTO v_u FROM users
   WHERE tenant_id = p_tenant_id AND pin = TRIM(p_pin) AND is_active = TRUE
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid PIN');
  END IF;

  SELECT id INTO v_open FROM time_clock_entries
   WHERE user_id = v_u.id AND clock_out_at IS NULL
   ORDER BY clock_in_at DESC LIMIT 1;

  v_perms := fn_user_permissions(v_u.id);

  SELECT * INTO v_role FROM roles
   WHERE tenant_id = v_u.tenant_id AND LOWER(name) = LOWER(v_u.role) LIMIT 1;
  v_max_disc := COALESCE(v_role.max_discount_pct, 0);

  RETURN jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id',           v_u.id,
      'name',         v_u.name,
      'role',         v_u.role,
      'email',        v_u.email,
      'employee_code',v_u.employee_code,
      'hourly_rate',  v_u.hourly_rate,
      'permissions',  v_perms,
      'max_discount_pct', v_max_disc,
      'currently_clocked_in_entry', v_open
    )
  );
END;
$func$;


NOTIFY pgrst, 'reload schema';

SELECT 'roles table' AS section, EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='roles')::TEXT AS ok
UNION ALL SELECT 'fn_user_permissions', EXISTS (SELECT 1 FROM pg_proc WHERE proname='fn_user_permissions')::TEXT
UNION ALL SELECT 'seeded role count', (SELECT COUNT(*)::TEXT FROM roles WHERE is_system = TRUE);
