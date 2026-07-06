import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface VaultCreds { baseUrl: string; token: string }

function extractCreds(creds: Record<string, unknown>): VaultCreds {
  const baseUrl = (creds['baseUrl'] as string | undefined) ?? 'http://localhost:8200'
  const token = (creds['token'] as string | undefined) ?? (creds['apiKey'] as string | undefined)
  if (!token) throw new Error('Vault credentials not configured (token/apiKey)')
  return { baseUrl: baseUrl.replace(/\/$/, ''), token }
}

/** Split a Vault KV path into (mount, subpath). 'secret/myapp' → ['secret', 'myapp'] */
function splitMount(fullPath: string): [string, string] {
  const idx = fullPath.indexOf('/')
  if (idx === -1) return [fullPath, '']
  return [fullPath.slice(0, idx), fullPath.slice(idx + 1)]
}

// Real Vault semantics: a LIST on a path with no secrets yet returns 404 —
// that's a legitimate "nothing here" signal, not an error, so it stays
// { ok: false } rather than throwing. But a network exception, an auth
// failure (401/403 — wrong/expired token), or a server error (5xx) are real
// failures that previously collapsed into the exact same { ok: false, data:
// null } as the legitimate empty-list case — confirmed live via independent
// review, masking "Vault is unreachable or misconfigured" as "no secrets/
// policies exist". Those now throw instead.
async function vaultRequest(
  baseUrl: string, vaultPath: string, method: string, token: string,
): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(`${baseUrl}${vaultPath}`, {
    method,
    headers: { 'X-Vault-Token': token },
  })
  if (res.status === 401 || res.status === 403) throw new Error(`Vault auth failed: HTTP ${res.status}`)
  if (res.status >= 500) throw new Error(`Vault server error: HTTP ${res.status}`)
  const body = await res.json().catch(() => null) as unknown
  return { ok: res.ok, data: body }
}

const TOOLS: ConnectorTool[] = [
  // ── get_secret_metadata — real Vault KV v2 REST API ──────────────
  {
    definition: {
      name: 'get_secret_metadata',
      description: 'List secret keys at a Vault KV path and return metadata',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    execute: async (params, creds) => {
      const c = extractCreds(creds)
      const fullPath = String(params.path ?? '')
      const [mount, subpath] = splitMount(fullPath)

      // LIST equivalent: GET ?list=true (fetch rejects custom HTTP methods like LIST)
      const listPath = subpath
        ? `/v1/${mount}/metadata/${subpath}/?list=true`
        : `/v1/${mount}/metadata/?list=true`
      const listResult = await vaultRequest(c.baseUrl, listPath, 'GET', c.token)
      const keys: string[] = listResult.ok
        ? ((listResult.data as { data?: { keys?: string[] } })?.data?.keys ?? []).slice()
        : []

      // GET metadata for timestamp — only meaningful when subpath names a secret
      let lastUpdated: string | null = null
      if (subpath) {
        const metaPath = `/v1/${mount}/metadata/${subpath}`
        const metaResult = await vaultRequest(c.baseUrl, metaPath, 'GET', c.token)
        if (metaResult.ok) {
          const md = (metaResult.data as { data?: { updated_time?: string; created_time?: string } })?.data
          lastUpdated = md?.updated_time ?? md?.created_time ?? null
        }
      }

      return { keys, lastUpdated }
    },
    write: false,
  },

  // ── list_policies — real Vault REST API ───────────────────────────
  {
    definition: {
      name: 'list_policies',
      description: 'List Vault ACL policies',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (_params, creds) => {
      const c = extractCreds(creds)
      const result = await vaultRequest(c.baseUrl, '/v1/sys/policies/acl', 'GET', c.token)
      if (!result.ok) return { policies: [] }
      const policies = (result.data as { data?: { keys?: string[] } })?.data?.keys ?? []
      return { policies }
    },
    write: false,
  },
]

export class VaultAgent implements IConnectorAgent {
  readonly connectorType = 'vault'
  readonly tools = TOOLS
}
