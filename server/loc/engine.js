// =====================================================================
// LOC 자동 분할매수 — 계산 엔진 (순수 함수, 주문·DB 없음)
//
//   하루 투자금 D = 총 예산 ÷ 분할 횟수, 잔액 이월 없음
//   모든 주문은 LOC(장 마감 지정가). 체결 여부는 그날 종가가 정함 (B 방식)
//   주문 값은 전날 확정된 값으로: 평단(증권사 잔고), 신저가(사이클 종가 최저), 보유 수량, 전일 종가
//   현재가는 매수 LOC 상한(현재가 × 1.2)에만 사용 — 미국 브로커가 매도호가 +30% 넘는 매수를 거부
//
//   1일차 (보유 0) : D 전부, LOC = min(전일 종가 × 1.15, 상한), 계단 −20%
//   2일차~ (매일)  : ① 평단 50%   — D/2, LOC = min(평단, 상한), 계단 −35%
//                    ② 신저가 50% — D/2, LOC = 신저가,          계단 −20%
//                    매도         — 보유 전량, LOC = 평단 × (1 + 매도 기준) (올림)
//   남은 예산이 모자라면 ① 먼저 남은 만큼, 1주도 못 사면 매수 없음 (매도는 계속)
//
//   계단식 LOC: 기본 floor(금액 ÷ LOC)주 @LOC + n번째 주식을 금액 ÷ n 가격에 1주씩
//               (계단 깊이까지, 최대 maxSteps 건 — 넘치면 묶음, 묶음 가격 = 금액 ÷ 마지막 n)
//               → 종가 c 에서 체결 수량 = floor(금액 ÷ c) (계단 범위 안) = 예산 안 최대 수량
// =====================================================================

export const DEFAULTS = {
  sellPct: 10,        // 매도 기준 (%)
  capPct: 20,         // 매수 LOC 상한: 현재가 대비 (%)
  firstPct: 15,       // 1일차 LOC: 전일 종가 대비 (%)
  depthAvg: 0.35,     // ① 계단 깊이
  depthLow: 0.2,      // ② · 1일차 계단 깊이
  maxSteps: 10,       // 주문 하나당 계단 최대 건수
  lowOnly: false,     // true: ① 평단 매수 멈춤, ② 신저가 매수만 (020)
}

const cents = (v) => Math.round(v * 100) / 100
const floorCents = (v) => Math.floor(v * 100 + 1e-9) / 100
const ceilCents = (v) => Math.ceil(v * 100 - 1e-9) / 100

/**
 * 계단식 LOC 주문 목록
 * @returns {{ price: number, qty: number }[]} 첫 줄 = 기본 주문 (가격 높은 순)
 */
export function ladder(amount, limit, { depth = 0.2, maxSteps = DEFAULTS.maxSteps } = {}) {
  if (!(amount > 0) || !(limit > 0)) return []
  const base = Math.floor(amount / limit + 1e-9)
  const orders = base > 0 ? [{ price: cents(limit), qty: base }] : []
  const ns = []
  for (let n = base + 1; ; n++) {
    if (floorCents(amount / n) < limit * (1 - depth)) break
    ns.push(n)
  }
  const size = Math.ceil(ns.length / maxSteps) || 1
  for (let i = 0; i < ns.length; i += size) {
    const group = ns.slice(i, i + size)
    orders.push({ price: floorCents(amount / group.at(-1)), qty: group.length })
  }
  return orders
}

/** 계단 주문들을 종가 close 에 냈을 때 체결 수량 */
export const filledQty = (steps, close) => steps.filter((s) => close <= s.price).reduce((t, s) => t + s.qty, 0)

/**
 * 하루 주문 계획
 * @param {object} s
 * @param {number} s.dailyAmount  하루 투자금 D ($)
 * @param {number} s.remaining    남은 예산 ($)
 * @param {number} s.holdQty      보유 수량 (매도 가능 수량)
 * @param {number|null} s.avg     평단 (증권사 잔고), 보유 0 이면 null
 * @param {number|null} s.low     신저가 (사이클 종가 최저), 없으면 null
 * @param {number} s.prevClose    전일 종가
 * @param {number|null} s.current 주문 직전 현재가 (상한 계산용, 없으면 상한 없음)
 * @returns {{ sell: {price,qty}|null, buys: {tag,amount,limit,steps}[], exhausted: boolean }}
 */
export function planDay(s, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const cap = s.current > 0 ? cents(s.current * (1 + o.capPct / 100)) : Infinity
  const sell = s.holdQty > 0 && s.avg > 0 ? { price: ceilCents(s.avg * (1 + o.sellPct / 100)), qty: s.holdQty } : null

  const wants = s.holdQty > 0
    ? [
        // lowOnly(020): ① 평단 매수 멈춤 → ② 신저가 매수만
        ...(o.lowOnly ? [] : [{ tag: 'avg', amount: floorCents(s.dailyAmount / 2), limit: cents(Math.min(s.avg, cap)), depth: o.depthAvg }]),
        { tag: 'low', amount: floorCents(s.dailyAmount / 2), limit: cents(s.low), depth: o.depthLow },
      ]
    : [{ tag: 'first', amount: floorCents(s.dailyAmount), limit: cents(Math.min(s.prevClose * (1 + o.firstPct / 100), cap)), depth: o.depthLow }]

  // 남은 예산 안에서 앞에서부터 (① 먼저)
  let room = floorCents(Math.max(0, s.remaining))
  const buys = []
  for (const w of wants) {
    if (!(w.limit > 0)) continue
    const amount = floorCents(Math.min(w.amount, room))
    const steps = ladder(amount, w.limit, { depth: w.depth, maxSteps: o.maxSteps })
    if (!steps.length) continue
    room = floorCents(room - amount)
    buys.push({ tag: w.tag, amount, limit: w.limit, steps })
  }
  return { sell, buys, exhausted: buys.length === 0 }
}

/**
 * 합친 방식 하루 주문 — 매수는 planDay 와 같고(신저가 = 가장 싼 묶음 매수가), 매도는 가장 싼 묶음 1개
 *   매도 LOC = 묶음 매수가 × (1 + lotSellPct) (올림), 수량 = 그 묶음 수량
 * @param {object} s planDay 와 같음 (low 대신 lots 를 넘김)
 * @param {{date, qty, price}[]} s.lots 들고 있는 묶음
 * @returns {{ sell: {price,qty,lot}|null, buys, exhausted, low }}
 */
export function planLoopDay(s, opts = {}) {
  const o = { lotSellPct: 5, ...opts }
  const lot = s.lots.length ? s.lots.reduce((a, b) => (b.price < a.price ? b : a)) : null
  const low = lot ? lot.price : null
  const p = planDay({ ...s, low }, o)
  const sell = lot ? { price: ceilCents(lot.price * (1 + o.lotSellPct / 100)), qty: lot.qty, lot } : null
  return { ...p, sell, low }
}

/**
 * 하루 결과 (종가 close 기준) — 시뮬레이션·미리보기용
 * @returns {{ sold: boolean, buyQty: number, buyAmount: number }}
 */
export function settleDay(plan, close) {
  if (plan.sell && close >= plan.sell.price) return { sold: true, buyQty: 0, buyAmount: 0 }
  const buyQty = plan.buys.reduce((t, b) => t + filledQty(b.steps, close), 0)
  return { sold: false, buyQty, buyAmount: cents(buyQty * close) }
}
