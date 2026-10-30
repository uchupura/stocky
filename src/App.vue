<script setup>
import { ref, onMounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import PortfolioSummary from './components/PortfolioSummary.vue'
import HoldingList from './components/HoldingList.vue'
import { usePortfolio } from './composables/usePortfolio'
import { fmt } from './utils/format'

const { summary, holdings, usdRate, loading, error, load, saveOrder } = usePortfolio()

// ===== 토스트 =====
const toastMsg = ref('')
const toastShow = ref(false)
let toastTimer
function toast(msg) {
  toastMsg.value = msg
  toastShow.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastShow.value = false), 1600)
}

async function onReorder(ids) {
  try {
    await saveOrder(ids)
    toast('순서를 바꿨어요')
  } catch (e) {
    console.error(e)
    toast('순서를 저장하지 못했어요')
  }
}

onMounted(load)
</script>

<template>
  <AppHeader />

  <main class="app">
    <h1 class="page-title d-only">내 투자</h1>

    <!-- 불러오는 중 -->
    <template v-if="loading">
      <section class="card" aria-busy="true" aria-label="불러오는 중">
        <span class="skeleton" style="width: 30%; height: 16px" />
        <span class="skeleton" style="width: 60%; height: 34px" />
        <span class="skeleton" style="width: 40%; height: 18px" />
      </section>
      <section class="card">
        <span v-for="n in 5" :key="n" class="skeleton" style="height: 48px" />
      </section>
    </template>

    <!-- 연결 실패 -->
    <section v-else-if="error" class="card state" role="alert">
      <strong>포트폴리오를 불러오지 못했어요</strong>
      {{ error }}
      <div><button class="retry" @click="load">다시 시도</button></div>
    </section>

    <!-- 정상 -->
    <template v-else>
      <PortfolioSummary :summary="summary" />

      <section class="card list-card">
        <div class="list-head">
          <h2>보유 주식<span>{{ holdings.length }}</span></h2>
          <span class="hint">≡ 를 끌어서 순서 변경</span>
        </div>
        <div class="thead d-only" aria-hidden="true">
          <span class="c-name">종목</span>
          <span>보유 수량</span>
          <span>평균 단가</span>
          <span>현재가</span>
          <span>평가금액</span>
          <span>수익금 (수익률)</span>
          <span />
        </div>
        <p v-if="!holdings.length" class="state">보유한 주식이 없어요</p>
        <HoldingList v-else :holdings="holdings" @reorder="onReorder" />
      </section>

      <div class="foot">
        <span v-if="usdRate">※ 1달러 = {{ fmt(usdRate) }}원 기준</span>
        <span v-else />
        <button @click="load">새로고침</button>
      </div>
    </template>
  </main>

  <div class="toast" :class="{ show: toastShow }" role="status" aria-live="polite">{{ toastMsg }}</div>
</template>
