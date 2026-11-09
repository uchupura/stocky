// =====================================================================
// LOC 수동 운영 — 오늘 주문 계산 · 전송 (서버 전용)
//   설정(화면에서 입력, 브라우저 저장): 종목, 총 투자금, 분할 횟수, 시작일, 매도 기준, 제외할 주문번호
//     하루 투자금 = 총 투자금 ÷ 분할 횟수 (센트 내림), 거래소는 잔고 또는 시세 조회로 자동
//   증권사에서 계산:
//     보유 수량 · 평단        ← 해외 잔고 (평단 = 증권사 평단)
//     쓴 금액 · 남은 예산      ← 시작일 이후 매수 체결 합계 (제외 주문 빼고), 총 예산 = 하루 투자금 × 분할 횟수
//     신저가                  ← 시작일 이후 일봉 종가 최저 (장이 끝난 날만)
//     현재가 · 전일 종가       ← 시세 (현재가는 매수 LOC 상한에만)
//   합친 방식(strategy 'loop'): 체결 내역 → 묶음(lots.js) · 매도 = 가장 싼 묶음 ×(1+묶음 매도%) 그 수량
//     신저가 = 가장 싼 묶음 매수가 · 남은 예산 = 총 예산 − 산 금액 + 판 금액 − 인출 · 사이클 종료 없음
// =====================================================================
import { planDay, planLoopDay, settleDay, filledQty } from './engine.js'
import { buildLots } from './lots.js'
import { holding, quote, dailyCloses, fills, todayOrders, placeLoc, ordersOn, MARKET_OF } from '../meritz.js'

const VENDOR_OF = Object.fromEntries(Object.entries(MARKET_OF).map(([v, m]) => [m, v]))
// 보유 중이 아니면 시세가 나오는 거래소를 찾음 (아멕스 → 나스닥 → 뉴욕)
async function findVendor(symbol) {
  for (const m of ['AX', 'OQ', 'NY']) {
    try { await quote(symbol, m); return VENDOR_OF[m] } catch { /* 다음 거래소 */ }
  }
  return null
}

const round2 = (v) => Math.round(v * 100) / 100

// 미국 동부 시각 기준: 장이 끝난(16:30 이후) 날까지만 종가로 인정
export function lastClosedUsDate(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((x) => [x.type, x.value]))
  const d = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`)
  if (Number(p.hour) * 60 + Number(p.minute) < 16 * 60 + 30) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10).replaceAll('-', '')
}

/** 실제 주문 모드인지 (LOC_ORDER_ENABLED = 1 / true — 앞뒤 공백·따옴표 무시) */
export const orderEnabled = () => ['1', 'true'].includes(String(process.env.LOC_ORDER_ENABLED || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase())

/** 계산한 주문 → 보낼 주문 목록 (매도 먼저, 매수는 계단 순서) */
export function orderList(plan) {
  const list = []
  if (plan.sell) list.push({ tag: 'sell', side: 'sell', ...plan.sell })
  for (const b of plan.buys) for (const st of b.steps) list.push({ tag: b.tag, side: 'buy', price: st.price, qty: st.qty })
  return list
}

/** 입력 설정 검사 · 정리 */
export function normalize(s = {}) {
  const symbol = String(s.symbol || '').trim().toUpperCase()
  const splits = Math.floor(Number(s.splits))
  // 총 투자금이 기준 (예전 형식: 하루 투자금만 있으면 × 분할 횟수)
  const budget = round2(Number(s.budget) > 0 ? Number(s.budget) : Number(s.dailyAmount) * splits)
  const out = {
    symbol,
    budget,
    dailyAmount: splits > 0 ? Math.floor((budget / splits) * 100 + 1e-9) / 100 : NaN,
    splits,
    startDate: String(s.startDate || '').replaceAll('-', ''),
    sellPct: Number(s.sellPct ?? 10),
    strategy: s.strategy === 'loop' ? 'loop' : 'b',
    lotSellPct: Number(s.lotSellPct ?? 5),
    withdrawPct: Number(s.withdrawPct ?? 50),
    exclude: [...new Set(String(s.exclude || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))],
  }
  const err = []
  if (!/^[A-Z.]{1,10}$/.test(symbol)) err.push('종목(ticker)을 확인해 주세요')
  if (!(out.budget > 0)) err.push('총 투자금을 확인해 주세요')
  if (!(out.splits > 0)) err.push('분할 횟수를 확인해 주세요')
  if (!/^\d{8}$/.test(out.startDate)) err.push('사이클 시작일을 확인해 주세요')
  if (!(out.sellPct > 0 && out.sellPct < 100)) err.push('매도 기준(%)을 확인해 주세요')
  if (!(out.lotSellPct > 0 && out.lotSellPct < 100)) err.push('묶음 매도 기준(%)을 확인해 주세요')
  if (!(out.withdrawPct >= 0 && out.withdrawPct <= 100)) err.push('인출 비율(%)을 확인해 주세요')
  return { settings: out, errors: err }
}

// [주문 넣기] 때 현재가가 [계산] 때 값에서 이만큼 안이면 그 값을 그대로 써서 같은 주문을 보냄
//   (① 평단 주문 가격 = min(평단, 현재가×1.2) 라 현재가가 1센트만 움직여도 주문이 달라짐)
//   2% 움직여도 매수 상한은 지금 현재가 대비 약 22% — 증권사 30% 제한 안쪽
export const REF_PRICE_TOLERANCE = 0.02

/**
 * 오늘 주문 계산 (주문 없음)
 * @param refPrice [계산] 때 쓴 현재가 — 지금 현재가와 2% 안이면 이 값으로 계산 (같은 주문이 나오게)
 */
export async function buildPlan(settings, { refPrice = null } = {}) {
  const s = settings
  const h = await holding(s.symbol)
  const vendor = h?.vendor || (await findVendor(s.symbol))
  const market = MARKET_OF[vendor]
  if (!market) throw new Error(`${s.symbol} 시세를 찾지 못했어요. 종목(ticker)을 확인해 주세요.`)

  const q = await quote(s.symbol, market)
  const ref = Number(refPrice)
  const calcPrice = ref > 0 && Math.abs(q.price - ref) / q.price <= REF_PRICE_TOLERANCE ? ref : q.price // 주문 계산에 쓸 현재가
  const closedTo = lastClosedUsDate()
  const closes = closedTo >= s.startDate ? await dailyCloses(s.symbol, market, s.startDate, closedTo) : []
  const allFills = await fills(s.symbol, s.startDate)
  const excluded = new Set(s.exclude)
  const used = allFills.filter((f) => !excluded.has(f.no))
  const buys = used.filter((f) => f.side === 'buy')
  const spent = round2(buys.reduce((t, f) => t + f.amount, 0))
  const budget = s.budget
  const loop = s.strategy === 'loop'
  const lotInfo = loop ? buildLots(used, { withdrawPct: s.withdrawPct }) : null
  // 남은 예산: B = 총 예산 − 산 금액 / 합친 = + 판 금액 − 인출 (판 돈 다시 넣음)
  const remaining = loop ? round2(budget - spent + lotInfo.sold - lotInfo.withdrawn) : round2(budget - spent)
  // 신저가: B = 시작일부터 최저 종가 / 합친 = 들고 있는 묶음 중 가장 싼 매수가 (팔리면 그다음 묶음)
  const minLot = loop && lotInfo.lots.length ? lotInfo.lots.reduce((a, b) => (b.price < a.price ? b : a)) : null
  const low = loop ? (minLot ? minLot.price : null) : closes.length ? Math.min(...closes.map((c) => c.close)) : null
  const lowDate = loop ? minLot?.date ?? null : low === null ? null : closes.find((c) => c.close === low).date
  // 안전장치: 증권사 보유 수량 = 체결 내역(시작일 이후, 제외 빼고) 매수 − 매도 여야 함
  const netQty = used.reduce((t, f) => t + (f.side === 'buy' ? f.qty : -f.qty), 0)
  const warnings = []
  if (netQty !== (h?.qty || 0)) warnings.push(`증권사 보유 ${h?.qty || 0}주와 체결 내역 합계 ${netQty}주가 달라요. 시작일·제외 주문번호를 확인해 주세요.`)
  // 안전장치: 체결이 있었던 날(장 마감된 날)의 종가를 못 받으면 신저가가 틀릴 수 있음 → 주문 안 보냄
  const closeDates = new Set(closes.map((c) => c.date))
  const noClose = [...new Set(used.map((f) => f.date))].filter((dt) => dt <= closedTo && !closeDates.has(dt)).sort()
  if (noClose.length) warnings.push(`${noClose.map((dt) => `${dt.slice(4, 6)}/${dt.slice(6, 8)}`).join(', ')} 종가를 증권사에서 받지 못했어요. 신저가가 틀릴 수 있어 주문을 보내지 않아요. 잠시 뒤 다시 [계산]해 주세요.`)
  const orders = await todayOrders(s.symbol)
  const live = orders.filter((o) => o.open > 0 && !o.rejected && o.origNo === '0')

  const state = {
    dailyAmount: s.dailyAmount, remaining, holdQty: h?.qty || 0, avg: h?.qty ? h.avg : null,
    low, prevClose: q.prevClose, current: calcPrice,
  }
  // 사이클 종료: 시작일 이후 매도 체결이 있고 보유가 0주 (전량 매도) → 주문 계산 안 함
  const sells = used.filter((f) => f.side === 'sell')
  const ended = !loop && !(h?.qty) && sells.length > 0 && netQty === 0 // 합친 방식은 끝나지 않음 (0주면 다음 날 다시 첫날 규칙)
    ? (() => {
        const soldAmount = round2(sells.reduce((t, f) => t + f.amount, 0))
        return {
          endedOn: sells.map((f) => f.date).sort().at(-1),
          soldQty: sells.reduce((t, f) => t + f.qty, 0),
          soldAmount, boughtAmount: spent, pnl: round2(soldAmount - spent),
          pnlPct: spent ? round2(((soldAmount - spent) / spent) * 100) : 0,
        }
      })()
    : null
  const plan = ended ? { sell: null, buys: [], exhausted: false }
    : loop ? planLoopDay({ ...state, lots: lotInfo.lots }, { lotSellPct: s.lotSellPct })
    : planDay(state, { sellPct: s.sellPct })

  // 종가별 예상 (주요 가격 지점) — B: 팔리면 사이클 끝(매수 없음) / 합친: 묶음 매도와 매수가 같은 날 함께 체결될 수 있음
  const settle = (c) => {
    if (!loop) return settleDay(plan, c)
    const buyQty = plan.buys.reduce((t, b) => t + filledQty(b.steps, c), 0)
    return { sold: !!plan.sell && c >= plan.sell.price, sellQty: plan.sell && c >= plan.sell.price ? plan.sell.qty : 0, buyQty, buyAmount: round2(buyQty * c) }
  }
  const points = new Set([q.price, q.prevClose, ...plan.buys.flatMap((b) => b.steps.map((x) => x.price))])
  if (plan.sell) points.add(plan.sell.price)
  const preview = [...points].filter((v) => v > 0).sort((a, b) => b - a).map((c) => ({ close: round2(c), ...settle(c) }))

  // 날짜별 내역 (시작일~): 종가 · 매수 · 매도 · 누적 보유 · 누적 쓴 금액 — 최신순
  const byDate = new Map()
  for (const c of closes) byDate.set(c.date, { date: c.date, close: c.close, buyQty: 0, buyAmount: 0, sellQty: 0, sellAmount: 0 })
  for (const f of used) {
    const e = byDate.get(f.date) || { date: f.date, close: null, buyQty: 0, buyAmount: 0, sellQty: 0, sellAmount: 0 }
    if (f.side === 'buy') { e.buyQty += f.qty; e.buyAmount += f.amount } else { e.sellQty += f.qty; e.sellAmount += f.amount }
    byDate.set(f.date, e)
  }
  // 합친 방식: 그날 판 묶음의 수익 · 수익률, 인출
  if (loop) {
    for (const x of lotInfo.sales) { const e = byDate.get(x.date); if (e) { e.sellPnl = round2((e.sellPnl || 0) + x.pnl); e.sellCost = round2((e.sellCost || 0) + x.cost) } }
    for (const w of lotInfo.withdrawals) { const e = byDate.get(w.date); if (e) e.withdraw = w.amount }
  }
  let cumQty = 0, cumSpent = 0
  const history = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
    cumQty += e.buyQty - e.sellQty
    cumSpent += e.buyAmount
    return { ...e, buyAmount: round2(e.buyAmount), sellAmount: round2(e.sellAmount), cumQty, cumSpent: round2(cumSpent), ...(e.sellCost ? { sellPct: round2((e.sellAmount / e.sellCost - 1) * 100) } : {}) }
  }).reverse()

  // 최근 거래일 주문 상세 (체결 · 미체결 소멸 · 취소 · 거부)
  const lastDate = history.find((e) => e.buyQty || e.sellQty)?.date || null
  let lastOrders = []
  if (lastDate) {
    const raw = await ordersOn(s.symbol, lastDate)
    const cancelledNos = new Set(raw.filter((o) => o.origNo !== '0').map((o) => o.origNo))
    lastOrders = raw.filter((o) => o.origNo === '0').map((o) => ({
      ...o,
      excluded: excluded.has(o.no),
      result: o.rejected ? 'rejected' : cancelledNos.has(o.no) && !o.filled ? 'cancelled' : o.filled >= o.qty ? 'filled' : o.filled > 0 ? 'partial' : 'expired',
    })).sort((a, b) => (a.side === b.side ? b.price - a.price : a.side === 'sell' ? -1 : 1))
  }

  // 서버가 다시 계산했을 때 같은 주문인지 확인하는 서명
  const signature = JSON.stringify([plan.sell, plan.buys.map((b) => b.steps)])
  return {
    symbol: s.symbol, name: q.name, vendor, market, dailyAmount: s.dailyAmount, calcPrice,
    holding: { qty: h?.qty || 0, avg: h?.avg ?? null },
    price: q.price, prevClose: q.prevClose,
    budget, spent, remaining, buyDays: new Set(buys.map((f) => f.date)).size,
    low, lowDate, closesUsed: closes.length, closedTo,
    excludedFills: allFills.filter((f) => excluded.has(f.no)),
    plan, preview, live, signature, netQty, warnings, history, lastDate, lastOrders, ended,
    strategy: s.strategy,
    loop: loop ? {
      lotSellPct: s.lotSellPct, withdrawPct: s.withdrawPct,
      lots: lotInfo.lots.map((l) => ({ ...l, sellPrice: Math.ceil(l.price * (1 + s.lotSellPct / 100) * 100 - 1e-9) / 100, next: plan.sell?.lot?.date === l.date })),
      sold: lotInfo.sold, realized: lotInfo.realized, withdrawn: lotInfo.withdrawn, withdrawals: lotInfo.withdrawals, sales: lotInfo.sales,
    } : null,
  }
}

/**
 * 오늘 주문 전송 — 서버에서 다시 계산한 주문이 화면에서 본 것과 같을 때만
 * @returns {{ dryRun, sent: [], statuses: [] }}
 */
export async function submitPlan(settings, signature, { refPrice = null } = {}) {
  const p = await buildPlan(settings, { refPrice })
  if (signature !== p.signature) return { changed: true, preview: p }
  if (p.ended) throw new Error('이 사이클은 전량 매도로 끝났어요. 새 사이클을 시작해 주세요.')
  if (p.warnings.length) throw new Error(`주문을 보내지 않았어요 — ${p.warnings.join(' ')}`)
  if (p.live.length) throw new Error(`오늘 이미 걸린 ${p.symbol} 주문이 ${p.live.length}건 있어요. 중복을 막기 위해 보내지 않았어요.`)
  const totalAmount = p.plan.buys.reduce((t, b) => t + b.amount, 0)
  if (totalAmount > p.remaining + 0.01 || totalAmount > settings.dailyAmount + 0.01) throw new Error('매수 금액이 하루 투자금·남은 예산을 넘어요.')

  const list = orderList(p.plan)

  const dryRun = !orderEnabled()
  if (dryRun) return { dryRun: true, list, preview: p }

  const sent = []
  for (const o of list) {
    const r = await placeLoc({ symbol: p.symbol, vendor: p.vendor, ...o })
    console.log('[loc] 주문', JSON.stringify({ at: new Date().toISOString(), ...o, ...r }))
    sent.push({ ...o, ...r })
    if (!r.ok) break // 정상 접수가 아니면 남은 주문은 보내지 않음
  }
  await new Promise((r) => setTimeout(r, 2500))
  const today = await todayOrders(p.symbol)
  const statuses = sent.map((o) => {
    const t = today.find((x) => x.no === o.no)
    return { ...o, status: !o.ok ? 'failed' : !t ? 'unknown' : t.rejected ? 'rejected' : t.open > 0 ? 'live' : 'closed', reason: t?.rejected || '' }
  })
  return { dryRun: false, sent: statuses, complete: sent.length === list.length && statuses.every((x) => x.status === 'live') }
}
