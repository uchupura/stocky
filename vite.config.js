import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 로컬 개발용: /api/* 요청을 api/ 폴더의 함수로 연결 (배포 환경에서는 Vercel Functions 가 처리)
 *   예) /api/quote → api/quote.js 의 GET(request), /api/auth/naver/login → api/auth/naver/login.js
 */
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        try {
          // /api/quote → api/quote.js,  /api/auth/naver/login → api/auth/naver/login.js
          const name = new URL(req.url, 'http://local').pathname.replace(/^\/+|\/+$/g, '')
          if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(name)) throw Object.assign(new Error('Not found'), { status: 404 })
          const mod = await server.ssrLoadModule(`/api/${name}.js`) // 코드 수정 시 자동 반영
          const handler = mod[req.method]
          if (!handler) throw Object.assign(new Error('Method not allowed'), { status: 405 })

          const response = await handler(new Request(`http://${req.headers.host}/api${req.url}`, {
            method: req.method,
            headers: req.headers,
          }))
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          res.statusCode = e.status || 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: e.status ? e.message : '서버 오류' }))
          if (!e.status) console.error('[local-api]', e)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // .env 의 모든 값을 "개발 서버(Node)" 의 process.env 로만 읽어온다.
  // 브라우저에는 여전히 VITE_ 로 시작하는 값만 전달됨 (KIS 키·service_role 키는 전달 안 됨)
  //
  // .env 를 고치면 개발 서버가 다시 시작되며 이 코드가 다시 실행된다.
  // loadEnv 는 process.env 에 이미 있는 값을 우선하므로, 지난번에 넣은 값을 먼저 지워야
  // "처음 빈 값으로 저장 → 나중에 채움" 같은 경우에도 새 값이 반영된다.
  for (const k of globalThis.__dotenvKeys ?? []) delete process.env[k]
  const fileEnv = loadEnv(mode, process.cwd(), '')
  globalThis.__dotenvKeys = Object.keys(fileEnv).filter((k) => !(k in process.env))
  Object.assign(process.env, fileEnv)

  return {
    plugins: [vue(), localApi()],
  }
})
