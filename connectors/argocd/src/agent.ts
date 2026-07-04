import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface ArgocdCreds { token: string; baseUrl: string }

function extractCreds(creds: Record<string, unknown>): ArgocdCreds | null {
  const token = (creds as { token?: string; baseUrl?: string }).token
  const baseUrl = (creds as { token?: string; baseUrl?: string }).baseUrl
  if (typeof token !== 'string' || typeof baseUrl !== 'string' || !token || !baseUrl) return null
  return { token, baseUrl: baseUrl.replace(/\/$/, '') }
}

/** Map ArgoCD sync + health status to a human-readable pipeline status. */
function mapPipelineStatus(syncStatus: string, healthStatus: string): string {
  const s = syncStatus || 'Unknown'
  const h = healthStatus || 'Unknown'
  if (s === 'Synced' && h === 'Healthy') return 'healthy'
  if (s === 'Synced' && h === 'Degraded') return 'degraded'
  if (s === 'OutOfSync') return 'out_of_sync'
  if (h === 'Progressing') return 'progressing'
  if (h === 'Suspended') return 'suspended'
  return 'unknown'
}

interface ArgoCDApp {
  metadata?: { name?: string }
  status?: {
    sync?: { status?: string }
    health?: { status?: string }
    history?: Array<{
      id: number
      revision?: string
      deployedAt?: string
      deployStartedAt?: string
    }>
  }
}

const TOOLS: ConnectorTool[] = [
  // ── get_pipelines — real ArgoCD REST API ──────────────────────────
  {
    definition: {
      name: 'get_pipelines',
      description: 'List ArgoCD applications (pipelines) with sync and health status',
      parameters: {
        type: 'object',
        properties: { service: { type: 'string', optional: true } },
      },
    },
    execute: async (params, creds) => {
      const c = extractCreds(creds)
      if (!c) return { pipelines: [] }
      const filter = typeof params.service === 'string' ? (params.service as string).toLowerCase() : null
      try {
        const res = await fetch(`${c.baseUrl}/api/v1/applications`, {
          headers: { Authorization: `Bearer ${c.token}` },
        })
        if (!res.ok) return { pipelines: [] }
        const data = (await res.json()) as { items?: ArgoCDApp[] }
        if (!data?.items) return { pipelines: [] }
        const apps = filter
          ? data.items.filter(a => (a.metadata?.name ?? '').toLowerCase().includes(filter))
          : data.items
        return {
          pipelines: apps.map(a => ({
            id: a.metadata?.name ?? 'unknown',
            name: a.metadata?.name ?? 'unknown',
            status: mapPipelineStatus(
              a.status?.sync?.status ?? 'Unknown',
              a.status?.health?.status ?? 'Unknown',
            ),
            syncStatus: a.status?.sync?.status ?? 'Unknown',
            healthStatus: a.status?.health?.status ?? 'Unknown',
          })),
        }
      } catch {
        return { pipelines: [] }
      }
    },
    write: false,
  },

  // ── get_builds — deployment history via real ArgoCD REST API ──────
  // ArgoCD has no CI "builds" concept. Closest equivalent: an
  // application's sync history (status.history). Each history entry
  // represents a completed sync operation — a real deploy event.
  {
    definition: {
      name: 'get_builds',
      description: 'List deployment history for an ArgoCD application (from status.history)',
      parameters: {
        type: 'object',
        properties: {
          pipeline: { type: 'string' },
          limit: { type: 'number', optional: true },
        },
        required: ['pipeline'],
      },
    },
    execute: async (params, creds) => {
      const c = extractCreds(creds)
      if (!c) return { builds: [] }
      const appName = encodeURIComponent(String(params.pipeline))
      const limit = typeof params.limit === 'number' ? (params.limit as number) : 10
      try {
        const res = await fetch(`${c.baseUrl}/api/v1/applications/${appName}`, {
          headers: { Authorization: `Bearer ${c.token}` },
        })
        if (!res.ok) return { builds: [] }
        const app = (await res.json()) as ArgoCDApp
        const history = app.status?.history ?? []
        const builds = history.slice(0, limit).map(h => ({
          id: `b-${h.id}`,
          sha: h.revision ?? '',
          status: 'deployed', // history only records completed syncs — all entries are deployed
          duration: 0, // ArgoCD does not track per-deploy duration
          startedAt: h.deployedAt ?? h.deployStartedAt ?? new Date().toISOString(),
        }))
        return { builds }
      } catch {
        return { builds: [] }
      }
    },
    write: false,
  },

  // ── trigger_deploy — UNCHANGED (real, working) ────────────────────
  {
    definition: {
      name: 'trigger_deploy',
      description: 'Trigger a deploy',
      parameters: {
        type: 'object',
        properties: { appName: { type: 'string' } },
        required: ['appName'],
      },
    },
    execute: async (params, creds) => {
      const token = (creds as { token?: string; baseUrl?: string }).token
      if (!token) throw new Error('ArgoCD token not configured')
      const baseUrl = (creds as { token?: string; baseUrl?: string }).baseUrl ?? ''
      if (!baseUrl) throw new Error('ArgoCD URL not configured')
      const appName = String(params.appName ?? '')
      if (!appName) throw new Error('appName is required')
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/applications/${appName}/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error(`ArgoCD trigger_deploy failed: HTTP ${res.status}`)
      const operation = (await res.json()) as { metadata?: { name?: string }; status?: { operationState?: { id?: string } } }
      return { runId: operation.metadata?.name ?? operation.status?.operationState?.id ?? 'unknown' }
    },
    write: true,
  },
]

export class ArgocdAgent implements IConnectorAgent {
  readonly connectorType = 'argocd'
  readonly tools = TOOLS
}
