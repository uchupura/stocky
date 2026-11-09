// =====================================================================
// 합친 방식 — 체결 내역 → 묶음 · 판 금액 · 실현 수익 · 인출 (순수 함수, 주문·DB 없음)
//
//   묶음: 하루에 체결된 매수 = 묶음 1개 (매수가 = 그날 체결 평균, LOC 라 보통 종가 하나)
//   매도: 들고 있는 묶음 중 가장 싼 묶음부터 차감 (합친 방식은 가장 싼 묶음을 그 수량만큼 팖)
//   인출: 매도로 보유가 0주가 된 날, 지난 인출 뒤 실현 수익 × withdrawPct% — 다시 투자하지 않음
//         (앱은 인출 가능 금액을 알리고 예산에서 뺌 · 실제 출금은 직접)
//   체결 내역으로 매번 다시 계산하므로 따로 저장할 값이 없음
// =====================================================================

const r2 = (v) => Math.round(v * 100) / 100
const unit = (l) => l.cost / l.qty

/**
 * @param {{ date: string, no: string, side: 'buy'|'sell', qty: number, price: number, amount: number }[]} fills 제외 주문번호를 뺀 체결
 * @param {{ withdrawPct?: number }} opts
 * @returns {{ lots: {date, qty, price, cost}[], spent, sold, realized, withdrawn, withdrawals: {date, profit, amount}[], sales: {date, qty, cost, amount, pnl, pct}[] }}
 */
export function buildLots(fills, { withdrawPct = 50 } = {}) {
  const list = [...fills].sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1)) // 같은 날은 매도 먼저 (LOC 동시 체결)
  let lots = [], spent = 0, sold = 0, realized = 0, withdrawn = 0, sinceW = 0
  const withdrawals = [], sales = []
  for (const f of list) {
    if (f.side === 'buy') {
      spent += f.amount
      const l = lots.find((x) => x.date === f.date)
      if (l) { l.qty += f.qty; l.cost += f.amount } else lots.push({ date: f.date, qty: f.qty, cost: f.amount })
      continue
    }
    // 매도: 가장 싼 묶음부터
    sold += f.amount
    let q = f.qty, cost = 0
    lots.sort((a, b) => unit(a) - unit(b))
    while (q > 0 && lots.length) {
      const l = lots[0], take = Math.min(q, l.qty), u = unit(l)
      l.qty -= take; l.cost -= u * take; cost += u * take; q -= take
      if (l.qty <= 0) lots.shift()
    }
    const pnl = f.amount - cost
    realized += pnl; sinceW += pnl
    sales.push({ date: f.date, qty: f.qty, cost: r2(cost), amount: r2(f.amount), pnl: r2(pnl), pct: cost ? r2((f.amount / cost - 1) * 100) : 0 })
    if (!lots.length && sinceW > 0 && withdrawPct > 0) {
      const w = r2(sinceW * withdrawPct / 100)
      withdrawn += w; withdrawals.push({ date: f.date, profit: r2(sinceW), amount: w }); sinceW = 0
    }
  }
  lots.sort((a, b) => a.date.localeCompare(b.date))
  return {
    lots: lots.map((l) => ({ date: l.date, qty: l.qty, price: Math.round(unit(l) * 10000) / 10000, cost: r2(l.cost) })),
    spent: r2(spent), sold: r2(sold), realized: r2(realized), withdrawn: r2(withdrawn), withdrawals, sales,
  }
}

/** 가장 싼 묶음 (같으면 먼저 산 묶음) — 없으면 null */
export const cheapestLot = (lots) => lots.reduce((a, b) => (!a || b.price < a.price ? b : a), null)
