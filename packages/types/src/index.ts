// Branded type primitive — prevents plain string assignment without explicit cast
declare const __brand: unique symbol
type Brand<T, B> = T & { readonly [__brand]: B }

export type TenantId = Brand<string, 'TenantId'>
export type UserId = Brand<string, 'UserId'>
export type SessionId = Brand<string, 'SessionId'>
export type ConnectorId = Brand<string, 'ConnectorId'>

export const TenantId = (s: string): TenantId => s as TenantId
export const UserId = (s: string): UserId => s as UserId
export const SessionId = (s: string): SessionId => s as SessionId
export const ConnectorId = (s: string): ConnectorId => s as ConnectorId

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  TOKEN_LIMIT_EXCEEDED: 'TOKEN_LIMIT_EXCEEDED',
  INTENT_CLASSIFICATION_FAILED: 'INTENT_CLASSIFICATION_FAILED',
  GRAPH_CONTEXT_FAILED: 'GRAPH_CONTEXT_FAILED',
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// ---------------------------------------------------------------------------
// AppError base class
// ---------------------------------------------------------------------------

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly cause?: Error,
  ) {
    super(message)
    this.name = 'AppError'
    if (cause) this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack ?? ''}`
  }
}

// ---------------------------------------------------------------------------
// Result<T, E> — discriminated union
// ---------------------------------------------------------------------------

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E = AppError> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

// ---------------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------------

export const AgentRole = {
  sre: 'sre',
  dev: 'dev',
  pm: 'pm',
  ba: 'ba',
  admin: 'admin',
} as const
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole]

export const ConnectorMode = {
  read: 'read',
  write: 'write',
  'read-write': 'read-write',
} as const
export type ConnectorMode = (typeof ConnectorMode)[keyof typeof ConnectorMode]

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export type AnthropicToolUseBlock = {
  readonly type: 'tool_use'
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

export type AnthropicToolResultBlock = {
  readonly type: 'tool_result'
  readonly tool_use_id: string
  readonly content: string
}

export type AnthropicContentBlock = AnthropicToolUseBlock | AnthropicToolResultBlock

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface OpenAIToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly arguments: string
  }
}

export interface Message {
  readonly role: MessageRole
  readonly content: string | AnthropicContentBlock[]
  readonly tool_call_id?: string
  readonly tool_calls?: readonly OpenAIToolCall[]
}

// ---------------------------------------------------------------------------
// StreamEvent — discriminated union over streaming response types
// ---------------------------------------------------------------------------

export interface TextDeltaEvent {
  readonly type: 'text_delta'
  readonly content: string
}

export interface ToolCallEvent {
  readonly type: 'tool_call'
  readonly toolName: string
  readonly toolCallId: string
  readonly args: Record<string, unknown>
}

export interface ToolResultEvent {
  readonly type: 'tool_result'
  readonly toolCallId: string
  readonly result: unknown
}

export interface GateRequiredEvent {
  readonly type: 'gate_required'
  readonly gateId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly args: Record<string, unknown>
  readonly confidence?: number
}

export interface GroundingSource {
  readonly source: string
  readonly fetchedAt: string  // ISO 8601 — serialisable over SSE
  readonly confidence: number
  readonly freshness: number  // 0.0–1.0; < 0.5 = stale
}

export interface DoneEvent {
  readonly type: 'done'
  readonly inputTokens: number
  readonly outputTokens: number
  readonly groundingSources?: readonly GroundingSource[]
}

export interface ErrorEvent {
  readonly type: 'error'
  readonly code: ErrorCode
  readonly message: string
}

export interface AgentFindingEvent {
  readonly type: 'agent_finding'
  readonly agentType: string
  readonly summary: string
  readonly confidence: number
  readonly toolsUsed: string[]
}

export type StreamEvent =
  | TextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | GateRequiredEvent
  | AgentFindingEvent
  | DoneEvent
  | ErrorEvent

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export interface CapabilityManifest {
  readonly read?: string[]
  readonly write?: string[]
}

export interface ConnectorResult {
  readonly source: string
  readonly fetched_at: Date
  readonly ttl: number
  readonly freshness_score: number
  readonly data: unknown
}

export interface HealthStatus {
  readonly status: 'healthy' | 'degraded' | 'unhealthy'
  readonly message?: string
  readonly lastChecked: Date
}

export interface ConnectorQuery {
  readonly type: string
  readonly [key: string]: unknown
}

export interface ConnectorAction {
  readonly type: string
  readonly [key: string]: unknown
}

export interface ConnectorCreds {
  baseUrl?: string
  token?: string
  apiKey?: string
  password?: string
  org?: string
  [k: string]: unknown
}

export interface IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest
  read(query: ConnectorQuery): Promise<ConnectorResult>
  write(action: ConnectorAction): Promise<ConnectorResult>
  health(): Promise<HealthStatus>
}
