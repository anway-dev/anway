import { KubeConfig, CoreV1Api } from '@kubernetes/client-node'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

/**
 * Patches a loaded KubeConfig so it works from inside a Docker container:
 * - 127.0.0.1 / localhost → host.docker.internal (reach host services)
 * - caFile pointing to host FS paths that don't exist in container → skipTLSVerify
 */
function patchForContainer(kc: KubeConfig): void {
  kc.clusters = kc.clusters.map(cluster => {
    const c: any = { ...cluster }
    if (c.server) {
      const rewritten = c.server.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)/, '$1host.docker.internal')
      if (rewritten !== c.server) {
        c.server = rewritten
        // host.docker.internal is not in the cert's SANs (issued for localhost/127.0.0.1/minikube)
        // so skip TLS when we rewrote the hostname
        c.skipTLSVerify = true
        delete c.caFile
        delete c.caData
      }
    }
    // CA cert file from host FS not accessible in container → skip TLS
    if (c.caFile && !existsSync(c.caFile)) {
      delete c.caFile
      c.skipTLSVerify = true
    }
    return c
  })
}

function buildKubeConfig(payload: Record<string, unknown>): { kc: KubeConfig; cleanup?: () => void } {
  const kc = new KubeConfig()
  const kubeconfig = payload['kubeconfig'] as string | undefined
  const server = payload['server'] as string | undefined
  const token = payload['token'] as string | undefined

  if (kubeconfig?.trimStart().startsWith('apiVersion')) {
    // Inline YAML — write temp file then load
    const tmp = join(tmpdir(), `anway-k8s-${Date.now()}.yaml`)
    writeFileSync(tmp, kubeconfig, { mode: 0o600 })
    kc.loadFromFile(tmp)
    patchForContainer(kc)
    return { kc, cleanup: () => { try { unlinkSync(tmp) } catch { /* ignore */ } } }
  }

  if (kubeconfig) {
    // File path
    kc.loadFromFile(kubeconfig)
    patchForContainer(kc)
    return { kc }
  }

  if (server && token) {
    kc.loadFromOptions({
      clusters: [{ name: 'anway', server, skipTLSVerify: true }],
      users: [{ name: 'anway', token }],
      contexts: [{ name: 'anway', cluster: 'anway', user: 'anway' }],
      currentContext: 'anway',
    })
    return { kc }
  }

  // Fall back to default kubeconfig context
  kc.loadFromDefault()
  patchForContainer(kc)
  return { kc }
}

export class KubernetesBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const { kc, cleanup } = buildKubeConfig(payload)

    try {
      const api = kc.makeApiClient(CoreV1Api)

      // 1. List all services across all namespaces first — the real,
      // authoritative set of K8s DNS names (`<name>.<namespace>.svc.cluster.local`)
      // that step 3 below matches pod env vars against for DEPENDS_ON.
      const svcsResp = await api.listServiceForAllNamespaces()
      const namespaces = new Set<string>()
      let entitiesUpserted = 0
      let relationshipsUpserted = 0
      const serviceIdByNsName = new Map<string, string>()

      for (const svc of svcsResp.items ?? []) {
        const selector = svc.spec?.selector ?? {}
        const selectorStr = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(',')
        const ns = svc.metadata?.namespace ?? 'default'
        const name = svc.metadata?.name ?? 'unknown'
        if (selectorStr) {
          namespaces.add(ns)
          const svcId = await this.kg.upsertEntity({
            type: 'Service',
            name,
            metadata: {
              namespace: ns,
              connectorCoordinates: { k8s: { resourceIds: { namespace: ns, selector: selectorStr } } },
            },
          }, tenantId)
          serviceIdByNsName.set(`${ns}/${name}`, svcId)
          entitiesUpserted++
        }
      }

      // 2. List all pods across all namespaces
      const podsResp = await api.listPodForAllNamespaces()
      const pods = podsResp.items ?? []

      // K8s DNS pattern for same-cluster service refs: `<svc>.<ns>.svc.cluster.local`
      // or `<svc>.<ns>.svc`. Captures svc+ns so the match is checked against
      // real Service entities rather than any arbitrary substring hit.
      const dnsRefPattern = /\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.svc(?:\.cluster\.local)?\b/gi

      for (const pod of pods) {
        const ns = pod.metadata?.namespace ?? 'default'
        namespaces.add(ns)
        const labels = pod.metadata?.labels ?? {}
        const appLabel = labels['app'] ?? labels['app.kubernetes.io/name'] ?? pod.metadata?.name ?? 'unknown'

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

        // 3. Service→DEPENDS_ON→Service — real, derivable at bootstrap time
        // from container env var values that reference another real
        // Service's K8s DNS name (e.g.
        // `PAYMENTS_URL=http://payments-api.prod.svc.cluster.local`).
        // Confirmed live via independent connector-bootstrap audit:
        // CLAUDE.md documents this relationship for the K8s connector but
        // bootstrap.ts never created it. Matched only against Service
        // entities already known from the real /services listing above —
        // an unmatched hostname is skipped rather than fabricating a Service.
        const seenTargets = new Set<string>()
        for (const container of pod.spec?.containers ?? []) {
          for (const env of container.env ?? []) {
            const value = env.value
            if (!value) continue
            for (const match of value.matchAll(dnsRefPattern)) {
              const [, refName, refNs] = match
              const targetKey = `${refNs}/${refName}`
              if (targetKey === `${ns}/${appLabel}` || seenTargets.has(targetKey)) continue
              const targetId = serviceIdByNsName.get(targetKey)
              if (!targetId) continue // referenced host not a known Service — skip rather than fabricate
              seenTargets.add(targetKey)
              await this.kg.upsertRelationship({ fromEntityId: svcId, relType: 'DEPENDS_ON', toEntityId: targetId, metadata: {} }, tenantId)
              relationshipsUpserted++
            }
          }
        }
      }

      const hints = [`K8s bootstrap: found ${entitiesUpserted} services across ${namespaces.size} namespaces`]
      return { entitiesUpserted, relationshipsUpserted, episodeHints: hints, metadata: { namespaces: Array.from(namespaces) } }
    } finally {
      cleanup?.()
    }
  }
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('ENOENT') && (msg.includes('.crt') || msg.includes('.key') || msg.includes('.pem') || msg.includes('.csr'))) {
    return `Certificate file not found inside the gateway container: ${msg}\n\nFix: run this on your machine and paste the output into the kubeconfig field:\n  kubectl config view --raw --minify --flatten\nThis embeds all certs inline so no host filesystem paths are needed.`
  }
  return msg.slice(0, 600)
}

/** Lightweight connectivity check — used by the /test endpoint. */
export async function testK8sConnectivity(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { kc, cleanup } = buildKubeConfig(payload)
  try {
    const api = kc.makeApiClient(CoreV1Api)
    const resp = await api.listNamespace()
    const count = resp.items?.length ?? 0
    return { ok: true, message: `Cluster reachable — ${count} namespace${count !== 1 ? 's' : ''}` }
  } catch (err) {
    return { ok: false, error: friendlyError(err) }
  } finally {
    cleanup?.()
  }
}
