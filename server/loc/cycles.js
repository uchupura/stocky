// =====================================================================
// LOC 사이클 DB (014 loc_cycles · loc_daily) — 서버 전용 (service_role)
//   * 사이클 설정은 화면이 저장(본인 RLS), 서버는 그 값을 읽어 계산 — 화면이 보낸 설정을 그대로 믿지 않음
//   * 날짜별 내역은 서버만 씀: [계산] 때 증권사 체결·일봉으로 다시 계산해 통째로 덮어씀
// =====================================================================
import { adminDb } from '../kis.js'
import { HttpError } from '../auth.js'

const ymd = (d) => String(d).replaceAll('-', '')          // 2026-10-05 → 20261005
const dash = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` // 20261005 → 2026-10-05

/** 사이클 1개 — 로그인한 사용자의 포트폴리오 것이 아니면 거부 */
export async function cycleForUser(cycleId, userId) {
  const { data, error } = await adminDb()
    .from('loc_cycles')
    .select('*, portfolios!inner(owner_id)')
    .eq('id', cycleId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.portfolios.owner_id !== userId) throw new HttpError(404, '사이클을 찾지 못했어요.')
  return data
}

/** DB 사이클 → 계산용 설정 (manual.normalize 에 넘길 형태) */
export const settingsOf = (c) => ({
  symbol: c.symbol,
  budget: Number(c.budget),
  splits: c.splits,
  startDate: ymd(c.start_date),
  sellPct: Number(c.sell_pct),
  // 018: 방식 (018 적용 전이면 칸이 없어서 B)
  strategy: c.strategy === 'loop' ? 'loop' : 'b',
  lotSellPct: c.lot_sell_pct == null ? 5 : Number(c.lot_sell_pct),
  withdrawPct: c.withdraw_pct == null ? 50 : Number(c.withdraw_pct),
  exclude: (c.exclude_order_nos || []).join(','),
})

/** 날짜별 내역 통째로 덮어쓰기 (history: buildPlan 의 최신순 목록) */
export async function saveHistory(cycleId, history) {
  const db = adminDb()
  const base = (e) => ({
    cycle_id: cycleId, trade_date: dash(e.date), close: e.close,
    buy_qty: e.buyQty, buy_amount: e.buyAmount, sell_qty: e.sellQty, sell_amount: e.sellAmount,
    cum_qty: e.cumQty, cum_spent: e.cumSpent, updated_at: new Date().toISOString(),
  })
  // 019: 합친 방식 매도 수익 (내 방식 / 증권사 앱) · 인출 · 판 묶음
  const full = (e) => ({
    ...base(e),
    sell_pnl: e.sellPnl ?? null, sell_pct: e.sellPct ?? null,
    broker_pnl: e.brokerPnl ?? null, broker_pct: e.brokerPct ?? null, broker_avg: e.brokerAvg ?? null,
    withdraw: e.withdraw ?? null, sold_from: e.soldFrom ?? null, lot_sold: e.lotSold ?? null,
  })
  const { error: delErr } = await db.from('loc_daily').delete().eq('cycle_id', cycleId)
  if (delErr) throw delErr
  if (history.length) {
    let { error } = await db.from('loc_daily').insert(history.map(full))
    // 019 적용 전이면 새 칸이 없음 → 기본 칸만으로 다시 (이미 지웠으므로 내역이 비지 않게)
    if (error && /sell_pnl|sell_pct|broker_|withdraw|sold_from|lot_sold/.test(error.message || '')) ({ error } = await db.from('loc_daily').insert(history.map(base)))
    if (error) throw error
  }
}

/** 사이클 종료 기록 (전량 매도 확인) */
export async function endCycle(cycleId, result) {
  const { error } = await adminDb()
    .from('loc_cycles')
    .update({ status: 'ended', ended_on: dash(result.endedOn), sold_qty: result.soldQty, sold_amount: result.soldAmount, bought_amount: result.boughtAmount, realized_pnl: result.pnl })
    .eq('id', cycleId)
    .eq('status', 'active')
  if (error) throw error
}
