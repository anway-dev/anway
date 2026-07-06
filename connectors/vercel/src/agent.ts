import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


interface VercelDeployment {
  uid: string
  name?: string
  state?: string
  readyState?: string
  createdAt?: number
  buildingAt?: number
  ready?: number
  meta?: { githubCommitSha?: string }
}

function vercelAuth(creds: ConnectorCreds): string {
  const apiKey = creds.apiKey
  if (!apiKey) throw new Error('Vercel API key not configured')
  return `Bearer ${String(apiKey)}`
}

const TOOLS: ConnectorTool[] = [
  {
    // Hardcoded fake data previously — confirmed live via independent review
    // these are the only tools the orchestrator sees for this connector
    // (write:true tools are filtered out of chat in V1). Vercel doesn't
    // distinguish "pipelines" from "builds" the way CircleCI does — a
    // deployment *is* the build unit — so get_pipelines lists recent
    // deployments for the project (real /v6/deployments API) and get_builds
    // (below) fetches one deployment's detail by id.
    definition: { name: 'get_pipelines', description: 'List pipelines', parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] } },
    execute: async (params, creds) => {
      const auth = vercelAuth(creds as ConnectorCreds)
      const res = await fetch(`https://api.vercel.com/v6/deployments?app=${encodeURIComponent(String(params.service))}&limit=20`, {
        headers: { Authorization: auth },
      })
      if (!res.ok) throw new Error(`Vercel get_pipelines failed: HTTP ${res.status}`)
      const json = await res.json() as { deployments?: VercelDeployment[] }
      return {
        pipelines: (json.deployments ?? []).map(d => ({
          id: d.uid,
          name: d.name ?? String(params.service),
          status: d.state ?? d.readyState ?? 'unknown',
          lastRun: d.createdAt ? new Date(d.createdAt).toISOString() : null,
        })),
      }
    },
    write: false,
  },
  {
    definition: { name: 'get_builds', description: 'List builds', parameters: { type: 'object', properties: { pipeline: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['pipeline'] } },
    execute: async (params, creds) => {
      const auth = vercelAuth(creds as ConnectorCreds)
      // `pipeline` here is a Vercel deployment id — the closest real concept
      // to a single "build" this platform has.
      const res = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(String(params.pipeline))}`, {
        headers: { Authorization: auth },
      })
      if (!res.ok) throw new Error(`Vercel get_builds failed: HTTP ${res.status}`)
      const d = await res.json() as VercelDeployment
      const duration = d.buildingAt && d.ready ? Math.round((d.ready - d.buildingAt) / 1000) : null
      return {
        builds: [{
          id: d.uid,
          sha: d.meta?.githubCommitSha ?? '',
          status: d.state ?? d.readyState ?? 'unknown',
          duration,
          startedAt: d.buildingAt ? new Date(d.buildingAt).toISOString() : (d.createdAt ? new Date(d.createdAt).toISOString() : null),
        }],
      }
    },
    write: false,
  },
  {
    definition: { name: 'trigger_deploy', description: 'Trigger a deploy', parameters: { type: 'object', properties: { service: { type: 'string' }, env: { type: 'string' }, sha: { type: 'string' } }, required: ['service', 'env', 'sha'] } },
    execute: async (params, creds) => {
      const apiKey = (creds as ConnectorCreds).apiKey
      if (!apiKey) throw new Error('Vercel API key not configured')
      const res = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ name: String(params.service), gitSource: { type: 'github', ref: String(params.sha) }, target: String(params.env) }),
      })
      if (!res.ok) throw new Error(`Vercel trigger_deploy failed: HTTP ${res.status}`)
      const json = await res.json() as { id: string }
      return { runId: json.id }
    },
    write: true,
  },
]

export class VercelAgent implements IConnectorAgent {
  readonly connectorType = 'vercel'
  readonly tools = TOOLS
}
