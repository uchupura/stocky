<script setup>
import { ref, computed } from 'vue'
import { fmt } from '../utils/format'

// 내 투자 — 계좌 필터(계좌별 총 자산 함께 표시) + 계좌 미지정 안내 · 일괄 지정
//   v-model = 'all' | 계좌 id | 'none'(미지정)
const props = defineProps({
  modelValue: { type: [String, Number], default: 'all' },
  accounts: { type: Array, default: () => [] },
  holdings: { type: Array, default: () => [] },
  cash: { type: Array, default: () => [] },
  usdRate: { type: Number, default: null },
  assigning: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'assign'])

const cashKrw = (c) => (c.currency === 'USD' ? Math.round(c.amount * (props.usdRate || 0)) : c.amount)
// 계좌별 총 자산 = 주식 평가금액 + 예수금(달러는 현재 환율)
const totals = computed(() => {
  const t = new Map()
  const add = (k, v) => t.set(k, (t.get(k) || 0) + v)
  for (const h of props.holdings) add(h.account_id ?? 'none', Number(h.value_krw))
  for (const c of props.cash) add(c.account_id ?? 'none', cashKrw(c))
  return t
})
const looseHoldings = computed(() => props.holdings.filter((h) => h.account_id == null).length)
const looseCash = computed(() => props.cash.some((c) => c.account_id == null && c.amount > 0))
const hasLoose = computed(() => looseHoldings.value > 0 || looseCash.value)

const short = (v) => {
  const a = Math.abs(v)
  if (a >= 1e8) return `${+(v / 1e8).toFixed(1)}억`
  if (a >= 1e4) return `${fmt(Math.round(v / 1e4))}만`
  return fmt(v)
}

const target = ref('')
function assign() {
  if (target.value) emit('assign', Number(target.value))
}
</script>

<template>
  <div v-if="accounts.length || hasLoose" class="acct-bar">
    <div v-if="accounts.length" class="filter-chips acct-chips" role="radiogroup" aria-label="계좌 선택">
      <button type="button" role="radio" :aria-checked="modelValue === 'all'" :class="{ on: modelValue === 'all' }" @click="emit('update:modelValue', 'all')">전체</button>
      <button
        v-for="a in accounts" :key="a.id" type="button" role="radio"
        :aria-checked="modelValue === a.id" :class="{ on: modelValue === a.id }"
        @click="emit('update:modelValue', a.id)"
      >{{ a.name }} <small>{{ short(totals.get(a.id) || 0) }}</small></button>
      <button
        v-if="hasLoose" type="button" role="radio"
        :aria-checked="modelValue === 'none'" :class="{ on: modelValue === 'none' }"
        @click="emit('update:modelValue', 'none')"
      >미지정 <small>{{ short(totals.get('none') || 0) }}</small></button>
    </div>

    <div v-if="hasLoose" class="acct-notice" role="status">
      <p>
        <b>계좌 미지정</b>
        {{ [looseHoldings ? `${looseHoldings}종목` : '', looseCash ? '예수금' : ''].filter(Boolean).join(' · ') }}
        — 계좌를 지정해야 계좌별 금액·수익률이 정확해요
      </p>
      <div v-if="accounts.length" class="acct-assign">
        <select v-model="target" class="chart-select-inline" aria-label="일괄 지정할 계좌">
          <option value="">계좌 고르기</option>
          <option v-for="a in accounts" :key="a.id" :value="String(a.id)">{{ a.name }}</option>
        </select>
        <button type="button" class="chip-btn primary" :disabled="!target || assigning" @click="assign">
          {{ assigning ? '지정하는 중…' : '한 번에 지정' }}
        </button>
      </div>
      <p v-else class="acct-help">입출금 탭이나 주식 추가·수정 창의 "+ 새 계좌"로 계좌를 먼저 만들어 주세요.</p>
    </div>
  </div>
</template>
