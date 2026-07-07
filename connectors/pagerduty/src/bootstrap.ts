import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

interface PdConn { baseUrl: string; token: string }

interface PdUser { id: string; name: string; email: string }
interface PdTeam { id: string; name: string }
interface PdOncall {
  user?: { id: string; summary: string }
  escalation_policy?: { id: string; summary: string }
}
interface PdEscalationPolicy {
  teams?: Array<{ id: string; summary: string }>
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

    // 1. Users → Engineer entities. Capture the REAL entity id upsertEntity
    // returns, keyed by PagerDuty's own user id — confirmed live via
    // independent review that the ONCALL relationship below previously used
    // fabricated string IDs (`Engineer:${summary}`) instead of these real
    // ids. Against the real StructuralGraph, upsertEntity returns a random
    // UUID (not `${type}:${name}`), so every ONCALL edge pointed at a
    // non-existent entity — silently broken in production, masked in tests
    // only because FakeKnowledgeGraph's test double happens to return
    // exactly `${type}:${name}` as its id.
    const engineerIdByPdUserId = new Map<string, string>()
    const usersResp = await pdGet(conn, '/users?limit=100') as { users?: PdUser[] }
    const users = usersResp.users ?? []
    for (const user of users) {
      const engineerId = await this.kg.upsertEntity({
        type: 'Engineer',
        name: user.name,
        metadata: {
          externalId: user.id,
          email: user.email,
          source: 'pagerduty',
          connectorCoordinates: { pagerduty: { resourceIds: { userId: user.id } } },
        },
      }, tenantId)
      engineerIdByPdUserId.set(user.id, engineerId)
      entitiesUpserted++
      hints.push(`PagerDuty engineer ${user.name}`)
    }

    // 2. Teams → Team entities. Same real-id capture as above.
    const teamIdByPdTeamId = new Map<string, string>()
    const teamsResp = await pdGet(conn, '/teams?limit=100') as { teams?: PdTeam[] }
    const teams = teamsResp.teams ?? []
    for (const team of teams) {
      const teamId = await this.kg.upsertEntity({
        type: 'Team',
        name: team.name,
        metadata: {
          externalId: team.id,
          source: 'pagerduty',
          connectorCoordinates: { pagerduty: { resourceIds: { teamId: team.id } } },
        },
      }, tenantId)
      teamIdByPdTeamId.set(team.id, teamId)
      entitiesUpserted++
      hints.push(`PagerDuty team ${team.name}`)
    }

    // 3. Oncalls → Team ONCALL Engineer. PagerDuty's /oncalls response does
    // not include team info directly — only a lightweight escalation_policy
    // reference (id + summary). The real team association lives on the
    // escalation policy itself (`GET /escalation_policies/{id}` returns a
    // `teams` array) — confirmed live via independent review that the
    // previous code used `escalation_policy.summary` as if it WERE a team
    // name, which is conceptually wrong (an escalation policy is not a
    // team, though one commonly maps to one or more). Resolved properly
    // here, with each distinct escalation policy fetched at most once.
    const teamsByEscalationPolicyId = new Map<string, PdEscalationPolicy['teams']>()
    const oncallsResp = await pdGet(conn, '/oncalls?limit=100') as { oncalls?: PdOncall[] }
    const oncalls = oncallsResp.oncalls ?? []
    for (const oncall of oncalls) {
      const pdUserId = oncall.user?.id
      const epId = oncall.escalation_policy?.id
      if (!pdUserId || !epId) continue
      const engineerId = engineerIdByPdUserId.get(pdUserId)
      if (!engineerId) continue

      if (!teamsByEscalationPolicyId.has(epId)) {
        try {
          const epResp = await pdGet(conn, `/escalation_policies/${epId}`) as { escalation_policy?: PdEscalationPolicy }
          teamsByEscalationPolicyId.set(epId, epResp.escalation_policy?.teams ?? [])
        } catch {
          // A single escalation policy failing to resolve shouldn't abort
          // the whole bootstrap — real primary data (users, teams) already
          // succeeded above; this only affects how many ONCALL edges we can
          // draw.
          teamsByEscalationPolicyId.set(epId, [])
        }
      }
      const epTeams = teamsByEscalationPolicyId.get(epId) ?? []

      for (const epTeam of epTeams) {
        const teamId = teamIdByPdTeamId.get(epTeam.id)
        if (!teamId) continue // team referenced by the policy but not in our /teams listing — skip rather than fabricate
        await this.kg.upsertRelationship({
          fromEntityId: teamId,
          relType: 'ONCALL',
          toEntityId: engineerId,
        }, tenantId)
        relationshipsUpserted++
      }
    }

    hints.push(`PagerDuty bootstrap: ${users.length} users, ${teams.length} teams, ${oncalls.length} oncalls`)
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
