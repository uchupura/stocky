// =====================================================================
// 하루 주가 그래프 (가장 최근 거래일) — 서버 전용
//   국내: 주식일별분봉조회 FHKST03010230 — 1분봉 120개씩 → 2시간씩 거슬러 약 4번 호출
//   해외: 해외주식분봉조회 HHDFS76950200 — 10분봉 최대 120개 1번 호출
//   그래프 간격: 10분 (국내는 1분봉만 제공돼 받은 뒤 10분 간격으로 줄임)
//   결과는 intraday_cache 에 저장 (장 중 5분 / 장 마감 후 60분) → 같은 종목 재요청 시 KIS 호출 안 함
//   * 시세 "조회" API 만 사용
// =====================================================================
import { adminDb, getQuote, kisGet } from './kis.js'

const STEP = 10 // 그래프 간격 (분)
const TTL_OPEN = 5 * 60 * 1000
const TTL_CLOSED = 60 * 60 * 1000
const SESSION = {
  KR: { open: 900, close: 1530 },  // 한국 시간
  US: { open: 930, close: 1600 },  // 미국 동부 시간
}
const hhmm = (hms) => Number(String(hms).padStart(6, '0').slice(0, 4)) // "093500" → 935
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** STEP 분 간격으로 줄이기 (정각·10분 단위 + 마지막 점) — 예전에 저장된 5분 그래프에도 적용 */
function downsample(points) {
  const out = points.filter(([t], i) => t % STEP === 0 || i === points.length - 1)
  return out.length >= 2 ? out : points
}

// ----- 국내 -----
// 한국 날짜 YYYYMMDD (날짜를 하루 빼고 싶으면 offsetDays)
function kstDate(base = new Date(), offsetDays = 0) {
  const d = new Date(base.getTime() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d).replaceAll('-', '')
}
const ymdToDate = (ymd) => new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00+09:00`)

/**
 * 주식일별분봉조회(FHKST03010230): 지정한 날짜·시각부터 거꾸로 1분봉 최대 120개
 *   → 15:30 부터 2시간씩 거슬러 약 4번이면 하루(09:00~15:30) 완성
 *   날짜에 주말·휴일을 넣으면 그 이전 가장 최근 거래일 데이터를 준다
 * @param {string} date 조회 시작 날짜 (YYYYMMDD)
 */
async function fetchKRDay(symbol, date) {
  const bars = new Map() // 시각(HHMMSS) → 가격
  let hour = '153000'
  let session = null // 실제 거래일 (첫 응답의 날짜)
  for (let i = 0; i < 6; i++) {
    const res = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice', 'FHKST03010230', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: symbol,
      FID_INPUT_HOUR_1: hour,
      FID_INPUT_DATE_1: session ?? date,
      FID_PW_DATA_INCU_YN: 'Y',
      FID_FAKE_TICK_INCU_YN: '',
    }, { output: 'output2' })
    const rows = (res || []).filter((r) => r.stck_bsop_date && r.stck_cntg_hour)
    if (!rows.length) break
    session ??= rows[0].stck_bsop_date
    const same = rows.filter((r) => r.stck_bsop_date === session) // 전날 시간외 거래 등은 제외
    for (const r of same) bars.set(r.stck_cntg_hour, Number(r.stck_prpr))
    const oldest = same.at(-1)?.stck_cntg_hour // 응답은 최신 → 과거 순
    if (!oldest || same.length < rows.length || hhmm(oldest) <= SESSION.KR.open) break
    // 다음 요청: 가장 오래된 봉 1분 전부터
    const t = Number(oldest.slice(0, 2)) * 60 + Number(oldest.slice(2, 4)) - 1
    hour = `${String(Math.floor(t / 60)).padStart(2, '0')}${String(t % 60).padStart(2, '0')}00`
    await sleep(60) // KIS 초당 호출 한도 보호
  }
  const points = [...bars.entries()]
    .map(([hms, p]) => [hhmm(hms), p])
    .filter(([t, p]) => t >= SESSION.KR.open && t <= SESSION.KR.close && p > 0) // 정규장만
    .sort((a, b) => a[0] - b[0])
  return { sessionDate: session, points: downsample(points) }
}

async function fetchKR(symbol) {
  const r = await fetchKRDay(symbol, kstDate())
  // 장 시작 전(오늘 정규장 데이터 없음)이면 그 전 거래일로 한 번 더
  if (r.points.length < 2 && r.sessionDate) {
    return fetchKRDay(symbol, kstDate(ymdToDate(r.sessionDate), -1))
  }
  return r
}

// ----- 해외 -----
async function fetchUS(symbol, exchange) {
  const rows = await kisGet('/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice', 'HHDFS76950200', {
    AUTH: '', EXCD: exchange, SYMB: symbol, NMIN: String(STEP), PINC: '1', NEXT: '', NREC: '120', FILL: '', KEYB: '',
  }, { output: 'output2' })
  const list = (rows || []).filter((r) => r.xymd && r.xhms && Number(r.last) > 0)
  if (!list.length) return { sessionDate: null, points: [] }
  // 가장 최근 현지 날짜의 정규장(09:30~16:00)만
  const date = list.reduce((m, r) => (r.xymd > m ? r.xymd : m), list[0].xymd)
  const points = list
    .filter((r) => r.xymd === date)
    .map((r) => [hhmm(r.xhms), Number(r.last)])
    .filter(([t]) => t >= SESSION.US.open && t <= SESSION.US.close)
    .sort((a, b) => a[0] - b[0])
  return { sessionDate: date, points: downsample(points) }
}

/**
 * @param {{ symbol: string, market: 'KR'|'US', exchange: string }} s
 * @returns {Promise<{ symbol, market, sessionDate, prevClose, points: Array<[number, number]>, cached: boolean }>}
 */
export async function getIntraday(s) {
  const db = adminDb()
  const { data: hit } = await db
    .from('intraday_cache')
    .select('session_date, prev_close, points, fetched_at')
    .eq('symbol', s.symbol)
    .eq('market', s.market)
    .maybeSingle()
  if (hit) {
    const age = Date.now() - new Date(hit.fetched_at).getTime()
    const last = hit.points.at(-1)?.[0] ?? 0
    const ttl = last >= SESSION[s.market].close ? TTL_CLOSED : TTL_OPEN
    if (age < ttl) {
      return { symbol: s.symbol, market: s.market, sessionDate: hit.session_date,
               prevClose: hit.prev_close != null ? Number(hit.prev_close) : null, points: downsample(hit.points), cached: true }
    }
  }

  const { sessionDate, points } = s.market === 'KR' ? await fetchKR(s.symbol) : await fetchUS(s.symbol, s.exchange)
  let prevClose = null
  try {
    const q = await getQuote(s)
    prevClose = q.prevClose || null
    // 그래프 끝 = 화면에 보이는 현재가로 맞춤
    //   (국내 분봉은 종가 단일가 시간(15:20~15:30)에 값이 멈춰 최종 종가와 다를 때가 있음)
    if (points.length && q.price > 0) points[points.length - 1] = [points.at(-1)[0], q.price]
  } catch (e) {
    console.error('[chart] 현재가·전일 종가 조회 실패', s.symbol, e.message)
  }

  if (sessionDate && points.length) {
    const { error } = await db.from('intraday_cache').upsert({
      symbol: s.symbol, market: s.market, session_date: sessionDate, prev_close: prevClose,
      points, fetched_at: new Date().toISOString(),
    })
    if (error) console.error('[chart] 캐시 저장 실패', error.message)
  }
  return { symbol: s.symbol, market: s.market, sessionDate, prevClose, points, cached: false }
}
