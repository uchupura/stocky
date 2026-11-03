<script setup>
import { ref, computed, watch } from 'vue'
import { supabase } from '../lib/supabase'

// 익절 히스토리 — 끝난(전량 매도) LOC 사이클 목록 (014 loc_cycles · loc_daily)
//   누적 실현 수익 · 사이클별 기간·매수·매도·실현 수익, 누르면 그 사이클의 날짜별 내역
const props = defineProps({ portfolioId: { type: Number, default: null } })
const emit = defineEmits(['navigate'])

const cycles = ref([])
const loaded = ref(false)
const error = ref('')
watch(() => props.portfolioId, async (id) => {
  if (!id) return
  const { data, error: e } = await supabase.from('loc_cycles').select('*').eq('portfolio_id', id).eq('status', 'ended')
    .order('ended_on', { ascending: false })
  if (e) error.value = /loc_cycles/.test(e.message || '') ? '014_loc_cycles.sql 을 먼저 실행해 주세요.' : e.message
  else cycles.value = data.map((c) => ({ ...c, bought: Number(c.bought_amount), sold: Number(c.sold_amount), pnl: Number(c.realized_pnl) }))
  loaded.value = true
}, { immediate: true })

const usd = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const signedUsd = (v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${usd(Math.abs(v))}`
const pct = (c) => (c.bought ? (c.pnl / c.bought) * 100 : 0)
const dot = (d) => d.replaceAll('-', '.')
const daysOf = (c) => Math.round((new Date(`${c.ended_on}T12:00:00Z`) - new Date(`${c.start_date}T12:00:00Z`)) / 86400000) + 1
const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat')

const total = computed(() => {
  const l = cycles.value
  const pnl = l.reduce((t, c) => t + c.pnl, 0)
  return {
    count: l.length, pnl,
    avgPct: l.length ? l.reduce((t, c) => t + pct(c), 0) / l.length : 0,
    avgDays: l.length ? Math.round(l.reduce((t, c) => t + daysOf(c), 0) / l.length) : 0,
    wins: l.filter((c) => c.pnl > 0).length,
  }
})

// 펼친 사이클의 날짜별 내역
const openId = ref(null)
const daily = ref({})
async function toggle(c) {
  openId.value = openId.value === c.id ? null : c.id
  if (openId.value && !daily.value[c.id]) {
    const { data } = await supabase.from('loc_daily').select('*').eq('cycle_id', c.id).order('trade_date', { ascending: false })
    daily.value = { ...daily.value, [c.id]: data || [] }
  }
}
</script>

<template>
  <button class="link-btn ph-back" @click="emit('navigate', 'auto')">← 자동매매</button>

  <section v-if="!loaded" class="card" aria-busy="true"><span class="skeleton" style="width: 40%; height: 20px" /><span class="skeleton" style="height: 80px" /></section>
  <section v-else-if="error" class="card state" role="alert"><strong>익절 히스토리를 불러오지 못했어요</strong>{{ error }}</section>

  <template v-else>
    <section class="card summary">
      <div class="sum-main">
        <p class="label">누적 실현 수익 <span class="label-sub">끝난 사이클 {{ total.count }}개</span></p>
        <p class="total" :class="tone(total.pnl)">{{ signedUsd(total.pnl) }}</p>
        <p class="total-pl flat">평균 수익률 {{ total.avgPct.toFixed(2) }}% · 평균 {{ total.avgDays }}일</p>
      </div>
      <div class="sum-side">
        <dl class="rows">
          <div class="row"><dt>익절한 사이클</dt><dd>{{ total.wins }} / {{ total.count }}</dd></div>
          <div class="row"><dt>매수 합계</dt><dd>{{ usd(cycles.reduce((t, c) => t + c.bought, 0)) }}</dd></div>
          <div class="row"><dt>매도 합계</dt><dd>{{ usd(cycles.reduce((t, c) => t + c.sold, 0)) }}</dd></div>
        </dl>
      </div>
    </section>

    <section class="card list-card">
      <div class="list-head"><div class="list-title"><h2>사이클<span>{{ cycles.length }}</span></h2></div><div class="list-actions"><span class="hint">눌러서 날짜별 내역</span></div></div>
      <p v-if="!cycles.length" class="state">아직 끝난 사이클이 없어요</p>
      <ul class="dep-list">
        <li v-for="c in cycles" :key="c.id">
          <button class="dep-row ph-row" :aria-expanded="openId === c.id" @click="toggle(c)">
            <span class="dep-main">
              <span class="dep-account">{{ c.symbol }} <span class="ph-period">{{ dot(c.start_date) }} ~ {{ dot(c.ended_on) }} · {{ daysOf(c) }}일</span></span>
              <span class="dep-memo">매수 {{ usd(c.bought) }} → 매도 {{ usd(c.sold) }} ({{ c.sold_qty }}주)</span>
            </span>
            <span class="dep-amount">
              <b :class="tone(c.pnl)">{{ signedUsd(c.pnl) }}</b>
              <span class="dep-krw" :class="tone(c.pnl)">{{ pct(c) > 0 ? '+' : '' }}{{ pct(c).toFixed(2) }}%</span>
            </span>
          </button>
          <div v-if="openId === c.id" class="ret-table-wrap ph-daily">
            <p v-if="!daily[c.id]" class="at-info">불러오는 중…</p>
            <p v-else-if="!daily[c.id].length" class="at-info">날짜별 내역이 없어요</p>
            <table v-else class="ret-table at-table">
              <thead><tr><th scope="col">날짜</th><th scope="col">종가</th><th scope="col">매수</th><th scope="col">매수 금액</th><th scope="col">매도</th><th scope="col">누적 보유</th><th scope="col">누적 쓴 금액</th></tr></thead>
              <tbody>
                <tr v-for="d in daily[c.id]" :key="d.trade_date">
                  <th scope="row">{{ dot(d.trade_date) }}</th>
                  <td>{{ d.close === null ? '–' : usd(d.close) }}</td>
                  <td>{{ d.buy_qty ? `${d.buy_qty}주` : '–' }}</td><td>{{ d.buy_qty ? usd(d.buy_amount) : '' }}</td>
                  <td>{{ d.sell_qty ? `${d.sell_qty}주 ${usd(d.sell_amount)}` : '–' }}</td>
                  <td>{{ d.cum_qty }}주</td><td>{{ usd(d.cum_spent) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </li>
      </ul>
    </section>
  </template>
</template>
