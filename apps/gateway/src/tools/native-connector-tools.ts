import type { ExecutableTool } from '@anway/agent'
import type { ConnectorCreds } from '@anway/types'
import { withTenant } from '../db/prisma.js'
import { effectiveCredentials } from '../utils/credentials.js'
import type { PrismaClient } from '@prisma/client'
import { adaptConnectorAgent } from './connector-tools-adapter.js'
import { ArgocdAgent } from '@anway/connector-argocd'
import { AwsCloudwatchAgent } from '@anway/connector-aws-cloudwatch'
import { AwsHealthAgent } from '@anway/connector-aws-health'
import { AzureMonitorAgent } from '@anway/connector-azure-monitor'
import { CircleciAgent } from '@anway/connector-circleci'
import { ConfluenceAgent } from '@anway/connector-confluence'
import { CoralogixAgent } from '@anway/connector-coralogix'
import { DatadogAgent } from '@anway/connector-datadog'
import { DynatraceAgent } from '@anway/connector-dynatrace'
import { EksAgent } from '@anway/connector-eks'
import { ElasticAgent } from '@anway/connector-elastic'
import { GcpMonitoringAgent } from '@anway/connector-gcp-monitoring'
import { GkeAgent } from '@anway/connector-gke'
import { JenkinsAgent } from '@anway/connector-jenkins'
import { JiraAgent } from '@anway/connector-jira'
import { K8sAgent } from '@anway/connector-k8s'
import { LaunchdarklyAgent } from '@anway/connector-launchdarkly'
import { LinearAgent } from '@anway/connector-linear'
import { NewrelicAgent } from '@anway/connector-newrelic'
import { NotionAgent } from '@anway/connector-notion'
import { OpsgenieAgent } from '@anway/connector-opsgenie'
import { PagerdutyAgent } from '@anway/connector-pagerduty'
import { SentryAgent } from '@anway/connector-sentry'
import { SlackAgent } from '@anway/connector-slack'
import { SnykAgent } from '@anway/connector-snyk'
import { SonarqubeAgent } from '@anway/connector-sonarqube'
import { TerraformAgent } from '@anway/connector-terraform'
import { VaultAgent } from '@anway/connector-vault'
import { VercelAgent } from '@anway/connector-vercel'

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
      name: 'prometheus__query',
      description: 'Execute a targeted PromQL instant query scoped to a specific service. ' +
        'REQUIRED: query MUST include a specific service or job label filter from graph connector coordinates, ' +
        'e.g. rate(http_requests_total{service="payments-api"}[5m]). ' +
        'FORBIDDEN: wildcard matchers like {service=~".+"} or empty selectors {} — these are blocked at the execution layer.',
      parameters: {
        type: 'object' as const,
        properties: { query: { type: 'string', description: 'PromQL expression with specific service/job label, e.g. rate(http_requests_total{service="payments-api"}[5m])' } },
        required: ['query'],
      },
      run: async (args: Record<string, unknown>) => {
        const query = String(args['query'] ?? '')
        // Block wildcard/universal queries (T11)
        if (/\{\s*\}/.test(query) || /=~"\.\+"/.test(query) || /=~"\.\*"/.test(query) || /__name__=~/.test(query)) {
          return { error: 'wildcard selector forbidden — use graph coordinates' }
        }
        try {
          const resp = await fetch(`${baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`)
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'prometheus__alerts',
      description: 'List currently firing alerts from Prometheus.',
      parameters: { type: 'object' as const, properties: {}, required: [] },
      run: async () => {
        try {
          const resp = await fetch(`${baseUrl}/api/v1/alerts`)
          if (!resp.ok) return { alerts: [] }
          const data = await resp.json() as { data?: { alerts?: unknown[] } }
          return { alerts: data?.data?.alerts ?? [] }
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'prometheus__targets',
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
      name: 'alertmanager__alerts',
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
      name: 'alertmanager__silences',
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
      name: 'loki__query',
      description: 'Execute a targeted LogQL range query against Loki scoped to a specific service. ' +
        'REQUIRED: query MUST include a specific app or service label from graph connector coordinates, ' +
        'e.g. {app="payments-api"} |= "error". ' +
        'FORBIDDEN: wildcard matchers like {app=~".+"} or empty selectors {} — these are blocked at the execution layer.',
      parameters: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'LogQL expression with specific service label, e.g. {app="payments-api"} |= "error"' },
          since: { type: 'string', description: 'Lookback window, e.g. 5m, 1h, 24h (default: 1h)' },
          limit: { type: 'number', description: 'Max log lines to return (default: 50)' },
        },
        required: ['query'],
      },
      run: async (args: Record<string, unknown>) => {
        const query = String(args['query'] ?? '')
        // Block wildcard/universal LogQL queries (T11)
        if (/\{\s*\}/.test(query) || /=~".\+"/.test(query)) {
          return { error: 'wildcard selector forbidden — use graph coordinates' }
        }
        try {
          const now = Math.floor(Date.now() / 1000)
          const since = String(args['since'] ?? '1h')
          const start = now - parseDurationSec(since)
          const params = new URLSearchParams({
            query,
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
      name: 'loki__labels',
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
      name: 'grafana__dashboards',
      description: 'Search Grafana dashboards by service name. ' +
        'REQUIRED: pass the specific service name from graph connector coordinates as query, e.g. "payments-api". ' +
        'FORBIDDEN: empty string or "*" — these are blocked at the execution layer.',
      parameters: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Service name to search for, e.g. "payments-api". Must be a specific name — not empty or wildcard.' },
        },
        required: ['query'],
      },
      run: async (args: Record<string, unknown>) => {
        const rawQuery = String(args['query'] ?? '').trim()
        // Block empty or wildcard grafana search (T11)
        if (!rawQuery || rawQuery === '*') {
          return { error: 'wildcard selector forbidden — use graph coordinates' }
        }
        try {
          const q = encodeURIComponent(rawQuery)
          const resp = await fetch(`${baseUrl}/api/search?query=${q}&type=dash-db`, {
            headers: { Authorization: authHeader },
          })
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'grafana__health',
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
      name: 'github__list_repos',
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
      name: 'github__list_prs',
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
          const owner = org || 'anway-demo'
          const state = String(args['state'] ?? 'open')
          const url = `${apiBase}/repos/${owner}/${args['repo']}/pulls?state=${state}&limit=20`
          const resp = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } })
          return await resp.json()
        } catch (e) { return { error: String(e) } }
      },
    },
    {
      name: 'github__search_issues',
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
      case 'argocd':          tools.push(...adaptConnectorAgent(new ArgocdAgent(), creds as ConnectorCreds)); break
      case 'aws-cloudwatch':  tools.push(...adaptConnectorAgent(new AwsCloudwatchAgent(), creds as ConnectorCreds)); break
      case 'aws-health':      tools.push(...adaptConnectorAgent(new AwsHealthAgent(), creds as ConnectorCreds)); break
      case 'azure-monitor':   tools.push(...adaptConnectorAgent(new AzureMonitorAgent(), creds as ConnectorCreds)); break
      case 'circleci':        tools.push(...adaptConnectorAgent(new CircleciAgent(), creds as ConnectorCreds)); break
      case 'confluence':      tools.push(...adaptConnectorAgent(new ConfluenceAgent(), creds as ConnectorCreds)); break
      case 'coralogix':       tools.push(...adaptConnectorAgent(new CoralogixAgent(), creds as ConnectorCreds)); break
      case 'datadog':         tools.push(...adaptConnectorAgent(new DatadogAgent(), creds as ConnectorCreds)); break
      case 'dynatrace':       tools.push(...adaptConnectorAgent(new DynatraceAgent(), creds as ConnectorCreds)); break
      case 'eks':             tools.push(...adaptConnectorAgent(new EksAgent(), creds as ConnectorCreds)); break
      case 'elastic':         tools.push(...adaptConnectorAgent(new ElasticAgent(), creds as ConnectorCreds)); break
      case 'gcp-monitoring':  tools.push(...adaptConnectorAgent(new GcpMonitoringAgent(), creds as ConnectorCreds)); break
      case 'gke':             tools.push(...adaptConnectorAgent(new GkeAgent(), creds as ConnectorCreds)); break
      case 'jenkins':         tools.push(...adaptConnectorAgent(new JenkinsAgent(), creds as ConnectorCreds)); break
      case 'jira':            tools.push(...adaptConnectorAgent(new JiraAgent(), creds as ConnectorCreds)); break
      case 'k8s':             tools.push(...adaptConnectorAgent(new K8sAgent(), creds as ConnectorCreds)); break
      case 'launchdarkly':    tools.push(...adaptConnectorAgent(new LaunchdarklyAgent(), creds as ConnectorCreds)); break
      case 'linear':          tools.push(...adaptConnectorAgent(new LinearAgent(), creds as ConnectorCreds)); break
      case 'newrelic':        tools.push(...adaptConnectorAgent(new NewrelicAgent(), creds as ConnectorCreds)); break
      case 'notion':          tools.push(...adaptConnectorAgent(new NotionAgent(), creds as ConnectorCreds)); break
      case 'opsgenie':        tools.push(...adaptConnectorAgent(new OpsgenieAgent(), creds as ConnectorCreds)); break
      case 'pagerduty':       tools.push(...adaptConnectorAgent(new PagerdutyAgent(), creds as ConnectorCreds)); break
      case 'sentry':          tools.push(...adaptConnectorAgent(new SentryAgent(), creds as ConnectorCreds)); break
      case 'slack':           tools.push(...adaptConnectorAgent(new SlackAgent(), creds as ConnectorCreds)); break
      case 'snyk':            tools.push(...adaptConnectorAgent(new SnykAgent(), creds as ConnectorCreds)); break
      case 'sonarqube':       tools.push(...adaptConnectorAgent(new SonarqubeAgent(), creds as ConnectorCreds)); break
      case 'terraform':       tools.push(...adaptConnectorAgent(new TerraformAgent(), creds as ConnectorCreds)); break
      case 'vault':           tools.push(...adaptConnectorAgent(new VaultAgent(), creds as ConnectorCreds)); break
      case 'vercel':          tools.push(...adaptConnectorAgent(new VercelAgent(), creds as ConnectorCreds)); break
    }
  }
  return tools
}
