// =====================================================================
// 메리츠 계좌 → stocky 계좌 맞추기 — 서버 전용 (service_role)
//   연결 계좌: 환경변수 MERITZ_ACCOUNT_ID (stocky accounts.id) — 다른 계좌는 건드리지 않음
//   * 증권사에 있는 종목: 수량·평균 단가를 증권사 값으로 (매입 환율은 그대로)
//   * 새 종목: stocks 에서 찾고, 없으면 종목 마스터 + 현재가로 등록 → 추가 (매입 환율 = 지금 환율)
//   * 증권사에 없는 종목: 삭제
//   * 예수금: 원화 = 예수금, 달러 = 결제 전 매수 금액까지 뺀 값으로 덮어씀
//   증권사 조회가 하나라도 실패하면 아무것도 바꾸지 않음 (meritz.account() 가 먼저 다 받아 옴)
// =====================================================================
import { adminDb, getQuote } from './kis.js'
import { account as meritzAccount } from './meritz.js'

// 메리츠 거래소 코드 → stocky 거래소
const EXCHANGE_OF = { '0066': 'AMS', '0537': 'NAS', '0321': 'NYS' }
const r4 = (v) => Math.round(Number(v) * 10000) / 10000
const r2 = (v) => Math.round(Number(v) * 100) / 100

/** 연결된 계좌 (로그인한 사람 포트폴리오 것일 때만) → { accountId, portfolioId } | null */
export async function linkedAccount(userId) {
  const id = Number(String(process.env.MERITZ_ACCOUNT_ID || '').trim().replace(/^["']|["']$/g, ''))
  if (!(id > 0)) return null
  const { data, error } = await adminDb()
    .from('accounts').select('id, portfolio_id, portfolios!inner(owner_id)').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data || data.portfolios.owner_id !== userId) return null
  return { accountId: data.id, portfolioId: data.portfolio_id }
}

/**
 * 바뀔 내용 계산 (쓰기 없음)
 * @param broker meritz.account() 결과 { kr, us, krw, usd }
 * @returns {{ add, update, remove, cash, skipped }}
 */
export async function planSync({ portfolioId, accountId }, broker) {
  const db = adminDb()
  const [h, c] = await Promise.all([
    db.from('holdings').select('id, quantity, avg_price, stocks(id, symbol, market, name)').eq('portfolio_id', portfolioId).eq('account_id', accountId),
    db.from('cash_balances').select('currency, amount').eq('portfolio_id', portfolioId).eq('account_id', accountId),
  ])
  for (const r of [h, c]) if (r.error) throw r.error

  const want = [
    ...broker.kr.map((x) => ({ ...x, market: 'KR' })),
    ...broker.us.map((x) => ({ ...x, market: 'US' })),
  ]
  const key = (market, symbol) => `${market}:${symbol}`
  const mine = new Map(h.data.map((x) => [key(x.stocks.market, x.stocks.symbol), x]))
  const add = []
  const update = []
  for (const w of want) {
    const cur = mine.get(key(w.market, w.symbol))
    mine.delete(key(w.market, w.symbol))
    const qty = r4(w.qty)
    const avg = r4(w.avg)
    if (!cur) { add.push({ ...w, qty, avg }); continue }
    if (r4(cur.quantity) !== qty || r4(cur.avg_price) !== avg) {
      update.push({ id: cur.id, symbol: w.symbol, name: cur.stocks.name, market: w.market, from: { qty: Number(cur.quantity), avg: Number(cur.avg_price) }, to: { qty, avg } })
    }
  }
  const remove = [...mine.values()].map((x) => ({ id: x.id, symbol: x.stocks.symbol, name: x.stocks.name, market: x.stocks.market, qty: Number(x.quantity) }))

  const had = (cur) => Number(c.data.find((x) => x.currency === cur)?.amount || 0)
  const cash = [
    { currency: 'KRW', from: had('KRW'), to: Math.round(broker.krw) },
    { currency: 'USD', from: had('USD'), to: r2(broker.usd) },
  ].filter((x) => x.from !== x.to)
  return { add, update, remove, cash }
}

/** 새 종목 → stocks.id (없으면 종목 마스터 + 현재가로 등록), 못 찾으면 null */
async function ensureStock(db, w) {
  const { data: s, error } = await db.from('stocks').select('id, market').eq('symbol', w.symbol).maybeSingle()
  if (error) throw error
  if (s) return s.market === w.market ? s.id : null
  const { data: m, error: mErr } = await db.from('stock_master')
    .select('symbol, market, exchange, currency, name_ko, name_en').eq('symbol', w.symbol).eq('market', w.market).maybeSingle()
  if (mErr) throw mErr
  const exchange = m?.exchange || (w.market === 'US' ? EXCHANGE_OF[w.vendor] : null)
  if (!exchange) return null
  const q = await getQuote({ symbol: w.symbol, market: w.market, exchange }).catch(() => null)
  if (!(q?.price > 0)) return null
  const { data, error: iErr } = await db.from('stocks').insert({
    symbol: w.symbol, name: m?.name_ko || m?.name_en || w.name, market: w.market,
    currency: w.market === 'US' ? 'USD' : 'KRW', exchange,
    current_price: q.price, price_updated_at: new Date().toISOString(),
    ...(q.prevClose > 0 ? { prev_close: q.prevClose } : {}),
  }).select('id').single()
  if (iErr) throw iErr
  return data.id
}

/** 계산한 내용 반영 → { added, updated, removed, cashChanged, skipped: [{ symbol, name, reason }] }
 *  새 종목 확인(현재가 조회 포함)을 먼저 끝낸 뒤 쓰기 — 조회 실패로 중간에 멈춰 반만 바뀌지 않게 */
export async function applySync({ portfolioId, accountId }, plan) {
  const db = adminDb()
  const skipped = []
  const adds = []
  for (const w of plan.add) {
    const stockId = await ensureStock(db, w)
    if (stockId) adds.push({ ...w, stockId })
    else skipped.push({ symbol: w.symbol, name: w.name, reason: '종목 정보를 찾지 못했어요' })
  }
  const [{ data: fx, error: fxErr }, { data: order, error: oErr }] = await Promise.all([
    db.from('exchange_rates').select('rate_to_krw').eq('currency', 'USD').maybeSingle(),
    db.from('holdings').select('sort_order').eq('portfolio_id', portfolioId).order('sort_order', { ascending: false }).limit(1),
  ])
  if (fxErr || oErr) throw fxErr || oErr

  for (const u of plan.update) {
    const { error } = await db.from('holdings').update({ quantity: u.to.qty, avg_price: u.to.avg }).eq('id', u.id)
    if (error) throw error
  }
  if (plan.remove.length) {
    const { error } = await db.from('holdings').delete().in('id', plan.remove.map((x) => x.id))
    if (error) throw error
  }
  if (adds.length) {
    let next = Number(order?.[0]?.sort_order || 0) + 1
    const { error } = await db.from('holdings').insert(adds.map((w) => ({
      portfolio_id: portfolioId, account_id: accountId, stock_id: w.stockId,
      quantity: w.qty, avg_price: w.avg, sort_order: next++,
      avg_fx_rate: w.market === 'US' && fx?.rate_to_krw ? Number(fx.rate_to_krw) : null, // 새 종목만 지금 환율 (B 방식)
    })))
    if (error) throw error
  }
  for (const c of plan.cash) {
    const { error } = await db.from('cash_balances').upsert(
      { portfolio_id: portfolioId, account_id: accountId, currency: c.currency, amount: c.to },
      { onConflict: 'portfolio_id,account_id,currency' },
    )
    if (error) throw error
  }
  return { added: adds.length, updated: plan.update.length, removed: plan.remove.length, cashChanged: plan.cash.length > 0, skipped }
}

/** 로그인한 사용자 → 연결 계좌 맞추기. 연결 안 됐으면 null. dryRun 이면 계산만 */
export async function syncMeritz(userId, { dryRun = false, broker = null } = {}) {
  const link = await linkedAccount(userId)
  if (!link) return null
  const plan = await planSync(link, broker || (await meritzAccount()))
  if (dryRun) return { dryRun: true, ...plan }
  return { ...(await applySync(link, plan)), plan }
}
