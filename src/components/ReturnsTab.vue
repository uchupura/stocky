<script setup>
import { ref, computed, watch } from 'vue'
import ReturnsChart from './ReturnsChart.vue'
import SnapshotSheet from './SnapshotSheet.vue'
import { useSnapshots } from '../composables/useSnapshots'
import { useDeposits, todayKST } from '../composables/useDeposits'
import { computeReturns } from '../utils/returns'
import { fmt, signed, tone, pctText } from '../utils/format'

// 수익률 탭: 누적 수익률(누적 입금액 대비) · 월별 표(계좌 총액·월 입금액·월 수익·월 수익률·누적 입금액·누적 수익·누적 수익률) · 월말 총 자산 입력
//   기록 = 월말 자동 기록(012, Vercel Cron) + 직접 입력한 총 자산
//   이번 달은 지금 총 자산을 임시 끝 값으로 사용 (진행 중)
//   계좌별(013): 그 계좌의 월말 기록 + 그 계좌 입출금 + 그 계좌 지금 총 자산(주식 + 예수금)
const props = defineProps({
  summary: { type: Object, required: true },
  holdings: { type: Array, default: () => [] },
  cash: { type: Array, default: () => [] },
  accounts: { type: Array, default: () => [] },
  usdRate: { type: Number, default: null },
})
const emit = defineEmits(['toast', 'navigate'])

const pid = computed(() => props.summary?.portfolio_id ?? null)
const snap = useSnapshots(pid)
const dep = useDeposits(pid)
const load = () => Promise.all([snap.load(), dep.load()])
watch(pid, (id) => id && load(), { immediate: true })

const loaded = computed(() => snap.loaded.value && dep.loaded.value)
const error = computed(() => snap.error.value || dep.error.value)

// ===== 계좌 선택: null = 전체 =====
const acct = ref(null)
watch(() => props.accounts, (list) => { if (acct.value && !list.some((a) => a.id === acct.value)) acct.value = null })
const acctName = computed(() => props.accounts.find((a) => a.id === acct.value)?.name || '')

// 지금 총 자산: 전체 = DB 합계, 계좌 = 그 계좌 주식 평가금액 + 예수금(달러는 현재 환율)
function totalOf(accountId) {
  if (accountId == null) return Number(props.summary.total_asset ?? props.summary.total_value ?? 0)
  const stocks = props.holdings.filter((h) => h.account_id === accountId).reduce((t, h) => t + Number(h.value_krw), 0)
  const cash = props.cash.filter((c) => c.account_id === accountId)
    .reduce((t, c) => t + (c.currency === 'USD' ? Math.round(c.amount * (props.usdRate || 0)) : c.amount), 0)
  return stocks + cash
}
const totalAsset = computed(() => totalOf(acct.value))
const mySnaps = computed(() => snap.snapshots.value.filter((s) => (s.account_id ?? null) === acct.value))
const myDeps = computed(() => (acct.value == null ? dep.deposits.value : dep.deposits.value.filter((d) => d.account_id === acct.value)))
// 계좌를 골랐는데 미지정 주식·예수금이 남아 있으면 안내
const hasLoose = computed(() => props.holdings.some((h) => h.account_id == null) || props.cash.some((c) => c.account_id == null && c.amount > 0))
const result = computed(() =>
  computeReturns(mySnaps.value, myDeps.value, { date: todayKST(), total_asset: totalAsset.value }))

// 월별 목록 (최근 달이 위)
const monthRows = computed(() => [...result.value.months].reverse())
// 그 달의 마지막 "저장된" 기록 (지금 값 제외) → 눌러서 수정
const lastSnapOf = computed(() => {
  const m = {}
  for (const s of mySnaps.value) m[s.snap_date.slice(0, 7)] = s
  return m
})
const firstKey = computed(() => result.value.months[0]?.key)

// ===== 입력 · 수정 =====
const sheetOpen = ref(false)
const editing = ref(null)
const saving = ref(false)
const sheetError = ref('')
function openAdd() { editing.value = null; sheetError.value = ''; sheetOpen.value = true }
function openEdit(s) { editing.value = s; sheetError.value = ''; sheetOpen.value = true }
async function onSubmit(p) {
  saving.value = true
  sheetError.value = ''
  try {
    await snap.saveSnapshot(p)
    sheetOpen.value = false
    emit('toast', p.id ? '기록을 수정했어요' : p.snap_date === todayKST() ? '오늘 총 자산을 기록했어요' : `${Number(p.snap_date.slice(5, 7))}월 말 총 자산을 기록했어요`)
  } catch (e) {
    sheetError.value = e.message
  } finally {
    saving.value = false
  }
}
async function onDelete(s) {
  saving.value = true
  try {
    await snap.removeSnapshot(s.id)
    sheetOpen.value = false
    emit('toast', '기록을 삭제했어요')
  } catch (e) {
    sheetError.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <template v-if="!loaded && !error">
    <section class="card" aria-busy="true"><span class="skeleton" style="width: 30%; height: 16px" /><span class="skeleton" style="width: 55%; height: 34px" /></section>
    <section class="card"><span class="skeleton" style="height: 200px" /></section>
  </template>

  <section v-else-if="error" class="card state" role="alert">
    <strong>수익률을 불러오지 못했어요</strong>
    {{ error }}
    <div><button class="retry" @click="load">다시 시도</button></div>
  </section>

  <template v-else>
    <!-- 계좌 선택 -->
    <div v-if="accounts.length" class="acct-bar">
      <div class="filter-chips acct-chips" role="radiogroup" aria-label="수익률 계좌 선택">
        <button type="button" role="radio" :aria-checked="acct === null" :class="{ on: acct === null }" @click="acct = null">전체</button>
        <button v-for="a in accounts" :key="a.id" type="button" role="radio" :aria-checked="acct === a.id" :class="{ on: acct === a.id }" @click="acct = a.id">{{ a.name }}</button>
      </div>
      <p v-if="acct !== null && hasLoose" class="acct-notice">
        <span><b>계좌 미지정</b> 주식·예수금이 있어요. 내 투자 탭에서 계좌를 지정해야 계좌별 수익률이 정확해요.</span>
      </p>
    </div>

    <!-- 누적 수익률 (원금 대비) -->
    <section class="card summary home-summary">
      <div class="sum-main">
        <p class="label">누적 수익률 <span class="label-sub">{{ acctName ? `${acctName} · ` : '' }}누적 입금액 대비</span></p>
        <p class="total" :class="tone(result.cumRate)">{{ pctText(result.cumRate) }}</p>
        <p v-if="result.cumRate !== null" class="total-pl flat">
          누적 수익 <span :class="tone(result.cumProfit)">{{ signed(result.cumProfit) }}원</span>
        </p>
        <p v-else class="total-pl flat">입출금 탭에 입금 내역을 입력하면 계산해 드려요</p>
      </div>
      <div class="sum-side">
        <dl class="rows">
          <div class="row"><dt>계좌 총액</dt><dd>{{ fmt(totalAsset) }}원</dd></div>
          <div class="row"><dt>누적 입금액 <span class="label-sub">입금 − 출금</span></dt><dd>{{ fmt(result.cumNet ?? 0) }}원</dd></div>
          <div class="row"><dt>누적 수익</dt><dd :class="tone(result.cumProfit)">{{ result.cumProfit === null ? '–' : `${signed(result.cumProfit)}원` }}</dd></div>
        </dl>
      </div>
    </section>

    <!-- 월 수익을 계산할 기록이 부족할 때 -->
    <section v-if="!result.intervals.length" class="card state">
      <template v-if="mySnaps.length">
        <strong>오늘부터 기록이 시작됐어요</strong>
        내일부터 오늘 대비 수익을 보여드려요. 지난 달들의 월말 총 자산을 입력하면 그 달부터 바로 볼 수 있어요.
      </template>
      <template v-else>
        <strong>아직 월별 수익을 계산할 기록이 없어요</strong>
        매달 말일 총 자산이 자동으로 기록돼요(다음 날 아침 저장). 지난 달들의 월말 총 자산을 입력하면 그 달부터 바로 보여드려요.
      </template>
      <div><button class="retry" @click="openAdd">+ 월말 총 자산 입력</button></div>
      <p v-if="!dep.deposits.value.length" class="ret-tip">
        입출금 내역도 입력해야 입금한 돈이 수익으로 잡히지 않아요.
        <button class="link-btn" @click="emit('navigate', 'deposits')">입출금 입력하러 가기 →</button>
      </p>
    </section>

    <template v-else>
      <ReturnsChart :months="result.months" />

      <!-- 월별 수익률 -->
      <section class="card list-card">
        <div class="list-head">
          <div class="list-title"><h2>월별 수익률</h2></div>
          <div class="list-actions"><button class="chip-btn primary" @click="openAdd">+ 월말 자산 입력</button></div>
        </div>

        <!-- 데스크톱: 표 -->
        <div class="ret-table-wrap d-only">
          <table class="ret-table">
            <thead>
              <tr>
                <th scope="col">월</th><th scope="col">계좌 총액</th><th scope="col">월 입금액</th><th scope="col">월 수익</th>
                <th scope="col">월 수익률</th><th scope="col">누적 입금액</th><th scope="col">누적 수익</th><th scope="col">누적 수익률</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in monthRows" :key="m.key"
                :class="{ clickable: lastSnapOf[m.key] }"
                :tabindex="lastSnapOf[m.key] ? 0 : undefined"
                :aria-label="lastSnapOf[m.key] ? `${m.year}년 ${m.month}월 총 자산 기록 수정` : undefined"
                @click="lastSnapOf[m.key] && openEdit(lastSnapOf[m.key])"
                @keydown.enter="lastSnapOf[m.key] && openEdit(lastSnapOf[m.key])"
              >
                <th scope="row">
                  {{ m.year }}.{{ String(m.month).padStart(2, '0') }}
                  <span v-if="m.live" class="badge">진행 중</span>
                  <span v-else-if="lastSnapOf[m.key]?.source === 'manual'" class="badge etf">직접</span>
                </th>
                <td>{{ m.endValue === null ? '기록 없음' : `${fmt(m.endValue)}원` }}</td>
                <td>{{ m.net ? `${signed(m.net)}원` : '–' }}</td>
                <td :class="tone(m.profit)">{{ m.profit === null ? (m.key === firstKey ? '시작' : '–') : `${signed(m.profit)}원` }}</td>
                <td :class="tone(m.rate)">{{ pctText(m.rate) }}</td>
                <td>{{ m.cumNet === null ? '–' : `${fmt(m.cumNet)}원` }}</td>
                <td :class="tone(m.cumProfit)">{{ m.cumProfit === null ? '–' : `${signed(m.cumProfit)}원` }}</td>
                <td :class="tone(m.cumRate)">{{ pctText(m.cumRate) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 모바일: 카드 -->
        <ul class="dep-list m-only">
          <li v-for="m in monthRows" :key="m.key">
            <component
              :is="lastSnapOf[m.key] ? 'button' : 'div'"
              class="dep-row ret-row"
              :aria-label="lastSnapOf[m.key] ? `${m.year}년 ${m.month}월 총 자산 기록 수정` : undefined"
              @click="lastSnapOf[m.key] && openEdit(lastSnapOf[m.key])"
            >
              <span class="dep-date">{{ m.month }}월<small>{{ m.year }}</small></span>
              <span class="dep-main">
                <span class="dep-account">
                  {{ m.endValue !== null ? `${fmt(m.endValue)}원` : '기록 없음' }}
                  <span v-if="m.live" class="badge">진행 중</span>
                  <span v-else-if="lastSnapOf[m.key]?.source === 'manual'" class="badge etf">직접</span>
                </span>
                <span class="ret-sub">입금 {{ m.net ? `${signed(m.net)}원` : '–' }} · 누적 입금 {{ m.cumNet === null ? '–' : `${fmt(m.cumNet)}원` }}</span>
                <span class="ret-sub">누적 수익 <b :class="tone(m.cumProfit)">{{ m.cumProfit === null ? '–' : `${signed(m.cumProfit)}원` }} {{ m.cumRate === null ? '' : `(${pctText(m.cumRate)})` }}</b></span>
              </span>
              <span class="dep-amount">
                <b :class="tone(m.rate)">{{ m.rate === null ? (m.key === firstKey ? '시작' : '–') : pctText(m.rate) }}</b>
                <span v-if="m.profit !== null" class="dep-krw" :class="tone(m.profit)">{{ signed(m.profit) }}원</span>
              </span>
            </component>
          </li>
        </ul>
      </section>
    </template>
  </template>

  <SnapshotSheet
    :open="sheetOpen"
    :snapshot="editing"
    :current-total-of="totalOf"
    :accounts="accounts"
    :account-id="acct"
    :saving="saving"
    :server-error="sheetError"
    @close="sheetOpen = false"
    @submit="onSubmit"
    @delete="onDelete"
  />
</template>
