<script setup>
import { ref, computed, watch, toRef } from 'vue'
import BaseSheet from './BaseSheet.vue'
import { locPreview, locSubmit } from '../lib/api'
import { useLocCycles, toForm } from '../composables/useLocCycles'

// 자동매매 탭 — LOC 분할매수 수동 운영 (자동화 전 단계)
//   탭을 열면: DB(014)에 저장된 사이클 설정 · 날짜별 내역을 바로 표시 (증권사 조회 없이)
//   설정 변경: 자동 저장 (진행 중 사이클)
//   [계산]: 서버가 DB 설정으로 증권사에서 다시 계산 → 날짜별 내역 저장 · 전량 매도면 사이클 종료 → 오늘 주문 (주문 없음)
//   [주문 넣기]: 확인 창 → 서버가 다시 계산해 같을 때만 전송 (LOC_ORDER_ENABLED=1 아니면 시험 모드)
const props = defineProps({ portfolioId: { type: Number, default: null } })
const emit = defineEmits(['toast', 'navigate'])
const lc = useLocCycles(toRef(props, 'portfolioId'))

// 설정은 DB(loc_cycles)에 저장 — 사이클이 없을 때만 아래 빈 기본값으로 시작
//   하루 투자금은 입력하지 않고 총 투자금 ÷ 분할 횟수로 계산, 거래소는 서버가 자동으로 찾음
const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
const form = ref({ symbol: '', budget: '', splits: 30, startDate: todayKst, sellPct: 10, exclude: '' })
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
  if (lc.active.value) form.value = toForm(lc.active.value)
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

const loading = ref(false)
const error = ref('')
const p = ref(null) // 계산 결과
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
    lc.daily.value = p.value.history
    if (p.value.ended) { await lc.load(); emit('toast', '전량 매도로 사이클이 끝났어요') }
  } catch (e) {
    error.value = e.message
    p.value = null
  } finally {
    loading.value = false
  }
}

// 오늘 주문 목록 (표시용)
const rows = computed(() => {
  if (!p.value) return []
  const out = []
  if (p.value.plan.sell) out.push({ tag: 'sell', side: '매도', price: p.value.plan.sell.price, qty: p.value.plan.sell.qty, base: true })
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
    result.value = await locSubmit(p.value.cycleId, p.value.signature)
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
// 저장된 내역으로 바로 보여주는 요약 (계산 전)
const savedSum = computed(() => {
  const d = lc.daily.value
  if (!d.length) return null
  const budget = Number(String((ended.value ? toForm(ended.value) : form.value).budget).replace(/,/g, ''))
  const closes = d.map((x) => x.close).filter((v) => v > 0)
  const low = closes.length ? Math.min(...closes) : null
  return { qty: d[0].cumQty, spent: d[0].cumSpent, remaining: Math.round((budget - d[0].cumSpent) * 100) / 100, budget, low, lowDate: d.find((x) => x.close === low)?.date, lastDate: d[0].date, updatedAt: d[0].updatedAt, days: d.filter((x) => x.buyQty).length }
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
  nextForm.value = { ...toForm(c), budget: '', exclude: '', startDate: nextWeekday(c.ended_on) }
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
  <div class="ph-link"><button class="chip-btn" @click="emit('navigate', 'profits')">익절 히스토리 →</button></div>
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
      {{ form.symbol }} · 총 {{ usd(Number(String(form.budget).replace(/,/g, ''))) }} · {{ form.splits }}회 (하루 {{ daily ? usd(daily) : '–' }}) · {{ String(form.startDate).replaceAll('-', '.') }} 시작 · 매도 {{ form.sellPct }}%
      <template v-if="String(form.exclude).trim()"> · 제외 {{ String(form.exclude).split(/[\s,]+/).filter(Boolean).length }}건</template>
    </p>
    <div v-show="!folded" id="at-settings" class="at-grid">
      <label class="field"><span class="field-label">사이클 시작일</span>
        <div class="field-input"><input v-model="form.startDate" type="date"></div></label>
      <label class="field"><span class="field-label">종목 (ticker)</span>
        <div class="field-input"><input v-model="form.symbol" autocomplete="off" placeholder="예: SOXL" @input="form.symbol = form.symbol.toUpperCase()"></div></label>
      <label class="field"><span class="field-label">총 투자금</span>
        <div class="field-input"><input v-model="form.budget" inputmode="decimal" placeholder="예: 60000"><span class="suffix">$</span></div></label>
      <label class="field"><span class="field-label">분할 횟수 <span class="field-hint">하루 투자금 {{ daily ? usd(daily) : '–' }}</span></span>
        <div class="field-input"><input v-model="form.splits" inputmode="numeric"><span class="suffix">회</span></div></label>
      <label class="field"><span class="field-label">매도 기준</span>
        <div class="field-input"><input v-model="form.sellPct" inputmode="decimal"><span class="suffix">%</span></div></label>
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
      <p class="label">{{ form.symbol }} <span class="label-sub">저장된 내역 기준 · {{ ymd(savedSum.lastDate) }}까지</span></p>
      <p class="total">{{ usd(savedSum.remaining) }}</p>
      <p class="total-pl flat">남은 예산 · 총 {{ usd(savedSum.budget) }} 중 {{ usd(savedSum.spent) }} 사용 ({{ savedSum.days }}일)</p>
    </div>
    <div class="sum-side">
      <dl class="rows">
        <div class="row"><dt>누적 보유</dt><dd>{{ savedSum.qty }}주</dd></div>
        <div class="row"><dt>신저가 <span class="label-sub">사이클 종가 최저</span></dt><dd>{{ usd(savedSum.low) }} <small class="at-sub">{{ ymd(savedSum.lowDate) }}</small></dd></div>
      </dl>
      <p class="at-info">오늘 주문·평단·현재가는 [계산]을 누르면 증권사에서 불러와요.</p>
    </div>
  </section>

  <template v-if="p">
    <!-- 증권사 값 · 사이클 현황 -->
    <section class="card summary">
      <div class="sum-main">
        <p class="label">{{ p.symbol }} <span class="label-sub">{{ p.name }}</span></p>
        <p class="total">{{ usd(p.remaining) }}</p>
        <p class="total-pl flat">남은 예산 · 총 {{ usd(p.budget) }} 중 {{ usd(p.spent) }} 사용 ({{ p.buyDays }}일) · 하루 {{ usd(p.dailyAmount) }}</p>
      </div>
      <div class="sum-side">
        <dl class="rows">
          <div class="row"><dt>보유 · 평단 <span class="label-sub">증권사</span></dt><dd>{{ p.holding.qty }}주 · {{ usd(p.holding.avg) }}</dd></div>
          <div class="row"><dt>신저가 <span class="label-sub">사이클 종가 최저</span></dt><dd>{{ usd(p.low) }} <small class="at-sub">{{ ymd(p.lowDate) }}</small></dd></div>
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
            <th scope="row">{{ r.base ? TAG[r.tag] : '└ 계단' }}</th>
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
            <td>{{ x.sold ? `전량 매도 ${p.plan.sell.qty}주` : x.buyQty ? `매수 ${x.buyQty}주` : '체결 없음' }}</td>
            <td>{{ x.sold ? usd(x.close * p.plan.sell.qty) : x.buyQty ? usd(x.buyAmount) : '' }}</td>
          </tr>
        </tbody>
      </table></div>

      <button class="primary-btn" :disabled="blocked" @click="confirmOpen = true">주문 넣기{{ p.orderEnabled ? '' : ' (시험 모드)' }}</button>
      <p v-if="p.orderEnabled" class="at-info at-live">실제 주문 모드예요 — [주문 넣기]를 누르면 증권사에 실제 주문이 나가요.</p>
      <p v-else class="at-info">지금은 시험 모드예요 — 서버 환경변수 LOC_ORDER_ENABLED=1 일 때만 실제 주문이 나가요 (Vercel 은 넣은 뒤 Redeploy 필요).</p>
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
      <thead><tr><th scope="col">날짜</th><th scope="col">종가</th><th scope="col">매수</th><th scope="col">매수 금액</th><th scope="col">매도</th><th scope="col">누적 보유</th><th scope="col">누적 쓴 금액</th></tr></thead>
      <tbody>
        <tr v-for="e in hist" :key="e.date" :class="{ 'at-low': e.close === histLow }">
          <th scope="row">{{ ymd(e.date) }}</th>
          <td>{{ usd(e.close) }}{{ e.close === histLow ? ' ⬇' : '' }}</td>
          <td>{{ e.buyQty ? `${e.buyQty}주` : '–' }}</td><td>{{ e.buyQty ? usd(e.buyAmount) : '' }}</td>
          <td>{{ e.sellQty ? `${e.sellQty}주 ${usd(e.sellAmount)}` : '–' }}</td>
          <td>{{ e.cumQty }}주</td><td>{{ usd(e.cumSpent) }}</td>
        </tr>
      </tbody>
    </table></div>
    <p class="at-info">⬇ = 사이클 신저가 · 제외한 거래는 빠져 있어요</p>
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
      <label class="field"><span class="field-label">매도 기준</span><div class="field-input"><input v-model="nextForm.sellPct" inputmode="decimal"><span class="suffix">%</span></div></label>
      <p v-if="nextError" class="form-error" role="alert">{{ nextError }}</p>
      <button class="primary-btn" type="submit" style="width:100%">시작</button>
    </form>
  </BaseSheet>
</template>
