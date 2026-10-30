-- =====================================================================
-- 005: 미국 주식 티커 검색 개선 (004 의 검색 함수를 교체)
--   1) 티커 기호 통일: KIS 종목 목록은 클래스 주식을 "BRK/B" 처럼 '/' 로 표기
--      → 검색할 때 . - / 공백 을 무시하고 비교 (BRK.B, BRK-B, BRKB, brk b 모두 BRK/B 검색)
--   2) 정렬: 티커 정확히 일치 → 티커 앞부분 일치 → 이름 앞부분 일치 → 그 외
--      (예: "GOOG" → GOOG, GOOGL 이 이름에 GOOGLE 이 들어간 종목보다 먼저)
--
--   여러 번 실행해도 안전 (create or replace)
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

create or replace function public.search_stock_master(q text, max_results int default 20)
returns setof public.stock_master
language sql
stable
security invoker
set search_path = ''
as $$
  with k as (
    select trim(q) as raw,
           -- 이름 검색용: ilike 특수문자(\ % _) 이스케이프
           replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') as esc,
           -- 티커 검색용: 대문자 + 기호(. - / 공백) 제거, 이스케이프
           replace(replace(replace(upper(translate(trim(q), './- ', '')), '\', '\\'), '%', '\%'), '_', '\_') as tick
  ),
  m as (
    select s.*, upper(translate(s.symbol, './- ', '')) as tsym
      from public.stock_master s
  )
  select m.symbol, m.market, m.exchange, m.currency, m.name_ko, m.name_en, m.security_type, m.updated_at
    from m, k
   where length(k.raw) > 0
     and (   m.name_ko ilike '%' || k.esc || '%'
          or m.name_en ilike '%' || k.esc || '%'
          or (length(k.tick) > 0 and m.tsym like k.tick || '%'))
   order by
     case when length(k.tick) > 0 and m.tsym = upper(translate(k.raw, './- ', '')) then 0  -- 티커 정확히 일치
          when m.name_ko = k.raw or upper(m.name_en) = upper(k.raw)              then 0  -- 이름 정확히 일치
          when length(k.tick) > 0 and m.tsym like k.tick || '%'                   then 1  -- 티커 앞부분 일치
          when m.name_ko ilike k.esc || '%' or m.name_en ilike k.esc || '%'       then 2  -- 이름 앞부분 일치
          else 3 end,
     case m.security_type when 'stock' then 0 else 1 end,
     length(m.tsym),
     length(coalesce(m.name_ko, m.name_en, m.symbol)),
     m.symbol
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- Supabase API(PostgREST)가 바뀐 함수를 바로 인식하도록 목록 새로고침
notify pgrst, 'reload schema';
