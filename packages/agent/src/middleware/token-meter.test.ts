import { describe, expect, it } from 'vitest'
import type { ModelCallRequest, TokenBudget } from './token-meter.js'
import { createTokenMeterMiddleware, reconcileTokenUsage } from './token-meter.js'

function makeReq(estimatedTokens: number): ModelCallRequest {
  return { estimatedTokens, messages: [], model: 'claude-haiku-4-5' }
}

function makeBudget(overrides: Partial<TokenBudget> = {}): TokenBudget {
  return {
    perQueryHardLimit: 10_000,
    perSessionLimit: 50_000,
    perTenantDailyLimit: 100_000,
    perTenantMonthlyLimit: 1_000_000,
    sessionUsed: 0,
    tenantDailyUsed: 0,
    tenantMonthlyUsed: 0,
    ...overrides,
  }
}

describe('createTokenMeterMiddleware', () => {
  it('passes request through when all budgets are within limits', async () => {
    const meter = createTokenMeterMiddleware(makeBudget())
    const req = makeReq(500)
    const result = await meter(req)
    expect(result).toBe(req)
  })

  it('blocks when estimated tokens exceed per-query hard limit', async () => {
    const meter = createTokenMeterMiddleware(makeBudget({ perQueryHardLimit: 100 }))
    const result = await meter(makeReq(101))
    expect((result as { _tag: string })._tag).toBe('TokenHardBlock')
    expect((result as { limitType: string }).limitType).toBe('per_query')
  })

  it('blocks when session budget is at zero (sessionUsed equals limit)', async () => {
    const meter = createTokenMeterMiddleware(makeBudget({ perSessionLimit: 0, sessionUsed: 0 }))
    const result = await meter(makeReq(1))
    expect((result as { _tag: string })._tag).toBe('TokenHardBlock')
    expect((result as { limitType: string }).limitType).toBe('per_session')
  })

  it('blocks when adding to existing session usage would exceed limit', async () => {
    const meter = createTokenMeterMiddleware(makeBudget({ perSessionLimit: 1000, sessionUsed: 900 }))
    const result = await meter(makeReq(200))
    expect((result as { _tag: string })._tag).toBe('TokenHardBlock')
    expect((result as { limitType: string }).limitType).toBe('per_session')
  })

  it('blocks when tenant daily limit would be exceeded', async () => {
    const meter = createTokenMeterMiddleware(makeBudget({ perTenantDailyLimit: 500, tenantDailyUsed: 400 }))
    const result = await meter(makeReq(200))
    expect((result as { _tag: string })._tag).toBe('TokenHardBlock')
    expect((result as { limitType: string }).limitType).toBe('per_tenant_daily')
  })

  it('blocks when tenant monthly limit would be exceeded', async () => {
    const meter = createTokenMeterMiddleware(makeBudget({ perTenantMonthlyLimit: 1000, tenantMonthlyUsed: 900 }))
    const result = await meter(makeReq(200))
    expect((result as { _tag: string })._tag).toBe('TokenHardBlock')
    expect((result as { limitType: string }).limitType).toBe('per_tenant_monthly')
  })

  it('all limits at 0 — blocks any request', async () => {
    const meter = createTokenMeterMiddleware(makeBudget({
      perQueryHardLimit: 0,
      perSessionLimit: 0,
      perTenantDailyLimit: 0,
      perTenantMonthlyLimit: 0,
    }))
    const result = await meter(makeReq(1))
    expect((result as { _tag: string })._tag).toBe('TokenHardBlock')
  })

  it('reserves the estimate into the budget synchronously on a passing check', async () => {
    const budget = makeBudget()
    const meter = createTokenMeterMiddleware(budget)
    await meter(makeReq(500))
    expect(budget.sessionUsed).toBe(500)
    expect(budget.tenantDailyUsed).toBe(500)
    expect(budget.tenantMonthlyUsed).toBe(500)
  })

  it('does not reserve when the check blocks', async () => {
    const budget = makeBudget({ perSessionLimit: 100 })
    const meter = createTokenMeterMiddleware(budget)
    const result = await meter(makeReq(200))
    expect((result as { _tag: string })._tag).toBe('TokenHardBlock')
    expect(budget.sessionUsed).toBe(0)
  })

  // Regression test for finding I10: a real TOCTOU race under the
  // orchestrator's concurrent ConnectorAgents — multiple agents run via
  // Promise.all against the same shared TokenBudget object. Previously the
  // middleware only checked without reserving, so two concurrent calls
  // could both read the same pre-race budget.sessionUsed, both pass their
  // individual check, and only increment afterward — allowing combined
  // actual spend to exceed the limit. Reserving synchronously at check time
  // means the second concurrent call now correctly sees the first's
  // reservation and blocks.
  it('closes the concurrent-call TOCTOU race — second concurrent call sees the first reservation', async () => {
    const budget = makeBudget({ perSessionLimit: 1000, sessionUsed: 0 })
    const meterA = createTokenMeterMiddleware(budget)
    const meterB = createTokenMeterMiddleware(budget)

    // Both calls request 600 tokens — individually fine against a 1000
    // limit, but 600+600=1200 exceeds it. Since createTokenMeterMiddleware
    // has no `await` before its synchronous check+reserve, calling both
    // without awaiting between them exercises the exact interleaving
    // concurrent ConnectorAgents produce.
    const resultA = await meterA(makeReq(600))
    const resultB = await meterB(makeReq(600))

    expect('_tag' in resultA ? resultA._tag : 'ok').toBe('ok')
    expect((resultB as { _tag: string })._tag).toBe('TokenHardBlock')
    expect(budget.sessionUsed).toBe(600) // only A's reservation held
  })
})

describe('reconcileTokenUsage', () => {
  it('adds the delta between actual and estimated (actual higher than estimate)', () => {
    const budget = makeBudget({ sessionUsed: 500, tenantDailyUsed: 500, tenantMonthlyUsed: 500 })
    reconcileTokenUsage(budget, 100, 150)
    expect(budget.sessionUsed).toBe(550)
    expect(budget.tenantDailyUsed).toBe(550)
    expect(budget.tenantMonthlyUsed).toBe(550)
  })

  it('subtracts the delta when actual is lower than the estimate (releases over-reservation)', () => {
    const budget = makeBudget({ sessionUsed: 500, tenantDailyUsed: 500, tenantMonthlyUsed: 500 })
    reconcileTokenUsage(budget, 100, 40)
    expect(budget.sessionUsed).toBe(440)
  })

  it('fully releases the reservation when actual is 0 (failed model call)', () => {
    const budget = makeBudget({ sessionUsed: 500 })
    reconcileTokenUsage(budget, 200, 0)
    expect(budget.sessionUsed).toBe(300)
  })

  it('composes correctly with createTokenMeterMiddleware: reserve then reconcile nets out to real usage', async () => {
    const budget = makeBudget()
    const meter = createTokenMeterMiddleware(budget)
    const estimated = 500
    await meter(makeReq(estimated))
    expect(budget.sessionUsed).toBe(500) // reserved

    const actual = 320 // real usage came in lower than the estimate
    reconcileTokenUsage(budget, estimated, actual)
    expect(budget.sessionUsed).toBe(320) // reconciled to the real total
  })
})
