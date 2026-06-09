import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_channel_history', description: 'Get channel messages', parameters: { type: 'object', properties: { channel: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['channel'] } }, execute: () => Promise.resolve({ messages: [{ user:'U123',text:'Deploy complete',ts:'1234567890.123' }] }), write: false },
  { definition: { name: 'post_message', description: 'Post a message to channel', parameters: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } }, execute: () => Promise.resolve({ ts: '1234567890.456' }), write: true },
]

export class SlackAgent implements IConnectorAgent {
  readonly connectorType = 'slack'
  readonly tools = TOOLS
}
