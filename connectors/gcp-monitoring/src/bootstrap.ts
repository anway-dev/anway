import { execFile } from 'child_process'
import { promisify } from 'util'
import { tmpdir } from 'os'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

const execFileAsync = promisify(execFile)

// Mirrors connectors/gcp-monitoring/src/agent.ts's auth + exec pattern —
// execFile with an argument array, never a shell string.

function gcloudEnv(creds: Record<string, unknown>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  const keyFilePath = creds['google_application_credentials'] as string | undefined
  const rawKey = creds['service_account_key'] as string | object | undefined

  if (keyFilePath) {
    env['GOOGLE_APPLICATION_CREDENTIALS'] = keyFilePath
  } else if (rawKey) {
    const keyContent = typeof rawKey === 'string' ? rawKey : JSON.stringify(rawKey)
    const tmpFile = join(tmpdir(), `anway-gcp-key-${randomUUID()}.json`)
    writeFileSync(tmpFile, keyContent, { mode: 0o600 })
    env['GOOGLE_APPLICATION_CREDENTIALS'] = tmpFile
  }

  if (creds['project_id']) {
    env['CLOUDSDK_CORE_PROJECT'] = String(creds['project_id'])
  }

  return env
}

async function runGcloud(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  try {
    const project = env['CLOUDSDK_CORE_PROJECT']
    const projArgs = project ? ['--project', project] : []
    const { stdout } = await execFileAsync(
      'gcloud',
      [...args, ...projArgs, '--format=json'],
      { env, timeout: 30000 },
    )
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

export class GcpMonitoringBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const env = gcloudEnv(payload)
    const project = env['CLOUDSDK_CORE_PROJECT']
    let entitiesUpserted = 0
    const hints: string[] = []

    // -- Alert policies (real gcloud CLI call, no placeholder) ----------------
    const policiesData = await runGcloud(['monitoring', 'policies', 'list'], env) as Array<{
      name?: string
      displayName?: string
      enabled?: boolean
      conditions?: Array<{ displayName?: string }>
    }> | null

    if (Array.isArray(policiesData)) {
      for (const p of policiesData) {
        if (!p.name) continue
        const displayName = p.displayName ?? p.name
        const entityId = await this.kg.upsertEntity({
          type: 'Alert',
          name: displayName,
          metadata: {
            source: 'gcp-monitoring',
            provider: 'gcp',
            externalId: p.name,
            severity: p.enabled === false ? 'low' : 'medium',
            status: p.enabled === false ? 'disabled' : 'enabled',
            description: p.conditions?.[0]?.displayName ?? displayName,
            connectorId,
            connectorCoordinates: {
              'gcp-monitoring': {
                connectorType: 'gcp-monitoring',
                resourceIds: { policyName: p.name },
                resolvedAt: new Date().toISOString(),
                confidence: 1.0,
              },
            },
          },
        }, tenantId)
        if (entityId) entitiesUpserted++
      }
      hints.push(`GCP Monitoring: ${policiesData.length} alert policies discovered`)
    } else {
      hints.push(
        'GCP Monitoring policies list returned no data — ' +
        'gcloud CLI may not be authenticated. No alert policies seeded.'
      )
    }

    // -- Service health events (real Personalized Service Health REST call) ---
    if (project) {
      try {
        const { stdout: tokenOut } = await execFileAsync(
          'gcloud', ['auth', 'print-access-token'], { env, timeout: 15000 },
        )
        const token = tokenOut.trim()
        if (token) {
          const url = `https://servicehealth.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/global/events`
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
          if (res.ok) {
            const r = await res.json() as {
              events?: Array<{
                title?: string
                description?: string
                category?: string
                state?: string
                affectedProducts?: string[]
                affectedLocations?: string[]
              }>
            }
            const events = r.events ?? []
            for (const e of events) {
              const name = e.title ?? e.category ?? 'gcp-health-event'
              const entityId = await this.kg.upsertEntity({
                type: 'Alert',
                name,
                metadata: {
                  source: 'gcp-monitoring',
                  provider: 'gcp',
                  severity: e.state === 'ACTIVE' ? 'high' : 'low',
                  service: e.affectedProducts?.join(', ') ?? e.category ?? 'GCP',
                  region: e.affectedLocations?.join(', ') ?? 'global',
                  status: e.state ?? 'unknown',
                  description: e.description ?? name,
                  connectorId,
                },
              }, tenantId)
              if (entityId) entitiesUpserted++
            }
            hints.push(`GCP Monitoring: ${events.length} service health events discovered`)
          } else {
            hints.push('GCP Service Health API call failed (non-2xx). No health events seeded.')
          }
        }
      } catch {
        hints.push('GCP Service Health API call errored. No health events seeded.')
      }
    } else {
      hints.push('No project_id provided — service health events not queried.')
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: hints.length > 0 ? hints : ['GCP Monitoring bootstrap: 0 entities discovered'],
    }
  }
}
