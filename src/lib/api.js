// 우리 서버(/api/*) 호출 — KIS 키는 서버에만 있고 브라우저는 결과만 받는다

/**
 * 현재가 조회
 * @param {string} symbol 005930, AAPL
 * @param {'KR'|'US'} market
 * @returns {Promise<{ price: number, currency: 'KRW'|'USD', change: number, changeRate: number, asOf: string }>}
 */
export async function fetchQuote(symbol, market) {
  const qs = new URLSearchParams({ symbol, market })
  const res = await fetch(`/api/quote?${qs}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || '현재가를 가져오지 못했어요.')
  return data
}

/**
 * 보유 종목 현재가 + 원/달러 환율 일괄 갱신 (서버가 1분에 한 번만 실제 조회)
 * @returns {Promise<{ skipped: boolean, updated?: number, failed?: Array<{symbol, error}>, fxRate: number, updatedAt: string }>}
 */
export async function refreshMarket() {
  const res = await fetch('/api/refresh', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || '현재가를 갱신하지 못했어요.')
  return data
}
