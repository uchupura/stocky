-- =====================================================================
-- 002: 보유 종목(holdings) 삭제 허용
--   "내 투자"에서 주식 삭제 기능을 위해 holdings 에만 DELETE 정책을 추가한다.
--   stocks / exchange_rates / portfolios 는 계속 삭제 불가.
--
--   ⚠️ 누구나(anon) 삭제 가능 → 데모 용도로만 사용
--
--   실행: Supabase 대시보드 → SQL Editor → 이 파일 내용 붙여넣고 Run
--   (이미 schema.sql 을 실행한 DB 에 한 번만 실행)
-- =====================================================================

create policy "holdings: 누구나 삭제"
  on public.holdings for delete to anon, authenticated using (true);
