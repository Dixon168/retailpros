// src/App.jsx
import { useEffect, Component } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '@/stores/authStore'
import AppLayout from '@/components/layout/AppLayout'
import AuthLayout from '@/components/layout/AuthLayout'
import LoginPage from '@/pages/auth/LoginPage'
import POSPage from '@/pages/pos/POSPage'
import ProductsPage from '@/pages/products/ProductsPage'
import CustomersPage from '@/pages/customers/CustomersPage'
import InvoicesPage from '@/pages/invoices/InvoicesPage'
import EstimatesPage from '@/pages/estimates/EstimatesPage'
import PaymentsPage from '@/pages/payments/PaymentsPage'
import ARAgingPage from '@/pages/reports/ARAgingPage'
import B2BCenterPage from '@/pages/b2b-center/B2BCenterPage'
import MarketingPage from '@/pages/marketing/MarketingPage'
import LoyaltyPage from '@/pages/loyalty/LoyaltyPage'
import VendorsPage from '@/pages/vendors/VendorsPage'
import ReportsPage from '@/pages/reports/ReportsPage'
import SettingsPage from '@/pages/settings/SettingsPage'
import OrderLookupPage from '@/pages/orders/OrderLookupPage'
import DashboardPage from '@/pages/backoffice/DashboardPage'
import SmartReceivePage from '@/pages/inventory/SmartReceivePage'
import StockLevelsPage from '@/pages/inventory/StockLevelsPage'
import PurchaseOrdersPage from '@/pages/purchase-orders/PurchaseOrdersPage'
import CardCenterPage from '@/pages/cardcenter/CardCenterPage'
import CategoriesPage from '@/pages/categories/CategoriesPage'
import BusinessCustomersPage from '@/pages/business/BusinessCustomersPage'
import CompanyDetailPage from '@/pages/business/CompanyDetailPage'
import BarcodePage from '@/pages/barcode/BarcodePage'
import PayrollPage from '@/pages/payroll/PayrollPage'
import POSDashboardPage from '@/pages/pos-dashboard/POSDashboardPage'
import POSReportsPage from '@/pages/pos-reports/POSReportsPage'
import B2BReportsPage from '@/pages/b2b-reports/B2BReportsPage'
import CustomerDisplayPage from '@/pages/display/CustomerDisplayPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 30, networkMode: 'offlineFirst' } }
})

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', height:'100vh',
      background:'#FFFFFF', color:'#64748b',
      fontFamily:'monospace', fontSize:'13px', gap:'12px'
    }}>
      <div style={{
        width:'32px', height:'32px', border:'2px solid #E5E5E5',
        borderTop:'2px solid #3b82f6', borderRadius:'50%',
        animation:'spin 0.8s linear infinite'
      }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div>Loading RetailPOS...</div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return children
}

class ErrorBoundary extends Component {
  state = { hasError: false, error: null, info: null }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) {
    // Log full error + component stack so we can find the actual crash site
    // when "Something went wrong" pops up.
    console.error('[ErrorBoundary] caught:', error)
    console.error('[ErrorBoundary] component stack:', info?.componentStack)
    this.setState({ info })
  }
  render() {
    if (this.state.hasError) return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#FFFFFF',gap:'16px',padding:'20px'}}>
        <div style={{fontSize:'40px'}}>⚠️</div>
        <div style={{fontSize:'18px',fontWeight:'bold',color:'#1F1F1F'}}>Something went wrong</div>
        <div style={{fontSize:'12px',color:'#64748b',maxWidth:'600px',textAlign:'left',fontFamily:'monospace',background:'#fff',padding:'12px',borderRadius:'8px',border:'1px solid #e2e8f0',whiteSpace:'pre-wrap',overflow:'auto',maxHeight:'200px'}}>
          <strong style={{color:'#dc2626'}}>{this.state.error?.name || 'Error'}: {this.state.error?.message || '(no message)'}</strong>
          {this.state.error?.stack && (
            <div style={{marginTop:'8px',fontSize:'10px',opacity:0.7}}>{this.state.error.stack.split('\n').slice(0,4).join('\n')}</div>
          )}
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button onClick={() => window.location.href='/pos'}
            style={{background:'#006AFF',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 24px',fontSize:'13px',fontWeight:'bold',cursor:'pointer'}}>
            Back to POS
          </button>
          <button onClick={() => window.location.reload()}
            style={{background:'#fff',color:'#475569',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'10px 24px',fontSize:'13px',fontWeight:'bold',cursor:'pointer'}}>
            Reload page
          </button>
        </div>
      </div>
    )
    return this.props.children
  }
}

export default function App() {
  const { initialize } = useAuthStore()
  useEffect(() => { initialize() }, [])

  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthLayout><LoginPage /></AuthLayout>} />
          {/* POS — standalone, no AppLayout */}
          <Route path="/pos" element={<ProtectedRoute><POSPage /></ProtectedRoute>} />

          {/* Customer-facing display for second monitor — no AppLayout, no auth gate
              so it can be opened on a kiosk-style screen without login. The screen
              is read-only (just a mirror of the POS via BroadcastChannel) so no
              sensitive operations are exposed. */}
          <Route path="/display" element={<CustomerDisplayPage/>}/>
          <Route path="/display/:terminalId" element={<CustomerDisplayPage/>}/>

          {/* Back Office — uses AppLayout */}
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/backoffice"      element={<DashboardPage />} />
            <Route path="/smart-receive"   element={<SmartReceivePage />} />
            <Route path="/stock-levels"    element={<StockLevelsPage />} />
            <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="/orders"     element={<OrderLookupPage />} />
            <Route path="/products"   element={<ProductsPage />} />
            <Route path="/customers"  element={<CustomersPage />} />
            <Route path="/invoices"   element={<InvoicesPage />} />
            <Route path="/estimates"  element={<EstimatesPage />} />
            <Route path="/payments"   element={<PaymentsPage />} />
            <Route path="/reports/ar-aging" element={<ARAgingPage />} />
            <Route path="/b2b-center"  element={<B2BCenterPage />} />
            <Route path="/marketing"  element={<MarketingPage />} />
            <Route path="/loyalty"    element={<LoyaltyPage />} />
            <Route path="/vendors"    element={<VendorsPage />} />
            <Route path="/cardcenter" element={<CardCenterPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/business"      element={<BusinessCustomersPage />} />
            <Route path="/business/:id"  element={<CompanyDetailPage />} />
            <Route path="/reports"    element={<ReportsPage />} />
            <Route path="/pos-dashboard" element={<POSDashboardPage />} />
            <Route path="/pos-reports"   element={<POSReportsPage />} />
            <Route path="/b2b-reports"   element={<B2BReportsPage />} />
            <Route path="/barcode"    element={<BarcodePage />} />
            <Route path="/payroll"    element={<PayrollPage />} />
            <Route path="/settings"   element={<SettingsPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/pos" replace />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </BrowserRouter>

      <Toaster position="top-right" toastOptions={{
        style: {
          background: '#fff', color: '#1F1F1F',
          border: '1px solid #e2e8f0', borderRadius: '12px',
          fontFamily: 'Inter, sans-serif', fontSize: '13px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        },
        success: { iconTheme: { primary: '#16a34a', secondary: '#fff' } },
        error:   { iconTheme: { primary: '#dc2626', secondary: '#fff' } },
      }} />
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
