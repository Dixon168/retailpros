// src/pages/pos/panels/CustomerPanel.jsx
// 客户搜索面板

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import { useAuthStore } from '@/stores/authStore'
import { Overlay } from './SerialPanel'

export default function CustomerPanel() {
  const { setCustomer } = useCartStore()
  const { tenant } = useAuthStore()
  const [search, setSearch] = useState('')

  const close = () => useCartStore.setState({ showCustPanel: false })

  // 搜索客户
  const { data: customers = [] } = useQuery({
    queryKey: ['customer-search', tenant?.id, search],
    queryFn: async () => {
      let q = supabase
        .from('customers')
        .select('id, code, name, company, phone, email, type, credit_balance, loyalty_points, credit_enabled')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)

      if (search) {
        q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%,code.ilike.%${search}%,company.ilike.%${search}%`)
      }

      const { data } = await q.order('name').limit(20)
      return data || []
    },
    enabled: !!tenant?.id
  })

  const handleSelect = (customer) => {
    setCustomer(customer)
    close()
  }

  return (
    <Overlay onClose={close}>
      <div className="bg-[#0d1117] border border-[#243347] rounded-2xl w-[460px] overflow-hidden">

        {/* Header + 搜索 */}
        <div className="px-5 py-4 border-b border-[#1e2d42]">
          <div className="text-[15px] font-bold mb-3">👥 Select Customer</div>
          <div className="flex items-center gap-2 bg-[#111827] border border-[#1e2d42]
            rounded-[9px] px-3 focus-within:border-purple-500/30 transition-colors">
            <span className="text-[#3d5068]">🔍</span>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, phone, or code..."
              className="flex-1 bg-transparent border-none outline-none py-2.5
                text-[13px] text-[#e8edf5] font-sans placeholder-[#3d5068]"
            />
          </div>
        </div>

        {/* 客户列表 */}
        <div className="max-h-[320px] overflow-y-auto px-3 py-2">
          {customers.length === 0 ? (
            <div className="text-center py-8 text-[#3d5068] text-sm">No customers found</div>
          ) : (
            customers.map(customer => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                onClick={() => handleSelect(customer)}
              />
            ))
          )}
        </div>

        {/* 新建客户 */}
        <div className="px-3 pb-3 pt-1 border-t border-[#1e2d42]">
          <button
            onClick={() => { close(); /* 打开新建客户表单 */ }}
            className="w-full bg-blue-500/10 border border-blue-500/20 rounded-lg
              py-2.5 text-[12px] text-blue-400 font-sans
              hover:bg-blue-500/15 transition-colors">
            + Add New Customer
          </button>
        </div>
      </div>
    </Overlay>
  )
}

function CustomerRow({ customer, onClick }) {
  const initials = customer.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-[9px] cursor-pointer
        hover:bg-[#111827] transition-colors"
    >
      {/* 头像 */}
      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[13px]
        font-bold text-white flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)' }}>
        {initials}
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">
          {customer.name}
          {customer.company && (
            <span className="text-[10px] text-[#3d5068] ml-1.5">· {customer.company}</span>
          )}
        </div>
        <div className="text-[10px] font-mono text-[#3d5068] mt-0.5">
          {customer.code} · {customer.phone || customer.email || '—'} · {customer.type}
        </div>
        <div className="flex gap-1.5 mt-1">
          {customer.credit_balance > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono
              bg-red-500/10 text-red-400">
              Owes ${customer.credit_balance.toFixed(2)}
            </span>
          )}
          {customer.loyalty_points > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono
              bg-purple-500/10 text-purple-400">
              {customer.loyalty_points} pts
            </span>
          )}
          {customer.type === 'vip' && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono
              bg-yellow-500/10 text-yellow-400">VIP</span>
          )}
        </div>
      </div>

      <span className="text-[#3d5068] text-sm">›</span>
    </div>
  )
}
