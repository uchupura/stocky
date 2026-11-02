-- =====================================================================
-- 012: 총 자산 기록 (월별·누적 수익률 계산용)
--
--   asset_snapshots : 날짜별 총 자산(원) — 포트폴리오당 하루 1줄
--     source = 'auto'   : 매달 말일 서버가 자동 기록 (Vercel Cron, 다음 날 아침 · service_role)
--              'manual' : 사용자가 직접 입력 (과거 월말 총 자산 등)
--   수익률은 화면에서 계산: 기록 사이 자산 변화 − 입출금(010) → 구간 수익률을 곱해 연결
--
--   권한: 본인 포트폴리오 것만 읽기·삭제, 추가·수정은 'manual' 만
--         (자동 기록은 service_role 이 RLS 를 거치지 않고 저장)
--
--   여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (011 다음)
-- =====================================================================

create table if not exists public.asset_snapshots (
  id           bigint generated always as identity primary key,
  portfolio_id bigint not null references public.portfolios (id) on delete cascade,
  snap_date    date   not null,
  total_asset  numeric(18, 0) not null check (total_asset >= 0),        -- 원
  source       text   not null default 'manual' check (source in ('auto', 'manual')),
  memo         text   check (memo is null or length(memo) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (portfolio_id, snap_date)
);
comment on table public.asset_snapshots is '날짜별 총 자산(원). auto = 월말 자동 기록, manual = 직접 입력';

drop trigger if exists asset_snapshots_set_updated_at on public.asset_snapshots;
create trigger asset_snapshots_set_updated_at
  before update on public.asset_snapshots
  for each row execute function public.set_updated_at();


-- 권한
alter table public.asset_snapshots enable row level security;

drop policy if exists "asset_snapshots: 본인 읽기" on public.asset_snapshots;
drop policy if exists "asset_snapshots: 본인 추가" on public.asset_snapshots;
drop policy if exists "asset_snapshots: 본인 수정" on public.asset_snapshots;
drop policy if exists "asset_snapshots: 본인 삭제" on public.asset_snapshots;

create policy "asset_snapshots: 본인 읽기" on public.asset_snapshots for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "asset_snapshots: 본인 추가" on public.asset_snapshots for insert to authenticated
  with check (source = 'manual'
    and exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
-- 자동 기록을 고치면 직접 입력('manual')으로 바뀜
create policy "asset_snapshots: 본인 수정" on public.asset_snapshots for update to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())))
  with check (source = 'manual'
    and exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "asset_snapshots: 본인 삭제" on public.asset_snapshots for delete to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));


notify pgrst, 'reload schema';
