-- =====================================================================
-- 009: 시세 보기 — 전일 종가 + 하루 주가 그래프 저장
--
--   1) stocks.prev_close : 전일 종가 (오늘 수익률 = (현재가 − 전일 종가) ÷ 전일 종가)
--   2) intraday_cache    : 종목별 "가장 최근 거래일" 하루 그래프 데이터 (5분 간격 가격)
--                          서버(service_role) 전용 — 브라우저는 /api/chart 로만 받음
--
--   여러 번 실행해도 안전
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run  (008 다음)
-- =====================================================================

-- 1. 전일 종가
alter table public.stocks
  add column if not exists prev_close numeric(18, 4) check (prev_close is null or prev_close >= 0);
comment on column public.stocks.prev_close is '전일 종가 (현지 통화). 현재가 갱신 때 함께 저장';


-- 2. 하루 그래프 저장 (같은 종목을 5분 안에 다시 요청하면 KIS 를 부르지 않기 위해)
create table if not exists public.intraday_cache (
  symbol       text not null,
  market       text not null check (market in ('KR', 'US')),
  session_date text not null,                 -- 거래일 (현지 날짜, YYYYMMDD)
  prev_close   numeric(18, 4),                -- 그 거래일의 전일 종가
  points       jsonb not null,                -- [[시각 HHMM, 가격], ...] 시간순
  fetched_at   timestamptz not null default now(),
  primary key (symbol, market)
);
comment on table public.intraday_cache is '하루 주가 그래프 캐시. 서버(service_role) 전용 — 브라우저 접근 불가';

alter table public.intraday_cache enable row level security;
-- 정책을 만들지 않고 권한도 회수 → anon / authenticated 모두 읽기·쓰기 불가
revoke all on public.intraday_cache from anon, authenticated;


-- Supabase API(PostgREST)가 바뀐 테이블을 바로 인식하도록 목록 새로고침
notify pgrst, 'reload schema';
