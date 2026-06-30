import type { ConnectorQuery } from '@anway/types'
import type { ArgoCDConnector } from './connector.js'

export function makeArgoCDTools(connector: ArgoCDConnector) {
  const prefix = 'argocd'
  const toolDefs = [
    {
      name: `${prefix}.list_applications`,
      description: 'List ArgoCD applications',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: `${prefix}.get_application`,
      description: 'Get details of an ArgoCD application',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name' } } },
    },
    {
      name: `${prefix}.get_sync_status`,
      description: 'Get sync and health status of an ArgoCD application',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name' } } },
    },
    {
      name: `${prefix}.get_application_history`,
      description: 'Get deployment history of an ArgoCD application',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name' } } },
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
