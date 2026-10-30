import { createClient } from '@supabase/supabase-js'

// .env 의 값은 빌드할 때 Vite 가 넣어준다 (VITE_ 로 시작하는 변수만 브라우저에 전달됨)
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null
