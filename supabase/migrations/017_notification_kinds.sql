-- =====================================================================
-- 017: 알림 종류 추가 — 'loc_order' (LOC 자동 주문 결과 · 사이클 종료)
--
--   016 의 notifications.kind 는 'refresh' | 'loc_buy' 만 허용 → 'loc_order' 추가
--   여러 번 실행해도 안전, 기존 알림 유지
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (016 다음)
-- =====================================================================

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('refresh', 'loc_buy', 'loc_order'));

notify pgrst, 'reload schema';
