-- =====================================================================
-- 004: 종목 검색 함수 (003_stock_master.sql 다음에 실행)
--   여러 번 실행해도 안전 (create or replace)
--   실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

-- 종목 검색: 한글명·영문명 부분 일치 + 종목 코드 앞부분 일치
--   정렬: 정확히 일치 → 앞부분 일치 → 주식 먼저(ETF 나중) → 이름 짧은 순
--   예) select * from public.search_stock_master('애플');  → AAPL(애플) 이 맨 위
create or replace function public.search_stock_master(q text, max_results int default 20)
returns setof public.stock_master
language sql
stable
security invoker
set search_path = ''
as $$
  with k as (
    -- ilike 특수문자(\ % _) 이스케이프
    select trim(q) as raw,
           replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') as esc
  )
  select m.*
    from public.stock_master m, k
   where length(k.raw) > 0
     and (   m.name_ko ilike '%' || k.esc || '%'
          or m.name_en ilike '%' || k.esc || '%'
          or m.symbol  ilike k.esc || '%')
   order by
     case when upper(m.symbol) = upper(k.raw) or m.name_ko = k.raw or upper(m.name_en) = upper(k.raw) then 0
          when m.name_ko ilike k.esc || '%' or m.name_en ilike k.esc || '%' then 1
          else 2 end,
     case m.security_type when 'stock' then 0 else 1 end,
     length(coalesce(m.name_ko, m.name_en, m.symbol)),
     m.symbol
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- Supabase API(PostgREST)가 새 함수를 바로 인식하도록 목록 새로고침
notify pgrst, 'reload schema';
