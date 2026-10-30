// 우리 서버(/api/*) 호출 — KIS 키는 서버에만 있고 브라우저는 결과만 받는다
// 서버는 로그인한 허용 사용자만 받으므로 로그인 토큰을 함께 보낸다
import { authHeader } from '../composables/useAuth'

async function call(path, init = {}, fallback) {
  const res = await fetch(path, { ...init, headers: { ...(init.headers || {}), ...(await authHeader()) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || fallback)
  return data
}

/**
 * 현재가 조회
 * @param {string} symbol 005930, AAPL
 * @param {'KR'|'US'} market
 * @returns {Promise<{ price: number, currency: 'KRW'|'USD', change: number, changeRate: number, fxRate?: number, asOf: string }>}
 */
export function fetchQuote(symbol, market) {
  return call(`/api/quote?${new URLSearchParams({ symbol, market })}`, {}, '현재가를 가져오지 못했어요.')
}

/**
 * 보유 종목 현재가 + 원/달러 환율 일괄 갱신 (서버가 1분에 한 번만 실제 조회)
 * @returns {Promise<{ skipped: boolean, updated?: number, failed?: Array<{symbol, error}>, fxRate: number, updatedAt: string }>}
 */
export function refreshMarket() {
  return call('/api/refresh', { method: 'POST' }, '현재가를 갱신하지 못했어요.')
}
