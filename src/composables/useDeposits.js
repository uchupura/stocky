import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'

// Postgres 에러 → 화면 메시지
function friendly(e, fallback) {
  if (e?.code === '23505') return '같은 이름의 계좌가 이미 있어요.'
  if (e?.code === '23503') return '입출금·배당 내역이나 보유 주식·예수금이 있는 계좌는 삭제할 수 없어요. 먼저 옮기거나 지워 주세요.'
  if (e?.code === '23514') return '입력값을 다시 확인해 주세요.'
  if (e?.code === '42P01' || /deposits|accounts/.test(e?.message || '')) {
    return '입출금 기능을 쓰려면 010_deposits.sql 을 먼저 실행해 주세요.'
  }
  return e?.message || fallback
}

/** 한국 날짜 YYYY-MM-DD (입력 기본값: 오늘) */
export function todayKST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/**
 * 입출금 내역 · 계좌
 *   누적 원금 = 총 입금 − 총 출금 (원화)
 * @param {import('vue').Ref<number|null>} portfolioId
 */
export function useDeposits(portfolioId) {
  const accounts = ref([])
  const deposits = ref([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')

  async function load() {
    if (!portfolioId.value) return
    loading.value = true
    error.value = ''
    try {
      const [a, d] = await Promise.all([
        supabase.from('accounts').select('id, name, sort_order').eq('portfolio_id', portfolioId.value)
          .order('sort_order').order('id'),
        supabase.from('deposits').select('id, account_id, kind, amount, txn_date, memo')
          .eq('portfolio_id', portfolioId.value).order('txn_date', { ascending: false }).order('id', { ascending: false }),
      ])
      for (const r of [a, d]) if (r.error) throw r.error
      accounts.value = a.data
      deposits.value = d.data.map((x) => ({ ...x, amount: Number(x.amount) }))
      loaded.value = true
    } catch (e) {
      console.error(e)
      error.value = friendly(e, '입출금 내역을 불러오지 못했어요.')
    } finally {
      loading.value = false
    }
  }

  // ===== 집계 =====
  const signedAmount = (d) => (d.kind === 'deposit' ? d.amount : -d.amount)
  const totals = computed(() => {
    let inSum = 0
    let outSum = 0
    const byAccount = {}
    for (const d of deposits.value) {
      if (d.kind === 'deposit') inSum += d.amount
      else outSum += d.amount
      byAccount[d.account_id] = (byAccount[d.account_id] || 0) + signedAmount(d)
    }
    return { in: inSum, out: outSum, principal: inSum - outSum, byAccount }
  })

  // ===== 계좌 =====
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
  async function renameAccount(id, name) {
    const { error: e } = await supabase.from('accounts').update({ name: name.trim() }).eq('id', id)
    if (e) throw new Error(friendly(e, '계좌 이름을 바꾸지 못했어요.'))
    await load()
  }
  async function deleteAccount(id) {
    const { error: e } = await supabase.from('accounts').delete().eq('id', id)
    if (e) throw new Error(friendly(e, '계좌를 삭제하지 못했어요.'))
    await load()
  }

  // ===== 입출금 =====
  /** @param {{ id?: number, kind: 'deposit'|'withdraw', amount: number, account_id: number, txn_date: string, memo?: string }} p */
  async function saveDeposit(p) {
    const row = {
      portfolio_id: portfolioId.value,
      account_id: p.account_id,
      kind: p.kind,
      amount: p.amount,
      txn_date: p.txn_date,
      memo: p.memo?.trim() || null,
    }
    const { error: e } = p.id
      ? await supabase.from('deposits').update(row).eq('id', p.id)
      : await supabase.from('deposits').insert(row)
    if (e) throw new Error(friendly(e, '저장하지 못했어요.'))
    await load()
  }
  async function removeDeposit(id) {
    const { error: e } = await supabase.from('deposits').delete().eq('id', id)
    if (e) throw new Error(friendly(e, '삭제하지 못했어요.'))
    await load()
  }

  return {
    accounts, deposits, loading, loaded, error, totals,
    load, addAccount, renameAccount, deleteAccount, saveDeposit, removeDeposit,
  }
}
