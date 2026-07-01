import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { createClient } from 'redis'
import { UUID_RE } from '../utils/validators.js'
import { effectiveCredentials } from '../utils/credentials.js'
import { requireRole } from '../plugins/rbac.js'
import { appendAuditEvent } from './audit.js'
import { decryptJson } from '../utils/crypto.js'
import { testK8sConnectivity } from '@anway/connector-k8s'
import { createKnowledgeGraph } from '../kb/index.js'

export interface ConfigField { label: string; key: string; type: string; placeholder?: string }
export interface CatalogEntry { id: string; name: string; category: string; description: string; color: string; icon: string; capabilities: string[]; configFields: ConfigField[] }

export const CONNECTOR_CATALOG: CatalogEntry[] = [
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
  { id: "alertmanager", name: "Alertmanager", category: "Alerting", description: "Prometheus Alertmanager — active alerts, silences, inhibitions", color: "#e55b2e", icon: "AM", capabilities: ["alerts"], configFields: [{ label: "Endpoint URL", key: "baseUrl", type: "text" }, { label: "Webhook Token (Anway receives alerts from Alertmanager with this bearer token)", key: "webhookToken", type: "password" }] },
  { id: "pagerduty", name: "PagerDuty", category: "Alerting", description: "Incidents, on-call schedules", color: "#06a94d", icon: "PD", capabilities: ["alerts", "incidents"], configFields: [{ label: "API Key", key: "api_key", type: "password" }, { label: "Service ID", key: "service_id", type: "text" }] },
  { id: "gke", name: "Google GKE", category: "Kubernetes", description: "GCP managed Kubernetes", color: "#4285f4", icon: "GK", capabilities: ["k8s", "infrastructure"], configFields: [{ label: "Project ID", key: "project_id", type: "text" }, { label: "Cluster Name", key: "cluster", type: "text" }, { label: "Service Account JSON", key: "sa_json", type: "textarea" }] },
  { id: "aws-cloudwatch", name: "AWS CloudWatch", category: "Cloud Health", description: "Metrics, alarms, logs, health events", color: "#ff9900", icon: "CW", capabilities: ["metrics", "logs", "alerts", "infrastructure"], configFields: [{ label: "Access Key ID", key: "access_key_id", type: "text" }, { label: "Secret Access Key", key: "secret_access_key", type: "password" }, { label: "Region", key: "region", type: "text" }] },
  { id: "aws-health", name: "AWS Health", category: "Cloud Health", description: "Service events, scheduled maintenance, account health", color: "#ff9900", icon: "AH", capabilities: ["alerts", "infrastructure"], configFields: [{ label: "Access Key ID", key: "access_key_id", type: "text" }, { label: "Secret Access Key", key: "secret_access_key", type: "password" }] },
  { id: "gcp-monitoring", name: "GCP Cloud Monitoring", category: "Cloud Health", description: "Metrics, uptime checks, alerting policies", color: "#4285f4", icon: "GM", capabilities: ["metrics", "alerts", "infrastructure"], configFields: [{ label: "Project ID", key: "project_id", type: "text" }, { label: "Service Account JSON", key: "sa_json", type: "textarea" }] },
  { id: "azure-monitor", name: "Azure Monitor", category: "Cloud Health", description: "Metrics, logs, alerts, service health", color: "#0078d4", icon: "AM", capabilities: ["metrics", "logs", "alerts", "infrastructure"], configFields: [{ label: "Tenant ID", key: "tenant_id", type: "text" }, { label: "Client ID", key: "client_id", type: "text" }, { label: "Client Secret", key: "client_secret", type: "password" }, { label: "Subscription ID", key: "subscription_id", type: "text" }] },
  { id: "slack", name: "Slack", category: "Collaboration", description: "Channels, messages, notifications, incidents", color: "#4a154b", icon: "SL", capabilities: ["notifications", "incidents"], configFields: [{ label: "Bot Token", key: "bot_token", type: "password" }, { label: "Default Channel", key: "channel", type: "text" }] },
  { id: "confluence", name: "Confluence", category: "Docs", description: "Pages, spaces, runbooks, architecture docs", color: "#0052cc", icon: "CF", capabilities: ["docs"], configFields: [{ label: "Site URL", key: "site", type: "text" }, { label: "API Token", key: "token", type: "password" }, { label: "Email", key: "email", type: "text" }] },
  { id: "grafana", name: "Grafana", category: "Observability", description: "Dashboards, alerting rules, annotations", color: "#f46800", icon: "GF", capabilities: ["metrics", "dashboards", "alerts"], configFields: [{ label: "Grafana URL", key: "url", type: "text", placeholder: "Internal API URL (e.g. http://grafana:3000)" }, { label: "Public URL (optional)", key: "dashboardUrl", type: "text", placeholder: "Browser-accessible URL for dashboard links (e.g. http://localhost:8520)" }, { label: "Service Account Token", key: "token", type: "password", placeholder: "Recommended for production" }, { label: "Username", key: "user", type: "text", placeholder: "Basic auth fallback (default: admin)" }, { label: "Password", key: "password", type: "password", placeholder: "Basic auth fallback" }, { label: "Org ID", key: "org_id", type: "text" }] },
  { id: "elastic", name: "Elasticsearch", category: "Logging", description: "Log search, APM, security analytics", color: "#00bfb3", icon: "ES", capabilities: ["logs", "search", "traces"], configFields: [{ label: "Elasticsearch URL", key: "url", type: "text" }, { label: "API Key", key: "api_key", type: "password" }, { label: "Index Pattern", key: "index", type: "text" }] },
  { id: "dynatrace", name: "Dynatrace", category: "Observability", description: "Full-stack APM, traces, infrastructure", color: "#1496ff", icon: "DT", capabilities: ["metrics", "traces", "infrastructure"], configFields: [{ label: "Environment URL", key: "env_url", type: "text" }, { label: "API Token", key: "api_token", type: "password" }] },
  { id: "sentry", name: "Sentry", category: "Error Tracking", description: "Errors, releases, performance, replays", color: "#362d59", icon: "SY", capabilities: ["errors", "releases", "traces"], configFields: [{ label: "Auth Token", key: "token", type: "password" }, { label: "Organization Slug", key: "org", type: "text" }, { label: "Project Slug", key: "project", type: "text" }] },
  { id: "jenkins", name: "Jenkins", category: "CI/CD", description: "Build pipelines, test results, deployments", color: "#d24939", icon: "JK", capabilities: ["ci", "deployments"], configFields: [{ label: "Jenkins URL", key: "url", type: "text" }, { label: "Username", key: "user", type: "text" }, { label: "API Token", key: "token", type: "password" }] },
  { id: "circleci", name: "CircleCI", category: "CI/CD", description: "Pipelines, workflows, test insights", color: "#343434", icon: "CC", capabilities: ["ci", "deployments"], configFields: [{ label: "API Token", key: "token", type: "password" }, { label: "Organization Slug", key: "org", type: "text" }] },
  { id: "vercel", name: "Vercel", category: "Deployment", description: "Frontend deployments, previews, edge functions", color: "#000000", icon: "VL", capabilities: ["deployments"], configFields: [{ label: "API Token", key: "token", type: "password" }, { label: "Team ID", key: "team_id", type: "text" }] },
  { id: "k8s", name: "Kubernetes", category: "Kubernetes", description: "Self-hosted cluster — pods, services, events", color: "#326ce5", icon: "K8", capabilities: ["k8s", "infrastructure"], configFields: [{ label: "API Server URL", key: "server", type: "text" }, { label: "Bearer Token", key: "token", type: "password" }, { label: "Kubeconfig (YAML content or file path)", key: "kubeconfig", type: "textarea" }] },
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
      tx.$queryRaw<{ bootstrapped_at: Date | null; last_bootstrap_summary: Record<string, unknown> | null }[]>`
        SELECT bootstrapped_at AS bootstrapped_at, last_bootstrap_summary AS last_bootstrap_summary
        FROM connector_config WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
      `
    ).catch(() => [])
    if (row.length === 0) return { bootstrapped: false }
    const summary = row[0]!.last_bootstrap_summary
    return {
      bootstrapped: row[0]!.bootstrapped_at !== null,
      bootstrappedAt: row[0]!.bootstrapped_at,
      summary: sanitizeBootstrapSummary(summary),
      namespaces: Array.isArray(summary?.['namespaces']) ? summary['namespaces'] as string[] : [],
      namespaceFilter: Array.isArray(summary?.['namespace_filter']) ? summary['namespace_filter'] as string[] : null,
    }
  })

  // PUT /api/connectors/:type/namespace-filter — save namespace selection for k8s-type connectors
  app.put<{ Params: { type: string }; Body: { namespaces: string[] | null } }>(
    '/api/connectors/:type/namespace-filter',
    { preHandler: [app.authenticate, requireRole('admin', 'sre')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { type } = request.params
      const K8S_TYPES = new Set(['k8s', 'eks', 'gke', 'aks'])
      if (!K8S_TYPES.has(type)) return reply.code(400).send({ error: 'namespace filter only applies to k8s connectors' })

      const { namespaces } = request.body
      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<{ last_bootstrap_summary: Record<string, unknown> | null }[]>`
          SELECT last_bootstrap_summary FROM connector_config
          WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
        `
      ).catch(() => [])
      if (rows.length === 0) return reply.code(404).send({ error: 'connector not registered' })

      const existing = rows[0]!.last_bootstrap_summary ?? {}
      const updated = { ...existing, namespace_filter: namespaces }
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE connector_config
          SET last_bootstrap_summary = ${JSON.stringify(updated)}::jsonb
          WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
        `
      )
      return { ok: true }
    },
  )

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

  const VALID_BOOTSTRAP_TYPES = new Set(['github','linear','argocd','datadog','prometheus','loki','alertmanager','pagerduty','k8s','eks','gke','aks','aws-cloudwatch'])
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
      await pub.del(`graph:bootstrap:lock:${tenantId}:${type}`).catch(() => {})
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

  // POST /api/connectors/grafana/provision-dashboards
  // For each Service entity in the graph: if no Grafana dashboard exists with that title,
  // create a basic one with error-rate, latency, and request-rate panels (Prometheus datasource).
  app.post('/api/connectors/grafana/provision-dashboards', {
    preHandler: [app.authenticate, requireRole('admin', 'sre')],
  }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string }

    // Load Grafana connector credentials
    const grafanaRows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ credentials_enc: string }>>`
        SELECT credentials_enc FROM connector_config
        WHERE tenant_id = ${tenantId}::uuid AND connector_type = 'grafana' AND enabled = true LIMIT 1
      `
    ).catch(() => [])
    if (grafanaRows.length === 0) return reply.code(404).send({ error: 'grafana connector not configured' })

    const grafanaCreds = decryptJson<Record<string, unknown>>(grafanaRows[0]!.credentials_enc)
    const grafanaBase = (grafanaCreds['url'] as string | undefined) ?? 'http://localhost:3001'
    // Public URL for dashboard links — may differ from internal API URL (e.g. behind a proxy)
    const grafanaPublicBase = (grafanaCreds['dashboardUrl'] ?? grafanaCreds['publicUrl'] ?? grafanaCreds['externalUrl'] ?? grafanaBase) as string
    const grafanaToken = grafanaCreds['token'] as string | undefined
    const grafanaUser = (grafanaCreds['user'] ?? grafanaCreds['username'] ?? 'admin') as string
    const grafanaPass = (grafanaCreds['password'] ?? '') as string
    const grafanaAuth = grafanaToken ? `Bearer ${grafanaToken}` : `Basic ${Buffer.from(`${grafanaUser}:${grafanaPass}`).toString('base64')}`

    // Resolve Prometheus datasource UID
    let promDsUid = 'prometheus'
    try {
      const dsRes = await fetch(`${grafanaBase}/api/datasources`, { headers: { Authorization: grafanaAuth } })
      if (dsRes.ok) {
        const ds = await dsRes.json() as Array<{ uid: string; type: string }>
        const prom = ds.find(d => d.type === 'prometheus')
        if (prom) promDsUid = prom.uid
      }
    } catch { /* use default */ }

    // Existing dashboards
    const existingTitles = new Set<string>()
    try {
      const searchRes = await fetch(`${grafanaBase}/api/search?type=dash-db`, { headers: { Authorization: grafanaAuth } })
      if (searchRes.ok) {
        const boards = await searchRes.json() as Array<{ title: string }>
        boards.forEach(b => existingTitles.add(b.title))
      }
    } catch { /* ignore */ }

    // Service entities from graph
    const services = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ name: string; metadata: Record<string, unknown> }>>`
        SELECT name, metadata FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type = 'Service'
        ORDER BY name ASC LIMIT 100
      `
    ).catch(() => [])

    const created: string[] = []
    const updated: string[] = []
    const failed: string[] = []
    const kg = createKnowledgeGraph(tenantId as import('@anway/types').TenantId)

    for (const svc of services) {
      const title = `${svc.name} — Service Overview`
      const alreadyExists = existingTitles.has(title)

      const job = ((svc.metadata?.['connectorCoordinates'] as Record<string, unknown> | undefined)?.['prometheus'] as { resourceIds?: { job?: string } } | undefined)?.resourceIds?.job ?? svc.name

      const panels = [
        {
          id: 1, type: 'timeseries', title: 'Request Rate',
          gridPos: { h: 8, w: 12, x: 0, y: 0 },
          datasource: { type: 'prometheus', uid: promDsUid },
          targets: [{ expr: `sum(rate(http_requests_total{job="${job}"}[2m]))`, legendFormat: 'req/s' }],
        },
        {
          id: 2, type: 'timeseries', title: 'Error Rate',
          gridPos: { h: 8, w: 12, x: 12, y: 0 },
          datasource: { type: 'prometheus', uid: promDsUid },
          targets: [{ expr: `sum(rate(http_requests_total{job="${job}",status=~"5.."}[2m])) / sum(rate(http_requests_total{job="${job}"}[2m]))`, legendFormat: 'error %' }],
          fieldConfig: { defaults: { unit: 'percentunit', thresholds: { steps: [{ value: 0, color: 'green' }, { value: 0.05, color: 'red' }] } } },
        },
        {
          id: 3, type: 'timeseries', title: 'P95 Latency',
          gridPos: { h: 8, w: 24, x: 0, y: 8 },
          datasource: { type: 'prometheus', uid: promDsUid },
          targets: [{ expr: `histogram_quantile(0.95, sum by(le)(rate(http_request_duration_seconds_bucket{job="${job}"}[5m])))`, legendFormat: 'p95' }],
          fieldConfig: { defaults: { unit: 's' } },
        },
      ]

      try {
        const res = await fetch(`${grafanaBase}/api/dashboards/db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: grafanaAuth },
          body: JSON.stringify({
            dashboard: { id: null, title, panels, schemaVersion: 36, version: 0, refresh: '30s', time: { from: 'now-1h', to: 'now' } },
            overwrite: true,
            folderId: 0,
          }),
        })
        if (res.ok) {
          if (alreadyExists) updated.push(svc.name); else created.push(svc.name)
          const d = await res.json() as { uid?: string; url?: string }
          const dashId = await kg.upsertEntity({
            type: 'Dashboard', name: title,
            metadata: {
              externalId: d.uid ?? title,
              url: d.url ? `${grafanaPublicBase}${d.url}` : `${grafanaPublicBase}/d/${d.uid}`,
              connectorCoordinates: { grafana: { connectorType: 'grafana', resourceIds: { uid: d.uid ?? title, title }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
            },
          }, tenantId as import('@anway/types').TenantId).catch(() => '')
          if (dashId && svc.name) {
            const svcEntity = await withTenant(prisma, tenantId, (tx) =>
              tx.$queryRaw<{ id: string }[]>`SELECT id FROM entities WHERE tenant_id = ${tenantId}::uuid AND type = 'Service' AND name = ${svc.name} LIMIT 1`
            ).catch(() => [] as { id: string }[])
            if (svcEntity[0]?.id) {
              await kg.upsertRelationship({ fromEntityId: dashId, relType: 'MONITORS', toEntityId: svcEntity[0].id }, tenantId as import('@anway/types').TenantId).catch(() => {})
            }
          }
        } else failed.push(svc.name)
      } catch { failed.push(svc.name) }
    }

    return { ok: true, created, updated, failed, total: services.length }
  })

  // POST /api/connectors/:type/test — validates credentials before saving
  app.post<{ Params: { type: string }; Body: { credentials: Record<string, unknown> } }>(
    '/api/connectors/:type/test',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { type } = request.params
      const { credentials } = request.body
      const { tenantId } = request.user as { tenantId: string }
      const userId = (request.user as { sub?: string }).sub ?? ''
      const K8S_TYPES = new Set(['k8s', 'eks', 'gke', 'aks'])

      let result: { ok: boolean; message?: string; error?: string }

      if (K8S_TYPES.has(type)) {
        result = await testK8sConnectivity(credentials)
      } else {
        const urlVal = (credentials['url'] ?? credentials['server'] ?? credentials['baseUrl'] ?? credentials['site'] ?? credentials['env_url']) as string | undefined
        if (urlVal && typeof urlVal === 'string') {
          try {
            const res = await fetch(urlVal, { signal: AbortSignal.timeout(5000), method: 'HEAD' })
            result = (res.ok || res.status < 500)
              ? { ok: true, message: `Reachable (HTTP ${res.status})` }
              : { ok: false, error: `HTTP ${res.status} from ${urlVal}` }
          } catch (e) {
            result = { ok: false, error: String(e).slice(0, 200) }
          }
        } else {
          result = { ok: true, message: 'Credentials saved — bootstrap will verify connectivity' }
        }
      }

      // Log test result to audit_events so it appears in the activity panel
      await appendAuditEvent({
        tenantId, userId,
        action: 'connector.test_connection',
        resource: type,
        outcome: result.ok ? 'success' : 'failed',
        metadata: {
          connectorType: type,
          message: result.message ?? result.error ?? '',
        },
      }).catch(() => {})

      // Also update last_bootstrap_summary.test so the activity endpoint surfaces it
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE connector_config
          SET last_bootstrap_summary = COALESCE(last_bootstrap_summary, '{}'::jsonb) ||
            ${JSON.stringify({ test: { ok: result.ok, message: result.message, error: result.error, at: new Date().toISOString() } })}::jsonb
          WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
        `
      ).catch(() => {})

      return reply.send(result)
    },
  )

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
      await pub.del(`graph:bootstrap:lock:${tenantId}:${type}`).catch(() => {})
      await pub.publish('connector_reconnected', JSON.stringify({
        type: 'connector_reconnected',
        tenantId,
        connectorType: type,
        connectorId: type,
      }))
    }
    return { ok: true, message: `Reconnect triggered for ${type}` }
  })

  // GET /api/connectors/activity — unified connector event log for all connector types
  app.get('/api/connectors/activity', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }

    // Bootstrap status from connector_config
    const configs = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ connector_type: string; enabled: boolean; bootstrapped_at: Date | null; last_bootstrap_summary: Record<string, unknown> | null; updated_at: Date }[]>`
        SELECT connector_type, enabled, bootstrapped_at, last_bootstrap_summary, updated_at
        FROM connector_config WHERE tenant_id = ${tenantId}::uuid
        ORDER BY updated_at DESC
      `
    ).catch(() => [])

    // Audit events for connectors (last 50)
    const auditRows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<{ event_type: string; payload: Record<string, unknown>; created_at: Date }[]>`
        SELECT event_type, payload, created_at FROM audit_events
        WHERE tenant_id = ${tenantId}::uuid
          AND (event_type LIKE 'connector.%' OR event_type LIKE 'connector_%')
        ORDER BY created_at DESC LIMIT 50
      `
    ).catch(() => [])

    type ActivityEvent = { type: string; connectorType: string; message: string; timestamp: string; level: 'info' | 'success' | 'error' | 'warn' }
    const events: ActivityEvent[] = []

    for (const cfg of configs) {
      const sum = cfg.last_bootstrap_summary
      if (!sum) {
        events.push({ type: 'registered', connectorType: cfg.connector_type, message: 'Registered — bootstrap pending', timestamp: cfg.updated_at.toISOString(), level: 'info' })
        continue
      }

      // Bootstrap result
      const status = sum['status'] as string | undefined
      const at = (sum['at'] as string | undefined) ?? cfg.updated_at.toISOString()
      if (status === 'success') {
        const nsCount = Array.isArray(sum['namespaces']) ? ` — ${(sum['namespaces'] as string[]).length} namespace${(sum['namespaces'] as string[]).length !== 1 ? 's' : ''}` : ''
        const entCount = typeof sum['entitiesUpserted'] === 'number' ? `, ${sum['entitiesUpserted']} entities` : ''
        events.push({ type: 'bootstrap_success', connectorType: cfg.connector_type, message: `Bootstrap succeeded${nsCount}${entCount}`, timestamp: at, level: 'success' })
      } else if (status === 'error') {
        const err = (sum['error'] as string | undefined) ?? 'unknown error'
        events.push({ type: 'bootstrap_error', connectorType: cfg.connector_type, message: `Bootstrap failed: ${err.slice(0, 200)}`, timestamp: at, level: 'error' })
      } else if (status) {
        events.push({ type: 'bootstrap_unknown', connectorType: cfg.connector_type, message: `Bootstrap: ${status}`, timestamp: at, level: 'warn' })
      }

      // Most recent test result (if any)
      const test = sum['test'] as { ok: boolean; message?: string; error?: string; at?: string } | undefined
      if (test?.at) {
        events.push({
          type: 'test_connection',
          connectorType: cfg.connector_type,
          message: test.ok ? `Connection test passed${test.message ? `: ${test.message}` : ''}` : `Connection test failed: ${test.error ?? 'unknown'}`,
          timestamp: test.at,
          level: test.ok ? 'success' : 'error',
        })
      }
    }

    for (const row of auditRows) {
      // Skip test_connection here — already surfaced from last_bootstrap_summary.test above
      if (row.event_type === 'connector.test_connection') continue
      const connType = (row.payload?.['connectorType'] as string | undefined) ?? (row.payload?.['type'] as string | undefined) ?? 'unknown'
      const msg = (row.payload?.['message'] as string | undefined)
      const outcome = (row.payload?.['outcome'] as string | undefined)
      events.push({
        type: row.event_type,
        connectorType: connType,
        message: msg ?? `${row.event_type.replace('connector.', '').replace(/_/g, ' ')}${outcome ? ` · ${outcome}` : ''}`,
        timestamp: row.created_at.toISOString(),
        level: outcome === 'denied' || outcome === 'failed' ? 'error' : 'info',
      })
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return { events: events.slice(0, 60) }
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
