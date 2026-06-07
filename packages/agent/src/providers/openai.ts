import OpenAI from 'openai'
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

const DEFAULT_MODEL = 'gpt-4o'

function mapTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }))
}

function mapMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        tool_call_id: m.tool_call_id ?? '',
      }
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: 'assistant' as const,
        content: typeof m.content === 'string' ? m.content : null,
        tool_calls: m.tool_calls as OpenAI.ChatCompletionMessageToolCall[],
      }
    }
    return {
      role: m.role as 'user' | 'assistant' | 'system',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }
  })
}

export class OpenAIProvider implements IModelProvider {
  private readonly client: OpenAI

  constructor(private readonly config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey ?? 'placeholder',
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    })
  }

  async chat(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): Promise<ChatResponse> {
    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: opts.model || (this.config.defaultModel ?? DEFAULT_MODEL),
      messages: mapMessages(messages),
      ...(tools.length > 0 ? { tools: mapTools(tools), tool_choice: 'auto' } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.stopSequences && opts.stopSequences.length > 0 ? { stop: opts.stopSequences } : {}),
    }

    const response = await this.client.chat.completions.create(params, { signal: opts.signal })
    const choice = response.choices[0]

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
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    }
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): AsyncGenerator<StreamChunk> {
    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: opts.model || (this.config.defaultModel ?? DEFAULT_MODEL),
      messages: mapMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 ? { tools: mapTools(tools), tool_choice: 'auto' } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.stopSequences && opts.stopSequences.length > 0 ? { stop: opts.stopSequences } : {}),
    }

    // Accumulate tool call args per index
    const partialToolCalls = new Map<
      number,
      { id: string; name: string; argsJson: string }
    >()
    let inputTokens = 0
    let outputTokens = 0

    try {
      const stream = await this.client.chat.completions.create(params, { signal: opts.signal })

      for await (const chunk of stream) {
        const choice = chunk.choices[0]

        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0
          outputTokens = chunk.usage.completion_tokens ?? 0
        }

        if (!choice) continue

        const delta = choice.delta

        if (delta.content) {
          yield { type: 'text_delta', content: delta.content }
        }

        for (const tc of delta.tool_calls ?? []) {
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

        // Emit completed tool calls when stream finishes (finish_reason = tool_calls)
        if (choice.finish_reason === 'tool_calls') {
          for (const [, partial] of partialToolCalls) {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(partial.argsJson) as Record<string, unknown>
            } catch {
              args = {}
            }
            yield {
              type: 'tool_call',
              toolName: partial.name,
              toolCallId: partial.id,
              args,
            }
          }
          partialToolCalls.clear()
        }
      }

      yield { type: 'done', inputTokens, outputTokens }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown OpenAI stream error'
      yield { type: 'error', code: 'UPSTREAM_ERROR', message }
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
