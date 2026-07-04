import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface SonarQubeConn { baseUrl: string; token: string }

function connFromCreds(creds: Record<string, unknown>): SonarQubeConn | null {
  const baseUrl = creds['baseUrl']
  const token = (creds['token'] as string | undefined) ?? (creds['apiKey'] as string | undefined)
  if (typeof token !== 'string' || !token) return null
  const resolvedBase = typeof baseUrl === 'string' ? (baseUrl as string) : 'http://localhost:9000'
  return { baseUrl: resolvedBase.replace(/\/$/, ''), token }
}

async function sonarGet(conn: SonarQubeConn, path: string): Promise<unknown | null> {
  try {
    const auth = Buffer.from(`${conn.token}:`).toString('base64')
    const res = await fetch(`${conn.baseUrl}${path}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    })
    if (!res.ok) return null
    return await res.json() as unknown
  } catch { return null }
}

interface SonarQubeIssue {
  severity: string
  type: string
  message: string
  component: string
  line?: number
}

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'get_issues',
      description: 'List open code quality issues for a SonarQube project',
      parameters: {
        type: 'object',
        properties: { project: { type: 'string' } },
        required: ['project'],
      },
    },
    execute: async (params, creds) => {
      const conn = connFromCreds(creds)
      if (!conn) return { issues: [] }

      const project = String(params.project ?? '').trim()
      if (!project) return { issues: [] }

      const data = await sonarGet(
        conn,
        `/api/issues/search?componentKeys=${encodeURIComponent(project)}&resolved=false`,
      ) as { issues?: SonarQubeIssue[] } | null

      if (!data?.issues) return { issues: [] }

      return {
        issues: data.issues.map(i => {
          // SonarQube component format: projectKey:path/to/file
          // Extract file path portion after the last colon
          const file = i.component.includes(':') ? i.component.split(':').pop()! : i.component
          return {
            severity: i.severity.toLowerCase(),
            type: i.type,
            message: i.message,
            file,
            line: i.line ?? 0,
          }
        }),
      }
    },
    write: false,
  },
  {
    definition: {
      name: 'get_quality_metrics',
      description: 'Get quality metrics for a SonarQube project',
      parameters: {
        type: 'object',
        properties: { project: { type: 'string' } },
        required: ['project'],
      },
    },
    execute: async (params, creds) => {
      const conn = connFromCreds(creds)
      if (!conn) return { coverage: 0, duplication: 0, bugs: 0, vulnerabilities: 0 }

      const project = String(params.project ?? '').trim()
      if (!project) return { coverage: 0, duplication: 0, bugs: 0, vulnerabilities: 0 }

      const data = await sonarGet(
        conn,
        `/api/measures/component?component=${encodeURIComponent(project)}&metricKeys=coverage,duplicated_lines_density,bugs,vulnerabilities`,
      ) as {
        component?: {
          measures?: Array<{ metric: string; value: string }>
        }
      } | null

      if (!data?.component?.measures) return { coverage: 0, duplication: 0, bugs: 0, vulnerabilities: 0 }

      const metrics: Record<string, number> = {}
      for (const m of data.component.measures) {
        metrics[m.metric] = parseFloat(m.value)
      }

      return {
        coverage: metrics['coverage'] ?? 0,
        duplication: metrics['duplicated_lines_density'] ?? 0,
        bugs: Math.round(metrics['bugs'] ?? 0),
        vulnerabilities: Math.round(metrics['vulnerabilities'] ?? 0),
      }
    },
    write: false,
  },
]

export class SonarqubeAgent implements IConnectorAgent {
  readonly connectorType = 'sonarqube'
  readonly tools = TOOLS
}
