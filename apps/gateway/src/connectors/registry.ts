import { withTenant } from '../db/prisma.js'
import type { ExecutableTool, ProviderConfig } from '@anway/agent'
import { classifyToolRoles, ProviderFactory, extractListItems, resourceName, resourceId } from '@anway/agent'
import { McpConnector } from '@anway/mcp-adapter'
import type { CliExecEntry } from '@anway/cli-adapter'
import { CliConnector } from '@anway/cli-adapter'
import { encryptJson, decryptJson } from '../utils/crypto.js'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '../db/client.js'
import { checkRateLimit } from './rate-limiter.js'
import { effectiveApiKey } from '../utils/credentials.js'
import { createKnowledgeGraph } from '../kb/index.js'
import type { TenantId } from '@anway/types'

/** Same pattern used in graph-builder/subscriber.ts and events/incident-subscriber.ts (not shared — see those files). */
async function resolveProviderConfig(tenantId: string): Promise<ProviderConfig | null> {
  try {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ provider: string; api_key_enc: string | null; base_url: string; default_model: string; cheap_model: string }>>`
        SELECT provider, api_key_enc, base_url, default_model, cheap_model
        FROM provider_config WHERE tenant_id = ${tenantId}::uuid
      `
    )
    const KEYLESS = new Set(['ollama', 'lmstudio'])
    if (rows.length > 0 && (rows[0]!.api_key_enc || KEYLESS.has(rows[0]!.provider))) {
      const r = rows[0]!
      return {
        type: r.provider as ProviderConfig['type'],
        apiKey: effectiveApiKey(r),
        baseURL: r.base_url || undefined,
        defaultModel: r.default_model || undefined,
        cheapModel: r.cheap_model || undefined,
      }
    }
  } catch { /* fall through to env vars */ }
  if (process.env['ANTHROPIC_API_KEY']) return { type: 'anthropic', apiKey: process.env['ANTHROPIC_API_KEY'] }
  if (process.env['OPENAI_API_KEY']) return { type: 'openai', apiKey: process.env['OPENAI_API_KEY'] }
  if (process.env['DEEPSEEK_API_KEY']) return { type: 'deepseek', apiKey: process.env['DEEPSEEK_API_KEY'], baseURL: 'https://api.deepseek.com' }
  if (process.env['GROQ_API_KEY']) return { type: 'groq', apiKey: process.env['GROQ_API_KEY'] }
  if (process.env['MISTRAL_API_KEY']) return { type: 'mistral', apiKey: process.env['MISTRAL_API_KEY'] }
  if (process.env['OLLAMA_ENDPOINT']) return { type: 'ollama', baseURL: process.env['OLLAMA_ENDPOINT'] }
  if (process.env['LMSTUDIO_ENDPOINT']) return { type: 'lmstudio', baseURL: process.env['LMSTUDIO_ENDPOINT'] }
  return null
}

type ConnectorRow = {
  id: string
  type: string
  name: string
  mode: string
  config_enc?: string | null
}

// Singleton cache per (tenantId, connectorId) — bounded to prevent memory leak
const adapterCache = new Map<string, McpConnector | CliConnector>()
const MAX_ADAPTER_CACHE = 200
function cacheSetAdapter(key: string, val: McpConnector | CliConnector): void {
  if (adapterCache.size >= MAX_ADAPTER_CACHE) { const k = adapterCache.keys().next().value; if (k !== undefined) adapterCache.delete(k) }
  adapterCache.set(key, val)
}

function cacheKey(tenantId: string, connectorId: string): string {
  return `${tenantId}:${connectorId}`
}

// Allowlist of approved CLI connector binaries — prevents RCE via connector config
const ALLOWED_CLI_BINARIES = new Set([
  'gh', 'git', 'kubectl', 'argocd', 'aws', 'gcloud', 'az',
  'pd', 'terraform', 'helm', 'docker', 'datadog-ci',
])

function isAllowedBinary(binary: unknown): boolean {
  if (typeof binary !== 'string' || binary.length === 0) return false
  // Reject paths, shell metacharacters, and relative traversal
  if (/[/\\|;&`$<>]/.test(binary)) return false
  return ALLOWED_CLI_BINARIES.has(binary)
}

function getCfg(row: ConnectorRow): Record<string, unknown> | null {
  if (row.config_enc) {
    try { return decryptJson<Record<string, unknown>>(row.config_enc) } catch { return null }
  }
  return {}
}

function instantiateAdapter(row: ConnectorRow, tenantId: string): McpConnector | CliConnector | null {
  const cfg = getCfg(row)
  if (cfg === null) {
    // Decrypt failed — skip rather than cache a broken adapter
    return null
  }
  const name = row.name || row.type

  if (row.type === 'mcp') {
    return new McpConnector({
      url: cfg['url'] as string ?? '',
      name,
    })
  }

  // CLI type — validate binary against allowlist before instantiating
  const binary = cfg['binary']
  if (!isAllowedBinary(binary)) {
    return null
  }

  return new CliConnector({
    name,
    binary: binary as string,
    allowedSubcommands: cfg['allowedSubcommands'] as string[] | undefined,
    env: cfg['env'] as Record<string, string> | undefined,
    onExec(entry: CliExecEntry) {
      void (async () => {
        try {
          await withTenant(prisma, tenantId, (tx) =>
            tx.auditEvent.create({
              data: {
                id: crypto.randomUUID(),
                tenant_id: tenantId,
                user_id: null,
                session_id: null,
                event_type: 'tool_call_allowed',
                payload: JSON.parse(JSON.stringify(entry)),
                created_at: new Date(),
              },
            })
          )
        } catch { /* swallow */ }
      })()
    },
  })
}

export async function getToolsForTenant(
  prismaClient: PrismaClient,
  tenantId: string,
): Promise<ExecutableTool[]> {
  const rows = await withTenant(prismaClient, tenantId, (tx) =>
    tx.connector.findMany({ where: { tenant_id: tenantId } })
  ) as unknown as ConnectorRow[]

  // Load rate_limit_rps for each connector
  const rateLimits = await withTenant(prismaClient, tenantId, (tx) =>
    tx.$queryRaw<Array<{ connector_type: string; rate_limit_rps: number }>>`
      SELECT connector_type, COALESCE(rate_limit_rps, 10) AS rate_limit_rps
      FROM connector_config WHERE tenant_id = ${tenantId}::uuid
    `
  ).catch(() => [] as Array<{ connector_type: string; rate_limit_rps: number }>)
  const rpsByType = new Map(rateLimits.map(r => [r.connector_type, r.rate_limit_rps]))
  const DEFAULT_RPS = 10

  const adapterEntries = rows.map(async (row) => {
    const key = cacheKey(tenantId, row.id)
    let adapter = adapterCache.get(key)
    if (!adapter) {
      const built = instantiateAdapter(row, tenantId)
      if (!built) return []  // decrypt failed or binary not allowed — skip silently
      adapter = built
      cacheSetAdapter(key, adapter)
    }
    const tools = await adapter.getTools()
    const connectorType = row.type
    const rps = rpsByType.get(connectorType) ?? DEFAULT_RPS
    // Wrap each tool with rate limiting
    return tools.map(t => ({
      ...t,
      run: async (args: Record<string, unknown>) => {
        const allowed = await checkRateLimit(tenantId, connectorType, rps)
        if (!allowed) {
          // Wait 1s and retry once
          await new Promise(r => setTimeout(r, 1000))
          const retry = await checkRateLimit(tenantId, connectorType, rps)
          if (!retry) return { error: 'rate limit exceeded' }
        }
        return t.run(args)
      },
    }))
  })
  const toolArrays = await Promise.all(adapterEntries)
  return toolArrays.flat()
}

/**
 * Registration tool: register_connector — write action, admin role only.
 *
 * mcp/cli are templates: every call to this creates a genuinely distinct
 * row (its own UUID, own name, own config) — already multi-instance by
 * construction, no separate "instance_name" concept needed the way
 * connector_config required one (see migration 0046 there).
 *
 * On registration: discover the real tool set, classify it into standard
 * lifecycle roles (discovery/search/get/write) via the cheap model tier,
 * bootstrap graph entities from the discovery-role tool's real output (same
 * as any native connector's bootstrap), and persist a real per-tool
 * allowlist into capability_manifest — chat.ts's perimeter already reads
 * capability_manifest.allowedTools from this exact table for this exact
 * purpose. Classification is best-effort: no model configured, or nothing
 * classifies as read-shaped, means 0 entities and an empty allowlist — an
 * honest outcome, not a fabricated one.
 */
// Native connector_type strings — a chat perimeter's connectorId is derived
// from a tool's dot-prefix, and both this table (`connectors`, keyed by
// name) and connector_config (keyed by connector_type) share that same
// connectorId keyspace once merged into one manifests/scopes list in
// chat.ts. Naming an mcp/cli instance "github" would collide with the real
// github connector's manifest there (last-registered wins in the lookup
// map), silently granting or denying the wrong tools. Reject it outright
// instead of allowing a name that can never be resolved unambiguously.
const RESERVED_NATIVE_CONNECTOR_NAMES = new Set([
  'github', 'datadog', 'linear', 'argocd', 'coralogix', 'notion',
  'prometheus', 'newrelic', 'jira', 'loki', 'terraform', 'pagerduty',
  'slack', 'grafana', 'elastic', 'dynatrace', 'sentry', 'jenkins',
  'circleci', 'vercel', 'k8s', 'vault', 'snyk', 'sonarqube',
  'opsgenie', 'launchdarkly', 'confluence',
  'eks', 'gke', 'aks', 'aws-cloudwatch', 'aws-health', 'gcp-monitoring', 'azure-monitor',
  'alertmanager',
])

export async function registerConnectorTool(
  tenantId: string,
  type: 'mcp' | 'cli',
  name: string,
  config: Record<string, unknown>,
): Promise<{ connectorId: string; toolCount: number; tools: string[]; entitiesBootstrapped: number }> {
  if (RESERVED_NATIVE_CONNECTOR_NAMES.has(name)) {
    throw new Error(`"${name}" is a reserved native connector name — choose a different name for this ${type} instance`)
  }
  const row = await withTenant(prisma, tenantId, (tx) =>
    tx.connector.create({
      data: {
        tenant_id: tenantId,
        name,
        type,
        mode: 'read',
        config_enc: encryptJson(config),
        capability_manifest: { capabilities: { read: [], write: [] } },
      },
    })
  )

  const adapter = instantiateAdapter({ id: row.id, type, name, mode: 'read', config_enc: encryptJson(config) }, tenantId)
  if (!adapter) {
    return { connectorId: row.id, toolCount: 0, tools: [], entitiesBootstrapped: 0 }
  }
  const key = cacheKey(tenantId, row.id)
  cacheSetAdapter(key, adapter)

  const tools = await adapter.getTools()
  const toolNames = tools.map((t) => t.name)
  if (tools.length === 0) return { connectorId: row.id, toolCount: 0, tools: [], entitiesBootstrapped: 0 }

  const providerConfig = await resolveProviderConfig(tenantId)
  let entitiesBootstrapped = 0
  if (providerConfig) {
    const model = ProviderFactory.create(providerConfig)
    const roleMap = await classifyToolRoles(model, tools.map(t => ({ name: t.name, description: t.description })))
    const allowedTools = [roleMap.discovery, roleMap.search, roleMap.get, ...(roleMap.write ?? [])].filter((t): t is string => !!t)

    if (roleMap.discovery) {
      const discoveryTool = tools.find(t => t.name === roleMap.discovery)
      if (discoveryTool) {
        try {
          const result = await discoveryTool.run({}) as { data?: unknown }
          const items = extractListItems(result?.data ?? result)
          const kg = createKnowledgeGraph(tenantId as TenantId)
          for (const item of items) {
            await kg.upsertEntity({
              type: 'Resource',
              name: resourceName(item),
              metadata: {
                source: `${type}:${name}`,
                connectorType: type,
                connectorName: name,
                connectorId: row.id,
                connectorCoordinates: {
                  [name]: { connectorType: type, resourceIds: { id: resourceId(item) }, resolvedAt: new Date().toISOString(), confidence: 0.7 },
                },
              },
            }, tenantId as TenantId)
            entitiesBootstrapped++
          }
        } catch { /* discovery call failed — 0 entities is honest, not fabricated */ }
      }
    }

    if (allowedTools.length > 0) {
      await withTenant(prisma, tenantId, (tx) =>
        tx.connector.update({
          where: { id: row.id },
          data: { capability_manifest: JSON.parse(JSON.stringify({ capabilities: { read: ['*'], write: [] }, allowedTools, toolRoleMap: roleMap })) },
        })
      ).catch(() => {})
    }
  }

  return { connectorId: row.id, toolCount: tools.length, tools: toolNames, entitiesBootstrapped }
}

/** List connectors tool: returns connector list for tenant (mcp/cli, from the `connectors` table). */
export async function listConnectorsTool(tenantId: string): Promise<{ connectors: unknown[] }> {
  const rows = await withTenant(prisma, tenantId, (tx) =>
    tx.connector.findMany({ where: { tenant_id: tenantId } })
  ) as unknown as Array<{ id: string; name: string; type: string; mode: string; created_at: Date }>
  return { connectors: rows.map(r => ({ id: r.id, name: r.name, type: r.type, mode: r.mode, createdAt: r.created_at })) }
}
