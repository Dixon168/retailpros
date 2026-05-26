-- ════════════════════════════════════════════════════════════════════
-- Card top-up amount vs payment amount (promotions)
-- ════════════════════════════════════════════════════════════════════
-- Business need:
--   When selling or topping up a gift / member card, the amount that goes
--   ONTO the card (充值金额 / top-up amount) can differ from the cash the
--   customer actually PAYS (付款金额 / payment amount).
--
--   Example promo: "Top up $100, get $20 free" →
--     payment_amount = 100   (real cash → goes to financial income report)
--     topup_amount   = 120   (card balance increase → card usage data)
--     bonus          = 20    (marketing cost, derived = topup - payment)
--
--   gift_card_transactions.amount has always meant "how much the balance
--   changed" (= top-up amount). We keep that meaning and ADD paid_amount
--   so the two figures can diverge. bonus_amount is stored for reporting.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. New columns on the transaction log ──────────────────────────
ALTER TABLE gift_card_transactions
  ADD COLUMN IF NOT EXISTS paid_amount  NUMERIC(10,2);   -- cash the customer paid
ALTER TABLE gift_card_transactions
  ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC(10,2) DEFAULT 0;  -- free/promo amount

-- Backfill historical rows: assume they paid exactly what was loaded
-- (no promo), for issue/topup types. Redeems/refunds keep paid = NULL.
UPDATE gift_card_transactions
   SET paid_amount = amount, bonus_amount = 0
 WHERE paid_amount IS NULL AND type IN ('issue','topup');


-- ── 2. fn_create_gift_card — now takes card_type + payment amount ──
-- p_amount      = top-up amount (goes on the card)
-- p_paid_amount = cash paid (financial income); defaults to p_amount
-- p_card_type   = 'gift' or 'member'
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
  p_order_id       UUID DEFAULT NULL,
  p_paid_amount    NUMERIC DEFAULT NULL,
  p_card_type      TEXT DEFAULT 'gift'
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_card_id    UUID;
  v_expires    TIMESTAMPTZ;
  v_tenant_default INTEGER;
  v_paid       NUMERIC(10,2);
  v_bonus      NUMERIC(10,2);
  v_type       TEXT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Top-up amount must be > 0');
  END IF;
  IF TRIM(COALESCE(p_card_number, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Card number is required');
  END IF;
  IF EXISTS (SELECT 1 FROM member_cards WHERE tenant_id=p_tenant_id AND card_number=TRIM(p_card_number)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'A card with this number already exists');
  END IF;

  v_type  := CASE WHEN p_card_type = 'member' THEN 'member' ELSE 'gift' END;
  v_paid  := COALESCE(p_paid_amount, p_amount);     -- default: paid == loaded
  v_bonus := GREATEST(0, p_amount - v_paid);        -- free portion

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
    v_card_id, p_tenant_id, p_customer_id, TRIM(p_card_number), v_type,
    p_amount, p_amount, 'active', TRUE,
    v_expires, p_recipient_name, p_recipient_phone, p_note,
    p_user_id, p_order_id
  );

  INSERT INTO gift_card_transactions
    (tenant_id, card_id, type, amount, paid_amount, bonus_amount, balance_after, order_id, user_id, note)
  VALUES
    (p_tenant_id, v_card_id, 'issue', p_amount, v_paid, v_bonus, p_amount, p_order_id, p_user_id,
     COALESCE(p_note, 'Card issued'));

  RETURN jsonb_build_object(
    'success', true,
    'card_id', v_card_id,
    'card_number', TRIM(p_card_number),
    'card_type', v_type,
    'balance', p_amount,
    'paid_amount', v_paid,
    'bonus_amount', v_bonus,
    'expires_at', v_expires
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── 3. fn_topup_gift_card — now takes payment amount separately ────
CREATE OR REPLACE FUNCTION fn_topup_gift_card(
  p_tenant_id   UUID,
  p_card_number TEXT,
  p_amount      NUMERIC,
  p_user_id     UUID DEFAULT NULL,
  p_order_id    UUID DEFAULT NULL,
  p_note        TEXT DEFAULT NULL,
  p_paid_amount NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_c       member_cards%ROWTYPE;
  v_new_bal NUMERIC(10,2);
  v_paid    NUMERIC(10,2);
  v_bonus   NUMERIC(10,2);
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
    RETURN jsonb_build_object('success', false, 'message', 'Top-up amount must be > 0');
  END IF;

  v_paid  := COALESCE(p_paid_amount, p_amount);
  v_bonus := GREATEST(0, p_amount - v_paid);
  v_new_bal := COALESCE(v_c.balance, 0) + p_amount;

  UPDATE member_cards
     SET balance = v_new_bal,
         status  = 'active',
         expires_at = CASE WHEN v_c.expires_at IS NOT NULL AND v_c.expires_at < NOW()
                           THEN NULL ELSE v_c.expires_at END
   WHERE id = v_c.id;

  INSERT INTO gift_card_transactions
    (tenant_id, card_id, type, amount, paid_amount, bonus_amount, balance_after, order_id, user_id, note)
  VALUES
    (p_tenant_id, v_c.id, 'topup', p_amount, v_paid, v_bonus, v_new_bal, p_order_id, p_user_id, p_note);

  RETURN jsonb_build_object(
    'success', true,
    'card_id', v_c.id,
    'previous_balance', v_c.balance,
    'amount_added', p_amount,
    'paid_amount', v_paid,
    'bonus_amount', v_bonus,
    'balance', v_new_bal
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────
SELECT 'paid_amount col'  AS section,
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name='gift_card_transactions' AND column_name='paid_amount')::TEXT AS ok
UNION ALL SELECT 'bonus_amount col',
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name='gift_card_transactions' AND column_name='bonus_amount')::TEXT
UNION ALL SELECT 'fn_create_gift_card', EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_create_gift_card')::TEXT
UNION ALL SELECT 'fn_topup_gift_card',  EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_topup_gift_card')::TEXT;
