// =====================================================================
// 알림 (016 notifications) — 서버 전용 (service_role)
//   * refresh : [새로고침] 버튼 결과 — 현재가·환율 갱신 + 메리츠 계좌 맞춤
//   * loc_buy : 지난 미국 거래일에 걸어 둔 LOC 매수 주문 결과 (갱신할 때마다 확인, 날짜마다 1개)
//               합친 방식이면 묶음 매도 체결(수익 · 수익률)과 전부 매도 시 인출 가능 금액도 (날짜마다 1개)
// =====================================================================
import { adminDb } from './kis.js'
import { ordersOn, fills as meritzFills } from './meritz.js'
import { buildLots } from './loc/lots.js'
import { linkedAccount } from './brokerSync.js'
import { lastClosedUsDate } from './loc/manual.js'

const krw = (v) => `${Math.round(v).toLocaleString('ko-KR')}원`
const usd = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (v) => Math.round(v * 100) / 100
const dot = (ymd) => `${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`

/** 알림 1개 저장 — dedup_key 가 같은 알림이 이미 있으면 만들지 않음 → 새로 만들었으면 true */
export async function notify(portfolioId, { kind, title, body = null, data = {}, dedupKey = null }) {
  const row = { portfolio_id: portfolioId, kind, title, body, data, dedup_key: dedupKey }
  const q = dedupKey
    ? adminDb().from('notifications').upsert(row, { onConflict: 'portfolio_id,dedup_key', ignoreDuplicates: true }).select('id')
    : adminDb().from('notifications').insert(row).select('id')
  const { data: rows, error } = await q
  if (error) throw error
  return rows.length > 0
}

/** 로그인한 사용자의 포트폴리오 id (첫 번째) */
async function portfolioOf(userId) {
  const { data, error } = await adminDb().from('portfolios').select('id').eq('owner_id', userId).order('id').limit(1).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

/** [새로고침] 결과 알림 — prices: refreshPrices() 결과, broker: 메리츠 맞춤 결과(null = 연결 안 됨) */
export async function notifyRefresh(userId, prices, broker) {
  const pid = await portfolioOf(userId)
  if (!pid) return false
  const lines = []
  if (prices.skipped) lines.push(`방금 갱신한 최신 값 · 환율 ${prices.fxRate?.toLocaleString('ko-KR')}원`)
  else lines.push(`${prices.updated}/${prices.total}종목 · 환율 ${prices.fxRate ? `${prices.fxRate.toLocaleString('ko-KR')}원` : '갱신 실패'}`)
  if (prices.failed?.length) lines.push(`갱신 실패: ${prices.failed.map((f) => f.symbol).join(', ')}`)
  if (broker?.error) lines.push(`메리츠 계좌 맞춤 실패: ${broker.error}`)
  else if (broker) {
    const parts = [broker.added && `추가 ${broker.added}`, broker.updated && `수정 ${broker.updated}`, broker.removed && `삭제 ${broker.removed}`, broker.cashChanged && '예수금'].filter(Boolean)
    lines.push(parts.length ? `메리츠 계좌 맞춤: ${parts.join(' · ')}` : '메리츠 계좌는 이미 같아요')
    if (broker.skipped?.length) lines.push(`못 넣은 종목: ${broker.skipped.map((x) => x.name || x.symbol).join(', ')}`)
  }
  return notify(pid, { kind: 'refresh', title: '현재가·환율 갱신', body: lines.join('\n'), data: { prices: { ...prices, failed: prices.failed || [] }, broker } })
}

/** 지난 미국 거래일 = 장이 끝난 마지막 평일 (YYYYMMDD) — 휴장일은 주문이 없어 알림도 없음 */
export function lastUsTradingDate(now = new Date()) {
  const s = lastClosedUsDate(now)
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00Z`)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10).replaceAll('-', '')
}

/**
 * LOC 매수 결과 알림 — 메리츠 연결 계좌 포트폴리오의 진행 중 사이클, 지난 미국 거래일 하루만
 *   그날 걸어 둔 매수 주문(정정·취소 줄·취소된 주문·제외 주문번호 제외)의 체결 합계 → 알림 (사이클·날짜마다 1개)
 *   주문이 없으면 알림 없음
 * @returns 새로 만든 알림 수
 */
export async function checkLocBuys(userId, { date = lastUsTradingDate(), orders = ordersOn, fillsFn = meritzFills } = {}) {
  const link = await linkedAccount(userId)
  if (!link) return 0
  const db = adminDb()
  const [{ data: cycles, error }, { data: fx, error: fxErr }] = await Promise.all([
    db.from('loc_cycles').select('*').eq('portfolio_id', link.portfolioId).eq('status', 'active'), // 018 적용 전에도 되게 전체 칸
    db.from('exchange_rates').select('rate_to_krw').eq('currency', 'USD').maybeSingle(),
  ])
  if (error || fxErr) throw error || fxErr
  const rate = Number(fx?.rate_to_krw || 0)
  let made = 0
  for (const c of cycles) {
    if (date < c.start_date.replaceAll('-', '')) continue
    const key = `loc_buy:${c.id}:${date}`
    const sellKey = `loc_sell:${c.id}:${date}`
    const loop = c.strategy === 'loop'
    const had = async (k) => !!(await db.from('notifications').select('id').eq('portfolio_id', link.portfolioId).eq('dedup_key', k).maybeSingle()).data
    const needBuy = !(await had(key)), needSell = loop && !(await had(sellKey))
    if (!needBuy && !needSell) continue // 이미 알림 있음 → 증권사 조회 안 함
    const excluded = new Set(c.exclude_order_nos || [])
    const raw = await orders(c.symbol, date)

    // 합친 방식: 묶음 매도 체결 → 수익 · 수익률 (+ 보유 전부 매도면 인출 가능 금액)
    if (needSell && raw.some((o) => o.origNo === '0' && o.side === 'sell' && o.filled > 0 && !excluded.has(o.no))) {
      const used = (await fillsFn(c.symbol, c.start_date.replaceAll('-', ''))).filter((f) => !excluded.has(f.no) && f.date <= date)
      const li = buildLots(used, { withdrawPct: c.withdraw_pct == null ? 50 : Number(c.withdraw_pct) })
      const sales = li.sales.filter((x) => x.date === date)
      if (sales.length) {
        const q = sales.reduce((t, x) => t + x.qty, 0), amt = round2(sales.reduce((t, x) => t + x.amount, 0)), cost = sales.reduce((t, x) => t + x.cost, 0), pnl = round2(amt - cost)
        const pct = cost ? round2((amt / cost - 1) * 100) : 0
        const w = li.withdrawals.find((x) => x.date === date)
        const body = [`${dot(date)} · ${q}주 · ${usd(amt)} · 수익 ${pnl >= 0 ? '+' : '-'}${usd(Math.abs(pnl))} (${pct >= 0 ? '+' : ''}${pct}%)`,
          w ? `보유 전부 매도 → 수익 ${usd(w.profit)} 중 ${usd(w.amount)} 인출 가능 (직접 출금)` : `남은 묶음 ${li.lots.length}개 · ${li.lots.reduce((t, l) => t + l.qty, 0)}주`].join('\n')
        if (await notify(link.portfolioId, { kind: 'loc_buy', title: `${c.symbol} 묶음 매도 체결`, body, dedupKey: sellKey, data: { cycleId: c.id, symbol: c.symbol, date, qty: q, amount: amt, pnl, pct, withdraw: w?.amount || 0 } })) made++
      }
    }
    if (!needBuy) continue

    const cancelled = new Set(raw.filter((o) => o.origNo !== '0').map((o) => o.origNo)) // 취소·정정된 원래 주문
    const buys = raw.filter((o) => o.origNo === '0' && o.side === 'buy' && !excluded.has(o.no) && !(cancelled.has(o.no) && !o.filled))
    if (!buys.length) continue
    const qty = buys.reduce((t, o) => t + o.filled, 0)
    const amount = round2(buys.reduce((t, o) => t + o.filled * o.fillPrice, 0))
    const won = Math.round(amount * rate)
    const filledOrders = buys.filter((o) => o.filled > 0).length
    const title = qty ? `${c.symbol} 매수 체결` : `${c.symbol} 매수 미체결`
    const body = qty
      ? `${dot(date)} · ${qty}주 · ${usd(amount)} · 약 ${krw(won)} (환율 ${rate.toLocaleString('ko-KR')}원)\n주문 ${buys.length}건 중 ${filledOrders}건 체결`
      : `${dot(date)} · 주문 ${buys.length}건 모두 체결되지 않았어요`
    if (await notify(link.portfolioId, { kind: 'loc_buy', title, body, dedupKey: key, data: { cycleId: c.id, symbol: c.symbol, date, qty, amount, rate, won, orders: buys.length, filledOrders } })) made++
  }
  return made
}
