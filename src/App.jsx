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
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  render() {
    if (this.state.hasError) return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'#FFFFFF',gap:'16px',padding:'20px'}}>
        <div style={{fontSize:'40px'}}>⚠️</div>
        <div style={{fontSize:'18px',fontWeight:'bold',color:'#1F1F1F'}}>Something went wrong</div>
        <div style={{fontSize:'12px',color:'#64748b',maxWidth:'400px',textAlign:'center',fontFamily:'monospace',background:'#fff',padding:'12px',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
          {this.state.error?.message}
        </div>
        <button onClick={() => window.location.href='/pos'}
          style={{background:'#006AFF',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 24px',fontSize:'13px',fontWeight:'bold',cursor:'pointer'}}>
          Back to POS
        </button>
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
            <Route path="/marketing"  element={<MarketingPage />} />
            <Route path="/loyalty"    element={<LoyaltyPage />} />
            <Route path="/vendors"    element={<VendorsPage />} />
            <Route path="/cardcenter" element={<CardCenterPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/business"   element={<BusinessCustomersPage />} />
            <Route path="/reports"    element={<ReportsPage />} />
            <Route path="/settings"   element={<SettingsPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/pos" replace />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </BrowserRouter>

      <Toaster position="bottom-center" toastOptions={{
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
