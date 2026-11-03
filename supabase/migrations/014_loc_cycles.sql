-- =====================================================================
-- 014: LOC 분할매수 사이클 설정 · 날짜별 내역 (자동매매 탭)
--
--   loc_cycles : 사이클 설정 — 종목, 총 투자금, 분할 횟수(하루 투자금 = 총 ÷ 분할), 시작일, 매도 기준,
--                제외할 주문번호(실수 거래 등), 상태(진행/종료) + 종료 결과
--                진행 중 사이클은 포트폴리오당 1개
--   loc_daily  : 날짜별 내역 — 종가, 매수·매도 수량·금액, 누적 보유·누적 쓴 금액
--                [계산] 때 서버가 증권사 체결·일봉으로 다시 계산해 덮어씀 (service_role)
--
--   권한: 본인 포트폴리오 것만. loc_daily 는 읽기만 (쓰기는 서버)
--   여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (013 다음)
-- =====================================================================

create table if not exists public.loc_cycles (
  id                bigint generated always as identity primary key,
  portfolio_id      bigint not null references public.portfolios (id) on delete cascade,
  symbol            text   not null check (symbol ~ '^[A-Z.]{1,10}$'),
  budget            numeric(14, 2) not null check (budget > 0),            -- 총 투자금 ($)
  splits            integer not null check (splits > 0),                   -- 분할 횟수
  start_date        date   not null,                                       -- 사이클 시작일
  sell_pct          numeric(5, 2) not null default 10 check (sell_pct > 0 and sell_pct < 100), -- 매도 기준 (%)
  exclude_order_nos text[] not null default '{}',                          -- 계산에서 뺄 주문번호
  status            text   not null default 'active' check (status in ('active', 'ended')),
  -- 종료 결과 (전량 매도 확인 시)
  ended_on          date,
  sold_qty          integer,
  sold_amount       numeric(14, 2),
  bought_amount     numeric(14, 2),
  realized_pnl      numeric(14, 2),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.loc_cycles is 'LOC 분할매수 사이클 설정. 하루 투자금 = budget ÷ splits';

-- 진행 중 사이클은 포트폴리오당 하나
create unique index if not exists loc_cycles_one_active on public.loc_cycles (portfolio_id) where status = 'active';
create index if not exists loc_cycles_portfolio_idx on public.loc_cycles (portfolio_id, start_date desc);

drop trigger if exists loc_cycles_set_updated_at on public.loc_cycles;
create trigger loc_cycles_set_updated_at
  before update on public.loc_cycles
  for each row execute function public.set_updated_at();


create table if not exists public.loc_daily (
  cycle_id    bigint not null references public.loc_cycles (id) on delete cascade,
  trade_date  date   not null,
  close       numeric(14, 4),                 -- 그날 종가 (일봉)
  buy_qty     integer not null default 0,
  buy_amount  numeric(14, 2) not null default 0,
  sell_qty    integer not null default 0,
  sell_amount numeric(14, 2) not null default 0,
  cum_qty     integer not null default 0,     -- 누적 보유
  cum_spent   numeric(14, 2) not null default 0, -- 누적 쓴 금액 (매수 합계)
  updated_at  timestamptz not null default now(),
  primary key (cycle_id, trade_date)
);
comment on table public.loc_daily is 'LOC 사이클 날짜별 내역 — 서버가 증권사 체결·일봉으로 계산해 저장';


-- 권한
alter table public.loc_cycles enable row level security;
alter table public.loc_daily  enable row level security;

do $$
declare op text;
begin
  foreach op in array array['읽기', '추가', '수정', '삭제'] loop
    execute format('drop policy if exists %I on public.loc_cycles', 'loc_cycles: 본인 ' || op);
  end loop;
  execute 'drop policy if exists "loc_daily: 본인 읽기" on public.loc_daily';
end $$;

create policy "loc_cycles: 본인 읽기" on public.loc_cycles for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "loc_cycles: 본인 추가" on public.loc_cycles for insert to authenticated
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "loc_cycles: 본인 수정" on public.loc_cycles for update to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "loc_cycles: 본인 삭제" on public.loc_cycles for delete to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));

-- 날짜별 내역은 읽기만 (쓰기는 서버 service_role)
create policy "loc_daily: 본인 읽기" on public.loc_daily for select to authenticated
  using (exists (select 1 from public.loc_cycles c join public.portfolios p on p.id = c.portfolio_id
                 where c.id = cycle_id and p.owner_id = (select auth.uid())));


notify pgrst, 'reload schema';
