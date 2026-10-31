<script setup>
import { ref, watch } from 'vue'
import BaseSheet from './BaseSheet.vue'
import { fmt } from '../utils/format'

// 계좌 관리: 이름 변경 · 삭제 (내역이 있는 계좌는 DB 에서 삭제 거부)
const props = defineProps({
  open: { type: Boolean, default: false },
  accounts: { type: Array, default: () => [] },
  principalByAccount: { type: Object, default: () => ({}) },
  busy: { type: Boolean, default: false },
  serverError: { type: String, default: '' },
})
const emit = defineEmits(['close', 'rename', 'delete'])

const names = ref({})
const confirmId = ref(null)
watch(
  () => [props.open, props.accounts],
  () => {
    names.value = Object.fromEntries(props.accounts.map((a) => [a.id, a.name]))
    confirmId.value = null
  },
  { deep: true },
)

const changed = (a) => (names.value[a.id] ?? '').trim() && names.value[a.id].trim() !== a.name
function onDelete(a) {
  if (confirmId.value !== a.id) { confirmId.value = a.id; return }
  emit('delete', a)
}
</script>

<template>
  <BaseSheet :open="open" title="계좌 관리" @close="emit('close')">
    <div class="sheet-body">
      <p v-if="!accounts.length" class="pick-empty">등록된 계좌가 없어요. 입출금을 추가할 때 계좌를 만들 수 있어요.</p>
      <ul v-else class="account-list">
        <li v-for="a in accounts" :key="a.id" class="account-row">
          <div class="field-input">
            <input v-model="names[a.id]" maxlength="30" :aria-label="`${a.name} 계좌 이름`" autocomplete="off">
          </div>
          <span class="account-sum">{{ fmt(principalByAccount[a.id] || 0) }}원</span>
          <button v-if="changed(a)" class="chip-btn primary" :disabled="busy" @click="emit('rename', { id: a.id, name: names[a.id] })">저장</button>
          <button v-else class="chip-btn" :class="{ danger: confirmId === a.id }" :disabled="busy" @click="onDelete(a)">
            {{ confirmId === a.id ? '삭제 확인' : '삭제' }}
          </button>
        </li>
      </ul>
      <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>
    </div>
  </BaseSheet>
</template>
