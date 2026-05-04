import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': '/src' }
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router')) return 'vendor-react'
            if (id.includes('@tanstack')) return 'vendor-query'
            if (id.includes('@supabase')) return 'vendor-supabase'
            if (id.includes('react-hot-toast')) return 'vendor-ui'
            return 'vendor-misc'
          }
          if (id.includes('/pages/products/')) return 'page-products'
          if (id.includes('/pages/pos/')) return 'page-pos'
          if (id.includes('/pages/marketing/') || id.includes('/pages/loyalty/')) return 'page-marketing'
          if (id.includes('/pages/reports/') || id.includes('/pages/settings/')) return 'page-admin'
        }
      }
    }
  }
})
