<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { fmt } from '../utils/format'

// 배당 그래프: 월별(쌓은 막대) · 연도별(쌓은 막대) · 누적(선)
//   금액 = 세후 원화 환산액(지급일 환율, dividends.amount_krw)
//   색: 국내 = 파랑, 해외 = 주황 — 라이트·다크 각각 팔레트 검사(색약 구분·대비) 통과한 값 (main.css --viz-*)
const props = defineProps({
  dividends: { type: Array, default: () => [] },
  accounts: { type: Array, default: () => [] },
})
const emit = defineEmits(['navigate'])

const view = ref('month') // month | year | cum
const accountId = ref('')  // '' = 전체
const stockKey = ref('')   // '' = 전체, 'KR:005930'
const thisYear = new Date().getFullYear()
const year = ref(thisYear)

// ===== 필터 =====
// 종목 목록: 계좌를 골랐으면 그 계좌로 배당이 들어온 종목만 (배당 많은 순)
const stocks = computed(() => {
  const m = new Map()
  for (const d of props.dividends) {
    if (accountId.value && d.account_id !== Number(accountId.value)) continue
    const k = `${d.market}:${d.symbol}`
    const e = m.get(k) || { key: k, name: d.stock_name, total: 0 }
    e.total += d.amount_krw
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => b.total - a.total)
})
const usedAccounts = computed(() => {
  const ids = new Set(props.dividends.map((d) => d.account_id))
  return props.accounts.filter((a) => ids.has(a.id))
})
const filtered = computed(() =>
  props.dividends.filter((d) =>
    (!accountId.value || d.account_id === Number(accountId.value)) &&
    (!stockKey.value || `${d.market}:${d.symbol}` === stockKey.value)),
)
// 계좌를 바꿨는데 고른 종목이 그 계좌에 없으면 "종목 전체"로
watch([() => props.dividends, () => props.accounts, accountId], () => {
  if (accountId.value && !usedAccounts.value.some((a) => a.id === Number(accountId.value))) accountId.value = ''
  if (stockKey.value && !stocks.value.some((s) => s.key === stockKey.value)) stockKey.value = ''
})

// ===== 집계 =====
const years = computed(() => {
  const ys = props.dividends.map((d) => Number(d.pay_date.slice(0, 4)))
  if (!ys.length) return [thisYear]
  const lo = Math.min(...ys)
  const hi = Math.max(thisYear, ...ys)
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
})
const minYear = computed(() => years.value[0])
const maxYear = computed(() => years.value.at(-1))

// 막대 데이터: [{ label, short, kr, us }]
const bars = computed(() => {
  if (view.value === 'month') {
    const b = Array.from({ length: 12 }, (_, i) => ({ label: `${year.value}년 ${i + 1}월`, short: `${i + 1}`, kr: 0, us: 0 }))
    for (const d of filtered.value) {
      if (Number(d.pay_date.slice(0, 4)) !== year.value) continue
      const m = Number(d.pay_date.slice(5, 7)) - 1
      b[m][d.market === 'US' ? 'us' : 'kr'] += d.amount_krw
    }
    return b
  }
  const b = years.value.map((y) => ({ label: `${y}년`, short: `${String(y).slice(2)}`, y, kr: 0, us: 0 }))
  const idx = Object.fromEntries(b.map((x, i) => [x.y, i]))
  for (const d of filtered.value) {
    const i = idx[Number(d.pay_date.slice(0, 4))]
    if (i !== undefined) b[i][d.market === 'US' ? 'us' : 'kr'] += d.amount_krw
  }
  return b
})

// 누적 선 데이터: 첫 배당 달 ~ 이번 달, [{ label, value }]
const cumPoints = computed(() => {
  const list = filtered.value
  if (!list.length) return []
  const byMonth = {}
  for (const d of list) byMonth[d.pay_date.slice(0, 7)] = (byMonth[d.pay_date.slice(0, 7)] || 0) + d.amount_krw
  const first = Object.keys(byMonth).sort()[0]
  const now = new Date()
  const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const pts = []
  let [y, m] = first.split('-').map(Number)
  let acc = 0
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`
    acc += byMonth[k] || 0
    pts.push({ label: `${y}년 ${m}월`, key: k, value: acc, add: byMonth[k] || 0 })
    if (k >= end) break
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return pts
})

const headline = computed(() => {
  if (view.value === 'month') return { title: `${year.value}년 배당`, value: bars.value.reduce((s, b) => s + b.kr + b.us, 0) }
  const total = filtered.value.reduce((s, d) => s + d.amount_krw, 0)
  return { title: view.value === 'year' ? '연도별 배당 (전체 합계)' : '누적 배당', value: total }
})

// ===== 그리기 (가로 폭은 실제 크기를 재서 글자가 늘어나지 않게) =====
const box = ref(null)
const W = ref(640)
const H = 200
const PAD = { top: 12, right: 8, bottom: 26, left: 44 }
let ro
onMounted(() => {
  ro = new ResizeObserver(([e]) => { W.value = Math.max(260, Math.round(e.contentRect.width)) })
  if (box.value) ro.observe(box.value)
})
// 그래프 영역이 나중에 생기거나(배당 추가·필터 변경) 다시 그려질 때마다 다시 연결
watch(box, (el, old) => {
  if (!ro) return
  if (old) ro.unobserve(old)
  if (el) ro.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())

const plotW = computed(() => W.value - PAD.left - PAD.right)
const plotH = H - PAD.top - PAD.bottom

// 눈금: 1·2·5 × 10^k 로 깔끔하게
const yMax = computed(() => {
  const raw = view.value === 'cum'
    ? Math.max(0, ...cumPoints.value.map((p) => p.value))
    : Math.max(0, ...bars.value.map((b) => b.kr + b.us))
  if (raw <= 0) return 10000
  const step0 = raw / 4
  const p = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 5, 10].map((k) => k * p).find((s) => s >= step0)
  return step * 4
})
const ticks = computed(() => [0, 1, 2, 3, 4].map((i) => (yMax.value / 4) * i))
const yOf = (v) => PAD.top + plotH - (v / yMax.value) * plotH
const short = (v) => {
  if (v >= 1e8) return `${+(v / 1e8).toFixed(1)}억`
  if (v >= 1e4) return `${+(v / 1e4).toFixed(v >= 1e5 ? 0 : 1)}만`
  return fmt(v)
}

// 막대 위치
const slotW = computed(() => plotW.value / Math.max(1, bars.value.length))
const barW = computed(() => Math.max(6, Math.min(28, slotW.value * 0.56)))
const GAP = 2
// 위쪽만 둥근 사각형 (반지름 r) — 아래는 기준선에 붙음
function topRounded(x, y, w, h, r) {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}
const barShapes = computed(() =>
  bars.value.map((b, i) => {
    const cx = PAD.left + slotW.value * i + slotW.value / 2
    const x = cx - barW.value / 2
    const yKr = yOf(b.kr)
    const yTop = yOf(b.kr + b.us)
    const hasUs = b.us > 0
    const krH = PAD.top + plotH - yKr
    const usH = yKr - yTop - (hasUs && b.kr > 0 ? GAP : 0)
    return {
      cx,
      // 국내(아래): 해외가 위에 있으면 위쪽 둥글림 없음
      kr: b.kr > 0 ? (hasUs ? `M${x},${yKr}H${x + barW.value}V${yKr + krH}H${x}Z` : topRounded(x, yKr, barW.value, krH, 4)) : '',
      us: hasUs && usH > 0 ? topRounded(x, yTop, barW.value, usH, 4) : '',
    }
  }),
)
const showLabel = (i) => (view.value === 'month' && W.value < 420 ? i % 2 === 0 : bars.value.length <= 16 || i % Math.ceil(bars.value.length / 12) === 0)

// 누적 선
const cumGeo = computed(() => {
  const p = cumPoints.value
  if (!p.length) return null
  const n = Math.max(1, p.length - 1)
  const xs = p.map((_, i) => PAD.left + (p.length === 1 ? plotW.value / 2 : (plotW.value * i) / n))
  return {
    xs,
    line: p.map((pt, i) => `${xs[i].toFixed(1)},${yOf(pt.value).toFixed(1)}`).join(' '),
    area: `M${xs[0]},${PAD.top + plotH} ` + p.map((pt, i) => `L${xs[i].toFixed(1)},${yOf(pt.value).toFixed(1)}`).join(' ') + ` L${xs.at(-1)},${PAD.top + plotH} Z`,
    labelIdx: p.map((pt, i) => (pt.key.endsWith('-01') || i === 0 ? i : -1)).filter((i) => i >= 0),
  }
})

// ===== 마우스·터치·키보드: 금액 표시 =====
const active = ref(-1)
watch([view, year, accountId, stockKey], () => { active.value = -1 })
const tip = computed(() => {
  const i = active.value
  if (i < 0) return null
  if (view.value === 'cum') {
    const p = cumPoints.value[i]
    if (!p) return null
    return { x: cumGeo.value.xs[i], title: p.label, lines: [['누적', p.value], ['이번 달', p.add]] }
  }
  const b = bars.value[i]
  if (!b) return null
  return { x: barShapes.value[i].cx, title: b.label, lines: [['합계', b.kr + b.us], ['국내', b.kr], ['해외', b.us]] }
})
function onCumMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * W.value
  const xs = cumGeo.value?.xs || []
  let best = -1
  let bestD = Infinity
  xs.forEach((v, i) => { const d = Math.abs(v - x); if (d < bestD) { bestD = d; best = i } })
  active.value = best
}
function onKey(e) {
  const n = view.value === 'cum' ? cumPoints.value.length : bars.value.length
  if (!n) return
  if (e.key === 'ArrowRight') { active.value = Math.min(n - 1, active.value + 1); e.preventDefault() }
  if (e.key === 'ArrowLeft') { active.value = Math.max(0, active.value < 0 ? n - 1 : active.value - 1); e.preventDefault() }
  if (e.key === 'Escape') active.value = -1
}
</script>

<template>
  <section class="card div-chart">
    <div class="div-chart-head">
      <h2>배당</h2>
      <div class="view-toggle" role="radiogroup" aria-label="그래프 보기">
        <button
          v-for="o in [{ v: 'month', t: '월별' }, { v: 'year', t: '연도별' }, { v: 'cum', t: '누적' }]"
          :key="o.v" type="button" role="radio" :aria-checked="view === o.v" :class="{ on: view === o.v }" @click="view = o.v"
        >{{ o.t }}</button>
      </div>
    </div>

    <!-- 배당 내역 없음 -->
    <div v-if="!dividends.length" class="state">
      <strong>아직 배당 내역이 없어요</strong>
      배당 탭에서 받은 배당을 기록하면 그래프로 보여드려요
      <div><button class="retry" @click="emit('navigate', 'dividends')">배당 기록하러 가기</button></div>
    </div>

    <template v-else>
      <!-- 필터 (그래프 위 한 줄) -->
      <div class="chart-filters">
        <label class="chart-select">
          <span class="sr-only">계좌</span>
          <select v-model="accountId" aria-label="계좌 필터">
            <option value="">계좌 전체</option>
            <option v-for="a in usedAccounts" :key="a.id" :value="String(a.id)">{{ a.name }}</option>
          </select>
        </label>
        <label class="chart-select">
          <span class="sr-only">종목</span>
          <select v-model="stockKey" aria-label="종목 필터">
            <option value="">종목 전체</option>
            <option v-for="s in stocks" :key="s.key" :value="s.key">{{ s.name }}</option>
          </select>
        </label>
      </div>

      <div class="chart-headline">
        <div>
          <p class="chart-title">{{ headline.title }}</p>
          <p class="chart-total">{{ fmt(headline.value) }}원</p>
        </div>
        <div v-if="view === 'month'" class="year-nav" role="group" aria-label="연도 선택">
          <button type="button" :disabled="year <= minYear" aria-label="이전 연도" @click="year--">‹</button>
          <span>{{ year }}</span>
          <button type="button" :disabled="year >= maxYear" aria-label="다음 연도" @click="year++">›</button>
        </div>
        <div v-else-if="view !== 'cum'" class="chart-legend" aria-hidden="true">
          <span><i class="sw kr" />국내</span><span><i class="sw us" />해외</span>
        </div>
      </div>
      <div v-if="view === 'month'" class="chart-legend chart-legend-row" aria-hidden="true">
        <span><i class="sw kr" />국내</span><span><i class="sw us" />해외</span>
      </div>

      <p v-if="!filtered.length" class="state">선택한 조건의 배당이 없어요</p>

      <div v-else ref="box" class="chart-box" tabindex="0" :aria-label="`${headline.title} 그래프 — 좌우 화살표로 항목 이동`" @keydown="onKey" @mouseleave="active = -1">
        <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="chart-svg" aria-hidden="true">
          <!-- 눈금선 · 금액 축 -->
          <g class="grid">
            <template v-for="t in ticks" :key="t">
              <line :x1="PAD.left" :x2="W - PAD.right" :y1="yOf(t)" :y2="yOf(t)" :class="{ base: t === 0 }" />
              <text :x="PAD.left - 6" :y="yOf(t) + 4" text-anchor="end">{{ short(t) }}</text>
            </template>
          </g>

          <!-- 막대 (월별 · 연도별) -->
          <g v-if="view !== 'cum'">
            <g v-for="(s, i) in barShapes" :key="i" :class="{ dim: active >= 0 && active !== i }">
              <path v-if="s.kr" :d="s.kr" class="bar-kr" />
              <path v-if="s.us" :d="s.us" class="bar-us" />
              <text v-if="showLabel(i)" :x="s.cx" :y="H - 8" text-anchor="middle" class="x-label">{{ bars[i].short }}</text>
              <!-- 누르기 쉬운 넓은 영역 -->
              <rect :x="s.cx - slotW / 2" :y="PAD.top" :width="slotW" :height="plotH" class="hit"
                    @mouseenter="active = i" @click="active = active === i ? -1 : i" />
            </g>
          </g>

          <!-- 누적 선 -->
          <g v-else-if="cumGeo">
            <path :d="cumGeo.area" class="cum-area" />
            <polyline :points="cumGeo.line" class="cum-line" />
            <text v-for="i in cumGeo.labelIdx" :key="i" :x="cumGeo.xs[i]" :y="H - 8" text-anchor="middle" class="x-label">
              {{ i === 0 ? `${cumPoints[i].key.slice(0, 4)}.${Number(cumPoints[i].key.slice(5))}` : cumPoints[i].key.slice(0, 4) }}
            </text>
            <template v-if="active >= 0 && cumPoints[active]">
              <line :x1="cumGeo.xs[active]" :x2="cumGeo.xs[active]" :y1="PAD.top" :y2="PAD.top + plotH" class="crosshair" />
              <circle :cx="cumGeo.xs[active]" :cy="yOf(cumPoints[active].value)" r="5" class="cum-dot" />
            </template>
            <rect :x="PAD.left" :y="PAD.top" :width="plotW" :height="plotH" class="hit" @mousemove="onCumMove" @click="onCumMove" />
          </g>
        </svg>

        <!-- 금액 표시 (글자는 글자 색, 색 점은 구분용) -->
        <div v-if="tip" class="chart-tip" :style="{ left: `${Math.min(Math.max(tip.x, 70), W - 70)}px` }" role="status">
          <b>{{ tip.title }}</b>
          <span v-for="[k, v] in tip.lines" :key="k" class="tip-line">
            <i v-if="k === '국내'" class="sw kr" /><i v-else-if="k === '해외'" class="sw us" />
            {{ k }} <em>{{ fmt(v) }}원</em>
          </span>
        </div>
      </div>

      <!-- 화면 읽기 프로그램용 표 -->
      <table class="sr-only">
        <caption>{{ headline.title }}</caption>
        <thead v-if="view !== 'cum'"><tr><th>기간</th><th>국내</th><th>해외</th><th>합계</th></tr></thead>
        <thead v-else><tr><th>월</th><th>그달 배당</th><th>누적</th></tr></thead>
        <tbody v-if="view !== 'cum'">
          <tr v-for="b in bars" :key="b.label"><td>{{ b.label }}</td><td>{{ fmt(b.kr) }}원</td><td>{{ fmt(b.us) }}원</td><td>{{ fmt(b.kr + b.us) }}원</td></tr>
        </tbody>
        <tbody v-else>
          <tr v-for="p in cumPoints" :key="p.key"><td>{{ p.label }}</td><td>{{ fmt(p.add) }}원</td><td>{{ fmt(p.value) }}원</td></tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
