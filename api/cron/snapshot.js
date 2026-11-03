// GET /api/cron/snapshot
//   (Cron 일정은 삭제 — 지금은 새로고침이 기록) 직접 호출하면 전날이 말일일 때 시세 갱신 후 월말 총 자산 기록 (server/snapshot.js)
//   Vercel 이 "Authorization: Bearer <CRON_SECRET>" 을 붙여 보냄 → 일치할 때만 실행
import { takeSnapshots } from '../../server/snapshot.js'
import { cronDenyReason } from '../../server/cron.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

// 실행할 때마다 한 줄 기록 → Vercel Logs 에서 확인
const LOG = '[cron/snapshot]'

export async function GET(request) {
  const agent = request.headers.get('user-agent') || '-'
  const reason = cronDenyReason(request)
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
