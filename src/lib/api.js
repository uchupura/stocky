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
 * 하루 주가 그래프 (가장 최근 거래일)
 * @returns {Promise<{ sessionDate: string, prevClose: number|null, points: Array<[number, number]>, cached: boolean }>}
 */
export function fetchChart(symbol, market) {
  return call(`/api/chart?${new URLSearchParams({ symbol, market })}`, {}, '그래프를 가져오지 못했어요.')
}

/**
 * 그날 원/달러 환율 (주말·휴일은 직전 영업일)
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<{ requested: string, date: string, rate: number, cached: boolean }>}
 */
export function fetchFx(date) {
  return call(`/api/fx?${new URLSearchParams({ date })}`, {}, '환율을 가져오지 못했어요.')
}

/**
 * 보유 종목 현재가 + 원/달러 환율 일괄 갱신 (서버가 1분에 한 번만 실제 조회)
 * sync: 메리츠 연결 계좌도 증권사 값으로 맞춤 ([새로고침] 버튼) → 결과 broker
 * @returns {Promise<{ skipped: boolean, updated?: number, failed?: Array<{symbol, error}>, fxRate: number, updatedAt: string, broker: object|null }>}
 */
export function refreshMarket({ sync = false } = {}) {
  return call('/api/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sync }) }, '현재가를 갱신하지 못했어요.')
}

// ===== LOC 수동 운영 (자동매매 탭) =====
async function postJson(path, body, fallback) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeader()) }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || fallback), { status: res.status, data })
  return data
}

/** 오늘 LOC 주문 계산 (주문 없음) — DB 사이클 설정으로, 날짜별 내역 저장 */
export function locPreview(cycleId) {
  return postJson('/api/loc/preview', { cycleId }, '주문을 계산하지 못했어요.')
}

/** 오늘 LOC 주문 전송 — 409 면 error.data.preview 에 새 계산 결과 */
// refPrice: [계산] 때 현재가 — 서버가 2% 안이면 그 값으로 다시 계산해 같은 주문을 보냄
export function locSubmit(cycleId, signature, refPrice) {
  return postJson('/api/loc/submit', { cycleId, signature, refPrice }, '주문을 보내지 못했어요.')
}
