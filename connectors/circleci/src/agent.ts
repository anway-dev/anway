import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


interface CCPipelineItem { id: string; state?: string; created_at?: string; updated_at?: string }
interface CCWorkflowItem { id: string; status?: string }
interface CCJobItem { id: string; job_number?: number; status?: string; started_at?: string; stopped_at?: string }

function ccHeaders(creds: ConnectorCreds): Record<string, string> {
  const apiKey = creds.apiKey
  if (!apiKey) throw new Error('CircleCI API key not configured')
  return { 'Circle-Token': String(apiKey) }
}

const TOOLS: ConnectorTool[] = [
  {
    // Hardcoded fake data previously — confirmed live via independent review
    // these are the only tools the orchestrator sees for this connector
    // (write:true tools are filtered out of chat in V1). Real CircleCI API v2.
    definition: { name: 'get_pipelines', description: 'List pipelines', parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] } },
    execute: async (params, creds) => {
      const headers = ccHeaders(creds as ConnectorCreds)
      const res = await fetch(`https://circleci.com/api/v2/project/${String(params.service)}/pipeline`, { headers })
      if (!res.ok) throw new Error(`CircleCI get_pipelines failed: HTTP ${res.status}`)
      const json = await res.json() as { items?: CCPipelineItem[] }
      return {
        pipelines: (json.items ?? []).map(p => ({
          id: p.id,
          name: String(params.service),
          status: p.state ?? 'unknown',
          lastRun: p.updated_at ?? p.created_at ?? null,
        })),
      }
    },
    write: false,
  },
  {
    // CircleCI's real hierarchy is Pipeline -> Workflow -> Job (no flat "builds"
    // endpoint) — fetch the pipeline's workflows, then each workflow's jobs,
    // and flatten into the "builds" shape agents/UI expect.
    definition: { name: 'get_builds', description: 'List builds', parameters: { type: 'object', properties: { pipeline: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['pipeline'] } },
    execute: async (params, creds) => {
      const headers = ccHeaders(creds as ConnectorCreds)
      const pipelineId = String(params.pipeline)
      const limit = params.limit ? Number(params.limit) : 20

      const [pipelineRes, workflowsRes] = await Promise.all([
        fetch(`https://circleci.com/api/v2/pipeline/${pipelineId}`, { headers }),
        fetch(`https://circleci.com/api/v2/pipeline/${pipelineId}/workflow`, { headers }),
      ])
      if (!pipelineRes.ok) throw new Error(`CircleCI get_builds (pipeline) failed: HTTP ${pipelineRes.status}`)
      if (!workflowsRes.ok) throw new Error(`CircleCI get_builds (workflows) failed: HTTP ${workflowsRes.status}`)
      const pipelineJson = await pipelineRes.json() as { vcs?: { revision?: string } }
      const sha = pipelineJson.vcs?.revision ?? ''
      const workflowsJson = await workflowsRes.json() as { items?: CCWorkflowItem[] }

      const builds: Array<{ id: string; sha: string; status: string; duration: number | null; startedAt: string | null }> = []
      for (const wf of workflowsJson.items ?? []) {
        if (builds.length >= limit) break
        const jobsRes = await fetch(`https://circleci.com/api/v2/workflow/${wf.id}/job`, { headers })
        if (!jobsRes.ok) continue
        const jobsJson = await jobsRes.json() as { items?: CCJobItem[] }
        for (const job of jobsJson.items ?? []) {
          if (builds.length >= limit) break
          const startedAt = job.started_at ?? null
          const stoppedAt = job.stopped_at ?? null
          const duration = startedAt && stoppedAt
            ? Math.round((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000)
            : null
          builds.push({ id: job.id, sha, status: job.status ?? 'unknown', duration, startedAt })
        }
      }
      return { builds }
    },
    write: false,
  },
  {
    definition: { name: 'trigger_deploy', description: 'Trigger a deploy', parameters: { type: 'object', properties: { service: { type: 'string' }, env: { type: 'string' }, sha: { type: 'string' } }, required: ['service', 'env', 'sha'] } },
    execute: async (params, creds) => {
      const apiKey = (creds as ConnectorCreds).apiKey
      if (!apiKey) throw new Error('CircleCI API key not configured')
      const res = await fetch(`https://circleci.com/api/v2/project/${String(params.service)}/pipeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Circle-Token': apiKey,
        },
        body: JSON.stringify({ branch: String(params.env), parameters: { sha: String(params.sha) } }),
      })
      if (!res.ok) throw new Error(`CircleCI trigger_deploy failed: HTTP ${res.status}`)
      const json = await res.json() as { id: string }
      return { runId: json.id }
    },
    write: true,
  },
]

export class CircleciAgent implements IConnectorAgent {
  readonly connectorType = 'circleci'
  readonly tools = TOOLS
}
