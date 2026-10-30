# Stocky

주식 포트폴리오를 한눈에 보여주는 웹 페이지입니다.
보유 종목의 평가금액과 수익을 카드/표 형태로 보여주고, 드래그 앤 드롭으로 순서를 바꾸면 DB에 저장됩니다.

- 프론트엔드: Vue 3 + Vite
- 백엔드/DB: Supabase (Postgres)

> ⚠️ 현재 RLS 정책은 **누구나 읽기·쓰기 가능**(데모용)입니다. 실제 자산 정보는 넣지 마세요.
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
│   │   └── HoldingItem.vue       # 종목 한 줄 (USD 배지 포함)
│   ├── composables/
│   │   └── usePortfolio.js       # Supabase 조회 + 순서 저장
│   ├── lib/
│   │   └── supabase.js           # Supabase 클라이언트 (.env 값 사용)
│   └── utils/
│       └── format.js             # 금액·수익률 표시 형식
├── supabase/
│   ├── schema.sql                # 테이블·뷰·함수·RLS 정책
│   └── seed.sql                  # 예시 데이터
├── .env.example                  # 환경변수 목록 (값 없음)
├── vite.config.js
├── vercel.json                   # Vercel 배포 설정 (빌드, 보안 헤더)
└── package.json
```

## DB 준비 (최초 1회)

Supabase 대시보드 → **SQL Editor** 에서 순서대로 실행합니다.

1. `supabase/schema.sql`
2. `supabase/seed.sql` (예시 데이터)

## 로컬 실행

Node.js 20.19 이상이 필요합니다.

```bash
# 1. 환경변수 파일 만들기 → 값 채우기 (Supabase → Project Settings → API)
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
| `npm run preview` | 빌드 결과를 로컬에서 미리 보기 |

### 환경변수

| 이름 | 설명 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon(public) 키 |

`.env` 는 `.gitignore` 에 등록되어 있어 Git 에 올라가지 않습니다.

## 주요 기능

| 기능 | 설명 |
|---|---|
| 포트폴리오 요약 | 총 평가금액, 총 수익금/수익률, 투자 원금, 국내·해외 평가금액과 비중 |
| 보유 종목 목록 | 종목명, 보유 수량, 평가금액, 수익금/수익률 (데스크톱은 평균 단가·현재가 추가) |
| USD 배지 | 해외(미국) 주식은 종목명 옆에 `USD` 표시 |
| 순서 변경 | `≡` 손잡이를 드래그 (마우스·터치), 또는 손잡이 선택 후 키보드 `↑` `↓` → DB 에 저장 |
| 반응형 | 모바일(~639px) / 태블릿(640~1023px) / 데스크톱(1024px~) 레이아웃 |
| 다크 모드 | 기기 설정에 따라 라이트/다크 테마 자동 적용 |

## 배포 (Vercel)

1. [vercel.com](https://vercel.com) → **Add New… → Project** → `uchupura/stocky` Import
2. **Environment Variables** 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등록
3. **Deploy** (Framework·빌드 설정은 `vercel.json` 에 지정되어 있어 기본값 그대로)

이후 `main` 브랜치에 push 할 때마다 자동으로 다시 배포됩니다.
환경변수를 바꾼 경우에는 Vercel 에서 **Redeploy** 해야 반영됩니다.
