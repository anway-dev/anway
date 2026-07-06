import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

interface SnykCreds { token: string; baseUrl: string }

function extractCreds(creds: Record<string, unknown>): SnykCreds {
  const token = (creds['token'] as string | undefined) ?? (creds['apiKey'] as string | undefined)
  const baseUrl = ((creds['baseUrl'] as string | undefined)?.trim() || undefined) ?? 'https://api.snyk.io'
  if (!token) throw new Error('Snyk credentials not configured (token/apiKey)')
  return { token, baseUrl: baseUrl.replace(/\/$/, '') }
}

interface SnykOrg {
  id: string
  name: string
}

interface SnykProject {
  id: string
  name: string
}

/** Raw vulnerability shape from Snyk v1 POST /org/{orgId}/project/{projectId}/issues */
interface SnykVuln {
  id: string
  issueData: { severity: string; title: string }
  pkgName: string
  isFixable: boolean
}

/** Normalised return shape matching existing tool contract */
interface VulnResult {
  id: string
  severity: string
  title: string
  packageName: string
  fixable: boolean
}

async function resolveProject(
  projectHint: string,
  baseUrl: string,
  token: string,
): Promise<{ orgId: string; projectId: string } | null> {
  // 1. List orgs — a real failure here (network error, auth failure) means
  // we cannot know whether the project exists at all, so it throws rather
  // than being indistinguishable from "traversed everything, found no
  // match" (which legitimately returns null below).
  const orgsRes = await fetch(`${baseUrl}/v1/orgs`, {
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
  })
  if (!orgsRes.ok) throw new Error(`Snyk list orgs failed: HTTP ${orgsRes.status}`)
  const orgsData = (await orgsRes.json()) as { orgs?: SnykOrg[] }
  const orgs = orgsData.orgs ?? []

  // 2. For each org, list projects and search for match
  for (const org of orgs) {
    try {
      const projRes = await fetch(`${baseUrl}/v1/org/${org.id}/projects`, {
        headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
      })
      if (!projRes.ok) continue
      const projData = (await projRes.json()) as { projects?: SnykProject[] }
      const projects = projData.projects ?? []

      // Exact project ID match first, then name match
      for (const p of projects) {
        if (p.id === projectHint || p.name === projectHint) {
          return { orgId: org.id, projectId: p.id }
        }
      }
    } catch {
      // skip this org, try next
    }
  }

  return null
}

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'get_vulnerabilities',
      description: 'List vulnerabilities for a Snyk project. Resolves orgId via traversal.',
      parameters: {
        type: 'object',
        properties: { project: { type: 'string' } },
        required: ['project'],
      },
    },
    execute: async (params, creds) => {
      const c = extractCreds(creds)

      const projectHint = String(params.project ?? '').trim()
      if (!projectHint) throw new Error('Snyk get_vulnerabilities: project is required')

      // Resolve project → (orgId, projectId) via org→project traversal.
      // resolved === null after a successful traversal is a genuine "no
      // project matched that name/id" result, not a failure.
      const resolved = await resolveProject(projectHint, c.baseUrl, c.token)
      if (!resolved) return { vulns: [] }

      const issuesRes = await fetch(
        `${c.baseUrl}/v1/org/${resolved.orgId}/project/${resolved.projectId}/issues`,
        {
          method: 'POST',
          headers: {
            Authorization: `token ${c.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        },
      )
      if (!issuesRes.ok) throw new Error(`Snyk get_vulnerabilities failed: HTTP ${issuesRes.status}`)
      const issuesData = (await issuesRes.json()) as {
        issues?: { vulnerabilities?: SnykVuln[] }
      }
      const raw = issuesData.issues?.vulnerabilities ?? []
      const vulns: VulnResult[] = raw.map(v => ({
        id: v.id,
        severity: v.issueData?.severity ?? 'unknown',
        title: v.issueData?.title ?? '',
        packageName: v.pkgName ?? '',
        fixable: v.isFixable ?? false,
      }))
      return { vulns }
    },
    write: false,
  },
]

export class SnykAgent implements IConnectorAgent {
  readonly connectorType = 'snyk'
  readonly tools = TOOLS
}
