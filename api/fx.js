// GET /api/fx?date=2026-10-30
//   그날 원/달러 환율 (주말·휴일은 직전 영업일) — 로그인한 허용 사용자만
//   → { requested, date, rate, cached }
import { getUsdKrw } from '../server/fx.js'
import { requireUser, HttpError } from '../server/auth.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function GET(request) {
  const date = (new URL(request.url).searchParams.get('date') || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return json({ error: 'date 는 YYYY-MM-DD 형식이어야 해요.' }, 400)
  }
  if (date < '2000-01-01') return json({ error: '2000년 이후 날짜만 조회할 수 있어요.' }, 400)
  try {
    await requireUser(request)
    return json(await getUsdKrw(date))
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('[api/fx]', e)
    return json({ error: e.message || '환율을 가져오지 못했어요.' }, 502)
  }
}
