import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class VercelBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    if (!token) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Vercel bootstrap: no API token configured'] }
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    // Confirmed live via independent review: `!res.ok` and the outer catch
    // both swallowed every failure (invalid token, network outage,
    // malformed JSON) as a plausible "API/connection failed" success with
    // 0 entities. Hits Vercel's real cloud API (not a local default), so a
    // network failure is a real outage worth surfacing — only "no token
    // configured" (above) is legitimately empty.
    // Paginate to completion with a hard budget (Vercel: pagination.next
    // timestamp cursor via ?until=) — confirmed via independent review this
    // fetched one page (default 20!), silently truncating any account with
    // >20 projects.
    const MAX_PROJECTS = 1000
    const base = (payload['baseUrl'] as string | undefined) ?? 'https://api.vercel.com'
    const projects: Array<{ id: string; name: string }> = []
    let truncated = false
    let until: number | null = null
    for (;;) {
      const untilParam = until != null ? `&until=${until}` : ''
      const res = await fetch(`${base}/v9/projects?limit=100${untilParam}`, { headers })
      if (!res.ok) {
        throw new Error(`Vercel bootstrap: /v9/projects failed with HTTP ${res.status}`)
      }
      const data = await res.json() as { projects?: Array<{ id: string; name: string }>; pagination?: { next?: number | null } }
      projects.push(...(data.projects ?? []))
      if (data.pagination?.next == null) break
      if (projects.length >= MAX_PROJECTS) { truncated = true; break }
      until = data.pagination.next
    }
    let entitiesUpserted = 0
    for (const p of projects) {
      await this.kg.upsertEntity({
        type: 'Service', name: p.name,
        metadata: {
          source: 'vercel', projectId: p.id,
          connectorCoordinates: { vercel: { connectorType: 'vercel', resourceIds: { projectId: p.id, projectName: p.name }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
        },
      }, tenantId)
      entitiesUpserted++
    }
    return {
      entitiesUpserted, relationshipsUpserted: 0,
      episodeHints: [
        `Vercel: ${entitiesUpserted} projects indexed`,
        ...(truncated ? [`Vercel bootstrap: TRUNCATED at ${MAX_PROJECTS} projects — graph is partial`] : []),
      ],
    }
  }
}
