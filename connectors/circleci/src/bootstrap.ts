import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

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
    // Docs-verification findings (CircleCI API v2 reference):
    // - org-slug was HARDCODED to "gh/anway" — bootstrap only ever worked
    //   for a GitHub org literally named "anway". It is tenant config.
    // - GET /project/{org} does not exist in API v2 — /project/{slug} takes
    //   a full 3-part project slug (vcs/org/repo) and returns ONE project;
    //   there is no org-level project-list endpoint in v2. The call 404'd
    //   and was silently skipped, so no Service entity was ever created.
    //   Projects are derived instead from the pipeline list's documented
    //   `project_slug` field.
    const orgSlug = (payload['orgSlug'] as string | undefined) ?? (payload['org'] as string | undefined)
    if (!apiToken) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['circleci: no credentials configured'] }
    }
    if (!orgSlug) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['circleci: orgSlug not configured (e.g. "gh/your-org") — cannot list pipelines'] }
    }

    const headers: Record<string, string> = {
      'Circle-Token': apiToken,
      'Content-Type': 'application/json',
    }

    let entitiesUpserted = 0

    const resp = await fetch(`${baseUrl}/pipeline?org-slug=${encodeURIComponent(orgSlug)}`, { headers })
    if (!resp.ok) {
      throw new Error(`circleci bootstrap: GET /pipeline failed with HTTP ${resp.status}`)
    }
    const data = await resp.json() as { items?: Array<{ id: string; state: string; project_slug?: string }> }
    const projectSlugs = new Set<string>()
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
      if (p.project_slug) projectSlugs.add(p.project_slug)
    }

    for (const slug of projectSlugs) {
      await this.kg.upsertEntity({
        type: 'Service', name: slug.split('/').pop() ?? slug,
        metadata: {
          externalId: slug,
          connectorCoordinates: { circleci: { resourceIds: { projectSlug: slug } } },
        },
      }, tenantId)
      entitiesUpserted++
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: entitiesUpserted > 0 ? [`circleci: bootstrapped ${entitiesUpserted} entities`] : ['circleci: no entities found'],
    }
  }
}
