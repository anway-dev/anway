import type { ConnectorQuery } from '@anway/types'
import type { GitHubConnector } from './connector.js'

export function makeGitHubTools(connector: GitHubConnector) {
  const prefix = 'github'

  const toolDefs = [
    {
      name: `${prefix}.list_prs`,
      description: 'List pull requests in a GitHub repository',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name (e.g. owner/repo)' },
          state: { type: 'string', enum: ['open', 'closed', 'merged', 'all'], default: 'open' },
          limit: { type: 'number', default: 20 },
        },
      },
    },
    {
      name: `${prefix}.get_pr`,
      description: 'Get details of a specific pull request',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name' },
          number: { type: 'string', description: 'PR number' },
        },
      },
    },
    {
      name: `${prefix}.list_commits`,
      description: 'List commits on a branch',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name' },
          branch: { type: 'string', description: 'Branch name', default: 'main' },
          since: { type: 'string', description: 'ISO date string to filter commits after' },
        },
      },
    },
    {
      name: `${prefix}.get_workflow_run`,
      description: 'Get details of a GitHub Actions workflow run',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name' },
          run_id: { type: 'string', description: 'Workflow run ID' },
        },
      },
    },
    {
      name: `${prefix}.search_code`,
      description: 'Search code in a repository',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name' },
          query: { type: 'string', description: 'Search query' },
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
