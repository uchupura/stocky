// =====================================================================
// 한국투자증권(KIS) Open API — 서버 전용 (브라우저 코드에서 import 금지)
//   * 시세 "조회" API 만 사용. 주문·잔고 등 다른 API 는 호출하지 않는다.
//   * 접근토큰: 하루 유효, 발급할 때마다 알림톡 발송 → Supabase kis_tokens 에 저장해 재사용
//   참고: github.com/koreainvestment/open-trading-api (examples_llm/kis_auth.py)
// =====================================================================
import { createClient } from '@supabase/supabase-js'

const DOMAINS = {
  real: 'https://openapi.koreainvestment.com:9443',
  mock: 'https://openapivts.koreainvestment.com:29443',
}

function config() {
  const env = process.env.KIS_ENV === 'mock' ? 'mock' : 'real'
  const appKey = process.env.KIS_APP_KEY
  const appSecret = process.env.KIS_APP_SECRET
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!appKey || !appSecret || !supabaseUrl || !serviceKey) {
    throw new Error('서버 환경변수(KIS_APP_KEY, KIS_APP_SECRET, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 없어요.')
  }
  return { env, base: DOMAINS[env], appKey, appSecret, supabaseUrl, serviceKey }
}

let _db
export function adminDb() {
  const c = config()
  _db ??= createClient(c.supabaseUrl, c.serviceKey, { auth: { persistSession: false } })
  return _db
}

// ----- 접근토큰 -----
let memToken = null // { token, expiresAt } — 같은 서버 인스턴스 안에서는 DB 조회도 생략

async function getToken() {
  const c = config()
  const margin = 10 * 60 * 1000 // 만료 10분 전이면 새로 받기
  if (memToken && memToken.expiresAt - Date.now() > margin) return memToken.token

  const db = adminDb()
  const { data } = await db.from('kis_tokens').select('access_token, expires_at').eq('env', c.env).maybeSingle()
  if (data && new Date(data.expires_at) - Date.now() > margin) {
    memToken = { token: data.access_token, expiresAt: new Date(data.expires_at).getTime() }
    return memToken.token
  }

  const res = await fetch(`${c.base}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: c.appKey, appsecret: c.appSecret }),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.access_token) {
    throw new Error(`KIS 토큰 발급 실패 (HTTP ${res.status}) ${d.error_description || d.msg1 || ''}`.trim())
  }
  // access_token_token_expired: "YYYY-MM-DD HH:MM:SS" (한국 시간)
  const expiresAt = new Date(d.access_token_token_expired.replace(' ', 'T') + '+09:00')
  const { error } = await db.from('kis_tokens').upsert({
    env: c.env, access_token: d.access_token, expires_at: expiresAt.toISOString(), updated_at: new Date().toISOString(),
  })
  if (error) console.error('kis_tokens 저장 실패:', error.message)
  memToken = { token: d.access_token, expiresAt: expiresAt.getTime() }
  return memToken.token
}

async function kisGet(path, trId, params) {
  const c = config()
  const token = await getToken()
  const res = await fetch(`${c.base}${path}?${new URLSearchParams(params)}`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: c.appKey,
      appsecret: c.appSecret,
      tr_id: trId,
      custtype: 'P',
    },
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || d.rt_cd !== '0' || !d.output) {
    throw new Error(`KIS 시세 조회 실패 (HTTP ${res.status}) ${d.msg1 || ''}`.trim())
  }
  return d.output
}

// ----- 현재가 (같은 종목 30초 캐시) -----
const cache = new Map()
const TTL = 30 * 1000

/**
 * @param {{ symbol: string, market: 'KR'|'US', exchange: string }} s
 * @returns {Promise<{ symbol, market, exchange, currency, price, prevClose, change, changeRate, asOf }>}
 */
export async function getQuote({ symbol, market, exchange }) {
  const key = `${market}:${exchange}:${symbol}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value

  let value
  if (market === 'KR') {
    // 국내주식 현재가 시세 (FHKST01010100), J = KRX
    const o = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: symbol,
    })
    const price = Number(o.stck_prpr)
    value = {
      symbol, market, exchange, currency: 'KRW',
      price,
      prevClose: price - Number(o.prdy_vrss),
      change: Number(o.prdy_vrss),
      changeRate: Number(o.prdy_ctrt),
    }
  } else {
    // 해외주식 현재체결가 (HHDFS00000300), EXCD = NAS / NYS / AMS
    const o = await kisGet('/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', {
      AUTH: '',
      EXCD: exchange,
      SYMB: symbol,
    })
    const last = Number(o.last)
    const base = Number(o.base)
    const price = last > 0 ? last : base // 장 시작 전 등 체결가가 비어 있으면 전일 종가
    value = {
      symbol, market, exchange, currency: 'USD',
      price,
      prevClose: base,
      change: Number(o.diff) * (o.sign === '5' || o.sign === '4' ? -1 : 1),
      changeRate: Number(o.rate),
    }
  }
  if (!(value.price > 0)) throw new Error('현재가를 받지 못했어요. 거래 정지 종목일 수 있어요.')
  value.asOf = new Date().toISOString()
  cache.set(key, { at: Date.now(), value })
  return value
}
