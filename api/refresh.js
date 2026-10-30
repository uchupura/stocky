// POST /api/refresh
//   보유 종목 현재가 + 원/달러 환율 일괄 갱신 (마지막 갱신 1분 이내면 건너뜀)
import { refreshPrices } from '../server/refresh.js'
import { requireUser, HttpError } from '../server/auth.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function POST(request) {
  try {
    await requireUser(request) // 로그인한 허용 사용자만
    return json(await refreshPrices())
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('[api/refresh]', e)
    return json({ error: e.message || '현재가를 갱신하지 못했어요.' }, 502)
  }
}
