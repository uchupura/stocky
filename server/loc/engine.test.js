// LOC 계산 엔진 시험 — 사용자와 표로 확인한 예시 + 2026-11-02 SOXL 실제 주문
//   실행: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ladder, filledQty, planDay, settleDay } from './engine.js'

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
