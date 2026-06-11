import type { Message, StreamEvent } from '@anvay/types'
import { AppError } from '@anvay/types'

export type { Message }
export { AppError }

// JSON Schema object describing tool parameters
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

// An LLM-requested tool invocation
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

// Per-call inference overrides
export interface InferenceOptions {
  model?: string           // optional — omit to use provider default
  temperature?: number
  maxTokens?: number
  stopSequences?: string[]
  signal?: AbortSignal
}

// Non-streaming response shape
export interface ChatResponse {
  content: string
  toolCalls: ToolCall[]
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

// StreamChunk maps 1:1 to StreamEvent from @anvay/types
export type StreamChunk = StreamEvent

// The ONLY interface agents and the orchestrator ever call — never a provider SDK directly
export interface IModelProvider {
  readonly modelId: string       // configured default model or fallback
  readonly cheapModelId: string  // configured cheap model or fallback to modelId
  chat(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): Promise<ChatResponse>
  stream(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): AsyncGenerator<StreamChunk>
  formatToolResult(toolCallId: string, result: unknown): Message
  formatToolCall(toolCalls: ToolCall[]): Message
}

// Embedding provider for KB semantic retrieval
export interface IEmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}

// Field definition for provider config forms — drives dynamic UI
export interface ProviderField {
  key: string
  label: string
  type: 'password' | 'text' | 'url'
  required: boolean
  placeholder?: string
  defaultValue?: string
}

// Provider manifest — every provider registered via manifest, no code change to add new ones
export interface ProviderManifest {
  id: string
  displayName: string
  website: string
  fields: ProviderField[]
  models: string[] | 'dynamic'
  modelsEndpoint?: string
  defaultBaseUrl?: string
  openAICompatible: boolean
  factory?: (config: ProviderConfig) => IModelProvider
}

// Supported provider types (kept for backwards compat, not used for routing)
export type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'groq' | 'mistral' | 'lmstudio'

// Configuration passed to ProviderFactory.create()
export interface ProviderConfig {
  type: string
  apiKey?: string
  baseURL?: string
  defaultModel?: string
  cheapModel?: string
}
