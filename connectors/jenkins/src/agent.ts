import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


interface JenkinsConn { baseUrl: string; user?: string; apiToken?: string }

// user/apiToken are an optional PAIR: real Jenkins instances commonly allow
// anonymous read (ci.jenkins.io does — verified live against it), and
// requiring a token made every such instance unusable. baseUrl alone is
// valid; a user without a token (or vice versa) is still a config error.
function connFromCreds(creds: Record<string, unknown>): JenkinsConn {
  const baseUrl = creds['baseUrl']
  const user = creds['user']
  const apiToken = creds['apiToken']
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('Jenkins credentials not configured (baseUrl required)')
  }
  const hasUser = typeof user === 'string' && user.length > 0
  const hasToken = typeof apiToken === 'string' && apiToken.length > 0
  if (hasUser !== hasToken) {
    throw new Error('Jenkins credentials misconfigured: user and apiToken must be provided together')
  }
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
  if (!res.ok) throw new Error(`Jenkins API failed: HTTP ${res.status} (${path})`)
  return await res.json() as unknown
}

interface JenkinsJob { name: string; url: string; color?: string }
interface JenkinsBuild { number: number; result?: string; timestamp?: number; duration?: number }

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'get_pipelines',
      description: 'List Jenkins pipelines (jobs)',
      parameters: {
        type: 'object',
        properties: { service: { type: 'string', optional: true } },
      },
    },
    execute: async (params, creds) => {
      const conn = connFromCreds(creds)
      const filter = typeof params.service === 'string' ? (params.service as string).toLowerCase() : null
      const data = await jenkinsGet(conn, '/api/json?tree=jobs[name,url,color]') as { jobs?: JenkinsJob[] }
      if (!data.jobs) return { pipelines: [] }
      const jobs = filter ? data.jobs.filter(j => j.name.toLowerCase().includes(filter)) : data.jobs
      return {
        pipelines: jobs.map(j => {
          const status: string = !j.color ? 'unknown' : j.color.includes('blue') ? 'passed' : j.color.includes('red') ? 'failed' : j.color.includes('disabled') ? 'disabled' : j.color.includes('aborted') ? 'aborted' : 'unknown'
          return { id: j.name, name: j.name, status, url: j.url }
        }),
      }
    },
    write: false,
  },
  {
    definition: {
      name: 'get_builds',
      description: 'List builds for a Jenkins pipeline',
      parameters: {
        type: 'object',
        properties: { pipeline: { type: 'string' }, limit: { type: 'number', optional: true } },
        required: ['pipeline'],
      },
    },
    execute: async (params, creds) => {
      const conn = connFromCreds(creds)
      const jobName = encodeURIComponent(String(params.pipeline))
      const limit = typeof params.limit === 'number' ? (params.limit as number) : 10
      const data = await jenkinsGet(
        conn,
        `/job/${jobName}/api/json?tree=builds[number,result,timestamp,duration]{0,${limit - 1}}`,
      ) as { builds?: JenkinsBuild[] }
      if (!data.builds) return { builds: [] }
      return {
        builds: data.builds.map(b => ({
          id: `b-${b.number}`,
          number: b.number,
          status: !b.result ? 'running' : b.result === 'SUCCESS' ? 'success' : b.result === 'UNSTABLE' ? 'unstable' : 'failed',
          sha: '', // Jenkins REST API doesn't expose SHA at the job level without the git plugin
          duration: b.duration ?? 0,
          startedAt: b.timestamp ? new Date(b.timestamp).toISOString() : new Date().toISOString(),
        })),
      }
    },
    write: false,
  },
  {
    definition: { name: 'trigger_deploy', description: 'Trigger a deploy', parameters: { type: 'object', properties: { service: { type: 'string' }, env: { type: 'string' }, sha: { type: 'string' } }, required: ['service', 'env', 'sha'] } },
    execute: async (params, creds) => {
      const c = creds as ConnectorCreds
      const baseUrl = String(c.baseUrl ?? '')
      const user = String(c.user ?? '')
      const apiToken = String(c.apiToken ?? '')
      if (!baseUrl || !user || !apiToken) throw new Error('Jenkins credentials not configured')
      const url = `${baseUrl.replace(/\/$/, '')}/job/${String(params.service)}/buildWithParameters?env=${encodeURIComponent(String(params.env))}&sha=${encodeURIComponent(String(params.sha))}`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${user}:${apiToken}`)}`,
        },
      })
      if (!res.ok) throw new Error(`Jenkins trigger_deploy failed: HTTP ${res.status}`)
      const location = res.headers.get('Location')
      const queueId = location ? location.split('/').pop() ?? 'queued' : 'queued'
      return { runId: queueId }
    },
    write: true,
  },
]

export class JenkinsAgent implements IConnectorAgent {
  readonly connectorType = 'jenkins'
  readonly tools = TOOLS
}
