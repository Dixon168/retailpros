-- ╔════════════════════════════════════════════════════════════════╗
-- ║  RETAIL PRO — 今日全部数据库更新 (一次跑完)                       ║
-- ║  安全: 全部幂等写法, 重复跑不会出错. 跑完看最底部验证结果应全 true. ║
-- ╚════════════════════════════════════════════════════════════════╝


-- ████████████████████████████████████████████████████████████████
-- FILE: B2C_CARD_TOPUP_VS_PAYMENT.sql
-- ████████████████████████████████████████████████████████████████
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

-- ████████████████████████████████████████████████████████████████
-- FILE: B2C_MEMBER_FIELDS_AND_TOPUPS.sql
-- ████████████████████████████████████████████████████████████████
-- ════════════════════════════════════════════════════════════════════
-- Member (VIP) fields + member-card top-up history
-- ════════════════════════════════════════════════════════════════════
-- The Members page (customers) already references these columns and a
-- customer_topups table, but they were never created. This adds them.
--
-- Member cards are SEPARATE from gift cards (member_cards table). Member
-- cards live on the customer record: customers.card_number + card_balance.
-- Top-ups are logged in customer_topups, which (like gift cards) tracks
-- the top-up amount vs the payment amount so promos ("top up $100, get
-- $20 free") work: paid_amount = cash (financial income), amount = loaded
-- to card (balance / usage data), bonus = free.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Member fields on customers ──────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_number      TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_balance     NUMERIC(10,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_expire_date DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS member_level     TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS member_since     DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday         DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender           TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referrer         TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notify_method    TEXT;

-- One member card number per member (unique within a tenant when set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_card
  ON customers(tenant_id, card_number)
  WHERE card_number IS NOT NULL AND card_number <> '';

-- Lookups by phone (search a member by phone)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone
  ON customers(tenant_id, phone) WHERE phone IS NOT NULL;


-- ── 2. customer_topups — member-card top-up history ────────────────
CREATE TABLE IF NOT EXISTS customer_topups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount        NUMERIC(10,2) NOT NULL,            -- 充值金额 — loaded onto the card
  paid_amount   NUMERIC(10,2),                     -- 付款金额 — cash collected (income)
  bonus_amount  NUMERIC(10,2) DEFAULT 0,           -- free / promo amount
  method        TEXT DEFAULT 'cash',               -- cash | card | transfer
  balance_after NUMERIC(10,2),
  note          TEXT,
  staff_id      UUID,
  staff_name    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_topups_cust
  ON customer_topups(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_topups_tenant_dt
  ON customer_topups(tenant_id, created_at DESC);

-- If the table already existed (older build), make sure the new
-- promo columns are present too.
ALTER TABLE customer_topups ADD COLUMN IF NOT EXISTS paid_amount   NUMERIC(10,2);
ALTER TABLE customer_topups ADD COLUMN IF NOT EXISTS bonus_amount  NUMERIC(10,2) DEFAULT 0;
ALTER TABLE customer_topups ADD COLUMN IF NOT EXISTS balance_after NUMERIC(10,2);

-- Backfill paid_amount = amount for any old rows (no promo recorded)
UPDATE customer_topups SET paid_amount = amount WHERE paid_amount IS NULL;


-- ── 3. RLS (match the rest of the app: tenant-scoped) ──────────────
ALTER TABLE customer_topups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_topups_tenant ON customer_topups;
CREATE POLICY customer_topups_tenant ON customer_topups
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));


NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────
SELECT 'customers.card_number' AS section,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='card_number')::TEXT AS ok
UNION ALL SELECT 'customers.card_balance',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='card_balance')::TEXT
UNION ALL SELECT 'customers.birthday',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='birthday')::TEXT
UNION ALL SELECT 'customers.notify_method',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='notify_method')::TEXT
UNION ALL SELECT 'customer_topups table',
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='customer_topups')::TEXT
UNION ALL SELECT 'customer_topups.paid_amount',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customer_topups' AND column_name='paid_amount')::TEXT;

-- ████████████████████████████████████████████████████████████████
-- FILE: B2C_CARD_VOID_REFUND.sql
-- ████████████████████████████████████████████████████████████████
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

-- ████████████████████████████████████████████████████████████████
-- FILE: B2C_VOID_ORDER_RESTOCK.sql
-- ████████████████████████████████████████████████████████████████
-- ════════════════════════════════════════════════════════════════════
-- POS order void — restore inventory
-- ════════════════════════════════════════════════════════════════════
-- Policy (Dixon): when a POS order is voided, all the items it sold go
-- back into stock. Previously POS voids only flipped the order status and
-- did NOT restock (unlike invoice voids). This RPC restocks atomically.
--
-- It restores quantity per order_item (minus anything already returned),
-- skips non-inventory lines (services, card top-ups/reversals — these
-- have product_id NULL or product_type 'service'), and marks the order
-- voided. Serialized items are returned to 'in_stock'.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_void_order(
  p_tenant_id  UUID,
  p_order_id   UUID,
  p_user_id    UUID DEFAULT NULL,
  p_user_name  TEXT DEFAULT NULL,
  p_approved_by      UUID DEFAULT NULL,
  p_approved_by_name TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE
  v_store_id UUID; v_status TEXT; v_order_no TEXT; v_item RECORD; v_restocked INT := 0;
BEGIN
  SELECT store_id, status, order_number INTO v_store_id, v_status, v_order_no
    FROM orders WHERE id = p_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order not found');
  END IF;
  IF v_status = 'voided' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order already voided');
  END IF;

  -- Restore inventory for each real product line (skip services / cards /
  -- already-returned qty). order_items.quantity is what was sold; subtract
  -- returned_qty so we don't double-restock items already returned.
  FOR v_item IN
    SELECT product_id, serial_number,
           (quantity - COALESCE(returned_qty,0)) AS qty
      FROM order_items
     WHERE order_id = p_order_id
       AND product_id IS NOT NULL
       AND COALESCE(product_type,'product') <> 'service'
       AND (quantity - COALESCE(returned_qty,0)) > 0
  LOOP
    IF v_item.serial_number IS NOT NULL AND v_item.serial_number <> '' THEN
      -- Serialized: put the serial back in stock
      UPDATE serial_numbers SET status='in_stock', order_id=NULL
       WHERE tenant_id=p_tenant_id AND serial=v_item.serial_number;
    END IF;
    INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
    VALUES (p_tenant_id, v_item.product_id, v_store_id, v_item.qty)
    ON CONFLICT (tenant_id, product_id, store_id)
    DO UPDATE SET quantity = inventory.quantity + v_item.qty, updated_at = NOW();
    v_restocked := v_restocked + 1;
  END LOOP;

  UPDATE orders SET
      status = 'voided',
      voided_at = NOW(),
      voided_by = p_user_id,
      voided_by_name = p_user_name,
      voided_approved_by = p_approved_by,
      voided_approved_by_name = p_approved_by_name
   WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_number', v_order_no,
    'lines_restocked', v_restocked, 'message', 'Order voided — inventory restored');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;

NOTIFY pgrst, 'reload schema';

SELECT 'fn_void_order' AS section, EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_void_order')::TEXT AS ok;

-- ████████████████████████████████████████████████████████████████
-- FILE: B2C_ATOMIC_MEMBER_BALANCE.sql
-- ████████████████████████████████████████████████████████████████
-- ════════════════════════════════════════════════════════════════════
-- Atomic member-card balance changes (fix race condition)
-- ════════════════════════════════════════════════════════════════════
-- The member-card top-up / reversal was done client-side as read-then-
-- write (read balance, add, write back). Two registers topping up the
-- same member at once would overwrite each other and LOSE money. These
-- RPCs do the balance change atomically in the database with FOR UPDATE,
-- the same way gift cards already work, and log the customer_topups row
-- in the same transaction.
-- ════════════════════════════════════════════════════════════════════

-- ── Member top-up (atomic) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_member_topup(
  p_tenant_id   UUID,
  p_customer_id UUID,
  p_amount      NUMERIC,                 -- 充值金额 onto the card
  p_paid_amount NUMERIC DEFAULT NULL,    -- 付款金额 collected
  p_bonus       NUMERIC DEFAULT 0,
  p_user_id     UUID DEFAULT NULL,
  p_order_id    UUID DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE v_bal NUMERIC(10,2); v_new NUMERIC(10,2); v_paid NUMERIC(10,2);
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be > 0');
  END IF;
  SELECT COALESCE(card_balance,0) INTO v_bal FROM customers
   WHERE id = p_customer_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Member not found');
  END IF;
  v_paid := COALESCE(p_paid_amount, p_amount);
  v_new  := v_bal + p_amount;
  UPDATE customers SET card_balance = v_new WHERE id = p_customer_id;
  INSERT INTO customer_topups
    (tenant_id, customer_id, amount, paid_amount, bonus_amount, balance_after, method, note, staff_id, order_id)
  VALUES
    (p_tenant_id, p_customer_id, p_amount, v_paid, COALESCE(p_bonus,0), v_new,
     'order', p_note, p_user_id, p_order_id);
  RETURN jsonb_build_object('success', true, 'balance', v_new, 'previous_balance', v_bal);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── Member reversal (atomic) — pull a top-up back off the card ─────
CREATE OR REPLACE FUNCTION fn_member_reverse(
  p_tenant_id   UUID,
  p_customer_id UUID,
  p_amount      NUMERIC,                 -- top-up amount to pull back
  p_allow_negative BOOLEAN DEFAULT FALSE,
  p_user_id     UUID DEFAULT NULL,
  p_order_id    UUID DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $func$
DECLARE v_bal NUMERIC(10,2); v_new NUMERIC(10,2);
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be > 0');
  END IF;
  SELECT COALESCE(card_balance,0) INTO v_bal FROM customers
   WHERE id = p_customer_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Member not found');
  END IF;
  IF v_bal < p_amount AND NOT p_allow_negative THEN
    RETURN jsonb_build_object('success', false,
      'message', 'Insufficient card balance to reverse — manager override required',
      'balance', v_bal, 'needed', p_amount);
  END IF;
  v_new := v_bal - p_amount;
  UPDATE customers SET card_balance = v_new WHERE id = p_customer_id;
  INSERT INTO customer_topups
    (tenant_id, customer_id, amount, paid_amount, bonus_amount, balance_after, method, note, staff_id, order_id)
  VALUES
    (p_tenant_id, p_customer_id, -p_amount, NULL, 0, v_new, 'reversal', p_note, p_user_id, p_order_id);
  RETURN jsonb_build_object('success', true, 'balance', v_new, 'went_negative', v_new < 0);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- ── Card-activation failures log (financial safety net) ────────────
-- If a card load/reversal can't complete after the sale is already
-- finalized, we record it here so nothing is silently lost and staff can
-- reconcile. (The UI also alerts the cashier.)
CREATE TABLE IF NOT EXISTS card_activation_failures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id    UUID,
  order_number TEXT,
  kind        TEXT,                    -- topup | reversal
  card_kind   TEXT,                    -- gift | member
  detail      JSONB,                   -- the cardTopup / cardReversal payload
  error       TEXT,
  resolved    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE card_activation_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS caf_tenant ON card_activation_failures;
CREATE POLICY caf_tenant ON card_activation_failures
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));


-- ── Atomic inventory restore (used by product refunds) ─────────────
CREATE OR REPLACE FUNCTION fn_restore_inventory(
  p_tenant_id  UUID,
  p_product_id UUID,
  p_store_id   UUID,
  p_qty        NUMERIC
) RETURNS JSONB LANGUAGE plpgsql AS $func$
BEGIN
  IF p_product_id IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;
  INSERT INTO inventory (tenant_id, product_id, store_id, quantity)
  VALUES (p_tenant_id, p_product_id, p_store_id, p_qty)
  ON CONFLICT (tenant_id, product_id, store_id)
  DO UPDATE SET quantity = inventory.quantity + p_qty, updated_at = NOW();
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


NOTIFY pgrst, 'reload schema';

SELECT 'fn_member_topup'   AS section, EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_member_topup')::TEXT AS ok
UNION ALL SELECT 'fn_member_reverse', EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_member_reverse')::TEXT
UNION ALL SELECT 'fn_restore_inventory', EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_restore_inventory')::TEXT
UNION ALL SELECT 'card_activation_failures', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='card_activation_failures')::TEXT;
