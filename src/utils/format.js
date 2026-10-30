// 금액·수익률 표시 형식

export const fmt = (n) => Math.round(Number(n)).toLocaleString('ko-KR')

export const signed = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n))

// 상승 = 빨강(up), 하락 = 파랑(down), 보합 = 회색(flat)
export const tone = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat')

export const rateText = (r) => `(${r > 0 ? '+' : ''}${Number(r).toFixed(1)}%)`

// 수익률(%) = 수익금 ÷ 원금 × 100
// DB 의 profit_rate 는 소수 2자리로 반올림된 값이라, 화면에서 다시 1자리로 반올림하면
// 오차가 생길 수 있음 (예: 2.653 → 2.65 → 2.6). 그래서 원본 금액으로 직접 계산한다.
export const ratePct = (profit, cost) => (Number(cost) ? (Number(profit) / Number(cost)) * 100 : 0)

// 단가: 미국 주식은 달러, 국내 주식은 원
export const unitPrice = (currency, v) =>
  currency === 'USD' ? `$${Number(v).toFixed(2)}` : `${fmt(v)}원`

// 환율: 1,335.2 처럼 소수점 2자리까지
export const fxText = (r) => Number(r).toLocaleString('ko-KR', { maximumFractionDigits: 2 })

// 시각: 오늘이면 "14:56", 아니면 "10/30 14:56"
export const timeText = (iso) => {
  const d = new Date(iso)
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

// 주식 수: 정수면 그대로, 소수점 주식이면 최대 6자리
export const qtyText = (q) =>
  `${Number(q).toLocaleString('ko-KR', { maximumFractionDigits: 6 })}주`
