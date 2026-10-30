import { ref, computed } from 'vue'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

// 로그인 상태 (앱 전체에서 하나만 공유)
const session = ref(null)
const ready = ref(false) // 처음 로그인 상태 확인이 끝났는지
let started = false

/**
 * 네이버 로그인 흐름
 *   "네이버로 로그인" → /api/auth/naver/login → 네이버 → /api/auth/naver/callback
 *   → 앱 주소 #access_token=... → supabase-js 가 자동으로 세션 저장 (주소의 # 부분은 지움)
 */
export function useAuth() {
  if (!started && isSupabaseConfigured) {
    started = true
    supabase.auth.getSession().then(({ data }) => {
      session.value = data.session
      ready.value = true
    })
    supabase.auth.onAuthStateChange((_event, s) => {
      session.value = s
      ready.value = true
    })
  } else if (!isSupabaseConfigured) {
    ready.value = true
  }

  const user = computed(() => session.value?.user ?? null)
  const displayName = computed(() => user.value?.user_metadata?.name || user.value?.email || '')

  async function signOut() {
    await supabase.auth.signOut()
    session.value = null
  }

  return { session, user, displayName, ready, signOut, loginUrl: '/api/auth/naver/login' }
}

/** 서버 API 호출용 로그인 토큰 헤더 */
export async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { authorization: `Bearer ${token}` } : {}
}
