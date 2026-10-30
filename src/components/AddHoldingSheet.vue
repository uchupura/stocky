<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import BaseSheet from './BaseSheet.vue'
import { supabase } from '../lib/supabase'
import { fetchQuote } from '../lib/api'
import { fmt, signed, tone, unitPrice, fxText } from '../utils/format'

const props = defineProps({
  open: { type: Boolean, default: false },
  stocks: { type: Array, default: () => [] },        // 이미 등록된 종목 (검색어 없을 때 표시)
  heldSymbols: { type: Array, default: () => [] },   // 이미 보유 중인 종목 코드
  usdRate: { type: Number, default: null },
  saving: { type: Boolean, default: false },
  serverError: { type: String, default: '' },        // DB 저장 실패 메시지
})
const emit = defineEmits(['close', 'submit'])

// 새 종목 로고 색 (종목 코드로 고정 선택)
const PALETTE = ['#3182f6', '#f04452', '#00b8a9', '#ff9f1a', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b']
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0)
const EXCHANGE_LABEL = { KOSPI: '코스피', KOSDAQ: '코스닥', NAS: '나스닥', NYS: '뉴욕', AMS: '아멕스' }
// 화면 표시용 티커: KIS 는 클래스 주식을 "BRK/B" 로 저장 → 익숙한 "BRK.B" 로 보여줌 (저장값은 그대로)
const tickerText = (c) => (c.market === 'US' ? c.symbol.replace(/\//g, '.') : c.symbol)

const step = ref('search') // search: 종목 고르기 / form: 수량·단가 입력
const mode = ref('pick')   // pick: 검색에서 고름 / new: 직접 입력으로 새 종목 등록
const query = ref('')
const selected = ref(null)
const form = ref(emptyForm())
const touched = ref(false) // 한 번 "추가하기"를 눌러야 에러 문구 표시
const body = ref(null)

function emptyForm() {
  return { name: '', symbol: '', market: 'KR', price: '', qty: '', avg: '', fx: '' }
}

function reset() {
  step.value = 'search'
  mode.value = 'pick'
  query.value = ''
  results.value = []
  searchError.value = ''
  selected.value = null
  quote.value = { status: 'idle' }
  form.value = emptyForm()
  touched.value = false
}
watch(() => props.open, (o) => o && reset())

// 단계가 바뀌면 첫 입력칸으로 포커스
watch(step, async () => {
  await nextTick()
  body.value?.querySelector('input')?.focus()
})

// ===== 1단계: 종목 검색 (전체 상장 종목 · stock_master) =====
const held = computed(() => new Set(props.heldSymbols))
const registered = computed(() => Object.fromEntries(props.stocks.map((s) => [s.symbol, s])))

const results = ref([])
const searching = ref(false)
const searchError = ref('')
let searchTimer
let searchSeq = 0

watch(query, (q) => {
  clearTimeout(searchTimer)
  searchError.value = ''
  if (!q.trim()) {
    results.value = []
    searching.value = false
    return
  }
  searching.value = true
  searchTimer = setTimeout(() => runSearch(q), 250) // 입력을 잠깐 멈추면 검색
})
onBeforeUnmount(() => clearTimeout(searchTimer))

async function runSearch(q) {
  const seq = ++searchSeq
  const { data, error } = await supabase.rpc('search_stock_master', { q: q.trim(), max_results: 20 })
  if (seq !== searchSeq) return // 더 최근 검색이 있으면 무시
  searching.value = false
  if (error) {
    console.error(error)
    searchError.value = '검색하지 못했어요. 잠시 후 다시 시도해 주세요.'
    results.value = []
    return
  }
  results.value = data
}

// 화면에 보여줄 후보 (검색 결과 또는 등록된 종목)
function fromMaster(m) {
  const reg = registered.value[m.symbol]
  return {
    symbol: m.symbol,
    market: m.market,
    exchange: m.exchange,
    currency: m.currency,
    name: reg?.name || m.name_ko || m.name_en,
    nameSub: m.name_ko && m.name_en ? m.name_en : '',
    isEtf: m.security_type === 'etf',
    logo_color: reg?.logo_color || PALETTE[hash(m.symbol) % PALETTE.length],
  }
}
function fromRegistered(s) {
  return {
    symbol: s.symbol, market: s.market, exchange: s.exchange, currency: s.currency,
    name: s.name, nameSub: '', isEtf: false, logo_color: s.logo_color || PALETTE[hash(s.symbol) % PALETTE.length],
  }
}
const candidates = computed(() =>
  query.value.trim() ? results.value.map(fromMaster) : props.stocks.map(fromRegistered),
)

// ===== 종목 선택 → 현재가 자동 조회 =====
const quote = ref({ status: 'idle' }) // idle | loading | ok | error
let quoteSeq = 0

async function pick(c) {
  if (held.value.has(c.symbol)) return
  selected.value = c
  mode.value = 'pick'
  form.value = emptyForm()
  touched.value = false
  step.value = 'form'

  const seq = ++quoteSeq
  quote.value = { status: 'loading' }
  try {
    const q = await fetchQuote(c.symbol, c.market)
    if (seq === quoteSeq) {
      quote.value = { status: 'ok', ...q }
      // 해외: 매수 환율 기본값 = 오늘 환율 (다른 날 샀으면 직접 수정)
      if (c.market === 'US' && !form.value.fx) form.value.fx = String(q.fxRate ?? props.usdRate ?? '')
    }
  } catch (e) {
    if (seq === quoteSeq) quote.value = { status: 'error', message: e.message }
  }
}

function startNew() {
  mode.value = 'new'
  selected.value = null
  quote.value = { status: 'idle' }
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
// 현재가를 직접 입력해야 하는 경우: 새 종목 직접 등록 / 자동 조회 실패
const needManualPrice = computed(() => mode.value === 'new' || quote.value.status === 'error')

const price = computed(() => (quote.value.status === 'ok' ? quote.value.price : num(form.value.price)))
// 현재 환율: 현재가와 함께 받은 값 → 없으면 DB 환율
const nowFx = computed(() => (quote.value.status === 'ok' && quote.value.fxRate) || props.usdRate)
function useTodayFx() {
  if (nowFx.value) form.value.fx = String(nowFx.value)
}

const errors = computed(() => {
  const e = {}
  const f = form.value
  if (mode.value === 'new') {
    if (!f.name.trim()) e.name = '종목 이름을 입력해 주세요'
    const sym = f.symbol.trim().toUpperCase()
    if (!sym) e.symbol = '종목 코드를 입력해 주세요'
    else if (props.stocks.some((s) => s.symbol.toUpperCase() === sym)) e.symbol = '이미 등록된 종목 코드예요. 검색에서 골라 주세요'
  }
  if (needManualPrice.value && !(num(f.price) > 0)) e.price = '현재가를 숫자로 입력해 주세요'
  if (!(num(f.qty) > 0)) e.qty = '보유 수량은 0보다 커야 해요'
  if (!(num(f.avg) >= 0)) e.avg = '평균 단가를 숫자로 입력해 주세요'
  // 매수 환율은 비워도 됨 (현재 환율로 대신 계산)
  if (currency.value === 'USD' && String(f.fx).trim() !== '' && !(num(f.fx) > 0)) e.fx = '환율을 숫자로 입력해 주세요'
  return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)
const showErr = (k) => touched.value && errors.value[k]

// 입력 중 미리보기: 예상 평가금액·수익금 (원화)
const preview = computed(() => {
  const q = num(form.value.qty)
  const a = num(form.value.avg)
  const fx = currency.value === 'USD' ? nowFx.value : 1
  if (!(q > 0) || !(a >= 0) || !(price.value > 0) || !fx) return null
  const buyFx = currency.value === 'USD' && num(form.value.fx) > 0 ? num(form.value.fx) : fx
  const value = q * price.value * fx
  return { value, profit: value - q * a * buyFx }
})

function submit() {
  touched.value = true
  if (!valid.value || props.saving || quote.value.status === 'loading') return
  const f = form.value
  const base = { quantity: num(f.qty), avgPrice: num(f.avg) }
  if (currency.value === 'USD' && num(f.fx) > 0) base.avgFxRate = num(f.fx)
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
    const c = selected.value
    emit('submit', {
      ...base,
      label: c.name,
      price: price.value,
      prevClose: quote.value.status === 'ok' ? quote.value.prevClose : null,
      master: {
        symbol: c.symbol, name: c.name, market: c.market, currency: c.currency,
        exchange: c.exchange, logo_color: c.logo_color,
      },
    })
  }
}

const title = computed(() =>
  step.value === 'search' ? '주식 추가' : mode.value === 'new' ? '새 종목 등록' : '보유 정보 입력',
)
const rateText = (r) => `${r > 0 ? '+' : ''}${Number(r).toFixed(2)}%`
</script>

<template>
  <BaseSheet :open="open" :title="title" @close="emit('close')">
    <!-- 1단계: 종목 고르기 -->
    <div v-if="step === 'search'" ref="body" class="sheet-body">
      <div class="field-input">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <!-- v-model 대신 @input: v-model 은 한글 조합 중에는 값을 바꾸지 않아
             휴대폰 키보드에서 "애플"을 쳐도 검색이 시작되지 않는 문제가 있음 -->
        <input
          :value="query"
          type="search"
          placeholder="종목 이름·코드·티커 (예: 삼성전자, 애플, AAPL, BRK.B)"
          aria-label="종목 검색"
          autocomplete="off"
          @input="query = $event.target.value"
        >
      </div>

      <p v-if="!query.trim()" class="pick-caption">등록된 종목 · 검색하면 전체 상장 종목에서 찾아요</p>

      <ul class="pick-list" :aria-busy="searching">
        <li v-for="c in candidates" :key="`${c.market}:${c.symbol}`">
          <button class="pick" :disabled="held.has(c.symbol)" @click="pick(c)">
            <span class="logo sm" :style="{ background: c.logo_color }">{{ c.name[0] }}</span>
            <span class="pick-main">
              <span class="pick-name">
                <span class="text">{{ c.name }}</span>
                <span v-if="c.market === 'US'" class="badge">USD</span>
                <span v-if="c.isEtf" class="badge etf">ETF</span>
              </span>
              <span v-if="c.nameSub" class="pick-sub text">{{ c.nameSub }}</span>
            </span>
            <span class="pick-sub">{{ held.has(c.symbol) ? '보유 중' : `${tickerText(c)} · ${EXCHANGE_LABEL[c.exchange] || c.market}` }}</span>
          </button>
        </li>
        <li v-if="searching" class="pick-empty">검색 중…</li>
        <li v-else-if="searchError" class="pick-empty">{{ searchError }}</li>
        <li v-else-if="query.trim() && !candidates.length" class="pick-empty">'{{ query }}' 검색 결과가 없어요</li>
      </ul>

      <button class="link-btn" @click="startNew">찾는 종목이 없나요? <b>직접 입력해서 등록</b></button>
    </div>

    <!-- 2단계: 수량·단가 입력 -->
    <form v-else ref="body" class="sheet-body" novalidate @submit.prevent="submit">
      <button type="button" class="back-btn" @click="step = 'search'">← 종목 다시 고르기</button>

      <div v-if="mode === 'pick'" class="picked">
        <span class="logo sm" :style="{ background: selected.logo_color }">{{ selected.name[0] }}</span>
        <div class="pick-main">
          <div class="pick-name">
            <span class="text">{{ selected.name }}</span>
            <span v-if="selected.market === 'US'" class="badge">USD</span>
          </div>
          <div class="pick-sub">
            {{ tickerText(selected) }} · {{ EXCHANGE_LABEL[selected.exchange] || selected.market }} ·
            <template v-if="quote.status === 'loading'">현재가 불러오는 중…</template>
            <template v-else-if="quote.status === 'ok'">
              현재가 <b class="quote-price">{{ unitPrice(quote.currency, quote.price) }}</b>
              <span :class="tone(quote.change)">{{ rateText(quote.changeRate) }}</span>
            </template>
            <template v-else-if="quote.status === 'error'">현재가를 불러오지 못했어요</template>
          </div>
        </div>
      </div>

      <template v-if="mode === 'new'">
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
      </template>

      <label v-if="needManualPrice" class="field">
        <span class="field-label">현재가{{ quote.status === 'error' ? ' (자동 조회 실패 — 직접 입력)' : '' }}</span>
        <div class="field-input"><input v-model="form.price" inputmode="decimal" placeholder="0" autocomplete="off"><span class="suffix">{{ unit }}</span></div>
        <span v-if="showErr('price')" class="field-error">{{ errors.price }}</span>
      </label>

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
      <div v-if="currency === 'USD'" class="field">
        <label class="field-label" for="add-fx">
          매수 환율 <span class="field-hint">증권사 앱의 "매입 환율" · 비우면 현재 환율로 계산</span>
        </label>
        <div class="field-input">
          <input id="add-fx" v-model="form.fx" inputmode="decimal" :placeholder="nowFx ? `오늘 ${fxText(nowFx)}` : '예: 1300'" autocomplete="off">
          <span class="suffix">원</span>
        </div>
        <span v-if="showErr('fx')" class="field-error">{{ errors.fx }}</span>
        <button v-if="nowFx && String(form.fx) !== String(nowFx)" type="button" class="link-btn fx-today" @click="useTodayFx">오늘 환율 {{ fxText(nowFx) }}원 넣기</button>
      </div>

      <p v-if="preview" class="preview">
        예상 평가금액 <b>{{ fmt(preview.value) }}원</b> · 수익금
        <b :class="tone(preview.profit)">{{ signed(preview.profit) }}원</b>
      </p>
      <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>

      <button class="primary-btn" type="submit" :disabled="saving || quote.status === 'loading'">
        {{ saving ? '추가하는 중…' : quote.status === 'loading' ? '현재가 불러오는 중…' : '추가하기' }}
      </button>
    </form>
  </BaseSheet>
</template>
