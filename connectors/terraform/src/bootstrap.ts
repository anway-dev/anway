import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class TerraformBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    if (!token) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Terraform bootstrap: no API token configured'] }
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json' }

    // Confirmed live via independent review: both the top-level and
    // per-org catch swallowed every failure (invalid token, network
    // outage, malformed JSON) as a plausible success — a completely
    // invalid token would fail the organizations call and report "0
    // workspaces across 0 orgs indexed", identical to a genuinely empty
    // Terraform Cloud account. Hits app.terraform.io's real cloud API, so
    // a network failure is a real outage worth surfacing.
    // Paginate to completion with a hard budget — confirmed via independent
    // review: this fetched ONE unpaginated page of orgs and workspaces, and
    // Terraform Cloud's default page size is only 20, so any org with >20
    // workspaces got a silently partial graph. TFC paginates via
    // page[number]/page[size] with meta.pagination.next-page.
    const base = (payload['baseUrl'] as string | undefined) ?? 'https://app.terraform.io'
    const MAX_ORGS = 100
    const MAX_WORKSPACES_PER_ORG = 1000
    const PAGE_SIZE = 100
    let truncated = false

    interface TfcPage<T> { data?: T[]; meta?: { pagination?: { 'next-page'?: number | null } } }
    const fetchAll = async <T>(pathBase: string, cap: number, label: string): Promise<{ items: T[]; capped: boolean }> => {
      const items: T[] = []
      for (let page = 1; ; ) {
        const sep = pathBase.includes('?') ? '&' : '?'
        const res = await fetch(`${base}${pathBase}${sep}page%5Bnumber%5D=${page}&page%5Bsize%5D=${PAGE_SIZE}`, { headers })
        if (!res.ok) throw Object.assign(new Error(`Terraform bootstrap: ${label} failed with HTTP ${res.status}`), { status: res.status })
        const data = await res.json() as TfcPage<T>
        items.push(...(data.data ?? []))
        const next = data.meta?.pagination?.['next-page']
        if (next == null) return { items, capped: false }
        if (items.length >= cap) return { items, capped: true }
        page = next
      }
    }

    const { items: orgs, capped: orgsCapped } = await fetchAll<{ id: string; attributes: { name: string } }>('/api/v2/organizations', MAX_ORGS, '/api/v2/organizations')
    if (orgsCapped) truncated = true
    let entitiesUpserted = 0
    for (const org of orgs) {
      const orgName = org.attributes.name
      let workspaces: Array<{ id: string; attributes: { name: string } }>
      try {
        const r = await fetchAll<{ id: string; attributes: { name: string } }>(`/api/v2/organizations/${orgName}/workspaces`, MAX_WORKSPACES_PER_ORG, `workspaces for org ${orgName}`)
        workspaces = r.items
        if (r.capped) truncated = true
      } catch (err) {
        // 403/404 for one specific org is a legitimate per-org permission
        // gap; anything else is a real failure that must not look
        // identical to "empty org".
        const status = (err as { status?: number }).status
        if (status === 403 || status === 404) continue
        throw err
      }
      for (const w of workspaces) {
        await this.kg.upsertEntity({
          type: 'Service', name: `${orgName}/${w.attributes.name}`,
          metadata: {
            source: 'terraform', org: orgName, workspace: w.attributes.name,
            connectorCoordinates: { terraform: { connectorType: 'terraform', resourceIds: { org: orgName, workspace: w.attributes.name }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
          },
        }, tenantId)
        entitiesUpserted++
      }
    }
    return {
      entitiesUpserted, relationshipsUpserted: 0,
      episodeHints: [
        `Terraform: ${entitiesUpserted} workspaces across ${orgs.length} orgs indexed`,
        ...(truncated ? ['Terraform bootstrap: TRUNCATED by budget — graph is partial'] : []),
      ],
    }
  }
}
