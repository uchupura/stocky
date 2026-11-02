<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { fmt, signed, pctText } from '../utils/format'

// 수익률 그래프: 월별(0 기준 위·아래 막대) · 누적(선)
//   색: 오르면 빨강(--up), 내리면 파랑(--down) — 라이트·다크 팔레트 검사 통과, 위/아래 방향으로도 구분
//   months = computeReturns().months
const props = defineProps({
  months: { type: Array, default: () => [] },
})

const view = ref('month') // month | cum
const years = computed(() => {
  const ys = [...new Set(props.months.map((m) => m.year))]
  return ys.length ? ys : [new Date().getFullYear()]
})
const year = ref(years.value.at(-1))
watch(years, (ys) => { if (!ys.includes(year.value)) year.value = ys.at(-1) })

// 월별: 선택한 연도 1~12월
const bars = computed(() => {
  const byKey = Object.fromEntries(props.months.map((m) => [m.key, m]))
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year.value}-${String(i + 1).padStart(2, '0')}`
    const m = byKey[key]
    return { key, label: `${year.value}년 ${i + 1}월`, short: `${i + 1}`, rate: m?.rate ?? null, m }
  })
})
// 누적: 누적 수익률(누적 입금액 대비) — 기록 있는 달만 (기록 없는 달은 건너뜀)
const cumPoints = computed(() =>
  props.months.filter((m) => m.cumRate !== null).map((m) => ({ key: m.key, label: `${m.year}년 ${m.month}월`, value: m.cumRate, m })))

// 제목 숫자: 월별 = 그 해 월 수익 합계(원), 누적 = 마지막 누적 수익률
const headline = computed(() => {
  if (view.value === 'month') {
    const ms = bars.value.filter((b) => b.m?.profit != null)
    const sum = ms.reduce((acc, b) => acc + b.m.profit, 0)
    return { title: `${year.value}년 수익`, value: ms.length ? sum : null, text: ms.length ? `${signed(sum)}원` : '–' }
  }
  const v = cumPoints.value.at(-1)?.value ?? null
  return { title: '누적 수익률', value: v, text: pctText(v) }
})

// ===== 그리기 =====
const box = ref(null)
const W = ref(640)
const H = 200
const PAD = { top: 12, right: 8, bottom: 26, left: 48 }
let ro
onMounted(() => {
  ro = new ResizeObserver(([e]) => { W.value = Math.max(260, Math.round(e.contentRect.width)) })
  if (box.value) ro.observe(box.value)
})
watch(box, (el, old) => {
  if (!ro) return
  if (old) ro.unobserve(old)
  if (el) ro.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())

const plotW = computed(() => W.value - PAD.left - PAD.right)
const plotH = H - PAD.top - PAD.bottom

// 눈금: 0 을 포함하는 깔끔한 범위 (1·2·5 × 10^k)
const scale = computed(() => {
  const vals = view.value === 'cum' ? cumPoints.value.map((p) => p.value) : bars.value.map((b) => b.rate)
  const nums = vals.filter((v) => v !== null && Number.isFinite(v))
  let lo = Math.min(0, ...nums)
  let hi = Math.max(0, ...nums)
  if (hi - lo < 1e-9) { lo = -0.01; hi = 0.01 }
  const step0 = (hi - lo) / 4
  const p = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 5, 10].map((k) => k * p).find((s) => s >= step0)
  const min = Math.floor(lo / step + 1e-9) * step
  const max = Math.ceil(hi / step - 1e-9) * step
  const ticks = []
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v)
  return { min, max, ticks, step }
})
const yOf = (v) => PAD.top + plotH - ((v - scale.value.min) / (scale.value.max - scale.value.min)) * plotH
const y0 = computed(() => yOf(0))
const tickText = (v) => {
  const pct = v * 100
  const d = scale.value.step * 100 < 1 ? 1 : 0
  return `${pct > 0 ? '+' : ''}${pct.toFixed(d)}%`
}

// 막대: 0 기준선에서 위(+) · 아래(−), 바깥쪽 끝만 둥글게
const slotW = computed(() => plotW.value / 12)
const barW = computed(() => Math.max(6, Math.min(28, slotW.value * 0.56)))
function bar(x, w, yFrom, yTo, r) {
  const h = Math.abs(yTo - yFrom)
  if (h < 0.5) return `M${x},${yFrom - 0.5}H${x + w}V${yFrom + 0.5}H${x}Z` // 0% 는 얇은 선
  const rr = Math.min(r, w / 2, h)
  if (yTo < yFrom) { // 위로 (+)
    return `M${x},${yFrom}V${yTo + rr}Q${x},${yTo} ${x + rr},${yTo}H${x + w - rr}Q${x + w},${yTo} ${x + w},${yTo + rr}V${yFrom}Z`
  }
  return `M${x},${yFrom}V${yTo - rr}Q${x},${yTo} ${x + rr},${yTo}H${x + w - rr}Q${x + w},${yTo} ${x + w},${yTo - rr}V${yFrom}Z`
}
const barShapes = computed(() =>
  bars.value.map((b, i) => {
    const cx = PAD.left + slotW.value * i + slotW.value / 2
    if (b.rate === null) return { cx, d: '', cls: '' }
    return {
      cx,
      d: bar(cx - barW.value / 2, barW.value, y0.value, yOf(b.rate), 4),
      cls: b.rate > 0 ? 'bar-up' : b.rate < 0 ? 'bar-down' : 'bar-flat',
    }
  }),
)
const showLabel = (i) => (W.value < 420 ? i % 2 === 0 : true)

// 누적 선: 0 위는 빨강, 아래는 파랑 (같은 선을 위·아래로 잘라서 두 번 그림)
const uid = `rc${Math.random().toString(36).slice(2, 8)}`
const cumGeo = computed(() => {
  const p = cumPoints.value
  if (!p.length) return null
  const n = Math.max(1, p.length - 1)
  const xs = p.map((_, i) => PAD.left + (p.length === 1 ? plotW.value / 2 : (plotW.value * i) / n))
  const pts = p.map((pt, i) => `${xs[i].toFixed(1)},${yOf(pt.value).toFixed(1)}`)
  return {
    xs,
    line: pts.join(' '),
    area: `M${xs[0]},${y0.value} L${pts.join(' L')} L${xs.at(-1)},${y0.value} Z`,
    // 1월 · 첫 달만 글자 (좁으면 덜)
    labelIdx: p.map((pt, i) => (i === 0 || pt.key.endsWith('-01') ? i : -1)).filter((i) => i >= 0),
  }
})

// ===== 마우스·터치·키보드 =====
const active = ref(-1)
watch([view, year], () => { active.value = -1 })
const tip = computed(() => {
  const i = active.value
  if (i < 0) return null
  const src = view.value === 'cum' ? cumPoints.value[i] : bars.value[i]
  if (!src) return null
  const m = src.m
  const x = view.value === 'cum' ? cumGeo.value.xs[i] : barShapes.value[i].cx
  if (!m) return { x, title: src.label, lines: [['', '기록 없음']] }
  const lines = []
  if (view.value === 'cum') {
    lines.push(['누적 수익률', pctText(m.cumRate)])
    lines.push(['누적 수익', `${signed(m.cumProfit)}원`])
    lines.push(['누적 입금액', `${fmt(m.cumNet)}원`])
  } else {
    lines.push(['월 수익률', m.rate === null ? (m.profit === null ? '기록 없음' : '계산 불가') : pctText(m.rate)])
    if (m.profit !== null) lines.push(['월 수익', `${signed(m.profit)}원`])
    if (m.net) lines.push(['월 입금액', `${signed(m.net)}원`])
  }
  if (m.endValue !== null) lines.push([m.live ? '지금 계좌 총액' : '계좌 총액', `${fmt(m.endValue)}원`])
  return { x, title: m.live ? `${src.label} (진행 중)` : src.label, lines }
})
function onCumMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = PAD.left + ((e.clientX - rect.left) / rect.width) * plotW.value
  const xs = cumGeo.value?.xs || []
  let best = -1
  let bestD = Infinity
  xs.forEach((v, i) => { const d = Math.abs(v - x); if (d < bestD) { bestD = d; best = i } })
  active.value = best
}
function onKey(e) {
  const n = view.value === 'cum' ? cumPoints.value.length : 12
  if (e.key === 'ArrowRight') { active.value = Math.min(n - 1, active.value + 1); e.preventDefault() }
  if (e.key === 'ArrowLeft') { active.value = Math.max(0, active.value < 0 ? n - 1 : active.value - 1); e.preventDefault() }
  if (e.key === 'Escape') active.value = -1
}
const toneOf = (r) => (r > 0 ? 'up' : r < 0 ? 'down' : 'flat')
</script>

<template>
  <section class="card div-chart">
    <div class="div-chart-head">
      <h2>수익률 그래프</h2>
      <div class="view-toggle" role="radiogroup" aria-label="그래프 보기">
        <button
          v-for="o in [{ v: 'month', t: '월별' }, { v: 'cum', t: '누적' }]"
          :key="o.v" type="button" role="radio" :aria-checked="view === o.v" :class="{ on: view === o.v }" @click="view = o.v"
        >{{ o.t }}</button>
      </div>
    </div>

    <div class="chart-headline">
      <div>
        <p class="chart-title">{{ headline.title }}</p>
        <p class="chart-total" :class="toneOf(headline.value)">{{ headline.text }}</p>
      </div>
      <div v-if="view === 'month'" class="year-nav" role="group" aria-label="연도 선택">
        <button type="button" :disabled="year <= years[0]" aria-label="이전 연도" @click="year--">‹</button>
        <span>{{ year }}</span>
        <button type="button" :disabled="year >= years.at(-1)" aria-label="다음 연도" @click="year++">›</button>
      </div>
    </div>
    <div class="chart-legend chart-legend-row" aria-hidden="true">
      <span><i class="sw up" />수익</span><span><i class="sw down" />손실</span>
    </div>

    <div ref="box" class="chart-box" tabindex="0" :aria-label="`${headline.title} 그래프 — 좌우 화살표로 항목 이동`" @keydown="onKey" @mouseleave="active = -1">
      <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="chart-svg" aria-hidden="true">
        <defs>
          <clipPath :id="`${uid}-pos`"><rect :x="0" :y="0" :width="W" :height="y0" /></clipPath>
          <clipPath :id="`${uid}-neg`"><rect :x="0" :y="y0" :width="W" :height="Math.max(0, H - y0)" /></clipPath>
        </defs>
        <g class="grid">
          <template v-for="t in scale.ticks" :key="t">
            <line :x1="PAD.left" :x2="W - PAD.right" :y1="yOf(t)" :y2="yOf(t)" :class="{ base: t === 0 }" />
            <text :x="PAD.left - 6" :y="yOf(t) + 4" text-anchor="end">{{ tickText(t) }}</text>
          </template>
        </g>

        <g v-if="view === 'month'">
          <g v-for="(s, i) in barShapes" :key="i" :class="{ dim: active >= 0 && active !== i }">
            <path v-if="s.d" :d="s.d" :class="[s.cls, { live: bars[i].m?.live }]" />
            <text v-if="showLabel(i)" :x="s.cx" :y="H - 8" text-anchor="middle" class="x-label">{{ bars[i].short }}</text>
            <rect :x="s.cx - slotW / 2" :y="PAD.top" :width="slotW" :height="plotH" class="hit"
                  @mouseenter="active = i" @click="active = active === i ? -1 : i" />
          </g>
        </g>

        <g v-else-if="cumGeo">
          <path :d="cumGeo.area" class="ret-area-up" :clip-path="`url(#${uid}-pos)`" />
          <path :d="cumGeo.area" class="ret-area-down" :clip-path="`url(#${uid}-neg)`" />
          <polyline :points="cumGeo.line" class="ret-line up" :clip-path="`url(#${uid}-pos)`" />
          <polyline :points="cumGeo.line" class="ret-line down" :clip-path="`url(#${uid}-neg)`" />
          <text v-for="i in cumGeo.labelIdx" :key="i" :x="cumGeo.xs[i]" :y="H - 8" text-anchor="middle" class="x-label">
            {{ i === 0 ? `${cumPoints[i].key.slice(0, 4)}.${Number(cumPoints[i].key.slice(5))}` : cumPoints[i].key.slice(0, 4) }}
          </text>
          <template v-if="active >= 0 && cumPoints[active]">
            <line :x1="cumGeo.xs[active]" :x2="cumGeo.xs[active]" :y1="PAD.top" :y2="PAD.top + plotH" class="crosshair" />
            <circle :cx="cumGeo.xs[active]" :cy="yOf(cumPoints[active].value)" r="5" class="ret-dot" :class="toneOf(cumPoints[active].value)" />
          </template>
          <rect :x="PAD.left" :y="PAD.top" :width="plotW" :height="plotH" class="hit" @mousemove="onCumMove" @click="onCumMove" />
        </g>
      </svg>

      <div v-if="tip" class="chart-tip" :style="{ left: `${Math.min(Math.max(tip.x, 80), W - 80)}px` }" role="status">
        <b>{{ tip.title }}</b>
        <span v-for="[k, v] in tip.lines" :key="k" class="tip-line">{{ k }} <em>{{ v }}</em></span>
      </div>
    </div>

    <div class="sr-only">
      <table>
        <caption>{{ headline.title }}</caption>
        <thead><tr><th>월</th><th>월 수익</th><th>월 수익률</th><th>누적 수익률</th></tr></thead>
        <tbody>
          <tr v-for="m in months" :key="m.key"><td>{{ m.year }}년 {{ m.month }}월</td><td>{{ m.profit === null ? '–' : `${signed(m.profit)}원` }}</td><td>{{ pctText(m.rate) }}</td><td>{{ pctText(m.cumRate) }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
