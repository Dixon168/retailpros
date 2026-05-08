-- ============================================================
-- 🔧 修复：把没有 store_id 的旧 inventory 行迁移到默认店
-- 复制全部内容 → Supabase SQL Editor → 点 Run
-- 安全：可以重复跑（已经设过的不会再变）
--
-- 背景：以前 ReceiveModal 没传 store_id 就 insert，
-- 导致很多 inventory 行的 store_id 是 NULL，
-- POS 看得见但 Stock Center 看不见。
-- ============================================================

-- 找出每个租户的"主店"（最早创建的那一个），
-- 然后把这个租户所有 store_id IS NULL 的 inventory 行设到它名下。
-- 如果同一商品已经在主店有 inventory 行，就把数量合并过去。

-- Step 1: 合并 — 如果 NULL 行 + 主店行同时存在，先合并数量到主店行
WITH null_rows AS (
  SELECT i.id, i.tenant_id, i.product_id, i.quantity, i.avg_cost,
         (SELECT s.id FROM stores s
            WHERE s.tenant_id = i.tenant_id
            ORDER BY s.created_at LIMIT 1) AS main_store_id
  FROM inventory i
  WHERE i.store_id IS NULL
)
UPDATE inventory main
SET quantity = COALESCE(main.quantity, 0) + COALESCE(nr.quantity, 0),
    avg_cost = CASE
      WHEN COALESCE(main.quantity, 0) + COALESCE(nr.quantity, 0) = 0 THEN main.avg_cost
      ELSE ((COALESCE(main.avg_cost, 0) * COALESCE(main.quantity, 0))
          + (COALESCE(nr.avg_cost, 0)   * COALESCE(nr.quantity, 0)))
          / (COALESCE(main.quantity, 0) + COALESCE(nr.quantity, 0))
    END,
    updated_at = NOW()
FROM null_rows nr
WHERE main.tenant_id  = nr.tenant_id
  AND main.product_id = nr.product_id
  AND main.store_id   = nr.main_store_id;

-- Step 2: 删掉那些已经被合并过去的 NULL 行
DELETE FROM inventory i
WHERE i.store_id IS NULL
  AND EXISTS (
    SELECT 1 FROM inventory m
    WHERE m.tenant_id  = i.tenant_id
      AND m.product_id = i.product_id
      AND m.store_id  = (SELECT s.id FROM stores s
                          WHERE s.tenant_id = i.tenant_id
                          ORDER BY s.created_at LIMIT 1)
  );

-- Step 3: 剩下的 NULL 行（主店还没这商品的）→ 直接把 store_id 改成主店
UPDATE inventory i
SET store_id = (SELECT s.id FROM stores s
                  WHERE s.tenant_id = i.tenant_id
                  ORDER BY s.created_at LIMIT 1),
    updated_at = NOW()
WHERE i.store_id IS NULL;

-- ✅ 跑完看到 "Success"
-- 你的 Apple 这种应该就在 Stock Center 显示对的数字了
