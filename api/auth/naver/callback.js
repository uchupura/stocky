// GET /api/auth/naver/callback?code=...&state=...  (네이버 로그인 후 돌아오는 주소)
//   1) state 확인 (위조 요청 차단)  2) code → 네이버 access token  3) 프로필(id·email·name)
//   4) 허용 목록 확인  5) Supabase 세션 발급  6) 앱으로 이동 (#access_token=... → supabase-js 가 자동 로그인)
import { cookie, readCookie, isAllowedEmail, issueSession, claimPortfolio, HttpError } from '../../../server/auth.js'

function back(origin, params, { clearState = true } = {}) {
  const headers = { location: `${origin}/${params}`, 'cache-control': 'no-store' }
  if (clearState) headers['set-cookie'] = cookie('naver_state', '', { maxAge: 0, secure: origin.startsWith('https:') })
  return new Response(null, { status: 302, headers })
}

export async function GET(request) {
  const url = new URL(request.url)
  const origin = url.origin
  const fail = (code) => back(origin, `?login_error=${code}`)

  try {
    // 사용자가 네이버 화면에서 취소한 경우
    if (url.searchParams.get('error')) return fail('cancelled')

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const saved = readCookie(request, 'naver_state')
    if (!code || !state || !saved || state !== saved) return fail('state')

    // 2) 토큰 교환
    const tokenRes = await fetch('https://nid.naver.com/oauth2.0/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.NAVER_CLIENT_ID,
        client_secret: process.env.NAVER_CLIENT_SECRET,
        code,
        state,
      }),
    })
    const token = await tokenRes.json().catch(() => ({}))
    if (!token.access_token) {
      console.error('[naver token]', token.error, token.error_description)
      return fail('token')
    }

    // 3) 프로필 — 네이버는 사용자 정보를 response 안에 담아 준다
    const meRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { authorization: `Bearer ${token.access_token}` },
    })
    const me = await meRes.json().catch(() => ({}))
    const p = me.response
    if (me.resultcode !== '00' || !p?.id) return fail('profile')
    if (!p.email) return fail('no_email') // 이메일 제공 동의 안 함

    // 4) 허용 목록
    if (!isAllowedEmail(p.email)) return fail('forbidden')

    // 5) 세션 발급 + 첫 로그인 때 포트폴리오 연결
    const { session, user } = await issueSession({ id: p.id, email: p.email, name: p.name || p.nickname })
    await claimPortfolio(user.id)

    // 6) 앱으로 — 주소 뒤 # 부분은 서버로 전송되지 않고, supabase-js 가 읽은 뒤 지운다
    const hash = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: String(session.expires_in),
      expires_at: String(session.expires_at),
      token_type: 'bearer',
      type: 'magiclink',
    })
    return back(origin, `#${hash}`)
  } catch (e) {
    console.error('[naver callback]', e)
    return fail(e instanceof HttpError && e.status === 403 ? 'forbidden' : 'server')
  }
}
