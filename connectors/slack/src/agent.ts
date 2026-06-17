import type { ConnectorCreds } from '@anvay/types'
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'


const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_channel_history', description: 'Get channel messages', parameters: { type: 'object', properties: { channel: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['channel'] } }, execute: () => Promise.resolve({ messages: [{ user:'U123',text:'Deploy complete',ts:'1234567890.123' }] }), write: false },
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
