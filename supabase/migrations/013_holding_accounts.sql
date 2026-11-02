-- =====================================================================
-- 013: 보유 주식 · 예수금 · 월말 기록에 계좌 지정 (계좌별 보기 · 계좌별 수익률)
--
--   계좌 = 010 의 accounts (입출금 탭에서 만든 계좌)
--   account_id 가 비어 있으면(null) = "계좌 미지정" — 기존 데이터는 모두 미지정으로 시작
--
--   holdings        : 같은 종목도 계좌별로 한 줄씩 (포트폴리오+종목+계좌 중복 불가, 미지정도 종목당 1줄)
--   cash_balances   : 계좌별 원화·달러 예수금 (포트폴리오+계좌+통화 중복 불가)
--   asset_snapshots : 계좌별 월말 총 자산. account_id 가 비어 있으면 = 포트폴리오 전체
--   holding_values  : account_id 칸 추가 (맨 뒤). portfolio_summary 합계는 그대로
--
--   계좌는 반드시 같은 포트폴리오의 것 (010 과 같은 방식)
--   보유 주식·예수금이 남은 계좌는 삭제 불가, 월말 기록은 계좌와 함께 삭제
--   권한(RLS)은 기존 정책 그대로 (포트폴리오 주인만)
--
--   여러 번 실행해도 안전, 기존 데이터 유지
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (012 다음)
--   필요: PostgreSQL 15 이상 (unique nulls not distinct)
-- =====================================================================

-- 1. 보유 주식
alter table public.holdings add column if not exists account_id bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'holdings_account_fkey') then
    alter table public.holdings
      add constraint holdings_account_fkey
      foreign key (account_id, portfolio_id) references public.accounts (id, portfolio_id);
  end if;
  -- 같은 종목 1줄 → 계좌별 1줄
  if exists (select 1 from pg_constraint where conname = 'holdings_portfolio_id_stock_id_key') then
    alter table public.holdings drop constraint holdings_portfolio_id_stock_id_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'holdings_portfolio_stock_account_key') then
    alter table public.holdings
      add constraint holdings_portfolio_stock_account_key
      unique nulls not distinct (portfolio_id, stock_id, account_id);
  end if;
end $$;
create index if not exists holdings_account_idx on public.holdings (account_id);
comment on column public.holdings.account_id is '계좌 (accounts). 비어 있으면 계좌 미지정';


-- 2. 예수금
alter table public.cash_balances add column if not exists account_id bigint;

do $$
begin
  -- 기본키 (포트폴리오, 통화) → 일련번호 + 중복 규칙 (포트폴리오, 계좌, 통화)
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'cash_balances' and column_name = 'id') then
    alter table public.cash_balances drop constraint if exists cash_balances_pkey;
    alter table public.cash_balances add column id bigint generated always as identity primary key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cash_balances_account_fkey') then
    alter table public.cash_balances
      add constraint cash_balances_account_fkey
      foreign key (account_id, portfolio_id) references public.accounts (id, portfolio_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cash_balances_portfolio_account_currency_key') then
    alter table public.cash_balances
      add constraint cash_balances_portfolio_account_currency_key
      unique nulls not distinct (portfolio_id, account_id, currency);
  end if;
end $$;
create index if not exists cash_balances_account_idx on public.cash_balances (account_id);
comment on column public.cash_balances.account_id is '계좌 (accounts). 비어 있으면 계좌 미지정';


-- 3. 월말 총 자산 기록
alter table public.asset_snapshots add column if not exists account_id bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asset_snapshots_account_fkey') then
    alter table public.asset_snapshots
      add constraint asset_snapshots_account_fkey
      foreign key (account_id, portfolio_id) references public.accounts (id, portfolio_id) on delete cascade;
  end if;
  if exists (select 1 from pg_constraint where conname = 'asset_snapshots_portfolio_id_snap_date_key') then
    alter table public.asset_snapshots drop constraint asset_snapshots_portfolio_id_snap_date_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'asset_snapshots_portfolio_date_account_key') then
    alter table public.asset_snapshots
      add constraint asset_snapshots_portfolio_date_account_key
      unique nulls not distinct (portfolio_id, snap_date, account_id);
  end if;
end $$;
create index if not exists asset_snapshots_account_idx on public.asset_snapshots (account_id);
comment on column public.asset_snapshots.account_id is '계좌 (accounts). 비어 있으면 포트폴리오 전체 기록';


-- 4. holding_values 에 account_id 추가 (기존 칸 그대로, 새 칸은 맨 뒤 — create or replace view 규칙)
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
  b.avg_price,
  b.current_price,
  b.value_krw,
  b.cost_krw,
  b.value_krw - b.cost_krw                               as profit_krw,
  case when b.cost_krw = 0 then 0
       else round((b.value_krw - b.cost_krw) / b.cost_krw * 100, 2)
  end                                                    as profit_rate,
  b.avg_fx_rate,
  b.fx_rate,
  b.market = 'US' and b.avg_fx_rate is null              as fx_missing,
  b.value_local,
  b.cost_local,
  b.value_local - b.cost_local                           as profit_local,
  case when b.cost_local = 0 then 0
       else round((b.value_local - b.cost_local) / b.cost_local * 100, 2)
  end                                                    as profit_rate_local,
  -- ----- 013 에서 추가 -----
  b.account_id                                           -- 계좌 (비어 있으면 미지정)
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
    h.quantity * h.avg_price     as cost_local,
    h.account_id
  from public.holdings h
  join public.stocks s          on s.id = h.stock_id
  join public.exchange_rates fx on fx.currency = s.currency
) b;


notify pgrst, 'reload schema';
