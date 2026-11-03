-- =====================================================================
-- 016: 알림 (헤더의 알림 아이콘)
--
--   notifications : 포트폴리오별 알림
--     kind      : 'refresh'(현재가·환율 갱신 + 메리츠 계좌 맞춤 결과) | 'loc_buy'(LOC 매수 체결)
--     dedup_key : 같은 알림이 두 번 생기지 않게 (예: loc_buy:사이클:날짜) — 비우면 중복 검사 안 함
--     read_at   : 읽은 시각 — 화면은 안 읽은 것만 보여줌 (누르면 읽음 → 목록에서 사라짐)
--
--   권한: 본인 포트폴리오 것만 읽기 · 읽음 표시 · 삭제. 만들기는 서버만 (service_role)
--   여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (015 다음)
-- =====================================================================

create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  portfolio_id bigint not null references public.portfolios (id) on delete cascade,
  kind         text   not null check (kind in ('refresh', 'loc_buy')),
  title        text   not null,
  body         text,
  data         jsonb  not null default '{}',
  dedup_key    text,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (portfolio_id, dedup_key)
);
comment on table public.notifications is '알림 — 서버가 만들고, 화면은 안 읽은 것만 보여주고 읽음 표시';

create index if not exists notifications_unread_idx on public.notifications (portfolio_id, created_at desc) where read_at is null;

alter table public.notifications enable row level security;

do $$
declare op text;
begin
  foreach op in array array['읽기', '수정', '삭제'] loop
    execute format('drop policy if exists %I on public.notifications', 'notifications: 본인 ' || op);
  end loop;
end $$;

create policy "notifications: 본인 읽기" on public.notifications for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "notifications: 본인 수정" on public.notifications for update to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "notifications: 본인 삭제" on public.notifications for delete to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.owner_id = (select auth.uid())));

-- 화면에서는 읽음 표시(read_at)만 바꿀 수 있게 — 제목·내용 등은 서버만
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

notify pgrst, 'reload schema';
