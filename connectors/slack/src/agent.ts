import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'get_channel_history',
      description: 'Get channel messages',
      parameters: {
        type: 'object',
        properties: { channel: { type: 'string' }, limit: { type: 'number', optional: true } },
        required: ['channel'],
      },
    },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).apiKey
      if (!token) throw new Error('Slack API key not configured')
      const baseUrl = typeof creds.baseUrl === 'string' ? creds.baseUrl : 'https://slack.com'
      const channel = encodeURIComponent(String(params.channel))
      const limit = typeof params.limit === 'number' ? params.limit : 20
      const url = `${baseUrl}/api/conversations.history?channel=${channel}&limit=${limit}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Slack conversations.history failed: HTTP ${res.status}`)
      const json = await res.json() as { ok: boolean; messages?: Array<{ type?: string; user?: string; text?: string; ts?: string }>; error?: string }
      if (!json.ok) throw new Error('Slack conversations.history failed: ' + (json.error ?? 'unknown error'))
      return { messages: json.messages ?? [] }
    },
    write: false,
  },
  {
    definition: { name: 'post_message', description: 'Post a message to channel', parameters: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).apiKey
      if (!token) throw new Error('Slack API key not configured')
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channel: String(params.channel), text: String(params.text) }),
      })
      if (!res.ok) throw new Error(`Slack post_message failed: HTTP ${res.status}`)
      const json = await res.json() as { ok: boolean; ts?: string; error?: string }
      if (!json.ok) throw new Error('Slack post_message failed: ' + (json.error ?? 'unknown error'))
      return { ts: json.ts }
    },
    write: true,
  },
]

export class SlackAgent implements IConnectorAgent {
  readonly connectorType = 'slack'
  readonly tools = TOOLS
}
