import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'
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
    } catch (err) {
      // ENOENT (binary genuinely not on PATH) is a legitimate empty result —
      // an org that hasn't installed the argocd CLI has no apps to report,
      // same class as vault's documented 404-is-empty-list case. Any other
      // failure (non-zero exit from a real auth/connection error, or a
      // 15s timeout) is a real outage that must not look identical to
      // "not installed" — confirmed live via independent connector-bootstrap
      // review that this catch previously swallowed both cases the same way.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['ArgoCD CLI not available'] }
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`ArgoCD bootstrap: 'argocd app list' failed: ${msg}`)
    }

    let apps: { metadata?: { name?: string }; spec?: { destination?: { namespace?: string } }; status?: { sync?: { status?: string } } }[]
    try {
      apps = JSON.parse(stdout)
    } catch (err) {
      // The CLI ran and exited 0 (we only get here past the ENOENT/exit-code
      // catch above) but returned output that isn't valid JSON — a real,
      // unexpected-format bug, not "no apps configured". Must throw, not
      // silently report an empty success.
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`ArgoCD bootstrap: 'argocd app list' returned non-JSON output: ${msg}`)
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
