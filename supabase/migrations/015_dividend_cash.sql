-- =====================================================================
-- 015: 배당 → 예수금 자동 반영 여부
--
--   dividends.cash_applied : 이 배당 금액을 그 계좌 예수금(cash_balances)에 더했는지
--     배당을 추가할 때 "예수금에도 반영"을 켜면 true (한국 배당 = 원화, 미국 배당 = 달러 예수금)
--     수정·삭제할 때 true 였던 배당만 예수금을 되돌림 — 기존 배당은 모두 false 로 시작
--
--   여러 번 실행해도 안전, 기존 데이터 유지
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (014 다음)
-- =====================================================================

alter table public.dividends add column if not exists cash_applied boolean not null default false;
comment on column public.dividends.cash_applied is '배당 금액을 그 계좌 예수금에 반영했는지 (수정·삭제 시 되돌림 기준)';

notify pgrst, 'reload schema';
