-- =====================================================================
-- 예시 데이터 (초기 목업 화면과 같은 값)
-- schema.sql 실행 후 실행
-- =====================================================================

insert into public.exchange_rates (currency, rate_to_krw) values
  ('KRW', 1),
  ('USD', 1385);

insert into public.stocks (symbol, name, market, currency, current_price, logo_color) values
  ('005930', '삼성전자',   'KR', 'KRW',  74500, '#1428a0'),
  ('AAPL',   'Apple',      'US', 'USD',  228.4, '#333d4b'),
  ('NVDA',   'NVIDIA',     'US', 'USD',  141.2, '#76b900'),
  ('000660', 'SK하이닉스', 'KR', 'KRW', 211000, '#ea002c'),
  ('TSLA',   'Tesla',      'US', 'USD',  238.1, '#cc0000'),
  ('035420', 'NAVER',      'KR', 'KRW', 188500, '#03c75a'),
  ('MSFT',   'Microsoft',  'US', 'USD',  421.8, '#00a4ef'),
  ('035720', '카카오',     'KR', 'KRW',  41200, '#f7c600'),
  ('005380', '현대차',     'KR', 'KRW', 251500, '#002c5f');

insert into public.portfolios (name) values ('내 포트폴리오');

insert into public.holdings (portfolio_id, stock_id, quantity, avg_price, sort_order)
select p.id, s.id, v.quantity, v.avg_price, v.sort_order
from (values
  ('005930', 50, 68000,  1),
  ('AAPL',   15, 172.3,  2),
  ('NVDA',   30, 98.5,   3),
  ('000660', 10, 182000, 4),
  ('TSLA',    6, 265.0,  5),
  ('035420',  8, 215000, 6),
  ('MSFT',    4, 395.0,  7),
  ('035720', 20, 52000,  8),
  ('005380',  5, 245000, 9)
) as v (symbol, quantity, avg_price, sort_order)
join public.stocks s on s.symbol = v.symbol
cross join (select id from public.portfolios where name = '내 포트폴리오' limit 1) p;
