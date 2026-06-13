import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

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

    // 1. Projects → ownership containers
    const projectsResp = await jiraGet(conn, '/rest/api/3/project/search?maxResults=50') as { values?: JiraProject[] }
    const projects = projectsResp.values ?? []
    for (const p of projects) {
      await this.kg.upsertEntity({
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
      hints.push(`Jira project ${p.key} — ${p.name}`)
    }

    // 2. Recent issues → Ticket entities
    const issuesResp = await jiraGet(
      conn,
      '/rest/api/3/search?jql=' + encodeURIComponent('ORDER BY updated DESC') + '&maxResults=50&fields=summary,project,assignee',
    ) as { issues?: JiraIssue[] }
    const issues = issuesResp.issues ?? []
    for (const issue of issues) {
      await this.kg.upsertEntity({
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
      if (issue.fields?.project?.key) {
        await this.kg.upsertRelationship({
          fromEntityId: `Ticket:${issue.key}`,
          relType: 'OWNED_BY',
          toEntityId: `Project:${issue.fields.project.name ?? issue.fields.project.key}`,
        }, tenantId)
        relationshipsUpserted++
      }
    }

    hints.push(`Jira bootstrap: ${projects.length} projects, ${issues.length} issues`)
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
