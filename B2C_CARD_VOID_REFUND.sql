-- ════════════════════════════════════════════════════════════════════
-- Card top-up VOID / REFUND support
-- ════════════════════════════════════════════════════════════════════
-- When an order that loaded a card (gift or member) is voided or refunded,
-- we must REVERSE the top-up: pull the top-up amount back OFF the card and
-- refund the payment amount to the customer.
--
-- Policy (Dixon):
--   • Reverse the TOP-UP amount from the card balance (e.g. $120).
--   • Refund the PAYMENT amount to the customer (e.g. $100, editable in cart).
--   • Verify the card has enough balance to pull back the top-up first.
--       enough    → allowed.
--       not enough → blocked unless a manager override is given.
--   • Everything executes when the refund order is completed (cart flow).
--
-- This migration:
--   1. adds customer_topups.order_id (so a member top-up can be traced to
--      its order for reversal)
--   2. adds a fn_reverse_gift_card RPC (pull amount off a gift/member card
--      in member_cards, with an allow_negative flag for manager override)
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Trace member top-ups back to their order ────────────────────
ALTER TABLE customer_topups ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customer_topups_order ON customer_topups(order_id) WHERE order_id IS NOT NULL;


-- ── 2. Reverse a gift card top-up (pull amount back off the card) ──
-- p_allow_negative: when TRUE (manager override), allow the balance to go
-- below zero / below the amount; when FALSE, refuse if balance is short.
CREATE OR REPLACE FUNCTION fn_reverse_gift_card(
  p_tenant_id   UUID,
  p_card_number TEXT,
  p_amount      NUMERIC,                 -- top-up amount to pull back
  p_allow_negative BOOLEAN DEFAULT FALSE,
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
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be > 0');
  END IF;

  -- Balance check unless a manager override allows going negative
  IF COALESCE(v_c.balance,0) < p_amount AND NOT p_allow_negative THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Insufficient card balance to reverse — manager override required',
      'balance', v_c.balance,
      'needed',  p_amount
    );
  END IF;

  v_new_bal := COALESCE(v_c.balance, 0) - p_amount;

  UPDATE member_cards SET balance = v_new_bal WHERE id = v_c.id;

  INSERT INTO gift_card_transactions
    (tenant_id, card_id, type, amount, paid_amount, bonus_amount, balance_after, order_id, user_id, note)
  VALUES
    (p_tenant_id, v_c.id, 'void', -p_amount, NULL, 0, v_new_bal, p_order_id, p_user_id,
     COALESCE(p_note, 'Top-up reversed'));

  RETURN jsonb_build_object('success', true, 'card_id', v_c.id,
    'previous_balance', v_c.balance, 'amount_reversed', p_amount, 'balance', v_new_bal,
    'went_negative', v_new_bal < 0);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────
SELECT 'customer_topups.order_id' AS section,
  EXISTS(SELECT 1 FROM information_schema.columns
         WHERE table_name='customer_topups' AND column_name='order_id')::TEXT AS ok
UNION ALL SELECT 'fn_reverse_gift_card',
  EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_reverse_gift_card')::TEXT;
