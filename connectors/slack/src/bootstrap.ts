import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

interface SlackConn { baseUrl: string; token: string }

interface SlackChannel { id: string; name: string }

function connFromPayload(payload: Record<string, unknown>): SlackConn | null {
  const token = payload['token']
  if (typeof token !== 'string') return null
  const baseUrl = typeof payload['baseUrl'] === 'string' ? payload['baseUrl'] : 'https://slack.com'
  return { baseUrl: baseUrl.replace(/\/$/, ''), token }
}

async function slackGet(conn: SlackConn, path: string): Promise<unknown> {
  const res = await fetch(`${conn.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${conn.token}` },
  })
  if (!res.ok) throw new Error(`Slack API ${res.status} for ${path}`)
  return res.json()
}

export class SlackBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const conn = connFromPayload(payload)
    if (!conn) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Slack bootstrap: missing token'] }
    }

    let entitiesUpserted = 0
    const hints: string[] = []

    // Public channels → Team entities (Slack channel ≈ team comms surface).
    // Paginate via Slack's real cursor convention
    // (response_metadata.next_cursor) with a hard budget — confirmed via
    // independent review this fetched one page (limit=200) with no cursor
    // loop, silently truncating any workspace with >200 public channels.
    const MAX_CHANNELS = 2000
    const channels: SlackChannel[] = []
    let truncated = false
    let cursor = ''
    for (;;) {
      const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      const resp = await slackGet(conn, `/api/conversations.list?types=public_channel&limit=200${cursorParam}`) as {
        channels?: SlackChannel[]
        response_metadata?: { next_cursor?: string }
      }
      channels.push(...(resp.channels ?? []))
      cursor = resp.response_metadata?.next_cursor ?? ''
      if (!cursor) break
      if (channels.length >= MAX_CHANNELS) { truncated = true; break }
    }
    for (const channel of channels) {
      await this.kg.upsertEntity({
        type: 'Team',
        name: channel.name,
        metadata: {
          externalId: channel.id,
          source: 'slack',
          connectorCoordinates: { slack: { resourceIds: { channelId: channel.id, channelName: channel.name } } },
        },
      }, tenantId)
      entitiesUpserted++
      hints.push(`Slack channel #${channel.name}`)
    }

    hints.push(`Slack bootstrap: ${channels.length} public channels`)
    if (truncated) hints.push(`Slack bootstrap: TRUNCATED at ${MAX_CHANNELS} channels — graph is partial`)
    return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: hints }
  }
}
