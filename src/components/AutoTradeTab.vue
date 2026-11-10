<script setup>
import { ref, computed, watch, toRef } from 'vue'
import BaseSheet from './BaseSheet.vue'
import { locPreview, locSubmit } from '../lib/api'
import { useLocCycles, toForm } from '../composables/useLocCycles'
import { supabase } from '../lib/supabase'

// 자동매매 탭 — LOC 분할매수 수동 운영 (자동화 전 단계)
//   탭을 열면: DB(014)에 저장된 사이클 설정 · 날짜별 내역을 바로 표시 (증권사 조회 없이)
//   설정 변경: 자동 저장 (진행 중 사이클)
//   [계산]: 서버가 DB 설정으로 증권사에서 다시 계산 → 날짜별 내역 저장 · 전량 매도면 사이클 종료 → 오늘 주문 (주문 없음)
//   [주문 넣기]: 확인 창 → 서버가 다시 계산해 같을 때만 전송 (LOC_ORDER_ENABLED=1 아니면 시험 모드)
//   화면은 합친 방식만 (018 strategy 'loop' — B 방식 선택 UI 는 없앰, 서버 B 계산은 지난 사이클용으로 남음)
//     가장 싼 묶음 +기준% 매도 · 판 돈 재투자 · 묶음 목록 · 매도 수익 표시
const props = defineProps({ portfolioId: { type: Number, default: null } })
const emit = defineEmits(['toast', 'navigate'])
const lc = useLocCycles(toRef(props, 'portfolioId'))

// 설정은 DB(loc_cycles)에 저장 — 사이클이 없을 때만 아래 빈 기본값으로 시작
//   하루 투자금은 입력하지 않고 총 투자금 ÷ 분할 횟수로 계산, 거래소는 서버가 자동으로 찾음
const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
// 화면은 합친 방식만 (B 방식 선택 UI 없음) — 저장할 때 항상 합친 방식으로
const form = ref({ symbol: '', budget: '', splits: 30, startDate: todayKst, sellPct: 10, exclude: '', strategy: 'loop', lotSellPct: 5, withdrawPct: 50 })
const isLoop = computed(() => true)
const daily = computed(() => {
  const b = Number(String(form.value.budget).replace(/,/g, ''))
  const n = Math.floor(Number(form.value.splits))
  return b > 0 && n > 0 ? Math.floor((b / n) * 100 + 1e-9) / 100 : null
})

// DB 불러오기 → 진행 중 사이클이 있으면 그 설정으로
const ready = ref(false)
// 사이클 설정 접기 — 브라우저에 기억, 처음엔 저장된 사이클이 있으면 접은 상태
const FOLD_KEY = 'stocky-loc-folded'
const folded = ref(localStorage.getItem(FOLD_KEY) === '1')
watch(folded, (v) => localStorage.setItem(FOLD_KEY, v ? '1' : '0'))
watch(() => props.portfolioId, async (id) => {
  if (!id) return
  await lc.load()
  if (lc.active.value) form.value = { ...toForm(lc.active.value), strategy: 'loop' }
  if (localStorage.getItem(FOLD_KEY) === null) folded.value = !!lc.active.value
  ready.value = true
}, { immediate: true })
const ended = computed(() => (!lc.active.value && lc.latest.value?.status === 'ended' ? lc.latest.value : null))

// 설정 자동 저장 (진행 중 사이클이 있을 때, 0.8초 뒤)
const savedAt = ref(null)
const saveError = ref('')
let saveTimer
watch(form, () => {
  if (!ready.value || !lc.active.value) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try { await lc.save(form.value); savedAt.value = new Date(); saveError.value = '' } catch (e) { saveError.value = e.message }
  }, 800)
}, { deep: true })
const timeText = (d) => (d ? new Date(d).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '')

const usd = (v) => (v === null || v === undefined ? '–' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const ymd = (s) => (s ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : '–')
const TAG = { sell: '매도', first: '1일차', avg: '① 평단', low: '② 신저가' }
const md = (s) => (s ? `${s.slice(4, 6)}/${s.slice(6, 8)}` : '')
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${usd(Math.abs(v))}`

const loading = ref(false)
const error = ref('')
const p = ref(null) // 계산 결과
const fetchedAt = ref(null) // 증권사에서 마지막으로 불러온 시각
async function calc({ keepResult = false } = {}) {
  loading.value = true
  error.value = ''
  if (!keepResult) result.value = null
  try {
    const missing = [!String(form.value.symbol).trim() && '종목', !(Number(String(form.value.budget).replace(/,/g, '')) > 0) && '총 투자금', !form.value.startDate && '사이클 시작일'].filter(Boolean)
    if (missing.length) throw new Error(`입력해 주세요: ${missing.join(', ')}`)
    clearTimeout(saveTimer)
    const cycle = await lc.save(form.value) // 설정 저장(처음이면 새 사이클) → 서버는 DB 설정으로 계산
    savedAt.value = new Date()
    p.value = await locPreview(cycle.id)
    fetchedAt.value = new Date()
    lc.daily.value = p.value.history
    if (p.value.ended) { await lc.load(); emit('toast', '전량 매도로 사이클이 끝났어요') }
  } catch (e) {
    error.value = e.message
    p.value = null
  } finally {
    loading.value = false
  }
}

// [새로고침] — 증권사에서 다시 불러와 날짜별 내역만 바꿈 (오늘 주문 · 묶음 · 주문 결과 카드는 안 보임, 주문 없음)
const lastLoop = ref(null) // 새로고침으로 받은 묶음 정보 (★ 다음에 팔 묶음 표시용)
async function refresh() {
  if (!lc.active.value) return
  loading.value = true
  error.value = ''
  try {
    const r = await locPreview(lc.active.value.id)
    lc.daily.value = r.history
    lastLoop.value = r.loop
    fetchedAt.value = new Date()
    p.value = null
    result.value = null
    if (r.ended) { await lc.load(); emit('toast', '전량 매도로 사이클이 끝났어요') }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// 오늘 주문 목록 (표시용)
const rows = computed(() => {
  if (!p.value) return []
  const out = []
  if (p.value.plan.sell) out.push({ tag: 'sell', side: '매도', price: p.value.plan.sell.price, qty: p.value.plan.sell.qty, base: true, lot: p.value.plan.sell.lot })
  for (const b of p.value.plan.buys) b.steps.forEach((s, i) => out.push({ tag: b.tag, side: '매수', price: s.price, qty: s.qty, base: i === 0, amount: i === 0 ? b.amount : null }))
  return out
})
const blocked = computed(() => !p.value || (p.value.live?.length ?? 1) > 0 || (p.value.warnings?.length ?? 1) > 0)

// ===== 주문 넣기 =====
const confirmOpen = ref(false)
const sending = ref(false)
const result = ref(null)
async function send() {
  sending.value = true
  try {
    result.value = await locSubmit(p.value.cycleId, p.value.signature, p.value.calcPrice)
    confirmOpen.value = false
    emit('toast', result.value.dryRun ? '시험 모드 — 주문은 보내지 않았어요' : result.value.complete ? `주문 ${result.value.sent.length}건을 넣었어요` : '일부 주문에 문제가 있어요. 결과를 확인해 주세요')
    if (!result.value.dryRun) await calc({ keepResult: true }) // 오늘 걸린 주문 다시 반영 (결과 표는 유지)
  } catch (e) {
    if (e.status === 409 && e.data?.preview) p.value = { ...e.data.preview, orderEnabled: p.value.orderEnabled }
    confirmOpen.value = false
    error.value = e.message
  } finally {
    sending.value = false
  }
}
// 최근 거래일 주문 결과
const RESULT = { filled: '✅ 체결', partial: '일부 체결', expired: '미체결 (소멸)', cancelled: '취소', rejected: '⛔ 거부' }
const showAll = ref(false) // 취소·거부 주문까지 보기
const lastShown = computed(() => (p.value?.lastOrders || []).filter((o) => showAll.value || !['cancelled', 'rejected'].includes(o.result)))
const lastFilled = computed(() => {
  const f = (p.value?.lastOrders || []).filter((o) => o.filled > 0 && !o.excluded)
  const buy = f.filter((o) => o.side === 'buy')
  const sell = f.filter((o) => o.side === 'sell')
  const sum = (l) => l.reduce((t, o) => t + o.filled, 0)
  const amt = (l) => l.reduce((t, o) => t + o.filled * o.fillPrice, 0)
  return { buyQty: sum(buy), buyAmount: amt(buy), sellQty: sum(sell), sellAmount: amt(sell), price: f[0]?.fillPrice ?? null }
})
const hiddenCount = computed(() => (p.value?.lastOrders || []).length - lastShown.value.length)

// 날짜별 내역: 계산했으면 그 결과, 아니면 DB 에 저장된 내역
const hist = computed(() => (p.value ? p.value.history : lc.daily.value) || [])
const histLow = computed(() => { const c = hist.value.map((x) => x.close).filter((v) => v > 0); return c.length ? Math.min(...c) : null })
// ===== 누적 수익 (내 방식, 판 묶음 수익 합계) — 원화는 매도한 날 환율로 바꿔 더함 =====
//   환율: 새로고침·[계산] 결과의 sellFx → 없으면 fx_daily(날짜별 환율, 서버가 저장) → 없으면 지금 환율(약)
const fxByDate = ref({})  // 'YYYYMMDD' → 원/달러
const fxNow = ref(null)
watch(() => hist.value.filter((e) => e.sellPnl !== undefined && !e.sellFx).map((e) => e.date).join(), async (key) => {
  if (!key) return
  const dates = key.split(',').sort()
  const dash = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  const from = new Date(`${dash(dates[0])}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - 14) // 휴일이면 그 전 영업일 값
  const [{ data }, { data: now }] = await Promise.all([
    supabase.from('fx_daily').select('rate_date, rate').eq('currency', 'USD').gte('rate_date', from.toISOString().slice(0, 10)).lte('rate_date', dash(dates.at(-1))).order('rate_date'),
    supabase.from('exchange_rates').select('rate_to_krw').eq('currency', 'USD').maybeSingle(),
  ])
  fxNow.value = now ? Number(now.rate_to_krw) : null
  const map = { ...fxByDate.value }
  for (const d of dates) { const r = (data || []).filter((x) => x.rate_date <= dash(d)).at(-1); if (r) map[d] = Number(r.rate) }
  fxByDate.value = map
}, { immediate: true })
const cum = computed(() => {
  const out = {}
  let usdSum = 0, krwSum = 0, approx = false
  for (const e of [...hist.value].reverse()) { // 오래된 날부터
    if (e.sellPnl !== undefined) {
      const fx = e.sellFx || fxByDate.value[e.date] || fxNow.value
      if (!e.sellFx && !fxByDate.value[e.date]) approx = true
      usdSum += e.sellPnl; if (fx) krwSum += e.sellPnl * fx
    }
    out[e.date] = usdSum ? { usd: Math.round(usdSum * 100) / 100, krw: Math.round(krwSum), approx } : null
  }
  return out
})
const won = (v) => `${v < 0 ? '-' : '+'}${Math.abs(v).toLocaleString('ko-KR')}원`
const cumNow = computed(() => (hist.value.length ? cum.value[hist.value[0].date] : null)) // 지금까지 누적 (가장 최근 날)

// 합친 방식: 지금 신저가 묶음(다음에 팔 묶음)을 산 날 — [계산] 뒤에만 알 수 있음
// 저장된 날짜별 내역만으로 남은 묶음 계산: 그날 산 수량 − 그날 산 묶음 중 팔린 수량(✓) → 가장 싼 묶음 = 다음 신저가
const histLots = computed(() => hist.value
  .filter((e) => e.buyQty > 0)
  .map((e) => ({ date: e.date, qty: e.buyQty - (e.lotSold || []).reduce((t, x) => t + x.qty, 0), price: e.buyAmount / e.buyQty }))
  .filter((l) => l.qty > 0))
const nextLot = computed(() => {
  const fromCalc = (p.value?.loop || lastLoop.value)?.lots.find((l) => l.next)
  if (fromCalc) return fromCalc
  const l = histLots.value.reduce((a, b) => (!a || b.price < a.price ? b : a), null)
  if (!l) return null
  const price = Math.round(l.price * 10000) / 10000
  return { ...l, price, sellPrice: Math.ceil(price * (1 + Number(form.value.lotSellPct || 5) / 100) * 100 - 1e-9) / 100 }
})
const nextLotDate = computed(() => nextLot.value?.date || null)
// 저장된 내역으로 바로 보여주는 요약 (계산 전)
const savedSum = computed(() => {
  const d = lc.daily.value
  if (!d.length) return null
  const budget = Number(String((ended.value ? toForm(ended.value) : form.value).budget).replace(/,/g, ''))
  const closes = d.map((x) => x.close).filter((v) => v > 0)
  const low = closes.length ? Math.min(...closes) : null
  const sold = d.reduce((t, x) => t + (x.sellAmount || 0), 0)
  const withdrawn = d.reduce((t, x) => t + (x.withdraw || 0), 0)
  const remaining = isLoop.value ? budget - d[0].cumSpent + sold - withdrawn : budget - d[0].cumSpent // 합친 방식은 판 돈이 다시 들어감
  return { qty: d[0].cumQty, spent: d[0].cumSpent, sold, withdrawn, remaining: Math.round(remaining * 100) / 100, budget, low, lowDate: d.find((x) => x.close === low)?.date, lastDate: d[0].date, updatedAt: d[0].updatedAt, days: d.filter((x) => x.buyQty).length }
})

// ===== 새 사이클 시작 =====
const nextOpen = ref(false)
const nextForm = ref(null)
const nextError = ref('')
function nextWeekday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()))
  return d.toISOString().slice(0, 10)
}
function openNext() {
  const c = ended.value
  nextForm.value = { ...toForm(c), strategy: 'loop', budget: '', exclude: '', startDate: nextWeekday(c.ended_on) }
  nextError.value = ''
  nextOpen.value = true
}
async function startNext() {
  const f = nextForm.value
  if (!(Number(String(f.budget).replace(/,/g, '')) > 0)) { nextError.value = '총 투자금을 입력해 주세요'; return }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.startDate)) { nextError.value = '시작일을 골라 주세요'; return }
  try {
    await lc.startNew(f)
    form.value = { ...f }
    p.value = null
    result.value = null
    nextOpen.value = false
    emit('toast', '새 사이클을 시작했어요')
  } catch (e) { nextError.value = e.message }
}

const STATUS = { live: '✅ 살아 있음', rejected: '⛔ 거부', failed: '⛔ 접수 실패', closed: '체결·종료', unknown: '확인 안 됨' }
</script>

<template>
  <!-- 위쪽: 증권사에서 다시 불러오기 (조회만) · 익절 히스토리 -->
  <div class="refresh-bar">
    <p class="refresh-info" aria-live="polite">
      <template v-if="loading">증권사에서 불러오는 중…</template>
      <template v-else-if="fetchedAt">증권사 기준 · {{ timeText(fetchedAt) }} 불러옴</template>
      <template v-else-if="lc.active.value">저장된 내역 기준 · [새로고침]으로 증권사에서 날짜별 내역을 다시 불러와요</template>
    </p>
    <button class="chip-btn" @click="emit('navigate', 'profits')">익절 히스토리 →</button>
    <button v-if="lc.active.value" type="button" class="refresh-btn" :class="{ spinning: loading }" :disabled="loading" @click="refresh">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
      새로고침
    </button>
  </div>
  <section v-if="!ready" class="card" aria-busy="true"><span class="skeleton" style="width: 40%; height: 20px" /><span class="skeleton" style="height: 120px" /></section>

  <!-- 사이클 종료 -->
  <section v-else-if="ended" class="card summary">
    <div class="sum-main">
      <p class="label">{{ ended.symbol }} 사이클 종료 <span class="label-sub">{{ ended.start_date.replaceAll('-', '.') }} ~ {{ ended.ended_on?.replaceAll('-', '.') }}</span></p>
      <p class="total" :class="Number(ended.realized_pnl) >= 0 ? 'up' : 'down'">{{ Number(ended.realized_pnl) >= 0 ? '+' : '' }}{{ usd(ended.realized_pnl) }}</p>
      <p class="total-pl flat">실현 수익 · 매수 {{ usd(ended.bought_amount) }} → 매도 {{ usd(ended.sold_amount) }} ({{ ended.sold_qty }}주)</p>
    </div>
    <div class="sum-side">
      <p class="at-info">자동으로 다시 시작하지 않아요. 총 투자금을 정해서 새 사이클을 시작해 주세요.</p>
      <button class="primary-btn" @click="openNext">새 사이클 시작</button>
    </div>
  </section>

  <!-- 사이클 설정 -->
  <section v-else class="card at-form">
    <button type="button" class="at-toggle" :aria-expanded="!folded" aria-controls="at-settings" @click="folded = !folded">
      <h2>사이클 설정</h2>
      <span class="at-chev" :class="{ open: !folded }" aria-hidden="true">⌄</span>
    </button>
    <p v-if="folded" class="at-folded">
      {{ form.symbol }} · 총 {{ usd(Number(String(form.budget).replace(/,/g, ''))) }} · {{ form.splits }}회 (하루 {{ daily ? usd(daily) : '–' }}) · {{ String(form.startDate).replaceAll('-', '.') }} 시작 · {{ isLoop ? `묶음 매도 ${form.lotSellPct}% · 인출 ${form.withdrawPct}%` : `매도 ${form.sellPct}%` }}
      <template v-if="String(form.exclude).trim()"> · 제외 {{ String(form.exclude).split(/[\s,]+/).filter(Boolean).length }}건</template>
    </p>
    <div v-show="!folded" id="at-settings" class="at-grid">
      <p class="field-hint at-wide">매일 하루 투자금으로 ① 평단 · ② 신저가 계단 매수 → 매도는 가장 싸게 산 묶음만 그 수량만큼 (매수가 +묶음 매도 기준%) · 판 돈은 예산에 다시 넣음 · 사이클이 끝나지 않음</p>
      <label class="field"><span class="field-label">사이클 시작일</span>
        <div class="field-input"><input v-model="form.startDate" type="date"></div></label>
      <label class="field"><span class="field-label">종목 (ticker)</span>
        <div class="field-input"><input v-model="form.symbol" autocomplete="off" placeholder="예: SOXL" @input="form.symbol = form.symbol.toUpperCase()"></div></label>
      <label class="field"><span class="field-label">총 투자금</span>
        <div class="field-input"><input v-model="form.budget" inputmode="decimal" placeholder="예: 60000"><span class="suffix">$</span></div></label>
      <label class="field"><span class="field-label">분할 횟수 <span class="field-hint">하루 투자금 {{ daily ? usd(daily) : '–' }}</span></span>
        <div class="field-input"><input v-model="form.splits" inputmode="numeric"><span class="suffix">회</span></div></label>
      <label class="field"><span class="field-label">묶음 매도 기준 <span class="field-hint">가장 싼 묶음 매수가 +</span></span>
        <div class="field-input"><input v-model="form.lotSellPct" inputmode="decimal"><span class="suffix">%</span></div></label>
      <label class="field"><span class="field-label">인출 비율 <span class="field-hint">전부 매도될 때 수익 중</span></span>
        <div class="field-input"><input v-model="form.withdrawPct" inputmode="decimal"><span class="suffix">%</span></div></label>
      <label class="field at-wide"><span class="field-label">제외할 주문번호 <span class="field-hint">실수 거래 등 — 쉼표로 구분</span></span>
        <div class="field-input"><input v-model="form.exclude" autocomplete="off" placeholder="예: 123456, 123457"></div></label>
    </div>
    <button class="primary-btn" :disabled="loading" @click="calc()">{{ loading ? '증권사에서 불러오는 중…' : '계산' }}</button>
    <p class="at-info">
      <template v-if="saveError">⚠️ {{ saveError }}</template>
      <template v-else-if="lc.active.value">설정은 바꾸면 자동 저장돼요{{ savedAt ? ` · ${timeText(savedAt)} 저장` : '' }}</template>
      <template v-else>처음 [계산]하면 이 설정으로 사이클이 저장돼요</template>
    </p>
    <p v-if="error || lc.error.value" class="form-error" role="alert">{{ error || lc.error.value }}</p>
  </section>

  <!-- 저장된 내역 요약 (계산 전) -->
  <section v-if="ready && !p && savedSum && !ended" class="card summary">
    <div class="sum-main">
      <p class="label">{{ form.symbol }} <span class="label-sub">{{ fetchedAt ? '증권사 기준' : '저장된 내역 기준' }} · {{ ymd(savedSum.lastDate) }}까지</span></p>
      <p class="total">{{ usd(savedSum.remaining) }}</p>
      <p v-if="isLoop" class="total-pl flat">남은 예산 = 총 {{ usd(savedSum.budget) }} − 산 금액 {{ usd(savedSum.spent) }} + 판 금액 {{ usd(savedSum.sold) }}<template v-if="savedSum.withdrawn"> − 인출 {{ usd(savedSum.withdrawn) }}</template></p>
      <p v-else class="total-pl flat">남은 예산 · 총 {{ usd(savedSum.budget) }} 중 {{ usd(savedSum.spent) }} 사용 ({{ savedSum.days }}일)</p>
    </div>
    <div class="sum-side">
      <dl class="rows">
        <div class="row"><dt>누적 보유</dt><dd>{{ savedSum.qty }}주</dd></div>
        <div v-if="isLoop" class="row"><dt>누적 수익 <span class="label-sub">내 방식</span></dt>
          <dd v-if="cumNow"><span :class="cumNow.usd >= 0 ? 'up' : 'down'">{{ signed(cumNow.usd) }}</span> <small class="at-sub">{{ cumNow.approx ? '약 ' : '' }}{{ won(cumNow.krw) }} (매도일 환율)</small></dd>
          <dd v-else>–</dd></div>
        <div v-if="!isLoop" class="row"><dt>신저가 <span class="label-sub">사이클 종가 최저</span></dt><dd>{{ usd(savedSum.low) }} <small class="at-sub">{{ ymd(savedSum.lowDate) }}</small></dd></div>
        <div v-else-if="nextLot" class="row"><dt>신저가 <span class="label-sub">가장 싼 묶음 ★</span></dt><dd>{{ usd(nextLot.price) }} <small class="at-sub">{{ ymd(nextLot.date) }} · {{ nextLot.qty }}주 → 매도 {{ usd(nextLot.sellPrice) }}</small></dd></div>
      </dl>
      <p class="at-info">[새로고침] = 날짜별 내역만 증권사에서 다시 불러와요 · 오늘 주문 · 묶음 · 평단 · 현재가는 [계산]을 누르면 보여요.</p>
    </div>
  </section>

  <template v-if="p">
    <!-- 증권사 값 · 사이클 현황 -->
    <section class="card summary">
      <div class="sum-main">
        <p class="label">{{ p.symbol }} <span class="label-sub">{{ p.name }}</span></p>
        <p class="total">{{ usd(p.remaining) }}</p>
        <p v-if="p.loop" class="total-pl flat">남은 예산 = 총 {{ usd(p.budget) }} − 산 금액 {{ usd(p.spent) }} + 판 금액 {{ usd(p.loop.sold) }}<template v-if="p.loop.withdrawn"> − 인출 {{ usd(p.loop.withdrawn) }}</template> · 하루 {{ usd(p.dailyAmount) }}</p>
        <p v-else class="total-pl flat">남은 예산 · 총 {{ usd(p.budget) }} 중 {{ usd(p.spent) }} 사용 ({{ p.buyDays }}일) · 하루 {{ usd(p.dailyAmount) }}</p>
      </div>
      <div class="sum-side">
        <dl class="rows">
          <div class="row"><dt>보유 · 평단 <span class="label-sub">증권사</span></dt><dd>{{ p.holding.qty }}주 · {{ usd(p.holding.avg) }}</dd></div>
          <div class="row"><dt>신저가 <span class="label-sub">{{ p.loop ? '가장 싼 묶음' : '사이클 종가 최저' }}</span></dt><dd>{{ usd(p.low) }} <small class="at-sub">{{ ymd(p.lowDate) }}</small></dd></div>
          <div v-if="p.loop" class="row"><dt>실현 수익 <span class="label-sub">내 방식 · 판 묶음 합계</span></dt><dd :class="p.loop.realized > 0 ? 'up' : ''">{{ signed(p.loop.realized) }}<small v-if="cumNow" class="at-sub"> {{ cumNow.approx ? '약 ' : '' }}{{ won(cumNow.krw) }}</small><small v-if="p.loop.withdrawn" class="at-sub"> · 인출 {{ usd(p.loop.withdrawn) }}</small></dd></div>
          <div v-if="p.loop && p.loop.sales.length" class="row"><dt>증권사 앱 기준 <span class="label-sub">평단 대비</span></dt><dd :class="p.loop.brokerRealized >= 0 ? 'up' : 'down'">약 {{ signed(p.loop.brokerRealized) }}</dd></div>
          <div class="row"><dt>현재가 · 전일 종가</dt><dd>{{ usd(p.price) }} · {{ usd(p.prevClose) }}</dd></div>
          <div class="row"><dt>매수 상한 <span class="label-sub">현재가 × 1.2</span></dt><dd>{{ usd(Math.round(p.price * 120) / 100) }}</dd></div>
        </dl>
      </div>
    </section>

    <section v-if="p.warnings?.length || p.live?.length || p.excludedFills?.length" class="card at-notes">
      <p v-for="w in p.warnings" :key="w" class="at-warn">⚠️ {{ w }}</p>
      <p v-if="p.live?.length" class="at-warn">⚠️ 오늘 이미 걸린 {{ p.symbol }} 주문이 {{ p.live.length }}건 있어서 [주문 넣기]가 막혀 있어요.</p>
      <p v-if="p.excludedFills.length" class="at-info">제외한 거래: {{ p.excludedFills.map((f) => `#${f.no} ${f.side === 'buy' ? '매수' : '매도'} ${f.qty}주 @${f.price}`).join(', ') }}</p>
    </section>

    <!-- 오늘 주문 -->
    <section class="card list-card">
      <div class="list-head">
        <div class="list-title"><h2>오늘 주문<span>{{ rows.length }}</span></h2></div>
        <div class="list-actions">
          <span class="at-mode" :class="p.orderEnabled ? 'live' : 'dry'">{{ p.orderEnabled ? '🔴 실제 주문 모드' : '시험 모드' }}</span>
          <span class="hint">모두 LOC · 종가에 체결</span>
        </div>
      </div>
      <p v-if="p.plan.exhausted" class="at-info">남은 예산으로 1주도 살 수 없어 매수 주문이 없어요 (매도는 계속).</p>
      <div class="ret-table-wrap"><table class="ret-table at-table">
        <thead><tr><th scope="col">구분</th><th scope="col">LOC 가격</th><th scope="col">수량</th><th scope="col">배정 금액</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i" :class="{ 'at-step': !r.base }">
            <th scope="row">{{ r.base ? TAG[r.tag] : '└ 계단' }}<small v-if="r.lot" class="at-sub"> {{ md(r.lot.date) }} 묶음 @{{ usd(r.lot.price) }}</small></th>
            <td>{{ usd(r.price) }}</td><td>{{ r.qty }}주</td><td>{{ r.amount ? usd(r.amount) : '' }}</td>
          </tr>
        </tbody>
      </table></div>

      <h3 class="at-h3">종가별 예상</h3>
      <div class="ret-table-wrap"><table class="ret-table at-table">
        <thead><tr><th scope="col">종가</th><th scope="col">결과</th><th scope="col">금액</th></tr></thead>
        <tbody>
          <tr v-for="x in p.preview" :key="x.close">
            <th scope="row">{{ usd(x.close) }}<small v-if="x.close === p.price" class="at-sub"> 현재가</small></th>
            <template v-if="p.loop">
              <td>{{ [x.sold ? `묶음 매도 ${x.sellQty}주` : '', x.buyQty ? `매수 ${x.buyQty}주` : ''].filter(Boolean).join(' · ') || '체결 없음' }}</td>
              <td>{{ [x.sold ? `+${usd(x.close * x.sellQty)}` : '', x.buyQty ? `−${usd(x.buyAmount)}` : ''].filter(Boolean).join(' / ') }}</td>
            </template>
            <template v-else>
              <td>{{ x.sold ? `전량 매도 ${p.plan.sell.qty}주` : x.buyQty ? `매수 ${x.buyQty}주` : '체결 없음' }}</td>
              <td>{{ x.sold ? usd(x.close * p.plan.sell.qty) : x.buyQty ? usd(x.buyAmount) : '' }}</td>
            </template>
          </tr>
        </tbody>
      </table></div>

      <button class="primary-btn" :disabled="blocked" @click="confirmOpen = true">주문 넣기{{ p.orderEnabled ? '' : ' (시험 모드)' }}</button>
      <p v-if="p.orderEnabled" class="at-info at-live">실제 주문 모드예요 — [주문 넣기]를 누르면 증권사에 실제 주문이 나가요.</p>
      <p v-else class="at-info">지금은 시험 모드예요 — 서버 환경변수 LOC_ORDER_ENABLED=1 일 때만 실제 주문이 나가요 (Vercel 은 넣은 뒤 Redeploy 필요).</p>
    </section>

    <!-- 합친 방식: 묶음 목록 -->
    <section v-if="p.loop" class="card list-card">
      <div class="list-head">
        <div class="list-title"><h2>묶음<span>{{ p.loop.lots.length }}</span></h2></div>
        <div class="list-actions"><span class="hint">매도는 ★ 묶음만 (가장 싼 매수가 +{{ p.loop.lotSellPct }}%)</span></div>
      </div>
      <p v-if="!p.loop.lots.length" class="at-info">들고 있는 묶음이 없어요 — 다음 거래일에 1일차 규칙으로 다시 사요.</p>
      <div v-else class="ret-table-wrap"><table class="ret-table at-table">
        <thead><tr><th scope="col">매수일</th><th scope="col">수량</th><th scope="col">매수가</th><th scope="col">매도 기준가</th><th scope="col">지금 손익</th></tr></thead>
        <tbody>
          <tr v-for="l in [...p.loop.lots].sort((a, b) => a.price - b.price)" :key="l.date" :class="{ 'at-low': l.next }">
            <th scope="row">{{ l.next ? '★ ' : '' }}{{ ymd(l.date) }}</th>
            <td>{{ l.qty }}주</td><td>{{ usd(l.price) }}</td><td>{{ usd(l.sellPrice) }}</td>
            <td :class="p.price > l.price ? 'up' : 'down'">{{ ((p.price / l.price - 1) * 100).toFixed(1) }}%</td>
          </tr>
        </tbody>
      </table></div>
      <p class="at-info">판 금액 {{ usd(p.loop.sold) }} · 실현 수익 {{ signed(p.loop.realized) }} ({{ p.loop.sales.length }}번)<template v-if="p.loop.withdrawals.length"> · 인출 {{ usd(p.loop.withdrawn) }} ({{ p.loop.withdrawals.length }}번, 직접 출금)</template> · 묶음은 매수가가 싼 순서</p>
    </section>

    <!-- 최근 거래일 주문 결과 -->
    <section v-if="p.lastDate && p.lastOrders" class="card list-card">
      <div class="list-head">
        <div class="list-title"><h2>{{ ymd(p.lastDate) }} 주문 결과</h2></div>
        <div class="list-actions">
          <button v-if="hiddenCount || showAll" class="chip-btn" :class="{ on: showAll }" @click="showAll = !showAll">{{ showAll ? '취소·거부 숨기기' : `취소·거부 ${hiddenCount}건 보기` }}</button>
        </div>
      </div>
      <p class="at-info at-result-sum">
        <template v-if="lastFilled.buyQty">매수 <b>{{ lastFilled.buyQty }}주</b> @ {{ usd(lastFilled.price) }} = <b>{{ usd(lastFilled.buyAmount) }}</b></template>
        <template v-if="lastFilled.sellQty"> · 매도 <b>{{ lastFilled.sellQty }}주</b> = {{ usd(lastFilled.sellAmount) }}</template>
        <template v-if="!lastFilled.buyQty && !lastFilled.sellQty">체결 없음</template>
      </p>
      <div class="ret-table-wrap"><table class="ret-table at-table">
        <thead><tr><th scope="col">주문번호</th><th scope="col">구분</th><th scope="col">LOC</th><th scope="col">수량</th><th scope="col">체결</th><th scope="col">결과</th></tr></thead>
        <tbody>
          <tr v-for="o in lastShown" :key="o.no" :class="{ 'at-step': o.result !== 'filled' && o.result !== 'partial' }">
            <th scope="row">#{{ o.no }}</th>
            <td>{{ o.side === 'buy' ? '매수' : '매도' }}{{ o.type === '5' ? '' : ' (LOC 아님)' }}</td>
            <td>{{ usd(o.price) }}</td><td>{{ o.qty }}주</td>
            <td>{{ o.filled ? `${o.filled}주 @${usd(o.fillPrice)}` : '–' }}</td>
            <td>{{ RESULT[o.result] }}{{ o.excluded ? ' · 제외' : '' }}</td>
          </tr>
        </tbody>
      </table></div>
    </section>

    <!-- 전송 결과 -->
    <section v-if="result" class="card list-card">
      <div class="list-head"><div class="list-title"><h2>{{ result.dryRun ? '시험 모드 — 보낼 주문' : '전송 결과' }}</h2></div></div>
      <div class="ret-table-wrap"><table class="ret-table at-table">
        <thead><tr><th scope="col">구분</th><th scope="col">LOC</th><th scope="col">수량</th><th scope="col">{{ result.dryRun ? '' : '주문번호 · 상태' }}</th></tr></thead>
        <tbody>
          <tr v-for="(o, i) in result.dryRun ? result.list : result.sent" :key="i">
            <th scope="row">{{ TAG[o.tag] }}</th><td>{{ usd(o.price) }}</td><td>{{ o.qty }}주</td>
            <td>{{ result.dryRun ? '' : `#${o.no ?? '-'} · ${STATUS[o.status]}${o.reason ? ' — ' + o.reason : ''}${o.status === 'failed' ? ' — ' + o.message : ''}` }}</td>
          </tr>
        </tbody>
      </table></div>
    </section>
  </template>

  <!-- 날짜별 내역 (DB 저장분 또는 계산 결과) -->
  <section v-if="hist.length" class="card list-card">
    <div class="list-head"><div class="list-title"><h2>날짜별 내역<span>{{ hist.length }}</span></h2></div><div class="list-actions"><span class="hint">{{ ymd(hist.at(-1).date) }}부터</span></div></div>
    <div class="ret-table-wrap"><table class="ret-table at-table">
      <thead><tr><th scope="col">날짜</th><th scope="col">종가</th><th scope="col">매수</th><th scope="col">매수 금액</th><th scope="col">매도</th><th scope="col">수익 <span class="label-sub">내 방식</span></th><th scope="col">누적 보유</th><th scope="col">누적 쓴 금액</th></tr></thead>
      <tbody>
        <template v-for="e in hist" :key="e.date">
        <tr :class="{ 'at-low': e.close === histLow || e.date === nextLotDate }">
          <th scope="row">{{ e.date === nextLotDate ? '★ ' : '' }}{{ ymd(e.date) }}<span v-for="x in e.lotSold || []" :key="x.soldOn" class="at-sold">✓ {{ md(x.soldOn) }} 매도{{ x.qty !== e.buyQty ? ` ${x.qty}주` : '' }}</span></th>
          <td>{{ usd(e.close) }}{{ e.close === histLow ? ' ⬇' : '' }}</td>
          <td>{{ e.buyQty ? `${e.buyQty}주` : '–' }}</td><td>{{ e.buyQty ? usd(e.buyAmount) : '' }}</td>
          <td>{{ e.sellQty ? `${e.sellQty}주 ${usd(e.sellAmount)}` : '–' }}</td>
          <td><template v-if="e.sellPnl !== undefined"><b :class="e.sellPnl >= 0 ? 'up' : 'down'">{{ signed(e.sellPnl) }}</b> <small :class="e.sellPnl >= 0 ? 'up' : 'down'">({{ e.sellPct > 0 ? '+' : '' }}{{ e.sellPct }}%)</small><small v-if="e.withdraw" class="at-sub"> · 인출 가능 {{ usd(e.withdraw) }}</small></template><template v-else>–</template></td>
          <td>{{ e.cumQty }}주</td><td>{{ usd(e.cumSpent) }}</td>
        </tr>
        </template>
      </tbody>
    </table></div>
    <p class="at-info">⬇ = 시작일부터 최저 종가 · ★ = 다음에 팔 묶음을 산 날 · ✓ = 그날 산 묶음이 팔린 날 · 수익 = 판 묶음 매수가 대비 (증권사 앱은 평단 대비라 손실로 보일 수 있음) · 제외한 거래는 빠져 있어요</p>
  </section>


  <BaseSheet :open="confirmOpen" title="주문 넣기" @close="confirmOpen = false">
    <div v-if="p" class="sheet-body">
      <p class="sheet-note">
        <b>{{ p.symbol }}</b> LOC 주문 {{ rows.length }}건을 {{ p.orderEnabled ? '실제로 보내요. 보낸 뒤에는 증권사 앱에서만 취소할 수 있어요.' : '시험 모드로 확인해요 (주문은 나가지 않아요).' }}
        서버가 다시 계산해서 지금 화면과 같을 때만 보내요.
      </p>
      <p class="confirm-text">
        매도 {{ p.plan.sell ? `${usd(p.plan.sell.price)} × ${p.plan.sell.qty}주` : '없음' }}<br>
        매수 배정 {{ usd(p.plan.buys.reduce((t, b) => t + b.amount, 0)) }} (하루 투자금 {{ usd(p.dailyAmount) }} 이하)
      </p>
      <div class="btn-row">
        <button class="secondary-btn" @click="confirmOpen = false">취소</button>
        <button :class="p.orderEnabled ? 'danger-btn' : 'primary-btn'" :disabled="sending" style="margin-top:0" @click="send">{{ sending ? '보내는 중…' : p.orderEnabled ? '실제 주문 보내기' : '시험해 보기' }}</button>
      </div>
    </div>
  </BaseSheet>

  <BaseSheet :open="nextOpen" title="새 사이클 시작" @close="nextOpen = false">
    <form v-if="nextForm" class="sheet-body" novalidate @submit.prevent="startNext">
      <p class="sheet-note">이전 사이클 설정을 채워 뒀어요. 총 투자금은 직접 정해 주세요.</p>
      <label class="field"><span class="field-label">사이클 시작일</span><div class="field-input"><input v-model="nextForm.startDate" type="date"></div></label>
      <label class="field"><span class="field-label">종목 (ticker)</span><div class="field-input"><input v-model="nextForm.symbol" autocomplete="off" @input="nextForm.symbol = nextForm.symbol.toUpperCase()"></div></label>
      <label class="field"><span class="field-label">총 투자금</span><div class="field-input"><input v-model="nextForm.budget" inputmode="decimal" placeholder="직접 입력"><span class="suffix">$</span></div></label>
      <label class="field"><span class="field-label">분할 횟수</span><div class="field-input"><input v-model="nextForm.splits" inputmode="numeric"><span class="suffix">회</span></div></label>
      <label class="field"><span class="field-label">묶음 매도 기준</span><div class="field-input"><input v-model="nextForm.lotSellPct" inputmode="decimal"><span class="suffix">%</span></div></label>
      <p v-if="nextError" class="form-error" role="alert">{{ nextError }}</p>
      <button class="primary-btn" type="submit" style="width:100%">시작</button>
    </form>
  </BaseSheet>
</template>
