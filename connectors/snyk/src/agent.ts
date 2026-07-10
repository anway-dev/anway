import type { IConnectorAgent, ConnectorTool } from '@anway/agent'
import { snykRestList } from './rest.js'

interface SnykCreds { token: string; baseUrl: string }

function extractCreds(creds: Record<string, unknown>): SnykCreds {
  const token = (creds['token'] as string | undefined) ?? (creds['apiKey'] as string | undefined)
  const baseUrl = ((creds['baseUrl'] as string | undefined)?.trim() || undefined) ?? 'https://api.snyk.io'
  if (!token) throw new Error('Snyk credentials not configured (token/apiKey)')
  return { token, baseUrl: baseUrl.replace(/\/$/, '') }
}

interface OrgAttrs { name: string }
interface ProjectAttrs { name: string }

/**
 * Snyk REST issue attributes (docs.snyk.io REST API reference, issues).
 * Severity lives in effective_severity_level; the affected package in
 * coordinates[].representations[].dependency.
 */
interface IssueAttrs {
  title?: string
  effective_severity_level?: string
  coordinates?: Array<{
    is_fixable_manually?: boolean
    is_fixable_snyk?: boolean
    is_upgradeable?: boolean
    is_patchable?: boolean
    representations?: Array<{ dependency?: { package_name?: string; package_version?: string } }>
  }>
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
  const orgs = await snykRestList<OrgAttrs>(baseUrl, token, '/rest/orgs', 'list orgs')

  // 2. For each org, list projects and search for match
  for (const org of orgs) {
    try {
      const projects = await snykRestList<ProjectAttrs>(
        baseUrl, token, `/rest/orgs/${org.id}/projects`, `list projects (org ${org.id})`,
      )
      // Exact project ID match first, then name match
      for (const p of projects) {
        if (p.id === projectHint || p.attributes.name === projectHint) {
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

      // REST issues endpoint, scoped to the project via scan_item filters
      // (docs-verified; replaces the deprecated v1 POST .../issues).
      const issues = await snykRestList<IssueAttrs>(
        c.baseUrl, c.token,
        `/rest/orgs/${resolved.orgId}/issues?scan_item.id=${encodeURIComponent(resolved.projectId)}&scan_item.type=project`,
        'get_vulnerabilities',
      )

      const vulns: VulnResult[] = issues.map(issue => {
        const coord = issue.attributes.coordinates?.[0]
        const dep = coord?.representations?.find(r => r.dependency)?.dependency
        return {
          id: issue.id,
          severity: issue.attributes.effective_severity_level ?? 'unknown',
          title: issue.attributes.title ?? '',
          packageName: dep?.package_name ?? '',
          fixable: Boolean(coord?.is_fixable_snyk || coord?.is_fixable_manually || coord?.is_upgradeable || coord?.is_patchable),
        }
      })
      return { vulns }
    },
    write: false,
  },
]

export class SnykAgent implements IConnectorAgent {
  readonly connectorType = 'snyk'
  readonly tools = TOOLS
}
