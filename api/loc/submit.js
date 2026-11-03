// POST /api/loc/submit — 오늘 LOC 주문 전송
//   본문: { cycleId, signature } — DB 사이클 설정으로 서버가 다시 계산해 화면에서 본 것(signature)과 같을 때만 전송
//   진행 중 사이클만, LOC_ORDER_ENABLED=1 이 아니면 시험 모드(보낼 목록만 돌려줌)
import { requireUser, HttpError } from '../../server/auth.js'
import { normalize, submitPlan } from '../../server/loc/manual.js'
import { cycleForUser, settingsOf } from '../../server/loc/cycles.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export async function POST(request) {
  try {
    const user = await requireUser(request)
    const body = await request.json().catch(() => ({}))
    const cycle = await cycleForUser(Number(body.cycleId), user.id)
    if (cycle.status !== 'active') return json({ error: '끝난 사이클이에요. 새 사이클을 시작해 주세요.' }, 400)
    const { settings, errors } = normalize(settingsOf(cycle))
    if (errors.length) return json({ error: errors.join(' · ') }, 400)
    if (typeof body.signature !== 'string') return json({ error: '먼저 [계산]으로 주문을 확인해 주세요.' }, 400)
    console.log('[loc] 전송 요청', user.email?.replace(/(.).+@/, '$1***@'), settings.symbol, `cycle#${cycle.id}`)
    const r = await submitPlan(settings, body.signature)
    if (r.changed) return json({ error: '그사이 설정이나 가격이 바뀌어 주문이 달라졌어요. 새 주문을 확인한 뒤 다시 눌러 주세요.', preview: { ...r.preview, cycleId: cycle.id } }, 409)
    return json(r)
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('[api/loc/submit]', e)
    return json({ error: e.message || '주문을 보내지 못했어요.' }, 502)
  }
}
