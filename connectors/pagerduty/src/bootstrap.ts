import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

interface PdConn { baseUrl: string; token: string }

interface PdUser { id: string; name: string; email: string }
interface PdTeam { id: string; name: string }
interface PdOncall {
  user?: { id: string; summary: string }
  escalation_policy?: { summary: string }
}

function connFromPayload(payload: Record<string, unknown>): PdConn | null {
  const token = payload['token']
  if (typeof token !== 'string' || token.length === 0) return null
  const baseUrl = payload['baseUrl']
  return {
    token,
    baseUrl: (typeof baseUrl === 'string' ? baseUrl : 'https://api.pagerduty.com').replace(/\/$/, ''),
  }
}

async function pdGet(conn: PdConn, path: string): Promise<unknown> {
  const res = await fetch(`${conn.baseUrl}${path}`, {
    headers: {
      Authorization: `Token token=${conn.token}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
    },
  })
  if (!res.ok) throw new Error(`PagerDuty API ${res.status} for ${path}`)
  return res.json()
}

export class PagerdutyBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const conn = connFromPayload(payload)
    if (!conn) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['PagerDuty bootstrap: missing token'] }
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0
    const hints: string[] = []

    // 1. Users → Engineer entities
    const usersResp = await pdGet(conn, '/users?limit=100') as { users?: PdUser[] }
    const users = usersResp.users ?? []
    for (const user of users) {
      await this.kg.upsertEntity({
        type: 'Engineer',
        name: user.name,
        metadata: {
          externalId: user.id,
          email: user.email,
          source: 'pagerduty',
          connectorCoordinates: { pagerduty: { resourceIds: { userId: user.id } } },
        },
      }, tenantId)
      entitiesUpserted++
      hints.push(`PagerDuty engineer ${user.name}`)
    }

    // 2. Teams → Team entities
    const teamsResp = await pdGet(conn, '/teams?limit=100') as { teams?: PdTeam[] }
    const teams = teamsResp.teams ?? []
    for (const team of teams) {
      await this.kg.upsertEntity({
        type: 'Team',
        name: team.name,
        metadata: {
          externalId: team.id,
          source: 'pagerduty',
          connectorCoordinates: { pagerduty: { resourceIds: { teamId: team.id } } },
        },
      }, tenantId)
      entitiesUpserted++
      hints.push(`PagerDuty team ${team.name}`)
    }

    // 3. Oncalls → Team ONCALL Engineer
    const oncallsResp = await pdGet(conn, '/oncalls?limit=100') as { oncalls?: PdOncall[] }
    const oncalls = oncallsResp.oncalls ?? []
    for (const oncall of oncalls) {
      const userSummary = oncall.user?.summary
      if (!userSummary) continue
      const teamSummary = oncall.escalation_policy?.summary ?? 'unknown'
      await this.kg.upsertRelationship({
        fromEntityId: `Team:${teamSummary}`,
        relType: 'ONCALL',
        toEntityId: `Engineer:${userSummary}`,
      }, tenantId)
      relationshipsUpserted++
    }

    hints.push(`PagerDuty bootstrap: ${users.length} users, ${teams.length} teams, ${oncalls.length} oncalls`)
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
