import type { Message, ToolDefinition } from '../interfaces/provider.js'
import type { IModelProvider } from '../interfaces/provider.js'
import type { ExecutableTool } from '../orchestrator.js'

// ---------------------------------------------------------------------------
// AgentFinding — structured result returned by each connector agent.
// Orchestrator collects all findings and synthesises the final response.
// ---------------------------------------------------------------------------

export interface AgentFinding {
  agentType: string
  toolsUsed: string[]
  rawData: Record<string, unknown>
  summary: string      // 2-3 sentences for orchestrator synthesis prompt
  confidence: number   // 0.0–1.0
  error?: string
}

// ---------------------------------------------------------------------------
// SpecialistContext — passed to each connector agent by the orchestrator.
// Contains graph-resolved coordinates and alert context.
// ---------------------------------------------------------------------------

export interface SpecialistContext {
  task: string                        // what to investigate
  intent: string                      // classified intent
  coordinates: Record<string, string> // graph-resolved labels: { service, job, namespace, … }
  alertContext?: string               // serialised alert labels from alertmanager (if pre-fetched)
  entityHint?: string                 // fallback when graph has no coordinates
  tenantId: string
  sessionId: string
  userId: string
}

// ---------------------------------------------------------------------------
// Per-connector system prompts — each agent knows only its domain.
// ---------------------------------------------------------------------------

const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  alertmanager:
    'You are the Alertmanager data agent. Your ONLY job: retrieve all active alerts and their labels.\n' +
    'Steps:\n' +
    '1. Call alertmanager__alerts (no args) to get all firing alerts.\n' +
    '2. Extract from each alert: alertname, service, job, namespace, instance, severity, summary annotation.\n' +
    '3. Return the complete structured list with all label/annotation values.\n' +
    'End with: "SUMMARY: [2 sentences — what is firing, which services are affected, severity]".\n' +
    'Do NOT call any other tool. Do NOT fabricate alert data.',

  prometheus:
    'You are the Prometheus data agent. Your ONLY job: query targeted metrics for specific services.\n' +
    'Rules:\n' +
    '1. Use ONLY the service/job/namespace labels from connector coordinates or alert context.\n' +
    '2. Query error rate, request rate, p99 latency, and saturation for each affected service.\n' +
    '3. Example targeted queries:\n' +
    '   - rate(http_requests_total{service="X"}[5m])\n' +
    '   - histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{service="X"}[5m]))\n' +
    '   - sum(increase(http_requests_total{service="X",status=~"5.."}[5m]))\n' +
    '4. Return raw metric values with units.\n' +
    'FORBIDDEN: {service=~".+"}, {__name__=~".*"}, empty selectors {} — these will be rejected.\n' +
    'End with: "SUMMARY: [2 sentences — what the metrics show, trend, anomalies]".',

  loki:
    'You are the Loki log agent. Your ONLY job: find error patterns in service logs.\n' +
    'Rules:\n' +
    '1. Use the service/app label from connector coordinates — never query all logs.\n' +
    '2. Search for: ERROR, WARN, exception, stacktrace, timeout, connection refused, panic.\n' +
    '3. Scope to last 15 minutes by default (since=15m).\n' +
    '4. Return the most relevant log lines with timestamps.\n' +
    'FORBIDDEN: {app=~".+"} or empty selectors {} — these will be rejected.\n' +
    'End with: "SUMMARY: [2 sentences — key error patterns, frequency, first seen]".',

  grafana:
    'You are the Grafana data agent. Your ONLY job: find relevant dashboards for the service.\n' +
    'Rules:\n' +
    '1. Call grafana__dashboards with the service name from connector coordinates as query.\n' +
    '2. FORBIDDEN: empty string or "*" as query — pass the actual service name.\n' +
    '3. Return dashboard titles and URLs.\n' +
    'End with: "SUMMARY: [1 sentence — dashboards available and their purpose]".',

  github:
    'You are the GitHub data agent. Your ONLY job: surface recent code changes relevant to the issue.\n' +
    'Rules:\n' +
    '1. Use the repo from connector coordinates.\n' +
    '2. List PRs merged in the last 24h (state=closed or merged).\n' +
    '3. Note changes to critical paths: auth, payment, DB schema, config.\n' +
    'End with: "SUMMARY: [2 sentences — recent changes and their potential impact on the issue]".',
}

// ---------------------------------------------------------------------------
// ConnectorAgent — mini non-streaming agentic loop.
// Called by orchestrator in parallel. Returns structured AgentFinding.
// Uses cheap model tier (henchman) — expensive model is for synthesis only.
// ---------------------------------------------------------------------------

export class ConnectorAgent {
  constructor(
    readonly agentType: string,
    private model: IModelProvider,
    private tools: ExecutableTool[],
  ) {}

  async run(ctx: SpecialistContext, signal?: AbortSignal): Promise<AgentFinding> {
    if (this.tools.length === 0) {
      return {
        agentType: this.agentType,
        toolsUsed: [],
        rawData: {},
        summary: `No tools registered for ${this.agentType} connector.`,
        confidence: 0,
      }
    }

    const systemPrompt =
      AGENT_SYSTEM_PROMPTS[this.agentType] ??
      `You are the ${this.agentType} data agent. Query your connector and return structured findings.`

    // Build task message — inject coordinates + alert context if available
    const coordPart = Object.keys(ctx.coordinates).length > 0
      ? `\nConnector coordinates (use these exact label values): ${JSON.stringify(ctx.coordinates)}`
      : ''
    const alertPart = ctx.alertContext
      ? `\nAlert context (labels from alertmanager — use service/job/namespace from here): ${ctx.alertContext}`
      : ''
    const entityPart = ctx.entityHint ? `\nEntity hint (fallback name if no coordinates): ${ctx.entityHint}` : ''

    const userContent =
      `Task: ${ctx.task}\nIntent: ${ctx.intent}` +
      coordPart + alertPart + entityPart

    const toolDefs: ToolDefinition[] = this.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]

    const rawData: Record<string, unknown> = {}
    const toolsUsed: string[] = []
    const MAX_STEPS = 5

    for (let step = 0; step < MAX_STEPS; step++) {
      let resp: Awaited<ReturnType<typeof this.model.chat>>
      try {
        resp = await this.model.chat(messages, toolDefs, {
          model: this.model.cheapModelId,
          maxTokens: 2000,
          temperature: 0,
          ...(signal ? { signal } : {}),
        })
      } catch (e) {
        return {
          agentType: this.agentType,
          toolsUsed,
          rawData,
          summary: `${this.agentType} agent error: ${e instanceof Error ? e.message : String(e)}`,
          confidence: 0,
          error: String(e),
        }
      }

      // No tool calls → agent produced final summary
      if (!resp.toolCalls || resp.toolCalls.length === 0) {
        return {
          agentType: this.agentType,
          toolsUsed,
          rawData,
          summary: resp.content || `${this.agentType}: no findings.`,
          confidence: toolsUsed.length > 0 ? 0.80 : 0.20,
        }
      }

      // Execute tool calls, feed results back
      const resultMessages: Message[] = []
      for (const call of resp.toolCalls) {
        const tool = this.tools.find(t => t.name === call.name)
        let result: unknown
        if (tool) {
          try {
            result = await tool.run(call.args)
            rawData[call.name] = result
            toolsUsed.push(call.name)
          } catch (e) {
            result = { error: `Tool execution failed: ${e instanceof Error ? e.message : String(e)}` }
          }
        } else {
          result = { error: `Tool "${call.name}" not available in ${this.agentType} agent` }
        }
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        const truncated = resultStr.length > 6000
          ? resultStr.slice(0, 6000) + `\n[truncated — ${resultStr.length - 6000} chars omitted. Use targeted queries.]`
          : result
        resultMessages.push(this.model.formatToolResult(call.id, truncated))
      }

      messages.push(this.model.formatToolCall(resp.toolCalls))
      for (const r of resultMessages) messages.push(r)
    }

    return {
      agentType: this.agentType,
      toolsUsed,
      rawData,
      summary: `${this.agentType}: max investigation steps reached. Partial data collected.`,
      confidence: 0.40,
    }
  }
}

// ---------------------------------------------------------------------------
// Utility — group flat ExecutableTool array by connector prefix.
// 'prometheus__query' → key 'prometheus', 'loki__query' → key 'loki', etc.
// ---------------------------------------------------------------------------

export function groupToolsByConnector(tools: ExecutableTool[]): Map<string, ExecutableTool[]> {
  const map = new Map<string, ExecutableTool[]>()
  for (const tool of tools) {
    const prefix = tool.name.split('__')[0] ?? tool.name
    if (!map.has(prefix)) map.set(prefix, [])
    map.get(prefix)!.push(tool)
  }
  return map
}

// ---------------------------------------------------------------------------
// Utility — select which connector types to activate based on query intent.
// ---------------------------------------------------------------------------

export function selectConnectorTypes(
  intent: string,
  isAlertInvestigation: boolean,
  available: string[],
): string[] {
  const has = (t: string) => available.includes(t)

  // Incident triage / alerts: metrics + logs + alert state
  if (isAlertInvestigation || intent === 'incident_triage') {
    return ['alertmanager', 'prometheus', 'loki', 'grafana'].filter(has)
  }
  // Deployment / pipeline queries
  if (intent === 'deployment') {
    return ['github', 'prometheus'].filter(has)
  }
  // Code / feature queries
  if (intent === 'code_review' || intent === 'feature_status') {
    return ['github'].filter(has)
  }
  // Metrics-only queries
  if (intent === 'metrics') {
    return ['prometheus', 'grafana', 'alertmanager'].filter(has)
  }
  // General: activate all available connectors
  return available
}
