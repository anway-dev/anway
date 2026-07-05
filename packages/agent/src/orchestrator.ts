import type { ErrorCode, GroundingSource, Message, StreamEvent } from '@anway/types'
import type { IAuditSink } from './interfaces/audit.js'
import type { ISessionMemory, SessionContext } from './interfaces/memory.js'
import type { IModelProvider, ToolDefinition } from './interfaces/provider.js'
import type { IKnowledgeGraph } from './interfaces/knowledge-graph.js'
import { extractJson } from './agents/extract-json.js'
import { createTokenMeterMiddleware } from './middleware/token-meter.js'
import type { TokenBudget } from './middleware/token-meter.js'
import type { AgentPerimeter } from './perimeter/engine.js'
import type { IGateSink } from './gate/gate.js'
import { SREAgent, type IncidentContext } from './agents/sre.js'
import { ConnectorAgent, groupToolsByConnector, selectConnectorTypes } from './agents/connector-agent.js'
import type { AgentFinding, ConnectorAgentConfig, SpecialistContext } from './agents/connector-agent.js'
import { createPerimeterMiddleware } from './middleware/perimeter.js'
import type { PerimeterCtx } from './middleware/perimeter.js'

export interface ExecutableTool extends ToolDefinition {
  run(args: Record<string, unknown>): Promise<unknown>
}

export interface OrchestratorConfig {
  /** Provider for main (expensive) model calls */
  model: IModelProvider
  /** Available tools — orchestrator injects only perimeter-allowed subset */
  tools: ExecutableTool[]
  perimeter: AgentPerimeter
  auditSink: IAuditSink
  sessionMemory: ISessionMemory
  /** Model string for main inference */
  defaultModel?: string
  /** Model string for cheap classifier calls */
  cheapModel?: string
  /** Token budget — defaults to generous limits suitable for development */
  budget?: TokenBudget
  /** Maximum tool-call round-trips per runSession call (default: 10) */
  maxSteps?: number
  /** Knowledge Graph for context injection — mandatory. Skipping = hard violation. */
  knowledgeGraph: IKnowledgeGraph
  /** V1 L2 gate — required for write actions. Omit to block all writes (safe default). */
  gateSink?: IGateSink
  /** Gate poll timeout in ms (default: 30000) */
  gateTimeoutMs?: number
  /** Registered connector names — injected into system prompt so LLM knows available data sources */
  connectors?: Array<{ name: string; type: string; mode: string }>
}

/** Opaque handle returned by createOrchestrator. Contains no Mastra types. */
export interface Orchestrator {
  readonly config: OrchestratorConfig
}

const DEFAULT_BUDGET: TokenBudget = {
  perQueryHardLimit: Number.MAX_SAFE_INTEGER,
  perSessionLimit: Number.MAX_SAFE_INTEGER,
  perTenantDailyLimit: Number.MAX_SAFE_INTEGER,
  perTenantMonthlyLimit: Number.MAX_SAFE_INTEGER,
  sessionUsed: 0,
  tenantDailyUsed: 0,
  tenantMonthlyUsed: 0,
}

const ORCHESTRATOR_SYSTEM_PROMPT =
  'You are Anway, the central nervous system of a software organisation. ' +
  'You are a single unified agent — never mention "routing", "specialist agents", or "handing off". ' +
  'You investigate and act directly using the tools available to you. ' +
  'Every claim must be grounded in data returned by tool calls. ' +
  'When you cannot ground a claim, state explicitly what data is missing and why.' +

  '\n\n## MANDATORY: Graph-first, targeted calls only\n' +
  'The knowledge graph provides connector coordinates for every known entity. ' +
  'You MUST use these coordinates for every tool call. ' +
  'NEVER use broad/wildcard queries. The following are FORBIDDEN:\n' +
  '  - PromQL: {service=~".+"}, {__name__=~".*"}, {} (empty selector), any selector that matches all series\n' +
  '  - Grafana: searching for "" or "*" to list everything\n' +
  '  - Any query whose only purpose is to discover what exists\n' +
  'If graph context below contains "Connector coordinates", you MUST use those exact values in every tool call.\n' +
  'The ## GRAPH CONTEXT block injected below tells you exactly what to do:\n' +
  '  - If it contains "CONNECTOR COORDINATES": use those exact values. No other services.\n' +
  '  - If it contains "ALERT INVESTIGATION PROTOCOL": follow those steps in order. DO NOT ask the user which service.\n' +
  '  - If it says "Do NOT call connector tools": obey — ask user which service to investigate.\n' +

  '\n## Investigation approach (when coordinates are available)\n' +
  '- Incidents, alerts, outages, error spikes: call alertmanager__alerts first, extract labels, ' +
  'then prometheus__query scoped to those labels, then loki__query.\n' +
  '- Metrics, SLO, latency, error rate: call prometheus__query with PromQL scoped to the service label from coordinates (e.g. {service="payments-api"}).\n' +
  '- Dashboards: call grafana__dashboards with the service name as query — not empty string.\n' +
  '- Code, PRs: call github__list_prs, github__get_commits with the repo from coordinates.\n' +
  '- Deployments: call trigger_pipeline with { service, environment, sha? }\n' +
  '- Gate required: surface as "Gate required: [stage] — reply approve to proceed or cancel to abort"\n' +
  '- User says approve/yes/ship it: call approve_gate with the gate_id\n' +
  '\nIf a tool call returns an error or empty result, say so explicitly. Never fabricate data.\n'

// Injected into graphContext for alert/incident investigations when graph has no coordinates.
// Alertmanager labels ARE the connector coordinates — agent extracts them, then calls targeted tools.
const ALERT_INVESTIGATION_PROTOCOL =
  `## ALERT INVESTIGATION PROTOCOL — execute in order, autonomously:\n` +
  `STEP 1: Call alertmanager__alerts (no args) — get all firing alerts and their labels.\n` +
  `         Extract from each alert: service, job, namespace, instance, alertname, severity.\n` +
  `         These label values are your connector coordinates for all subsequent calls.\n` +
  `STEP 2: Call prometheus__alerts (no args) — get rule evaluation status.\n` +
  `         Identify which rules are failing/pending and their rule group.\n` +
  `STEP 3: For each affected service/job from step 1 labels:\n` +
  `         → Call prometheus__query with query scoped to that label ONLY.\n` +
  `           Example: if label is {job="payments-api"}, use rate(http_requests_total{job="payments-api"}[5m])\n` +
  `           NEVER use {service=~".+"} — use the exact label value from step 1.\n` +
  `STEP 4: If loki tool available: call loki__query scoped to the affected service/app label.\n` +
  `STEP 5: Correlate all findings — alert labels + rule status + metrics + logs → root cause.\n` +
  `         State confidence, cite each data source, recommend action.\n` +
  `DO NOT ask the user which service. Execute all steps autonomously.`

const INTENT_SYSTEM_PROMPT =
  'Classify the user query. Respond ONLY with a JSON object — no prose: ' +
  '{"intent":"<category>","agentType":"<specialist>","inferredRole":"<role>"}\n' +
  'intent categories: incident_triage, feature_status, code_review, deployment, metrics, general\n' +
  'specialist agents: sre, dev, pm, ba, orchestrator\n' +
  'roles: sre, dev, pm, ba, admin'

/**
 * Creates an orchestrator instance. The returned object is an opaque handle —
 * hand-rolled agentic loop, model-agnostic (IModelProvider). Satisfies four of
 * six locked Mastra requirements: model-agnostic streaming, perimeter middleware
 * on every tool call, full audit hook, and typed multi-agent context handoff.
 * Two missing: waitForInput/gate (see gateSink below) and onModelCall token hook
 * (token-meter middleware is inline, not a Mastra lifecycle hook — functionally
 * equivalent for current feature set).
 */
export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  return { config }
}

/**
 * Runs an agentic session and yields StreamEvent items as they are produced.
 *
 * The loop:
 *   1. Logs query_received + agent_spawned to auditSink
 *   2. Classifies intent via cheap model (best-effort — does not block on failure)
 *   3. Streams LLM response, forwarding text_delta events to caller
 *   4. On tool_call events: runs perimeter check, executes allowed tools, feeds results back
 *   5. Repeats until no tool calls or maxSteps reached
 *   6. Yields done with cumulative token counts
 */
export async function* runSession(
  orchestrator: Orchestrator,
  input: string,
  ctx: SessionContext,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const { config } = orchestrator
  const { model, tools, auditSink, sessionMemory } = config
  const budget = config.budget ?? DEFAULT_BUDGET
  const mainModel = model.modelId
  const cheapModel = model.cheapModelId

  const checkTokens = createTokenMeterMiddleware(budget)

  await auditSink.append({
    id: crypto.randomUUID(),
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    eventType: 'query_received',
    payload: { query: input, effectiveRole: ctx.effectiveRole },
    createdAt: new Date(),
  })

  await sessionMemory.append(ctx.sessionId, {
    role: 'user',
    content: input,
    timestamp: Date.now(),
  })

  const session = await sessionMemory.get(ctx.sessionId)
  const history = session?.turns ?? []

  // Best-effort intent classification via cheap model
  let classifiedIntent = 'general'
  try {
    const intentMessages: Message[] = [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user', content: input },
    ]
    // Token check before intent classification
    const intentEstimatedTokens = Math.ceil(JSON.stringify(intentMessages).length / 4) + 100
    const intentTokenCheck = await checkTokens({ estimatedTokens: intentEstimatedTokens, messages: intentMessages, model: cheapModel })
    if ('_tag' in intentTokenCheck && intentTokenCheck._tag === 'TokenHardBlock') {
      yield makeError('TOKEN_LIMIT_EXCEEDED', intentTokenCheck.reason)
      return
    }

    let intentResp: Awaited<ReturnType<typeof model.chat>> | null = null
    intentResp = await model.chat(intentMessages, [], {
      model: cheapModel,
      maxTokens: 100,
      temperature: 0,
      ...(signal ? { signal } : {}),
    })
    // Increment budget immediately after intent classification
    budget.sessionUsed += (intentResp?.usage?.inputTokens ?? 0) + (intentResp?.usage?.outputTokens ?? 0)
    budget.tenantDailyUsed += (intentResp?.usage?.inputTokens ?? 0) + (intentResp?.usage?.outputTokens ?? 0)
    budget.tenantMonthlyUsed += (intentResp?.usage?.inputTokens ?? 0) + (intentResp?.usage?.outputTokens ?? 0)
    const parsed = extractJson<{ intent?: unknown }>(intentResp.content)
    if (typeof parsed.intent === 'string') classifiedIntent = parsed.intent
  } catch (err) {
    auditSink.append({
      id: crypto.randomUUID(), tenantId: ctx.tenantId, userId: ctx.userId,
      sessionId: ctx.sessionId, eventType: 'intent_parse_failed',
      payload: { error: err instanceof Error ? err.message : String(err) },
      createdAt: new Date(),
    }).catch(() => {})
    classifiedIntent = 'general'
  }

  await auditSink.append({
    id: crypto.randomUUID(),
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    eventType: 'agent_spawned',
    payload: { intent: classifiedIntent, effectiveRole: ctx.effectiveRole },
    createdAt: new Date(),
  })

  // SREAgent context assembly — live triage context for sre-classified queries
  let sreContext: string | null = null
  if (classifiedIntent === 'sre' || classifiedIntent === 'incident_triage') {
    try {
      const sreAgent = new SREAgent(config.model, config.model, config.knowledgeGraph)
      const sreResult: IncidentContext = await sreAgent.assembleContext(input, '', ctx.tenantId)
      const lines = [
        `## Live Triage Context (SREAgent)`,
        `Hypothesis: ${sreResult.hypothesis.slice(0, 500)}`,
      ]
      if (sreResult.relatedDeploys.length > 0) {
        lines.push(`Recent deploys: ${sreResult.relatedDeploys.slice(0, 5).join(', ')}`)
      }
      if (sreResult.relatedPRs.length > 0) {
        lines.push(`Recent PRs: ${sreResult.relatedPRs.slice(0, 5).join(', ')}`)
      }
      if (sreResult.suggestedRunbook.length > 0) {
        lines.push(`Suggested runbook: ${sreResult.suggestedRunbook.slice(0, 4).join('; ')}`)
      }
      sreContext = lines.join('\n')
      await config.auditSink.append({
        id: crypto.randomUUID(), tenantId: ctx.tenantId, userId: ctx.userId,
        sessionId: ctx.sessionId, eventType: 'agent_spawned',
        payload: { agentType: 'SREAgent', classifiedIntent, contextLength: sreContext.length },
        createdAt: new Date(),
      })
    } catch {
      // non-blocking — SRE context best-effort, orchestrator continues without it
    }
  }

  // Knowledge Graph context injection — mandatory first step per CLAUDE.md
  let graphContext = '## GRAPH CONTEXT — lookup failed. Do NOT call connector tools. Ask user which service to investigate.'
  let groundingSources: GroundingSource[] = []
  // Hoisted to function scope — avoids bug where second resolveContextByName
  // re-resolves a UUID by name-ILIKE (both failure modes: UUID never matches,
  // and empty string matches every row).
  let resolvedAgentContext: Awaited<ReturnType<typeof config.knowledgeGraph.resolveContextByName>> = null

  const isAlertInvestigation = classifiedIntent === 'incident_triage' ||
    /alert|incident|firing|outage|error.?rate|latency|spike|investigate/i.test(input)

  try {
    // For alert investigations: extract the service hint separately from the alert name.
    // "Investigate HighErrorRate on service payments-api" → service="payments-api"
    // "Investigate PrometheusMissingRuleEvaluations" → service="" (infra alert, no service)
    const entityExtractPrompt = isAlertInvestigation
      ? 'Extract the SOFTWARE SERVICE name (not the alert name) from this query. ' +
        'A service name looks like: payments-api, checkout-api, auth-service. ' +
        'An alert name looks like: HighErrorRate, PodCrashLooping, PrometheusMissingRuleEvaluations. ' +
        'Respond with ONLY the service name, or empty string if query is about an infrastructure alert with no specific service.'
      : 'Extract the primary service, team, or entity name from this query. Respond with ONLY the name, or empty string if none found.'

    // Token check before entity extraction
    const entityExtractMsgs: Message[] = [
      { role: 'system', content: entityExtractPrompt },
      { role: 'user', content: input },
    ]
    const entityEstimatedTokens = Math.ceil(JSON.stringify(entityExtractMsgs).length / 4) + 30
    const entityTokenCheck = await checkTokens({ estimatedTokens: entityEstimatedTokens, messages: entityExtractMsgs, model: cheapModel })
    if ('_tag' in entityTokenCheck && entityTokenCheck._tag === 'TokenHardBlock') {
      yield makeError('TOKEN_LIMIT_EXCEEDED', entityTokenCheck.reason)
      return
    }

    const entityResp = await model.chat(entityExtractMsgs, [], { model: cheapModel, maxTokens: 30, temperature: 0, ...(signal ? { signal } : {}) })
    // Increment budget immediately
    budget.sessionUsed += (entityResp?.usage?.inputTokens ?? 0) + (entityResp?.usage?.outputTokens ?? 0)
    budget.tenantDailyUsed += (entityResp?.usage?.inputTokens ?? 0) + (entityResp?.usage?.outputTokens ?? 0)
    budget.tenantMonthlyUsed += (entityResp?.usage?.inputTokens ?? 0) + (entityResp?.usage?.outputTokens ?? 0)
    const entityName = entityResp.content.trim()

    if (entityName) {
      resolvedAgentContext = await config.knowledgeGraph.resolveContextByName(entityName, ctx.tenantId, 1)
const context = resolvedAgentContext
      if (!context?.primaryEntity) {
        await config.auditSink.append({
          id: crypto.randomUUID(), tenantId: ctx.tenantId, userId: ctx.userId,
          sessionId: ctx.sessionId, eventType: 'graph_miss',
          payload: { entityName }, createdAt: new Date(),
        }).catch(() => {})
      }
      if (context?.primaryEntity) {
        ctx = { ...ctx, contextEntityId: context.primaryEntity.id }
        const coords = context.connectorCoordinates
        const parts = [
          `## GRAPH CONTEXT — entity resolved: "${context.primaryEntity.name}" (${context.primaryEntity.type})`,
          `Use ONLY these coordinates in tool calls. Do not query other services.`,
        ]
        for (const rel of context.relationships.slice(0, 10)) {
          const fromName = rel.fromEntityId === context.primaryEntity.id
            ? context.primaryEntity.name
            : context.relatedEntities.find(e => e.id === rel.fromEntityId)?.name ?? rel.fromEntityId
          const toName = context.relatedEntities.find(e => e.id === rel.toEntityId)?.name ?? rel.toEntityId
          parts.push(`  ${rel.relType}: ${fromName} → ${toName}`)
        }
        if (Object.keys(coords).length > 0) {
          parts.push('## CONNECTOR COORDINATES (mandatory — use these exact values):')
          for (const [connType, coord] of Object.entries(coords)) {
            parts.push(`  ${connType}: ${JSON.stringify(coord.resourceIds)}`)
          }
          const promCoord = coords['prometheus']
          if (promCoord?.resourceIds) {
            const svc = promCoord.resourceIds['service'] ?? promCoord.resourceIds['job']
            if (svc) parts.push(`  → PromQL scope: {service="${svc}"} or {job="${svc}"}`)
          }
        } else {
          // Entity in graph but no connector coordinates yet.
          // For alert investigations: fall through to alert protocol.
          if (isAlertInvestigation) {
            parts.push(`  [No connector coordinates yet — use alert investigation protocol below]`)
            parts.push(ALERT_INVESTIGATION_PROTOCOL)
          } else {
            parts.push('  [No connector coordinates — use entity name for targeted queries only.]')
          }
        }
        if (context.freshness < 0.5) parts.push('  [STALE — verify critical facts from live connector]')
        graphContext = parts.join('\n')
        groundingSources = context.groundingSources.map(gs => ({
          source: gs.source,
          fetchedAt: gs.fetchedAt.toISOString(),
          confidence: gs.confidence,
          freshness: context.freshness,
        }))
      } else if (entityName && isAlertInvestigation) {
        // Service mentioned but not yet in graph — still investigate using alert protocol.
        // Alert labels from alertmanager will provide coordinates.
        graphContext =
          `## GRAPH CONTEXT — service "${entityName}" not yet in knowledge graph.\n` +
          `Graph miss — use alert investigation protocol to derive coordinates from live alert labels.\n` +
          ALERT_INVESTIGATION_PROTOCOL
      } else if (entityName) {
        // Non-alert: entity not in graph — block tools, ask user to confirm
        graphContext = `## GRAPH CONTEXT — entity "${entityName}" not found in knowledge graph.\nDo NOT call connector tools. Ask the user to confirm the exact service name or register the relevant connector first.`
      }
    } else if (isAlertInvestigation) {
      // No specific service extracted but this is an alert investigation (e.g. infra alert).
      // Use alert investigation protocol — alertmanager is the coordinate source.
      graphContext =
        `## GRAPH CONTEXT — infrastructure alert investigation (no specific service in query).\n` +
        `Alertmanager and Prometheus are the coordinate sources for this investigation.\n` +
        ALERT_INVESTIGATION_PROTOCOL
    } else {
      // General query with no entity — ask user
      graphContext = `## GRAPH CONTEXT — no specific entity identified in this query.\nDo NOT call connector tools with broad/wildcard queries. Ask the user which specific service or entity they want to investigate.`
    }
  } catch (err) {
    // Graph failure is audit-logged (hard violation per CLAUDE.md)
    await auditSink.append({
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      eventType: 'graph_context_failed',
      payload: { error: err instanceof Error ? err.message : 'graph context resolution failed' },
      createdAt: new Date(),
    })
    // If alert investigation, still try the protocol rather than blocking
    if (isAlertInvestigation) {
      graphContext =
        `## GRAPH CONTEXT — graph lookup failed (will proceed with alert investigation protocol).\n` +
        ALERT_INVESTIGATION_PROTOCOL
    }
  }

  // Tool definitions for the LLM (run function stripped)
  const toolDefs: ToolDefinition[] = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }))

  // Inject registered connector list so LLM knows available data sources
  let connectorContext = ''
  if (config.connectors && config.connectors.length > 0) {
    const lines = config.connectors.map(c => `  - ${c.name} (${c.type}, ${c.mode})`)
    connectorContext = `\n\nRegistered data sources (use these tools to answer queries):\n${lines.join('\n')}`
  }

  // Build message list from history + current turn
  const sreBlock = sreContext ? `\n\n${sreContext}\n\nGround your response in this context. Cite specific services, incidents, and metrics above. If the context shows services are healthy, say so explicitly — do not speculate about outages.` : ''
  // graphContext is always set (entity found, entity missing, or no entity) — always injected
  const systemPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}\nEffective role: ${ctx.effectiveRole}. Classified intent: ${classifiedIntent}.${connectorContext}\n\n${graphContext}${sreBlock}`
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(
      (t): Message => ({
        role: t.role as 'user' | 'assistant' | 'system',
        content: t.content,
      }),
    ),
  ]

  // --- MULTI-AGENT DELEGATION ---
  const toolMap = groupToolsByConnector(tools)
  const selectedTypes = selectConnectorTypes(classifiedIntent, isAlertInvestigation, [...toolMap.keys()])

  if (selectedTypes.length === 0) {
    yield* synthesisOnlyFallback(model, input, graphContext, connectorContext, sreContext, ctx.effectiveRole, history, checkTokens)
    return
  }

  // Flatten graph-resolved coordinates for SpecialistContext.
  // Uses the already-resolved agent context (from entity resolution above),
  // NOT a second resolveContextByName call that would re-resolve a UUID by
  // name-ILIKE (T5 bug: UUID never matches → {}; empty string matches all).
  const coordinates: Record<string, string> = {}
  const context = resolvedAgentContext
  if (context?.connectorCoordinates) {
    for (const coords of Object.values(context.connectorCoordinates)) {
      Object.assign(coordinates, coords.resourceIds)
    }
  }

  const specialistCtx: SpecialistContext = {
    task: input,
    intent: classifiedIntent,
    coordinates,
    entityHint: ctx.contextEntityId ?? undefined,
    tenantId: ctx.tenantId,
    sessionId: ctx.sessionId,
    userId: ctx.userId,
  }

  // Run all selected connector agents in parallel — hard 30s timeout per P1
  const AGENT_TIMEOUT_MS = 30_000
  const agentAbort = new AbortController()
  const agentTimeout = setTimeout(() => agentAbort.abort('agent_timeout'), AGENT_TIMEOUT_MS)
  // Composite signal: respect outer signal + agent timeout
  const agentSignal = signal
    ? AbortSignal.any([signal, agentAbort.signal])
    : agentAbort.signal

  // Build perimeter context for ConnectorAgent audit + gate wiring
  const perimeterCtx: PerimeterCtx = {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
  }

  const agentRuns = selectedTypes.map(connType => {
    const agentConfig: ConnectorAgentConfig = {
      agentType: connType,
      model,
      tools: toolMap.get(connType) ?? [],
      perimeter: config.perimeter,
      auditSink: config.auditSink,
      perimeterCtx,
      gateSink: config.gateSink,
      gateTimeoutMs: config.gateTimeoutMs,
      budget,
      onGateEvent: (gateId, toolName, args) => {
        // Yield gate_required SSE event — surfaced to client for approval
        void (async () => {
          // Gate events are yielded as findings via the audit/gate pipeline
          // The ConnectorAgent polls internally; this callback is the signal to
          // surface it to the client. We push a lightweight audit row.
          await config.auditSink.append({
            id: crypto.randomUUID(),
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            sessionId: ctx.sessionId,
            eventType: 'gate_decision',
            payload: { gateId, toolName, args, status: 'pending_approval' },
            createdAt: new Date(),
          }).catch(() => {})
        })()
        // Gate is handled inline inside ConnectorAgent.run() — push → pollGate → execute.
        // onGateEvent fires the audit row; the agent blocks until the gate is resolved.
      },
    }
    return new ConnectorAgent(agentConfig).run(specialistCtx, agentSignal)
  })

  const results = await Promise.allSettled(agentRuns)
  clearTimeout(agentTimeout)
  const findings: AgentFinding[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    const connType = selectedTypes[i]!
    if (result.status === 'fulfilled') {
      findings.push(result.value)
      yield {
        type: 'agent_finding' as const,
        agentType: result.value.agentType,
        summary: result.value.summary,
        confidence: result.value.confidence,
        toolsUsed: result.value.toolsUsed,
      }
      auditSink.append({ id: crypto.randomUUID(), tenantId: ctx.tenantId, userId: ctx.userId, sessionId: ctx.sessionId, eventType: 'agent_finding', payload: { agentType: connType, confidence: result.value.confidence, toolsUsed: result.value.toolsUsed }, createdAt: new Date() }).catch(() => {})
    } else {
      const errFinding: AgentFinding = {
        agentType: connType, toolsUsed: [], rawData: {},
        summary: `${connType} agent failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        confidence: 0, error: String(result.reason),
      }
      findings.push(errFinding)
      yield { type: 'agent_finding' as const, agentType: connType, summary: errFinding.summary, confidence: 0, toolsUsed: [] }
    }
  }

  // Accumulate agent token usage before synthesis
  let agentInputTokens = 0, agentOutputTokens = 0
  for (const finding of findings) {
    agentInputTokens += finding.inputTokens ?? 0
    agentOutputTokens += finding.outputTokens ?? 0
  }
  budget.sessionUsed += agentInputTokens + agentOutputTokens
  budget.tenantDailyUsed += agentInputTokens + agentOutputTokens
  budget.tenantMonthlyUsed += agentInputTokens + agentOutputTokens

  // Token check before synthesis
  const synthesisMessages = buildSynthesisMessages(input, graphContext, findings, ctx.effectiveRole, connectorContext, sreContext, history)
  const estimatedTokens = Math.ceil(JSON.stringify(synthesisMessages).length / 4) + 500
  const synthTokenCheck = await checkTokens({ estimatedTokens, messages: synthesisMessages, model: mainModel })
  if ('_tag' in synthTokenCheck && synthTokenCheck._tag === 'TokenHardBlock') {
    yield makeError('TOKEN_LIMIT_EXCEEDED', synthTokenCheck.reason)
    return
  }

  // Stream synthesis — expensive model, NO tools. 60s timeout per P7.
  let inputTokens = 0, outputTokens = 0
  const SYNTH_MAX_RETRIES = 2
  const synthAbort = new AbortController()
  const synthTimeout = setTimeout(() => synthAbort.abort('synthesis_timeout'), 60_000)
  const synthSignal = signal
    ? AbortSignal.any([signal, synthAbort.signal])
    : synthAbort.signal

  for (let attempt = 0; attempt <= SYNTH_MAX_RETRIES; attempt++) {
    try {
      for await (const chunk of model.stream(synthesisMessages, [], { model: mainModel, maxTokens: 4096, temperature: 0.2, signal: synthSignal })) {
        if (chunk.type === 'text_delta') {
          yield { type: 'text_delta' as const, content: chunk.content }
        } else if (chunk.type === 'done') {
          inputTokens = chunk.inputTokens ?? 0
          outputTokens = chunk.outputTokens ?? 0
        }
      }
      break
    } catch (e) {
      if (attempt === SYNTH_MAX_RETRIES) {
        yield { type: 'error' as const, code: 'UPSTREAM_ERROR' as const, message: e instanceof Error ? e.message : String(e) }
        return
      }
    }
  }

  clearTimeout(synthTimeout)
  budget.sessionUsed += inputTokens + outputTokens
  budget.tenantDailyUsed += inputTokens + outputTokens
  budget.tenantMonthlyUsed += inputTokens + outputTokens
  auditSink.append({ id: crypto.randomUUID(), tenantId: ctx.tenantId, userId: ctx.userId, sessionId: ctx.sessionId, eventType: 'synthesis_complete', payload: { inputTokens, outputTokens, agentCount: findings.length }, createdAt: new Date() }).catch(() => {})

  // Persist assistant turn summary
  await sessionMemory.append(ctx.sessionId, {
    role: 'assistant',
    content: findings.map(f => `${f.agentType}: ${f.summary}`).join('\n') || '[no response]',
    timestamp: Date.now(),
  })

  yield {
    type: 'done' as const,
    inputTokens,
    outputTokens,
    ...(groundingSources.length > 0 ? { groundingSources } : {}),
  }
}

function makeError(code: ErrorCode, message: string): StreamEvent & { type: 'error' } {
  return { type: 'error', code, message }
}

function buildSynthesisMessages(
  input: string,
  graphContext: string,
  findings: AgentFinding[],
  effectiveRole: string,
  connectorContext: string,
  sreContext: string | null,
  history: Array<{ role: string; content: string }>,
): Message[] {
  const findingBlocks = findings
    .filter(f => !f.error || f.toolsUsed.length > 0)
    .map(f =>
      `### ${f.agentType.toUpperCase()} AGENT [confidence: ${f.confidence.toFixed(2)}]\n` +
      `Tools used: ${f.toolsUsed.join(', ') || 'none'}\n` +
      f.summary
    ).join('\n\n')

  const noData = findings.every(f => f.toolsUsed.length === 0)

  const systemContent =
    `You are Anway — the orchestrator synthesiser. Your specialist agents have queried all connected data sources in parallel. Effective role: ${effectiveRole}.\n\n` +
    `${graphContext}\n${connectorContext}\n\n` +
    (sreContext ? `${sreContext}\n\n` : '') +
    `## SPECIALIST AGENT FINDINGS\n` +
    (noData
      ? 'No connector data retrieved — no connectors available or all agents returned errors.'
      : findingBlocks) +
    `\n\n## SYNTHESIS INSTRUCTIONS\n` +
    `- Ground every claim in the agent findings above. Cite which agent and tool provided each fact.\n` +
    `- Correlate across agents: timeline, causal chain, affected services.\n` +
    `- State confidence (0.0–1.0) based on data quality and cross-agent consistency.\n` +
    `- Recommend next action. If write action needed, state it and ask for confirmation.\n` +
    `- DO NOT call any tools — all data collection is complete.\n` +
    `- If findings show no issues, say so explicitly and cite the healthy metrics.`

  return [
    { role: 'system', content: systemContent },
    ...history.map(t => ({ role: t.role as 'user' | 'assistant' | 'system', content: t.content })),
    { role: 'user', content: input },
  ]
}

async function* synthesisOnlyFallback(
  model: IModelProvider,
  input: string,
  graphContext: string,
  connectorContext: string,
  sreContext: string | null,
  effectiveRole: string,
  history: Array<{ role: string; content: string }>,
  checkTokens?: ReturnType<typeof createTokenMeterMiddleware>,
): AsyncGenerator<StreamEvent> {
  const messages = buildSynthesisMessages(input, graphContext, [], effectiveRole, connectorContext, sreContext, history)
  const estimatedTokens = Math.ceil(JSON.stringify(messages).length / 4) + 500
  if (checkTokens) {
    const tokenCheck = await checkTokens({ estimatedTokens, messages, model: model.modelId })
    if ('_tag' in tokenCheck && tokenCheck._tag === 'TokenHardBlock') {
      yield { type: 'error' as const, code: 'TOKEN_LIMIT_EXCEEDED' as const, message: tokenCheck.reason }
      return
    }
  }
  let inputTokens = 0
  let outputTokens = 0
  try {
    for await (const chunk of model.stream(messages, [], { model: model.modelId, maxTokens: 2048, temperature: 0.2 })) {
      if (chunk.type === 'text_delta') {
        yield { type: 'text_delta' as const, content: chunk.content }
      } else if (chunk.type === 'done') {
        inputTokens = chunk.inputTokens ?? 0
        outputTokens = chunk.outputTokens ?? 0
      }
    }
  } catch (e) {
    yield { type: 'error' as const, code: 'UPSTREAM_ERROR' as const, message: e instanceof Error ? e.message : String(e) }
    yield { type: 'done' as const, inputTokens, outputTokens }
    return
  }
  yield { type: 'done' as const, inputTokens, outputTokens }
}

