# Stocky

주식 포트폴리오를 한눈에 보여주는 웹 페이지 목업입니다.
보유 종목의 평가금액과 수익을 카드/표 형태로 보여주고, 드래그 앤 드롭으로 순서를 바꿀 수 있습니다.

> ⚠️ 화면에 표시되는 종목·수량·가격·환율은 모두 **예시(목업) 데이터**입니다.

## 폴더 구조

```
stocky/
├── portfolio.html   # 포트폴리오 목업 페이지 (HTML + CSS + JS 단일 파일)
├── favicon.svg      # 브라우저 탭 아이콘
├── vercel.json      # Vercel 배포 설정 (`/` → portfolio.html 연결, 보안 헤더)
├── README.md        # 프로젝트 설명
└── .gitignore       # Git에 올리지 않을 파일 목록 (민감 정보, 백업, OS 파일 등)
```

## 실행 방법

별도 설치나 빌드가 필요 없습니다.

```bash
open portfolio.html        # macOS: 기본 브라우저로 열기
```

또는 `portfolio.html` 파일을 브라우저로 드래그해서 열면 됩니다.

로컬 웹서버로 띄우려면:

```bash
python3 -m http.server 8000   # → http://localhost:8000/portfolio.html
```

## 배포 (Vercel)

빌드 과정이 없는 정적 사이트라 별도 설정 없이 배포됩니다. 사이트 루트(`/`)는 `vercel.json`의 rewrite 설정으로 `portfolio.html`을 보여줍니다.

1. [vercel.com](https://vercel.com) 로그인 → **Add New… → Project**
2. **Import Git Repository**에서 `uchupura/stocky` 선택 (private 레포는 Vercel에 GitHub 접근 권한 허용 필요)
3. 설정 화면은 기본값 그대로 두고 **Deploy**
   - Framework Preset: `Other`
   - Build Command / Output Directory: 비워둠
4. 배포가 끝나면 발급된 주소(`https://<프로젝트명>.vercel.app`)로 접속해서 확인

이후 `main` 브랜치에 push할 때마다 자동으로 다시 배포됩니다.

## 주요 기능

| 기능 | 설명 |
|---|---|
| 포트폴리오 요약 | 총 평가금액, 총 수익금/수익률, 투자 원금, 국내·해외 비중 |
| 보유 종목 목록 | 종목명, 보유 수량, 평가금액, 수익금/수익률 (데스크톱은 평균 단가·현재가 추가) |
| USD 배지 | 미국 주식은 종목명 옆에 `USD` 표시 |
| 순서 변경 | `≡` 손잡이를 드래그 (마우스·터치), 또는 손잡이 선택 후 키보드 `↑` `↓` |
| 순서 저장 | 바꾼 순서는 브라우저(localStorage)에 저장되어 새로고침해도 유지, `순서 초기화`로 복구 |
| 반응형 | 모바일(~639px) / 태블릿(640~1023px) / 데스크톱(1024px~) 레이아웃 |
| 다크 모드 | 기기 설정에 따라 라이트/다크 테마 자동 적용 |

## 기술 스택

- HTML / CSS / Vanilla JavaScript (외부 라이브러리 없음)
- 폰트: [Pretendard](https://github.com/orioncactus/pretendard) (CDN)
