<script setup>
import { ref, nextTick, onBeforeUnmount } from 'vue'
import HoldingItem from './HoldingItem.vue'

const props = defineProps({
  holdings: { type: Array, required: true },
  editing: { type: Boolean, default: false },
  view: { type: String, default: 'value' },       // 'value' 평가 / 'quote' 시세
  charts: { type: Object, default: () => ({}) },  // 시세 보기 그래프 (키: "KR:005930")
})
// reorder: 바뀐 순서(holding_id 배열) → 부모가 DB 에 저장
// delete: 편집 모드에서 삭제 버튼을 누른 종목 / edit: 편집 모드에서 누른 종목
const emit = defineEmits(['reorder', 'delete', 'edit'])

const listEl = ref(null)
let drag = null

// 순서를 바꾼 id 배열 만들기 (from 위치 항목을 to 위치로)
function movedIds(from, to) {
  const ids = props.holdings.map((h) => h.holding_id)
  const [moved] = ids.splice(from, 1)
  ids.splice(to, 0, moved)
  return ids
}

// ===== 드래그 앤 드롭 (마우스 + 터치 공용, Pointer Events) =====
function onPointerDown(e) {
  const handle = e.target.closest('.handle')
  if (!handle || drag) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault()

  const item = handle.closest('.item')
  const items = [...listEl.value.children]
  const from = items.indexOf(item)
  // 페이지 기준 좌표로 저장 (드래그 중 스크롤돼도 계산이 맞도록)
  const slots = items.map((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top + scrollY, h: r.height }
  })

  drag = { item, items, from, to: from, slots, pointerId: e.pointerId,
           startY: e.clientY + scrollY, clientY: e.clientY, raf: 0 }

  handle.setPointerCapture(e.pointerId)
  item.classList.add('dragging')
  document.body.classList.add('sorting')
  if (navigator.vibrate) navigator.vibrate(10)
  drag.raf = requestAnimationFrame(autoScroll)
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return
  drag.clientY = e.clientY
  updateDrag()
}

function updateDrag() {
  const { item, items, from, slots } = drag
  const me = slots[from]
  const first = slots[0].top
  const last = slots[slots.length - 1].top + slots[slots.length - 1].h - me.h

  let dy = drag.clientY + scrollY - drag.startY
  dy = Math.max(first - me.top, Math.min(last - me.top, dy)) // 목록 밖으로 못 나가게
  item.style.transform = `translateY(${dy}px) scale(1.02)`

  // 끌고 있는 카드의 중심보다 위에 있는 다른 카드 수 = 새 위치
  const center = me.top + me.h / 2 + dy
  let to = 0
  slots.forEach((s, i) => { if (i !== from && s.top + s.h / 2 < center) to++ })

  // 사이에 있는 카드들을 한 칸씩 밀어 자리 만들기
  items.forEach((el, i) => {
    if (i === from) return
    let shift = 0
    if (i > from && i <= to) shift = -me.h
    else if (i < from && i >= to) shift = me.h
    el.style.transform = shift ? `translateY(${shift}px)` : ''
  })
  drag.to = to
}

function autoScroll() {
  if (!drag) return
  const edgeTop = 110, edgeBottom = 80
  const y = drag.clientY, h = innerHeight
  let v = 0
  if (y < edgeTop) v = -Math.min(14, (edgeTop - y) / 5)
  else if (y > h - edgeBottom) v = Math.min(14, (y - (h - edgeBottom)) / 5)
  if (v) { scrollBy(0, v); updateDrag() }
  drag.raf = requestAnimationFrame(autoScroll)
}

async function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return
  const { item, items, from, to } = drag
  cancelAnimationFrame(drag.raf)
  drag = null

  const before = item.getBoundingClientRect().top
  listEl.value.classList.add('no-anim')
  items.forEach((el) => (el.style.transform = ''))
  item.classList.remove('dragging')
  document.body.classList.remove('sorting')

  if (to !== from) {
    emit('reorder', movedIds(from, to)) // 부모가 순서를 바꾸면 Vue 가 DOM 을 다시 그림
    await nextTick()
  }

  // 놓은 위치에서 제자리로 부드럽게 내려앉는 애니메이션 (FLIP)
  const after = item.getBoundingClientRect().top
  item.style.transform = `translateY(${before - after}px)`
  void item.offsetHeight
  listEl.value?.classList.remove('no-anim')
  item.style.transform = ''
}

// 키보드로도 순서 변경 (접근성): 손잡이에 포커스 후 ↑ / ↓
async function onKeyDown(e) {
  const handle = e.target.closest('.handle')
  if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  e.preventDefault()
  const item = handle.closest('.item')
  const from = [...listEl.value.children].indexOf(item)
  const to = e.key === 'ArrowUp' ? from - 1 : from + 1
  if (to < 0 || to >= props.holdings.length) return
  emit('reorder', movedIds(from, to))
  await nextTick()
  item.querySelector('.handle').focus()
}

onBeforeUnmount(() => {
  if (drag) cancelAnimationFrame(drag.raf)
  document.body.classList.remove('sorting')
})
</script>

<template>
  <ul
    id="list"
    ref="listEl"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeyDown"
  >
    <HoldingItem
      v-for="h in holdings"
      :key="h.holding_id"
      :holding="h"
      :editing="editing"
      :view="view"
      :chart="charts[`${h.market}:${h.symbol}`] || null"
      @delete="emit('delete', $event)"
      @edit="emit('edit', $event)"
    />
  </ul>
</template>
