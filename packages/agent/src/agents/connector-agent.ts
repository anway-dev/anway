import type { Message, ToolDefinition } from '../interfaces/provider.js'
import type { IModelProvider } from '../interfaces/provider.js'
import type { ExecutableTool } from '../orchestrator.js'
import type { AgentPerimeter } from '../perimeter/engine.js'
import type { IAuditSink } from '../interfaces/audit.js'
import type { PerimeterCtx } from '../middleware/perimeter.js'
import { createPerimeterMiddleware } from '../middleware/perimeter.js'
import { isWriteAction, pollGate } from '../gate/gate.js'
import type { IGateSink } from '../gate/gate.js'
import { connectorIdFromTool } from '../tools/naming.js'
import { createTokenMeterMiddleware, reconcileTokenUsage } from '../middleware/token-meter.js'
import type { TokenBudget } from '../middleware/token-meter.js'

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
  inputTokens?: number   // accumulated from model.chat() calls
  outputTokens?: number  // accumulated from model.chat() calls
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
  entityHint?: string | undefined                 // fallback when graph has no coordinates
  tenantId: string
  sessionId: string
  userId: string
}

// ---------------------------------------------------------------------------
// ConnectorAgentConfig — all required params for gated, audited execution.
// ---------------------------------------------------------------------------

export interface ConnectorAgentConfig {
  agentType: string
  model: IModelProvider
  tools: ExecutableTool[]
  /** REQUIRED — perimeter is not optional. Fails closed if omitted. */
  perimeter: AgentPerimeter
  /** REQUIRED — every tool call (allowed or blocked) is audit-logged. */
  auditSink: IAuditSink
  /** REQUIRED — scoped tenant/user/session identifiers for audit events. */
  perimeterCtx: PerimeterCtx
  /** L2 gate sink for write actions. Omit to hard-block all writes (safe default). */
  gateSink?: IGateSink | undefined
  // 30s was long enough for the poll mechanism itself but not for an actual
  // human to see a gate_required event and click approve — confirmed live,
  // the previous default made every chat-path write action time out before a
  // person could plausibly react. A real approval needs minutes, not
  // seconds; the orchestrator's own per-agent hard timeout no longer counts
  // against this window (see onGateEvent/onGateResolved below).
  /** Gate poll timeout in ms (default: 600000 / 10 minutes). */
  gateTimeoutMs?: number | undefined
  /** Callback invoked when a gate event is created — orchestrator uses this to yield a real gate_required SSE event and to stop counting this agent against its own hard timeout while the gate is open. */
  onGateEvent?: ((gateId: string, toolCallId: string, toolName: string, args: Record<string, unknown>) => void) | undefined
  /** Callback invoked once the gate above is resolved (approved/rejected/timed out) — pairs with onGateEvent so the orchestrator can resume counting this agent against its hard timeout. */
  onGateResolved?: ((gateId: string) => void) | undefined
  /** Token budget for metering all model calls in this agent. Shared across all agents. */
  budget?: TokenBudget | undefined
  /** Max tool-call round-trips for this agent (default: 5). Previously hardcoded — OrchestratorConfig.maxSteps was accepted but never actually reached this class. */
  maxSteps?: number | undefined
}

// ---------------------------------------------------------------------------
// Per-connector system prompts — each agent knows only its domain.
// ---------------------------------------------------------------------------

// Shared baseline, prepended to every connector agent's prompt — including
// the generic one-line fallback below for any connector type without a
// hand-written entry in AGENT_SYSTEM_PROMPTS (coralogix, dynatrace, terraform,
// snyk, cloud connectors, and any future type). Ported from what was
// ORCHESTRATOR_SYSTEM_PROMPT in orchestrator.ts — confirmed live via
// independent review that constant was built and then never actually sent to
// any model (the multi-agent rewrite replaced it with buildSynthesisMessages
// without carrying its anti-fabrication/graph-first rules anywhere), so every
// connector type without its own hand-written prompt ran with zero grounding
// discipline at all.
const BASE_AGENT_INSTRUCTIONS =
  'Every claim must be grounded in data returned by your own tool calls. ' +
  'When you cannot ground a claim, state explicitly what data is missing and why — never fabricate data.\n' +
  'MANDATORY: use only the connector coordinates / alert-context labels provided to you for every tool call. ' +
  'NEVER use broad/wildcard queries whose only purpose is to discover what exists — e.g. PromQL {service=~".+"}, ' +
  '{__name__=~".*"}, or an empty selector {}; Grafana/Loki searches for "" or "*". ' +
  'If a tool call returns an error or empty result, say so explicitly.\n\n'

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

  k8s:
    'You are the Kubernetes data agent. Your ONLY job: retrieve pod health and recent events for affected namespaces.\n' +
    'Rules:\n' +
    '1. Use namespace from connector coordinates (or "default" if not provided).\n' +
    '2. Call k8s__get_pods to list pod status — look for CrashLoopBackOff, Error, Pending, OOMKilled.\n' +
    '3. Call k8s__get_events to list recent warning events.\n' +
    '4. For failing pods: call k8s__get_pod_logs with the failing pod name.\n' +
    '5. Call k8s__get_deployments to check replica counts.\n' +
    'End with: "SUMMARY: [2 sentences — pod health, failing pods if any, key events]".\n' +
    'Do NOT call k8s__restart_deployment (write op, V1 blocked).',

  pagerduty:
    'You are the PagerDuty data agent. Your ONLY job: surface active incidents and current oncall.\n' +
    'Rules:\n' +
    '1. Call pagerduty__get_active_incidents (no args or with service from coordinates).\n' +
    '2. Call pagerduty__get_oncall with the team from connector coordinates.\n' +
    '3. Return: incident count, severity, who is oncall.\n' +
    'End with: "SUMMARY: [1-2 sentences — active incidents and oncall engineer]".\n' +
    'Do NOT call pagerduty__create_incident or pagerduty__acknowledge_alert (write ops, V1 blocked).',

  datadog:
    'You are the Datadog data agent. Your ONLY job: retrieve metrics and alerts for affected services.\n' +
    'Rules:\n' +
    '1. Use service name from connector coordinates.\n' +
    '2. Call datadog__get_metrics with service and window="1h".\n' +
    '3. Call datadog__get_alerts to list firing monitors.\n' +
    '4. Call datadog__get_logs with service and query="error OR exception".\n' +
    'End with: "SUMMARY: [2 sentences — key metrics, alert state, anomalies observed]".',

  linear:
    'You are the Linear data agent. Your ONLY job: surface open issues and project status for the team.\n' +
    'Rules:\n' +
    '1. Use team key from connector coordinates (or entity name as fallback).\n' +
    '2. Call linear__get_issues with team key.\n' +
    '3. Call linear__get_projects with team key for feature status.\n' +
    'End with: "SUMMARY: [2 sentences — open issues, priority items, project state]".\n' +
    'Do NOT call linear__create_issue (write op, V1 blocked).',

  argocd:
    'You are the ArgoCD data agent. Your ONLY job: retrieve deployment pipeline state.\n' +
    'Rules:\n' +
    '1. Use service from connector coordinates.\n' +
    '2. Call argocd__get_pipelines with the service name.\n' +
    '3. Call argocd__get_builds for the returned pipeline — look for failures.\n' +
    '4. Note: any failed or in-progress deploys, last successful deploy timestamp.\n' +
    'End with: "SUMMARY: [2 sentences — recent deploy state, last success, any failures]".\n' +
    'Do NOT call argocd__trigger_deploy (write op, V1 blocked).',

  sentry:
    'You are the Sentry data agent. Your ONLY job: retrieve error events and issues for affected services.\n' +
    'Rules:\n' +
    '1. Use project/service from connector coordinates.\n' +
    '2. Surface: error count, top error types, first/last seen, affected users.\n' +
    'End with: "SUMMARY: [2 sentences — error volume, top error types, user impact]".',

  elastic:
    'You are the Elasticsearch data agent. Your ONLY job: search application logs for errors.\n' +
    'Rules:\n' +
    '1. Use service/index from connector coordinates.\n' +
    '2. Search for error and exception events in the last 15 minutes.\n' +
    '3. Return: log lines with timestamps, error types, frequency.\n' +
    'End with: "SUMMARY: [2 sentences — error patterns, frequency, affected component]".',

  newrelic:
    'You are the New Relic data agent. Your ONLY job: retrieve APM metrics and alerts.\n' +
    'Rules:\n' +
    '1. Use application/service from connector coordinates.\n' +
    '2. Query error rate, throughput, response time, Apdex score.\n' +
    '3. Surface any active violations or alerts.\n' +
    'End with: "SUMMARY: [2 sentences — APM health, error rate, active violations]".',

  jenkins:
    'You are the Jenkins data agent. Your ONLY job: retrieve CI/CD pipeline status.\n' +
    'Rules:\n' +
    '1. Use job/pipeline from connector coordinates.\n' +
    '2. Retrieve recent build results — pass/fail, duration, last successful build.\n' +
    '3. Note any failing tests or stages.\n' +
    'End with: "SUMMARY: [2 sentences — build health, last failure if any, test results]".',

  jira:
    'You are the Jira data agent. Your ONLY job: surface open issues for the affected service/team.\n' +
    'Rules:\n' +
    '1. Use project key from connector coordinates.\n' +
    '2. Query for in-progress and recently created issues.\n' +
    '3. Look for issues mentioning the investigated service.\n' +
    'End with: "SUMMARY: [1-2 sentences — open issues, blockers, recent activity]".',
}

// ---------------------------------------------------------------------------
// ConnectorAgent — mini non-streaming agentic loop.
// Called by orchestrator in parallel. Returns structured AgentFinding.
// Uses cheap model tier (henchman) — expensive model is for synthesis only.
//
// Every tool call goes through:
//   1. Perimeter middleware — audit-logs allow/block
//   2. Write-action gate — push → SSE gate_required → poll → execute/reject
// ---------------------------------------------------------------------------

export class ConnectorAgent {
  readonly agentType: string
  private model: IModelProvider
  private tools: ExecutableTool[]
  private perimeter: AgentPerimeter
  private auditSink: IAuditSink
  private perimeterCtx: PerimeterCtx
  private gateSink: IGateSink | undefined
  private gateTimeoutMs: number
  private onGateEvent: ((gateId: string, toolCallId: string, toolName: string, args: Record<string, unknown>) => void) | undefined
  private onGateResolved: ((gateId: string) => void) | undefined
  private budget: TokenBudget | undefined
  private maxSteps: number

  constructor(config: ConnectorAgentConfig) {
    if (!config.perimeter) throw new Error('ConnectorAgent: perimeter is required')
    if (!config.auditSink) throw new Error('ConnectorAgent: auditSink is required')
    if (!config.perimeterCtx) throw new Error('ConnectorAgent: perimeterCtx is required')

    this.agentType = config.agentType
    this.model = config.model
    this.tools = config.tools
    this.perimeter = config.perimeter
    this.auditSink = config.auditSink
    this.perimeterCtx = config.perimeterCtx
    this.gateSink = config.gateSink
    this.gateTimeoutMs = config.gateTimeoutMs ?? 600_000
    this.onGateEvent = config.onGateEvent
    this.onGateResolved = config.onGateResolved
    this.budget = config.budget
    this.maxSteps = config.maxSteps ?? 5
  }

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

    // Perimeter middleware — every tool call is audit-logged (allowed or blocked).
    const checkPerimeter = createPerimeterMiddleware(this.perimeter, this.auditSink, this.perimeterCtx)

    const systemPrompt = BASE_AGENT_INSTRUCTIONS + (
      AGENT_SYSTEM_PROMPTS[this.agentType] ??
      `You are the ${this.agentType} data agent. Query your connector and return structured findings.`
    )

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
    // Real signal for the confidence score below, replacing what was a
    // hardcoded 0.80/0.20/0.40 constant regardless of what actually happened
    // — confirmed live via independent review that number was fabricated and
    // fed to users/synthesis as if it reflected real data quality.
    let toolCallsAttempted = 0
    let toolCallsSucceeded = 0
    let agentInputTokens = 0
    let agentOutputTokens = 0
    const MAX_STEPS = this.maxSteps

    for (let step = 0; step < MAX_STEPS; step++) {
      // Token metering — block before reaching the LLM if budget exceeded.
      // createTokenMeterMiddleware synchronously reserves estimatedTokens
      // into this.budget as part of the check itself (closes a real TOCTOU
      // race: multiple ConnectorAgents run concurrently via Promise.all
      // against this same shared budget object — see token-meter.ts's doc
      // comment). Must reconcile with the real usage below, including on a
      // failed model call (reservation still needs releasing).
      let estimatedTokens = 0
      if (this.budget) {
        estimatedTokens = Math.ceil(JSON.stringify(messages).length / 4) + 2000
        const checkTokens = createTokenMeterMiddleware(this.budget)
        const tokenCheck = await checkTokens({ estimatedTokens, messages, model: this.model.cheapModelId })
        if ('_tag' in tokenCheck && tokenCheck._tag === 'TokenHardBlock') {
          return {
            agentType: this.agentType,
            toolsUsed,
            rawData,
            summary: `Token limit exceeded: ${tokenCheck.reason}`,
            confidence: 0,
            error: 'TOKEN_LIMIT_EXCEEDED',
            inputTokens: agentInputTokens,
            outputTokens: agentOutputTokens,
          }
        }
      }

      let resp: Awaited<ReturnType<typeof this.model.chat>>
      try {
        resp = await this.model.chat(messages, toolDefs, {
          model: this.model.cheapModelId,
          maxTokens: 2000,
          temperature: 0,
          ...(signal ? { signal } : {}),
        })
      } catch (e) {
        // Release the reservation — the call never happened, so 0 tokens
        // were actually spent, but estimatedTokens was already reserved above.
        if (this.budget) reconcileTokenUsage(this.budget, estimatedTokens, 0)
        return {
          agentType: this.agentType,
          toolsUsed,
          rawData,
          summary: `${this.agentType} agent error: ${e instanceof Error ? e.message : String(e)}`,
          confidence: 0,
          error: String(e),
          inputTokens: agentInputTokens,
          outputTokens: agentOutputTokens,
        }
      }

      agentInputTokens += resp.usage?.inputTokens ?? 0
      agentOutputTokens += resp.usage?.outputTokens ?? 0
      // Reconcile the reservation against the real usage.
      if (this.budget) {
        const usedThisCall = (resp.usage?.inputTokens ?? 0) + (resp.usage?.outputTokens ?? 0)
        reconcileTokenUsage(this.budget, estimatedTokens, usedThisCall)
      }

      // No tool calls → agent produced final summary
      if (!resp.toolCalls || resp.toolCalls.length === 0) {
        return {
          agentType: this.agentType,
          toolsUsed,
          rawData,
          summary: resp.content || `${this.agentType}: no findings.`,
          confidence: toolCallsAttempted === 0 ? 0 : Math.round((toolCallsSucceeded / toolCallsAttempted) * 100) / 100,
          inputTokens: agentInputTokens,
          outputTokens: agentOutputTokens,
        }
      }

      // Execute tool calls, feed results back
      const resultMessages: Message[] = []
      for (const call of resp.toolCalls) {
        toolCallsAttempted++
        const tool = this.tools.find(t => t.name === call.name)
        let result: unknown

        if (!tool) {
          result = { error: `Tool "${call.name}" not available in ${this.agentType} agent` }
          const resultStr = JSON.stringify(result)
          resultMessages.push(this.model.formatToolResult(call.id, resultStr))
          continue
        }

        // --- Perimeter check (audit-logged, both allowed and blocked) ---
        const perimResult = await checkPerimeter({ name: call.name, args: call.args, id: call.id })
        if ('_tag' in perimResult && perimResult._tag === 'HardBlock') {
          result = { error: `PERIMETER_BLOCKED: ${call.name} — ${perimResult.reason}` }
          const resultStr = JSON.stringify(result)
          resultMessages.push(this.model.formatToolResult(call.id, resultStr))
          continue
        }

        // --- V1 L2 gate: every write action requires user approval ---
        if (isWriteAction(call.name)) {
          if (!this.gateSink) {
            // Safe default: no gateSink → hard-block all writes
            const blockMsg = `Write action "${call.name}" blocked: gate sink not configured (safe V1 default)`
            await this.auditSink.append({
              id: crypto.randomUUID(),
              tenantId: this.perimeterCtx.tenantId,
              userId: this.perimeterCtx.userId,
              sessionId: this.perimeterCtx.sessionId,
              eventType: 'tool_call_blocked',
              payload: { toolName: call.name, args: call.args, reason: 'no_gate_sink', rule: 'v1_safe_default' },
              createdAt: new Date(),
            })
            result = { error: blockMsg }
            const resultStr = JSON.stringify(result)
            resultMessages.push(this.model.formatToolResult(call.id, resultStr))
            continue
          }

          const gateId = crypto.randomUUID()
          await this.gateSink.push({
            id: gateId,
            toolCallId: call.id,
            toolName: call.name,
            args: call.args,
            connectorId: connectorIdFromTool(call.name),
            tenantId: this.perimeterCtx.tenantId,
            userId: this.perimeterCtx.userId,
            sessionId: this.perimeterCtx.sessionId,
            createdAt: new Date(),
          })

          // Notify orchestrator so it can (a) yield a real gate_required SSE
          // event — the client previously got no signal at all that a write
          // was waiting on them — and (b) stop counting this agent against
          // its own hard per-agent timeout while genuinely waiting on a human,
          // since that timeout firing mid-gate-wait made writes through chat
          // effectively always resolve to "timed out" regardless of gateTimeoutMs.
          this.onGateEvent?.(gateId, call.id, call.name, call.args)

          const decision = await pollGate(this.gateSink, gateId, this.gateTimeoutMs, undefined, signal ? { signal } : undefined)

          this.onGateResolved?.(gateId)

          if (decision._tag !== 'approved') {
            await this.auditSink.append({
              id: crypto.randomUUID(),
              tenantId: this.perimeterCtx.tenantId,
              userId: this.perimeterCtx.userId,
              sessionId: this.perimeterCtx.sessionId,
              eventType: 'tool_call_blocked',
              payload: { gateId, toolName: call.name, decision: decision._tag, reason: decision._tag === 'rejected' ? 'User rejected' : 'Gate timed out' },
              createdAt: new Date(),
            })
            const blockMsg = `Write action "${call.name}" ${decision._tag === 'rejected' ? 'rejected by user' : 'timed out'}`
            result = { error: blockMsg }
            const resultStr = JSON.stringify(result)
            resultMessages.push(this.model.formatToolResult(call.id, resultStr))
            continue
          }
        }

        // --- Execute tool ---
        try {
          result = await tool.run(call.args)
          rawData[call.name] = result
          toolsUsed.push(call.name)
          toolCallsSucceeded++
        } catch (e) {
          result = { error: `Tool execution failed: ${e instanceof Error ? e.message : String(e)}` }
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

    // Same real success-ratio signal as above, with a penalty since hitting
    // MAX_STEPS itself means the investigation was cut off incomplete —
    // worth reflecting honestly rather than reporting whatever ratio was
    // reached as if the agent had actually finished.
    const rawConfidence = toolCallsAttempted === 0 ? 0 : toolCallsSucceeded / toolCallsAttempted
    return {
      agentType: this.agentType,
      toolsUsed,
      rawData,
      summary: `${this.agentType}: max investigation steps reached. Partial data collected.`,
      confidence: Math.round(rawConfidence * 0.75 * 100) / 100,
      inputTokens: agentInputTokens,
      outputTokens: agentOutputTokens,
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

  if (isAlertInvestigation || intent === 'incident_triage') {
    return [
      'alertmanager', 'prometheus', 'loki', 'grafana',
      'datadog', 'newrelic', 'elastic', 'coralogix', 'dynatrace',
      'k8s', 'eks', 'gke',
      'pagerduty', 'opsgenie', 'sentry',
    ].filter(has)
  }
  if (intent === 'deployment') {
    return ['argocd', 'github', 'jenkins', 'circleci', 'vercel', 'prometheus'].filter(has)
  }
  if (intent === 'code_review' || intent === 'feature_status') {
    return ['github', 'linear', 'jira'].filter(has)
  }
  if (intent === 'metrics') {
    return ['prometheus', 'grafana', 'datadog', 'newrelic', 'alertmanager'].filter(has)
  }
  if (intent === 'security') {
    return ['snyk', 'sonarqube', 'aws-cloudwatch', 'gcp-monitoring', 'azure-monitor'].filter(has)
  }
  if (intent === 'cost' || intent === 'infrastructure') {
    return [
      'aws-cloudwatch', 'aws-health', 'gcp-monitoring', 'azure-monitor',
      'terraform', 'k8s', 'eks', 'gke',
    ].filter(has)
  }
  return available
}
