<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import AppHeader from './components/AppHeader.vue'
import PortfolioSummary from './components/PortfolioSummary.vue'
import HoldingList from './components/HoldingList.vue'
import AddHoldingSheet from './components/AddHoldingSheet.vue'
import EditHoldingSheet from './components/EditHoldingSheet.vue'
import CashSheet from './components/CashSheet.vue'
import AccountBar from './components/AccountBar.vue'
import DepositsTab from './components/DepositsTab.vue'
import DividendsTab from './components/DividendsTab.vue'
import HomeTab from './components/HomeTab.vue'
import ReturnsTab from './components/ReturnsTab.vue'
import AutoTradeTab from './components/AutoTradeTab.vue'
import ProfitHistory from './components/ProfitHistory.vue'
import BaseSheet from './components/BaseSheet.vue'
import LoginScreen from './components/LoginScreen.vue'
import { useAuth } from './composables/useAuth'
import { useCharts } from './composables/useCharts'
import { usePortfolio } from './composables/usePortfolio'
import { fmt, qtyText, fxText, timeText } from './utils/format'

const {
  summary, holdings, stocks, accounts, cash, usdRate, fxUpdatedAt, refreshing, loading, error,
  load, saveOrder, addHolding, updateHolding, removeHolding, refreshPrices, saveCash, assignAccount, addAccount,
} = usePortfolio()

// ===== 내 투자 — 계좌 필터: 'all' | 계좌 id | 'none'(미지정) — 고른 값은 브라우저에 기억 =====
const ACCT_KEY = 'stocky-account'
const savedAcct = localStorage.getItem(ACCT_KEY)
const acct = ref(savedAcct === 'none' ? 'none' : Number(savedAcct) > 0 ? Number(savedAcct) : 'all')
watch(acct, (v) => localStorage.setItem(ACCT_KEY, String(v)))
// 계좌가 지워졌거나 미지정 항목이 없어지면 전체로
watch([accounts, holdings, cash], () => {
  if (typeof acct.value === 'number' && !accounts.value.some((a) => a.id === acct.value)) acct.value = 'all'
  if (acct.value === 'none' && !holdings.value.some((h) => h.account_id == null) && !cash.value.some((c) => c.account_id == null && c.amount > 0)) acct.value = 'all'
})
const acctId = computed(() => (typeof acct.value === 'number' ? acct.value : null)) // 새로 추가할 때 기본 계좌
const inAcct = (x) => acct.value === 'all' || (acct.value === 'none' ? x.account_id == null : x.account_id === acct.value)
const accountName = computed(() => Object.fromEntries(accounts.value.map((a) => [a.id, a.name])))
// 화면에 보일 보유 주식 (전체 보기에서는 계좌 이름 배지)
const shownHoldings = computed(() =>
  holdings.value.filter(inAcct).map((h) => ({
    ...h,
    account_name: acct.value === 'all' && accounts.value.length ? accountName.value[h.account_id] || '미지정' : '',
  })),
)
// 요약 카드: 전체 = DB 합계 그대로, 계좌를 고르면 그 계좌만 다시 계산
const shownSummary = computed(() => {
  const s = summary.value
  if (!s || acct.value === 'all') return s
  const hs = holdings.value.filter(inAcct)
  const cs = cash.value.filter(inAcct)
  const sum = (list, f) => list.reduce((t, x) => t + Number(f(x) || 0), 0)
  const total_value = sum(hs, (h) => h.value_krw)
  const total_cost = sum(hs, (h) => h.cost_krw)
  const cash_krw = sum(cs.filter((c) => c.currency === 'KRW'), (c) => c.amount)
  const cash_usd = sum(cs.filter((c) => c.currency === 'USD'), (c) => c.amount)
  const cash_usd_krw = Math.round(cash_usd * (usdRate.value || 0))
  return {
    ...s,
    total_value, total_cost, total_profit: total_value - total_cost,
    domestic_value: sum(hs.filter((h) => h.market === 'KR'), (h) => h.value_krw),
    overseas_value: sum(hs.filter((h) => h.market === 'US'), (h) => h.value_krw),
    holding_count: hs.length,
    cash_krw, cash_usd, cash_usd_krw,
    total_asset: total_value + cash_krw + cash_usd_krw,
  }
})
const summaryTitle = computed(() =>
  acct.value === 'all' ? '' : acct.value === 'none' ? '계좌 미지정' : accountName.value[acct.value] || '')

const assigning = ref(false)
async function onAssign(accountId) {
  assigning.value = true
  try {
    const r = await assignAccount(accountId)
    const kept = r.skipped.length ? `${r.skipped.join(', ')}은(는) 그 계좌에 이미 있어 그대로 뒀어요` : ''
    toast(!kept ? `${accountName.value[accountId]} 계좌로 지정했어요` : r.moved ? `${r.moved}종목을 지정했어요 · ${kept}` : kept)
  } catch (e) {
    toast(e.message)
  } finally {
    assigning.value = false
  }
}

// ===== 탭: 홈(기본) / 내 투자 / 입출금 / 배당 — 주소 # 로 새로고침해도 유지 =====
const TAB_HASH = { invest: '#invest', returns: '#returns', deposits: '#deposits', dividends: '#dividends', auto: '#auto', profits: '#auto-history' }
const TAB_TITLE = { home: '홈', invest: '내 투자', returns: '수익률', deposits: '입출금', dividends: '배당', auto: '자동매매', profits: '익절 히스토리' }
const tabFromHash = () => Object.keys(TAB_HASH).find((t) => TAB_HASH[t] === location.hash) || 'home'
const tab = ref(tabFromHash())
// 모바일 탭이 넘치면 옆으로 넘기므로, 고른 탭이 보이게 스크롤
watch(tab, () => nextTick(() => document.querySelector('.page-tabs .on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })))
function setTab(t) {
  // 다른 탭에서 계좌·입출금을 바꿨을 수 있으니 내 투자·수익률로 올 때 조용히 다시 불러옴
  if (t !== tab.value && (t === 'invest' || t === 'returns') && summary.value) load({ silent: true })
  tab.value = t
  history.replaceState(null, '', location.pathname + location.search + (TAB_HASH[t] || ''))
  window.scrollTo({ top: 0 })
}
window.addEventListener('hashchange', () => {
  if (!location.hash.includes('access_token')) tab.value = tabFromHash()
})

// ===== 보기 전환: 평가 / 시세 (고른 값은 브라우저에 기억) =====
const VIEW_KEY = 'stocky-view'
const view = ref(localStorage.getItem(VIEW_KEY) === 'quote' ? 'quote' : 'value')
const { charts, loadCharts } = useCharts()
watch(view, (v) => localStorage.setItem(VIEW_KEY, v))
// 시세 보기일 때만 그래프를 불러옴 (보유 종목이 바뀌면 새 종목만 추가로)
watch(
  () => [view.value, holdings.value.map((h) => `${h.market}:${h.symbol}`).join()],
  () => { if (view.value === 'quote' && holdings.value.length) loadCharts(holdings.value) },
)

// ===== 로그인 =====
const { session, displayName, ready, signOut, loginUrl } = useAuth()

// 네이버 로그인 실패 시 서버가 ?login_error=코드 로 돌려보냄 → 한 번 읽고 주소에서 지움
const loginError = ref(new URLSearchParams(location.search).get('login_error') || '')
if (loginError.value) history.replaceState(null, '', location.pathname + location.hash)

async function onLogout() {
  await signOut()
  toast('로그아웃했어요')
}

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
    // 계좌로 걸러 보는 중이면, 보이는 종목들이 차지하던 자리 안에서만 순서를 바꿈
    if (acct.value !== 'all') {
      const shown = new Set(ids)
      const queue = [...ids]
      ids = holdings.value.map((h) => (shown.has(h.holding_id) ? queue.shift() : h.holding_id))
    }
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
const held = computed(() => holdings.value.map((h) => ({ symbol: h.symbol, account_id: h.account_id ?? null })))

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

// ===== 예수금 =====
const cashOpen = ref(false)
const cashSaving = ref(false)
const cashError = ref('')
function openCash() {
  cashError.value = ''
  cashOpen.value = true
}
async function onCash(payload) {
  cashSaving.value = true
  cashError.value = ''
  try {
    await saveCash(payload)
    cashOpen.value = false
    toast('예수금을 저장했어요')
  } catch (e) {
    cashError.value = e.message
  } finally {
    cashSaving.value = false
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
  if (error.value) return
  await refresh({ manual: true })
  if (view.value === 'quote') loadCharts(holdings.value, { force: true })
}

// 로그인되면: 저장된 값으로 바로 보여주고 → 뒤에서 현재가·환율 갱신
// (로그인 전에는 데이터를 요청하지 않음)
watch(
  () => session.value?.user?.id,
  async (uid) => {
    if (!uid) return
    loginError.value = ''
    await load()
    if (!error.value) refresh()
  },
  { immediate: true },
)
</script>

<template>
  <AppHeader :user-name="session ? displayName : ''" :active-tab="tab === 'profits' ? 'auto' : tab" @logout="onLogout" @navigate="setTab" />

  <!-- 로그인 상태 확인 중: 아무것도 그리지 않음 -->
  <template v-if="!ready" />

  <!-- 로그인 안 됨 -->
  <LoginScreen v-else-if="!session" :login-url="loginUrl" :error-code="loginError" />

  <main v-else class="app">
    <!-- 탭 (모바일 — 데스크톱은 상단 메뉴) -->
    <div class="page-tabs m-only" role="tablist" aria-label="화면 선택">
      <button
        v-for="t in ['home', 'invest', 'returns', 'deposits', 'dividends', 'auto']"
        :key="t"
        type="button"
        role="tab"
        :aria-selected="tab === t"
        :class="{ on: tab === t || (t === 'auto' && tab === 'profits') }"
        @click="setTab(t)"
      >{{ TAB_TITLE[t] }}</button>
    </div>
    <h1 class="page-title d-only">{{ TAB_TITLE[tab] }}</h1>

    <!-- ===== 홈 탭 ===== -->
    <template v-if="tab === 'home'">
      <section v-if="loading" class="card" aria-busy="true"><span class="skeleton" style="width: 30%; height: 16px" /><span class="skeleton" style="width: 55%; height: 34px" /></section>
      <section v-else-if="error" class="card state" role="alert">
        <strong>포트폴리오를 불러오지 못했어요</strong>
        {{ error }}
        <div><button class="retry" @click="load()">다시 시도</button></div>
      </section>
      <HomeTab v-else :summary="summary" @navigate="setTab" />
    </template>

    <!-- ===== 자동매매 탭 (LOC 수동 운영) ===== -->
    <AutoTradeTab v-else-if="tab === 'auto'" :portfolio-id="summary?.portfolio_id ?? null" @toast="toast" @navigate="setTab" />

    <!-- ===== 익절 히스토리 (자동매매 하위 페이지) ===== -->
    <ProfitHistory v-else-if="tab === 'profits'" :portfolio-id="summary?.portfolio_id ?? null" @navigate="setTab" />

    <!-- ===== 수익률 탭 ===== -->
    <template v-else-if="tab === 'returns'">
      <section v-if="loading" class="card" aria-busy="true"><span class="skeleton" style="width: 30%; height: 16px" /><span class="skeleton" style="width: 55%; height: 34px" /></section>
      <section v-else-if="error" class="card state" role="alert">
        <strong>포트폴리오를 불러오지 못했어요</strong>
        {{ error }}
        <div><button class="retry" @click="load()">다시 시도</button></div>
      </section>
      <ReturnsTab v-else :summary="summary" @toast="toast" @navigate="setTab" />
    </template>


    <!-- ===== 입출금 · 배당 탭 ===== -->
    <template v-else-if="tab === 'deposits' || tab === 'dividends'">
      <section v-if="loading" class="card" aria-busy="true"><span class="skeleton" style="width: 40%; height: 30px" /></section>
      <section v-else-if="error" class="card state" role="alert">
        <strong>포트폴리오를 불러오지 못했어요</strong>
        {{ error }}
        <div><button class="retry" @click="load()">다시 시도</button></div>
      </section>
      <DepositsTab v-else-if="tab === 'deposits'" :portfolio-id="summary?.portfolio_id ?? null" @toast="toast" />
      <DividendsTab v-else :portfolio-id="summary?.portfolio_id ?? null" :holdings="holdings" @toast="toast" @cash-changed="load({ silent: true })" />
    </template>

    <!-- ===== 내 투자 탭 ===== -->
    <template v-else>

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
      <AccountBar
        v-model="acct"
        :accounts="accounts"
        :holdings="holdings"
        :cash="cash"
        :usd-rate="usdRate"
        :assigning="assigning"
        @assign="onAssign"
      />
      <PortfolioSummary :summary="shownSummary" :title="summaryTitle" :holdings="shownHoldings" @edit-cash="openCash" />

      <section class="card list-card" :class="{ editing }">
        <div class="list-head">
          <div class="list-title">
            <h2>보유 주식<span>{{ shownHoldings.length }}</span></h2>
            <div class="view-toggle" role="radiogroup" aria-label="보기 선택">
              <button
                v-for="o in [{ v: 'value', t: '평가' }, { v: 'quote', t: '시세' }]"
                :key="o.v"
                type="button"
                role="radio"
                :aria-checked="view === o.v"
                :class="{ on: view === o.v }"
                @click="view = o.v"
              >{{ o.t }}</button>
            </div>
          </div>
          <div class="list-actions">
            <span v-if="!editing && shownHoldings.length" class="hint">≡ 를 끌어서 순서 변경</span>
            <span v-if="editing" class="hint">종목을 누르면 수정</span>
            <button v-if="shownHoldings.length" class="chip-btn" :class="{ on: editing }" @click="editing = !editing">
              {{ editing ? '완료' : '편집' }}
            </button>
            <button class="chip-btn primary" @click="openAdd">+ 추가</button>
          </div>
        </div>
        <div v-if="shownHoldings.length && view === 'quote'" class="thead quote d-only" aria-hidden="true">
          <span class="c-name">종목</span>
          <span>내 평단가</span>
          <span class="c-chart">오늘 그래프</span>
          <span>현재가</span>
          <span>오늘 수익률</span>
          <span />
        </div>
        <div v-else-if="shownHoldings.length" class="thead d-only" aria-hidden="true">
          <span class="c-name">종목</span>
          <span>보유 수량</span>
          <span>평균 단가</span>
          <span>현재가</span>
          <span>평가금액</span>
          <span>수익금 (수익률)</span>
          <span />
        </div>
        <div v-if="!shownHoldings.length" class="state">
          <strong>{{ acct === 'all' ? '보유한 주식이 없어요' : '이 계좌에 보유한 주식이 없어요' }}</strong>
          <button class="retry" @click="openAdd">+ 주식 추가하기</button>
        </div>
        <HoldingList
          v-else
          :holdings="shownHoldings"
          :editing="editing"
          :view="view"
          :charts="charts"
          @reorder="onReorder"
          @delete="deleteTarget = $event"
          @edit="openEdit"
        />
        <p v-if="shownHoldings.some((h) => h.fx_missing)" class="fx-note">
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
    </template>
  </main>

  <!-- 주식 추가 -->
  <AddHoldingSheet
    :open="addOpen"
    :stocks="stocks"
    :held="held"
    :accounts="accounts"
    :add-account="addAccount"
    :default-account-id="acctId"
    :usd-rate="usdRate"
    :saving="adding"
    :server-error="addError"
    @close="addOpen = false"
    @submit="onAdd"
  />

  <!-- 보유 정보 수정 -->
  <EditHoldingSheet
    :holding="editTarget"
    :accounts="accounts"
    :add-account="addAccount"
    :usd-rate="usdRate"
    :saving="editSaving"
    :server-error="editError"
    @close="editTarget = null"
    @submit="onEdit"
  />

  <!-- 예수금 수정 -->
  <CashSheet
    :open="cashOpen"
    :cash="cash"
    :accounts="accounts"
    :add-account="addAccount"
    :account-id="acctId"
    :usd-rate="usdRate"
    :saving="cashSaving"
    :server-error="cashError"
    @close="cashOpen = false"
    @submit="onCash"
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
