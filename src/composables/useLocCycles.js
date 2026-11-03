import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'

// LOC 사이클 (014) — 설정은 화면이 저장(본인 RLS), 날짜별 내역은 서버가 저장하고 화면은 읽기만
function friendly(e, fallback) {
  if (e?.code === '23505') return '진행 중인 사이클이 이미 있어요.'
  if (e?.code === '23514') return '입력값을 다시 확인해 주세요.'
  if (e?.code === '42P01' || /loc_cycles|loc_daily/.test(e?.message || '')) return '자동매매 설정을 쓰려면 014_loc_cycles.sql 을 먼저 실행해 주세요.'
  return e?.message || fallback
}

/** 화면 입력 → DB 행 */
export function toRow(form, portfolioId) {
  return {
    portfolio_id: portfolioId,
    symbol: String(form.symbol || '').trim().toUpperCase(),
    budget: Number(String(form.budget).replace(/,/g, '')),
    splits: Math.floor(Number(form.splits)),
    start_date: form.startDate,
    sell_pct: Number(form.sellPct),
    exclude_order_nos: [...new Set(String(form.exclude || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))],
  }
}
/** DB 행 → 화면 입력 */
export const toForm = (c) => ({
  symbol: c.symbol, budget: String(Number(c.budget)), splits: c.splits, startDate: c.start_date,
  sellPct: Number(c.sell_pct), exclude: (c.exclude_order_nos || []).join(', '),
})

export function useLocCycles(portfolioId) {
  const cycles = ref([])      // 최신 시작 순
  const daily = ref([])       // 선택한 사이클의 날짜별 내역 (최신순)
  const loaded = ref(false)
  const error = ref('')

  const active = computed(() => cycles.value.find((c) => c.status === 'active') || null)
  const latest = computed(() => cycles.value[0] || null)

  async function load() {
    if (!portfolioId.value) return
    error.value = ''
    const { data, error: e } = await supabase.from('loc_cycles').select('*').eq('portfolio_id', portfolioId.value)
      .order('start_date', { ascending: false }).order('id', { ascending: false })
    if (e) { error.value = friendly(e, '자동매매 설정을 불러오지 못했어요.'); loaded.value = true; return }
    cycles.value = data
    const target = active.value || latest.value
    daily.value = target ? await loadDaily(target.id) : []
    loaded.value = true
  }

  async function loadDaily(cycleId) {
    const { data, error: e } = await supabase.from('loc_daily').select('*').eq('cycle_id', cycleId).order('trade_date', { ascending: false })
    if (e) { error.value = friendly(e, '날짜별 내역을 불러오지 못했어요.'); return [] }
    return data.map((d) => ({
      date: d.trade_date.replaceAll('-', ''), close: d.close === null ? null : Number(d.close),
      buyQty: d.buy_qty, buyAmount: Number(d.buy_amount), sellQty: d.sell_qty, sellAmount: Number(d.sell_amount),
      cumQty: d.cum_qty, cumSpent: Number(d.cum_spent), updatedAt: d.updated_at,
    }))
  }

  /** 진행 중 사이클 설정 저장 (없으면 새로 만듦) → 사이클 */
  async function save(form) {
    const row = toRow(form, portfolioId.value)
    const q = active.value
      ? supabase.from('loc_cycles').update(row).eq('id', active.value.id).select().single()
      : supabase.from('loc_cycles').insert(row).select().single()
    const { data, error: e } = await q
    if (e) throw new Error(friendly(e, '설정을 저장하지 못했어요.'))
    cycles.value = [data, ...cycles.value.filter((c) => c.id !== data.id)]
    return data
  }

  /** 새 사이클 시작 (이전 사이클은 종료 상태여야 함) */
  async function startNew(form) {
    const { data, error: e } = await supabase.from('loc_cycles').insert(toRow(form, portfolioId.value)).select().single()
    if (e) throw new Error(friendly(e, '새 사이클을 시작하지 못했어요.'))
    cycles.value = [data, ...cycles.value]
    daily.value = []
    return data
  }

  return { cycles, daily, loaded, error, active, latest, load, loadDaily, save, startNew }
}
