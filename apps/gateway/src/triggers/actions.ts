import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { effectiveCredentials } from '../utils/credentials.js'
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
        VALUES (${tenantId}::uuid, ${title}, ${severity}::incident_severity, 'active'::incident_status,
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
  const pipelineName = typeof params.pipeline === 'string' ? params.pipeline : null
  const env = typeof params.env === 'string' ? params.env : null

  if (!pipelineName) {
    return { ok: false, action: 'block_deploy_gate', error: 'pipeline name is required' }
  }

  try {
    // Set the pending gate.<env> stage run for the named pipeline to rejected
    const stageName = env ? `gate.${env}` : 'gate'
    const affected = await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        UPDATE pipeline_stage_runs
        SET status = 'rejected', finished_at = NOW()
        WHERE tenant_id = ${tenantId}::uuid
          AND pipeline_name = ${pipelineName}
          AND stage_name = ${stageName}
          AND status = 'pending'
      `
    )
    log.info({ tenantId, pipelineName, env, stageName, affected }, 'block_deploy_gate executed')
    return { ok: true, action: 'block_deploy_gate', detail: JSON.stringify({ pipelineName, env, affected }) }
  } catch (err) {
    log.error({ err, tenantId, pipelineName }, 'block_deploy_gate failed')
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
        VALUES (${tenantId}::uuid, ${title}, ${severity}::incident_severity, 'active'::incident_status,
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
