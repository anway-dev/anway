import { spawnSync } from 'node:child_process'
import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

export class KubernetesBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const kubeconfigPath = ((payload as Record<string, unknown>)['kubeconfig'] as string) ?? undefined
    const kubectlArgs = (k: string) => kubeconfigPath ? ['--kubeconfig', kubeconfigPath, ...k.split(' ')] : k.split(' ')

    // 1. Get pods
    const podsResult = spawnSync('kubectl', kubectlArgs('get pods --all-namespaces -o json'), { encoding: 'utf-8', timeout: 15_000 })
    if (podsResult.status !== 0) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['K8s bootstrap: kubectl not available or cluster unreachable'] }
    }

    const podsData = JSON.parse(podsResult.stdout) as { items: Array<{ metadata: { name: string; namespace: string; labels?: Record<string, string> } }> }
    const namespaces = new Set<string>()
    let entitiesUpserted = 0
    let relationshipsUpserted = 0

    for (const pod of podsData.items) {
      const ns = pod.metadata.namespace
      namespaces.add(ns)
      // Extract app label (app= or app.kubernetes.io/name=)
      const labels = pod.metadata.labels ?? {}
      const appLabel = labels['app'] ?? labels['app.kubernetes.io/name'] ?? pod.metadata.name

      const nsId = await this.kg.upsertEntity({ type: 'Namespace', name: ns, metadata: {} }, tenantId)
      const svcId = await this.kg.upsertEntity({
        type: 'Service',
        name: appLabel,
        metadata: {
          namespace: ns,
          connectorCoordinates: { k8s: { resourceIds: { namespace: ns, selector: `app=${appLabel}` } } },
        },
      }, tenantId)
      await this.kg.upsertRelationship({ fromEntityId: svcId, relType: 'HOSTED_IN', toEntityId: nsId, metadata: {} }, tenantId)
      entitiesUpserted++
      relationshipsUpserted++
    }

    // 2. Get services
    const svcResult = spawnSync('kubectl', kubectlArgs('get services --all-namespaces -o json'), { encoding: 'utf-8', timeout: 15_000 })
    if (svcResult.status === 0) {
      const svcData = JSON.parse(svcResult.stdout) as { items: Array<{ metadata: { name: string; namespace: string }; spec?: { selector?: Record<string, string> } }> }
      for (const svc of svcData.items) {
        const selector = svc.spec?.selector ?? {}
        const selectorStr = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(',')
        if (selectorStr) {
          await this.kg.upsertEntity({
            type: 'Service',
            name: svc.metadata.name,
            metadata: {
              namespace: svc.metadata.namespace,
              connectorCoordinates: {
                k8s: { resourceIds: { namespace: svc.metadata.namespace, selector: selectorStr } },
              },
            },
          }, tenantId)
          entitiesUpserted++
        }
      }
    }

    const hints = [`K8s bootstrap: found ${entitiesUpserted} services across ${namespaces.size} namespaces`]
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
