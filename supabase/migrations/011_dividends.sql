-- =====================================================================
-- 011: 배당금 내역 + 날짜별 환율 + 월별/연도별 집계 (홈 탭 그래프 대비)
--
--   dividends        : 배당 (종목, 받은 금액(세후, 받은 통화 그대로), 지급일 환율, 원화 환산액, 계좌, 지급일, 메모)
--                      국내 = 원 · 환율 1 / 미국 = 달러 · 지급일 원/달러 환율
--                      amount_krw = round(amount × fx_rate) — DB 가 자동 계산 (지급일 가치로 고정)
--   fx_daily         : 날짜별 원/달러 환율 (KIS FX@KRW 종가) — 서버(service_role)만 쓰기, 로그인 사용자 읽기
--   dividend_monthly : 월별 배당 합계   ┐ 홈 탭 그래프용 (월별·연도별·전체 누적)
--   dividend_yearly  : 연도별 배당 합계 ┘ 전체 누적 = dividend_yearly 의 합
--
--   여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (010 다음)
-- =====================================================================

-- 1. 날짜별 환율
create table if not exists public.fx_daily (
  currency   text not null check (currency in ('USD')),
  rate_date  date not null,                  -- 환율 기준일 (영업일)
  rate       numeric(12, 4) not null check (rate > 0),   -- 원/외화 (종가)
  fetched_at timestamptz not null default now(),
  primary key (currency, rate_date)
);
comment on table public.fx_daily is '날짜별 원/달러 환율 (KIS 해외 환율 기간별시세 FX@KRW 종가). 서버만 쓰기';

alter table public.fx_daily enable row level security;
drop policy if exists "fx_daily: 로그인 읽기" on public.fx_daily;
create policy "fx_daily: 로그인 읽기" on public.fx_daily for select to authenticated using (true);
-- 쓰기 정책 없음 → service_role(서버)만 저장


-- 2. 배당금
create table if not exists public.dividends (
  id           bigint generated always as identity primary key,
  portfolio_id bigint not null references public.portfolios (id) on delete cascade,
  account_id   bigint not null,
  symbol       text   not null check (length(btrim(symbol)) between 1 and 20),    -- 005930, AAPL
  market       text   not null check (market in ('KR', 'US')),
  stock_name   text   not null check (length(btrim(stock_name)) between 1 and 100), -- 입력 당시 종목 이름
  currency     text   not null check (currency in ('KRW', 'USD')),
  amount       numeric(18, 2) not null check (amount > 0),     -- 받은 금액 (세후, 받은 통화 단위)
  fx_rate      numeric(12, 4) not null default 1 check (fx_rate > 0),  -- 원/외화 (국내는 1)
  fx_date      date,                                           -- 적용한 환율의 기준일 (미국 주식)
  amount_krw   numeric(18, 0) generated always as (round(amount * fx_rate)) stored,  -- 원화 환산액
  pay_date     date   not null default ((now() at time zone 'Asia/Seoul')::date),
  memo         text   check (memo is null or length(memo) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 국내 = 원·환율 1·정수 금액 / 미국 = 달러
  constraint dividends_market_currency_check check (
    (market = 'KR' and currency = 'KRW' and fx_rate = 1 and amount = round(amount))
    or (market = 'US' and currency = 'USD')
  ),
  -- 계좌는 같은 포트폴리오의 것 (입출금 계좌 공용). 내역이 있으면 계좌 삭제 불가
  foreign key (account_id, portfolio_id) references public.accounts (id, portfolio_id)
);
comment on table public.dividends is '배당금 (세후). amount_krw = 지급일 환율 기준 원화 환산액';

create index if not exists dividends_portfolio_date_idx on public.dividends (portfolio_id, pay_date desc, id desc);
create index if not exists dividends_account_idx on public.dividends (account_id);

drop trigger if exists dividends_set_updated_at on public.dividends;
create trigger dividends_set_updated_at
  before update on public.dividends
  for each row execute function public.set_updated_at();

alter table public.dividends enable row level security;
drop policy if exists "dividends: 본인 읽기" on public.dividends;
drop policy if exists "dividends: 본인 추가" on public.dividends;
drop policy if exists "dividends: 본인 수정" on public.dividends;
drop policy if exists "dividends: 본인 삭제" on public.dividends;
create policy "dividends: 본인 읽기" on public.dividends for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "dividends: 본인 추가" on public.dividends for insert to authenticated
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "dividends: 본인 수정" on public.dividends for update to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "dividends: 본인 삭제" on public.dividends for delete to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));


-- 3. 집계 뷰 (홈 탭 그래프용) — security_invoker: 조회하는 사람의 RLS 적용 (본인 것만)
create or replace view public.dividend_monthly
with (security_invoker = true) as
select
  d.portfolio_id,
  d.month,                                            -- 그 달 1일 (그래프 가로축)
  extract(year  from d.month)::int                    as year,
  extract(month from d.month)::int                    as month_no,
  sum(d.amount_krw)                                   as amount_krw,   -- 원화 환산 합계
  coalesce(sum(d.amount_krw) filter (where d.market = 'KR'), 0) as domestic_krw,
  coalesce(sum(d.amount_krw) filter (where d.market = 'US'), 0) as overseas_krw,
  coalesce(sum(d.amount)     filter (where d.currency = 'USD'), 0) as amount_usd,   -- 받은 달러 합계
  count(*)                                            as count
from (
  select x.*, date_trunc('month', x.pay_date)::date as month from public.dividends x
) d
group by d.portfolio_id, d.month;

create or replace view public.dividend_yearly
with (security_invoker = true) as
select
  d.portfolio_id,
  extract(year from d.pay_date)::int                  as year,
  sum(d.amount_krw)                                   as amount_krw,
  coalesce(sum(d.amount_krw) filter (where d.market = 'KR'), 0) as domestic_krw,
  coalesce(sum(d.amount_krw) filter (where d.market = 'US'), 0) as overseas_krw,
  coalesce(sum(d.amount)     filter (where d.currency = 'USD'), 0) as amount_usd,
  count(*)                                            as count
from public.dividends d
group by d.portfolio_id, extract(year from d.pay_date);


-- Supabase API(PostgREST)가 새 테이블·뷰를 바로 인식하도록 목록 새로고침
notify pgrst, 'reload schema';
