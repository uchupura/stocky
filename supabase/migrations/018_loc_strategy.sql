-- =====================================================================
-- 018: LOC 사이클 방식 — 'b'(지금 방식) | 'loop'(합친 방식)
--
--   strategy     : 'b'    = 평단 × (1 + sell_pct) 에 전량 매도 → 사이클 종료
--                  'loop' = 매수는 B 와 같음 · 매도는 들고 있는 묶음 중 가장 싼 묶음을 × (1 + lot_sell_pct) 에 그 수량만큼
--                           신저가 = 가장 싼 묶음 매수가 · 판 돈은 예산에 다시 넣음 · 사이클 종료 없음
--   lot_sell_pct : 합친 방식 묶음 매도 기준 (%) — 기본 5
--   withdraw_pct : 합친 방식에서 보유가 전부 매도될 때 그동안 실현 수익 중 인출할 비율 (%) — 기본 50
--                  (앱은 인출 가능 금액을 알리고 예산에서 뺌 · 실제 출금은 직접)
--
--   기존 사이클은 모두 'b' 로 그대로. 여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (017 다음)
-- =====================================================================

alter table public.loc_cycles add column if not exists strategy text not null default 'b';
alter table public.loc_cycles add column if not exists lot_sell_pct numeric(5, 2) not null default 5;
alter table public.loc_cycles add column if not exists withdraw_pct numeric(5, 2) not null default 50;

alter table public.loc_cycles drop constraint if exists loc_cycles_strategy_check;
alter table public.loc_cycles add constraint loc_cycles_strategy_check check (strategy in ('b', 'loop'));
alter table public.loc_cycles drop constraint if exists loc_cycles_lot_sell_pct_check;
alter table public.loc_cycles add constraint loc_cycles_lot_sell_pct_check check (lot_sell_pct > 0 and lot_sell_pct < 100);
alter table public.loc_cycles drop constraint if exists loc_cycles_withdraw_pct_check;
alter table public.loc_cycles add constraint loc_cycles_withdraw_pct_check check (withdraw_pct >= 0 and withdraw_pct <= 100);

comment on column public.loc_cycles.strategy is 'b = 평단+기준% 전량 매도 / loop = 가장 싼 묶음 +lot_sell_pct% 매도, 판 돈 재투자';
comment on column public.loc_cycles.lot_sell_pct is '합친 방식 묶음 매도 기준 (%)';
comment on column public.loc_cycles.withdraw_pct is '합친 방식 전부 매도 시 실현 수익 중 인출 비율 (%)';

notify pgrst, 'reload schema';
