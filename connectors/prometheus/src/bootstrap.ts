import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

export class PrometheusBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['url'] as string | undefined) ?? (payload['baseUrl'] as string | undefined) ?? 'http://localhost:9090'
    type TargetLabels = { job?: string; service?: string; [k: string]: string | undefined }
    type ActiveTarget = { labels?: TargetLabels }
    let activeTargets: ActiveTarget[]
    try {
      // Active targets only — label-values API includes stale jobs from TSDB history
      const res = await fetch(`${baseUrl}/api/v1/targets?state=active`)
      if (!res.ok) throw new Error(`prometheus returned ${res.status}`)
      const data = await res.json() as { data?: { activeTargets?: ActiveTarget[] } }
      activeTargets = data.data?.activeTargets ?? []
    } catch (err) {
      throw new Error(`prometheus unreachable at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Prefer the `service` label (set by relabeling from k8s pod app label) over `job`.
    // This gives individual service names (cart-service, user-service …) instead of the
    // scrape job name (demo-services) which is a group, not a service.
    const seen = new Map<string, { job: string; service: string }>()
    for (const t of activeTargets) {
      const job = t.labels?.job
      if (!job) continue
      // `service` label comes from k8s pod relabeling; fall back to job if absent
      const svcName = t.labels?.service ?? job
      if (svcName && !seen.has(svcName)) seen.set(svcName, { job, service: svcName })
    }

    let entitiesUpserted = 0
    for (const [name, coords] of seen) {
      await this.kg.upsertEntity({
        type: 'Service',
        name,
        metadata: { connectorCoordinates: { prometheus: { resourceIds: { job: coords.job, service: coords.service } } } },
      }, tenantId)
      entitiesUpserted++
    }
    const hints = [...seen.keys()].map(n => `Prometheus scraping: ${n}`)
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: hints }
  }
}
