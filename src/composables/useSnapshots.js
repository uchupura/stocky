import { ref } from 'vue'
import { supabase } from '../lib/supabase'

function friendly(e, fallback) {
  if (e?.code === '23505') return '그 날짜에는 이미 기록이 있어요. 목록에서 눌러 수정해 주세요.'
  if (e?.code === '42P10') return '계좌별 기록을 쓰려면 013_holding_accounts.sql 을 먼저 실행해 주세요.'
  if (e?.code === '23514') return '입력값을 다시 확인해 주세요.'
  if (e?.code === '42501') return '자동 기록은 직접 고칠 수 없어요.'
  if (e?.code === '42P01' || /asset_snapshots/.test(e?.message || '')) {
    return '수익률 기능을 쓰려면 012_asset_snapshots.sql 을 먼저 실행해 주세요.'
  }
  return e?.message || fallback
}

/**
 * 총 자산 기록 (012) — 월말 자동 기록(auto) + 직접 입력(manual)
 *   account_id (013) — 비어 있으면 포트폴리오 전체, 있으면 그 계좌
 * @param {import('vue').Ref<number|null>} portfolioId
 */
export function useSnapshots(portfolioId) {
  const snapshots = ref([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')

  async function load() {
    if (!portfolioId.value) return
    loading.value = true
    error.value = ''
    try {
      const { data, error: e } = await supabase
        .from('asset_snapshots')
        .select('*')
        .eq('portfolio_id', portfolioId.value)
        .order('snap_date')
      if (e) throw e
      snapshots.value = data.map((s) => ({ ...s, account_id: s.account_id ?? null, total_asset: Number(s.total_asset) }))
      loaded.value = true
    } catch (e) {
      console.error(e)
      error.value = friendly(e, '총 자산 기록을 불러오지 못했어요.')
    } finally {
      loading.value = false
    }
  }

  /**
   * 직접 입력 저장. 새 기록은 같은 날짜의 자동 기록이 있으면 덮어씀(→ manual)
   * @param {{ id?: number, snap_date: string, total_asset: number, memo?: string, account_id?: number|null }} p
   */
  async function saveSnapshot(p) {
    const row = {
      portfolio_id: portfolioId.value,
      account_id: p.account_id ?? null,
      snap_date: p.snap_date,
      total_asset: p.total_asset,
      source: 'manual',
      memo: p.memo?.trim() || null,
    }
    const { error: e } = p.id
      ? await supabase.from('asset_snapshots').update(row).eq('id', p.id)
      : await supabase.from('asset_snapshots').upsert(row, { onConflict: 'portfolio_id,snap_date,account_id' })
    if (e) throw new Error(friendly(e, '저장하지 못했어요.'))
    await load()
  }

  async function removeSnapshot(id) {
    const { error: e } = await supabase.from('asset_snapshots').delete().eq('id', id)
    if (e) throw new Error(friendly(e, '삭제하지 못했어요.'))
    await load()
  }

  return { snapshots, loading, loaded, error, load, saveSnapshot, removeSnapshot }
}
