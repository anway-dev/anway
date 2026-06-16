import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { createClient } from 'redis'
import { UUID_RE } from '../utils/validators.js'
import { effectiveCredentials } from '../utils/credentials.js'
import { requireRole } from '../plugins/rbac.js'
import { appendAuditEvent } from './audit.js'

interface ConfigField { label: string; key: string; type: string }
interface CatalogEntry { id: string; name: string; category: string; description: string; color: string; icon: string; capabilities: string[]; configFields: ConfigField[] }

const CONNECTOR_CATALOG: CatalogEntry[] = [
  { id: "github", name: "GitHub", category: "Code & CI", description: "Repos, PRs, Actions, Issues", color: "#6e7681", icon: "GH", capabilities: ["code", "ci", "issues"], configFields: [{ label: "Personal Access Token", key: "token", type: "password" }, { label: "Organization", key: "org", type: "text" }] },
  { id: "linear", name: "Linear", category: "Issue Tracking", description: "Issues, projects, cycles", color: "#5e6ad2", icon: "LN", capabilities: ["issues", "roadmap"], configFields: [{ label: "API Key", key: "api_key", type: "password" }, { label: "Team ID", key: "team_id", type: "text" }] },
  { id: "datadog", name: "Datadog", category: "Observability", description: "Metrics, APM, logs, dashboards", color: "#7c3aed", icon: "DD", capabilities: ["metrics", "logs", "traces", "alerts"], configFields: [{ label: "API Key", key: "api_key", type: "password" }, { label: "App Key", key: "app_key", type: "password" }] },
  { id: "argocd", name: "ArgoCD", category: "Deployment", description: "GitOps deployments, rollbacks", color: "#f97316", icon: "AC", capabilities: ["deployments", "rollbacks"], configFields: [{ label: "Server URL", key: "server", type: "text" }, { label: "Auth Token", key: "token", type: "password" }] },
  { id: "coralogix", name: "Coralogix", category: "Logging", description: "Log management and analysis", color: "#06b6d4", icon: "CX", capabilities: ["logs", "alerts"], configFields: [{ label: "API Key", key: "api_key", type: "password" }, { label: "Region", key: "region", type: "text" }] },
  { id: "notion", name: "Notion", category: "Docs", description: "Specs, runbooks, wikis", color: "#e5e5e5", icon: "NT", capabilities: ["docs"], configFields: [{ label: "Integration Token", key: "token", type: "password" }, { label: "Database ID", key: "database_id", type: "text" }] },
  { id: "eks", name: "Amazon EKS", category: "Kubernetes", description: "Clusters, pods, services, metrics", color: "#f59e0b", icon: "EK", capabilities: ["k8s", "infrastructure"], configFields: [{ label: "Cluster Name", key: "cluster", type: "text" }, { label: "Region", key: "region", type: "text" }, { label: "Kubeconfig", key: "kubeconfig", type: "textarea" }] },
  { id: "ecs", name: "Amazon ECS", category: "Deployment", description: "Fargate + EC2 container services, task definitions", color: "#ff9900", icon: "EC", capabilities: ["deployments", "infrastructure"], configFields: [{ label: "Access Key ID", key: "access_key_id", type: "text" }, { label: "Secret Access Key", key: "secret_access_key", type: "password" }, { label: "Region", key: "region", type: "text" }, { label: "Cluster Name", key: "cluster", type: "text" }] },
  { id: "aks", name: "Azure AKS", category: "Kubernetes", description: "Azure managed Kubernetes clusters", color: "#0078d4", icon: "AK", capabilities: ["k8s", "infrastructure"], configFields: [{ label: "Tenant ID", key: "tenant_id", type: "text" }, { label: "Client ID", key: "client_id", type: "text" }, { label: "Client Secret", key: "client_secret", type: "password" }, { label: "Cluster Name", key: "cluster", type: "text" }, { label: "Resource Group", key: "resource_group", type: "text" }] },
  { id: "prometheus", name: "Prometheus", category: "Observability", description: "Self-hosted metrics and alerting", color: "#e55b2e", icon: "PR", capabilities: ["metrics", "alerts"], configFields: [{ label: "Endpoint URL", key: "url", type: "text" }, { label: "Basic Auth User", key: "user", type: "text" }, { label: "Basic Auth Password", key: "password", type: "password" }] },
  { id: "newrelic", name: "New Relic", category: "Observability", description: "APM, metrics, browser monitoring", color: "#1ce783", icon: "NR", capabilities: ["metrics", "logs", "traces"], configFields: [{ label: "License Key", key: "license_key", type: "password" }, { label: "Account ID", key: "account_id", type: "text" }] },
  { id: "jira", name: "Jira", category: "Issue Tracking", description: "Issues, sprints, epics", color: "#0052cc", icon: "JR", capabilities: ["issues", "roadmap"], configFields: [{ label: "Site URL", key: "site", type: "text" }, { label: "API Token", key: "token", type: "password" }, { label: "Email", key: "email", type: "text" }] },
  { id: "loki", name: "Loki", category: "Logging", description: "Log aggregation (Grafana stack)", color: "#f9a825", icon: "LK", capabilities: ["logs"], configFields: [{ label: "Endpoint URL", key: "url", type: "text" }, { label: "Org ID", key: "org_id", type: "text" }] },
  { id: "terraform", name: "Terraform Cloud", category: "Infrastructure", description: "IaC runs, state, workspaces", color: "#7b42bc", icon: "TF", capabilities: ["infrastructure"], configFields: [{ label: "API Token", key: "token", type: "password" }, { label: "Organization", key: "org", type: "text" }] },
  { id: "pagerduty", name: "PagerDuty", category: "Alerting", description: "Incidents, on-call schedules", color: "#06a94d", icon: "PD", capabilities: ["alerts", "incidents"], configFields: [{ label: "API Key", key: "api_key", type: "password" }, { label: "Service ID", key: "service_id", type: "text" }] },
  { id: "gke", name: "Google GKE", category: "Kubernetes", description: "GCP managed Kubernetes", color: "#4285f4", icon: "GK", capabilities: ["k8s", "infrastructure"], configFields: [{ label: "Project ID", key: "project_id", type: "text" }, { label: "Cluster Name", key: "cluster", type: "text" }, { label: "Service Account JSON", key: "sa_json", type: "textarea" }] },
  { id: "aws-cloudwatch", name: "AWS CloudWatch", category: "Cloud Health", description: "Metrics, alarms, logs, health events", color: "#ff9900", icon: "CW", capabilities: ["metrics", "logs", "alerts", "infrastructure"], configFields: [{ label: "Access Key ID", key: "access_key_id", type: "text" }, { label: "Secret Access Key", key: "secret_access_key", type: "password" }, { label: "Region", key: "region", type: "text" }] },
  { id: "aws-health", name: "AWS Health", category: "Cloud Health", description: "Service events, scheduled maintenance, account health", color: "#ff9900", icon: "AH", capabilities: ["alerts", "infrastructure"], configFields: [{ label: "Access Key ID", key: "access_key_id", type: "text" }, { label: "Secret Access Key", key: "secret_access_key", type: "password" }] },
  { id: "gcp-monitoring", name: "GCP Cloud Monitoring", category: "Cloud Health", description: "Metrics, uptime checks, alerting policies", color: "#4285f4", icon: "GM", capabilities: ["metrics", "alerts", "infrastructure"], configFields: [{ label: "Project ID", key: "project_id", type: "text" }, { label: "Service Account JSON", key: "sa_json", type: "textarea" }] },
  { id: "azure-monitor", name: "Azure Monitor", category: "Cloud Health", description: "Metrics, logs, alerts, service health", color: "#0078d4", icon: "AM", capabilities: ["metrics", "logs", "alerts", "infrastructure"], configFields: [{ label: "Tenant ID", key: "tenant_id", type: "text" }, { label: "Client ID", key: "client_id", type: "text" }, { label: "Client Secret", key: "client_secret", type: "password" }, { label: "Subscription ID", key: "subscription_id", type: "text" }] },
  { id: "slack", name: "Slack", category: "Collaboration", description: "Channels, messages, notifications, incidents", color: "#4a154b", icon: "SL", capabilities: ["notifications", "incidents"], configFields: [{ label: "Bot Token", key: "bot_token", type: "password" }, { label: "Default Channel", key: "channel", type: "text" }] },
  { id: "confluence", name: "Confluence", category: "Docs", description: "Pages, spaces, runbooks, architecture docs", color: "#0052cc", icon: "CF", capabilities: ["docs"], configFields: [{ label: "Site URL", key: "site", type: "text" }, { label: "API Token", key: "token", type: "password" }, { label: "Email", key: "email", type: "text" }] },
  { id: "grafana", name: "Grafana", category: "Observability", description: "Dashboards, alerting rules, annotations", color: "#f46800", icon: "GF", capabilities: ["metrics", "dashboards", "alerts"], configFields: [{ label: "Grafana URL", key: "url", type: "text" }, { label: "Service Account Token", key: "token", type: "password" }, { label: "Org ID", key: "org_id", type: "text" }] },
  { id: "elastic", name: "Elasticsearch", category: "Logging", description: "Log search, APM, security analytics", color: "#00bfb3", icon: "ES", capabilities: ["logs", "search", "traces"], configFields: [{ label: "Elasticsearch URL", key: "url", type: "text" }, { label: "API Key", key: "api_key", type: "password" }, { label: "Index Pattern", key: "index", type: "text" }] },
  { id: "dynatrace", name: "Dynatrace", category: "Observability", description: "Full-stack APM, traces, infrastructure", color: "#1496ff", icon: "DT", capabilities: ["metrics", "traces", "infrastructure"], configFields: [{ label: "Environment URL", key: "env_url", type: "text" }, { label: "API Token", key: "api_token", type: "password" }] },
  { id: "sentry", name: "Sentry", category: "Error Tracking", description: "Errors, releases, performance, replays", color: "#362d59", icon: "SY", capabilities: ["errors", "releases", "traces"], configFields: [{ label: "Auth Token", key: "token", type: "password" }, { label: "Organization Slug", key: "org", type: "text" }, { label: "Project Slug", key: "project", type: "text" }] },
  { id: "jenkins", name: "Jenkins", category: "CI/CD", description: "Build pipelines, test results, deployments", color: "#d24939", icon: "JK", capabilities: ["ci", "deployments"], configFields: [{ label: "Jenkins URL", key: "url", type: "text" }, { label: "Username", key: "user", type: "text" }, { label: "API Token", key: "token", type: "password" }] },
  { id: "circleci", name: "CircleCI", category: "CI/CD", description: "Pipelines, workflows, test insights", color: "#343434", icon: "CC", capabilities: ["ci", "deployments"], configFields: [{ label: "API Token", key: "token", type: "password" }, { label: "Organization Slug", key: "org", type: "text" }] },
  { id: "vercel", name: "Vercel", category: "Deployment", description: "Frontend deployments, previews, edge functions", color: "#000000", icon: "VL", capabilities: ["deployments"], configFields: [{ label: "API Token", key: "token", type: "password" }, { label: "Team ID", key: "team_id", type: "text" }] },
  { id: "k8s", name: "Kubernetes", category: "Kubernetes", description: "Self-hosted cluster — pods, services, events", color: "#326ce5", icon: "K8", capabilities: ["k8s", "infrastructure"], configFields: [{ label: "API Server URL", key: "server", type: "text" }, { label: "Bearer Token", key: "token", type: "password" }, { label: "Namespace", key: "namespace", type: "text" }] },
  { id: "vault", name: "HashiCorp Vault", category: "Security", description: "Secrets, policies, audit leases", color: "#ffcf25", icon: "VT", capabilities: ["secrets", "infrastructure"], configFields: [{ label: "Vault URL", key: "url", type: "text" }, { label: "Token", key: "token", type: "password" }, { label: "Namespace", key: "namespace", type: "text" }] },
  { id: "snyk", name: "Snyk", category: "Security", description: "Dependency vulns, SAST, container scanning", color: "#4c4a73", icon: "SK", capabilities: ["security", "code"], configFields: [{ label: "API Token", key: "token", type: "password" }, { label: "Org ID", key: "org_id", type: "text" }] },
  { id: "sonarqube", name: "SonarQube", category: "Code Quality", description: "Code smell, coverage, technical debt, security hotspots", color: "#4e9bcd", icon: "SQ", capabilities: ["code", "security"], configFields: [{ label: "Server URL", key: "url", type: "text" }, { label: "Token", key: "token", type: "password" }, { label: "Project Key", key: "project", type: "text" }] },
  { id: "opsgenie", name: "OpsGenie", category: "Alerting", description: "Alerts, on-call schedules, escalations", color: "#ef5c35", icon: "OG", capabilities: ["alerts", "incidents"], configFields: [{ label: "API Key", key: "api_key", type: "password" }] },
  { id: "launchdarkly", name: "LaunchDarkly", category: "Feature Flags", description: "Feature flags, A/B tests, rollouts", color: "#405bff", icon: "LD", capabilities: ["flags", "releases"], configFields: [{ label: "SDK Key", key: "sdk_key", type: "password" }, { label: "Project Key", key: "project", type: "text" }] },
]

const BOOTSTRAP_UNSAFE_KEYS = new Set(['error', 'stack', 'stackTrace', 'stderr', 'stdout'])

function sanitizeBootstrapSummary(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (BOOTSTRAP_UNSAFE_KEYS.has(k)) {
      out[k] = typeof v === 'string' ? v.slice(0, 200) : '[redacted]'
    } else {
      out[k] = v
    }
  }
  return out
}

export async function connectorsRoutes(app: FastifyInstance) {
  app.get('/api/connectors', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }

    const connectors = await withTenant(prisma, tenantId, (tx) =>
      tx.connector.findMany({
        where: { tenant_id: tenantId },
        select: {
          id: true,
          name: true,
          type: true,
          mode: true,
          created_at: true,
        },
      }),
    )

    return connectors.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      mode: c.mode,
      createdAt: c.created_at,
    }))
  })

  // T9: Bootstrap status
  app.get<{ Params: { type: string } }>('/api/connectors/:type/bootstrap-status', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { type } = request.params
    if (!KNOWN_CONNECTORS.has(type)) return reply.code(400).send({ error: `unknown connector type: ${type}` })
    const row = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ bootstrapped_at: Date | null; last_bootstrap_summary: unknown }[]>`
        SELECT bootstrapped_at AS bootstrapped_at, last_bootstrap_summary AS last_bootstrap_summary
        FROM connector_config WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
      `
    ).catch(() => [])
    if (row.length === 0) return { bootstrapped: false }
    return { bootstrapped: row[0]!.bootstrapped_at !== null, bootstrappedAt: row[0]!.bootstrapped_at, summary: sanitizeBootstrapSummary(row[0]!.last_bootstrap_summary) }
  })

  // BB1: Connector health/status — polls live connector endpoint
  app.get<{ Params: { type: string } }>('/api/connectors/:type/status', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { type } = request.params
    if (!KNOWN_CONNECTORS.has(type)) return reply.code(400).send({ error: `unknown connector type: ${type}` })

    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ enabled: boolean; bootstrapped_at: Date | null; last_bootstrap_summary: Record<string, unknown> | null }>>`
        SELECT enabled, bootstrapped_at, last_bootstrap_summary
        FROM connector_config
        WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
      `
    ).catch(() => [] as Array<{ enabled: boolean; bootstrapped_at: Date | null; last_bootstrap_summary: Record<string, unknown> | null }>)

    if (rows.length === 0) return reply.code(404).send({ error: 'connector not found' })
    const row = rows[0]!
    return reply.send({
      type,
      enabled: row.enabled,
      bootstrappedAt: row.bootstrapped_at?.toISOString() ?? null,
      lastBootstrapSummary: sanitizeBootstrapSummary(row.last_bootstrap_summary) ?? null,
      status: row.bootstrapped_at ? 'bootstrapped' : 'pending',
    })
  })

  const VALID_BOOTSTRAP_TYPES = new Set(['github','linear','argocd','datadog','prometheus','loki','pagerduty','k8s','aws-cloudwatch'])
const KNOWN_CONNECTORS = new Set(CONNECTOR_CATALOG.map(c => c.id))

  // T9: Trigger bootstrap
  app.post<{ Params: { type: string } }>('/api/connectors/:type/bootstrap', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { type } = request.params
    if (!VALID_BOOTSTRAP_TYPES.has(type)) {
      return reply.code(400).send({ error: `unknown connector type: ${type}` })
    }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ credentials_enc: string }>>`
        SELECT credentials_enc FROM connector_config
        WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
      `
    ).catch(() => [])
    if (rows.length === 0) return reply.code(404).send({ error: 'connector not registered' })

    const pub = await getBootstrapPub()
    if (pub) {
      await pub.publish('connector_registered', JSON.stringify({
        type: 'connector_registered',
        tenantId,
        connectorType: type,
        connectorId: type,
      }))
    }
    return { ok: true, message: `Bootstrap triggered for ${type}` }
  })

  // DELETE connector — emits connector_removed for stale marking
  app.delete<{ Params: { id: string } }>(
    '/api/connectors/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as { tenantId: string; role?: string }
      const { tenantId } = user
      if (user.role !== 'admin') return reply.code(403).send({ error: 'admin role required' })
      const { id } = request.params
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' })
      // Try connector_config first (settings-based), then connectors table (MCP/CLI adapters)
      let rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<{ connector_type: string }[]>`
          DELETE FROM connector_config
          WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          RETURNING connector_type
        `
      ).catch(() => [])
      if (rows.length === 0) {
        const adapterRows = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<{ connector_type: string }[]>`
            DELETE FROM connectors
            WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
            RETURNING type AS connector_type
          `
        ).catch(() => [])
        rows = adapterRows
      }
      if (rows.length === 0) return reply.code(404).send({ error: 'not found' })
      await appendAuditEvent({
        tenantId, userId: (request.user as { sub: string }).sub,
        action: 'connector.delete',
        resource: `connector:${id}`,
        outcome: 'action_executed',
        metadata: { id, connectorType: rows[0]!.connector_type },
      }).catch(() => {})
      const pub = await getBootstrapPub()
      if (pub) {
        await pub.publish('connector_removed', JSON.stringify({
          type: 'connector_removed',
          tenantId,
          connectorId: id,
          connectorType: rows[0]!.connector_type,
        }))
      }
      return reply.code(204).send()
    },
  )

  // GET /api/connectors/catalog — all known connector types merged with per-tenant enabled status
  app.get('/api/connectors/catalog', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const configs = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ connector_type: string; enabled: boolean; bootstrapped_at: Date | null }[]>`
        SELECT connector_type, enabled, bootstrapped_at FROM connector_config WHERE tenant_id = ${tenantId}::uuid
      `
    ).catch(() => [])
    const statusMap = new Map(configs.map(c => [c.connector_type, { enabled: c.enabled, bootstrappedAt: c.bootstrapped_at }]))
    return CONNECTOR_CATALOG.map(c => ({
      ...c,
      connected: statusMap.get(c.id)?.enabled ?? false,
      bootstrappedAt: statusMap.get(c.id)?.bootstrappedAt ?? null,
    }))
  })

  // POST /api/connectors/:type/reconnect — triggers re-bootstrap
  app.post<{ Params: { type: string } }>('/api/connectors/:type/reconnect', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }
    const { type } = request.params
    if (!VALID_BOOTSTRAP_TYPES.has(type)) {
      return reply.code(400).send({ error: `unknown connector type: ${type}` })
    }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ credentials_enc: string }>>`
        SELECT credentials_enc FROM connector_config
        WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
      `
    ).catch(() => [])
    if (rows.length === 0) return reply.code(404).send({ error: 'connector not registered' })
    const pub = await getBootstrapPub()
    if (pub) {
      await pub.publish('connector_reconnected', JSON.stringify({
        type: 'connector_reconnected',
        tenantId,
        connectorType: type,
        connectorId: type,
      }))
    }
    return { ok: true, message: `Reconnect triggered for ${type}` }
  })
}

let _pub: import('redis').RedisClientType | null = null
let _pubPromise: Promise<import('redis').RedisClientType> | null = null

async function getBootstrapPub(): Promise<import('redis').RedisClientType | null> {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (!_pub) {
    if (!_pubPromise) {
      _pubPromise = (async () => {
        const client = createClient({ url }) as import('redis').RedisClientType
        await client.connect()
        _pub = client
        return client
      })().catch((err) => {
        _pubPromise = null  // allow retry on next call
        throw err
      })
    }
    return _pubPromise
  }
  return _pub
}
