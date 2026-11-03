import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'

function friendly(e, fallback) {
  if (e?.code === '23505') return '같은 이름의 계좌가 이미 있어요.'
  if (e?.code === '23514') return '입력값을 다시 확인해 주세요. (국내 주식은 원 단위 정수, 미국 주식은 달러)'
  if (e?.code === '42P01' || /dividends|fx_daily/.test(e?.message || '')) {
    return '배당 기능을 쓰려면 011_dividends.sql 을 먼저 실행해 주세요.'
  }
  return e?.message || fallback
}

/**
 * 배당금 내역 (계좌는 입출금과 공용)
 *   amount     : 받은 금액 (세후, 국내 원 / 미국 달러)
 *   amount_krw : 지급일 환율 기준 원화 환산액 (DB 자동 계산)
 * @param {import('vue').Ref<number|null>} portfolioId
 */
export function useDividends(portfolioId) {
  const dividends = ref([])
  const accounts = ref([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')

  async function load() {
    if (!portfolioId.value) return
    loading.value = true
    error.value = ''
    try {
      const [d, a] = await Promise.all([
        supabase.from('dividends')
          .select('*') // 015(cash_applied) 적용 전에도 동작하도록 전체 칸
          .eq('portfolio_id', portfolioId.value)
          .order('pay_date', { ascending: false }).order('id', { ascending: false }),
        supabase.from('accounts').select('id, name, sort_order').eq('portfolio_id', portfolioId.value)
          .order('sort_order').order('id'),
      ])
      for (const r of [d, a]) if (r.error) throw r.error
      dividends.value = d.data.map((x) => ({
        ...x, amount: Number(x.amount), fx_rate: Number(x.fx_rate), amount_krw: Number(x.amount_krw), cash_applied: !!x.cash_applied,
      }))
      accounts.value = a.data
      loaded.value = true
    } catch (e) {
      console.error(e)
      error.value = friendly(e, '배당 내역을 불러오지 못했어요.')
    } finally {
      loading.value = false
    }
  }

  // ===== 집계 (화면용 — 홈 탭 그래프는 DB 의 dividend_monthly / dividend_yearly 뷰 사용) =====
  const totals = computed(() => {
    const thisYear = new Date().getFullYear()
    let all = 0
    let usd = 0
    const byYear = {}
    const byAccount = {}
    for (const d of dividends.value) {
      all += d.amount_krw
      if (d.currency === 'USD') usd += d.amount
      const y = Number(d.pay_date.slice(0, 4))
      byYear[y] = (byYear[y] || 0) + d.amount_krw
      byAccount[d.account_id] = (byAccount[d.account_id] || 0) + d.amount_krw
    }
    const years = Object.keys(byYear).map(Number).sort((a, b) => b - a)
    return { all, usd, thisYear: byYear[thisYear] || 0, thisYearLabel: thisYear, byYear, years, byAccount }
  })

  // ===== 계좌 (입출금과 공용) =====
  async function addAccount(name) {
    const nextOrder = Math.max(0, ...accounts.value.map((a) => a.sort_order)) + 1
    const { data, error: e } = await supabase
      .from('accounts')
      .insert({ portfolio_id: portfolioId.value, name: name.trim(), sort_order: nextOrder })
      .select('id, name, sort_order')
      .single()
    if (e) throw new Error(friendly(e, '계좌를 추가하지 못했어요.'))
    accounts.value = [...accounts.value, data]
    return data
  }

  // ===== 배당 =====
  /**
   * @param {{ id?: number, symbol: string, market: 'KR'|'US', stock_name: string, amount: number,
   *           fx_rate?: number, fx_date?: string|null, account_id: number, pay_date: string, memo?: string }} p
   */
  // ===== 예수금 반영 (015) — 한국 배당 = 원화, 미국 배당 = 달러 예수금, 계좌별 =====
  const round2 = (v) => Math.round(v * 100) / 100
  /** 계좌 예수금에 delta 더하기 (0 아래로는 안 내려감) → 0 에서 멈췄으면 true */
  async function adjustCash(accountId, currency, delta) {
    if (!delta) return false
    const pid = portfolioId.value
    const { data, error: e1 } = await supabase.from('cash_balances').select('amount')
      .eq('portfolio_id', pid).eq('account_id', accountId).eq('currency', currency).maybeSingle()
    if (e1) throw e1
    const raw = round2(Number(data?.amount || 0) + delta)
    const { error: e2 } = await supabase.from('cash_balances').upsert(
      { portfolio_id: pid, account_id: accountId, currency, amount: Math.max(0, raw) },
      { onConflict: 'portfolio_id,account_id,currency' },
    )
    if (e2) throw e2
    return raw < 0
  }
  /** [{ accountId, currency, delta }] 를 같은 계좌·통화끼리 합쳐서 반영 */
  async function applyCashChanges(changes) {
    const merged = new Map()
    for (const c of changes) {
      const k = `${c.accountId}|${c.currency}`
      merged.set(k, { ...c, delta: round2((merged.get(k)?.delta || 0) + c.delta) })
    }
    let clamped = false
    try {
      for (const c of merged.values()) clamped = (await adjustCash(c.accountId, c.currency, c.delta)) || clamped
    } catch (e) {
      console.error(e)
      throw new Error('배당은 저장됐지만 예수금 반영에 실패했어요. 내 투자 탭에서 예수금을 직접 확인해 주세요.')
    }
    return { clamped }
  }

  /**
   * 배당 저장 — applyCash 면 그 계좌 예수금에 반영, 수정 시 예전 반영분은 되돌린 뒤 다시 반영
   * @returns {Promise<{ cashChanged: boolean, clamped: boolean }>}
   */
  async function saveDividend(p) {
    const us = p.market === 'US'
    const old = p.id ? dividends.value.find((d) => d.id === p.id) : null
    const applyCash = !!p.applyCash
    const row = {
      portfolio_id: portfolioId.value,
      account_id: p.account_id,
      symbol: p.symbol,
      market: p.market,
      stock_name: p.stock_name,
      currency: us ? 'USD' : 'KRW',
      amount: p.amount,
      fx_rate: us ? p.fx_rate : 1,
      fx_date: us ? p.fx_date || null : null,
      pay_date: p.pay_date,
      memo: p.memo?.trim() || null,
      cash_applied: applyCash,
    }
    const { error: e } = p.id
      ? await supabase.from('dividends').update(row).eq('id', p.id)
      : await supabase.from('dividends').insert(row)
    if (e) {
      if (/cash_applied/.test(e.message || '')) throw new Error('예수금 자동 반영을 쓰려면 015_dividend_cash.sql 을 먼저 실행해 주세요.')
      throw new Error(friendly(e, '저장하지 못했어요.'))
    }
    const changes = []
    if (old?.cash_applied) changes.push({ accountId: old.account_id, currency: old.currency, delta: -old.amount })
    if (applyCash) changes.push({ accountId: row.account_id, currency: row.currency, delta: Number(row.amount) })
    let r = { clamped: false }
    try { r = await applyCashChanges(changes) } finally { await load() }
    return { cashChanged: changes.some((c) => c.delta), clamped: r.clamped }
  }
  /** 배당 삭제 — 예수금에 반영됐던 배당이면 그만큼 되돌림 */
  async function removeDividend(id) {
    const old = dividends.value.find((d) => d.id === id)
    const { error: e } = await supabase.from('dividends').delete().eq('id', id)
    if (e) throw new Error(friendly(e, '삭제하지 못했어요.'))
    let r = { clamped: false }
    try {
      if (old?.cash_applied) r = await applyCashChanges([{ accountId: old.account_id, currency: old.currency, delta: -old.amount }])
    } finally { await load() }
    return { cashChanged: !!old?.cash_applied, clamped: r.clamped }
  }

  return { dividends, accounts, loading, loaded, error, totals, load, addAccount, saveDividend, removeDividend }
}
