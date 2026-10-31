<script setup>
import { ref, computed, watch } from 'vue'
import BaseSheet from './BaseSheet.vue'
import { fmt } from '../utils/format'
import { todayKST } from '../composables/useDeposits'

// 입출금 추가 · 수정
const props = defineProps({
  open: { type: Boolean, default: false },
  deposit: { type: Object, default: null },        // 수정할 내역 (null 이면 새로 추가)
  accounts: { type: Array, default: () => [] },
  defaultAccountId: { type: Number, default: null }, // 목록에서 고른 계좌 필터
  addAccount: { type: Function, required: true },   // (이름) => Promise<계좌>
  saving: { type: Boolean, default: false },
  serverError: { type: String, default: '' },
})
const emit = defineEmits(['close', 'submit', 'delete'])

const form = ref(blank())
const touched = ref(false)
const confirmDelete = ref(false)
const newAccount = ref({ open: false, name: '', error: '', saving: false })

function blank() {
  return { kind: 'deposit', amount: '', account_id: null, txn_date: todayKST(), memo: '' }
}

watch(
  () => props.open,
  (o) => {
    if (!o) return
    const d = props.deposit
    form.value = d
      ? { kind: d.kind, amount: String(d.amount), account_id: d.account_id, txn_date: d.txn_date, memo: d.memo || '' }
      : { ...blank(), account_id: props.defaultAccountId ?? props.accounts[0]?.id ?? null }
    touched.value = false
    confirmDelete.value = false
    newAccount.value = { open: !props.accounts.length, name: '', error: '', saving: false } // 계좌가 없으면 바로 추가 칸
  },
)

const num = (v) => (String(v).trim() === '' ? NaN : Number(String(v).replace(/,/g, '').trim()))
const errors = computed(() => {
  const e = {}
  const a = num(form.value.amount)
  if (!(a > 0) || !Number.isInteger(a)) e.amount = '1원 이상의 금액을 숫자로 입력해 주세요'
  if (!form.value.account_id) e.account = '계좌를 골라 주세요'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.value.txn_date)) e.date = '날짜를 골라 주세요'
  if (form.value.memo.length > 100) e.memo = '메모는 100자까지예요'
  return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)
const showErr = (k) => touched.value && errors.value[k]
const amountPreview = computed(() => (num(form.value.amount) > 0 ? `${form.value.kind === 'deposit' ? '+' : '−'}${fmt(num(form.value.amount))}원` : ''))

async function createAccount() {
  const name = newAccount.value.name.trim()
  if (!name) { newAccount.value.error = '계좌 이름을 입력해 주세요'; return }
  if (name.length > 30) { newAccount.value.error = '30자까지 입력할 수 있어요'; return }
  newAccount.value.saving = true
  newAccount.value.error = ''
  try {
    const acc = await props.addAccount(name)
    form.value.account_id = acc.id
    newAccount.value = { open: false, name: '', error: '', saving: false }
  } catch (e) {
    newAccount.value.error = e.message
    newAccount.value.saving = false
  }
}

function submit() {
  touched.value = true
  if (!valid.value || props.saving) return
  emit('submit', {
    id: props.deposit?.id,
    kind: form.value.kind,
    amount: num(form.value.amount),
    account_id: form.value.account_id,
    txn_date: form.value.txn_date,
    memo: form.value.memo,
  })
}
function onDelete() {
  if (!confirmDelete.value) { confirmDelete.value = true; return }
  emit('delete', props.deposit)
}
</script>

<template>
  <BaseSheet :open="open" :title="deposit ? '입출금 수정' : '입출금 추가'" @close="emit('close')">
    <form class="sheet-body" novalidate @submit.prevent="submit">
      <div class="segment" role="radiogroup" aria-label="입금 또는 출금">
        <button type="button" role="radio" :aria-checked="form.kind === 'deposit'" :class="{ on: form.kind === 'deposit' }" @click="form.kind = 'deposit'">입금</button>
        <button type="button" role="radio" :aria-checked="form.kind === 'withdraw'" :class="{ on: form.kind === 'withdraw' }" @click="form.kind = 'withdraw'">출금</button>
      </div>

      <label class="field">
        <span class="field-label">금액 <span v-if="amountPreview" class="field-hint">{{ amountPreview }}</span></span>
        <div class="field-input"><input v-model="form.amount" inputmode="numeric" placeholder="0" autocomplete="off"><span class="suffix">원</span></div>
        <span v-if="showErr('amount')" class="field-error">{{ errors.amount }}</span>
      </label>

      <div class="field">
        <label class="field-label" for="dep-account">계좌</label>
        <div v-if="accounts.length" class="field-input">
          <select id="dep-account" v-model="form.account_id" class="field-select">
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
        <span v-if="showErr('account')" class="field-error">{{ errors.account }}</span>
        <button v-if="!newAccount.open" type="button" class="link-btn fx-today" @click="newAccount.open = true">+ 새 계좌</button>
        <div v-else class="new-account">
          <div class="field-input">
            <input v-model="newAccount.name" placeholder="예: 한국투자 위탁, ISA" maxlength="30" autocomplete="off" @keydown.enter.prevent="createAccount">
          </div>
          <button type="button" class="chip-btn primary" :disabled="newAccount.saving" @click="createAccount">{{ newAccount.saving ? '추가 중…' : '계좌 추가' }}</button>
        </div>
        <span v-if="newAccount.error" class="field-error">{{ newAccount.error }}</span>
      </div>

      <label class="field">
        <span class="field-label">일자</span>
        <div class="field-input"><input v-model="form.txn_date" type="date" :max="todayKST()"></div>
        <span v-if="showErr('date')" class="field-error">{{ errors.date }}</span>
      </label>

      <label class="field">
        <span class="field-label">메모 <span class="field-hint">선택 · 100자까지</span></span>
        <div class="field-input"><input v-model="form.memo" maxlength="100" placeholder="예: 월급 투자" autocomplete="off"></div>
        <span v-if="showErr('memo')" class="field-error">{{ errors.memo }}</span>
      </label>

      <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>

      <div :class="deposit ? 'btn-row' : ''">
        <button v-if="deposit" type="button" class="danger-btn" :disabled="saving" @click="onDelete">
          {{ confirmDelete ? '한 번 더 누르면 삭제' : '삭제' }}
        </button>
        <button class="primary-btn" type="submit" :disabled="saving" :style="deposit ? 'margin-top:0' : 'width:100%'">
          {{ saving ? '저장하는 중…' : '저장' }}
        </button>
      </div>
    </form>
  </BaseSheet>
</template>
