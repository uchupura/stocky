// =====================================================================
// 월말 총 자산 기록 (012 asset_snapshots) — 서버 전용
//   지금은 새로고침(/api/refresh)이 ensureLastMonthSnapshot 으로 호출: 다음 달 첫 새로고침 때 그 시점 값을 지난달 말일로 저장
//   (Vercel Cron 은 삭제 — api/cron/snapshot.js 로 직접 부르면 아래 Cron 방식 그대로 동작)
//   1) 현재가·환율 갱신 (refreshPrices 재사용, 실패해도 마지막 시세로 계속 · refresh:false 면 건너뜀)
//   2) 포트폴리오별 총 자산(portfolio_summary.total_asset) → 'auto' 로 저장
//
//   기록 날짜 = KST 어제: 아침 7시 무렵 실행되므로 값은 "전날 장 마감" 기준
//   (한국 = 전날 종가, 미국 = 새벽 마감 종가). 그날 낮에 한 입출금이 다음 구간에 들어가도록.
//   월 단위로만 저장: 기록 날짜가 그 달의 말일일 때만 저장, 아니면 아무것도 안 함 (시세 조회도 안 함)
//   (cron 은 28~31일 22:00 UTC = 다음 날 07:00 KST 에 실행 → 말일 다음 날 아침에 한 번 저장됨)
//   직접 입력('manual')한 날은 덮어쓰지 않음. 총 자산 0원(빈 포트폴리오·빈 계좌)은 건너뜀.
//   전체(account_id 비움) + 계좌별(013: 그 계좌 주식 평가금액 + 예수금, 달러는 현재 환율) 함께 저장
// =====================================================================
import { adminDb } from './kis.js'
import { refreshPrices } from './refresh.js'
import { kstToday } from './fx.js'

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const isMonthEnd = (ymd) => addDays(ymd, 1).endsWith('-01')

// only: 특정 포트폴리오만 · refresh: false 면 시세 갱신 없이 지금 저장된 시세로
export async function takeSnapshots({ date = addDays(kstToday(), -1), only = null, refresh: doRefresh = true } = {}) {
  if (!isMonthEnd(date)) return { date, saved: 0, skipped: '말일이 아니라 저장하지 않음' }
  const db = adminDb()

  let refresh = null
  if (doRefresh) {
    try {
      refresh = await refreshPrices()
    } catch (e) {
      console.error('[snapshot] refresh', e)
      refresh = { error: e.message }
    }
  }

  const [sums, hv, cb, fx, manual] = await Promise.all([
    db.from('portfolio_summary').select('portfolio_id, total_asset'),
    db.from('holding_values').select('portfolio_id, account_id, value_krw').not('account_id', 'is', null),
    db.from('cash_balances').select('portfolio_id, account_id, currency, amount').not('account_id', 'is', null),
    db.from('exchange_rates').select('rate_to_krw').eq('currency', 'USD').maybeSingle(),
    db.from('asset_snapshots').select('portfolio_id, account_id').eq('snap_date', date).eq('source', 'manual'),
  ])
  for (const r of [sums, hv, cb, fx, manual]) if (r.error) throw r.error

  // 총 자산: 'portfolio|' = 전체, 'portfolio|account' = 계좌
  const totals = new Map()
  const add = (pid, acc, v) => { const k = `${pid}|${acc ?? ''}`; totals.set(k, (totals.get(k) || 0) + Number(v || 0)) }
  for (const s of sums.data) add(s.portfolio_id, null, s.total_asset)
  const usd = Number(fx.data?.rate_to_krw || 0)
  for (const h of hv.data) add(h.portfolio_id, h.account_id, h.value_krw)
  for (const c of cb.data) add(c.portfolio_id, c.account_id, c.currency === 'USD' ? Math.round(Number(c.amount) * usd) : c.amount)

  const keep = new Set(manual.data.map((r) => `${r.portfolio_id}|${r.account_id ?? ''}`))
  const rows = []
  let skippedManual = 0
  for (const [k, v] of totals) {
    const [pid, acc] = k.split('|')
    if (only && !only.includes(Number(pid))) continue
    if (keep.has(k)) { skippedManual++; continue }
    if (!(v > 0)) continue
    rows.push({ portfolio_id: Number(pid), account_id: acc ? Number(acc) : null, snap_date: date, total_asset: Math.round(v), source: 'auto' })
  }

  if (rows.length) {
    const { error: uErr } = await db.from('asset_snapshots').upsert(rows, { onConflict: 'portfolio_id,snap_date,account_id' })
    if (uErr) throw uErr
  }

  return { date, saved: rows.length, accounts: rows.filter((r) => r.account_id).length, skippedManual, refresh }
}

/** 지난달 말일 (KST, YYYY-MM-DD) */
export const lastMonthEnd = (today = kstToday()) => addDays(`${today.slice(0, 7)}-01`, -1)

/**
 * 새로고침 때 호출 — 로그인한 사용자 포트폴리오의 지난달 말일 기록이 없으면 지금 총 자산으로 저장
 *   이미 있으면(직접 입력·자동) 아무것도 안 함 → 한 달에 한 번만 저장
 *   포트폴리오를 그 말일 뒤에 만들었으면 저장 안 함 (그때는 자산이 없었으므로)
 *   시세는 방금 갱신한 값을 그대로 씀 (refresh: false)
 * @returns 저장 결과 | null (저장할 필요 없음)
 */
export async function ensureLastMonthSnapshot(userId, { today = kstToday() } = {}) {
  const db = adminDb()
  const date = lastMonthEnd(today)
  const { data: pf, error } = await db.from('portfolios').select('id, created_at').eq('owner_id', userId).order('id').limit(1).maybeSingle()
  if (error) throw error
  if (!pf) return null
  const createdKst = new Date(new Date(pf.created_at).getTime() + 9 * 3600000).toISOString().slice(0, 10)
  if (createdKst > date) return null
  const { data: had, error: hErr } = await db.from('asset_snapshots').select('source').eq('portfolio_id', pf.id).eq('snap_date', date).is('account_id', null).maybeSingle()
  if (hErr) throw hErr
  if (had) return null
  return takeSnapshots({ date, only: [pf.id], refresh: false })
}
