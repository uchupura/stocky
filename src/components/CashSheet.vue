<script setup>
import { ref, computed, watch } from 'vue'
import BaseSheet from './BaseSheet.vue'
import { fmt, fxText } from '../utils/format'

// 예수금 수정: 원화(원) · 달러($)
const props = defineProps({
  open: { type: Boolean, default: false },
  krw: { type: Number, default: 0 },
  usd: { type: Number, default: 0 },
  usdRate: { type: Number, default: null },
  saving: { type: Boolean, default: false },
  serverError: { type: String, default: '' },
})
const emit = defineEmits(['close', 'submit'])

const form = ref({ krw: '', usd: '' })
const touched = ref(false)
watch(
  () => props.open,
  (o) => {
    if (!o) return
    form.value = { krw: props.krw ? String(props.krw) : '', usd: props.usd ? String(props.usd) : '' }
    touched.value = false
  },
)

// 빈칸 = 0, "1,000,000" 같은 입력도 숫자로
const num = (v) => (String(v).trim() === '' ? 0 : Number(String(v).replace(/,/g, '').trim()))
const errors = computed(() => {
  const e = {}
  if (!(num(form.value.krw) >= 0)) e.krw = '0 이상의 숫자로 입력해 주세요'
  if (!(num(form.value.usd) >= 0)) e.usd = '0 이상의 숫자로 입력해 주세요'
  return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)
const showErr = (k) => touched.value && errors.value[k]

const usdKrw = computed(() => (props.usdRate && num(form.value.usd) >= 0 ? num(form.value.usd) * props.usdRate : null))

function submit() {
  touched.value = true
  if (!valid.value || props.saving) return
  emit('submit', {
    krw: Math.round(num(form.value.krw)),                // 원: 정수
    usd: Math.round(num(form.value.usd) * 100) / 100,    // 달러: 센트까지
  })
}
</script>

<template>
  <BaseSheet :open="open" title="예수금 수정" @close="emit('close')">
    <form class="sheet-body" novalidate @submit.prevent="submit">
      <label class="field">
        <span class="field-label">원화 예수금</span>
        <div class="field-input"><input v-model="form.krw" inputmode="numeric" placeholder="0" autocomplete="off"><span class="suffix">원</span></div>
        <span v-if="showErr('krw')" class="field-error">{{ errors.krw }}</span>
      </label>
      <label class="field">
        <span class="field-label">달러 예수금</span>
        <div class="field-input"><input v-model="form.usd" inputmode="decimal" placeholder="0" autocomplete="off"><span class="suffix">$</span></div>
        <span v-if="showErr('usd')" class="field-error">{{ errors.usd }}</span>
      </label>

      <p v-if="usdKrw !== null && valid" class="preview">
        달러 예수금 원화 환산 <b>{{ fmt(usdKrw) }}원</b> (1달러 = {{ fxText(usdRate) }}원)<br>
        예수금 합계 <b>{{ fmt(num(form.krw) + usdKrw) }}원</b>
      </p>
      <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>

      <button class="primary-btn" type="submit" :disabled="saving">{{ saving ? '저장하는 중…' : '저장' }}</button>
    </form>
  </BaseSheet>
</template>
