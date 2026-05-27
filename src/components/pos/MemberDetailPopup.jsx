// src/components/pos/MemberDetailPopup.jsx
// In-POS member detail — reuses the SAME CustomerDetail component as the
// back-office Members page so the cashier sees the full thing: profile,
// purchase history (Transactions), Points + redemption history, Top-up
// history. Includes inline Edit (opens EditCustomerModal as a child).
// Closing returns to POS with cart state untouched.
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { CustomerDetail, EditCustomerModal, TopupModal } from '@/pages/customers/CustomersPage'
import { useCartStore } from '@/stores/cartStore'
import toast from 'react-hot-toast'

export default function MemberDetailPopup({ customer, tenantId, onClose }) {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [current, setCurrent] = useState(customer)
  const [showEdit, setShowEdit] = useState(false)
  const [showTopup, setShowTopup] = useState(false)

  // If the customer in the cart changes (rare), keep the popup in sync.
  useEffect(() => { setCurrent(customer) }, [customer?.id])

  if (!current) return null

  // Pull the fullest version of the record (in case the cart has a slim copy)
  const refresh = async () => {
    const { data } = await supabase.from('customers')
      .select('id,code,name,phone,email,loyalty_points,credit_balance,is_active,created_at,card_number,card_balance,card_expire_date,member_level,member_since,birthday,gender,tier,type,notes,address,referrer,notify_method')
      .eq('id', current.id).maybeSingle()
    if (data) {
      setCurrent(data)
      // Keep the cart's customer in sync so the cart bar reflects edits
      const { customer: cartCust, setCustomer } = useCartStore.getState()
      if (cartCust?.id === data.id && setCustomer) setCustomer(data)
      else if (cartCust?.id === data.id) useCartStore.setState({ customer: data })
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-3"
        style={{background:'rgba(0,0,0,0.55)', display: (showEdit || showTopup) ? 'none' : 'flex'}}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="rounded-2xl overflow-hidden shadow-xl flex flex-col w-[820px] max-w-[96vw] h-[88vh] max-h-[88vh]"
          style={{background:'#fff'}}>
          <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
            style={{background:'#000', color:'#fff'}}>
            <div className="text-[13px] font-bold">Member Details</div>
            <button onClick={onClose} title="Back to POS"
              className="text-[11px] font-bold px-3 py-1.5 rounded-md bg-white/15 border-none cursor-pointer text-white">
              ← Back to POS
            </button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{background:'#fafafa'}}>
            <CustomerDetail
              customer={current}
              tenantId={tenantId}
              userId={user?.id}
              userName={user?.name}
              onTopup={() => setShowTopup(true)}
              onEdit={() => setShowEdit(true)}
              onRefresh={refresh}
            />
          </div>
        </div>
      </div>

      {showEdit && (
        <EditCustomerModal
          customer={current}
          tenantId={tenantId}
          onSave={async () => {
            setShowEdit(false)
            await refresh()
            qc.invalidateQueries({ queryKey: ['customers'] })
            qc.invalidateQueries({ queryKey: ['customer-search'] })
            toast.success('Member updated')
          }}
          onClose={() => setShowEdit(false)}/>
      )}

      {showTopup && (
        <TopupModal
          customer={current}
          tenantId={tenantId}
          userId={user?.id}
          userName={user?.name}
          onSave={async () => {
            setShowTopup(false)
            await refresh()
            qc.invalidateQueries({ queryKey: ['customer-topups', current.id] })
          }}
          onClose={() => setShowTopup(false)}/>
      )}
    </>
  )
}
