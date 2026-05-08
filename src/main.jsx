// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Register service worker for offline / PWA support
// autoUpdate: when new version is deployed, refresh in background
if (typeof window !== 'undefined' && import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onOfflineReady() {
      console.log('[PWA] Ready to work offline')
    },
    onNeedRefresh() {
      console.log('[PWA] New content available, will update on next reload')
    },
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
