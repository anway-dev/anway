# Anvay — Continuous Code Review

Agent instruction: read this file before starting any task. Fix issues marked `BLOCKING`
before proceeding. `HIGH` must be fixed in the same task that touches the affected file.
`MEDIUM` and `LOW` can be fixed inline as you encounter them. Each section below is a
dated review pass — newest at the top.

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
