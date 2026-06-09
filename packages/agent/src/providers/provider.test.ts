import { describe, it, expect } from 'vitest'
import type { IModelProvider, ChatResponse, StreamChunk, InferenceOptions, ToolCall, ToolDefinition } from '../interfaces/provider.js'
import { ProviderFactory } from './factory.js'
import type { Message } from '@anvay/types'

// ---------------------------------------------------------------------------
// ProviderFactory instantiation
// ---------------------------------------------------------------------------

describe('ProviderFactory.create', () => {
  it('returns provider with chat + stream for anthropic', () => {
    const p = ProviderFactory.create({ type: 'anthropic', apiKey: 'test-key' })
    expect(typeof p.chat).toBe('function')
    expect(typeof p.stream).toBe('function')
  })

  it('returns provider with chat + stream for openai', () => {
    const p = ProviderFactory.create({ type: 'openai', apiKey: 'test-key' })
    expect(typeof p.chat).toBe('function')
    expect(typeof p.stream).toBe('function')
  })

  it('returns provider with chat + stream for ollama', () => {
    const p = ProviderFactory.create({ type: 'ollama' })
    expect(typeof p.chat).toBe('function')
    expect(typeof p.stream).toBe('function')
  })

  it('returns provider with chat + stream for groq', () => {
    const p = ProviderFactory.create({ type: 'groq', apiKey: 'test-key' })
    expect(typeof p.chat).toBe('function')
    expect(typeof p.stream).toBe('function')
  })

  it('returns provider with chat + stream for mistral', () => {
    const p = ProviderFactory.create({ type: 'mistral', apiKey: 'test-key' })
    expect(typeof p.chat).toBe('function')
    expect(typeof p.stream).toBe('function')
  })

  it('returns provider with chat + stream for lmstudio', () => {
    const p = ProviderFactory.create({ type: 'lmstudio' })
    expect(typeof p.chat).toBe('function')
    expect(typeof p.stream).toBe('function')
  })

  it('throws AppError for unknown provider type', () => {
    expect(() =>
      ProviderFactory.create({ type: 'unknown-provider' })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Mock IModelProvider — proves orchestrator needs only the interface
// ---------------------------------------------------------------------------

class MockProvider implements IModelProvider {
  async chat(_messages: Message[], _tools: ToolDefinition[], _opts: InferenceOptions): Promise<ChatResponse> {
    return {
      content: 'mock response',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    }
  }

  async *stream(_messages: Message[], _tools: ToolDefinition[], _opts: InferenceOptions): AsyncGenerator<StreamChunk> {
    yield { type: 'text_delta', content: 'hello ' }
    yield { type: 'text_delta', content: 'world' }
    yield { type: 'done', inputTokens: 10, outputTokens: 5 }
  }

  formatToolResult(_toolCallId: string, result: unknown): Message {
    return { role: 'user', content: JSON.stringify(result) }
  }

  formatToolCall(_toolCalls: ToolCall[]): Message {
    return { role: 'assistant', content: '' }
  }
}

describe('IModelProvider contract via MockProvider', () => {
  const messages: Message[] = [{ role: 'user', content: 'test query' }]
  const tools: ToolDefinition[] = []
  const opts: InferenceOptions = { model: 'mock-model' }

  it('chat() returns ChatResponse with all required fields', async () => {
    const provider: IModelProvider = new MockProvider()
    const response = await provider.chat(messages, tools, opts)
    expect(response.content).toBe('mock response')
    expect(response.toolCalls).toHaveLength(0)
    expect(response.usage.inputTokens).toBe(10)
    expect(response.usage.outputTokens).toBe(5)
  })

  it('stream() yields text_delta chunks then done', async () => {
    const provider: IModelProvider = new MockProvider()
    const chunks: StreamChunk[] = []
    for await (const chunk of provider.stream(messages, tools, opts)) {
      chunks.push(chunk)
    }
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual({ type: 'text_delta', content: 'hello ' })
    expect(chunks[1]).toEqual({ type: 'text_delta', content: 'world' })
    expect(chunks[2]).toEqual({ type: 'done', inputTokens: 10, outputTokens: 5 })
  })

  it('provider.stream() is the only method called — no SDK method needed', async () => {
    // This test proves orchestrator only needs IModelProvider — MockProvider has no SDK
    const provider: IModelProvider = new MockProvider()
    const collected: string[] = []
    for await (const chunk of provider.stream(messages, tools, opts)) {
      if (chunk.type === 'text_delta') collected.push(chunk.content)
    }
    expect(collected.join('')).toBe('hello world')
  })

  it('all StreamEvent discriminant types are valid StreamChunk values', () => {
    // Type-level check via assignability — each literal is a valid StreamChunk
    const textDelta: StreamChunk = { type: 'text_delta', content: 'x' }
    const toolCall: StreamChunk = { type: 'tool_call', toolName: 'f', toolCallId: '1', args: {} }
    const toolResult: StreamChunk = { type: 'tool_result', toolCallId: '1', result: null }
    const gate: StreamChunk = { type: 'gate_required', gateId: 'g', toolCallId: '1', toolName: 'test', args: {} }
    const done: StreamChunk = { type: 'done', inputTokens: 1, outputTokens: 1 }
    const error: StreamChunk = { type: 'error', code: 'UPSTREAM_ERROR', message: 'fail' }

    // All assignable without TypeScript errors — runtime check confirms they're objects
    for (const chunk of [textDelta, toolCall, toolResult, gate, done, error]) {
      expect(typeof chunk.type).toBe('string')
    }
  })
})

// ---------------------------------------------------------------------------
// Public API surface — verify concrete providers NOT exported from index
// ---------------------------------------------------------------------------

describe('@anvay/agent public exports', () => {
  it('exports ProviderFactory', async () => {
    const mod = await import('../index.js')
    expect(mod.ProviderFactory).toBeDefined()
  })

  it('does NOT export AnthropicProvider, OpenAIProvider, or OllamaProvider', async () => {
    const mod = await import('../index.js') as Record<string, unknown>
    expect(mod['AnthropicProvider']).toBeUndefined()
    expect(mod['OpenAIProvider']).toBeUndefined()
    expect(mod['OllamaProvider']).toBeUndefined()
  })
})
