-- =====================================================================
-- 007: 로그인한 "본인"만 포트폴리오 보기 (네이버 로그인)
--
--   ⚠️ 실행 순서: 로그인 기능 배포 → 이 SQL 실행 → 네이버로 한 번 로그인
--      (첫 허용 로그인 때 서버가 주인 없는 포트폴리오를 그 계정에 연결함)
--      이 SQL 을 실행하면 로그인하지 않은 사람(anon)은 아무 데이터도 볼 수 없다.
--
--   변경 내용
--     1) portfolios.owner_id 추가
--     2) 기존 "누구나" 정책 전부 삭제
--     3) 새 정책 — authenticated(로그인한 사용자)만
--        - portfolios / holdings : 본인 포트폴리오만 읽기·쓰기
--        - stocks                : 읽기·추가·수정 (종목 추가 화면용)
--        - exchange_rates        : 읽기만 (갱신은 서버 service_role)
--        - stock_master          : 읽기만 (종목 검색)
--     4) 함수 실행 권한: anon 회수
--
--   여러 번 실행해도 안전
-- =====================================================================

-- 1. 포트폴리오 주인
alter table public.portfolios
  add column if not exists owner_id uuid references auth.users (id) on delete set null;
create index if not exists portfolios_owner_id_idx on public.portfolios (owner_id);


-- 2. 기존 정책 삭제 ("누구나" 정책 + 이 파일을 다시 실행할 때를 위한 새 정책 이름)
drop policy if exists "exchange_rates: 누구나 읽기" on public.exchange_rates;
drop policy if exists "exchange_rates: 누구나 추가" on public.exchange_rates;
drop policy if exists "exchange_rates: 누구나 수정" on public.exchange_rates;
drop policy if exists "stocks: 누구나 읽기"         on public.stocks;
drop policy if exists "stocks: 누구나 추가"         on public.stocks;
drop policy if exists "stocks: 누구나 수정"         on public.stocks;
drop policy if exists "portfolios: 누구나 읽기"     on public.portfolios;
drop policy if exists "portfolios: 누구나 추가"     on public.portfolios;
drop policy if exists "portfolios: 누구나 수정"     on public.portfolios;
drop policy if exists "holdings: 누구나 읽기"       on public.holdings;
drop policy if exists "holdings: 누구나 추가"       on public.holdings;
drop policy if exists "holdings: 누구나 수정"       on public.holdings;
drop policy if exists "holdings: 누구나 삭제"       on public.holdings;
drop policy if exists "stock_master: 누구나 읽기"   on public.stock_master;

drop policy if exists "exchange_rates: 로그인 읽기" on public.exchange_rates;
drop policy if exists "stocks: 로그인 읽기"         on public.stocks;
drop policy if exists "stocks: 로그인 추가"         on public.stocks;
drop policy if exists "stocks: 로그인 수정"         on public.stocks;
drop policy if exists "stock_master: 로그인 읽기"   on public.stock_master;
drop policy if exists "portfolios: 본인 읽기"       on public.portfolios;
drop policy if exists "portfolios: 본인 수정"       on public.portfolios;
drop policy if exists "holdings: 본인 읽기"         on public.holdings;
drop policy if exists "holdings: 본인 추가"         on public.holdings;
drop policy if exists "holdings: 본인 수정"         on public.holdings;
drop policy if exists "holdings: 본인 삭제"         on public.holdings;


-- 3. 새 정책 (to authenticated → 로그인 안 한 anon 은 해당 없음 = 차단)

-- 시세·종목 목록: 로그인한 사용자 읽기
create policy "exchange_rates: 로그인 읽기"
  on public.exchange_rates for select to authenticated using (true);
create policy "stock_master: 로그인 읽기"
  on public.stock_master for select to authenticated using (true);

-- 종목 정보: 종목 추가 화면에서 등록·현재가 갱신
create policy "stocks: 로그인 읽기"
  on public.stocks for select to authenticated using (true);
create policy "stocks: 로그인 추가"
  on public.stocks for insert to authenticated with check (true);
create policy "stocks: 로그인 수정"
  on public.stocks for update to authenticated using (true) with check (true);

-- 포트폴리오: 본인 것만 (추가·삭제는 없음)
create policy "portfolios: 본인 읽기"
  on public.portfolios for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "portfolios: 본인 수정"
  on public.portfolios for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- 보유 종목: 본인 포트폴리오에 속한 것만
create policy "holdings: 본인 읽기"
  on public.holdings for select to authenticated
  using (exists (select 1 from public.portfolios p
                  where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "holdings: 본인 추가"
  on public.holdings for insert to authenticated
  with check (exists (select 1 from public.portfolios p
                       where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "holdings: 본인 수정"
  on public.holdings for update to authenticated
  using (exists (select 1 from public.portfolios p
                  where p.id = portfolio_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p
                       where p.id = portfolio_id and p.owner_id = (select auth.uid())));
create policy "holdings: 본인 삭제"
  on public.holdings for delete to authenticated
  using (exists (select 1 from public.portfolios p
                  where p.id = portfolio_id and p.owner_id = (select auth.uid())));


-- 4. 함수 실행 권한: 로그인 안 한 사용자는 호출 불가
revoke execute on function public.search_stock_master(text, int) from anon, public;
revoke execute on function public.reorder_holdings(bigint, bigint[]) from anon, public;
grant  execute on function public.search_stock_master(text, int) to authenticated;
grant  execute on function public.reorder_holdings(bigint, bigint[]) to authenticated;


-- Supabase API(PostgREST)가 바뀐 권한을 바로 인식하도록 목록 새로고침
notify pgrst, 'reload schema';
