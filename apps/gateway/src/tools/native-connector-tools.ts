import type { ExecutableTool } from '@anvay/agent'
import { withTenant } from '../db/prisma.js'
import { effectiveCredentials } from '../utils/credentials.js'
import type { PrismaClient } from '@prisma/client'

type ConnectorConfigRow = {
  connector_type: string
  credentials_enc: string | null
}

function parseDurationSec(s: string): number {
  const m = s.match(/^(\d+)(s|m|h|d)$/)
  if (!m) return 3600
  const n = parseInt(m[1]!, 10)
  switch (m[2]) {
    case 's': return n
    case 'm': return n * 60
    case 'h': return n * 3600
    case 'd': return n * 86400
    default: return 3600
  }
}

function makePrometheusTools(creds: Record<string, unknown>): ExecutableTool[] {
  const baseUrl = String(creds['baseUrl'] ?? creds['url'] ?? 'http://localhost:9090')
  return [
    {
      name: 'prometheus.query',
      description: 'Execute a PromQL instant query. Returns metric values at current time.',
      parameters: {
        type: 'object' as const,
        properties: { query: { type: 'string', description: 'PromQL expression, e.g. up, rate(http_requests_total[5m])' } },
        required: ['query'],
      },
      run: async (args: Record<string, unknown>) => {
        try {
          const resp = await fetch(`${baseUrl}/api/v1/query?query=${encodeURIComponent(String(args['query']))}`)
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'prometheus.alerts',
      description: 'List currently firing alerts from Prometheus.',
      parameters: { type: 'object' as const, properties: {}, required: [] },
      run: async () => {
        try {
          const resp = await fetch(`${baseUrl}/api/v1/alerts`)
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'prometheus.targets',
      description: 'List Prometheus scrape targets and their health.',
      parameters: { type: 'object' as const, properties: {}, required: [] },
      run: async () => {
        try {
          const resp = await fetch(`${baseUrl}/api/v1/targets`)
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
  ]
}

function makeAlertmanagerTools(creds: Record<string, unknown>): ExecutableTool[] {
  const baseUrl = String(creds['baseUrl'] ?? creds['url'] ?? 'http://localhost:9093')
  return [
    {
      name: 'alertmanager.alerts',
      description: 'List active alerts from Alertmanager. Filter by active/inhibited/silenced.',
      parameters: {
        type: 'object' as const,
        properties: {
          active: { type: 'boolean', description: 'Include active alerts (default true)' },
          inhibited: { type: 'boolean', description: 'Include inhibited alerts (default false)' },
          silenced: { type: 'boolean', description: 'Include silenced alerts (default false)' },
        },
        required: [],
      },
      run: async (args: Record<string, unknown>) => {
        try {
          const params = new URLSearchParams({
            active: String(args['active'] ?? true),
            inhibited: String(args['inhibited'] ?? false),
            silenced: String(args['silenced'] ?? false),
          })
          const resp = await fetch(`${baseUrl}/api/v2/alerts?${params}`)
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'alertmanager.silences',
      description: 'List active silences in Alertmanager.',
      parameters: { type: 'object' as const, properties: {}, required: [] },
      run: async () => {
        try {
          const resp = await fetch(`${baseUrl}/api/v2/silences`)
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
  ]
}

function makeLokiTools(creds: Record<string, unknown>): ExecutableTool[] {
  const baseUrl = String(creds['baseUrl'] ?? creds['url'] ?? 'http://localhost:3100')
  const orgId = creds['orgId'] ?? creds['org_id'] ?? '1'
  const headers: Record<string, string> = { 'X-Scope-OrgID': String(orgId) }
  return [
    {
      name: 'loki.query',
      description: 'Execute a LogQL range query against Loki. Returns log lines.',
      parameters: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'LogQL expression, e.g. {app="payments-api"} |= "error"' },
          since: { type: 'string', description: 'Lookback window, e.g. 5m, 1h, 24h (default: 1h)' },
          limit: { type: 'number', description: 'Max log lines to return (default: 50)' },
        },
        required: ['query'],
      },
      run: async (args: Record<string, unknown>) => {
        try {
          const now = Math.floor(Date.now() / 1000)
          const since = String(args['since'] ?? '1h')
          const start = now - parseDurationSec(since)
          const params = new URLSearchParams({
            query: String(args['query']),
            start: String(start * 1e9),
            end: String(now * 1e9),
            limit: String(args['limit'] ?? 50),
          })
          const resp = await fetch(`${baseUrl}/loki/api/v1/query_range?${params}`, { headers })
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'loki.labels',
      description: 'List available label names in Loki.',
      parameters: { type: 'object' as const, properties: {}, required: [] },
      run: async () => {
        try {
          const resp = await fetch(`${baseUrl}/loki/api/v1/labels`, { headers })
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
  ]
}

function makeGrafanaTools(creds: Record<string, unknown>): ExecutableTool[] {
  const baseUrl = String(creds['baseUrl'] ?? creds['url'] ?? 'http://localhost:3000')
  const token = creds['token'] as string | undefined
  const password = String(creds['password'] ?? 'admin')
  const authHeader = token ? `Bearer ${token}` : `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`
  return [
    {
      name: 'grafana.dashboards',
      description: 'Search Grafana dashboards. Returns list of matching dashboards with URLs.',
      parameters: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search string (leave empty for all dashboards)' },
        },
        required: [],
      },
      run: async (args: Record<string, unknown>) => {
        try {
          const q = encodeURIComponent(String(args['query'] ?? ''))
          const resp = await fetch(`${baseUrl}/api/search?query=${q}&type=dash-db`, {
            headers: { Authorization: authHeader },
          })
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'grafana.health',
      description: 'Check Grafana health status.',
      parameters: { type: 'object' as const, properties: {}, required: [] },
      run: async () => {
        try {
          const resp = await fetch(`${baseUrl}/api/health`, { headers: { Authorization: authHeader } })
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
  ]
}

function makeGitHubTools(creds: Record<string, unknown>): ExecutableTool[] {
  const token = String(creds['token'] ?? '')
  const org = String(creds['org'] ?? '')
  // Gitea if baseUrl set, otherwise GitHub
  const customBase = creds['baseUrl'] as string | undefined
  const apiBase = customBase ? `${customBase}/api/v1` : 'https://api.github.com'
  const authHeader = `Bearer ${token}`
  return [
    {
      name: 'github.list_repos',
      description: 'List repositories for the configured GitHub/Gitea organization.',
      parameters: {
        type: 'object' as const,
        properties: { page: { type: 'number', description: 'Page number (default 1)' } },
        required: [],
      },
      run: async (args: Record<string, unknown>) => {
        try {
          const page = Number(args['page'] ?? 1)
          const url = org
            ? `${apiBase}/orgs/${org}/repos?page=${page}&limit=20`
            : `${apiBase}/user/repos?page=${page}&limit=20`
          const resp = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } })
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'github.list_prs',
      description: 'List open pull requests for a repository.',
      parameters: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string', description: 'Repository name (e.g. "payments-api")' },
          state: { type: 'string', description: '"open", "closed", or "all" (default: "open")' },
        },
        required: ['repo'],
      },
      run: async (args: Record<string, unknown>) => {
        try {
          const owner = org || 'anvay-demo'
          const state = String(args['state'] ?? 'open')
          const url = `${apiBase}/repos/${owner}/${args['repo']}/pulls?state=${state}&limit=20`
          const resp = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } })
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'github.search_issues',
      description: 'Search issues and PRs in GitHub/Gitea.',
      parameters: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query string' },
        },
        required: ['query'],
      },
      run: async (args: Record<string, unknown>) => {
        try {
          const q = encodeURIComponent(String(args['query']))
          // Gitea: /api/v1/repos/search?q=... or /api/v1/issues/search?q=...
          // GitHub: /search/issues?q=...
          const url = customBase
            ? `${apiBase}/repos/search?q=${q}&topic=true&limit=20`
            : `https://api.github.com/search/issues?q=${q}+org:${org}`
          const resp = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } })
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
  ]
}

export async function getNativeConnectorTools(
  prismaClient: PrismaClient,
  tenantId: string,
): Promise<ExecutableTool[]> {
  const rows = await withTenant(prismaClient, tenantId, (tx) =>
    tx.$queryRaw<ConnectorConfigRow[]>`
      SELECT connector_type, credentials_enc
      FROM connector_config
      WHERE tenant_id = ${tenantId}::uuid AND enabled = true
    `
  ).catch(() => [] as ConnectorConfigRow[])

  const tools: ExecutableTool[] = []
  for (const row of rows) {
    const creds = effectiveCredentials(row as Parameters<typeof effectiveCredentials>[0])
    switch (row.connector_type) {
      case 'prometheus':    tools.push(...makePrometheusTools(creds)); break
      case 'alertmanager':  tools.push(...makeAlertmanagerTools(creds)); break
      case 'loki':          tools.push(...makeLokiTools(creds)); break
      case 'grafana':       tools.push(...makeGrafanaTools(creds)); break
      case 'github':        tools.push(...makeGitHubTools(creds)); break
      // vault: read-only listing is risky; skip for now
    }
  }
  return tools
}
