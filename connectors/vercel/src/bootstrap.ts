import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class VercelBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    try {
      const res = await fetch(`${payload['baseUrl'] ?? 'https://api.vercel.com'}/v9/projects`, { headers })
      if (!res.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Vercel bootstrap: API call failed'] }
      const data = await res.json() as { projects?: Array<{ id: string; name: string }> }
      const projects = data.projects ?? []
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
      return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Vercel: ${entitiesUpserted} projects indexed`] }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Vercel bootstrap: connection failed'] }
    }
  }
}
