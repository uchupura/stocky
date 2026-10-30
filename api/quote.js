// GET /api/quote?symbol=005930&market=KR
// GET /api/quote?symbol=AAPL&market=US
//   → stock_master 에 있는 종목만 KIS 현재가 조회 (Vercel Function, 로컬은 vite.config.js 에서 연결)
import { adminDb, getQuote } from '../server/kis.js'
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

  // 입력값 검사 (국내: 6자리 코드, 해외: 영문·숫자 티커 — 클래스 주식은 KIS 표기 "BRK/B")
  if (!['KR', 'US'].includes(market)) return json({ error: 'market 은 KR 또는 US 여야 해요.' }, 400)
  const pattern = market === 'KR' ? /^[0-9A-Z]{6}$/ : /^[A-Z0-9.\-/]{1,12}$/
  if (!pattern.test(symbol)) return json({ error: '종목 코드 형식이 올바르지 않아요.' }, 400)

  try {
    await requireUser(request) // 로그인한 허용 사용자만

    // 상장 종목 목록에 있는 것만 허용 (아무 코드로나 호출 한도를 쓰지 못하게)
    const { data: m, error } = await adminDb()
      .from('stock_master')
      .select('symbol, market, exchange, name_ko, name_en')
      .eq('symbol', symbol)
      .eq('market', market)
      .maybeSingle()
    if (error) throw error
    if (!m) return json({ error: '상장 종목 목록에 없는 코드예요.' }, 404)

    const q = await getQuote(m)
    return json({ ...q, name_ko: m.name_ko, name_en: m.name_en })
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('[api/quote]', e)
    return json({ error: e.message || '현재가를 가져오지 못했어요.' }, 502)
  }
}
