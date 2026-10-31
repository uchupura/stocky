<script setup>
import { ref, computed, toRef, watch } from 'vue'
import DividendSheet from './DividendSheet.vue'
import { useDividends } from '../composables/useDividends'
import { fmt, usdText, fxText } from '../utils/format'

// 배당 탭: 누적 배당 · 올해 · 연도별 · 계좌 필터 · 월별 내역
const props = defineProps({
  portfolioId: { type: Number, default: null },
  holdings: { type: Array, default: () => [] }, // 종목 고를 때 보유 종목을 먼저 보여줌
})
const emit = defineEmits(['toast'])

const { dividends, accounts, loading, loaded, error, totals, load, addAccount, saveDividend, removeDividend } =
  useDividends(toRef(props, 'portfolioId'))
watch(() => props.portfolioId, (id) => id && load(), { immediate: true })

// ===== 계좌 필터 =====
const filter = ref(null)
const accountName = computed(() => Object.fromEntries(accounts.value.map((a) => [a.id, a.name])))
const shown = computed(() => (filter.value ? dividends.value.filter((d) => d.account_id === filter.value) : dividends.value))
watch(accounts, (list) => { if (filter.value && !list.some((a) => a.id === filter.value)) filter.value = null })

// ===== 월별 묶음 =====
const monthGroups = computed(() => {
  const groups = []
  for (const d of shown.value) {
    const key = d.pay_date.slice(0, 7)
    let g = groups.at(-1)
    if (!g || g.key !== key) {
      g = { key, label: `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월`, krw: 0, items: [] }
      groups.push(g)
    }
    g.items.push(d)
    g.krw += d.amount_krw
  }
  return groups
})
const weekday = (ymd) =>
  new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${ymd}T12:00:00+09:00`))
const dayLabel = (ymd) => `${Number(ymd.slice(5, 7))}.${ymd.slice(8, 10)}`
const localAmount = (d) => (d.currency === 'USD' ? usdText(d.amount) : `${fmt(d.amount)}원`)

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
    await saveDividend(p)
    sheetOpen.value = false
    emit('toast', p.id ? '배당 내역을 수정했어요' : `${p.stock_name} 배당을 기록했어요`)
  } catch (e) {
    sheetError.value = e.message
  } finally {
    saving.value = false
  }
}
async function onDelete(d) {
  saving.value = true
  try {
    await removeDividend(d.id)
    sheetOpen.value = false
    emit('toast', '배당 내역을 삭제했어요')
  } catch (e) {
    sheetError.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <template v-if="loading && !loaded">
    <section class="card" aria-busy="true"><span class="skeleton" style="width: 30%; height: 16px" /><span class="skeleton" style="width: 55%; height: 34px" /></section>
    <section class="card"><span v-for="n in 4" :key="n" class="skeleton" style="height: 44px" /></section>
  </template>

  <section v-else-if="error" class="card state" role="alert">
    <strong>배당 내역을 불러오지 못했어요</strong>
    {{ error }}
    <div><button class="retry" @click="load">다시 시도</button></div>
  </section>

  <template v-else>
    <!-- 누적 배당 -->
    <section class="card summary deposit-summary">
      <div class="sum-main">
        <p class="label">누적 배당 <span class="label-sub">세후 · 원화 환산</span></p>
        <p class="total">{{ fmt(totals.all) }}원</p>
        <p class="total-pl flat">
          {{ totals.thisYearLabel }}년 {{ fmt(totals.thisYear) }}원<template v-if="totals.usd"> · 달러 배당 {{ usdText(totals.usd) }}</template>
        </p>
      </div>
      <div v-if="totals.years.length" class="sum-side">
        <dl class="rows">
          <div v-for="y in totals.years" :key="y" class="row"><dt>{{ y }}년</dt><dd>{{ fmt(totals.byYear[y]) }}원</dd></div>
        </dl>
      </div>
    </section>

    <!-- 내역 -->
    <section class="card list-card">
      <div class="list-head">
        <div class="list-title"><h2>배당 내역<span>{{ shown.length }}</span></h2></div>
        <div class="list-actions"><button class="chip-btn primary" @click="openAdd">+ 추가</button></div>
      </div>

      <div v-if="accounts.length > 1" class="filter-chips" role="radiogroup" aria-label="계좌 필터">
        <button type="button" role="radio" :aria-checked="filter === null" :class="{ on: filter === null }" @click="filter = null">전체</button>
        <button v-for="a in accounts" :key="a.id" type="button" role="radio" :aria-checked="filter === a.id" :class="{ on: filter === a.id }" @click="filter = a.id">{{ a.name }}</button>
      </div>

      <div v-if="!dividends.length" class="state">
        <strong>아직 배당 내역이 없어요</strong>
        받은 배당금을 기록하면 월별·연도별로 모아 드려요
        <div><button class="retry" @click="openAdd">+ 배당 추가하기</button></div>
      </div>
      <p v-else-if="!shown.length" class="state">이 계좌의 배당 내역이 없어요</p>

      <div v-for="g in monthGroups" :key="g.key" class="month-group">
        <div class="month-head">
          <span>{{ g.label }}</span>
          <span class="month-sum">합계 {{ fmt(g.krw) }}원</span>
        </div>
        <ul class="dep-list">
          <li v-for="d in g.items" :key="d.id">
            <button class="dep-row" :aria-label="`${d.pay_date} ${d.stock_name} 배당 ${localAmount(d)} 수정`" @click="openEdit(d)">
              <span class="dep-date">{{ dayLabel(d.pay_date) }}<small>{{ weekday(d.pay_date) }}</small></span>
              <span class="dep-main">
                <span class="dep-account">
                  {{ d.stock_name }}
                  <span v-if="d.currency === 'USD'" class="badge">USD</span>
                </span>
                <span class="dep-memo">{{ accountName[d.account_id] || '알 수 없는 계좌' }}{{ d.memo ? ` · ${d.memo}` : '' }}</span>
              </span>
              <span class="dep-amount">
                <b>{{ localAmount(d) }}</b>
                <span v-if="d.currency === 'USD'" class="dep-krw" :title="`환율 ${fxText(d.fx_rate)}원 (${d.fx_date || d.pay_date})`">≈ {{ fmt(d.amount_krw) }}원</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </section>
  </template>

  <DividendSheet
    :open="sheetOpen"
    :dividend="editing"
    :holdings="holdings"
    :accounts="accounts"
    :default-account-id="filter"
    :add-account="addAccount"
    :saving="saving"
    :server-error="sheetError"
    @close="sheetOpen = false"
    @submit="onSubmit"
    @delete="onDelete"
  />
</template>
