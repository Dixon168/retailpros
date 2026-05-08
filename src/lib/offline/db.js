// src/lib/offline/db.js
// Local IndexedDB schema (via Dexie) for offline POS support.
//
// Tables:
//   products_cache  — copy of products fetched from Supabase
//   inventory_cache — copy of inventory levels for current store
//   meta            — key/value: last_sync_at, terminal_id, etc.
//   offline_orders  — orders created while offline (Phase 3 — placeholder for now)
//   offline_queue   — pending sync operations (Phase 4 — placeholder for now)
//
// Phase 1+2: only products_cache + inventory_cache + meta are actively used.
// Tables for offline orders are declared but not yet written to.

import Dexie from 'dexie'

class POSDatabase extends Dexie {
  constructor() {
    super('retailpos_offline_v1')

    this.version(1).stores({
      // primary key is product id (uuid)
      products_cache:  'id, sku, name, type, category_id, tenant_id, is_active',
      // composite key: tenant_id + store_id + product_id
      inventory_cache: '[tenant_id+store_id+product_id], product_id, store_id, tenant_id',
      // simple key/value store
      meta:            'key',
      // offline orders — Phase 3
      offline_orders:  '++localId, temp_number, created_at, sync_status, tenant_id',
      // sync queue — Phase 4
      offline_queue:   '++id, kind, created_at, tries, last_error',
    })
  }
}

export const db = new POSDatabase()

// Convenience helpers
export const meta = {
  async get(key) {
    const row = await db.meta.get(key)
    return row?.value
  },
  async set(key, value) {
    await db.meta.put({ key, value })
  },
}
