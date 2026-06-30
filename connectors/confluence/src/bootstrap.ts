import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class ConfluenceBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly baseUrl?: string,
    private readonly apiToken?: string,
    private readonly email?: string,
  ) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? this.baseUrl
    const apiToken = (payload['apiToken'] as string | undefined) ?? this.apiToken
    const email = (payload['email'] as string | undefined) ?? this.email
    if (!baseUrl || !apiToken || !email) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['confluence: no credentials configured'] }
    }

    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64')
    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    }

    let entitiesUpserted = 0

    // Fetch spaces
    const spaceResp = await fetch(`${baseUrl}/wiki/rest/api/space?limit=50`, { headers })
    if (spaceResp.ok) {
      const spaces = (await spaceResp.json() as { results?: Array<{ key: string; name: string }> }).results ?? []
      for (const space of spaces) {
        try {
          // Fetch pages in space
          const pageResp = await fetch(`${baseUrl}/wiki/rest/api/space/${space.key}/content?limit=20`, { headers })
          if (pageResp.ok) {
            const pages = (await pageResp.json() as { results?: Array<{ id: string; title: string; _links?: { webui?: string } }> }).results ?? []
            for (const page of pages) {
              await this.kg.upsertEntity({
                type: 'Doc', name: page.title,
                metadata: {
                  externalId: page.id,
                  space: space.key,
                  url: `${baseUrl}${page._links?.webui ?? `/wiki/spaces/${space.key}/pages/${page.id}`}`,
                  connectorCoordinates: { confluence: { resourceIds: { spaceKey: space.key, pageId: page.id, pageTitle: page.title } } },
                },
              }, tenantId)
              entitiesUpserted++
            }
          }
        } catch { /* per-space error, continue */ }
      }
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: entitiesUpserted > 0 ? [`confluence: bootstrapped ${entitiesUpserted} docs`] : ['confluence: no entities found'],
    }
  }
}
