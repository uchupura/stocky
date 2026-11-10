-- =====================================================================
-- 019: LOC 날짜별 내역에 합친 방식 매도 수익 저장 (자동매매 탭 [새로고침] · [계산] 때 서버가 저장)
--
--   sell_pnl / sell_pct     : 내 방식 수익 — 판 묶음 매수가 대비 ($ · %)
--   broker_pnl / broker_pct : 증권사 앱 기준 손익 — 평단 대비 ($ · %, 체결로 계산한 평단이라 앱과 몇 달러 다를 수 있음)
--   broker_avg              : 그때 평단
--   withdraw                : 보유가 전부 매도된 날 인출 가능 금액
--   sold_from               : 그날 판 묶음 [{date, qty, price}]
--   lot_sold                : 그날 산 묶음이 언제 팔렸는지 [{qty, soldOn}]
--
--   기존 내역 유지, 여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (018 다음)
-- =====================================================================

alter table public.loc_daily add column if not exists sell_pnl   numeric(14, 2);
alter table public.loc_daily add column if not exists sell_pct   numeric(8, 2);
alter table public.loc_daily add column if not exists broker_pnl numeric(14, 2);
alter table public.loc_daily add column if not exists broker_pct numeric(8, 2);
alter table public.loc_daily add column if not exists broker_avg numeric(14, 4);
alter table public.loc_daily add column if not exists withdraw   numeric(14, 2);
alter table public.loc_daily add column if not exists sold_from  jsonb;
alter table public.loc_daily add column if not exists lot_sold   jsonb;

comment on column public.loc_daily.sell_pnl is '합친 방식 내 방식 수익 (판 묶음 매수가 대비)';
comment on column public.loc_daily.broker_pnl is '증권사 앱 기준 손익 (평단 대비)';

notify pgrst, 'reload schema';
