-- =====================================================================
-- 008: 원화·달러 예수금
--
--   총 자산 = 주식 평가금액 + 원화 예수금 + 달러 예수금 × 현재 환율
--   (수익금·수익률은 지금처럼 주식만 기준 — 예수금은 손익 없음)
--
--   여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (007 다음)
-- =====================================================================

-- 1. 예수금 (포트폴리오 × 통화 당 한 줄)
create table if not exists public.cash_balances (
  portfolio_id bigint not null references public.portfolios (id) on delete cascade,
  currency     text   not null references public.exchange_rates (currency)
                      check (currency in ('KRW', 'USD')),
  amount       numeric(18, 2) not null default 0 check (amount >= 0),  -- 통화 단위 (원 / 달러)
  updated_at   timestamptz not null default now(),
  primary key (portfolio_id, currency)
);
comment on table public.cash_balances is '예수금 (원화·달러). 금액은 해당 통화 단위';

drop trigger if exists cash_balances_set_updated_at on public.cash_balances;
create trigger cash_balances_set_updated_at
  before update on public.cash_balances
  for each row execute function public.set_updated_at();


-- 2. 권한: 본인 포트폴리오의 예수금만 (007 과 같은 규칙)
alter table public.cash_balances enable row level security;

drop policy if exists "cash_balances: 본인 읽기" on public.cash_balances;
drop policy if exists "cash_balances: 본인 추가" on public.cash_balances;
drop policy if exists "cash_balances: 본인 수정" on public.cash_balances;
drop policy if exists "cash_balances: 본인 삭제" on public.cash_balances;

create policy "cash_balances: 본인 읽기"
  on public.cash_balances for select to authenticated
  using (exists (select 1 from public.portfolios p
                  where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "cash_balances: 본인 추가"
  on public.cash_balances for insert to authenticated
  with check (exists (select 1 from public.portfolios p
                       where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "cash_balances: 본인 수정"
  on public.cash_balances for update to authenticated
  using (exists (select 1 from public.portfolios p
                  where p.id = portfolio_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p
                       where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "cash_balances: 본인 삭제"
  on public.cash_balances for delete to authenticated
  using (exists (select 1 from public.portfolios p
                  where p.id = portfolio_id and p.owner_id = (select auth.uid())));


-- 3. 요약 뷰에 예수금·총 자산 추가
--    기존 칸(이름·순서·타입)은 그대로, 새 칸은 맨 뒤에 (create or replace view 규칙)
create or replace view public.portfolio_summary
with (security_invoker = true) as
select
  t.portfolio_id,
  t.name,
  t.total_value,                                         -- 주식 총 평가 금액
  t.total_cost,                                          -- 투자 원금
  t.total_value - t.total_cost                           as total_profit,  -- 주식 수익금
  case when t.total_cost = 0 then 0
       else round((t.total_value - t.total_cost) / t.total_cost * 100, 2)
  end                                                    as total_profit_rate, -- 주식 수익률(%)
  t.domestic_value,                                      -- 국내 주식 평가 금액
  t.overseas_value,                                      -- 해외 주식 평가 금액
  t.holding_count,
  -- ----- 008 에서 추가 -----
  c.cash_krw,                                            -- 원화 예수금 (원)
  c.cash_usd,                                            -- 달러 예수금 ($)
  c.cash_usd_krw,                                        -- 달러 예수금 원화 환산 (현재 환율)
  t.total_value + c.cash_krw + c.cash_usd_krw            as total_asset    -- 총 자산
from (
  select
    p.id                                                             as portfolio_id,
    p.name,
    coalesce(sum(v.value_krw), 0)                                    as total_value,
    coalesce(sum(v.cost_krw), 0)                                     as total_cost,
    coalesce(sum(v.value_krw) filter (where v.market = 'KR'), 0)     as domestic_value,
    coalesce(sum(v.value_krw) filter (where v.market = 'US'), 0)     as overseas_value,
    count(v.holding_id)                                              as holding_count
  from public.portfolios p
  left join public.holding_values v on v.portfolio_id = p.id
  group by p.id, p.name
) t
cross join lateral (
  select
    coalesce(sum(cb.amount) filter (where cb.currency = 'KRW'), 0)                         as cash_krw,
    coalesce(sum(cb.amount) filter (where cb.currency = 'USD'), 0)                         as cash_usd,
    coalesce(round(sum(cb.amount * fx.rate_to_krw) filter (where cb.currency = 'USD')), 0) as cash_usd_krw
  from public.cash_balances cb
  join public.exchange_rates fx on fx.currency = cb.currency
  where cb.portfolio_id = t.portfolio_id
) c;


-- Supabase API(PostgREST)가 바뀐 뷰·테이블을 바로 인식하도록 목록 새로고침
notify pgrst, 'reload schema';
