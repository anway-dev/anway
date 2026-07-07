import type { Message } from '@anway/types'

export interface TokenBudget {
  readonly perQueryHardLimit: number
  readonly perSessionLimit: number
  readonly perTenantDailyLimit: number
  readonly perTenantMonthlyLimit: number
  sessionUsed: number
  tenantDailyUsed: number
  tenantMonthlyUsed: number
}

export interface ModelCallRequest {
  readonly estimatedTokens: number
  readonly messages: Message[]
  readonly model: string
}

export type TokenLimitType = 'per_query' | 'per_session' | 'per_tenant_daily' | 'per_tenant_monthly'

export interface TokenHardBlock {
  readonly _tag: 'TokenHardBlock'
  readonly reason: string
  readonly limitType: TokenLimitType
  readonly used: number
  readonly limit: number
}

/**
 * Returns a middleware that hard-blocks a model call when any token budget is
 * exceeded, and synchronously reserves the estimate into `budget` before
 * returning.
 *
 * Confirmed live via independent review: this previously only checked
 * without reserving ("metering happens after the call completes"), which is
 * a real TOCTOU race under the orchestrator's concurrent ConnectorAgents —
 * multiple agents run via Promise.all against the same shared TokenBudget
 * object, each awaiting a real (slow) model call between its own check and
 * its own post-call increment. Two concurrent agents could both read the
 * same pre-race budget.sessionUsed, both pass their individual check, then
 * both spend for real — the combined actual usage could exceed the limit by
 * as much as the second agent's entire call, since its check never saw the
 * first agent's reservation.
 *
 * The fix: reserve `req.estimatedTokens` into all three counters
 * synchronously, in the same function invocation as the check (no `await`
 * between them) — JS's single-threaded event loop guarantees no other
 * concurrent call can interleave between the check and this reservation, so
 * a second concurrent caller's check now correctly sees the first caller's
 * reservation already applied. Callers must reconcile the estimate against
 * the real usage once the model call completes via reconcileTokenUsage()
 * below — the actual token count is only known after the call, but the
 * budget must be held (reserved) before it, not after.
 */
export function createTokenMeterMiddleware(
  budget: TokenBudget,
): (req: ModelCallRequest) => Promise<ModelCallRequest | TokenHardBlock> {
  return async (req: ModelCallRequest): Promise<ModelCallRequest | TokenHardBlock> => {
    if (req.estimatedTokens > budget.perQueryHardLimit) {
      return {
        _tag: 'TokenHardBlock',
        reason: `estimated tokens (${req.estimatedTokens}) exceeds per-query hard limit (${budget.perQueryHardLimit})`,
        limitType: 'per_query',
        used: req.estimatedTokens,
        limit: budget.perQueryHardLimit,
      }
    }

    if (budget.sessionUsed + req.estimatedTokens > budget.perSessionLimit) {
      return {
        _tag: 'TokenHardBlock',
        reason: `session token usage would exceed per-session limit (${budget.perSessionLimit})`,
        limitType: 'per_session',
        used: budget.sessionUsed + req.estimatedTokens,
        limit: budget.perSessionLimit,
      }
    }

    if (budget.tenantDailyUsed + req.estimatedTokens > budget.perTenantDailyLimit) {
      return {
        _tag: 'TokenHardBlock',
        reason: `tenant daily token usage would exceed daily limit (${budget.perTenantDailyLimit})`,
        limitType: 'per_tenant_daily',
        used: budget.tenantDailyUsed + req.estimatedTokens,
        limit: budget.perTenantDailyLimit,
      }
    }

    if (budget.tenantMonthlyUsed + req.estimatedTokens > budget.perTenantMonthlyLimit) {
      return {
        _tag: 'TokenHardBlock',
        reason: `tenant monthly token usage would exceed monthly limit (${budget.perTenantMonthlyLimit})`,
        limitType: 'per_tenant_monthly',
        used: budget.tenantMonthlyUsed + req.estimatedTokens,
        limit: budget.perTenantMonthlyLimit,
      }
    }

    // Reserve synchronously — see function doc comment above.
    budget.sessionUsed += req.estimatedTokens
    budget.tenantDailyUsed += req.estimatedTokens
    budget.tenantMonthlyUsed += req.estimatedTokens

    return req
  }
}

/**
 * Reconciles a prior estimate-based reservation (from createTokenMeterMiddleware)
 * against the real usage once a model call completes. Adds the delta
 * (actual - estimated), which may be negative if the estimate overshot —
 * call exactly once per successful checkTokens() call (one that returned a
 * real request, not a TokenHardBlock).
 */
export function reconcileTokenUsage(budget: TokenBudget, estimatedTokens: number, actualTokens: number): void {
  const delta = actualTokens - estimatedTokens
  budget.sessionUsed += delta
  budget.tenantDailyUsed += delta
  budget.tenantMonthlyUsed += delta
}
