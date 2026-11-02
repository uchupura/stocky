// =====================================================================
// 월말 총 자산 기록 (012 asset_snapshots) — 서버 전용, Vercel Cron 이 호출
//   1) 현재가·환율 갱신 (refreshPrices 재사용, 실패해도 마지막 시세로 계속)
//   2) 포트폴리오별 총 자산(portfolio_summary.total_asset) → 'auto' 로 저장
//
//   기록 날짜 = KST 어제: 아침 7시 무렵 실행되므로 값은 "전날 장 마감" 기준
//   (한국 = 전날 종가, 미국 = 새벽 마감 종가). 그날 낮에 한 입출금이 다음 구간에 들어가도록.
//   월 단위로만 저장: 기록 날짜가 그 달의 말일일 때만 저장, 아니면 아무것도 안 함 (시세 조회도 안 함)
//   (cron 은 28~31일 22:00 UTC = 다음 날 07:00 KST 에 실행 → 말일 다음 날 아침에 한 번 저장됨)
//   직접 입력('manual')한 날은 덮어쓰지 않음. 총 자산 0원(빈 포트폴리오)은 건너뜀.
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

// only: 특정 포트폴리오만 (테스트용)
export async function takeSnapshots({ date = addDays(kstToday(), -1), only = null } = {}) {
  if (!isMonthEnd(date)) return { date, saved: 0, skipped: '말일이 아니라 저장하지 않음' }
  const db = adminDb()

  let refresh
  try {
    refresh = await refreshPrices()
  } catch (e) {
    console.error('[snapshot] refresh', e)
    refresh = { error: e.message }
  }

  const { data: sums, error } = await db.from('portfolio_summary').select('portfolio_id, total_asset')
  if (error) throw error

  const { data: manual, error: mErr } = await db
    .from('asset_snapshots')
    .select('portfolio_id')
    .eq('snap_date', date)
    .eq('source', 'manual')
  if (mErr) throw mErr
  const keep = new Set(manual.map((r) => r.portfolio_id))

  const rows = sums
    .filter((s) => (!only || only.includes(s.portfolio_id)) && !keep.has(s.portfolio_id) && Number(s.total_asset) > 0)
    .map((s) => ({ portfolio_id: s.portfolio_id, snap_date: date, total_asset: Math.round(Number(s.total_asset)), source: 'auto' }))

  if (rows.length) {
    const { error: uErr } = await db.from('asset_snapshots').upsert(rows, { onConflict: 'portfolio_id,snap_date' })
    if (uErr) throw uErr
  }

  return { date, saved: rows.length, skippedManual: keep.size, refresh }
}
