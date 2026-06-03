import type { Message } from '@anvay/types'

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
 * Returns a middleware that hard-blocks a model call when any token budget is exceeded.
 * Does not mutate the budget — metering of actual usage happens after the call completes.
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

    return req
  }
}
