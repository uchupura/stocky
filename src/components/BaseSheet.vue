<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

// 모바일: 아래에서 올라오는 시트 / 데스크톱: 가운데 창
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const panel = ref(null)

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  async (open) => {
    document.body.classList.toggle('sheet-open', open) // 뒤 화면 스크롤 막기
    if (open) {
      document.addEventListener('keydown', onKey)
      await nextTick()
      // 첫 입력칸(없으면 창 자체)에 포커스
      const first = panel.value?.querySelector('input, button:not(.sheet-close)')
      ;(first || panel.value)?.focus()
    } else {
      document.removeEventListener('keydown', onKey)
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.classList.remove('sheet-open')
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="sheet-backdrop" @click.self="emit('close')">
        <div ref="panel" class="sheet" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
          <div class="sheet-head">
            <h3>{{ title }}</h3>
            <button class="sheet-close" aria-label="닫기" @click="emit('close')">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
