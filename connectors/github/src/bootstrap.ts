import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileAsync = promisify(execFile)

export class GitHubBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly token: string,
  ) {}

  async runGh<T>(args: string[]): Promise<T | null> {
    try {
      const result = await execFileAsync('gh', args, {
        env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin', GH_TOKEN: this.token },
        timeout: 15_000,
      })
      return JSON.parse(result.stdout) as T
    } catch {
      return null
    }
  }

  async fetchCODEOWNERS(org: string, repo: string): Promise<string | null> {
    try {
      const result = await execFileAsync('gh', ['api', `/repos/${org}/${repo}/contents/CODEOWNERS`, '--jq', '.content'], {
        env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin', GH_TOKEN: this.token },
        timeout: 10_000,
      })
      // execFileAsync throws on non-zero exit — no status check needed
      return Buffer.from(result.stdout.trim(), 'base64').toString('utf-8')
    } catch {
      return null
    }
  }

  async bootstrap(tenantId: TenantId, connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const org = payload['org'] as string | undefined
    if (!org) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [] }

    const repos = await this.runGh<Array<{ name: string; defaultBranchRef?: { name: string }; languages: { node: { name: string } }[] }>>([
      'repo', 'list', org,
      '--json', 'name,defaultBranchRef,languages',
      '--limit', '100',
    ])
    if (!repos) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [] }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0

    for (const repo of repos) {
      // Upsert Repo entity
      const repoId = await this.kg.upsertEntity({
        type: 'Repo',
        name: `${org}/${repo.name}`,
        metadata: { defaultBranch: repo.defaultBranchRef?.name ?? 'main', org },
      }, tenantId)
      entitiesUpserted++

      // Upsert Service entity (service name = repo name without org)
      const svcId = await this.kg.upsertEntity({
        type: 'Service',
        name: repo.name,
        metadata: { connectorCoordinates: { github: { resourceIds: { repo: `${org}/${repo.name}` } } } },
      }, tenantId)
      entitiesUpserted++

      // Upsert Service→HOSTED_IN→Repo
      await this.kg.upsertRelationship({ fromEntityId: svcId, relType: 'HOSTED_IN', toEntityId: repoId, metadata: {} }, tenantId)
      relationshipsUpserted++

      // Fetch CODEOWNERS
      const codeowners = await this.fetchCODEOWNERS(org, repo.name)
      if (!codeowners) continue

      // Parse CODEOWNERS lines — extract @team and @user entries
      const teamSet = new Set<string>()
      const userSet = new Set<string>()
      for (const line of codeowners.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue
        // Skip file path component, extract owners
        const parts = trimmed.split(/\s+/)
        for (const p of parts) {
          if (p.startsWith('@')) {
            const name = p.slice(1)
            if (name.includes('/')) teamSet.add(name)       // org/team-name
            else userSet.add(name)                            // username
          }
        }
      }

      for (const teamName of teamSet) {
        const teamId = await this.kg.upsertEntity({
          type: 'Team',
          name: teamName,
          metadata: { connectorCoordinates: { github: { resourceIds: { team: teamName } } } },
        }, tenantId)
        entitiesUpserted++
        // Upsert Service→OWNED_BY→Team
        await this.kg.upsertRelationship({ fromEntityId: svcId, relType: 'OWNED_BY', toEntityId: teamId, metadata: {} }, tenantId)
        relationshipsUpserted++
      }

      for (const userName of userSet) {
        const engId = await this.kg.upsertEntity({
          type: 'Engineer',
          name: userName,
          metadata: {},
        }, tenantId)
        entitiesUpserted++
        // Find the first team and create Engineer→MEMBER_OF→Team
        if (teamSet.size > 0) {
          const firstTeam = teamSet.values().next().value!
          // Lookup team entity id — reuse team upsert from above
          const teamId = await this.kg.upsertEntity({
            type: 'Team',
            name: firstTeam,
            metadata: { connectorCoordinates: { github: { resourceIds: { team: firstTeam } } } },
          }, tenantId)
          entitiesUpserted++
          await this.kg.upsertRelationship({ fromEntityId: engId, relType: 'MEMBER_OF', toEntityId: teamId, metadata: {} }, tenantId)
          relationshipsUpserted++
        }
      }
    }

    return { entitiesUpserted, relationshipsUpserted, episodeHints: [`Bootstrapped ${repos.length} repos from ${org} with CODEOWNERS teams and users`] }
  }
}
