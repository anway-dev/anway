# Anway — Completion Plan

**Purpose:** Every task required to call Anway complete and demo-ready. Execute in order.
**Branch:** `claude/claude-md-docs-k210H`
**Repo:** `/Users/raj/workspace_code/ai-proj/restol`
**Stack:** TypeScript monorepo · pnpm workspaces · turborepo · Vitest · Fastify · Next.js · Postgres/pgvector · Redis

**Definition of complete:**
- `docker compose up` starts full stack (postgres, redis, gateway, web)
- Browser → OrchestratorChat → real LLM streaming response (no mock data)
- GitHub connector functional (real `gh` CLI, no shell injection)
- Demo tenant seeded, KB has entities for name resolution
- `pnpm typecheck` clean, all tests green
- All security issues resolved

> **Opus review verdict: APPROVED WITH COMMENTS** — 3 blockers fixed below (Dockerfile CLI, B-3 before B-2 ordering, StructuralGraph RLS). See full review notes inline.

---

## Part 0 — Rules

- `git pull` before every session
- `pnpm typecheck` after every task. Fix errors before committing
- After agent/types changes: `pnpm --filter @anway/agent test`
- After gateway changes: `pnpm --filter anway-gateway test`
- After web changes: `pnpm --filter @anway/web test`
- Commit each task separately: `fix|feat|chore(scope): description — Task S-1`
- Post to `docs/BRIDGE.md` if blocked. Claude reads it and responds within minutes.
- Check `docs/BRIDGE.md` for Claude's latest messages before starting each session

---

## SECURITY — Execute first, no exceptions

### S-0 — Gateway Dockerfile: install `gh` CLI (distroless has no CLI tools)

**File:** `apps/gateway/Dockerfile`

Current base is `gcr.io/distroless/nodejs22-debian12` — no shell, no package manager, no `gh`, no `argocd`. GitHub and ArgoCD connectors use these CLIs. Every connector call throws `ENOENT` at runtime.

**Fix — switch runtime stage to `node:22-slim` and install `gh`:**

```dockerfile
# Build stage (unchanged)
FROM node:22-slim AS builder
WORKDIR /app
# ... existing build steps ...

# Runtime stage — switch from distroless to node:22-slim
FROM node:22-slim AS runtime
WORKDIR /app

# Install gh CLI (GitHub's official package)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    curl \
    ca-certificates \
  && wget -qO /tmp/gh.deb https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_amd64.deb \
  && dpkg -i /tmp/gh.deb \
  && rm /tmp/gh.deb \
  && apt-get purge -y wget \
  && rm -rf /var/lib/apt/lists/*

# Copy built output from builder
COPY --from=builder /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder /app/node_modules ./node_modules
# ... rest of COPY steps ...

USER node
CMD ["node", "apps/gateway/dist/server.js"]
```

Note: `argocd` CLI install is optional for V1 — ArgoCD connector can be wired to HTTP API instead (recommended). Do not add large CLIs (kubectl, aws, gcloud) — those are infra tooling, not gateway dependencies.

**Verify:** `docker build -t anway-gateway -f apps/gateway/Dockerfile . && docker run --rm anway-gateway gh --version`

**Commit:** `fix(gateway): switch runtime to node:22-slim; install gh CLI`

---

### S-1 — Shell injection in CLI connectors

**Files:** `connectors/github/src/connector.ts`, `connectors/linear/src/connector.ts`, `connectors/argocd/src/connector.ts`

All use `execSync(\`binary ${args.join(' ')}\`)` with LLM-produced values in `args`. Any value containing `;`, `&&`, or `$()` executes arbitrary shell commands on the gateway host.

**Fix — replace `execSync(string)` with `spawnSync(array)` in every connector:**

```typescript
import { spawnSync } from 'node:child_process'

private runCli(binary: string, args: string[]): string {
  const result = spawnSync(binary, args, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error) throw new Error(`${binary} spawn failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${binary} exited ${result.status}: ${result.stderr}`)
  return result.stdout
}
```

`spawnSync` with an array NEVER invokes a shell. Arguments with special characters are passed literally.

Also replace `filters: string` param in GitHub `list_prs` tool with structured params — never accept raw CLI flags from LLM:
```typescript
// Remove:
filters: { type: 'string', description: 'Optional gh CLI filter flags...' }
// Add:
state: { type: 'string', enum: ['open', 'closed', 'merged', 'all'], default: 'open' },
limit: { type: 'number', default: 20 },
```

Update `list_prs` case to build args from structured params:
```typescript
case 'list_prs': {
  const repo = query.repo as string ?? ''
  const state = (query.state as string) ?? 'open'
  const limit = String(query.limit ?? 20)
  stdout = this.runCli('gh', ['pr', 'list', '--repo', repo, '--state', state, '--limit', limit, '--json', 'number,title,state,author,createdAt'])
  break
}
```

**Verify:** `grep -r "execSync\`" connectors/` must return 0 results.

**Commit:** `fix(connectors): spawnSync array replaces execSync string — closes shell injection`

---

### S-2 — GraphQL injection in Linear connector + replace CLI with HTTP API

**File:** `connectors/linear/src/connector.ts`

Two problems:
1. `team`, `issue_id`, `project_id` interpolated directly into GraphQL query strings — GraphQL injection
2. `linear api --json '{...}'` CLI doesn't exist as a documented tool — every call throws `ENOENT`

**Fix — replace with direct Linear HTTP GraphQL API using variables:**

```typescript
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anway/types'

export class LinearConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }

  constructor(id: string) {
    this.id = id
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const token = process.env['LINEAR_API_KEY']
    if (!token) throw new Error('LINEAR_API_KEY not set')
    const resp = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({ query, variables }),
    })
    if (!resp.ok) throw new Error(`Linear API ${resp.status}: ${await resp.text()}`)
    const json = await resp.json() as { data?: unknown; errors?: unknown[] }
    if (json.errors?.length) throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`)
    return json.data
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    let data: unknown

    switch (query.type) {
      case 'list_issues': {
        data = await this.graphql(
          `query ListIssues($team: String!, $first: Int) {
            issues(first: $first, filter: { team: { name: { eq: $team } } }) {
              nodes { id title description state { name } priority assignee { name } createdAt }
            }
          }`,
          { team: query.team as string ?? '', first: 50 },
        )
        break
      }
      case 'get_issue': {
        data = await this.graphql(
          `query GetIssue($id: String!) {
            issue(id: $id) { id title description state { name } priority assignee { name } team { name } createdAt }
          }`,
          { id: query.issue_id as string ?? '' },
        )
        break
      }
      case 'list_projects': {
        data = await this.graphql(
          `query ListProjects($team: String!, $first: Int) {
            projects(first: $first, filter: { team: { name: { eq: $team } } }) {
              nodes { id name description state { name } startDate targetDate }
            }
          }`,
          { team: query.team as string ?? '', first: 50 },
        )
        break
      }
      case 'get_project': {
        data = await this.graphql(
          `query GetProject($id: String!) {
            project(id: $id) { id name description state { name } startDate targetDate teams { nodes { name } } }
          }`,
          { id: query.project_id as string ?? '' },
        )
        break
      }
      default:
        throw new Error(`Linear connector: unknown query type '${query.type}'`)
    }

    return {
      source: `linear:${this.id}`,
      fetched_at: new Date(),
      ttl: 120,
      freshness_score: 1.0,
      data,
    }
  }

  async write(_action: ConnectorAction): Promise<ConnectorResult> {
    throw new Error('Linear connector is read-only in V1')
  }

  async health(): Promise<HealthStatus> {
    try {
      await this.graphql('{ viewer { id } }', {})
      return { status: 'healthy', lastChecked: new Date() }
    } catch (err) {
      return { status: 'unhealthy', message: String(err), lastChecked: new Date() }
    }
  }
}
```

Add `LINEAR_API_KEY` to `apps/gateway/src/config/env.ts` as optional:
```typescript
LINEAR_API_KEY: z.string().optional(),
```

Remove the `execSync` import from `connectors/linear/src/connector.ts`.

**Commit:** `fix(linear): HTTP API with GraphQL variables — closes CLI + injection issues`

---

### S-3 — Datadog connector: replace nonexistent CLI with HTTP API

**File:** `connectors/datadog/src/connector.ts`

`datadog` CLI used does not exist — every call throws `ENOENT`. Replace with Datadog HTTP API v1:

```typescript
import type { CapabilityManifest, ConnectorResult, ConnectorQuery, ConnectorAction, HealthStatus, IConnector } from '@anway/types'

export class DatadogConnector implements IConnector {
  readonly id: string
  readonly capabilities: CapabilityManifest = { read: ['*'], write: [] }
  private readonly baseUrl = 'https://api.datadoghq.com/api/v1'

  constructor(
    id: string,
    private readonly apiKey: string,
    private readonly appKey: string,
  ) {
    this.id = id
  }

  private async ddFetch(path: string, body?: unknown): Promise<unknown> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'DD-API-KEY': this.apiKey,
        'DD-APPLICATION-KEY': this.appKey,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!resp.ok) throw new Error(`Datadog API ${resp.status}: ${await resp.text()}`)
    return resp.json()
  }

  async read(query: ConnectorQuery): Promise<ConnectorResult> {
    let data: unknown
    const ttl = query.type === 'get_metrics' || query.type === 'search_logs' ? 30 : 120

    switch (query.type) {
      case 'get_metrics': {
        const from = (query.from as number) ?? Math.floor(Date.now() / 1000) - 3600
        const to = (query.to as number) ?? Math.floor(Date.now() / 1000)
        const service = query.service as string ?? ''
        const metric = (query.metric as string) ?? 'trace.servlet.request.hits'
        data = await this.ddFetch(`/query?from=${from}&to=${to}&query=avg:${encodeURIComponent(metric)}%7Bservice:${encodeURIComponent(service)}%7D`)
        break
      }
      case 'list_monitors': {
        const q = query.query as string ?? ''
        data = await this.ddFetch(`/monitor${q ? `?name=${encodeURIComponent(q)}` : ''}`)
        break
      }
      case 'get_monitor': {
        const id = query.monitor_id as string ?? ''
        data = await this.ddFetch(`/monitor/${encodeURIComponent(id)}`)
        break
      }
      case 'search_logs': {
        const q = query.query as string ?? ''
        const from = (query.from as string) ?? 'now-1h'
        const to = (query.to as string) ?? 'now'
        data = await this.ddFetch('/logs-queries/list', {
          query: q,
          time: { from, to },
          limit: 50,
          sort: 'desc',
        })
        break
      }
      case 'list_dashboards': {
        data = await this.ddFetch('/dashboard')
        break
      }
      default:
        throw new Error(`Datadog connector: unknown query type '${query.type}'`)
    }

    return { source: `datadog:${this.id}`, fetched_at: new Date(), ttl, freshness_score: 1.0, data }
  }

  async write(_action: ConnectorAction): Promise<ConnectorResult> {
    throw new Error('Datadog connector is read-only in V1')
  }

  async health(): Promise<HealthStatus> {
    try {
      await this.ddFetch('/validate')
      return { status: 'healthy', lastChecked: new Date() }
    } catch (err) {
      return { status: 'unhealthy', message: String(err), lastChecked: new Date() }
    }
  }
}
```

Add `DATADOG_API_KEY` and `DATADOG_APP_KEY` to `apps/gateway/src/config/env.ts` as optional.

**Commit:** `fix(datadog): Datadog HTTP API v1 replaces nonexistent CLI`

---

### S-4 — Tenant isolation in automations routes

**File:** `apps/gateway/src/routes/automations.ts`

`activeTriggers` module-level array is shared across all tenants. `GET /triggers` and `POST /evaluate` both operate on all tenants' rules.

**Fix — filter by `tenantId` everywhere:**

```typescript
// GET /api/automations/triggers
async (request) => {
  const { tenantId } = request.user as { tenantId: string }
  return activeTriggers
    .filter(t => t.tenantId === tenantId)
    .map(t => ({ id: t.id, eventType: t.eventType, enabled: t.enabled, actionCount: t.actions.length }))
}

// POST /api/automations/evaluate
async (request) => {
  const { tenantId } = request.user as { tenantId: string }
  const { eventType, payload } = request.body
  const tenantEngine = new TriggerEngine()
  tenantEngine.loadRules(activeTriggers.filter(t => t.tenantId === tenantId))
  const actions = await tenantEngine.evaluate(eventType, payload)
  return { matched: actions.length, actions }
}
```

Also replace `id: \`trigger-${Date.now()}\`` with `id: crypto.randomUUID()`.

**Commit:** `fix(automations): filter triggers by tenantId; UUID for trigger IDs`

---

### S-5 — Auth headers not forwarded in web proxy

**File:** `apps/web/app/api/chat/route.ts`

Browser's `Authorization` header is dropped. Gateway cannot identify user — all requests are anonymous.

**Fix:**
```typescript
const response = await fetch(`${GATEWAY_URL}/api/chat`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(request.headers.get('Authorization')
      ? { Authorization: request.headers.get('Authorization')! }
      : {}),
    ...(request.headers.get('Cookie')
      ? { Cookie: request.headers.get('Cookie')! }
      : {}),
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(5 * 60 * 1000),
})
```

**Commit:** `fix(web): forward Authorization + Cookie headers; add AbortSignal timeout`

---

## BROKEN — Fix before integration testing

### B-1 — KB migration missing UNIQUE constraints — upserts broken

**File:** `apps/gateway/prisma/migrations/` (new migration) + `packages/agent/src/kb/structural-graph.ts`

`upsertEntity` conflict target is `(id)` — id is auto-generated, conflict never fires → every call inserts new row.
`upsertRelationship` uses `ON CONFLICT DO NOTHING` with no column list → Postgres error on every call.

**Fix — create migration `0004_kb_unique_constraints`:**

File: `apps/gateway/prisma/migrations/0004_kb_unique_constraints/migration.sql`
```sql
ALTER TABLE entities ADD CONSTRAINT entities_tenant_type_name_unique
  UNIQUE (tenant_id, type, name);

ALTER TABLE relationships ADD CONSTRAINT relationships_edge_unique
  UNIQUE (from_entity_id, rel_type, to_entity_id);
```

**Fix `upsertEntity` in `structural-graph.ts`:**
```typescript
async upsertEntity(entity: EntitySpec, tenantId: TenantId): Promise<string> {
  const result = await this.query<{ id: string }>(
    `INSERT INTO entities (tenant_id, type, name, metadata)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, type, name) DO UPDATE
       SET metadata = EXCLUDED.metadata, updated_at = NOW()
     RETURNING id`,
    [tenantId, entity.type, entity.name, JSON.stringify(entity.metadata ?? {})],
  )
  return result[0]!.id
}
```

**Fix `upsertRelationship` in `structural-graph.ts`:**
```typescript
async upsertRelationship(rel: RelationshipSpec, tenantId: TenantId): Promise<string> {
  const result = await this.query<{ id: string }>(
    `INSERT INTO relationships (tenant_id, from_entity_id, rel_type, to_entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (from_entity_id, rel_type, to_entity_id) DO NOTHING
     RETURNING id`,
    [tenantId, rel.fromEntityId, rel.relType, rel.toEntityId, JSON.stringify(rel.metadata ?? {})],
  )
  return result[0]?.id ?? ''
}
```

**Commit:** `fix(kb): add UNIQUE constraints migration; fix upsertEntity + upsertRelationship`

---

### B-2 — `resolveContext` called with entity name, not entity ID (do this BEFORE B-3)

**Files:** `packages/agent/src/orchestrator.ts`, `packages/agent/src/kb/structural-graph.ts`, `packages/agent/src/interfaces/knowledge-graph.ts`

`resolveContext(entityId, ...)` does `WHERE id = $1`. Orchestrator passes entity name (e.g. `"payments-api"`) — UUID lookup always returns null. Graph context never injected.

**Fix — add `resolveContextByName` to interface and implementation:**

```typescript
// interfaces/knowledge-graph.ts — add to IKnowledgeGraph:
resolveContextByName(name: string, tenantId: TenantId, depth?: number): Promise<AgentContext | null>
```

```typescript
// structural-graph.ts — add implementation:
async resolveContextByName(name: string, tenantId: TenantId, depth = 2): Promise<AgentContext | null> {
  const rows = await this.query<{ id: string }>(
    `SELECT id FROM entities WHERE tenant_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [tenantId, name],
  )
  if (rows.length === 0) return null
  return this.resolveContext(rows[0]!.id, tenantId, depth)
}
```

**Fix orchestrator to call `resolveContextByName`:**
```typescript
// packages/agent/src/orchestrator.ts
if (entityName) {
  const context = await config.knowledgeGraph.resolveContextByName(entityName, ctx.tenantId, 2)
  if (context?.primaryEntity) {
    const parts = [`Graph context for "${context.primaryEntity.name}" (${context.primaryEntity.type}):`]
    for (const rel of context.relationships.slice(0, 10)) {
      // Resolve names from entities map
      const fromName = rel.fromEntityId === context.primaryEntity.id
        ? context.primaryEntity.name
        : context.relatedEntities.find(e => e.id === rel.fromEntityId)?.name ?? rel.fromEntityId
      const toName = context.relatedEntities.find(e => e.id === rel.toEntityId)?.name ?? rel.toEntityId
      parts.push(`  ${rel.relType}: ${fromName} → ${toName}`)
    }
    if (context.freshness < 0.5) parts.push('  [STALE] Verify critical facts from live source.')
    graphContext = parts.join('\n')
  }
}
```

**Commit:** `fix(kb): resolveContextByName — name lookup; fix UUID leakage in context string`

---

### B-3 — `StructuralGraph` uses `pg.Pool` — gateway has only Prisma (do after B-2)

**File:** `packages/agent/src/kb/structural-graph.ts`

`DbPool.query(sql, params)` matches the `pg` npm package API, not Prisma. `pg` is not in gateway deps.

**Fix — use `prisma.$queryRawUnsafe` instead:**

```typescript
import type { PrismaClient } from '@prisma/client'
import type { TenantId } from '@anway/types'
import type { IKnowledgeGraph, Entity, Relationship, KBEntry, Episode, Fact, AgentContext, EntitySpec, RelationshipSpec } from '../interfaces/knowledge-graph.js'
import { withTenant } from '../../apps/gateway/src/db/prisma.js'  // or pass prisma from gateway

export class StructuralGraph implements IKnowledgeGraph {
  constructor(private readonly prisma: PrismaClient) {}

  private async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.prisma.$queryRawUnsafe<T[]>(sql, ...params)
  }

  // All other methods unchanged — replace this.pool.query with this.query
}
```

> **RLS note:** `StructuralGraph` methods already filter by `tenant_id = $1` in every SQL query, so data is isolated even without RLS policy enforcement. For defense-in-depth, calls from `chat.ts` should eventually wrap in `withTenant`, but for V1 the explicit filter is sufficient.

Remove the `DbPool` type. Remove the `pool` constructor parameter.

Wire in `apps/gateway/src/routes/chat.ts`:
```typescript
import { StructuralGraph } from '@anway/agent'

// In chatRoutes, after prisma is defined:
const knowledgeGraph = new StructuralGraph(prisma)

// In createOrchestrator call:
const orchestrator = createOrchestrator({
  model: provider,
  tools: connectorTools,
  perimeter,
  auditSink,
  sessionMemory,
  knowledgeGraph,   // ADD THIS
  budget,
  maxSteps: 10,
})
```

Export `StructuralGraph` from `packages/agent/src/index.ts`.

**Commit:** `fix(kb): StructuralGraph uses Prisma $queryRawUnsafe; wire into orchestrator`

---

### B-4 — Graph Builder FK violations on external IDs

**File:** `packages/agent/src/agents/graph-builder.ts`

`handleTicketCreated` uses `ticketId` (Linear string like `"LIN-123"`) as `fromEntityId` in relationship.
`handlePrMerged` uses `ticketMatch[1]` (raw number string `"123"`) as `toEntityId`.
Both fail FK `from/to_entity_id → entities(id)` — UUID expected.

**Fix `handleTicketCreated`:**
```typescript
async handleTicketCreated(payload: TicketCreatedPayload): Promise<void> {
  const { ticketId, tenantId, title, description, labels } = payload
  const tenant = tenantId as TenantId

  const ticketEntity: EntitySpec = {
    type: 'Ticket',
    name: title,
    metadata: { externalId: ticketId, description, labels, source: 'linear' },  // store externalId in metadata
  }
  const dbTicketId = await this.kg.upsertEntity(ticketEntity, tenant)  // capture DB UUID

  const serviceName = this.extractServiceName(title, description, labels)
  if (serviceName && dbTicketId) {
    const serviceId = await this.kg.upsertEntity({ type: 'Service', name: serviceName }, tenant)
    await this.kg.upsertRelationship(
      { fromEntityId: dbTicketId, relType: 'RELATES_TO', toEntityId: serviceId, metadata: { confidence: 0.7 } },
      tenant,
    )
  }
}
```

**Fix `handlePrMerged`:**
```typescript
async handlePrMerged(payload: PrMergedPayload): Promise<void> {
  const { repo, tenantId, commitSha, commitMessage, author } = payload
  const tenant = tenantId as TenantId

  const commitId = await this.kg.upsertEntity(
    { type: 'Commit', name: commitSha.slice(0, 7), metadata: { repo, author, message: commitMessage } },
    tenant,
  )

  const ticketMatch = commitMessage.match(/(?:fixes|closes|resolves)\s+#(\d+)/i)
  if (ticketMatch && commitId) {
    // Look up ticket by externalId stored in metadata
    const ticketEntityId = await this.kg.getEntityByExternalRef(ticketMatch[1]!, tenant)
    if (ticketEntityId) {
      await this.kg.upsertRelationship(
        { fromEntityId: commitId, relType: 'FIXES', toEntityId: ticketEntityId, metadata: { confidence: 0.9 } },
        tenant,
      )
    }
  }
}
```

**Add `getEntityByExternalRef` to interface and StructuralGraph:**
```typescript
// IKnowledgeGraph interface:
getEntityByExternalRef(externalId: string, tenantId: TenantId): Promise<string | null>

// StructuralGraph implementation:
async getEntityByExternalRef(externalId: string, tenantId: TenantId): Promise<string | null> {
  const rows = await this.query<{ id: string }>(
    `SELECT id FROM entities WHERE tenant_id = $1 AND metadata->>'externalId' = $2 LIMIT 1`,
    [tenantId, externalId],
  )
  return rows[0]?.id ?? null
}
```

**Commit:** `fix(graph-builder): DB UUIDs in FK relationships; add getEntityByExternalRef`

---

### B-5 — `SREAgent` uses invalid model IDs

**File:** `packages/agent/src/agents/sre.ts`

`{ model: 'haiku' }` and `{ model: 'sonnet' }` rejected by providers. Full IDs required.

**Fix:**
```typescript
export class SREAgent {
  constructor(
    private readonly cheapModel: IModelProvider,
    private readonly mainModel: IModelProvider,
    private readonly cheapModelId = 'claude-haiku-3-5-20251001',
    private readonly mainModelId = 'claude-sonnet-4-6',
  ) {}

  async assembleContext(alertTitle: string, alertDescription: string): Promise<IncidentContext> {
    const entityExtraction = await this.cheapModel.chat([...], [], {
      model: this.cheapModelId, maxTokens: 50, temperature: 0,
    })
    const hypothesisResult = await this.mainModel.chat([...], [], {
      model: this.mainModelId, maxTokens: 500, temperature: 0,
    })
    // rest unchanged
  }
}
```

**Commit:** `fix(sre): real model IDs via constructor params`

---

### B-6 — Web route tests broken in CI

**File:** `apps/web/app/api/chat/route.test.ts`

`fetch('http://localhost:4000/api/chat')` throws ECONNREFUSED in test → caught → 502 JSON → `Content-Type: text/event-stream` assertion fails.

**Fix — mock global fetch in tests:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

const encoder = new TextEncoder()

beforeEach(() => {
  const mockStream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"text_delta","content":"stub response"}\n\n'))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(mockStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  ))
})

// existing tests unchanged
```

**Verify:** `pnpm --filter @anway/web test` all green.

**Commit:** `test(web): mock gateway fetch — fixes CI test failures`

---

### B-7 — `IncidentService` RLS bypass; duplicate PrismaClient; 404 missing

**Files:** `apps/gateway/src/routes/incidents.ts`, `apps/gateway/src/services/incident.ts`

Three issues in one:
1. `IncidentService` calls Prisma without `withTenant` — RLS not set
2. `incidents.ts` creates its own `new PrismaClient()` — second connection pool
3. Missing 404 on not-found incidents and silent no-op on update of nonexistent record

**Fix 1 — shared Prisma singleton:**

Create `apps/gateway/src/db/client.ts`:
```typescript
import { PrismaClient } from '@prisma/client'
export const prisma = new PrismaClient()
```

Update `apps/gateway/src/routes/chat.ts` — replace `const prisma = new PrismaClient()` with:
```typescript
import { prisma } from '../db/client.js'
```

Update `apps/gateway/src/routes/incidents.ts` — remove `const prisma = new PrismaClient()`:
```typescript
import { prisma } from '../db/client.js'
```

**Fix 2 — `IncidentService` wraps all DB in `withTenant`:**
```typescript
import { withTenant } from '../db/prisma.js'

async create(tenantId: string, data: { title: string; severity: IncidentSeverity; description?: string }) {
  return withTenant(this.prisma, tenantId, (tx) =>
    tx.incident.create({ data: { tenant_id: tenantId, ...data, status: 'active' as IncidentStatus } })
  )
}

async get(id: string, tenantId: string) {
  return withTenant(this.prisma, tenantId, (tx) =>
    tx.incident.findFirst({ where: { id, tenant_id: tenantId } })
  )
}

async list(tenantId: string, filters?: { status?: IncidentStatus; severity?: IncidentSeverity }) {
  return withTenant(this.prisma, tenantId, (tx) =>
    tx.incident.findMany({ where: { tenant_id: tenantId, ...filters }, orderBy: { created_at: 'desc' }, take: 50 })
  )
}

async update(id: string, tenantId: string, data: Partial<{ title: string; status: IncidentStatus }>) {
  return withTenant(this.prisma, tenantId, (tx) =>
    tx.incident.updateMany({ where: { id, tenant_id: tenantId }, data })
  )
}

async resolve(id: string, tenantId: string) {
  return withTenant(this.prisma, tenantId, (tx) =>
    tx.incident.updateMany({ where: { id, tenant_id: tenantId }, data: { status: 'resolved' as IncidentStatus, resolved_at: new Date() } })
  )
}
```

**Fix 3 — proper 404:**
```typescript
// GET /api/incidents/:id
const incident = await service.get(id, tenantId)
if (!incident) { reply.code(404); return { error: 'Incident not found' } }
return incident

// PATCH /api/incidents/:id
const result = await service.update(id, tenantId, updates)
if (result.count === 0) { reply.code(404); return { error: 'Incident not found' } }
return { ok: true }
```

**Commit:** `fix(incidents): shared Prisma; withTenant RLS; 404 on not-found`

---

## CONNECTOR WIRING — Make tools real

### C-1 — Add ArgoCD tool builder

**File:** `connectors/argocd/src/` — missing `tools.ts`

No `makeArgoCDTools` exported. Registry can't build tools for ArgoCD. Create following GitHub pattern:

```typescript
// connectors/argocd/src/tools.ts
import type { ConnectorQuery } from '@anway/types'
import type { ArgoCDConnector } from './connector.js'

export function makeArgoCDTools(connector: ArgoCDConnector) {
  const prefix = 'argocd'
  const toolDefs = [
    {
      name: `${prefix}.list_applications`,
      description: 'List ArgoCD applications',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: `${prefix}.get_application`,
      description: 'Get details of an ArgoCD application',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name' } } },
    },
    {
      name: `${prefix}.get_sync_status`,
      description: 'Get sync and health status of an ArgoCD application',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name' } } },
    },
    {
      name: `${prefix}.get_application_history`,
      description: 'Get deployment history of an ArgoCD application',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name' } } },
    },
  ]

  return toolDefs.map((def) => ({
    ...def,
    async run(args: Record<string, unknown>) {
      const query: ConnectorQuery = { type: def.name.split('.')[1]!, ...args }
      const result = await connector.read(query)
      return result.data
    },
  }))
}
```

Update `connectors/argocd/src/index.ts`:
```typescript
export { ArgoCDConnector } from './connector.js'
export { makeArgoCDTools } from './tools.js'
```

**Commit:** `feat(argocd): add makeArgoCDTools; export from index`

---

### C-2 — Add Linear and Datadog tool builders

**Files:** `connectors/linear/src/tools.ts`, `connectors/datadog/src/tools.ts`

Same pattern as GitHub and ArgoCD. Create `makeLinearTools` and `makeDatadogTools`. Export from each package's `index.ts`.

For Linear tools: `list_issues`, `get_issue`, `list_projects`, `get_project`
For Datadog tools: `get_metrics`, `list_monitors`, `get_monitor`, `search_logs`, `list_dashboards`

**Commit:** `feat(connectors): add makeLinearTools and makeDatadogTools`

---

### C-3 — Wire real connectors into gateway registry

**File:** `apps/gateway/src/connectors/registry.ts`

`loadConnectors` creates mock stubs for all DB rows. Replace with real connector dispatch.

**Fix:**
```typescript
import { GitHubConnector, makeGitHubTools } from '@anway/connector-github'
import { LinearConnector, makeLinearTools } from '@anway/connector-linear'
import { ArgoCDConnector, makeArgoCDTools } from '@anway/connector-argocd'
import { DatadogConnector, makeDatadogTools } from '@anway/connector-datadog'

function createConnectorWithTools(row: ConnectorRow): { connector: IConnector; tools: ExecutableTool[] } {
  const raw = row.capability_manifest as { capabilities?: { read?: string[]; write?: string[] } } | null
  const capabilities: CapabilityManifest = {
    read: raw?.capabilities?.read ?? ['*'],
    write: raw?.capabilities?.write ?? [],
  }

  switch (row.type) {
    case 'github': {
      const c = new GitHubConnector(row.id)
      return { connector: c, tools: makeGitHubTools(c) }
    }
    case 'linear': {
      const c = new LinearConnector(row.id)
      return { connector: c, tools: makeLinearTools(c) }
    }
    case 'argocd': {
      const c = new ArgoCDConnector(row.id)
      return { connector: c, tools: makeArgoCDTools(c) }
    }
    case 'datadog': {
      const c = new DatadogConnector(row.id, process.env['DATADOG_API_KEY'] ?? '', process.env['DATADOG_APP_KEY'] ?? '')
      return { connector: c, tools: makeDatadogTools(c) }
    }
    default:
      return { connector: createMockConnector(row, capabilities), tools: [] }
  }
}

export async function getToolsForTenant(prisma: PrismaClient, tenantId: string): Promise<ExecutableTool[]> {
  const connectors = await withTenant(prisma, tenantId, (tx) =>
    tx.connector.findMany({ where: { tenant_id: tenantId } })
  )
  return connectors.flatMap(row => createConnectorWithTools(row).tools)
}
```

Add workspace deps to `apps/gateway/package.json`:
```json
"@anway/connector-github": "workspace:*",
"@anway/connector-linear": "workspace:*",
"@anway/connector-argocd": "workspace:*",
"@anway/connector-datadog": "workspace:*"
```

Run `pnpm install` after updating package.json. Commit the updated `pnpm-lock.yaml`.

**Commit:** `feat(registry): dispatch real connectors by type; wire all tool builders`

---

## INTEGRATION — End-to-end

### I-1 — Wire OrchestratorChat to real /api/chat SSE

**File:** `apps/web/components/orchestrator-chat.tsx`

Currently uses `SCENARIOS` from `@/lib/mock`. Replace with real streaming. Do NOT modify any UI layout, styling, or other components. Only replace the data source in the send-message handler.

Key implementation points:
- `sessionId = useRef(crypto.randomUUID())` — stable per browser tab
- `fetch('/api/chat', { method: 'POST', body: JSON.stringify({ query, sessionId: sessionId.current }) })`
- Stream via `response.body.getReader()` + `TextDecoder`
- Parse `data: {...}` SSE lines
- `text_delta` → append to message content
- `tool_call` → add to activity trace
- `tool_result` → add to activity trace  
- `done` → mark streaming complete, show token counts
- `error` → show error state
- Do NOT remove `@/lib/mock` imports used by other parts of the component (scenario list, etc.)

**Verify:** `pnpm --filter @anway/web dev` → send query → confirm real LLM stream renders (not mock data).

**Commit:** `feat(web): OrchestratorChat real SSE stream; remove mock data source`

---

### I-2 — Add gateway + web to docker-compose

**File:** `infra/docker-compose.yml`

Add after redis service:
```yaml
  gateway:
    build:
      context: ..
      dockerfile: apps/gateway/Dockerfile
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER:-anway}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-anway_dev}
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      LINEAR_API_KEY: ${LINEAR_API_KEY:-}
      DATADOG_API_KEY: ${DATADOG_API_KEY:-}
      DATADOG_APP_KEY: ${DATADOG_APP_KEY:-}
      PORT: "4000"
      HOST: "0.0.0.0"
    ports:
      - "4000:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:4000/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - anway-dev

  web:
    build:
      context: ..
      dockerfile: apps/web/Dockerfile
    environment:
      GATEWAY_URL: http://gateway:4000
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      gateway:
        condition: service_healthy
    networks:
      - anway-dev
```

Update `infra/.env.example` — add missing keys:
```
JWT_SECRET=changeme-32-chars-minimum
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
LINEAR_API_KEY=
DATADOG_API_KEY=
DATADOG_APP_KEY=
GATEWAY_URL=http://localhost:4000
```

**Commit:** `feat(infra): add gateway + web to docker-compose; update .env.example`

---

### I-3 — Fix seed: manifest format + demo KB entities

**File:** `apps/gateway/prisma/seed.ts`

Current seed writes wrong manifest format and has a broken `SET LOCAL` outside a transaction.

**Fix:**
1. Remove `await prisma.$executeRawUnsafe(\`SET LOCAL app.tenant_id = '${tenant.id}'\`)` — no-op outside transaction; superuser bypasses RLS anyway in seed context.
2. Fix all `capability_manifest` values to nested format:
   ```typescript
   capability_manifest: { capabilities: { read: ['org/*'], write: [] } }
   ```
3. Add more demo connectors using `createMany` with `skipDuplicates: true`:
   ```typescript
   await prisma.connector.createMany({
     skipDuplicates: true,
     data: [
       { tenant_id: tenant.id, name: 'Linear (Demo)', type: 'linear', mode: 'read', config_encrypted: {}, capability_manifest: { capabilities: { read: ['*'], write: [] } } },
       { tenant_id: tenant.id, name: 'PagerDuty (Demo)', type: 'pagerduty', mode: 'read', config_encrypted: {}, capability_manifest: { capabilities: { read: ['*'], write: [] } } },
       { tenant_id: tenant.id, name: 'ArgoCD (Demo)', type: 'argocd', mode: 'read', config_encrypted: {}, capability_manifest: { capabilities: { read: ['*'], write: [] } } },
     ],
   })
   ```
4. Seed KB entities so `resolveContextByName` has something to resolve:
   ```typescript
   await prisma.$executeRaw`
     INSERT INTO entities (tenant_id, type, name, metadata)
     VALUES
       (${tenant.id}::uuid, 'Service', 'payments-api', '{"language":"TypeScript","tier":"critical"}'::jsonb),
       (${tenant.id}::uuid, 'Service', 'auth-service', '{"language":"Go","tier":"critical"}'::jsonb),
       (${tenant.id}::uuid, 'Team', 'platform', '{"slack":"#platform"}'::jsonb)
     ON CONFLICT (tenant_id, type, name) DO NOTHING
   `
   ```

**Commit:** `fix(seed): correct manifest format; add demo connectors + KB entities`

---

### I-4 — Persist triggers in DB

**Files:** `apps/gateway/src/routes/automations.ts`, new migration

In-process `activeTriggers[]` is lost on restart. Store in DB.

**Create migration `apps/gateway/prisma/migrations/0005_triggers/migration.sql`:**
```sql
CREATE TABLE IF NOT EXISTS trigger_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  condition JSONB NOT NULL DEFAULT '{}',
  actions JSONB NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trigger_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_trigger_rules ON trigger_rules
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

CREATE INDEX IF NOT EXISTS idx_trigger_rules_tenant_event ON trigger_rules (tenant_id, event_type);
```

**Update `automations.ts` routes to use DB:**
```typescript
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'

// GET — load from DB
async (request) => {
  const { tenantId } = request.user as { tenantId: string }
  const rules = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw`SELECT * FROM trigger_rules WHERE tenant_id = ${tenantId}::uuid AND enabled = true`
  )
  return rules
}

// POST — persist to DB
async (request) => {
  const { tenantId } = request.user as { tenantId: string }
  const { eventType, condition, actions } = request.body
  const rule = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw`
      INSERT INTO trigger_rules (tenant_id, event_type, condition, actions)
      VALUES (${tenantId}::uuid, ${eventType}, ${JSON.stringify(condition ?? {})}::jsonb, ${JSON.stringify(actions)}::jsonb)
      RETURNING *
    `
  )
  return rule
}
```

Remove `activeTriggers[]` module-level array and all references to it.

**Commit:** `feat(automations): persist trigger rules in DB; migration 0005`

---

### I-5 — Fix `initSession` called for all memory implementations

**File:** `apps/gateway/src/routes/chat.ts`

`initSession` only called when `sessionMemory instanceof RedisSessionMemory`. `InMemorySessionMemory.initSession` is never called → fake identity (`userId: 'unknown'`).

**Fix — call unconditionally:**
```typescript
try {
  await sessionMemory.initSession({
    sessionId: SessionId(sessionId),
    userId: UserId(userId),
    tenantId: TenantId(tenantId),
    effectiveRole: (role as AgentRole) ?? 'dev',
  })
} catch (err) {
  request.log.warn({ err, sessionId }, 'initSession failed — session identity may be incomplete')
}
```

**Commit:** `fix(gateway): initSession unconditional — fixes InMemorySessionMemory identity`

---

### I-6 — Bootstrap logger regression fix

**File:** `apps/gateway/src/server.ts`

`bootstrapLog` was removed. `app.log.error` in catch fails if `buildApp()` throws (app undefined → TypeError → original error swallowed).

**Fix:**
```typescript
import pino from 'pino'
const bootstrapLog = pino({ level: 'info' })

async function main() {
  const env = validateEnv()
  let app: Awaited<ReturnType<typeof buildApp>> | undefined

  try {
    initMetrics()
    app = await buildApp()
    await app.listen({ port: env.PORT, host: env.HOST })
    app.log.info({ port: env.PORT, host: env.HOST }, 'gateway server started')
  } catch (err) {
    const log = app?.log ?? bootstrapLog
    log.error({ err }, 'failed to start server')
    process.exit(1)
  }
}
```

**Commit:** `fix(gateway): restore bootstrap logger fallback`

---

### I-7 — Full integration smoke test

Run after I-1 through I-6 complete:

```bash
# From repo root
pnpm typecheck                                     # must be 0 errors
pnpm --filter @anway/agent test                    # all green
pnpm --filter anway-gateway test                   # all green
pnpm --filter @anway/web test                      # all green

# Docker
docker build -t anway-gateway -f apps/gateway/Dockerfile .
cd infra && cp .env.example .env
# Edit .env: set JWT_SECRET, add at least ANTHROPIC_API_KEY
docker compose up -d --build
docker compose ps   # wait for all services healthy

# Migrations + seed
docker compose exec gateway sh -c "cd /app && npx prisma migrate deploy"
docker compose exec gateway sh -c "cd /app && npx tsx prisma/seed.ts"

# Smoke
curl http://localhost:4000/health     # {"status":"ok"}
curl http://localhost:3000            # HTML

# Manual: open browser → http://localhost:3000 → Chat → send "what is payments-api?" → real LLM stream
```

Post result in `docs/BRIDGE.md` as STATUS entry.

**Commit:** `chore: integration smoke test complete — Wave complete`

---

## CLEANUP — Final polish

### CL-1 — WRITE_SUFFIXES false positive in perimeter engine
**File:** `packages/agent/src/perimeter/engine.ts`
```typescript
// Before (substring match — autocreate matches create):
const isWrite = WRITE_SUFFIXES.some(s => toolCall.name.includes(s))

// After (whole-word split):
const actionParts = toolCall.name.split(/[._-]/)
const isWrite = WRITE_SUFFIXES.some(s => actionParts.includes(s))
```
**Commit:** `fix(perimeter): whole-word WRITE_SUFFIXES check`

### CL-2 — UUID validation before Prisma in chat.ts
**File:** `apps/gateway/src/routes/chat.ts`
```typescript
import { validate as isUuid } from 'uuid'
if (!isUuid(tenantId)) return reply.code(400).send({ error: 'Invalid tenantId' })
```
**Commit:** `fix(gateway): validate tenantId UUID at route entry`

### CL-3 — Remove AppError re-export from AnthropicProvider
**File:** `packages/agent/src/providers/anthropic.ts`
Remove `export { AppError }` — belongs in `@anway/types` not a provider.
**Commit:** `fix(anthropic): remove AppError re-export`

### CL-4 — Ollama null content for assistant+tool_calls
**File:** `packages/agent/src/providers/ollama.ts`
`content: ''` → `content: null` for assistant messages with `tool_calls`.
**Commit:** `fix(ollama): null content for assistant+tool_calls`

### CL-5 — Token estimation includes tool definitions
**File:** `packages/agent/src/orchestrator.ts`
```typescript
const toolTokens = toolDefs.reduce((acc, t) => acc + Math.ceil(JSON.stringify(t).length / 4), 0)
const estimatedTokens = msgTokens + toolTokens + 500
```
**Commit:** `fix(orchestrator): include tool defs in token estimation`

---

## Acceptance Criteria — ALL required

| Check | Command | Expected |
|-------|---------|----------|
| No shell injection | `grep -rn "execSync\`" connectors/` | 0 results |
| TypeScript | `pnpm typecheck` | 0 errors |
| Agent tests | `pnpm --filter @anway/agent test` | All green |
| Gateway tests | `pnpm --filter anway-gateway test` | All green |
| Web tests | `pnpm --filter @anway/web test` | All green |
| Docker build | `docker compose -f infra/docker-compose.yml build` | Exit 0 |
| Stack healthy | `docker compose -f infra/docker-compose.yml up -d` | All services healthy |
| Gateway health | `curl http://localhost:4000/health` | `{"status":"ok"}` |
| UI loads | `curl http://localhost:3000` | HTML response |
| Real LLM stream | Query in OrchestratorChat | Real response, no mock |
| Tenant isolation | Cross-tenant data test | No leakage |

---

## Execution Order

```
Security:     S-0 → S-1 → S-2 → S-3 → S-4 → S-5
Broken fixes: B-1 → B-2 → B-3 → B-4 → B-5 → B-6 → B-7
              ↑ B-2 (resolveContextByName) MUST come before B-3 (wire knowledgeGraph)
              ↑ Do NOT wire knowledgeGraph into orchestrator until B-2 interface is complete
Connectors:   C-1 → C-2 → C-3
Integration:  I-1 → I-2 → I-3 → I-4 → I-5 → I-6 → I-7
Cleanup:      CL-1 → CL-2 → CL-3 → CL-4 → CL-5
```

**Total: 26 tasks.** Work in order. Do not skip.
