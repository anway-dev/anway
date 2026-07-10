import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

interface JenkinsConn { baseUrl: string; user?: string; apiToken?: string }

interface JenkinsBuild { number: number; result?: string; timestamp?: number }
interface JenkinsJob { name: string; url: string; lastBuild?: JenkinsBuild }

// user/apiToken optional PAIR — anonymous-read Jenkins instances are real
// (verified live against ci.jenkins.io). Same contract as agent.ts.
function connFromPayload(payload: Record<string, unknown>): JenkinsConn | null {
  const baseUrl = payload['baseUrl']
  const user = payload['user']
  const apiToken = payload['apiToken']
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return null
  const hasUser = typeof user === 'string' && user.length > 0
  const hasToken = typeof apiToken === 'string' && apiToken.length > 0
  if (hasUser !== hasToken) return null
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    ...(hasUser ? { user: user as string, apiToken: apiToken as string } : {}),
  }
}

async function jenkinsGet(conn: JenkinsConn, path: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (conn.user && conn.apiToken) {
    headers['Authorization'] = `Basic ${Buffer.from(`${conn.user}:${conn.apiToken}`).toString('base64')}`
  }
  const res = await fetch(`${conn.baseUrl}${path}`, { headers })
  if (!res.ok) throw new Error(`Jenkins API ${res.status} for ${path}`)
  return res.json()
}

export class JenkinsBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const conn = connFromPayload(payload)
    if (!conn) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Jenkins bootstrap: missing baseUrl (or user without apiToken)'] }
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0
    const hints: string[] = []

    const resp = await jenkinsGet(
      conn,
      '/api/json?tree=jobs[name,url,lastBuild[number,result,timestamp]]',
    ) as { jobs?: JenkinsJob[] }
    const jobs = resp.jobs ?? []

    for (const job of jobs) {
      // Job → Pipeline entity. Confirmed live via independent review:
      // upsertRelationship casts fromEntityId/toEntityId to ::uuid, but
      // this previously passed fabricated `Deploy:${name}` /
      // `Pipeline:${name}` strings, which threw on the very first real
      // build. upsertEntity's return value is the real entity UUID and
      // must be captured instead.
      const pipelineId = await this.kg.upsertEntity({
        type: 'Pipeline',
        name: job.name,
        metadata: {
          url: job.url,
          provider: 'jenkins',
          source: 'jenkins',
          connectorCoordinates: { jenkins: { resourceIds: { jobName: job.name, jobUrl: job.url } } },
        },
      }, tenantId)
      entitiesUpserted++
      hints.push(`Jenkins pipeline ${job.name}`)

      // Last build → Deploy entity + DEPLOYED_TO relationship
      if (job.lastBuild) {
        const deployName = `${job.name}#${job.lastBuild.number}`
        const deployId = await this.kg.upsertEntity({
          type: 'Deploy',
          name: deployName,
          metadata: {
            result: job.lastBuild.result,
            source: 'jenkins',
            connectorCoordinates: { jenkins: { resourceIds: { jobName: job.name, build: String(job.lastBuild.number) } } },
          },
        }, tenantId)
        entitiesUpserted++

        await this.kg.upsertRelationship({
          fromEntityId: deployId,
          relType: 'DEPLOYED_TO',
          toEntityId: pipelineId,
        }, tenantId)
        relationshipsUpserted++

        hints.push(`Jenkins build ${deployName} — ${job.lastBuild.result ?? 'unknown'}`)
      }
    }

    hints.push(`Jenkins bootstrap: ${jobs.length} jobs`)
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
