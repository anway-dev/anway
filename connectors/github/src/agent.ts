import { spawnSync } from 'node:child_process'
import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


function ghConfig(creds: Record<string, unknown>): { baseUrl: string; authHeader: string; apiPrefix: string; token: string } {
  const token = (creds as ConnectorCreds).token ?? ''
  const baseUrl = (creds as ConnectorCreds).baseUrl ?? 'https://api.github.com'
  const isGitea = baseUrl.includes('gitea') || baseUrl.includes(':3000')
  return { token, baseUrl, authHeader: isGitea ? `token ${token}` : `Bearer ${token}`, apiPrefix: isGitea ? '/api/v1' : '' }
}

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_prs', description: 'List pull requests', parameters: { type: 'object', properties: { repo: { type: 'string' }, state: { type: 'string', optional: true }, limit: { type: 'number', optional: true } }, required: ['repo'] } },
    execute: async (params, creds) => {
      const { token, baseUrl, authHeader, apiPrefix } = ghConfig(creds)
      if (!token) return { prs: [] }
      const res = await fetch(`${baseUrl}${apiPrefix}/repos/${params.repo}/pulls?state=${params.state ?? 'open'}&limit=${params.limit ?? 10}`, { headers: { Authorization: authHeader } })
      if (!res.ok) return { prs: [], error: `API ${res.status}` }
      const prs = await res.json() as Array<{ number: number; title: string; state: string; user: { login: string }; merged_at: string | null; head: { sha: string } }>
      return { prs: prs.map(p => ({ id: p.number, title: p.title, state: p.state, author: p.user.login, mergedAt: p.merged_at, sha: p.head.sha })) }
    },
    write: false,
  },
  {
    definition: { name: 'get_commits', description: 'List commits', parameters: { type: 'object', properties: { repo: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['repo'] } },
    execute: async (params, creds) => {
      const { token, baseUrl, authHeader, apiPrefix } = ghConfig(creds)
      if (!token) return { commits: [] }
      const res = await fetch(`${baseUrl}${apiPrefix}/repos/${params.repo}/commits?limit=${params.limit ?? 10}`, { headers: { Authorization: authHeader } })
      if (!res.ok) return { commits: [], error: `API ${res.status}` }
      const commits = await res.json() as Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>
      return { commits: commits.map(c => ({ sha: c.sha, message: c.commit.message, author: c.commit.author.name, date: c.commit.author.date })) }
    },
    write: false,
  },
  {
    definition: { name: 'get_file', description: 'Get file content', parameters: { type: 'object', properties: { repo: { type: 'string' }, path: { type: 'string' }, ref: { type: 'string', optional: true } }, required: ['repo', 'path'] } },
    execute: async (params, creds) => {
      const { token, baseUrl, authHeader, apiPrefix } = ghConfig(creds)
      if (!token) return { content: '' }
      const ref = params.ref ? `?ref=${params.ref}` : ''
      const res = await fetch(`${baseUrl}${apiPrefix}/repos/${params.repo}/contents/${params.path}${ref}`, { headers: { Authorization: authHeader } })
      if (!res.ok) return { content: '', error: `API ${res.status}` }
      const data = await res.json() as { content?: string; encoding?: string }
      if (data.encoding === 'base64' && data.content) return { content: Buffer.from(data.content, 'base64').toString('utf-8') }
      return { content: data.content ?? '' }
    },
    write: false,
  },
  {
    definition: { name: 'create_pr', description: 'Create a pull request', parameters: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string', optional: true }, base: { type: 'string' }, head: { type: 'string' } }, required: ['repo', 'title', 'base', 'head'] } },
    execute: async (params, creds) => {
      const token = (creds as ConnectorCreds).token ?? process.env['GH_TOKEN'] ?? ''
      const result = spawnSync('gh', [
        'pr', 'create',
        '--repo', String(params.repo),
        '--title', String(params.title),
        '--body', String(params.body ?? ''),
        '--base', String(params.base ?? 'main'),
        '--head', String(params.head),
      ], {
        env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin', GH_TOKEN: token },
        encoding: 'utf-8',
        timeout: 30_000,
      })
      if (result.status !== 0) throw new Error(result.stderr || 'gh pr create failed')
      return { url: result.stdout.trim(), ok: true }
    },
    write: true,
  },
]

export class GithubAgent implements IConnectorAgent {
  readonly connectorType = 'github'
  readonly tools = TOOLS
}
