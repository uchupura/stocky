// =====================================================================
// Vercel Cron 호출 확인 — "Authorization: Bearer <CRON_SECRET>" 이 맞을 때만 실행
// =====================================================================
import { timingSafeEqual } from 'node:crypto'

/** 거부 이유 (로그용 — 비밀값 자체는 절대 남기지 않음), 통과면 '' */
export function cronDenyReason(request) {
  const secret = process.env.CRON_SECRET || ''
  if (secret.length < 16) return 'CRON_SECRET 없음(또는 16자 미만) — Vercel 환경변수 확인' // 항상 거부
  const header = request.headers.get('authorization')
  if (!header) return 'Authorization 헤더 없음'
  const got = Buffer.from(header)
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want) ? '' : '비밀값 불일치'
}
