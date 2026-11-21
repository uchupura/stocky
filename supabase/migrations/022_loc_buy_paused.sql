-- =====================================================================
-- 022: LOC 사이클 — 매수 중지
--
--   buy_paused : true 면 매수 주문(① 평단 · ② 신저가 · 1일차)을 하나도 걸지 않음 · 묶음 매도는 그대로
--                자동매매 탭 [매수 중지] / [매수 다시 시작] 버튼으로 바꿈. 기본 false
--
--   기존 사이클 유지, 여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (021 다음)
-- =====================================================================

alter table public.loc_cycles add column if not exists buy_paused boolean not null default false;
comment on column public.loc_cycles.buy_paused is '매수 중지 — 매도만 걸림';

notify pgrst, 'reload schema';
