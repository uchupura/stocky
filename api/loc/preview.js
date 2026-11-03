// POST /api/loc/preview — 오늘 LOC 주문 계산 (주문 없음)
//   본문: { cycleId } — DB(loc_cycles)의 사이클 설정으로 계산하고, 날짜별 내역(loc_daily)을 최신으로 저장
//         전량 매도가 확인되면 사이클을 '종료'로 기록
import { requireUser, HttpError } from '../../server/auth.js'
import { normalize, buildPlan, orderEnabled } from '../../server/loc/manual.js'
import { cycleForUser, settingsOf, saveHistory, endCycle } from '../../server/loc/cycles.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export async function POST(request) {
  try {
    const user = await requireUser(request)
    const body = await request.json().catch(() => ({}))
    const cycle = await cycleForUser(Number(body.cycleId), user.id)
    const { settings, errors } = normalize(settingsOf(cycle))
    if (errors.length) return json({ error: errors.join(' · ') }, 400)
    const p = await buildPlan(settings)
    await saveHistory(cycle.id, p.history)
    if (p.ended && cycle.status === 'active') await endCycle(cycle.id, p.ended)
    return json({ ...p, cycleId: cycle.id, orderEnabled: orderEnabled() })
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('[api/loc/preview]', e)
    return json({ error: e.message || '주문을 계산하지 못했어요.' }, 502)
  }
}
