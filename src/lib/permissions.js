// src/lib/permissions.js
// Canonical permission catalog, grouped by feature area.
// The Roles management UI iterates this to render checkboxes.
//
// Each permission has a key (used in the DB JSONB), label, and optional
// description. Sensitive permissions are marked with `sensitive: true`
// so the UI can warn before enabling them.

export const PERMISSION_GROUPS = [
  {
    id:'pos',
    icon:'🛒',
    title:'POS — Cashier Workflow',
    description:'What the cashier can do at the register',
    items: [
      ['pos.access',          '🔓 Access POS terminal',     'Required to use the register at all'],
      ['pos.discount',        '✂️ Apply discounts',         'Manual %% or $ off the cart'],
      ['pos.price_override',  '💲 Override item price',     'Type a different price for an item'],
      ['pos.tip',             '🙏 Add tip',                  ''],
      ['pos.surcharge',       '💼 Add surcharge / fee',      ''],
      ['pos.tax_exempt',      '🏛️ Mark tax-exempt',         'Toggle tax off for the whole order'],
      ['pos.coupon',          '🎫 Use coupon codes',         ''],
      ['pos.points_redeem',   '⭐ Redeem loyalty points',    ''],
      ['pos.gift_card',       '🎁 Sell / top-up gift cards', ''],
      ['pos.refund',          '↩️ Process refunds',          'Both by-item and by-invoice', { sensitive:true }],
      ['pos.void',            '🚫 Void completed orders',    '', { sensitive:true }],
      ['pos.cash_drawer',     '💵 Open cash drawer',         'No-sale drawer open'],
      ['pos.hold_recall',     '📌 Hold / recall orders',     ''],
      ['pos.open_shift',      '☀️ Open shift',               'Enter opening float'],
      ['pos.close_shift',     '🌙 Close shift',              'Count cash + print Z-report', { sensitive:true }],
    ],
  },
  {
    id:'b2b',
    icon:'🏢',
    title:'B2B — Wholesale / Companies',
    description:'Business customer features',
    items: [
      ['b2b.access',     'Access B2B section',           ''],
      ['b2b.companies',  '🏢 Manage companies',           ''],
      ['b2b.estimates',  '📝 Create / send estimates',    ''],
      ['b2b.invoices',   '📄 Create / send invoices',     ''],
      ['b2b.payments',   '💰 Record B2B payments',        ''],
      ['b2b.ar_aging',   '💸 View A/R aging report',      ''],
    ],
  },
  {
    id:'inventory',
    icon:'📦',
    title:'Inventory & Products',
    description:'Stock and product management',
    items: [
      ['inventory.products',        '📦 Manage products',         'Add/edit/delete items'],
      ['inventory.categories',      '📁 Manage categories',       ''],
      ['inventory.stock_adjust',    '📊 Stock adjustments',        'Count, write-off, receive', { sensitive:true }],
      ['inventory.receive',         '🤖 Smart Receive',            ''],
      ['inventory.purchase_order',  '📋 Purchase Orders',          ''],
      ['inventory.barcode_print',   '🏷️ Print barcode labels',    ''],
    ],
  },
  {
    id:'reports',
    icon:'📊',
    title:'Reports & Payroll',
    description:'Reporting access — what they can see',
    items: [
      ['reports.view',       '📊 View reports',                ''],
      ['reports.financial',  '💰 Financial reports (P&L, tax)','', { sensitive:true }],
      ['reports.export',     '⬇ Export reports',              ''],
      ['reports.payroll',    '⏰ View payroll',                ''],
      ['payroll.view',       '👀 View own time-clock',         'See your own hours'],
      ['payroll.manage',     '✏️ Edit time-clock entries',     'Edit other people\'s hours', { sensitive:true }],
    ],
  },
  {
    id:'marketing',
    icon:'🎯',
    title:'Marketing & Loyalty',
    description:'Promotions and customer rewards',
    items: [
      ['marketing.promotions', '🎯 Promotions',          ''],
      ['loyalty.config',       '⭐ Loyalty config',      'Set redeem rate, etc.'],
      ['loyalty.adjust',       '🪙 Manually adjust points','', { sensitive:true }],
      ['customers.manage',     '👥 Manage customers',     'Add/edit customer profiles'],
    ],
  },
  {
    id:'settings',
    icon:'⚙️',
    title:'Settings',
    description:'System configuration — usually managers/owners only',
    items: [
      ['settings.store',     '🏪 Store info',            ''],
      ['settings.users',     '👤 Manage employees',      '', { sensitive:true }],
      ['settings.roles',     '🛡️ Manage roles & permissions', 'Edit this very page', { sensitive:true }],
      ['settings.tax',       '🧾 Tax rates',             ''],
      ['settings.coupons',   '🎫 Coupon config',         ''],
      ['settings.payment',   '💳 Payment / card processing','', { sensitive:true }],
      ['settings.terminals', '🖥️ Terminal config',       '', { sensitive:true }],
    ],
  },
]

// Flat list of all permission keys — used for "select all/none"
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.items.map(i => i[0]))

// Get human label for a key
export function labelFor(key) {
  for (const g of PERMISSION_GROUPS) {
    for (const i of g.items) {
      if (i[0] === key) return i[1]
    }
  }
  return key
}
