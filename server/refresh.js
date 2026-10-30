// =====================================================================
// 보유 종목 현재가 + 원/달러 환율 일괄 갱신 — 서버 전용
//   * 시세 "조회" API 만 사용 (server/kis.js)
//   * DB 쓰기는 service_role 로만 (브라우저는 stocks·환율을 직접 고치지 않음)
//   * 남용 방지: 마지막 갱신 후 1분이 지나지 않았으면 KIS 호출 없이 건너뜀
// =====================================================================
import { adminDb, getQuote } from './kis.js'

const MIN_INTERVAL = 60 * 1000
// 해외 보유 종목이 없을 때 환율만 받기 위한 기준 종목
const FX_REFERENCE = { symbol: 'SPY', market: 'US', exchange: 'AMS' }

export async function refreshPrices() {
  const db = adminDb()

  // 1) 최근 갱신 시각 확인 (환율 행의 updated_at 을 "마지막 갱신 시각"으로 사용)
  const { data: fx, error: fxErr } = await db
    .from('exchange_rates')
    .select('rate_to_krw, updated_at')
    .eq('currency', 'USD')
    .maybeSingle()
  if (fxErr) throw fxErr
  if (fx && Date.now() - new Date(fx.updated_at).getTime() < MIN_INTERVAL) {
    return { skipped: true, updatedAt: fx.updated_at, fxRate: Number(fx.rate_to_krw) }
  }

  // 2) 보유 중인 종목 목록 (중복 제거)
  const { data: rows, error: hErr } = await db.from('holdings').select('stocks(id, symbol, market, exchange)')
  if (hErr) throw hErr
  const stocks = [...new Map(rows.map((r) => [r.stocks.id, r.stocks])).values()]

  // 3) 현재가 조회 → stocks 갱신 (한 번에 몰리지 않게 순서대로)
  const now = new Date().toISOString()
  const failed = []
  let fxRate = null
  let updated = 0
  for (const s of stocks) {
    if (s.market === 'US' && !s.exchange) {
      failed.push({ symbol: s.symbol, error: '거래소 정보 없음' })
      continue
    }
    try {
      const q = await getQuote(s)
      if (q.fxRate) fxRate = q.fxRate
      const { error } = await db.from('stocks').update({ current_price: q.price, price_updated_at: now }).eq('id', s.id)
      if (error) throw error
      updated++
    } catch (e) {
      failed.push({ symbol: s.symbol, error: e.message })
    }
  }

  // 4) 환율 갱신 (해외 보유 종목에서 못 받았으면 기준 종목으로)
  if (!fxRate) {
    try {
      fxRate = (await getQuote(FX_REFERENCE)).fxRate
    } catch (e) {
      failed.push({ symbol: 'USD/KRW', error: e.message })
    }
  }
  if (fxRate) {
    const { error } = await db.from('exchange_rates').update({ rate_to_krw: fxRate, updated_at: now }).eq('currency', 'USD')
    if (error) throw error
  }

  return { skipped: false, updated, total: stocks.length, failed, fxRate, updatedAt: now }
}
