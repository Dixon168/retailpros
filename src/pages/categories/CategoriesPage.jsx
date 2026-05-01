// src/pages/categories/CategoriesPage.jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

const COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899','#14b8a6','#84cc16']
const EMOJIS = ['📁','🛒','📱','💻','🍎','🥛','🔧','👕','💊','🏠','🎮','📚','🚗','🎵','💄','🌿','🍕','☕','🔑','💎']

export default function CategoriesPage() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [selectedCat, setSelectedCat] = useState(null)
  const [showCatForm, setShowCatForm] = useState(false)
  const [showSubForm, setShowSubForm] = useState(false)
  const [editItem, setEditItem] = useState(null)

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories-full', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, emoji, color, sort_order, subcategories(id, name, emoji, sort_order)')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('sort_order')
      return data || []
    },
    enabled: !!tenant?.id,
  })

  const { data: subcatProducts = [] } = useQuery({
    queryKey: ['subcat-products', selectedCat?.id],
    queryFn: async () => {
      const subcatIds = selectedCat?.subcategories?.map(s => s.id) || []
      if (!subcatIds.length) return []
      const { data } = await supabase
        .from('products')
        .select('id, name, emoji, price, sort_order, subcategory_id')
        .in('subcategory_id', subcatIds)
        .eq('is_active', true)
        .order('sort_order')
      return data || []
    },
    enabled: !!selectedCat,
  })

  const saveCategory = async (form) => {
    if (form.id) {
      await supabase.from('categories').update({ name: form.name, emoji: form.emoji, color: form.color, sort_order: parseInt(form.sort_order)||0 }).eq('id', form.id)
      toast.success('Category updated')
    } else {
      await supabase.from('categories').insert({ tenant_id: tenant.id, name: form.name, emoji: form.emoji, color: form.color, sort_order: parseInt(form.sort_order)||0 })
      toast.success('Category created')
    }
    qc.invalidateQueries(['categories-full'])
    setShowCatForm(false)
    setEditItem(null)
  }

  const saveSubcategory = async (form) => {
    if (form.id) {
      await supabase.from('subcategories').update({ name: form.name, emoji: form.emoji, sort_order: parseInt(form.sort_order)||0 }).eq('id', form.id)
      toast.success('Subcategory updated')
    } else {
      await supabase.from('subcategories').insert({ tenant_id: tenant.id, category_id: selectedCat.id, name: form.name, emoji: form.emoji, sort_order: parseInt(form.sort_order)||0 })
      toast.success('Subcategory created')
    }
    qc.invalidateQueries(['categories-full'])
    setShowSubForm(false)
    setEditItem(null)
  }

  const deleteCategory = async (id) => {
    if (!confirm('Archive this category?')) return
    await supabase.from('categories').update({ is_active: false }).eq('id', id)
    if (selectedCat?.id === id) setSelectedCat(null)
    qc.invalidateQueries(['categories-full'])
    toast.success('Category archived')
  }

  const deleteSubcategory = async (id) => {
    if (!confirm('Archive this subcategory?')) return
    await supabase.from('subcategories').update({ is_active: false }).eq('id', id)
    qc.invalidateQueries(['categories-full'])
    toast.success('Subcategory archived')
  }

  const updateProductOrder = async (productId, newOrder) => {
    await supabase.from('products').update({ sort_order: parseInt(newOrder)||0 }).eq('id', productId)
    qc.invalidateQueries(['subcat-products'])
  }

  return (
    <div className="flex h-full bg-[#07090f]">

      {/* ── Column 1: Categories ── */}
      <div className="w-[280px] bg-[#0d1117] border-r border-[#1e2d42] flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-[#1e2d42] flex items-center justify-between">
          <div className="text-[13px] font-bold">Categories</div>
          <button onClick={() => { setEditItem(null); setShowCatForm(true) }}
            className="bg-blue-500 border-none rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white cursor-pointer">
            + Add
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading
            ? Array(4).fill(0).map((_,i) => <div key={i} className="h-14 bg-[#111827] rounded-[9px] mb-1.5 animate-pulse"/>)
            : categories.map(cat => {
                const subCount = cat.subcategories?.length || 0
                const prodCount = subcatProducts.filter(p => cat.subcategories?.some(s => s.id === p.subcategory_id)).length || 0
                return (
                  <div key={cat.id}
                    onClick={() => setSelectedCat(cat)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-[9px] cursor-pointer mb-1 transition-all ${
                      selectedCat?.id === cat.id
                        ? 'bg-[#1a2236] border border-[#243347]'
                        : 'hover:bg-[#111827] border border-transparent'
                    }`}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[16px] flex-shrink-0"
                      style={{ background: `${cat.color}22` }}>
                      {cat.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold truncate">{cat.name}</div>
                      <div className="text-[10px] text-[#3d5068] font-mono mt-0.5">
                        {subCount} sub · {prodCount} products
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditItem(cat); setShowCatForm(true) }}
                        className="text-[10px] text-[#3d5068] hover:text-blue-400 bg-transparent border-none cursor-pointer px-1">
                        ✏
                      </button>
                      <button onClick={() => deleteCategory(cat.id)}
                        className="text-[10px] text-[#3d5068] hover:text-red-400 bg-transparent border-none cursor-pointer px-1">
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })
          }
        </div>
      </div>

      {/* ── Column 2: Subcategories ── */}
      <div className="w-[260px] bg-[#0d1117] border-r border-[#1e2d42] flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-[#1e2d42] flex items-center justify-between">
          <div className="text-[13px] font-bold text-[#8899b0]">
            {selectedCat
              ? <span>
                  <span className="mr-1.5">{selectedCat.emoji}</span>
                  <span className="text-white">{selectedCat.name}</span>
                </span>
              : 'Select a category'
            }
          </div>
          {selectedCat && (
            <button onClick={() => { setEditItem(null); setShowSubForm(true) }}
              className="bg-cyan-500 border-none rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white cursor-pointer">
              + Add
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {!selectedCat ? (
            <div className="flex flex-col items-center justify-center h-full text-[#3d5068]">
              <div className="text-3xl mb-2 opacity-20">👈</div>
              <div className="text-[11px]">Select a category</div>
            </div>
          ) : (
            (selectedCat.subcategories || [])
              .filter(s => s.is_active !== false)
              .sort((a,b) => a.sort_order - b.sort_order)
              .map(sub => {
                const prodCount = subcatProducts.filter(p => p.subcategory_id === sub.id).length
                return (
                  <div key={sub.id}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-[9px] mb-1
                      hover:bg-[#111827] border border-transparent hover:border-[#1e2d42] transition-all group">
                    <span className="text-[16px]">{sub.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold truncate">{sub.name}</div>
                      <div className="text-[10px] text-[#3d5068] font-mono mt-0.5">
                        {prodCount} products · order {sub.sort_order}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditItem(sub); setShowSubForm(true) }}
                        className="text-[10px] text-[#3d5068] hover:text-blue-400 bg-transparent border-none cursor-pointer px-1">
                        ✏
                      </button>
                      <button onClick={() => deleteSubcategory(sub.id)}
                        className="text-[10px] text-[#3d5068] hover:text-red-400 bg-transparent border-none cursor-pointer px-1">
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })
          )}
        </div>
      </div>

      {/* ── Column 3: Products in subcategories ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-[#1e2d42] bg-[#0d1117] flex items-center justify-between">
          <div className="text-[13px] font-bold text-[#8899b0]">
            {selectedCat
              ? <span className="text-white">Products in <span style={{ color: selectedCat.color }}>{selectedCat.name}</span></span>
              : 'Products'
            }
          </div>
          <div className="text-[10px] font-mono text-[#3d5068]">
            Drag sort_order number to reorder products
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {!selectedCat ? (
            <div className="flex flex-col items-center justify-center h-full text-[#3d5068]">
              <div className="text-5xl mb-3 opacity-15">📦</div>
              <div className="text-[13px]">Select a category to see products</div>
            </div>
          ) : subcatProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#3d5068]">
              <div className="text-4xl mb-3 opacity-15">📭</div>
              <div className="text-[12px]">No products in this category</div>
              <div className="text-[11px] mt-1">Assign products from the Products page</div>
            </div>
          ) : (
            <div>
              {/* Group by subcategory */}
              {(selectedCat.subcategories || [])
                .filter(s => s.is_active !== false)
                .sort((a,b) => a.sort_order - b.sort_order)
                .map(sub => {
                  const prods = subcatProducts
                    .filter(p => p.subcategory_id === sub.id)
                    .sort((a,b) => a.sort_order - b.sort_order)
                  if (!prods.length) return null
                  return (
                    <div key={sub.id} className="mb-6">
                      <div className="flex items-center gap-2 mb-2.5">
                        <span className="text-[14px]">{sub.emoji}</span>
                        <span className="text-[12px] font-bold text-[#8899b0]">{sub.name}</span>
                        <span className="text-[10px] font-mono text-[#3d5068] ml-1">({prods.length})</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {prods.map((p, idx) => (
                          <div key={p.id}
                            className="flex items-center gap-3 bg-[#0d1117] border border-[#1e2d42]
                              rounded-[9px] px-4 py-2.5 hover:border-[#243347] transition-colors">
                            <span className="text-[#3d5068] font-mono text-[11px] w-5 text-center">
                              {idx + 1}
                            </span>
                            <span className="text-[16px]">{p.emoji || '📦'}</span>
                            <span className="flex-1 text-[12px] font-semibold">{p.name}</span>
                            <span className="font-mono text-[12px] text-blue-400">
                              ${parseFloat(p.price||0).toFixed(2)}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-[#3d5068]">Order:</span>
                              <input
                                type="number"
                                defaultValue={p.sort_order}
                                onBlur={e => updateProductOrder(p.id, e.target.value)}
                                className="w-12 bg-[#111827] border border-[#1e2d42] rounded px-2 py-1
                                  text-[11px] font-mono text-center outline-none focus:border-blue-500/40"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })
              }
            </div>
          )}
        </div>
      </div>

      {/* ── Category Form Modal ── */}
      {showCatForm && (
        <CategoryForm
          initial={editItem}
          onSave={saveCategory}
          onClose={() => { setShowCatForm(false); setEditItem(null) }}
        />
      )}

      {/* ── Subcategory Form Modal ── */}
      {showSubForm && selectedCat && (
        <SubcategoryForm
          initial={editItem}
          categoryName={selectedCat.name}
          onSave={saveSubcategory}
          onClose={() => { setShowSubForm(false); setEditItem(null) }}
        />
      )}
    </div>
  )
}

function CategoryForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    id:         initial?.id         || null,
    name:       initial?.name       || '',
    emoji:      initial?.emoji      || '📁',
    color:      initial?.color      || '#3b82f6',
    sort_order: initial?.sort_order || 0,
  })
  const set = (k,v) => setForm(p => ({...p,[k]:v}))

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[420px]" onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1e2d42] flex justify-between items-center">
          <div className="text-[15px] font-bold">{form.id ? '✏️ Edit Category' : '📁 New Category'}</div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Emoji</div>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map(e => (
                <button key={e} onClick={() => set('emoji', e)}
                  className={`w-8 h-8 rounded-lg text-[16px] border cursor-pointer transition-all ${
                    form.emoji===e ? 'border-blue-500/50 bg-blue-500/10' : 'border-[#1e2d42] bg-[#111827]'
                  }`}>{e}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Color</div>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button key={c} onClick={() => set('color', c)}
                  className={`w-7 h-7 rounded-full border-2 cursor-pointer transition-all ${
                    form.color===c ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ background: c }}/>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Name *</div>
              <input value={form.name} onChange={e=>set('name',e.target.value)} autoFocus placeholder="e.g. Electronics"
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] outline-none focus:border-blue-500/40 placeholder-[#3d5068]"/>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Sort Order</div>
              <input type="number" value={form.sort_order} onChange={e=>set('sort_order',e.target.value)}
                className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] font-mono outline-none focus:border-blue-500/40"/>
            </div>
          </div>
          {/* Preview */}
          <div className="flex items-center gap-3 bg-[#111827] border border-[#1e2d42] rounded-[9px] px-4 py-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[18px]"
              style={{ background: `${form.color}22` }}>{form.emoji}</div>
            <span className="text-[13px] font-semibold" style={{ color: form.color }}>{form.name || 'Category Name'}</span>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4">
          <button onClick={onClose} className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-2.5 text-[13px] text-[#8899b0] cursor-pointer">Cancel</button>
          <button onClick={() => { if(form.name.trim()) onSave(form); else toast.error('Name required') }}
            className="flex-[2] bg-blue-500 border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white cursor-pointer">
            {form.id ? '✓ Update' : '✓ Create Category'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SubcategoryForm({ initial, categoryName, onSave, onClose }) {
  const [form, setForm] = useState({
    id:         initial?.id         || null,
    name:       initial?.name       || '',
    emoji:      initial?.emoji      || '📂',
    sort_order: initial?.sort_order || 0,
  })
  const set = (k,v) => setForm(p => ({...p,[k]:v}))

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[380px]" onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1e2d42] flex justify-between items-center">
          <div>
            <div className="text-[15px] font-bold">{form.id ? '✏️ Edit Subcategory' : '📂 New Subcategory'}</div>
            <div className="text-[11px] text-[#3d5068] mt-0.5">Under: {categoryName}</div>
          </div>
          <button onClick={onClose} className="text-[#3d5068] hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-2">Emoji</div>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map(e => (
                <button key={e} onClick={() => set('emoji', e)}
                  className={`w-8 h-8 rounded-lg text-[16px] border cursor-pointer transition-all ${
                    form.emoji===e ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-[#1e2d42] bg-[#111827]'
                  }`}>{e}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Name *</div>
            <input value={form.name} onChange={e=>set('name',e.target.value)} autoFocus placeholder="e.g. Phones"
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] outline-none focus:border-cyan-500/40 placeholder-[#3d5068]"/>
          </div>
          <div>
            <div className="text-[10px] font-mono text-[#3d5068] uppercase tracking-wider mb-1.5">Sort Order</div>
            <input type="number" value={form.sort_order} onChange={e=>set('sort_order',e.target.value)}
              className="w-full bg-[#111827] border border-[#1e2d42] rounded-[9px] px-3.5 py-2.5 text-[13px] font-mono outline-none focus:border-cyan-500/40"/>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2 border-t border-[#1e2d42] pt-4">
          <button onClick={onClose} className="flex-1 bg-[#111827] border border-[#1e2d42] rounded-[9px] py-2.5 text-[13px] text-[#8899b0] cursor-pointer">Cancel</button>
          <button onClick={() => { if(form.name.trim()) onSave(form); else toast.error('Name required') }}
            className="flex-[2] bg-cyan-500 border-none rounded-[9px] py-2.5 text-[13px] font-bold text-white cursor-pointer">
            {form.id ? '✓ Update' : '✓ Create Subcategory'}
          </button>
        </div>
      </div>
    </div>
  )
}
