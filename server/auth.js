// =====================================================================
// 로그인 — 서버 전용 (브라우저 코드에서 import 금지)
//   네이버 로그인 성공 → 허용 목록(ALLOWED_EMAILS) 확인 → Supabase 세션 발급
//   API 요청 → Authorization: Bearer <Supabase access token> 검사
// =====================================================================
import { createClient } from '@supabase/supabase-js'
import { adminDb } from './kis.js'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** 허용할 이메일 목록 (쉼표로 구분, 대소문자 무시) */
export function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}
export const isAllowedEmail = (email) => !!email && allowedEmails().includes(String(email).toLowerCase())

/**
 * API 요청의 로그인 토큰 검사 → 허용된 사용자만 통과
 * @returns {Promise<import('@supabase/supabase-js').User>}
 */
export async function requireUser(request) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new HttpError(401, '로그인이 필요해요.')
  const { data, error } = await adminDb().auth.getUser(token)
  if (error || !data?.user) throw new HttpError(401, '로그인이 만료됐어요. 다시 로그인해 주세요.')
  if (!isAllowedEmail(data.user.email)) throw new HttpError(403, '접근 권한이 없어요.')
  return data.user
}

/**
 * 네이버 프로필로 Supabase 사용자 세션 발급
 *   1) 사용자 없으면 생성 (이메일 확인 완료 처리)
 *   2) 네이버 회원 id 를 app_metadata 에 기록 — 이미 다른 id 가 있으면 거부
 *   3) 일회용 로그인 링크 토큰 생성 → 바로 검증해 세션(access/refresh token) 획득
 * @param {{ id: string, email: string, name?: string }} profile 네이버 프로필
 * @returns {Promise<{ session: object, user: object }>}
 */
export async function issueSession(profile) {
  const admin = adminDb().auth.admin
  const email = profile.email.toLowerCase()

  const { error: createErr } = await admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: profile.name || '', provider: 'naver' },
    app_metadata: { provider: 'naver', naver_id: profile.id },
  })
  // 이미 가입된 이메일이면 그대로 진행
  if (createErr && createErr.code !== 'email_exists' && !/already/i.test(createErr.message || '')) {
    throw new Error(`사용자 생성 실패: ${createErr.message}`)
  }

  const { data: link, error: linkErr } = await admin.generateLink({ type: 'magiclink', email })
  if (linkErr) throw new Error(`로그인 처리 실패: ${linkErr.message}`)
  const user = link.user

  // 같은 이메일인데 다른 네이버 계정이면 거부 (이메일만 같은 다른 사람 차단)
  const savedId = user.app_metadata?.naver_id
  if (savedId && savedId !== profile.id) throw new HttpError(403, '등록된 네이버 계정과 달라요.')
  if (!savedId || user.user_metadata?.name !== (profile.name || '')) {
    await admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, provider: 'naver', naver_id: profile.id },
      user_metadata: { ...user.user_metadata, name: profile.name || '', provider: 'naver' },
    })
  }

  // 세션 발급: anon 키 클라이언트로 일회용 토큰 검증
  const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: verified, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  })
  if (otpErr || !verified?.session) throw new Error(`세션 발급 실패: ${otpErr?.message || '알 수 없음'}`)
  return { session: verified.session, user }
}

/**
 * 주인 없는 포트폴리오를 이 사용자에게 연결 (첫 로그인 1회)
 *   007 마이그레이션 전(owner_id 칸 없음)이면 조용히 건너뜀
 */
export async function claimPortfolio(userId) {
  const { error } = await adminDb().from('portfolios').update({ owner_id: userId }).is('owner_id', null)
  if (error && error.code !== '42703' && !/owner_id/.test(error.message || '')) {
    console.error('[claimPortfolio]', error.message)
  }
}

// ----- 쿠키 도우미 -----
export function readCookie(request, name) {
  const raw = request.headers.get('cookie') || ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}
export function cookie(name, value, { maxAge, secure }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ')
}
