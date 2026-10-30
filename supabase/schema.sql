-- =====================================================================
-- Stocky 포트폴리오 DB 스키마 (Supabase / Postgres 15+)
--
-- 설계 원칙
--   * 테이블에는 "원본 값"만 저장한다: 보유 수량, 평균 단가, 현재가, 환율
--   * 평가금액 · 수익금 · 수익률 · 합계는 VIEW 에서 계산한다
--     → 현재가/환율이 바뀌어도 값이 서로 어긋나지 않음
--   * 금액은 부동소수 오차가 없는 numeric 사용
--
-- 테이블 관계
--   portfolios 1 ── N holdings N ── 1 stocks N ── 1 exchange_rates(currency)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 환율 (통화 → 원화 환산 비율)
--    KRW 도 rate_to_krw = 1 로 한 행 넣어두면 국내/해외 계산식이 같아진다
-- ---------------------------------------------------------------------
create table public.exchange_rates (
  currency    text primary key check (currency in ('KRW', 'USD')),
  rate_to_krw numeric(12, 4) not null check (rate_to_krw > 0),
  updated_at  timestamptz not null default now()
);
comment on table public.exchange_rates is '통화별 원화 환산 환율 (KRW = 1)';


-- ---------------------------------------------------------------------
-- 2. 종목 (주식 이름, 국내/해외, 현재가)
-- ---------------------------------------------------------------------
create table public.stocks (
  id               bigint generated always as identity primary key,
  symbol           text not null unique,                 -- 예: 005930, AAPL
  name             text not null,                        -- 예: 삼성전자, Apple
  market           text not null check (market in ('KR', 'US')),   -- 국내/해외
  currency         text not null references public.exchange_rates (currency),
  current_price    numeric(18, 4) not null check (current_price >= 0), -- 현지 통화 기준
  price_updated_at timestamptz not null default now(),
  logo_color       text,                                 -- 화면 로고 배경색 (#RRGGBB)
  created_at       timestamptz not null default now(),
  -- 국내 = 원화, 해외(미국) = 달러 조합만 허용
  constraint stocks_market_currency_check check (
    (market = 'KR' and currency = 'KRW') or (market = 'US' and currency = 'USD')
  )
);
comment on table  public.stocks is '종목 마스터';
comment on column public.stocks.market is 'KR = 국내, US = 해외(미국). 화면의 USD 배지 표시 기준';


-- ---------------------------------------------------------------------
-- 3. 포트폴리오
-- ---------------------------------------------------------------------
create table public.portfolios (
  id         bigint generated always as identity primary key,
  name       text not null default '내 포트폴리오',
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 4. 보유 종목 (보유 수량, 평균 단가, 화면 표시 순서)
-- ---------------------------------------------------------------------
create table public.holdings (
  id           bigint generated always as identity primary key,
  portfolio_id bigint not null references public.portfolios (id) on delete cascade,
  stock_id     bigint not null references public.stocks (id) on delete restrict,
  quantity     numeric(20, 6) not null check (quantity > 0),   -- 소수점 주식(해외) 대비
  avg_price    numeric(18, 4) not null check (avg_price >= 0), -- 현지 통화 기준
  sort_order   integer not null default 0,                      -- 드래그 앤 드롭 순서
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (portfolio_id, stock_id)                               -- 같은 종목 중복 보유 방지
);
create index holdings_portfolio_sort_idx on public.holdings (portfolio_id, sort_order);
comment on column public.holdings.sort_order is '작을수록 위에 표시. reorder_holdings() 로 일괄 변경';

-- updated_at 자동 갱신
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger holdings_set_updated_at
  before update on public.holdings
  for each row execute function public.set_updated_at();


-- =====================================================================
-- VIEW: 계산 값
--   security_invoker = true → 뷰를 조회하는 사람 권한으로 실행되어
--   아래 테이블의 RLS 정책이 그대로 적용된다 (Supabase 권장 설정)
-- =====================================================================

-- 종목별: 평가금액, 투자 원금, 수익금, 수익률 (원화 기준)
create view public.holding_values
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
  b.value_krw,                                           -- 평가 금액
  b.cost_krw,                                            -- 투자 원금
  b.value_krw - b.cost_krw                               as profit_krw,  -- 수익금
  case when b.cost_krw = 0 then 0
       else round((b.value_krw - b.cost_krw) / b.cost_krw * 100, 2)
  end                                                    as profit_rate  -- 수익률(%)
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
    round(h.quantity * h.avg_price     * fx.rate_to_krw) as cost_krw
  from public.holdings h
  join public.stocks s          on s.id = h.stock_id
  join public.exchange_rates fx on fx.currency = s.currency
) b;

-- 포트폴리오 요약: 총 평가금액, 총 수익률, 투자 원금, 국내/해외 평가금액
create view public.portfolio_summary
with (security_invoker = true) as
select
  t.portfolio_id,
  t.name,
  t.total_value,                                         -- 총 평가 금액
  t.total_cost,                                          -- 투자 원금
  t.total_value - t.total_cost                           as total_profit,  -- 총 수익금
  case when t.total_cost = 0 then 0
       else round((t.total_value - t.total_cost) / t.total_cost * 100, 2)
  end                                                    as total_profit_rate, -- 총 수익률(%)
  t.domestic_value,                                      -- 국내 주식 평가 금액
  t.overseas_value,                                      -- 해외 주식 평가 금액
  t.holding_count
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
) t;


-- =====================================================================
-- 함수: 드래그 앤 드롭 순서 저장
--   화면에서 바뀐 순서대로 holding id 배열을 넘기면 sort_order 를 한 번에 갱신
--   예) select public.reorder_holdings(1, array[2, 3, 1, 4]);
--   security invoker → 호출한 사람의 RLS 정책이 적용됨
-- =====================================================================
create function public.reorder_holdings(p_portfolio_id bigint, p_holding_ids bigint[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.holdings h
     set sort_order = t.ord
    from unnest(p_holding_ids) with ordinality as t (id, ord)
   where h.id = t.id
     and h.portfolio_id = p_portfolio_id;
$$;


-- =====================================================================
-- RLS (Row Level Security, 행 단위 접근 권한)
--   요청 사항: 누구나 읽기 + 작성 가능
--   → anon(로그인 안 한 사용자), authenticated(로그인 사용자) 모두
--     SELECT / INSERT / UPDATE 허용
--   → DELETE 는 holdings(보유 종목)만 허용, 나머지 테이블은 정책이 없어 차단
--
--   ⚠️ 주의: 사이트 주소와 anon 키만 알면 누구나 데이터를 바꿀 수 있다.
--      목업/데모 용도로만 쓰고, 실제 개인 자산 데이터는 넣지 말 것.
--      실서비스 전환 시 파일 맨 아래 "권장안"으로 교체.
-- =====================================================================
alter table public.exchange_rates enable row level security;
alter table public.stocks         enable row level security;
alter table public.portfolios     enable row level security;
alter table public.holdings       enable row level security;

-- exchange_rates
create policy "exchange_rates: 누구나 읽기"
  on public.exchange_rates for select to anon, authenticated using (true);
create policy "exchange_rates: 누구나 추가"
  on public.exchange_rates for insert to anon, authenticated with check (true);
create policy "exchange_rates: 누구나 수정"
  on public.exchange_rates for update to anon, authenticated using (true) with check (true);

-- stocks
create policy "stocks: 누구나 읽기"
  on public.stocks for select to anon, authenticated using (true);
create policy "stocks: 누구나 추가"
  on public.stocks for insert to anon, authenticated with check (true);
create policy "stocks: 누구나 수정"
  on public.stocks for update to anon, authenticated using (true) with check (true);

-- portfolios
create policy "portfolios: 누구나 읽기"
  on public.portfolios for select to anon, authenticated using (true);
create policy "portfolios: 누구나 추가"
  on public.portfolios for insert to anon, authenticated with check (true);
create policy "portfolios: 누구나 수정"
  on public.portfolios for update to anon, authenticated using (true) with check (true);

-- holdings
create policy "holdings: 누구나 읽기"
  on public.holdings for select to anon, authenticated using (true);
create policy "holdings: 누구나 추가"
  on public.holdings for insert to anon, authenticated with check (true);
create policy "holdings: 누구나 수정"
  on public.holdings for update to anon, authenticated using (true) with check (true);
-- 주식 삭제 기능용 (migrations/002_holdings_delete.sql 과 같은 내용)
create policy "holdings: 누구나 삭제"
  on public.holdings for delete to anon, authenticated using (true);


-- =====================================================================
-- [권장안] 실서비스용: "읽기는 누구나, 쓰기는 본인 포트폴리오만"
--   위 portfolios / holdings 정책 대신 아래를 사용 (로그인 기능 필요)
-- =====================================================================
-- alter table public.portfolios
--   add column owner_id uuid not null default auth.uid() references auth.users (id);
--
-- create policy "portfolios: 본인만 추가" on public.portfolios for insert
--   to authenticated with check ((select auth.uid()) = owner_id);
-- create policy "portfolios: 본인만 수정" on public.portfolios for update
--   to authenticated using ((select auth.uid()) = owner_id)
--   with check ((select auth.uid()) = owner_id);
--
-- create policy "holdings: 본인만 추가" on public.holdings for insert
--   to authenticated with check (exists (
--     select 1 from public.portfolios p
--      where p.id = portfolio_id and p.owner_id = (select auth.uid())));
-- create policy "holdings: 본인만 수정" on public.holdings for update
--   to authenticated using (exists (
--     select 1 from public.portfolios p
--      where p.id = portfolio_id and p.owner_id = (select auth.uid())));
--
-- stocks / exchange_rates 는 시세 데이터이므로 쓰기 정책을 없애고
-- 서버(service_role 키)에서만 갱신하는 것을 권장
