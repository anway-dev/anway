import type { AgentRole, SessionId, TenantId, UserId } from '@anway/types'
import type { IModelProvider, ToolCall } from './provider.js'

export interface ConversationTurn {
  readonly role: 'user' | 'assistant' | 'system'
  readonly content: string
  readonly toolCalls?: ToolCall[]
  readonly timestamp: number
}

/**
 * A graph entity pinned to this session. CLAUDE.md capability #8 ("multi-repo
 * sessions — dev query spans N repos, context maintained"): every entity the
 * user has brought into the conversation stays in scope for follow-up turns,
 * so "why is checkout-api failing after the payments-api deploy?" followed by
 * "now check the client repo too" keeps ALL of those repos' graph coordinates
 * live without the user re-naming them each turn.
 */
export interface SessionEntityRef {
  readonly id: string
  readonly name: string
}

export interface SessionContext {
  readonly sessionId: SessionId
  readonly userId: UserId
  readonly tenantId: TenantId
  readonly effectiveRole: AgentRole
  readonly turns: ConversationTurn[]
  readonly summary?: string
  readonly contextEntityId?: string
  readonly contextEntities?: readonly SessionEntityRef[]
}

export type SessionMeta = Omit<SessionContext, 'turns'>

export interface ISessionMemory {
  get(sessionId: SessionId): Promise<SessionContext | null>
  append(sessionId: SessionId, turn: ConversationTurn): Promise<void>
  summarise(sessionId: SessionId): Promise<void>
  clear(sessionId: SessionId): Promise<void>
  initSession?(meta: SessionMeta): Promise<void>
  /** Persist the session's resolved entity set (multi-repo carryover). */
  updateContextEntities?(sessionId: SessionId, entities: SessionEntityRef[]): Promise<void>
}

export interface MemoryConfig {
  type: 'redis'
  redisUrl?: string
  /** IModelProvider used by summarise() — cheap model recommended */
  summariseProvider?: IModelProvider
  summariseModel?: string
}
