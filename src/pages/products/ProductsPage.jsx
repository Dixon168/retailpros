// src/pages/products/ProductsPage.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useProductsStore } from '@/stores/productsStore'
import { ProductForm } from './ProductForm'

const TYPE_BADGE = {
  unit:       { label: 'UNIT',    bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  weight:     { label: 'WEIGHT',  bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
  serialized: { label: 'SERIAL',  bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b' },
  service:    { label: 'SERVICE', bg: 'rgba(139,92,246,0.12)',  color: '#8b5cf6' },
}

export default function ProductsPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const { selectedProduct, setSelectedProduct } = useProductsStore()
  const [search, setSearch]       = useState('')
  const [filterType, setFilterType] = useState('all')
  const [showForm, setShowForm]   = useState(false)
  const [editProduct, setEditProduct] = useState(null)

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', tenant?.id, search, filterType],
    queryFn: async () => {
      let q = supabase.from('products')
        .select('*, inventory(quantity)')
        .eq('tenant_id', tenant.id).eq('is_active', true)
      if (search) q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%,barcode.ilike.%${search}%`)
      if (filterType !== 'all' && filterType !== 'low') q = q.eq('type', filterType)
      const { data } = await q.order('name').limit(200)
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const getQty = (p) => p.inventory?.reduce((a, i) => a + (i.quantity || 0), 0) || 0

  const displayed = filterType === 'low'
    ? products.filter(p => getQty(p) <= 5 && p.type !== 'service')
    : products

  const lowStock = products.filter(p => getQty(p) <= 5 && p.type !== 'service').length

  const handleDelete = async (id) => {
    if (!confirm('Archive this product?')) return
    await supabase.from('products').update({ is_active: false }).eq('id', id)
    qc.invalidateQueries(['products'])
  }

  const openAdd = () => { setEditProduct(null); setShowForm(true) }
  const openEdit = (p) => { setEditProduct(p); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setEditProduct(null) }

  return (
    <div className="flex h-full bg-[#07090f]">

      {/* Sidebar */}
      <div className="w-[190px] bg-[#0d1117] border-r border-[#1e2d42] p-3 flex-shrink-0">
        <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-widest px-2 mb-2">Type</div>
        {[
          ['all',        'All Products', null],
          ['unit',       'Unit',         '#3b82f6'],
          ['weight',     'Weight',       '#10b981'],
          ['serialized', 'Serialized',   '#f59e0b'],
          ['service',    'Service',      '#8b5cf6'],
        ].map(([id, label, color]) => (
          <div key={id} onClick={() => setFilterType(id)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer
              text-[12px] mb-0.5 transition-all ${
              filterType === id
                ? 'bg-blue-500/10 text-blue-400'
                : 'text-[#8899b0] hover:bg-[#111827] hover:text-white'
            }`}>
            {color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }}/>}
            {label}
          </div>
        ))}
        <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-widest px-2 mb-2 mt-4">Alerts</div>
        <div onClick={() => setFilterType('low')}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer
            text-[12px] mb-0.5 transition-all ${
            filterType === 'low'
              ? 'bg-red-500/10 text-red-400'
              : 'text-[#8899b0] hover:bg-[#111827]'
          }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0"/>
          Low Stock
          {lowStock > 0 && (
            <span className="ml-auto font-mono text-[10px] bg-red-500/10 text-red-400 px-1.5 rounded">
              {lowStock}
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#1e2d42]
          bg-[#0d1117] flex-shrink-0">
          <div className="flex gap-5 mr-2 flex-shrink-0">
            <div>
              <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-wider">Products</div>
              <div className="text-[18px] font-bold leading-tight">{products.length}</div>
            </div>
            <div>
              <div className="text-[9px] font-mono text-[#3d5068] uppercase tracking-wider">Low Stock</div>
              <div className="text-[18px] font-bold leading-tight text-red-400">{lowStock}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42]
            rounded-[9px] px-3 flex-1 focus-within:border-blue-500/40 transition-colors">
            <span className="text-[#3d5068]">🔍</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, SKU, barcode..."
              className="bg-transparent border-none outline-none text-[#e8edf5]
                text-[12px] py-2 flex-1 placeholder-[#3d5068]"
            />
          </div>

          <button onClick={openAdd}
            className="bg-blue-500 border-none rounded-lg px-4 py-2 text-[11px]
              font-bold text-white cursor-pointer hover:bg-blue-600 transition-colors flex-shrink-0">
            + Add Product
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#111827] border-b border-[#1e2d42]">
                {['','Product','SKU','Type','Stock','Price','Cost','Margin','Actions'].map((h, i) => (
                  <th key={i} className="px-3.5 py-2.5 text-left font-mono text-[10px]
                    text-[#3d5068] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array(8).fill(0).map((_, i) => (
                    <tr key={i} className="border-b border-[#1e2d42]">
                      {Array(9).fill(0).map((_, j) => (
                        <td key={j} className="px-3.5 py-3">
                          <div className="h-3 bg-[#111827] rounded animate-pulse"/>
                        </td>
                      ))}
                    </tr>
                  ))
                : displayed.length === 0
                ? (
                    <tr>
                      <td colSpan={9} className="text-center py-16 text-[#3d5068]">
                        <div className="text-4xl mb-3 opacity-20">📦</div>
                        <div className="text-[14px]">No products yet</div>
                        <button onClick={openAdd}
                          className="mt-3 bg-blue-500 border-none rounded-lg px-4 py-2
                            text-[11px] font-bold text-white cursor-pointer">
                          + Add your first product
                        </button>
                      </td>
                    </tr>
                  )
                : displayed.map(p => {
                    const tb = TYPE_BADGE[p.type] || TYPE_BADGE.unit
                    const qty = getQty(p)
                    const margin = p.price > 0 ? ((p.price - p.cost) / p.price * 100) : 0
                    const isLow = qty <= 5 && p.type !== 'service'
                    return (
                      <tr key={p.id}
                        className="border-b border-[#1e2d42] hover:bg-[#0d1117] transition-colors">
                        <td className="px-3.5 py-2.5 w-10">
                          <div className="w-8 h-8 rounded-[7px] bg-[#111827] border border-[#1e2d42]
                            flex items-center justify-center text-[15px]">
                            {p.emoji || '📦'}
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5">
                          <div className="text-[13px] font-semibold">{p.name}</div>
                          {p.description && (
                            <div className="text-[10px] text-[#3d5068] mt-0.5 truncate max-w-[200px]">
                              {p.description}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[11px] text-[#3d5068]">
                          {p.sku || '—'}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded"
                            style={{ background: tb.bg, color: tb.color }}>
                            {tb.label}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5">
                          {p.type === 'service'
                            ? <span className="text-[11px] text-[#3d5068]">—</span>
                            : (
                                <span className={`font-mono text-[12px] font-bold ${
                                  isLow ? 'text-red-400' : 'text-[#e8edf5]'
                                }`}>
                                  {isLow && <span className="text-red-400 mr-1">⚠</span>}
                                  {qty} {p.unit}
                                </span>
                              )
                          }
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[13px] font-bold text-blue-400">
                          ${parseFloat(p.price || 0).toFixed(2)}
                          {p.type === 'weight' && (
                            <span className="text-[9px] text-[#3d5068] ml-0.5">/{p.unit}</span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[11px] text-[#8899b0]">
                          ${parseFloat(p.cost || 0).toFixed(2)}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span className={`font-mono text-[11px] font-bold ${
                            margin >= 30 ? 'text-green-400' :
                            margin >= 10 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {margin.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5">
                          <div className="flex gap-1.5">
                            <button onClick={() => openEdit(p)}
                              className="text-[10px] bg-[#111827] border border-[#1e2d42]
                                rounded px-2 py-1 text-[#8899b0] cursor-pointer
                                hover:border-blue-500/30 hover:text-blue-400 transition-all">
                              Edit
                            </button>
                            <button onClick={() => handleDelete(p.id)}
                              className="text-[10px] bg-[#111827] border border-[#1e2d42]
                                rounded px-2 py-1 text-[#8899b0] cursor-pointer
                                hover:border-red-500/30 hover:text-red-400 transition-all">
                              Archive
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* Product Form Modal */}
      {showForm && (
        <ProductForm
          initial={editProduct || {}}
          tenantId={tenant?.id}
          onSave={() => {
            qc.invalidateQueries(['products'])
            closeForm()
          }}
          onClose={closeForm}
        />
      )}
    </div>
  )
}
