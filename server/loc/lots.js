// =====================================================================
// 합친 방식 — 체결 내역 → 묶음 · 판 금액 · 실현 수익 · 인출 (순수 함수, 주문·DB 없음)
//
//   묶음: 하루에 체결된 매수 = 묶음 1개 (매수가 = 그날 체결 평균, LOC 라 보통 종가 하나)
//   매도: 들고 있는 묶음 중 가장 싼 묶음부터 차감 (합친 방식은 가장 싼 묶음을 그 수량만큼 팖)
//   인출: 매도로 보유가 0주가 된 날, 지난 인출 뒤 실현 수익 × withdrawPct% — 다시 투자하지 않음
//         (앱은 인출 가능 금액을 알리고 예산에서 뺌 · 실제 출금은 직접)
//   증권사 기준 손익: 증권사 앱처럼 평단(이동평균 — 살 때 평균 다시, 팔 때 그대로) 대비. 제외한 거래도 증권사 평단에는 들어가므로
//                    평단 계산에만 넣음 (excluded) — 묶음 · 산 금액 · 판 금액 · 내 방식 수익에는 안 넣음
//   체결 내역으로 매번 다시 계산하므로 따로 저장할 값이 없음
// =====================================================================

const r2 = (v) => Math.round(v * 100) / 100
const unit = (l) => l.cost / l.qty

/**
 * @param {{ date: string, no: string, side: 'buy'|'sell', qty: number, price: number, amount: number }[]} fills 제외 주문번호를 뺀 체결
 * @param {{ withdrawPct?: number, excludedFills?: object[] }} opts excludedFills: 제외한 거래 — 증권사 평단 계산에만 씀
 * @returns {{ lots: {date, qty, price, cost}[], spent, sold, realized, withdrawn, withdrawals: {date, profit, amount}[],
 *             sales: {date, qty, cost, amount, pnl, pct, avg, brokerPnl, brokerPct, lots: {date, qty, price}[]}[], soldLots: {date, qty, price, soldOn}[], avg }}
 */
export function buildLots(fills, { withdrawPct = 50, excludedFills = [] } = {}) {
  const tagged = [...fills.map((f) => ({ ...f, ex: false })), ...excludedFills.map((f) => ({ ...f, ex: true }))]
  const list = tagged.sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1)) // 같은 날은 매도 먼저 (LOC 동시 체결)
  let lots = [], spent = 0, sold = 0, realized = 0, withdrawn = 0, sinceW = 0
  let hold = 0, avg = 0 // 증권사 평단 (이동평균, 제외 거래 포함)
  const withdrawals = [], sales = [], soldLots = []
  for (const f of list) {
    // 증권사 평단: 살 때 평균 다시, 팔 때 그대로 (다 팔리면 0)
    const avgBefore = avg
    if (f.side === 'buy') { avg = hold + f.qty > 0 ? (hold * avg + f.amount) / (hold + f.qty) : 0; hold += f.qty } else { hold -= f.qty; if (hold <= 0) { hold = 0; avg = 0 } }
    if (f.ex) continue
    if (f.side === 'buy') {
      spent += f.amount
      const l = lots.find((x) => x.date === f.date)
      if (l) { l.qty += f.qty; l.cost += f.amount } else lots.push({ date: f.date, qty: f.qty, cost: f.amount })
      continue
    }
    // 매도: 가장 싼 묶음부터
    sold += f.amount
    let q = f.qty, cost = 0
    const used = []
    lots.sort((a, b) => unit(a) - unit(b))
    while (q > 0 && lots.length) {
      const l = lots[0], take = Math.min(q, l.qty), u = unit(l)
      l.qty -= take; l.cost -= u * take; cost += u * take; q -= take
      used.push({ date: l.date, qty: take, price: Math.round(u * 10000) / 10000 })
      soldLots.push({ date: l.date, qty: take, price: Math.round(u * 10000) / 10000, soldOn: f.date })
      if (l.qty <= 0) lots.shift()
    }
    const pnl = f.amount - cost
    realized += pnl; sinceW += pnl
    const brokerCost = f.qty * avgBefore // 증권사 앱: 평단 대비
    sales.push({ date: f.date, qty: f.qty, cost: r2(cost), amount: r2(f.amount), pnl: r2(pnl), pct: cost ? r2((f.amount / cost - 1) * 100) : 0,
      avg: Math.round(avgBefore * 10000) / 10000, brokerPnl: r2(f.amount - brokerCost), brokerPct: brokerCost ? r2((f.amount / brokerCost - 1) * 100) : 0, lots: used })
    if (!lots.length && sinceW > 0 && withdrawPct > 0) {
      const w = r2(sinceW * withdrawPct / 100)
      withdrawn += w; withdrawals.push({ date: f.date, profit: r2(sinceW), amount: w }); sinceW = 0
    }
  }
  lots.sort((a, b) => a.date.localeCompare(b.date))
  return {
    lots: lots.map((l) => ({ date: l.date, qty: l.qty, price: Math.round(unit(l) * 10000) / 10000, cost: r2(l.cost) })),
    spent: r2(spent), sold: r2(sold), realized: r2(realized), withdrawn: r2(withdrawn), withdrawals, sales, soldLots,
    avg: Math.round(avg * 10000) / 10000,
  }
}

/** 가장 싼 묶음 (같으면 먼저 산 묶음) — 없으면 null */
export const cheapestLot = (lots) => lots.reduce((a, b) => (!a || b.price < a.price ? b : a), null)
