<script setup>
import { computed } from 'vue'
import { fmt, signed, tone, ratePct, usdText } from '../utils/format'

const props = defineProps({
  summary: { type: Object, required: true },
  title: { type: String, default: '' }, // 계좌를 골랐을 때 계좌 이름
  holdings: { type: Array, default: () => [] }, // 요약 대상 보유 주식 (일일 수익 계산용)
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

// 오늘(일일) 수익: Σ 수량 × (현재가 − 전일 종가) × 환율 ÷ 어제 기준 평가금액
//   미국 주식은 가장 최근 미국장 기준, 환율 변동은 넣지 않음(오늘 환율로 계산)
//   전일 종가가 없는 종목은 빼고 계산
const today = computed(() => {
  let change = 0
  let base = 0
  let missing = 0
  for (const h of props.holdings) {
    const prev = Number(h.prev_close)
    const cur = Number(h.current_price)
    if (!(prev > 0) || !(cur > 0)) { missing++; continue }
    const fx = Number(h.fx_rate) || 1
    change += Number(h.quantity) * (cur - prev) * fx
    base += Number(h.quantity) * prev * fx
  }
  return base > 0 ? { change: Math.round(change), rate: (change / base) * 100, missing } : null
})

// 수익률 배지: ▲ 1.45% / ▼ 0.44% / 0.00% (색 + 화살표로 구분)
const pill = (r) => {
  const v = Math.abs(r).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v === '0.00' ? '0.00%' : `${r > 0 ? '▲' : '▼'} ${v}%`
}
const totalRate = computed(() => ratePct(props.summary.total_profit, props.summary.total_cost))
</script>

<template>
  <section class="card summary">
    <div class="sum-main">
      <p class="label">{{ hasCash ? '총 자산' : '총 평가금액' }} <span v-if="title" class="label-sub">{{ title }}</span></p>
      <p class="total">{{ fmt(totalAsset) }}원</p>
      <!-- 수익은 주식만 기준 (예수금은 손익 없음) -->
      <div class="pl-tiles">
        <div class="pl-tile">
          <span class="pl-name">총 수익</span>
          <b class="pl-amt" :class="tone(summary.total_profit)">{{ signed(summary.total_profit) }}원</b>
          <span class="pl-pill" :class="tone(summary.total_profit)">{{ pill(totalRate) }}</span>
        </div>
        <div v-if="today" class="pl-tile">
          <span class="pl-name">일간 수익<small v-if="today.missing"> · {{ today.missing }}종목 제외</small></span>
          <b class="pl-amt" :class="tone(today.change)">{{ signed(today.change) }}원</b>
          <span class="pl-pill" :class="tone(today.change)">{{ pill(today.rate) }}</span>
        </div>
      </div>
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
