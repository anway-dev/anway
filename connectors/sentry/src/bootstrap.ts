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

    // 1. Projects → Service entities
    const projects = await sentryGet(conn, `/api/0/organizations/${conn.org}/projects/`) as SentryProject[]
    for (const p of projects) {
      await this.kg.upsertEntity({
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
      hints.push(`Sentry project ${p.slug} — ${p.name}`)
    }

    // 2. Recent issues for the first project → Alert entities
    const firstProject = projects[0]
    if (firstProject) {
      const issues = await sentryGet(
        conn,
        `/api/0/projects/${conn.org}/${firstProject.slug}/issues/?statsPeriod=24h`,
      ) as SentryIssue[]
      for (const issue of issues) {
        await this.kg.upsertEntity({
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

        await this.kg.upsertRelationship({
          fromEntityId: `Alert:${issue.title}`,
          relType: 'MONITORED_BY',
          toEntityId: `Service:${firstProject.slug}`,
        }, tenantId)
        relationshipsUpserted++
      }
      hints.push(`Sentry bootstrap: ${projects.length} projects, ${issues.length} issues`)
    } else {
      hints.push(`Sentry bootstrap: ${projects.length} projects, 0 issues`)
    }

    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
