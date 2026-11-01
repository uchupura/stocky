<script setup>
import { computed, watch } from 'vue'
import { useDeposits } from '../composables/useDeposits'
import { useDividends } from '../composables/useDividends'
import DividendChart from './DividendChart.vue'
import { fmt, signed, tone, rateText, ratePct } from '../utils/format'

// 홈: 총 자산 · 누적 원금 · 누적 원금 대비 수익률
//   총 자산   = 주식 평가금액 + 원화 예수금 + 달러 예수금(원화 환산)  ← portfolio_summary.total_asset
//   누적 원금 = 총 입금 − 총 출금                                   ← 입출금 내역
//   (배당금은 예수금으로 들어가 총 자산에 이미 포함 — 따로 더하지 않음)
const props = defineProps({
  summary: { type: Object, required: true },
})
const emit = defineEmits(['navigate'])

const pid = computed(() => props.summary?.portfolio_id ?? null)
const { deposits, loaded, error, totals, load } = useDeposits(pid)
// 배당 그래프용
const div = useDividends(pid)
watch(pid, (id) => { if (id) { load(); div.load() } }, { immediate: true })

const n = (v) => Number(v || 0)
// 008(예수금) 적용 전이면 total_asset 이 없음 → 주식 평가금액
const totalAsset = computed(() => n(props.summary.total_asset ?? props.summary.total_value))
const cash = computed(() => n(props.summary.cash_krw) + n(props.summary.cash_usd_krw))
const principal = computed(() => totals.value.principal)
const profit = computed(() => totalAsset.value - principal.value)
// 원금이 있어야(0보다 커야) 수익률 계산 가능
const canRate = computed(() => loaded.value && principal.value > 0)
</script>

<template>
  <section class="card summary home-summary">
    <div class="sum-main">
      <p class="label">총 자산</p>
      <p class="total">{{ fmt(totalAsset) }}원</p>
      <p v-if="canRate" class="total-pl" :class="tone(profit)">
        <span class="pl-prefix">누적 원금 대비</span>
        {{ signed(profit) }}원 {{ rateText(ratePct(profit, principal)) }}
      </p>
      <p v-else-if="!loaded && !error" class="total-pl flat">원금 계산 중…</p>
      <p v-else-if="error" class="total-pl flat">{{ error }}</p>
      <p v-else-if="!deposits.length" class="total-pl flat">입출금을 입력하면 원금 대비 수익률을 보여드려요</p>
      <p v-else class="total-pl flat">누적 원금이 0원 이하라 수익률을 계산할 수 없어요</p>
    </div>
    <div class="sum-side">
      <dl class="rows">
        <div class="row">
          <dt>누적 원금 <span class="label-sub">입금 − 출금</span></dt>
          <dd>{{ loaded ? `${fmt(principal)}원` : '–' }}</dd>
        </div>
        <div class="row"><dt>주식 평가금액</dt><dd>{{ fmt(summary.total_value) }}원</dd></div>
        <div class="row"><dt>예수금</dt><dd>{{ fmt(cash) }}원</dd></div>
      </dl>
      <button v-if="loaded && !deposits.length" class="link-btn cash-edit home-go" @click="emit('navigate', 'deposits')">
        입출금 입력하러 가기 →
      </button>
    </div>
  </section>

  <!-- 배당 그래프 -->
  <section v-if="!div.loaded.value && !div.error.value" class="card" aria-busy="true"><span class="skeleton" style="height: 200px" /></section>
  <section v-else-if="div.error.value" class="card state" role="alert">
    <strong>배당 그래프를 불러오지 못했어요</strong>
    {{ div.error.value }}
  </section>
  <DividendChart v-else :dividends="div.dividends.value" :accounts="div.accounts.value" @navigate="emit('navigate', $event)" />
</template>
