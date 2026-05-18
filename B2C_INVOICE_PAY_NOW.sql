-- ════════════════════════════════════════════════════════════════════
-- fn_create_invoice_and_pay — one-shot create + send + receive payment
-- ════════════════════════════════════════════════════════════════════
-- For "customer is paying right now" scenarios. Wraps:
--   1. fn_create_invoice_atomic   (creates draft)
--   2. fn_send_invoice            (deducts inventory)
--   3. fn_receive_payment_atomic  (records payment)
-- All in one transaction — either everything succeeds or nothing does.
--
-- If p_payment_amount = 0 (or null), behaves like just create_invoice_atomic
-- (saves as draft, no send, no payment). Caller can choose later.
--
-- If 0 < p_payment_amount < total → invoice ends in 'partial' status.
-- If p_payment_amount >= total → invoice ends in 'paid' status.
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS fn_create_invoice_and_pay(
  UUID, UUID, UUID, DATE, TEXT, TEXT, UUID, JSONB, JSONB, JSONB, UUID, TEXT,
  DECIMAL, TEXT, TEXT, TEXT, DATE
);

CREATE FUNCTION fn_create_invoice_and_pay(
  p_tenant_id          UUID,
  p_store_id           UUID,
  p_customer_id        UUID,
  p_due_date           DATE,
  p_notes              TEXT,
  p_internal_notes     TEXT,
  p_created_by         UUID,
  p_items              JSONB,
  p_billing_addr       JSONB,
  p_shipping_addr      JSONB,
  p_source_estimate_id UUID,
  p_delivery_notes     TEXT,
  p_payment_amount     DECIMAL(10,2),
  p_payment_method     TEXT,
  p_payment_reference  TEXT,
  p_payment_notes      TEXT,
  p_payment_date       DATE
)
RETURNS JSONB
LANGUAGE plpgsql
AS $func$
DECLARE
  v_create_result    JSONB;
  v_send_result      JSONB;
  v_pay_result       JSONB;
  v_invoice_id       UUID;
  v_invoice_number   TEXT;
  v_total            DECIMAL(10,2);
  v_pay_amt          DECIMAL(10,2);
  v_allocations      JSONB;
BEGIN
  -- Step 1: Create draft
  v_create_result := fn_create_invoice_atomic(
    p_tenant_id, p_store_id, p_customer_id, p_due_date,
    p_notes, p_internal_notes, p_created_by,
    p_items, p_billing_addr, p_shipping_addr,
    p_source_estimate_id, p_delivery_notes
  );
  IF NOT (v_create_result->>'success')::BOOLEAN THEN
    RETURN v_create_result;
  END IF;

  v_invoice_id     := (v_create_result->>'invoice_id')::UUID;
  v_invoice_number := v_create_result->>'invoice_number';
  v_total          := (v_create_result->>'total')::DECIMAL;
  v_pay_amt        := COALESCE(p_payment_amount, 0);

  -- No payment requested — return after draft
  IF v_pay_amt <= 0 THEN
    RETURN jsonb_build_object(
      'success',        true,
      'invoice_id',     v_invoice_id,
      'invoice_number', v_invoice_number,
      'total',          v_total,
      'amount_paid',    0,
      'status',         'draft',
      'message',        'Draft saved (no payment).'
    );
  END IF;

  -- Step 2: Send (deducts inventory, with availability check)
  v_send_result := fn_send_invoice(p_tenant_id, v_invoice_id, p_created_by);
  IF NOT (v_send_result->>'success')::BOOLEAN THEN
    RAISE EXCEPTION 'Send failed: %', v_send_result->>'message';
  END IF;

  -- Step 3: Receive payment (cap at total)
  IF v_pay_amt > v_total THEN v_pay_amt := v_total; END IF;

  v_allocations := jsonb_build_array(
    jsonb_build_object('invoice_id', v_invoice_id, 'amount', v_pay_amt)
  );

  v_pay_result := fn_receive_payment_atomic(
    p_tenant_id, p_store_id, p_customer_id,
    COALESCE(p_payment_date, CURRENT_DATE),
    p_payment_method, p_payment_reference, p_payment_notes,
    p_created_by, v_allocations
  );
  IF NOT (v_pay_result->>'success')::BOOLEAN THEN
    RAISE EXCEPTION 'Payment failed: %', v_pay_result->>'message';
  END IF;

  RETURN jsonb_build_object(
    'success',          true,
    'invoice_id',       v_invoice_id,
    'invoice_number',   v_invoice_number,
    'total',            v_total,
    'amount_paid',      v_pay_amt,
    'balance_due',      v_total - v_pay_amt,
    'payment_number',   v_pay_result->>'payment_number',
    'status',           CASE WHEN v_pay_amt >= v_total THEN 'paid' ELSE 'partial' END,
    'message',          CASE WHEN v_pay_amt >= v_total
                          THEN 'Invoice created, sent, paid in full ✓'
                          ELSE format('Invoice created, sent. Partial payment applied. Balance: %s',
                                      (v_total - v_pay_amt)::TEXT)
                        END
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$func$;

INSERT INTO schema_migrations (id, description, notes) VALUES
  ('B2C_INVOICE_PAY_NOW', 'fn_create_invoice_and_pay one-shot create+send+pay', 'B2B UX')
ON CONFLICT (id) DO UPDATE SET applied_at = NOW();

NOTIFY pgrst, 'reload schema';

SELECT 'fn_create_invoice_and_pay exists' AS check,
       EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_create_invoice_and_pay')::TEXT AS ok;
