import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface TerraformConn { baseUrl: string; token: string }

function connFromCreds(creds: Record<string, unknown>): TerraformConn {
  const baseUrl = (creds['baseUrl'] as string | undefined) ?? 'https://app.terraform.io'
  const token = (creds['token'] as string | undefined) ?? (creds['apiKey'] as string | undefined) ?? ''
  if (!token) throw new Error('Terraform Cloud credentials not configured (token/apiKey)')
  return { baseUrl: baseUrl.replace(/\/$/, ''), token }
}

async function tfcGet(conn: TerraformConn, path: string): Promise<unknown> {
  const res = await fetch(`${conn.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${conn.token}`, 'Content-Type': 'application/vnd.api+json' },
  })
  if (!res.ok) throw new Error(`Terraform Cloud API failed: HTTP ${res.status} (${path})`)
  return await res.json() as unknown
}

interface TfcOrg { id: string; attributes: { name: string } }
interface TfcWorkspace { id: string; attributes: { name: string } }
interface TfcRun { id: string; attributes: { status: string; message: string; 'status-timestamps': Record<string, string> } }

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'get_workspaces',
      description: 'List Terraform Cloud workspaces across all organizations',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (_params, creds) => {
      const conn = connFromCreds(creds)

      {
        const orgsData = await tfcGet(conn, '/api/v2/organizations') as { data?: TfcOrg[] } | null
        if (!orgsData?.data) return { workspaces: [] }

        const workspaces: Array<{ name: string; org: string; status: string; lastRun: string | null }> = []

        for (const org of orgsData.data) {
          const orgName = org.attributes.name
          try {
            const wsData = await tfcGet(conn, `/api/v2/organizations/${orgName}/workspaces`) as { data?: TfcWorkspace[] } | null
            for (const w of wsData?.data ?? []) {
              // Fetch latest run to derive status + lastRun timestamp.
              // Terraform Cloud workspace resources don't expose a flat "status"
              // field; the workspace's current run status lives on the run resource.
              // GET …/runs returns newest-first, so page[size]=1 gives the latest.
              let status = 'unknown'
              let lastRun: string | null = null
              try {
                const runsData = await tfcGet(conn, `/api/v2/workspaces/${w.id}/runs?page[size]=1`) as { data?: TfcRun[] } | null
                const latest = runsData?.data?.[0]
                if (latest) {
                  status = latest.attributes.status
                  const ts = latest.attributes['status-timestamps'] ?? {}
                  // Pick the timestamp matching the run's terminal status first
                  // (e.g. 'applied-at' for applied, 'errored-at' for errored),
                  // so an errored run returns its errored-at, not an earlier planned-at.
                  // Fall back through priority: applied > planned-and-finished >
                  // canceled > discarded > planned > first available.
                  lastRun = ts[`${status}-at`]
                    ?? ts['applied-at']
                    ?? ts['planned-and-finished-at']
                    ?? ts['canceled-at']
                    ?? ts['discarded-at']
                    ?? ts['planned-at']
                    ?? Object.values(ts)[0]
                    ?? null
                }
              } catch { /* keep unknown status */ }

              workspaces.push({
                name: `${orgName}/${w.attributes.name}`,
                org: orgName,
                status,
                lastRun,
              })
            }
          } catch { /* skip workspaces for this org */ }
        }

        return { workspaces }
      }
    },
    write: false,
  },
  {
    definition: {
      name: 'get_run',
      description: 'Get the most recent run for a Terraform Cloud workspace',
      parameters: {
        type: 'object',
        properties: { workspaceId: { type: 'string' } },
        required: ['workspaceId'],
      },
    },
    execute: async (params, creds) => {
      const workspaceId = params['workspaceId'] as string | undefined
      if (!workspaceId) throw new Error('Terraform get_run: workspaceId is required')

      const conn = connFromCreds(creds)

      // Terraform Cloud runs list is newest-first; page[size]=1 fetches the
      // single most recent run.
      const runsData = await tfcGet(conn, `/api/v2/workspaces/${workspaceId}/runs?page[size]=1`) as { data?: TfcRun[] } | null
      const latest = runsData?.data?.[0]
      if (!latest) return { run: null }

      const ts = latest.attributes['status-timestamps'] ?? {}
      // applied-at is the canonical "this was applied" timestamp.
      // If the run hasn't been applied (e.g. still in planned), appliedAt is null.
      const appliedAt = ts['applied-at'] ?? null

      return {
        run: {
          id: latest.id,
          status: latest.attributes.status,
          message: latest.attributes.message,
          appliedAt,
        },
      }
    },
    write: false,
  },
]

export class TerraformAgent implements IConnectorAgent {
  readonly connectorType = 'terraform'
  readonly tools = TOOLS
}
