<script setup>
import { ref, computed, onMounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import PortfolioSummary from './components/PortfolioSummary.vue'
import HoldingList from './components/HoldingList.vue'
import AddHoldingSheet from './components/AddHoldingSheet.vue'
import BaseSheet from './components/BaseSheet.vue'
import { usePortfolio } from './composables/usePortfolio'
import { fmt, qtyText } from './utils/format'

const {
  summary, holdings, stocks, usdRate, loading, error,
  load, saveOrder, addHolding, removeHolding,
} = usePortfolio()

// ===== 토스트 =====
const toastMsg = ref('')
const toastShow = ref(false)
let toastTimer
function toast(msg) {
  toastMsg.value = msg
  toastShow.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastShow.value = false), 1800)
}

// ===== 순서 변경 =====
async function onReorder(ids) {
  try {
    await saveOrder(ids)
    toast('순서를 바꿨어요')
  } catch (e) {
    console.error(e)
    toast('순서를 저장하지 못했어요')
  }
}

// ===== 편집 모드 (삭제) =====
const editing = ref(false)
const deleteTarget = ref(null) // 삭제 확인 중인 종목
const deleting = ref(false)

async function confirmDelete() {
  const h = deleteTarget.value
  if (!h || deleting.value) return
  deleting.value = true
  try {
    await removeHolding(h.holding_id)
    toast(`${h.name} 종목을 삭제했어요`)
    if (!holdings.value.length) editing.value = false
  } catch (e) {
    toast(e.message)
  } finally {
    deleting.value = false
    deleteTarget.value = null
  }
}

// ===== 추가 =====
const addOpen = ref(false)
const adding = ref(false)
const addError = ref('')
const heldStockIds = computed(() => holdings.value.map((h) => h.stock_id))

function openAdd() {
  addError.value = ''
  editing.value = false
  addOpen.value = true
}
async function onAdd(payload) {
  adding.value = true
  addError.value = ''
  try {
    await addHolding(payload)
    addOpen.value = false
    toast(`${payload.label} 종목을 추가했어요`)
  } catch (e) {
    addError.value = e.message
  } finally {
    adding.value = false
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
      <div><button class="retry" @click="load()">다시 시도</button></div>
    </section>

    <!-- 정상 -->
    <template v-else>
      <PortfolioSummary :summary="summary" />

      <section class="card list-card" :class="{ editing }">
        <div class="list-head">
          <h2>보유 주식<span>{{ holdings.length }}</span></h2>
          <div class="list-actions">
            <span v-if="!editing && holdings.length" class="hint">≡ 를 끌어서 순서 변경</span>
            <button v-if="holdings.length" class="chip-btn" :class="{ on: editing }" @click="editing = !editing">
              {{ editing ? '완료' : '편집' }}
            </button>
            <button class="chip-btn primary" @click="openAdd">+ 추가</button>
          </div>
        </div>
        <div v-if="holdings.length" class="thead d-only" aria-hidden="true">
          <span class="c-name">종목</span>
          <span>보유 수량</span>
          <span>평균 단가</span>
          <span>현재가</span>
          <span>평가금액</span>
          <span>수익금 (수익률)</span>
          <span />
        </div>
        <div v-if="!holdings.length" class="state">
          <strong>보유한 주식이 없어요</strong>
          <button class="retry" @click="openAdd">+ 주식 추가하기</button>
        </div>
        <HoldingList
          v-else
          :holdings="holdings"
          :editing="editing"
          @reorder="onReorder"
          @delete="deleteTarget = $event"
        />
      </section>

      <div class="foot">
        <span v-if="usdRate">※ 1달러 = {{ fmt(usdRate) }}원 기준</span>
        <span v-else />
        <button @click="load()">새로고침</button>
      </div>
    </template>
  </main>

  <!-- 주식 추가 -->
  <AddHoldingSheet
    :open="addOpen"
    :stocks="stocks"
    :held-stock-ids="heldStockIds"
    :usd-rate="usdRate ? Number(usdRate) : null"
    :saving="adding"
    :server-error="addError"
    @close="addOpen = false"
    @submit="onAdd"
  />

  <!-- 삭제 확인 -->
  <BaseSheet :open="!!deleteTarget" title="종목 삭제" @close="deleteTarget = null">
    <div v-if="deleteTarget" class="sheet-body">
      <p class="confirm-text">
        <b>{{ deleteTarget.name }}</b> 종목을 삭제할까요?<br>
        <span class="pick-sub">{{ qtyText(deleteTarget.quantity) }} · 평가금액 {{ fmt(deleteTarget.value_krw) }}원</span>
      </p>
      <div class="btn-row">
        <button class="secondary-btn" @click="deleteTarget = null">취소</button>
        <button class="danger-btn" :disabled="deleting" @click="confirmDelete">{{ deleting ? '삭제하는 중…' : '삭제' }}</button>
      </div>
    </div>
  </BaseSheet>

  <div class="toast" :class="{ show: toastShow }" role="status" aria-live="polite">{{ toastMsg }}</div>
</template>
