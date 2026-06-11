import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

const LINEAR_API = 'https://api.linear.app/graphql'

async function graphqlQuery(token: string, query: string): Promise<Record<string, unknown>> {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`Linear API ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

interface TeamNode { id: string; name: string; key: string }
interface ProjectNode { id: string; name: string; key: string }
interface IssueNode { id: string; identifier: string; title: string; description?: string }

export class LinearBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly apiKey?: string,
  ) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    if (!this.apiKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Linear bootstrap: no API key'] }
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0

    // 1. Fetch teams
    try {
      const teamsData = await graphqlQuery(this.apiKey, '{ teams { nodes { id name key } } }') as { data?: { teams?: { nodes: TeamNode[] } } }
      const teams = teamsData?.data?.teams?.nodes ?? []

      for (const team of teams) {
        await this.kg.upsertEntity({
          type: 'Team',
          name: team.name,
          metadata: { externalId: team.id, linearKey: team.key, connectorCoordinates: { linear: { resourceIds: { teamId: team.id } } } },
        }, tenantId)
        entitiesUpserted++
      }

      // 2. Fetch projects
      const projData = await graphqlQuery(this.apiKey, '{ projects { nodes { id name } } }') as { data?: { projects?: { nodes: Array<{ id: string; name: string }> } } }
      const projects = projData?.data?.projects?.nodes ?? []

      for (const proj of projects) {
        await this.kg.upsertEntity({
          type: 'Project',
          name: proj.name,
          metadata: { externalId: proj.id, source: 'linear' },
        }, tenantId)
        entitiesUpserted++
      }

      // 3. Fetch recent issues (last 30 days)
      const issuesData = await graphqlQuery(this.apiKey, `{ issues(filter: { createdAt: { gte: "${new Date(Date.now() - 30 * 86400000).toISOString()}" } }, first: 100) { nodes { id identifier title description } } }`) as { data?: { issues?: { nodes: IssueNode[] } } }
      const issues = issuesData?.data?.issues?.nodes ?? []

      for (const issue of issues) {
        const issueName = `${issue.identifier}: ${issue.title}`
        const ticketId = await this.kg.upsertEntity({
          type: 'Ticket',
          name: issueName,
          metadata: { externalId: issue.id, source: 'linear', status: 'open' },
        }, tenantId)
        entitiesUpserted++

        // Match ticket title words against known Service entities
        const words = issue.title.split(/\s+/).filter((w: string) => w.length > 3)
        for (const word of words.slice(0, 3)) {
          try {
            const ctx = await this.kg.resolveContextByName(word, tenantId, 1)
            if (ctx && ctx.primaryEntity?.type === 'Service') {
              await this.kg.upsertRelationship({
                fromEntityId: ticketId,
                relType: 'RELATES_TO',
                toEntityId: ctx.primaryEntity.id,
                metadata: { confidence: 0.6, source: 'linear-title-match' },
              }, tenantId)
              relationshipsUpserted++
              break
            }
          } catch { /* no match — skip */ }
        }
      }

      const hints = [`Linear bootstrap: ${teams.length} teams, ${projects.length} projects, ${issues.length} recent tickets`]
      return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Linear API error'
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [`Linear bootstrap failed: ${msg}`] }
    }
  }
}
