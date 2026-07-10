/**
 * Snyk REST API helpers (docs.snyk.io "About the REST API").
 *
 * Docs-verification finding: the connector previously used the v1 API
 * (/v1/orgs, /v1/org/{id}/projects, POST .../issues) which Snyk has marked
 * deprecated — all development is on the REST API, and deprecated v1
 * endpoints get Sunset headers. The GA REST surface:
 *
 *   GET {base}/rest/orgs?version=...
 *   GET {base}/rest/orgs/{orgId}/projects?version=...
 *   GET {base}/rest/orgs/{orgId}/issues?version=...&scan_item.id=...&scan_item.type=project
 *
 * Responses are JSON:API — { data: [{ id, attributes: {...} }], links: { next } }.
 * Auth is the same `Authorization: token <t>` scheme as v1.
 */

export const SNYK_REST_VERSION = '2024-10-15'
const MAX_PAGES = 10

export interface JsonApiResource<A> {
  id: string
  attributes: A
}

export async function snykRestList<A>(
  baseUrl: string,
  token: string,
  pathAndQuery: string,
  label: string,
): Promise<Array<JsonApiResource<A>>> {
  const out: Array<JsonApiResource<A>> = []
  const sep = pathAndQuery.includes('?') ? '&' : '?'
  let url: string | null = `${baseUrl}${pathAndQuery}${sep}version=${SNYK_REST_VERSION}&limit=100`
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.api+json' },
    })
    if (!res.ok) throw new Error(`Snyk ${label} failed: HTTP ${res.status}`)
    const body = await res.json() as { data?: Array<JsonApiResource<A>>; links?: { next?: string } }
    out.push(...(body.data ?? []))
    // links.next is a relative path+query (already version-stamped)
    url = body.links?.next ? (body.links.next.startsWith('http') ? body.links.next : `${baseUrl}${body.links.next}`) : null
  }
  return out
}
