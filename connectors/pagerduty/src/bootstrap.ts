import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

const PD_API = 'https://api.pagerduty.com'

export class PagerDutyBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(_tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const apiKey = (payload['token'] ?? payload['apiKey'] ?? process.env['PAGERDUTY_API_KEY']) as string | undefined
    if (!apiKey) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['PagerDuty bootstrap: no API key configured'] }

    try {
      // Fetch services
      const svcResp = await fetch(`${PD_API}/services?limit=100`, {
        headers: { Authorization: `Token token=${apiKey}`, Accept: 'application/vnd.pagerduty+json;version=2' },
      })
      const services = svcResp.ok ? (await svcResp.json() as { services?: Array<{ id: string; name: string; description?: string }> }).services ?? [] : []

      // Fetch teams (for oncall)
      const teamResp = await fetch(`${PD_API}/teams?limit=100`, {
        headers: { Authorization: `Token token=${apiKey}`, Accept: 'application/vnd.pagerduty+json;version=2' },
      })
      const teams = teamResp.ok ? (await teamResp.json() as { teams?: Array<{ id: string; name: string }> }).teams ?? [] : []

      // Fetch oncalls
      const oncallsResp = await fetch(`${PD_API}/oncalls?include[]=users&limit=100`, {
        headers: { Authorization: `Token token=${apiKey}`, Accept: 'application/vnd.pagerduty+json;version=2' },
      })
      const oncalls = oncallsResp.ok ? (await oncallsResp.json() as { oncalls?: Array<{ user?: { id: string; name: string; email: string }; escalation_policy?: { id: string; summary: string } }> }).oncalls ?? [] : []

      // Upsert Service entities
      for (const svc of services) {
        await this.kg.upsertEntity({
          id: `pd-svc-${svc.id}`, type: 'Service', name: svc.name, tenantId: _tenantId,
          metadata: { source: 'pagerduty', externalId: svc.id, description: svc.description },
        })
      }

      // Upsert Team entities
      for (const team of teams) {
        await this.kg.upsertEntity({
          id: `pd-team-${team.id}`, type: 'Team', name: team.name, tenantId: _tenantId,
          metadata: { source: 'pagerduty', externalId: team.id },
        })
      }

      // Upsert Engineer entities from oncalls
      for (const oc of oncalls) {
        if (oc.user) {
          await this.kg.upsertEntity({
            id: `pd-eng-${oc.user.id}`, type: 'Engineer', name: oc.user.name, tenantId: _tenantId,
            metadata: { source: 'pagerduty', email: oc.user.email },
          })
        }
      }

      return { entitiesUpserted: services.length + teams.length + oncalls.length, relationshipsUpserted: 0 }
    } catch (err) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [`PagerDuty bootstrap failed: ${String(err)}`] }
    }
  }
}
