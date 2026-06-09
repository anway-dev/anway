import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_active_incidents', description: 'List active incidents', parameters: { type: 'object', properties: { service: { type: 'string', optional: true } } } }, execute: () => Promise.resolve({ incidents: [{ id:'inc-1',title:'Payment failures',severity:'critical',startedAt:new Date().toISOString(),status:'triggered' }] }), write: false },
  { definition: { name: 'get_oncall', description: 'Get oncall engineer', parameters: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] } }, execute: () => Promise.resolve({ engineer: { name:'Alice',email:'alice@acme.dev',phone:'+1-555-0100' } }), write: false },
  { definition: { name: 'create_incident', description: 'Create a new incident', parameters: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string' }, serviceId: { type: 'string' } }, required: ['title', 'severity'] } }, execute: () => Promise.resolve({ id: 'inc-new' }), write: true },
  { definition: { name: 'acknowledge_alert', description: 'Acknowledge an alert', parameters: { type: 'object', properties: { alertId: { type: 'string' } }, required: ['alertId'] } }, execute: () => Promise.resolve({ ok: true }), write: true },
]

export class PagerdutyAgent implements IConnectorAgent {
  readonly connectorType = 'pagerduty'
  readonly tools = TOOLS
}
