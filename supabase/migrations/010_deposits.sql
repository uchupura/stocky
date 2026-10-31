-- =====================================================================
-- 010: 입출금 내역 (계좌 직접 추가, 원화만)
--
--   accounts : 계좌 (예: 한국투자 위탁, ISA) — 포트폴리오별, 이름 중복 불가
--   deposits : 입출금 (계좌, 입금/출금, 금액(원), 일자, 메모)
--   누적 원금 = 총 입금 − 총 출금 (화면에서 계산)
--
--   권한: 본인 포트폴리오 것만 읽기·쓰기 (007 과 같은 규칙)
--   내역이 있는 계좌는 삭제 불가 (포트폴리오를 지우면 계좌·내역도 함께 삭제)
--
--   여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (009 다음)
-- =====================================================================

-- 1. 계좌
create table if not exists public.accounts (
  id           bigint generated always as identity primary key,
  portfolio_id bigint not null references public.portfolios (id) on delete cascade,
  name         text   not null check (length(btrim(name)) between 1 and 30),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (portfolio_id, name),
  unique (id, portfolio_id)            -- deposits 가 "같은 포트폴리오의 계좌"만 가리키도록
);
comment on table public.accounts is '입출금 계좌 (사용자가 직접 추가)';


-- 2. 입출금
create table if not exists public.deposits (
  id           bigint generated always as identity primary key,
  portfolio_id bigint not null references public.portfolios (id) on delete cascade,
  account_id   bigint not null,
  kind         text   not null check (kind in ('deposit', 'withdraw')),  -- 입금 / 출금
  amount       numeric(18, 0) not null check (amount > 0),              -- 원 (항상 양수, 방향은 kind)
  txn_date     date   not null default ((now() at time zone 'Asia/Seoul')::date),
  memo         text   check (memo is null or length(memo) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 계좌는 반드시 같은 포트폴리오의 것. 내역이 남아 있으면 계좌 삭제 불가
  -- (no action: 포트폴리오 통째 삭제 시에는 같은 문장에서 내역도 지워지므로 통과)
  foreign key (account_id, portfolio_id) references public.accounts (id, portfolio_id)
);
comment on table public.deposits is '입출금 내역 (원화). 누적 원금 = 입금 합 − 출금 합';

create index if not exists deposits_portfolio_date_idx on public.deposits (portfolio_id, txn_date desc, id desc);
create index if not exists deposits_account_idx on public.deposits (account_id);

drop trigger if exists deposits_set_updated_at on public.deposits;
create trigger deposits_set_updated_at
  before update on public.deposits
  for each row execute function public.set_updated_at();


-- 3. 권한: 본인 포트폴리오 것만
alter table public.accounts enable row level security;
alter table public.deposits enable row level security;

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['accounts', 'deposits'] loop
    foreach op in array array['읽기', '추가', '수정', '삭제'] loop
      execute format('drop policy if exists %I on public.%I', t || ': 본인 ' || op, t);
    end loop;
  end loop;
end $$;

create policy "accounts: 본인 읽기" on public.accounts for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "accounts: 본인 추가" on public.accounts for insert to authenticated
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "accounts: 본인 수정" on public.accounts for update to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "accounts: 본인 삭제" on public.accounts for delete to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));

create policy "deposits: 본인 읽기" on public.deposits for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "deposits: 본인 추가" on public.deposits for insert to authenticated
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "deposits: 본인 수정" on public.deposits for update to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "deposits: 본인 삭제" on public.deposits for delete to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));


-- Supabase API(PostgREST)가 새 테이블을 바로 인식하도록 목록 새로고침
notify pgrst, 'reload schema';
