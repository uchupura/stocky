-- =====================================================================
-- 020: LOC 사이클 — 평단 매수 멈춤 (신저가 매수만)
--
--   low_only : true 면 매일 ① 평단 매수(하루 투자금 절반)를 걸지 않고 ② 신저가 매수만 (하루 투자금 절반)
--              매도 · 1일차(보유 0주) 규칙은 그대로. 기본 false
--
--   기존 사이클 유지, 여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (019 다음)
-- =====================================================================

alter table public.loc_cycles add column if not exists low_only boolean not null default false;
comment on column public.loc_cycles.low_only is '평단 매수 멈춤 — ② 신저가 매수만';

notify pgrst, 'reload schema';
