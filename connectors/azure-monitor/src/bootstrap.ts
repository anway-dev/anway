import { execFile } from 'child_process'
import { promisify } from 'util'
import type { IConnectorBootstrap, ConnectorBootstrapResult, IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

const execFileAsync = promisify(execFile)

// Mirrors connectors/azure-monitor/src/agent.ts's auth + exec pattern —
// execFile with an argument array, never a shell string. Bootstrap payload
// values are connector-config, not LLM-reachable, but the same helper is
// reused for consistency and to avoid maintaining two auth implementations.

interface AzureCredentials {
  clientId?: string
  clientSecret?: string
  tenantId?: string
  subscriptionId?: string
}

function azEnv(creds: AzureCredentials): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (creds.clientId) env['AZURE_CLIENT_ID'] = creds.clientId
  if (creds.clientSecret) env['AZURE_CLIENT_SECRET'] = creds.clientSecret
  if (creds.tenantId) env['AZURE_TENANT_ID'] = creds.tenantId
  return env
}

async function runAz(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync('az', [...args, '--output', 'json'], { env, timeout: 30000 })
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

export class AzureMonitorBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const creds: AzureCredentials = {
      clientId: (payload['clientId'] ?? payload['client_id']) as string | undefined,
      clientSecret: (payload['clientSecret'] ?? payload['client_secret']) as string | undefined,
      tenantId: (payload['tenantId'] ?? payload['tenant_id']) as string | undefined,
      subscriptionId: (payload['subscriptionId'] ?? payload['subscription_id']) as string | undefined,
    }
    const env = azEnv(creds)
    let entitiesUpserted = 0
    const hints: string[] = []

    // -- Metric alert rules (real az CLI call, no placeholder) ----------------
    const alertsData = await runAz(['monitor', 'metrics', 'alert', 'list'], env) as Array<{
      id?: string
      name?: string
      enabled?: boolean
      severity?: string
      description?: string
      condition?: { allOf?: Array<{ metricName?: string; operator?: string; threshold?: number }> }
    }> | null

    if (Array.isArray(alertsData)) {
      for (const a of alertsData) {
        if (!a.name) continue
        const conditionSummary = a.condition?.allOf
          ?.map(c => `${c.metricName ?? '?'} ${c.operator ?? '?'} ${c.threshold ?? ''}`)
          .join(', ') ?? ''
        const entityId = await this.kg.upsertEntity({
          type: 'Alert',
          name: a.name,
          metadata: {
            source: 'azure-monitor',
            provider: 'azure',
            externalId: a.id ?? a.name,
            severity: a.enabled === false ? 'low' : (a.severity ?? 'medium'),
            status: a.enabled === false ? 'disabled' : 'enabled',
            description: a.description ?? conditionSummary ?? a.name,
            connectorId,
            connectorCoordinates: {
              'azure-monitor': {
                connectorType: 'azure-monitor',
                resourceIds: { alertId: a.id ?? a.name },
                resolvedAt: new Date().toISOString(),
                confidence: 1.0,
              },
            },
          },
        }, tenantId)
        if (entityId) entitiesUpserted++
      }
      hints.push(`Azure Monitor: ${alertsData.length} metric alert rules discovered`)
    } else {
      hints.push(
        'Azure Monitor metrics alert list returned no data — ' +
        'az CLI may not be authenticated (requires az login --service-principal). ' +
        'No alert rules seeded.'
      )
    }

    // -- Service health events (real ResourceHealth REST call) ----------------
    if (creds.subscriptionId) {
      const url =
        `https://management.azure.com/subscriptions/${encodeURIComponent(creds.subscriptionId)}` +
        `/providers/Microsoft.ResourceHealth/events` +
        `?api-version=2022-10-01` +
        `&$filter=eventSource eq 'ServiceHealth'`

      const healthData = await runAz(['rest', '--method', 'GET', '--url', url], env) as {
        value?: Array<{
          properties?: {
            title?: string
            service?: string
            region?: string
            status?: string
            impactDescription?: string
          }
        }>
      } | null

      if (Array.isArray(healthData?.value)) {
        for (const e of healthData!.value!) {
          const name = e.properties?.title ?? e.properties?.service ?? 'azure-health-event'
          const entityId = await this.kg.upsertEntity({
            type: 'Alert',
            name,
            metadata: {
              source: 'azure-monitor',
              provider: 'azure',
              severity: e.properties?.status === 'Active' ? 'high' : 'low',
              service: e.properties?.service ?? 'Unknown',
              region: e.properties?.region ?? 'global',
              status: e.properties?.status ?? 'unknown',
              description: e.properties?.impactDescription ?? name,
              connectorId,
            },
          }, tenantId)
          if (entityId) entitiesUpserted++
        }
        hints.push(`Azure Monitor: ${healthData!.value!.length} service health events discovered`)
      } else {
        hints.push('Azure ResourceHealth events call returned no data. No health events seeded.')
      }
    } else {
      hints.push('No subscriptionId provided — service health events not queried.')
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: hints.length > 0 ? hints : ['Azure Monitor bootstrap: 0 entities discovered'],
    }
  }
}
