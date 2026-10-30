// GET /api/chart?symbol=005930&market=KR
//   가장 최근 거래일 하루 주가 그래프 (로그인한 허용 사용자만, stock_master 에 있는 종목만)
//   → { sessionDate, prevClose, points: [[HHMM, 가격], ...], cached }
import { adminDb } from '../server/kis.js'
import { getIntraday } from '../server/chart.js'
import { requireUser, HttpError } from '../server/auth.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function GET(request) {
  const url = new URL(request.url)
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase()
  const market = (url.searchParams.get('market') || '').trim().toUpperCase()

  if (!['KR', 'US'].includes(market)) return json({ error: 'market 은 KR 또는 US 여야 해요.' }, 400)
  const pattern = market === 'KR' ? /^[0-9A-Z]{6}$/ : /^[A-Z0-9.\-/]{1,12}$/
  if (!pattern.test(symbol)) return json({ error: '종목 코드 형식이 올바르지 않아요.' }, 400)

  try {
    await requireUser(request) // 로그인한 허용 사용자만

    const { data: m, error } = await adminDb()
      .from('stock_master')
      .select('symbol, market, exchange')
      .eq('symbol', symbol)
      .eq('market', market)
      .maybeSingle()
    if (error) throw error
    if (!m) return json({ error: '상장 종목 목록에 없는 코드예요.' }, 404)

    return json(await getIntraday(m))
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('[api/chart]', e)
    return json({ error: e.message || '그래프를 가져오지 못했어요.' }, 502)
  }
}
