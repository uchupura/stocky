<script setup>
import { computed } from 'vue'

// 오늘 하루 주가 그래프 (작은 선 그래프)
//   점선 = 전일 종가, 선 색 = 현재가가 전일 종가보다 높으면 빨강(up) / 낮으면 파랑(down) / 같으면 회색(flat)
const props = defineProps({
  points: { type: Array, default: () => [] },  // [[HHMM, 가격], ...] 시간순
  prevClose: { type: Number, default: null },
  price: { type: Number, default: null },      // 현재가 (색 판단 기준 — 수익률 숫자와 같은 기준)
  label: { type: String, default: '' },        // 화면 읽기 프로그램용 설명
})

const W = 100
const H = 32
const PAD = 2

// HHMM → 분 (가로축은 시각 기준이라 장 중이면 그래프가 왼쪽부터 채워짐)
const toMin = (t) => Math.floor(t / 100) * 60 + (t % 100)

const geo = computed(() => {
  const p = props.points
  if (!p || p.length < 2) return null
  const t0 = toMin(p[0][0])
  const t1 = Math.max(toMin(p.at(-1)[0]), t0 + 1)
  const prices = p.map((x) => x[1])
  const base = props.prevClose > 0 ? props.prevClose : null
  let lo = Math.min(...prices, ...(base ? [base] : []))
  let hi = Math.max(...prices, ...(base ? [base] : []))
  if (hi === lo) { hi += 1; lo -= 1 }
  const x = (t) => PAD + ((toMin(t) - t0) / (t1 - t0)) * (W - PAD * 2)
  const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2)
  return {
    line: p.map(([t, v]) => `${x(t).toFixed(2)},${y(v).toFixed(2)}`).join(' '),
    baseY: base ? y(base).toFixed(2) : null,
    lastX: x(p.at(-1)[0]).toFixed(2),
    lastY: y(p.at(-1)[1]).toFixed(2),
  }
})

const tone = computed(() => {
  const now = props.price ?? props.points.at(-1)?.[1]
  if (!(props.prevClose > 0) || now == null) return 'flat'
  return now > props.prevClose ? 'up' : now < props.prevClose ? 'down' : 'flat'
})
</script>

<template>
  <svg
    class="spark"
    :class="tone"
    :viewBox="`0 0 ${W} ${H}`"
    preserveAspectRatio="none"
    role="img"
    :aria-label="label || '오늘 주가 그래프'"
  >
    <template v-if="geo">
      <line v-if="geo.baseY" class="spark-base" x1="0" :x2="W" :y1="geo.baseY" :y2="geo.baseY" />
      <polyline class="spark-line" :points="geo.line" />
      <circle class="spark-dot" :cx="geo.lastX" :cy="geo.lastY" r="1.6" />
    </template>
    <line v-else class="spark-empty" x1="0" :x2="W" :y1="H / 2" :y2="H / 2" />
  </svg>
</template>
