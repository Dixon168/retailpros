-- ════════════════════════════════════════════════════════════════════
-- Add item count + total ordered qty to the PO list view
-- so the Purchase Center order list can show "how much was ordered".
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_po_with_vendor AS
SELECT
  po.*,
  s.name         AS vendor_name,
  s.contact_name AS vendor_contact,
  s.phone        AS vendor_phone,
  s.email        AS vendor_email,
  COALESCE(agg.item_count, 0)    AS item_count,
  COALESCE(agg.total_qty, 0)     AS total_qty,
  COALESCE(agg.received_qty, 0)  AS received_qty
FROM purchase_orders po
LEFT JOIN suppliers s ON s.id = po.supplier_id
LEFT JOIN (
  SELECT po_id,
         COUNT(*)          AS item_count,
         SUM(quantity)     AS total_qty,
         SUM(received)     AS received_qty
  FROM purchase_order_items
  GROUP BY po_id
) agg ON agg.po_id = po.id;

NOTIFY pgrst, 'reload schema';
