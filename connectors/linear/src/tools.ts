import type { ConnectorQuery } from '@anvay/types'
import type { LinearConnector } from './connector.js'

export function makeLinearTools(connector: LinearConnector) {
  const prefix = 'linear'
  const toolDefs = [
    {
      name: `${prefix}.list_issues`,
      description: 'List issues in a Linear team',
      parameters: {
        type: 'object',
        properties: {
          team: { type: 'string', description: 'Team name' },
          filters: { type: 'string', description: 'Additional filter criteria' },
        },
      },
    },
    {
      name: `${prefix}.get_issue`,
      description: 'Get details of a Linear issue',
      parameters: {
        type: 'object',
        properties: {
          issue_id: { type: 'string', description: 'Issue ID' },
        },
      },
    },
    {
      name: `${prefix}.list_projects`,
      description: 'List projects in a Linear team',
      parameters: {
        type: 'object',
        properties: {
          team: { type: 'string', description: 'Team name' },
        },
      },
    },
    {
      name: `${prefix}.get_project`,
      description: 'Get details of a Linear project',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID' },
        },
      },
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
