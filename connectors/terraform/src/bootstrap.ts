import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class TerraformBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json' }

    try {
      const orgsRes = await fetch('https://app.terraform.io/api/v2/organizations', { headers })
      if (!orgsRes.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Terraform bootstrap: API call failed'] }
      const orgsData = await orgsRes.json() as { data?: Array<{ id: string; attributes: { name: string } }> }
      const orgs = orgsData.data ?? []
      let entitiesUpserted = 0
      for (const org of orgs) {
        const orgName = org.attributes.name
        try {
          const wsRes = await fetch(`https://app.terraform.io/api/v2/organizations/${orgName}/workspaces`, { headers })
          if (!wsRes.ok) continue
          const wsData = await wsRes.json() as { data?: Array<{ id: string; attributes: { name: string } }> }
          for (const w of wsData.data ?? []) {
            await this.kg.upsertEntity({
              type: 'Service', name: `${orgName}/${w.attributes.name}`,
              metadata: {
                source: 'terraform', org: orgName, workspace: w.attributes.name,
                connectorCoordinates: { terraform: { connectorType: 'terraform', resourceIds: { org: orgName, workspace: w.attributes.name }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
              },
            }, tenantId)
            entitiesUpserted++
          }
        } catch { /* skip workspaces for this org */ }
      }
      return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Terraform: ${entitiesUpserted} workspaces across ${orgs.length} orgs indexed`] }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Terraform bootstrap: connection failed'] }
    }
  }
}
