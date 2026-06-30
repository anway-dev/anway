import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

interface GitHubRepo { id: number; name: string; full_name: string; language?: string; default_branch: string }

export class GitHubBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  private async fetchJson<T>(baseUrl: string, path: string, token: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`)
    return res.json() as Promise<T>
  }

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const token = (payload['token'] as string | undefined) ?? process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN']
    const org = (payload['org'] as string | undefined)
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'https://api.github.com'

    if (!token) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['GitHub bootstrap: token required'] }
    if (!org) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['GitHub bootstrap: org required'] }

    try {
      let repos: GitHubRepo[] = []
      // List repos for the org
      for (let page = 1; page <= 5; page++) {
        const pageRepos = await this.fetchJson<GitHubRepo[]>(baseUrl, `/orgs/${org}/repos?type=source&per_page=100&page=${page}`, token)
        if (!Array.isArray(pageRepos) || pageRepos.length === 0) break
        repos = repos.concat(pageRepos)
        if (pageRepos.length < 100) break
      }

      let entitiesUpserted = 0
      for (const repo of repos) {
        await this.kg.upsertEntity({
          type: 'Repo',
          name: repo.full_name,
          metadata: {
            source: 'github', org, language: repo.language ?? 'unknown',
            defaultBranch: repo.default_branch,
            connectorCoordinates: { github: { connectorType: 'github', resourceIds: { repo: repo.full_name, org }, resolvedAt: new Date().toISOString(), confidence: 1.0 } },
          },
        }, tenantId)
        entitiesUpserted++

        // Try to fetch CODEOWNERS
        try {
          const ownersResp = await this.fetchJson<{ content?: string; encoding?: string }>(baseUrl, `/repos/${org}/${repo.name}/contents/CODEOWNERS`, token)
          if (ownersResp?.content && ownersResp?.encoding === 'base64') {
            const decoded = Buffer.from(ownersResp.content, 'base64').toString('utf-8')
            const teams = new Set<string>()
            for (const line of decoded.split('\n')) {
              const m = line.match(/^\S+\s+(@\S+)/)
              if (m) {
                const team = m[1]!.replace(/^@/, '')
                teams.add(team)
              }
            }
            for (const team of teams) {
              await this.kg.upsertEntity({
                type: 'Team', name: team,
                metadata: { source: 'github', org, repo: repo.name },
              }, tenantId)
              entitiesUpserted++
            }
          }
        } catch { /* CODEOWNERS may not exist */ }
      }

      const hints = [`GitHub bootstrap: ${repos.length} repos indexed`]
      return { entitiesUpserted, relationshipsUpserted: 0, episodeHints: hints }
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['GitHub bootstrap: API call failed'] }
    }
  }
}
