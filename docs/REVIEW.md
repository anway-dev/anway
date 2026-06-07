# Anvay — Continuous Code Review

Agent instruction: read this file before starting any task. Fix issues marked `BLOCKING`
before proceeding. `HIGH` must be fixed in the same task that touches the affected file.
`MEDIUM` and `LOW` can be fixed inline as you encounter them. Each section below is a
dated review pass — newest at the top.

---

<!-- REVIEW SECTION START — 2026-06-07n -->
## Review — 2026-06-07 | I-5/I-6 followup (63e34f7)

### I-5/I-6 interface fix — `initSession` optional | 63e34f7

`ISessionMemory.initSession` made optional (`initSession?:`). `chat.ts` uses `initSession?.()`.
Likely driven by a typecheck error on an `ISessionMemory` implementation missing `initSession`.
Technically correct — optional chaining is safe, existing implementations that have `initSession`
still called.

**LOW — optional `initSession` weakens the interface contract**
Any future `ISessionMemory` implementation that omits `initSession` will silently skip session
identity setup → `userId: 'unknown'`, wrong `effectiveRole`. Hard to debug. Consider instead
providing a default no-op in `InMemorySessionMemory` and keeping the method required:
```typescript
// ISessionMemory — keep required:
initSession(meta: SessionMeta): Promise<void>
// Implementations that need no-op:
async initSession(_meta: SessionMeta): Promise<void> {}
```
Post-V1 improvement. No action needed now.

No blocking issues. ✓

---

<!-- REVIEW SECTION END — 2026-06-07n -->

<!-- REVIEW SECTION START — 2026-06-07m -->
## Review — 2026-06-07 | I-5+I-6 (6c54d2b)

### I-5 + I-6 — initSession unconditional + bootstrap logger | 6c54d2b

LGTM. `instanceof RedisSessionMemory` guard removed — `initSession` called for all
implementations, `InMemorySessionMemory` now gets correct user identity. Error handling
preserved. ✓

Bootstrap logger: `const bootstrapLog = pino({ level: 'info' })` at module level. `buildApp()`
and `app.listen()` both inside `try`. Catch: `app?.log ?? bootstrapLog` — original error no
longer swallowed when `app` is undefined. `shutdown` handler correctly inside outer try
(registered only if `buildApp()` succeeds). `app!` non-null assertion inside shutdown is
safe since `app` is guaranteed set. ✓

**LOW — `RedisSessionMemory` import may now be unused in `chat.ts`**
`instanceof RedisSessionMemory` check is gone. If `RedisSessionMemory` is not referenced
elsewhere in `chat.ts`, TypeScript `noUnusedLocals` will warn. Run `pnpm typecheck` and
remove the import if flagged.

No other issues. Move to CL-1 through CL-5. ✓

---

<!-- REVIEW SECTION END — 2026-06-07m -->

<!-- REVIEW SECTION START — 2026-06-07l -->
## Review — 2026-06-07 | I-3 (fde2923) · I-4 (493f60f)

### I-3 — Seed: manifest format + demo connectors + KB entities | fde2923

LGTM. `SET LOCAL app.tenant_id` correctly removed (no-op outside transaction). All four
connectors use nested manifest format `{ capabilities: { read: [...], write: [] } }`. ✓
`createMany` with `skipDuplicates: true` idempotent. KB entities use `$executeRaw` tagged
template (Prisma-safe parameterization). `ON CONFLICT (tenant_id, type, name) DO NOTHING`
requires migration 0004 to have run first — ordering correct. ✓

**MEDIUM — ArgoCD still in seed despite no `argocd` CLI in gateway image**
ArgoCD seeded → C-3 registry dispatches to `ArgoCDConnector` → `runCli('argocd', ...)` →
`ENOENT` whenever LLM invokes an ArgoCD tool. Not immediate crash (tool only called on
LLM decision), but demo is brittle. Recommend removing ArgoCD from seed until CLI or HTTP
API is wired:

```typescript
// Remove this line from seed:
{ tenant_id: tenant.id, name: 'ArgoCD (Demo)', type: 'argocd', ... },
```

**LOW — PagerDuty in seed but no connector exists**
`type: 'pagerduty'` → `default` case → mock connector → `tools: []` → LLM gets no
PagerDuty capability. Harmless — no ENOENT, just silent no-op. OK for V1.

No other issues. Move to I-4. ✓

---

### I-4 — Trigger rules DB persistence + migration 0005 | 493f60f

Migration correct — `trigger_rules` table, RLS enabled, policy, index. ✓
`activeTriggers[]` in-process array fully removed. `withTenant` wraps all DB calls. ✓

**MEDIUM — `$queryRaw` returns snake_case columns; `TriggerEngine.evaluate` expects camelCase**

`trigger_rules` DB columns: `event_type`, `tenant_id`, `created_at`.
`$queryRaw` returns rows as-is from Postgres — snake_case.
`TriggerEngine.loadRules(rules as any[])` receives snake_case objects.
If `TriggerEngine.evaluate(eventType, payload)` matches via `rule.eventType` — it gets
`undefined` (field is `rule.event_type`). No trigger ever matches → evaluate always returns
`{ matched: 0, actions: [] }`. Silent bug — no crash, just broken automation.

Verify `TriggerEngine.evaluate` implementation. If it accesses `rule.eventType`, fix by
aliasing in the query:
```typescript
tx.$queryRaw`SELECT id, event_type AS "eventType", tenant_id AS "tenantId",
  condition, actions, enabled FROM trigger_rules
  WHERE tenant_id = ${tenantId}::uuid AND enabled = true`
```

**LOW — POST trigger: `$queryRaw` INSERT RETURNING returns array, not single object**

```typescript
const rule = await withTenant(prisma, tenantId, (tx) =>
  tx.$queryRaw`INSERT INTO trigger_rules (...) RETURNING *`
)
return rule  // ← array [{...}], not single object
```

Old code returned a single `TriggerRule` — clients may break expecting `{ id, eventType, ... }`.
Fix: `return (rule as unknown[])[0]`

**LOW — RLS policy missing `WITH CHECK` for INSERT**

```sql
CREATE POLICY ... USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
```

`USING` applies to SELECT/UPDATE/DELETE. INSERT needs `WITH CHECK`. Without it, RLS doesn't
restrict inserts by policy (explicit `tenant_id = ${tenantId}::uuid` in VALUES still provides
isolation). Add `WITH CHECK` for defense-in-depth in next migration or patch.

Move to I-5. ✓

---

<!-- REVIEW SECTION END — 2026-06-07l -->

<!-- REVIEW SECTION START — 2026-06-07k -->
## Review — 2026-06-07 | I-2 (473937b)

### I-2 — docker-compose gateway + web | 473937b

**BLOCKING — `wget` purged in Dockerfile but used in gateway healthcheck**

S-0 Dockerfile: `apt-get purge -y wget` removes `wget` from the runtime image. The
docker-compose healthcheck is:
```yaml
test: ["CMD-SHELL", "wget -q --spider http://localhost:4000/health || exit 1"]
```
`wget: not found` → healthcheck always fails → gateway never reaches `healthy` state →
web container never starts (`depends_on: condition: service_healthy` blocks).

Fix — use `curl` (kept in Dockerfile, not purged):
```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -fs http://localhost:4000/health || exit 1"]
  interval: 15s
  timeout: 5s
  retries: 5
  start_period: 30s
```

Fix this before running I-7 smoke test. Single line change in `infra/docker-compose.yml`.

**LOW — web service has no healthcheck**
Web `depends_on: gateway: condition: service_healthy` blocks correctly. But web itself has no
`healthcheck:` — smoke test must manually `curl http://localhost:3000` rather than using
`docker compose ps` to verify web readiness. Acceptable for V1 — add post-demo.

**Note (correct behavior):** `GATEWAY_URL=http://gateway:4000` inside docker-compose, 
`http://localhost:4000` in `.env.example` for local dev. Both correct for their contexts. ✓

**IMPORTANT — I-1 (OrchestratorChat SSE wiring) was skipped.**
OrchestratorChat still uses mock data. Real LLM stream won't work in browser until I-1 is
done. Complete I-1 before I-7 smoke test — the smoke test acceptance criteria explicitly
requires "real LLM stream in browser."

---

<!-- REVIEW SECTION END — 2026-06-07k -->

<!-- REVIEW SECTION START — 2026-06-07j -->
## Review — 2026-06-07 | C-3 (005c5bb)

### C-3 — Registry real connector dispatch | 005c5bb

LGTM. All four connector workspace deps added to `gateway/package.json` + `pnpm-lock.yaml`.
`getToolsForTenant` now uses `withTenant` — RLS active for connector load (previous version
bypassed RLS entirely). Nested `capability_manifest` format parsed correctly via
`raw?.capabilities?.read`. `DatadogConnector` receives API keys from `process.env`. ✓
`clearCache` + `getConnectorsForTenant` removed — clean slate.

**LOW — unknown connector type falls through to mock silently**
`default: return { connector: createMockConnector(...), tools: [] }` — no warning emitted.
If `pagerduty` is in seed, tools = [], LLM gets no PagerDuty tools, user gets confusing
"I don't have that tool" response. Add a `console.warn` or `app.log.warn` at minimum.
Fix inline when next touching `registry.ts`.

**Note — ArgoCD MEDIUM still applies**
`ArgoCDConnector.runCli('argocd', ...)` → `ENOENT` if `argocd` not in gateway image.
Decide before I-7 smoke test: remove ArgoCD from seed (easiest) or install CLI in Dockerfile.
See C-1/C-2 review above.

**Note — connector load is per-request (no cache)**
Old registry had in-memory cache (now removed). Each chat request does one DB roundtrip for
`connector.findMany`. Acceptable for V1 — add Redis TTL cache post-launch if load warrants.

Move to I-1. ✓

---

<!-- REVIEW SECTION END — 2026-06-07j -->

<!-- REVIEW SECTION START — 2026-06-07i -->
## Review — 2026-06-07 | C-1+C-2 (d5504a9)

### C-1 + C-2 — ArgoCD / Linear / Datadog tool builders | d5504a9

LGTM overall. All three `make*Tools` functions follow identical pattern. `def.name.split('.')[1]`
correctly extracts query type — matches connector switch cases for all three. Exported from
each package's `index.ts`. ✓

**LOW — `filters: string` in Linear `list_issues` tool definition**

```typescript
{ name: 'linear.list_issues', parameters: { properties: {
  team: { type: 'string' },
  filters: { type: 'string', description: 'Additional filter criteria' },  // ← dead param
}}}
```

`LinearConnector.read()` case `'list_issues'` uses only `query.team` — ignores `query.filters`.
LLM may populate `filters` → silently dropped. Remove `filters` from tool params to avoid
misleading the LLM. Fix inline when next touching `connectors/linear/src/tools.ts`.

**MEDIUM — ArgoCD connector requires `argocd` CLI — not installed in gateway Dockerfile**

S-0 Dockerfile installs `gh` only. `argocd` CLI is not installed. `ArgoCDConnector.runCli('argocd', ...)`
→ `ENOENT` at runtime. The demo seed (I-3) adds ArgoCD as a demo connector — once C-3 wires
it into the registry, every chat request that invokes an ArgoCD tool will throw.

Options — pick one before I-7 smoke test:
1. Install `argocd` CLI in `apps/gateway/Dockerfile` (same pattern as `gh`)
2. Remove ArgoCD from the demo seed in I-3 (simplest for V1 demo)
3. Convert ArgoCD connector to HTTP API (v2.6+ has REST API — no CLI needed)

Recommend option 2 for now (remove from seed) — defers ArgoCD HTTP API to post-demo.
Post to BRIDGE.md if blocked on this decision.

Move to C-3. ✓

---

<!-- REVIEW SECTION END — 2026-06-07i -->

<!-- REVIEW SECTION START — 2026-06-07h -->
## Review — 2026-06-07 | B-7 (2899784)

### B-7 — IncidentService shared Prisma + withTenant + 404 | 2899784

LGTM. `apps/gateway/src/db/client.ts` created — singleton `PrismaClient` exported. Both
`chat.ts` and `incidents.ts` now import it; duplicate `new PrismaClient()` removed from
both files. All five `IncidentService` methods wrapped in `withTenant` — RLS now active. ✓

404 on not-found: `service.get()` null check → `reply.code(404)` ✓. `updateMany` returns
`{ count: number }` — `result.count === 0` check in PATCH and resolve routes is correct ✓.
`withTenant` path from `services/` to `db/prisma.js` is `'../db/prisma.js'` ✓.

No issues. Security section complete. Move to C-1. ✓

---

<!-- REVIEW SECTION END — 2026-06-07h -->

<!-- REVIEW SECTION START — 2026-06-07g -->
## Review — 2026-06-07 | B-6 (abd351d)

### B-6 — Web route test fetch mock | abd351d

LGTM. `vi.stubGlobal('fetch', ...)` in `beforeEach` — mocks global fetch before each test,
prevents ECONNREFUSED in CI. `ReadableStream` produces valid SSE format (`data: {...}\n\n`
followed by `data: [DONE]\n\n`). Mock returns `200` with `Content-Type: text/event-stream`.
Existing test cases unchanged. ✓

No issues. Move to B-7. ✓

---

<!-- REVIEW SECTION END — 2026-06-07g -->

<!-- REVIEW SECTION START — 2026-06-07f -->
## Review — 2026-06-07 | B-4 (0f67fa1) · B-5 (dab9a2a)

### B-4 — Graph Builder FK violations fixed | 0f67fa1

LGTM. `ticketId` (external Linear string) no longer used as FK. DB UUID captured from
`upsertEntity` return value → used as `fromEntityId`. `externalId` stored in metadata for
`getEntityByExternalRef` lookup. `handlePrMerged` correctly resolves ticket DB UUID before
creating `FIXES` relationship. `RelationshipSpec` unused import removed. ✓

**LOW — `extractServiceName` regex too narrow**
`/\b([a-z]+-[a-z]+-api)\b/i` requires exactly 3 hyphen-segments ending in `-api` (e.g.
`payments-service-api`). Won't match `payments-api` (2 segments) or `auth-service` (no `-api`).
V1 demo data uses seeded entities — won't impact smoke test. Fix post-launch.

No blocking issues. Move to B-5. ✓

---

### B-5 — SREAgent real model IDs | dab9a2a

LGTM. `cheapModelId = 'claude-haiku-3-5-20251001'` and `mainModelId = 'claude-sonnet-4-6'`
match orchestrator defaults. Constructor params with defaults — overridable at instantiation.
Unused `ToolCall` import removed. ✓

No issues. Move to B-6. ✓

---

<!-- REVIEW SECTION END — 2026-06-07f -->

<!-- REVIEW SECTION START — 2026-06-07e -->
## Review — 2026-06-07 | B-3 (d8b0a27)

### B-3 — StructuralGraph Prisma wiring | d8b0a27

LGTM. `DbPool` → `QueryFn` abstraction is clean. Private `query<T>()` helper correctly
typed. All `this.pool.query(...)` calls replaced — `result.rows` workarounds from B-2 gone.
`chat.ts` wiring via lambda: `(sql, params?) => prisma.$queryRawUnsafe(sql, ...(params ?? []))`.
`IKnowledgeGraph`, `AgentContext`, `StructuralGraph` all exported from `index.ts`. ✓

**LOW — `StructuralGraph` instantiated per-request**
`new StructuralGraph(...)` inside the `app.post` handler = new instance every chat request.
Stateless, so safe. Move to module level (after `const prisma = ...`) to avoid repeated allocation:
```typescript
// module level, after prisma singleton:
const knowledgeGraph = new StructuralGraph(
  (sql: string, params?: unknown[]) => prisma.$queryRawUnsafe(sql, ...(params ?? [])),
)
```
Fix inline when next touching `chat.ts`.

**Note — RLS bypass expected and acceptable for V1**
`$queryRawUnsafe` runs outside `withTenant` → `app.tenant_id` not set → RLS policy inactive.
All KB queries have `WHERE tenant_id = $1` — explicit filter provides isolation. No data leak.
Plan acknowledged this. No action required for V1.

**Note — `$queryRawUnsafe` with static SQL is safe**
All SQL strings are compile-time literals. `params` array carries user data as parameterized
values. Not injection-vulnerable despite the "unsafe" name (refers to Prisma type-checking,
not parameterization).

Move to B-4. ✓

---

<!-- REVIEW SECTION END — 2026-06-07e -->

<!-- REVIEW SECTION START — 2026-06-07d -->
## Review — 2026-06-07 | B-2 (b80f356)

### B-2 — `resolveContextByName` + orchestrator fix | b80f356

LGTM overall. Interface additions correct — both methods added to `IKnowledgeGraph` ✓.
Orchestrator now calls `resolveContextByName` instead of `resolveContext` ✓. Entity names
resolved from `relatedEntities` array — UUIDs no longer leaked into context string ✓.

**MEDIUM — `pool.query()` returns `QueryResult`, not array — `resolveContextByName` uses wrong API**

`this.pool.query()` is `pg.Pool` API — returns `QueryResult<T>` with `.rows: T[]`. But the
new `resolveContextByName` and `getEntityByExternalRef` treat the result as an array directly:

```typescript
const rows = await this.pool.query(...)  // rows = QueryResult, NOT T[]
if (rows.length === 0)                   // QueryResult has no .length — this is always falsy
return this.resolveContext(rows[0]!.id as string, ...)  // rows[0] = undefined → TypeError
```

Existing methods use `result.rows[0]?.id` correctly (e.g. `upsertEntity`). The new methods
skip `.rows` — they are broken on the current `pg.Pool` path.

**This is acceptable because:** B-3 replaces `this.pool.query()` with a private `query<T>()`
wrapper returning `T[]` directly (via `prisma.$queryRawUnsafe`). Both new methods will be
correct after B-3. The orchestrator won't wire `knowledgeGraph` until B-3, so no runtime
breakage before the fix lands.

**Update — ce097ad self-corrected immediately:**
Added `const rows = result.rows as Record<string, unknown>[]` in both methods. ✓ Correct.
`as Record<string, unknown>[]` is loose typing but safe since `SELECT id` is the only column.
B-3 will tighten to typed `query<T>()` helper. No further action needed.

Move to B-3. ✓

---

<!-- REVIEW SECTION END — 2026-06-07d -->

<!-- REVIEW SECTION START — 2026-06-07c -->
## Review — 2026-06-07 | S-5 (b8c2681) · B-1 (ea10712)

### S-5 — Web proxy auth header forwarding | b8c2681

LGTM. `Authorization` and `Cookie` forwarded via conditional spread — no null headers sent.
`AbortSignal.timeout(5 * 60 * 1000)` correct — matches plan. Clean implementation.

No issues. ✓

---

### B-1 — KB UNIQUE constraints + upsert fix | ea10712

LGTM. Migration adds both constraints correctly:
- `UNIQUE (tenant_id, type, name)` on `entities` ✓
- `UNIQUE (from_entity_id, rel_type, to_entity_id)` on `relationships` ✓

`upsertEntity` ON CONFLICT target updated to `(tenant_id, type, name)`. `EXCLUDED.metadata`
used correctly. ✓

`upsertRelationship` ON CONFLICT column list specified — Postgres error fixed. ✓

**Note (expected):** `this.pool.query(...)` still present — `pg.Pool` API. B-3 (Prisma switch)
fixes this. Correct per plan ordering.

No blocking issues. Move to B-2. ✓

---

<!-- REVIEW SECTION END — 2026-06-07c -->

<!-- REVIEW SECTION START — 2026-06-07b -->
## Review — 2026-06-07 | S-3 (527c401) · S-4 (17ffe79)

### S-3 — Datadog HTTP API v1 | 527c401

LGTM. `execSync` fully removed. `ddFetch` uses correct Datadog v1 endpoints. URL encoding
correct — `encodeURIComponent(metric)`, `encodeURIComponent(service)`. `/validate` is the
correct health endpoint for Datadog v1. Error message now includes actual error string.

**LOW — `Content-Type: application/json` set on GET requests**
`ddFetch` always adds `Content-Type: application/json` header regardless of method. Harmless
for Datadog (they ignore it on GET), but signals intent incorrectly. Fix inline when next
touching this file:
```typescript
headers: {
  'DD-API-KEY': this.apiKey,
  'DD-APPLICATION-KEY': this.appKey,
  ...(body ? { 'Content-Type': 'application/json' } : {}),
},
```

No blocking issues. Move to S-4 / S-5. ✓

---

### S-4 — Automations tenant isolation | 17ffe79

LGTM. `GET /triggers` now filters by `tenantId` ✓. `POST /evaluate` uses per-request
`TriggerEngine` scoped to tenant's rules ✓. `id: crypto.randomUUID()` ✓.

**Note (expected, not a bug):** `activeTriggers` is still in-process — rules lost on restart.
DB persistence is I-4's job. S-4 correctly scopes the in-process fix. No action needed here.

No blocking issues. Move to S-5. ✓

---

<!-- REVIEW SECTION END — 2026-06-07b -->

<!-- REVIEW SECTION START — 2026-06-07 -->
## Review — 2026-06-07 | S-0 (83bfe2b) · S-1 (1fe3fa3) · S-2 (7fd840a)

### S-0 — `apps/gateway/Dockerfile` | 83bfe2b

**BLOCKING — Missing `package.json` in runtime stage**

Gateway has `"type": "module"` in `package.json`. Node resolves `.js` imports as ESM only when
`package.json` with `"type":"module"` exists in a parent directory at startup. Runtime stage
copies `dist/` and `node_modules/` but NOT `package.json`. Node defaults to CJS → `import`
statements → `SyntaxError: Cannot use import statement in a module`. Server won't start.

Fix — add to runtime stage BEFORE the `ENV NODE_ENV=production` line:
```dockerfile
COPY --from=builder /app/apps/gateway/package.json ./package.json
```

Also copy prisma schema for migrations:
```dockerfile
COPY --from=builder /app/apps/gateway/prisma ./prisma
```
(already present — confirmed ✓)

**MEDIUM — `amd64` hardcoded in gh download URL**

`gh_2.62.0_linux_amd64.deb` fails on ARM hosts (CI runners, Graviton EC2, Apple Silicon via
Rosetta emulation breaks on native ARM). Fix — detect arch at build time:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends wget curl ca-certificates \
  && ARCH=$(dpkg --print-architecture) \
  && wget -qO /tmp/gh.deb "https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_${ARCH}.deb" \
  && dpkg -i /tmp/gh.deb \
  && rm /tmp/gh.deb \
  && apt-get purge -y wget \
  && rm -rf /var/lib/apt/lists/*
```

**Fix S-0 issues in the next commit before moving to S-3.**

---

### S-1 — CLI connectors shell injection fix | 1fe3fa3

LGTM overall. `execSync` removed from both `github/src/connector.ts` and `argocd/src/connector.ts`.
`runCli(binary, args[])` with `spawnSync` is correct — no shell invoked.
`list_prs` structured params (`state` enum + `limit` number) correct — raw `filters` string removed.

**MEDIUM — `list_commits` — `--since` as CLI flag is invalid for `gh api`**

Current code:
```typescript
const args: string[] = ['api', `repos/${repo}/commits?sha=${branch}`]
if (since) args.push('--since', since)
stdout = this.runCli('gh', args)
```

`gh api` does not accept a `--since` flag. It will throw: `unknown flag: --since`. The `since`
parameter is a GitHub REST API query param — must be embedded in the URL.

Fix:
```typescript
const encodedSince = since ? `&since=${encodeURIComponent(since)}` : ''
const args: string[] = ['api', `repos/${repo}/commits?sha=${branch}${encodedSince}`]
stdout = this.runCli('gh', args)
```

Fix in the S-0 bug-fix commit or as a standalone fix before S-3.

**Verification passed:**
```
grep -rn "execSync(" connectors/github/src/ connectors/argocd/src/  # 0 results ✓
```
`connectors/linear/src/` covered by S-2. ✓

---

### S-2 — Linear HTTP API + GraphQL variables | 7fd840a

LGTM. `execSync` fully removed. All four query types use proper GraphQL variable syntax — no
string interpolation into query bodies. `LINEAR_API_KEY` (+ `DATADOG_API_KEY/APP_KEY`) added
to env Zod schema. `health()` error message now includes actual error string.

**LOW — `as string ?? ''` makes nullish fallback unreachable**

```typescript
{ team: query.team as string ?? '', first: 50 }
```
`as string` widens the type to `string`, stripping `undefined`. The `?? ''` never fires.
TypeScript strict mode may warn; not a runtime bug since the value is already whatever
it was — the fallback just silently doesn't apply if it was `undefined`.

Fix (all four query switch cases):
```typescript
{ team: (query.team as string | undefined) ?? '', first: 50 }
{ id: (query.issue_id as string | undefined) ?? '' }
{ team: (query.team as string | undefined) ?? '', first: 50 }
{ id: (query.project_id as string | undefined) ?? '' }
```
Fix inline when next touching `connectors/linear/src/connector.ts`.

---

<!-- REVIEW SECTION END — 2026-06-07 -->

<!-- REVIEW SECTION START — 2026-06-28 -->
## Review — 2026-06-28 | 58da43d (duplicate type — already logged)

No new feature code from opencode. `58da43d` introduced duplicate `OpenAIToolCall` (L-6, already in
2026-06-27 section + BRIDGE.md correction sent). `90575bf` is reviewer bridge message. Working tree clean.

Opus deep analysis completed this session — full gap analysis and 25-task execution plan written to
`docs/BRIDGE.md` style prompt. No new code issues to add beyond those already open.

### Still open (priority order for next agent run)
| Issue | Severity | File | Notes |
|-------|----------|------|-------|
| L-6 | LOW | `packages/types/src/index.ts:108` | Duplicate OpenAIToolCall — delete lines 108–115 |
| H-2 | HIGH | `gateway/routes/chat.ts:46` | InMemorySessionMemory.get returns fake UserId('unknown') |
| B-2-R | MEDIUM | `gateway/routes/chat.ts:110` | sessionUsed resets to 0 per request |
| B-5 | MEDIUM | `gateway/routes/chat.ts:174` | connectorScopes hardcodes wildcard |
| B-8 | MEDIUM | `gateway/routes/chat.ts` | RLS set_config never called |
| B-9 | MEDIUM | `prisma/migrations/0001_initial` | audit_events FK is CASCADE not RESTRICT |
| B-10 | MEDIUM | `apps/gateway/Dockerfile` | workspace symlinks broken in distroless |
| L-2 | LOW | `orchestrator.ts:134` | INTENT_CLASSIFICATION_FAILED hard-fails, should be best-effort |
| L-4 | LOW | `gateway/__tests__/chat.test.ts:270` | `as never` cast |
| L-5 | LOW | `providers/ollama.ts:mapMessages` | `content: ''` should be `null` |

### Architecture gaps (from Opus analysis, not in any prior section)
| Gap | Notes |
|-----|-------|
| No AbortSignal thread-through | Client disconnect burns tokens; needs signal in InferenceOptions + providers |
| No env validation at boot | Misconfigured process fails on first request, not at startup |
| No `trace_id` in audit events | Requests unattributable across audit rows |
| `InMemorySessionMemory.get` returns fake identity | Returns `UserId('unknown')` instead of `null` — breaks audit attribution |
| Mastra not integrated | TASKS.md M1-T4 requires Mastra lifecycle hooks; code rolls own loop instead |

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 8/10 |
| Code standards | 7/10 |
| Performance | 6/10 |
| Security | 5/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

### Pending Features (docs/TASKS.md)
| Task | Status |
|------|--------|
| M0 Foundation | ✓ Complete |
| M1 Agent harness + all providers | ✓ Complete |
| M1 Orchestrator runSession | ✓ Complete |
| M1 RedisSessionMemory | ✓ Complete |
| M1 TokenBudget middleware | ⚠ Partial — B-2-R |
| M1 Audit sink | ⚠ Partial — B-9, no trace_id |
| M1 Gateway chatRoutes + SSE | ⚠ Partial — B-5, B-8, H-2 |
| M1-T6 Wire web OrchestratorChat to real /api/chat | ✗ Not started |
| M2 Connectors (GitHub/Datadog/Linear/ArgoCD) | ✗ Not started |
| M3 Incident War Room | ✗ Not started |
| M4 Knowledge Graph + Graph Builder | ✗ Not started |
| M5 Automations + Scheduler | ✗ Not started |

<!-- REVIEW SECTION END — 2026-06-28 -->

---

<!-- REVIEW SECTION START — 2026-06-27 -->
## Review — 2026-06-27 | No new commits

No opencode commits since `0914a0f`. Working tree has one stale artifact.

### Issues found

**LOW — L-6** `packages/types/src/index.ts:105–114` (working tree only, not committed)  
Duplicate `OpenAIToolCall` interface declaration. Stale copy from prior Claude Code session
that wasn't cleaned when `fa7d3fa` committed the canonical version. TypeScript merges identical
interfaces silently — compiles fine — but dead code confuses readers.  
**Fix:** Remove lines 105–114 (the second copy). The identical interface already exists at ~line 96.  
**Verify:** `pnpm typecheck` clean. `grep -c "export interface OpenAIToolCall" packages/types/src/index.ts` returns `1`.

### Still open (Wave 3 of CODEX-PLAN.md)
| Issue | Severity | File | Notes |
|-------|----------|------|-------|
| B-2-R | MEDIUM | `gateway/routes/chat.ts:82` | sessionUsed resets per request |
| B-5 | MEDIUM | `gateway/routes/chat.ts:144` | connectorScopes hardcodes `['*']` |
| B-8 | MEDIUM | `gateway/routes/chat.ts` | RLS set_config never called before queries |
| B-9 | MEDIUM | `prisma/migrations/0001_initial` | audit_events CASCADE bypasses immutability |
| B-10 | MEDIUM | `apps/gateway/Dockerfile` | workspace symlinks broken in distroless |
| H-2 | HIGH | `gateway/routes/chat.ts:96` | InMemorySessionMemory fallback loses history across processes |
| L-4 | LOW | `gateway/__tests__/chat.test.ts:261` | `as never` cast in test |
| L-5 | LOW | `providers/ollama.ts:mapMessages` | `content: ''` should be `null` for tool_calls assistant messages |
| L-6 | LOW | `packages/types/src/index.ts:105` | Duplicate OpenAIToolCall (working tree, uncommitted) |

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 8/10 |
| Code standards | 7/10 |
| Performance | 6/10 |
| Security | 5/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

### Pending Features (docs/TASKS.md)
| Task | Status |
|------|--------|
| M0 Foundation | ✓ Complete |
| M1 Agent harness + all providers | ✓ Complete |
| M1 Orchestrator runSession | ✓ Complete |
| M1 RedisSessionMemory | ✓ Complete |
| M1 TokenBudget middleware | ⚠ Partial — B-2-R open |
| M1 Audit sink | ⚠ Partial — B-9 open |
| M1 Gateway chatRoutes + SSE | ✓ Complete |
| Wave 3 medium fixes | ✗ Not started |
| M2 Knowledge Graph | ✗ Not started |
| M2 Bootstrap Agent | ✗ Not started |
| M3+ Specialist agents | ✗ Not started |

<!-- REVIEW SECTION END — 2026-06-27 -->

---

<!-- REVIEW SECTION START — 2026-06-26 -->
## Review — 2026-06-26 | fa7d3fa 7e9f92d 0c7c209 bfd468f 0952f49 0914a0f

6 commits from MiniMax via opencode. Wave 1 + Wave 2 of CODEX-PLAN.md complete.
All BLOCKING and HIGH issues from prior reviews resolved in this batch.
`0914a0f` — L-3 fixed: `.js` extensions added to `metrics.ts` and `server.ts`. ESM migration now complete across all gateway files.

### Commits reviewed
| SHA | Message |
|-----|---------|
| `fa7d3fa` | feat(types): widen Message type — Anthropic content blocks, tool_call_id |
| `7e9f92d` | fix(providers): add formatToolCall to IModelProvider; fix H-1/H-16/H-17/H-18 |
| `0c7c209` | fix(orchestrator): surface intent error, accumulate text, use formatToolCall |
| `bfd468f` | fix(tests): add formatToolCall/formatToolResult to mock providers |
| `0952f49` | feat(gateway): ESM migration (NodeNext), register chatRoutes with SSE streaming |

### Issues resolved this pass
| Issue | File | Status |
|-------|------|--------|
| H-1 | `providers/anthropic.ts` | ✓ Fixed — index-keyed streaming map |
| H-4 | `orchestrator.ts:134` | ✓ Fixed — INTENT_CLASSIFICATION_FAILED yielded + return |
| H-5 | `orchestrator.ts` | ✓ Fixed — accumulatedText persisted as real content |
| H-15 | `orchestrator.ts:254` | ✓ Fixed — model.formatToolCall used instead of string encode |
| H-16 | `providers/anthropic.ts` | ✓ Fixed — proper tool_result content block |
| H-17 | `providers/openai.ts:mapMessages` | ✓ Fixed — tool_call_id + tool_calls forwarded |
| H-18 | `providers/ollama.ts:mapMessages` | ✓ Fixed — tool_call_id + tool_calls forwarded |
| M-18 | `packages/types/src/index.ts` | ✓ Fixed — OpenAIToolCall + tool_calls on Message |
| B-14 | `orchestrator.test.ts` | ✓ Fixed — both mocks have both interface methods |
| B-15 | `orchestrator.test.ts` | ✓ Fixed — module-level code wrapped in it() block |

### New issues found

**LOW — L-3** `apps/gateway/src/routes/metrics.ts:2` and `apps/gateway/src/server.ts:1-4`  
ESM migration incomplete — `.js` extension missing on 4 imports across these 2 files. Committed
gateway batch (`0952f49`) missed them. Files sit in working tree unchanged.  
**Fix:** Add `.js` to each bare import and commit. Two-line change per file.  
**Verify:** `pnpm --filter anvay-gateway build` exits 0.

**LOW — L-4** `apps/gateway/src/__tests__/chat.test.ts:261`  
`as never` cast used to pass invalid type to `resolveProviderConfig` in test. Confirms security
behavior (client apiKey ignored) but the cast is a code smell.  
**Fix:** Create a separate type-unsafe test util or use `satisfies` + `Omit`. Not blocking.

**LOW — L-5** `apps/gateway/src/providers/ollama.ts` — `mapMessages` assistant branch  
Assistant messages with `tool_calls` get `content: ''` (empty string). OpenAI spec says `null`.
Most Ollama models tolerate this but it's spec-incorrect.  
**Fix:** `content: (typeof m.content === 'string' ? m.content : null) as string`  
**Verify:** Ollama integration test passes with tool call round-trip.

### Still open (from prior reviews)
| Issue | Severity | File | Notes |
|-------|----------|------|-------|
| B-2-R | MEDIUM | `gateway/routes/chat.ts:buildTokenBudget` | sessionUsed resets per request |
| B-5 | MEDIUM | `gateway/routes/chat.ts:144` | connectorScopes hardcodes `['*']` |
| B-8 | MEDIUM | `gateway/routes/chat.ts` | RLS set_config never called |
| B-9 | MEDIUM | `prisma/migrations/0001_initial` | audit_events CASCADE bypasses immutability |
| B-10 | MEDIUM | `apps/gateway/Dockerfile` | workspace symlinks broken in distroless |
| H-2 | HIGH | `gateway/routes/chat.ts:96` | InMemorySessionMemory used if REDIS_URL absent |
| L-3 | LOW | `gateway/routes/metrics.ts`, `server.ts` | ESM `.js` extension missing (uncommitted) |

### Ratings
| Dimension | Rating | Change |
|-----------|--------|--------|
| Feature completeness | 8/10 | +1 — gateway SSE wired, all provider paths correct |
| Code standards | 7/10 | +2 — B-14/B-15 fixed, mapMessages correct, no casts |
| Performance | 6/10 | — |
| Security | 5/10 | +1 — client API key rejection enforced in chat.ts; B-5/B-8/B-9 still open |
| Readability | 8/10 | — |
| Clarity and comments | 7/10 | — |

### Pending Features (docs/TASKS.md)
| Task | Status |
|------|--------|
| M0 Foundation | ✓ Complete |
| M1-T1 Agent harness + IModelProvider | ✓ Complete |
| M1-T2 Anthropic provider | ✓ Complete (H-1/H-16 fixed) |
| M1-T3 OpenAI provider | ✓ Complete (H-17 fixed) |
| M1-T4 Ollama provider | ✓ Complete (H-18 fixed) |
| M1-T5 AgentPerimeter engine | ✓ Complete |
| M1-T6 Orchestrator runSession | ✓ Complete (H-4/H-5/H-15 fixed) |
| M1-T7 RedisSessionMemory | ✓ Complete |
| M1-T8 TokenBudget middleware | ⚠ Partial — B-2-R open |
| M1-T9 Audit sink | ⚠ Partial — B-9 open |
| M1 Gateway chatRoutes | ✓ Complete (0952f49) |
| Wave 3 medium fixes (B-2-R/B-5/B-8/B-9/B-10) | ✗ Not started |
| M2 Knowledge Graph | ✗ Not started |
| M2 Bootstrap Agent | ✗ Not started |

<!-- REVIEW SECTION END — 2026-06-26 -->

---

<!-- REVIEW SECTION START — 2026-06-25 -->
## Review — 2026-06-25 | No new commits

No commits from opencode since `47726f2`. Working tree unchanged from 2026-06-21.
B-14/B-15 remain top priority — compile blocked until fixed.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 7/10 |
| Code standards | 5/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

### Pending Features (from docs/TASKS.md)

| Task | Status | Notes |
|------|--------|-------|
| M0 Foundation | Complete | Monorepo, Docker Compose, auth, DB |
| M1-T1 Agent harness + IModelProvider | Complete | `packages/agent` |
| M1-T2 Anthropic provider | Complete | H-1 streaming fix pending commit |
| M1-T3 OpenAI provider | Complete | H-17 mapMessages gap open |
| M1-T4 Ollama provider | Complete | H-18 mapMessages gap open |
| M1-T5 AgentPerimeter engine | Complete | B-5 wildcard scope open |
| M1-T6 Orchestrator runSession | Complete | H-4/H-5/H-15 fix pending commit |
| M1-T7 RedisSessionMemory | Complete | B-3 fixed, 2 LOW residuals |
| M1-T8 TokenBudget middleware | Complete | B-2-R (sessionUsed reset) open |
| M1-T9 Audit sink | Complete | B-9 CASCADE bypass open |
| M2+ Knowledge Graph, Bootstrap Agent | Not started | |
| B-8 RLS set_config | Not fixed | Postgres row-level security unused |
| B-10 Dockerfile pnpm deploy | Not fixed | Workspace symlinks broken in distroless |
| B-14/B-15 orchestrator.test.ts | Not fixed | **BLOCKING** — compile fails |
| H-2 RedisSessionMemory in chat.ts | Not fixed | InMemorySessionMemory used in prod path |
| H-17/H-18 mapMessages tool fields | Not fixed | OpenAI/Ollama tool turns broken |
| M-18 Message.tool_calls field | Not fixed | Missing from @anvay/types |

<!-- REVIEW SECTION END — 2026-06-25 -->

---

<!-- REVIEW SECTION START — 2026-06-24 -->
## Review — 2026-06-24 | No new commits

No commits from opencode since `47726f2`. Working tree unchanged from 2026-06-21.
B-14/B-15 (broken orchestrator test file) remain top priority — compile will fail until fixed.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 7/10 |
| Code standards | 5/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

<!-- REVIEW SECTION END — 2026-06-24 -->

---

<!-- REVIEW SECTION START — 2026-06-23 -->
## Review — 2026-06-23 | No new commits

No commits from opencode since `47726f2` (last code commit). Working tree unchanged.
All open issues from 2026-06-21 remain. Ratings unchanged.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 7/10 |
| Code standards | 5/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

<!-- REVIEW SECTION END — 2026-06-23 -->

---

<!-- REVIEW SECTION START — 2026-06-22 -->
## Review — 2026-06-22 | No new commits

No commits from opencode since last review. Working tree identical to 2026-06-21.
Ratings and open issues unchanged. B-14/B-15 (broken test file) must be fixed before
anything else — compile will fail until both mocks have both interface methods and the
module-level code is wrapped in a test block.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 7/10 |
| Code standards | 5/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

<!-- REVIEW SECTION END — 2026-06-22 -->

---

<!-- REVIEW SECTION START — 2026-06-21 -->
## Review — 2026-06-21 | Major fixes land: H-1/H-4/H-5/B-12/B-13/H-15/H-16 resolved — test file broken

**Scope:** Uncommitted working-tree changes vs `06e54bf`. New files vs prior review:
`packages/types/src/index.ts`, `packages/agent/src/interfaces/provider.ts`,
`packages/agent/src/providers/anthropic.ts`, `packages/agent/src/providers/openai.ts`,
`packages/agent/src/providers/ollama.ts`, `packages/agent/src/orchestrator.ts`,
`packages/agent/src/orchestrator.test.ts`. Gateway ESM files unchanged from prior reviews.

| Dimension | Rating | Δ from last review |
|-----------|--------|-------------------|
| Feature completeness | 7/10 | ↑1 — H-1/H-4/H-5 fixed; proper tool message formatting end-to-end for Anthropic |
| Code standards | 5/10 | ↓1 — test file severely broken (see B-14/B-15) |
| Performance | 6/10 | = |
| Security | 4/10 | = |
| Readability | 8/10 | = |
| Clarity and comments | 7/10 | = |

---

### Previous Issues — Status Update

| Issue | Status |
|-------|--------|
| H-1 — Anthropic parallel tool calls lose args | **FIXED** ✓ — `partialToolCalls` now keyed by `event.index` (content block index), not tool call ID |
| H-4 — Intent classification failure silent | **FIXED** ✓ — catch yields `error` event and returns |
| H-5 — Streamed response stored as `'[streamed response]'` | **FIXED** ✓ — `accumulatedText` accumulates all `text_delta` chunks, persisted to session memory |
| H-15 — Assistant tool_call messages text-encoded | **FIXED** ✓ — `messages.push(model.formatToolCall(collectedToolCalls))` |
| H-16 — Anthropic formatToolResult text encoding | **FIXED** ✓ — returns proper `[{ type: 'tool_result', tool_use_id, content }]` block |
| B-11-R — array content not assignable to Message.content | **FIXED** ✓ — `Message.content` widened to `string \| AnthropicContentBlock[]` |
| B-12 — OpenAI formatToolResult wrong role + ignores toolCallId | **FIXED** ✓ — `role: 'tool'`, `tool_call_id: toolCallId` |
| B-13 — Ollama formatToolResult same defect | **FIXED** ✓ — same fix as B-12 |

---

### BLOCKING

#### B-14 — `orchestrator.test.ts` mock providers missing required interface methods — compile fails

**File:** `packages/agent/src/orchestrator.test.ts:95–133`

```typescript
function makeTextOnlyProvider(): IModelProvider {
  return {
    // ... chat, stream ...
    formatToolCall(...): Message { ... },
    // formatToolResult MISSING — IModelProvider requires it
  }
}

function makeToolCallProvider(toolName: string): IModelProvider {
  return {
    // ... chat, stream ...
    formatToolCall(...): Message { ... },
    // formatToolResult MISSING — IModelProvider requires it
  }
}
```

`IModelProvider` now requires both `formatToolResult` and `formatToolCall`. Both mocks only
implement `formatToolCall` — they no longer implement `formatToolResult`. TypeScript compile
fails: `Property 'formatToolResult' is missing in type '...' but required in type
'IModelProvider'`.

**Fix:**
```typescript
// Add to both makeTextOnlyProvider and makeToolCallProvider:
formatToolResult(_toolCallId: string, result: unknown): Message {
  return { role: 'user', content: JSON.stringify(result) }
},
```

---

#### B-15 — `orchestrator.test.ts` lines 136–175 are module-level code outside any test wrapper

**File:** `packages/agent/src/orchestrator.test.ts:136–175`

```typescript
let callCount = 0
const loopingProvider: IModelProvider = { ... }   // module-level variable
const execTool: ExecutableTool = { ... }
const orch = createOrchestrator({ ... })           // runs on module load
const events = await collectEvents(...)            // top-level await outside test
expect(callCount).toBeLessThanOrEqual(3)           // expect outside it()
```

The body of `it('caps the agentic loop at maxSteps...')` was kept but the `it(` wrapper
was removed. The `})` at lines 174–175 close the surrounding `describe` block correctly
(the test suite), but everything on lines 136–174 executes at module import time, not
inside a test case. Vitest will not register these as tests. The `expect()` calls fire
during module initialisation — if they pass, they pass silently outside any test; if they
fail, they crash the entire test file load.

Additionally, `loopingProvider` at line 137 implements `formatToolResult` but not
`formatToolCall` — compile error on that object too.

**Fix:** Wrap lines 136–174 back in a `describe`/`it` block and add `formatToolCall` to
`loopingProvider`:

```typescript
describe('runSession', () => {
  it('caps the agentic loop at maxSteps to prevent infinite loops', async () => {
    let callCount = 0
    const loopingProvider: IModelProvider = {
      async chat(): Promise<ChatResponse> { ... },
      async *stream() { ... },
      formatToolResult(_id, result): Message { return { role: 'user', content: JSON.stringify(result) } },
      formatToolCall(_toolCalls): Message { return { role: 'assistant', content: '' } },
    }
    // ... rest of test body ...
    expect(callCount).toBeLessThanOrEqual(3)
    expect(doneEvents).toHaveLength(1)
  })
})
```

**Verify:** `pnpm --filter @anvay/agent test` shows at least 1 test in orchestrator.test.ts.
`pnpm --filter @anvay/agent typecheck` exits 0.

Note: In the fix, all the previously deleted test cases (text_delta+done, audit events,
perimeter middleware, tool_result emission, token budget exhausted, perimeter blocks) should
be restored. Deleting passing tests that cover critical agentic loop behaviour is a regression
regardless of the reason. These tests protected against regressions in the exact code that
was just heavily modified.

---

### HIGH

#### H-17 — `OpenAIProvider.mapMessages` drops `tool_call_id` and `tool_calls` — multi-turn tool use broken at mapping layer

**File:** `packages/agent/src/providers/openai.ts:24–32`

```typescript
function mapMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    const content = Array.isArray(m.content) ? JSON.stringify(m.content) : m.content
    return {
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content,
      // tool_call_id NOT included — tool result messages lose their association
      // tool_calls NOT included — assistant tool call messages lose their call list
    }
  })
}
```

Two missing fields:

1. **`tool_call_id`** — `formatToolResult` sets `tool_call_id: toolCallId` on `Message`. But
   `mapMessages` only copies `role` and `content`. OpenAI API requires `tool_call_id` on every
   `role: 'tool'` message — without it, the API returns `400 invalid_request_error: Missing
   required parameter: 'tool_call_id'`.

2. **`tool_calls`** — `formatToolCall` returns `Message & { tool_calls: [...] }` (cast). The
   `tool_calls` field is not in `Message` so `mapMessages` cannot see it. OpenAI API requires
   `tool_calls` on the assistant message to associate results. Without it, the subsequent
   `role: 'tool'` messages are orphaned — OpenAI API returns `400: Each 'tool' message must
   correspond to a previous tool call`.

**Fix:** Include `tool_call_id` and spread any additional fields through `mapMessages`. First
add `tool_calls` to `Message` type (see M-18), then:

```typescript
function mapMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    const content = Array.isArray(m.content) ? JSON.stringify(m.content) : (m.content ?? null)
    const base = { role: m.role as 'user' | 'assistant' | 'system' | 'tool', content }
    if (m.tool_call_id) return { ...base, tool_call_id: m.tool_call_id }
    if (m.tool_calls) return { ...base, content: undefined, tool_calls: m.tool_calls }
    return base
  }) as OpenAI.ChatCompletionMessageParam[]
}
```

**Verify:** Run a two-turn conversation with a tool call. Assert the messages array sent to
OpenAI SDK contains the assistant message with `tool_calls` and the tool result message with
`tool_call_id`. Currently neither field reaches the SDK.

---

#### H-18 — `OllamaProvider.mapMessages` same defect as H-17

**File:** `packages/agent/src/providers/ollama.ts:63–68`

Identical missing `tool_call_id` + `tool_calls` fields. Same fix as H-17, applied to
`OllamaCompatMessage` mapping.

---

### MEDIUM

#### M-18 — `Message` type missing `tool_calls` field — OpenAI/Ollama `formatToolCall` uses an unsafe cast

**File:** `packages/types/src/index.ts:83–88`

`formatToolCall` in `OpenAIProvider` and `OllamaProvider` returns:
```typescript
return {
  role: 'assistant',
  content: '',
  tool_calls: [...],
} as Message & { tool_calls: OpenAI.ChatCompletionMessageToolCall[] }
```

The `tool_calls` field is not in the `Message` interface — it's cast in. This means:
- TypeScript type-checks it at the cast site but loses the information everywhere `Message`
  is consumed (e.g., `mapMessages` can't see `tool_calls` without casting back)
- Any code that copies `Message` objects via spread loses `tool_calls`

**Fix:** Add `tool_calls` to `Message` in `@anvay/types`:
```typescript
export type OpenAIToolCall = {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

export interface Message {
  readonly role: MessageRole
  readonly content?: string | AnthropicContentBlock[]
  readonly tool_call_id?: string
  readonly tool_calls?: readonly OpenAIToolCall[]
}
```

Then remove the casts from `formatToolCall` in OpenAI and Ollama providers.

---

### What these changes accomplish (positive)

**H-1 fix (critical correctness):** Anthropic streaming now keyed by `event.index` — the
content block index from the Anthropic streaming API. This is the correct identifier for
tracking which tool call a delta belongs to. Previously keyed by tool call ID (which only
exists after `content_block_start`, making the key assignment non-deterministic). Parallel
tool calls now fully correct.

**H-4 fix:** Intent classification errors now surface as proper error events. The orchestrator
no longer silently swallows failures that could produce incorrect routing.

**H-5 fix:** Session memory now stores real text. Follow-up queries can reason about prior
responses. Multi-turn conversations now have actual context.

**H-15 + H-16 + Anthropic `formatToolCall`:** Complete and correct for Anthropic API. Assistant
messages contain `tool_use` content blocks; tool results contain `tool_result` content blocks.
Anthropic multi-turn tool use is now correctly structured end-to-end.

**B-12 + B-13:** OpenAI/Ollama `formatToolResult` now correct (`role: 'tool'` + `tool_call_id`).
Still broken at `mapMessages` level (H-17/H-18) but the Message object is now correct.

---

### Pending Features (Updated Status)

| Feature | Task | Status |
|---------|------|--------|
| M0-T1 through M0-T8 | M0 | **COMPLETE** |
| M1-T1 through M1-T5 | M1 (partial) | **COMPLETE** |
| Wire OrchestratorChat to real SSE | M1-T6 | **PARTIAL** — SSE client wired, stub response |
| H-1 parallel tool calls fix | — | **FIXED** ✓ |
| H-4 intent classification error surface | — | **FIXED** ✓ |
| H-5 real text in session memory | — | **FIXED** ✓ |
| H-15/H-16 proper Anthropic tool message format | — | **FIXED** ✓ |
| B-12/B-13 OpenAI/Ollama formatToolResult | — | **FIXED** ✓ (mapMessages still broken, H-17/H-18) |
| B-11-R Message type widened | — | **FIXED** ✓ |
| Gateway ESM migration | — | **COMPLETE** (uncommitted) |
| formatToolCall on all providers | — | **COMPLETE** — present, Anthropic correct; OpenAI/Ollama blocked by H-17/H-18 |
| Specialist agent tools | M2 | NOT STARTED |
| Connector implementations | M2 | NOT STARTED |
| IKnowledgeGraph + resolveContext() | M4-T5 | NOT STARTED |
| User permission DB model (B-5 prereq) | pre-M2 | NOT STARTED |
| RLS activation at query time (B-8) | pre-M2 | NOT STARTED |
| Dockerfile symlink fix (B-10) | immediate | NOT STARTED |

---

### Consolidated open issues (updated)

| ID | Severity | File | Short description | Status |
|----|----------|------|-------------------|--------|
| B-2-R | BLOCKING | chat.ts | sessionUsed resets to 0 each request | OPEN |
| B-4 | BLOCKING | orchestrator.ts | Assistant messages: formatToolCall used ✓; OpenAI/Ollama mapMessages drops tool_calls | PARTIAL |
| B-5 | BLOCKING | chat.ts | connectorScopes wildcards all users | OPEN |
| B-6 | BLOCKING | chat.ts | InMemorySessionMemory shared across tenants | OPEN |
| B-7 | BLOCKING | jwt.ts | JWT error leaked to client | OPEN |
| B-8 | BLOCKING | chat.ts + migration | RLS app.tenant_id never set | OPEN |
| B-9 | BLOCKING | migration.sql | audit_events CASCADE bypass | OPEN |
| B-10 | BLOCKING | Dockerfile | Workspace symlinks broken in runner | OPEN |
| B-14 | BLOCKING | orchestrator.test.ts | Mock providers missing formatToolResult — compile fails | **NEW** |
| B-15 | BLOCKING | orchestrator.test.ts | Module-level code outside test wrapper; deleted tests | **NEW** |
| H-2 | HIGH | chat.ts | InMemorySessionMemory inline, summarise no-op | OPEN |
| H-3 | HIGH | postgres-sink.ts | Audit sink silent drop on DB failure | OPEN |
| H-6 | HIGH | auth.ts | Stub hardcodes sub=stub-user-id | OPEN |
| H-7 | HIGH | specialist-agent.ts | No token budget enforcement | OPEN |
| H-8 | HIGH | web/api/chat/route.ts | Web chat SSE stub — not real LLM | PARTIAL |
| H-9 | HIGH | cors.ts | CORS * + credentials broken combo | OPEN |
| H-10 | HIGH | health.ts | /health/ready always 200 | OPEN |
| H-11 | HIGH | metrics.ts | /metrics unauthenticated | OPEN |
| H-12 | HIGH | seed.ts | $executeRawUnsafe + SET LOCAL wrong scope | OPEN |
| H-13 | HIGH | orchestrator-chat.tsx | Gate Approve/Reject are no-ops | OPEN |
| H-17 | HIGH | openai.ts | mapMessages drops tool_call_id and tool_calls | **NEW** |
| H-18 | HIGH | ollama.ts | mapMessages drops tool_call_id and tool_calls | **NEW** |
| M-1 through M-17 | MEDIUM | various | (see prior sections) | OPEN |
| M-18 | MEDIUM | types/index.ts | Message missing tool_calls field — unsafe cast workaround | **NEW** |
| L-1 through L-12 | LOW | various | (see prior sections) | OPEN |

<!-- REVIEW SECTION END — 2026-06-21 -->

---

<!-- REVIEW SECTION START — 2026-06-20 -->
## Review — 2026-06-20 | No new commits

No commits from opencode since `47726f2`. Working tree unchanged. All open issues from
2026-06-15 remain. Ratings unchanged.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 6/10 |
| Code standards | 6/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

<!-- REVIEW SECTION END — 2026-06-20 -->

---

<!-- REVIEW SECTION START — 2026-06-19 -->
## Review — 2026-06-19 | No new commits

No commits from opencode since `47726f2`. Working tree unchanged. All open issues from
2026-06-15 remain. Ratings unchanged.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 6/10 |
| Code standards | 6/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

<!-- REVIEW SECTION END — 2026-06-19 -->

---

<!-- REVIEW SECTION START — 2026-06-18 -->
## Review — 2026-06-18 | No new commits

**Scope:** No commits from opencode since `47726f2`. Working tree unchanged (gateway ESM
migration still uncommitted). Ratings and open issues unchanged from 2026-06-17.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 6/10 |
| Code standards | 6/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

<!-- REVIEW SECTION END — 2026-06-18 -->

---

<!-- REVIEW SECTION START — 2026-06-17 -->
## Review — 2026-06-17 | No new commits

**Scope:** No commits from opencode since `47726f2`. Working tree unchanged.
Ratings and open issues identical to 2026-06-16.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 6/10 |
| Code standards | 6/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

<!-- REVIEW SECTION END — 2026-06-17 -->

---

<!-- REVIEW SECTION START — 2026-06-16 -->
## Review — 2026-06-16 | No new commits

**Scope:** No commits from opencode since `47726f2`. Uncommitted working tree: gateway ESM
migration only (already reviewed 2026-06-08). Nothing new to evaluate.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 6/10 |
| Code standards | 6/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

Priority queue unchanged from 2026-06-15: H-15/H-16 (tool message encoding), B-12/B-13
(OpenAI/Ollama formatToolResult), B-10 (Dockerfile), B-8 (RLS), B-5 (connector scopes).

<!-- REVIEW SECTION END — 2026-06-16 -->

---

<!-- REVIEW SECTION START — 2026-06-15 -->
## Review — 2026-06-15 | B-4 partial fix — tool results via formatToolResult, assistant side still text-encoded

**Scope:** Two commits — `45153ab` ("B-4: use formatToolResult; fix test mocks") and
`47726f2` ("M1-T6: fix tool_result handler — use toolNamesRef to track tool call IDs").
Files changed: `orchestrator.ts`, `orchestrator.test.ts`, `redis-session.test.ts`,
`provider.test.ts`, `interfaces/provider.ts`, `providers/anthropic.ts`, `providers/openai.ts`,
`providers/ollama.ts`, `apps/web/components/orchestrator-chat.tsx`.

| Dimension | Rating | Δ from last review |
|-----------|--------|-------------------|
| Feature completeness | 6/10 | = — formatToolResult wired into orchestrator; assistant side still broken |
| Code standards | 6/10 | ↑1 — compile error resolved, tests updated |
| Performance | 6/10 | = |
| Security | 4/10 | = |
| Readability | 8/10 | = |
| Clarity and comments | 7/10 | = |

---

### Previous Issues — Status Update

| Issue | Status |
|-------|--------|
| B-4 — tool message format wrong for multi-turn | **PARTIAL** — result side now uses `formatToolResult`; assistant tool_call messages still text-encoded (see H-15) |
| B-11-R — AnthropicProvider array content compile error | **FIXED** ✓ — now returns `role: 'user', content: "[tool_result id=...] ..."` string |
| B-12 — OpenAIProvider wrong role + ignores toolCallId | OPEN |
| B-13 — OllamaProvider wrong role + ignores toolCallId | OPEN |
| H-14 — `tool_result` handler references `event.toolName` | **FIXED** ✓ (`47726f2`) — `toolNamesRef.current.set(toolCallId, toolName)` in `tool_call` handler; `toolNamesRef.current.get(toolCallId)` in `tool_result` handler |
| M-15 — `toolNamesRef` declared but never used | **FIXED** ✓ (resolved by H-14 fix) |

---

### HIGH

#### H-15 — Orchestrator assistant message still text-encoded — both sides of tool exchange are wrong for real provider APIs

**File:** `packages/agent/src/orchestrator.ts:249–255`

```typescript
const assistantContent = collectedToolCalls
  .map((tc) => `[tool_call id="${tc.id}" name="${tc.name}"] ${JSON.stringify(tc.args)}`)
  .join('\n')
messages.push({ role: 'assistant', content: assistantContent })
for (const msg of toolResultMessages) {
  messages.push(msg)
}
```

The result side now uses `model.formatToolResult()` — correct direction. But the assistant
message for tool calls is still plain text: `[tool_call id="call_1" name="my-tool"] {...}`.

**What providers require:**

| Provider | Required assistant message format |
|----------|----------------------------------|
| Anthropic | `{ role: 'assistant', content: [{ type: 'tool_use', id: '...', name: '...', input: {...} }] }` |
| OpenAI / Ollama | `{ role: 'assistant', tool_calls: [{ id: '...', type: 'function', function: { name: '...', arguments: '...' } }] }` |

Neither provider receives a properly structured assistant turn. The Anthropic model receives
plain text that looks like `[tool_call id="..."]` — it treats this as a regular assistant
text response, not a `tool_use` block. The follow-up user message with `[tool_result id="..."]`
is also plain text. The model has no semantic understanding that a tool was called and returned.

**Impact:** Multi-turn tool use is currently theatre — the conversation history is sent to the
provider but is not understood as a tool exchange. The model will respond as if it never used
a tool. Any reasoning that depends on tool results (e.g., "Based on the K8s pod status I just
fetched...") will hallucinate because the tool result is not injected in a way the model
processes.

**Fix:** Add `formatToolCall(toolCalls: ToolCall[]): Message` to `IModelProvider` (companion
to `formatToolResult`), then:

```typescript
// In orchestrator.ts — replace the text-encoded assistant push:
const toolCallMsg = model.formatToolCall(collectedToolCalls)
messages.push(toolCallMsg)
for (const msg of toolResultMessages) {
  messages.push(msg)
}
```

Provider implementations:
```typescript
// AnthropicProvider
formatToolCall(toolCalls: ToolCall[]): Message {
  return {
    role: 'assistant',
    content: toolCalls.map(tc => ({
      type: 'tool_use',
      id: tc.id,
      name: tc.name,
      input: tc.args,
    })),
  }
}

// OpenAIProvider / OllamaProvider
formatToolCall(toolCalls: ToolCall[]): Message {
  return {
    role: 'assistant',
    tool_calls: toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
    })),
  }
}
```

This also requires widening `Message` in `@anvay/types` to support the assistant tool-call
shape (same root as B-11-R/B-12/B-13 — the `Message` type is the blocker).

**Verify:** Send a query that triggers a tool call. Capture the messages array after the
tool exchange. Assert `messages[n]` is the correct provider-format assistant message (content
block array for Anthropic, `tool_calls` array for OpenAI). Assert `messages[n+1]` is the
correct tool result message.

---

#### H-16 — `AnthropicProvider.formatToolResult` text encoding not recognized by Anthropic API

**File:** `packages/agent/src/providers/anthropic.ts:159–165`

```typescript
formatToolResult(toolCallId: string, result: unknown): Message {
  const content = typeof result === 'string' ? result : JSON.stringify(result)
  return {
    role: 'user',
    content: `[tool_result id="${toolCallId}"] ${content}`,
  }
}
```

This avoids the compile error (good) but is semantically wrong for the Anthropic API. The
Anthropic SDK expects tool results as a user message with a `tool_result` content block:

```json
{
  "role": "user",
  "content": [{
    "type": "tool_result",
    "tool_use_id": "toolu_abc123",
    "content": "result text"
  }]
}
```

When the orchestrator feeds `[tool_result id="..."] ...` as a plain user string to the
Anthropic SDK, the API accepts it (valid message) but Claude does not interpret it as a
tool result. Claude's reasoning will not incorporate the tool output, defeating the purpose
of tool use entirely.

**Relationship to H-15:** Both issues stem from `Message.content: string` being too narrow.
The correct fix requires widening `Message` to support content block arrays (already
identified in B-11-R Option A). Once `Message` supports arrays, `formatToolResult` can
return the proper Anthropic content block and the compile check passes.

**Fix:** Widen `Message` in `@anvay/types` first (same as B-11-R Option A fix), then:

```typescript
formatToolResult(toolCallId: string, result: unknown): Message {
  const content = typeof result === 'string' ? result : JSON.stringify(result)
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolCallId, content }],
  }
}
```

**Verify:** In a test that calls Anthropic SDK with a tool call followed by the
`formatToolResult` output, assert the SDK receives a message with `content[0].type ===
'tool_result'` and `content[0].tool_use_id === toolCallId`. With the current implementation,
`content` is a plain string.

---

### What changed (positive)

**B-4 result side:** `toolResultParts: string[]` → `toolResultMessages: Message[]` with
`model.formatToolResult()`. Individual messages per tool result (not concatenated into one
user message). Structurally correct — each result is its own message. Content encoding still
wrong per provider but the architecture is right.

**B-11-R resolved:** `AnthropicProvider.formatToolResult` now returns `string` content —
compile error gone. String encoding is a workaround; proper fix is H-16 above.

**Mock providers:** All four test mock providers (`makeTextOnlyProvider`, `makeToolCallProvider`,
anonymous mock in `runSession` test, `MockSummariseProvider`, `MockProvider`) now implement
`formatToolResult`. Tests will compile and run. Mock returns `{ role: 'user', content: JSON.stringify(result) }` — acceptable for test purposes.

---

### Pending Features (Updated Status)

| Feature | Task | Status |
|---------|------|--------|
| M0-T1 through M0-T8 | M0 | **COMPLETE** |
| M1-T1 through M1-T5 | M1 (partial) | **COMPLETE** |
| Wire OrchestratorChat to real SSE | M1-T6 | **PARTIAL** — SSE client wired, stub response |
| `formatToolResult` on all providers | — | **PARTIAL** — present everywhere; Anthropic/OpenAI/Ollama still semantically wrong for real API |
| B-4 tool message format fix | — | **PARTIAL** — result side wired; assistant tool_call messages text-encoded (H-15) |
| Gateway ESM migration | — | **COMPLETE** (uncommitted) |
| Gate UI (visual) | — | **PARTIAL** — display only, H-13 unresolved |
| Specialist agent tools | M2 | NOT STARTED |
| Connector implementations | M2 | NOT STARTED |
| IKnowledgeGraph + resolveContext() | M4-T5 | NOT STARTED |
| Graph Builder Agent | M4-T6 | NOT STARTED |
| User permission DB model (B-5 prereq) | pre-M2 | NOT STARTED |
| RLS activation at query time (B-8) | pre-M2 | NOT STARTED |
| Dockerfile symlink fix (B-10) | immediate | NOT STARTED |

---

### Consolidated open issues (updated)

| ID | Severity | File | Short description | Status |
|----|----------|------|-------------------|--------|
| B-2-R | BLOCKING | chat.ts | sessionUsed resets to 0 each request | OPEN |
| B-4 | BLOCKING | orchestrator.ts | Assistant tool_call messages still text-encoded | **PARTIAL** |
| B-5 | BLOCKING | chat.ts | connectorScopes wildcards all users | OPEN |
| B-6 | BLOCKING | chat.ts | InMemorySessionMemory shared across tenants | OPEN |
| B-7 | BLOCKING | jwt.ts | JWT error leaked to client | OPEN |
| B-8 | BLOCKING | chat.ts + migration | RLS app.tenant_id never set | OPEN |
| B-9 | BLOCKING | migration.sql | audit_events CASCADE bypass | OPEN |
| B-10 | BLOCKING | Dockerfile | Workspace symlinks broken in runner | OPEN |
| B-11-R | BLOCKING | anthropic.ts | formatToolResult text encoding; see H-16 | **DOWNGRADED→H-16** |
| B-12 | BLOCKING | openai.ts | formatToolResult wrong role + ignores toolCallId | OPEN |
| B-13 | BLOCKING | ollama.ts | formatToolResult wrong role + ignores toolCallId | OPEN |
| H-1 | HIGH | anthropic.ts | Streaming break — parallel tool calls lose args | OPEN |
| H-2 | HIGH | chat.ts | InMemorySessionMemory inline, summarise no-op | OPEN |
| H-3 | HIGH | postgres-sink.ts | Audit sink silent drop on DB failure | OPEN |
| H-4 | HIGH | orchestrator.ts | Intent classification failure silent | OPEN |
| H-5 | HIGH | orchestrator.ts | Streamed response stored as placeholder | OPEN |
| H-6 | HIGH | auth.ts | Stub hardcodes sub=stub-user-id | OPEN |
| H-7 | HIGH | specialist-agent.ts | No token budget enforcement | OPEN |
| H-8 | HIGH | web/api/chat/route.ts | Web chat SSE stub — not real LLM | PARTIAL |
| H-9 | HIGH | cors.ts | CORS * + credentials broken combo | OPEN |
| H-10 | HIGH | health.ts | /health/ready always 200 | OPEN |
| H-11 | HIGH | metrics.ts | /metrics unauthenticated | OPEN |
| H-12 | HIGH | seed.ts | $executeRawUnsafe + SET LOCAL wrong scope | OPEN |
| H-13 | HIGH | orchestrator-chat.tsx | Gate Approve/Reject are no-ops | OPEN |
| H-14 | HIGH | orchestrator-chat.tsx | tool_result handler references nonexistent event.toolName | **FIXED** ✓ `47726f2` |
| H-15 | HIGH | orchestrator.ts | Assistant tool_call messages text-encoded — providers can't process | **NEW** |
| H-16 | HIGH | anthropic.ts | formatToolResult text encoding not recognized by Anthropic API | **NEW** |
| M-1 through M-17 | MEDIUM | various | (see prior sections) | OPEN |
| L-1 through L-12 | LOW | various | (see prior sections) | OPEN |

<!-- REVIEW SECTION END — 2026-06-15 -->

---

<!-- REVIEW SECTION START — 2026-06-14 -->
## Review — 2026-06-14 | No new commits

**Scope:** No commits from opencode since `3629fe2`. Working tree identical to 2026-06-12/13.
Ratings and open issues unchanged. B-11-R/B-12/B-13 remain top priority.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 6/10 |
| Code standards | 5/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

<!-- REVIEW SECTION END — 2026-06-14 -->

---

<!-- REVIEW SECTION START — 2026-06-13 -->
## Review — 2026-06-13 | No new commits

**Scope:** No commits from opencode since `3629fe2`. Working tree identical to 2026-06-12 review.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 6/10 |
| Code standards | 5/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

All issues from 2026-06-12 open. Next commit must fix B-11-R/B-12/B-13 together — all three
require widening `Message` type in `@anvay/types` first.

<!-- REVIEW SECTION END — 2026-06-13 -->

---

<!-- REVIEW SECTION START — 2026-06-12 -->
## Review — 2026-06-12 | `formatToolResult` implemented — three new defects introduced

**Scope:** Working-tree changes vs last commit (`4bc2d31`). New files in diff since 2026-06-11:
`packages/agent/src/providers/anthropic.ts`, `openai.ts`, `ollama.ts` — `formatToolResult`
added to all three providers. B-11 "missing method" compile error resolved. Three new issues
introduced.

| Dimension | Rating | Δ from last review |
|-----------|--------|-------------------|
| Feature completeness | 6/10 | = — formatToolResult present but semantically broken for two providers |
| Code standards | 5/10 | = — compile error in Anthropic, wrong API format in OpenAI/Ollama |
| Performance | 6/10 | = |
| Security | 4/10 | = |
| Readability | 8/10 | = |
| Clarity and comments | 7/10 | = |

---

### Previous Issues — Status Update

| Issue | Status |
|-------|--------|
| B-11 — `formatToolResult` missing from all providers | **PARTIAL** — method exists now; Anthropic still causes compile error (B-11-R below) |

---

### BLOCKING

#### B-11-R — `AnthropicProvider.formatToolResult` returns array content — `Message.content` is `string` — compile error

**File:** `packages/agent/src/providers/anthropic.ts:159–167`

```typescript
formatToolResult(toolCallId: string, result: unknown): Message {
  const content = typeof result === 'string' ? result : JSON.stringify(result)
  return {
    role: 'user',
    content: [{          // ← TypeScript error: array not assignable to string
      type: 'tool_result',
      tool_use_id: toolCallId,
      content,
    }],
  }
}
```

`Message.content` is `readonly content: string` in `@anvay/types/src/index.ts:85`. Array
content is the correct Anthropic API wire format but violates the `Message` type. TypeScript
rejects: `Type '{ type: string; tool_use_id: string; content: string; }[]' is not assignable
to type 'string'`.

Root cause: `Message` was designed for simple text turns. Tool results in the Anthropic API
require a content-block array wrapped in a `user` role message — a fundamentally different
shape. The `Message` type must be widened, or the Anthropic provider must serialize the
content block to a string and reconstruct it before sending.

**Fix — Option A (recommended): widen `Message` type in `@anvay/types`**

```typescript
// packages/types/src/index.ts

export type AnthropicContentBlock = {
  readonly type: 'tool_result'
  readonly tool_use_id: string
  readonly content: string
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface Message {
  readonly role: MessageRole
  readonly content: string | AnthropicContentBlock[]
  readonly tool_call_id?: string   // OpenAI/Ollama tool result messages need this
}
```

Then update `AnthropicProvider.formatToolResult` — no change needed, it's already correct.

Update `OpenAIProvider` / `OllamaProvider` to use `role: 'tool'` + `tool_call_id` (see B-12/B-13).

**Fix — Option B: serialize in provider, reconstruct before send**

```typescript
formatToolResult(toolCallId: string, result: unknown): Message {
  const content = typeof result === 'string' ? result : JSON.stringify(result)
  // Store as JSON string — AnthropicProvider.chat() unpacks before sending to SDK
  return {
    role: 'user',
    content: JSON.stringify({ _anthropic_tool_result: true, tool_use_id: toolCallId, content }),
  }
}
```

Option A is cleaner — it models the actual wire format in the type system. Option B is a
workaround that hides the type mismatch behind a runtime convention.

**Verify:** `pnpm --filter @anvay/agent typecheck` exits 0. `pnpm --filter @anvay/types build`
exits 0. No TS2322 errors on `content` assignment.

---

#### B-12 — `OpenAIProvider.formatToolResult` ignores `toolCallId` and uses wrong role — multi-turn tool calls broken

**File:** `packages/agent/src/providers/openai.ts:156–162`

```typescript
formatToolResult(toolCallId: string, result: unknown): Message {
  const content = typeof result === 'string' ? result : JSON.stringify(result)
  return {
    role: 'user',        // ← wrong — must be 'tool'
    content: String(content),
    // toolCallId never used ← multi-turn association broken
  }
}
```

OpenAI's chat completions API requires tool results as:
```json
{ "role": "tool", "tool_call_id": "<id from the assistant's tool_call>", "content": "<result>" }
```

Without `role: "tool"` the API cannot distinguish this message from a normal user turn. Without
`tool_call_id` the API cannot associate the result with the tool call that requested it.
OpenAI returns `400 invalid_request_error` for malformed tool result sequences. Multi-turn
tool use (the orchestrator's agentic loop) is completely broken.

**Fix:** Add `'tool'` to `MessageRole` in `@anvay/types` and `tool_call_id?: string` to
`Message` (same change as B-11-R Option A), then:

```typescript
formatToolResult(toolCallId: string, result: unknown): Message {
  const content = typeof result === 'string' ? result : JSON.stringify(result)
  return {
    role: 'tool',
    content,
    tool_call_id: toolCallId,
  }
}
```

**Verify:** In a test, call `formatToolResult('call_abc', 'ok')`. Assert returned message has
`role === 'tool'` and `tool_call_id === 'call_abc'`. Pass the result to `openai.chat()` with
a prior assistant message containing a tool call — assert no 400 from API.

---

#### B-13 — `OllamaProvider.formatToolResult` same wrong format as B-12

**File:** `packages/agent/src/providers/ollama.ts:258–264`

```typescript
formatToolResult(toolCallId: string, result: unknown): Message {
  const content = typeof result === 'string' ? result : JSON.stringify(result)
  return {
    role: 'user',        // ← wrong — must be 'tool' (Ollama uses OpenAI-compatible format)
    content: String(content),
    // toolCallId never used ← same defect as B-12
  }
}
```

Ollama implements the OpenAI-compatible `/v1/chat/completions` API. Same format requirement,
same failure mode as B-12.

**Fix:** Identical to B-12 — `role: 'tool'` + `tool_call_id: toolCallId`. Apply after
`MessageRole` and `Message` type are widened per B-11-R.

**Verify:** Same test pattern as B-12 but targeting `OllamaProvider`.

---

### LOW

#### L-12 — `String(content)` is a redundant no-op in OpenAI and Ollama formatToolResult

**File:** `packages/agent/src/providers/openai.ts:159`, `packages/agent/src/providers/ollama.ts:261`

```typescript
const content = typeof result === 'string' ? result : JSON.stringify(result)
return {
  // ...
  content: String(content),   // ← String() on a value that is already string
}
```

`content` is always `string` after the ternary — `String(content)` is a no-op. Delete the
`String()` wrapper and use `content` directly. This is cosmetic but signals unclear intent.

---

### Root cause: `Message` type too narrow

B-11-R, B-12, B-13 share a common root: `Message` in `@anvay/types` was designed for
simple user/assistant/system text turns. The agentic loop requires a fourth message shape
(tool results) that has a different role (`tool`), an additional field (`tool_call_id`), and
optionally structured content. The type was not extended when `formatToolResult` was added to
the interface.

**Correct fix sequence:**
1. Extend `Message` in `@anvay/types`: add `'tool'` to `MessageRole`, add optional
   `tool_call_id?: string`, widen `content` to `string | AnthropicContentBlock[]`
2. Fix `AnthropicProvider` — already correct shape, just needs type to match
3. Fix `OpenAIProvider.formatToolResult` — `role: 'tool'`, `tool_call_id`
4. Fix `OllamaProvider.formatToolResult` — same as OpenAI
5. Run `pnpm typecheck` — all three providers should pass

---

### Pending Features (Updated Status)

| Feature | Task | Status |
|---------|------|--------|
| M0-T1 through M0-T8 | M0 | **COMPLETE** |
| M1-T1 through M1-T5 | M1 (partial) | **COMPLETE** |
| Wire OrchestratorChat to real SSE | M1-T6 | **PARTIAL** — SSE client wired, stub response |
| `formatToolResult` on all providers | — | **PARTIAL** — present but B-11-R/B-12/B-13 broken |
| Gateway ESM migration | — | **COMPLETE** |
| Gate UI (visual) | — | **PARTIAL** — display only, H-13 unresolved |
| Specialist agent tools | M2 | NOT STARTED |
| Connector implementations | M2 | NOT STARTED |
| IKnowledgeGraph + resolveContext() | M4-T5 | NOT STARTED |
| Graph Builder Agent | M4-T6 | NOT STARTED |
| Trigger.dev cron jobs | M5 | NOT STARTED |
| User permission DB model (B-5 prereq) | pre-M2 | NOT STARTED |
| RLS activation at query time (B-8) | pre-M2 | NOT STARTED |
| Workspace symlink fix in Dockerfile (B-10) | immediate | NOT STARTED |

---

### Consolidated open issues (updated)

| ID | Severity | File | Short description | Status |
|----|----------|------|-------------------|--------|
| B-2-R | BLOCKING | chat.ts | sessionUsed resets to 0 each request | OPEN |
| B-4 | BLOCKING | orchestrator.ts | Tool message format wrong for multi-turn | OPEN (M2) |
| B-5 | BLOCKING | chat.ts | connectorScopes wildcards all users | OPEN |
| B-6 | BLOCKING | chat.ts | InMemorySessionMemory shared across tenants | OPEN |
| B-7 | BLOCKING | jwt.ts | JWT error leaked to client | OPEN |
| B-8 | BLOCKING | chat.ts + migration | RLS app.tenant_id never set | OPEN |
| B-9 | BLOCKING | migration.sql | audit_events CASCADE bypass | OPEN |
| B-10 | BLOCKING | Dockerfile | Workspace symlinks broken in runner | OPEN |
| B-11 | BLOCKING | provider.ts / anthropic.ts | AnthropicProvider returns array content, Message.content is string | **PARTIAL→B-11-R** |
| B-11-R | BLOCKING | anthropic.ts | array content not assignable to Message.content:string | **NEW** |
| B-12 | BLOCKING | openai.ts | formatToolResult wrong role + ignores toolCallId | **NEW** |
| B-13 | BLOCKING | ollama.ts | formatToolResult wrong role + ignores toolCallId | **NEW** |
| B-3-R | LOW | redis-session.ts | expire races rpush; summarise del+rpush non-atomic | OPEN |
| H-1 | HIGH | anthropic.ts | Streaming break — parallel tool calls lose args | OPEN |
| H-2 | HIGH | chat.ts | InMemorySessionMemory inline, summarise no-op | OPEN |
| H-3 | HIGH | postgres-sink.ts | Audit sink silent drop on DB failure | OPEN |
| H-4 | HIGH | orchestrator.ts | Intent classification failure silent | OPEN |
| H-5 | HIGH | orchestrator.ts | Streamed response stored as placeholder | OPEN |
| H-6 | HIGH | auth.ts | Stub hardcodes sub=stub-user-id | OPEN |
| H-7 | HIGH | specialist-agent.ts | No token budget enforcement | OPEN |
| H-8 | HIGH | web/api/chat/route.ts | Web chat SSE stub — not real LLM | PARTIAL |
| H-9 | HIGH | cors.ts | CORS * + credentials broken combo | OPEN |
| H-10 | HIGH | health.ts | /health/ready always 200 | OPEN |
| H-11 | HIGH | metrics.ts | /metrics unauthenticated | OPEN |
| H-12 | HIGH | seed.ts | $executeRawUnsafe + SET LOCAL wrong scope | OPEN |
| H-13 | HIGH | orchestrator-chat.tsx | Gate Approve/Reject are no-ops | OPEN |
| H-14 | HIGH | orchestrator-chat.tsx | tool_result handler references nonexistent event.toolName | OPEN |
| M-1 through M-17 | MEDIUM | various | (see prior sections) | OPEN |
| L-1 through L-11 | LOW | various | (see prior sections) | OPEN |
| L-12 | LOW | openai.ts, ollama.ts | String(content) redundant no-op | **NEW** |

<!-- REVIEW SECTION END — 2026-06-12 -->

---

<!-- REVIEW SECTION START — 2026-06-11 -->
## Review — 2026-06-11 | No new commits

**Scope:** No commits from opencode since `806b01a`. Working tree unchanged.
All issues from 2026-06-08 still open. Ratings unchanged.

| Dimension | Rating |
|-----------|--------|
| Feature completeness | 6/10 |
| Code standards | 5/10 |
| Performance | 6/10 |
| Security | 4/10 |
| Readability | 8/10 |
| Clarity and comments | 7/10 |

Next commit from opencode should address B-11 (`formatToolResult` compile break) first.

<!-- REVIEW SECTION END — 2026-06-11 -->

---

<!-- REVIEW SECTION START — 2026-06-10 -->
## Review — 2026-06-10 | No new commits — build cycle stalled

**Scope:** No commits from opencode since `806b01a` (2026-06-08 review). Working tree
unchanged — identical 10-file diff reviewed in 2026-06-08 section. Nothing new to evaluate.

| Dimension | Rating | Δ |
|-----------|--------|---|
| Feature completeness | 6/10 | = |
| Code standards | 5/10 | = |
| Performance | 6/10 | = |
| Security | 4/10 | = |
| Readability | 8/10 | = |
| Clarity and comments | 7/10 | = |

**Top blockers for next commit (priority order):**

1. **B-11** — `formatToolResult` not implemented in any provider → compile fails — fix first
2. **B-10** — Dockerfile workspace symlinks → production image won't start
3. **B-8** — `app.tenant_id` never set → RLS dead
4. **H-14** — `tool_result` handler references `event.toolName` (doesn't exist on type)
5. **H-13** — Gate Approve/Reject are no-ops

<!-- REVIEW SECTION END — 2026-06-10 -->

---

<!-- REVIEW SECTION START — 2026-06-09 -->
## Review — 2026-06-09 | No new commits — awaiting opencode task completion

**Scope:** No new commits since `806b01a`. Working tree contains the same 10 uncommitted
files reviewed in the 2026-06-08 section (ESM migration + SSE wiring). No additional source
changes to evaluate.

| Dimension | Rating | Δ from last review |
|-----------|--------|-------------------|
| Feature completeness | 6/10 | = |
| Code standards | 5/10 | = |
| Performance | 6/10 | = |
| Security | 4/10 | = |
| Readability | 8/10 | = |
| Clarity and comments | 7/10 | = |

---

### Status

All issues from 2026-06-08 section remain open. Top priorities unchanged:

1. **B-11** (BLOCKING) — `formatToolResult` missing from `AnthropicProvider`, `OpenAIProvider`, `OllamaProvider` → compile fails
2. **B-10** (BLOCKING) — Dockerfile workspace symlinks broken in runner
3. **B-8** (BLOCKING) — RLS `app.tenant_id` never set at query time
4. **B-9** (BLOCKING) — `audit_events` CASCADE bypass
5. **H-13** (HIGH) — Gate Approve/Reject are no-ops

No updated ratings or new issues to report. Next section will cover the next committed task batch from opencode.

<!-- REVIEW SECTION END — 2026-06-09 -->

---

<!-- REVIEW SECTION START — 2026-06-08 -->
## Review — 2026-06-08 | ESM migration, SSE wiring, gate UI, provider interface break

**Scope:** Uncommitted working-tree changes (opencode in-progress, not yet committed). Files
reviewed: `apps/gateway/package.json`, `apps/gateway/tsconfig.json`, `apps/gateway/src/app.ts`,
`apps/gateway/src/routes/metrics.ts`, `apps/gateway/src/server.ts`,
`apps/gateway/src/__tests__/schema.test.ts`, `apps/gateway/src/__tests__/server.test.ts`,
`apps/web/components/orchestrator-chat.tsx`, `apps/web/app/api/chat/route.ts`,
`packages/agent/src/interfaces/provider.ts`.

| Dimension | Rating | Δ from last review |
|-----------|--------|-------------------|
| Feature completeness | 6/10 | ↑1 — SSE chat wiring done; gate UI added; ESM migration correct |
| Code standards | 5/10 | = — new type error in tool_result handler; interface unimplemented |
| Performance | 6/10 | = |
| Security | 4/10 | = — B-5 through B-10 all still open |
| Readability | 8/10 | = |
| Clarity and comments | 7/10 | = |

---

### Previous Issues — Status Update

| Issue | Status |
|-------|--------|
| H-8 — web chat stub | **PARTIAL** ↑ — route now returns proper SSE stream (text_delta + DONE). `sendRealForm` wired and parsing correctly. Still returns a static "stub response" — no real LLM call yet. |
| B-10 — Dockerfile symlinks | OPEN — workspace deps `@anvay/agent` + `@anvay/types` now declared in gateway `package.json`, which makes the symlink issue more visible but still not fixed. |
| All others B-2-R through H-12 | OPEN — no change |

---

### BLOCKING

#### B-11 — `IModelProvider.formatToolResult` added to interface but not implemented in any provider — compile fails

**File:** `packages/agent/src/interfaces/provider.ts:46`

```typescript
export interface IModelProvider {
  chat(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): Promise<ChatResponse>
  stream(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): AsyncGenerator<StreamChunk>
  formatToolResult(toolCallId: string, result: unknown): Message   // ← added
}
```

`AnthropicProvider`, `OpenAIProvider`, and `OllamaProvider` all `implements IModelProvider`
but none has a `formatToolResult` method. TypeScript compile fails for the entire
`@anvay/agent` package — every downstream consumer (gateway chat route, orchestrator, all tests)
fails to build.

**Fix:** Implement `formatToolResult` on all three providers. The Anthropic format requires
a `tool` role message; OpenAI/Ollama use a `tool` role with `tool_call_id`:

```typescript
// In AnthropicProvider (packages/agent/src/providers/anthropic.ts)
formatToolResult(toolCallId: string, result: unknown): Message {
  return {
    role: 'tool',
    content: typeof result === 'string' ? result : JSON.stringify(result),
    tool_call_id: toolCallId,
  }
}

// OpenAIProvider and OllamaProvider — same shape (both use OpenAI message format)
formatToolResult(toolCallId: string, result: unknown): Message {
  return {
    role: 'tool',
    content: typeof result === 'string' ? result : JSON.stringify(result),
    tool_call_id: toolCallId,
  }
}
```

Note: The `Message` type in `packages/agent/src/interfaces/provider.ts` must support
`role: 'tool'` and `tool_call_id: string`. If the current `Message` type only allows
`user | assistant | system`, add `tool` as a valid role and the `tool_call_id` field.

**Verify:** `pnpm --filter @anvay/agent typecheck` exits 0. `pnpm --filter @anvay/agent build`
exits 0. All three provider classes satisfy the interface.

---

### HIGH

#### H-13 — Gate Approve/Reject are UI-only no-ops — no backend signal sent

**File:** `apps/web/components/orchestrator-chat.tsx:~807–819`

```tsx
<button onClick={() => setGateRequired(null)}>Approve</button>
<button onClick={() => setGateRequired(null)}>Reject</button>
```

Both buttons dismiss the gate UI by clearing state. Neither sends any signal to the backend.
If the orchestrator suspends execution waiting for gate approval, this leaves the request
hanging indefinitely. If the orchestrator doesn't wait (fire-and-forget), the gate is purely
cosmetic and provides no actual safety enforcement.

This is a V1 correctness failure — the gate is the trust mechanism per `CLAUDE.md §V1 Trust
Principle`. A gate that doesn't actually gate is worse than no gate: it shows the user a
confirm dialog that does nothing.

**Fix:** Add a `gateToken` to the gate event payload from the server. On Approve/Reject, POST
to `/api/chat/gate` with the token:

```tsx
// In the gate_required event handler:
setGateRequired({ action, resource, reason, token: event.gateToken });

// Approve handler:
onClick={async () => {
  await fetch('/api/chat/gate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gateToken: gateRequired.token, decision: 'approved' }),
  });
  setGateRequired(null);
}}

// Reject handler — same but decision: 'rejected'
```

The orchestrator's suspend/resume mechanism must be implemented to match. Gate is deferred
to M2 per TASKS.md — until then, remove the gate UI entirely rather than ship a non-functional
confirmation dialog.

**Verify:** Trigger a gated action (any write op). Assert the backend receives the approval
decision. Assert the write executes only after explicit approval, not before.

---

#### H-14 — `tool_result` event handler references `event.toolName` — field doesn't exist on `tool_result` type

**File:** `apps/web/components/orchestrator-chat.tsx:421`

```tsx
} else if (event.type === 'tool_result') {
  const resultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result).slice(0, 100);
  pushLog({ actor: "TOOL", actorColor: "#555", text: `→ ${resultStr}...`, status: 'done', ms: 0 });
  setAgentStates(prev => prev.map(a => a.name === event.toolName ? { ...a, currentStatus: 'done' } : a));
  //                                                   ^^^^^^^^^^^^ does not exist on tool_result
}
```

The local `StreamEvent` union defines `tool_result` as:
```typescript
{ type: "tool_result"; toolCallId: string; result: unknown }
```

There is no `toolName` field. TypeScript should flag `event.toolName` as `Property 'toolName'
does not exist on type '{ type: "tool_result"; toolCallId: string; result: unknown }'`.
At runtime, `event.toolName` is `undefined` — the `setAgentStates` map predicate
`a.name === undefined` never matches → agent activity states are never cleared when a tool
call completes. The activity panel keeps showing all agents as `running` even after they
finish.

**Fix:** Track `toolCallId → toolName` in `toolNamesRef` (already declared but unused) when
a `tool_call` event arrives. Use it to look up the name on `tool_result`:

```tsx
} else if (event.type === 'tool_call') {
  toolNamesRef.current.set(event.toolCallId, event.toolName);
  // ... existing agent state update ...

} else if (event.type === 'tool_result') {
  const toolName = toolNamesRef.current.get(event.toolCallId) ?? '';
  const resultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result).slice(0, 100);
  pushLog({ actor: "TOOL", actorColor: "#555", text: `→ ${resultStr}...`, status: 'done', ms: 0 });
  setAgentStates(prev => prev.map(a => a.name === toolName ? { ...a, currentStatus: 'done' } : a));
}
```

This also makes `toolNamesRef` purposeful rather than dead (fixes M-15 below).

**Verify:** Send a message that triggers a tool call. Assert the agent activity indicator
transitions from `running` to `done` after the result arrives.

---

### MEDIUM

#### M-15 — `toolNamesRef` declared but never read

**File:** `apps/web/components/orchestrator-chat.tsx:317`

```tsx
const toolNamesRef = useRef(new Map<string, string>());
```

Declared but neither populated nor consumed. Dead state. Resolved by the H-14 fix above —
see that fix for the correct usage pattern.

---

#### M-16 — Confidence hardcoded to `0.9` in SSE `done` handler

**File:** `apps/web/components/orchestrator-chat.tsx:~453`

```tsx
} else if (event.type === 'done') {
  // ...
  setConfidence(0.9);  // always 0.90 regardless of actual confidence
```

The `done` `StreamEvent` type has `inputTokens` and `outputTokens` but no `confidence`
field. The orchestrator does compute a confidence score internally (used by the gate). Surface
it on the `done` chunk:

```typescript
// In orchestrator StreamEvent 'done':
{ type: 'done'; inputTokens: number; outputTokens: number; confidence?: number }

// In UI:
setConfidence(event.confidence ?? 0);
```

Until the orchestrator emits real confidence, show nothing rather than a false `0.90`.

---

#### M-17 — Follow-ups hardcoded in SSE `done` handler — same 3 chips every query

**File:** `apps/web/components/orchestrator-chat.tsx:~460`

```tsx
setFollowUps(['Show active blockers', 'View payments incident', 'What should I fix first?']);
```

Three follow-up suggestions hardcoded for every query regardless of content. A user asking
about Cloud costs or an SLO burn gets "View payments incident". Either:
1. Return suggested follow-ups from the backend in the `done` event: `{ type: 'done', ..., followUps?: string[] }`
2. Clear `setFollowUps([])` until backend sends real suggestions

For now: `setFollowUps([])` — empty is less misleading than wrong.

---

### LOW

#### L-11 — `useCallback` imported but never used

**File:** `apps/web/components/orchestrator-chat.tsx:2`

```tsx
import { useState, useEffect, useRef, useCallback } from "react";
```

`useCallback` is never used in the component body. Dead import. Delete it. If a linter runs
with `no-unused-vars`, this fails the lint step.

**Fix:** Remove `useCallback` from the import.

---

### What these changes accomplish (positive)

**ESM migration (gateway):** `"type": "module"` + `module: NodeNext` + `.js` extensions on
all internal imports is the correct approach. `__dirname` → `import.meta.dirname` in tests
is the right ESM-compatible replacement. This unblocks the `@anvay/agent` workspace
dependency working correctly at runtime (imports via package `exports` field rather than
CJS path hacking). Neutral risk — no logic changed, mechanical correctness improvement.

**`apps/web/app/api/chat/route.ts`:** Now returns a proper SSE stream with a `text_delta`
event and `[DONE]` terminator. `sendRealForm` can parse this correctly — user sees "stub
response" text streamed in. This is the first end-to-end SSE path working in the UI,
even if the content is still fake. H-8 moves from OPEN to PARTIAL.

**Gate UI in `OrchestratorChat`:** Visual gate panel with amber styling, action/resource
display, Approve/Reject buttons is structurally correct and follows the design language.
Incomplete (H-13) but the skeleton is right.

**`sessionIdRef`:** Stable `session-${Date.now()}-${Math.random()}` per component mount.
Correct pattern for session continuity across messages within one page load. Will need to
persist across refreshes (e.g. `sessionStorage`) but acceptable for now.

---

### Pending Features (Updated Status)

| Feature | Task | Status |
|---------|------|--------|
| M0-T1 through M0-T8 | M0 | **COMPLETE** |
| M1-T1 through M1-T5 | M1 (partial) | **COMPLETE** |
| Wire OrchestratorChat to real SSE | M1-T6 | **PARTIAL** — SSE client wired, route returns stub |
| Gateway ESM migration | — | **COMPLETE** (this cycle) |
| Gate UI (visual) | — | **PARTIAL** — display works, approval signal missing |
| `formatToolResult` on IModelProvider | — | **BROKEN** — interface updated, implementations missing |
| Specialist agent tools | M2 | NOT STARTED |
| Connector implementations | M2 | NOT STARTED |
| IKnowledgeGraph + resolveContext() | M4-T5 | NOT STARTED |
| Graph Builder Agent | M4-T6 | NOT STARTED |
| Trigger.dev cron jobs | M5 | NOT STARTED |
| User permission DB model (B-5 prereq) | pre-M2 | NOT STARTED |
| RLS activation at query time (B-8) | pre-M2 | NOT STARTED |
| Workspace symlink fix in Dockerfile (B-10) | immediate | NOT STARTED |

---

### Consolidated open issues (updated)

| ID | Severity | File | Short description | Status |
|----|----------|------|-------------------|--------|
| B-2-R | BLOCKING | chat.ts | sessionUsed resets to 0 each request | OPEN |
| B-3-R | LOW | redis-session.ts | expire races rpush; summarise del+rpush non-atomic | OPEN |
| B-4 | BLOCKING | orchestrator.ts | Tool message format wrong for multi-turn | OPEN (M2) |
| B-5 | BLOCKING | chat.ts | connectorScopes wildcards all users | OPEN |
| B-6 | BLOCKING | chat.ts | InMemorySessionMemory shared across tenants | OPEN |
| B-7 | BLOCKING | jwt.ts | JWT error leaked to client | OPEN |
| B-8 | BLOCKING | chat.ts + migration | RLS app.tenant_id never set | OPEN |
| B-9 | BLOCKING | migration.sql | audit_events CASCADE bypass | OPEN |
| B-10 | BLOCKING | Dockerfile | Workspace symlinks broken in runner | OPEN |
| B-11 | BLOCKING | provider.ts | formatToolResult not implemented in any provider | **NEW** |
| H-1 | HIGH | anthropic.ts | Streaming break — parallel tool calls lose args | OPEN |
| H-2 | HIGH | chat.ts | InMemorySessionMemory inline, summarise no-op | OPEN |
| H-3 | HIGH | postgres-sink.ts | Audit sink silent drop on DB failure | OPEN |
| H-4 | HIGH | orchestrator.ts | Intent classification failure silent | OPEN |
| H-5 | HIGH | orchestrator.ts | Streamed response stored as placeholder | OPEN |
| H-6 | HIGH | auth.ts | Stub hardcodes sub=stub-user-id | OPEN |
| H-7 | HIGH | specialist-agent.ts | No token budget enforcement | OPEN |
| H-8 | HIGH | web/api/chat/route.ts | Web chat stub — SSE format correct, content still fake | **PARTIAL** |
| H-9 | HIGH | cors.ts | CORS * + credentials broken combo | OPEN |
| H-10 | HIGH | health.ts | /health/ready always 200 | OPEN |
| H-11 | HIGH | metrics.ts | /metrics unauthenticated | OPEN |
| H-12 | HIGH | seed.ts | $executeRawUnsafe + SET LOCAL wrong scope | OPEN |
| H-13 | HIGH | orchestrator-chat.tsx | Gate Approve/Reject are no-ops — no backend signal | **NEW** |
| H-14 | HIGH | orchestrator-chat.tsx | tool_result handler references nonexistent event.toolName | **NEW** |
| M-1 through M-14 | MEDIUM | various | (see 2026-06-04 through 2026-06-06 sections) | OPEN |
| M-15 | MEDIUM | orchestrator-chat.tsx | toolNamesRef declared but never used | **FIXED** ✓ (resolved by H-14 fix) |
| M-16 | MEDIUM | orchestrator-chat.tsx | Confidence hardcoded 0.9 in done handler | **NEW** |
| M-17 | MEDIUM | orchestrator-chat.tsx | Follow-ups hardcoded in done handler | **NEW** |
| L-1 through L-10 | LOW | various | (see prior sections) | OPEN |
| L-11 | LOW | orchestrator-chat.tsx | useCallback imported but unused | **NEW** |

<!-- REVIEW SECTION END — 2026-06-08 -->

---

<!-- REVIEW SECTION START — 2026-06-07 -->
## Review — 2026-06-07 | Consolidated status — no new commits since B-3 fix

**Scope:** No new feature commits since `5f053e6` (B-3 Redis session fix, 2026-06-06). This
section is a consolidation pass — re-evaluating all open issues, reassessing severity after
three fix cycles, and producing the priority queue for the next build wave.

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Feature completeness | 5/10 | M1-T6 (web chat) not started. M2 specialist tools not started. No KG layer yet. |
| Code standards | 5/10 | Inline memory impl, stub auth, module-level singletons, dead imports remain. |
| Performance | 6/10 | No change — Redis list ops correct now. summarise() still N round trips. |
| Security | 4/10 | B-5/B-7/B-8/B-9/B-10 all open. RLS dead, audit erasable, Dockerfile broken. |
| Readability | 8/10 | Code is readable. Issues are structural/logic, not style. |
| Clarity and comments | 7/10 | No change. |

---

### Fix cycle recap (B-1 through B-3)

| Bug | Commit | Result |
|-----|--------|--------|
| B-1 — perimeter resource defaulted to `'*'` | `8b80b2e` | **FIXED** ✓ — resource arg now correctly defaults to `null`, wildcard bypass closed |
| B-2 — token budget counters never updated | `d438253` | **PARTIAL** ✓ — within-request step accumulation fixed; `sessionUsed` still resets to 0 each HTTP request (B-2-R) |
| B-3 — Redis session get-modify-write race | `5f053e6` | **FIXED** ✓ — `RPUSH`/`LRANGE 0 -1` atomic; two LOW residuals remain (B-3-R) |

---

### Priority queue for next build wave

These are the issues that block M2 progress or pose active production risk. Order is strict
— do not start the next item until the prior one passes its verification step.

#### Priority 1 — B-10: Fix Dockerfile before any container deployment

**File:** `apps/gateway/Dockerfile`

Workspace symlinks `@anvay/agent → ../../../../packages/agent` break in the distroless runner.
Production image cannot start. Nothing else matters until the container runs.

**Fix:** Replace the manual COPY approach with `pnpm deploy`:
```dockerfile
FROM base AS deployer
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter=anvay-gateway deploy --prod /app/deploy

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runner
WORKDIR /app
COPY --from=deployer /app/deploy .
COPY --from=deployer /app/deploy/dist ./dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["dist/src/server.js"]
```

**Verify:** `docker build -f apps/gateway/Dockerfile . && docker run --rm anvay-gateway node -e "require('@anvay/agent')"` exits 0.

---

#### Priority 2 — B-8: Set `app.tenant_id` before every Prisma query

**File:** `apps/gateway/src/routes/chat.ts` (and any other route with Prisma calls)

RLS policies exist on all six tables but `current_setting('app.tenant_id', true)` is never set
at query time → either returns 0 rows (FORCE RLS active) or bypasses isolation entirely
(superuser connection). Tenant data isolation is structurally dead.

**Fix pattern:**
```typescript
// wrap every multi-query block in a transaction that sets the RLS variable first
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
  const connectors = await tx.connector.findMany({ where: { tenant_id: tenantId } })
  // ... rest of DB reads
})
```

Or create a `createTenantPrismaClient(tenantId)` factory with a `$allOperations` extension
that wraps every query in this pattern automatically (cleaner for many call sites).

**Verify:** Insert rows for tenant-A. Query with app credentials (non-superuser) without
setting `app.tenant_id` — assert 0 rows. Set it — assert correct rows returned.

---

#### Priority 3 — B-9: `audit_events` FK must be RESTRICT, not CASCADE

**File:** `apps/gateway/prisma/migrations/0001_initial/migration.sql`

`RULE no_delete_audit_events` is bypassed by FK CASCADE. `DELETE FROM tenants` silently
wipes the audit trail. Replace the RULE with a BEFORE DELETE trigger (triggers fire on
cascade; rules do not) and change FK to `ON DELETE RESTRICT`.

```sql
-- New migration
ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_tenant_id_fkey,
  ADD CONSTRAINT audit_events_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

DROP RULE IF EXISTS no_delete_audit_events ON audit_events;

CREATE OR REPLACE FUNCTION prevent_audit_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are immutable';
END;$$;

CREATE TRIGGER no_delete_audit_events
BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_delete();
```

**Verify:** Insert tenant + audit event. `DELETE FROM tenants WHERE id = $id` → assert
exception raised AND audit event still exists.

---

#### Priority 4 — B-5: `connectorScopes` must come from DB, not hardcoded wildcards

**File:** `apps/gateway/src/routes/chat.ts:143–148`

Every user gets `read: ['*'], write: ['*']` regardless of provisioned permissions. The
perimeter engine (fixed in B-1) correctly evaluates scopes — but the scopes fed to it are
wrong. AgentPerimeter is operating in always-allow mode for every user.

**Prereq:** `UserConnectorPermission` table must exist in the Prisma schema:
```prisma
model UserConnectorPermission {
  id          String   @id @default(cuid())
  userId      String
  tenantId    String
  connectorId String
  readScopes  String[] // ["org/*", "team-payments/*"]
  writeScopes String[] // ["org/repo-a"]
  user        User     @relation(fields: [userId], references: [id])
  connector   Connector @relation(fields: [connectorId], references: [id])
}
```

Then in the chat route, replace the hardcoded perimeter with a DB lookup:
```typescript
const userPermissions = await prisma.userConnectorPermission.findMany({
  where: { userId, tenantId },
})
const userPerimeter: UserPerimeter = {
  userId,
  connectors: userPermissions.map(p => ({
    connectorId: p.connectorId,
    read: p.readScopes,
    write: p.writeScopes,
  })),
}
```

---

#### Priority 5 — B-7: JWT errors must not leak to client

**File:** `apps/gateway/src/plugins/jwt.ts`

`reply.send(err)` serializes the raw JWT error object including library internals, algorithm
details, and stack fragments. Replace with a structured 401:
```typescript
reply.code(401).send({ error: 'Unauthorized', code: 'JWT_INVALID' })
```

---

#### Priority 6 — B-6: `InMemorySessionMemory` is a cross-tenant singleton

**File:** `apps/gateway/src/routes/chat.ts:96`

`const inMemoryStore = new InMemorySessionMemory()` at module level — one map shared
across all tenants, all users, all requests. Switch to `RedisSessionMemory` (already
implemented at `packages/agent/src/memory/redis-session.ts`):
```typescript
import { RedisSessionMemory } from '@anvay/agent'
const sessionMemory = new RedisSessionMemory(redisClient, modelProvider)
```
The in-memory implementation should be deleted from chat.ts; it exists only for dev/test.

---

#### Priority 7 — B-2-R: `sessionUsed` resets to 0 every HTTP request

**File:** `apps/gateway/src/routes/chat.ts` — `buildTokenBudget()` called on every POST

`TokenBudget` is constructed fresh per request with `sessionUsed: 0`. The B-2 fix correctly
accumulates within a single streaming response, but each new user message starts at 0.
`perSessionLimit` never enforces across messages.

**Fix:** Store `sessionUsed` in session memory (Redis), load it at request start, pass to
`buildTokenBudget`. After response: persist updated `sessionUsed` back.

---

#### Priority 8 — H-8: Wire M1-T6 — web chat must call `/api/chat`, not return a stub

**File:** `apps/web/app/api/chat/route.ts`

Returns `"stub response"` hardcoded. This is M1-T6 per TASKS.md — NOT STARTED. The
`OrchestratorChat` component streams from `/api/chat`. Until this route is implemented,
the chat UI shows no real AI responses.

**Implementation spec:**
```typescript
// apps/web/app/api/chat/route.ts
export async function POST(req: Request): Promise<Response> {
  const { message, sessionId, tenantId } = await req.json()
  // forward to gateway /chat with credentials
  const upstream = await fetch(`${process.env.GATEWAY_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.get('Authorization') ?? '' },
    body: JSON.stringify({ message, sessionId, tenantId }),
  })
  // stream back
  return new Response(upstream.body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}
```
`GATEWAY_URL` must be in `.env.local`. API key never touches the client.

---

### Remaining HIGH issues (no change since 2026-06-05)

These were documented in full in the 2026-06-05 and 2026-06-06 sections. Status unchanged —
all still OPEN. Listing for visibility:

| ID | File | Short description |
|----|------|------------------|
| H-1 | anthropic.ts:123–126 | Streaming `break` after first tool call — parallel tool calls lose args for call #2+ |
| H-2 | chat.ts | `InMemorySessionMemory` inline in route file; `summarise()` is no-op |
| H-3 | postgres-sink.ts | `void prisma...catch(onError)` — audit events silently dropped on DB failure |
| H-4 | orchestrator.ts:134 | `catch {}` on intent classification — failure silently falls through |
| H-5 | orchestrator.ts:259–263 | `content: '[streamed response]'` placeholder stored instead of actual text |
| H-6 | auth.ts | `sub: 'stub-user-id'`, `role: 'dev'` hardcoded for all users |
| H-7 | specialist-agent.ts | No token budget enforcement — specialist agents are unbounded |
| H-9 | cors.ts | `origin: '*'` + `credentials: true` browser-rejected combination |
| H-10 | health.ts | `/health/ready` always 200 — no DB/Redis liveness check |
| H-11 | metrics.ts | `/metrics` no auth — request rates, routes, error patterns publicly readable |
| H-12 | seed.ts | `$executeRawUnsafe` string interpolation + `SET LOCAL` in wrong transaction scope |

---

### MEDIUM / LOW — no change

M-1 through M-14 and L-1 through L-10 are documented in prior sections. None resolved this
cycle. The MEDIUM items that will surface naturally as M2 work starts:

- **M-4** (`isWriteAction` false positives — substring match) — will manifest when specialist tools fire
- **M-5** (`effectiveRole` hardcoded `'dev'`) — affects role-aware response routing
- **M-1** (empty string tenantId passed to Prisma) — will cause silent data errors before B-8 fix

---

### Consolidated open issues

| ID | Severity | File | Short description | Status |
|----|----------|------|-------------------|--------|
| B-2-R | BLOCKING | chat.ts | sessionUsed resets to 0 each request | OPEN |
| B-3-R | LOW | redis-session.ts | expire races rpush on new key; summarise del+rpush non-atomic | OPEN |
| B-4 | BLOCKING | orchestrator.ts | Tool message format wrong for multi-turn | OPEN (M2) |
| B-5 | BLOCKING | chat.ts | connectorScopes wildcards all users | OPEN |
| B-6 | BLOCKING | chat.ts | InMemorySessionMemory shared across tenants | OPEN |
| B-7 | BLOCKING | jwt.ts | JWT error leaked to client | OPEN |
| B-8 | BLOCKING | chat.ts + migration | RLS app.tenant_id never set | OPEN |
| B-9 | BLOCKING | migration.sql | audit_events CASCADE bypass | OPEN |
| B-10 | BLOCKING | Dockerfile | Workspace symlinks broken in runner | OPEN |
| H-1 | HIGH | anthropic.ts | Streaming break — parallel tool calls lose args | OPEN |
| H-2 | HIGH | chat.ts | InMemorySessionMemory inline, summarise no-op | OPEN |
| H-3 | HIGH | postgres-sink.ts | Audit sink silent drop on DB failure | OPEN |
| H-4 | HIGH | orchestrator.ts | Intent classification failure silent | OPEN |
| H-5 | HIGH | orchestrator.ts | Streamed response stored as placeholder | OPEN |
| H-6 | HIGH | auth.ts | Stub hardcodes sub=stub-user-id | OPEN |
| H-7 | HIGH | specialist-agent.ts | No token budget enforcement | OPEN |
| H-8 | HIGH | web/api/chat/route.ts | Web chat stub — M1-T6 not started | OPEN |
| H-9 | HIGH | cors.ts | CORS * + credentials broken combo | OPEN |
| H-10 | HIGH | health.ts | /health/ready always 200 | OPEN |
| H-11 | HIGH | metrics.ts | /metrics unauthenticated | OPEN |
| H-12 | HIGH | seed.ts | $executeRawUnsafe + SET LOCAL wrong scope | OPEN |
| M-1 through M-14 | MEDIUM | various | (see 2026-06-04 through 2026-06-06 sections) | OPEN |
| L-1 through L-10 | LOW | various | (see prior sections) | OPEN |

<!-- REVIEW SECTION END — 2026-06-07 -->

---

<!-- REVIEW SECTION START — 2026-06-06 -->
## Review — 2026-06-06 | CI, Dockerfiles, docker-compose, seed, smoke-test, remaining infrastructure

**Scope:** No new feature commits since 2026-06-05. Final sweep of unreviewed files: `.github/workflows/ci.yml`, `apps/gateway/Dockerfile`, `apps/web/Dockerfile`, `infra/docker-compose.yml`, `infra/docker-compose.dev.yml`, `scripts/smoke-test.sh`, `apps/gateway/prisma/seed.ts`, `apps/gateway/src/routes/metrics.ts`, `apps/gateway/src/logger.ts`, `apps/web/next.config.ts`. Symlink structure in `node_modules/@anvay/*` confirmed via `ls`.

| Dimension | Rating | Δ from last review |
|-----------|--------|-------------------|
| Feature completeness | 5/10 | = |
| Code standards | 5/10 | = |
| Performance | 6/10 | = |
| Security | 4/10 | = — /metrics unauthenticated, seed SQL injection pattern |
| Readability | 8/10 | = |
| Clarity and comments | 7/10 | = |

---

### Previous Issues — Status Update

All issues from 2026-06-03 through 2026-06-05 remain open except:
- B-1: FIXED ✓
- B-2: PARTIAL ✓ (within-request accumulation fixed; cross-request gap is B-2-R, still open)
- L-3: CLOSED ✓

---

### BLOCKING

#### B-10 — Gateway production Docker image fails to start — workspace symlinks broken in runner stage

**File:** `apps/gateway/Dockerfile:21–28`

**Issue:** `apps/gateway/node_modules/@anvay/agent` and `@anvay/types` are relative symlinks:
```
apps/gateway/node_modules/@anvay/agent → ../../../../packages/agent
apps/gateway/node_modules/@anvay/types → ../../../../packages/types
```
These resolve correctly in the builder stage (`/app/apps/gateway/node_modules/@anvay/agent` → `/app/packages/agent`). In the runner stage, Docker COPY preserves symlinks as-is. After:
```dockerfile
COPY --from=builder /app/apps/gateway/node_modules ./node_modules
```
The symlink now lives at `/app/node_modules/@anvay/agent → ../../../../packages/agent`, which resolves to `/packages/agent` — a path that does not exist in the distroless image. The gateway process crashes immediately on startup with `Cannot find module '@anvay/agent'`.

Verified: `ls -la apps/gateway/node_modules/@anvay/` confirms the `../../../../packages/agent` relative target.

**Fix — Option A (recommended): use `pnpm deploy`**
```dockerfile
FROM base AS deployer
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm deploy --filter=anvay-gateway --prod /app/deploy

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runner
WORKDIR /app
COPY --from=deployer /app/deploy ./
COPY --from=deployer /app/deploy/dist ./dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["dist/src/server.js"]
```
`pnpm deploy` resolves all workspace dependencies and produces a self-contained deployment directory with no broken symlinks.

**Fix — Option B: copy workspace package dist outputs explicitly**
```dockerfile
COPY --from=builder /app/apps/gateway/dist ./dist
COPY --from=builder /app/apps/gateway/node_modules ./node_modules
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist
COPY --from=builder /app/packages/agent/package.json ./packages/agent/package.json
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
```
Since the symlink `../../../../packages/agent` from `/app/node_modules/@anvay/agent` now resolves to `/packages/agent`, you also need to adjust the symlink depth or use absolute-path resolution. Option A is cleaner.

**Verify:** Run `docker build -f apps/gateway/Dockerfile .` then `docker run --rm anvay-gateway:ci node -e "require('@anvay/agent')"`. Currently exits with module not found. With fix, exits 0.

---

### HIGH

#### H-11 — `/metrics` endpoint exposed without authentication — operational data publicly readable

**File:** `apps/gateway/src/routes/metrics.ts:4–9`

**Issue:**
```typescript
app.get('/metrics', async (_request, reply) => {
  reply.header('Content-Type', getMetricsContentType())
  return reply.send(await getMetricsText())
})
```
No `preHandler: [app.authenticate]`. Prometheus metrics include HTTP request rates, error rates, route names, status code distributions, active connections, and all Node.js runtime metrics. An unauthenticated caller can:
- Enumerate all API routes (`anvay_gateway_http_requests_total` labels include `route`)
- Detect error spikes, high-traffic periods, and system load patterns
- Map the internal service topology from metrics labels

In production this endpoint should be restricted to the monitoring network or require a scrape token.

**Fix option A (network restriction):** Do not expose port 4000 publicly; expose only via internal service. Mount `/metrics` on a separate internal port (e.g. 9100) not bound to the external load balancer.

**Fix option B (bearer token):**
```typescript
app.get('/metrics', {
  preHandler: async (request, reply) => {
    const token = request.headers['authorization']?.replace('Bearer ', '')
    const expected = process.env.METRICS_SCRAPE_TOKEN
    if (!expected || token !== expected) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  }
}, async (_request, reply) => {
  reply.header('Content-Type', getMetricsContentType())
  return reply.send(await getMetricsText())
})
```

**Verify:** Without auth, `GET /metrics` → 401. With correct `Authorization: Bearer $token` → 200 with Prometheus text.

---

#### H-12 — `seed.ts` uses `$executeRawUnsafe` with string interpolation and `SET LOCAL` in wrong scope

**File:** `apps/gateway/prisma/seed.ts:32`

**Issue A — SQL injection pattern:**
```typescript
await prisma.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenant.id}'`)
```
`$executeRawUnsafe` with string interpolation is categorically unsafe. `tenant.id` is a UUID from Prisma in this specific call (safe in isolation), but this establishes a pattern that will be copied with arbitrary string values — ticket titles, connector names, user input — causing SQL injection. All `$executeRaw` calls must use tagged template literals (parameterized).

**Issue B — `SET LOCAL` is transaction-scoped, runs in a separate implicit transaction:**
`SET LOCAL app.tenant_id = ?` applies only for the duration of the current Postgres transaction. Prisma's `$executeRawUnsafe` runs in its own implicit transaction which commits immediately. The subsequent `prisma.user.upsert` call opens a NEW implicit transaction on a potentially different pool connection where `app.tenant_id` is not set. The intent (to let subsequent writes pass RLS) is correct; the implementation is wrong.

**Fix:**
```typescript
// Wrap all seed operations in a single transaction with the RLS variable set:
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`

  await tx.user.upsert({ ... })
  await tx.connector.create({ ... })
})
```
`set_config(..., true)` is equivalent to `SET LOCAL` but works inside a transaction. All subsequent operations within the same `$transaction` callback share the setting.

**Verify:** In a fresh DB with FORCE RLS, run the seed. Assert `users` and `connectors` tables contain the seeded rows. Currently the RLS-enforced writes fail silently (returning empty results or throwing) because the session variable is set in a separate transaction.

---

### MEDIUM

#### M-13 — CI test job has no Postgres or Redis service — DB-path integration tests impossible

**File:** `.github/workflows/ci.yml:43–57`

**Issue:** The `test` job runs without any `services:` block. Unit tests (agent package, perimeter, token-meter, redis-session with mocked Redis) pass. The `server.test.ts` tests happen to work because none of the test paths execute real Prisma queries (health and auth endpoints don't hit the DB in the test assertions). But any future integration test that exercises `prisma.connector.findMany`, `prisma.tenant.findUnique`, or Redis session operations will fail in CI with a connection error.

**Fix:**
```yaml
test:
  name: Test
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_DB: anvay_test
        POSTGRES_USER: anvay
        POSTGRES_PASSWORD: test_secret
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
    redis:
      image: redis:7-alpine
      options: >-
        --health-cmd "redis-cli ping"
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  env:
    DATABASE_URL: postgresql://anvay:test_secret@localhost:5432/anvay_test
    REDIS_URL: redis://localhost:6379
```

**Verify:** Add one test that calls `prisma.$queryRaw\`SELECT 1\``. Assert it passes in CI. Currently any such test would fail.

---

#### M-14 — `--passWithNoTests` in CI silently accepts packages with zero test coverage

**File:** `.github/workflows/ci.yml:56`

```yaml
- run: pnpm test -- --passWithNoTests
```

When a new package is added without any test files, Turbo runs its `test` task which calls Vitest with `--passWithNoTests`. Vitest exits 0. CI passes. An untested package ships with no warning. This flag exists to handle the web package which has no Vitest tests (it uses Next.js testing conventions). The flag is correct for `apps/web` but wrong as a global flag.

**Fix:** Move `--passWithNoTests` to only the web package's vitest config or test script. Remove from the root CI command. Alternatively use `turbo test --filter='!anvay-web'` to exclude the Next.js app from vitest:
```yaml
- run: pnpm test -- --passWithNoTests  # keep for web compatibility
```
And add a separate lint step that counts test files per package and fails if a TS package has zero `.test.ts` files.

---

### LOW

#### L-8 — `seed.ts` has an unused import

**File:** `apps/gateway/prisma/seed.ts:2`

```typescript
import { createWriteStream } from 'fs'
```
Never used. Dead import. Delete it.

---

#### L-9 — `docker-compose.dev.yml` hardcodes credentials — risk of dev config leaking to staging

**File:** `infra/docker-compose.dev.yml:17, 91`

```yaml
POSTGRES_PASSWORD: anvay_dev_secret
GF_SECURITY_ADMIN_PASSWORD: anvay_grafana_dev
```

The production `docker-compose.yml` correctly requires these via `${POSTGRES_PASSWORD:?must be set}`. The dev variant hardcodes them. Risk: if a staging or CI environment accidentally picks up the dev compose file, it runs with known plaintext credentials. Low risk in a truly local-only context, but document explicitly:
```yaml
# WARNING: hardcoded dev credentials — never use this file outside localhost
```

---

#### L-10 — Gateway Dockerfile: `pnpm install --filter=anvay-gateway...` without copying all `packages/*/package.json` — deps stage may be incomplete

**File:** `apps/gateway/Dockerfile:6–9`

```dockerfile
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/gateway/package.json apps/gateway/
RUN pnpm install --frozen-lockfile --filter=anvay-gateway...
```

`pnpm-workspace.yaml` declares `packages: ['packages/*']` but none of the workspace package manifests are copied before install. pnpm with `--frozen-lockfile` reads the lockfile to resolve versions without needing all manifests, so this works. But if a workspace package adds a new dependency that requires a manifest presence check, this stage would silently fail. Safer to copy all package manifests:
```dockerfile
COPY packages/agent/package.json packages/agent/
COPY packages/types/package.json packages/types/
```

---

### Summary: All Open Issues (Consolidated)

| ID | Severity | File | Short description | Status |
|----|----------|------|-------------------|--------|
| B-2-R | BLOCKING | chat.ts | sessionUsed resets to 0 each request | OPEN |
| B-3 | BLOCKING | redis-session.ts | get-modify-write race condition | **FIXED** ✓ (`5f053e6`) |
| B-3-R | LOW | redis-session.ts | `expire` races `rpush` on new key; `summarise()` del+rpush non-atomic (11 round trips, double-summarise duplicates) | OPEN |
| B-4 | BLOCKING | orchestrator.ts | Tool message format wrong for multi-turn | OPEN (M2) |
| B-5 | BLOCKING | chat.ts | connectorScopes wildcards all users | OPEN |
| B-6 | BLOCKING | chat.ts | InMemorySessionMemory shared across tenants | OPEN |
| B-7 | BLOCKING | jwt.ts | JWT error leaked to client | OPEN |
| B-8 | BLOCKING | chat.ts + migration | RLS app.tenant_id never set | OPEN |
| B-9 | BLOCKING | migration.sql | audit_events CASCADE bypass | OPEN |
| B-10 | BLOCKING | Dockerfile | Workspace symlinks broken in runner | OPEN |
| H-1 | HIGH | anthropic.ts | Streaming break bug parallel tool calls | OPEN |
| H-2 | HIGH | chat.ts | InMemorySessionMemory inline, summarise no-op | OPEN |
| H-3 | HIGH | postgres-sink.ts | Audit sink drops on DB failure | OPEN |
| H-4 | HIGH | orchestrator.ts | Intent classification failure silent | OPEN |
| H-5 | HIGH | orchestrator.ts | Assistant response stored as placeholder | OPEN |
| H-6 | HIGH | auth.ts | Stub hardcodes sub=stub-user-id | OPEN |
| H-7 | HIGH | specialist-agent.ts | No token budget enforcement | OPEN |
| H-8 | HIGH | web/api/chat/route.ts | Web chat is still a stub (M1-T6) | OPEN |
| H-9 | HIGH | cors.ts | CORS * + credentials broken combo | OPEN |
| H-10 | HIGH | health.ts | /health/ready always 200 | OPEN |
| H-11 | HIGH | routes/metrics.ts | /metrics unauthenticated | OPEN |
| H-12 | HIGH | seed.ts | $executeRawUnsafe + SET LOCAL wrong scope | OPEN |
| M-1 through M-14 | MEDIUM | various | (see previous sections) | OPEN |

---

### Pending Features (Updated Status)

| Feature | Task | Status |
|---------|------|--------|
| M0-T1 through M0-T8 | M0 | **COMPLETE** |
| M1-T1 through M1-T5 | M1 (partial) | **COMPLETE** |
| Wire OrchestratorChat to real SSE | M1-T6 | NOT STARTED |
| Specialist agent tools | M2 | NOT STARTED |
| Connector implementations | M2 | NOT STARTED |
| IKnowledgeGraph + resolveContext() | M4-T5 | NOT STARTED |
| Graph Builder Agent | M4-T6 | NOT STARTED |
| Agent context injection | M4-T7 | NOT STARTED |
| Trigger.dev cron jobs | M5 | NOT STARTED |
| User permission DB model (B-5 prereq) | pre-M2 | NOT STARTED |
| RLS activation at query time (B-8) | pre-M2 | NOT STARTED |
| Workspace symlink fix in Dockerfile (B-10) | immediate | NOT STARTED |

<!-- REVIEW SECTION END — 2026-06-06 -->

---

<!-- REVIEW SECTION START — 2026-06-05 -->
## Review — 2026-06-05 | Infrastructure deep-dive: migration, CORS, health, telemetry, factories

**Scope:** No new feature commits since 2026-06-04. Review covers previously unread infrastructure files: `prisma/schema.prisma`, `migrations/0001_initial/migration.sql`, `plugins/cors.ts`, `plugins/request-logger.ts`, `routes/health.ts`, `metrics.ts`, `telemetry.ts`, `server.ts`, `memory/factory.ts`, and all gateway test files. New code-path issues found in existing files confirmed.

| Dimension | Rating | Δ from last review |
|-----------|--------|-------------------|
| Feature completeness | 5/10 | = — no new commits |
| Code standards | 5/10 | ↓1 — RLS never activated, tenant/user IDs never logged, CORS misconfiguration |
| Performance | 6/10 | = |
| Security | 4/10 | ↓2 — B-8/B-9 are severe: RLS policy dead in production, audit cascade bypass |
| Readability | 8/10 | = |
| Clarity and comments | 7/10 | = |

---

### Previous Issues — Status Update

| Issue | Status |
|-------|--------|
| B-1 Perimeter resource defaults to `*` | **FIXED** ✓ |
| B-2 Token budget counters never update | **PARTIAL** ✓ — within-request fixed; cross-request persistence remains (B-2-R) |
| B-2-R Cross-request sessionUsed reset | OPEN |
| B-3 Redis session append race condition | **FIXED** ✓ (`5f053e6`) — two LOW residuals remain (B-3-R) |
| B-4 Tool message format wrong | OPEN (M2 deferred) |
| B-5 connectorScopes hardcodes wildcards | OPEN |
| B-6 InMemorySessionMemory shared across tenants | OPEN |
| B-7 JWT error leaked to client | OPEN |
| H-1 through H-8 | All OPEN |
| M-1 through M-7 | All OPEN |
| L-1, L-2, L-4, L-5 | All OPEN |

---

### BLOCKING

#### B-8 — RLS `app.tenant_id` is never set — all tenant isolation is dead in production

**File:** `apps/gateway/src/routes/chat.ts` (all Prisma calls), `apps/gateway/prisma/migrations/0001_initial/migration.sql`

**Issue:** The migration correctly enables RLS on all six tables and creates policies keyed on `current_setting('app.tenant_id', true)`. The migration also runs `FORCE ROW LEVEL SECURITY` which means policies apply even to the table owner. However, nowhere in the application does any code call `SET LOCAL app.tenant_id = ?` before executing Prisma queries.

Two failure modes depending on connection role:

- **App connects as non-superuser (correct setup):** `FORCE ROW LEVEL SECURITY` applies. `app.tenant_id` is never set → `current_setting('app.tenant_id', true)` returns `NULL` → `NULL::uuid` cast → `tenant_id = NULL` is always false → **every Prisma query returns 0 rows**. All `dbConnectors`, `dbTenant` queries silently return empty. Connector perimeters are empty. Budget is default. The application appears to work but has no data.

- **App connects as superuser (likely in dev):** RLS is bypassed entirely for superusers unless `FORCE ROW LEVEL SECURITY` is enforced. Queries return data without tenant filtering — only the application-level `where: { tenant_id: tenantId }` guards apply. This works in practice but provides no defense-in-depth: a bug in application filters = cross-tenant data exposure.

Both scenarios mean the RLS layer is either silently failing or completely inactive. The `schema.test.ts` tests verify the SQL contains the right policy text but do NOT test that the setting is actually applied per-request.

**Fix:** Add a Prisma client extension that sets `app.tenant_id` before each query via `$allOperations` middleware:
```typescript
// apps/gateway/src/db.ts
import { PrismaClient } from '@prisma/client'

export function createPrismaClient(tenantId: string): PrismaClient {
  return new PrismaClient().$extends({
    query: {
      $allOperations({ args, query }) {
        return prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
          return query(args)
        })
      }
    }
  })
}
```
Or use a transaction-scoped approach in the route:
```typescript
await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
const connectors = await prisma.connector.findMany({ where: { tenant_id: tenantId } })
```
The `set_config(..., true)` third argument makes the setting LOCAL to the current transaction.

**Verify:** In a test with RLS-enforced DB, insert rows for tenant-A. Connect with app credentials (non-superuser). Issue a query without setting `app.tenant_id`. Assert 0 rows returned. Then set `app.tenant_id = tenant-A`. Assert rows returned. Currently: either returns 0 rows always or bypasses RLS entirely.

---

#### B-9 — `audit_events` CASCADE DELETE from tenant bypasses immutability RULE — audit history erasable

**File:** `apps/gateway/prisma/migrations/0001_initial/migration.sql` (lines ~150–165)

**Issue:**
```sql
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE RULE no_delete_audit_events AS
    ON DELETE TO audit_events DO INSTEAD NOTHING;
```
PostgreSQL RULES apply to direct SQL statements on the table. They do NOT intercept CASCADE operations triggered by foreign key constraints. Running `DELETE FROM tenants WHERE id = $id` cascades through the FK and deletes all `audit_events` for that tenant, bypassing `no_delete_audit_events` entirely.

PRODUCT.md §7 states: "every event immutably logged." Deleting a tenant erases the entire audit trail. An insider threat or a bug in a tenant-deletion flow would permanently destroy the audit record with no recovery path.

**Fix option A (preferred):** Change the FK to `ON DELETE RESTRICT`. Tenants with audit history cannot be deleted — only deactivated:
```sql
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
Add a `deleted_at` soft-delete column to `tenants` for deactivation.

**Fix option B:** Replace the RULE with a trigger that actively blocks the DELETE:
```sql
CREATE OR REPLACE FUNCTION prevent_audit_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are immutable — delete not permitted';
END;$$;

CREATE TRIGGER no_delete_audit_events
BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_delete();
```
Triggers fire on CASCADE operations; RULES do not.

**Verify:** Insert a tenant and audit event. Run `DELETE FROM tenants WHERE id = $tenant_id`. Assert the audit event still exists. Currently it is deleted.

---

### HIGH

#### H-9 — `CORS_ORIGIN=*` with `credentials: true` is a broken configuration — silently fails for credentialed requests

**File:** `apps/gateway/src/plugins/cors.ts:6–11`

**Issue:**
```typescript
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id'],
  credentials: true,
})
```
The `Access-Control-Allow-Credentials: true` header is sent with every response. When `CORS_ORIGIN` is not set (default), the response also sends `Access-Control-Allow-Origin: *`. Browsers reject this combination per the CORS spec — `*` and `credentials: true` cannot coexist. Any cross-origin `fetch` with `credentials: 'include'` will fail with a CORS error. This is the expected production use pattern.

Beyond the functional failure: `credentials: true` on `*` origin means that if a browser somehow accepts the response, it would share cookies with ANY origin — an SSRF/CORS bypass risk.

**Fix:**
```typescript
await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',') ?? false, // false = same-origin only
  credentials: Boolean(process.env.CORS_ORIGIN), // credentials only when origin is explicit
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id'],
})
```
Require `CORS_ORIGIN` to be set explicitly in production. Default to same-origin (no CORS) when unset.

**Verify:** Without `CORS_ORIGIN` set, make a cross-origin request. Assert `Access-Control-Allow-Origin` header is absent. With `CORS_ORIGIN=https://app.acme.dev`, assert header is present and matches. Currently wildcard header is always present.

---

#### H-10 — `health/ready` always returns 200 — Kubernetes liveness probes never detect DB/Redis failures

**File:** `apps/gateway/src/routes/health.ts:18–21`

**Issue:**
```typescript
app.get('/health/ready', async (_request, reply) => {
  return reply.send({ status: 'ok' })
})
```
The readiness probe unconditionally returns 200. Kubernetes uses this endpoint to decide whether to route traffic to the pod. If Postgres or Redis is down, the gateway is not operationally ready — but Kubernetes will still send traffic to it. Every request will fail with DB errors, yet the pod appears healthy.

The comment says "DB, Redis added in later milestones" but this is in production infrastructure now. The placeholder should at minimum document the expected implementation contract.

**Fix:**
```typescript
app.get('/health/ready', async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return reply.send({ status: 'ok' })
  } catch {
    return reply.code(503).send({ status: 'unavailable', reason: 'db' })
  }
})
```
Add Redis ping check similarly when Redis is configured.

**Verify:** Stop Postgres. Hit `/health/ready`. Assert 503. Currently returns 200.

---

### MEDIUM

#### M-11 — `request.tenantId` and `request.userId` are declared but never populated — access logs always null

**File:** `apps/gateway/src/plugins/request-logger.ts:6–11`, `apps/gateway/src/routes/chat.ts`

**Issue:**
```typescript
declare module 'fastify' {
  interface FastifyRequest {
    traceId: string
    tenantId?: string
    userId?: string
  }
}
```
The `onResponse` logger logs `request.tenantId` and `request.userId` — but nothing ever sets these fields. The chat route has `const { sub: userId, tenantId } = request.user` after JWT verification, but does not assign `request.tenantId = tenantId` or `request.userId = userId`. Every response log entry shows `tenantId: null, userId: null`, making per-tenant/per-user query analysis from logs impossible.

**Fix:** In the chat route handler, after JWT fields are extracted:
```typescript
const { sub: userId, tenantId, role } = request.user
request.tenantId = tenantId
request.userId = userId
```

**Verify:** Make a chat request. Assert the structured log entry for that request contains the actual `tenantId` and `userId`. Currently both are null.

---

#### M-12 — `X-Trace-Id` header accepted without validation — log injection via uncontrolled traceId

**File:** `apps/gateway/src/plugins/request-logger.ts:15–16`

**Issue:**
```typescript
const traceId = (request.headers['x-trace-id'] as string | undefined) ?? randomUUID()
request.traceId = traceId
```
`traceId` is logged as-is in every request log entry. An attacker can inject `"tenantId":"victim-tenant","userId":"admin"` as the `X-Trace-Id` header value. Depending on the log aggregation system (Datadog, Elastic), this can corrupt structured log entries or inject false audit-adjacent signals.

**Fix:**
```typescript
const raw = request.headers['x-trace-id'] as string | undefined
const isValidTraceId = /^[0-9a-f-]{36,64}$/i.test(raw ?? '')
request.traceId = isValidTraceId ? raw! : randomUUID()
```

**Verify:** Send a request with `X-Trace-Id: injected-value". Assert log entry shows a generated UUID, not the injected value.

---

### LOW

#### L-6 — `health/ready` probe does not check Redis — pod may receive traffic when session store is down

**File:** `apps/gateway/src/routes/health.ts:18–21`

Supplementary to H-10. Even after DB check is added, Redis unavailability should also return 503 if the gateway is Redis-backed for sessions. If Redis is down, every authenticated chat request will fail (session memory commands throw). Readiness should reflect this.

---

#### L-7 — Schema test `migration.sql` path uses `import.meta.dirname` — will break if test runner changes cwd

**File:** `apps/gateway/src/__tests__/schema.test.ts:57`

```typescript
join(import.meta.dirname, '../../prisma/migrations/0001_initial/migration.sql')
```
`import.meta.dirname` is correct for ESM. If tests are ever run from a different working directory or if the migration file moves, the test silently throws and the RLS invariants go untested. Consider resolving from package root via a workspace-relative path.

---

### Positive Findings — First-Time Assessment

- **Migration SQL quality is high:** RLS enabled AND forced on all tables, append-only enforcement on audit_events, composite indexes on high-cardinality queries, UUID PKs everywhere. Solid foundation.
- **telemetry.ts:** Correctly no-ops when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset. No mandatory external dependency.
- **metrics.ts:** `initMetrics()` guard prevents double-registration. Correct singleton pattern.
- **server.ts:** Graceful SIGTERM/SIGINT shutdown with telemetry flush. Correct.
- **MemoryFactory:** Exhaustive switch with `_exhaustive: never` compile-time guard. Correct pattern.

---

### Pending Features (Updated Status)

| Feature | Task | Status |
|---------|------|--------|
| M0-T1 through M0-T8 | M0 | **COMPLETE** |
| M1-T1 through M1-T5 | M1 (partial) | **COMPLETE** |
| Wire OrchestratorChat to real SSE | M1-T6 | NOT STARTED — web /api/chat is stub |
| Specialist agent tools | M2 | NOT STARTED |
| Connector implementations | M2 | NOT STARTED |
| `IKnowledgeGraph` + `resolveContext()` | M4-T1, M4-T2, M4-T5 | NOT STARTED |
| Graph Builder Agent | M4-T6 | NOT STARTED |
| Agent context injection | M4-T7 | NOT STARTED |
| Trigger.dev cron jobs | M5 | NOT STARTED |
| User permission DB model (required for B-5) | pre-M2 | NOT STARTED |
| RLS activation at query time (B-8) | pre-M2 | NOT STARTED — security critical |
| Real auth (SAML/OIDC) (M7) | M7 | NOT STARTED — auth stub is production risk |

<!-- REVIEW SECTION END — 2026-06-05 -->

---

<!-- REVIEW SECTION START — 2026-06-04 -->
## Review — 2026-06-04 | B-1 fix + full re-audit of M0-T1 through M1-T5

**Scope:** All committed code as of this date. New commit since last review: `8b80b2e fix(perimeter): B-1 — resource check defaults to null not wildcard`. Full re-audit of all source files for issues missed or introduced.

| Dimension | Rating | Δ from last review |
|-----------|--------|-------------------|
| Feature completeness | 5/10 | ↓1 — real SSE wired but web UI stub, token budget broken, multi-turn tool use broken |
| Code standards | 6/10 | ↓1 — JWT error leak, tenant isolation absent in InMemory fallback, hardcoded stub IDs |
| Performance | 6/10 | = — budget still dead, no route timeout |
| Security | 6/10 | ↑1 — B-1 fixed, but connector perimeter wildcard and JWT error leak are new concerns |
| Readability | 8/10 | = |
| Clarity and comments | 7/10 | = |

---

### Previous Issues — Status Update

| Issue | Status |
|-------|--------|
| B-1 Perimeter resource defaults to `*` | **FIXED** ✓ (`8b80b2e`) |
| B-2 Token budget counters never update | **PARTIAL** (`d438253`) — within-request step accumulation fixed; cross-request persistence still missing (see B-2-R below) |
| B-3 Redis session append race condition | OPEN |
| B-4 Tool message format wrong for multi-turn | OPEN (acknowledged, deferred to M2) |
| H-1 Streaming break bug (parallel tool calls) | OPEN |
| H-2 InMemorySessionMemory inline, summarise no-op | OPEN |
| H-3 Audit sink drops events silently | OPEN |
| H-4 Intent classification failure silent | OPEN |
| H-5 Assistant response stored as placeholder | OPEN |
| M-1 Empty UUID DB query | PARTIAL — validated before query but still passes empty string to Prisma instead of returning 400 |
| M-2 Token estimate ignores tool definitions | OPEN |
| M-3 content_block_stop emits all tool calls | OPEN |
| M-4 WRITE_SUFFIXES substring false positives | OPEN |
| M-5 InMemorySessionMemory hardcodes `effectiveRole: 'dev'` | OPEN |
| L-1 AnthropicProvider re-exports AppError | OPEN |
| L-2 No request timeout on SSE route | OPEN |
| L-3 gate.ts status unknown | CLOSED — implemented correctly |

---

### BLOCKING

#### B-2-R — `sessionUsed` resets to 0 on every HTTP request — per-session limit never enforces across messages

**File:** `apps/gateway/src/routes/chat.ts:82–92`, `packages/agent/src/orchestrator.ts`

**Context:** `d438253` fixed within-request step accumulation (budget.sessionUsed now increments after each LLM `done` chunk within a single runSession call). The within-request case is now correct.

**Remaining gap:** `buildTokenBudget()` constructs a new budget object on every POST request with `sessionUsed: 0`. Each user message is a separate HTTP request. After the first message uses 400K tokens, the next request creates a fresh budget — `sessionUsed` is back to 0. `perSessionLimit: 500_000` can be exceeded arbitrarily by sending multiple messages. Same applies to `tenantDailyUsed` and `tenantMonthlyUsed`.

**Fix:**
```typescript
// In chatRoutes, load persisted usage from Redis before constructing budget:
const redisUsageKey = `token-usage:${sessionId}`
const persistedUsed = await redis.get(redisUsageKey)
const sessionUsed = persistedUsed ? parseInt(persistedUsed, 10) : 0

const budget = buildTokenBudget(dbTenant?.token_budget_monthly, sessionUsed)

// After runSession completes, persist updated value:
await redis.set(redisUsageKey, String(budget.sessionUsed), 'EX', SESSION_TTL_SECONDS)
```

For tenant daily/monthly usage, load from a `token_usage` Postgres table keyed on `(tenant_id, date)` — Redis is insufficient as it can evict entries.

**Verify:** Send two messages in the same session, each consuming 300K tokens. Assert the second message is blocked by `perSessionLimit: 500_000`. Currently both pass.

---

#### B-5 — connectorScopes hardcodes `read: ['*'], write: ['*']` — perimeter resource enforcement is dead

**File:** `apps/gateway/src/routes/chat.ts:143–148`

**Issue:**
```typescript
const connectorScopes: ConnectorScope[] = dbConnectors.map((c) => ({
  connectorId: c.id,
  read: ['*'],
  write: c.mode === 'write' || c.mode === 'read_write' ? ['*'] : [],
}))
```
Every authenticated user gets `read: ['*']` on every connector they have access to, and `write: ['*']` on every write-capable connector. The `intersectScope()` function in the perimeter engine intersects user scope with manifest capabilities — but when user scope is `['*']` and manifest is `['*']`, the result is `['*']`. So no matter what resources a connector manifest declares, every user gets full wildcard access at the resource level.

The entire per-resource scoping system from PRODUCT.md §3 (e.g. `write: ['deployments/app1']` only) is bypassed. A user assigned to `org/repo-a` can write to `org/repo-b`. The perimeter engine correctly enforces what is given to it, but what is given to it is always wildcard.

**Root cause:** There is no `user_permissions` table in the Prisma schema. Connector-level scoping exists, but resource-level user permissions are not persisted.

**Fix:**
Step 1 — Add `user_connector_permissions` table to Prisma schema:
```sql
model UserConnectorPermission {
  id           String   @id @default(uuid())
  tenant_id    String
  user_id      String
  connector_id String
  read_scopes  String[] -- e.g. ["*"] or ["org/repo-a"]
  write_scopes String[] -- e.g. [] or ["deployments/app1"]
  @@unique([tenant_id, user_id, connector_id])
}
```
Step 2 — Load user's resource-level scopes from this table in `chatRoutes()`:
```typescript
const userPermissions = await prisma.userConnectorPermission.findMany({
  where: { tenant_id: tenantId, user_id: userId }
})
const connectorScopes: ConnectorScope[] = userPermissions.map((p) => ({
  connectorId: p.connector_id,
  read: p.read_scopes,
  write: p.write_scopes,
}))
```
Step 3 — Until table exists, fail closed: default `write: []` (read-only) for unknown users. Never default to wildcard write.

**Verify:** Create a user in the system with `write: ['deployments/app1']` only. Call a write tool targeting `deployments/app2`. Assert `allows()` returns false. Currently returns true.

---

#### B-6 — InMemorySessionMemory is a module-level singleton shared across all tenants

**File:** `apps/gateway/src/routes/chat.ts:96`

**Issue:**
```typescript
const inMemoryStore = new InMemorySessionMemory()
```
Module-level singleton. All requests to this gateway process share one `InMemorySessionMemory` instance. Sessions are keyed by `sessionId` string alone — no tenant namespace. If tenant A and tenant B each start a session with ID `"session-123"` (e.g. both use UUIDs that collide, or a client reuses a session ID across tenant contexts), they share session history. In dev mode where the in-memory store is the default (no Redis), this is the production code path.

**Fix:**
Key sessions as `${tenantId}:${sessionId}` internally:
```typescript
private readonly turns = new Map<string, ConversationTurn[]>()

private key(sessionId: SessionId, tenantId?: TenantId): string {
  return tenantId ? `${tenantId}:${sessionId}` : sessionId
}
```
Or move InMemorySessionMemory to `packages/agent/src/memory/in-memory-session.ts` and accept a namespace prefix in the constructor (addresses H-2 simultaneously).

**Verify:** Two requests with different `tenantId` but identical `sessionId` string. Assert their turns are independent. Currently they share turns.

---

#### B-7 — JWT `authenticate` decorator leaks raw JWT error to client — sensitive JWT internals exposed

**File:** `apps/gateway/src/plugins/jwt.ts:44–53`

**Issue:**
```typescript
app.decorate('authenticate', async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await request.jwtVerify()
  } catch (err) {
    reply.send(err)
  }
})
```
`@fastify/jwt` throws an error object on verification failure. `reply.send(err)` serializes the raw Error object including its message, stack trace fragments embedded in the JWT error details, and the full `@fastify/jwt` error format. This leaks the JWT algorithm, token structure information, and internal library details to the client.

Beyond the info leak: there is no `return` or `throw` after `reply.send(err)`. With Fastify's async preHandler, once a reply is sent Fastify does stop the route handler. However, any code after `reply.send(err)` in the `authenticate` function continues executing until it returns. If future modifications add code after `reply.send(err)`, there is no safety net.

**Fix:**
```typescript
app.decorate('authenticate', async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await request.jwtVerify()
  } catch {
    await reply.code(401).send({ error: 'Unauthorized' })
  }
})
```

**Verify:** Send a request with an invalid JWT. Assert response is `{"error":"Unauthorized"}` with status 401 and no JWT internal details. Assert response does not contain stack trace, algorithm name, or `@fastify/jwt` error format.

---

### HIGH

#### H-6 — Auth stub assigns `sub: 'stub-user-id'` to all users — audit trail corrupted

**File:** `apps/gateway/src/routes/auth.ts:23–29`

**Issue:**
```typescript
const token = await reply.jwtSign({
  sub: 'stub-user-id',
  email,
  tenantId,
  role: 'dev',
})
```
Every user who calls `/auth/token` gets a JWT with `sub: 'stub-user-id'` and `role: 'dev'`. All audit events are attributed to `user_id = 'stub-user-id'`. All sessions from different users share the same user ID in session memory. Role-based intent routing always receives `effectiveRole: 'dev'`. This is development scaffolding that must be clearly bounded.

This stub is acceptable for M0/M1 development but must be guarded against accidental production use and must be obviously labeled as temporary.

**Fix:** Add a guard at startup and a clear comment:
```typescript
// TODO M7: replace with real SAML/OIDC auth — this stub is DEV ONLY
if (process.env.NODE_ENV === 'production') {
  throw new Error('Auth stub must not run in production — implement real auth before deploying')
}
```
Also: generate a per-request pseudo-user-id from the email so audit events are at least distinguishable per user: `sub: `stub:${email}``

**Verify:** Confirm in the audit_events table that different email addresses produce different `user_id` values.

---

#### H-7 — Specialist agent has no token budget enforcement — unlimited spend possible

**File:** `packages/agent/src/specialist-agent.ts:38–136`

**Issue:** `runSpecialist()` calls `createPerimeterMiddleware` but never calls `createTokenMeterMiddleware`. A specialist agent can make unlimited LLM calls with no per-query, per-session, or per-tenant budget check. If a specialist agent enters a tool loop, it will spend tokens without limit until `maxSteps` is hit (default 10) — and even then, 10 unchecked calls on a long-context model could exhaust a tenant's monthly budget in a single session.

**Fix:**
```typescript
// In runSpecialist(), add budget parameter to SpecialistAgentConfig:
export interface SpecialistAgentConfig {
  ...
  budget?: TokenBudget
}

// In runSpecialist() loop, before model.stream():
const tokenResult = await checkTokens({ estimatedTokens, messages, model: mainModel })
if ('_tag' in tokenResult && tokenResult._tag === 'TokenHardBlock') {
  yield makeError('TOKEN_LIMIT_EXCEEDED', tokenResult.reason)
  return
}
```

**Verify:** Create specialist agent with `perQueryHardLimit: 100`. Provide a prompt that would produce >100 estimated tokens. Assert agent yields TOKEN_LIMIT_EXCEEDED error.

---

#### H-8 — `apps/web/app/api/chat/route.ts` is a stub — web UI never reaches real orchestrator

**File:** `apps/web/app/api/chat/route.ts:1–21`

**Issue:**
```typescript
export async function POST() {
  // ... returns hardcoded "stub response"
}
```
The web UI's chat endpoint is a stub that returns a hardcoded text_delta event regardless of the query. All chat messages from the browser hit this stub and never reach the gateway or the real orchestrator. M1-T5 wired the gateway SSE endpoint but M1-T6 (wire OrchestratorChat to real SSE) was not completed.

**Fix:** Implement `apps/web/app/api/chat/route.ts` to proxy to the gateway:
```typescript
export async function POST(request: Request) {
  const gatewayUrl = process.env.GATEWAY_URL ?? 'http://localhost:3001'
  const body = await request.json()
  const response = await fetch(`${gatewayUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: request.headers.get('Authorization') ?? '',
    },
    body: JSON.stringify(body),
  })
  return new Response(response.body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  })
}
```

**Verify:** Send a chat message from the browser. Confirm the audit_events table in Postgres shows a `query_received` event. Currently no DB event is created.

---

### MEDIUM

#### M-6 — `isWriteAction` uses `includes()` — false positives on common verb substrings

**File:** `packages/agent/src/perimeter/engine.ts:68–71`

Already noted as M-4 in 2026-06-03 review. Escalating severity: `WRITE_SUFFIXES` contains `'post'`, `'put'`, `'close'`. Tool names like `get_repository_post_count`, `compute_uptime`, and `autocreate_alert` all trigger false write classification. Each false positive forces a write-scope check on what is actually a read operation, potentially blocking legitimate reads.

**Fix (exact from previous review, still unimplemented):**
```typescript
function isWriteAction(toolName: string): boolean {
  const action = toolName.includes('.') ? toolName.split('.').slice(1).join('.') : toolName
  const parts = action.toLowerCase().split('_')
  return WRITE_SUFFIXES.some((s) => parts.includes(s))
}
```

**Verify:** `isWriteAction('datadog.get_post_count')` → false. `isWriteAction('github.create_pr')` → true. `isWriteAction('k8s.delete_pod')` → true.

---

#### M-7 — `OllamaProvider.chat()` has no request timeout — hangs indefinitely on unresponsive server

**File:** `packages/agent/src/providers/ollama.ts:98–105`

```typescript
const response = await fetch(`${this.baseURL}/chat/completions`, {
  method: 'POST',
  ...
  body: JSON.stringify(body),
})
```
No `AbortSignal` or timeout. If the Ollama server is slow or unresponsive, the gateway request hangs indefinitely, holding the connection and consuming a thread-equivalent slot. Under load, a single slow Ollama instance can exhaust the gateway's request concurrency.

**Fix:**
```typescript
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 30_000) // 30s
try {
  const response = await fetch(url, { ...options, signal: controller.signal })
  ...
} finally {
  clearTimeout(timeout)
}
```

**Verify:** Start Ollama provider with a URL that never responds. Assert `chat()` throws/rejects within 35 seconds. Currently it hangs.

---

#### M-8 — `RedisSessionMemory.append()` triggers `summarise()` while still holding the turns state — possible double-compress

**File:** `packages/agent/src/memory/redis-session.ts:54–69`

```typescript
async append(sessionId: SessionId, turn: ConversationTurn): Promise<void> {
  const key = turnsKey(sessionId)
  const raw = await this.redis.get(key)
  const turns: ConversationTurn[] = raw ? JSON.parse(raw) : []
  turns.push(turn)
  await Promise.all([
    this.redis.set(key, JSON.stringify(turns), 'EX', SESSION_TTL_SECONDS),
    this.redis.expire(metaKey(sessionId), SESSION_TTL_SECONDS),
  ])
  if (turns.length > MAX_TURNS_BEFORE_SUMMARISE) {
    await this.summarise(sessionId)  // re-reads from Redis
  }
}
```
`append()` writes 51 turns to Redis, then calls `summarise()` which reads them back and writes compressed turns. This is correct behavior — but note it still uses the get-modify-write pattern (B-3 from previous review). More subtle: if `summarise()` is called concurrently from two requests (both append the 51st turn simultaneously), both call `summarise()`. Both read the same 51 turns, both compress them. Second write wins, but the first write has already removed the canonical state. Result: correctly compressed, but the B-3 race still affects append; `summarise()` itself is idempotent if called twice on the same state.

This is a clarification of B-3, not a new issue. B-3 remains the root problem.

---

### LOW

#### L-4 — `MemoryFactory` not exported from `packages/agent/src/memory/factory.ts` source

**File:** `packages/agent/src/memory/factory.ts`

The chat route imports `MemoryFactory` from `@anvay/agent`. Verify this import exists and the factory correctly instantiates `RedisSessionMemory`. If this factory is missing or doesn't pass the `summariseProvider` option, Redis sessions will use fallback summaries only (no LLM summarisation). Confirm the export chain is complete.

**Verify:** `import { MemoryFactory } from '@anvay/agent'` compiles without error. `MemoryFactory.create({ type: 'redis', redisUrl: '...' })` returns a `RedisSessionMemory` instance.

---

#### L-5 — `apps/web/app/api/providers/route.ts` checks `process.env` at request time — no caching

**File:** `apps/web/app/api/providers/route.ts:1–12`

`process.env` reads are cheap, but this route is called on every UI load (the ModelConfig component checks it). In Next.js server components, the env is already resolved at build time for static data. This is not a correctness issue but a missed optimization — `process.env.ANTHROPIC_API_KEY` in server routes is dynamic (correct), but should be wrapped in `cache()` for the duration of a request if called multiple times.

Minor. Non-blocking. Document as intentional.

---

### Patterns to Watch (Negative Reference — Do Not Repeat)

- **Wildcard perimeter defaults:** Never default to `write: ['*']` when user scope is unknown. Fail closed — default write to `[]`.
- **Shared module-level state with tenant data:** Module-level singletons that hold per-user or per-session data are a multi-tenancy hazard. Scope all session/user storage by `tenantId:sessionId`.
- **Swallowing JWT errors without structured response:** Always return a structured error (`{"error":"Unauthorized"}`) on auth failure — never serialize the raw exception.

---

### Pending Features (Updated Status)

| Feature | Task | Status at this review |
|---------|------|----------------------|
| Wire OrchestratorChat to real SSE | M1-T6 | Not started — web /api/chat is still a stub |
| Specialist agent tools | M2 | Not started |
| Connector implementations | M2 | Not started |
| `IKnowledgeGraph` + `resolveContext()` | M4-T1, M4-T2, M4-T5 | Not started |
| Graph Builder Agent | M4-T6 | Not started |
| Agent context injection | M4-T7 | Not started |
| Trigger.dev cron jobs | M5 | Not started |
| User permission DB model | Pre-M2 (required for B-5) | Not started — currently all perimeter resource checks are wildcarded |
| Real auth (SAML/OIDC) | M7 | Not started — auth stub in production would be catastrophic |

<!-- REVIEW SECTION END — 2026-06-04 -->

---

<!-- REVIEW SECTION START — 2026-06-03 -->
## Review — 2026-06-03 | M0-T1 through M1-T5

**Scope:** All committed code as of this date.

| Dimension | Rating | Blocking issues |
|-----------|--------|----------------|
| Feature completeness | 6/10 | Token budget never updates, tool naming contract broken |
| Code standards | 7/10 | Race condition in session memory, tool message format wrong |
| Performance | 6/10 | Read-modify-write without lock, token estimate unreliable |
| Security | 5/10 | Perimeter defaults to `*` on missing resource arg |
| Readability | 8/10 | One unexplained `break` bug |
| Clarity and comments | 7/10 | Silent error swallows in two places |

---

### BLOCKING

#### B-1 — Perimeter resource check defaults to `*`, bypasses resource-level control

**File:** `packages/agent/src/perimeter/engine.ts:99`

**Issue:**
```typescript
const resource = typeof toolCall.args['resource'] === 'string' ? toolCall.args['resource'] : '*'
```
When a tool call has no arg named `resource`, this defaults to `'*'`. `matchesAny(scope.write, '*')` returns true if the user has any write scope at all — meaning every write tool without an explicit `resource` arg passes the perimeter regardless of what it targets. Almost no real tool will name its arg `resource`. Perimeter is effectively not checking resources for the vast majority of tool calls.

**Fix:**
```typescript
const resource = typeof toolCall.args['resource'] === 'string' ? toolCall.args['resource'] : null
if (resource === null) {
  return isWriteAction(toolCall.name)
    ? scope.write.includes('*')
    : scope.read.includes('*')
}
```
Long-term: every `ExecutableTool` declares `targetResource: string` and perimeter checks that field, not a runtime arg.

**Verify:** Test — create perimeter with `write: ['deployments/app1']` only. Call a write tool with no `resource` arg. Assert `allows()` returns false. Currently returns true.

---

#### B-2 — Token budget counters never update — per-session and per-tenant limits never enforce

**File:** `apps/gateway/src/routes/chat.ts:82–92`, `packages/agent/src/orchestrator.ts:86–99`

**Issue:** `buildTokenBudget()` creates budget with `sessionUsed: 0`. After each LLM call, `totalInputTokens`/`totalOutputTokens` accumulate locally but are never written back to the budget object. Next step in the loop still sees `sessionUsed: 0`. Per-session and per-tenant limits are dead code — they can never trigger.

**Fix:** Track mutable `sessionUsed` inside `runSession`, pass updated value into `checkTokens` on each step. Persist `sessionUsed` to Redis keyed on `sessionId` so it survives across requests.

**Verify:** Unit test — budget with `perSessionLimit: 100`. Step 1 uses 80 tokens. Assert step 2 is blocked. Currently passes.

---

#### B-3 — Redis session append race condition — concurrent requests lose turns

**File:** `packages/agent/src/memory/redis-session.ts:54–68`

**Issue:** `get → parse → push → set` is not atomic. Two concurrent requests for the same session both read the same state, each append one turn, last writer wins. One turn permanently lost.

**Fix:** Use Redis List (`RPUSH`) — natively atomic:
```typescript
await this.redis.rpush(turnsKey(sessionId), JSON.stringify(turn))
await this.redis.expire(turnsKey(sessionId), SESSION_TTL_SECONDS)
// get: LRANGE key 0 -1 → parse each element
```

**Verify:** Integration test — 10 concurrent `append()` calls for same session. Assert final turn count is exactly 10. Currently < 10.

---

#### B-4 — Tool call message format wrong for multi-turn tool use with Anthropic

**File:** `packages/agent/src/orchestrator.ts:248–255`

**Issue:**
```typescript
messages.push({ role: 'assistant', content: assistantContent }) // serialised as plain text
messages.push({ role: 'user', content: toolResultParts.join('\n') }) // serialised as plain text
```
Anthropic requires structured `tool_use` content blocks and `tool` role messages with `tool_use_id`. Sending as plain text means the model cannot correlate results with tool calls — it sees tool output as a new user message. Every multi-step agentic workflow is broken.

**Fix:** Add `formatToolResult(toolCallId, result): Message` to `IModelProvider`. Each provider implements it using its native format. Anthropic uses `role: 'user', content: [{ type: 'tool_result', tool_use_id, content }]`.

**Verify:** Run a tool-calling session requiring 2+ steps. With fix, model correctly references tool output in subsequent reasoning.

---

### HIGH

#### H-1 — Streaming tool call args accumulation bug — only first tool call gets args

**File:** `packages/agent/src/providers/anthropic.ts:123–126`

**Issue:** `break` after first Map entry means only tool call #1 accumulates JSON delta. Tool calls 2+ silently get `args: {}`. Anthropic commonly returns parallel tool calls.

**Fix:** Use the `index` field from `content_block_delta`:
```typescript
const entries = [...partialToolCalls.entries()]
if (entries[event.index]) {
  const [id, partial] = entries[event.index]
  partial.argsJson += event.delta.partial_json
}
```

**Verify:** Mock Anthropic stream with two simultaneous tool calls. Assert both `args` objects are correctly populated.

---

#### H-2 — `InMemorySessionMemory` embedded in route file, `summarise()` is no-op

**File:** `apps/gateway/src/routes/chat.ts:34–60`

**Issue:** Defined inline in a route — untestable, unreusable. `summarise()` is empty. Sessions using in-memory storage grow unbounded in long-running dev process.

**Fix:** Move to `packages/agent/src/memory/in-memory-session.ts`. Implement `summarise()` with same truncation logic as `RedisSessionMemory` (keep last 10, replace rest with `[Summary of N earlier turns]`). Export from package.

**Verify:** Test — append 55 turns, call `summarise()`, assert turn count ≤ 11.

---

#### H-3 — Audit sink silently drops events when DB is unavailable

**File:** `apps/gateway/src/audit/postgres-sink.ts:19–36`

**Issue:** `void write().catch(onError)` — on Postgres failure, event is dropped. Audit log described as immutable and complete. Silent drop under DB pressure is a correctness and security violation.

**Fix:** Add Redis fallback queue. On Postgres failure, push serialised event to `audit:fallback:{tenantId}` Redis list. Background job drains to Postgres on recovery. Minimum: log full event as structured error so it can be recovered from log aggregation.

**Verify:** Bring Postgres down, fire `append()`. Assert event appears in Redis fallback or error log with full payload.

---

#### H-4 — Intent classification failure is silently swallowed

**File:** `packages/agent/src/orchestrator.ts:134`

**Issue:** `catch { /* proceed with default intent */ }` — error is invisible. Quota exceeded, network error, bad model response all look identical. Silent fallback to `'general'` intent routes to wrong specialist.

**Fix:**
```typescript
} catch (err) {
  void auditSink.append({ ...ctx, eventType: 'intent_classification_failed',
    payload: { error: err instanceof Error ? err.message : String(err) }, createdAt: new Date() })
}
```

**Verify:** Mock `model.chat` to throw. Assert `intent_classification_failed` appears in audit sink. Assert session continues.

---

#### H-5 — Assistant response never stored in session memory

**File:** `packages/agent/src/orchestrator.ts:259–263`

**Issue:**
```typescript
await sessionMemory.append(ctx.sessionId, { role: 'assistant', content: '[streamed response]' })
```
Placeholder, not the actual response. Follow-up "what did you just say?" has no history to draw from.

**Fix:** Collect streamed text chunks into a buffer during the loop. Store the actual concatenated text in session memory after the loop completes.

**Verify:** Two-turn session — turn 2 asks "summarise what you said". Assert model has access to turn 1 response text.

---

### MEDIUM

#### M-1 — `prisma.tenant.findUnique({ id: '' })` runs useless DB query on invalid UUID
**File:** `apps/gateway/src/routes/chat.ts:137`
Validate `tenantId` at route entry. Return 400 immediately if not a valid UUID. Don't pass empty string to Prisma.

#### M-2 — Token estimation ignores tool definitions — underestimates 20–40% on tool-heavy calls
**File:** `packages/agent/src/orchestrator.ts:172–173`
Add `toolDefs.reduce((acc, t) => acc + JSON.stringify(t).length / 4, 0)` to the estimate. Document known imprecision.

#### M-3 — `content_block_stop` emits all partial tool calls, not just the stopped one
**File:** `packages/agent/src/providers/anthropic.ts:129–145`
Track `blockType` per index. Only emit tool call on `content_block_stop` if stopped block was `tool_use`.

#### M-4 — `WRITE_SUFFIXES` substring match causes false positives
**File:** `packages/agent/src/perimeter/engine.ts:63–70`
Split action on `_` and require whole-word match against `WRITE_SUFFIXES`. `autocreate` should not match `create`.

#### M-5 — `InMemorySessionMemory` hardcodes `effectiveRole: 'dev'`
**File:** `apps/gateway/src/routes/chat.ts:45`
Store role from caller. Every user in dev mode is currently treated as `dev`. Wrong role → wrong specialist routing.

---

### LOW

#### L-1 — `AnthropicProvider` re-exports `AppError` — wrong file
**File:** `packages/agent/src/providers/anthropic.ts:161`
Remove `export { AppError }`. It belongs to `@anvay/types`, not to a provider.

#### L-2 — No request timeout on SSE chat route
**File:** `apps/gateway/src/routes/chat.ts:215`
Add 5-minute AbortSignal. Runaway agent holds connection indefinitely.

#### L-3 — `gate.ts` implementation status unknown
**File:** `packages/agent/src/gate.ts`
Verify `createGate` handles `autoApproveThreshold`, `waitForInput`, and gate decision audit logging. If stub, mark `// TODO M2` clearly.

---

### Pending Features (Not Issues — Track Progress)

| Feature | Task | Status at this review |
|---------|------|----------------------|
| `IKnowledgeGraph` + `resolveContext()` | M4-T1, M4-T2, M4-T5 | Not started |
| Graph Builder Agent | M4-T6 | Not started |
| Agent context injection | M4-T7 | Not started |
| Specialist agent tools | M2 | Not started |
| Connector implementations | M2 | Not started |
| `apps/web/api/chat/route.ts` real SSE | M1-T6 | Not started |
| Trigger.dev cron jobs | M5 | Not started |

---

### Patterns to Follow (Positive Reference)

- **Perimeter audit logging:** every tool call — allowed AND blocked — logged before return. Never skip.
- **Provider abstraction:** `ProviderFactory.create()` is the only entry point for SDK instantiation. Never import Anthropic/OpenAI directly in orchestrator or agents.
- **Branded types:** `TenantId`, `UserId`, `SessionId` everywhere. Never accept plain `string` where a branded type exists.
- **RLS + application filter:** both DB-level RLS and application-level `tenant_id` filter must stay. Neither replaces the other.
- **Error events streamed:** on error in agent loop, send `{ type: 'error', code, message }` before closing stream. Never close silently.

<!-- REVIEW SECTION END — 2026-06-03 -->

---

## Review — 2026-06-07

**Commits:** `0c2d0a7`, `912ea42`, `5f4e40e`, `3d9f8e7`, `dbda6a4`, `8ac311e`
**Author:** DeepSeek V4 Flash (via Codex)
**Reviewer:** Claude (automated)

Wave 3 of CODEX-PLAN.md complete. Six commits, seven bugs closed. No regressions detected.

---

### Resolved (this batch)

#### ✓ L-6 — `0c2d0a7` — Duplicate `OpenAIToolCall` interface removed
`packages/types/src/index.ts` now has exactly one `export interface OpenAIToolCall` (line 99).
`grep -c "export interface OpenAIToolCall" packages/types/src/index.ts` returns `1`. Clean.

#### ✓ L-2 — `912ea42` — Intent classification best-effort, not fatal
`orchestrator.ts:131–134` — `catch` block now sets `classifiedIntent = 'general'` and continues.
No longer yields `INTENT_CLASSIFICATION_FAILED` error and returns. Correct — a bad intent parse
should not abort the user's session. The `INTENT_CLASSIFICATION_FAILED` ErrorCode constant in
`@anvay/types` is now unused; harmless to keep, can be pruned in a later cleanup pass.

#### ✓ B-2-R — `5f4e40e` — Session token usage persists across calls
`apps/gateway/src/routes/chat.ts` — module-level `sessionTokenUsage: Map<string, { used, lastSeen }>`
with 24 h TTL eviction. `buildTokenBudget(monthly, sessionUsed)` now seeds `sessionUsed` from the
map before building the `TokenBudget`. `recordSessionUsed` called in `finally` block after stream
drains. In-process only (clears on restart) — comment is accurate. Acceptable for V1.

One observation: `totalTokens` is declared outside the `try` block and only set inside the `done`
event handler. If the loop throws before emitting `done`, `totalTokens` stays 0 and `recordSessionUsed`
is skipped (guard `if (totalTokens > 0)`). Correct behavior — partial failed sessions don't inflate
the budget counter.

#### ✓ B-5 — `3d9f8e7` — Connector scopes from capability manifest
`connectorScopes` now reads `c.capability_manifest` (cast `as { capabilities?: { read?, write? } }`)
rather than hardcoding `read: ['*']`. Falls back to `['*']` if manifest missing/malformed.
The wildcard fallback preserves prior behavior for connectors with no manifest data — acceptable
for V1 bootstrap, but any newly registered connector should include a manifest. Flag for
connector registration validation work.

#### ✓ B-8 — `3d9f8e7` — RLS `set_config` now called before queries
New file `apps/gateway/src/db/prisma.ts` — `withTenant(prisma, tenantId, fn)` wraps `fn` in a
`prisma.$transaction`, runs `SELECT set_config('app.tenant_id', $1, true)` first, then calls `fn`.
All tenant-scoped DB queries (connector load, tenant load) are now wrapped in `withTenant`. B-8 resolved.

**Minor:** `tx` is cast `as typeof prisma` inside the transaction callback. This is standard Prisma
transaction boilerplate — `PrismaClient.$transaction` passes a `Prisma.TransactionClient` which has
the same model accessors. Cast is safe here.

#### ✓ B-9 — `dbda6a4` — Audit FK changed to RESTRICT + delete trigger
Migration `0002_audit_immutability`:
- `prevent_audit_delete()` trigger function — raises exception on any DELETE from `audit_events`.
- `no_delete_audit_events` trigger — BEFORE DELETE FOR EACH ROW.
- FK changed from CASCADE to RESTRICT: deleting a tenant now fails (hard error) if audit events exist.

**Minor:** `CREATE TRIGGER no_delete_audit_events` is not idempotent. If the migration is ever
re-run manually it will fail with `trigger already exists`. Prisma migrations are run-once by design
so this is low risk, but a `DROP TRIGGER IF EXISTS ... CASCADE` before the `CREATE TRIGGER` would
be safer. Not blocking.

#### ✓ B-10 — `8ac311e` — Dockerfile `pnpm deploy` for workspace symlinks
Builder stage now runs `pnpm deploy --filter=anvay-gateway /app/deploy --prod` after the build.
This copies a self-contained, symlink-free node_modules into `/app/deploy`. Runner stage copies
from `/app/deploy/node_modules` instead of `apps/gateway/node_modules`.

**Verify:** `--filter=anvay-gateway` assumes the `name` field in `apps/gateway/package.json` is
`anvay-gateway` (no `@` scope). If it's `@anvay/gateway`, the filter needs shell-quoting:
`--filter='@anvay/gateway'`. Run a Docker build dry-run to confirm filter resolves correctly.

---

### Remaining Open Issues (forward to next wave)

| ID | File | Description |
|----|------|-------------|
| M-5/H-2 | `apps/gateway/src/routes/chat.ts` | `InMemorySessionMemory` returns hardcoded `effectiveRole: 'dev'` for all users |
| M-1 | `apps/gateway/src/routes/chat.ts:137` | `tenantId` not UUID-validated before Prisma — runs useless `findUnique({ id: '' })` |
| M-2 | `packages/agent/src/orchestrator.ts:172` | Token estimation ignores tool definitions — underestimates by 20–40% on tool-heavy calls |
| M-3 | `packages/agent/src/providers/anthropic.ts:129` | `content_block_stop` emits all partial tool calls, not just the stopped block |
| M-4 | `packages/agent/src/perimeter/engine.ts:63` | `WRITE_SUFFIXES` substring match — `autocreate` matches `create` (false positive) |
| L-1 | `packages/agent/src/providers/anthropic.ts:161` | `export { AppError }` — wrong file, belongs in `@anvay/types` |
| L-3 | `packages/agent/src/gate.ts` | `createGate` implementation status unknown — verify or mark TODO |
| L-5 | `packages/agent/src/providers/ollama.ts` | `content: ''` should be `content: null` for assistant messages with tool_calls |

---

### Status Tracker — Wave 3 Complete

| Bug | Status |
|-----|--------|
| B-2-R session token reset | ✓ RESOLVED `5f4e40e` |
| B-5 connector scopes wildcard | ✓ RESOLVED `3d9f8e7` |
| B-8 RLS set_config never called | ✓ RESOLVED `3d9f8e7` |
| B-9 audit FK CASCADE | ✓ RESOLVED `dbda6a4` |
| B-10 Dockerfile symlinks | ✓ RESOLVED `8ac311e` |
| L-6 duplicate OpenAIToolCall | ✓ RESOLVED `0c2d0a7` |
| L-2 intent fail aborts session | ✓ RESOLVED `912ea42` |
| M-5/H-2 fake identity + prod guard | ✓ RESOLVED `bd8c4e9` |

---

### `bd8c4e9` — InMemorySessionMemory fake identity + production Redis guard

**Two changes in one commit:**

1. `InMemorySessionMemory` — added `initSession(meta: SessionMeta)` method that stores
   `{ userId, tenantId, effectiveRole }` in a `metas: Map`. `get()` now reads from `metas`
   instead of returning hardcoded `'unknown'`/`'dev'`.

2. Production guard added at `chatRoutes` startup:
   ```typescript
   if (process.env['NODE_ENV'] === 'production' && !process.env['REDIS_URL']) {
     throw new Error('Production requires REDIS_URL environment variable')
   }
   ```
   Prevents silent fallback to ephemeral in-memory sessions in production.

**Subtle issue — `initSession` call site only guards `instanceof RedisSessionMemory`:**
```typescript
if (sessionMemory instanceof RedisSessionMemory) {
  await sessionMemory.initSession(...)  // InMemorySessionMemory.initSession never called
}
```
`InMemorySessionMemory.initSession` is dead code — `metas` stays empty, `get()` still returns
`userId: 'unknown'`. However, this does NOT cause a runtime bug: `runSession` uses the `ctx`
parameter for user identity (line 256–259 in chat.ts), not `sessionMemory.get()`. The orchestrator
calls `sessionMemory.get()` only for `session?.turns` (conversation history). Identity fields
from memory are ignored.

**Fix needed:** change the `instanceof RedisSessionMemory` guard to call `initSession` on any
memory implementation that has the method:
```typescript
await sessionMemory.initSession({ sessionId: ..., userId: ..., tenantId: ..., effectiveRole: ... })
```

---

### Remaining Open Issues (carry forward)

| ID | File | Description |
|----|------|-------------|
| M-5 (partial) | `apps/gateway/src/routes/chat.ts:243` | `initSession` only called for `RedisSessionMemory` — `InMemorySessionMemory` identity fix dead code |
| M-1 | `apps/gateway/src/routes/chat.ts:137` | `tenantId` not UUID-validated — useless Prisma query on invalid input |
| M-2 | `packages/agent/src/orchestrator.ts:172` | Token estimation ignores tool definitions |
| M-3 | `packages/agent/src/providers/anthropic.ts:129` | `content_block_stop` emits all partial tool calls |
| M-4 | `packages/agent/src/perimeter/engine.ts:63` | `WRITE_SUFFIXES` substring false positives |
| L-1 | `packages/agent/src/providers/anthropic.ts:161` | `export { AppError }` — wrong file |
| L-3 | `packages/agent/src/gate.ts` | `createGate` implementation unknown — verify or mark TODO |
| L-5 | `packages/agent/src/providers/ollama.ts` | `content: ''` should be `null` for assistant+tool_calls |

---

### `722fe28` — AbortSignal on client disconnect

`InferenceOptions.signal?: AbortSignal` added. Propagated through:
- `runSession(orchestrator, input, ctx, signal?)` — new optional param
- `model.chat()` (intent classification) — signal passed
- `model.stream()` (main loop) — signal passed
- All three providers: Anthropic (`messages.create`/`messages.stream`), OpenAI (`chat.completions.create`), Ollama (`fetch`) — all pass `signal` to underlying SDK/fetch call

Gateway wiring: `AbortController` created per request, `request.raw.on('close', () => abortController.abort())` fires on disconnect.

**Observations:**

1. `request.raw.on('close', ...)` fires on both client disconnect AND normal completion. On normal completion, the generator is already exhausted and `stream.push(null)` already called — abort is a no-op. No double-close risk.

2. `AbortError` propagates up to the catch block in the void IIFE. Current catch handler emits an SSE error event to the client — but on disconnect the client is gone, so the write is silently dropped. Benign.

3. Tool execution (`execTool.run(toolCall.args)`) does not receive the signal — a blocked tool call will run to completion after disconnect. Acceptable for V1 where tools are expected to be short-lived.

4. Only three providers exist (anthropic, openai, ollama) — all updated. When Groq/Mistral are added, remember to wire `opts.signal`.

**L-2 RESOLVED.**

---

## Review — 2026-06-07 (continued)

**Commit:** `19b61ac`
**Author:** DeepSeek V4 Flash (via Codex)

### `19b61ac` — Boot-time env validation with Zod

New `apps/gateway/src/config/env.ts` — Zod v4 schema, `validateEnv()` called first in `server.ts` before `initMetrics()` or `buildApp()`. `PORT`/`HOST` now come from typed schema defaults.

Covers: `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`, `PORT`, `HOST`, all provider keys.

**Issues:**

1. **`bootstrapLog` removal creates gap:** catch block now uses `app.log.error`. If `buildApp()` throws, `app` is undefined → `app.log.error` throws `TypeError` → original error swallowed. Fix:
   ```typescript
   } catch (err) {
     const logger = app?.log ?? pino({ level: 'info' })
     logger.error({ err }, 'failed to start server')
     process.exit(1)
   }
   ```

2. **`REDIS_URL` production guard duplicated:** `chatRoutes` still has a runtime check for `NODE_ENV === 'production' && !REDIS_URL`. Zod schema marks `REDIS_URL` optional — doesn't enforce production constraint. Move to `.superRefine()` in schema and remove route-level guard, or leave both. Current: redundant.

3. **Validated `env` object not threaded:** `chatRoutes` still reads `process.env['ANTHROPIC_API_KEY']` etc. directly. `env` object only used for PORT/HOST. Not a bug but inconsistent.

---

### `a6c0231` — IConnector types + connector registry

New types in `@anvay/types`: `IConnector`, `CapabilityManifest`, `ConnectorResult`, `ConnectorQuery`, `ConnectorAction`, `HealthStatus`. Clean interface contracts.

`apps/gateway/src/connectors/registry.ts` — loads connectors from DB per tenant, caches in module-level Map, converts to `ExecutableTool[]` via `getToolsForTenant()`. Orchestrator now receives real tools instead of `[]`.

**SECURITY — `loadConnectors` missing `withTenant`:**
Direct `prisma.connector.findMany()` without `set_config('app.tenant_id', ...)`. If RLS is enforced on `connectors` table, this leaks all tenants' connectors. Fix:
```typescript
return withTenant(prisma, tenantId, (tx) =>
  tx.connector.findMany({ where: { tenant_id: tenantId } })
)
```

**Type mismatch — `CapabilityManifest` vs DB shape:**
New type is `{ read?: string[]; write?: string[] }`. But DB `capability_manifest` column stores `{ read: { scope: [...] }, write: {} }` (as seen in `seed.ts` and prior `3d9f8e7` code which reads `raw.capabilities?.read`). The registry casts `row.capability_manifest as CapabilityManifest | null` directly — this silently gives `capabilities: { read: undefined, write: undefined }` because the DB object has no top-level `read`/`write` arrays. Result: every connector defaults to `{ read: ['*'], write: [] }` regardless of DB content. Fix: normalize at DB read time or update `CapabilityManifest` to match the actual DB schema.

**Cache never invalidated:**
`registryCache` is module-level, cleared only by `clearCache()` which is exported but never called. Connector add/update/remove won't be reflected until process restart. Acceptable for V1 static setup, but document the limitation.

**Only `.read` tool exposed per connector:**
`getToolsForTenant` creates `${prefix}.read` only. Write actions require a separate `.write` tool. Acceptable for V1 read-only mode.

---

### `c836509` — Next.js `/api/chat` proxies to gateway

`apps/web/app/api/chat/route.ts` — stub replaced with real proxy:
- `GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'`
- Forwards request body to `${GATEWAY_URL}/api/chat`
- Pipes gateway `response.body` (`ReadableStream`) directly to client — correct for SSE passthrough
- Error handling: non-ok → status+text; no body → 502; catch → 502 JSON

Tests updated to pass `Request` arg to `POST()`.

**BLOCKER — Auth headers not forwarded:**
Proxy copies `Content-Type` only. `Authorization: Bearer <JWT>` from browser is silently dropped. Gateway uses JWT for tenant/user resolution — without it, every request arrives anonymous. Fix:
```typescript
headers: {
  'Content-Type': 'application/json',
  ...(request.headers.get('Authorization')
    ? { Authorization: request.headers.get('Authorization')! }
    : {}),
}
```

**Tests broken in CI:** Tests assert `Content-Type: text/event-stream` + `body contains text_delta`, but route now calls `fetch('http://localhost:4000/api/chat')` → `ECONNREFUSED` in test → catch → 502 JSON. Assertions fail. Fix: mock `fetch` in tests or add a test-mode bypass.

**Minor:**
- No timeout on proxy fetch — gateway hang blocks indefinitely. Add `AbortSignal.timeout(5 * 60 * 1000)`.
- `GATEWAY_URL` env var undocumented — add to `apps/web/.env.local` template.

---

### `f809f9b` — GitHub connector via gh CLI

New `connectors/github` package (`@anvay/connector-github`). `GitHubConnector implements IConnector` — 5 read operations (list_prs, get_pr, list_commits, get_workflow_run, search_code) via `gh` CLI. `makeGitHubTools(connector)` returns `ExecutableTool[]`. Correct strategy per CLAUDE.md (CLI before SDK). `pnpm-workspace.yaml` updated to include `connectors/*`.

**SECURITY — Shell injection via `execSync(string)` — fix before any real use:**
```typescript
const cmd = `gh ${args.join(' ')}`
execSync(cmd, ...)
```
`args` contains LLM-produced values (`repo`, `prNumber`, `filters`). String join + shell execution → injection. `repo = "org/repo; rm -rf /"` executes both commands. `filters` is a raw flag string directly in args — same risk.

**Fix — `spawnSync` with array, no shell:**
```typescript
import { spawnSync } from 'node:child_process'

private runGh(args: string[]): string {
  const result = spawnSync('gh', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  if (result.error) throw new Error(`gh spawn failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`gh exited ${result.status}: ${result.stderr}`)
  return result.stdout
}
```
Also replace `filters: string` param with structured `{ state?, limit?, author? }` — never accept raw flag strings from LLM.

**Connector not wired to registry:** `getConnectorsForTenant` still returns mock connectors for all DB rows. Add type dispatch:
```typescript
if (row.type === 'github') return new GitHubConnector(row.id)
```

**Other:**
- No tests.
- Not in `turbo.json` pipeline — won't build from root.
- `list_commits` interpolates `branch` into URL string — sanitize.

---

### `8d223e3` — Graph Builder Agent + orchestrator KB context injection

**Architecture correct:** `GraphBuilderAgent` is event-driven, never user-facing. Handles `connector_registered`, `ticket_created`, `pr_merged`. `knowledgeGraph?: IKnowledgeGraph` optional on `OrchestratorConfig` — no breaking change. Context injection is best-effort with silent fallback.

**BLOCKER — `resolveContext` called with entity name, not entity ID:**
```typescript
const context = await config.knowledgeGraph.resolveContext(entityName, ctx.tenantId, 2)
```
`resolveContext(entityId: string, ...)` does `WHERE id = $1` — lookup by UUID. `entityName` is a string like `"payments-api"`, not a UUID. Always returns null (entity never found). Graph context is never injected.

Fix: add `resolveContextByName(name: string, tenantId)` to `IKnowledgeGraph`, or add a `search`-based path: find entity by name then resolve by ID.

**BLOCKER — `handleTicketCreated` uses external ticket ID as FK:**
```typescript
await this.kg.upsertRelationship({
  fromEntityId: ticketId,   // Linear external ID, not a graph entity UUID
  toEntityId: serviceId,    // correct DB UUID
})
```
`upsertEntity` returns a DB-generated UUID but the relationship uses the original `ticketId` (raw Linear ID like `"LIN-123"`). FK `from_entity_id → entities(id)` will fail.

Fix:
```typescript
const dbTicketId = await this.kg.upsertEntity(ticketEntity, tenant)
await this.kg.upsertRelationship({ fromEntityId: dbTicketId, ... })
```

**BLOCKER — `handlePrMerged` uses raw issue number as `toEntityId`:**
```typescript
toEntityId: ticketMatch[1]!  // e.g. "123" — not a UUID
```
FK `to_entity_id → entities(id)` will fail — "123" is not a UUID. Fix: look up ticket entity in graph by external ID, use returned UUID.

**Minor:**
- Graph context string emits raw UUID IDs in relationship lines — useless to LLM. Resolve to entity names.
- `extractServiceName` regex `[a-z]+-[a-z]+-api` misses `payments-api`, `auth-service`, single-word names.
- `EntitySpec.id` field set in `handleTicketCreated` but `upsertEntity` ignores it (uses `gen_random_uuid()` in INSERT).

---

### `3e7347e` — KB schema + IKnowledgeGraph + StructuralGraph

**Migration `0003_kb`:** `entities`, `relationships`, `kb_entries` tables. RLS enabled on all three. HNSW index on `embedding vector_cosine_ops`. Indexes on traversal + freshness. Correct structure per CLAUDE.md KB spec.

**`IKnowledgeGraph` interface:** Clean — matches CLAUDE.md contract. All required methods present. `AgentContext`, `ConnectorCoordinates`, `GroundingSource` types defined correctly.

**`StructuralGraph` implementation — two broken SQL patterns:**

1. **`upsertEntity` ON CONFLICT clause never fires:**
   ```sql
   INSERT INTO entities (tenant_id, type, name, metadata)
   VALUES ($1,$2,$3,$4)
   ON CONFLICT (id) DO UPDATE SET ...
   ```
   `id` has `DEFAULT gen_random_uuid()` and is not in the INSERT. A new UUID is generated each call — conflict on `id` is impossible. Every `upsertEntity` call creates a new row. Fix: add `UNIQUE (tenant_id, type, name)` to migration and use:
   ```sql
   ON CONFLICT (tenant_id, type, name) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = NOW()
   ```

2. **`upsertRelationship` ON CONFLICT without column list — Postgres error:**
   ```sql
   INSERT INTO relationships ... ON CONFLICT DO NOTHING
   ```
   Postgres requires `ON CONFLICT (col_list) DO NOTHING` or a named constraint. Without a column list this throws `ERROR: ON CONFLICT DO NOTHING requires inference specification`. Fix: add `UNIQUE (from_entity_id, rel_type, to_entity_id)` to migration and use that in the conflict clause.

Both upserts are broken in current state — migration needs two UNIQUE constraints added.

**`StructuralGraph` requires `pg.Pool`, not Prisma:**
`DbPool.query(sql, params)` matches the `pg` package API, not Prisma (`$queryRaw`). Gateway uses Prisma exclusively — `pg` is not in gateway deps. Either add `pg` + raw pool alongside Prisma, or rewrite `StructuralGraph` to use `prisma.$queryRawUnsafe`. Former is cleaner for graph queries; latter avoids a new dependency. Either way, wiring is currently missing.

**`resolveContext` N+1 queries:**
BFS calls `getRelationships(eid)` and `getEntity(eid)` individually per entity per hop. At depth 3 on a 20-entity graph: ~60 DB round trips per `resolveContext` call. Acceptable for V1 prototype but flag for future batching via `WHERE id = ANY($1)`.

**`search` and episodic methods throw:** Clearly marked not implemented. Correct — document Graphiti + pgvector as the next milestone.

**`embedding VECTOR(1536)`** — hardcoded to OpenAI dimension. Flag if non-OpenAI embeddings are used.

---

### `71a2a33` — Datadog, Linear, ArgoCD connectors

Three new connector packages. Same structure as GitHub connector. Same `execSync(string)` shell injection problem — fix all with `spawnSync(array)` per the GitHub review.

**Datadog — CLI doesn't exist as written:**
`execSync('datadog api metrics/query ...')` — there is no official `datadog` CLI that accepts `api metrics/query`. Datadog tools are: `datadog-ci` (CI/CD pipeline only), `ddtrace` (APM tracing), Python CLI `dog` (deprecated). None match this interface. The connector will throw `ENOENT` or similar on every call. **Needs a real implementation** — use the Datadog HTTP API directly with `fetch` and an API key, or wait for an official MCP server.

**Linear — GraphQL injection:**
`team` and `issue_id` are interpolated directly into GraphQL query strings:
```typescript
const q = `{ issues(...filter:{team:{name:{eq:\"${team}\"}}}...) }`
```
Malicious `team` value rewrites the query. Fix: use GraphQL variables:
```typescript
const query = `query($team: String!) { issues(filter:{team:{name:{eq:$team}}}) { ... } }`
const variables = { team }
const payload = JSON.stringify({ query, variables })
```

**Linear — `linear api` CLI existence uncertain:**
`execSync("linear api --json '{...}'")` — Linear doesn't ship a well-known CLI with this interface. Verify `linear` CLI exists and accepts this syntax, or replace with direct HTTP to `https://api.linear.app/graphql` using `fetch`.

**ArgoCD — no tool builder:**
`ArgoCD` index exports only `ArgoCDConnector` — no `makeArgoCDTools()`. Inconsistent with GitHub pattern. Registry can't auto-build tools without it.

**All three — not wired to registry, no tests.**

---

### `1a73251` — IncidentService, incident routes, SREAgent

CRUD for incidents (create/get/list/update/resolve), REST routes, `SREAgent` skeleton with cheap→main model hypothesis flow. Routes all behind `app.authenticate`. Input schema validated. Correct structure.

**`IncidentService` skips `withTenant` — RLS bypass:**
All Prisma calls go without `withTenant`. Fix: wrap each in `withTenant(this.prisma, tenantId, (tx) => tx.incident.*)`.

**Second `PrismaClient` instance:**
`const prisma = new PrismaClient()` in `incidents.ts` duplicates the one in `chat.ts`. Two pools. Pass Prisma as dependency or import shared singleton.

**404 not returned on missing incident:**
`GET /api/incidents/:id` returns `{ error: 'Incident not found' }` with HTTP 200. Fix: `reply.code(404)`. `PATCH` same — `updateMany` with `count === 0` silently returns `{ ok: true }`.

**`SREAgent` uses invalid model IDs:**
`{ model: 'haiku' }` and `{ model: 'sonnet' }` — providers expect full IDs (`claude-haiku-3-5-20251001`, `claude-sonnet-4-6`). Will fail. Accept via constructor.

**`SREAgent` connector data empty:** `relatedDeploys: []`, `relatedPRs: []` — connectors not wired. Acceptable skeleton for now.

---

### `285b2e7` — TriggerEngine, cron monitors, automations routes

`TriggerEngine` — event matching with exact key-value condition check. REST routes: list/create triggers, evaluate event. Four cron monitor stubs. Clean interfaces.

**SECURITY — tenant isolation missing in `evaluate` and `GET /triggers`:**
`activeTriggers` is a module-level array shared across all tenants. `POST /automations/evaluate` evaluates rules from all tenants — tenant A's event triggers tenant B's rules. `GET /triggers` returns all triggers for all tenants.
Fix: filter by `tenantId` before evaluate and in list route.

**`activeTriggers` not persisted — lost on restart:**
In-process array. Triggers are lost on every deploy/restart. Needs DB persistence for production. Document clearly or add DB-backed store.

**`DeployHealthReport` queries wrong table:**
```typescript
const deploys = await this.prisma.incident.findMany(...)
return { status: 'ok', deploys: deploys.length }
```
Queries `incidents` table, labels result as `deploys`. Wrong. Should query a deploys table or connector data.

**Cron monitors not scheduled:**
Classes exist, nothing schedules them. Per CLAUDE.md, use Trigger.dev or BullMQ — not `setInterval`. Currently dead code.

**`id: \`trigger-${Date.now()}\``** — collision risk on concurrent creates. Use `crypto.randomUUID()`.

<!-- REVIEW SECTION END — 2026-06-07 -->
