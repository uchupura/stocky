<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import BaseSheet from './BaseSheet.vue'
import { supabase } from '../lib/supabase'
import { fetchFx } from '../lib/api'
import { fmt, fxText, usdText } from '../utils/format'
import { todayKST } from '../composables/useDeposits'

// 배당 추가 · 수정
const props = defineProps({
  open: { type: Boolean, default: false },
  dividend: { type: Object, default: null },          // 수정할 배당 (null 이면 새로 추가)
  holdings: { type: Array, default: () => [] },       // 보유 종목 (먼저 보여줌)
  accounts: { type: Array, default: () => [] },
  defaultAccountId: { type: Number, default: null },
  addAccount: { type: Function, required: true },
  saving: { type: Boolean, default: false },
  serverError: { type: String, default: '' },
})
const emit = defineEmits(['close', 'submit', 'delete'])

const EXCHANGE_LABEL = { KOSPI: '코스피', KOSDAQ: '코스닥', NAS: '나스닥', NYS: '뉴욕', AMS: '아멕스' }
const tickerText = (s) => (s.market === 'US' ? s.symbol.replace(/\//g, '.') : s.symbol)

const stock = ref(null) // { symbol, market, name }
const form = ref(blank())
const fx = ref({ status: 'idle' }) // idle | loading | ok | error
const touched = ref(false)
const confirmDelete = ref(false)
const newAccount = ref({ open: false, name: '', error: '', saving: false })

function blank() {
  return { amount: '', account_id: null, pay_date: todayKST(), fx_rate: '', memo: '' }
}

let opening = false // 창을 여는 동안 지급일이 채워지는 것은 "변경"으로 보지 않음
watch(() => props.open, (o) => {
  if (!o) return
  opening = true
  nextTick(() => { opening = false })
  const d = props.dividend
  stock.value = d ? { symbol: d.symbol, market: d.market, name: d.stock_name } : null
  form.value = d
    ? { amount: String(d.amount), account_id: d.account_id, pay_date: d.pay_date, fx_rate: d.market === 'US' ? String(d.fx_rate) : '', memo: d.memo || '' }
    : { ...blank(), account_id: props.defaultAccountId ?? props.accounts[0]?.id ?? null }
  fx.value = d && d.market === 'US' ? { status: 'ok', date: d.fx_date, rate: d.fx_rate, kept: true } : { status: 'idle' }
  query.value = ''
  results.value = []
  touched.value = false
  confirmDelete.value = false
  newAccount.value = { open: !props.accounts.length, name: '', error: '', saving: false }
})

// ===== 종목 고르기: 보유 종목 먼저, 검색하면 전체 상장 종목 =====
const query = ref('')
const results = ref([])
const searching = ref(false)
let timer
let seq = 0
function onQuery(e) {
  query.value = e.target.value // v-model 대신 — 한글 조합 중에도 검색
  clearTimeout(timer)
  const q = query.value.trim()
  if (!q) { results.value = []; searching.value = false; return }
  searching.value = true
  timer = setTimeout(async () => {
    const my = ++seq
    const { data, error } = await supabase.rpc('search_stock_master', { q, max_results: 20 })
    if (my !== seq) return
    searching.value = false
    results.value = error ? [] : data.map((m) => ({ symbol: m.symbol, market: m.market, name: m.name_ko || m.name_en, exchange: m.exchange }))
  }, 250)
}
onBeforeUnmount(() => clearTimeout(timer))
const candidates = computed(() =>
  query.value.trim() ? results.value : props.holdings.map((h) => ({ symbol: h.symbol, market: h.market, name: h.name, held: true })),
)
function pick(c) {
  stock.value = { symbol: c.symbol, market: c.market, name: c.name }
  if (c.market === 'US') loadFx()
}

// ===== 미국 주식: 지급일 환율 자동 조회 =====
const isUS = computed(() => stock.value?.market === 'US')
let fxSeq = 0
async function loadFx() {
  if (!isUS.value || !/^\d{4}-\d{2}-\d{2}$/.test(form.value.pay_date)) return
  const my = ++fxSeq
  fx.value = { status: 'loading' }
  try {
    const r = await fetchFx(form.value.pay_date)
    if (my !== fxSeq) return
    fx.value = { status: 'ok', date: r.date, rate: r.rate }
    form.value.fx_rate = String(r.rate)
  } catch (e) {
    if (my === fxSeq) fx.value = { status: 'error', message: e.message }
  }
}
// 지급일을 바꾸면 그날 환율로 다시 (수정 창을 처음 열 때는 저장된 환율 유지)
watch(() => form.value.pay_date, (v, old) => { if (!opening && v !== old && isUS.value) loadFx() })

// ===== 입력값 =====
const num = (v) => (String(v).trim() === '' ? NaN : Number(String(v).replace(/,/g, '').trim()))
const clean = (v) => String(v).replace(/,/g, '').trim()
// 원화 환산 = 금액 × 환율 반올림 — 소수점 오차 없이 정수로 계산해 DB(round(amount × fx_rate))와 같은 값
//   예) 5.10 × 1435 = 7318.5 → 7319 (일반 계산은 7318.4999… → 7318 로 틀림)
function krwOf(amount, rate) {
  const cents = Math.round(Number(clean(amount)) * 100)   // 달러 → 센트 (정수)
  const r4 = Math.round(Number(clean(rate)) * 10000)       // 환율 × 10000 (정수)
  return Math.floor((cents * r4 + 500000) / 1000000)       // ÷ 100 ÷ 10000, 반올림
}
const errors = computed(() => {
  const e = {}
  if (!stock.value) e.stock = '종목을 골라 주세요'
  const a = num(form.value.amount)
  if (!(a > 0)) e.amount = '0보다 큰 금액을 숫자로 입력해 주세요'
  else if (!isUS.value && !Number.isInteger(a)) e.amount = '국내 주식은 원 단위(정수)로 입력해 주세요'
  else if (isUS.value && !/^\d+(\.\d{1,2})?$/.test(clean(form.value.amount))) e.amount = '달러는 소수점 둘째 자리(센트)까지예요'
  if (isUS.value && !(num(form.value.fx_rate) > 0)) e.fx = '환율을 숫자로 입력해 주세요'
  if (!form.value.account_id) e.account = '계좌를 골라 주세요'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.value.pay_date)) e.date = '지급일을 골라 주세요'
  return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)
const showErr = (k) => touched.value && errors.value[k]
const krwPreview = computed(() => {
  const a = num(form.value.amount)
  if (!(a > 0)) return null
  return isUS.value ? (num(form.value.fx_rate) > 0 ? krwOf(form.value.amount, form.value.fx_rate) : null) : a
})
const fxEdited = computed(() => fx.value.status === 'ok' && num(form.value.fx_rate) !== Number(fx.value.rate))

async function createAccount() {
  const name = newAccount.value.name.trim()
  if (!name) { newAccount.value.error = '계좌 이름을 입력해 주세요'; return }
  newAccount.value.saving = true
  newAccount.value.error = ''
  try {
    const acc = await props.addAccount(name)
    form.value.account_id = acc.id
    newAccount.value = { open: false, name: '', error: '', saving: false }
  } catch (e) {
    newAccount.value.error = e.message
    newAccount.value.saving = false
  }
}

function submit() {
  touched.value = true
  if (!valid.value || props.saving || fx.value.status === 'loading') return
  emit('submit', {
    id: props.dividend?.id,
    symbol: stock.value.symbol,
    market: stock.value.market,
    stock_name: stock.value.name,
    amount: num(form.value.amount),
    fx_rate: isUS.value ? num(form.value.fx_rate) : 1,
    // 환율을 직접 고쳤으면 기준일은 지급일로
    fx_date: isUS.value ? (fx.value.status === 'ok' && !fxEdited.value ? fx.value.date : form.value.pay_date) : null,
    account_id: form.value.account_id,
    pay_date: form.value.pay_date,
    memo: form.value.memo,
  })
}
function onDelete() {
  if (!confirmDelete.value) { confirmDelete.value = true; return }
  emit('delete', props.dividend)
}
</script>

<template>
  <BaseSheet :open="open" :title="dividend ? '배당 수정' : '배당 추가'" @close="emit('close')">
    <!-- 1) 종목 고르기 -->
    <div v-if="!stock" class="sheet-body">
      <div class="field-input">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input :value="query" type="search" placeholder="배당 받은 종목 (예: 삼성전자, 애플, AAPL)" aria-label="종목 검색" autocomplete="off" @input="onQuery">
      </div>
      <p v-if="!query.trim()" class="pick-caption">보유 종목 · 검색하면 전체 상장 종목에서 찾아요</p>
      <ul class="pick-list">
        <li v-for="c in candidates" :key="`${c.market}:${c.symbol}`">
          <button class="pick" @click="pick(c)">
            <span class="pick-main">
              <span class="pick-name">
                <span class="text">{{ c.name }}</span>
                <span v-if="c.market === 'US'" class="badge">USD</span>
              </span>
            </span>
            <span class="pick-sub">{{ tickerText(c) }}{{ c.exchange ? ` · ${EXCHANGE_LABEL[c.exchange] || ''}` : c.held ? ' · 보유' : '' }}</span>
          </button>
        </li>
        <li v-if="searching" class="pick-empty">검색 중…</li>
        <li v-else-if="query.trim() && !candidates.length" class="pick-empty">'{{ query }}' 검색 결과가 없어요</li>
        <li v-else-if="!query.trim() && !candidates.length" class="pick-empty">보유 종목이 없어요. 위에서 검색해 주세요</li>
      </ul>
    </div>

    <!-- 2) 배당 정보 -->
    <form v-else class="sheet-body" novalidate @submit.prevent="submit">
      <div class="picked">
        <div class="pick-main">
          <div class="pick-name">
            <span class="text">{{ stock.name }}</span>
            <span v-if="isUS" class="badge">USD</span>
          </div>
          <div class="pick-sub">{{ tickerText(stock) }} · {{ isUS ? '달러로 입력' : '원화로 입력' }}</div>
        </div>
        <button v-if="!dividend" type="button" class="link-btn" @click="stock = null">변경</button>
      </div>

      <label class="field">
        <span class="field-label">배당금 <span class="field-hint">받은 금액 (세후)</span></span>
        <div class="field-input"><input v-model="form.amount" inputmode="decimal" placeholder="0" autocomplete="off"><span class="suffix">{{ isUS ? '$' : '원' }}</span></div>
        <span v-if="showErr('amount')" class="field-error">{{ errors.amount }}</span>
      </label>

      <label class="field">
        <span class="field-label">지급일</span>
        <div class="field-input"><input v-model="form.pay_date" type="date" :max="todayKST()"></div>
        <span v-if="showErr('date')" class="field-error">{{ errors.date }}</span>
      </label>

      <div v-if="isUS" class="field">
        <label class="field-label" for="div-fx">
          적용 환율
          <span class="field-hint">
            <template v-if="fx.status === 'loading'">지급일 환율 불러오는 중…</template>
            <template v-else-if="fx.status === 'ok' && !fxEdited">{{ fx.date }} 원/달러 종가{{ fx.date !== form.pay_date ? ' (직전 영업일)' : '' }}</template>
            <template v-else-if="fxEdited">직접 입력</template>
            <template v-else-if="fx.status === 'error'">자동 조회 실패 — 직접 입력</template>
          </span>
        </label>
        <div class="field-input"><input id="div-fx" v-model="form.fx_rate" inputmode="decimal" placeholder="예: 1334.3" autocomplete="off"><span class="suffix">원</span></div>
        <span v-if="showErr('fx')" class="field-error">{{ errors.fx }}</span>
        <button v-if="fxEdited" type="button" class="link-btn fx-today" @click="form.fx_rate = String(fx.rate)">자동 환율 {{ fxText(fx.rate) }}원으로 되돌리기</button>
      </div>

      <div class="field">
        <label class="field-label" for="div-account">계좌</label>
        <div v-if="accounts.length" class="field-input">
          <select id="div-account" v-model="form.account_id" class="field-select">
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
        <span v-if="showErr('account')" class="field-error">{{ errors.account }}</span>
        <button v-if="!newAccount.open" type="button" class="link-btn fx-today" @click="newAccount.open = true">+ 새 계좌</button>
        <div v-else class="new-account">
          <div class="field-input"><input v-model="newAccount.name" placeholder="예: 한국투자 위탁, ISA" maxlength="30" autocomplete="off" @keydown.enter.prevent="createAccount"></div>
          <button type="button" class="chip-btn primary" :disabled="newAccount.saving" @click="createAccount">{{ newAccount.saving ? '추가 중…' : '계좌 추가' }}</button>
        </div>
        <span v-if="newAccount.error" class="field-error">{{ newAccount.error }}</span>
      </div>

      <label class="field">
        <span class="field-label">메모 <span class="field-hint">선택 · 100자까지</span></span>
        <div class="field-input"><input v-model="form.memo" maxlength="100" placeholder="예: 3분기 배당" autocomplete="off"></div>
      </label>

      <p v-if="krwPreview !== null" class="preview">
        {{ isUS ? '원화 환산' : '배당금' }} <b>{{ fmt(krwPreview) }}원</b>
        <template v-if="isUS && num(form.fx_rate) > 0"> ({{ usdText(num(form.amount)) }} × {{ fxText(num(form.fx_rate)) }}원)</template>
      </p>
      <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>

      <div :class="dividend ? 'btn-row' : ''">
        <button v-if="dividend" type="button" class="danger-btn" :disabled="saving" @click="onDelete">
          {{ confirmDelete ? '한 번 더 누르면 삭제' : '삭제' }}
        </button>
        <button class="primary-btn" type="submit" :disabled="saving || fx.status === 'loading'" :style="dividend ? 'margin-top:0' : 'width:100%'">
          {{ saving ? '저장하는 중…' : fx.status === 'loading' ? '환율 불러오는 중…' : '저장' }}
        </button>
      </div>
    </form>
  </BaseSheet>
</template>
