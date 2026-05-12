-- ════════════════════════════════════════════════════════════════════
-- Employee Time Clock + Payroll
-- ════════════════════════════════════════════════════════════════════
-- Goal:
--   * Tenant owners log in via Supabase email/password and own a terminal
--   * Many employees can clock in and use ONE terminal during a day,
--     each authenticated by a per-employee PIN
--   * Track clock-in / clock-out events for payroll
--   * Hourly pay rate per employee
--   * Payroll report (day / week / month)
-- ════════════════════════════════════════════════════════════════════

-- ── Extend users table ──────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_code TEXT;     -- short ID like 'EMP-001' for display
ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(8,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hired_at DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terminated_at DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT;

-- PIN already exists but we want it to be unique per-tenant when set
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_pin
  ON users(tenant_id, pin) WHERE pin IS NOT NULL AND pin <> '';


-- ── Time clock entries ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_clock_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id      UUID REFERENCES stores(id) ON DELETE SET NULL,
  terminal_id   UUID REFERENCES terminals(id) ON DELETE SET NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  clock_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out_at  TIMESTAMPTZ,                  -- NULL = still clocked in
  hourly_rate   NUMERIC(8,2),                 -- captured at clock-in for historical accuracy
  duration_min  INTEGER,                      -- computed on clock-out
  earned_amount NUMERIC(10,2),                -- duration_min/60 * hourly_rate

  edited_by_user_id UUID,                     -- manager who edited this row
  edit_note     TEXT,
  source        TEXT DEFAULT 'pos' CHECK (source IN ('pos','manual','import')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tce_user_dt ON time_clock_entries(user_id, clock_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_tce_open ON time_clock_entries(tenant_id, user_id) WHERE clock_out_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tce_tenant_dt ON time_clock_entries(tenant_id, clock_in_at DESC);


-- Auto-update updated_at
CREATE OR REPLACE FUNCTION fn_touch_tce() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_touch_tce ON time_clock_entries;
CREATE TRIGGER trg_touch_tce BEFORE UPDATE ON time_clock_entries
  FOR EACH ROW EXECUTE FUNCTION fn_touch_tce();


-- ── RPCs ────────────────────────────────────────────────────────────

-- Authenticate a PIN → returns user info if valid
CREATE OR REPLACE FUNCTION fn_pin_login(
  p_tenant_id UUID,
  p_pin       TEXT
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE v_u users%ROWTYPE; v_open UUID;
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

  -- Is this user currently clocked in?
  SELECT id INTO v_open FROM time_clock_entries
   WHERE user_id = v_u.id AND clock_out_at IS NULL
   ORDER BY clock_in_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id',           v_u.id,
      'name',         v_u.name,
      'role',         v_u.role,
      'email',        v_u.email,
      'employee_code',v_u.employee_code,
      'hourly_rate',  v_u.hourly_rate,
      'permissions',  COALESCE(v_u.permissions, '{}'::JSONB),
      'currently_clocked_in_entry', v_open
    )
  );
END;
$func$;


-- Clock-in
CREATE OR REPLACE FUNCTION fn_clock_in(
  p_tenant_id   UUID,
  p_user_id     UUID,
  p_store_id    UUID DEFAULT NULL,
  p_terminal_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE v_rate NUMERIC(8,2); v_id UUID; v_existing UUID;
BEGIN
  -- Reject if already clocked in
  SELECT id INTO v_existing FROM time_clock_entries
   WHERE user_id = p_user_id AND clock_out_at IS NULL
   ORDER BY clock_in_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Already clocked in', 'entry_id', v_existing);
  END IF;

  SELECT hourly_rate INTO v_rate FROM users WHERE id = p_user_id;

  v_id := gen_random_uuid();
  INSERT INTO time_clock_entries (
    id, tenant_id, store_id, terminal_id, user_id, hourly_rate
  ) VALUES (
    v_id, p_tenant_id, p_store_id, p_terminal_id, p_user_id, COALESCE(v_rate, 0)
  );

  RETURN jsonb_build_object('success', true, 'entry_id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- Clock-out
CREATE OR REPLACE FUNCTION fn_clock_out(
  p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_entry time_clock_entries%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_dur INTEGER;
  v_earn NUMERIC(10,2);
BEGIN
  SELECT * INTO v_entry FROM time_clock_entries
   WHERE user_id = p_user_id AND clock_out_at IS NULL
   ORDER BY clock_in_at DESC FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not currently clocked in');
  END IF;

  v_dur  := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_entry.clock_in_at))::INTEGER / 60);
  v_earn := ROUND(v_dur::NUMERIC / 60 * COALESCE(v_entry.hourly_rate, 0), 2);

  UPDATE time_clock_entries
     SET clock_out_at  = v_now,
         duration_min  = v_dur,
         earned_amount = v_earn
   WHERE id = v_entry.id;

  RETURN jsonb_build_object(
    'success', true, 'entry_id', v_entry.id,
    'duration_min', v_dur, 'earned_amount', v_earn
  );
END;
$func$;


-- Manager: edit a time-clock entry, recompute duration + earnings
CREATE OR REPLACE FUNCTION fn_edit_time_entry(
  p_entry_id    UUID,
  p_clock_in    TIMESTAMPTZ,
  p_clock_out   TIMESTAMPTZ,
  p_hourly_rate NUMERIC,
  p_editor_id   UUID,
  p_note        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE v_dur INTEGER; v_earn NUMERIC(10,2);
BEGIN
  IF p_clock_out IS NOT NULL AND p_clock_out <= p_clock_in THEN
    RETURN jsonb_build_object('success', false, 'message', 'Clock-out must be after clock-in');
  END IF;

  IF p_clock_out IS NOT NULL THEN
    v_dur  := GREATEST(0, EXTRACT(EPOCH FROM (p_clock_out - p_clock_in))::INTEGER / 60);
    v_earn := ROUND(v_dur::NUMERIC / 60 * COALESCE(p_hourly_rate, 0), 2);
  END IF;

  UPDATE time_clock_entries
     SET clock_in_at   = p_clock_in,
         clock_out_at  = p_clock_out,
         hourly_rate   = p_hourly_rate,
         duration_min  = v_dur,
         earned_amount = v_earn,
         edited_by_user_id = p_editor_id,
         edit_note     = COALESCE(p_note, edit_note),
         source        = 'manual'
   WHERE id = p_entry_id;

  RETURN jsonb_build_object('success', true, 'duration_min', v_dur, 'earned_amount', v_earn);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────
SELECT 'time_clock_entries' AS section, EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='time_clock_entries')::TEXT AS ok
UNION ALL SELECT 'users.hourly_rate', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='hourly_rate')::TEXT
UNION ALL SELECT 'fn_pin_login',        EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_pin_login')::TEXT
UNION ALL SELECT 'fn_clock_in',         EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_clock_in')::TEXT
UNION ALL SELECT 'fn_clock_out',        EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_clock_out')::TEXT
UNION ALL SELECT 'fn_edit_time_entry',  EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_edit_time_entry')::TEXT;
