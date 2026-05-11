-- ════════════════════════════════════════════════════════════════════
-- PHASE 9 — Gift Cards (built on existing member_cards table)
-- ════════════════════════════════════════════════════════════════════
-- The member_cards table already has: card_number, balance, card_type
-- ('member' | 'gift'), is_active, customer_id. We just add the missing
-- bits: init_amount, expires_at, status enum, plus a tx log and 4 RPCs.
--
-- Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── PART 1: tenant setting for default expiry ──────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gift_card_default_expire_days INTEGER;
COMMENT ON COLUMN tenants.gift_card_default_expire_days IS
  'Days until a newly-issued gift card expires. NULL = never expires.';


-- ── PART 2: extend member_cards with gift-card columns ─────────────
ALTER TABLE member_cards ADD COLUMN IF NOT EXISTS init_amount   NUMERIC(10,2);
ALTER TABLE member_cards ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ;
ALTER TABLE member_cards ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'active';
ALTER TABLE member_cards ADD COLUMN IF NOT EXISTS issued_by_user UUID;
ALTER TABLE member_cards ADD COLUMN IF NOT EXISTS issued_by_order UUID REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE member_cards ADD COLUMN IF NOT EXISTS last_used_at  TIMESTAMPTZ;
ALTER TABLE member_cards ADD COLUMN IF NOT EXISTS recipient_name TEXT;
ALTER TABLE member_cards ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE member_cards ADD COLUMN IF NOT EXISTS note          TEXT;

-- Status constraint — only add if not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_cards_status_check') THEN
    ALTER TABLE member_cards ADD CONSTRAINT member_cards_status_check
      CHECK (status IN ('active','depleted','expired','voided'));
  END IF;
END $$;

-- Backfill init_amount + status for existing cards if any are still NULL
UPDATE member_cards
   SET init_amount = COALESCE(balance, 0)
 WHERE init_amount IS NULL;
UPDATE member_cards
   SET status = CASE
     WHEN is_active = FALSE THEN 'voided'
     WHEN balance <= 0 THEN 'depleted'
     ELSE 'active'
   END
 WHERE status IS NULL OR status = 'active' AND (NOT is_active OR balance <= 0);

CREATE INDEX IF NOT EXISTS idx_member_cards_number ON member_cards(tenant_id, card_number);
CREATE INDEX IF NOT EXISTS idx_member_cards_status ON member_cards(tenant_id, status);


-- ── PART 3: gift_card_transactions (history log) ────────────────────
CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  card_id       UUID NOT NULL REFERENCES member_cards(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('issue','redeem','topup','refund','void','adjust')),
  amount        NUMERIC(10,2) NOT NULL,
  balance_after NUMERIC(10,2) NOT NULL,
  order_id      UUID REFERENCES orders(id) ON DELETE SET NULL,
  user_id       UUID,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gct_card ON gift_card_transactions(card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gct_tenant_date ON gift_card_transactions(tenant_id, created_at DESC);


-- ── PART 4: RPCs ────────────────────────────────────────────────────

-- 4a. Lookup
CREATE OR REPLACE FUNCTION fn_lookup_gift_card(
  p_tenant_id   UUID,
  p_card_number TEXT
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE v_c member_cards%ROWTYPE; v_status TEXT;
BEGIN
  SELECT * INTO v_c FROM member_cards
   WHERE tenant_id = p_tenant_id AND card_number = TRIM(p_card_number) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Card not found');
  END IF;

  v_status := COALESCE(v_c.status, 'active');
  IF v_status = 'active' AND v_c.expires_at IS NOT NULL AND v_c.expires_at < NOW() THEN
    v_status := 'expired';
    UPDATE member_cards SET status = 'expired' WHERE id = v_c.id;
  END IF;
  IF v_status = 'active' AND COALESCE(v_c.balance,0) <= 0 THEN
    v_status := 'depleted';
    UPDATE member_cards SET status = 'depleted' WHERE id = v_c.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'card', jsonb_build_object(
      'id',             v_c.id,
      'card_number',    v_c.card_number,
      'card_type',      v_c.card_type,
      'init_amount',    v_c.init_amount,
      'balance',        v_c.balance,
      'status',         v_status,
      'expires_at',     v_c.expires_at,
      'issued_at',      v_c.created_at,
      'last_used_at',   v_c.last_used_at,
      'customer_id',    v_c.customer_id,
      'recipient_name', v_c.recipient_name,
      'recipient_phone',v_c.recipient_phone,
      'note',           v_c.note
    )
  );
END;
$func$;


-- 4b. Create
CREATE OR REPLACE FUNCTION fn_create_gift_card(
  p_tenant_id      UUID,
  p_card_number    TEXT,
  p_amount         NUMERIC,
  p_expire_days    INTEGER DEFAULT NULL,
  p_customer_id    UUID DEFAULT NULL,
  p_recipient_name TEXT DEFAULT NULL,
  p_recipient_phone TEXT DEFAULT NULL,
  p_note           TEXT DEFAULT NULL,
  p_user_id        UUID DEFAULT NULL,
  p_order_id       UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_card_id    UUID;
  v_expires    TIMESTAMPTZ;
  v_tenant_default INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be > 0');
  END IF;
  IF TRIM(COALESCE(p_card_number, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Card number is required');
  END IF;
  IF EXISTS (SELECT 1 FROM member_cards WHERE tenant_id=p_tenant_id AND card_number=TRIM(p_card_number)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'A card with this number already exists');
  END IF;

  IF p_expire_days IS NOT NULL THEN
    v_expires := NOW() + (p_expire_days || ' days')::INTERVAL;
  ELSE
    SELECT gift_card_default_expire_days INTO v_tenant_default FROM tenants WHERE id = p_tenant_id;
    IF v_tenant_default IS NOT NULL THEN
      v_expires := NOW() + (v_tenant_default || ' days')::INTERVAL;
    END IF;
  END IF;

  v_card_id := gen_random_uuid();
  INSERT INTO member_cards (
    id, tenant_id, customer_id, card_number, card_type,
    balance, init_amount, status, is_active,
    expires_at, recipient_name, recipient_phone, note,
    issued_by_user, issued_by_order
  ) VALUES (
    v_card_id, p_tenant_id, p_customer_id, TRIM(p_card_number), 'gift',
    p_amount, p_amount, 'active', TRUE,
    v_expires, p_recipient_name, p_recipient_phone, p_note,
    p_user_id, p_order_id
  );

  INSERT INTO gift_card_transactions
    (tenant_id, card_id, type, amount, balance_after, order_id, user_id, note)
  VALUES
    (p_tenant_id, v_card_id, 'issue', p_amount, p_amount, p_order_id, p_user_id, 'Card issued');

  RETURN jsonb_build_object(
    'success', true,
    'card_id', v_card_id,
    'card_number', TRIM(p_card_number),
    'balance', p_amount,
    'expires_at', v_expires
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- 4c. Redeem (partial OK, row-locked)
CREATE OR REPLACE FUNCTION fn_redeem_gift_card(
  p_tenant_id   UUID,
  p_card_number TEXT,
  p_amount      NUMERIC,
  p_user_id     UUID DEFAULT NULL,
  p_order_id    UUID DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_c member_cards%ROWTYPE;
  v_new_bal NUMERIC(10,2);
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_c FROM member_cards
   WHERE tenant_id = p_tenant_id AND card_number = TRIM(p_card_number)
   FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Card not found');
  END IF;
  IF v_c.expires_at IS NOT NULL AND v_c.expires_at < NOW() THEN
    UPDATE member_cards SET status='expired' WHERE id=v_c.id;
    RETURN jsonb_build_object('success', false, 'message', 'Card has expired');
  END IF;
  IF COALESCE(v_c.status, 'active') NOT IN ('active') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Card is ' || v_c.status);
  END IF;
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be > 0');
  END IF;
  IF p_amount > COALESCE(v_c.balance, 0) THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Insufficient balance ($' || COALESCE(v_c.balance,0)::TEXT || ' available)');
  END IF;

  v_new_bal := v_c.balance - p_amount;
  v_new_status := CASE WHEN v_new_bal <= 0 THEN 'depleted' ELSE 'active' END;

  UPDATE member_cards
     SET balance = v_new_bal,
         status = v_new_status,
         last_used_at = NOW()
   WHERE id = v_c.id;

  INSERT INTO gift_card_transactions
    (tenant_id, card_id, type, amount, balance_after, order_id, user_id, note)
  VALUES
    (p_tenant_id, v_c.id, 'redeem', -p_amount, v_new_bal, p_order_id, p_user_id, p_note);

  RETURN jsonb_build_object(
    'success', true,
    'card_id', v_c.id,
    'previous_balance', v_c.balance,
    'amount_used', p_amount,
    'balance', v_new_bal,
    'depleted', v_new_status = 'depleted'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- 4d. Top-up
CREATE OR REPLACE FUNCTION fn_topup_gift_card(
  p_tenant_id   UUID,
  p_card_number TEXT,
  p_amount      NUMERIC,
  p_user_id     UUID DEFAULT NULL,
  p_order_id    UUID DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE v_c member_cards%ROWTYPE; v_new_bal NUMERIC(10,2);
BEGIN
  SELECT * INTO v_c FROM member_cards
   WHERE tenant_id = p_tenant_id AND card_number = TRIM(p_card_number)
   FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Card not found');
  END IF;
  IF COALESCE(v_c.status,'active') = 'voided' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Card is voided — cannot top up');
  END IF;
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be > 0');
  END IF;

  v_new_bal := COALESCE(v_c.balance, 0) + p_amount;

  UPDATE member_cards
     SET balance = v_new_bal,
         status  = 'active',
         expires_at = CASE WHEN v_c.expires_at IS NOT NULL AND v_c.expires_at < NOW()
                           THEN NULL ELSE v_c.expires_at END
   WHERE id = v_c.id;

  INSERT INTO gift_card_transactions
    (tenant_id, card_id, type, amount, balance_after, order_id, user_id, note)
  VALUES
    (p_tenant_id, v_c.id, 'topup', p_amount, v_new_bal, p_order_id, p_user_id, p_note);

  RETURN jsonb_build_object(
    'success', true,
    'card_id', v_c.id,
    'previous_balance', v_c.balance,
    'amount_added', p_amount,
    'balance', v_new_bal
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── PART 5: PostgREST reload ────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ── VERIFY ──────────────────────────────────────────────────────────
SELECT 'member_cards.init_amount' AS section,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name='member_cards' AND column_name='init_amount')::TEXT AS ok
UNION ALL SELECT 'member_cards.expires_at',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name='member_cards' AND column_name='expires_at')::TEXT
UNION ALL SELECT 'member_cards.status',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name='member_cards' AND column_name='status')::TEXT
UNION ALL SELECT 'gift_card_transactions table',
       EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_name='gift_card_transactions')::TEXT
UNION ALL SELECT 'fn_lookup_gift_card',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='fn_lookup_gift_card')::TEXT
UNION ALL SELECT 'fn_create_gift_card',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='fn_create_gift_card')::TEXT
UNION ALL SELECT 'fn_redeem_gift_card',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='fn_redeem_gift_card')::TEXT
UNION ALL SELECT 'fn_topup_gift_card',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='fn_topup_gift_card')::TEXT
UNION ALL SELECT 'tenants.gift_card_default_expire_days',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name='tenants' AND column_name='gift_card_default_expire_days')::TEXT;
