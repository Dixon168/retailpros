// src/lib/promoProducts.js
// Centralised logic for the "products list" attached to a promotion.
// Conflict-checks against other active promos before adding; uses the
// fn_promo_conflicts SQL function so the DB is the source of truth.
import { supabase } from '@/lib/supabase'

/**
 * Check which product_ids are already in some OTHER active promotion.
 * @returns Array of { product_id, conflict_promo_id, conflict_promo_name }
 */
export async function findConflicts(tenantId, productIds, excludePromoId = null) {
  if (!productIds || productIds.length === 0) return []
  const { data, error } = await supabase.rpc('fn_promo_conflicts', {
    p_tenant_id:   tenantId,
    p_product_ids: productIds,
    p_exclude_id:  excludePromoId,
  })
  if (error) { console.error('fn_promo_conflicts error', error); return [] }
  return data || []
}

/**
 * Load the current product list for a promotion (with product details so
 * the editor can render names/SKUs).
 */
export async function loadPromoProducts(promotionId) {
  if (!promotionId) return []
  const { data, error } = await supabase.from('promotion_products')
    .select('product_id, added_at, added_via, products(id, name, sku, barcode, price, image_url, category_id)')
    .eq('promotion_id', promotionId)
  if (error) return []
  return (data || [])
    .filter(r => r.products)
    .map(r => ({ ...r.products, _added_via: r.added_via, _added_at: r.added_at }))
}

/**
 * Replace the entire product list of a promotion with the given ids.
 * Returns { added: n, removed: n } counts so the UI can confirm.
 * Conflict checking is the caller's responsibility (do it before save).
 */
export async function setPromoProducts(promotionId, products) {
  // products: array of { id, _added_via }
  const newIds = products.map(p => p.id)
  // Delete rows that are no longer in the list
  await supabase.from('promotion_products')
    .delete()
    .eq('promotion_id', promotionId)
    .not('product_id', 'in', `(${newIds.length ? newIds.map(id=>`"${id}"`).join(',') : '""'})`)
  // Upsert the new list
  if (newIds.length === 0) return { added: 0, removed: 0 }
  const rows = products.map(p => ({
    promotion_id: promotionId,
    product_id:   p.id,
    added_via:    p._added_via || 'manual',
  }))
  const { error } = await supabase.from('promotion_products')
    .upsert(rows, { onConflict: 'promotion_id,product_id' })
  if (error) throw error
  return { added: rows.length }
}

/**
 * Pull all products belonging to a category (and optionally its
 * subcategories). Used by the "Add by Category" snapshot button.
 */
export async function loadProductsByCategory(tenantId, categoryId) {
  if (!categoryId) return []
  const { data } = await supabase.from('products')
    .select('id, name, sku, barcode, price, image_url, category_id, is_active')
    .eq('tenant_id', tenantId)
    .eq('category_id', categoryId)
    .eq('is_active', true)
    .order('name')
  return data || []
}
