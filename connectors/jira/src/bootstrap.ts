import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

interface JiraConn { baseUrl: string; email: string; apiToken: string }

interface JiraProject { id: string; key: string; name: string; lead?: { displayName?: string } }
interface JiraIssue {
  id: string
  key: string
  fields?: {
    summary?: string
    project?: { key?: string; name?: string }
    assignee?: { displayName?: string } | null
  }
}

function connFromPayload(payload: Record<string, unknown>): JiraConn | null {
  const baseUrl = payload['baseUrl']
  const email = payload['email']
  const apiToken = payload['apiToken'] ?? payload['token']
  if (typeof baseUrl !== 'string' || typeof email !== 'string' || typeof apiToken !== 'string') return null
  return { baseUrl: baseUrl.replace(/\/$/, ''), email, apiToken }
}

async function jiraGet(conn: JiraConn, path: string): Promise<unknown> {
  const auth = Buffer.from(`${conn.email}:${conn.apiToken}`).toString('base64')
  const res = await fetch(`${conn.baseUrl}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Jira API ${res.status} for ${path}`)
  return res.json()
}

export class JiraBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const conn = connFromPayload(payload)
    if (!conn) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Jira bootstrap: missing baseUrl/email/apiToken'] }
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0
    const hints: string[] = []

    // Paginate to completion with a hard budget — confirmed via independent
    // review: this fetched exactly one page (maxResults=50) with no
    // pagination at all, so any org with >50 projects or >50 recent issues
    // got a silently partial graph, and agents answered confidently from an
    // incomplete world model. When the budget itself truncates, that is
    // REPORTED in episodeHints below, never silent.
    const MAX_PROJECTS = 1000
    const MAX_ISSUES = 1000
    const PAGE = 50

    // 1. Projects → ownership containers (Jira: startAt/maxResults + isLast)
    const projects: JiraProject[] = []
    let projectsTruncated = false
    for (let startAt = 0; ; startAt += PAGE) {
      const resp = await jiraGet(conn, `/rest/api/3/project/search?maxResults=${PAGE}&startAt=${startAt}`) as { values?: JiraProject[]; isLast?: boolean }
      const page = resp.values ?? []
      projects.push(...page)
      if (resp.isLast === true || page.length < PAGE) break
      if (projects.length >= MAX_PROJECTS) { projectsTruncated = true; break }
    }
    // Keyed by Jira project key — used below to resolve each issue's
    // OWNED_BY target. Confirmed live via independent review:
    // upsertRelationship casts fromEntityId/toEntityId to ::uuid, but this
    // previously passed fabricated `Project:${name}` / `Ticket:${key}`
    // strings, which threw on the very first real ticket. upsertEntity's
    // return value is the real entity UUID and must be captured instead.
    const projectIdByKey = new Map<string, string>()
    for (const p of projects) {
      const projectId = await this.kg.upsertEntity({
        type: 'Project',
        name: p.name,
        metadata: {
          externalId: p.id,
          jiraKey: p.key,
          lead: p.lead?.displayName,
          connectorCoordinates: { jira: { resourceIds: { projectKey: p.key, projectId: p.id } } },
        },
      }, tenantId)
      entitiesUpserted++
      projectIdByKey.set(p.key, projectId)
      hints.push(`Jira project ${p.key} — ${p.name}`)
    }

    // 2. Recent issues → Ticket entities (same startAt pagination)
    const issues: JiraIssue[] = []
    let issuesTruncated = false
    for (let startAt = 0; ; startAt += PAGE) {
      const resp = await jiraGet(
        conn,
        '/rest/api/3/search?jql=' + encodeURIComponent('ORDER BY updated DESC') + `&maxResults=${PAGE}&startAt=${startAt}&fields=summary,project,assignee`,
      ) as { issues?: JiraIssue[]; total?: number }
      const page = resp.issues ?? []
      issues.push(...page)
      if (page.length < PAGE || (typeof resp.total === 'number' && issues.length >= resp.total)) break
      if (issues.length >= MAX_ISSUES) { issuesTruncated = true; break }
    }
    for (const issue of issues) {
      const ticketId = await this.kg.upsertEntity({
        type: 'Ticket',
        name: issue.key,
        metadata: {
          externalId: issue.id,
          title: issue.fields?.summary,
          projectKey: issue.fields?.project?.key,
          assignee: issue.fields?.assignee?.displayName ?? null,
          source: 'jira',
          connectorCoordinates: { jira: { resourceIds: { issueKey: issue.key, issueId: issue.id } } },
        },
      }, tenantId)
      entitiesUpserted++

      // Ticket OWNED_BY its Project container (RELATES_TO Service resolved later, G2)
      const projectKey = issue.fields?.project?.key
      const projectId = projectKey ? projectIdByKey.get(projectKey) : undefined
      if (projectId) {
        await this.kg.upsertRelationship({
          fromEntityId: ticketId,
          relType: 'OWNED_BY',
          toEntityId: projectId,
        }, tenantId)
        relationshipsUpserted++
      }
    }

    hints.push(`Jira bootstrap: ${projects.length} projects, ${issues.length} issues`)
    if (projectsTruncated) hints.push(`Jira bootstrap: TRUNCATED at ${MAX_PROJECTS} projects — graph is partial`)
    if (issuesTruncated) hints.push(`Jira bootstrap: TRUNCATED at ${MAX_ISSUES} issues — graph is partial`)
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
