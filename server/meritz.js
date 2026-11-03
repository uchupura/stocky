// =====================================================================
// 메리츠증권 Open API — 서버 전용 (키: MERITZ_APP_KEY / MERITZ_APP_SECRET, .env)
//   * 토큰(12시간)은 메모리에 저장해 재사용 (로컬 개발 서버용 — 자동화 단계에서 DB 로 옮김)
//   * 모든 요청에 mac_address 헤더 필수 (값은 임의 12자리여도 통과)
//   * 주문 API 는 placeLoc 만 사용 — 성공(0001) 뒤에도 미국 브로커가 거부할 수 있으므로
//     전송 후 todayOrders() 로 실제 상태를 확인할 것
// =====================================================================

const BASE = 'https://openapi.imeritz.com:9443'
const MAC = 'A1B2C3D4E5F6'
// 잔고의 거래소 코드(벤더) → 시세 API 의 거래소 구분
export const MARKET_OF = { '0066': 'AX', '0321': 'NY', '0537': 'OQ' }

let tokenCache = null // { token, exp }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class MeritzError extends Error {
  constructor(message, detail) { super(message); this.detail = detail }
}

async function token() {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token
  const key = process.env.MERITZ_APP_KEY
  const secret = process.env.MERITZ_APP_SECRET
  if (!key || !secret) throw new MeritzError('메리츠 앱키가 설정되지 않았어요 (.env 의 MERITZ_APP_KEY / MERITZ_APP_SECRET).')
  const r = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: key, client_secret: secret, scope: 'login' }),
  })
  const d = await r.json().catch(() => ({}))
  if (!d.access_token) throw new MeritzError(`메리츠 토큰을 받지 못했어요 (HTTP ${r.status}).`)
  tokenCache = { token: d.access_token, exp: Date.now() + (Number(d.expires_in || 3600) - 120) * 1000 }
  return tokenCache.token
}

async function request(method, path, params = {}) {
  const headers = { authorization: `Bearer ${await token()}`, mac_address: MAC }
  let url = `${BASE}${path}`
  const init = { method, headers }
  if (method === 'GET') url += `?${new URLSearchParams(params)}`
  else { headers['content-type'] = 'application/json; charset=utf-8'; init.body = JSON.stringify(params) }
  const r = await fetch(url, init)
  const text = await r.text()
  let d
  try { d = JSON.parse(text) } catch { d = { raw: text.slice(0, 300) } }
  await sleep(150) // API 별 초당 10건 한도 안쪽
  return { status: r.status, body: d, data: d.data }
}
const first = (data) => (Array.isArray(data) ? data[0] : data) || {}

/** 해외 잔고에서 종목 한 줄 (없으면 null) */
export async function holding(symbol) {
  const r = await request('GET', '/accounts/v1/me/overseas/holdings')
  if (!Array.isArray(r.data)) throw new MeritzError(`잔고를 불러오지 못했어요: ${r.body.rsp_msg || r.status}`)
  const h = r.data.find((x) => x.ovrs_stck_symb_iscd === symbol)
  if (!h) return null
  return {
    // 보유 수량 = 잔고 수량 (매도 가능 수량은 걸려 있는 매도 주문만큼 줄어서 쓰면 안 됨)
    qty: Math.floor(Number(h.rmnd_dqty || 0)),
    sellable: Math.floor(Number(h.seln_able_dqty || 0)),
    avg: Number(h.avrg_unpr),
    vendor: h.ovrs_exch_vndr_idno,
    price: Number(h.psnt_prc),
  }
}

/** 현재가 · 전일 종가 */
export async function quote(symbol, market) {
  const r = await request('GET', '/market/v1/overseas/prices', { mrkt_div_code: 'OV', mrkt_cls_code: market, iscd: symbol, dely_rltm_cls_code: '0' })
  const q = first(r.data)
  if (!(Number(q.prpr) > 0)) throw new MeritzError(`현재가를 불러오지 못했어요: ${r.body.rsp_msg || r.status}`)
  return { price: Number(q.prpr), prevClose: Number(q.prdy_clpr), name: q.kor_isnm || q.eng_isnm || symbol }
}

/** 일봉 종가 [{ date, close }] (from~to, YYYYMMDD) — 기간을 2주씩 나눠 조회 */
export async function dailyCloses(symbol, market, from, to) {
  const out = new Map()
  const d = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00Z`)
  const ymd = (x) => x.toISOString().slice(0, 10).replaceAll('-', '')
  for (let a = d(from); a <= d(to); a.setUTCDate(a.getUTCDate() + 14)) {
    const b = new Date(a); b.setUTCDate(b.getUTCDate() + 13)
    const end = b > d(to) ? to : ymd(b)
    const r = await request('GET', '/market/v1/overseas/candles/days', { mrkt_div_code: 'OV', mrkt_cls_code: market, iscd: symbol, dely_rltm_cls_code: '0', mod_stpr_cls_code: '1', from: ymd(a), to: end })
    for (const x of Array.isArray(r.data) ? r.data : []) if (x.date >= from && x.date <= to) out.set(x.date, Number(x.prpr))
  }
  return [...out].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }))
}

/** 체결 내역 (from 이후, 체결된 것만) — [{ date, no, side, qty, price, amount, type }] */
export async function fills(symbol, from) {
  const rows = []
  let key = null
  for (let page = 0; page < 20; page++) {
    const p = { oder_sta_date: from, oder_fin_date: '20991231', seln_byov_clcd: '0', cntg_cls_code: '1' }
    if (key) Object.assign(p, { tr_cont: '1', tr_cont_key: key })
    const r = await request('GET', '/trading/v1/overseas/orders/history', p)
    if (!Array.isArray(r.data)) break
    rows.push(...r.data)
    if (r.body.tr_cont !== '1' || !r.body.tr_cont_key) break
    key = r.body.tr_cont_key
  }
  return rows
    .filter((o) => (o.iscd || '').split('.')[0] === symbol && Number(o.cntg_dqty) > 0)
    .map((o) => ({
      date: o.oder_date,
      no: String(o.oder_no),
      side: o.seln_byov_clcd === '2' ? 'buy' : 'sell',
      qty: Number(o.cntg_dqty),
      price: Number(o.cntg_crnc_prc),
      amount: Number(o.cntg_camt) || Number(o.cntg_dqty) * Number(o.cntg_crnc_prc),
      type: o.aspr_type_code, // 5 = LOC
    }))
}

/** 오늘 주문 (해당 종목) — [{ no, origNo, side, qty, price, open, filled, cancelled, rejected }] */
export async function todayOrders(symbol) {
  const r = await request('GET', '/trading/v1/overseas/orders/today', { cntg_cls_code: '0', seln_byov_clcd: '0' })
  return (Array.isArray(r.data) ? r.data : [])
    .filter((o) => o.ovrs_stck_symb_iscd === symbol)
    .map((o) => ({
      no: String(o.oder_no),
      origNo: String(o.orgl_oder_no || 0),
      side: o.seln_byov_clcd === '2' ? 'buy' : 'sell',
      qty: Number(o.odqt),
      price: Number(o.ovrs_stck_oder_prc),
      open: Number(o.ncnt_qty),
      filled: Number(o.cntg_qty),
      cancelled: Number(o.cncl_cnfr_qty),
      rejected: o.ovrs_stck_rfus_reas || '',
      at: o.oder_exec_ymdh,
    }))
}

/** LOC 주문 1건 (side: 'buy' | 'sell') → { ok, no, message } — 경고(warn_cls_code≠0)는 재전송하지 않고 실패로 */
export async function placeLoc({ symbol, vendor, side, qty, price }) {
  const path = side === 'buy' ? '/trading/v1/overseas/orders/buy' : '/trading/v1/overseas/orders/sell'
  const r = await request('POST', path, {
    ovrs_stck_symb_iscd: symbol, ovrs_exch_vndr_idno: vendor,
    oder_cls_code: '32', oder_cond_cls_code: '7', // LOC · 종가
    odqt: qty, ovrs_stck_oder_prc: Number(price).toFixed(2),
  })
  const o = first(r.data)
  const warn = o.warn_cls_code && o.warn_cls_code !== '0'
  const ok = r.body.rsp_cd === '0001' && !!o.oder_no && !warn
  return {
    ok,
    no: o.oder_no ? String(o.oder_no) : null,
    message: [r.body.rsp_msg, r.body.rsp_sub_msg, warn ? `경고 ${o.warn_cls_code}: ${o.warn_msg}` : ''].filter(Boolean).join(' · '),
    raw: { status: r.status, rsp_cd: r.body.rsp_cd },
  }
}

/** 특정 날짜(YYYYMMDD, 주문일)의 해당 종목 주문 전체 (체결 여부 무관) */
export async function ordersOn(symbol, date) {
  const rows = []
  let key = null
  for (let page = 0; page < 10; page++) {
    const p = { oder_sta_date: date, oder_fin_date: date, seln_byov_clcd: '0', cntg_cls_code: '0' }
    if (key) Object.assign(p, { tr_cont: '1', tr_cont_key: key })
    const r = await request('GET', '/trading/v1/overseas/orders/history', p)
    if (!Array.isArray(r.data)) break
    rows.push(...r.data)
    if (r.body.tr_cont !== '1' || !r.body.tr_cont_key) break
    key = r.body.tr_cont_key
  }
  return rows
    .filter((o) => (o.iscd || '').split('.')[0] === symbol)
    .map((o) => ({
      no: String(o.oder_no),
      origNo: String(o.orgl_oder_no || 0),
      side: o.seln_byov_clcd === '2' ? 'buy' : 'sell',
      type: o.aspr_type_code,
      kind: o.rctf_cncl_cls_name || '',          // 정정·취소 구분 이름
      qty: Number(o.oder_dqty),
      price: Number(o.ovrs_stck_oder_prc),
      filled: Number(o.cntg_dqty),
      fillPrice: Number(o.cntg_crnc_prc),
      open: Number(o.ncnt_odqt),
      rejected: o.ovrs_stck_rfus_reas || '',
      at: o.oder_exec_ymdh,
    }))
}
