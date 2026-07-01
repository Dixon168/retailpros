// src/pages/business/CompanyDetailPage.jsx
// Phase 3: Full company drill-down page with 7 tabs.
// Replaces the CustomerHistoryModal (which was a modal).
// URL: /business/:id

import { useState, useMemo, lazy, Suspense } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import toast from 'react-hot-toast'

import OverviewTab from './tabs/OverviewTab'
import InvoicesTab from './tabs/InvoicesTab'
import PaymentsTab from './tabs/PaymentsTab'
import ContactsTab from './tabs/ContactsTab'
import AddressesTab from './tabs/AddressesTab'
import PaymentMethodsTab from './tabs/PaymentMethodsTab'
import NotesTab from './tabs/NotesTab'

import ReceivePaymentModal from '@/pages/invoices/ReceivePaymentModal'
import CreateInvoiceModal from '@/pages/invoices/CreateInvoiceModal'
import CreateEstimateModal from '@/pages/estimates/CreateEstimateModal'

const TABS = [
  { key: 'overview',  label: 'Overview',         icon: '📊' },
  { key: 'invoices',  label: 'Invoices',         icon: '📄' },
  { key: 'payments',  label: 'Payments',         icon: '💰' },
  { key: 'contacts',  label: 'Contacts',         icon: '👥' },
  { key: 'addresses', label: 'Addresses',        icon: '📍' },
  { key: 'methods',   label: 'Payment Methods',  icon: '💳' },
  { key: 'notes',     label: 'Notes',            icon: '📝' },
]

export default function CompanyDetailPage() {
  const { id: customerId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const { tenant } = useAuthStore()

  const currentTab = searchParams.get('tab') || 'overview'
  const setTab = (key) => {
    if (key === 'overview') searchParams.delete('tab')
    else searchParams.set('tab', key)
    setSearchParams(searchParams, { replace: true })
  }

  const [showReceive, setShowReceive]     = useState(false)
  const [showCreateInv, setShowCreateInv] = useState(false)
  const [showCreateEst, setShowCreateEst] = useState(false)

  // ── Load company + financial summary ──
  const { data: company, isLoading } = useQuery({
    queryKey: ['company-detail', customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_business_customer_list')
        .select('*')
        .eq('id', customerId)
        .single()
      if (error) console.error('[Company] Load error:', error)
      return data
    },
    enabled: !!customerId,
  })

  // ── Pinned/alert notes for top banner ──
  const { data: alertNotes = [] } = useQuery({
    queryKey: ['company-alert-notes', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('business_notes')
        .select('*').eq('business_customer_id', customerId).eq('is_alert', true)
      return data || []
    },
    enabled: !!customerId,
  })

  // ── Tab counts (for badge numbers) ──
  const { data: counts } = useQuery({
    queryKey: ['company-tab-counts', customerId],
    queryFn: async () => {
      const [inv, pay, con, addr, pm, notes] = await Promise.all([
        supabase.from('invoices').select('id', { count:'exact', head:true }).eq('business_customer_id', customerId),
        supabase.from('received_payments').select('id', { count:'exact', head:true }).eq('business_customer_id', customerId),
        supabase.from('business_contacts').select('id', { count:'exact', head:true }).eq('business_customer_id', customerId),
        supabase.from('business_addresses').select('id', { count:'exact', head:true }).eq('business_customer_id', customerId),
        supabase.from('business_payment_methods').select('id', { count:'exact', head:true }).eq('business_customer_id', customerId).eq('is_active', true),
        supabase.from('business_notes').select('id', { count:'exact', head:true }).eq('business_customer_id', customerId),
      ])
      return {
        invoices:  inv.count   || 0,
        payments:  pay.count   || 0,
        contacts:  con.count   || 0,
        addresses: addr.count  || 0,
        methods:   pm.count    || 0,
        notes:     notes.count || 0,
      }
    },
    enabled: !!customerId,
  })

  if (isLoading) {
    return (
      <div className="p-12 text-center text-[#666] text-[13px]">Loading company...</div>
    )
  }

  if (!company) {
    return (
      <div className="p-12 text-center">
        <div className="text-[36px] mb-2 opacity-30">🏢</div>
        <div className="text-[14px] font-bold mb-1">Company not found</div>
        <button onClick={() => navigate('/business')}
          className="mt-3 rounded-lg px-4 py-2 text-[12px] font-bold cursor-pointer"
          style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
          ← Back to Companies
        </button>
      </div>
    )
  }

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['company-detail', customerId] })
    qc.invalidateQueries({ queryKey: ['company-tab-counts', customerId] })
    qc.invalidateQueries({ queryKey: ['business-customer-list'] })
    qc.invalidateQueries({ queryKey: ['company-invoices', customerId] })
    qc.invalidateQueries({ queryKey: ['company-payments', customerId] })
  }

  const balance      = company.computed_balance      || 0
  const openInvoices = company.open_invoice_count    || 0
  const overdue      = company.overdue_invoice_count || 0

  return (
    <div className="max-w-[1200px] mx-auto p-5">
      {/* Breadcrumb + Header */}
      <button onClick={() => navigate('/business')}
        className="mb-3 text-[11px] font-bold cursor-pointer"
        style={{background:'none', border:'none', color:'#5E6AD2'}}>
        ← All Companies
      </button>

      <div className="rounded-xl p-5 mb-4" style={{background:'#FFFFFF', border:'1px solid #E5E5E5'}}>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[22px] font-bold text-[#1F1F1F] truncate">{company.company_name}</div>
              {company.tier && company.tier !== 'standard' && (
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded flex-shrink-0"
                  style={{background: company.tier === 'vip' ? '#FEF3C7' : '#eef0fc',
                          color: company.tier === 'vip' ? '#B45309' : '#5E6AD2'}}>
                  {company.tier}
                </span>
              )}
            </div>
            {company.trade_name && (
              <div className="text-[12px] text-[#666] mb-2">DBA: {company.trade_name}</div>
            )}
            <div className="text-[12px] text-[#666]">
              {[
                company.contact_name && `👤 ${company.contact_name}`,
                company.effective_phone && `📞 ${company.effective_phone}`,
                company.contact_email && `✉️ ${company.contact_email}`,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => setShowCreateEst(true)}
              className="rounded-lg px-3 py-2 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
              style={{background:'#FFFFFF', color:'#5E6AD2', border:'1px solid #5E6AD2'}}>
              + Estimate
            </button>
            <button onClick={() => setShowCreateInv(true)}
              className="rounded-lg px-3 py-2 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
              style={{background:'#5E6AD2', color:'#FFFFFF', border:'none'}}>
              + Invoice
            </button>
            {balance > 0 && (
              <button onClick={() => setShowReceive(true)}
                className="rounded-lg px-3 py-2 text-[12px] font-bold cursor-pointer active:scale-[0.96]"
                style={{background:'#059669', color:'#FFFFFF', border:'none'}}>
                💰 Receive Payment
              </button>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          <Kpi label="Owed"        value={`$${balance.toFixed(0)}`}
            color={balance > 0 ? (overdue > 0 ? '#dc2626' : '#1F1F1F') : '#059669'}/>
          <Kpi label="Open Invoices"   value={openInvoices}
            color={openInvoices > 0 ? '#1F1F1F' : '#999'}
            note={overdue > 0 ? `${overdue} overdue` : null}
            noteColor={'#dc2626'}/>
          <Kpi label="Credit Limit"    value={`$${(company.credit_limit || 0).toFixed(0)}`}/>
          <Kpi label="Terms"           value={(company.payment_terms || 'net_30').replace('_', ' ').toUpperCase()}/>
        </div>
      </div>

      {/* Alert notes banner */}
      {alertNotes.length > 0 && (
        <div className="rounded-xl p-3 mb-4"
          style={{background:'#FEE2E2', border:'1px solid #dc2626'}}>
          {alertNotes.map((n, i) => (
            <div key={n.id} className={i > 0 ? 'mt-2 pt-2 border-t border-red-300' : ''}>
              <div className="text-[11px] font-bold text-[#dc2626] flex items-start gap-1.5">
                <span>⚠️</span>
                <span className="flex-1 whitespace-pre-wrap">{n.note}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl overflow-hidden">
        <div className="flex gap-1 overflow-x-auto p-2" style={{borderBottom:'1px solid #E5E5E5'}}>
          {TABS.map(t => {
            const active = currentTab === t.key
            const c = countFor(t.key, counts)
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="rounded-lg px-3 py-2 text-[12px] font-bold cursor-pointer whitespace-nowrap active:scale-[0.96]"
                style={active
                  ? { background:'#5E6AD2', color:'#FFFFFF', border:'none' }
                  : { background:'#FFFFFF', color:'#1F1F1F', border:'1px solid #E5E5E5' }
                }>
                {t.icon} {t.label}
                {c !== null && (
                  <span className="ml-1 opacity-75">({c})</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="p-4">
          {currentTab === 'overview'  && <OverviewTab  customer={company} onChanged={refreshAll}/>}
          {currentTab === 'invoices'  && <InvoicesTab  customerId={customerId} onChanged={refreshAll}/>}
          {currentTab === 'payments'  && <PaymentsTab  customerId={customerId} onChanged={refreshAll}/>}
          {currentTab === 'contacts'  && <ContactsTab  customerId={customerId} tenantId={tenant?.id} onChanged={refreshAll}/>}
          {currentTab === 'addresses' && <AddressesTab customerId={customerId} tenantId={tenant?.id} onChanged={refreshAll}/>}
          {currentTab === 'methods'   && <PaymentMethodsTab customerId={customerId} tenantId={tenant?.id} onChanged={refreshAll}/>}
          {currentTab === 'notes'     && <NotesTab     customerId={customerId} tenantId={tenant?.id} onChanged={refreshAll}/>}
        </div>
      </div>

      {/* Action modals */}
      {showReceive && (
        <ReceivePaymentModal
          presetCustomerId={customerId}
          onClose={() => setShowReceive(false)}
          onDone={() => { setShowReceive(false); refreshAll() }}/>
      )}
      {showCreateInv && (
        <CreateInvoiceModal
          presetCustomerId={customerId}
          onClose={() => setShowCreateInv(false)}
          onCreated={() => { setShowCreateInv(false); refreshAll() }}/>
      )}
      {showCreateEst && (
        <CreateEstimateModal
          presetCustomerId={customerId}
          onClose={() => setShowCreateEst(false)}
          onCreated={() => { setShowCreateEst(false); refreshAll() }}/>
      )}
    </div>
  )
}

function Kpi({ label, value, color, note, noteColor }) {
  return (
    <div className="rounded-lg p-2.5" style={{background:'#FAFAFA', border:'1px solid #E5E5E5'}}>
      <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-0.5">{label}</div>
      <div className="font-mono text-[18px] font-bold" style={{color: color || '#1F1F1F'}}>{value}</div>
      {note && (
        <div className="text-[10px] font-bold mt-0.5" style={{color: noteColor || '#666'}}>{note}</div>
      )}
    </div>
  )
}

function countFor(key, counts) {
  if (!counts) return null
  const map = {
    invoices:  counts.invoices,
    payments:  counts.payments,
    contacts:  counts.contacts,
    addresses: counts.addresses,
    methods:   counts.methods,
    notes:     counts.notes,
  }
  return map[key] ?? null
}
