<script setup>
import BaseSheet from './BaseSheet.vue'

// 알림 목록 — 누르면 읽음 → 사라짐, [모두 읽음]
defineProps({
  open: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  error: { type: String, default: '' },
})
const emit = defineEmits(['close', 'read', 'read-all'])

const ICON = { refresh: '↻', loc_buy: '$', loc_order: '▶' }
function ago(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <BaseSheet :open="open" title="알림" @close="emit('close')">
    <div class="sheet-body">
      <p v-if="error" class="sheet-note">{{ error }}</p>
      <p v-else-if="!items.length" class="noti-empty">새 알림이 없어요</p>
      <template v-else>
        <div class="noti-head">
          <span>안 읽은 알림 {{ items.length }}개 · 누르면 읽음</span>
          <button type="button" class="link-btn" @click="emit('read-all')">모두 읽음</button>
        </div>
        <ul class="noti-list">
          <li v-for="n in items" :key="n.id">
            <button type="button" class="noti-item" @click="emit('read', n.id)">
              <span class="noti-icon" :class="n.kind" aria-hidden="true">{{ ICON[n.kind] || '•' }}</span>
              <span class="noti-main">
                <span class="noti-title"><b>{{ n.title }}</b><time :datetime="n.created_at">{{ ago(n.created_at) }}</time></span>
                <span v-if="n.body" class="noti-body">{{ n.body }}</span>
              </span>
            </button>
          </li>
        </ul>
      </template>
    </div>
  </BaseSheet>
</template>
