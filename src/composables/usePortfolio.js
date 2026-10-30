import { ref } from 'vue'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const FALLBACK_COLOR = '#8b95a1'

/**
 * 포트폴리오 데이터 조회 + 드래그 순서 저장
 *  - portfolio_summary 뷰: 총 평가금액, 수익률, 원금, 국내/해외 금액
 *  - holding_values 뷰: 종목별 평가금액, 수익금, 수익률
 *  - stocks: 로고 색, exchange_rates: 달러 환율 (화면 하단 표시용)
 */
export function usePortfolio() {
  const summary = ref(null)
  const holdings = ref([])
  const usdRate = ref(null)
  const loading = ref(true)
  const error = ref('')

  async function load() {
    loading.value = true
    error.value = ''
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase 연결 정보가 없어요. .env 파일을 확인해 주세요.')
      }

      const { data: s, error: e1 } = await supabase
        .from('portfolio_summary')
        .select('*')
        .order('portfolio_id')
        .limit(1)
        .maybeSingle()
      if (e1) throw e1
      if (!s) throw new Error('포트폴리오가 아직 없어요. seed.sql 을 실행했는지 확인해 주세요.')

      const [h, st, fx] = await Promise.all([
        supabase
          .from('holding_values')
          .select('*')
          .eq('portfolio_id', s.portfolio_id)
          .order('sort_order')
          .order('holding_id'),
        supabase.from('stocks').select('id, logo_color'),
        supabase.from('exchange_rates').select('rate_to_krw').eq('currency', 'USD').maybeSingle(),
      ])
      for (const r of [h, st, fx]) if (r.error) throw r.error

      const colors = Object.fromEntries(st.data.map((x) => [x.id, x.logo_color]))
      summary.value = s
      holdings.value = h.data.map((x) => ({ ...x, logo_color: colors[x.stock_id] || FALLBACK_COLOR }))
      usdRate.value = fx.data?.rate_to_krw ?? null
    } catch (e) {
      console.error(e)
      error.value = e.message || '데이터를 불러오지 못했어요.'
    } finally {
      loading.value = false
    }
  }

  /**
   * 화면 순서를 먼저 바꾸고(즉시 반응) DB 에 저장한다.
   * 저장에 실패하면 원래 순서로 되돌리고 에러를 던진다.
   */
  async function saveOrder(holdingIds) {
    const prev = holdings.value
    const byId = Object.fromEntries(prev.map((x) => [x.holding_id, x]))
    holdings.value = holdingIds.map((id) => byId[id])

    const { error: e } = await supabase.rpc('reorder_holdings', {
      p_portfolio_id: summary.value.portfolio_id,
      p_holding_ids: holdingIds,
    })
    if (e) {
      holdings.value = prev
      throw e
    }
  }

  return { summary, holdings, usdRate, loading, error, load, saveOrder }
}
