import { ref } from 'vue'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { refreshMarket } from '../lib/api'

const FALLBACK_COLOR = '#8b95a1'

// Postgres 에러 코드 → 화면에 보여줄 메시지
function friendlyError(e, fallback) {
  if (e?.code === '23505') {
    // unique 위반: 보유 종목 중복 / 종목 코드 중복
    return /symbol/.test(e.message || '') ? '같은 종목 코드가 이미 등록되어 있어요.' : '이미 보유 중인 종목이에요.'
  }
  if (e?.code === '23514') return '입력값을 다시 확인해 주세요.' // check 제약 위반
  if (e?.code === '42501') return '권한이 없어요. Supabase RLS 정책을 확인해 주세요.'
  return e?.message || fallback
}

/**
 * 포트폴리오 데이터 조회 + 추가/삭제/순서 저장
 *  - portfolio_summary 뷰: 총 평가금액, 수익률, 원금, 국내/해외 금액
 *  - holding_values 뷰: 종목별 평가금액, 수익금, 수익률
 *  - stocks: 종목 검색·로고 색, exchange_rates: 달러 환율
 */
export function usePortfolio() {
  const summary = ref(null)
  const holdings = ref([])
  const stocks = ref([])
  const usdRate = ref(null)
  const fxUpdatedAt = ref(null) // 현재가·환율 마지막 갱신 시각
  const refreshing = ref(false)
  const loading = ref(true)
  const error = ref('')

  /**
   * @param {{ silent?: boolean }} opts silent = true 면 로딩 화면 없이 조용히 갱신 (추가/삭제 후)
   */
  async function load({ silent = false } = {}) {
    if (!silent) loading.value = true
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
      if (!s) throw new Error('이 계정에 연결된 포트폴리오가 없어요.')

      const [h, st, fx] = await Promise.all([
        supabase
          .from('holding_values')
          .select('*')
          .eq('portfolio_id', s.portfolio_id)
          .order('sort_order')
          .order('holding_id'),
        supabase.from('stocks').select('id, symbol, name, market, exchange, currency, current_price, prev_close, logo_color').order('name'),
        supabase.from('exchange_rates').select('rate_to_krw, updated_at').eq('currency', 'USD').maybeSingle(),
      ])
      for (const r of [h, st, fx]) if (r.error) throw r.error

      const byStock = Object.fromEntries(st.data.map((x) => [x.id, x]))
      summary.value = s
      holdings.value = h.data.map((x) => ({
        ...x,
        logo_color: byStock[x.stock_id]?.logo_color || FALLBACK_COLOR,
        prev_close: byStock[x.stock_id]?.prev_close ?? null, // 전일 종가 (시세 보기 · 오늘 수익률)
      }))
      stocks.value = st.data
      usdRate.value = fx.data?.rate_to_krw != null ? Number(fx.data.rate_to_krw) : null
      fxUpdatedAt.value = fx.data?.updated_at ?? null
    } catch (e) {
      console.error(e)
      error.value = friendlyError(e, '데이터를 불러오지 못했어요.')
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

  /**
   * 검색에서 고른 종목을 stocks 에 반영하고 id 를 돌려준다.
   *   이미 등록된 종목 → 현재가·거래소만 최신으로 갱신 / 처음 보는 종목 → 새로 등록
   */
  async function upsertStock(master, price, prevClose) {
    const now = new Date().toISOString()
    const existing = stocks.value.find((s) => s.symbol === master.symbol)
    if (existing) {
      const patch = { exchange: master.exchange }
      if (price > 0) Object.assign(patch, { current_price: price, price_updated_at: now })
      if (prevClose > 0) patch.prev_close = prevClose
      const { error: e } = await supabase.from('stocks').update(patch).eq('id', existing.id)
      if (e) throw e
      return existing.id
    }
    if (!(price > 0)) throw new Error('현재가가 있어야 새 종목을 등록할 수 있어요.')
    const { data, error: e } = await supabase
      .from('stocks')
      .insert({
        symbol: master.symbol,
        name: master.name,
        market: master.market,
        currency: master.currency,
        exchange: master.exchange,
        current_price: price,
        price_updated_at: now,
        ...(prevClose > 0 ? { prev_close: prevClose } : {}),
        logo_color: master.logo_color,
      })
      .select('id')
      .single()
    if (e) throw e
    return data.id
  }

  /**
   * 보유 종목 추가 (목록 맨 아래에 붙음)
   * @param {{ master?: object, price?: number, stockId?: number, newStock?: object, quantity: number, avgPrice: number }} p
   *   - master + price: 전체 종목 검색에서 고른 경우 (현재가 자동 조회 값)
   *   - stockId: 이미 등록된 종목을 고른 경우
   *   - newStock: 직접 입력으로 새 종목 등록 { symbol, name, market, currency, current_price, logo_color }
   */
  async function addHolding({ master, price, prevClose, stockId, newStock, quantity, avgPrice, avgFxRate = null }) {
    try {
      let id = stockId
      if (master) {
        id = await upsertStock(master, price, prevClose)
      } else if (newStock) {
        const { data, error: e } = await supabase.from('stocks').insert(newStock).select('id').single()
        if (e) throw e
        id = data.id
      }

      const nextOrder = Math.max(0, ...holdings.value.map((h) => h.sort_order)) + 1
      const { error: e } = await supabase.from('holdings').insert({
        portfolio_id: summary.value.portfolio_id,
        stock_id: id,
        quantity,
        avg_price: avgPrice,
        sort_order: nextOrder,
        ...(avgFxRate ? { avg_fx_rate: avgFxRate } : {}), // 해외 주식 매수 환율
      })
      if (e) throw e
    } catch (e) {
      console.error(e)
      // 새 종목은 등록됐는데 보유 추가만 실패한 경우에도 목록을 최신으로
      await load({ silent: true })
      throw new Error(friendlyError(e, '추가하지 못했어요.'))
    }
    await load({ silent: true })
  }

  /**
   * 보유 정보 수정 (수량 · 평균 단가 · 매수 환율)
   * @param {number} holdingId
   * @param {{ quantity: number, avgPrice: number, avgFxRate?: number|null }} p avgFxRate 는 해외 주식만
   */
  async function updateHolding(holdingId, { quantity, avgPrice, avgFxRate }) {
    const patch = { quantity, avg_price: avgPrice }
    if (avgFxRate !== undefined) patch.avg_fx_rate = avgFxRate
    const { error: e, count } = await supabase
      .from('holdings')
      .update(patch, { count: 'exact' })
      .eq('id', holdingId)
    if (e) throw new Error(friendlyError(e, '수정하지 못했어요.'))
    if (count === 0) {
      await load({ silent: true })
      throw new Error('수정되지 않았어요. 이미 삭제된 종목일 수 있어요.')
    }
    await load({ silent: true })
  }

  /**
   * 보유 종목 현재가 + 환율 갱신 (서버 /api/refresh) → 화면 다시 불러오기
   * 서버가 1분에 한 번만 실제로 조회하므로 자주 불러도 괜찮다.
   * @returns {Promise<{ skipped: boolean, failed: Array }>}
   */
  async function refreshPrices() {
    if (refreshing.value) return null
    refreshing.value = true
    try {
      const r = await refreshMarket()
      await load({ silent: true })
      return r
    } finally {
      refreshing.value = false
    }
  }

  /**
   * 예수금 저장 (원화·달러 각각 한 줄, 없으면 추가 / 있으면 수정)
   * @param {{ krw: number, usd: number }} p 원화는 원, 달러는 $ 단위
   */
  async function saveCash({ krw, usd }) {
    const portfolio_id = summary.value.portfolio_id
    const { error: e } = await supabase.from('cash_balances').upsert(
      [
        { portfolio_id, currency: 'KRW', amount: krw },
        { portfolio_id, currency: 'USD', amount: usd },
      ],
      { onConflict: 'portfolio_id,currency' },
    )
    if (e) {
      if (e.code === '42P01' || /cash_balances/.test(e.message || '')) {
        throw new Error('예수금 기능을 쓰려면 008_cash_balances.sql 을 먼저 실행해 주세요.')
      }
      throw new Error(friendlyError(e, '예수금을 저장하지 못했어요.'))
    }
    await load({ silent: true })
  }

  /** 보유 종목 삭제 (종목 정보 stocks 는 남겨둠) */
  async function removeHolding(holdingId) {
    const { error: e, count } = await supabase
      .from('holdings')
      .delete({ count: 'exact' })
      .eq('id', holdingId)
    if (e) throw new Error(friendlyError(e, '삭제하지 못했어요.'))
    // RLS 에 삭제 정책이 없으면 에러 없이 0건 삭제됨 (또는 다른 곳에서 이미 삭제됨)
    if (count === 0) {
      await load({ silent: true })
      throw new Error('삭제되지 않았어요. 이미 삭제됐거나 삭제 권한(002_holdings_delete.sql)이 없어요.')
    }
    await load({ silent: true })
  }

  return {
    summary, holdings, stocks, usdRate, fxUpdatedAt, refreshing, loading, error,
    load, saveOrder, addHolding, updateHolding, removeHolding, refreshPrices, saveCash,
  }
}
