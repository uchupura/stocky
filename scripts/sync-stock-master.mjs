// =====================================================================
// 전체 상장 종목 목록 동기화 → Supabase stock_master
//   한국투자증권이 공개하는 종목 마스터 파일(로그인 불필요)을 받아 정리한다.
//   코스피·코스닥·나스닥·뉴욕·아멕스의 주식/리츠/ETF 만 저장 (ETN·ELW 등 제외)
//
//   실행: npm run sync:stocks
//   필요: .env 의 VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (서버 전용 키)
//   파일 형식 참고: github.com/koreainvestment/open-trading-api/tree/main/stocks_info
// =====================================================================
import { loadEnv } from 'vite'
import { unzipSync } from 'fflate'
import { createClient } from '@supabase/supabase-js'

const env = loadEnv('development', process.cwd(), '')
const SUPABASE_URL = env.VITE_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ .env 에 VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 가 필요해요.')
  process.exit(1)
}

const BASE = 'https://new.real.download.dws.co.kr/common/master'
const cp949 = new TextDecoder('euc-kr') // WHATWG 의 euc-kr = Windows-949(cp949)

async function download(file) {
  const res = await fetch(`${BASE}/${file}.zip`)
  if (!res.ok) throw new Error(`${file} 다운로드 실패: HTTP ${res.status}`)
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
  const name = Object.keys(files).find((n) => n.toLowerCase() === file.toLowerCase()) ?? Object.keys(files)[0]
  return cp949.decode(files[name])
}

const lines = (text) => text.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean)

/**
 * 국내 (kospi_code.mst / kosdaq_code.mst)
 *   한 줄 = [단축코드 9][표준코드 12][한글명 ...] + [뒷부분 고정폭 N자]
 *   N = 코스피 228, 코스닥 222 (줄바꿈 1자 포함 기준) — 뒷부분 첫 2자 = 그룹코드
 *   그룹코드: ST 주권, RT 리츠, EF ETF (그 외 ETN·ELW 등은 제외)
 */
function parseDomestic(text, exchange, tailLen) {
  const out = []
  for (const raw of lines(text)) {
    const row = raw + '\n' // 공식 예제(파이썬)는 줄바꿈을 포함한 길이로 자름
    const head = row.slice(0, row.length - tailLen)
    const group = row.slice(-tailLen, -tailLen + 2)
    const type = group === 'EF' ? 'etf' : group === 'ST' || group === 'RT' ? 'stock' : null
    if (!type) continue
    const symbol = head.slice(0, 9).trim()
    const nameKo = head.slice(21).trim()
    if (!/^[0-9A-Z]{6}$/.test(symbol) || !nameKo) continue
    out.push({ symbol, market: 'KR', exchange, currency: 'KRW', name_ko: nameKo, name_en: null, security_type: type })
  }
  return out
}

/**
 * 해외 (nasmst.cod / nysmst.cod / amsmst.cod) — 탭 구분
 *   [4] Symbol  [6] 한글명  [7] 영문명  [8] 종류(2 주식, 3 ETF)  [9] 통화
 */
function parseOverseas(text, exchange) {
  const out = []
  for (const row of lines(text)) {
    const c = row.split('\t')
    const type = c[8] === '2' ? 'stock' : c[8] === '3' ? 'etf' : null
    if (!type || c[9] !== 'USD') continue
    const symbol = (c[4] || '').trim()
    if (!symbol) continue
    out.push({
      symbol, market: 'US', exchange, currency: 'USD',
      name_ko: (c[6] || '').trim() || null,
      name_en: (c[7] || '').trim() || null,
      security_type: type,
    })
  }
  return out
}

const SOURCES = [
  { file: 'kospi_code.mst', parse: (t) => parseDomestic(t, 'KOSPI', 228) },
  { file: 'kosdaq_code.mst', parse: (t) => parseDomestic(t, 'KOSDAQ', 222) },
  { file: 'nasmst.cod', parse: (t) => parseOverseas(t, 'NAS') },
  { file: 'nysmst.cod', parse: (t) => parseOverseas(t, 'NYS') },
  { file: 'amsmst.cod', parse: (t) => parseOverseas(t, 'AMS') },
]

const startedAt = new Date().toISOString()
const all = new Map()
for (const s of SOURCES) {
  const rows = s.parse(await download(s.file))
  for (const r of rows) all.set(`${r.symbol}|${r.market}`, { ...r, updated_at: startedAt })
  console.log(`  ${s.file.padEnd(16)} ${rows.length.toLocaleString()}종목`)
}
const rows = [...all.values()]
if (rows.length < 1000) {
  console.error(`❌ 종목 수가 너무 적어요(${rows.length}). 파일 형식이 바뀌었을 수 있어 저장하지 않았어요.`)
  process.exit(1)
}

// 미리보기: npm run sync:stocks -- --dry  (DB 에 저장하지 않고 결과만 확인)
if (process.argv.includes('--dry')) {
  const pick = (q) => rows.filter((r) => [r.symbol, r.name_ko, r.name_en].some((v) => v?.includes(q))).slice(0, 3)
  for (const q of ['삼성전자', '카카오', '애플', 'AAPL', 'KODEX 200']) {
    console.log(`  "${q}" →`, pick(q).map((r) => `${r.symbol}(${r.exchange}) ${r.name_ko ?? ''} / ${r.name_en ?? ''} [${r.security_type}]`).join(' | ') || '(없음)')
  }
  console.log(`(미리보기) 총 ${rows.length.toLocaleString()}종목 — 저장하지 않았어요`)
  process.exit(0)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
for (let i = 0; i < rows.length; i += 1000) {
  const { error } = await db.from('stock_master').upsert(rows.slice(i, i + 1000), { onConflict: 'symbol,market' })
  if (error) throw new Error(`저장 실패: ${error.message}`)
}
// 이번 파일에 없는 종목(상장 폐지 등) 정리
const { error: delErr, count } = await db.from('stock_master').delete({ count: 'exact' }).lt('updated_at', startedAt)
if (delErr) throw new Error(`정리 실패: ${delErr.message}`)

console.log(`✅ 저장 ${rows.length.toLocaleString()}종목 · 목록에서 빠진 종목 ${count ?? 0}개 삭제`)
