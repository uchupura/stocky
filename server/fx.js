// =====================================================================
// 날짜별 원/달러 환율 — 서버 전용
//   KIS 해외주식 종목_지수_환율기간별시세 FHKST03030100 (시장 X = 환율, FX@KRW, 일봉 종가)
//   fx_daily 에 저장해 재사용 / 주말·휴일은 직전 영업일 / 오늘 값은 30분마다 다시 받음
//   * 시세 "조회" API 만 사용
// =====================================================================
import { adminDb, kisGet } from './kis.js'

const CODE = 'FX@KRW'
const TODAY_TTL = 30 * 60 * 1000

/** 한국 날짜 YYYY-MM-DD */
export function kstToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const compact = (ymd) => ymd.replaceAll('-', '')
const dashed = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`

async function latestCached(db, date) {
  const { data } = await db
    .from('fx_daily')
    .select('rate_date, rate, fetched_at')
    .eq('currency', 'USD')
    .lte('rate_date', date)
    .gte('rate_date', addDays(date, -14))
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

/**
 * 지정한 날짜의 원/달러 환율 (그날이 휴일이면 직전 영업일)
 * @param {string} date YYYY-MM-DD (오늘 이후면 오늘로)
 * @returns {Promise<{ requested: string, date: string, rate: number, cached: boolean }>}
 */
export async function getUsdKrw(date) {
  const today = kstToday()
  const want = date > today ? today : date
  const db = adminDb()

  // 1) 저장된 값: 그 날짜 값이 정확히 있으면 사용 (오늘 값은 30분 지나면 다시)
  const hit = await latestCached(db, want)
  if (hit && hit.rate_date === want && (want !== today || Date.now() - new Date(hit.fetched_at) < TODAY_TTL)) {
    return { requested: want, date: hit.rate_date, rate: Number(hit.rate), cached: true }
  }

  // 2) KIS 에서 2주치 받아 저장 → 그날 이전 가장 최근 영업일 값
  const rows = await kisGet('/uapi/overseas-price/v1/quotations/inquire-daily-chartprice', 'FHKST03030100', {
    FID_COND_MRKT_DIV_CODE: 'X',
    FID_INPUT_ISCD: CODE,
    FID_INPUT_DATE_1: compact(addDays(want, -14)),
    FID_INPUT_DATE_2: compact(want),
    FID_PERIOD_DIV_CODE: 'D',
  }, { output: 'output2' })
  const list = (rows || [])
    .filter((r) => r.stck_bsop_date && Number(r.ovrs_nmix_prpr) > 0)
    .map((r) => ({ currency: 'USD', rate_date: dashed(r.stck_bsop_date), rate: Number(r.ovrs_nmix_prpr), fetched_at: new Date().toISOString() }))
    .filter((r) => r.rate_date <= want)
  if (list.length) {
    const { error } = await db.from('fx_daily').upsert(list)
    if (error) console.error('[fx] 저장 실패', error.message)
    const best = list.reduce((m, r) => (r.rate_date > m.rate_date ? r : m))
    return { requested: want, date: best.rate_date, rate: best.rate, cached: false }
  }
  // KIS 에 없으면 저장된 가장 가까운 값이라도
  if (hit) return { requested: want, date: hit.rate_date, rate: Number(hit.rate), cached: true }
  throw new Error('그 날짜의 환율을 찾지 못했어요. 직접 입력해 주세요.')
}
