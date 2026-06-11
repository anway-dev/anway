import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileAsync = promisify(execFile)

export class ArgocdBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    let stdout: string
    try {
      const result = await execFileAsync('argocd', ['app', 'list', '-o', 'json'], {
        timeout: 15_000,
        env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin' },
      })
      stdout = result.stdout
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['ArgoCD CLI not available'] }
    }

    let apps: { metadata?: { name?: string }; spec?: { destination?: { namespace?: string } }; status?: { sync?: { status?: string } } }[]
    try {
      apps = JSON.parse(stdout)
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['ArgoCD bootstrap: failed to parse app list'] }
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0
    for (const app of apps) {
      const name = app.metadata?.name
      if (!name) continue

      const deployId = await this.kg.upsertEntity({
        type: 'Deploy', name,
        metadata: { namespace: app.spec?.destination?.namespace ?? '', syncStatus: app.status?.sync?.status ?? 'unknown' },
      }, tenantId)
      entitiesUpserted++

      const svcId = await this.kg.upsertEntity({
        type: 'Service', name,
        metadata: { connectorCoordinates: { argocd: { resourceIds: { app: name } } } },
      }, tenantId)
      entitiesUpserted++

      await this.kg.upsertRelationship({ fromEntityId: deployId, relType: 'DEPLOYED_TO', toEntityId: svcId, metadata: {} }, tenantId)
      relationshipsUpserted++

      const pipelineId = await this.kg.upsertEntity({
        type: 'Pipeline', name: `argocd/${name}`,
        metadata: { provider: 'argocd', connectorCoordinates: { argocd: { resourceIds: { app: name } } } },
      }, tenantId)
      entitiesUpserted++

      await this.kg.upsertRelationship({ fromEntityId: svcId, relType: 'DEPLOYED_BY', toEntityId: pipelineId, metadata: {} }, tenantId)
      relationshipsUpserted++
    }

    return { entitiesUpserted, relationshipsUpserted, episodeHints: [`ArgoCD bootstrap: found ${apps.length} apps with service/pipeline edges`] }
  }
}
