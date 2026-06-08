import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'
import { spawnSync } from 'child_process'

export class GitHubBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly token: string,
  ) {}

  async bootstrap(tenantId: TenantId, connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const org = payload['org'] as string | undefined
    if (!org) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [] }

    // List repos in org via gh CLI
    const result = spawnSync('gh', [
      'repo', 'list', org,
      '--json', 'name,defaultBranchRef,languages',
      '--limit', '100',
    ], {
      env: { ...process.env, GH_TOKEN: this.token },
      encoding: 'utf-8',
    })

    if (result.status !== 0) return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [] }

    let repos: { name: string; defaultBranchRef?: { name: string }; languages: { node: { name: string } }[] }[]
    try {
      repos = JSON.parse(result.stdout)
    } catch {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: [] }
    }

    let entitiesUpserted = 0
    const relationshipsUpserted = 0

    for (const repo of repos) {
      await this.kg.upsertEntity({
        type: 'Repo',
        name: `${org}/${repo.name}`,
        metadata: { defaultBranch: repo.defaultBranchRef?.name ?? 'main', org },
      }, tenantId)
      entitiesUpserted++
    }

    return { entitiesUpserted, relationshipsUpserted, episodeHints: [`Bootstrapped ${repos.length} repos from ${org}`] }
  }
}
