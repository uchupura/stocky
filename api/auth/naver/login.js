// GET /api/auth/naver/login → 네이버 로그인 화면으로 이동
//   state: 위조 요청(CSRF) 방지용 일회용 값 — 쿠키에 저장했다가 돌아올 때 비교
import { cookie } from '../../../server/auth.js'

export function GET(request) {
  const clientId = process.env.NAVER_CLIENT_ID
  if (!clientId) {
    return new Response('NAVER_CLIENT_ID 환경변수가 없어요.', { status: 500 })
  }
  const origin = new URL(request.url).origin
  const state = crypto.randomUUID()
  const authorize = new URL('https://nid.naver.com/oauth2.0/authorize')
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/naver/callback`,
    state,
  })
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      'set-cookie': cookie('naver_state', state, { maxAge: 600, secure: origin.startsWith('https:') }),
      'cache-control': 'no-store',
    },
  })
}
