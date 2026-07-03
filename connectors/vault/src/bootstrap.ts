import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class VaultBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'http://localhost:8200'
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    const headers: Record<string, string> = { 'X-Vault-Token': token }

    try {
      // Vault dev containers can return health OK before the root token is fully
      // provisioned. Retry the mounts call a few times to avoid false failures.
      let res: Response | null = null
      for (let attempt = 0; attempt < 5; attempt++) {
        res = await fetch(`${baseUrl}/v1/sys/mounts`, { headers })
        if (res.ok) break
        await new Promise(r => setTimeout(r, 1000))
      }
      if (!res || !res.ok) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Vault bootstrap: connection failed'] }
      const mounts = await res.json() as Record<string, { type: string; description?: string }>
      let entitiesUpserted = 0
      for (const [path, info] of Object.entries(mounts)) {
        // Each mount is a secret engine namespace
        await this.kg.upsertEntity({
          type: 'Service', name: path.replace(/\/$/, ''),
          metadata: {
            source: 'vault', engineType: info.type,
            connectorCoordinates: { vault: { connectorType: 'vault', resourceIds: { mount: path }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
          },
        }, tenantId)
        entitiesUpserted++
      }
      return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: [`Vault: ${entitiesUpserted} secret engines indexed`] }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Vault bootstrap: connection failed'] }
    }
  }
}
