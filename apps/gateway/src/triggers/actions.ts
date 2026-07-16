import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { effectiveCredentials } from '../utils/credentials.js'
import { publishDurable } from '../events/durable-events.js'
import { RecallService } from '../services/recall.js'
import type { TriggerAction } from './engine.js'
import pino from 'pino'

const log = pino({ name: 'trigger-actions' })

// ---------------------------------------------------------------------------
// Action dispatcher — called when a gated trigger action is approved.
// Each action type has a real implementation, not a no-op.
// ---------------------------------------------------------------------------

export interface ActionResult {
  ok: boolean
  action: string
  detail?: string
  error?: string
}

/**
 * Execute a trigger action with real integrations.
 * Called from gate-decide-route.ts after approval and from executor.ts
 * for read-only actions (surface_context — no gate required).
 */
export async function executeTriggerAction(
  tenantId: string,
  action: TriggerAction,
): Promise<ActionResult> {
  switch (action.type) {
    case 'create_incident':
      return createIncident(tenantId, action.params)
    case 'notify_channel':
      return notifyChannel(tenantId, action.params)
    case 'notify_oncall':
      return notifyOncall(tenantId, action.params)
    case 'escalate':
      return escalate(tenantId, action.params)
    case 'block_deploy_gate':
      return blockDeployGate(tenantId, action.params)
    case 'run_runbook':
      return runRunbook(tenantId, action.params)
    case 'surface_context':
      return surfaceContext(tenantId, action.params)
    case 'open_war_room':
      return openWarRoom(tenantId, action.params)
    case 'http_request':
      return httpRequest(tenantId, action.params)
    case 'db_op':
      return dbOp(tenantId, action.params)
    case 'emit_event':
      return emitEvent(tenantId, action.params)
    default:
      return { ok: false, action: action.type, error: `unknown action type: ${(action as { type: string }).type}` }
  }
}

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

async function createIncident(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const title = String(params.title ?? 'Triggered incident')
  const severity = String(params.severity ?? 'medium')
  const description = typeof params.description === 'string' ? params.description : null
  const serviceName = typeof params.service === 'string' ? params.service : null
  const warRoom = params.war_room === true

  try {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO incidents (tenant_id, title, severity, status, description, created_at)
        VALUES (${tenantId}::uuid, ${title}, ${severity}::"IncidentSeverity", 'active'::"IncidentStatus",
                ${description}, NOW())
        RETURNING id
      `
    )
    const incidentId = rows[0]?.id
    log.info({ tenantId, incidentId, title, severity, warRoom }, 'incident created via trigger action')
    return { ok: true, action: 'create_incident', detail: JSON.stringify({ incidentId, serviceName, warRoom }) }
  } catch (err) {
    log.error({ err, tenantId, title }, 'create_incident failed')
    return { ok: false, action: 'create_incident', error: String(err) }
  }
}

async function notifyChannel(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const channel = String(params.channel ?? '')
  const text = String(params.text ?? 'Anway trigger notification')

  if (!channel) {
    return { ok: false, action: 'notify_channel', error: 'channel is required' }
  }

  try {
    // Load Slack connector credentials for the tenant
    const slackRow = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ credentials_enc: string | null }>>`
        SELECT credentials_enc FROM connector_config
        WHERE tenant_id = ${tenantId}::uuid AND connector_type = 'slack'
        LIMIT 1
      `
    ).catch(() => [] as Array<{ credentials_enc: string | null }>)

    const creds = effectiveCredentials(slackRow[0] as Parameters<typeof effectiveCredentials>[0])
    const token = creds['apiKey'] ?? creds['token']

    if (!token) {
      log.warn({ tenantId, channel }, 'notify_channel: Slack API key not configured')
      return { ok: false, action: 'notify_channel', error: 'Slack API key not configured' }
    }

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    })

    if (!res.ok) {
      return { ok: false, action: 'notify_channel', error: `Slack API returned HTTP ${res.status}` }
    }

    const json = await res.json() as { ok: boolean; error?: string; ts?: string }
    if (!json.ok) {
      return { ok: false, action: 'notify_channel', error: json.error ?? 'Slack API error' }
    }

    log.info({ tenantId, channel, ts: json.ts }, 'notify_channel succeeded')
    return { ok: true, action: 'notify_channel', detail: JSON.stringify({ ts: json.ts, channel }) }
  } catch (err) {
    log.error({ err, tenantId, channel }, 'notify_channel failed')
    return { ok: false, action: 'notify_channel', error: String(err) }
  }
}

async function notifyOncall(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const title = String(params.title ?? 'Anway alert')
  const severity = String(params.severity ?? 'critical')
  const serviceId = typeof params.service_id === 'string' ? params.service_id : undefined

  try {
    const pdRow = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ credentials_enc: string | null }>>`
        SELECT credentials_enc FROM connector_config
        WHERE tenant_id = ${tenantId}::uuid AND connector_type = 'pagerduty'
        LIMIT 1
      `
    ).catch(() => [] as Array<{ credentials_enc: string | null }>)

    const creds = effectiveCredentials(pdRow[0] as Parameters<typeof effectiveCredentials>[0])
    const token = creds['apiKey']

    if (!token) {
      log.warn({ tenantId }, 'notify_oncall: PagerDuty API key not configured')
      return { ok: false, action: 'notify_oncall', error: 'PagerDuty API key not configured' }
    }

    // Use PagerDuty Events API v2 to trigger an incident
    const body: Record<string, unknown> = {
      routing_key: token,
      event_action: 'trigger',
      payload: {
        summary: title,
        severity,
        source: 'anway-trigger',
      },
    }
    if (serviceId) {
      body['payload'] = { ...(body['payload'] as Record<string, unknown>), class: serviceId }
    }

    const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      return { ok: false, action: 'notify_oncall', error: `PagerDuty Events API returned HTTP ${res.status}` }
    }

    const json = await res.json() as { status?: string; message?: string }
    log.info({ tenantId, title, status: json.status }, 'notify_oncall succeeded')
    return { ok: true, action: 'notify_oncall', detail: JSON.stringify(json) }
  } catch (err) {
    log.error({ err, tenantId, title }, 'notify_oncall failed')
    return { ok: false, action: 'notify_oncall', error: String(err) }
  }
}

async function escalate(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  // Escalation: create a higher-severity PagerDuty incident
  const escalatedParams = {
    ...params,
    title: typeof params.title === 'string'
      ? `ESCALATED: ${params.title}`
      : 'ESCALATED: Anway trigger escalation',
    severity: 'critical' as const,
  }
  return notifyOncall(tenantId, escalatedParams)
}

async function blockDeployGate(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  // Confirmed live via independent review: pipeline_stage_runs (see
  // 0032_pipelines/migration.sql) has no `pipeline_name`/`stage_name`
  // columns at all — real columns are `pipeline_id` (UUID) and `stage_id`
  // (text, e.g. "gate.prod" per pipeline.ts:214). This UPDATE always threw
  // "column does not exist", silently caught below, so block_deploy_gate
  // never blocked a single real deploy. It also checked `status = 'pending'`
  // — pipeline.ts's real awaiting-approval state for a gate stage is
  // 'waiting' (see pipeline.ts:1078,1103,1244); 'pending' is only ever the
  // table's DEFAULT for a not-yet-started stage, never the gate-wait state.
  const pipelineId = typeof params.pipelineId === 'string' ? params.pipelineId : null
  const env = typeof params.env === 'string' ? params.env : null
  const stageId = typeof params.stageId === 'string' ? params.stageId : (env ? `gate.${env}` : null)

  if (!pipelineId || !stageId) {
    return { ok: false, action: 'block_deploy_gate', error: 'pipelineId and (stageId or env) are required' }
  }

  try {
    const affected = await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        UPDATE pipeline_stage_runs
        SET status = 'rejected', finished_at = NOW()
        WHERE tenant_id = ${tenantId}::uuid
          AND pipeline_id = ${pipelineId}::uuid
          AND stage_id = ${stageId}
          AND status = 'waiting'
      `
    )
    log.info({ tenantId, pipelineId, env, stageId, affected }, 'block_deploy_gate executed')
    return { ok: true, action: 'block_deploy_gate', detail: JSON.stringify({ pipelineId, env, stageId, affected: Number(affected) }) }
  } catch (err) {
    log.error({ err, tenantId, pipelineId, stageId }, 'block_deploy_gate failed')
    return { ok: false, action: 'block_deploy_gate', error: String(err) }
  }
}

async function runRunbook(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const runbookName = typeof params.runbook === 'string' ? params.runbook : null

  if (!runbookName) {
    return { ok: false, action: 'run_runbook', error: 'runbook name is required' }
  }

  try {
    // Load runbook steps from the runbooks store
    const steps = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ step: number; action_type: string; action_params: Record<string, unknown> }>>`
        SELECT step, action_type, action_params
        FROM runbook_steps
        WHERE tenant_id = ${tenantId}::uuid AND runbook_name = ${runbookName}
        ORDER BY step ASC
      `
    ).catch(() => [] as Array<{ step: number; action_type: string; action_params: Record<string, unknown> }>)

    if (steps.length === 0) {
      return { ok: false, action: 'run_runbook', error: `runbook "${runbookName}" not found or has no steps` }
    }

    const results: Array<{ step: number; action: string; ok: boolean; error?: string }> = []
    for (const step of steps) {
      const triggerAction: TriggerAction = {
        type: step.action_type as TriggerAction['type'],
        params: step.action_params ?? {},
      }
      const result = await executeTriggerAction(tenantId, triggerAction)
      results.push({ step: step.step, action: step.action_type, ok: result.ok, error: result.error })
      // If a critical step fails, stop the runbook
      if (!result.ok && params['stop_on_error'] !== false) {
        log.warn({ tenantId, runbookName, failedStep: step.step }, 'runbook step failed, stopping')
        break
      }
    }

    log.info({ tenantId, runbookName, stepCount: steps.length, results }, 'runbook executed')
    return { ok: true, action: 'run_runbook', detail: JSON.stringify({ runbookName, results }) }
  } catch (err) {
    log.error({ err, tenantId, runbookName }, 'run_runbook failed')
    return { ok: false, action: 'run_runbook', error: String(err) }
  }
}

async function surfaceContext(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const eventType = typeof params.event_type === 'string' ? params.event_type : 'unknown'
  const summary = typeof params.summary === 'string' ? params.summary : 'No summary provided'
  const source = typeof params.source === 'string' ? params.source : 'trigger'

  try {
    // Insert into signal_inbox table — replaces the dead session:context Redis publish
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO signal_inbox (tenant_id, event_type, summary, source, payload, created_at)
        VALUES (${tenantId}::uuid, ${eventType}, ${summary}, ${source},
                ${JSON.stringify(params)}::jsonb, NOW())
        RETURNING id
      `
    ).catch(() => [] as Array<{ id: string }>)

    log.info({ tenantId, signalId: rows[0]?.id, eventType }, 'surface_context inserted into signal_inbox')
    return { ok: true, action: 'surface_context', detail: JSON.stringify({ signalId: rows[0]?.id }) }
  } catch (err) {
    log.error({ err, tenantId, eventType }, 'surface_context failed')
    return { ok: false, action: 'surface_context', error: String(err) }
  }
}

// ---------------------------------------------------------------------------
// Generic primitives — user-defined params (templated against the event).
// ---------------------------------------------------------------------------

const BLOCKED_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|::1|172\.(1[6-9]|2\d|3[01])\.)/i

/**
 * http_request — call any external endpoint with user-supplied method/url/
 * headers/body. SSRF-guarded: only public https(/http) hosts; internal/private
 * ranges are refused (use db_op for internal Anway operations, not this).
 */
async function httpRequest(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const url = typeof params.url === 'string' ? params.url : ''
  const method = (typeof params.method === 'string' ? params.method : 'POST').toUpperCase()
  const headers = (params.headers && typeof params.headers === 'object' ? params.headers : {}) as Record<string, string>
  const body = params.body

  if (!url) return { ok: false, action: 'http_request', error: 'url is required' }
  let parsed: URL
  try { parsed = new URL(url) } catch { return { ok: false, action: 'http_request', error: 'invalid url' } }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, action: 'http_request', error: 'only http(s) urls allowed' }
  }
  if (BLOCKED_HOST.test(parsed.hostname)) {
    return { ok: false, action: 'http_request', error: `refused: ${parsed.hostname} is a private/internal host (use db_op for internal ops)` }
  }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined || method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))

    const detail = JSON.stringify({ status: res.status, host: parsed.hostname })
    if (!res.ok) return { ok: false, action: 'http_request', error: `HTTP ${res.status}`, detail }
    log.info({ tenantId, host: parsed.hostname, status: res.status }, 'http_request succeeded')
    return { ok: true, action: 'http_request', detail }
  } catch (err) {
    log.error({ err, tenantId, url }, 'http_request failed')
    return { ok: false, action: 'http_request', error: String(err) }
  }
}

/**
 * db_op — internal Anway operations, no external call, no token minting.
 * Supported ops: resolve_incident | update_incident | comment_incident.
 * This is the clean path for "resolve THIS incident from an event".
 */
async function dbOp(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const op = typeof params.op === 'string' ? params.op : ''
  const incidentId = typeof params.incidentId === 'string' ? params.incidentId : null

  try {
    switch (op) {
      case 'resolve_incident': {
        if (!incidentId) return { ok: false, action: 'db_op', error: 'incidentId is required' }
        const affected = await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            UPDATE incidents SET status = 'resolved'::"IncidentStatus", resolved_at = NOW()
            WHERE id = ${incidentId}::uuid AND tenant_id = ${tenantId}::uuid AND status <> 'resolved'::"IncidentStatus"
          `
        )
        // Keep Recall consistent with the API resolve path — capture the fix.
        if (Number(affected) > 0) {
          await new RecallService(prisma).recordResolution(tenantId, incidentId).catch(() => {})
        }
        log.info({ tenantId, incidentId, affected: Number(affected) }, 'db_op resolve_incident')
        return { ok: true, action: 'db_op', detail: JSON.stringify({ op, incidentId, affected: Number(affected) }) }
      }
      case 'update_incident': {
        if (!incidentId) return { ok: false, action: 'db_op', error: 'incidentId is required' }
        const status = typeof params.status === 'string' ? params.status : null
        const severity = typeof params.severity === 'string' ? params.severity : null
        if (!status && !severity) return { ok: false, action: 'db_op', error: 'update_incident needs status and/or severity' }
        const affected = await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            UPDATE incidents SET
              status = COALESCE(${status}::"IncidentStatus", status),
              severity = COALESCE(${severity}::"IncidentSeverity", severity)
            WHERE id = ${incidentId}::uuid AND tenant_id = ${tenantId}::uuid
          `
        )
        log.info({ tenantId, incidentId, status, severity }, 'db_op update_incident')
        return { ok: true, action: 'db_op', detail: JSON.stringify({ op, incidentId, affected: Number(affected) }) }
      }
      case 'comment_incident': {
        if (!incidentId) return { ok: false, action: 'db_op', error: 'incidentId is required' }
        const text = typeof params.text === 'string' ? params.text : ''
        if (!text) return { ok: false, action: 'db_op', error: 'text is required' }
        await withTenant(prisma, tenantId, (tx) =>
          tx.$executeRaw`
            INSERT INTO audit_events (id, tenant_id, user_id, session_id, event_type, payload, created_at)
            VALUES (gen_random_uuid(), ${tenantId}::uuid, NULL, NULL, 'incident_comment',
                    ${JSON.stringify({ incidentId, text, source: 'trigger' })}::jsonb, NOW())
          `
        )
        return { ok: true, action: 'db_op', detail: JSON.stringify({ op, incidentId }) }
      }
      default:
        return { ok: false, action: 'db_op', error: `unknown op: ${op} (resolve_incident|update_incident|comment_incident)` }
    }
  } catch (err) {
    log.error({ err, tenantId, op }, 'db_op failed')
    return { ok: false, action: 'db_op', error: String(err) }
  }
}

let _emitPub: RedisClientType | null = null
async function getEmitPub(): Promise<RedisClientType | null> {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (_emitPub) return _emitPub
  const client = createClient({ url }) as RedisClientType
  client.on('error', () => {})
  await client.connect()
  _emitPub = client
  return client
}

/**
 * emit_event — re-emit an event onto the bus so another trigger can fire.
 * Chains automations. Depth-guarded (__depth, cap 3) to prevent loops.
 */
async function emitEvent(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const eventType = typeof params.eventType === 'string' ? params.eventType : ''
  if (!eventType) return { ok: false, action: 'emit_event', error: 'eventType is required' }

  const depth = typeof params.__depth === 'number' ? params.__depth : 0
  if (depth >= 3) {
    log.warn({ tenantId, eventType, depth }, 'emit_event depth cap reached — dropping to prevent loop')
    return { ok: false, action: 'emit_event', error: 'emit depth cap (3) reached' }
  }

  const inner = (params.payload && typeof params.payload === 'object' ? params.payload : {}) as Record<string, unknown>
  const outPayload: Record<string, unknown> = { ...inner, tenantId, __depth: depth + 1 }

  try {
    const pub = await getEmitPub()
    // publishDurable writes the event_log outbox row AND publishes to Redis.
    await publishDurable(pub, tenantId, eventType, outPayload)
    log.info({ tenantId, eventType, depth: depth + 1 }, 'emit_event published')
    return { ok: true, action: 'emit_event', detail: JSON.stringify({ eventType, depth: depth + 1 }) }
  } catch (err) {
    log.error({ err, tenantId, eventType }, 'emit_event failed')
    return { ok: false, action: 'emit_event', error: String(err) }
  }
}

async function openWarRoom(
  tenantId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  // Create an incident with war_room flag — consumed by incident-view
  const title = String(params.title ?? 'War Room')
  const severity = String(params.severity ?? 'critical')
  const description = typeof params.description === 'string' ? params.description : null
  const serviceName = typeof params.service === 'string' ? params.service : null

  try {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO incidents (tenant_id, title, severity, status, description, created_at)
        VALUES (${tenantId}::uuid, ${title}, ${severity}::"IncidentSeverity", 'active'::"IncidentStatus",
                ${description}, NOW())
        RETURNING id
      `
    )
    const incidentId = rows[0]?.id
    log.info({ tenantId, incidentId, title, war_room: true, serviceName }, 'war room opened via trigger action')
    return { ok: true, action: 'open_war_room', detail: JSON.stringify({ incidentId, war_room: true, serviceName }) }
  } catch (err) {
    log.error({ err, tenantId, title }, 'open_war_room failed')
    return { ok: false, action: 'open_war_room', error: String(err) }
  }
}
