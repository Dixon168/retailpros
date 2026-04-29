// src/lib/supabase.js
// Supabase 数据库连接配置
// 环境变量在 .env.local 中设置（不上传到 GitHub）

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // 自动刷新 token
    autoRefreshToken: true,
    // 本地持久化 session
    persistSession: true,
    detectSessionInUrl: true
  },
  realtime: {
    // 实时订阅配置（多机器同步库存用）
    params: { eventsPerSecond: 10 }
  }
})

export default supabase
