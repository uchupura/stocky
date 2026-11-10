// LOC 계산 엔진 시험 — 사용자와 표로 확인한 예시 + 2026-11-02 SOXL 실제 주문
//   실행: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ladder, filledQty, planDay, planLoopDay, settleDay } from './engine.js'
import { buildLots, cheapestLot } from './lots.js'

const prices = (steps) => steps.map((s) => (s.qty > 1 ? `${s.price}x${s.qty}` : `${s.price}`))

// 사이클 시뮬레이션: 종가 목록으로 하루씩 (평단은 체결로 계산 — 실제 운영에서는 증권사 잔고 평단)
function simulate({ budget, splits, closes, prev0, currents = [], sellPct = 10 }) {
  const D = budget / splits
  let qty = 0, cost = 0, spent = 0, low = null, prevClose = prev0
  const days = []
  for (const [i, close] of closes.entries()) {
    const plan = planDay({ dailyAmount: D, remaining: budget - spent, holdQty: qty, avg: qty ? cost / qty : null, low, prevClose, current: currents[i] ?? null }, { sellPct })
    const r = settleDay(plan, close)
    if (r.sold) {
      const avg = cost / qty
      days.push({ day: i + 1, sold: qty, pnl: Math.round((qty * close - qty * avg) * 100) / 100 })
      return { days, done: true }
    }
    qty += r.buyQty; cost += r.buyAmount; spent += r.buyAmount
    low = low === null ? close : Math.min(low, close)
    prevClose = close
    days.push({ day: i + 1, buy: r.buyQty, qty, avg: qty ? Math.round((cost / qty) * 100) / 100 : null, low, spent: Math.round(spent * 100) / 100, exhausted: plan.exhausted })
  }
  return { days, done: false }
}

test('계단: 1일차 $500 @57.5 → 기본 8주 + 계단 $55.55, $50', () => {
  assert.deepEqual(prices(ladder(500, 57.5, { depth: 0.2 })), ['57.5x8', '55.55', '50'])
})

test('계단: 종가별 체결 수량 = 예산 안 최대 수량', () => {
  const steps = ladder(500, 57.5, { depth: 0.2 })
  assert.equal(filledQty(steps, 58), 0)
  assert.equal(filledQty(steps, 57), 8)
  assert.equal(filledQty(steps, 54), 9)
  assert.equal(filledQty(steps, 50), 10)
  for (const c of [57, 54, 52, 50, 48]) assert.ok(filledQty(steps, c) * c <= 500)
})

test('계단: 건수가 많으면 묶음 (최대 10건), 묶음도 예산 안', () => {
  const steps = ladder(1000, 10, { depth: 0.35 })
  assert.ok(steps.length <= 11)
  for (const c of [10, 9, 8, 7, 6.5]) assert.ok(filledQty(steps, c) * c <= 1000 + 1e-9, `종가 ${c}`)
})

test('B 방식 예시: 8일 사이클 → 8일차 50주 전량 매도, 수익 $263.40', () => {
  const r = simulate({ budget: 20000, splits: 40, closes: [50, 47, 49.9, 39.8, 41, 39, 47, 48.5], prev0: 50 })
  assert.deepEqual(r.days.map((d) => d.buy ?? `매도${d.sold}`), [10, 10, 0, 12, 6, 12, 0, '매도50'])
  assert.deepEqual(r.days.slice(0, 7).map((d) => d.low), [50, 47, 47, 39.8, 39.8, 39, 39])
  assert.equal(r.days.at(-1).pnl, 263.4)
  assert.equal(r.done, true)
})

test('예산 소진: 매수 멈추고 매도는 계속 → 8일차 34주 매도, 수익 $179.00', () => {
  const r = simulate({ budget: 1600, splits: 4, closes: [50, 47, 45, 44, 42, 46, 49, 51.5], prev0: 50 })
  assert.equal(r.days[4].buy, 2)                  // 5일차: 남은 $112 로 ① 만
  assert.equal(r.days[5].exhausted, true)         // 6일차: 1주도 못 사서 매수 없음
  assert.equal(r.days.at(-1).sold, 34)
  assert.equal(r.days.at(-1).pnl, 179)
})

test('남은 예산이 모자라면 ① 먼저, ② 는 남은 만큼(없으면 안 걸음)', () => {
  const p = planDay({ dailyAmount: 400, remaining: 112, holdQty: 32, avg: 46.5, low: 44, prevClose: 44 })
  assert.deepEqual(p.buys.map((b) => [b.tag, b.amount]), [['avg', 112]])
})

test('매수 상한: 평단이 현재가 +20% 보다 높으면 LOC = 현재가 × 1.2', () => {
  const p = planDay({ dailyAmount: 500, remaining: 10000, holdQty: 292, avg: 110.7433, low: 70, prevClose: 77.05, current: 80.53 })
  assert.equal(p.buys[0].limit, 96.64)
  assert.equal(p.buys[1].limit, 70)
})

test('1일차: LOC = min(전일 종가 × 1.15, 현재가 × 1.2)', () => {
  assert.equal(planDay({ dailyAmount: 500, remaining: 500, holdQty: 0, avg: null, low: null, prevClose: 50, current: null }).buys[0].limit, 57.5)
  assert.equal(planDay({ dailyAmount: 500, remaining: 500, holdQty: 0, avg: null, low: null, prevClose: 50, current: 45 }).buys[0].limit, 54)
})

test('2026-11-02 SOXL 실제 주문 13건과 같음', () => {
  const p = planDay({ dailyAmount: 2383.97, remaining: 38690.72, holdQty: 292, avg: 110.7433, low: 77.05, prevClose: 77.05, current: 80.661 })
  assert.deepEqual(p.sell, { price: 121.82, qty: 292 })
  const [avg, low] = p.buys
  assert.equal(avg.amount, 1191.98)
  assert.deepEqual(prices(avg.steps), ['96.79x12', '91.69', '85.14', '79.46', '74.49', '70.11', '66.22'])
  assert.deepEqual(prices(low.steps), ['77.05x15', '74.49', '70.11', '66.22', '62.73'])
  // 어떤 종가에서도 하루 투자금 안
  for (const c of [96.79, 90, 85, 80, 77.05, 74, 70, 63]) assert.ok(settleDay(p, c).buyAmount <= 2383.97, `종가 ${c}`)
  assert.equal(settleDay(p, 121.82).sold, true)
})

// ===== 합친 방식 (매수 B · 가장 싼 묶음 +5% 매도) =====
const fill = (date, side, qty, price) => ({ date, no: `${date}${side}${qty}`, side, qty, price, amount: Math.round(qty * price * 100) / 100 })

test('묶음: 날짜별 매수 = 묶음, 매도는 가장 싼 묶음부터 · 실현 수익', () => {
  const r = buildLots([fill('20261001', 'buy', 10, 100), fill('20261002', 'buy', 5, 90), fill('20261002', 'buy', 5, 90), fill('20261003', 'buy', 8, 95), fill('20261005', 'sell', 10, 95)])
  assert.deepEqual(r.lots.map((l) => [l.date, l.qty, l.price]), [['20261001', 10, 100], ['20261003', 8, 95]])
  assert.equal(r.spent, 2660); assert.equal(r.sold, 950); assert.equal(r.realized, 50)
  assert.deepEqual(r.sales[0], { date: '20261005', qty: 10, cost: 900, amount: 950, pnl: 50, pct: 5.56, avg: 95, brokerPnl: 0, brokerPct: 0, lots: [{ date: '20261002', qty: 10, price: 90 }] })
  assert.equal(cheapestLot(r.lots).date, '20261003')
})

test('인출: 보유가 전부 팔린 날 그동안 실현 수익 × 50%', () => {
  const r = buildLots([fill('20261001', 'buy', 10, 100), fill('20261002', 'buy', 10, 80), fill('20261005', 'sell', 10, 84), fill('20261006', 'sell', 10, 105)])
  assert.equal(r.lots.length, 0)
  assert.equal(r.realized, 90) // (84−80)×10 + (105−100)×10
  assert.deepEqual(r.withdrawals, [{ date: '20261006', profit: 90, amount: 45 }])
  assert.equal(r.withdrawn, 45)
  assert.equal(buildLots([fill('20261001', 'buy', 1, 10), fill('20261002', 'sell', 1, 11)], { withdrawPct: 0 }).withdrawn, 0)
})

test('합친 방식 주문: 매도 = 가장 싼 묶음 ×1.05 그 수량, ② 신저가 = 가장 싼 묶음 매수가', () => {
  const lots = [{ date: '20261001', qty: 14, price: 164.27 }, { date: '20261105', qty: 47, price: 40.87 }, { date: '20261106', qty: 24, price: 45.97 }]
  const p = planLoopDay({ dailyAmount: 2383.97, remaining: 30000, holdQty: 85, avg: 80, lots, prevClose: 45.97, current: 45.97 })
  assert.deepEqual(p.sell, { price: 42.92, qty: 47, lot: lots[1] })
  assert.equal(p.low, 40.87)
  assert.deepEqual(p.buys.map((b) => [b.tag, b.limit]), [['avg', 55.16], ['low', 40.87]])
  // 묶음이 없으면 매도 없음 · 첫날 규칙
  const z = planLoopDay({ dailyAmount: 500, remaining: 500, holdQty: 0, avg: null, lots: [], prevClose: 50, current: null })
  assert.equal(z.sell, null); assert.equal(z.buys[0].tag, 'first')
})

// 백테스트(2026/10/05~11/06 SOXL 실제 종가)와 같은 결과 — 현재가 = 전날 종가, 판 돈 다시 안 넣음
test('합친 방식 시뮬레이션 = 백테스트: 매도 7번 · 실현 +$1,348.03 · 312주 · 산 금액 $46,461.64', () => {
  const closes = [164.27, 164.26, 158.91, 142.52, 139.76, 128.4, 127.57, 110.54, 107.35, 93.67, 98.65, 97.55, 103.24, 82.11, 83.56, 90.5, 101.08, 107.35, 102.39, 77.05, 68.17, 73.12, 66.68, 40.87, 45.97]
  const budget = 71519.1, daily = 2383.97
  let prev = 163.71, avg = null, qty = 0
  const fills = []
  closes.forEach((close, i) => {
    const date = `d${String(i).padStart(2, '0')}`
    const b = buildLots(fills)
    const p = planLoopDay({ dailyAmount: daily, remaining: budget - b.spent, holdQty: qty, avg, lots: b.lots, prevClose: prev, current: prev })
    if (p.sell && close >= p.sell.price) { fills.push(fill(date, 'sell', p.sell.qty, close)); qty -= p.sell.qty; if (!qty) avg = null }
    const q = p.buys.reduce((t, x) => t + filledQty(x.steps, close), 0)
    if (q) { avg = qty ? (qty * avg + q * close) / (qty + q) : close; qty += q; fills.push(fill(date, 'buy', q, close)) }
    prev = close
  })
  const r = buildLots(fills)
  assert.equal(r.sales.length, 7); assert.equal(r.realized, 1348.03)
  assert.equal(qty, 312); assert.equal(r.lots.reduce((t, l) => t + l.qty, 0), 312)
  assert.equal(r.spent, 46461.64)
})

test('증권사 기준 손익: 평단(이동평균) 대비 — 내 방식은 수익, 증권사 앱은 손실', () => {
  // 비싸게 산 묶음 10주 @100 + 싸게 산 10주 @50 → 평단 75 · 싼 묶음 10주를 55 에 팔면
  const r = buildLots([fill('20261001', 'buy', 10, 100), fill('20261002', 'buy', 10, 50), fill('20261005', 'sell', 10, 55)])
  const x = r.sales[0]
  assert.equal(x.pnl, 50); assert.equal(x.pct, 10)                 // 내 방식: 묶음 매수가 50 대비 +10%
  assert.equal(x.avg, 75); assert.equal(x.brokerPnl, -200); assert.equal(x.brokerPct, -26.67) // 증권사: 평단 75 대비
  assert.deepEqual(r.soldLots, [{ date: '20261002', qty: 10, price: 50, soldOn: '20261005' }])
  assert.equal(r.avg, 75) // 팔아도 평단 그대로
})

test('제외한 거래는 증권사 평단에만 들어감 (묶음 · 산 금액 · 수익에는 안 들어감)', () => {
  const ex = [fill('20261003', 'buy', 10, 60), fill('20261004', 'sell', 10, 61)]
  const r = buildLots([fill('20261001', 'buy', 10, 100), fill('20261002', 'buy', 10, 50)], { excludedFills: ex })
  assert.equal(r.spent, 1500); assert.equal(r.lots.length, 2)
  assert.equal(r.avg, 70) // (1000 + 500 + 600) / 30 = 70, 팔아도 그대로
})
