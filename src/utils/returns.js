// =====================================================================
// 월별 · 누적 수익률
//
//   월 수익률 (입출금 효과 제거) — 기록(총 자산) 두 개 사이 = 한 구간, Modified Dietz:
//     r = (끝 자산 − 시작 자산 − 순입금) ÷ (시작 자산 + Σ 순입금 × 가중치)
//     가중치 = (구간 끝 − 입금일) ÷ 구간 일수   ← 입금이 구간 안에 머문 비율
//   (입출금은 그날 장 마감 뒤에 들어온 것으로 봄 → 기록 날짜와 같은 날 입금은 그 구간에 포함, 가중치 0)
//   한 달에 구간이 여럿이면 곱해서 연결  Π(1+r) − 1
//   구간이 여러 달에 걸치면(중간 달 기록 없음) 끝 날짜의 달에 넣고, 사이 달은 "기록 없음"
//
//   누적 (원금 대비, 홈의 "누적 원금 대비 수익률"과 같은 기준)
//     누적 입금액 = 그 기록 날짜까지 입금 − 출금 합계
//     누적 수익   = 총 자산 − 누적 입금액
//     누적 수익률 = 누적 수익 ÷ 누적 입금액   (누적 입금액이 0 이하면 계산 불가)
// =====================================================================

const DAY = 86400000
const dayNum = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / DAY
const monthKey = (ymd) => ymd.slice(0, 7)
const nextMonth = (key) => {
  const y = +key.slice(0, 4)
  const m = +key.slice(5, 7)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

// 입출금 → 부호 있는 금액 (입금 +, 출금 −)
const flowOf = (d) => (d.kind === 'withdraw' ? -1 : 1) * Number(d.amount)

// 누적 (원금 대비)
function cumulative(value, flows, date) {
  let net = 0
  for (const f of flows) if (f.date <= date) net += f.amount
  const profit = value - net
  return { cumNet: net, cumProfit: profit, cumRate: net > 0 ? profit / net : null }
}

/**
 * @param snapshots [{ snap_date, total_asset, source? }]
 * @param deposits  [{ txn_date, kind, amount }]
 * @param live      { date, total_asset } | null — 지금 총 자산 (이번 달 진행 중 값)
 */
export function computeReturns(snapshots, deposits, live = null) {
  const points = snapshots
    .map((s) => ({ date: s.snap_date, value: Number(s.total_asset), source: s.source || 'manual' }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  // 지금 값은 마지막 기록보다 뒤일 때만 (같은 날 기록이 있으면 기록 우선)
  if (live && live.total_asset > 0 && (!points.length || live.date > points.at(-1).date)) {
    points.push({ date: live.date, value: Number(live.total_asset), source: 'live' })
  }

  const flows = deposits
    .map((d) => ({ date: d.txn_date, amount: flowOf(d) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  // 구간 계산
  const intervals = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const T = dayNum(b.date) - dayNum(a.date)
    let net = 0
    let weighted = 0
    for (const f of flows) {
      if (f.date <= a.date || f.date > b.date) continue
      net += f.amount
      weighted += f.amount * ((dayNum(b.date) - dayNum(f.date)) / T)
    }
    const base = a.value + weighted
    const profit = b.value - a.value - net
    intervals.push({ from: a.date, to: b.date, start: a.value, end: b.value, net, profit, rate: base > 0 ? profit / base : null })
  }

  // 월별 묶음: 첫 기록의 달 ~ 마지막 기록의 달
  const months = []
  if (points.length) {
    const byMonth = new Map()
    for (const iv of intervals) {
      const k = monthKey(iv.to)
      if (!byMonth.has(k)) byMonth.set(k, [])
      byMonth.get(k).push(iv)
    }
    const flowByMonth = new Map()
    for (const f of flows) flowByMonth.set(monthKey(f.date), (flowByMonth.get(monthKey(f.date)) || 0) + f.amount)
    const lastPointOf = new Map()
    for (const p of points) lastPointOf.set(monthKey(p.date), p)

    const lastKey = monthKey(points.at(-1).date)
    for (let k = monthKey(points[0].date); k <= lastKey; k = nextMonth(k)) {
      const ivs = byMonth.get(k) || []
      let rate = null
      let profit = null
      if (ivs.length) {
        profit = ivs.reduce((s, iv) => s + iv.profit, 0)
        rate = ivs.some((iv) => iv.rate === null) ? null : ivs.reduce((g, iv) => g * (1 + iv.rate), 1) - 1
      }
      const lp = lastPointOf.get(k)
      months.push({
        key: k,
        year: +k.slice(0, 4),
        month: +k.slice(5, 7),
        endValue: lp ? lp.value : null,        // 계좌 총액 (그 달 마지막 기록)
        endDate: lp ? lp.date : null,
        live: lp?.source === 'live',           // 이번 달 진행 중 (지금 값 사용)
        net: flowByMonth.get(k) || 0,          // 월 입금액 (입금 − 출금)
        profit,                                // 월 수익 (null = 계산 불가: 시작 달 · 기록 없음)
        rate,                                  // 월 수익률
        // 누적 (원금 대비) — 그 달 기록이 없으면 null
        ...(lp ? cumulative(lp.value, flows, lp.date) : { cumNet: null, cumProfit: null, cumRate: null }),
      })
    }
  }

  const last = points.at(-1)
  return {
    points,
    intervals,
    months,
    ...(last ? cumulative(last.value, flows, last.date) : { cumNet: null, cumProfit: null, cumRate: null }),
    since: points[0]?.date ?? null,
    until: last?.date ?? null,
  }
}

// 그 달의 마지막 날 (YYYY-MM → YYYY-MM-DD)
export function monthEnd(key) {
  const y = +key.slice(0, 4)
  const m = +key.slice(5, 7)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
