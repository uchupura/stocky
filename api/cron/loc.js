// GET /api/cron/loc
//   Vercel Cron 이 한국 시간 월~금 18:00(무료 플랜은 그 뒤 1시간 안 → 18~19시) 호출 · 미국 동부 새벽 4시(서머타임 5시) — 프리마켓 시작 → LOC 자동 주문 (server/loc/auto.js)
//   Vercel 이 "Authorization: Bearer <CRON_SECRET>" 을 붙여 보냄 → 일치할 때만 실행
//   실제 전송은 LOC_ORDER_ENABLED=1 과 LOC_AUTO_ENABLED=1 둘 다 있을 때만 (아니면 시험 모드 알림)
import { runAuto } from '../../server/loc/auto.js'
import { cronDenyReason } from '../../server/cron.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

// 실행할 때마다 한 줄 기록 → Vercel Logs 에서 확인
const LOG = '[cron/loc]'

export async function GET(request) {
  const agent = request.headers.get('user-agent') || '-'
  const reason = cronDenyReason(request)
  if (reason) {
    console.warn(LOG, 401, reason, `ua=${agent}`)
    return json({ error: 'Unauthorized' }, 401)
  }
  try {
    const result = await runAuto()
    console.log(LOG, 200, JSON.stringify(result), `ua=${agent}`)
    return json(result)
  } catch (e) {
    console.error(LOG, 500, e)
    return json({ error: e.message || '자동 주문을 실행하지 못했어요.' }, 500)
  }
}
