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
  model: string
  temperature?: number
  maxTokens?: number
  stopSequences?: string[]
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
  chat(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): Promise<ChatResponse>
  stream(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): AsyncGenerator<StreamChunk>
  formatToolResult(toolCallId: string, result: unknown): Message
  formatToolCall(toolCalls: ToolCall[]): Message
}

// Embedding provider for KB semantic retrieval
export interface IEmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}

// Supported provider types
export type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'groq' | 'mistral' | 'lmstudio'

// Configuration passed to ProviderFactory.create()
export interface ProviderConfig {
  type: ProviderType
  apiKey?: string
  baseURL?: string
  defaultModel?: string
}
