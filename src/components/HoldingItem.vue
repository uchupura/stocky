<script setup>
import { fmt, signed, tone, rateText, ratePct, unitPrice, qtyText } from '../utils/format'

defineProps({
  holding: { type: Object, required: true },
})
</script>

<template>
  <li class="item" :data-id="holding.holding_id">
    <div class="logo" :style="{ background: holding.logo_color }">{{ holding.name[0] }}</div>
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
      </div>
    </div>
    <button class="handle" :aria-label="`${holding.name} 순서 변경 (위/아래 화살표 키)`">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </button>
  </li>
</template>
