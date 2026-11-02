<script setup>
import { ref, computed } from 'vue'

// 계좌 선택 칸 (+ 새 계좌) — 주식 추가·수정, 예수금, 월말 자산 입력에서 함께 사용
//   v-model = 계좌 id (null = noneLabel 항목: "계좌 미지정" / "전체")
const props = defineProps({
  modelValue: { type: Number, default: null },
  accounts: { type: Array, default: () => [] },
  addAccount: { type: Function, default: null }, // (이름) => Promise<계좌>, 없으면 "+ 새 계좌" 숨김
  noneLabel: { type: String, default: '계좌 미지정' },
  label: { type: String, default: '계좌' },
  hint: { type: String, default: '' },
  id: { type: String, default: 'account-picker' },
})
const emit = defineEmits(['update:modelValue'])

const value = computed({
  get: () => (props.modelValue == null ? '' : String(props.modelValue)),
  set: (v) => emit('update:modelValue', v === '' ? null : Number(v)),
})

const adding = ref({ open: false, name: '', error: '', saving: false })
async function create() {
  const name = adding.value.name.trim()
  if (!name) { adding.value.error = '계좌 이름을 입력해 주세요'; return }
  if (name.length > 30) { adding.value.error = '30자까지 입력할 수 있어요'; return }
  adding.value.saving = true
  adding.value.error = ''
  try {
    const acc = await props.addAccount(name)
    emit('update:modelValue', acc.id)
    adding.value = { open: false, name: '', error: '', saving: false }
  } catch (e) {
    adding.value.error = e.message
    adding.value.saving = false
  }
}
</script>

<template>
  <div class="field">
    <label class="field-label" :for="id">{{ label }} <span v-if="hint" class="field-hint">{{ hint }}</span></label>
    <div class="field-input">
      <select :id="id" v-model="value" class="field-select">
        <option value="">{{ noneLabel }}</option>
        <option v-for="a in accounts" :key="a.id" :value="String(a.id)">{{ a.name }}</option>
      </select>
    </div>
    <template v-if="addAccount">
      <button v-if="!adding.open" type="button" class="link-btn fx-today" @click="adding.open = true">+ 새 계좌</button>
      <div v-else class="new-account">
        <div class="field-input">
          <input v-model="adding.name" placeholder="예: 한국투자 위탁, ISA" maxlength="30" autocomplete="off" @keydown.enter.prevent="create">
        </div>
        <button type="button" class="chip-btn primary" :disabled="adding.saving" @click="create">{{ adding.saving ? '추가 중…' : '계좌 추가' }}</button>
      </div>
      <span v-if="adding.error" class="field-error">{{ adding.error }}</span>
    </template>
  </div>
</template>
