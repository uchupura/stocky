<script setup>
import { fmt, signed, tone, rateText, ratePct, unitPrice, qtyText } from '../utils/format'

defineProps({
  holding: { type: Object, required: true },
  editing: { type: Boolean, default: false }, // 편집 모드: 손잡이 대신 삭제 버튼
})
const emit = defineEmits(['delete'])
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
    <button v-if="editing" class="del-btn" :aria-label="`${holding.name} 삭제`" @click="emit('delete', holding)">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
    </button>
    <button v-else class="handle" :aria-label="`${holding.name} 순서 변경 (위/아래 화살표 키)`">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </button>
  </li>
</template>
