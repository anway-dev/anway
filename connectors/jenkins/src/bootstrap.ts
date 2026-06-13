import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anvay/agent'
import type { IKnowledgeGraph } from '@anvay/agent'
import type { TenantId } from '@anvay/types'

interface JenkinsConn { baseUrl: string; user: string; apiToken: string }

interface JenkinsBuild { number: number; result?: string; timestamp?: number }
interface JenkinsJob { name: string; url: string; lastBuild?: JenkinsBuild }

function connFromPayload(payload: Record<string, unknown>): JenkinsConn | null {
  const baseUrl = payload['baseUrl']
  const user = payload['user']
  const apiToken = payload['apiToken']
  if (typeof baseUrl !== 'string' || typeof user !== 'string' || typeof apiToken !== 'string') return null
  return { baseUrl: baseUrl.replace(/\/$/, ''), user, apiToken }
}

async function jenkinsGet(conn: JenkinsConn, path: string): Promise<unknown> {
  const auth = Buffer.from(`${conn.user}:${conn.apiToken}`).toString('base64')
  const res = await fetch(`${conn.baseUrl}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Jenkins API ${res.status} for ${path}`)
  return res.json()
}

export class JenkinsBootstrap implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const conn = connFromPayload(payload)
    if (!conn) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Jenkins bootstrap: missing baseUrl/user/apiToken'] }
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
      // Job → Pipeline entity
      await this.kg.upsertEntity({
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
        await this.kg.upsertEntity({
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
          fromEntityId: `Deploy:${deployName}`,
          relType: 'DEPLOYED_TO',
          toEntityId: `Pipeline:${job.name}`,
        }, tenantId)
        relationshipsUpserted++

        hints.push(`Jenkins build ${deployName} — ${job.lastBuild.result ?? 'unknown'}`)
      }
    }

    hints.push(`Jenkins bootstrap: ${jobs.length} jobs`)
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
