import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

function resolveKubectlArgs(payload: Record<string, unknown>): { args: string[]; cleanup?: () => void } {
  const kubeconfig = payload['kubeconfig'] as string | undefined
  const server = payload['server'] as string | undefined
  const token = payload['token'] as string | undefined

  if (kubeconfig) {
    // YAML content: write temp file
    if (kubeconfig.trimStart().startsWith('apiVersion')) {
      const tmp = join(tmpdir(), `anvay-k8s-${Date.now()}.yaml`)
      writeFileSync(tmp, kubeconfig, { mode: 0o600 })
      return { args: ['--kubeconfig', tmp], cleanup: () => { try { unlinkSync(tmp) } catch {} } }
    }
    // File path
    return { args: ['--kubeconfig', kubeconfig] }
  }

  if (server && token) {
    return { args: ['--server', server, '--token', token, '--insecure-skip-tls-verify=true'] }
  }

  // Use default kubectl context (KUBECONFIG env or ~/.kube/config)
  return { args: [] }
}

export class KubernetesBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const { args: kubectlBase, cleanup } = resolveKubectlArgs(payload)
    const run = (k: string) => spawnSync('kubectl', [...kubectlBase, ...k.split(' ')], { encoding: 'utf-8', timeout: 15_000 })

    try {
      // 1. Get pods
      const podsResult = run('get pods --all-namespaces -o json')
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
      const svcResult = run('get services --all-namespaces -o json')
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
    } finally {
      cleanup?.()
    }
  }
}
