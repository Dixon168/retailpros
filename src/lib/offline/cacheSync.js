// src/lib/offline/cacheSync.js
// Pulls products + inventory from Supabase into IndexedDB so they're
// available when offline.
//
// Strategy:
//   - On boot (after auth ready): full sync
//   - Every 5 minutes while online: incremental sync (using updated_at)
//   - On manual trigger (e.g. after editing a product): immediate refresh
//
// We don't need realtime for this. Stale-by-5-min is fine for offline use.

import { supabase } from '@/lib/supabase'
import { db, meta } from './db'

const FULL_SYNC_BATCH = 1000
const INCREMENTAL_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes

let _activeSync = null
let _scheduledTimer = null

// ─────────────────────────────────────────────────────────────
// Internal: load all products in pages of 1000
// ─────────────────────────────────────────────────────────────
async function fetchAllProducts(tenantId) {
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, barcode, price, cost, type, category_id, tenant_id, is_active, image_url, low_stock_qty, updated_at')
      .eq('tenant_id', tenantId)
      .order('id')
      .range(from, from + FULL_SYNC_BATCH - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < FULL_SYNC_BATCH) break
    from += FULL_SYNC_BATCH
  }
  return all
}

async function fetchAllInventory(tenantId, storeId) {
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await supabase
      .from('inventory')
      .select('product_id, store_id, tenant_id, quantity, updated_at')
      .eq('tenant_id', tenantId)
      .eq('store_id', storeId)
      .order('product_id')
      .range(from, from + FULL_SYNC_BATCH - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < FULL_SYNC_BATCH) break
    from += FULL_SYNC_BATCH
  }
  return all
}

// ─────────────────────────────────────────────────────────────
// Public: full snapshot
// ─────────────────────────────────────────────────────────────
async function performFullSync({ tenantId, storeId }) {
  const start = Date.now()
  const [products, inventory] = await Promise.all([
    fetchAllProducts(tenantId),
    fetchAllInventory(tenantId, storeId),
  ])
  await db.transaction('rw', [db.products_cache, db.inventory_cache], async () => {
    await db.products_cache.clear()
    await db.inventory_cache.clear()
    if (products.length)  await db.products_cache.bulkPut(products)
    if (inventory.length) await db.inventory_cache.bulkPut(inventory)
  })
  await meta.set('last_full_sync_at', new Date().toISOString())
  await meta.set('last_incremental_sync_at', new Date().toISOString())
  await meta.set('cache_tenant_id', tenantId)
  await meta.set('cache_store_id', storeId)
  console.log(`[OfflineCache] Full sync done in ${Date.now() - start}ms — ${products.length} products, ${inventory.length} inventory rows`)
  return { products: products.length, inventory: inventory.length, ms: Date.now() - start }
}

// ─────────────────────────────────────────────────────────────
// Public: incremental (since last sync)
// ─────────────────────────────────────────────────────────────
async function performIncrementalSync({ tenantId, storeId }) {
  const since = await meta.get('last_incremental_sync_at')
  if (!since) {
    return performFullSync({ tenantId, storeId })
  }
  const start = Date.now()

  const [{ data: prods, error: pe }, { data: inv, error: ie }] = await Promise.all([
    supabase.from('products')
      .select('id, name, sku, barcode, price, cost, type, category_id, tenant_id, is_active, image_url, low_stock_qty, updated_at')
      .eq('tenant_id', tenantId).gt('updated_at', since).limit(2000),
    supabase.from('inventory')
      .select('product_id, store_id, tenant_id, quantity, updated_at')
      .eq('tenant_id', tenantId).eq('store_id', storeId)
      .gt('updated_at', since).limit(5000),
  ])
  if (pe) throw pe
  if (ie) throw ie

  if (prods?.length) await db.products_cache.bulkPut(prods)
  if (inv?.length)   await db.inventory_cache.bulkPut(inv)
  await meta.set('last_incremental_sync_at', new Date().toISOString())

  if (prods?.length || inv?.length) {
    console.log(`[OfflineCache] Incremental: +${prods?.length || 0} products, +${inv?.length || 0} inventory in ${Date.now() - start}ms`)
  }
  return { products: prods?.length || 0, inventory: inv?.length || 0 }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Trigger a sync now if not already in progress. Decides automatically
 * whether full or incremental based on whether we have any cache.
 */
export async function syncNow({ tenantId, storeId, full = false }) {
  if (_activeSync) return _activeSync
  if (!tenantId || !storeId) return null

  // If tenant/store changed, force a full re-sync
  const [cachedTenant, cachedStore] = await Promise.all([
    meta.get('cache_tenant_id'),
    meta.get('cache_store_id'),
  ])
  if (cachedTenant !== tenantId || cachedStore !== storeId) {
    full = true
  }

  const productCount = await db.products_cache.count()
  const wantFull = full || productCount === 0

  _activeSync = (wantFull
    ? performFullSync({ tenantId, storeId })
    : performIncrementalSync({ tenantId, storeId })
  ).finally(() => { _activeSync = null })
  return _activeSync
}

/**
 * Schedule periodic incremental syncs. Safe to call multiple times.
 */
export function startBackgroundSync({ tenantId, storeId }) {
  stopBackgroundSync()
  _scheduledTimer = setInterval(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    syncNow({ tenantId, storeId }).catch(e => {
      // Silent fail — UI doesn't need to know about background sync errors
      console.warn('[OfflineCache] Background sync failed:', e?.message)
    })
  }, INCREMENTAL_INTERVAL_MS)
}

export function stopBackgroundSync() {
  if (_scheduledTimer) clearInterval(_scheduledTimer)
  _scheduledTimer = null
}

/**
 * Get cache statistics for display in UI.
 */
export async function getCacheStats() {
  const [productCount, inventoryCount, lastFull, lastInc] = await Promise.all([
    db.products_cache.count(),
    db.inventory_cache.count(),
    meta.get('last_full_sync_at'),
    meta.get('last_incremental_sync_at'),
  ])
  return { productCount, inventoryCount, lastFull, lastInc }
}

/**
 * Clear all cached data — used on logout.
 */
export async function clearCache() {
  await db.transaction('rw', [db.products_cache, db.inventory_cache, db.meta], async () => {
    await db.products_cache.clear()
    await db.inventory_cache.clear()
    await db.meta.clear()
  })
  console.log('[OfflineCache] Cache cleared')
}
