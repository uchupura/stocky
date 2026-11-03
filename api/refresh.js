// POST /api/refresh   body { sync?: true }
//   보유 종목 현재가 + 원/달러 환율 일괄 갱신 (마지막 갱신 1분 이내면 건너뜀)
//   sync: 메리츠 연결 계좌(MERITZ_ACCOUNT_ID)의 보유 종목·예수금을 증권사 값으로 맞춘 뒤 갱신
//         실패해도 현재가 갱신은 계속 → 결과의 broker.error 로 알림
import { refreshPrices } from '../server/refresh.js'
import { syncMeritz } from '../server/brokerSync.js'
import { requireUser, HttpError } from '../server/auth.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function POST(request) {
  try {
    const user = await requireUser(request) // 로그인한 허용 사용자만
    const body = await request.json().catch(() => ({}))
    let broker = null
    if (body?.sync) {
      try {
        broker = await syncMeritz(user.id)
        if (broker) delete broker.plan
      } catch (e) {
        console.error('[api/refresh] meritz sync', e)
        broker = { error: e.message || '메리츠 계좌를 맞추지 못했어요.' }
      }
    }
    return json({ ...(await refreshPrices()), broker })
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('[api/refresh]', e)
    return json({ error: e.message || '현재가를 갱신하지 못했어요.' }, 502)
  }
}
