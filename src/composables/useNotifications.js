import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'

// 알림 (016) — 서버가 만들고, 화면은 안 읽은 것만 보여줌. 누르면 읽음(read_at) → 목록에서 사라짐
export function useNotifications(portfolioId) {
  const items = ref([])
  const error = ref('')
  const unread = computed(() => items.value.length)

  async function load() {
    if (!portfolioId.value) return
    const { data, error: e } = await supabase.from('notifications').select('id, kind, title, body, data, created_at')
      .eq('portfolio_id', portfolioId.value).is('read_at', null)
      .order('created_at', { ascending: false }).limit(50)
    if (e) {
      // 016 적용 전이면 알림 없이 조용히 (아이콘은 그대로)
      error.value = /notifications/.test(e.message || '') ? '알림을 쓰려면 016_notifications.sql 을 먼저 실행해 주세요.' : e.message
      items.value = []
      return
    }
    error.value = ''
    items.value = data
  }

  async function markRead(ids) {
    if (!ids.length) return
    const before = items.value
    items.value = items.value.filter((n) => !ids.includes(n.id)) // 바로 사라지게
    const { error: e } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    if (e) { items.value = before; throw new Error('읽음 표시를 하지 못했어요.') }
  }
  const read = (id) => markRead([id])
  const readAll = () => markRead(items.value.map((n) => n.id))

  return { items, unread, error, load, read, readAll }
}
