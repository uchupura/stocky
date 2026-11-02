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

function authorized(request) {
  const secret = process.env.CRON_SECRET || ''
  if (secret.length < 16) return false // 비밀값이 없거나 너무 짧으면 항상 거부
  const got = Buffer.from(request.headers.get('authorization') || '')
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function GET(request) {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401)
  try {
    return json(await takeSnapshots())
  } catch (e) {
    console.error('[api/cron/snapshot]', e)
    return json({ error: e.message || '총 자산을 기록하지 못했어요.' }, 500)
  }
}
