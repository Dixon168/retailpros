-- ============================================================
-- RetailPOS — 平台管理补丁
-- 套餐配额 + Session互踢 + Impersonation日志 + 代理商预留
-- 在 Supabase SQL Editor 执行
-- ============================================================

-- ── 1. 套餐定义表（你随时可以改价格和配额）──
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,           -- 'solo' | 'team' | 'pro' | 'custom'
  name            TEXT NOT NULL,              -- 显示名称
  max_users       INTEGER NOT NULL,           -- 最大账号数
  max_terminals   INTEGER NOT NULL,           -- 最大终端数
  price_monthly   DECIMAL(10,2) NOT NULL,     -- 月价格（美元）
  price_yearly    DECIMAL(10,2),              -- 年价格（可选）
  features        JSONB DEFAULT '{}',         -- 功能开关，预留扩展
  is_active       BOOLEAN DEFAULT true,       -- 是否在前台展示
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO plans (id, name, max_users, max_terminals, price_monthly, price_yearly, sort_order)
VALUES
  ('solo',   'Solo',   1,  1,  29.00,  290.00, 1),
  ('team',   'Team',   3,  3,  79.00,  790.00, 2),
  ('pro',    'Pro',    6,  6, 149.00, 1490.00, 3),
  ('custom', 'Custom', 0,  0,   0.00,    0.00, 4)  -- 0 = 无限制，你手动设置
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE plans IS '套餐定义 - 你可以随时改价格和配额，立即生效';
COMMENT ON COLUMN plans.max_users IS '0 = 无限制（Custom套餐用）';
COMMENT ON COLUMN plans.max_terminals IS '0 = 无限制';

-- ── 2. tenants 表补充字段 ──
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_id          TEXT REFERENCES plans(id) DEFAULT 'solo';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_users        INTEGER DEFAULT 1;   -- 实际生效配额（覆盖套餐默认值）
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_terminals    INTEGER DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_suspended     BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notes            TEXT;               -- 平台备注（售后用）
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reseller_id      UUID;               -- 代理商ID（预留）
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS activated_at     TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days';

-- ── 3. 平台超级管理员表 ──
-- 与普通用户完全分离，不在 users 表里
CREATE TABLE IF NOT EXISTS platform_admins (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  password_hash TEXT,                         -- bcrypt，Supabase Auth管理
  role         TEXT DEFAULT 'admin',          -- 'super_admin' | 'admin' | 'support'
  reseller_id  UUID,                          -- 代理商绑定（预留）
  is_active    BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE platform_admins IS '平台管理员 - 与商家账号完全分离，不受RLS限制';

-- ── 4. 代理商表（预留，先建结构不做功能）──
CREATE TABLE IF NOT EXISTS resellers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  commission_pct DECIMAL(5,2) DEFAULT 0,      -- 佣金比例
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE resellers IS '代理商表 - 预留结构，暂不启用功能';

-- ── 5. 活跃 Session 表（用于互踢逻辑）──
CREATE TABLE IF NOT EXISTS active_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terminal_id   UUID REFERENCES terminals(id) ON DELETE SET NULL,
  terminal_name TEXT,
  session_token TEXT NOT NULL UNIQUE,         -- 随机token，登录时生成
  ip_address    TEXT,
  user_agent    TEXT,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '12 hours'
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user
  ON active_sessions(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_expires
  ON active_sessions(expires_at);

COMMENT ON TABLE active_sessions IS '活跃会话表 - 用于检测同一账号多处登录，实现互踢';

-- ── 6. Impersonation 日志（平台登录商家的记录）──
CREATE TABLE IF NOT EXISTS impersonation_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id),
  platform_admin_name TEXT,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_name     TEXT,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  duration_seconds INTEGER,
  actions_taken   JSONB DEFAULT '[]',         -- 记录做了什么操作
  reason          TEXT                        -- 售后原因备注
);

COMMENT ON TABLE impersonation_logs IS '平台模拟登录日志 - 记录平台人员进入商家账号的所有操作';

-- ── 7. 平台操作日志 ──
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         UUID REFERENCES platform_admins(id),
  action           TEXT NOT NULL,             -- 'tenant.create' | 'tenant.suspend' | 'quota.change' 等
  target_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  details          JSONB DEFAULT '{}',
  ip_address       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. 配额检查函数 ──

-- 检查是否可以创建新用户
CREATE OR REPLACE FUNCTION fn_check_user_quota(p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_tenant   tenants%ROWTYPE;
  v_plan     plans%ROWTYPE;
  v_count    INTEGER;
  v_max      INTEGER;
BEGIN
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  SELECT * INTO v_plan   FROM plans   WHERE id = v_tenant.plan_id;

  -- 实际配额：tenant.max_users 覆盖套餐默认（0=无限制）
  v_max := COALESCE(
    NULLIF(v_tenant.max_users, 0),
    NULLIF(v_plan.max_users, 0),
    999999
  );

  SELECT COUNT(*) INTO v_count
  FROM users
  WHERE tenant_id = p_tenant_id AND is_active = true;

  IF v_count >= v_max THEN
    RETURN jsonb_build_object(
      'allowed',  false,
      'current',  v_count,
      'max',      v_max,
      'plan',     v_tenant.plan_id,
      'message',  'User limit reached (' || v_count || '/' || v_max || '). Please upgrade your plan.'
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'current', v_count, 'max', v_max);
END;
$$;

-- 检查是否可以注册新终端
CREATE OR REPLACE FUNCTION fn_check_terminal_quota(p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_tenant   tenants%ROWTYPE;
  v_plan     plans%ROWTYPE;
  v_count    INTEGER;
  v_max      INTEGER;
BEGIN
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
  SELECT * INTO v_plan   FROM plans   WHERE id = v_tenant.plan_id;

  v_max := COALESCE(
    NULLIF(v_tenant.max_terminals, 0),
    NULLIF(v_plan.max_terminals, 0),
    999999
  );

  SELECT COUNT(*) INTO v_count
  FROM terminals
  WHERE tenant_id = p_tenant_id AND is_active = true;

  IF v_count >= v_max THEN
    RETURN jsonb_build_object(
      'allowed',  false,
      'current',  v_count,
      'max',      v_max,
      'plan',     v_tenant.plan_id,
      'message',  'Terminal limit reached (' || v_count || '/' || v_max || '). Please upgrade your plan.'
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'current', v_count, 'max', v_max);
END;
$$;

-- ── 9. 立即更新配额的函数（平台后台调用）──
CREATE OR REPLACE FUNCTION fn_platform_update_quota(
  p_tenant_id    UUID,
  p_plan_id      TEXT DEFAULT NULL,
  p_max_users    INTEGER DEFAULT NULL,
  p_max_terminals INTEGER DEFAULT NULL,
  p_admin_id     UUID DEFAULT NULL,
  p_reason       TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tenants SET
    plan_id       = COALESCE(p_plan_id,       plan_id),
    max_users     = COALESCE(p_max_users,     max_users),
    max_terminals = COALESCE(p_max_terminals, max_terminals),
    updated_at    = NOW()
  WHERE id = p_tenant_id;

  -- 记录平台操作日志
  INSERT INTO platform_audit_logs (admin_id, action, target_tenant_id, details)
  VALUES (p_admin_id, 'quota.update', p_tenant_id, jsonb_build_object(
    'plan_id',       p_plan_id,
    'max_users',     p_max_users,
    'max_terminals', p_max_terminals,
    'reason',        p_reason
  ));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── 10. Session 检查函数（登录时调用）──
CREATE OR REPLACE FUNCTION fn_check_session_conflict(
  p_user_id     UUID,
  p_tenant_id   UUID,
  p_new_token   TEXT,
  p_terminal_name TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_existing active_sessions%ROWTYPE;
BEGIN
  -- 清理过期 session
  DELETE FROM active_sessions WHERE expires_at < NOW();

  -- 查找该用户的活跃 session
  SELECT * INTO v_existing
  FROM active_sessions
  WHERE user_id   = p_user_id
    AND tenant_id = p_tenant_id
    AND expires_at > NOW()
  ORDER BY last_active_at DESC
  LIMIT 1;

  IF FOUND THEN
    -- 有冲突，返回冲突信息给前端决定
    RETURN jsonb_build_object(
      'conflict',       true,
      'existing_terminal', COALESCE(v_existing.terminal_name, 'Unknown terminal'),
      'last_active_at', v_existing.last_active_at,
      'session_id',     v_existing.id
    );
  END IF;

  -- 没有冲突，创建新 session
  INSERT INTO active_sessions
    (tenant_id, user_id, session_token, terminal_name)
  VALUES
    (p_tenant_id, p_user_id, p_new_token, p_terminal_name);

  RETURN jsonb_build_object('conflict', false);
END;
$$;

-- 踢掉旧 session（用户确认后调用）
CREATE OR REPLACE FUNCTION fn_kick_session(
  p_session_id UUID,
  p_user_id    UUID,
  p_new_token  TEXT,
  p_tenant_id  UUID,
  p_terminal_name TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  -- 删除旧 session
  DELETE FROM active_sessions WHERE id = p_session_id AND user_id = p_user_id;

  -- 创建新 session
  INSERT INTO active_sessions
    (tenant_id, user_id, session_token, terminal_name)
  VALUES
    (p_tenant_id, p_user_id, p_new_token, p_terminal_name);
END;
$$;

-- 登出时清理 session
CREATE OR REPLACE FUNCTION fn_end_session(p_session_token TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM active_sessions WHERE session_token = p_session_token;
END;
$$;

-- ── RLS ──
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own sessions"
  ON active_sessions FOR ALL
  USING (user_id = auth.uid());

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans are public readable"
  ON plans FOR SELECT USING (true);

SELECT 'Platform patch applied successfully' AS status;
