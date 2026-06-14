import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

const OPSGENIE_API = 'https://api.opsgenie.com'

export class OpsGenieBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly apiKey?: string,
    private readonly baseUrl?: string,
  ) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const apiKey = (payload['apiKey'] as string | undefined) ?? this.apiKey
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? this.baseUrl ?? OPSGENIE_API
    if (!apiKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['opsgenie: no credentials configured'] }
    }

    const headers: Record<string, string> = {
      Authorization: `GenieKey ${apiKey}`,
      'Content-Type': 'application/json',
    }

    let entitiesUpserted = 0

    // Fetch teams
    const teamResp = await fetch(`${baseUrl}/v2/teams`, { headers })
    if (teamResp.ok) {
      const teams = (await teamResp.json() as { data?: Array<{ id: string; name: string }> }).data ?? []
      for (const t of teams) {
        await this.kg.upsertEntity({
          type: 'Team', name: t.name,
          metadata: { externalId: t.id, connectorCoordinates: { opsgenie: { resourceIds: { teamId: t.id, teamName: t.name } } } },
        }, tenantId)
        entitiesUpserted++
      }
    }

    // Fetch schedules (on-call)
    const schedResp = await fetch(`${baseUrl}/v2/schedules`, { headers })
    if (schedResp.ok) {
      const schedules = (await schedResp.json() as { data?: Array<{ id: string; name: string; ownerTeam?: { id: string; name: string } }> }).data ?? []
      for (const s of schedules) {
        // Try to fetch current on-call
        try {
          const oncallResp = await fetch(`${baseUrl}/v2/schedules/${s.id}/on-calls?scheduleIdentifierType=id`, { headers })
          if (oncallResp.ok) {
            const onCalls = (await oncallResp.json() as { data?: Array<{ onCallRecipients?: string[] }> }).data ?? []
            for (const oc of onCalls) {
              for (const recipient of (oc.onCallRecipients ?? [])) {
                await this.kg.upsertEntity({
                  type: 'Engineer', name: recipient,
                  metadata: { connectorCoordinates: { opsgenie: { resourceIds: { scheduleId: s.id } } } },
                }, tenantId)
                entitiesUpserted++
                if (s.ownerTeam) {
                  const teamId = await this.kg.upsertEntity({
                    type: 'Team', name: s.ownerTeam.name,
                    metadata: { externalId: s.ownerTeam.id },
                  }, tenantId)
                  const engId = await this.kg.upsertEntity({
                    type: 'Engineer', name: recipient,
                  }, tenantId)
                  await this.kg.upsertRelationship(
                    { fromEntityId: teamId, relType: 'ONCALL', toEntityId: engId },
                    tenantId,
                  ).catch(() => {})
                }
              }
            }
          }
        } catch { /* per-schedule error, continue */ }
      }
    }

    return {
      entitiesUpserted,
      relationshipsUpserted: 0,
      episodeHints: entitiesUpserted > 0 ? [`opsgenie: bootstrapped ${entitiesUpserted} entities`] : ['opsgenie: no entities found'],
    }
  }
}
