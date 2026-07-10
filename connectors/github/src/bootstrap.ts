import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

interface GitHubRepo { id: number; name: string; full_name: string; language?: string; default_branch: string }
interface GitHubContributor { login: string; contributions: number }
interface GitHubTeamMember { login: string }

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
      let reposTruncated = false
      // List repos for the org — paginate with a hard budget (10 pages =
      // 1000 repos); when the budget truncates, report it in episodeHints
      // below instead of silently serving a partial graph.
      const MAX_REPO_PAGES = 10
      for (let page = 1; ; page++) {
        // 'sources' (plural) per the official API spec — the Prism contract
        // test (real Actions run 29090846170) rejected 'source' with 422.
        const pageRepos = await this.fetchJson<GitHubRepo[]>(baseUrl, `/orgs/${org}/repos?type=sources&per_page=100&page=${page}`, token)
        if (!Array.isArray(pageRepos) || pageRepos.length === 0) break
        repos = repos.concat(pageRepos)
        if (pageRepos.length < 100) break
        if (page >= MAX_REPO_PAGES) { reposTruncated = true; break }
      }

      let entitiesUpserted = 0
      let relationshipsUpserted = 0
      // Real team-membership edges only need to be resolved once per team,
      // not once per repo that references it (CODEOWNERS commonly repeats
      // the same team across many paths/files).
      const resolvedTeams = new Set<string>()

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

        // Real committers — confirmed live via independent review that
        // CLAUDE.md documents this connector extracting
        // "Engineer (committers)" but no code ever created an Engineer
        // entity at all. Contributors API needs only the same repo-read
        // scope already required for the rest of this bootstrap.
        try {
          const contributors = await this.fetchJson<GitHubContributor[]>(
            baseUrl, `/repos/${org}/${repo.name}/contributors?per_page=100`, token,
          )
          if (Array.isArray(contributors)) {
            for (const c of contributors) {
              if (!c.login) continue
              await this.kg.upsertEntity({
                type: 'Engineer', name: c.login,
                metadata: { source: 'github', org },
              }, tenantId)
              entitiesUpserted++
            }
          }
        } catch { /* contributors may be empty/unavailable for an empty repo */ }

        // Try to fetch CODEOWNERS
        try {
          const ownersResp = await this.fetchJson<{ content?: string; encoding?: string }>(baseUrl, `/repos/${org}/${repo.name}/contents/CODEOWNERS`, token)
          if (ownersResp?.content && ownersResp?.encoding === 'base64') {
            const decoded = Buffer.from(ownersResp.content, 'base64').toString('utf-8')
            // Real CODEOWNERS syntax mixes team refs (@org/team-slug) and
            // individual reviewer refs (@username) on the same line —
            // confirmed live via independent review that the previous
            // regex treated every @-mention as a Team, so a CODEOWNERS
            // file listing an individual reviewer (a very common pattern)
            // created a bogus Team entity named after that person. Only a
            // "/"-qualified ref is a real GitHub team.
            const teamSlugs = new Set<string>()
            for (const line of decoded.split('\n')) {
              const trimmed = line.trim()
              if (!trimmed || trimmed.startsWith('#')) continue
              const mentions = trimmed.match(/@[\w-]+\/[\w-]+/g) ?? []
              for (const mention of mentions) {
                teamSlugs.add(mention.replace(/^@/, ''))
              }
            }
            for (const teamSlug of teamSlugs) {
              const teamName = teamSlug.split('/')[1]!
              await this.kg.upsertEntity({
                type: 'Team', name: teamName,
                metadata: { source: 'github', org, repo: repo.name },
              }, tenantId)
              entitiesUpserted++

              // Engineer -[:MEMBER_OF]-> Team — real team membership from
              // GitHub's Teams API, resolved once per distinct team.
              if (!resolvedTeams.has(teamSlug)) {
                resolvedTeams.add(teamSlug)
                try {
                  const members = await this.fetchJson<GitHubTeamMember[]>(
                    baseUrl, `/orgs/${org}/teams/${teamName}/members?per_page=100`, token,
                  )
                  if (Array.isArray(members)) {
                    for (const member of members) {
                      if (!member.login) continue
                      const engId = await this.kg.upsertEntity({
                        type: 'Engineer', name: member.login,
                        metadata: { source: 'github', org },
                      }, tenantId)
                      entitiesUpserted++
                      const teamId = await this.kg.upsertEntity({
                        type: 'Team', name: teamName,
                        metadata: { source: 'github', org },
                      }, tenantId)
                      await this.kg.upsertRelationship({
                        fromEntityId: engId, relType: 'MEMBER_OF', toEntityId: teamId,
                      }, tenantId)
                      relationshipsUpserted++
                    }
                  }
                } catch { /* team membership requires org read scope — may not be granted */ }
              }
            }
          }
        } catch { /* CODEOWNERS may not exist */ }
      }

      const hints = [`GitHub bootstrap: ${repos.length} repos indexed`]
      if (reposTruncated) hints.push(`GitHub bootstrap: TRUNCATED at ${MAX_REPO_PAGES * 100} repos — graph is partial`)
      return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
    } catch (err) {
      // Same swallow-everything bug fixed across 17 other connectors this
      // session, still present here in the single most important one: an
      // invalid/expired token reported a plausible "API call failed" empty
      // SUCCESS, indistinguishable from an org with no repos. Real
      // failures must throw so graph-builder records bootstrap_failed.
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`GitHub bootstrap failed: ${msg}`)
    }
  }
}
