import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class OpsGenieBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly apiKey?: string,
    private readonly baseUrl?: string,
  ) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? this.baseUrl ?? 'https://api.opsgenie.com'
    const apiKey = (payload['apiKey'] as string | undefined) ?? this.apiKey ?? process.env['OPSGENIE_API_KEY']
    if (!apiKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['opsgenie: no credentials configured'] }
    }

    const headers: Record<string, string> = {
      Authorization: `GenieKey ${apiKey}`,
      'Content-Type': 'application/json',
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0

    // Fetch teams. Real failure (non-OK) throws — a real API/auth outage
    // must not look identical to "this org just has no teams configured".
    const teamResp = await fetch(`${baseUrl}/v2/teams`, { headers })
    if (!teamResp.ok) throw new Error(`OpsGenie bootstrap: teams fetch failed HTTP ${teamResp.status}`)
    const teams = (await teamResp.json() as { data?: Array<{ id: string; name: string }> }).data ?? []
    for (const t of teams) {
      await this.kg.upsertEntity({
        type: 'Team', name: t.name,
        metadata: { externalId: t.id, connectorCoordinates: { opsgenie: { resourceIds: { teamId: t.id, teamName: t.name } } } },
      }, tenantId)
      entitiesUpserted++
    }

    // Fetch schedules (on-call). Same real-failure-throws reasoning as teams.
    const schedResp = await fetch(`${baseUrl}/v2/schedules`, { headers })
    if (!schedResp.ok) throw new Error(`OpsGenie bootstrap: schedules fetch failed HTTP ${schedResp.status}`)
    const schedules = (await schedResp.json() as { data?: Array<{ id: string; name: string; ownerTeam?: { id: string; name: string } }> }).data ?? []
    for (const s of schedules) {
      // Per-schedule on-call lookup is allowed to fail without aborting the
      // whole bootstrap (many schedules; one bad one shouldn't cost the
      // rest) — same documented-optional-enrichment pattern used elsewhere
      // this session (e.g. gcp-monitoring's alpha incidents call).
      try {
        const oncallResp = await fetch(`${baseUrl}/v2/schedules/${s.id}/on-calls?scheduleIdentifierType=id`, { headers })
        if (!oncallResp.ok) continue
        const onCalls = (await oncallResp.json() as { data?: Array<{ onCallRecipients?: string[] }> }).data ?? []
        for (const oc of onCalls) {
          for (const recipient of (oc.onCallRecipients ?? [])) {
            const engId = await this.kg.upsertEntity({
              type: 'Engineer', name: recipient,
              metadata: { connectorCoordinates: { opsgenie: { resourceIds: { scheduleId: s.id } } } },
            }, tenantId)
            entitiesUpserted++
            if (s.ownerTeam) {
              const teamId = await this.kg.upsertEntity({
                type: 'Team', name: s.ownerTeam.name,
                metadata: { externalId: s.ownerTeam.id },
              }, tenantId)
              // Confirmed live via independent review (connector bootstrap
              // audit): this real ONCALL edge (correctly using real
              // upsertEntity-returned ids, unlike PagerDuty's bug) was
              // still undercounted — the final return hardcoded
              // relationshipsUpserted: 0 regardless of how many edges were
              // actually created here.
              await this.kg.upsertRelationship(
                { fromEntityId: teamId, relType: 'ONCALL', toEntityId: engId },
                tenantId,
              ).then(() => { relationshipsUpserted++ }).catch(() => {})
            }
          }
        }
      } catch { /* per-schedule error, continue */ }
    }

    return {
      entitiesUpserted,
      relationshipsUpserted,
      episodeHints: entitiesUpserted > 0 ? [`opsgenie: bootstrapped ${entitiesUpserted} entities`] : ['opsgenie: no entities found'],
    }
  }
}
