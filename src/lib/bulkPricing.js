// src/lib/bulkPricing.js
// Compute the cheapest combination of bundle tiers for a given quantity.
//
// A "bundle tier" represents a multi-buy deal like "3 for $21" or "2 for $18".
// Our algorithm greedily applies the largest profitable bundle first, then
// fills in smaller bundles or singles for the remainder. This matches what
// real-world supermarkets do: customers expect that buying 4 = 3-pack + 1
// single, never that buying 4 costs MORE per unit than buying 3.
//
// Bundle storage convention (in DB):
//   bulk_tiers: [
//     { min_qty: 2, type: 'bundle_total', value: 18 },  // "2 for $18"
//     { min_qty: 3, type: 'bundle_total', value: 21 },  // "3 for $21"
//   ]
//
// We also support the legacy 'pct' and 'flat' types for tiers (% off or per-
// unit price), but bundle_total is the recommended one for clarity:
//   { min_qty: 2, type: 'pct',  value: 10 }   → 10% off each at qty>=2
//   { min_qty: 3, type: 'flat', value: 7 }    → $7 each at qty>=3
//
// "1 for $10" is the regular unit price — it's never stored as a tier.

/**
 * Compute the bulk-priced line total for a given quantity.
 *
 * @param {number} qty             Quantity in cart
 * @param {number} unitPrice       Regular per-unit price (the "1 for $X" price)
 * @param {Array}  tiers           Bundle tiers from promotions.bulk_tiers
 * @returns {Object}               { lineTotal, breakdown, savings, hint }
 *   - lineTotal: final price for the line
 *   - breakdown: how the quantity was split into bundles, for receipt display
 *   - savings:   how much was saved vs. paying unit price × qty
 *   - hint:      { addQty, savings } if adding N more items would lower per-unit cost
 */
export function calculateBulkPrice(qty, unitPrice, tiers) {
  const absQty   = Math.abs(qty)
  const isReturn = qty < 0

  // No tiers, returns, or zero quantity → straight unit pricing
  if (!Array.isArray(tiers) || tiers.length === 0 || absQty === 0 || isReturn) {
    return {
      lineTotal: unitPrice * qty,
      breakdown: [{ count: qty, unitPrice, label: 'unit' }],
      savings: 0,
      hint: null,
    }
  }

  // Normalize tiers: only bundle_total / pct / flat are valid
  const valid = tiers
    .filter(t => t && t.min_qty >= 2 && t.value > 0)
    .map(t => ({
      min_qty: Number(t.min_qty),
      type:    t.type || 'bundle_total',
      value:   Number(t.value),
      // Effective per-unit price for tier comparison
      perUnit: tierPerUnit(t, unitPrice),
    }))
    .sort((a, b) => b.min_qty - a.min_qty)  // largest bundle first

  if (valid.length === 0) {
    return { lineTotal: unitPrice * qty, breakdown: [{ count: qty, unitPrice, label: 'unit' }], savings: 0, hint: null }
  }

  // Greedy split: pick the largest bundle that fits, repeat
  let remaining = absQty
  const breakdown = []
  let total = 0

  for (const tier of valid) {
    const bundleCount = Math.floor(remaining / tier.min_qty)
    if (bundleCount > 0) {
      const bundleTotal = bundleCount * tierBundlePrice(tier, unitPrice)
      breakdown.push({
        count:      bundleCount * tier.min_qty,
        bundleSize: tier.min_qty,
        bundleCount,
        unitPrice:  tier.perUnit,
        bundlePrice: tierBundlePrice(tier, unitPrice),
        label:      tierLabel(tier, unitPrice),
        tier,
      })
      total     += bundleTotal
      remaining -= bundleCount * tier.min_qty
    }
  }

  // Whatever's left is sold at unit price
  if (remaining > 0) {
    total += unitPrice * remaining
    breakdown.push({ count: remaining, unitPrice, label: 'single' })
  }

  const regularTotal = unitPrice * absQty
  const savings = Math.max(0, regularTotal - total)

  // Hint: would adding N more items reduce the per-unit cost?
  const hint = computeUpsellHint(absQty, unitPrice, valid)

  return {
    lineTotal: isReturn ? -total : total,
    breakdown,
    savings,
    hint,
  }
}


/**
 * Detect if the cashier should suggest "add N more to save $X".
 * Looks at the next-larger tier and checks if topping up to it
 * lowers the total cost per unit.
 */
function computeUpsellHint(qty, unitPrice, sortedTiers) {
  if (sortedTiers.length === 0) return null

  // Current best split
  const currentResult = greedySplit(qty, unitPrice, sortedTiers)

  // Try adding 1, 2, ... up to (largest tier size - 1) more items
  const maxAdd = Math.max(...sortedTiers.map(t => t.min_qty)) - 1
  for (let add = 1; add <= maxAdd; add++) {
    const newQty   = qty + add
    const newResult = greedySplit(newQty, unitPrice, sortedTiers)
    const costOfExtra = newResult - currentResult
    const wouldPayIfSingle = add * unitPrice
    // If adding `add` items costs LESS than `add * unitPrice` → there's a deal
    if (costOfExtra < wouldPayIfSingle - 0.01) {
      return {
        addQty:    add,
        newQty,
        newTotal:  newResult,
        savings:   wouldPayIfSingle - costOfExtra,
      }
    }
  }
  return null
}


/** Internal: greedy split returning just the total cost */
function greedySplit(qty, unitPrice, sortedTiers) {
  let remaining = qty
  let total = 0
  for (const tier of sortedTiers) {
    const bundles = Math.floor(remaining / tier.min_qty)
    if (bundles > 0) {
      total     += bundles * tierBundlePrice(tier, unitPrice)
      remaining -= bundles * tier.min_qty
    }
  }
  total += remaining * unitPrice
  return total
}


/** Per-unit price for a tier */
function tierPerUnit(tier, unitPrice) {
  if (tier.type === 'bundle_total') return tier.value / tier.min_qty
  if (tier.type === 'pct')          return unitPrice * (1 - tier.value / 100)
  if (tier.type === 'flat')         return tier.value
  return unitPrice
}


/** Total bundle price for one set of min_qty items */
function tierBundlePrice(tier, unitPrice) {
  if (tier.type === 'bundle_total') return tier.value
  if (tier.type === 'pct')          return tier.min_qty * unitPrice * (1 - tier.value / 100)
  if (tier.type === 'flat')         return tier.min_qty * tier.value
  return tier.min_qty * unitPrice
}


/** Human-readable label for a tier */
function tierLabel(tier, unitPrice) {
  if (tier.type === 'bundle_total') return `Buy ${tier.min_qty} for $${Number(tier.value).toFixed(2)}`
  if (tier.type === 'pct')          return `${tier.value}% off (buy ${tier.min_qty}+)`
  if (tier.type === 'flat')         return `$${Number(tier.value).toFixed(2)} each (buy ${tier.min_qty}+)`
  return `Buy ${tier.min_qty}+`
}


/**
 * Get the active bulk-pricing tiers for a cart item, looking at its
 * promotions array. Returns [] if no active bulk promo exists.
 *
 * Active = is_active && type === 'bulk' && (no dates or current within range)
 */
export function getActiveBulkTiers(item) {
  if (!item?.promotions) return []
  const promos = Array.isArray(item.promotions) ? item.promotions : [item.promotions]
  const now = new Date()
  for (const p of promos) {
    if (!p || p.is_active === false) continue
    if (p.type !== 'bulk') continue
    if (p.sale_start && new Date(p.sale_start) > now) continue
    if (p.sale_end   && new Date(p.sale_end)   < now) continue
    if (!Array.isArray(p.bulk_tiers) || p.bulk_tiers.length === 0) continue
    return p.bulk_tiers
  }
  return []
}
