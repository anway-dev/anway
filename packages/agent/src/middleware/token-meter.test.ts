import { describe, expect, it } from 'vitest'
import type { ModelCallRequest, TokenBudget } from './token-meter.js'
import { createTokenMeterMiddleware } from './token-meter.js'

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

  it('does not mutate the budget object', async () => {
    const budget = makeBudget()
    const meter = createTokenMeterMiddleware(budget)
    await meter(makeReq(500))
    expect(budget.sessionUsed).toBe(0)
    expect(budget.tenantDailyUsed).toBe(0)
  })
})
