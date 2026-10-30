<script setup>
import { computed } from 'vue'
import Sparkline from './Sparkline.vue'
import { fmt, signed, tone, rateText, ratePct, unitPrice, qtyText } from '../utils/format'

const props = defineProps({
  holding: { type: Object, required: true },
  editing: { type: Boolean, default: false }, // 편집 모드: 손잡이 대신 삭제 버튼, 줄을 누르면 수정
  view: { type: String, default: 'value' },   // 'value' 평가 / 'quote' 시세
  chart: { type: Object, default: null },     // 시세 보기: 하루 그래프 { status, points, prevClose }
})

// ===== 시세 보기: 오늘 수익률 = (현재가 − 전일 종가) ÷ 전일 종가 =====
const today = computed(() => {
  const h = props.holding
  const prev = Number(h.prev_close) > 0 ? Number(h.prev_close) : Number(props.chart?.prevClose) || null
  const cur = Number(h.current_price)
  if (!prev || !(cur > 0)) return null
  const change = cur - prev
  return { prev, change, rate: (change / prev) * 100 }
})
// 전일 대비 금액: 미국 주식은 달러, 국내는 원 (부호 포함)
const changeText = (h, v) => {
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  return h.currency === 'USD' ? `${sign}$${Math.abs(v).toFixed(2)}` : `${sign}${fmt(Math.abs(v))}원`
}
const todayRate = (r) => `${r > 0 ? '+' : ''}${r.toFixed(2)}%`
const chartLabel = computed(() => {
  const p = props.chart?.points
  if (!p?.length) return `${props.holding.name} 오늘 그래프 없음`
  return `${props.holding.name} 오늘 주가 그래프: 시가 ${unitPrice(props.holding.currency, p[0][1])}, 현재 ${unitPrice(props.holding.currency, props.holding.current_price)}`
})
const emit = defineEmits(['delete', 'edit'])

const pct = (r) => `${r > 0 ? '+' : ''}${Number(r).toFixed(1)}%`

function onRowClick(e) {
  if (!props.editing || e.target.closest('.del-btn')) return
  emit('edit', props.holding)
}
function onRowKey(e) {
  if (props.editing && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
    e.preventDefault()
    emit('edit', props.holding)
  }
}
</script>

<template>
  <li
    class="item"
    :class="{ editable: editing, quote: view === 'quote' }"
    :data-id="holding.holding_id"
    :tabindex="editing ? 0 : undefined"
    :role="editing ? 'button' : undefined"
    :aria-label="editing ? `${holding.name} 보유 정보 수정` : undefined"
    @click="onRowClick"
    @keydown="onRowKey"
  >
    <div class="logo" :style="{ background: holding.logo_color }">{{ holding.name[0] }}</div>

    <!-- ===== 시세 보기: 이름 · 평단가 · 하루 그래프 · 현재가 · 오늘 수익률 ===== -->
    <template v-if="view === 'quote'">
      <div class="info">
        <div class="name">
          <span class="text">{{ holding.name }}</span>
          <span v-if="holding.is_overseas" class="badge">USD</span>
        </div>
        <div class="qty m-only">평단 {{ unitPrice(holding.currency, holding.avg_price) }}</div>
      </div>
      <div class="col d-only">{{ unitPrice(holding.currency, holding.avg_price) }}</div>
      <div class="spark-cell">
        <span v-if="!chart || chart.status === 'loading'" class="skeleton spark-skel" aria-label="그래프 불러오는 중" />
        <Sparkline
          v-else
          :points="chart.points || []"
          :prev-close="today?.prev ?? chart.prevClose"
          :price="Number(holding.current_price)"
          :label="chartLabel"
        />
      </div>
      <div class="amount">
        <div class="value">{{ unitPrice(holding.currency, holding.current_price) }}</div>
        <div v-if="today" class="pl" :class="tone(today.change)">
          {{ todayRate(today.rate) }} <span class="rate">({{ changeText(holding, today.change) }})</span>
        </div>
        <div v-else class="pl flat">–</div>
      </div>
    </template>

    <!-- ===== 평가 보기 (기본) ===== -->
    <template v-else>
    <div class="info">
      <div class="name">
        <span class="text">{{ holding.name }}</span>
        <span v-if="holding.is_overseas" class="badge">USD</span>
      </div>
      <div class="qty m-only">{{ qtyText(holding.quantity) }}</div>
    </div>
    <div class="col d-only">{{ qtyText(holding.quantity) }}</div>
    <div class="col d-only">{{ unitPrice(holding.currency, holding.avg_price) }}</div>
    <div class="col d-only">{{ unitPrice(holding.currency, holding.current_price) }}</div>
    <div class="amount">
      <div class="value">{{ fmt(holding.value_krw) }}원</div>
      <div class="pl" :class="tone(holding.profit_krw)">
        {{ signed(holding.profit_krw) }}원 <span class="rate">{{ rateText(ratePct(holding.profit_krw, holding.cost_krw)) }}</span>
        <!-- 해외: 달러 기준 수익률 (원화 수익은 환율 손익 포함) -->
        <span v-if="holding.is_overseas && holding.profit_rate_local != null" class="pl-local">
          <span v-if="holding.fx_missing" class="fx-missing" title="매수 환율을 입력하면 환율 손익이 반영돼요">환율 미입력</span>
          달러 <b :class="tone(holding.profit_local)">{{ pct(ratePct(holding.profit_local, holding.cost_local)) }}</b>
        </span>
      </div>
    </div>
    </template>

    <button v-if="editing" class="del-btn" :aria-label="`${holding.name} 삭제`" @click="emit('delete', holding)">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
    </button>
    <button v-else class="handle" :aria-label="`${holding.name} 순서 변경 (위/아래 화살표 키)`">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </button>
  </li>
</template>
