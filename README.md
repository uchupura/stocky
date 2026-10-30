# Stocky

주식 포트폴리오를 한눈에 보여주는 웹 페이지입니다.
보유 종목의 평가금액과 수익을 카드/표 형태로 보여주고, 드래그 앤 드롭으로 순서를 바꾸면 DB에 저장됩니다.

- 프론트엔드: Vue 3 + Vite
- 백엔드/DB: Supabase (Postgres)
- 서버 API: Vercel Functions (`api/`) — 한국투자증권 KIS Open API 로 실시간 현재가 조회

> ⚠️ 현재 RLS 정책은 **누구나 읽기·쓰기·보유 종목 삭제 가능**(데모용)입니다. 실제 자산 정보는 넣지 마세요.
> 실서비스 전환 시 `supabase/schema.sql` 하단의 "권장안"을 적용하세요.

## 폴더 구조

```
stocky/
├── index.html                    # 앱 진입 HTML (메타 태그, 폰트)
├── public/
│   └── favicon.svg               # 브라우저 탭 아이콘
├── src/
│   ├── main.js                   # Vue 앱 시작
│   ├── App.vue                   # 페이지 전체 (로딩/에러/정상 화면, 토스트)
│   ├── assets/main.css           # 전체 스타일 (반응형, 다크 모드)
│   ├── components/
│   │   ├── AppHeader.vue         # 상단 바 (로고, 메뉴, 검색)
│   │   ├── PortfolioSummary.vue  # 총 평가금액·수익률·원금·국내/해외 비중
│   │   ├── HoldingList.vue       # 보유 주식 목록 + 드래그 앤 드롭
│   │   ├── HoldingItem.vue       # 종목 한 줄 (USD 배지, 편집 모드 삭제 버튼)
│   │   ├── AddHoldingSheet.vue   # 주식 추가 창 (종목 검색 / 새 종목 등록)
│   │   └── BaseSheet.vue         # 공통 창 (모바일 하단 시트 / 데스크톱 가운데)
│   ├── composables/
│   │   └── usePortfolio.js       # Supabase 조회 · 추가 · 삭제 · 순서 저장
│   ├── lib/
│   │   ├── supabase.js           # Supabase 클라이언트 (.env 값 사용)
│   │   └── api.js                # 우리 서버(/api) 호출 — 현재가 조회
│   └── utils/
│       └── format.js             # 금액·수익률 표시 형식
├── api/
│   └── quote.js                  # GET /api/quote — 현재가 (Vercel Function)
├── server/
│   └── kis.js                    # KIS 토큰·시세 조회 (서버 전용, 조회 API 만 사용)
├── scripts/
│   └── sync-stock-master.mjs     # 전체 상장 종목 목록 → stock_master 동기화
├── supabase/
│   ├── schema.sql                # 테이블·뷰·함수·RLS 정책
│   ├── seed.sql                  # 예시 데이터
│   └── migrations/               # 기존 DB 에 추가로 적용할 변경 SQL
├── .env.example                  # 환경변수 목록 (값 없음)
├── vite.config.js                # 로컬 개발 시 /api 를 api/ 함수로 연결
├── vercel.json                   # Vercel 배포 설정 (빌드, 보안 헤더)
└── package.json
```

## DB 준비 (최초 1회)

Supabase 대시보드 → **SQL Editor** 에서 순서대로 실행합니다.

1. `supabase/schema.sql`
2. `supabase/seed.sql` (예시 데이터)

이미 위 SQL 을 실행한 DB 라면 `supabase/migrations/` 의 파일을 번호 순서대로 추가 실행합니다.

| 파일 | 내용 |
|---|---|
| `002_holdings_delete.sql` | 보유 종목 삭제 허용 (주식 삭제 기능용) — 이미 `schema.sql` 에 포함 |
| `003_stock_master.sql` | 전체 종목 목록 `stock_master`, KIS 토큰 보관 `kis_tokens`(서버 전용), `stocks.exchange` |
| `004_search_stock_master.sql` | 종목 검색 함수 (한글·영문명·코드, 정확도순) |
| `005_search_ticker.sql` | 티커 검색 개선 — `BRK.B`·`BRK-B`·`BRKB` 모두 검색, 티커 일치 우선 정렬 (004 함수 교체) |

> 처음부터 새로 만드는 경우: `schema.sql` → `seed.sql` → `003` → `004` → `005` 순서 (`002` 는 건너뜀)

### 종목 목록 채우기 (최초 1회 + 가끔)

```bash
npm run sync:stocks          # 코스피·코스닥·나스닥·뉴욕·아멕스 약 1.7만 종목 저장 (몇 초)
npm run sync:stocks -- --dry # 저장하지 않고 미리보기만
```

한국투자증권이 공개하는 종목 마스터 파일을 사용합니다. 신규 상장·상장 폐지를 반영하려면 가끔 다시 실행하세요.

## 로컬 실행

Node.js 20.19 이상이 필요합니다.

```bash
# 1. 환경변수 파일 만들기 → 값 채우기 (아래 "환경변수" 표 참고)
cp .env.example .env

# 2. 라이브러리 설치
npm install

# 3. 개발 서버 실행 → http://localhost:5173
npm run dev
```

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (코드 수정 시 화면 자동 갱신) |
| `npm run build` | 배포용 파일을 `dist/` 에 생성 |
| `npm run preview` | 빌드 결과를 로컬에서 미리 보기 (`/api` 는 동작 안 함) |
| `npm run sync:stocks` | 전체 상장 종목 목록 동기화 |

### 환경변수

| 이름 | 쓰는 곳 | 설명 |
|---|---|---|
| `VITE_SUPABASE_URL` | 브라우저·서버 | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | 브라우저 | Supabase anon(public) 키 — 공개용 |
| `KIS_APP_KEY` | 서버 전용 | 한국투자증권 KIS Developers App Key |
| `KIS_APP_SECRET` | 서버 전용 | 한국투자증권 KIS Developers App Secret |
| `KIS_ENV` | 서버 전용 | `real`(실전) 또는 `mock`(모의투자) |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 | Supabase service_role 키 — RLS 를 무시하는 관리자 키 |

- `.env` 는 `.gitignore` 에 등록되어 있어 Git 에 올라가지 않습니다.
- `VITE_` 로 시작하는 값만 브라우저로 전달됩니다. 서버 전용 키는 `api/`·`server/`·`scripts/` 에서만 읽습니다.
- 🔒 KIS **실전** 키는 주문 권한까지 있는 키입니다. 이 프로젝트는 시세 **조회** API 만 호출하지만, 키가 유출되지 않도록 주의하세요.
- KIS 접근토큰은 발급할 때마다 카카오 알림톡이 오며, 하루 동안 `kis_tokens` 테이블에 저장해 재사용합니다.

## 주요 기능

| 기능 | 설명 |
|---|---|
| 포트폴리오 요약 | 총 평가금액, 총 수익금/수익률, 투자 원금, 국내·해외 평가금액과 비중 |
| 보유 종목 목록 | 종목명, 보유 수량, 평가금액, 수익금/수익률 (데스크톱은 평균 단가·현재가 추가) |
| 주식 추가 | `+ 추가` → **전체 상장 종목 검색**(한글·영문·코드·티커, 예: "애플"·"aapl" → AAPL, "BRK.B" → 버크셔 B) → 현재가 자동 조회 → 보유 수량·평균 단가 입력 (예상 평가금액 미리보기). 검색에 없으면 직접 입력 |
| 주식 삭제 | `편집` → 종목의 휴지통 버튼 → 확인 후 삭제 |
| USD 배지 | 해외(미국) 주식은 종목명 옆에 `USD` 표시 |
| 순서 변경 | `≡` 손잡이를 드래그 (마우스·터치), 또는 손잡이 선택 후 키보드 `↑` `↓` → DB 에 저장 |
| 반응형 | 모바일(~639px) / 태블릿(640~1023px) / 데스크톱(1024px~) 레이아웃 |
| 다크 모드 | 기기 설정에 따라 라이트/다크 테마 자동 적용 |

## 배포 (Vercel)

1. [vercel.com](https://vercel.com) → **Add New… → Project** → `uchupura/stocky` Import
2. **Environment Variables** 에 위 "환경변수" 표의 6개 모두 등록 (서버 전용 키 포함)
3. **Deploy** (Framework·빌드 설정은 `vercel.json` 에 지정되어 있어 기본값 그대로)

이후 `main` 브랜치에 push 할 때마다 자동으로 다시 배포됩니다.
환경변수를 바꾼 경우에는 Vercel 에서 **Redeploy** 해야 반영됩니다.
