import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

interface SentryConn { baseUrl: string; token: string; org: string }

interface SentryProject { id: string; slug: string; name: string }
interface SentryIssue { id: string; title: string; culprit?: string }

function connFromPayload(payload: Record<string, unknown>): SentryConn | null {
  const token = payload['token']
  const org = payload['org']
  const baseUrl = payload['baseUrl']
  if (typeof token !== 'string' || typeof org !== 'string') return null
  const resolvedBase = typeof baseUrl === 'string' ? baseUrl : 'https://sentry.io'
  return { baseUrl: resolvedBase.replace(/\/$/, ''), token, org }
}

async function sentryGet(conn: SentryConn, path: string): Promise<unknown> {
  const res = await fetch(`${conn.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Sentry API ${res.status} for ${path}`)
  return res.json()
}

export class SentryBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const conn = connFromPayload(payload)
    if (!conn) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Sentry bootstrap: missing token/org'] }
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0
    const hints: string[] = []

    // Budgets — confirmed via independent review: this previously fetched
    // ONE unpaginated page of projects and issues for the FIRST project
    // only — every other project's recent errors were silently absent from
    // the graph. Now: all projects (Sentry paginates via Link headers; the
    // plain endpoint returns up to 100 — loop via cursor query param), and
    // recent issues for EVERY project, budget-capped and reported.
    const MAX_PROJECTS = 500
    const MAX_ISSUES_PER_PROJECT = 100
    let truncated = false

    // 1. Projects → Service entities (cursor pagination via Link header)
    const projects: SentryProject[] = []
    {
      let url = `${conn.baseUrl}/api/0/organizations/${conn.org}/projects/?per_page=100`
      for (;;) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' } })
        if (!res.ok) throw new Error(`Sentry API ${res.status} for projects list`)
        const page = await res.json() as SentryProject[]
        projects.push(...(Array.isArray(page) ? page : []))
        // Sentry Link header: <url>; rel="next"; results="true|false"; cursor="..."
        const link = res.headers.get('link') ?? ''
        const next = link.split(',').find(part => part.includes('rel="next"') && part.includes('results="true"'))
        const m = next?.match(/<([^>]+)>/)
        if (!m?.[1]) break
        url = m[1]
        if (projects.length >= MAX_PROJECTS) { truncated = true; break }
      }
    }

    // Confirmed live via independent review: upsertRelationship casts
    // fromEntityId/toEntityId to ::uuid, but this previously passed
    // fabricated `Alert:${title}` / `Service:${slug}` strings, which threw
    // on the very first real issue. upsertEntity's return value is the
    // real entity UUID and must be captured instead.
    const projectEntityIdBySlug = new Map<string, string>()
    for (const p of projects) {
      const projectEntityId = await this.kg.upsertEntity({
        type: 'Service',
        name: p.slug,
        metadata: {
          externalId: p.id,
          displayName: p.name,
          source: 'sentry',
          connectorCoordinates: { sentry: { resourceIds: { projectSlug: p.slug, projectId: p.id, org: conn.org } } },
        },
      }, tenantId)
      entitiesUpserted++
      projectEntityIdBySlug.set(p.slug, projectEntityId)
      hints.push(`Sentry project ${p.slug} — ${p.name}`)
    }

    // 2. Recent issues for EVERY project → Alert entities
    let totalIssues = 0
    for (const p of projects) {
      const projectEntityId = projectEntityIdBySlug.get(p.slug)
      if (!projectEntityId) continue
      let issues: SentryIssue[]
      try {
        issues = await sentryGet(
          conn,
          `/api/0/projects/${conn.org}/${p.slug}/issues/?statsPeriod=24h&limit=${MAX_ISSUES_PER_PROJECT}`,
        ) as SentryIssue[]
      } catch {
        // Per-project access gap (token scoped to a team) — continue with
        // the rest rather than aborting the whole bootstrap.
        continue
      }
      for (const issue of (Array.isArray(issues) ? issues : [])) {
        const alertId = await this.kg.upsertEntity({
          type: 'Alert',
          name: issue.title,
          metadata: {
            externalId: issue.id,
            culprit: issue.culprit,
            source: 'sentry',
            connectorCoordinates: { sentry: { resourceIds: { issueId: issue.id } } },
          },
        }, tenantId)
        entitiesUpserted++
        totalIssues++

        await this.kg.upsertRelationship({
          fromEntityId: alertId,
          relType: 'MONITORED_BY',
          toEntityId: projectEntityId,
        }, tenantId)
        relationshipsUpserted++
      }
    }
    hints.push(`Sentry bootstrap: ${projects.length} projects, ${totalIssues} issues across all projects`)
    if (truncated) hints.push(`Sentry bootstrap: TRUNCATED at ${MAX_PROJECTS} projects — graph is partial`)

    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
