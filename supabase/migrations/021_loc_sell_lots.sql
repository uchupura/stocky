-- =====================================================================
-- 021: LOC 사이클 — 하루에 매도를 걸 묶음 수 (합친 방식)
--
--   sell_lots : 들고 있는 묶음 중 가장 싼 묶음 몇 개까지 매도를 걸지 (1 ~ 3, 기본 1)
--               묶음마다 각자 매수가 × (1 + lot_sell_pct) 에 그 수량만큼 LOC 매도 (주문 따로)
--
--   기존 사이클은 1 그대로, 여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (020 다음)
-- =====================================================================

alter table public.loc_cycles add column if not exists sell_lots integer not null default 1;
alter table public.loc_cycles drop constraint if exists loc_cycles_sell_lots_check;
alter table public.loc_cycles add constraint loc_cycles_sell_lots_check check (sell_lots between 1 and 3);
comment on column public.loc_cycles.sell_lots is '합친 방식 — 하루에 매도를 걸 묶음 수 (가장 싼 순, 1~3)';

notify pgrst, 'reload schema';
