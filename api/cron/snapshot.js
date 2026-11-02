// GET /api/cron/snapshot
//   Vercel Cron 이 매월 28~31일 호출 → 전날이 말일이면 시세 갱신 후 월말 총 자산 기록 (server/snapshot.js)
//   Vercel 이 "Authorization: Bearer <CRON_SECRET>" 을 붙여 보냄 → 일치할 때만 실행
import { timingSafeEqual } from 'node:crypto'
import { takeSnapshots } from '../../server/snapshot.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

// 거부 이유 (로그용 — 비밀값 자체는 절대 남기지 않음), 통과면 ''
function denyReason(request) {
  const secret = process.env.CRON_SECRET || ''
  if (secret.length < 16) return 'CRON_SECRET 없음(또는 16자 미만) — Vercel 환경변수 확인' // 항상 거부
  const header = request.headers.get('authorization')
  if (!header) return 'Authorization 헤더 없음'
  const got = Buffer.from(header)
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want) ? '' : '비밀값 불일치'
}

// 실행할 때마다 한 줄 기록 → Vercel Logs 에서 확인
const LOG = '[cron/snapshot]'

export async function GET(request) {
  const agent = request.headers.get('user-agent') || '-'
  const reason = denyReason(request)
  if (reason) {
    console.warn(LOG, 401, reason, `ua=${agent}`)
    return json({ error: 'Unauthorized' }, 401)
  }
  try {
    const result = await takeSnapshots()
    console.log(LOG, 200, JSON.stringify(result), `ua=${agent}`)
    return json(result)
  } catch (e) {
    console.error(LOG, 500, e)
    return json({ error: e.message || '총 자산을 기록하지 못했어요.' }, 500)
  }
}
