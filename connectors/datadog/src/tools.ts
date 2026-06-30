import type { ConnectorQuery } from '@anway/types'
import type { DatadogConnector } from './connector.js'

export function makeDatadogTools(connector: DatadogConnector) {
  const prefix = 'datadog'
  const toolDefs = [
    {
      name: `${prefix}.get_metrics`,
      description: 'Get metrics for a service',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Service name' },
          metric: { type: 'string', description: 'Metric name' },
          from: { type: 'number', description: 'Start time Unix timestamp' },
          to: { type: 'number', description: 'End time Unix timestamp' },
        },
      },
    },
    {
      name: `${prefix}.list_monitors`,
      description: 'List Datadog monitors',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
      },
    },
    {
      name: `${prefix}.get_monitor`,
      description: 'Get details of a Datadog monitor',
      parameters: {
        type: 'object',
        properties: {
          monitor_id: { type: 'string', description: 'Monitor ID' },
        },
      },
    },
    {
      name: `${prefix}.search_logs`,
      description: 'Search Datadog logs',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Log search query' },
          from: { type: 'string', description: 'Start time' },
          to: { type: 'string', description: 'End time' },
        },
      },
    },
    {
      name: `${prefix}.list_dashboards`,
      description: 'List Datadog dashboards',
      parameters: { type: 'object', properties: {} },
    },
  ]

  return toolDefs.map((def) => ({
    ...def,
    async run(args: Record<string, unknown>) {
      const query: ConnectorQuery = { type: def.name.split('.')[1]!, ...args }
      const result = await connector.read(query)
      return result.data
    },
  }))
}
