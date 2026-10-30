<script setup>
import { computed } from 'vue'
import { fmt, signed, tone, rateText, ratePct, usdText } from '../utils/format'

const props = defineProps({
  summary: { type: Object, required: true },
})
const emit = defineEmits(['edit-cash'])

const n = (v) => Number(v || 0)
// 008(예수금) 적용 전에는 total_asset 칸이 없음 → 주식 금액만으로 표시
const hasCash = computed(() => props.summary.total_asset !== undefined)
const totalAsset = computed(() => n(hasCash.value ? props.summary.total_asset : props.summary.total_value))
const cashTotal = computed(() => n(props.summary.cash_krw) + n(props.summary.cash_usd_krw))

// 비중 막대 (%): 국내 주식 · 해외 주식 · 예수금
const share = (v) => (totalAsset.value ? (n(v) / totalAsset.value) * 100 : 0)
const pctKr = computed(() => share(props.summary.domestic_value))
const pctUs = computed(() => share(props.summary.overseas_value))
const pctCash = computed(() => (hasCash.value ? share(cashTotal.value) : 0))
</script>

<template>
  <section class="card summary">
    <div class="sum-main">
      <p class="label">{{ hasCash ? '총 자산' : '총 평가금액' }}</p>
      <p class="total">{{ fmt(totalAsset) }}원</p>
      <!-- 수익은 주식만 기준 (예수금은 손익 없음) -->
      <p class="total-pl" :class="tone(summary.total_profit)">
        <span v-if="hasCash" class="pl-prefix">주식</span>
        {{ signed(summary.total_profit) }}원 {{ rateText(ratePct(summary.total_profit, summary.total_cost)) }}
      </p>
    </div>
    <div class="sum-side">
      <dl class="rows">
        <div v-if="hasCash" class="row"><dt>주식 평가금액</dt><dd>{{ fmt(summary.total_value) }}원</dd></div>
        <div class="row"><dt>투자 원금</dt><dd>{{ fmt(summary.total_cost) }}원</dd></div>
        <div class="row"><dt>국내 주식</dt><dd>{{ fmt(summary.domestic_value) }}원</dd></div>
        <div class="row"><dt>해외 주식</dt><dd>{{ fmt(summary.overseas_value) }}원</dd></div>
        <template v-if="hasCash">
          <div class="row"><dt>원화 예수금</dt><dd>{{ fmt(summary.cash_krw) }}원</dd></div>
          <div class="row">
            <dt>달러 예수금</dt>
            <dd>{{ usdText(summary.cash_usd) }} <span class="dd-sub">{{ fmt(summary.cash_usd_krw) }}원</span></dd>
          </div>
        </template>
      </dl>
      <div class="alloc">
        <div class="alloc-bar">
          <span class="kr" :style="{ width: pctKr + '%' }" />
          <span class="us" :style="{ width: pctUs + '%' }" />
          <span v-if="hasCash" class="cash" :style="{ width: pctCash + '%' }" />
        </div>
        <div class="alloc-legend">
          <span><i class="dot kr" />국내<b>{{ pctKr.toFixed(1) }}%</b></span>
          <span><i class="dot us" />해외<b>{{ pctUs.toFixed(1) }}%</b></span>
          <span v-if="hasCash"><i class="dot cash" />예수금<b>{{ pctCash.toFixed(1) }}%</b></span>
          <button v-if="hasCash" class="link-btn cash-edit" @click="emit('edit-cash')">예수금 수정</button>
        </div>
      </div>
    </div>
  </section>
</template>
