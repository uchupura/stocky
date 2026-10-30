<script setup>
import { ref, computed, watch } from 'vue'
import BaseSheet from './BaseSheet.vue'
import { fmt, signed, tone, fxText, unitPrice } from '../utils/format'

// 보유 정보 수정: 수량 · 평균 단가 · 매수 환율(해외)
const props = defineProps({
  holding: { type: Object, default: null }, // holding_values 한 행 (null 이면 닫힘)
  usdRate: { type: Number, default: null },
  saving: { type: Boolean, default: false },
  serverError: { type: String, default: '' },
})
const emit = defineEmits(['close', 'submit'])

const form = ref({ qty: '', avg: '', fx: '' })
const touched = ref(false)

watch(
  () => props.holding,
  (h) => {
    if (!h) return
    form.value = {
      qty: String(Number(h.quantity)),
      avg: String(Number(h.avg_price)),
      fx: h.avg_fx_rate != null ? String(Number(h.avg_fx_rate)) : '',
    }
    touched.value = false
  },
)

const isUS = computed(() => props.holding?.market === 'US')
const unit = computed(() => (isUS.value ? '$' : '원'))
const num = (v) => (String(v).trim() === '' ? NaN : Number(String(v).replace(/,/g, '').trim()))

const errors = computed(() => {
  const e = {}
  if (!(num(form.value.qty) > 0)) e.qty = '보유 수량은 0보다 커야 해요'
  if (!(num(form.value.avg) >= 0)) e.avg = '평균 단가를 숫자로 입력해 주세요'
  // 매수 환율은 비워도 됨 (현재 환율로 대신 계산)
  if (isUS.value && String(form.value.fx).trim() !== '' && !(num(form.value.fx) > 0)) e.fx = '환율을 숫자로 입력해 주세요'
  return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)
const showErr = (k) => touched.value && errors.value[k]

// 미리보기: 원화 수익(환차익 포함) + 달러 수익률
const preview = computed(() => {
  const h = props.holding
  const q = num(form.value.qty)
  const a = num(form.value.avg)
  if (!h || !(q > 0) || !(a >= 0)) return null
  const price = Number(h.current_price)
  if (!isUS.value) {
    const value = q * price
    const cost = q * a
    return { value, profit: value - cost, rate: cost ? ((value - cost) / cost) * 100 : 0 }
  }
  const nowFx = props.usdRate
  if (!nowFx) return null
  const buyFx = num(form.value.fx) > 0 ? num(form.value.fx) : nowFx
  const value = q * price * nowFx
  const cost = q * a * buyFx
  return {
    value,
    profit: value - cost,
    rate: cost ? ((value - cost) / cost) * 100 : 0,
    rateLocal: a ? ((price - a) / a) * 100 : 0,
    fxGain: q * a * (nowFx - buyFx), // 환율 변동으로 생긴 손익
    fxMissing: !(num(form.value.fx) > 0),
  }
})
const pct = (r) => `${r > 0 ? '+' : ''}${r.toFixed(1)}%`

function useTodayFx() {
  if (props.usdRate) form.value.fx = String(props.usdRate)
}

function submit() {
  touched.value = true
  if (!valid.value || props.saving) return
  const payload = { quantity: num(form.value.qty), avgPrice: num(form.value.avg) }
  if (isUS.value) payload.avgFxRate = num(form.value.fx) > 0 ? num(form.value.fx) : null
  emit('submit', payload)
}
</script>

<template>
  <BaseSheet :open="!!holding" title="보유 정보 수정" @close="emit('close')">
    <form v-if="holding" class="sheet-body" novalidate @submit.prevent="submit">
      <div class="picked">
        <span class="logo sm" :style="{ background: holding.logo_color }">{{ holding.name[0] }}</span>
        <div class="pick-main">
          <div class="pick-name">
            <span class="text">{{ holding.name }}</span>
            <span v-if="isUS" class="badge">USD</span>
          </div>
          <div class="pick-sub">현재가 <b class="quote-price">{{ unitPrice(holding.currency, holding.current_price) }}</b></div>
        </div>
      </div>

      <label class="field">
        <span class="field-label">보유 수량</span>
        <div class="field-input"><input v-model="form.qty" inputmode="decimal" autocomplete="off"><span class="suffix">주</span></div>
        <span v-if="showErr('qty')" class="field-error">{{ errors.qty }}</span>
      </label>
      <label class="field">
        <span class="field-label">평균 단가</span>
        <div class="field-input"><input v-model="form.avg" inputmode="decimal" autocomplete="off"><span class="suffix">{{ unit }}</span></div>
        <span v-if="showErr('avg')" class="field-error">{{ errors.avg }}</span>
      </label>
      <div v-if="isUS" class="field">
        <label class="field-label" for="edit-fx">
          매수 환율 <span class="field-hint">증권사 앱의 "매입 환율" · 비우면 현재 환율로 계산</span>
        </label>
        <div class="field-input">
          <input id="edit-fx" v-model="form.fx" inputmode="decimal" :placeholder="usdRate ? `오늘 ${fxText(usdRate)}` : '예: 1300'" autocomplete="off">
          <span class="suffix">원</span>
        </div>
        <span v-if="showErr('fx')" class="field-error">{{ errors.fx }}</span>
        <button v-if="usdRate" type="button" class="link-btn fx-today" @click="useTodayFx">오늘 환율 {{ fxText(usdRate) }}원 넣기</button>
      </div>

      <div v-if="preview" class="preview">
        평가금액 <b>{{ fmt(preview.value) }}원</b> · 수익금
        <b :class="tone(preview.profit)">{{ signed(preview.profit) }}원 ({{ pct(preview.rate) }})</b>
        <template v-if="isUS">
          <br>달러 기준 <b :class="tone(preview.rateLocal)">{{ pct(preview.rateLocal) }}</b>
          <template v-if="!preview.fxMissing">
            · 환율 손익 <b :class="tone(preview.fxGain)">{{ signed(preview.fxGain) }}원</b>
          </template>
          <template v-else> · <span class="fx-missing">매수 환율 미입력 — 환율 손익 0으로 계산</span></template>
        </template>
      </div>
      <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>

      <button class="primary-btn" type="submit" :disabled="saving">{{ saving ? '저장하는 중…' : '저장' }}</button>
    </form>
  </BaseSheet>
</template>
