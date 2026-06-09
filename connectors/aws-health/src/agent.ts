import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_cloud_metrics', description: 'Fetch cloud metrics', parameters: { type: 'object', properties: { resource: { type: 'string' }, metric: { type: 'string' }, window: { type: 'string' } }, required: ['resource', 'metric', 'window'] } }, execute: () => Promise.resolve({ points: [{ t: Date.now(), v: 0.5 }] }), write: false },
  { definition: { name: 'get_alarms', description: 'List alarms', parameters: { type: 'object', properties: { service: { type: 'string', optional: true } } } }, execute: () => Promise.resolve({ alarms: [{ id:'al-1',name:'High CPU',state:'ALARM',reason:'CPU > 90%' }] }), write: false },
  { definition: { name: 'get_health_events', description: 'Get service health events', parameters: { type: 'object', properties: { } } }, execute: () => Promise.resolve({ events: [{ service:'EC2',region:'us-east-1',status:'RESOLVED',message:'Network issue resolved' }] }), write: false },
]

export class AwsHealthAgent implements IConnectorAgent {
  readonly connectorType = 'aws-health'
  readonly tools = TOOLS
}
