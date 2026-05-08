-- ============================================================
-- 💰 Receive Payment — 撤销收款功能
-- 复制全部 → Supabase SQL Editor → Run
-- 安全：可以重复跑
-- ============================================================

-- fn_void_payment — 撤销一笔收款
-- 把每张 invoice 的 amount_paid 减回去、status 重算、客户 credit_balance 加回去
-- 然后把整笔 received_payment + 所有 allocation 行删掉
CREATE OR REPLACE FUNCTION fn_void_payment(
  p_tenant_id  UUID,
  p_payment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_payment    RECORD;
  v_alloc      RECORD;
  v_inv        RECORD;
  v_new_paid   DECIMAL(10,2);
  v_new_status TEXT;
  v_total      DECIMAL(10,2);
BEGIN
  -- 1. Lock the payment
  SELECT * INTO v_payment FROM received_payments
   WHERE id = p_payment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Payment not found');
  END IF;

  v_total := v_payment.amount;

  -- 2. Walk allocations and reverse each
  FOR v_alloc IN
    SELECT * FROM payment_allocations WHERE payment_id = p_payment_id
  LOOP
    SELECT * INTO v_inv FROM invoices
     WHERE id = v_alloc.invoice_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_new_paid := GREATEST(COALESCE(v_inv.amount_paid, 0) - v_alloc.amount, 0);
    v_new_status :=
      CASE
        WHEN v_inv.status = 'void' THEN 'void'
        WHEN v_new_paid >= v_inv.total THEN 'paid'
        WHEN v_new_paid > 0           THEN 'partial'
        ELSE
          -- If status was 'paid' or 'partial' before, fall back to 'sent'
          -- (preserves draft if it was somehow draft)
          CASE WHEN v_inv.status IN ('paid','partial') THEN 'sent' ELSE v_inv.status END
      END;

    UPDATE invoices
       SET amount_paid = v_new_paid,
           balance_due = v_inv.total - v_new_paid,
           status      = v_new_status,
           updated_at  = NOW()
     WHERE id = v_alloc.invoice_id;
  END LOOP;

  -- 3. Restore customer credit_balance
  UPDATE business_customers
     SET credit_balance = COALESCE(credit_balance, 0) + v_total,
         updated_at = NOW()
   WHERE id = v_payment.business_customer_id;

  -- 4. Delete payment + allocations (CASCADE handles allocations)
  DELETE FROM received_payments WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success',        true,
    'payment_number', v_payment.payment_number,
    'amount_voided',  v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;


-- View — payments with customer name + alloc count
CREATE OR REPLACE VIEW v_payment_with_customer AS
SELECT
  p.*,
  bc.company_name,
  bc.contact_name AS customer_contact,
  (SELECT COUNT(*) FROM payment_allocations WHERE payment_id = p.id) AS allocation_count,
  (SELECT users.name FROM users WHERE users.id = p.received_by) AS received_by_name
FROM received_payments p
LEFT JOIN business_customers bc ON bc.id = p.business_customer_id;

-- ✅ 完成
