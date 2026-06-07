import type {
  ChatResponse,
  IModelProvider,
  InferenceOptions,
  ProviderConfig,
  StreamChunk,
  ToolCall,
  ToolDefinition,
} from '../interfaces/provider.js'
import type { Message } from '@anvay/types'

const DEFAULT_MODEL = 'llama3.2'
const DEFAULT_BASE_URL = 'http://localhost:11434/v1'

interface OpenAICompatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: OpenAICompatToolCall[]
}

interface OpenAICompatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OpenAICompatToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenAICompatChoice {
  message: {
    content: string | null
    tool_calls?: OpenAICompatToolCall[]
  }
  finish_reason: string | null
  delta?: {
    content?: string | null
    tool_calls?: Array<{
      index: number
      id?: string
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }
}

interface OpenAICompatResponse {
  choices: OpenAICompatChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

function mapMessages(messages: Message[]): OpenAICompatMessage[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        tool_call_id: m.tool_call_id ?? '',
      }
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: 'assistant',
        content: typeof m.content === 'string' ? m.content : '',
        tool_calls: m.tool_calls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        })),
      }
    }
    return {
      role: m.role as 'user' | 'assistant' | 'system',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }
  })
}

function mapTools(tools: ToolDefinition[]): OpenAICompatTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }))
}

export class OllamaProvider implements IModelProvider {
  private readonly baseURL: string

  constructor(private readonly config: ProviderConfig) {
    this.baseURL = config.baseURL ?? DEFAULT_BASE_URL
  }

  async chat(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: opts.model || (this.config.defaultModel ?? DEFAULT_MODEL),
      messages: mapMessages(messages),
      stream: false,
      ...(tools.length > 0 ? { tools: mapTools(tools) } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.stopSequences && opts.stopSequences.length > 0 ? { stop: opts.stopSequences } : {}),
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama request failed (${response.status}): ${text}`)
    }

    const data = (await response.json()) as OpenAICompatResponse
    const choice = data.choices[0]

    const content = choice?.message.content ?? ''
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: (() => {
        try {
          return JSON.parse(tc.function.arguments) as Record<string, unknown>
        } catch {
          return {}
        }
      })(),
    }))

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    }
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: opts.model || (this.config.defaultModel ?? DEFAULT_MODEL),
      messages: mapMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 ? { tools: mapTools(tools) } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.stopSequences && opts.stopSequences.length > 0 ? { stop: opts.stopSequences } : {}),
    }

    let response: Response
    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ollama connection failed'
      yield { type: 'error', code: 'UPSTREAM_ERROR', message }
      return
    }

    if (!response.ok) {
      const text = await response.text()
      yield { type: 'error', code: 'UPSTREAM_ERROR', message: `Ollama stream failed (${response.status}): ${text}` }
      return
    }

    const partialToolCalls = new Map<number, { id: string; name: string; argsJson: string }>()
    let inputTokens = 0
    let outputTokens = 0

    const reader = response.body?.getReader()
    if (!reader) {
      yield { type: 'error', code: 'UPSTREAM_ERROR', message: 'No response body from Ollama' }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep incomplete last line in buffer
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue

          const jsonStr = trimmed.slice(6)
          let chunk: { choices: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>; finish_reason?: string | null }; finish_reason?: string | null }>; usage?: { prompt_tokens: number; completion_tokens: number } }
          try {
            chunk = JSON.parse(jsonStr) as typeof chunk
          } catch {
            continue
          }

          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens
            outputTokens = chunk.usage.completion_tokens
          }

          const choice = chunk.choices[0]
          if (!choice) continue

          const delta = choice.delta

          if (delta?.content) {
            yield { type: 'text_delta', content: delta.content }
          }

          for (const tc of delta?.tool_calls ?? []) {
            const existing = partialToolCalls.get(tc.index) ?? {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              argsJson: '',
            }
            existing.argsJson += tc.function?.arguments ?? ''
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name = tc.function.name
            partialToolCalls.set(tc.index, existing)
          }

          const finishReason = choice.finish_reason ?? delta?.finish_reason
          if (finishReason === 'tool_calls') {
            for (const [, partial] of partialToolCalls) {
              let args: Record<string, unknown> = {}
              try {
                args = JSON.parse(partial.argsJson) as Record<string, unknown>
              } catch {
                args = {}
              }
              yield { type: 'tool_call', toolName: partial.name, toolCallId: partial.id, args }
            }
            partialToolCalls.clear()
          }
        }
      }

      yield { type: 'done', inputTokens, outputTokens }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ollama stream read error'
      yield { type: 'error', code: 'UPSTREAM_ERROR', message }
    } finally {
      reader.releaseLock()
    }
  }

  formatToolResult(toolCallId: string, result: unknown): Message {
    const content = typeof result === 'string' ? result : JSON.stringify(result)
    return {
      role: 'tool',
      content,
      tool_call_id: toolCallId,
    }
  }

  formatToolCall(toolCalls: ToolCall[]): Message {
    return {
      role: 'assistant',
      content: '',
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    }
  }
}
