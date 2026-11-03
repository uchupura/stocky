// POST /api/refresh   body { sync?: true }
//   보유 종목 현재가 + 원/달러 환율 일괄 갱신 (마지막 갱신 1분 이내면 건너뜀)
//   sync: 메리츠 연결 계좌(MERITZ_ACCOUNT_ID)의 보유 종목·예수금을 증권사 값으로 맞춘 뒤 갱신
//         실패해도 현재가 갱신은 계속 → 결과의 broker.error 로 알림 · [새로고침] 결과 알림 저장
//   매번: 지난 미국 거래일 LOC 매수 결과 확인 → 알림 (날짜마다 1개) — 실패해도 갱신 결과는 그대로
import { refreshPrices } from '../server/refresh.js'
import { syncMeritz } from '../server/brokerSync.js'
import { notifyRefresh, checkLocBuys } from '../server/notify.js'
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
    const prices = await refreshPrices()
    let notified = 0
    try {
      if (body?.sync && (await notifyRefresh(user.id, prices, broker))) notified++
      notified += await checkLocBuys(user.id)
    } catch (e) {
      console.error('[api/refresh] notify', e) // 016 미적용·메리츠 조회 실패 등 → 알림만 건너뜀
    }
    return json({ ...prices, broker, notified })
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('[api/refresh]', e)
    return json({ error: e.message || '현재가를 갱신하지 못했어요.' }, 502)
  }
}
