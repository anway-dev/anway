import Anthropic from '@anthropic-ai/sdk'
import { AppError } from '@anvay/types'
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

const DEFAULT_MODEL = 'claude-sonnet-4-6'

function mapTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      ...(t.parameters as Record<string, unknown>),
    },
  }))
}

function extractSystem(messages: Message[]): string | undefined {
  return messages.find((m) => m.role === 'system')?.content as string | undefined
}

function mapMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const role = m.role === 'tool' ? 'user' : (m.role as 'user' | 'assistant')
      const content = m.content
      return { role, content } as Anthropic.MessageParam
    })
}

export class AnthropicProvider implements IModelProvider {
  private readonly client: Anthropic

  constructor(private readonly config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    })
  }

  async chat(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): Promise<ChatResponse> {
    const system = extractSystem(messages)
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: opts.model || (this.config.defaultModel ?? DEFAULT_MODEL),
      max_tokens: opts.maxTokens ?? 4096,
      messages: mapMessages(messages),
      ...(system ? { system } : {}),
      ...(tools.length > 0 ? { tools: mapTools(tools) } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.stopSequences && opts.stopSequences.length > 0 ? { stop_sequences: opts.stopSequences } : {}),
    }

    const response = await this.client.messages.create(params, { signal: opts.signal })

    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const toolCalls: ToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        args: b.input as Record<string, unknown>,
      }))

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    }
  }

  async *stream(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): AsyncGenerator<StreamChunk> {
    const system = extractSystem(messages)
    const params: Anthropic.MessageCreateParamsStreaming = {
      model: opts.model || (this.config.defaultModel ?? DEFAULT_MODEL),
      max_tokens: opts.maxTokens ?? 4096,
      messages: mapMessages(messages),
      stream: true,
      ...(system ? { system } : {}),
      ...(tools.length > 0 ? { tools: mapTools(tools) } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.stopSequences && opts.stopSequences.length > 0 ? { stop_sequences: opts.stopSequences } : {}),
    }

    // Track partial tool call args per content block index
    const partialToolCalls = new Map<number, { id: string; name: string; argsJson: string }>()
    let inputTokens = 0
    let outputTokens = 0

    try {
      const stream = this.client.messages.stream(params, { signal: opts.signal })

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            partialToolCalls.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              argsJson: '',
            })
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', content: event.delta.text }
          } else if (event.delta.type === 'input_json_delta') {
            const partial = partialToolCalls.get(event.index)
            if (partial) {
              partial.argsJson += event.delta.partial_json
            }
          }
        } else if (event.type === 'content_block_stop') {
          const partial = partialToolCalls.get(event.index)
          if (partial) {
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
            partialToolCalls.delete(event.index)
          }
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage.output_tokens
        } else if (event.type === 'message_start') {
          inputTokens = event.message.usage.input_tokens
        }
      }

      yield { type: 'done', inputTokens, outputTokens }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Anthropic stream error'
      yield { type: 'error', code: 'UPSTREAM_ERROR', message }
    }
  }

  formatToolResult(toolCallId: string, result: unknown): Message {
    const content = typeof result === 'string' ? result : JSON.stringify(result)
    return {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolCallId,
        content,
      }],
    }
  }

  formatToolCall(toolCalls: ToolCall[]): Message {
    return {
      role: 'assistant',
      content: toolCalls.map(tc => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.args,
      })),
    }
  }
}

export { AppError }
