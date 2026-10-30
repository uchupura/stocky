-- =====================================================================
-- 006: 매수 환율(환차익) 반영 + 달러 기준 수익
--
--   해외 주식 계산 (원화)
--     평가금액 = 수량 × 현재가($)   × 현재 환율
--     투자원금 = 수량 × 평균 단가($) × 매수 환율   ← holdings.avg_fx_rate (비어 있으면 현재 환율)
--     수익금   = 평가금액 − 투자원금                 ← 환차익·환차손 포함
--   달러 기준 (현지 통화): value_local / cost_local / profit_local / profit_rate_local
--   국내 주식은 환율 1 (avg_fx_rate 사용 안 함)
--
--   여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

-- 1. 보유 종목에 매수 환율 칸 추가
alter table public.holdings
  add column if not exists avg_fx_rate numeric(12, 4);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'holdings_avg_fx_rate_check') then
    alter table public.holdings
      add constraint holdings_avg_fx_rate_check check (avg_fx_rate is null or avg_fx_rate > 0);
  end if;
end $$;

comment on column public.holdings.avg_fx_rate is
  '해외 주식 매수 환율 (원/외화). 비어 있으면 현재 환율로 대신 계산 → 환차익 0';


-- 2. 종목별 계산 뷰
--    기존 칸(이름·순서·타입)은 그대로, 새 칸은 맨 뒤에 추가 (create or replace view 규칙)
create or replace view public.holding_values
with (security_invoker = true) as
select
  b.holding_id,
  b.portfolio_id,
  b.sort_order,
  b.stock_id,
  b.symbol,
  b.name,
  b.market,
  b.market = 'US'                                        as is_overseas,
  b.currency,
  b.quantity,
  b.avg_price,                                           -- 현지 통화
  b.current_price,                                       -- 현지 통화
  b.value_krw,                                           -- 평가 금액 (현재 환율)
  b.cost_krw,                                            -- 투자 원금 (매수 환율)
  b.value_krw - b.cost_krw                               as profit_krw,   -- 수익금 (환차익 포함)
  case when b.cost_krw = 0 then 0
       else round((b.value_krw - b.cost_krw) / b.cost_krw * 100, 2)
  end                                                    as profit_rate,  -- 수익률(%) 원화 기준
  -- ----- 006 에서 추가 -----
  b.avg_fx_rate,                                         -- 매수 환율 (입력값, 없으면 null)
  b.fx_rate,                                             -- 현재 환율
  b.market = 'US' and b.avg_fx_rate is null              as fx_missing,   -- 매수 환율 미입력
  b.value_local,                                         -- 평가 금액 (현지 통화)
  b.cost_local,                                          -- 투자 원금 (현지 통화)
  b.value_local - b.cost_local                           as profit_local, -- 수익금 (현지 통화)
  case when b.cost_local = 0 then 0
       else round((b.value_local - b.cost_local) / b.cost_local * 100, 2)
  end                                                    as profit_rate_local -- 수익률(%) 현지 통화 기준
from (
  select
    h.id            as holding_id,
    h.portfolio_id,
    h.sort_order,
    s.id            as stock_id,
    s.symbol,
    s.name,
    s.market,
    s.currency,
    h.quantity,
    h.avg_price,
    s.current_price,
    round(h.quantity * s.current_price * fx.rate_to_krw) as value_krw,
    round(h.quantity * h.avg_price
          * case when s.currency = 'KRW' then 1 else coalesce(h.avg_fx_rate, fx.rate_to_krw) end) as cost_krw,
    case when s.currency = 'KRW' then null else h.avg_fx_rate end as avg_fx_rate,
    fx.rate_to_krw  as fx_rate,
    h.quantity * s.current_price as value_local,
    h.quantity * h.avg_price     as cost_local
  from public.holdings h
  join public.stocks s          on s.id = h.stock_id
  join public.exchange_rates fx on fx.currency = s.currency
) b;

-- portfolio_summary 는 holding_values 의 cost_krw 합계를 쓰므로 자동으로 매수 환율이 반영됨


-- Supabase API(PostgREST)가 바뀐 뷰를 바로 인식하도록 목록 새로고침
notify pgrst, 'reload schema';
