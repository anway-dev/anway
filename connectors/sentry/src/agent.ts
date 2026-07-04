import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface SentryConn { baseUrl: string; token: string; org: string }

function connFromCreds(creds: Record<string, unknown>): SentryConn | null {
  const token = creds['token']
  const org = creds['org']
  const baseUrl = creds['baseUrl']
  if (typeof token !== 'string' || typeof org !== 'string') return null
  const resolvedBase = typeof baseUrl === 'string' ? (baseUrl as string) : 'https://sentry.io'
  return { baseUrl: resolvedBase.replace(/\/$/, ''), token, org }
}

/** Extract a flat stack trace string from the first exception entry's frames. */
function extractStacktrace(event: Record<string, unknown>): string {
  try {
    const entries = event['entries'] as Array<Record<string, unknown>> | undefined
    if (!entries) return ''
    const excEntry = entries.find(e => e['type'] === 'exception')
    if (!excEntry) return ''
    const data = excEntry['data'] as Record<string, unknown> | undefined
    if (!data) return ''
    const values = data['values'] as Array<Record<string, unknown>> | undefined
    if (!values || values.length === 0) return ''
    const stacktrace = values[0]!['stacktrace'] as Record<string, unknown> | undefined
    const frames = stacktrace?.['frames'] as Array<Record<string, unknown>> | undefined
    if (!frames) return ''
    return frames.map(f => {
      const fn = f['function'] ?? '<anonymous>'
      const file = f['filename'] ?? f['absPath'] ?? 'unknown'
      const line = f['lineNo']
      const col = f['colNo']
      const loc = line != null ? (col != null ? `${file}:${line}:${col}` : `${file}:${line}`) : file
      return `at ${fn} (${loc})`
    }).join('\n')
  } catch {
    return ''
  }
}

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'get_issues',
      description:
        'List Sentry issues for a project. Returns the first page of results (true cursor-based pagination via Link header is not implemented — the optional limit param is accepted for API compatibility but does not apply a server-side filter).',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          limit: { type: 'number', optional: true },
        },
        required: ['project'],
      },
    },
    execute: async (params, creds) => {
      const conn = connFromCreds(creds)
      if (!conn) return { issues: [] }

      const project = String(params.project ?? '').trim()
      if (!project) return { issues: [] }

      try {
        const res = await fetch(
          `${conn.baseUrl}/api/0/projects/${encodeURIComponent(conn.org)}/${encodeURIComponent(project)}/issues/`,
          { headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' } },
        )
        if (!res.ok) return { issues: [] }

        const json = (await res.json()) as Array<{
          id: string
          title: string
          count: string | number
          firstSeen: string
          lastSeen: string
        }>
        const issues = (Array.isArray(json) ? json : []).map(issue => ({
          id: issue.id,
          title: issue.title,
          count: typeof issue.count === 'string' ? parseInt(issue.count, 10) : (issue.count as number),
          firstSeen: issue.firstSeen,
          lastSeen: issue.lastSeen,
        }))
        return { issues }
      } catch {
        return { issues: [] }
      }
    },
    write: false,
  },
  {
    definition: {
      name: 'get_events',
      description:
        'Get events for a Sentry issue. Returns the first page (true cursor-based pagination via Link header is not implemented). Stack trace is extracted from the first exception entry\'s frames and returned as a flat string.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          limit: { type: 'number', optional: true },
        },
        required: ['issueId'],
      },
    },
    execute: async (params, creds) => {
      const conn = connFromCreds(creds)
      if (!conn) return { events: [] }

      const issueId = String(params.issueId ?? '').trim()
      if (!issueId) return { events: [] }

      try {
        const res = await fetch(
          `${conn.baseUrl}/api/0/issues/${encodeURIComponent(issueId)}/events/`,
          { headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' } },
        )
        if (!res.ok) return { events: [] }

        const json = (await res.json()) as Array<Record<string, unknown>>
        const rawEvents = Array.isArray(json) ? json : []
        const events = rawEvents.map(e => ({
          id: (e['eventID'] as string) ?? (e['id'] as string) ?? '',
          message: (e['message'] as string) ?? (e['title'] as string) ?? '',
          stack: extractStacktrace(e),
          ts: (e['dateCreated'] as string) ?? (e['dateReceived'] as string) ?? new Date().toISOString(),
        }))
        return { events }
      } catch {
        return { events: [] }
      }
    },
    write: false,
  },
]

export class SentryAgent implements IConnectorAgent {
  readonly connectorType = 'sentry'
  readonly tools = TOOLS
}
