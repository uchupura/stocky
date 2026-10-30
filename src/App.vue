<script setup>
import { ref, computed, onMounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import PortfolioSummary from './components/PortfolioSummary.vue'
import HoldingList from './components/HoldingList.vue'
import AddHoldingSheet from './components/AddHoldingSheet.vue'
import EditHoldingSheet from './components/EditHoldingSheet.vue'
import BaseSheet from './components/BaseSheet.vue'
import { usePortfolio } from './composables/usePortfolio'
import { fmt, qtyText, fxText, timeText } from './utils/format'

const {
  summary, holdings, stocks, usdRate, fxUpdatedAt, refreshing, loading, error,
  load, saveOrder, addHolding, updateHolding, removeHolding, refreshPrices,
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
const heldSymbols = computed(() => holdings.value.map((h) => h.symbol))

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

// ===== 수정 (수량 · 평균 단가 · 매수 환율) =====
const editTarget = ref(null)
const editSaving = ref(false)
const editError = ref('')
function openEdit(h) {
  editError.value = ''
  editTarget.value = h
}
async function onEdit(payload) {
  const h = editTarget.value
  if (!h) return
  editSaving.value = true
  editError.value = ''
  try {
    await updateHolding(h.holding_id, payload)
    editTarget.value = null
    toast(`${h.name} 보유 정보를 수정했어요`)
  } catch (e) {
    editError.value = e.message
  } finally {
    editSaving.value = false
  }
}

// ===== 현재가 · 환율 갱신 =====
const refreshError = ref('')
async function refresh({ manual = false } = {}) {
  refreshError.value = ''
  try {
    const r = await refreshPrices()
    if (!r) return
    if (r.failed?.length) {
      refreshError.value = `일부 종목 갱신 실패: ${r.failed.map((f) => f.symbol).join(', ')}`
    } else if (manual) {
      toast(r.skipped ? '방금 갱신한 최신 값이에요' : '현재가·환율을 갱신했어요')
    }
  } catch (e) {
    console.error(e)
    refreshError.value = '현재가를 갱신하지 못했어요. 저장된 값으로 보여드려요.'
  }
}
async function reloadAll() {
  await load()
  if (!error.value) refresh({ manual: true })
}

// 처음 열 때: 저장된 값으로 바로 보여주고 → 뒤에서 현재가·환율 갱신
onMounted(async () => {
  await load()
  if (!error.value) refresh()
})
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
            <span v-if="editing" class="hint">종목을 누르면 수정</span>
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
          @edit="openEdit"
        />
        <p v-if="holdings.some((h) => h.fx_missing)" class="fx-note">
          <span class="fx-missing">환율 미입력</span>
          매수 환율을 넣지 않은 해외 종목은 환율 손익 없이 계산돼요 · <b>편집</b>에서 종목을 눌러 입력
        </p>
      </section>

      <div class="foot">
        <span>
          <template v-if="refreshing">현재가·환율 갱신 중…</template>
          <template v-else-if="usdRate">
            ※ 1달러 = {{ fxText(usdRate) }}원<template v-if="fxUpdatedAt"> · {{ timeText(fxUpdatedAt) }} 기준</template>
          </template>
          <span v-if="refreshError" class="foot-error">{{ refreshError }}</span>
        </span>
        <button :disabled="refreshing" @click="reloadAll">새로고침</button>
      </div>
    </template>
  </main>

  <!-- 주식 추가 -->
  <AddHoldingSheet
    :open="addOpen"
    :stocks="stocks"
    :held-symbols="heldSymbols"
    :usd-rate="usdRate"
    :saving="adding"
    :server-error="addError"
    @close="addOpen = false"
    @submit="onAdd"
  />

  <!-- 보유 정보 수정 -->
  <EditHoldingSheet
    :holding="editTarget"
    :usd-rate="usdRate"
    :saving="editSaving"
    :server-error="editError"
    @close="editTarget = null"
    @submit="onEdit"
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
