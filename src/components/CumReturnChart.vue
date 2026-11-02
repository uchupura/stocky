<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { fmt, signed, pctText } from '../utils/format'
import { monthEnd } from '../utils/returns'
import { todayKST } from '../composables/useDeposits'

// 홈 — 계좌 현황 그래프: 누적 입금액(파랑 선) + 계좌 총액(빨강 선), 둘 다 원 → 세로축 하나
//   두 선 사이 간격 = 누적 수익 (금액·수익률은 제목 줄·툴팁에)
//   모양은 수익률 탭의 누적 그래프와 같게 (선 + 옅은 면, 마우스 위치의 세로선 · 점)
//   누적 입금액 = 그 달 말(이번 달은 오늘)까지 입금 − 출금
//   계좌 총액   = 그 달 마지막 총 자산 기록 (기록 없는 달은 점선으로 건너뜀, 이번 달은 지금 총 자산)
//   색: 파랑 #3182f6 · 빨강 #f04452 — 라이트·다크 팔레트 검사(색약 구분·대비) 통과
const props = defineProps({
  months: { type: Array, default: () => [] },   // computeReturns().months
  deposits: { type: Array, default: () => [] }, // [{ txn_date, kind, amount }]
})
const emit = defineEmits(['navigate'])

const today = todayKST()
const flows = computed(() => props.deposits.map((d) => ({ date: d.txn_date, amount: (d.kind === 'withdraw' ? -1 : 1) * Number(d.amount) })))
const cumDeposit = (date) => flows.value.reduce((t, f) => (f.date <= date ? t + f.amount : t), 0)

// 점: [{ key, label, dep, profit|null, rate|null, asset|null, live }]
const points = computed(() => props.months.map((m) => {
  const end = monthEnd(m.key)
  return {
    key: m.key,
    label: `${m.year}년 ${m.month}월`,
    dep: cumDeposit(end < today ? end : today),
    profit: m.cumProfit,
    rate: m.cumRate,
    asset: m.endValue,
    live: m.live,
  }
}))
const last = computed(() => [...points.value].reverse().find((p) => p.profit !== null) || null)

// ===== 그리기 =====
const box = ref(null)
const W = ref(640)
const H = 220
const PAD = { top: 12, right: 8, bottom: 26, left: 52 }
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
  const vals = points.value.flatMap((p) => [p.dep, p.asset]).filter((v) => v !== null && Number.isFinite(v))
  let lo = Math.min(0, ...vals)
  let hi = Math.max(0, ...vals)
  if (hi - lo < 1) hi = lo + 10000
  const step0 = (hi - lo) / 4
  const p = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 5, 10].map((k) => k * p).find((s) => s >= step0)
  const min = Math.floor(lo / step + 1e-9) * step
  const max = Math.ceil(hi / step - 1e-9) * step
  const ticks = []
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v)
  return { min, max, ticks }
})
const yOf = (v) => PAD.top + plotH - ((v - scale.value.min) / (scale.value.max - scale.value.min)) * plotH
const y0 = computed(() => yOf(0))
const short = (v) => {
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (a >= 1e8) return `${s}${+(a / 1e8).toFixed(1)}억`
  if (a >= 1e4) return `${s}${fmt(Math.round(a / 1e4))}만`
  return `${s}${fmt(a)}`
}

// 가로 위치: 그래프 폭 전체에 고르게 (점이 하나면 가운데)
const xOf = (i) => {
  const n = points.value.length
  return PAD.left + (n <= 1 ? plotW.value / 2 : (plotW.value * i) / (n - 1))
}

// 누적 입금액 선 (모든 달)
const depLine = computed(() => points.value.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.dep).toFixed(1)}`).join(' '))

// 계좌 총액 선 + 옅은 면 — 기록 있는 달끼리 이음
//   바로 다음 달이면 실선, 사이에 기록 없는 달이 있으면 점선 (면은 끊지 않음)
const asset = computed(() => {
  const pts = points.value.map((p, i) => (p.asset === null ? null : { i, x: xOf(i), y: yOf(p.asset) })).filter(Boolean)
  if (!pts.length) return { solid: [], dashed: [], area: '', single: null }
  const solid = []
  const dashed = []
  let run = [pts[0]]
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]
    const b = pts[k]
    if (b.i === a.i + 1) run.push(b)
    else {
      if (run.length > 1) solid.push(run)
      dashed.push([a, b])
      run = [b]
    }
  }
  if (run.length > 1) solid.push(run)
  const str = (list) => list.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')
  return {
    solid: solid.map(str),
    dashed: dashed.map(str),
    area: `M${pts[0].x},${y0.value} ${pts.map((q) => `L${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')} L${pts.at(-1).x},${y0.value} Z`,
    single: pts.length === 1 ? pts[0] : null, // 기록이 하나뿐이면 점으로
  }
})

// 가로 라벨: 12개월 이하면 매달, 넘으면 첫 달 · 1월만 (좁으면 덜)
const labelIdx = computed(() => {
  const n = points.value.length
  if (n <= 12) {
    const every = W.value < 420 && n > 6 ? 2 : 1
    return points.value.map((_, i) => i).filter((i) => i % every === 0 || i === n - 1)
  }
  return points.value.map((p, i) => (i === 0 || p.key.endsWith('-01') ? i : -1)).filter((i) => i >= 0)
})
const xLabel = (i) => {
  const p = points.value[i]
  const m = Number(p.key.slice(5))
  if (points.value.length > 12) return i === 0 ? `${p.key.slice(2, 4)}.${m}` : p.key.slice(0, 4)
  return i === 0 || m === 1 ? `${p.key.slice(2, 4)}.${m}` : `${m}월`
}

// ===== 마우스 · 터치 · 키보드 =====
const active = ref(-1)
const tip = computed(() => {
  const p = points.value[active.value]
  if (!p) return null
  const lines = [
    ['계좌 총액', p.asset === null ? '기록 없음' : `${fmt(p.asset)}원`],
    ['누적 입금액', `${fmt(p.dep)}원`],
  ]
  if (p.profit !== null) lines.push(['누적 수익', `${signed(p.profit)}원 (${pctText(p.rate)})`])
  return { x: xOf(active.value), title: p.live ? `${p.label} (진행 중)` : p.label, lines }
})
// 마우스 가로 위치에서 가장 가까운 달
function onMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = PAD.left + ((e.clientX - rect.left) / rect.width) * plotW.value
  let best = -1
  let bestD = Infinity
  points.value.forEach((_, i) => { const d = Math.abs(xOf(i) - x); if (d < bestD) { bestD = d; best = i } })
  active.value = best
}
function onKey(e) {
  const n = points.value.length
  if (!n) return
  if (e.key === 'ArrowRight') { active.value = Math.min(n - 1, active.value + 1); e.preventDefault() }
  if (e.key === 'ArrowLeft') { active.value = Math.max(0, active.value < 0 ? n - 1 : active.value - 1); e.preventDefault() }
  if (e.key === 'Escape') active.value = -1
}
</script>

<template>
  <section class="card div-chart">
    <div class="div-chart-head"><h2>계좌 현황</h2></div>

    <div v-if="!last" class="state">
      <strong>아직 계좌 현황을 그릴 기록이 없어요</strong>
      수익률 탭에서 월말 총 자산을 기록하면 월별로 보여드려요
      <div><button class="retry" @click="emit('navigate', 'returns')">수익률 탭으로 가기</button></div>
    </div>

    <template v-else>
      <div class="chart-legend cr-legend" aria-hidden="true">
        <span><i class="sw-line asset" />계좌 총액</span>
        <span><i class="sw-line dep" />누적 입금액</span>
      </div>

      <div ref="box" class="chart-box" tabindex="0" aria-label="계좌 현황 그래프 — 좌우 화살표로 월 이동" @keydown="onKey" @mouseleave="active = -1">
        <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="chart-svg" aria-hidden="true">
          <g class="grid">
            <template v-for="t in scale.ticks" :key="t">
              <line :x1="PAD.left" :x2="W - PAD.right" :y1="yOf(t)" :y2="yOf(t)" :class="{ base: t === 0 }" />
              <text :x="PAD.left - 6" :y="yOf(t) + 4" text-anchor="end">{{ short(t) }}</text>
            </template>
          </g>

          <!-- 계좌 총액: 옅은 면 -->
          <path :d="asset.area" class="asset-area" />
          <!-- 누적 입금액: 파랑 선 -->
          <polyline :points="depLine" class="dep-line" />
          <!-- 계좌 총액: 빨강 선 (겹쳐도 보이게 배경색 테두리), 기록 없는 달을 건너는 구간은 점선 -->
          <polyline v-for="(pts, k) in asset.solid" :key="`h${k}`" :points="pts" class="cr-halo" />
          <polyline v-for="(pts, k) in asset.solid" :key="`s${k}`" :points="pts" class="asset-line" />
          <polyline v-for="(pts, k) in asset.dashed" :key="`d${k}`" :points="pts" class="asset-line gap" />
          <circle v-if="asset.single" :cx="asset.single.x" :cy="asset.single.y" r="3.5" class="asset-dot" />

          <text v-for="i in labelIdx" :key="`x${i}`" :x="xOf(i)" :y="H - 8" text-anchor="middle" class="x-label">{{ xLabel(i) }}</text>
          <template v-if="active >= 0 && points[active]">
            <line :x1="xOf(active)" :x2="xOf(active)" :y1="PAD.top" :y2="PAD.top + plotH" class="crosshair" />
            <circle :cx="xOf(active)" :cy="yOf(points[active].dep)" r="5" class="dep-dot" />
            <circle v-if="points[active].asset !== null" :cx="xOf(active)" :cy="yOf(points[active].asset)" r="5" class="asset-dot" />
          </template>
          <rect :x="PAD.left" :y="PAD.top" :width="plotW" :height="plotH" class="hit" @mousemove="onMove" @click="onMove" />
        </svg>

        <div v-if="tip" class="chart-tip cr-tip" :style="{ left: `${Math.min(Math.max(tip.x, 100), W - 100)}px` }" role="status">
          <b>{{ tip.title }}</b>
          <span v-for="[k, v] in tip.lines" :key="k" class="tip-line">
            <i v-if="k === '누적 입금액'" class="sw-line dep" /><i v-else-if="k === '계좌 총액'" class="sw-line asset" />
            {{ k }} <em>{{ v }}</em>
          </span>
        </div>
      </div>

      <div class="sr-only">
        <table>
          <caption>계좌 총액 · 누적 입금액 · 누적 수익 (월별)</caption>
          <thead><tr><th>월</th><th>계좌 총액</th><th>누적 입금액</th><th>누적 수익</th><th>누적 수익률</th></tr></thead>
          <tbody>
            <tr v-for="p in points" :key="p.key"><td>{{ p.label }}</td><td>{{ p.asset === null ? '기록 없음' : `${fmt(p.asset)}원` }}</td><td>{{ fmt(p.dep) }}원</td><td>{{ p.profit === null ? '–' : `${signed(p.profit)}원` }}</td><td>{{ pctText(p.rate) }}</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
