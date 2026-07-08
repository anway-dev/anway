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

    // Confirmed live via independent review: `if (spaceResp.ok)` with no
    // else branch meant a real auth/outage failure (401/403/5xx) silently
    // fell through to the same "no entities found" result as a genuinely
    // empty Confluence instance — a broken connector looked identical to a
    // working-but-quiet one. Real failures now throw; the per-space
    // try/catch below is kept (a single inaccessible space due to
    // per-space permissions is a legitimate partial case, same reasoning
    // as the AWS per-API AccessDenied handling elsewhere this session) but
    // now distinguishes that from a fully broken connector too.
    const spaceResp = await fetch(`${baseUrl}/wiki/rest/api/space?limit=50`, { headers })
    if (!spaceResp.ok) {
      throw new Error(`confluence: GET /wiki/rest/api/space failed with HTTP ${spaceResp.status}`)
    }
    const spaces = (await spaceResp.json() as { results?: Array<{ key: string; name: string }> }).results ?? []
    for (const space of spaces) {
      let pageResp: Response
      try {
        pageResp = await fetch(`${baseUrl}/wiki/rest/api/space/${space.key}/content?limit=20`, { headers })
      } catch {
        continue // genuine per-space network error — try the other spaces
      }
      if (!pageResp.ok) {
        // 403/404 for one specific space is a legitimate per-space
        // permission gap; anything else (5xx, auth entirely broken) is a
        // real failure that must not look identical to "empty space".
        if (pageResp.status === 403 || pageResp.status === 404) continue
        throw new Error(`confluence: GET pages for space ${space.key} failed with HTTP ${pageResp.status}`)
      }
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

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: entitiesUpserted > 0 ? [`confluence: bootstrapped ${entitiesUpserted} docs`] : ['confluence: no entities found'],
    }
  }
}
