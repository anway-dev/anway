# Anvay — Continuous Code Review

Agent instruction: read this file before starting any task. Fix issues marked `BLOCKING`
before proceeding. `HIGH` must be fixed in the same task that touches the affected file.
`MEDIUM` and `LOW` can be fixed inline as you encounter them. Each section below is a
dated review pass — newest at the top.

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
