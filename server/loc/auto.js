// =====================================================================
// LOC 자동 주문 (Cron) — 서버 전용
//   메리츠 연결 계좌(MERITZ_ACCOUNT_ID) 포트폴리오의 진행 중 사이클마다 [계산] → [주문 넣기] 와 같은 순서로:
//     1) 증권사 값으로 다시 계산 → 날짜별 내역 저장
//     2) 전량 매도로 끝났으면 종료 기록 (주문 안 함)
//     3) 아니면 submitPlan 으로 전송 — 안전장치 그대로 (오늘 걸린 주문 있으면 안 보냄, 보유 수량 불일치, 예산 초과, 실패 시 중단)
//   실제 전송은 LOC_ORDER_ENABLED=1 과 LOC_AUTO_ENABLED=1 이 둘 다 있을 때만 — 아니면 보낼 목록만 계산해 알림
//   결과는 알림(017 'loc_order')으로 — 같은 날 다시 실행돼도 알림 1개
// =====================================================================
import { adminDb } from '../kis.js'
import { normalize, buildPlan, submitPlan, orderList, orderEnabled } from './manual.js'
import { settingsOf, saveHistory, endCycle } from './cycles.js'
import { notify } from '../notify.js'
import { kstToday } from '../fx.js'

const flag = (v) => ['1', 'true'].includes(String(v || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase())
/** 자동 주문 스위치 (LOC_AUTO_ENABLED = 1 / true) */
export const autoEnabled = () => flag(process.env.LOC_AUTO_ENABLED)

const usd = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// 매수 금액 = 엔진이 정한 그날 매수 금액(① + ②). 계단 주문의 가격×수량 합이 아님 — 아래 계단은 종가가 그만큼 내려가야 체결되고
// 체결가는 그 종가라서, 어떤 종가에서도 실제 매수 합계는 이 금액을 넘지 않음
const summary = (list, buyAmount) => {
  const sells = list.filter((o) => o.side === 'sell').length
  const buys = list.filter((o) => o.side === 'buy').length
  return `매도 ${sells}건 · 매수 ${buys}건${buys ? ` · 매수 금액 ${usd(buyAmount)}` : ''}`
}

/** MERITZ_ACCOUNT_ID 계좌의 포트폴리오 id (없으면 null) */
async function linkedPortfolio(db) {
  const id = Number(String(process.env.MERITZ_ACCOUNT_ID || '').trim().replace(/^["']|["']$/g, ''))
  if (!(id > 0)) return null
  const { data, error } = await db.from('accounts').select('portfolio_id').eq('id', id).maybeSingle()
  if (error) throw error
  return data?.portfolio_id ?? null
}

/** 사이클 1개 처리 → { cycleId, symbol, result, title, body } */
async function runCycle(cycle, { send }) {
  const { settings, errors } = normalize(settingsOf(cycle))
  if (errors.length) return { result: 'invalid', title: `${cycle.symbol} 자동 주문 안 보냄`, body: `사이클 설정 확인 필요: ${errors.join(' · ')}` }

  const p = await buildPlan(settings)
  await saveHistory(cycle.id, p.history)
  if (p.ended) {
    await endCycle(cycle.id, p.ended)
    return { result: 'ended', title: `${cycle.symbol} 사이클 종료`, body: `전량 매도 확인 · 실현 수익 ${p.ended.pnl >= 0 ? '+' : '-'}${usd(Math.abs(p.ended.pnl))} (${p.ended.pnlPct}%)\n새 사이클은 자동매매 탭에서 시작해 주세요` }
  }

  const list = orderList(p.plan)
  const buyAmount = p.plan.buys.reduce((t, b) => t + b.amount, 0)
  if (!list.length) return { result: 'nothing', title: `${cycle.symbol} 오늘 주문 없음`, body: '보낼 주문이 없어요' }
  if (!send) {
    const why = !orderEnabled() ? 'LOC_ORDER_ENABLED' : 'LOC_AUTO_ENABLED'
    return { result: 'dry_run', title: `${cycle.symbol} LOC 주문 (시험 모드)`, body: `보낼 주문 ${list.length}건 · ${summary(list, buyAmount)}\n${why} 가 꺼져 있어 실제로 보내지 않았어요`, list }
  }

  // 전송 — 계산과 전송 사이에 현재가가 바뀌면(서명 불일치) 새 값으로 한 번 더
  let signature = p.signature
  let r
  try {
    for (let i = 0; i < 2; i++) {
      r = await submitPlan(settings, signature)
      if (!r.changed) break
      signature = r.preview.signature
    }
  } catch (e) {
    return { result: 'blocked', title: `${cycle.symbol} 자동 주문 안 보냄`, body: e.message }
  }
  if (r.changed) return { result: 'blocked', title: `${cycle.symbol} 자동 주문 안 보냄`, body: '가격이 계속 바뀌어 주문을 확정하지 못했어요. 자동매매 탭에서 직접 확인해 주세요' }
  if (r.dryRun) return { result: 'dry_run', title: `${cycle.symbol} LOC 주문 (시험 모드)`, body: `보낼 주문 ${r.list.length}건 · ${summary(r.list, buyAmount)}`, list: r.list }

  const bad = r.sent.filter((o) => o.status !== 'live')
  const sentList = r.sent.filter((o) => o.ok)
  if (r.complete) return { result: 'sent', title: `${cycle.symbol} LOC 주문 ${r.sent.length}건 넣음`, body: `${summary(r.sent, buyAmount)}\n모두 정상 접수됐어요`, sent: r.sent }
  return {
    result: 'partial',
    title: `${cycle.symbol} LOC 주문 확인 필요`,
    body: [`보낸 주문 ${sentList.length}/${list.length}건`, ...bad.slice(0, 3).map((o) => `${o.side === 'sell' ? '매도' : '매수'} ${o.qty}주 ${usd(o.price)}: ${o.reason || o.message || o.status}`), '자동매매 탭에서 주문 상태를 확인해 주세요'].join('\n'),
    sent: r.sent,
  }
}

/** Cron 1회 실행 → { date, portfolioId, send, cycles: [...] } */
export async function runAuto({ now = new Date() } = {}) {
  const db = adminDb()
  const date = kstToday()
  const send = orderEnabled() && autoEnabled()
  const pid = await linkedPortfolio(db)
  if (!pid) return { date, send, skipped: 'MERITZ_ACCOUNT_ID 없음 — 자동 주문할 계좌가 없어요' }
  const { data: cycles, error } = await db.from('loc_cycles').select('*').eq('portfolio_id', pid).eq('status', 'active')
  if (error) throw error

  const out = []
  for (const c of cycles) {
    let r
    try {
      r = await runCycle(c, { send })
    } catch (e) {
      console.error('[loc/auto]', c.id, e)
      r = { result: 'error', title: `${c.symbol} 자동 주문 실패`, body: e.message || '알 수 없는 오류' }
    }
    out.push({ cycleId: c.id, symbol: c.symbol, ...r })
    try {
      await notify(pid, { kind: 'loc_order', title: r.title, body: r.body, dedupKey: `loc_order:${c.id}:${date}`, data: { cycleId: c.id, result: r.result, at: now.toISOString() } })
    } catch (e) {
      console.error('[loc/auto] notify', e) // 017 미적용 등 — 주문 결과는 로그에 남음
    }
  }
  return { date, send, portfolioId: pid, cycles: out.map(({ list, sent, ...x }) => ({ ...x, orders: (sent || list || []).length })) }
}
