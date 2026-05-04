import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': '/src' }
  },
  build: {
    chunkSizeWarningLimit: 1000,
    minify: 'terser',
    terserOptions: {
      compress: {
        // Don't inline variables - prevents TDZ issues
        inline: false,
      },
      mangle: {
        // Keep component names readable
        keep_classnames: true,
        keep_fnames: true,
      }
    }
  }
})
