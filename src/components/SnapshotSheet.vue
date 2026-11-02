<script setup>
import { ref, computed, watch } from 'vue'
import BaseSheet from './BaseSheet.vue'
import AccountPicker from './AccountPicker.vue'
import { fmt } from '../utils/format'
import { todayKST } from '../composables/useDeposits'
import { monthEnd } from '../utils/returns'

// 월말 총 자산 입력 · 수정
//   새로 입력: 년·월을 고르면 그 달 말일로 저장 (지난 달까지만)
//   "지금 총 자산으로 기록": 날짜 = 오늘, 금액 = 지금 총 자산 (새로 입력할 때만)
//   수정: 달을 그대로 두면 원래 날짜 유지 (월말 자동 기록도 고칠 수 있음 → 직접 입력으로 바뀜)
const props = defineProps({
  open: { type: Boolean, default: false },
  snapshot: { type: Object, default: null },
  currentTotalOf: { type: Function, default: () => 0 }, // (계좌 id|null) => 지금 총 자산 (원)
  accounts: { type: Array, default: () => [] },
  accountId: { type: Number, default: null },           // 수익률 탭에서 고른 계좌 (null = 전체)
  saving: { type: Boolean, default: false },
  serverError: { type: String, default: '' },
})
const emit = defineEmits(['close', 'submit', 'delete'])

const thisMonth = () => todayKST().slice(0, 7)
const prevMonth = () => {
  const [y, m] = thisMonth().split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

const form = ref({ month: '', amount: '', memo: '', today: false, account: null })
const currentTotal = computed(() => props.currentTotalOf(form.value.account))
const touched = ref(false)
const confirmDelete = ref(false)

watch(
  () => props.open,
  (o) => {
    if (!o) return
    const s = props.snapshot
    form.value = s
      ? { month: s.snap_date.slice(0, 7), amount: String(s.total_asset), memo: s.memo || '', today: false, account: s.account_id ?? null }
      : { month: prevMonth(), amount: '', memo: '', today: false, account: props.accountId ?? null }
    touched.value = false
    confirmDelete.value = false
  },
)

const num = (v) => (String(v).trim() === '' ? NaN : Number(String(v).replace(/,/g, '').trim()))
// 저장할 날짜: 수정 중이고 달이 같으면 원래 날짜, 아니면 그 달 말일
const targetDate = computed(() => {
  if (form.value.today) return todayKST()
  const s = props.snapshot
  if (s && s.snap_date.slice(0, 7) === form.value.month) return s.snap_date
  return /^\d{4}-\d{2}$/.test(form.value.month) ? monthEnd(form.value.month) : ''
})
const errors = computed(() => {
  const e = {}
  const a = num(form.value.amount)
  if (!(a > 0) || !Number.isInteger(a)) e.amount = '1원 이상의 금액을 숫자로 입력해 주세요'
  if (!targetDate.value) e.month = '년·월을 골라 주세요'
  else if (targetDate.value > todayKST()) e.month = '아직 끝나지 않은 달이에요. 지난 달까지 입력할 수 있어요'
  if (form.value.memo.length > 100) e.memo = '메모는 100자까지예요'
  return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)
const showErr = (k) => touched.value && errors.value[k]
const dateLabel = computed(() => {
  const d = targetDate.value
  return d ? `${form.value.today ? '오늘 · ' : ''}${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 기준` : ''
})
function useNow() {
  form.value.today = true
  form.value.amount = String(Math.round(currentTotal.value))
}

function submit() {
  touched.value = true
  if (!valid.value || props.saving) return
  emit('submit', { id: props.snapshot?.id, account_id: form.value.account, snap_date: targetDate.value, total_asset: num(form.value.amount), memo: form.value.memo })
}
function onDelete() {
  if (!confirmDelete.value) { confirmDelete.value = true; return }
  emit('delete', props.snapshot)
}
</script>

<template>
  <BaseSheet :open="open" :title="snapshot ? '총 자산 기록 수정' : form.today ? '오늘 총 자산 기록' : '월말 총 자산 입력'" @close="emit('close')">
    <form class="sheet-body" novalidate @submit.prevent="submit">
      <p v-if="snapshot?.source === 'auto'" class="sheet-note">월말에 자동으로 저장된 기록이에요. 고치면 직접 입력한 값으로 바뀌고, 이후 자동 기록이 덮어쓰지 않아요.</p>
      <p v-else-if="form.today" class="sheet-note">지금 화면의 총 자산(주식 평가금액 + 예수금)을 오늘 날짜로 기록해요. 오늘 한 입출금은 이 금액에 이미 들어 있는 것으로 계산하니, 입출금 탭에 먼저 입력해 주세요.</p>
      <p v-else-if="!snapshot" class="sheet-note">증권사 앱에서 그 달 말일의 총 자산(주식 평가금액 + 예수금)을 확인해 입력해 주세요. 입출금은 입출금 탭의 내역으로 계산해요.</p>

      <AccountPicker
        v-if="accounts.length"
        v-model="form.account"
        :accounts="accounts"
        none-label="전체 (모든 계좌 합계)"
        label="대상"
        hint="계좌를 고르면 그 계좌의 총 자산"
        id="snap-account"
      />

      <div v-if="form.today" class="field">
        <span class="field-label">날짜 <span class="field-hint">{{ dateLabel }}</span></span>
        <button type="button" class="link-btn fx-today" @click="form.today = false">월말로 입력</button>
      </div>
      <label v-else class="field">
        <span class="field-label">년 · 월 <span v-if="dateLabel" class="field-hint">{{ dateLabel }}</span></span>
        <div class="field-input"><input v-model="form.month" type="month" :max="snapshot ? thisMonth() : prevMonth()"></div>
        <span v-if="showErr('month')" class="field-error">{{ errors.month }}</span>
        <button v-if="!snapshot && currentTotal > 0" type="button" class="link-btn fx-today" @click="useNow">지금 총 자산으로 기록 ({{ fmt(currentTotal) }}원)</button>
      </label>

      <label class="field">
        <span class="field-label">총 자산 <span v-if="num(form.amount) > 0" class="field-hint">{{ fmt(num(form.amount)) }}원</span></span>
        <div class="field-input"><input v-model="form.amount" inputmode="numeric" placeholder="0" autocomplete="off"><span class="suffix">원</span></div>
        <span v-if="showErr('amount')" class="field-error">{{ errors.amount }}</span>
      </label>

      <label class="field">
        <span class="field-label">메모 <span class="field-hint">선택 · 100자까지</span></span>
        <div class="field-input"><input v-model="form.memo" maxlength="100" placeholder="예: 증권사 앱 월말 잔고" autocomplete="off"></div>
        <span v-if="showErr('memo')" class="field-error">{{ errors.memo }}</span>
      </label>

      <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>

      <div :class="snapshot ? 'btn-row' : ''">
        <button v-if="snapshot" type="button" class="danger-btn" :disabled="saving" @click="onDelete">
          {{ confirmDelete ? '한 번 더 누르면 삭제' : '삭제' }}
        </button>
        <button class="primary-btn" type="submit" :disabled="saving" :style="snapshot ? 'margin-top:0' : 'width:100%'">
          {{ saving ? '저장하는 중…' : '저장' }}
        </button>
      </div>
    </form>
  </BaseSheet>
</template>
