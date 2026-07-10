import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

// Linear auth (docs-verified at linear.app/developers/graphql): personal
// API keys (lin_api_*) are passed RAW in Authorization — the Bearer prefix
// is ONLY for OAuth2 access tokens. This sent Bearer unconditionally, which
// 401s for every personal API key (the credential type users actually
// configure).
function linearAuthHeader(token: string): string {
  return token.startsWith('lin_api_') ? token : `Bearer ${token}`
}

async function graphqlQuery(token: string, baseUrl: string, query: string): Promise<Record<string, unknown>> {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: linearAuthHeader(token) },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`Linear API ${res.status}`)
  const body = (await res.json()) as Record<string, unknown> & { errors?: Array<{ message: string }> }
  // GraphQL reports many real failures (bad query, field errors, rate
  // limits) as HTTP 200 with a top-level `errors` array — this is how the
  // spec, and Linear's API specifically, signal partial/total failure, not
  // via HTTP status. Confirmed live via independent review: the non-OK
  // check above didn't catch this, so a real GraphQL-level failure (e.g.
  // the `team { id }` field this session just added being rejected by an
  // API version mismatch) fell through to the caller's `?.data?.X?.nodes ?? []`
  // as an indistinguishable empty success — same failure class already
  // fixed for the HTTP-status case.
  if (body.errors && body.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${body.errors.map(e => e.message).join('; ')}`)
  }
  return body
}

interface TeamNode { id: string; name: string; key: string }
interface ProjectNode { id: string; name: string; key: string }
interface IssueNode { id: string; identifier: string; title: string; description?: string; team?: { id: string } }

export class LinearBootstrap implements IConnectorBootstrap {
  constructor(
    private readonly kg: IKnowledgeGraph,
    private readonly apiKey?: string,
  ) {}

  async bootstrap(tenantId: TenantId, _connectorId: string, payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    const baseUrl = (payload['baseUrl'] as string | undefined) ?? 'https://api.linear.app/graphql'
    const apiKey = (payload['apiKey'] as string | undefined) ?? process.env['LINEAR_API_KEY']
    if (!apiKey) {
      return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['Linear bootstrap: no API key'] }
    }

    let entitiesUpserted = 0
    let relationshipsUpserted = 0

    // 1. Fetch teams. Real failure (graphqlQuery throws on non-OK) must
    // propagate — confirmed live via independent connector-bootstrap audit
    // that the outer try/catch below used to swallow every real thrown
    // error from graphqlQuery back into an empty *successful* result,
    // making a real API/auth outage indistinguishable from "this org has
    // no teams configured" (the exact A2-sweep failure mode already fixed
    // elsewhere this session, still present in this file since the
    // original sweep only touched agent.ts).
    const teamsData = await graphqlQuery(apiKey, baseUrl, '{ teams { nodes { id name key } } }') as { data?: { teams?: { nodes: TeamNode[] } } }
    const teams = teamsData?.data?.teams?.nodes ?? []

    // Capture the real entity id upsertEntity returns, keyed by Linear's
    // own team id — needed below to create the documented
    // Ticket→OWNED_BY→Team relationship using real ids, not fabricated ones
    // (same discipline as the PagerDuty/OpsGenie/K8s fixes this session).
    const teamIdByLinearId = new Map<string, string>()
    for (const team of teams) {
      const teamId = await this.kg.upsertEntity({
        type: 'Team',
        name: team.name,
        metadata: { externalId: team.id, linearKey: team.key, connectorCoordinates: { linear: { resourceIds: { teamId: team.id } } } },
      }, tenantId)
      teamIdByLinearId.set(team.id, teamId)
      entitiesUpserted++
    }

    // 2. Fetch projects
    const projData = await graphqlQuery(apiKey, baseUrl, '{ projects { nodes { id name } } }') as { data?: { projects?: { nodes: Array<{ id: string; name: string }> } } }
    const projects = projData?.data?.projects?.nodes ?? []

    for (const proj of projects) {
      await this.kg.upsertEntity({
        type: 'Project',
        name: proj.name,
        metadata: { externalId: proj.id, source: 'linear' },
      }, tenantId)
      entitiesUpserted++
    }

    // 3. Fetch recent issues (last 30 days). `team { id }` is a real field
    // on Linear's Issue type — every issue belongs to exactly one team.
    // Cursor-paginate to completion with a hard budget (Relay-style
    // pageInfo { hasNextPage endCursor }) — confirmed via independent
    // review this fetched exactly first:100 with no cursor loop, silently
    // truncating any org with >100 recent tickets.
    const MAX_ISSUES = 1000
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const issues: IssueNode[] = []
    let issuesTruncated = false
    let after = ''
    for (;;) {
      const afterArg = after ? `, after: "${after}"` : ''
      const issuesData = await graphqlQuery(apiKey, baseUrl, `{ issues(filter: { createdAt: { gte: "${since}" } }, first: 100${afterArg}) { pageInfo { hasNextPage endCursor } nodes { id identifier title description team { id } } } }`) as { data?: { issues?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; nodes: IssueNode[] } } }
      const page = issuesData?.data?.issues
      issues.push(...(page?.nodes ?? []))
      if (!page?.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break
      if (issues.length >= MAX_ISSUES) { issuesTruncated = true; break }
      after = page.pageInfo.endCursor
    }

    for (const issue of issues) {
      const issueName = `${issue.identifier}: ${issue.title}`
      const ticketId = await this.kg.upsertEntity({
        type: 'Ticket',
        name: issueName,
        metadata: { externalId: issue.id, source: 'linear', status: 'open' },
      }, tenantId)
      entitiesUpserted++

      // Ticket→OWNED_BY→Team — documented in CLAUDE.md, real and directly
      // derivable from the issue's own team field, matched against the real
      // Team entity ids captured in step 1. Confirmed live via independent
      // review that this connector never created this relationship at all.
      if (issue.team) {
        const teamId = teamIdByLinearId.get(issue.team.id)
        if (teamId) {
          await this.kg.upsertRelationship({
            fromEntityId: ticketId,
            relType: 'OWNED_BY',
            toEntityId: teamId,
            metadata: { source: 'linear-issue-team' },
          }, tenantId)
          relationshipsUpserted++
        }
      }

      // Match ticket title words against known Service entities
      const words = issue.title.split(/\s+/).filter((w: string) => w.length > 3)
      for (const word of words.slice(0, 3)) {
        try {
          const ctx = await this.kg.resolveContextByName(word, tenantId, 1)
          if (ctx && ctx.primaryEntity?.type === 'Service') {
            await this.kg.upsertRelationship({
              fromEntityId: ticketId,
              relType: 'RELATES_TO',
              toEntityId: ctx.primaryEntity.id,
              metadata: { confidence: 0.6, source: 'linear-title-match' },
            }, tenantId)
            relationshipsUpserted++
            break
          }
        } catch { /* no match — skip */ }
      }
    }

    const hints = [`Linear bootstrap: ${teams.length} teams, ${projects.length} projects, ${issues.length} recent tickets`]
    if (issuesTruncated) hints.push(`Linear bootstrap: TRUNCATED at ${MAX_ISSUES} tickets — graph is partial`)
    return { entitiesUpserted, relationshipsUpserted, episodeHints: hints }
  }
}
