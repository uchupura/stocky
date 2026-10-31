<script setup>
import { ref, computed, toRef, watch } from 'vue'
import DepositSheet from './DepositSheet.vue'
import AccountsSheet from './AccountsSheet.vue'
import { useDeposits } from '../composables/useDeposits'
import { fmt } from '../utils/format'

// 입출금 탭: 누적 원금 · 계좌별 원금 · 월별 내역
const props = defineProps({
  portfolioId: { type: Number, default: null },
})
const emit = defineEmits(['toast'])

const {
  accounts, deposits, loading, loaded, error, totals,
  load, addAccount, renameAccount, deleteAccount, saveDeposit, removeDeposit,
} = useDeposits(toRef(props, 'portfolioId'))

watch(() => props.portfolioId, (id) => id && load(), { immediate: true })

// ===== 계좌 필터 =====
const filter = ref(null) // null = 전체
const accountName = computed(() => Object.fromEntries(accounts.value.map((a) => [a.id, a.name])))
const shown = computed(() => (filter.value ? deposits.value.filter((d) => d.account_id === filter.value) : deposits.value))
watch(accounts, (list) => { if (filter.value && !list.some((a) => a.id === filter.value)) filter.value = null })

// ===== 월별 묶음 =====
const monthGroups = computed(() => {
  const groups = []
  for (const d of shown.value) {
    const key = d.txn_date.slice(0, 7)
    let g = groups.at(-1)
    if (!g || g.key !== key) {
      g = { key, label: `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월`, in: 0, out: 0, items: [] }
      groups.push(g)
    }
    g.items.push(d)
    if (d.kind === 'deposit') g.in += d.amount
    else g.out += d.amount
  }
  return groups
})
const weekday = (ymd) =>
  new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${ymd}T12:00:00+09:00`))
const dayLabel = (ymd) => `${Number(ymd.slice(5, 7))}.${ymd.slice(8, 10)}`
const signedWon = (d) => `${d.kind === 'deposit' ? '+' : '−'}${fmt(d.amount)}원`

// ===== 추가 · 수정 =====
const sheetOpen = ref(false)
const editing = ref(null)
const saving = ref(false)
const sheetError = ref('')
function openAdd() { editing.value = null; sheetError.value = ''; sheetOpen.value = true }
function openEdit(d) { editing.value = d; sheetError.value = ''; sheetOpen.value = true }
async function onSubmit(p) {
  saving.value = true
  sheetError.value = ''
  try {
    await saveDeposit(p)
    sheetOpen.value = false
    emit('toast', p.id ? '입출금 내역을 수정했어요' : `${p.kind === 'deposit' ? '입금' : '출금'} ${fmt(p.amount)}원을 기록했어요`)
  } catch (e) {
    sheetError.value = e.message
  } finally {
    saving.value = false
  }
}
async function onDelete(d) {
  saving.value = true
  try {
    await removeDeposit(d.id)
    sheetOpen.value = false
    emit('toast', '입출금 내역을 삭제했어요')
  } catch (e) {
    sheetError.value = e.message
  } finally {
    saving.value = false
  }
}

// ===== 계좌 관리 =====
const accountsOpen = ref(false)
const accountsBusy = ref(false)
const accountsError = ref('')
async function runAccounts(fn, msg) {
  accountsBusy.value = true
  accountsError.value = ''
  try { await fn(); emit('toast', msg) } catch (e) { accountsError.value = e.message } finally { accountsBusy.value = false }
}
const onRename = ({ id, name }) => runAccounts(() => renameAccount(id, name), '계좌 이름을 바꿨어요')
const onDeleteAccount = (a) => runAccounts(() => deleteAccount(a.id), `${a.name} 계좌를 삭제했어요`)
</script>

<template>
  <!-- 불러오는 중 -->
  <template v-if="loading && !loaded">
    <section class="card" aria-busy="true"><span class="skeleton" style="width: 30%; height: 16px" /><span class="skeleton" style="width: 55%; height: 34px" /></section>
    <section class="card"><span v-for="n in 4" :key="n" class="skeleton" style="height: 44px" /></section>
  </template>

  <section v-else-if="error" class="card state" role="alert">
    <strong>입출금 내역을 불러오지 못했어요</strong>
    {{ error }}
    <div><button class="retry" @click="load">다시 시도</button></div>
  </section>

  <template v-else>
    <!-- 누적 원금 -->
    <section class="card summary deposit-summary">
      <div class="sum-main">
        <p class="label">누적 원금 <span class="label-sub">입금 기준</span></p>
        <p class="total">{{ fmt(totals.principal) }}원</p>
        <p class="total-pl flat">총 입금 {{ fmt(totals.in) }}원 · 총 출금 {{ fmt(totals.out) }}원</p>
      </div>
      <div v-if="accounts.length" class="sum-side">
        <dl class="rows">
          <div v-for="a in accounts" :key="a.id" class="row">
            <dt>{{ a.name }}</dt><dd>{{ fmt(totals.byAccount[a.id] || 0) }}원</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- 내역 -->
    <section class="card list-card">
      <div class="list-head">
        <div class="list-title"><h2>입출금 내역<span>{{ shown.length }}</span></h2></div>
        <div class="list-actions">
          <button v-if="accounts.length" class="chip-btn" @click="accountsError = ''; accountsOpen = true">계좌 관리</button>
          <button class="chip-btn primary" @click="openAdd">+ 추가</button>
        </div>
      </div>

      <div v-if="accounts.length > 1" class="filter-chips" role="radiogroup" aria-label="계좌 필터">
        <button type="button" role="radio" :aria-checked="filter === null" :class="{ on: filter === null }" @click="filter = null">전체</button>
        <button v-for="a in accounts" :key="a.id" type="button" role="radio" :aria-checked="filter === a.id" :class="{ on: filter === a.id }" @click="filter = a.id">{{ a.name }}</button>
      </div>

      <div v-if="!deposits.length" class="state">
        <strong>아직 입출금 내역이 없어요</strong>
        증권 계좌에 넣고 뺀 돈을 기록하면 누적 원금을 계산해 드려요
        <div><button class="retry" @click="openAdd">+ 입출금 추가하기</button></div>
      </div>
      <p v-else-if="!shown.length" class="state">이 계좌의 내역이 없어요</p>

      <div v-for="g in monthGroups" :key="g.key" class="month-group">
        <div class="month-head">
          <span>{{ g.label }}</span>
          <span class="month-sum">입금 {{ fmt(g.in) }} · 출금 {{ fmt(g.out) }}</span>
        </div>
        <ul class="dep-list">
          <li v-for="d in g.items" :key="d.id">
            <button class="dep-row" :aria-label="`${d.txn_date} ${accountName[d.account_id]} ${d.kind === 'deposit' ? '입금' : '출금'} ${fmt(d.amount)}원 수정`" @click="openEdit(d)">
              <span class="dep-date">{{ dayLabel(d.txn_date) }}<small>{{ weekday(d.txn_date) }}</small></span>
              <span class="dep-main">
                <span class="dep-account">{{ accountName[d.account_id] || '알 수 없는 계좌' }}</span>
                <span v-if="d.memo" class="dep-memo">{{ d.memo }}</span>
              </span>
              <span class="dep-amount">
                <b>{{ signedWon(d) }}</b>
                <span class="dep-kind" :class="d.kind">{{ d.kind === 'deposit' ? '입금' : '출금' }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </section>
  </template>

  <DepositSheet
    :open="sheetOpen"
    :deposit="editing"
    :accounts="accounts"
    :default-account-id="filter"
    :add-account="addAccount"
    :saving="saving"
    :server-error="sheetError"
    @close="sheetOpen = false"
    @submit="onSubmit"
    @delete="onDelete"
  />
  <AccountsSheet
    :open="accountsOpen"
    :accounts="accounts"
    :principal-by-account="totals.byAccount"
    :busy="accountsBusy"
    :server-error="accountsError"
    @close="accountsOpen = false"
    @rename="onRename"
    @delete="onDeleteAccount"
  />
</template>
