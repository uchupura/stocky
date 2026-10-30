<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import BaseSheet from './BaseSheet.vue'
import { fmt, signed, tone, unitPrice } from '../utils/format'

const props = defineProps({
  open: { type: Boolean, default: false },
  stocks: { type: Array, default: () => [] },        // 등록된 전체 종목
  heldStockIds: { type: Array, default: () => [] },  // 이미 보유 중인 종목 id
  usdRate: { type: Number, default: null },
  saving: { type: Boolean, default: false },
  serverError: { type: String, default: '' },        // DB 저장 실패 메시지
})
const emit = defineEmits(['close', 'submit'])

// 새 종목 로고 색 (종목 코드로 고정 선택)
const PALETTE = ['#3182f6', '#f04452', '#00b8a9', '#ff9f1a', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b']
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0)

const step = ref('search') // search: 종목 고르기 / form: 수량·단가 입력
const mode = ref('existing') // existing: 등록된 종목 / new: 새 종목 등록
const query = ref('')
const selected = ref(null)
const form = ref(emptyForm())
const touched = ref(false) // 한 번 "추가하기"를 눌러야 에러 문구 표시
const body = ref(null)

function emptyForm() {
  return { name: '', symbol: '', market: 'KR', price: '', qty: '', avg: '' }
}

function reset() {
  step.value = 'search'
  mode.value = 'existing'
  query.value = ''
  selected.value = null
  form.value = emptyForm()
  touched.value = false
}
watch(() => props.open, (o) => o && reset())

// 단계가 바뀌면 첫 입력칸으로 포커스
watch(step, async () => {
  await nextTick()
  body.value?.querySelector('input')?.focus()
})

// ===== 1단계: 종목 검색 =====
const held = computed(() => new Set(props.heldStockIds))
const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = q
    ? props.stocks.filter((s) => s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q))
    : props.stocks
  return list.slice(0, 30)
})

function pick(s) {
  if (held.value.has(s.id)) return
  selected.value = s
  mode.value = 'existing'
  touched.value = false
  step.value = 'form'
}
function startNew() {
  mode.value = 'new'
  selected.value = null
  form.value = { ...emptyForm(), name: query.value.trim() }
  touched.value = false
  step.value = 'form'
}

// ===== 2단계: 입력값 =====
// "1,234.5" 같은 입력도 숫자로 (빈칸은 NaN)
const num = (v) => (String(v).trim() === '' ? NaN : Number(String(v).replace(/,/g, '').trim()))

const market = computed(() => (mode.value === 'new' ? form.value.market : selected.value?.market))
const currency = computed(() => (market.value === 'US' ? 'USD' : 'KRW'))
const unit = computed(() => (currency.value === 'USD' ? '$' : '원'))

const errors = computed(() => {
  const e = {}
  const f = form.value
  if (mode.value === 'new') {
    if (!f.name.trim()) e.name = '종목 이름을 입력해 주세요'
    const sym = f.symbol.trim().toUpperCase()
    if (!sym) e.symbol = '종목 코드를 입력해 주세요'
    else if (props.stocks.some((s) => s.symbol.toUpperCase() === sym)) e.symbol = '이미 등록된 종목 코드예요. 검색에서 골라 주세요'
    if (!(num(f.price) >= 0)) e.price = '현재가를 숫자로 입력해 주세요'
  }
  if (!(num(f.qty) > 0)) e.qty = '보유 수량은 0보다 커야 해요'
  if (!(num(f.avg) >= 0)) e.avg = '평균 단가를 숫자로 입력해 주세요'
  return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)
const showErr = (k) => touched.value && errors.value[k]

// 입력 중 미리보기: 예상 평가금액·수익금 (원화)
const preview = computed(() => {
  const q = num(form.value.qty)
  const a = num(form.value.avg)
  const price = mode.value === 'new' ? num(form.value.price) : Number(selected.value?.current_price)
  const fx = currency.value === 'USD' ? props.usdRate : 1
  if (!(q > 0) || !(a >= 0) || !(price >= 0) || !fx) return null
  const value = q * price * fx
  return { value, profit: value - q * a * fx }
})

function submit() {
  touched.value = true
  if (!valid.value || props.saving) return
  const f = form.value
  const base = { quantity: num(f.qty), avgPrice: num(f.avg) }
  if (mode.value === 'new') {
    const symbol = f.symbol.trim().toUpperCase()
    emit('submit', {
      ...base,
      label: f.name.trim(),
      newStock: {
        symbol,
        name: f.name.trim(),
        market: f.market,
        currency: currency.value,
        current_price: num(f.price),
        logo_color: PALETTE[hash(symbol) % PALETTE.length],
      },
    })
  } else {
    emit('submit', { ...base, label: selected.value.name, stockId: selected.value.id })
  }
}

const title = computed(() =>
  step.value === 'search' ? '주식 추가' : mode.value === 'new' ? '새 종목 등록' : '보유 정보 입력',
)
</script>

<template>
  <BaseSheet :open="open" :title="title" @close="emit('close')">
    <!-- 1단계: 종목 고르기 -->
    <div v-if="step === 'search'" ref="body" class="sheet-body">
      <div class="field-input">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input v-model="query" type="search" placeholder="종목 이름 또는 코드" aria-label="종목 검색" autocomplete="off">
      </div>

      <ul class="pick-list">
        <li v-for="s in results" :key="s.id">
          <button class="pick" :disabled="held.has(s.id)" @click="pick(s)">
            <span class="logo sm" :style="{ background: s.logo_color || '#8b95a1' }">{{ s.name[0] }}</span>
            <span class="pick-name">
              <span class="text">{{ s.name }}</span>
              <span v-if="s.market === 'US'" class="badge">USD</span>
            </span>
            <span class="pick-sub">{{ held.has(s.id) ? '보유 중' : s.symbol }}</span>
          </button>
        </li>
        <li v-if="!results.length" class="pick-empty">'{{ query }}' 검색 결과가 없어요</li>
      </ul>

      <button class="link-btn" @click="startNew">찾는 종목이 없나요? <b>새 종목 등록</b></button>
    </div>

    <!-- 2단계: 수량·단가 입력 -->
    <form v-else ref="body" class="sheet-body" novalidate @submit.prevent="submit">
      <button type="button" class="back-btn" @click="step = 'search'">← 종목 다시 고르기</button>

      <div v-if="mode === 'existing'" class="picked">
        <span class="logo sm" :style="{ background: selected.logo_color || '#8b95a1' }">{{ selected.name[0] }}</span>
        <div>
          <div class="pick-name">
            <span class="text">{{ selected.name }}</span>
            <span v-if="selected.market === 'US'" class="badge">USD</span>
          </div>
          <div class="pick-sub">{{ selected.symbol }} · 현재가 {{ unitPrice(selected.currency, selected.current_price) }}</div>
        </div>
      </div>

      <template v-else>
        <label class="field">
          <span class="field-label">종목 이름</span>
          <div class="field-input"><input v-model="form.name" placeholder="예: Alphabet" autocomplete="off"></div>
          <span v-if="showErr('name')" class="field-error">{{ errors.name }}</span>
        </label>
        <label class="field">
          <span class="field-label">종목 코드</span>
          <div class="field-input"><input v-model="form.symbol" placeholder="예: GOOGL, 035420" autocomplete="off" autocapitalize="characters"></div>
          <span v-if="showErr('symbol')" class="field-error">{{ errors.symbol }}</span>
        </label>
        <div class="field">
          <span class="field-label">시장</span>
          <div class="segment" role="radiogroup" aria-label="시장">
            <button type="button" role="radio" :aria-checked="form.market === 'KR'" :class="{ on: form.market === 'KR' }" @click="form.market = 'KR'">국내 (원)</button>
            <button type="button" role="radio" :aria-checked="form.market === 'US'" :class="{ on: form.market === 'US' }" @click="form.market = 'US'">해외 (USD)</button>
          </div>
        </div>
        <label class="field">
          <span class="field-label">현재가</span>
          <div class="field-input"><input v-model="form.price" inputmode="decimal" placeholder="0" autocomplete="off"><span class="suffix">{{ unit }}</span></div>
          <span v-if="showErr('price')" class="field-error">{{ errors.price }}</span>
        </label>
      </template>

      <label class="field">
        <span class="field-label">보유 수량</span>
        <div class="field-input"><input v-model="form.qty" inputmode="decimal" placeholder="0" autocomplete="off"><span class="suffix">주</span></div>
        <span v-if="showErr('qty')" class="field-error">{{ errors.qty }}</span>
      </label>
      <label class="field">
        <span class="field-label">평균 단가</span>
        <div class="field-input"><input v-model="form.avg" inputmode="decimal" placeholder="0" autocomplete="off"><span class="suffix">{{ unit }}</span></div>
        <span v-if="showErr('avg')" class="field-error">{{ errors.avg }}</span>
      </label>

      <p v-if="preview" class="preview">
        예상 평가금액 <b>{{ fmt(preview.value) }}원</b> · 수익금
        <b :class="tone(preview.profit)">{{ signed(preview.profit) }}원</b>
      </p>
      <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>

      <button class="primary-btn" type="submit" :disabled="saving">{{ saving ? '추가하는 중…' : '추가하기' }}</button>
    </form>
  </BaseSheet>
</template>
