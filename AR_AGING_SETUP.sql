-- ============================================================
-- 📊 A/R Aging report — 应收账款账龄
-- 复制全部 → Supabase SQL Editor → Run
-- 安全：可重复跑
-- ============================================================

-- A/R aging by customer — buckets by days overdue
CREATE OR REPLACE VIEW v_ar_aging_by_customer AS
SELECT
  bc.id                AS customer_id,
  bc.tenant_id,
  bc.company_name,
  bc.contact_name,
  bc.contact_email,
  bc.contact_phone,
  bc.payment_terms,
  COUNT(i.id)          AS invoice_count,
  COALESCE(SUM(i.balance_due), 0) AS total_owed,
  COALESCE(SUM(CASE
    WHEN i.due_date IS NULL OR i.due_date >= CURRENT_DATE
      THEN i.balance_due ELSE 0 END), 0) AS bucket_current,
  COALESCE(SUM(CASE
    WHEN i.due_date IS NOT NULL
     AND (CURRENT_DATE - i.due_date) BETWEEN 1 AND 30
      THEN i.balance_due ELSE 0 END), 0) AS bucket_1_30,
  COALESCE(SUM(CASE
    WHEN i.due_date IS NOT NULL
     AND (CURRENT_DATE - i.due_date) BETWEEN 31 AND 60
      THEN i.balance_due ELSE 0 END), 0) AS bucket_31_60,
  COALESCE(SUM(CASE
    WHEN i.due_date IS NOT NULL
     AND (CURRENT_DATE - i.due_date) BETWEEN 61 AND 90
      THEN i.balance_due ELSE 0 END), 0) AS bucket_61_90,
  COALESCE(SUM(CASE
    WHEN i.due_date IS NOT NULL
     AND (CURRENT_DATE - i.due_date) > 90
      THEN i.balance_due ELSE 0 END), 0) AS bucket_90_plus,
  MAX(CASE WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE
    THEN (CURRENT_DATE - i.due_date) ELSE 0 END) AS oldest_overdue_days
FROM business_customers bc
LEFT JOIN invoices i
  ON i.business_customer_id = bc.id
 AND i.status NOT IN ('paid', 'void', 'draft')
 AND COALESCE(i.balance_due, 0) > 0
WHERE bc.is_active = true
GROUP BY bc.id, bc.tenant_id, bc.company_name, bc.contact_name,
         bc.contact_email, bc.contact_phone, bc.payment_terms;

-- ✅ 完成
