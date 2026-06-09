import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { ProviderFactory } from '@anvay/agent'
import type { ProviderConfig, IConnectorAgent, ConnectorTool, ToolDefinition } from '@anvay/agent'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

const ALLOWED_CONNECTOR_TYPES = new Set([
  'github','datadog','linear','argocd','coralogix','notion','prometheus','newrelic',
  'jira','loki','terraform','pagerduty','slack','grafana','elastic','dynatrace',
  'sentry','jenkins','circleci','vercel','k8s','vault','snyk','sonarqube',
  'opsgenie','launchdarkly','confluence','eks','gke','aws-cloudwatch',
  'aws-health','gcp-monitoring','azure-monitor',
])

const MAX_ITERATIONS = 5

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  name?: string
}

interface ChatBody {
  messages: ChatMessage[]
  model?: string
}

export async function chatStreamRoutes(app: FastifyInstance) {
  app.post<{ Body: ChatBody }>('/api/chat/stream', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['messages'],
        properties: {
          messages: { type: 'array', minItems: 1 },
          model: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { messages, model } = request.body

    // Load provider config from DB
    const configRow = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ provider: string; api_key: string | null; base_url: string | null; default_model: string | null }[]>`
        SELECT provider, api_key, base_url, default_model FROM provider_config WHERE tenant_id = ${tenantId}::uuid
      `
    ).catch(() => [])

    let providerConfig: ProviderConfig | null = null
    if (configRow.length > 0 && configRow[0]!.api_key) {
      const r = configRow[0]!
      providerConfig = {
        type: r.provider,
        apiKey: r.api_key!,
        ...(r.base_url ? { baseURL: r.base_url } : {}),
        ...(r.default_model ? { defaultModel: r.default_model } : {}),
      }
    }
    if (!providerConfig) {
      return reply.code(503).send({ error: 'No LLM provider configured — configure in Settings > AI Provider in the web UI' })
    }

    const provider = ProviderFactory.create(providerConfig)
    const defaultModel = model ?? providerConfig.defaultModel ?? 'claude-sonnet-4-6'

    // Load connector agents for tenant
    const connConfigs = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ connector_type: string; credentials: Record<string, unknown> }[]>`
        SELECT connector_type AS connector_type, credentials FROM connector_config WHERE tenant_id = ${tenantId}::uuid AND enabled = true
      `
    ).catch(() => [])

    // Build tool list from connected connectors' agent files
    const tools: { definition: ToolDefinition; execute: (params: Record<string, unknown>) => Promise<unknown> }[] = []
    const credMap = new Map<string, Record<string, unknown>>()

    for (const cc of connConfigs) {
      if (!ALLOWED_CONNECTOR_TYPES.has(cc.connector_type) || /[./\\]/.test(cc.connector_type)) continue
      credMap.set(cc.connector_type, cc.credentials as Record<string, unknown>)
      try {
        const mod = await import(`../../../../connectors/${cc.connector_type}/src/agent.js`) as Record<string, unknown>
        // Try default export or named export {XxxAgent}
        const AgentClass = (Object.values(mod).find(v => typeof v === 'function' && (v as { prototype?: { connectorType?: string } }).prototype?.connectorType !== undefined)
          ?? Object.values(mod).find(v => typeof v === 'function')) as (new () => IConnectorAgent) | undefined
        if (AgentClass) {
          const agent = new AgentClass()
          for (const tool of agent.tools) {
            if (!tool.write) {
              tools.push({
                definition: tool.definition,
                execute: (params: Record<string, unknown>) => tool.execute(params, credMap.get(cc.connector_type) ?? {}),
              })
            }
          }
        }
      } catch {
        // Connector agent not available — skip
      }
    }

    // SSE setup
    const stream = new Readable({ read() {} })
    reply.header('Content-Type', 'text/event-stream')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')

    interface LLMMessage { role: 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string }
    const llmMessages: LLMMessage[] = messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {}),
    }))

    void (async () => {
      try {
        let iterations = 0
        while (iterations < MAX_ITERATIONS) {
          iterations++
          const response = await provider.chat(llmMessages as Parameters<typeof provider.chat>[0], tools.map(t => t.definition), {
            model: defaultModel,
            maxTokens: 2000,
          })

          if (response.content) {
            stream.push(`data: ${JSON.stringify({ type: 'text_delta', content: response.content })}\n\n`)
          }

          if (!response.toolCalls || response.toolCalls.length === 0) {
            stream.push('data: {"type":"done"}\n\n')
            break
          }

          for (const tc of response.toolCalls) {
            const tool = tools.find(t => t.definition.name === tc.name)
            if (tool) {
              try {
                const result = await tool.execute(tc.args as Record<string, unknown>)
                llmMessages.push({ role: 'tool' as const, content: JSON.stringify(result), tool_call_id: tc.id, name: tc.name })
                stream.push(`data: ${JSON.stringify({ type: 'tool_call', toolCallId: tc.id, toolName: tc.name, args: tc.args })}\n\n`)
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'tool execution failed'
                llmMessages.push({ role: 'assistant' as const, content: `Error: ${msg}` })
                stream.push(`data: ${JSON.stringify({ type: 'error', code: 'TOOL_ERROR', message: msg })}\n\n`)
              }
            }
          }
        }

        if (iterations >= MAX_ITERATIONS) {
          stream.push('data: {"type":"done"}\n\n')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'internal error'
        stream.push(`data: ${JSON.stringify({ type: 'error', code: 'UPSTREAM_ERROR', message: msg })}\n\n`)
      } finally {
        stream.push(null)
      }
    })()

    return reply.send(stream)
  })
}
