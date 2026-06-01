import type { AgentRole, SessionId, TenantId, UserId } from '@anvay/types'
import type { IModelProvider, ToolCall } from './provider.js'

export interface ConversationTurn {
  readonly role: 'user' | 'assistant' | 'system'
  readonly content: string
  readonly toolCalls?: ToolCall[]
  readonly timestamp: number
}

export interface SessionContext {
  readonly sessionId: SessionId
  readonly userId: UserId
  readonly tenantId: TenantId
  readonly effectiveRole: AgentRole
  readonly turns: ConversationTurn[]
  readonly summary?: string
}

export type SessionMeta = Omit<SessionContext, 'turns'>

export interface ISessionMemory {
  get(sessionId: SessionId): Promise<SessionContext | null>
  append(sessionId: SessionId, turn: ConversationTurn): Promise<void>
  summarise(sessionId: SessionId): Promise<void>
  clear(sessionId: SessionId): Promise<void>
}

export interface MemoryConfig {
  type: 'redis'
  redisUrl?: string
  /** IModelProvider used by summarise() — cheap model recommended */
  summariseProvider?: IModelProvider
  summariseModel?: string
}
