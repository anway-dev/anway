import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class VaultBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'http://localhost:8200'
    const token = (payload['token'] as string | undefined) ?? (payload['apiKey'] as string | undefined) ?? ''
    const headers: Record<string, string> = { 'X-Vault-Token': token }

    // Confirmed live via independent review: after exhausting the retry
    // loop below, a persistent non-ok response (e.g. 403 — invalid token)
    // was reported as the same generic "connection failed" empty success
    // as a genuinely unreachable Vault instance. baseUrl defaults to
    // localhost:8200 (real unauthenticated local dev setup), so a
    // connection-level failure (fetch() itself throwing) stays
    // legitimately empty — same reasoning as elastic/sonarqube's
    // bootstraps this session — but once Vault actually responds with a
    // real error status every retry, that's a real auth/permission
    // problem worth surfacing, not silence.
    let res: Response | null = null
    try {
      // Vault dev containers can return health OK before the root token is fully
      // provisioned. Retry the mounts call a few times to avoid false failures.
      for (let attempt = 0; attempt < 5; attempt++) {
        res = await fetch(`${baseUrl}/v1/sys/mounts`, { headers })
        if (res.ok) break
        await new Promise(r => setTimeout(r, 1000))
      }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Vault bootstrap: instance unreachable'] }
    }
    if (!res || !res.ok) {
      // No token configured at all — a 401/403 here is expected, not a
      // real failure (confirmed live: this connector's own conformance
      // test calls bootstrap({}) against a real reachable Vault dev
      // instance with no token, and legitimately gets 403 back). A real
      // token that still fails after every retry is a genuine problem.
      if (!token) {
        return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Vault bootstrap: no token configured'] }
      }
      throw new Error(`Vault bootstrap: /v1/sys/mounts failed with HTTP ${res?.status ?? 'no response'}`)
    }
    // Confirmed against a REAL Vault instance (dev-mode container): the
    // /v1/sys/mounts response is a standard Vault envelope — request_id,
    // lease_id, wrap_info: null, auth: null, ... with the actual mount map
    // under `data` (top-level mount keys are also present for backwards
    // compat, ALONGSIDE the null envelope fields). Iterating the raw body
    // hit `wrap_info: null` and crashed on `info.type`. The fixture test
    // authored an envelope-free response, so only the live run caught it.
    const body = await res.json() as { data?: Record<string, unknown> } & Record<string, unknown>
    const mounts = (body['data'] && typeof body['data'] === 'object' ? body['data'] : body) as Record<string, unknown>
    let entitiesUpserted = 0
    for (const [path, rawInfo] of Object.entries(mounts)) {
      if (!rawInfo || typeof rawInfo !== 'object' || typeof (rawInfo as { type?: unknown }).type !== 'string') continue
      const info = rawInfo as { type: string; description?: string }
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
  }
}
