// src/App.jsx
import { useEffect } from 'react'
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
import MarketingPage from '@/pages/marketing/MarketingPage'
import LoyaltyPage from '@/pages/loyalty/LoyaltyPage'
import VendorsPage from '@/pages/vendors/VendorsPage'
import ReportsPage from '@/pages/reports/ReportsPage'
import SettingsPage from '@/pages/settings/SettingsPage'
import OrderLookupPage from '@/pages/orders/OrderLookupPage'
import CardCenterPage from '@/pages/cardcenter/CardCenterPage'
import BusinessCustomersPage from '@/pages/business/BusinessCustomersPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, networkMode: 'offlineFirst' } }
})

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-[#07090f]">
      <div className="text-[#3d5068] font-mono text-sm animate-pulse">Loading...</div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const { initialize } = useAuthStore()
  useEffect(() => { initialize() }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthLayout><LoginPage /></AuthLayout>} />
          <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/pos" replace />} />
            <Route path="pos"        element={<POSPage />} />
            <Route path="orders"     element={<OrderLookupPage />} />
            <Route path="products"   element={<ProductsPage />} />
            <Route path="customers"  element={<CustomersPage />} />
            <Route path="invoices"   element={<InvoicesPage />} />
            <Route path="marketing"  element={<MarketingPage />} />
            <Route path="loyalty"    element={<LoyaltyPage />} />
            <Route path="vendors"    element={<VendorsPage />} />
            <Route path="cardcenter" element={<CardCenterPage />} />
            <Route path="business"   element={<BusinessCustomersPage />} />
            <Route path="reports"    element={<ReportsPage />} />
            <Route path="settings"   element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>

      <Toaster position="bottom-center" toastOptions={{
        style: {
          background: '#0d1117', color: '#e8edf5',
          border: '1px solid #1e2d42', borderRadius: '10px',
          fontFamily: 'DM Mono, monospace', fontSize: '12px',
        },
        success: { iconTheme: { primary: '#10b981', secondary: '#0d1117' } },
        error:   { iconTheme: { primary: '#ef4444', secondary: '#0d1117' } },
      }} />
    </QueryClientProvider>
  )
}
