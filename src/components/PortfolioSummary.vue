<script setup>
import { computed } from 'vue'
import { fmt, signed, tone, rateText, ratePct } from '../utils/format'

const props = defineProps({
  summary: { type: Object, required: true },
})

// 국내 / 해외 비중 (%)
const pctKr = computed(() => {
  const total = Number(props.summary.total_value)
  return total ? (Number(props.summary.domestic_value) / total) * 100 : 0
})
</script>

<template>
  <section class="card summary">
    <div class="sum-main">
      <p class="label">총 평가금액</p>
      <p class="total">{{ fmt(summary.total_value) }}원</p>
      <p class="total-pl" :class="tone(summary.total_profit)">
        {{ signed(summary.total_profit) }}원 {{ rateText(ratePct(summary.total_profit, summary.total_cost)) }}
      </p>
    </div>
    <div class="sum-side">
      <dl class="rows">
        <div class="row"><dt>투자 원금</dt><dd>{{ fmt(summary.total_cost) }}원</dd></div>
        <div class="row"><dt>국내 주식</dt><dd>{{ fmt(summary.domestic_value) }}원</dd></div>
        <div class="row"><dt>해외 주식</dt><dd>{{ fmt(summary.overseas_value) }}원</dd></div>
      </dl>
      <div class="alloc">
        <div class="alloc-bar">
          <span class="kr" :style="{ width: pctKr + '%' }" />
          <span class="us" :style="{ width: 100 - pctKr + '%' }" />
        </div>
        <div class="alloc-legend">
          <span><i class="dot kr" />국내<b>{{ pctKr.toFixed(1) }}%</b></span>
          <span><i class="dot us" />해외<b>{{ (100 - pctKr).toFixed(1) }}%</b></span>
        </div>
      </div>
    </div>
  </section>
</template>
