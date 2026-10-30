-- =====================================================================
-- 003: 실제 종목 검색 + 현재가 (한국투자증권 KIS Open API)
--
--   1) stock_master : 전체 상장 종목 목록 (코스피·코스닥·나스닥·뉴욕·아멕스)
--                     누구나 읽기만 가능. 쓰기는 서버(service_role)만 — npm run sync:stocks
--   2) kis_tokens   : KIS 접근토큰 보관. 외부(anon) 접근 완전 차단, 서버만 사용
--   3) stocks.exchange : 해외 현재가 조회에 필요한 거래소 코드 추가
--
--   실행: Supabase 대시보드 → SQL Editor → 이 파일 내용 붙여넣고 Run (한 번만)
-- =====================================================================

-- 부분 검색(ilike '%삼성%')을 빠르게 해주는 확장
create extension if not exists pg_trgm with schema extensions;


-- ---------------------------------------------------------------------
-- 1. 전체 상장 종목 목록
-- ---------------------------------------------------------------------
create table public.stock_master (
  symbol        text not null,                         -- 005930, AAPL
  market        text not null check (market in ('KR', 'US')),
  exchange      text not null check (exchange in ('KOSPI', 'KOSDAQ', 'NAS', 'NYS', 'AMS')),
  currency      text not null check (currency in ('KRW', 'USD')),
  name_ko       text,                                  -- 삼성전자, 애플
  name_en       text,                                  -- Samsung Electronics, APPLE INC
  security_type text not null default 'stock' check (security_type in ('stock', 'etf')),
  updated_at    timestamptz not null default now(),
  primary key (symbol, market)
);
comment on table public.stock_master is '종목 검색용 전체 상장 종목 (KIS 마스터 파일, npm run sync:stocks 로 갱신)';

create index stock_master_name_ko_trgm on public.stock_master using gin (name_ko extensions.gin_trgm_ops);
create index stock_master_name_en_trgm on public.stock_master using gin (name_en extensions.gin_trgm_ops);
create index stock_master_symbol_trgm  on public.stock_master using gin (symbol  extensions.gin_trgm_ops);

alter table public.stock_master enable row level security;
create policy "stock_master: 누구나 읽기"
  on public.stock_master for select to anon, authenticated using (true);
-- 쓰기 정책 없음 → service_role(서버 전용 키)만 쓰기 가능
-- 검색 함수는 004_search_stock_master.sql



-- ---------------------------------------------------------------------
-- 2. KIS 접근토큰 (하루 유효, 발급할 때마다 알림톡 → 저장해서 재사용)
-- ---------------------------------------------------------------------
create table public.kis_tokens (
  env          text primary key check (env in ('real', 'mock')),
  access_token text not null,
  expires_at   timestamptz not null,
  updated_at   timestamptz not null default now()
);
comment on table public.kis_tokens is 'KIS 접근토큰 캐시. 서버(service_role) 전용 — 브라우저에서 절대 접근 불가';

alter table public.kis_tokens enable row level security;
-- 정책을 만들지 않고 권한도 회수 → anon/authenticated 는 읽기·쓰기 모두 불가
revoke all on public.kis_tokens from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. stocks 에 거래소 코드 추가 (해외 현재가 조회: EXCD = NAS/NYS/AMS)
-- ---------------------------------------------------------------------
alter table public.stocks
  add column exchange text check (exchange in ('KOSPI', 'KOSDAQ', 'NAS', 'NYS', 'AMS'));

-- 기존 예시 종목 거래소 채우기
update public.stocks set exchange = 'KOSPI' where symbol in ('005930', '000660', '035420', '035720', '005380');
update public.stocks set exchange = 'NAS'   where symbol in ('AAPL', 'NVDA', 'TSLA', 'MSFT');
