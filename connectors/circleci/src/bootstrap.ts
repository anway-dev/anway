import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

const CIRCLECI_API = 'https://circleci.com/api/v2'

export class CircleCIBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly apiToken?: string,
    private readonly baseUrl?: string,
  ) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const apiToken = (payload['apiToken'] as string | undefined) ?? this.apiToken
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? this.baseUrl ?? CIRCLECI_API
    if (!apiToken) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['circleci: no credentials configured'] }
    }

    const headers: Record<string, string> = {
      'Circle-Token': apiToken,
      'Content-Type': 'application/json',
    }

    let entitiesUpserted = 0

    // Fetch pipelines
    const resp = await fetch(`${baseUrl}/pipeline?org-slug=gh/anvay`, { headers })
    if (resp.ok) {
      const data = await resp.json() as { items?: Array<{ id: string; state: string; vcs?: { branch?: string; commit?: { subject?: string } } }> }
      for (const p of (data.items ?? []).slice(0, 20)) {
        await this.kg.upsertEntity({
          type: 'Pipeline', name: `pipeline-${p.id.slice(0, 7)}`,
          metadata: {
            externalId: p.id,
            state: p.state,
            provider: 'circleci',
            connectorCoordinates: { circleci: { resourceIds: { pipelineId: p.id } } },
          },
        }, tenantId)
        entitiesUpserted++
      }
    }

    // Fetch recent projects
    const projResp = await fetch(`${baseUrl}/project/gh/anvay`, { headers })
    if (projResp.ok) {
      const projects = (await projResp.json() as Array<{ slug: string; vcs_url?: string }>).slice(0, 20)
      for (const proj of projects) {
        await this.kg.upsertEntity({
          type: 'Service', name: proj.slug.split('/').pop() ?? proj.slug,
          metadata: {
            externalId: proj.slug,
            connectorCoordinates: { circleci: { resourceIds: { projectSlug: proj.slug } } },
          },
        }, tenantId)
        entitiesUpserted++
      }
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: entitiesUpserted > 0 ? [`circleci: bootstrapped ${entitiesUpserted} entities`] : ['circleci: no entities found'],
    }
  }
}
