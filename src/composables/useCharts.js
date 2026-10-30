import { reactive } from 'vue'
import { fetchChart } from '../lib/api'

/**
 * 하루 주가 그래프 불러오기
 *   - 한 번에 4종목씩 (국내는 그래프 하나에 KIS 를 약 4번 부르므로 동시 4종목이면 초당 한도 안)
 *   - 이미 받은 종목은 다시 부르지 않음 (force 로 새로고침)
 *   charts[`${market}:${symbol}`] = { status: 'loading'|'ok'|'error', points, prevClose }
 */
export function useCharts() {
  const charts = reactive({})
  const key = (h) => `${h.market}:${h.symbol}`
  let seq = 0

  async function loadCharts(holdings, { force = false } = {}) {
    const run = ++seq
    // 아직 다 받지 못한 종목(없음·실패·이전 요청이 중간에 멈춰 '불러오는 중')은 다시
    const todo = holdings.filter((h) => force || charts[key(h)]?.status !== 'ok')
    for (const h of todo) charts[key(h)] = { ...(charts[key(h)] || {}), status: 'loading' }

    const queue = [...todo]
    const worker = async () => {
      while (queue.length) {
        if (run !== seq) return // 더 최근 요청이 있으면 그만
        const h = queue.shift()
        try {
          const r = await fetchChart(h.symbol, h.market)
          charts[key(h)] = { status: 'ok', points: r.points, prevClose: r.prevClose }
        } catch (e) {
          console.error('[chart]', h.symbol, e.message)
          charts[key(h)] = { status: 'error', points: [], prevClose: null }
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  }

  return { charts, chartKey: key, loadCharts }
}
