-- ============================================================
-- RetailPOS — 终端管理 + PAX 刷卡机配置
-- 在 Supabase SQL Editor 执行
-- ============================================================

-- ── 1. 终端注册表 ──
CREATE TABLE IF NOT EXISTS terminals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  name                TEXT NOT NULL,              -- "Terminal 1" / "Front Counter"
  device_fingerprint  TEXT,                       -- 浏览器指纹，用于自动识别设备

  -- PAX 刷卡机配置（每台机器独立）
  pax_ip              TEXT,                       -- PAX 机器局域网 IP，如 192.168.1.50
  pax_port            INTEGER DEFAULT 10009,      -- PAX 默认端口
  pax_model           TEXT,                       -- 'A920' | 'A80' | 'S300' | 'E600' 等
  pax_enabled         BOOLEAN DEFAULT false,      -- 是否启用 PAX 刷卡

  -- 每台终端的支付方式配置
  accept_cash         BOOLEAN DEFAULT true,
  accept_card         BOOLEAN DEFAULT true,       -- 通过 PAX
  accept_check        BOOLEAN DEFAULT true,
  accept_member_card  BOOLEAN DEFAULT true,
  accept_on_account   BOOLEAN DEFAULT true,

  -- 当前状态
  is_active           BOOLEAN DEFAULT true,
  last_seen_at        TIMESTAMPTZ,
  current_cashier_id  UUID REFERENCES users(id),

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE terminals IS '收银终端表 - 每台机器独立注册，含PAX刷卡机IP配置';
COMMENT ON COLUMN terminals.pax_ip IS 'PAX机器的局域网IP地址，收银机直接HTTP调用此IP发起刷卡';
COMMENT ON COLUMN terminals.pax_port IS 'PAX HTTP端口，默认10009';
COMMENT ON COLUMN terminals.device_fingerprint IS '浏览器指纹，开机时自动匹配已注册终端';

-- ── 2. cash_drawers 加 terminal_id ──
ALTER TABLE cash_drawers ADD COLUMN IF NOT EXISTS terminal_id UUID REFERENCES terminals(id);
ALTER TABLE cash_drawers ADD COLUMN IF NOT EXISTS terminal_name TEXT; -- 冗余字段，报表用

-- ── 3. orders 记录来自哪台终端 ──
-- （terminal_id 已在 concurrency patch 里加了，这里加 terminal_name 冗余字段方便报表）
ALTER TABLE orders ADD COLUMN IF NOT EXISTS terminal_name TEXT;

-- ── 4. RLS ──
ALTER TABLE terminals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation on terminals"
  ON terminals FOR ALL
  USING (tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- ── 5. 更新时间触发器 ──
CREATE TRIGGER trg_terminals_updated_at
  BEFORE UPDATE ON terminals
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- ── 6. 终端心跳更新函数（每60秒调一次，记录在线状态）──
CREATE OR REPLACE FUNCTION fn_terminal_heartbeat(
  p_terminal_id UUID,
  p_cashier_id  UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE terminals
  SET
    last_seen_at       = NOW(),
    current_cashier_id = COALESCE(p_cashier_id, current_cashier_id)
  WHERE id = p_terminal_id;
END;
$$;

SELECT 'Terminals patch applied' AS status;
