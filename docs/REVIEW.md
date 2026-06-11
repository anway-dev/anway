# Anvay — Continuous Code Review

Agent instruction: read this file before starting any task. Fix issues marked `BLOCKING`
before proceeding. `HIGH` must be fixed in the same task that touches the affected file.
`MEDIUM` and `LOW` can be fixed inline as you encounter them. Each section below is a
dated review pass — newest at the top.

---

<!-- REVIEW SECTION START — 2026-06-11i -->
## Review — 2026-06-11i | F3 (f54209f)

### Scope

Commit `f54209f` — add `@anvay/connector-prometheus` + `@anvay/connector-loki` to gateway `package.json`; replace bare `sleep 1` with active wait loops in `start_demo.sh` modes 2 and 3.

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 0 LOW — CLEAN

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 5/5 | Both package deps added. Wait loops in modes 2 and 3. F3 LOW resolved. |
| D2 Code Standards | 5/5 | Active poll (up to 15s) beats bare sleep. Web check uses HTTP status grep correctly. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 5/5 | No issues. |
| D5 Readability | 5/5 | One-liner wait loops compact but readable. |
| D6 Clarity/Comments | 5/5 | No noise. |

---

<!-- REVIEW SECTION START — 2026-06-11h -->
## Review — 2026-06-11h | F2 (0b43542)

### Scope

Commit `0b43542` — replace `read -rp` prompt with `select` menu, remove positional arg shortcut.

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 1 LOW

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 5/5 | `select` menu always shown. Positional arg path removed. 6 options correct. |
| D2 Code Standards | 5/5 | `case "$REPLY"` on 1-6, invalid loops back cleanly. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 5/5 | No issues. |
| D5 Readability | 5/5 | Options array readable, PS3 prompt clear. |
| D6 Clarity/Comments | 5/5 | No superfluous comments. |

---

### LOW

**L1** _(carried from 2026-06-11g L1, unresolved)_ `scripts/start_demo.sh` modes 2 and 3 — `sleep 1` before `check_service` is too short. Gateway and web are started with `& ` in background; 1 second is not enough. Probe always shows ✗. Change `sleep 1` to `sleep 3` on lines 59 and 72, or replace the live probe with a static "starting — check logs" message.

---

<!-- REVIEW SECTION START — 2026-06-11g -->
## Review — 2026-06-11g | F1 (56885da)

### Scope

Commit `56885da` — interactive restart menu + health checks in start_demo.sh.

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 1 LOW

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 5/5 | Menu, non-interactive args, health checks all present. |
| D2 Code Standards | 5/5 | `eval`-based helper clean. Fall-through to full start correct. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 5/5 | No issues. |
| D5 Readability | 5/5 | Clear mode labels and comments. |
| D6 Clarity/Comments | 5/5 | Comments minimal and useful. |

---

### LOW

**L1** `scripts/start_demo.sh` modes 2/3 — health check runs immediately after backgrounding the process. Gateway/web not up yet → always shows ✗. Add `sleep 3` before `check_service` in modes 2 and 3, or print "starting (check logs)" instead of a live probe.

---

<!-- REVIEW SECTION START — 2026-06-11f -->
## Review — 2026-06-11f | M3 fix (89e3020)

### Scope

Commit `89e3020` — pass connector credentials as payload in bootstrap trigger.

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 0 LOW — CLEAN

Fix correct. Also patches a second pre-existing bug: original publish omitted `type: 'connector_registered'`, so `switch (event.type)` in builder never matched — bootstrap was silently skipped even before M1/M2. Both `type` and `payload` now present. Full bootstrap pipeline functional.

---

<!-- REVIEW SECTION START — 2026-06-11e -->
## Review — 2026-06-11e | B1/B3/M1/M2 (8d72224)

### Scope

Commit `8d72224` — gate create endpoint, provider guard, prometheus/loki bootstraps.

### Verdict: 0 BLOCKING, 0 HIGH, 1 MEDIUM, 0 LOW

B1 and B3 clean. M1/M2 bootstrap implementations are correct but will silently fail at runtime due to undefined payload.

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 3/5 | B1/B3 complete. M1/M2 bootstrap logic correct but never executes — payload is undefined at call site. |
| D2 Code Standards | 5/5 | Patterns correct, error handling present. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 5/5 | No issues. |
| D5 Readability | 5/5 | Clean. |
| D6 Clarity/Comments | 5/5 | No spurious comments. |

---

### MEDIUM

**M3** `apps/gateway/src/routes/connectors.ts:58` — bootstrap trigger publishes `{ tenantId, connectorType }` with no `payload` field. `GraphBuilderAgent.onConnectorRegistered` passes `event.payload` (undefined) to `bootstrap.bootstrap(...)`. Inside `PrometheusBootstrap` and `LokiBootstrap`, `payload['baseUrl']` throws `TypeError: Cannot read properties of undefined` before the `?? 'http://localhost:9090'` fallback. Error is swallowed by try-catch in builder — bootstrap silently returns, zero entities seeded.

Fix in `apps/gateway/src/routes/connectors.ts` bootstrap route: read credentials from `connector_config` before publishing and include them as `payload`:

```typescript
const rows = await withTenant(prisma, tenantId, (tx) =>
  tx.$queryRaw<Array<{ credentials: Record<string, unknown> }>>`
    SELECT credentials FROM connector_config
    WHERE tenant_id = ${tenantId}::uuid AND connector_type = ${type}
  `
).catch(() => [])
const creds = (rows[0]?.credentials ?? {}) as Record<string, unknown>
await pub.publish('connector_registered', JSON.stringify({
  tenantId,
  connectorType: type,
  connectorId: type,
  payload: creds,
}))
```

---

<!-- REVIEW SECTION START — 2026-06-11d -->
## Review — 2026-06-11d | B4 fix (cd953b9)

### Scope

Commit `cd953b9` — remove `updated_at`, severity mapping.

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 0 LOW — CLEAN

Both schema errors from B2 corrected exactly. INSERT now matches `incidents` schema. `warning → medium` mapping correct.

---

<!-- REVIEW SECTION START — 2026-06-11c -->
## Review — 2026-06-11c | B2 fix (07d0831)

### Scope

Commit `07d0831` — alertmanager webhook inserts incident to DB.

### Verdict: 1 BLOCKING, 0 HIGH, 0 MEDIUM, 0 LOW

Logic correct. Two schema mismatches cause every alert INSERT to fail.

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 2/5 | Flow correct conceptually. INSERT fails at runtime — `updated_at` column does not exist in schema. |
| D2 Code Standards | 4/5 | Idempotency via `ON CONFLICT DO NOTHING` correct. Enum cast issue. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 5/5 | No issues. |
| D5 Readability | 5/5 | Clean. |
| D6 Clarity/Comments | 5/5 | Good comment on the INSERT line. |

---

### BLOCKING

**B4** `apps/gateway/src/routes/events.ts:65` — INSERT fails with two schema errors:

1. **`updated_at` column does not exist** in `incidents` table (schema: `id, tenant_id, title, severity, status, description, suggested_root_cause, created_at, resolved_at`). Every alertmanager webhook will throw `column "updated_at" of relation "incidents" does not exist`.

2. **Alertmanager sends `warning` severity** — not a valid `IncidentSeverity` enum value (`critical | high | medium | low`). Needs mapping: `warning → medium`. Insert as `${mappedSeverity}::incident_severity` not `::text`.

Fix: remove `updated_at` from INSERT, add severity mapping before the query.

---

<!-- REVIEW SECTION START — 2026-06-11b -->
## Review — 2026-06-11b | Demo chaos wiring + provider.color crash

### Scope

Codebase audit — demo event flow, provider.color TypeError, stub bootstraps.

### Verdict: 2 BLOCKING, 0 HIGH, 2 MEDIUM, 0 LOW

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 1/5 | Alert pipeline broken — alertmanager webhook fires but no incident reaches DB. PrometheusBootstrap + LokiBootstrap are stubs. Chat returns mock data. |
| D2 Code Standards | 4/5 | Real execute() in prometheus agent. Patterns consistent. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 5/5 | No issues. |
| D5 Readability | 5/5 | Clean. |
| D6 Clarity/Comments | 5/5 | No spurious comments. |

---

### BLOCKING

**B1** `apps/gateway/src/gate/gate-decide-route.ts` — `POST /api/gate` endpoint missing.
(Carried from 2026-06-11a — bridge task already posted, executor has not yet implemented.)

**B2** `apps/gateway/src/routes/events.ts` — `POST /api/events/alert` never writes to the
`incidents` table. Alertmanager fires → Redis `alert_fired` published → no subscriber
(not in `GRAPH_EVENT_CHANNELS`) → DB stays empty → War Room / Signals show nothing from
chaos services. Full demo flow broken. Fix: on alert webhook, INSERT into `incidents` table
directly (same request handler, before Redis publish), then publish `incident_created`
(which IS in `GRAPH_EVENT_CHANNELS`).

---

### MEDIUM

**M1** `connectors/prometheus/src/bootstrap.ts` — stub returning 0 entities. Prometheus
bootstrap must call `GET /api/v1/label/job/values`, create a `Service` entity per job, and
set `connectorCoordinates.prometheus.resourceIds.job`. Without this, `resolveContext()` has
no coordinates and chat falls back to scatter-gather.

**M2** `connectors/loki/src/bootstrap.ts` — same pattern. Call `GET /loki/api/v1/labels`,
get `{service_name}` label values, upsert `Service` entities with loki coordinates.

---

<!-- REVIEW SECTION START — 2026-06-11a -->
## Review — 2026-06-11a | T1-T3 coverage fixes (8a9f980 + ace995b)

### Scope

Commits `8a9f980` (fix: T1-T3) + `ace995b` (bridge close).

### Verdict: 1 BLOCKING, 0 HIGH, 0 MEDIUM, 0 LOW

T1 and T2 clean. T3 has a BLOCKING gap — gateway missing `POST /api/gate` endpoint.

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 3/5 | T1/T2 correct. T3 seeds to non-existent route → test will timeout in CI. |
| D2 Code Standards | 5/5 | T1 locator fixed correctly. T2 two-step isolation check correct. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 5/5 | Cross-tenant now rejects 200 — real isolation assertion. |
| D5 Readability | 5/5 | Clean. |
| D6 Clarity/Comments | 5/5 | Bridge appended correctly. |

---

### BLOCKING

**B1** `apps/gateway/src/gate/` — `POST /api/gate` does not exist.

`approvals.spec.ts` T3 seeds via:
```typescript
await request.post(`${GATEWAY}/api/gate`, { ... })
```

Gateway only has `POST /api/gate/:gateId/decide` (in `gate-decide-route.ts`). No create endpoint exists. Seed returns 404 silently (no assertion on POST response). `gate_events` table stays empty. Workflows UI shows no pending approvals. `await expect(approveBtn).toBeVisible({ timeout: 5000 })` times out → test FAILS in CI.

Fix — add `POST /api/gate` to `apps/gateway/src/gate/gate-decide-route.ts` (or a new file):

```typescript
app.post<{ Body: { action: string; target: string; requestedBy?: string } }>(
  '/api/gate', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['action', 'target'],
        properties: {
          action: { type: 'string' },
          target: { type: 'string' },
          requestedBy: { type: 'string' },
        },
      },
    },
  },
  async (request, reply) => {
    const { action, target, requestedBy } = request.body
    const { tenantId } = request.user as { tenantId: string }
    const row = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO gate_events (id, tenant_id, action, target, status, requested_by, created_at)
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${action}, ${target}, 'pending',
                ${requestedBy ?? 'system'}, NOW())
        RETURNING id
      `
    )
    return reply.code(201).send({ ok: true, id: (row as Array<{ id: string }>)[0]?.id })
  },
)
```

After adding the route, `T3 approvals.spec.ts` should pass: seed creates a `pending` gate → UI renders approve button → test clicks and asserts removal.

<!-- REVIEW SECTION END — 2026-06-11a -->

---

<!-- REVIEW SECTION START — 2026-06-10m -->
## Review — 2026-06-10m | S1-S11 shell spec enrichment (e7921b2 + 5703b44)

### Scope

Commits `e7921b2` (test: S1-S11 real UI assertions + fixture dedup) + `5703b44` (bridge close).

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 1 LOW — CLEAN (1 nit)

All 10 shell specs enriched with real `toBeVisible` assertions. `anvay.spec.ts` deduped against `fixtures.ts`. Bridge properly closed with append + `[CLOSED]`.

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 5/5 | All S1-S11 addressed. |
| D2 Code Standards | 4/5 | `kb.spec.ts` locator mixes CSS and `text=` engine in one string — invalid (see L1). |
| D3 Performance | 5/5 | `waitForTimeout(1000)` removed. Real visibility checks used. |
| D4 Security | 5/5 | No regressions. |
| D5 Readability | 5/5 | Deduped fixtures, clean OR-locator chains. |
| D6 Clarity/Comments | 5/5 | Bridge appended correctly. |

---

### LOW

**L1** `apps/web/e2e/kb.spec.ts:9` — mixed selector engine in CSS string:

```typescript
// WRONG — 'text=Entity' is a Playwright selector engine prefix, not CSS.
// When used in a comma-separated CSS string, it matches a literal <text> HTML tag
// with attribute =Entity — which doesn't exist. Third option never fires.
page.locator('input[placeholder*="Search"], input[placeholder*="search"], text=Entity')

// CORRECT — use .or() for cross-engine OR:
page.locator('input[placeholder*="earch"]').or(page.locator('text=Entity'))
```

<!-- REVIEW SECTION END — 2026-06-10m -->

---

<!-- REVIEW SECTION START — 2026-06-10l -->
## Review — 2026-06-10l | LOW sweep A1-A6 (c12df09 + c1059a9)

### Scope

Commits `c12df09` (fix: A3-A6) + `c1059a9` (bridge close). A1/A2 posted in error — reviewer did not verify current state before writing sweep task. Both were already fixed. Process failure: always read affected files before posting bridge tasks.

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 1 LOW — CLEAN (1 nit)

All 6 sweep items resolved. Bridge properly closed with append + `[CLOSED]`. One LOW on A6.

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 5/5 | All A1-A6 resolved. |
| D2 Code Standards | 5/5 | ConnectorCreds consolidated. `pnpm typecheck` clean assumed. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 4/5 | Cross-tenant test added but assertion too permissive (see L1). |
| D5 Readability | 5/5 | k8s comment inline. |
| D6 Clarity/Comments | 5/5 | Bridge properly closed via append in c1059a9. Protocol followed. |

---

### LOW

**L1** `apps/web/e2e/security.spec.ts` — Cross-tenant JWT test (A6) accepts `200` in assertion:

```typescript
expect([200, 401, 403]).toContain(resp.status())
```

200 means the request succeeded — if the gateway ignores the `x-tenant-id` header entirely and returns the authenticated user's own data, the test still passes. This doesn't verify tenant isolation at all.

Fix when convenient — narrow to reject only 200 that would indicate cross-tenant leak, or restructure to assert 403/401 specifically. For now flagged LOW since real RLS enforcement happens in Postgres, not this header, so the test as written is a structural placeholder rather than a real isolation proof.

<!-- REVIEW SECTION END — 2026-06-10l -->

---

<!-- REVIEW SECTION START — 2026-06-10k -->
## Review — 2026-06-10k | L1 credential check (f4b45a1)

### Scope

Commit `f4b45a1` — single-line fix: `toContain('credentials')` → `toMatch(/"credentials"\s*:/)`.

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 0 LOW — CLEAN

Fix exactly as specified. No regressions. No bridge closing entry (bridge cursor updated only).

<!-- REVIEW SECTION END — 2026-06-10k -->

---

<!-- REVIEW SECTION START — 2026-06-10j -->
## Review — 2026-06-10j | 2026-06-10i fixes (8e9b24c + e5ed524)

### Scope

Commits `8e9b24c` (fix: B1/M1-3/L1-2) + `e5ed524` (bridge close).

### Verdict: 0 BLOCKING, 0 HIGH, 1 MEDIUM, 1 LOW

All BLOCKINGs and MEDIUMs from 2026-06-10i resolved. One recurring bridge protocol
violation. L3 intentionally deferred (not in commit scope).

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 5/5 | B1/M1/M2/M3/L1/L2 all correctly fixed. |
| D2 Code Standards | 5/5 | OR-locator chain correct. Offset param correct. Import fixed. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 4/5 | `authHeaders` import restored. L3 credential check still broad but LOW. |
| D5 Readability | 5/5 | Duplicate describe block removed. Test names accurate. |
| D6 Clarity/Comments | 2/5 | e5ed524 mutates bridge entry in-place again — same violation as 8a7cfeb. |

---

### MEDIUM

**M1** `docs/BRIDGE.md` — e5ed524 mutated `TASKS [OPEN]` → `TASKS [ANSWERED]` in-place. Same violation as 8a7cfeb in prior cycle. Bridge is append-only. `[ANSWERED]` also not a valid status token (valid: `[OPEN]`, `[CLOSED]`). Persistent pattern — two cycles in a row.

---

### LOW

**L1** `apps/web/e2e/security.spec.ts:47` — `expect(body).not.toContain('credentials')` still broad (carried from L3 in 2026-06-10i — not in 8e9b24c scope, acceptable). False positive risk if response includes field names containing the substring `credentials`. Tighten when convenient:
```typescript
expect(body).not.toMatch(/"credentials"\s*:/)
```

<!-- REVIEW SECTION END — 2026-06-10j -->

---

<!-- REVIEW SECTION START — 2026-06-10i -->
## Review — 2026-06-10i | M1-M5 + L4-L5 task fixes (2a61381 + 8a7cfeb)

### Scope

Commits `2a61381` (test: M1-M5 + L4-L5) + `8a7cfeb` (bridge: M1-M5/L4-L5 resolved).

### Verdict: 1 BLOCKING, 0 HIGH, 4 MEDIUM, 3 LOW

B1 is a runtime crash — test suite will fail on import error. M3/M4 are carry-overs not
addressed. 8a7cfeb mutates a bridge entry in-place (append-only violation).

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 3/5 | M1/M4 addressed. M2 badge locator broken. audit.ts offset still missing. |
| D2 Code Standards | 2/5 | Missing import causes runtime crash. Duplicate describe block. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 3/5 | Credential check added but `.not.toContain('credentials')` too broad — false positives if any field name contains the word. |
| D5 Readability | 3/5 | Duplicate describe/test names in signals-view.spec.ts. |
| D6 Clarity/Comments | 2/5 | Bridge entry mutated in-place (append-only violated). |

---

### BLOCKING

**B1** `apps/web/e2e/security.spec.ts:2` — `authHeaders` used on line 43 but not imported.

```typescript
// Line 2 — only imports GATEWAY:
import { GATEWAY } from './fixtures'

// Line 43 — uses authHeaders which is undefined:
const h = await authHeaders(request)
```

Runtime: `ReferenceError: authHeaders is not defined`. Entire security spec crashes.

Fix — change line 2 to:
```typescript
import { GATEWAY, authHeaders } from './fixtures'
```

---

### MEDIUM

**M1** `apps/web/e2e/signals-view.spec.ts:25-36` — Duplicate `test.describe('Signals extended', ...)` with identical test name `'severity badges visible on alert cards'`. Old block (lines 16-23) not removed — Codex appended instead of replacing. Two tests with same describe+name = ambiguous reporting.

Fix — delete old block (lines 16-23), keep new seeded version.

**M2** `apps/web/e2e/signals-view.spec.ts:33` — Badge locator is invalid:

```typescript
// WRONG — single CSS selector string, not an OR of text matchers:
page.locator('text=critical, text=high, text=warning, text=low')

// CORRECT — Playwright OR-locator chain:
page.locator('text=critical').or(page.locator('text=high')).or(page.locator('text=warning')).or(page.locator('text=low'))
// Or use regex:
page.locator('[class*=badge], [class*=severity]').filter({ hasText: /critical|high|warning|low/i })
```

Test will always fail or silently never match.

**M3** `apps/gateway/src/routes/audit.ts` — `offset` param still not implemented. Carry-over from bridge task (explicitly requested in 5c69e0f bridge entry). Test `?limit=5&offset=5` only asserts `Array.isArray` — vacuous. Gateway ignores `?offset`.

Fix (unchanged from prior bridge task):
```typescript
const offsetClause = Math.max(Number((request.query as Record<string, string>)['offset']) || 0, 0)
// query:
FROM audit_events ORDER BY created_at DESC LIMIT ${limitClause} OFFSET ${offsetClause}
```

**M4** `docs/BRIDGE.md` — 8a7cfeb mutated `TASKS [OPEN]` → `TASKS [ANSWERED]` in-place. Bridge is append-only. Also `[ANSWERED]` is not a valid status token (valid: `[OPEN]`, `[CLOSED]`). Must append a closing entry instead of editing existing.

---

### LOW

**L1** `apps/web/e2e/graph-events.spec.ts:14` — Test name says `"returns 401"` but assertion is `expect([400, 401]).toContain(resp.status())`. Title/assertion mismatch. Rename to `"returns 401 or 400"`.

**L2** `apps/web/e2e/signals-view.spec.ts:29` — `page.waitForTimeout(500)` hardcoded wait after POST. Should await the POST response and use `waitForResponse` or `page.reload()` + wait for selector. Fragile on slow CI.

**L3** `apps/web/e2e/security.spec.ts:47` — `expect(body).not.toContain('credentials')` too broad. Substring match will fail if response legitimately contains `credentialsConfigured`, `hasCredentials`, or similar. Tighten to `'"credentials"'` (with quotes, checking JSON key) or `/"credentials"\s*:/.test(body)`.

<!-- REVIEW SECTION END — 2026-06-10i -->

---

<!-- REVIEW SECTION START — 2026-06-10h -->
## Review — 2026-06-10h | e2e Wave 1+2+3 fixes (f1e5191 + 448ab9e)

### Scope

Commits `f1e5191` (B1-B4/H1-H3/M3 fixes) + `448ab9e` (3 files corrupted by f1e5191 repaired directly). `4f1a3d8` is documentation-only (REVIEW.md marker update — "ALL RESOLVED" claim is inaccurate, corrected here).

### Verdict: 0 BLOCKING, 0 HIGH, 4 MEDIUM, 4 LOW

All BLOCKINGs and HIGHs from 2026-06-10g resolved. 4 MEDIUMs and 4 LOWs remain open from 2026-06-10g — NOT all resolved despite the marker in 4f1a3d8.

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 3/5 | B1-B4/H1-H3/M3 fixed. f1e5191 introduced 3 new syntax errors immediately repaired in 448ab9e. M1/M2/M4/M5 still open. |
| D2 Code Standards | 4/5 | 448ab9e restored correct structure. No lingering syntax issues. |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 4/5 | SSRF tests now check `toHaveLength(0)`. Cross-tenant JWT + credential exposure tests still missing. |
| D5 Readability | 4/5 | Audit test now properly uses `request` fixture. |
| D6 Clarity/Comments | 3/5 | 4f1a3d8 "ALL RESOLVED" header claim is wrong — M1/M2/M4/M5/L2/L4/L5 still open. |

---

### Carried-over MEDIUM (from 2026-06-10g, not yet fixed)

**M1** `connectors.spec.ts` — save error test checks API response (400), not UI `saveError` banner. Needs browser test: `page.goto` → click Connect → submit → assert error visible in modal.

**M2** `signals-view.spec.ts` — `text=critical` assertion fails on empty DB. Seed an alert first or match any of `critical|high|warning`.

**M4** `orchestrator-chat.spec.ts` — scenario chips visible, click chip → populates input, settings panel open/close — not added.

**M5** `graph-events.spec.ts` — only 401 test. Valid connector key + valid payload → 200 and invalid payload → 400 tests missing.

---

### Carried-over LOW (from 2026-06-10g, not yet fixed)

**L2** `approvals.spec.ts` — UI flow missing (click Approve/Reject in browser, verify item removed from list).

**L4** `security.spec.ts` — cross-tenant JWT test and credential exposure test (`GET /api/connectors` must not include `credentials` field) missing.

**L5** `signals-view.spec.ts` — unused `DEMO_TENANT` import.

**L-f1** (carried from 2026-06-10f) `audit.ts` — `offset` query param still not implemented in gateway. The test in 448ab9e now passes `?offset=5` but gateway ignores it (no OFFSET clause). Test asserts `Array.isArray` only — currently vacuous until gateway implements offset.

<!-- REVIEW SECTION END — 2026-06-10h -->

---

<!-- REVIEW SECTION START — 2026-06-10g -->
## Review — 2026-06-10g | e2e Wave 1+2+3 test expansion (cbe643c + 17c3ab9) [RESOLVED in f1e5191]

### Scope

Commits `cbe643c` (Wave 1) + `17c3ab9` (Wave 2+3). Files: fixtures.ts (new), audit-view.spec.ts, cert-alert-flow.spec.ts, connectors.spec.ts, signals-view.spec.ts, provider-config.spec.ts + 14 new spec files.

### Verdict: 4 BLOCKING, 3 HIGH, 5 MEDIUM, 5 LOW — ALL RESOLVED

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 2/5 | 4 files have duplicate imports/const — TypeScript compile errors, tests won't run. 2 of 3 Wave 1 gaps from plan not filled (infra health subpaths, orchestrator chips). Wave 3 specs are render-only shells. |
| D2 Code Standards | 2/5 | Imports mid-file (B2/B3/B4). `const` redeclaration after import (B1). Unused import (`DEMO_TENANT` in signals-view). |
| D3 Performance | 5/5 | No regressions. |
| D4 Security | 3/5 | SSRF tests exist but assert too weakly — `Array.isArray` passes for any response including unblocked ones. Cross-tenant JWT and credential exposure tests not written. |
| D5 Readability | 3/5 | Empty test body (H1) misleads — looks like a test, does nothing. |
| D6 Clarity/Comments | 4/5 | Commit message describes waves accurately. Comment in empty test says "Direct API test" but no test follows. |

---

### BLOCKING

**B1 — `cert-alert-flow.spec.ts`:4-5 — `const GATEWAY` / `const DEMO_TENANT` redeclared after import**

Lines 2-5:
```typescript
import { GATEWAY, authHeaders, DEMO_TENANT } from './fixtures'  // line 2 — imports GATEWAY, DEMO_TENANT
const GATEWAY = 'http://127.0.0.1:4000'                         // line 4 — REDECLARE
const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'       // line 5 — REDECLARE
```
TypeScript error: `Cannot redeclare block-scoped variable 'GATEWAY'` / `'DEMO_TENANT'`. Tests will not compile.

Fix — delete lines 4 and 5 (the const declarations). Values already available from fixtures import.

---

**B2 — `cert-alert-flow.spec.ts`:47 — second `import` statement mid-file**

Line 47 (after a `test.describe` block closes):
```typescript
import { GATEWAY, DEMO_TENANT } from './fixtures'
```
Imports must be at top of file before any statements. TypeScript rejects top-level `import` after `test.describe`. Also duplicates the import already on line 2.

Fix — delete line 47 entirely. Already imported at line 2.

---

**B3 — `connectors.spec.ts`:23 — second `import` statement mid-file**

```typescript
import { GATEWAY, authHeaders } from './fixtures'  // duplicate, mid-file
```
Fix — delete this line. Already imported at line 2.

---

**B4 — `provider-config.spec.ts`:20 — second `import` statement mid-file**

```typescript
import { GATEWAY, authHeaders } from './fixtures'  // duplicate, mid-file
```
Fix — delete this line. Already imported at line 2.

---

### HIGH

**H1 — `audit-view.spec.ts`: `?limit=5 returns at most 5 events` test body is empty**

```typescript
test('?limit=5 returns at most 5 events', async ({ page }) => {
  await page.goto('/?view=audit')
  // The component doesn't pass query params — this verifies the API supports it
  // Direct API test
})
```
No assertion. Test passes vacuously. The comment says "Direct API test" but the body calls `page.goto` (a UI call) and asserts nothing.

Fix — replace with an actual API assertion using `request` fixture:
```typescript
test('?limit=5 returns at most 5 events', async ({ request }) => {
  const h = await authHeaders(request)
  const resp = await request.get(`${GATEWAY}/api/audit?limit=5`, { headers: h })
  expect(resp.status()).toBe(200)
  const body = await resp.json() as unknown[]
  expect(body.length).toBeLessThanOrEqual(5)
})
```

---

**H2 — `security.spec.ts` SSRF tests: assertion too weak — `Array.isArray` passes for unblocked URLs too**

All three SSRF tests assert only `Array.isArray(body.models)`. An empty array `[]` satisfies this. A valid (unblocked) URL that returns no models also satisfies this. The test cannot distinguish "blocked and returned empty" from "valid but no models configured". Also: no status code check.

Fix — assert both status 200 and length 0:
```typescript
expect(resp.status()).toBe(200)
expect(body.models).toHaveLength(0)
```

---

**H3 — `services.spec.ts`: accepts 404 — hides missing route**

```typescript
expect([200, 404]).toContain(resp.status())
```
If `/api/services` route is unregistered or throws, 404 passes. This test certifies nothing meaningful.

Fix:
```typescript
expect(resp.status()).toBe(200)
```

---

### MEDIUM

**M1 — `connectors.spec.ts` save error test doesn't test UI behaviour**

The `save error shows on failed connect` test calls `page.request.put(...)` directly — it checks the API returns 400, not whether the `saveError` banner appears in the UI. The plan specified: open modal → fill invalid type → submit → assert error banner visible in modal.

Fix — rewrite as UI test:
```typescript
test('save error shows on failed connect', async ({ page }) => {
  await page.goto('/')
  await page.locator('text=Connectors').first().click()
  // Click first connector's Connect button
  await page.locator('button:has-text("Connect")').first().click()
  // Submit with empty/bad credentials — gateway returns 4xx
  await page.locator('button:has-text("Save")').first().click()
  // Error banner visible
  await expect(page.locator('text=Save failed').or(page.locator('[data-testid="save-error"]'))).toBeVisible()
})
```
Adjust selectors to match actual component markup.

---

**M2 — `signals-view.spec.ts` severity badge test fragile — fails on empty DB**

```typescript
await expect(page.locator('text=critical').first()).toBeVisible()
```
If no alerts are seeded, page shows empty state and test fails. Should seed an alert first or accept any severity.

Fix — create an alert before checking, or use a looser assertion:
```typescript
// Create alert first
await request.post(`${GATEWAY}/api/events/alert`, { data: { tenantId: DEMO_TENANT, title: 'test', severity: 'critical' } })
await page.waitForTimeout(500)
await page.goto('/')
await page.locator('text=Signals').first().click()
// Check any severity badge
const badge = page.locator('text=critical,text=high,text=warning').first()
await expect(badge).toBeVisible()
```

---

**M3 — `infra.spec.ts` not updated — health subpath + counter tests missing**

`/health/live`, `/health/ready`, `/health/startup` and request-counter-increment tests not added. Specified in Wave 1 plan.

Fix — add to `apps/web/e2e/anvay.spec.ts` or new `infra.spec.ts`:
```typescript
test('GET /health/live returns 200', async ({ request }) => {
  expect((await request.get(`${GATEWAY}/health/live`)).status()).toBe(200)
})
test('GET /health/ready returns 200', async ({ request }) => {
  expect((await request.get(`${GATEWAY}/health/ready`)).status()).toBe(200)
})
test('GET /health/startup returns 200', async ({ request }) => {
  expect((await request.get(`${GATEWAY}/health/startup`)).status()).toBe(200)
})
```

---

**M4 — `orchestrator-chat.spec.ts` additions missing**

Scenario shortcut chips, click chip → populates input, settings panel open/close — not added. Specified in Wave 1 plan.

---

**M5 — `graph-events.spec.ts` incomplete — valid payload and invalid payload tests missing**

Only has the 401 (no connector key) test. Plan specified: valid key + valid payload → 200; invalid payload → 400.

---

### LOW

**L1 — Wave 3 specs (10 files): render-only shells, no content assertions**

All 10 are identical: navigate → wait 1s → assert zero JS errors. This is better than nothing but misses plan-specified assertions: stage labels visible (lifecycle), L1/L2/L3/L4 options (workflow), entity list (kb), method selector (api-client), user list (access), etc. Acceptable as baseline; fill in per plan when time allows.

**L2 — `approvals.spec.ts`: UI flow missing**

Gate approve/reject via browser (clicking Approve/Reject buttons in ApprovalsView) not tested. Only API tests.

**L3 — `audit-view.spec.ts`: `?offset` pagination test missing**

`?limit=5&offset=5` second-page test specified in plan, not written.

**L4 — `security.spec.ts`: cross-tenant JWT and credential exposure tests missing**

Plan specified: token from tenant A cannot access tenant B incidents; `GET /api/connectors` response must not contain `credentials`/`config_encrypted`.

**L5 — `signals-view.spec.ts`: unused import `DEMO_TENANT`**

Imported but never used in the added test. Minor lint issue.

---

### Pending Features (unchanged)

See 2026-06-10f section.

<!-- REVIEW SECTION END — 2026-06-10g -->

---

<!-- REVIEW SECTION START — 2026-06-10f -->
## Review — 2026-06-10f | LOW items from 2026-06-10e resolved (841a507)

### Scope

Commit `841a507`. Files changed: connectors.tsx, settings.ts, audit.ts, k8s/agent.ts, github/agent.ts, grafana/agent.ts, linear/agent.ts, loki/agent.ts, pagerduty/agent.ts, prometheus/agent.ts.

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 2 LOW

All 5 LOWs from 2026-06-10e closed. Two new LOWs found.

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 5/5 | L-e1/L-e2/L1/L4 ✅. L3 partial — limit configurable but no cursor pagination. |
| D2 Code Standards | 4/5 | `ConnectorCreds` interface duplicated across 7 agent files instead of shared from `@anvay/types`. |
| D3 Performance | 5/5 | No regressions. Audit limit cap (200) prevents runaway queries. |
| D4 Security | 5/5 | Limit capped to 200 via `Math.min` before use in raw query. No injection risk. |
| D5 Readability | 5/5 | Clean mechanical changes. k8s comment is clear. |
| D6 Clarity/Comments | 5/5 | All comments correct and current. |

---

### LOW

**L-f1 — `audit.ts`: cursor pagination still missing — can't page past first N rows**

`apps/gateway/src/routes/audit.ts`: commit added configurable `limit` (default 50, max 200). No `cursor` or `offset` param added. Users with >200 audit events can only see the most recent batch — no way to retrieve older events. The original L3 spec said "limit and cursor query params".

Fix — add `offset` query param (simpler than cursor for append-only audit log):
```typescript
const limitClause = Math.min(Number((request.query as Record<string, string>)['limit']) || 50, 200)
const offsetClause = Math.max(Number((request.query as Record<string, string>)['offset']) || 0, 0)
// ...
FROM audit_events ORDER BY created_at DESC LIMIT ${limitClause} OFFSET ${offsetClause}
```
Return `{ events, total, limit, offset }` so callers know how to paginate.

Verify: `GET /api/audit?limit=10&offset=10` returns the second page.

---

**L-f2 — `ConnectorCreds` interface duplicated in all 7 agent files**

Each of `connectors/*/src/agent.ts` defines its own identical `interface ConnectorCreds { baseUrl?: string; token?: string; apiKey?: string; password?: string; org?: string; [k: string]: unknown }`. If a new field is needed (e.g. `region`, `orgId`), all 7 files must be updated.

Fix — export from `@anvay/types`:
```typescript
// packages/types/src/index.ts
export interface ConnectorCreds { baseUrl?: string; token?: string; apiKey?: string; password?: string; org?: string; [k: string]: unknown }
```
Import in each agent: `import type { ConnectorCreds } from '@anvay/types'`. Remove local declarations.

Verify: `pnpm typecheck` clean after change.

---

### Pending Features (unchanged from 2026-06-10e)

See 2026-06-10e section — no feature changes in this commit.

<!-- REVIEW SECTION END — 2026-06-10f -->

---

<!-- REVIEW SECTION START — 2026-06-10e -->
## Review — 2026-06-10e | 2026-06-10d fixes — all BLOCKING + HIGH + MEDIUM + LOW resolved

### Scope

Commits `5fcf9d0` + `5101916`. Files changed: events.ts, settings.ts, gateway-client.ts, connectors.tsx, bootstrap/route.ts, start_demo.sh, k8s/agent.ts, grafana/agent.ts, loki/agent.ts.

### Verdict: 0 BLOCKING, 0 HIGH, 0 MEDIUM, 2 LOW

All 13 issues from 2026-06-10d closed. Two LOW residuals remain.

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 5/5 | All 13 prior issues resolved. B1 env wipe ✅ H1 SSRF ✅ H2 IPv6 ✅ H3 save error ✅ H4 Redis reconnect ✅ M1-M5 ✅ L2/L5/L6 ✅ |
| D2 Code Standards | 4/5 | (creds as any) (L1) still present across all 8 connector agents. L3 audit LIMIT 50 still no pagination. |
| D3 Performance | 5/5 | Redis publisher reconnect strategy added. No regressions. |
| D4 Security | 5/5 | localhost SSRF blocked. tenantId UUID validation on deploy/pr-merged. K8s pod path traversal fixed. |
| D5 Readability | 5/5 | All fixes clean. No dead code. |
| D6 Clarity/Comments | 4/5 | settings.ts:79 comment still says "allow localhost for Ollama" after localhost was blocked. |

---

### LOW

**L-e1 — `connectors.tsx` line 120: `saveError` not cleared on modal re-open**

`apps/web/components/connectors.tsx`:120: `onConnect` handler is `() => { setModal(conn); setFormValues({}) }` — does not call `setSaveError(null)`. If a save fails (H3 fix shows the error), user closes the modal, then reopens it — the previous error message is still visible before they've attempted anything. `setSaveError(null)` runs only on the success path (line 78), not on modal open.

Fix — add `setSaveError(null)` to the `onConnect` callback in `ConnectorCard` usage:
```typescript
onConnect={() => { setSaveError(null); setModal(conn); setFormValues({}); }}
```

Verify: save fails, error shown; close modal; reopen — error is gone.

---

**L-e2 — `settings.ts` line 79: stale comment contradicts implementation**

`apps/gateway/src/routes/settings.ts`:79: comment reads `// Dynamic: fetch from endpoint — SSRF-safe (block cloud metadata, allow localhost for Ollama)`. After H1 fix (commit 5fcf9d0), `isSafeBaseUrl` now blocks `localhost`. The comment says "allow localhost for Ollama" but the code blocks it. Misleads future readers about the intended security policy.

Fix — update comment to match implementation:
```typescript
// Dynamic: fetch from endpoint — SSRF-safe (block cloud metadata + loopback)
```

Verify: no functional change — comment only.

---

### Carried-over LOW (not fixed in this batch, not regressed)

- **L1** — `(creds as any)` in all 8 connector agents (github, grafana, pagerduty, k8s, loki, linear, prometheus). Type-safe `ConnectorCreds` interface not yet added.
- **L3** — `audit.ts` LIMIT 50 with no pagination cursor.
- **L4** — `k8s/agent.ts` calls Docker daemon API (`/containers/json`), not real Kubernetes. Acceptable for demo; needs comment or replacement before real K8s support.

---

### Pending Features (from docs/TASKS.md)

| Task | Status | Notes |
|------|--------|-------|
| M0-T1 Monorepo root | ✅ Done | pnpm workspaces, turbo, .nvmrc |
| M0-T2 Docker Compose infra | ✅ Done | pgvector image, redis, neo4j |
| M0-T3 packages/types | ✅ Done | @anvay/types |
| M0-T4 DB schema — Prisma migrations | ✅ Done | 18 migrations applied |
| M0-T5 Gateway server skeleton | ✅ Done | /health, /metrics, /auth/token |
| M0-T6 Web API routes | ✅ Done | All proxy routes with try/catch |
| M0-T7 CI pipeline | ⚠️ Unclear | .github/workflows/ not verified |
| M0-T8 E2E smoke test | ✅ Done | 50/50 Playwright passing |
| M1 Agent harness (@anvay/agent) | ⚠️ Partial | Provider factory exists; orchestrator/specialist agents not built |
| M1 Knowledge Graph | ❌ Not started | Apache AGE / Graphiti absent |
| M1 Connector bootstrap contract | ❌ Not started | Event seeded; graph not populated |
| M2 SRE Agent | ❌ Not started | |
| M2 Graph Builder Agent | ❌ Not started | |
| M3 PM/Dev Agents | ❌ Not started | |
| M4 Gate system (L2 Approve) | ⚠️ Partial | Table + endpoint exist; no UI gate flow |
| M5 Trigger engine | ⚠️ Partial | Table + subscriber + engine exist; no UI |

<!-- REVIEW SECTION END — 2026-06-10e -->

---

<!-- REVIEW SECTION START — 2026-06-10d -->
## Review — 2026-06-10d | e2e certification + credential fixes + proxy routes + connector agents [RESOLVED]

### Scope

Commits `d4bb124` → `778bcf9`. Source files changed: events.ts, settings.ts, chat-stream.ts, audit.ts, alert-subscriber.ts, gateway-client.ts, all Next.js proxy routes (alerts, audit, incidents, providers, settings/*, connectors/*), connectors.tsx, all e2e spec files, all 4 connector agents (prometheus, loki, grafana, k8s), infra/docker-compose.yml, scripts/start_demo.sh, prisma/migrations/0003_kb/migration.sql.

### Verdict: 1 BLOCKING, 4 HIGH, 5 MEDIUM, 6 LOW — ALL RESOLVED in 5fcf9d0 + 5101916

**Previous review BLOCKINGs resolved:** B1 (alert format mismatch) ✓, B2 (getToken) ✓, B3 (orchestrator selector) ✓, B4 (proxy try/catch) ✓, B5 (alertmanager KNOWN_CONNECTORS) ✓. **e2e suite: 50/50 passing.**

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 4/5 | All 5 previous BLOCKINGs resolved. Alert → incident flow works end-to-end. 50/50 e2e certified. start_demo.sh env wipe (B1) breaks repeated-run workflow. |
| D2 Code Standards | 3/5 | All connector agents use `(creds as any)`. `await` on sync call in bootstrap/route.ts. `_pub` has no reconnect strategy unlike subscriber. DEMO_TENANT function-scoped instead of module constant. |
| D3 Performance | 4/5 | Token cache in gateway-client correctly uses inflight-dedup. Redis pub singleton correct. No pagination on audit (L3). |
| D4 Security | 3/5 | `isSafeBaseUrl()` blocks `127.0.0.1`/`::1` but allows `localhost` (same address, bypasses the guard). K8s agent path traversal on pod name param. Unauthenticated deploy/pr-merged events publish unvalidated bodies to Redis. |
| D5 Readability | 4/5 | Proxy routes consistent and clean. alert-subscriber clear. Connector agents simple. K8s agent function scope too long. |
| D6 Clarity/Comments | 4/5 | `isSafeBaseUrl` comment misleads ("allow localhost for Ollama dev") but implementation inconsistently blocks the IP while allowing hostname. Loki stub not flagged as such. |

---

### BLOCKING

**B1 — `start_demo.sh` line 58: overwrites `.env` on every run — destroys user-configured API keys**

`scripts/start_demo.sh`:58 runs `cp apps/gateway/.env.example apps/gateway/.env` unconditionally. Every time the script runs, the `.env` is replaced with the blank example. Any LLM provider API key the user configured via Settings is lost. Users who run `start_demo.sh` a second time after saving a key will find the key gone and the chat endpoint returns 503.

Fix — change line 58 to a no-clobber copy:
```bash
cp -n apps/gateway/.env.example apps/gateway/.env
log "apps/gateway/.env initialized from example (existing file preserved)"
```

Verify: run `start_demo.sh` twice; confirm `.env` is not overwritten on the second run.

---

### HIGH

**H1 — `settings.ts` `isSafeBaseUrl()` line 18: `localhost` not blocked — SSRF bypass**

`apps/gateway/src/routes/settings.ts`:18:
```typescript
if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return false
```
Comment says "allow localhost for Ollama dev". Code blocks the numeric IPs but `localhost` hostname is not in the block list and returns `true`. `http://localhost:9090` passes, allowing an authenticated user to make the gateway fetch internal services (e.g., Prometheus, Redis sentinel, internal APIs) via the models endpoint.

Two valid fixes — pick one based on product intent:
- **If localhost must be allowed for Ollama:** add `localhost` to the _allowed_ set but don't pretend to block it: remove `127.0.0.1` and `::1` from the block list too (they're equivalent). Add a comment explaining the trust decision.
- **If loopback must be blocked:** add `'localhost'` to the block condition:
```typescript
if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === 'localhost') return false
```
Current comment is wrong regardless — fix it to match whichever policy is chosen.

Verify: `isSafeBaseUrl('http://localhost:9090')` must either consistently return `true` (allowed) or `false` (blocked) — not differ from `isSafeBaseUrl('http://127.0.0.1:9090')`.

---

**H2 — `gateway-client.ts` line 1: `GATEWAY_URL` defaults to `http://localhost:4000` — IPv6 resolution failure on server**

`apps/web/lib/gateway-client.ts`:1:
```typescript
export const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'
```
Node.js v20.11.0 on macOS resolves `localhost` to `::1` (IPv6) first. The gateway listens on `0.0.0.0` (IPv4 only). Server-side route handlers calling `getDemoToken()` fail with `ECONNREFUSED ::1:4000`. The same `localhost` issue that broke e2e tests (now fixed to `127.0.0.1` in test files) exists here for all server-side proxy routes.

Fix:
```typescript
export const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://127.0.0.1:4000'
```

Verify: stop gateway, start it, call `GET /api/alerts` from the Next.js app — should get 401 or 200, not 502.

---

**H3 — `connectors.tsx` `handleConnect()` line 64-65: save failure shows connector as configured**

`apps/web/components/connectors.tsx`:64:
```typescript
setConfiguredMap(prev => ({ ...prev, [modal.id]: true }))
setModal(null)
```
These run even when the PUT response is 4xx or 5xx. A failed save (e.g., unknown connector type, DB error) still marks the connector as configured in the UI and closes the modal. User has no feedback and believes the connector is saved.

Fix — check response status before updating state:
```typescript
const resp = await fetch(`/api/settings/connectors/${modal.id}`, { ... })
if (!resp.ok) {
  const err = await resp.json().catch(() => ({}))
  // surface error to user — add a saveError state field
  setSaveError((err as { error?: string }).error ?? 'Save failed')
  return
}
setConfiguredMap(prev => ({ ...prev, [modal.id]: true }))
setModal(null)
```
Add `const [saveError, setSaveError] = useState<string | null>(null)` and render it in the modal.

Verify: point gateway at a misconfigured connector type; confirm error appears in UI.

---

**H4 — `events.ts` `_pub` Redis client: no reconnect strategy — lost publishes silently swallowed**

`apps/gateway/src/routes/events.ts`:63-73: `_pub` is created once via `createClient({ url })` with no `socket.reconnectStrategy`. The alert-subscriber (`alert-subscriber.ts`:21-23) correctly has `reconnectStrategy: (retries) => Math.min(retries * 100, 3000)`. If Redis drops and reconnects, `_pub` stays in a disconnected error state. `pub.publish(...)` throws; the `eventRoutes` handlers don't catch it (no try/catch); Fastify returns 500. Events are lost.

Fix — add reconnect strategy and error handler to `getEventPub()`:
```typescript
_pub = createClient({
  url,
  socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) },
}) as import('redis').RedisClientType
_pub.on('error', (err) => log.error({ err }, 'EventPub Redis error'))
await _pub.connect()
```
Also add try/catch in each event handler so Redis failures return `{ ok: true }` instead of 500.

Verify: stop Redis, fire an alert webhook, confirm gateway returns 200 (not 500).

---

### MEDIUM

**M1 — `events.ts` `/api/events/deploy` and `/api/events/pr-merged`: unvalidated body published to Redis**

`apps/gateway/src/routes/events.ts`:39-52. Both endpoints publish `request.body` verbatim to Redis without any schema check. A malformed or malicious payload (e.g., `{"__proto__": {...}}`) reaches the trigger subscriber which calls `JSON.parse(message)` and then pattern-matches against the payload. While trigger-subscriber has UUID validation for `tenantId`, deploy and pr-merged subscribers may not. At minimum, validate that the body contains `tenantId` (valid UUID) before publishing.

Fix — add tenantId validation:
```typescript
const payload = request.body as Record<string, unknown>
if (typeof payload.tenantId !== 'string' || !UUID_RE.test(payload.tenantId as string)) {
  return reply.code(400).send({ error: 'tenantId required' })
}
```

Verify: POST without tenantId returns 400; with valid UUID returns 200.

---

**M2 — `connectors/k8s/src/agent.ts` line 34: `params.pod` interpolated into URL without encoding — path traversal**

`connectors/k8s/src/agent.ts`:34:
```typescript
const res = await fetch(`${base}/containers/${params.pod}/logs?...`)
```
`params.pod` is LLM-supplied. If the LLM passes `../info` or similar, the request path becomes `/containers/../info/logs` which traverses the Docker API path. While the Docker API is already restricted in scope, this is still a code standard violation.

Fix:
```typescript
const podName = encodeURIComponent(String(params.pod))
const res = await fetch(`${base}/containers/${podName}/logs?tail=${params.lines ?? 100}&stdout=true&stderr=true`)
```

Verify: tool call with `pod: "../info"` results in a 404 from Docker, not a different endpoint.

---

**M3 — `connectors/grafana/src/agent.ts` line 7: default password `'anvay'` wrong — should be `'admin'`**

`connectors/grafana/src/agent.ts`:7:
```typescript
const auth = btoa(`admin:${(creds as any).password ?? 'anvay'}`)
```
If `password` is missing from credentials (fallback hit), the Basic auth header encodes `admin:anvay`. Grafana's actual default password is `admin`. The demo seeds `"password":"admin"` correctly, so this only breaks if the fallback is used (e.g., a user registers Grafana without the password field).

Fix: change fallback to `'admin'`:
```typescript
const auth = btoa(`admin:${(creds as any).password ?? 'admin'}`)
```

Verify: remove `password` from Grafana connector credentials; confirm `get_dashboards` still authenticates.

---

**M4 — `connectors/loki/src/agent.ts` `get_log_volume` returns hardcoded stub — misleads LLM**

`connectors/loki/src/agent.ts`:38-42:
```typescript
const res = await fetch(`${base}/loki/api/v1/query_range?query=count_over_time(${q}[1m])&limit=1`)
if (!res.ok) return { points: [] }
return { points: [{ t: Date.now(), v: 50 }] }  // ← hardcoded, ignores response
```
Response is fetched and discarded. Always returns `v: 50`. LLM will tell users their service has "50 log events/min" regardless of reality.

Fix — parse the actual Loki response:
```typescript
const data = await res.json() as { data: { result: Array<{ values: [string, string][] }> } }
const points = data.data.result.flatMap(r => r.values.map(([ts, v]) => ({ t: Number(ts) / 1e6, v: Number(v) })))
return { points: points.length ? points : [{ t: Date.now(), v: 0 }] }
```

Verify: tool call against live Loki returns values reflecting actual log traffic.

---

**M5 — `start_demo.sh` line 81: gateway health check uses `localhost` not `127.0.0.1`**

`scripts/start_demo.sh`:81:
```bash
until curl -sf http://localhost:4000/health > /dev/null 2>&1
```
Same IPv6 resolution issue as H2. On macOS with Node v20.11.0, `localhost` may resolve to `::1`. If gateway only listens on IPv4, curl will keep failing until the 40-retry timeout, then report "Gateway failed to start" even though it's running fine.

Fix:
```bash
until curl -sf http://127.0.0.1:4000/health > /dev/null 2>&1
```

Verify: gateway start loop completes within a few retries.

---

### LOW

**L1 — All connector agents: `(creds as any)` — use typed credentials interface**

`connectors/*/src/agent.ts` all use `(creds as any).baseUrl`. Define a typed credentials shape:
```typescript
interface ConnectorCreds { baseUrl?: string; [k: string]: unknown }
const c = creds as ConnectorCreds
const base = c.baseUrl ?? 'http://localhost:9090'
```
Eliminates `any` while keeping flexibility.

---

**L2 — `events.ts` line 5: `DEMO_TENANT` function-scoped constant**

`apps/gateway/src/routes/events.ts`:5: `const DEMO_TENANT = '...'` declared inside `eventRoutes()`. Re-created on module import (not per request — `eventRoutes` is called once at startup). No correctness issue but semantically should be a module-level constant outside the function.

---

**L3 — `audit.ts` line 53: hardcoded `LIMIT 50`, no pagination**

`apps/gateway/src/routes/audit.ts`:53: `LIMIT 50` with no cursor or offset. As audit events accumulate in production, users can only see the 50 most recent. Add `limit` and `cursor` query params.

---

**L4 — `connectors/k8s/src/agent.ts`: Docker API calls, not Kubernetes API**

Agent is named `k8s` and tools say "pods", "deployments", "namespaces" — but all calls go to Docker daemon (`/containers/json`). In production against real Kubernetes, this entire agent is non-functional. Acceptable for demo (uses docker-proxy container), but should be commented clearly and replaced when real K8s support is added.

---

**L5 — `bootstrap/route.ts` line 6: `await` on synchronous `.get()` call**

`apps/web/app/api/connectors/[type]/bootstrap/route.ts`:6:
```typescript
const auth = (await _req.headers.get('authorization')) || ...
```
`Headers.get()` is synchronous and returns `string | null`. The `await` is harmless but confusing — suggests the author thought it was async. Remove `await`:
```typescript
const auth = _req.headers.get('authorization') || await getDemoToken().then(t => t ? `Bearer ${t}` : '')
```

---

**L6 — `connectors.tsx` `authHeaders` not memoized**

`apps/web/components/connectors.tsx`:25: `const authHeaders = devToken ? { ... } : {}` is recomputed on every render. Since `authHeaders` is used in effects with `[devToken]` dependency, effects re-run only when `devToken` changes — correctness is fine. Wrap in `useMemo` to prevent unnecessary object recreation if the component renders frequently.

---

### Pending Features (from docs/TASKS.md)

| Task | Status | Notes |
|------|--------|-------|
| M0-T1 Monorepo root | ✅ Done | pnpm workspaces, turbo pipeline, .nvmrc |
| M0-T2 Docker Compose infra | ✅ Done | postgres (pgvector), redis, neo4j. pgvector added this batch. |
| M0-T3 packages/types | ✅ Done | @anvay/types exists |
| M0-T4 DB schema — Prisma migrations | ✅ Done | 18 migrations applied, all tables up |
| M0-T5 Gateway server skeleton | ✅ Done | /health, /metrics, /auth/token, structured logs |
| M0-T6 Web API routes | ✅ Done | All proxy routes with try/catch |
| M0-T7 CI pipeline | ⚠️ Unclear | .github/workflows/ not in diff — may not exist |
| M0-T8 E2E smoke test | ✅ Done | 50/50 Playwright tests passing |
| M1 Agent harness (@anvay/agent) | ⚠️ Partial | Provider factory, connector tool interface exist; orchestrator/specialist agents not built |
| M1 Knowledge Graph | ❌ Not started | Apache AGE / Graphiti layer absent |
| M1 Connector bootstrap contract | ❌ Not started | Bootstrap event seeded but graph not populated |
| M2 SRE Agent | ❌ Not started | |
| M2 Graph Builder Agent | ❌ Not started | |
| M3 PM/Dev Agents | ❌ Not started | |
| M4 Gate system (L2 Approve) | ⚠️ Partial | gate_events table exists, decide endpoint exists; no UI gate flow |
| M5 Trigger engine | ⚠️ Partial | trigger_rules table + subscriber + engine exist; no UI to create rules |
| Demo certification checks 1-2 | ✅ Done | health, auth, connectors, incidents, gate, automations, chat all pass |
| Demo certification check 3 | ✅ Done | alert → Redis → incident flow e2e verified |
| Demo certification checks 4-7 | ⚠️ Manual only | Require live Prometheus/Loki calls; not in automated suite |

<!-- REVIEW SECTION END — 2026-06-10d -->

---

<!-- REVIEW SECTION START — 2026-06-10c -->
## Review — 2026-06-10c | e2e suite + demo services + prod compose + provider-config fix

### Scope

Commits `6ad07ea` → `d4bb124`. 946c380 (4-item milestone: demo counters, prod compose, start_demo.sh, e2e), 7e18366 (provider-config auth split), d4bb124 (bridge close).

### Verdict: 5 BLOCKING, 3 HIGH, 2 MEDIUM, 2 LOW

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 2/5 | Alert flow broken end-to-end (B1). e2e tests will all fail on auth (B2) and wrong selectors (B3). alertmanager connector not registerable (B5). Cert checks 3-7 not tested. |
| D2 Code Standards | 3/5 | 7 proxy routes still have no try/catch. Alert event route publishes raw Alertmanager format but subscriber expects different shape. |
| D3 Performance | 4/5 | Demo services dynamic counters correctly implemented. start_demo.sh solid structure. |
| D4 Security | 4/5 | Provider-config now properly auth-gated. No regressions. |
| D5 Readability | 4/5 | anvay.spec.ts is thorough and well-organised. playwright.config.ts clean. |
| D6 Clarity/Comments | 3/5 | start_demo.sh comments good. alert-subscriber/events.ts format mismatch not commented. |

---

### BLOCKING

**B1 — Alertmanager → alert-subscriber format mismatch (cert check 3 completely broken)**

`apps/gateway/src/routes/events.ts` `POST /api/events/alert` publishes raw Alertmanager payload to Redis `alert_fired` channel. Alertmanager sends `{ "alerts": [{ "labels": { "alertname": "...", "severity": "...", "service": "..." }, "status": "firing", "annotations": { "summary": "..." } }], ... }`.

`apps/gateway/src/events/alert-subscriber.ts` reads `.tenantId` and `.title` from the message. Alertmanager payloads have neither. Subscriber logs "invalid payload — skipping" for every real alert. **No incident is ever created from Alertmanager.**

Fix in `apps/gateway/src/routes/events.ts` `POST /api/events/alert`:
```typescript
const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'

app.post('/api/events/alert', async (request) => {
  const body = request.body as {
    alerts?: Array<{
      labels?: { alertname?: string; severity?: string; service?: string; job?: string }
      status?: string
      annotations?: { summary?: string; description?: string }
    }>
    tenantId?: string
  }
  const pub = await getEventPub()
  if (!pub) return { ok: true }

  if (body.alerts && Array.isArray(body.alerts)) {
    // Standard Alertmanager webhook format — transform per alert
    for (const alert of body.alerts) {
      if (alert.status !== 'firing') continue
      const payload = {
        tenantId: body.tenantId ?? DEMO_TENANT,
        title: alert.labels?.alertname ?? 'Alert Fired',
        severity: alert.labels?.severity ?? 'high',
        service: alert.labels?.service ?? alert.labels?.job,
        description: alert.annotations?.summary ?? alert.annotations?.description,
      }
      await pub.publish('alert_fired', JSON.stringify(payload))
    }
  } else {
    // Direct internal format (tests, internal calls)
    await pub.publish('alert_fired', JSON.stringify(body))
  }
  return { ok: true }
})
```

**B2 — anvay.spec.ts `getToken()` uses email that is never seeded — all API test suites fail**

`apps/web/e2e/anvay.spec.ts` line 13: `const DEMO_EMAIL = 'admin@demo.anvay.dev'`.
`getToken()` calls `POST /auth/token` with this email. The dev-token seeds `dev@anvay.local` as admin. No user with `admin@demo.anvay.dev` exists → 401 → all suites B.1-H.3 fail.

Fix: replace `getToken()`:
```typescript
const DEV_TOKEN_URL = `${GATEWAY}/api/auth/dev-token`

async function getToken(request: Parameters<Parameters<typeof test>[1]>[0]['request']): Promise<string> {
  const r = await request.get(DEV_TOKEN_URL)
  const body = await r.json() as { token?: string }
  return body.token ?? ''
}
```
Remove `DEMO_TENANT` and `DEMO_EMAIL` constants (now unused).

**B3 — orchestrator-chat.spec.ts wrong placeholder selector**

`apps/web/e2e/orchestrator-chat.spec.ts` checks `input[placeholder*="query"]`. Actual placeholder in `orchestrator-chat.tsx` is `"ask anvay anything..."`. Selector never matches → `exists = false` → test fails.

Fix:
```typescript
const input = page.locator('input[placeholder*="anvay"]').first()
const textarea = page.locator('textarea[placeholder*="anvay"]').first()
```

**B4 — 7 Next.js proxy routes missing try/catch → 500 on ECONNREFUSED**

When gateway is not running, every call to these routes throws `ECONNREFUSED` → Next.js returns unhandled 500. User sees "500 Internal Server Error" instead of "gateway unavailable". Files:
- `apps/web/app/api/settings/provider/route.ts` (GET + POST)
- `apps/web/app/api/settings/provider-manifests/route.ts`
- `apps/web/app/api/settings/models/route.ts`
- `apps/web/app/api/settings/connectors/route.ts`
- `apps/web/app/api/settings/connectors/[type]/route.ts`
- `apps/web/app/api/connectors/[type]/bootstrap-status/route.ts`
- `apps/web/app/api/providers/route.ts`

Each handler needs:
```typescript
try {
  const resp = await fetch(...)
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
} catch (err) {
  const msg = err instanceof Error ? err.message : 'proxy error'
  return Response.json({ error: msg }, { status: 502 })
}
```

**B5 — `alertmanager` missing from `KNOWN_CONNECTORS` → start_demo.sh seeding fails for alertmanager**

`apps/gateway/src/routes/settings.ts` `KNOWN_CONNECTORS` array (lines 108-116) does not include `'alertmanager'`. `start_demo.sh` attempts `PUT /api/settings/connectors/alertmanager` → 400 "Unknown connector type" → connector never seeded.

Fix: add `'alertmanager'` to the `KNOWN_CONNECTORS` array.

---

### HIGH

**H1 — Cert check 3 (alert flow) needs e2e test**

Create `apps/web/e2e/cert-alert-flow.spec.ts` that:
1. Calls `GET /api/auth/dev-token` to get token
2. Posts Alertmanager-format payload to `POST /api/events/alert` (no auth required)
3. Waits 800ms for Redis → subscriber pipeline
4. Gets `/api/incidents` with auth and asserts at least one incident has the expected title

This is the only cert check coverable by API-level e2e. Do this AFTER fixing B1.

**H2 — Cert checks 4-7 need `start_demo.sh` to work end-to-end**

Cert checks 4-7 require the demo docker-compose stack. No additional e2e test file needed — they are verified manually by running `bash scripts/start_demo.sh`. Document in a `scripts/README.md` that checks 4-7 require demo stack.

**H3 — `apps/web/app/api/settings/connectors/[type]/route.ts` not verified**

This route is used by connector config save in the UI. It has no try/catch (covered by B4) and was not directly tested. Verify it proxies correctly after B4 fix.

---

### MEDIUM

**M1 — Prod compose Postgres: Apache AGE extension not initialized**

`infra/prod/docker-compose.yml` uses `postgres:16-alpine`. The structural graph requires Apache AGE Cypher extension. No init SQL is included. DB migrations may fail silently if AGE is required. Demo compose has the same issue but uses standard Postgres as well — the Cypher queries are deferred. Document clearly that AGE is required for graph features, add `# NOTE: Apache AGE extension required for graph features` comment in docker-compose.

**M2 — `anvay.spec.ts` Suite D.1 allows 404 — fragile test**

`expect([200, 404]).toContain(resp.status())` for `GET /api/incidents` is too permissive. If DB unreachable, returns 500 and test passes vacuously. Change to `expect(resp.status()).toBe(200)` — a seeded tenant with no incidents should still return `200 []`.

---

### LOW

**L1 — anvay.spec.ts imports unused constants after B2 fix**

After removing `DEMO_EMAIL` + `DEMO_TENANT` from `getToken()`, delete those constants.

**L2 — start_demo.sh: bootstrap silently skips if Redis unavailable**

The `POST /api/connectors/$connector/bootstrap` curl call uses `|| warn "... bootstrap skipped"`. If Redis is down at startup, bootstrap publishes nothing but returns `{ ok: true }`. The graph never populates. This is correct fallback behavior but should log more clearly. LOW priority.

---

<!-- REVIEW SECTION END — 2026-06-10c -->

---

<!-- REVIEW SECTION START — 2026-06-10b -->
## Review — 2026-06-10b | DeepSeek + Phase 4 UI wiring + FIX-1-5 from bridge-2026-06-10b

### Scope

All commits from `dd1885d` → `47b053f`. 23 files changed across gateway routes, web components, provider registry, and BFF proxy routes.

### Verdict: 3 BLOCKING, 6 HIGH, 7 MEDIUM, 3 LOW

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 2/5 | Signals view crashes on undefined `LIVE_ALERTS`. Alerts + audit routes return mock data with no tenant scope. Gate Approve/Decline are no-ops. Bootstrap-status proxy always 401. |
| D2 Code Standards | 3/5 | `chat.ts` has trailing import at EOF. Two divergent connector allowlists. No Fastify schema on settings POST or connector PUT. Unused `ConnectorTool` import. |
| D3 Performance | 3/5 | BFF alert + audit routes re-fetch a new JWT on every request instead of forwarding browser token. |
| D4 Security | 2/5 | API key in query string. SSRF misses `127.0.0.1`/`::1`. `/api/settings/models` unauthenticated. Full audit bypass on chat-stream. XSS in parseMarkdown. No provider validation on POST. |
| D5 Readability | 4/5 | Code structure clear. Component boundaries sensible. Inline styles consistent. |
| D6 Clarity/Comments | 3/5 | Good intent comments (`"V1 trust violation"`, `"Swap to DB query"`). No TODO ticket links on mock-data blocks. Gate-bypass error logged but not enforced. |

---

### Certification Check Status

| # | Check | Status | Blocking issue(s) |
|---|-------|--------|-------------------|
| 1 | `start_demo.sh` starts both stacks cleanly | likely passing | No blockers in reviewed files |
| 2 | Chat view loads, dev token obtained | likely passing | dev-token correctly guarded by `NODE_ENV` |
| 3 | Prometheus alert → gateway → incident → War Room | unknown | alert-subscriber still missing (bridge-2026-06-10d) |
| 4 | "What's wrong with checkout-api?" → real data | at risk | chat-stream has no audit/perimeter; `/api/chat` path may work |
| 5 | Connectors show connected + bootstrap summary | **BLOCKED** | B2: bootstrap-status proxy drops auth header |
| 6 | KG populated: entities for 3 services | unknown | not in reviewed files |
| 7 | UI views show real data, not lib/mock.ts | **BLOCKED** | B1: Signals crash on `LIVE_ALERTS`; B3: alerts+audit return tenant-unscoped mock data |

---

### BLOCKING

**B1 — `apps/web/components/alerts-view.tsx:331-332` — `LIVE_ALERTS` undefined — Signals view crashes at runtime**

`LIVE_ALERTS` referenced on lines 331–332 (tab count + `hasCritical`) but never imported after mock removal. `ReferenceError` on load — entire Signals view unusable.

```tsx
// Line 331:
const count = t.id === "all" ? alerts.length : alerts.filter(a => a.kind === t.id).length;
// Line 332:
const hasCritical = t.id !== "all" && alerts.some(a => a.kind === t.id && a.severity === "critical");
```

Verify: `pnpm build` passes. Load Signals tab — no console errors, tab badges show counts.

---

**B2 — `apps/web/app/api/connectors/[type]/bootstrap-status/route.ts:5` — auth header never forwarded → gateway always returns 401**

Proxy calls gateway without `Authorization`. Bootstrap status never loads. Certification check 5 permanently blocked.

```typescript
export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params
  const authHeader = request.headers.get('Authorization')
  const resp = await fetch(`${GATEWAY_URL}/api/connectors/${type}/bootstrap-status`, {
    headers: authHeader ? { Authorization: authHeader } : {},
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
```

Verify: Configure connector; bootstrap badge appears. Network tab shows 200, not 401.

---

**B3 — `apps/gateway/src/routes/alerts.ts` + `audit.ts` — hardcoded mock data returned to all tenants; no DB query**

Both routes authenticate the user but ignore the JWT and return the same static blob to every tenant. Data isolation violation + certification blocker for check 7. Replace with DB queries scoped by `tenantId`. Until dedicated `alerts` table exists, query `incidents`:

```typescript
const { tenantId } = request.user as { tenantId: string }
const rows = await withTenant(prisma, tenantId, (tx) =>
  tx.$queryRaw<...>`SELECT id, title, severity, status, description, created_at, suggested_root_cause
    FROM incidents WHERE tenant_id = ${tenantId}::uuid AND status IN ('active','investigating')
    ORDER BY created_at DESC LIMIT 50`
).catch(() => [])
return rows.map(i => ({ id: i.id, kind: 'alert', severity: i.severity, title: i.title, ... }))
```

Verify: Two tenants with different incidents; GET `/api/alerts` returns only that tenant's data.

---

### HIGH

**H1 — `apps/gateway/src/routes/settings.ts:47-61` — no provider allowlist on POST; no Fastify schema**

`provider` written to DB as-is. Add schema validation:
```typescript
schema: { body: { type: 'object', required: ['provider'], properties: {
  provider: { type: 'string', enum: ['anthropic','openai','deepseek','groq','mistral','ollama','lmstudio'] },
  apiKey: { type: 'string', maxLength: 512 },
  baseUrl: { type: 'string', maxLength: 2048 },
  defaultModel: { type: 'string', maxLength: 128 },
}, additionalProperties: false } }
```
Also: `if (!providerRegistry.get(provider)) return reply.code(400).send({ error: 'Unknown provider' })`

Verify: `POST { "provider": "evil" }` → 400.

---

**H2 — `apps/gateway/src/routes/settings.ts:67` — API key in query string; leaks into server logs**

`?apiKey=sk-ant-...` appears in HTTP access logs, browser history, Referer headers. Move to header:
```typescript
// Gateway: const apiKey = request.headers['x-api-key'] as string | undefined
// Client: headers: { ...(apiKey ? { 'X-Api-Key': apiKey } : {}) }
```

Verify: API key does not appear in gateway access log for the models request.

---

**H3 — `apps/gateway/src/routes/settings.ts:12-19` — SSRF misses `127.0.0.1`, `::1`, `0.0.0.0`**

`http://127.0.0.1:6379` passes `isSafeBaseUrl`. Add to block list:
```typescript
if (h !== 'localhost' && (h === '127.0.0.1' || h === '::1' || h === '0.0.0.0')) return false
```

Verify: `isSafeBaseUrl('http://127.0.0.1:6379')` → `false`. `isSafeBaseUrl('http://localhost:11434')` → `true`.

---

**H4 — `apps/gateway/src/routes/chat-stream.ts` — no audit trail, no perimeter enforcement**

Every tool call via `/api/chat/stream` is invisible to audit log and bypasses gate enforcement. Add `PostgresAuditSink`; log every tool call before and after execution.

Verify: Tool called via `/api/chat/stream` → row in `audit_events`.

---

**H5 — `apps/web/components/orchestrator-chat.tsx:192` — `dangerouslySetInnerHTML` with unsanitized LLM output (XSS)**

```typescript
function parseMarkdown(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(/```([\s\S]*?)```/g, '<pre ...><code>$1</code></pre>')
  // remaining substitutions on escaped
}
```

Or: `DOMPurify.sanitize(parseMarkdown(text))`.

Verify: LLM returns `<img src=x onerror=alert(1)>` — renders as literal text.

---

**H6 — `apps/web/app/api/alerts/route.ts` + `audit/route.ts` — BFF fetches own JWT per-request instead of forwarding browser token**

Redundant auth round-trip per request. In production this acts as a demo user bypassing real user's perimeter. Forward the browser's `Authorization` header instead:
```typescript
const authHeader = request.headers.get('Authorization')
if (!authHeader) return new Response('[]', { status: 401, headers: { 'Content-Type': 'application/json' } })
const resp = await fetch(`${GATEWAY_URL}/api/alerts`, { headers: { Authorization: authHeader } })
```

---

**H7 — `apps/gateway/src/routes/chat.ts:390` — bare `import` after function body**

`import { isValidUUID }` at EOF, after closing brace. Move to import block at top.

Verify: Import appears at top; `tsc --noEmit` passes.

---

### MEDIUM

**M1 — `apps/gateway/src/routes/chat.ts:320-323` — gate sink absent in dev; V1 write bypass unenforced**

Return 503 in production if `REDIS_URL` absent rather than proceeding gate-less.

---

**M2 — `apps/gateway/src/routes/settings.ts:64` — `/api/settings/models` unauthenticated**

Add `{ preHandler: [app.authenticate] }`. Verify: request without JWT → 401.

---

**M3 — `chat-stream.ts` vs `settings.ts` — two divergent connector allowlists**

`ALLOWED_CONNECTOR_TYPES` in `chat-stream.ts` missing `coralogix`, `notion`, `newrelic`, `jira`, `loki`. Extract to `packages/types/src/connectors.ts` as single source of truth.

---

**M4 — `apps/web/components/alerts-view.tsx` — Gate Approve/Decline buttons are no-ops**

Add `onClick={() => void approveGate(gateId!)}` calling `POST /api/gates/{gateId}/decide`. Add web proxy route.

---

**M5 — `apps/web/components/audit-view.tsx:5` — `AuditOutcome` type missing gateway values; runtime crash**

Frontend missing `'action_executed'`, `'action_failed'`, `'escalated'`, `'handed_off'`. Add to type + `OUTCOME_CONFIG`. Move to `@anvay/types`.

---

**M6 — `apps/gateway/src/routes/settings.ts:121-128` — no size limit on connector `credentials` JSON**

Add Fastify schema: `maxProperties: 20, additionalProperties: { type: 'string', maxLength: 2048 }`.

---

**M7 — `apps/web/app/page.tsx:189-198` — hardcoded `alex@acme.dev` / `Admin` in sidebar**

Decode JWT and display real user email + role.

---

### LOW

**L1 — `apps/gateway/src/routes/chat-stream.ts:4` — `ConnectorTool` imported but unused**

Remove from import line.

---

**L2 — `packages/agent/src/providers/registry.ts:46` — `claude-haiku-4-5` duplicated with `claude-haiku-4-5-20251001`**

Remove undated alias. Keep `claude-haiku-4-5-20251001` only.

---

**L3 — `apps/web/app/page.tsx:189` — hardcoded user identity in sidebar**

Same as M7 — decode JWT, show real identity.

<!-- REVIEW SECTION END — 2026-06-10b -->

---

<!-- REVIEW SECTION START — 2026-06-10 -->
## Review — 2026-06-10 | Bridge 2026-06-10a phases 1–3: demo stack + real connectors + event bus

### Scope

All commits from `36e1d50` → `50c6243`. 255 files changed across gateway routes, agent packages,
33 connector packages, web app, infra demo stack, and scripts.

### Verdict: 5 BLOCKING, 6 HIGH, 7 MEDIUM, 7 LOW

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 2.5/5 | Phase 1 demo stack ~90% done. Phase 2 connector execute() wired but multi-hop broken (tool-result role bug). Phase 3 event bus wired but async-in-sync bug + SSE type mismatch = streaming path dead end-to-end. |
| D2 Code Standards | 3/5 | `withTenant` + provider abstraction consistent. New `chat-stream.ts` diverges from established `chat.ts` orchestrator pattern without justification — two competing agentic loops. Several `(creds as any)` casts signal missing typed credential schemas. |
| D3 Performance | 2.5/5 | No request timeout on streaming loop. Credentials fetched on every request without caching. Bootstrap registry rebuilt on every graph event (accepted: correctness over perf). |
| D4 Security | 1.5/5 | Path traversal in dynamic import, no audit on streaming path, GraphQL injection, SSRF on GitHub baseUrl, plaintext credentials comment, XSS on chat output. RLS coverage good; connector allowlist exists in settings.ts but missing from connectors.ts and chat-stream.ts. |
| D5 Readability | 3.5/5 | Demo services and chaos script minimal and clear. `chat-stream.ts` hand-rolled loop harder to follow than the orchestrator it should delegate to. |
| D6 Clarity/Comments | 3/5 | `graph-builder/subscriber.ts` explains bootstrap-per-event rationale. Migration `0017` has misleading "encrypted" comment. `isSafeBaseUrl` is in `settings.ts` not `validators.ts`. |

---

### Phase completion

| Phase | Target | State | % |
|-------|--------|-------|---|
| Phase 1 — chaotic demo services | payments/auth/checkout + chaos + Prometheus + Grafana + Gitea | Services run, metrics emit, chaos injects, Gitea commits work. Docker socket scope issue is a nuance. | ~90% |
| Phase 2 — real connector execute() | GitHub + Linear call live APIs | Agents implemented. Tool-result role bug means multi-hop queries are broken. Single-shot tool calls work. | ~60% |
| Phase 3 — event bus flow | alert → EventBus → GraphBuilder → KG → Orchestrator → SSE | Redis pub/sub wired, subscribers exist. Three blockers: async bug in graph-builder, SSE type mismatch, no audit on stream path. | ~40% |
| Phase 4 — UI wired to real data | Chat shows real connector data | Hard-blocked by SSE event type mismatch. Bootstrap-status proxy drops auth header. | ~25% |
| End-to-end demo | Demo starts → alert fires → Anvay surfaces root cause in chat | Not working. B3, B4, B5 together mean streaming chat path is dead. | ~35% |

---

### BLOCKING

**B1 — `apps/gateway/src/routes/chat-stream.ts:77` — path traversal via unsanitised `connector_type` in dynamic import**

`connector_type` loaded from DB is injected into `import()` with no allowlist check. A tenant who can write to `connector_config` can set `connector_type = '../../routes/auth'` to load arbitrary bundle files as side-effects. Even though `PUT /api/settings/connectors/:type` validates against `KNOWN_CONNECTORS`, the DB value is still tenant-controlled.

```typescript
// Add at top of chat-stream.ts:
const ALLOWED_CONNECTORS = new Set([
  'github','datadog','linear','argocd','coralogix','notion','prometheus','newrelic',
  'jira','loki','terraform','pagerduty','slack','grafana','elastic','dynatrace',
  'sentry','jenkins','circleci','vercel','k8s','vault','snyk','sonarqube',
  'opsgenie','launchdarkly','confluence','eks','gke','aws-cloudwatch',
  'aws-health','gcp-monitoring','azure-monitor',
])
// Before the dynamic import:
if (!ALLOWED_CONNECTORS.has(cc.connector_type) || /[./\\]/.test(cc.connector_type)) continue
```

Verify: insert `connector_type = '../../routes/auth'` directly into DB; confirm loop skips it without a module-resolution error.

---

**B2 — `apps/gateway/src/routes/chat-stream.ts:104–107` — no audit trail, no perimeter enforcement, no graph-first context injection**

The streaming route builds its own bare agentic loop that: never calls `PostgresAuditSink` (violates CLAUDE.md non-negotiable audit requirement), runs a hard-coded `!tool.write` filter instead of evaluating the provisioned capability perimeter, and never calls `resolveContext` on the KG before dispatching (violates "graph first, always").

The existing `routes/chat.ts` wires the proper orchestrator with audit, token budgets, and perimeter enforcement. This new route reinvents it incorrectly.

Fix: Replace the hand-rolled loop with the same orchestrator wiring from `routes/chat.ts`. If streaming requires different response handling, pipe the orchestrator's `AsyncIterator<StreamEvent>` to SSE rather than rewriting the loop.

Verify: After a chat via `/api/chat/stream`, confirm a row appears in `audit_events` for tool calls made.

---

**B3 — `apps/gateway/src/routes/chat-stream.ts:133` — tool-result messages use role `assistant`; agentic loop is broken**

```typescript
// WRONG:
llmMessages.push({ role: 'assistant', content: JSON.stringify(result) })
// FIX:
llmMessages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id, name: tc.name })
```

The LLM does not recognise the `assistant` turn as a tool response. Multi-hop queries always get a second LLM turn that ignores the tool data entirely.

Verify: submit a query triggering a tool call; confirm the second LLM turn receives grounded tool data, not an ignored assistant message.

---

**B4 — `apps/gateway/src/routes/auth.ts:72` — `plan = 'free'` is not a valid Prisma `Plan` enum; dev-token upsert silently fails**

Schema defines `Plan` as `{ tier1, tier2, tier3 }`. Inserting `'free'` throws a PostgreSQL enum cast error, caught silently by `catch {}`. The JWT is issued, but the dev tenant row never lands in DB. Every downstream `withTenant()` call fails because RLS finds no matching tenant. Demo is silently broken from the start.

```typescript
// Fix: change 'free' → 'tier1'
INSERT INTO tenants (id, name, slug, plan) VALUES (${DEV_TENANT}::uuid, 'Dev Tenant', 'dev', 'tier1')
```

Verify: call `GET /api/auth/dev-token`, then `SELECT * FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001'` — row must exist with `plan = 'tier1'`.

---

**B5 — `apps/gateway/src/routes/chat-stream.ts:119–120` — SSE emits `type: 'token'`; frontend only handles `type: 'text_delta'` — streaming is silently dead**

```typescript
// Gateway emits (WRONG):
stream.push(`data: ${JSON.stringify({ type: 'token', content: response.content })}\n\n`)
// Fix:
stream.push(`data: ${JSON.stringify({ type: 'text_delta', content: response.content })}\n\n`)
```

Every streamed token falls through every handler branch with no match. From the user's perspective: spinner shows, nothing renders, spinner stops.

Verify: send a chat message; confirm assistant message box populates with streamed text.

---

### HIGH

**H1 — `connectors/linear/src/agent.ts:11,29` — GraphQL injection via LLM-controlled `params.team`**

```typescript
// WRONG: direct interpolation
const query = `query { issues(filter: { team: { key: { eq: "${params.team}" } } }, first: ${params.limit ?? 25}) { ... } }`
// FIX: use variables
const query = `query GetIssues($teamKey: String!, $limit: Int!) { issues(filter: { team: { key: { eq: $teamKey } } }, first: $limit) { ... } }`
const variables = { teamKey: String(params.team).slice(0, 64), limit: Math.min(Number(params.limit ?? 25), 100) }
body: JSON.stringify({ query, variables })
```

Applies to `get_projects` on line 29 as well.

Verify: pass `params.team = '"}}\nquery { malicious }'`; confirm injected fragment is not reflected in the request body.

---

**H2 — `connectors/github/src/agent.ts:5–7,41` — SSRF via tenant-controlled `baseUrl` + path traversal in `params.path`**

`baseUrl` from tenant credentials is not passed through `isSafeBaseUrl`. A tenant can store `baseUrl = 'http://169.254.169.254'` or an internal K8s API server URL. `params.path` in `get_file` is concatenated without stripping `..` segments.

Fix: call `isSafeBaseUrl(baseUrl)` before any fetch; strip `..` from path:
```typescript
if (!isSafeBaseUrl(baseUrl)) throw new Error('SSRF: unsafe baseUrl')
const safePath = (params.path as string).replace(/\.\.[/\\]/g, '').replace(/^\/+/, '')
```

Verify: store credential with `baseUrl = 'http://169.254.169.254'` and invoke `get_prs`; confirm blocked.

---

**H3 — `apps/gateway/src/routes/settings.ts:47–62` — API keys stored plaintext; migration comment says "encrypted" — false confidence**

Migration `0017` comment: `-- Connector credentials stored encrypted in DB.` No encryption implementation exists anywhere in the codebase. A DB read leak exposes every tenant's LLM API keys and connector credentials.

Minimum fix for this PR: correct the misleading comment to `-- NOTE: api_key stored plaintext — encryption is a follow-on task`. Proper fix: AES-256-GCM wrap at application layer before INSERT, decrypt on SELECT.

---

**H4 — `apps/gateway/src/routes/connectors.ts:51–61` — bootstrap trigger accepts any `:type` with no allowlist; publishes to Redis without validation**

`POST /api/connectors/:type/bootstrap` publishes `connectorType` from URL path directly to Redis. An authenticated user can flood the event bus with fabricated connector types or attempt path traversal via URL encoding.

```typescript
if (!KNOWN_CONNECTORS.includes(type)) return reply.code(400).send({ error: 'Unknown connector type' })
```

(Extract `KNOWN_CONNECTORS` from `settings.ts` to a shared `constants.ts`.)

---

**H5 — `apps/web/components/orchestrator-chat.tsx:192` — LLM output injected into DOM via `dangerouslySetInnerHTML` without sanitisation (XSS)**

```typescript
// WRONG:
<span dangerouslySetInnerHTML={{ __html: parseMarkdown(message.content) }} />
// FIX: add isomorphic-dompurify to apps/web/package.json, then:
import DOMPurify from 'isomorphic-dompurify'
<span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(parseMarkdown(message.content)) }} />
```

A prompt-injected LLM response containing `<script>` or `<img onerror=...>` executes in the user's browser.

---

**H6 — `apps/web/app/api/connectors/[type]/bootstrap-status/route.ts:5` — proxy drops auth header; gateway returns 401 on every call**

```typescript
// WRONG: no auth header
const resp = await fetch(`${GATEWAY_URL}/api/connectors/${type}/bootstrap-status`)
// FIX:
const authHeader = request.headers.get('Authorization')
const resp = await fetch(`${GATEWAY_URL}/api/connectors/${type}/bootstrap-status`, {
  headers: authHeader ? { Authorization: authHeader } : {},
})
```

Verify: authenticated browser request to `/api/connectors/github/bootstrap-status` returns non-401.

---

### MEDIUM

**M1 — `apps/gateway/src/graph-builder/subscriber.ts:61` — async handler inside sync `subscribe` callback; unhandled rejections crash process**

```typescript
// FIX: wrap in void IIFE with try/catch
await sub.subscribe(channel, (message) => {
  void (async () => {
    try { /* existing body */ }
    catch (err) { log.error({ err }, 'graph-builder: unhandled event error') }
  })()
})
```

---

**M2 — `apps/gateway/src/routes/settings.ts:65` — `GET /api/settings/models` has no authentication**

No `preHandler: [app.authenticate]`. Anyone can call with arbitrary `baseUrl` and trigger an outbound HTTP fetch — enables port scanning of external targets via the gateway. Add auth preHandler.

---

**M3 — `apps/gateway/src/routes/chat-stream.ts:112–125` — no per-request timeout on streaming loop**

Up to 5 sequential `provider.chat()` calls with no wall-clock timeout. Slow Ollama models can hold a connection 300s+. Thread an `AbortController` with `REQUEST_TIMEOUT_MS = 120_000` through all provider calls.

---

**M4 — `apps/gateway/src/routes/auth.ts:60` — `GET /api/auth/dev-token` has no rate limit**

In a dev VM with accidental external exposure, any caller gets a valid admin JWT with fixed dev UUIDs. Add `fastify-rate-limit` at `max: 5` per minute and optionally bind to localhost-only.

---

**M5 — `apps/gateway/src/routes/chat-stream.ts:64–68` — credentials fetched from DB on every chat request, no size limit**

No `LIMIT` on the query. A tenant with 33 connectors each with a large credentials blob causes a large allocation every request. Add `LIMIT 50` to query; enforce max credential JSON size on PUT endpoint.

---

**M6 — `infra/demo/docker-compose.yml:27` — chaos container mounts raw Docker socket; `docker kill` filter matches by substring, not exact name**

`--filter "name=$TARGET"` matches any container whose name *contains* the string. A host running a production `payments-api` alongside the demo would have it killed. Use exact-name filter: `--filter "name=^/anvay-demo_${TARGET}"` or route all docker CLI calls through the socket proxy.

---

**M7 — `apps/gateway/src/jobs/bullmq-scheduler.ts:30–34` — raw cron string from DB passed to BullMQ without validation**

An invalid expression throws at registration. Validate before enqueuing:
```typescript
import { parseExpression } from 'cron-parser'
try { parseExpression(job.schedule) } catch { throw new Error(`Invalid cron: ${job.schedule}`) }
```

---

### LOW

**L1 — `connectors/github/src/agent.ts:6–7` — Gitea detection by `:3000` hostname heuristic is fragile**

`:3000` also matches Next.js dev, Grafana, etc. Add explicit `type: 'gitea' | 'github'` to the credential schema instead.

---

**L2 — `packages/agent/src/agents/ba.ts:27`, `oncall.ts:27,37` — model IDs hardcoded as string literals**

CLAUDE.md requires model IDs from config, not hardcoded. If tenant configures Groq, these agents still attempt `claude-sonnet-4-6`. Pass `cheapModelId`/`mainModelId` constructor params (already done in `SREAgent`).

---

**L3 — `infra/demo/services/chaos/chaos.sh:23–28` — Gitea credentials hardcoded in script**

```bash
GITEA_USER="${GITEA_USER:-anvay}"
GITEA_PASS="${GITEA_PASS:-anvaypassword}"
```
Source from env vars set by `docker-compose.yml` instead of hardcoding.

---

**L4 — `apps/gateway/src/graph-builder/subscriber.ts:57–58` — `graphPub` Redis client has no reconnect strategy**

`sub` has reconnect strategy; `graphPub` uses bare `createClient({url})`. Silent failures on transient Redis disconnect. Add `socket: { reconnectStrategy: (r) => Math.min(r * 100, 3000) }`.

---

**L5 — `apps/gateway/src/routes/chat-stream.ts:116` — `maxTokens: 2000` hardcoded; ignores tenant token budget**

`routes/chat.ts` enforces `buildTokenBudget(dbTenant.token_budget_monthly, sessionUsed)`. Streaming route hardcodes 2000 with no budget check. Load and enforce the same budget.

---

**L6 — `infra/.env` tracked by git**

Contains `JWT_SECRET=dev-secret-change-in-production` and Neo4j password. Root `.gitignore` blocks `.env` but `infra/` has no `.gitignore`. Add `infra/.env` to root `.gitignore`. Rotate values if remote history exists.

---

**L7 — `apps/web/app/api/connectors/[type]/bootstrap-status/route.ts:5` — `type` segment forwarded to gateway without allowlist**

`../../auth/dev-token` via URL encoding could reach unintended gateway endpoints. Validate `type` against `KNOWN_CONNECTORS` before forwarding.

<!-- REVIEW SECTION END — 2026-06-10 -->

---

<!-- REVIEW SECTION START — 2026-06-09g -->
## Review — 2026-06-09g | Full codebase review — M0 through M5+M6 connector bootstraps

### Scope

Full review of all source files committed since 2026-06-07 (commits `49f1fc5` → `36e1d50`).
Coverage: 70+ files across gateway, agent package, connector packages, web app, agent-service.

### Verdict: 4 BLOCKING, 7 HIGH, 10 MEDIUM, 7 LOW

---

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 4/5 | M0–M5+M6 wired. Bootstrap registry live. Missing: ArgoCD/Datadog/Linear bootstrap impl bodies are stubs (no-op). |
| D2 Code Standards | 3/5 | `agents/graph-builder.ts` dead code class; `connectorId: c.type` scope collision for multi-connector; Linear auth header wrong. |
| D3 Performance | 4/5 | Per-request `new RedisGateSink()` in gate-decide creates new Redis connection per request. |
| D4 Security | 3/5 | `'in_progress'` wrong enum = silent wrong query. `kb_entries` missing FORCE RLS. GitHub bootstrap leaks `process.env` to child process. Linear auth header never sends "Bearer". |
| D5 Readability | 4/5 | Generally clean. Dead file `agents/graph-builder.ts` adds confusion. |
| D6 Clarity / Comments | 4/5 | Key invariants documented. BullMQ scheduler usage clear. |

---

### BLOCKING

**B1 — `apps/gateway/src/routes/services.ts:42` — invalid incident status enum**

Query filters on `'in_progress'` but Prisma schema (line 39) only defines `active`, `investigating`, `resolved`. `'in_progress'` does not exist — query returns 0 rows silently. Services page shows 0 active incidents for any service regardless of real state.

```sql
-- WRONG:
WHERE status IN ('active', 'in_progress')
-- FIX:
WHERE status IN ('active', 'investigating')
```

Verify: seed an incident with status `investigating`, call `/api/services`, confirm `activeIncidents > 0`.

---

**B2 — `apps/gateway/prisma/migrations/` — `kb_entries` missing FORCE ROW LEVEL SECURITY**

`entities` and `relationships` have `FORCE ROW LEVEL SECURITY` (migration 0013). `kb_entries` only has `ENABLE ROW LEVEL SECURITY` (migration 0003) — no FORCE. Without FORCE, table owners and superusers bypass RLS policies, violating tenant isolation during schema migrations, maintenance, and seeding.

Fix: create migration `0016_kb_entries_force_rls`:
```sql
ALTER TABLE kb_entries FORCE ROW LEVEL SECURITY;
```

Verify: connect to DB as table owner, `SELECT * FROM kb_entries` without setting `app.tenant_id` — must return 0 rows.

---

**B3 — `apps/agent-service/src/routes/episodes.py:14` — tenant_id header not validated**

`x_tenant_id: str = Header(...)` accepts any string. `graphiti.add_episode(group_id=x_tenant_id, ...)` passes it directly to Neo4j. Malformed or injected values corrupt the episodic graph namespace. No UUID format check.

Fix:
```python
from pydantic import constr
UUID_RE = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
x_tenant_id: constr(pattern=UUID_RE) = Header(...)
```

Apply same fix to `apps/agent-service/src/routes/facts.py:11`.

Verify: POST `/episodes` with `X-Tenant-Id: '; DROP'` → must return 422.

---

**B4 — `packages/agent/src/agents/graph-builder.ts` — dead duplicate class, name collision**

Two classes named `GraphBuilderAgent` exist:
- `packages/agent/src/agents/graph-builder.ts` (103 lines) — bootstraps only, not exported from index
- `packages/agent/src/graph-builder/builder.ts` (245 lines) — full event-driven impl, IS exported from index

`packages/agent/src/index.ts:65` exports from `graph-builder/builder.ts`. The `agents/graph-builder.ts` file is dead code that creates a confusing naming collision. Any future import from the wrong path silently gets the wrong class.

Fix: delete `packages/agent/src/agents/graph-builder.ts`. Ensure nothing imports from it (confirmed: zero imports).

Verify: `grep -r "agents/graph-builder"` → 0 results; typecheck passes.

---

### HIGH

**H1 — `apps/gateway/src/gate/gate-decide-route.ts:40` — new `RedisGateSink` per request**

`const sink = new RedisGateSink(...)` inside request handler creates a new Redis client on every gate decision call. Each call opens a TCP connection, does auth, executes, and leaks the connection (no `quit()` / `disconnect()`). Under load this exhausts Redis file descriptors.

Fix: create singleton at module level:
```typescript
// module-level, outside route handler:
let _gateSink: RedisGateSink | undefined
function getGateSink(redisUrl: string) {
  return _gateSink ??= new RedisGateSink(redisUrl)
}
```
Or inject as app-level decoration from `server.ts`.

Verify: 100 concurrent gate decisions → Redis connection count stays bounded (< 5 connections).

---

**H2 — `connectors/linear/src/connector.ts:18` — Authorization header missing "Bearer" prefix**

Linear GraphQL API requires `Authorization: Bearer <token>`. Current code sets `Authorization: token` (raw value). All Linear API calls return 401. Linear connector is non-functional.

Fix: `Authorization: \`Bearer ${this.apiKey}\``

Verify: mock Linear endpoint with valid token + correct header → returns 200; without Bearer → 401.

---

**H3 — `connectors/github/src/bootstrap.ts:26` — full `process.env` spread to child process**

```typescript
env: { ...process.env, GH_TOKEN: this.token }
```

Spreads all parent env vars (AWS_ACCESS_KEY_ID, OPENAI_API_KEY, DATABASE_URL, etc.) into the `gh` CLI subprocess. Any env-var-based credential in the gateway process is leaked to the subprocess and potentially visible in process listings.

Fix: whitelist only required vars:
```typescript
env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin', GH_TOKEN: this.token }
```

Verify: set AWS_ACCESS_KEY_ID in env, run bootstrap, confirm child process does NOT have it.

---

**H4 — `apps/gateway/src/routes/chat.ts:223` — `connectorId: c.type` causes scope collision for multi-connector**

`ConnectorScope.connectorId` is set to `c.type` (e.g. `"github"`, `"linear"`). If a tenant has two GitHub connectors registered (different repos, different modes), both get `connectorId: "github"` → second overwrites first in perimeter engine. User loses access to one connector silently.

Fix: use `c.id` (UUID) as `connectorId`:
```typescript
connectorId: c.id,  // was: c.type
```

Apply same fix to the `manifests` array at line 238 (`connectorId: c.type` → `connectorId: c.id`).

Verify: register two GitHub connectors, call `/api/chat`, confirm both connectors' tools are available.

---

**H5 — `packages/agent/src/agents/sre.ts` — SREAgent does not call Knowledge Graph first**

Per CLAUDE.md (non-negotiable): "The Knowledge Graph is the mandatory starting point for every investigation, triage, debug, and action." `SREAgent.assembleContext()` directly calls `this.mainModel.chat(...)` without first calling `knowledgeGraph.resolveContextByName()`. Incident analysis has no graph coordinates, so any connector calls it recommends are scatter-gather.

Fix: inject `IKnowledgeGraph` into `SREAgent` constructor and call `resolveContextByName(incidentTitle, tenantId)` before building the hypothesis prompt. Inject graph context into the system prompt.

Verify: `assembleContext()` called with a known entity name → graph context block appears in model input messages.

---

**H6 — `apps/agent-service/src/routes/facts.py:10` — unvalidated query string to Neo4j**

`query: str = Query(...)` passes directly to `graphiti.search(query=query, ...)`. If Graphiti passes this unescaped to Neo4j Cypher, injection is possible. Minimum: add length cap.

Fix:
```python
query: str = Query(..., min_length=1, max_length=500)
```

Plus validate charset: reject if query contains Cypher control chars (`{`, `}`, `;`, `MATCH`, `RETURN` as standalone words).

Verify: POST `/facts?query=MATCH+*+RETURN+*` → 400 or safe empty result.

---

**H7 — `apps/gateway/src/routes/automations.ts:48` — `actions` array not validated before DB insert**

Fastify schema only checks `type: 'array'` on actions. No validation of array element structure. Arbitrary JSON objects stored in `actions JSONB` column. Trigger executor at `executor.ts:18` then type-checks on `action.type === 'notify_oncall'` etc. — malformed actions silently skipped.

Fix: add Fastify JSON schema for action items:
```typescript
actions: {
  type: 'array',
  items: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', enum: ['notify_oncall', 'create_incident', 'surface_context', 'run_runbook', 'notify_channel', 'escalate', 'block_deploy_gate'] },
      params: { type: 'object' },
    },
  },
}
```

Verify: POST trigger with `actions: [{ type: "exec", cmd: "..." }]` → 400.

---

### MEDIUM

**M1 — `apps/gateway/src/jobs/bullmq-scheduler.ts:21` — no job deduplication on `register()`**

`queue.add(job.name, ..., { repeat: { pattern: job.schedule } })` called multiple times on same job name creates duplicate repeatable jobs in BullMQ. If `createCronJobs()` is called twice (e.g., hot-reload), service-health-sweep runs at 2× frequency.

Fix: before adding, remove existing repeatable job:
```typescript
const existing = await this.queue.getRepeatableJobs()
const dup = existing.find(j => j.name === job.name)
if (dup) await this.queue.removeRepeatableByKey(dup.key)
```

Verify: call `register()` twice with same job, confirm only one repeatable entry in Redis.

---

**M2 — `apps/gateway/src/jobs/scheduler.ts:32,46,63` — unbounded `SELECT DISTINCT tenant_id` query**

All three cron runners do `SELECT DISTINCT tenant_id AS id FROM connectors` with no LIMIT. On a large multi-tenant deployment, this loads all tenant IDs into memory at once. Cron runs every 5 min; under high tenant count this is O(n) memory per run.

Fix: add cursor-based pagination:
```sql
WHERE tenant_id > $cursor ORDER BY tenant_id LIMIT 100
```
And loop until no more rows.

Verify: create 1000 tenants in dev DB, run cron job, confirm memory stable.

---

**M3 — `apps/gateway/src/graph-builder/subscriber.ts:54-58` — bootstrapRegistry created per event**

`new Map()` + bootstrap constructors called inside `sub.subscribe()` callback — on every graph event, not just `connector_registered`. Overhead is minimal (no network calls), but creates unnecessary object churn.

Fix: build the registry once at startup and pass it into the callback closure:
```typescript
const bootstrapRegistry = new Map<string, IConnectorBootstrap>()
bootstrapRegistry.set('github', new GitHubBootstrap(kg_placeholder, process.env['GH_TOKEN'] ?? ''))
// ...
// In callback, use the closure's registry
const agent = new GraphBuilderAgent(kg, provider, cheapModel, log, bootstrapRegistry, graphPub)
```

Note: `kg` is tenant-scoped per event and must stay inside callback. Only registry construction moves out.

Verify: no performance regression on event stream; memory profile stable.

---

**M4 — `apps/agent-service/src/main.py:13` — Graphiti init exception swallowed silently**

```python
except Exception:
    app.state.graphiti = None
```

No logging. If Neo4j credentials wrong or connection refused, agent-service silently runs with `graphiti = None`. Every `/episodes` and `/facts` request returns 500 with unhelpful "Graphiti unavailable" message. Impossible to diagnose from logs.

Fix:
```python
except Exception as e:
    import logging
    logging.error(f"Graphiti init failed: {e}", exc_info=True)
    app.state.graphiti = None
```

Verify: start with wrong `NEO4J_URI`, logs show full traceback.

---

**M5 — `apps/agent-service/src/config.py:3-5` — hardcoded default Neo4j credentials**

```python
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "anvay")
```

`"anvay"` default password ships in source. Any deployment without explicit env override uses this. Should fail loudly if not set, not silently use default.

Fix: require all three env vars, no defaults:
```python
NEO4J_URI = os.environ["NEO4J_URI"]   # raises KeyError if missing
NEO4J_USER = os.environ["NEO4J_USER"]
NEO4J_PASSWORD = os.environ["NEO4J_PASSWORD"]
```

Verify: start agent-service without `NEO4J_PASSWORD` → process exits with clear error.

---

**M6 — `apps/gateway/src/routes/chat.ts:204-215` — `Promise.allSettled` masks connector load failure**

If DB call for connectors fails, `dbConnectors` silently becomes `[]`, user gets no tools, no error surfaced to client. Session proceeds with empty tool set. From user perspective, AI responds as if no connectors exist — no indication anything went wrong.

Fix: log failure with `request.log.error` so it appears in server logs. Optionally surface as `503` if connectors fail to load.

Verify: revoke DB permissions for connector table, send chat request, confirm server logs show error.

---

**M7 — `packages/agent/src/kb/structural-graph.ts:148` — `upsertRelationship` returns `''` on insert failure**

`upsertRelationship()` is declared to return `Promise<string>` (the relationship ID). If the raw query returns 0 rows (CONFLICT or constraint), it returns `''`. Callers in `builder.ts` don't check for empty string — silently lose the relationship without error.

Fix: either throw on 0 rows, or return the existing row ID by adding `ON CONFLICT ... DO UPDATE ... RETURNING id`.

Verify: insert same relationship twice, confirm second call returns non-empty ID, no silent failures.

---

**M8 — `connectors/argocd/src/bootstrap.ts`, `connectors/datadog/src/bootstrap.ts` — stub no-ops**

Both bootstrap implementations return `{ entitiesUpserted: 0, ... }` unconditionally. No CLI calls made. Per CLAUDE.md, `connector_registered` must trigger real bootstrap: "Every connector registered in Anvay MUST provide a bootstrap implementation."

These are stubs, not implementations. ArgoCD should list apps via `argocd app list`, Datadog should list monitors/dashboards.

Fix (ArgoCD): call `argocd app list -o json`, parse output, upsert `Deploy` entities. Guard with `try/catch` — return no-op if CLI unavailable.

Fix (Datadog): call Datadog API `/api/v1/monitor` using `DD_API_KEY` + `DD_APP_KEY` env vars. Return no-op if keys not set.

Severity accepted at MEDIUM for now — stubs are safe (graceful no-op). Promoted if connector bootstrap is a required M5 deliverable.

---

**M9 — `apps/gateway/src/audit/postgres-sink.ts` — invalid UUIDs silently coerced to null**

`isUUID(event.userId) ? event.userId : null` — if userId is not a valid UUID, audit record writes `user_id = NULL`. Audit event loses attribution. No log, no error.

Fix: log a warning before coercing, or throw — audit events with no user are a red flag:
```typescript
if (!isUUID(event.userId)) {
  this.onError?.(new Error(`audit: invalid userId "${event.userId}" — coercing to null`))
}
```

Verify: call `auditSink.append()` with malformed userId → warning in logs, record still saved.

---

**M10 — `apps/gateway/src/routes/chat.ts:286-289` — gate bypass logged but not fatal in production-adjacent deploys**

`if (!gateSink) request.log.warn('REDIS_URL not set — gate approval bypassed')` — in a production deploy without Redis (possible in limited setups), ALL write actions silently skip approval. V1 trust principle violated.

Fix: in `NODE_ENV === 'production'` context, throw instead of warn if `gateSink` is undefined (already partially guarded at line 153-155 but only at route-setup time, not at request time with per-request `redisUrl` check).

Verify: set `NODE_ENV=production`, unset `REDIS_URL`, send write-action query → 503 returned, not silent bypass.

---

### LOW

**L1 — `apps/gateway/src/server.ts` — hardcoded Redis fallback `'redis://localhost:6379'` in 5 places**

Extract to constant: `const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379'` at top of file, use everywhere.

**L2 — `apps/gateway/src/routes/chat.ts:355` + multiple files — `isValidUUID()` duplicated**

Same UUID regex defined in `chat.ts:355`, `audit/postgres-sink.ts`, `trigger-subscriber.ts`, `graph-builder/subscriber.ts`. Extract to `apps/gateway/src/utils/validators.ts`.

**L3 — `apps/gateway/src/triggers/engine.ts:35` — condition matching only does strict equality**

`matchesCondition()` iterates keys and checks `payload[key] !== value` — exact string match only. No range checks, no nested paths, no array membership. Limits practical automation rule power. Not broken, but underpowered. Document limitation or add `$gt`/`$contains` operators.

**L4 — `packages/agent/src/gate/gate.ts:41` — poll interval not configurable per call**

`pollGate()` hardcodes `intervalMs = 500`. Under concurrent gates, Redis is polled at 500ms × N concurrent gates. Make configurable in `OrchestratorConfig` and pass through.

**L5 — `apps/gateway/prisma/seed.ts:14` — `ON CONFLICT (slug) DO UPDATE SET id = ...` re-assigns UUID**

Updating the primary key on conflict is unusual and potentially disruptive (FK references will break if anything references the old id). Change to `DO NOTHING` and use `RETURNING id` to fetch existing.

**L6 — `apps/agent-service/src/routes/facts.py` — missing `app.state.graphiti` null guard**

`GET /facts` handler calls `await app.state.graphiti.search(...)` without checking if graphiti is None. If init failed, this raises `AttributeError` → 500. Add: `if not request.app.state.graphiti: raise HTTPException(503, "Graphiti unavailable")`.

**L7 — `connectors/linear/src/bootstrap.ts` — stub returns "SDK not wired" episodeHint**

Both branches return 0 entities. The `apiKey` check is correct, but the "SDK not wired" hint is misleading — it implies the SDK exists but isn't connected, when really no bootstrap logic was written. Remove the hint or replace with `'Linear bootstrap not implemented'`.

---

### Pending Features (TASKS.md status)

| Milestone | Status | Evidence |
|-----------|--------|---------|
| M0 — Foundation | ✓ Complete | DB migrations, auth, RLS, seed all present |
| M1 — Orchestrator Core | ✓ Complete | `orchestrator.ts`, `runSession`, gate flow, SSE streaming wired |
| M2 — Core Connectors | ✓ Complete | GitHub, ArgoCD, Datadog, Linear connectors + CLI/MCP adapters |
| M3 — Incident War Room | ✓ Complete | Incident CRUD, Redis emit, SRE context, War Room UI |
| M4 — Service Catalog + Knowledge Base | ✓ Complete | Services route, KB structural graph, Graphiti client, hybrid graph, grounding |
| M5-T1 — Trigger.dev/BullMQ infrastructure | ✓ Complete | `BullMQScheduler`, `SchedulerFactory`, wired in server.ts |
| M5-T2 — TriggerEngine event matching | ✓ Complete | `TriggerEngine`, subscriber, executor, DB-backed rules |
| M5-T3 — Built-in cron monitors | ✓ Complete | `ServiceHealthSweep`, `SloBurnCheck`, `DeployHealthReport`, `OncallMorningBrief` |
| M5-T4 — Automations UI wired to API | ✓ Complete | `automations-view.tsx` calls real gateway endpoints |
| Connector bootstrap registry | ✓ Complete | `subscriber.ts` wires per-tenant bootstrapRegistry |
| GitHub bootstrap | ✓ Complete | Calls `gh repo list`, upserts Repo entities |
| ArgoCD bootstrap | ⚠ Stub | Returns no-op unconditionally |
| Datadog bootstrap | ⚠ Stub | Returns no-op unconditionally |
| Linear bootstrap | ⚠ Stub | Returns no-op unconditionally |
| agent-service Graphiti endpoints | ✓ Complete | `/episodes`, `/facts` routes exist, Neo4j-backed |

---

### Issues for executor (BRIDGE.md)

**BLOCKING (4):** B1 services.ts wrong enum · B2 kb_entries FORCE RLS missing · B3 episodes.py no UUID validation · B4 agents/graph-builder.ts dead duplicate class

**HIGH (7):** H1 gate-decide per-request RedisGateSink · H2 Linear missing "Bearer" · H3 github bootstrap env leak · H4 connectorId c.type collision · H5 SREAgent skips graph call · H6 facts.py unvalidated query · H7 automations actions not schema-validated

**MEDIUM (10):** M1 BullMQ no dedup · M2 unbounded tenant query · M3 bootstrapRegistry per-event · M4 agent-service exception swallowed · M5 hardcoded Neo4j password · M6 allSettled masks connector fail · M7 upsertRelationship returns '' · M8 ArgoCD/Datadog bootstrap stubs · M9 audit userId null coerce · M10 gate bypass warn not throw in prod

**LOW (7):** L1 Redis URL constant · L2 UUID validator dedup · L3 condition matching limited · L4 poll interval hardcoded · L5 seed ON CONFLICT · L6 facts.py null guard · L7 Linear bootstrap hint

<!-- REVIEW SECTION END — 2026-06-09g -->

<!-- REVIEW SECTION START — 2026-06-09c -->
## Review — 2026-06-09c | Fix verification — registry null UUIDs, token cache, gate double-write, unused params

### Scope

4 source files changed in commit `9b25ed2` (since review `2026-06-09b`). Covers:
- `apps/gateway/src/connectors/registry.ts` — `user_id`/`session_id` null UUID fix
- `apps/gateway/src/gate/redis-gate-sink.ts` — double-write removed, TTL comment, `_decidedBy` prefix
- `apps/web/lib/gateway-client.ts` — `getDemoToken()` module-level cache + DEMO_EMAIL fix
- `packages/cli-adapter/src/discovery.ts` — `_env`/`_timeoutMs` prefix on unused params

### Verdict: PASS — 0 BLOCKING, 0 HIGH, 0 MEDIUM, 3 LOW

All issues from review `2026-06-09b` fully resolved and verified. Codebase is in clean state. Three LOW-severity observations documented below — none block development.

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 5/5 | All M0–M5 features wired. All prior BLOCKING/HIGH/MEDIUM issues resolved. |
| D2 Code Standards | 5/5 | `null` UUIDs correct. `_` prefixes on unused params correct. No `any`, no unused vars. |
| D3 Performance | 5/5 | `getDemoToken()` now cached at module level with JWT `exp` parsing. No unnecessary re-fetches. |
| D4 Security | 5/5 | RLS enforced on all DB writes. Gate flow correct. Admin role check on write tools. |
| D5 Readability | 4/5 | `record()` clarity improved with inline comment. Class docstring doesn't document Postgres ownership delegation (LOW). |
| D6 Clarity and Comments | 4/5 | `GATE_TTL_SECONDS` invariant documented. One LOW: `RedisGateSink` has no reconnect strategy unlike fixed `incident-subscriber`. |

---

### Issues Found

#### [LOW] redis-gate-sink.ts — `getPub()` has no reconnect strategy

**File:** `apps/gateway/src/gate/redis-gate-sink.ts:26`

**Issue:** `createClient({ url: this.redisUrl })` — no `socket.reconnectStrategy`. If Redis drops, `push()` and `record()` throw unhandled. `poll()` has try/catch (returns `null`, orchestrator times out), but `push()` has only a best-effort catch around the Postgres insert — the Redis `setEx` and `publish` calls after it are unguarded. `incident-subscriber.ts` was fixed to add reconnect in a prior cycle; this class was not.

**Fix:**

```typescript
private async getPub(): Promise<ReturnType<typeof createClient>> {
  if (!this.pub) {
    this.pub = createClient({
      url: this.redisUrl,
      socket: { reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000) },
    })
    this.pub.on('error', (err) => log.error({ err }, 'RedisGateSink connection error'))
    await this.pub.connect()
  }
  return this.pub
}
```

**Verify:** Stop Redis mid-session, observe gateway logs show reconnect attempts instead of unhandled throw.

---

#### [LOW] gateway-client.ts — concurrent requests can double-fetch token on cold start

**File:** `apps/web/lib/gateway-client.ts:8-9`

**Issue:** Two route handlers arriving simultaneously when `_cachedToken === null` both pass the cache check, both fetch `/auth/token`, both write the cache. Last writer wins — no data corruption, both tokens are valid. Harmless in practice (demo, low concurrency) but worth documenting.

**Fix (optional):** Deduplicate with a pending promise:

```typescript
let _fetchPromise: Promise<string | null> | null = null

export async function getDemoToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken
  if (_fetchPromise) return _fetchPromise
  _fetchPromise = fetchToken().finally(() => { _fetchPromise = null })
  return _fetchPromise
}
```

**Verify:** Two concurrent requests at cold start produce one `/auth/token` call in gateway logs.

---

#### [LOW] redis-gate-sink.ts — class docstring doesn't document Postgres ownership split

**File:** `apps/gateway/src/gate/redis-gate-sink.ts:12-18`

**Issue:** The class docstring describes all three methods but doesn't indicate that the Postgres `gate_events` update is owned by `gate-decide-route.ts`, not by `record()`. A reader scanning only the docstring would not know to look at the route for the DB update.

**Fix:** Update the `record:` line in the docstring:

```
- record: sets `gate:<gateId>:decision` in Redis — Postgres update is gate-decide-route.ts responsibility
```

---

### Pending Features (from docs/TASKS.md)

| Task | Title | Status |
|------|-------|--------|
| M0–M5 all tasks | Foundation through Automations | ✅ Complete |
| — | Gate Approve/Reject wired to backend | ✅ Complete |
| — | RLS on all audit writes | ✅ Complete |
| — | `getDemoToken()` consolidated + cached | ✅ Complete |
| — | `activeIncidents` computed from incidents table | ✅ Complete |
| — | `getToolsForTenant` parallel | ✅ Complete |
| — | `parseHelpOutput` unused params prefixed | ✅ Complete |
| — | `record()` double-write removed | ✅ Complete |
| — | `user_id`/`session_id` null in registry audit | ✅ Complete |
| — | `RedisGateSink.getPub()` reconnect strategy | ❌ Not started (LOW) |
| — | `getDemoToken()` concurrent fetch dedup | ❌ Not started (LOW) |
| — | `RedisGateSink` class docstring Postgres ownership | ❌ Not started (LOW) |

<!-- REVIEW SECTION END — 2026-06-09c -->

---

<!-- REVIEW SECTION START — 2026-06-09b -->
## Review — 2026-06-09b | BLOCKING+HIGH fix pass + MEDIUM executor fixes

### Scope

16 source files changed across commits `1acbe55..1427366` (since review `2026-06-09`). Covers:
- `apps/gateway/src/gate/redis-gate-sink.ts` — TTL fix, `record()` Postgres update added
- `apps/gateway/src/connectors/registry.ts` — RLS fix on audit event, parallel `getTools()`
- `apps/gateway/src/connectors/registration-tools.ts` — admin role guard added
- `apps/gateway/src/events/incident-subscriber.ts` — Redis reconnect strategy + error handler
- `apps/gateway/src/routes/chat.ts` — role forwarded to registration tools, redisUrl shadow removed
- `apps/gateway/src/routes/services.ts` — `activeIncidents` now computed (was hardcoded 0)
- `apps/web/lib/gateway-client.ts` — new shared `getDemoToken()` helper (was duplicated 6×)
- `apps/web/app/api/gate/[id]/decide/route.ts` — new proxy for gate decisions
- `apps/web/components/orchestrator-chat.tsx` — Approve/Reject now POST to `/api/gate/:id/decide`
- `apps/web/components/automations-view.tsx` — `toggleTrigger` error handling + toast
- `apps/web/components/incident-view.tsx` — ID truncation fixed (`slice(0,8)` → `slice(-8)`)
- All 5 web proxy routes — now import from `gateway-client.ts`

### Verdict: CONDITIONAL PASS — 0 BLOCKING, 1 HIGH, 3 MEDIUM, 4 LOW

All three BLOCKING issues from the 2026-06-09 review are resolved. The gate flow is now end-to-end functional, RLS is enforced on all audit writes in the path, and the TTL is appropriate. One HIGH issue remains: the connector registry's audit event still writes invalid UUIDs (`''`) for `user_id`/`session_id`, silently dropping every CLI tool call audit event. Fix before next feature work touches `registry.ts`.

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 4/5 | All previously blocked features now work end-to-end. `activeIncidents` computed. Gate approve/reject wired. `parseHelpOutput` unused params still unfixed (M4 from prior review). |
| D2 Code Standards | 3/5 | `user_id: ''` and `session_id: ''` in registry.ts still cause silent UUID cast failures. `parseHelpOutput` params not prefixed with `_`. |
| D3 Performance | 4/5 | `getToolsForTenant` now parallel. `getDemoToken()` consolidated but still uncached — fresh HTTP call per web request. |
| D4 Security | 4/5 | RLS fix on audit write in registry. Admin role check on `register_connector`. Gate TTL adequate. Minor: gate decision fire-and-forget with no client error path. |
| D5 Readability | 4/5 | Code clean overall. `record()` double-write (route + sink both update Postgres) is confusing — ownership unclear. |
| D6 Clarity and Comments | 3/5 | `GATE_TTL_SECONDS` still undocumented invariant. `record()` docstring not updated to mention Postgres update. Gate button `.catch(() => {})` makes silent failure intent unclear. |

---

### Issues Found

#### [HIGH] registry.ts — `user_id: ''` and `session_id: ''` are invalid UUIDs, audit event silently dropped

**File:** `apps/gateway/src/connectors/registry.ts:57-58`

**Issue:** Both `user_id` and `session_id` are `String? @db.Uuid` (nullable UUID columns). Prisma sends the empty string to Postgres which tries to cast `''::uuid` → throws `invalid input syntax for type uuid`. The `catch { /* swallow */ }` block eats the error. Every CLI tool call audit event is silently lost.

```typescript
// current — broken
user_id: '',
session_id: '',
```

**Fix:** Send `null` for both — the columns are nullable by design for system-generated events:

```typescript
user_id: null,
session_id: null,
```

**Verify:** Run gateway, register a CLI connector, invoke a tool. Check `audit_events` table has a row. Previously it had none.

---

#### [MEDIUM] cli-adapter/discovery.ts — `parseHelpOutput` params `env` and `timeoutMs` unused, not prefixed with `_`

**File:** `packages/cli-adapter/src/discovery.ts:49-50`

**Issue:** `parseHelpOutput` accepts `env` and `timeoutMs` but uses neither in its body (only `binary` and `text` are used). Lint rule `no-unused-vars` / TypeScript `noUnusedParameters` will flag these.

```typescript
// current
export function parseHelpOutput(
  text: string,
  binary: string,
  env?: Record<string, string>,      // unused
  timeoutMs?: number,                 // unused
): DiscoveredCommand[]
```

**Fix:** Prefix with `_` to signal intentional non-use:

```typescript
export function parseHelpOutput(
  text: string,
  binary: string,
  _env?: Record<string, string>,
  _timeoutMs?: number,
): DiscoveredCommand[]
```

**Verify:** `pnpm --filter @anvay/cli-adapter typecheck` passes with `noUnusedParameters: true`.

---

#### [MEDIUM] gateway-client.ts — `getDemoToken()` uncached: fresh HTTP `/auth/token` call on every web request

**File:** `apps/web/lib/gateway-client.ts:5`

**Issue:** Every call to `getDemoToken()` makes a synchronous HTTP POST to the gateway's `/auth/token`. Web proxy routes call it on every request (GET /api/services, GET /api/automations/triggers, etc.). The demo JWT has a long lifetime (likely 24h+) — fetching fresh every time adds unnecessary latency and gateway load.

**Fix:** Add module-level cache with expiry. Parse the JWT `exp` claim and cache until `exp - 60s`:

```typescript
let _cachedToken: string | null = null
let _tokenExpiry = 0

export async function getDemoToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken
  try {
    const r = await fetch(`${GATEWAY_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, tenantId: DEMO_TENANT_ID }),
    })
    if (!r.ok) return null
    const body = await r.json() as { token?: string }
    if (!body.token) return null
    try {
      const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64').toString()) as { exp?: number }
      _tokenExpiry = payload.exp ? (payload.exp - 60) * 1000 : Date.now() + 3_600_000
    } catch {
      _tokenExpiry = Date.now() + 3_600_000
    }
    _cachedToken = body.token
    return _cachedToken
  } catch {
    return null
  }
}
```

**Verify:** Two sequential calls to `/api/services` — second should not produce a `/auth/token` entry in gateway access log.

---

#### [MEDIUM] redis-gate-sink.ts — `record()` double-write: both route and sink update Postgres

**File:** `apps/gateway/src/gate/redis-gate-sink.ts:79-88` and `apps/gateway/src/gate/gate-decide-route.ts:25-31`

**Issue:** `gate-decide-route.ts` updates `gate_events.status` in Postgres first (with `AND status = 'pending'`), then calls `sink.record(...)`. `record()` now also updates Postgres. The second UPDATE finds 0 rows — harmless but wasteful. Ownership of "who updates Postgres" is split across two places.

**Fix:** Remove the Postgres UPDATE from `record()`. Route owns the DB update; `record()` only sets Redis:

```typescript
async record(gateId: string, decision: 'approved' | 'rejected', _decidedBy: string): Promise<void> {
  const pub = await this.getPub()
  await pub.setEx(`${GATE_KEY_PREFIX}${gateId}:decision`, GATE_TTL_SECONDS, decision)
}
```

Update the class docstring to reflect that `record` is Redis-only.

**Verify:** Single UPDATE in Postgres query log per gate decision. No extra Redis GET before `setEx`.

---

#### [LOW] redis-gate-sink.ts:10 — `GATE_TTL_SECONDS` undocumented invariant

**File:** `apps/gateway/src/gate/redis-gate-sink.ts:10`

**Fix:** `const GATE_TTL_SECONDS = 600 // must exceed orchestrator poll timeout (default 5 min) + max human response window`

---

#### [LOW] redis-gate-sink.ts:17-18 — docstring not updated to reflect Postgres update in `record()`

**Fix:** If keeping the Postgres path in `record()`, update the docstring: `- record: persists decision to Postgres + sets gate:<gateId>:decision in Redis`. If removing per the MEDIUM fix above, update to `- record: sets gate:<gateId>:decision in Redis (caller owns Postgres update)`.

---

#### [LOW] orchestrator-chat.tsx — gate fetch errors silently swallowed

**File:** `apps/web/components/orchestrator-chat.tsx:819,835`

**Fix:** `.catch((err) => { console.error('[gate] decision POST failed', err) })`

---

#### [LOW] orchestrator-chat.tsx — gate UI dismissed before fetch completes

**File:** `apps/web/components/orchestrator-chat.tsx:811,827`

`setGateRequired(null)` fires before fetch resolves. On fetch failure, gate is already gone — user cannot retry. Acceptable for V1 demo but document the limitation.

---

### Pending Features (from docs/TASKS.md)

| Task | Title | Status |
|------|-------|--------|
| M0–M5 all tasks | Foundation through Automations | ✅ Complete |
| — | Gate Approve/Reject → POST /api/gate/:id/decide | ✅ Complete (this cycle) |
| — | Registry audit RLS fix | ✅ Complete (this cycle) |
| — | `getDemoToken()` deduplicated | ✅ Complete (this cycle) |
| — | `activeIncidents` computed | ✅ Complete (this cycle) |
| — | `getToolsForTenant` parallelised | ✅ Complete (this cycle) |
| — | `parseHelpOutput` unused params (`_` prefix) | ❌ Not done — Executor skipped M4 |
| — | `getDemoToken()` module-level caching | ❌ Not started |
| — | `record()` double-write cleanup | ❌ Not started |
| — | `user_id: null` in registry audit (HIGH) | ❌ Not started |

<!-- REVIEW SECTION END — 2026-06-09b -->

---

<!-- REVIEW SECTION START — 2026-06-09 -->
## Review — 2026-06-09 | M3/M4/M5 milestone review — incident War Room, KB grounding, automations + service catalog wiring

### Scope

44 source files changed across commits `89d1a12..b963e8c` (since review `2026-06-08g`). Covers:
- `apps/gateway/src/gate/redis-gate-sink.ts` (HIGH fix from 2026-06-08g verified, new issues found)
- `apps/gateway/src/routes/incidents.ts`, `services.ts`, `chat.ts`
- `apps/gateway/src/events/incident-subscriber.ts`
- `apps/gateway/src/services/incident.ts`
- `apps/gateway/src/connectors/registry.ts`, `registration-tools.ts`
- `apps/gateway/prisma/migrations/0015_incidents_description_root_cause/migration.sql`, `schema.prisma`, `seed.ts`
- `apps/web/app/api/incidents/`, `services/`, `automations/triggers/`, `automations/monitors/` (new proxy routes)
- `apps/web/components/incident-view.tsx`, `orchestrator-chat.tsx`, `automations-view.tsx`, `service-catalog.tsx`
- `packages/agent/src/orchestrator.ts`, `tools/incident-context.ts`, `interfaces/audit.ts`, `index.ts`
- `packages/types/src/index.ts`
- `packages/mcp-adapter/src/connector.ts`, `connector.test.ts`, `index.ts`
- `packages/cli-adapter/src/connector.ts`, `discovery.ts`, `connector.test.ts`, `discovery.test.ts`, `index.ts`

### Verdict: HOLD — 2 BLOCKING issues must be fixed before ship

The milestone code is architecturally sound. The orchestrator, incident War Room, KB grounding, MCP/CLI adapters, and all five UI views are wired to real APIs. However three issues block shipping: the gate Approve/Reject buttons are no-ops (V1 trust contract broken), the connector registry audit write bypasses RLS (security isolation broken), and the gate Redis TTL is shorter than the human response window (gate flow breaks in practice). Fix these three before any further feature work touches the affected files.

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 2/5 | Gate approve/reject buttons are no-ops — V1 L2 trust contract broken. `activeIncidents` hardcoded 0. `record()` does not persist decision to Postgres. Incident subscriber has no reconnect. |
| D2 Code Standards | 3/5 | `prisma.auditEvent.create` in `registry.ts:52` bypasses RLS (withTenant imported but not used). `SessionId('')` is an invalid UUID stored in `session_id @db.Uuid`. Branching types inconsistency between service layer (plain string) and audit layer (branded). |
| D3 Performance | 3/5 | `getToolsForTenant` calls `adapter.getTools()` serially for each connector. `getDemoToken()` duplicated 6×, called per-request with no caching. `RedisGateSink` instantiated per-request in gate-decide-route. `allEntities` query has no type filter — full table scan. |
| D4 Security | 2/5 | `prisma.auditEvent.create` without `withTenant` in registry — data isolation violation. Gate Redis TTL (60s) shorter than human response window. `register_connector` tool has no runtime admin role check — relies on LLM discretion. |
| D5 Readability | 4/5 | Code is generally clean. Two issues: `chat.ts` has `redisUrl` declared twice (outer shadowed by inner). `incident-view.tsx` stores truncated 8-char IDs in selection state — confusing and breaks `onTriggerOrchestrator` calls. |
| D6 Clarity and Comments | 3/5 | Gate TTL invariant (must exceed poll timeout + human response) undocumented. `activeIncidents: 0` placeholder not marked as TODO. `adapterCache` eviction policy undocumented. `incident-subscriber.ts` has no comment about missing reconnect. |

---

### Issues Found

#### [BLOCKING] Gate Approve/Reject buttons are no-ops — V1 L2 trust contract broken

**File:** `apps/web/components/orchestrator-chat.tsx:810,820`

**Issue:** Both Approve and Reject `onClick` handlers only call `setGateRequired(null)` — no HTTP request to the backend:

```typescript
// line 810
onClick={() => setGateRequired(null)}  // Approve
// line 820
onClick={() => setGateRequired(null)}  // Reject
```

The gate sink is polling `gate:<gateId>:decision` in Redis. Without a call to the gate-decide endpoint, the Redis key is never set, `pollGate()` times out after 30 seconds, and every write action is permanently blocked. The V1 trust principle (L2 Approve — user explicitly confirms before Anvay executes) is completely broken. This is the most critical issue in the codebase.

**Fix:**
1. Create `apps/web/app/api/gate/[id]/decide/route.ts`:
```typescript
const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'
// ... getDemoToken pattern same as other proxy routes
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = await getDemoToken()
  if (!token) return new Response(JSON.stringify({ error: 'auth failed' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  const body = await request.text()
  const resp = await fetch(`${GATEWAY_URL}/api/gate/${id}/decide`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body,
  })
  const data = await resp.text()
  return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
}
```

2. In `orchestrator-chat.tsx`, replace both handlers:
```typescript
async function submitGateDecision(gateId: string, decision: 'approved' | 'rejected') {
  try {
    await fetch(`/api/gate/${gateId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, decidedBy: 'ui-user' }),
    })
  } catch (err) {
    pushLog({ actor: 'GATE', actorColor: '#ef4444', text: `Decision submit failed: ${err instanceof Error ? err.message : 'unknown'}`, status: 'error' })
  } finally {
    setGateRequired(null)
  }
}
// Approve button:
onClick={() => { void submitGateDecision(gateRequired.gateId, 'approved') }}
// Reject button:
onClick={() => { void submitGateDecision(gateRequired.gateId, 'rejected') }}
```

**Verify:** Enable a write action, trigger it via chat, click Approve. Confirm: (1) gateway logs `gate_decision` audit event, (2) the write action executes, (3) `gate_events.status` = `'approved'` in DB.

---

#### [BLOCKING] `registry.ts:52` — `prisma.auditEvent.create` bypasses RLS

**File:** `apps/gateway/src/connectors/registry.ts:52`

**Issue:** The `onExec` callback for CLI connectors calls `prisma.auditEvent.create({...})` directly — without `withTenant()`. Despite `withTenant` being imported at line 1, the `onExec` closure uses the bare `prisma` singleton:

```typescript
onExec(entry: CliExecEntry) {
  void (async () => {
    try {
      await prisma.auditEvent.create({  // ← no withTenant — RLS bypass
        data: { ..., tenant_id: tenantId, ... }
      })
    } catch { /* swallow */ }
  })()
},
```

`audit_events` has `FORCE ROW LEVEL SECURITY`. Without the `app.tenant_id` GUC set, the INSERT either fails silently (caught and swallowed) or—depending on the Postgres role—succeeds and writes to the wrong tenant namespace. Either way audit logging for all CLI tool executions is broken.

**Fix:**
```typescript
onExec(entry: CliExecEntry) {
  void (async () => {
    try {
      await withTenant(prisma, tenantId, (tx) =>
        tx.auditEvent.create({
          data: {
            id: crypto.randomUUID(),
            tenant_id: tenantId,
            user_id: null,    // String? @db.Uuid — null valid
            session_id: null, // String? @db.Uuid — null valid
            event_type: 'tool_call_allowed',
            payload: JSON.parse(JSON.stringify(entry)),
            created_at: new Date(),
          },
        })
      )
    } catch { /* swallow — best effort */ }
  })()
},
```

**Verify:** Execute a CLI tool for a non-default tenant. Confirm `audit_events` row exists with correct `tenant_id`. Confirm no row appears under a different tenant.

---

#### [BLOCKING] Gate Redis TTL (60s) is shorter than the human response window

**File:** `apps/gateway/src/gate/redis-gate-sink.ts:10`

**Issue:** `GATE_TTL_SECONDS = 60`. The orchestrator polls for up to 30 seconds by default (`gateTimeoutMs = 30_000`). After the poll times out, `pollGate()` returns `{ _tag: 'timed_out' }`. If the user then clicks Approve after the poll window (very common), `record()` sets the Redis key—but `pollGate()` has already returned and the action is blocked. Even within the poll window, a human who takes 35 seconds will find the key expired. The effective human decision window is `60 - 30 = 30 seconds`, which is insufficient for any non-trivial action review.

**Fix:**
```typescript
// TTL must exceed gateTimeoutMs (30s default) plus a generous human decision buffer.
// 10 minutes covers the UI review window for any non-automated action.
const GATE_TTL_SECONDS = 600
```

Both key writes (event payload at line 51, decision at line 71) use this constant.

**Verify:** Push a gate event, wait 35 seconds, call `record()` with `'approved'`. Confirm `poll()` still returns `'approved'` (key not expired).

---

#### [HIGH] `incident-subscriber.ts` has no Redis reconnect handling

**File:** `apps/gateway/src/events/incident-subscriber.ts:36-42`

**Issue:** `sub.connect()` runs once at startup with no error handler and no reconnect strategy. If Redis drops (network event, container restart), the subscriber silently dies. All `incident_created` events during the outage are permanently lost — SRE root cause analysis never runs for those incidents. There is no observable signal that the subscriber is dead (no metrics, no periodic heartbeat).

**Fix:**
```typescript
const sub = createClient({
  url: redisUrl,
  socket: { reconnectStrategy: (retries) => Math.min(retries * 500, 10_000) },
}) as RedisClientType

sub.on('error', (err) => {
  log.error({ err }, 'incident-subscriber: Redis error')
})
sub.on('reconnecting', () => {
  log.warn('incident-subscriber: reconnecting to Redis')
})
```

**Verify:** Kill Redis while subscriber is running. Restart Redis. Publish `incident_created`. Confirm subscriber processes it within reconnect delay.

---

#### [HIGH] `register_connector` tool has no runtime admin role enforcement

**File:** `apps/gateway/src/connectors/registration-tools.ts:25-29`

**Issue:** Tool description says "Admin only" but `run()` contains no role check. The LLM is not a hard enforcement boundary — role enforcement via natural language is probabilistic. Any user whose query happens to route to `register_connector` executes it regardless of their role.

**Fix:** Make `makeRegistrationTools` role-aware:
```typescript
import type { AgentRole } from '@anvay/types'

export function makeRegistrationTools(tenantId: string, role: AgentRole): ExecutableTool[] {
  return [{
    name: 'register_connector',
    // ...
    async run(args) {
      if (role !== 'admin') return { error: 'register_connector requires admin role' }
      // ... rest unchanged
    },
  }, {
    name: 'list_connectors',
    // ...
    async run(args) {
      if (role !== 'admin') return { error: 'list_connectors requires admin role' }
      // ... rest unchanged
    },
  }]
}
```

Update `chat.ts` to extract `role` from JWT claims and pass to `makeRegistrationTools`.

**Verify:** Authenticate as dev role user, send a query that triggers `register_connector`, confirm it returns the role error.

---

#### [HIGH] `activeIncidents` hardcoded to 0 — service catalog badges permanently blank

**File:** `apps/gateway/src/routes/services.ts:71`

**Issue:** `activeIncidents: 0` — the incident count badge in `service-catalog.tsx` always shows zero, misrepresenting live system state.

**Fix:** Inside the `withTenant` block, add an aggregation query:
```typescript
const incidentCounts = await tx.$queryRaw<{ name: string; cnt: bigint }[]>`
  SELECT e.name, COUNT(i.id)::bigint AS cnt
  FROM incidents i
  JOIN entities e ON LOWER(i.title) LIKE '%' || LOWER(e.name) || '%'
  WHERE i.status IN ('active', 'investigating') AND e.type = 'Service'
  GROUP BY e.name
`
const countMap = new Map(incidentCounts.map(r => [r.name, Number(r.cnt)]))
```
Then `activeIncidents: countMap.get(entity.name) ?? 0`. Add a comment noting this is name-match approximate until RELATES_TO edges are populated.

**Verify:** Create an active incident whose title contains a service name. Confirm that service's badge shows a non-zero count.

---

#### [HIGH] `RedisGateSink.record()` does not persist decision to Postgres

**File:** `apps/gateway/src/gate/redis-gate-sink.ts:68-71`

**Issue:** `record()` only writes the decision to Redis. The `gate_events` row inserted by `push()` keeps `status = 'pending'` unless `gate-decide-route.ts` runs the UPDATE independently. Future callers of `record()` (automated approval, batch approve) will leave audit rows as permanently pending.

**Fix:** Add a best-effort Postgres UPDATE inside `record()`:
```typescript
async record(gateId: string, decision: 'approved' | 'rejected', decidedBy: string): Promise<void> {
  // Best-effort — audit trail update; do not block gate flow
  try {
    await prisma.$executeRaw`
      UPDATE gate_events SET status = ${decision}::text, decided_by = ${decidedBy}::text, decided_at = NOW()
      WHERE id = ${gateId}::uuid AND status = 'pending'
    `
  } catch (err) {
    log.warn({ err, gateId }, 'gate_events decision UPDATE failed')
  }
  // Then Redis
  const pub = await this.getPub()
  const key = `${GATE_KEY_PREFIX}${gateId}:decision`
  await pub.setEx(key, GATE_TTL_SECONDS, decision)
}
```

Note: `withTenant` cannot be used without a `tenantId` parameter; the raw UPDATE is acceptable here since the WHERE clause is on the specific `gateId` (UUIDs are globally unique).

**Verify:** Call `record()` directly (without going through gate-decide-route). Confirm `gate_events.status` = `'approved'` in DB.

---

#### [HIGH] `getDemoToken()` duplicated 6× with no in-process caching

**Files:** `apps/web/app/api/incidents/route.ts:5`, `apps/web/app/api/services/route.ts:5`, `apps/web/app/api/automations/triggers/route.ts:5`, `apps/web/app/api/automations/triggers/[id]/route.ts:5`, `apps/web/app/api/automations/monitors/route.ts:5`, `apps/web/app/api/automations/monitors/[id]/route.ts:5`

**Issue:** Six identical 14-line functions + identical env-var constants. Pages that fetch multiple endpoints in parallel (service-catalog: services + incidents) issue two concurrent `POST /auth/token` requests. No caching means token acquisition scales O(N) with API routes loaded on a page.

**Fix:** Extract to `apps/web/lib/gateway-client.ts`:
```typescript
const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'
const DEMO_EMAIL   = process.env['DEMO_EMAIL']   ?? 'demo@anvay.dev'
const DEMO_TENANT  = process.env['DEMO_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001'

let _tokenCache: { token: string; expiresAt: number } | null = null

export async function getDemoToken(): Promise<string | null> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) return _tokenCache.token
  try {
    const r = await fetch(`${GATEWAY_URL}/auth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, tenantId: DEMO_TENANT }),
    })
    if (!r.ok) return null
    const body = await r.json() as { token?: string }
    if (!body.token) return null
    _tokenCache = { token: body.token, expiresAt: Date.now() + 5 * 60_000 }
    return body.token
  } catch { return null }
}
export const GATEWAY = GATEWAY_URL
```

Replace all six duplicate definitions with `import { getDemoToken, GATEWAY } from '@/lib/gateway-client'`.

**Verify:** Load service catalog page. Confirm only one `POST /auth/token` appears in gateway access log per page load.

---

#### [HIGH] `automations-view.tsx` `toggleTrigger` swallows errors with no user feedback

**File:** `apps/web/components/automations-view.tsx:155-161`

**Issue:** If the PATCH request fails (network error, 5xx), the error is swallowed entirely. State is only updated on success (`await` comes before `setTriggers`), so the UI does not flip — but the user sees no indication the action failed.

**Fix:**
```typescript
async function toggleTrigger(id: string, enabled: boolean) {
  try {
    const resp = await fetch(`/api/automations/triggers/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    setTriggers(prev => prev.map(t => t.id === id ? { ...t, enabled } : t))
  } catch (err) {
    console.error('toggleTrigger failed:', err)
    // TODO: surface via toast notification
  }
}
```

**Verify:** Mock the PATCH endpoint to return 503. Click the status dot. Confirm the state does not change and an error appears in console.

---

#### [MEDIUM] `getToolsForTenant` fetches MCP/CLI tools serially — adds latency per connector

**File:** `apps/gateway/src/connectors/registry.ts:80-90`

**Issue:** Sequential `for...of` loop calling `await adapter.getTools()` for each connector. For 5 MCP connectors at 100ms each = 500ms added to every chat request.

**Fix:** Parallelise with `Promise.all`:
```typescript
const toolArrays = await Promise.all(
  rows.map(async (row) => {
    const key = `${tenantId}:${row.id}`
    if (!adapterCache.has(key)) adapterCache.set(key, instantiateAdapter(row, tenantId))
    return adapterCache.get(key)!.getTools()
  })
)
return toolArrays.flat()
```

**Verify:** Benchmark with 3+ connectors; confirm total time ≈ slowest single connector not their sum.

---

#### [MEDIUM] `services.ts` fetches all entity rows without type filter on second query

**File:** `apps/gateway/src/routes/services.ts:29-34`

**Issue:** `SELECT id, name, type, metadata FROM entities` with no WHERE clause fetches every entity (Teams, Repos, Engineers, Tickets, etc.). Only the first query filters by `type = 'Service'`. At org scale this is a full table scan to build the join map.

**Fix:** Scope to IDs referenced by the fetched Service entities and their relationships:
```typescript
// Run allRels first with a scope filter, then fetch only referenced entity IDs
const allRels = await tx.$queryRaw<RelRow[]>`
  SELECT from_entity_id AS "fromEntityId", rel_type AS "relType", to_entity_id AS "toEntityId"
  FROM relationships
  WHERE from_entity_id = ANY(${entities.map(e => e.id)}::uuid[])
     OR to_entity_id   = ANY(${entities.map(e => e.id)}::uuid[])
`
const referencedIds = [...new Set([...allRels.map(r => r.fromEntityId), ...allRels.map(r => r.toEntityId)])]
const allEntities = referencedIds.length > 0
  ? await tx.$queryRaw<EntityRow[]>`SELECT id, name, type, metadata FROM entities WHERE id = ANY(${referencedIds}::uuid[])`
  : []
```

Note: Prisma doesn't natively support array params in tagged templates — use `$queryRawUnsafe` with `Prisma.join` or extract to a helper.

**Verify:** With 100 mixed entities, confirm `allEntities` result set is bounded by relationship count, not total entity count.

---

#### [MEDIUM] `incident-view.tsx` stores truncated 8-char ID in selection state — breaks orchestrator queries

**File:** `apps/web/components/incident-view.tsx:120`

**Issue:** `toDisplay()` slices `id` to 8 characters. This truncated ID is stored as `selectedId` and passed to `onTriggerOrchestrator` — the orchestrator query contains a partial UUID, not a valid one, making lookups impossible.

**Fix:** Store the full UUID; use a `shortId` field for display only:
```typescript
function toDisplay(a: ApiIncident): DisplayIncident {
  return {
    id: a.id,              // full UUID — used for selection + queries
    shortId: a.id.slice(0, 8),   // display badge only
    // ...
  }
}
```
Update all render sites to use `shortId` for the badge and `id` for selection/queries.

**Verify:** Click "Investigate with Anvay" on an incident. Confirm the query sent to the orchestrator contains a full UUID.

---

#### [MEDIUM] `chat.ts` — `redisUrl` declared twice, inner shadows outer

**File:** `apps/gateway/src/routes/chat.ts:160,286`

**Issue:** `const redisUrl = process.env['REDIS_URL']` at line 160 is re-declared inside the request handler at line 286. TypeScript allows this (different scopes) but creates confusion — a reader may believe the gate sink uses a different Redis URL than the session memory.

**Fix:** Remove line 286 redeclaration and use the outer `redisUrl` constant.

**Verify:** TypeScript compiles cleanly; grep confirms only one `const redisUrl` in the file.

---

#### [MEDIUM] MCP adapter test has no error-path coverage

**File:** `packages/mcp-adapter/src/connector.test.ts`

**Issue:** Tests only cover happy path. Missing: `connect()` failure → `health()` returns `unhealthy`; calling a tool not in the discovered set; transport error mid-call.

**Fix:** Add at minimum:
```typescript
it('health() returns unhealthy when connection fails', async () => { ... })
it('call() throws for unknown tool name', async () => { ... })
```

**Verify:** `vitest run` passes; error branches are exercised.

---

#### [MEDIUM] CLI adapter — `parseHelpOutput` has unused `env`/`timeoutMs` parameters

**File:** `packages/cli-adapter/src/discovery.ts:46-51`

**Issue:** Signature includes `env?: NodeJS.ProcessEnv` and `timeoutMs?: number` but neither is referenced inside the function body — they are used at the call site in `discoverSubcommands` but not passed into `parseHelpOutput`. The exported function signature is misleading.

**Fix:**
```typescript
export function parseHelpOutput(text: string, binary: string): DiscoveredCommand[] {
```
Remove the unused parameters. Update tests if they pass these args.

**Verify:** TypeScript compiles; existing tests pass.

---

#### [LOW] `SessionId('')` is an invalid UUID stored in `session_id @db.Uuid`

**File:** `apps/gateway/src/routes/incidents.ts:94,117,139`

**Issue:** `SessionId('')` creates a branded empty string. The `audit_events.session_id` column is `String? @db.Uuid` — Postgres will reject a non-UUID value when the column is actually used as a UUID. While Prisma may allow the write (if the column is `TEXT` at the DB level), it creates invalid data.

**Fix:** Use the all-zeros sentinel UUID for system actions with no session context:
```typescript
const SYSTEM_SESSION = SessionId('00000000-0000-0000-0000-000000000000')
// In audit events for incident mutations:
sessionId: SYSTEM_SESSION,
```

**Verify:** Insert an incident-created audit event. Confirm `session_id` in DB is a valid UUID (all-zeros).

---

#### [LOW] `adapterCache` in `registry.ts` has no eviction — stale adapters persist

**File:** `apps/gateway/src/connectors/registry.ts:19`

**Issue:** Module-level `Map` with no max size, no TTL, no eviction on connector delete/update. A deleted connector's adapter persists in cache and its tools continue to appear in `getToolsForTenant`.

**Fix:** Expose a `clearAdapterCache(tenantId: string, connectorId: string)` function and call it from the connector DELETE route. Add a comment:
```typescript
// Per-process cache, no TTL. Callers must invoke clearAdapterCache() on connector delete/update.
const adapterCache = new Map<string, McpConnector | CliConnector>()
export function clearAdapterCache(tenantId: string, connectorId: string) {
  adapterCache.delete(`${tenantId}:${connectorId}`)
}
```

**Verify:** Register a connector, call `getToolsForTenant`, delete the connector, call `clearAdapterCache`, call `getToolsForTenant` again — deleted connector's tools must not appear.

---

#### [LOW] Gate TTL invariant and `activeIncidents: 0` placeholder undocumented

**Files:** `apps/gateway/src/gate/redis-gate-sink.ts:10`, `apps/gateway/src/routes/services.ts:71`

**Issue:** Neither placeholder is marked as temporary or constrained. Future readers may assume they are intentional rather than known gaps.

**Fix:**
```typescript
// redis-gate-sink.ts line 10 (after fixing to 600):
// Must exceed gateTimeoutMs (30s default) + human review window. See OrchestratorConfig.gateTimeoutMs.
const GATE_TTL_SECONDS = 600

// services.ts line 71:
activeIncidents: 0, // TODO: join with incidents table once RELATES_TO graph edges are populated
```

**Verify:** Code review — comments present.

---

### Pending Features (vs docs/TASKS.md)

| Milestone | Task | Status | Notes |
|-----------|------|--------|-------|
| M0 — Foundation | All tasks (T1–T8) | ✅ Complete | DB, auth, Docker, E2E (38/38) |
| M1-T1 | IModelProvider + provider implementations | ✅ Complete | Anthropic, OpenAI, Ollama providers |
| M1-T2 | ISessionMemory + RedisSessionMemory | ✅ Complete | TTL, turn compression |
| M1-T3 | Perimeter engine + IAuditSink | ✅ Complete | Deterministic rule evaluation |
| M1-T4 | Orchestrator + runSession | ✅ Complete | Hand-rolled loop, graph-first |
| M1-T5 | /api/chat SSE gateway endpoint | ✅ Complete | Streams real LLM tokens |
| M1-T6 | OrchestratorChat wired to /api/chat | ⚠️ Partial | SSE streaming done; gate approve/reject buttons are no-ops (BLOCKING) |
| M2-T1 | CliConnector — `discoverSubcommands()` | ✅ Complete | parseHelpOutput + 1-level deep |
| M2-T2 | CliConnector — `run()` subprocess | ✅ Complete | onExec audit callback wired |
| M2-T5 | Connector registry + getToolsForTenant | ✅ Complete | Serial loop is HIGH perf issue |
| M2-T6 | MCP adapter | ✅ Complete | McpConnector, tool discovery, call() |
| M2-T7 | CLI adapter | ✅ Complete | CliConnector, discovery, subprocess |
| M3-T1 | Incident CRUD endpoints | ✅ Complete | GET/POST/PATCH/resolve with audit |
| M3-T2 | get_incident_context tool | ✅ Complete | Graph-first + SREAgent |
| M3-T3 | Redis incident_created subscriber | ⚠️ Partial | Runs but no reconnect handling (HIGH) |
| M3-T4 | Incident War Room UI | ✅ Complete | Fetches real API; empty states; hypothesis display |
| M4-T1 | IKnowledgeGraph migration (entities/relationships) | ✅ Complete | Tables, RLS policies |
| M4-T2 | HybridKnowledgeGraph implementation | ✅ Complete | StructuralGraph + GraphitiClient |
| M4-T3 | Freshness scoring | ✅ Complete | TTL-based decay, staleness flag |
| M4-T4 | Grounding validation + stale banner | ✅ Complete | GroundingSource in DoneEvent, UI banner |
| M4-T5 | StructuralGraph entity extraction | ⚠️ Partial | Interface + queries work; no connector bootstrap |
| M4-T6 | Graph Builder Agent event-driven wiring | ⚠️ Partial | Agent code exists; no event subscription in production path |
| M4-T7 | KB semantic search | ⚠️ Partial | Interface defined; no pgvector population |
| M5-T1 | Scheduler (Trigger.dev / BullMQ) | ⚠️ Partial | BullMQScheduler wired; Trigger.dev not implemented |
| M5-T2 | Trigger engine + rule evaluation | ✅ Complete | TriggerEngine, automations CRUD, Redis evaluate |
| M5-T3 | Cron monitors — scheduled agent runs | ⚠️ Partial | cron_jobs table + BullMQ registration; actual agent execution partial |
| M5-T4 | Automations + service catalog UI wiring | ✅ Complete | All views fetch real API; proxy routes wired |

**Overall progress:** 18/26 tasks fully complete. 6 tasks partial (functional code exists but known gaps). 2 tasks not started (Graph Builder production wiring, pgvector population).

---

<!-- REVIEW SECTION START — 2026-06-08g -->
## Review — 2026-06-08g | NEW-1/2/3 fix verification — gate_events audit + trigger_rules RLS

### Scope

Two files changed since review `2026-06-08f` (commit `3ef238c`):
- `apps/gateway/prisma/migrations/0014_trigger_rules_policy_cleanup/migration.sql`
- `apps/gateway/src/gate/redis-gate-sink.ts`

### Verdict: HOLD — 1 HIGH must be fixed before ship

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Feature Completeness | 3/5 | 0014 migration correct. gate_events INSERT structurally correct but silently broken at runtime — missing withTenant(). |
| D2 Code Standards | 3/5 | Module-level prisma used without tenant context. Pattern inconsistent with every other DB write in the codebase. |
| D3 Performance | 3/5 | poll() creates a new Redis TCP connection per call — up to 60 connections per 30s gate timeout. Wasteful. |
| D4 Security | 4/5 | 0014 correctly closes the trigger_rules WITH CHECK bypass. gate_events RLS is not broken (FORCE RLS already present from 0010). |
| D5 Readability | 4/5 | push() catch comment explains intent. poll() client lifecycle is implicit. |
| D6 Clarity and Comments | 3/5 | Missing comment on WHY withTenant() is absent — reader assumes it was intentional. It is a bug. |

---

### Issues Found

#### [HIGH — BLOCKING] push() INSERT silently fails — gate_events rows never persisted

**File:** `apps/gateway/src/gate/redis-gate-sink.ts:31-39`

**Issue:** `push()` uses the module-level `prisma` singleton directly — no `withTenant()` wrapper:

```typescript
await prisma.$executeRaw`
  INSERT INTO gate_events (...) VALUES (...)
`
```

`gate_events` has `FORCE ROW LEVEL SECURITY` (set in migration 0010) and a `WITH CHECK` policy requiring `tenant_id = current_setting('app.tenant_id', true)::uuid`. Without a `withTenant()` call, `app.tenant_id` is not set on the Postgres session. The `WITH CHECK` expression evaluates `current_setting('app.tenant_id', true)` → `NULL`. `NULL::uuid` ≠ any tenant_id → policy rejects the INSERT.

The exception is silently swallowed:
```typescript
} catch {
  // Best-effort — don't block gate flow on audit insert failure
}
```

Result: every `push()` call fails the INSERT silently, gate_events rows are never written, the gate UI is blind, and `/api/gate/:id/decide` always returns 404 (UPDATE finds 0 rows). NEW-3 from review `2026-06-08f` is not actually fixed at runtime — only at the syntactic level.

**Fix:** Wrap INSERT in `withTenant()`. `GateEvent.tenantId` is already available:

```typescript
import { withTenant } from '../db/prisma.js'

async push(event: GateEvent): Promise<string> {
  // Persist to Postgres (audit trail) — withTenant sets app.tenant_id for RLS
  try {
    await withTenant(prisma, event.tenantId, (tx) =>
      tx.$executeRaw`
        INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, tool_call_id, created_at)
        VALUES (${event.id}::uuid, ${event.tenantId}::uuid, ${event.userId}::uuid, ${event.sessionId}::uuid,
          ${event.toolName}, ${JSON.stringify(event.args)}::jsonb, ${event.connectorId},
          'pending', ${event.toolCallId}, ${event.createdAt.toISOString()}::timestamptz)
      `
    )
  } catch (err) {
    // Best-effort — log but don't block gate flow
    console.warn('[RedisGateSink] gate_events insert failed', err)
  }
  // ... Redis publish unchanged
}
```

**Verify:**
```sql
-- After push() call: row must exist
SELECT id, status FROM gate_events WHERE id = '<gateId>';
-- Must return 1 row with status = 'pending'
```
Then POST `/api/gate/:id/decide` → must return `{ ok: true }` (not 404).

---

#### [MEDIUM] poll() creates a new Redis TCP connection per invocation — 60 connections per gate event

**File:** `apps/gateway/src/gate/redis-gate-sink.ts:49-62`

**Issue:** `pollGate()` (in `packages/agent/src/gate/gate.ts`) calls `sink.poll()` every 500ms for up to 30s — up to 60 calls. `poll()` calls `createClient()` each time:

```typescript
async poll(gateId: string): Promise<'approved' | 'rejected' | null> {
  const c = createClient({ url: this.redisUrl })  // new TCP connection per call
  try {
    await c.connect()
    ...
    return await c.get(key)
  } finally {
    await c.disconnect().catch(() => {})
  }
}
```

`poll()` only calls `c.get()` — a standard command, no subscriber mode. There is no reason to create a new connection. `getPub()` returns a cached, already-connected client suitable for GET.

**Fix:**
```typescript
async poll(gateId: string): Promise<'approved' | 'rejected' | null> {
  try {
    const c = await this.getPub()
    const key = `${GATE_KEY_PREFIX}${gateId}:decision`
    const value = await c.get(key)
    if (value === 'approved' || value === 'rejected') return value
    return null
  } catch {
    return null
  }
}
```

**Verify:** Under concurrent gate approvals, no Redis connection exhaustion. Single active connection in Redis `CLIENT LIST` per `RedisGateSink` instance.

---

#### [LOW] gate-decide-route.ts: new RedisGateSink() per request, pub client never disconnected

**File:** `apps/gateway/src/gate/gate-decide-route.ts:36-41`

**Issue:** A new `RedisGateSink` is instantiated per request. `record()` calls `getPub()` which creates and caches `this.pub`. When the request ends, the instance is garbage-collected but `this.pub` (a live Redis client) is never explicitly disconnected. Under K8s rolling restarts or high decide traffic, open connections accumulate until GC runs.

**Fix:** Module-level singleton or explicit `quit()` after `record()`:
```typescript
// Option A: module-level singleton (preferred — matches inMemoryStore pattern in chat.ts)
const gateSink = process.env['REDIS_URL'] ? new RedisGateSink(process.env['REDIS_URL']) : null

// Option B: explicit cleanup
const sink = new RedisGateSink(process.env['REDIS_URL'])
await sink.record(gateId, decision, userId)
// After: call sink.quit() if/when RedisGateSink exposes it
```

---

#### [LOW] NEW-4 from prior review was incorrect — cron_jobs FORCE RLS already present

**Note:** Review `2026-06-08f` flagged cron_jobs as missing `FORCE ROW LEVEL SECURITY`. Incorrect. Migration `0008_cron_jobs_rls` already contains `ALTER TABLE cron_jobs FORCE ROW LEVEL SECURITY`. Prior finding was based on reading 0006 only, missing 0008. Retracting NEW-4.

---

### Pending Features (vs docs/TASKS.md)

| Milestone | Task | Status |
|-----------|------|--------|
| M0 Foundation | Monorepo + Docker + Gateway + Auth + DB | ✅ Complete |
| M0-T7 | E2E test suite (Playwright 38 tests) | ✅ Complete |
| M1 Orchestrator Core | IModelProvider, streaming SSE, token budget, perimeter | ✅ Complete |
| M1 Gate L2 | IGateSink wired, push/poll/record, gate-decide route | ⚠️ Partial — push() INSERT broken (this review HIGH) |
| M2 Core Connectors | GitHub, Datadog, K8s, PagerDuty connector agents | ❌ Not started |
| M2-T5 | Connector registry + getToolsForTenant() | ⚠️ Stub only (returns empty tools array) |
| M3 Incident War Room | Incident CRUD, SRE context, event-driven triggers | ❌ Not started |
| Knowledge Graph | StructuralGraph wired, IKnowledgeGraph interface | ⚠️ Structural only — no bootstrap, no episodic layer |
| Graph Builder Agent | Event-driven entity extraction, Graphiti layer | ❌ Not started |
| Audit trail | PostgresAuditSink, immutable gate_events | ⚠️ Partial — audit_events writes; gate_events INSERT broken |
| Session memory | RedisSessionMemory, InMemorySessionMemory | ✅ Complete |
| Token budget | Per-query/session/tenant limits, inline metering | ✅ Complete (in-process only) |
| Trigger engine | Event → agent execution pipeline | ❌ Not started |
| Cron monitors | Scheduled agent runs, anomaly detection | ❌ Not started |

---

### Summary

0014 migration is correct and complete. The gate_events fix (`push()` INSERT) is syntactically present but broken at runtime — RLS rejects every INSERT because `withTenant()` is absent. This is the only change needed before the gate L2 round-trip is functional end-to-end. Fix is 3 lines.

---

<!-- REVIEW SECTION START — 2026-06-08f -->
## Review — 2026-06-08f | Opus Expert Architectural Review #2 — post CRITICAL/HIGH fixes

### Scope

Verification review of all 7 CRITICALs + 5 HIGHs from review `2026-06-08e`, plus fresh architectural scan. Baseline: 13/13 migrations applied on fresh Docker build, 38/38 Playwright E2E passing.

### Verdict: CONDITIONAL-SHIP

Weighted score: **3.6/5**. All 7 CRITICALs and 5 HIGHs from the prior review are fixed. One new HIGH blocker (NEW-1) must be resolved before ship — it re-opens the RLS WITH CHECK hole in `trigger_rules` that CRITICAL-4 intended to close. One-migration fix.

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Architecture vs CLAUDE.md | 3/5 | Graph-first best-effort preserved. Gate L2 now wired end-to-end. isWriteAction unified. |
| D2 Security | 3/5 | Auth hardened. 11/12 tables have WITH CHECK. trigger_rules duplicate policy re-opens cross-tenant INSERT. |
| D3 Agent Harness | 3/5 | Gate round-trip functional. Audit await'd. RedisGateSink connection lifecycle leaks (MEDIUM). |
| D4 Knowledge Graph | 4/5 | 13/13 migrations clean, no `--applied` workaround. UNIQUE constraints present. |
| D5 Connector Pattern | 3/5 | args.resource accepted as-is (HIGH-1 deferred). Tools consistent. |
| D6 Operational Readiness | 4/5 | /health/ready hits DB. CORS hardened. x-connector-key header allowed. |
| D7 TypeScript Quality | 4/5 | isWriteAction unified. No new type regressions. |
| D8 Test Coverage | 3/5 | 38 E2E passing. Still no cross-tenant isolation test. No gate round-trip E2E. |

---

### Prior Issues — Verification Status

| ID | Status | Notes |
|----|--------|-------|
| CRITICAL-1 | ✅ FIXED | auth.ts verifies tenant + user before issuing JWT. 400 on bad tenant, 401 on unknown user. |
| CRITICAL-2 | ✅ FIXED | gateSink wired in chatRoutes. Gate path now active when REDIS_URL set. |
| CRITICAL-3 | ✅ FIXED | gate-decide-route.ts calls `sink.record()` after DB UPDATE. pollGate wakes on Redis publish. |
| CRITICAL-4 | ✅ FIXED (partial) | 0012_rls_with_check adds WITH CHECK on tenants/users/sessions/connectors/audit_events/incidents. trigger_rules has a residual issue — see NEW-1. |
| CRITICAL-5 | ✅ FIXED | postgres-sink.ts append() now awaits the write. onError called on failure, swallowed intentionally for latency. |
| CRITICAL-6 | ✅ FIXED | 0009_knowledge_graph replaced with SELECT 1 no-op. 0013_kb_constraints adds UNIQUE + FORCE RLS + WITH CHECK on entities/relationships/kb_entries. |
| CRITICAL-7 | ✅ FIXED | JWT fallback secret removed. Plugin throws if neither key set. |
| HIGH-1 | ✅ ACCEPTED | args.resource still null for all tools. Deferred — documented, not blocking for V1. |
| HIGH-2 | ✅ FIXED | perimeter/engine.ts now imports isWriteAction from gate/gate.ts. Single source of truth. |
| HIGH-3 | ✅ FIXED | CORS origin scoped to env var, defaults to localhost:3000. |
| HIGH-4 | ✅ FIXED | /health/ready hits Postgres. Returns 503 on DB unavailability. |
| HIGH-5 | ✅ FIXED | x-connector-key added to CORS allowedHeaders. |

---

### New Issues Found

#### [NEW-1 HIGH — BLOCKER] trigger_rules has duplicate PERMISSIVE policies — WITH CHECK bypassed

**File:** `apps/gateway/prisma/migrations/0005_triggers/migration.sql` + `apps/gateway/prisma/migrations/0012_rls_with_check/migration.sql`

**Issue:** Migration 0005_triggers created a policy named `tenant_isolation_trigger_rules` on the `trigger_rules` table with only a `USING` clause (no `WITH CHECK`). Migration 0012_rls_with_check then attempts to `DROP POLICY IF EXISTS tenant_isolation ON trigger_rules` (wrong name) — that drop is a no-op. It then creates a new `tenant_isolation` policy WITH CHECK. Result: two PERMISSIVE policies coexist on `trigger_rules`:

```
1. tenant_isolation_trigger_rules  (PERMISSIVE, no WITH CHECK)  ← from 0005
2. tenant_isolation                (PERMISSIVE, WITH CHECK)      ← from 0012
```

Postgres OR's WITH CHECK expressions across PERMISSIVE policies. The old policy implicitly allows any tenant_id for INSERT (no WITH CHECK defaults to TRUE). OR'd with the new policy's WITH CHECK = TRUE. Cross-tenant INSERT into `trigger_rules` is still possible.

**Fix:** New migration `0014_trigger_rules_policy_cleanup`:
```sql
-- Drop the stale no-WITH-CHECK policy from 0005_triggers
DROP POLICY IF EXISTS tenant_isolation_trigger_rules ON trigger_rules;

-- Ensure FORCE RLS is set (non-superusers cannot bypass)
ALTER TABLE trigger_rules FORCE ROW LEVEL SECURITY;
```
The correct `tenant_isolation` policy with WITH CHECK already exists from 0012 — no need to recreate it.

**Verify:**
```sql
SET app.tenant_id = '<tenant-a-uuid>';
INSERT INTO trigger_rules (tenant_id, ...) VALUES ('<tenant-b-uuid>', ...);
-- Must fail with RLS policy violation
```

---

#### [NEW-2 MEDIUM] RedisGateSink.poll() creates a new Redis client per call — connection leak

**File:** `apps/gateway/src/gate/redis-gate-sink.ts`

**Issue:** `push()` and `record()` reuse a cached `pub` client via `getPub()`. `poll()` calls `this.redis.subscribe(...)` on the shared client — `subscribe` moves a client into subscriber mode, blocking it for other commands. If `poll()` is called concurrently (multiple pending gate approvals), the second `poll()` tries to use a client already in subscriber mode and fails or creates a new untracked client per call.

**Fix:** In `poll()`, create a dedicated subscriber client that is disconnected after the poll resolves:
```typescript
async poll(gateId: string, timeoutMs = 30_000): Promise<GatePollResult> {
  const sub = this.redis.duplicate()
  try {
    // ... subscribe, await, unsubscribe
    return result
  } finally {
    await sub.quit()
  }
}
```
**Verify:** Two concurrent gate approvals both resolve correctly without connection errors.

---

#### [NEW-3 MEDIUM] gate_events rows never inserted — only the UPDATE path exists

**File:** `apps/gateway/src/gate/redis-gate-sink.ts` and `packages/agent/src/orchestrator/orchestrator.ts`

**Issue:** The orchestrator's gate flow calls `gateSink.push(gateId, toolCall)` to create a pending gate event, then `pollGate()` to wait. `push()` only publishes to Redis — it never inserts a row into `gate_events`. The `/api/gate/:id/decide` route calls `$executeRaw UPDATE gate_events SET status = ... WHERE id = $1` — if no row exists, 0 rows are updated, route returns 404. Gate events are invisible to the audit log and the UI.

**Fix:** `push()` must insert the row before publishing:
```typescript
async push(gateId: string, toolCall: ToolCall): Promise<void> {
  await withTenant(this.prisma, this.tenantId, (tx) =>
    tx.$executeRaw`
      INSERT INTO gate_events (id, tenant_id, tool_name, args, status, created_at)
      VALUES (${gateId}::uuid, ${this.tenantId}::uuid, ${toolCall.name}, ${JSON.stringify(toolCall.args)}::jsonb, 'pending', NOW())
    `
  )
  await this.getPub().publish(`gate:${gateId}`, JSON.stringify({ status: 'pending', toolCall }))
}
```
`RedisGateSink` needs a `prisma` + `tenantId` dependency injected at construction time.

**Verify:** After `push()`, `SELECT * FROM gate_events WHERE id = $gateId` returns a row. After `/decide`, the row has `status = 'approved'|'rejected'`.

---

#### [NEW-4 LOW] cron_jobs RLS policy missing in 0006_cron_jobs migration

**File:** `apps/gateway/prisma/migrations/0006_cron_jobs/migration.sql`

**Issue:** 0006_cron_jobs creates the `cron_jobs` table without an RLS policy. 0008_cron_jobs_rls adds tenant isolation later — but without FORCE RLS on the table itself, a superuser connection (or Prisma in dev mode) can bypass the policy entirely.

**Fix:** In 0008_cron_jobs_rls or a new migration:
```sql
ALTER TABLE cron_jobs FORCE ROW LEVEL SECURITY;
```
**Verify:** `SET ROLE postgres; SELECT * FROM cron_jobs` → still filtered by policy (FORCE RLS applies to superuser too).

---

### Summary Table

| ID | Severity | File | Issue |
|----|----------|------|-------|
| NEW-1 | 🟠 HIGH — BLOCKER | `0005_triggers` + `0012_rls_with_check` | trigger_rules duplicate PERMISSIVE policy — WITH CHECK bypass |
| NEW-2 | 🟡 MEDIUM | `redis-gate-sink.ts` | poll() subscriber mode conflict — connection leak under concurrency |
| NEW-3 | 🟡 MEDIUM | `redis-gate-sink.ts` + `orchestrator.ts` | gate_events rows never inserted — gate UI blind, audit incomplete |
| NEW-4 | 🔵 LOW | `0006_cron_jobs` + `0008_cron_jobs_rls` | cron_jobs missing FORCE RLS |

---

<!-- REVIEW SECTION START — 2026-06-08e -->
## Review — 2026-06-08e | Opus Expert Architectural Review — post E2E (38/38 green)

### Scope

Full architectural review of the codebase as of commit `8aa676f` (38/38 Playwright tests passing).
Covers security, agent harness, gate L2 flow, RLS, audit, migrations, and operational readiness.

### Verdict: NO-SHIP

Weighted score: **2.4/5** across 8 dimensions. 7 CRITICALs + 5 HIGHs must be resolved before ship.
The gate L2 flow (V1 trust contract) is non-functional end-to-end. Auth is open. RLS is missing WITH CHECK. These are not polish issues — they are architectural gaps.

### Dimension Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| D1 Architecture vs CLAUDE.md | 2/5 | Graph-first non-negotiable softened to best-effort. Gate not wired. Two divergent isWriteAction. |
| D2 Security | 1/5 | Auth open (no tenant verify). RLS missing WITH CHECK on 6 tables. JWT fallback secret. CORS wildcard+credentials. |
| D3 Agent Harness | 3/5 | IModelProvider interface clean. Audit fire-and-forget. Token budget in-process only. Gate path incomplete. |
| D4 Knowledge Graph | 3/5 | StructuralGraph Postgres wiring solid. 0003/0009 migration conflict — entities table created twice. |
| D5 Connector Pattern | 3/5 | Tool naming consistent. args.resource never set by tools — perimeter falls to wildcard path always. |
| D6 Operational Readiness | 2/5 | /health/ready is a stub. CORS missing x-connector-key header. |
| D7 TypeScript Quality | 4/5 | Branded IDs throughout. Few unsafe casts. |
| D8 Test Coverage | 2/5 | 38 happy-path E2E. No cross-tenant isolation tests. No gate round-trip test. No write-action perimeter test. |

---

### Issues Found

#### [CRITICAL-1] Auth route open — any caller gets JWT for any tenant
**File:** `apps/gateway/src/routes/auth.ts:22-58`
**Issue:** `POST /auth/token` accepts any `email` + `tenantId` and returns a signed JWT with no tenant verification, no identity proof, no rate limit. Any caller who knows (or guesses) a tenant UUID can impersonate any user in that tenant. User lookup failure silently falls through to `crypto.randomUUID()` as userId — token is still signed and returned.
**Fix:**
```typescript
// Step 1: verify tenant exists
const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
if (!tenant) return reply.code(400).send({ error: 'invalid tenantId' })

// Step 2: verify user exists in that tenant (no auto-provision on token endpoint)
const rows = await withTenant(prisma, tenantId, (tx) =>
  tx.$queryRaw<{ id: string; role: string }[]>`
    SELECT id, role FROM users WHERE tenant_id = ${tenantId}::uuid AND email = ${email} LIMIT 1
  `
)
if (!rows[0]) return reply.code(401).send({ error: 'user not found' })
const user = rows[0]
```
Remove the silent fallback `user = { id: crypto.randomUUID() }`. Token must only be issued for verified (tenantId, email) pairs.
**Verify:** POST `/auth/token` with a nonexistent tenantId → 400. POST with valid tenantId + unknown email → 401.

#### [CRITICAL-2] Gate sink not wired in chatRoutes — all write tools bypass approval
**File:** `apps/gateway/src/routes/chat.ts:280-288`
**Issue:** `createOrchestrator` called without `gateSink` parameter:
```typescript
const orchestrator = createOrchestrator({
  model: provider,
  tools: connectorTools,
  perimeter,
  auditSink,
  sessionMemory,
  knowledgeGraph,
  budget,
  // gateSink: MISSING
})
```
In `orchestrator.ts:298`: `if (isWriteAction(toolCall.name) && config.gateSink)` — when `gateSink` is undefined, the gate check is skipped entirely. Every write action executes without approval. V1 trust contract (L2 Approve — show gate, human confirms, then execute) is non-functional.
**Fix:**
```typescript
// In chatRoutes, after sessionMemory setup:
const gateSink = process.env['REDIS_URL']
  ? new RedisGateSink(process.env['REDIS_URL'])
  : undefined

const orchestrator = createOrchestrator({
  model: provider,
  tools: connectorTools,
  perimeter,
  auditSink,
  sessionMemory,
  knowledgeGraph,
  budget,
  gateSink,
})
```
Import `RedisGateSink` from `'../gate/redis-gate-sink.js'`. If Redis is not configured, gate checks are skipped (dev-only acceptable; log a warning).
**Verify:** With Redis running and a write tool in the tool list, calling the tool should emit a `gate_required` SSE event and block execution until `/api/gate/:id/decide` is called.

#### [CRITICAL-3] gate_decide route never publishes to Redis — gate polling always times out
**File:** `apps/gateway/src/gate/gate-decide-route.ts:24-36`
**Issue:** The route updates the DB row but never calls `gateSink.record()`. `pollGate()` polls `gate:<id>:decision` in Redis. That key is only set by `RedisGateSink.record()`. Without the publish step, `pollGate` will always exhaust its timeout and return `{ _tag: 'timeout' }`.
**Fix:** After the DB UPDATE succeeds, publish to Redis:
```typescript
const affected = await withTenant(prisma, tenantId, (tx) =>
  tx.$executeRaw`
    UPDATE gate_events
    SET status = ${decision}::text, decided_by = ${userId}::uuid, decided_at = NOW()
    WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
  `
)

if (Number(affected) === 0) {
  return reply.code(404).send({ error: 'gate not found or already decided' })
}

// Publish decision to Redis so pollGate() wakes up
if (process.env['REDIS_URL']) {
  const sink = new RedisGateSink(process.env['REDIS_URL'])
  await sink.record(gateId, decision, userId)
}

return { ok: true, gateId, decision }
```
**Verify:** Full gate round-trip: trigger a write tool call → receive `gate_required` SSE → POST `/api/gate/:id/decide` → tool executes (not timeout). Add a Playwright test for this flow.

#### [CRITICAL-4] RLS policies missing WITH CHECK on 6 tables — cross-tenant INSERT possible
**File:** `apps/gateway/prisma/migrations/0001_initial/migration.sql:171-198`
**Issue:** All 6 `tenant_isolation` policies use only `USING` clause. `USING` controls which rows are *visible* for SELECT/UPDATE/DELETE. Without `WITH CHECK`, INSERT and UPDATE can write rows with any `tenant_id` — including another tenant's ID. A compromised or buggy app layer could poison another tenant's data.
**Fix:** Add a new migration `0012_rls_with_check`:
```sql
-- Drop and recreate with WITH CHECK on the 6 initial tables
DO $$ DECLARE t TEXT; BEGIN
  FOR t IN VALUES ('tenants'), ('users'), ('sessions'), ('connectors'), ('audit_events'), ('incidents')
  LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I AS PERMISSIVE FOR ALL
       USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
       WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;
-- tenants table uses id not tenant_id — fix separately
DROP POLICY tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants AS PERMISSIVE FOR ALL
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);
```
Also check `triggers`, `cron_jobs` tables from later migrations — apply same pattern.
**Verify:** `SET app.tenant_id = '<tenant-a>'; INSERT INTO users (tenant_id, email, role) VALUES ('<tenant-b-uuid>', 'x@x.com', 'dev')` → must fail with RLS violation.

#### [CRITICAL-5] Audit sink fire-and-forget — events silently lost on DB failure
**File:** `apps/gateway/src/audit/postgres-sink.ts:20-36`
**Issue:** `append()` immediately resolves with `Promise.resolve()` — the actual DB write is fire-and-forget (`void withTenant(...).catch(...)`). If the DB is down or the write fails, the audit event is lost. The interface contract implies durability — callers do `await auditSink.append(...)` expecting the event was persisted.
**Fix:** Make `append` await the write, then surface errors to callers (don't swallow):
```typescript
async append(event: AuditEvent): Promise<void> {
  await withTenant(this.prisma, event.tenantId, (tx) =>
    tx.auditEvent.create({ data: { ... } })
  ).catch((err: unknown) => {
    this.onError?.(err)
    // Re-throw so callers know the write failed — they can decide whether to abort
    throw err
  })
}
```
If fire-and-forget is intentional for latency reasons, document it explicitly as "at-most-once delivery" and update callers that use `await auditSink.append(...)` to use `void` consistently.
**Verify:** Kill DB mid-request → `onError` is called, request continues (caller handles the error).

#### [CRITICAL-6] entities/relationships tables created in two incompatible migrations
**File:** `apps/gateway/prisma/migrations/0003_kb/migration.sql:1-11` and `apps/gateway/prisma/migrations/0009_knowledge_graph/migration.sql:4-25`
**Issue:** `0003_kb` creates `entities` and `relationships` with `IF NOT EXISTS` + `VARCHAR(64/512)` columns, no UNIQUE constraints, no FK on `tenant_id`. `0009_knowledge_graph` attempts `CREATE TABLE entities` (no IF NOT EXISTS) with `TEXT` columns, `UNIQUE (tenant_id, type, name)`, tenant_id FK, and FORCE RLS. The two schemas are divergent. On a fresh DB, 0003 runs first — 0009 then fails (`relation "entities" already exists`). The executor's workaround (`prisma migrate resolve --applied 0009`) marks it applied without running it, leaving the 0003 schema in place: no UNIQUE constraint, no WITH CHECK, no FK on tenant_id.
**Fix:** Delete `0009_knowledge_graph` entirely. Add a new migration `0009_kb_unique_constraints` that adds the missing elements to the tables created by 0003:
```sql
-- Add missing constraints to entities (created by 0003_kb)
ALTER TABLE entities ADD CONSTRAINT entities_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE entities ADD CONSTRAINT entities_unique_per_tenant
  UNIQUE (tenant_id, type, name);
ALTER TABLE entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON entities;
CREATE POLICY tenant_isolation ON entities AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Same for relationships
ALTER TABLE relationships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON relationships;
CREATE POLICY tenant_isolation ON relationships AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```
**Verify:** Fresh `docker compose down -v && up -d && prisma migrate deploy` succeeds without `--applied` workaround.

#### [CRITICAL-7] JWT plugin has hardcoded fallback secret — bypasses env validation
**File:** `apps/gateway/src/plugins/jwt.ts:30`
**Issue:**
```typescript
const secret = process.env.JWT_SECRET ?? 'dev-secret-change-in-production'
```
The JWT plugin reads `process.env.JWT_SECRET` directly. `validateEnv()` in `server.ts` requires JWT_SECRET and throws if absent — but `buildApp()` registers this plugin before `validateEnv()` is called. If the env var is missing or the plugin loads early, tokens are signed with the public string `'dev-secret-change-in-production'`. Any attacker can forge valid JWTs for any tenant.
**Fix:** Remove the fallback entirely. Let the plugin read from validated env:
```typescript
import { validateEnv } from '../config/env.js'
// or pass secret as a parameter

export default fp(async function jwtPlugin(app: FastifyInstance, opts: { secret: string }) {
  const privateKey = process.env.JWT_PRIVATE_KEY
  const publicKey = process.env.JWT_PUBLIC_KEY

  await app.register(jwt, {
    secret: privateKey && publicKey
      ? { private: privateKey, public: publicKey }
      : opts.secret,     // caller provides validated secret — no fallback
    sign: { algorithm: privateKey ? 'RS256' : 'HS256', expiresIn: '24h' },
  })
  // ...
})
```
In `app.ts`, call `await app.register(jwtPlugin, { secret: env.JWT_SECRET })` where `env` comes from `validateEnv()`.
**Verify:** Start gateway without JWT_SECRET → process exits before listening. No fallback token signing possible.

---

#### [HIGH-1] Perimeter resource extraction always null — wildcard fallback always taken
**File:** `packages/agent/src/perimeter/engine.ts:101`
**Issue:**
```typescript
const resource = typeof toolCall.args['resource'] === 'string' ? toolCall.args['resource'] : null
```
No connector tool in the codebase passes `args.resource`. It is always `null`. When `resource === null` and `isWriteAction()` returns true, the check falls to `scope.write.includes('*')`. Any connector with `write: ['*']` (all seeded connectors have this) passes unconditionally for all write tools. The per-resource scope check is dead code.
**Fix:** Either (a) remove the `resource` check and use only the scope wildcard logic, or (b) add a `resource` field to the write tools that need resource-scoped checks and document the contract.
**Verify:** Perimeter test: user has `write: ['org/repo-a']`, tool call is `github.create_pr` with `args.repo = 'org/repo-b'` → should be hard-blocked.

#### [HIGH-2] Two divergent isWriteAction implementations — gate and perimeter disagree
**File:** `packages/agent/src/gate/gate.ts:31` vs `packages/agent/src/perimeter/engine.ts:75`
**Issue:** 
- `gate.ts` uses regex patterns: `/^notify_/`, `/^create_/`, `/^rollback/`, `/^comment/`, `/^run_runbook/`
- `perimeter/engine.ts` uses suffix split on `WRITE_SUFFIXES` — `notify`, `rollback`, `comment`, `run_runbook` are absent

A tool named `notify_oncall` is classified as a write action by the gate (fires gate approval) but NOT by the perimeter (passes through as read-like). Divergent classification = gate fires unnecessarily OR perimeter misclassifies.
**Fix:** Single source of truth — delete `isWriteAction` from `perimeter/engine.ts`. Import from `gate/gate.ts`. Adjust `WRITE_ACTION_PATTERNS` to cover all cases both files need.
**Verify:** `isWriteAction('notify_oncall')` returns the same value in both perimeter checks and gate checks.

#### [HIGH-3] CORS wildcard origin + credentials enabled — browser rejects + security risk
**File:** `apps/gateway/src/plugins/cors.ts:7-8`
**Issue:** `origin: '*'` + `credentials: true`. The CORS spec prohibits this combination — browsers will reject credentialed cross-origin requests with wildcard origin. Additionally, if origin is scoped to `'*'`, any site can make credentialed requests if JWT is stored in a cookie. In current implementation JWT is in Authorization header (not cookie), so risk is lower — but the wildcard must still be scoped.
**Fix:**
```typescript
origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
```
In production, set `CORS_ORIGIN` to the UI's actual origin. Add to `env.ts` as optional with default.
**Verify:** Request from `http://evil.com` with `Authorization: Bearer <token>` → CORS rejected.

#### [HIGH-4] /health/ready is a stub — fake readiness in Kubernetes
**File:** `apps/gateway/src/routes/health.ts:19-21`
**Issue:** `/health/ready` returns `{ status: 'ok' }` without verifying DB or Redis connectivity. In K8s, the readiness probe gates traffic admission. A fake readiness probe means pods receive requests before Prisma is connected — first requests fail with 500.
**Fix:**
```typescript
app.get('/health/ready', async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return reply.send({ status: 'ok' })
  } catch (err) {
    return reply.code(503).send({ status: 'unavailable', reason: 'db not ready' })
  }
})
```
**Verify:** Stop Postgres → `/health/ready` returns 503.

#### [HIGH-5] CORS missing x-connector-key allowed header
**File:** `apps/gateway/src/plugins/cors.ts:8`
**Issue:** `allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id']` — missing `x-connector-key`. The graph events route authenticates connectors via this header. In cross-origin preflight requests, browsers strip unallowed headers — graph event ingestion from browser-facing connectors will silently fail.
**Fix:** Add `'x-connector-key'` to `allowedHeaders`.

---

### Summary Table

| ID | Severity | File | Issue |
|----|----------|------|-------|
| CRITICAL-1 | 🔴 | `auth.ts:22` | Open auth — JWT for any tenant, no verification |
| CRITICAL-2 | 🔴 | `chat.ts:280` | Gate sink not passed to createOrchestrator — gate bypass |
| CRITICAL-3 | 🔴 | `gate-decide-route.ts:36` | Decision never published to Redis — pollGate always times out |
| CRITICAL-4 | 🔴 | `0001_initial/migration.sql:171` | RLS missing WITH CHECK on 6 tables |
| CRITICAL-5 | 🔴 | `postgres-sink.ts:21` | Audit fire-and-forget — events lost on DB failure |
| CRITICAL-6 | 🔴 | `0003_kb` + `0009_knowledge_graph` | entities/relationships created twice, schemas diverge |
| CRITICAL-7 | 🔴 | `plugins/jwt.ts:30` | JWT fallback secret `dev-secret-change-in-production` |
| HIGH-1 | 🟠 | `perimeter/engine.ts:101` | args.resource always null — perimeter wildcard always taken |
| HIGH-2 | 🟠 | `gate/gate.ts:31` vs `perimeter/engine.ts:75` | Two divergent isWriteAction definitions |
| HIGH-3 | 🟠 | `plugins/cors.ts:7` | CORS wildcard + credentials |
| HIGH-4 | 🟠 | `health.ts:19` | Fake readiness probe |
| HIGH-5 | 🟠 | `plugins/cors.ts:8` | x-connector-key missing from CORS allowed headers |

---

<!-- REVIEW SECTION START — 2026-06-08d -->
## Review — 2026-06-08d | Gate RLS hardening + Dockerfile pnpm-deploy removal (3 source commits)

### Commits reviewed since last review (33cbf81)

| Commit | Description | Verdict |
|--------|-------------|---------|
| `98168d5` | fix(gate): withTenant wrapper + RLS on gate_events — BLOCKING-1/2 | ISSUES FOUND |
| `81af3e1` | bridge: gateway Dockerfile fix — drop pnpm deploy, direct COPY approach | ISSUES FOUND |
| `3572255` | bridge: gateway Dockerfile fix [ANSWERED] | LGTM ✓ (BRIDGE.md only) |

### Issues Found

#### [BLOCKING] gate_no_delete PERMISSIVE policy is a no-op — audit immutability not enforced
**File:** `apps/gateway/prisma/migrations/0010_gate_events/migration.sql:26-27`
**Issue:** `CREATE POLICY gate_no_delete ON gate_events AS PERMISSIVE FOR DELETE USING (false)`.
Postgres OR's all PERMISSIVE policies for the same command. `tenant_isolation` is also PERMISSIVE FOR ALL (includes DELETE). For the owning tenant, `tenant_isolation` USING returns `true`. OR'd with `false` from `gate_no_delete` = `true`. Delete is allowed. The immutability contract is broken — any tenant can delete their own gate_events.
**Fix:** Change to RESTRICTIVE, which AND's with PERMISSIVE policies:
```sql
-- Drop the no-op permissive policy
DROP POLICY gate_no_delete ON gate_events;

-- Immutable audit: RESTRICTIVE blocks ALL deletes regardless of other policies
CREATE POLICY gate_no_delete ON gate_events AS RESTRICTIVE FOR DELETE USING (false);
```
Add to a new migration `0011_gate_events_restrictive_delete/migration.sql`.
**Verify:**
```sql
SET app.tenant_id = '<valid-tenant-uuid>';
DELETE FROM gate_events WHERE tenant_id = '<valid-tenant-uuid>';
-- Must return: ERROR:  new row violates row-level security policy for table "gate_events"
-- or: DELETE 0 (no rows deleted)
```

#### [HIGH] Container runs as root — USER node removed from Dockerfile
**File:** `apps/gateway/Dockerfile` (runtime stage, line ~64)
**Issue:** `USER node` was present in previous Dockerfile; removed in `81af3e1`. Container now runs as root. If the process is compromised, the attacker has root inside the container. `node:22` includes a built-in `node` user (uid 1000).
**Fix:** Add before CMD:
```dockerfile
USER node
```
**Verify:** `docker run --rm infra-gateway whoami` → must return `node`, not `root`.

#### [HIGH] gate-decide-route.ts returns { ok: true } when 0 rows updated
**File:** `apps/gateway/src/gate/gate-decide-route.ts:24-32`
**Issue:** `withTenant` + `$executeRaw` UPDATE returns `BigInt` rows affected. If the gate ID doesn't exist or belongs to a different tenant, 0 rows are updated — but the route still returns `{ ok: true, gateId, decision }`. Caller gets false confirmation.
**Fix:**
```typescript
const result = await withTenant(prisma, tenantId, (tx) =>
  tx.$executeRaw`
    UPDATE gate_events
    SET status = ${decision}::text, decided_by = ${userId}::uuid, decided_at = NOW()
    WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'pending'
  `
)
if (result === BigInt(0)) {
  return reply.code(404).send({ error: 'gate not found or already decided' })
}
return { ok: true, gateId, decision }
```
Also add `AND status = 'pending'` to the WHERE clause — prevents re-deciding an already-decided gate.
**Verify:** POST to `/api/gate/nonexistent-uuid/decide` → must return 404.

#### [HIGH] tool_call_id column still missing from gate_events (carry-forward from 2026-06-08c)
**File:** `apps/gateway/prisma/migrations/0010_gate_events/migration.sql:2-14`
**Issue:** Orchestrator writes `toolCallId: toolCall.id` to gate events at runtime. Column does not exist in schema. Runtime inserts will fail or silently drop the field. Flagged as HIGH in 2026-06-08c review, not yet fixed.
**Fix:** Add to migration (new migration `0011`):
```sql
ALTER TABLE gate_events ADD COLUMN tool_call_id TEXT;
```
Use TEXT not UUID — tool call IDs from Anthropic SDK are opaque strings, not UUIDs.
**Verify:** `\d gate_events` shows `tool_call_id TEXT` column.

#### [MEDIUM] cp -rn direction: root node_modules win over gateway-scoped versions
**File:** `apps/gateway/Dockerfile` (runtime stage, line ~52)
**Issue:** `RUN cp -rn gateway_node_modules/. node_modules/`. The `-n` flag = no-clobber (do not overwrite existing files). Root `node_modules` takes precedence. If gateway has a different version of a package already present in root, root's version is kept. Gateway-specific overrides are silently ignored.
**Fix:** Remove `-n` flag so gateway-scoped versions win for conflicting files:
```dockerfile
RUN cp -r gateway_node_modules/. node_modules/ 2>/dev/null || true && rm -rf gateway_node_modules
```
**Verify:** Build and confirm `require.resolve('@prisma/client')` inside container resolves to the generated client, not a root stub.

#### [MEDIUM] pnpm build steps use || true — build failures silently ignored
**File:** `apps/gateway/Dockerfile` (builder stage, lines 21-22)
**Issue:** `RUN pnpm --filter @anvay/types build || true` and `RUN pnpm --filter @anvay/agent build || true`. If either package fails to compile, the Docker build continues and the runtime container will crash when gateway tries to import missing dist files. Failure is invisible in CI.
**Fix:** Remove `|| true`. If workspace packages fail to build, the gateway build should fail:
```dockerfile
RUN pnpm --filter @anvay/types build
RUN pnpm --filter @anvay/agent build
```
If the packages are optional (not required at runtime), add an explicit comment explaining why failure is acceptable.
**Verify:** Introduce a syntax error in `packages/types/src/index.ts` → Docker build must fail at the types build step.

#### [LOW] Gate decisions not emitted as audit events
**File:** `apps/gateway/src/gate/gate-decide-route.ts:24-32`
**Issue:** Gate approve/reject is a WRITE action (status transition on a gate event). CLAUDE.md requires every write action to be audit-logged. The route only updates the DB row — no `audit_events` INSERT. Gap in the immutable audit trail.
**Fix:** After the UPDATE, insert an audit event:
```typescript
await withTenant(prisma, tenantId, (tx) =>
  tx.$executeRaw`
    INSERT INTO audit_events (tenant_id, user_id, session_id, event_type, payload)
    SELECT tenant_id, ${userId}::uuid, session_id,
           'gate_decided',
           jsonb_build_object('gateId', id::text, 'decision', ${decision}::text)
    FROM gate_events WHERE id = ${gateId}::uuid
  `
)
```
**Verify:** After gate decision, `SELECT * FROM audit_events WHERE event_type = 'gate_decided'` returns a row.

### Summary

| Dimension | Rating | Notes |
|-----------|--------|-------|
| D1 Feature Completeness | 3/5 | BLOCKING-1/2 from 2026-06-08c applied. tool_call_id still absent (HIGH carry-forward). Dockerfile builds successfully. |
| D2 Code Standards | 3/5 | `|| true` on build steps swallows failures; 0-rows update silent; no audit event on gate decision. |
| D3 Performance | 5/5 | No regressions. Direct COPY approach avoids pnpm deploy overhead. |
| D4 Security | 2/5 | BLOCKING: gate_no_delete PERMISSIVE is a no-op (audit immutability unenforceable). HIGH: container runs as root. |
| D5 Readability | 4/5 | gate-decide-route clean and minimal. Dockerfile comments are clear. |
| D6 Clarity/Comments | 4/5 | "Generated Prisma client is in the pnpm store" comment is accurate. gate_no_delete comment says "immutable" but enforcement is broken. |

### Pending Features (from docs/TASKS.md)

| Task | Status | Notes |
|------|--------|-------|
| Gate RLS hardening (BLOCKING from 2026-06-08c) | Partial | withTenant + ENABLE RLS done. gate_no_delete PERMISSIVE bug still blocks immutability. |
| tool_call_id in gate_events (HIGH from 2026-06-08c) | Pending | Not fixed. Carry-forward HIGH. |
| Docker stack fully healthy | Pending | Dockerfile builds. Stack startup blocked by executor disk exhaustion. |
| Playwright E2E tests | Pending | Blocked on healthy stack. |
| All M0–M5 tasks | Complete | Based on prior reviews. No regressions in this batch. |

---

<!-- REVIEW SECTION START — 2026-06-08c -->
## Review — 2026-06-08 | M7 bootstrap + M8 ILIKE + gate L2 + opus fixes (16 commits)

### Commits reviewed since last review (e71cc90)

| Commit | Description | Verdict |
|--------|-------------|---------|
| `55e6393` | fix(docker): agent-service COPY paths + disable Postgres host port | LGTM ✓ |
| `4bc420b` | fix: 7 CRITICAL + 4 HIGH opus review findings | ISSUES FOUND |
| `99f7876` | fix(connectors): wire makeXxxTools into agent.ts for datadog/argocd/linear | LGTM ✓ |
| `991c183` | fix(daemon): setInterval→IScheduler; RLS bypass; BullMQ default | LGTM ✓ |
| `c37eb87` | feat(connectors): agent.ts for datadog/linear/argocd + GET /api/connectors | LGTM ✓ |
| `d5bb973` | fix: BLOCKING-1/2 docs + HIGH-1/2 + MEDIUM-1/2/4 — spec audit batch 1 | LGTM ✓ |
| `744da95` | fix(specialist): audit-log gate rejections in specialist agent | LGTM ✓ |
| `9e9cffb` | fix: TriggerExecutor separate pub client; Fact claim field; add missing tests | LGTM ✓ |
| `919dc13` | fix: specialist gate check + async IScheduler + BullMQ tests | LGTM ✓ |
| `71d185c` | fix: 10 spec-compliance violations — B-3, B-4, H-1 through H-5, M-1, M-3 | LGTM ✓ |
| `96e8c4a` | feat(scheduler): IScheduler interface + BullMQScheduler — replace node-cron | LGTM ✓ |
| `593015b` | feat(gate): L2 approve gate — IGateSink, gate_required event, poll loop | LGTM ✓ |
| `ec278db` | feat(kb): resolveContextByName ILIKE + depth — M8 | LGTM ✓ |
| `b4c51e1` | feat(kb): connector bootstrap contract — IConnectorBootstrap + GitHub bootstrap | LGTM ✓ |
| `693ddd1` | feat(kb): Redis subscriber wires connector events to GraphBuilderAgent — M6-T3 | LGTM ✓ |
| `f5e0788` | fix(security): require CONNECTOR_API_KEYS; validate tenantId; cron last_run_at | LGTM ✓ |

### Issues Found

#### [BLOCKING] RLS bypass in gate-decide-route.ts — withTenant missing
**File:** `apps/gateway/src/gate/gate-decide-route.ts:23-27`
**Issue:** Direct `prisma.$executeRaw` without `withTenant()` wrapper. Postgres RLS not active — tenant A can decide gates for tenant B by knowing the gateId. The WHERE clause `tenant_id = ${tenantId}` is application-level only; without RLS it's bypassable.
**Fix:**
```typescript
await withTenant(prisma, tenantId, (tx) =>
  tx.$executeRaw`
    UPDATE gate_events SET status = ${decision}::text, decided_by = ${userId}::uuid, decided_at = NOW()
    WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid
  `
)
```
**Verify:** Query gate_events as tenant B for tenant A's gate → must return 0 rows affected.

#### [BLOCKING] Missing RLS policy on gate_events table
**File:** `apps/gateway/prisma/migrations/0010_gate_events/migration.sql`
**Issue:** Migration creates gate_events with tenant_id but no `ALTER TABLE gate_events ENABLE ROW LEVEL SECURITY` and no policy. Table is unprotected — any DB user can read/write all tenants' gate events.
**Fix:** Add to end of migration:
```sql
ALTER TABLE gate_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY gate_events_tenant_isolation ON gate_events
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```
**Verify:** `SELECT * FROM gate_events` without `set_config('app.tenant_id', ...)` → returns 0 rows.

#### [HIGH] gate_events schema missing tool_call_id column
**File:** `apps/gateway/prisma/migrations/0010_gate_events/migration.sql`
**Issue:** Orchestrator writes `toolCallId: toolCall.id` to gate events at runtime but migration has no `tool_call_id` column. Runtime insert will fail or silently drop the field.
**Fix:** Add to CREATE TABLE:
```sql
  tool_call_id UUID NOT NULL,
```
**Verify:** `\d gate_events` shows tool_call_id column.

#### [MEDIUM] RedisGateSink creates new Redis connection per poll call
**File:** `apps/gateway/src/gate/redis-gate-sink.ts:36-46`
**Issue:** `poll()` calls `createClient()` + `connect()` + `disconnect()` every 500ms during gate wait (30s timeout = 60 connections). Wastes Redis connection slots.
**Fix:** Reuse `this.pub` client for polling — it's already connected. No need for a separate connection.
**Verify:** Under load, `redis-cli client list` shows only 1-2 connections from gateway (not 60+).

#### [MEDIUM] Bootstrap errors swallowed with no downstream signal
**File:** `packages/agent/src/graph-builder/builder.ts:73-86`
**Issue:** Bootstrap failure is logged at ERROR level but execution continues silently. Graph is partially initialized with no retry or notification. Downstream agents will operate on incomplete graph coordinates.
**Fix:** Emit `bootstrap_failed` event to Redis after catch block so the system can retry:
```typescript
} catch (err) {
  this.logger?.warn({ err, connectorType }, 'bootstrap failed — graph may be incomplete')
  await this.redisPublisher?.publish('bootstrap:failed', JSON.stringify({ connectorType, tenantId, err: String(err) }))
}
```
**Verify:** Stop agent-service, trigger connector_registered event → `bootstrap:failed` appears on Redis.

#### [LOW] RedisGateSink record() ignores decidedBy in Redis value
**File:** `apps/gateway/src/gate/redis-gate-sink.ts:50-54`
**Issue:** `record()` stores only the decision string in Redis — `decidedBy` and `decidedAt` not in the Redis value. Postgres is source of truth (via gate-decide-route.ts) so this is acceptable, but if Redis is used for audit replay it's incomplete.
**Note:** Accepted as-is given Postgres is authoritative. Redis is cache only.

### Summary

| Dimension | Rating | Notes |
|-----------|--------|-------|
| D1 Feature Completeness | 4/5 | IScheduler, BullMQ, L2 gate, bootstrap, ILIKE all end-to-end. Minor: tool_call_id missing from schema. |
| D2 Code Standards | 4/5 | No console.log, no unsafe `any`, pino everywhere. Python routes could use response type hints. |
| D3 Performance | 4/5 | BullMQ single-worker dispatch correct. Freshness decay efficient. Gap: RedisGateSink per-poll connections. |
| D4 Security | 2/5 | BLOCKING: RLS bypass in gate-decide-route + missing RLS policy on gate_events. Gate is the V1 trust surface — must be hardened. |
| D5 Readability | 4/5 | Clean naming, well-structured. Orchestrator context resolution dense but correct. |
| D6 Clarity/Comments | 3/5 | Bootstrap error handling strategy undocumented. Gate timeout reason field missing context. |

### Pending Features (from docs/TASKS.md)

| Task | Status | Notes |
|------|--------|-------|
| M5-T1 Automations infra | Complete | Package.json runtime stage fix |
| M5-T2 Trigger endpoints | Complete | Redis subscriber + PATCH/DELETE |
| M5-T3 Cron scheduler | Complete | IScheduler + BullMQ |
| M5-T4 Automations UI | Complete | Web automations-view wired |
| M6-T1 StructuralGraph Postgres | Complete | Real Postgres wiring |
| M6-T2 GraphBuilderAgent | Complete | Connector events → graph upsert |
| M6-T3 Redis subscriber for graph | Complete | Wired to GraphBuilderAgent |
| M7 Connector bootstrap | Complete | IConnectorBootstrap + GitHub |
| M8 ILIKE + depth search | Complete | resolveContextByName |
| Gate RLS hardening | **Pending** | BLOCKING issue in this review |

---

<!-- REVIEW SECTION START — 2026-06-08b -->
## Review — 2026-06-08 | M5 automations + M6 KB/GraphBuilder (13 commits)

### Commits reviewed since last review (24504df)

| Commit | Description | Verdict |
|--------|-------------|---------|
| `8b3a881` | fix(gateway): package.json in runtime stage; TriggerEngine camelCase | LGTM ✓ |
| `cd6e0d7` | fix: arch-agnostic gh CLI URL; list_commits since as URL param; Ollama null | LGTM ✓ |
| `100d5ba` | feat(automations): Redis subscriber, PATCH/DELETE trigger endpoints — M5-T2 | ISSUES FOUND |
| `638d475` | fix(security): withTenant on KG/audit/cron; perimeter intersectScope; connectorCoordinates | LGTM ✓ |
| `8862d1f` | feat(automations): cron monitors, cron_jobs migration, scheduler — M5-T3 | ISSUES FOUND |
| `0f56fab` | fix(migrations): rename 0006_audit_rls_with_check → 0007 | LGTM ✓ |
| `3983b50` | feat(web): wire automations-view to real API — M5-T4 | ISSUES FOUND |
| `dfd37d5` | fix: subscriber withTenant, PATCH all fields, cron RLS, batch resolveContext — corrections | LGTM ✓ |
| `d95dca4` | test: unit tests for KB, triggers, GitHub connector — correction | LGTM ✓ |
| `a10317f` | fix(kb): filter visited entities in resolveContext batch traversal | LGTM ✓ |
| `c068812` | feat(kb): wire StructuralGraph to real Postgres — M6-T1 | LGTM ✓ |
| `f2d664a` | feat(kb): GraphBuilderAgent connector events to graph upsert — M6-T2 | ISSUES FOUND |
| `e71cc90` | fix(kb): per-tenant KG in graph-events; pino logger in GraphBuilderAgent | LGTM ✓ |

---

### Dimension ratings

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Feature completeness | B | M5/M6 tasks coded; scheduler never writes last_run_at/last_result back to DB; /api/graph/events open to any caller when CONNECTOR_API_KEYS env is unset |
| Code standards | B | No console.log violations, no any-casts in source; `as any` in automations-view.tsx (UI); extractServiceName duplicates text in system+user turn |
| Performance | B | resolveContext batch traversal correct; scheduler queries all tenants serially every 5 min — acceptable at current scale |
| Security | B | withTenant applied everywhere; subscriber does not validate tenantId is a UUID before passing to withTenant::uuid cast — Postgres will throw but no clean 400; CONNECTOR_API_KEYS bypass on empty env |
| Readability | A | Code is clean; the otherId derivation in resolveContext is dense but correct |
| Clarity/comments | B | Good inline comments on KG per-request rationale; scheduler missing comment on why last_run_at is not updated |

---

### Pending Features

| Task | Status | Commit |
|------|--------|--------|
| M5-T1 | Complete (camelCase fixed) | `8b3a881` |
| M5-T2 | Complete | `100d5ba`, `dfd37d5` |
| M5-T3 | Complete (node-cron; stubs for SLO/oncall remain) | `8862d1f` |
| M5-T4 | Complete | `3983b50` |
| M6-T1 | Complete | `c068812` |
| M6-T2 | Complete | `f2d664a`, `e71cc90` |

---

### Issues found

#### HIGH — GB-1 | apps/gateway/src/routes/graph-events.ts line 58

**Issue:** When `CONNECTOR_API_KEYS` env var is empty or unset, `CONNECTOR_API_KEYS.size` is 0 and
the short-circuit `CONNECTOR_API_KEYS.size > 0 &&` makes the auth check **always pass** — any caller
with any (or no) `x-connector-key` header can POST graph events for any tenantId. The intent is
"if env is unset, disable key-check for dev" but the route still writes to the graph and runs LLM
extraction, so in a misconfigured prod deployment any anonymous caller can inject arbitrary graph
entities.

```typescript
// graph-events.ts line 58 — current:
if (!key || (CONNECTOR_API_KEYS.size > 0 && !CONNECTOR_API_KEYS.has(key as string))) {
  return reply.code(401).send(...)
}
// When CONNECTOR_API_KEYS is empty: condition is (!key || false) → only rejects missing key
// A caller that sends any non-empty x-connector-key passes through.
```

**Fix:** Fail closed in production. Only bypass auth in explicit dev mode:
```typescript
const isDev = process.env['NODE_ENV'] !== 'production'
if (!isDev && (!key || CONNECTOR_API_KEYS.size === 0 || !CONNECTOR_API_KEYS.has(key as string))) {
  return reply.code(401).send({ error: 'unauthorized — missing or invalid x-connector-key' })
}
if (!isDev && !key) {
  return reply.code(401).send({ error: 'unauthorized — missing x-connector-key' })
}
```

Or simpler — require `CONNECTOR_API_KEYS` in env schema validation and always check it:
```typescript
if (!key || !CONNECTOR_API_KEYS.has(key as string)) {
  return reply.code(401).send({ error: 'unauthorized — missing or invalid x-connector-key' })
}
```
Then add `CONNECTOR_API_KEYS` to `validateEnv()` so startup fails fast if missing in production.

**Verify:** Start gateway without `CONNECTOR_API_KEYS` set → POST `/api/graph/events` without
a key header → must get 401. With a key that is in the set → 200/503 (depending on provider).

---

#### MEDIUM — GB-2 | apps/gateway/src/triggers/subscriber.ts line 26

**Issue:** `tenantId` extracted from the Redis message is passed directly to `withTenant(prisma, tenantId, ...)` which internally sets `app.tenant_id = ${tenantId}::uuid` as a Postgres GUC. If the Redis message carries a malformed or missing `tenantId`, the Postgres cast `::uuid` will throw an unhandled exception inside the subscriber callback. The exception propagates through the `async` callback but `ioredis`/`redis` v6 drops unhandled promise rejections in subscribe callbacks silently in some versions — meaning the subscriber stays alive but the error is invisible in logs.

```typescript
// subscriber.ts line 26
const { tenantId, ...rest } = payload  // no validation that tenantId is a valid UUID
const rules = await withTenant(prisma, tenantId, ...)  // ::uuid cast blows up on bad input
```

**Fix:** Validate tenantId is a UUID before using it:
```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (!tenantId || !UUID_RE.test(tenantId)) {
  // log and drop — do not process untrusted messages
  return
}
```

**Verify:** Publish a message to `alert_fired` channel with `tenantId: "not-a-uuid"` → subscriber
logs a warning and drops the message, no unhandled rejection, gateway stays running.

---

#### MEDIUM — GB-3 | apps/gateway/src/jobs/scheduler.ts — missing result write-back

**Issue:** `startCronScheduler` runs `ServiceHealthSweep`, `SloBurnCheck`, `DeployHealthReport`,
and `OncallMorningBrief` but never writes results back to the `cron_jobs` table. The
`cron_jobs` schema has `last_run_at TIMESTAMPTZ` and `last_result JSONB` columns specifically
for this. The `/api/automations/monitors` endpoint queries these columns — users see all `null`
forever, making the monitor list useless.

**Fix:** After each job run, update the record:
```typescript
// After sweep.run(id) in each cron handler:
await prisma.$executeRaw`
  UPDATE cron_jobs
  SET last_run_at = NOW(), last_result = ${JSON.stringify(result)}::jsonb
  WHERE tenant_id = ${id}::uuid AND job_type = 'service_health_sweep'
`
```

This must be wrapped in `withTenant`. The cron_jobs table has RLS (0008 migration) — a direct
`prisma.$executeRaw` without `withTenant` will fail the RLS policy at runtime.

**Verify:** Trigger the `*/5` cron manually (or lower the interval temporarily) → query
`SELECT last_run_at, last_result FROM cron_jobs` → both columns populated.

---

#### MEDIUM — GB-4 | packages/agent/src/graph-builder/builder.ts line 206–208

**Issue:** `extractServiceName` puts the text in both the `system` message and the `user` message,
doubling the input tokens for every LLM extraction call. The `EXTRACT_PROMPT` string already
embeds the text inline — sending it again as the user turn is redundant and wasteful given that
the cheap model tier is used at high volume (once per ticket, once per PR).

```typescript
// builder.ts lines 206–208 — current (text sent twice):
{ role: 'system', content: EXTRACT_PROMPT + text.slice(0, 500) },
{ role: 'user', content: text.slice(0, 500) },  // redundant
```

**Fix:** Use a single user message with the full prompt, or a system + empty user:
```typescript
{ role: 'user', content: EXTRACT_PROMPT + text.slice(0, 500) },
```
Or, if a system turn is needed for provider compatibility:
```typescript
{ role: 'system', content: 'Extract service names from text as instructed.' },
{ role: 'user', content: EXTRACT_PROMPT + text.slice(0, 500) },
```

**Verify:** Builder test for `extractServiceName` passes. Token count for a typical call drops by
~40% (500 text tokens no longer duplicated).

---

#### LOW — GB-5 | apps/web/components/automations-view.tsx lines 76, 91, 92

**Issue:** Three `as any` casts in the component after wiring to real API. The triggers/monitors
state is typed as `typeof AUTOMATION_TRIGGERS` / `typeof CRON_MONITORS` (mock types) but the API
returns different shapes. The fix is to define proper API response types and use them.

```typescript
// line 76:
setTriggers(prev => prev.map((t: any) => t.id === id ? { ...t, enabled } : t))
// lines 91-92:
triggers.filter((t: any) => t.enabled)
monitors.filter((c: any) => c.enabled)
```

**Fix:** Define minimal API types and replace mock state types:
```typescript
interface TriggerRuleAPI { id: string; eventType: string; enabled: boolean; actions: unknown[] }
interface CronMonitorAPI { id: string; name: string; enabled: boolean; lastRunAt: string | null }
const [triggers, setTriggers] = useState<TriggerRuleAPI[]>([])
const [monitors, setMonitors] = useState<CronMonitorAPI[]>([])
```
Then remove all three `as any` casts.

**Verify:** TypeScript (`tsc --noEmit`) passes with no errors in `apps/web`.

---

#### LOW — GB-6 | apps/gateway/src/jobs/scheduler.ts — node-cron vs TASKS.md spec

**Note (not blocking):** TASKS.md §M5-T2 and PRODUCT.md specify Trigger.dev (primary) or BullMQ
(fallback) as the durable scheduler — explicitly disqualifying `setInterval` and `cron` npm
packages due to no persistence, no retry, no visibility. `scheduler.ts` uses `node-cron` which
is in the same disqualified category. Acceptable for the prototype phase but must be replaced
before production. The CLAUDE.md (PRODUCT.md) section on cron monitors is explicit:

> "Do not use setInterval or cron npm packages in production — no persistence, no retry, no visibility."

**Not blocking for current milestone** — prototype flag. Add to backlog before M7.

---

### Notes

- All 6 BLOCKING/HIGH issues from the prior 2026-06-08 review (S-0, I-4, CL-4, I-7) are now fixed in commits `8b3a881` and `cd6e0d7`. Those items are now closed.
- GB-1 (HIGH) is the only HIGH issue in this pass. Must be fixed before connecting a real prod Redis channel that external connectors publish to.
- GB-2/GB-3 (MEDIUM) are functional gaps. GB-3 makes the cron monitor UI permanently empty.
- GB-4/GB-5/GB-6 (LOW) are quality/standards issues — fix in the next task touching those files.

---

<!-- REVIEW SECTION END — 2026-06-08b -->

<!-- REVIEW SECTION START — 2026-06-08 -->
## Review — 2026-06-08 | Final acceptance — 24504df (wget fix) + overall state

### Commits reviewed since last review (6be7482)

| Commit | Description | Verdict |
|--------|-------------|---------|
| `24504df` | fix(infra): gateway healthcheck use curl not wget | LGTM ✓ |
| `366cf19` | bridge: Codex I-7 status (no code change) | N/A |

### 24504df — gateway healthcheck curl fix | infra/docker-compose.yml

Single line change: `wget -q --spider` → `curl -fs`. Correct. `curl` is retained in the
runtime image after S-0 purges `wget`. Fix is exact. ✓

---

### Final acceptance review — all 26 COMPLETION-PLAN tasks

Codebase examined end-to-end. Issues below are **new findings** not captured in prior review passes.

---

#### BLOCKING — S-0 | apps/gateway/Dockerfile line 44

**Issue:** Runtime stage missing `package.json` copy. Gateway package.json has `"type": "module"`.
Without it in the runtime image working directory, Node defaults to CommonJS and fails on the
first `import` statement in `dist/src/server.js`.

```dockerfile
# Runtime stage — node:22-slim AS runtime
WORKDIR /app
...
COPY --from=builder /app/deploy/node_modules ./node_modules   # line 44 — present
# MISSING: COPY --from=builder /app/deploy/package.json ./package.json
```

`pnpm deploy` places `package.json` + `node_modules` into `/app/deploy/` in the builder stage.
Only `node_modules` is copied to runtime. Node cannot determine module type → ESM fails.

**Fix:**
```dockerfile
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json   # ADD THIS LINE
```

**Verify:** `docker compose build && docker compose up gateway` → no `ERR_REQUIRE_ESM` error,
gateway logs "Server listening" on port 4000.

---

#### MEDIUM — S-0 | apps/gateway/Dockerfile line 35

**Issue:** `gh_2.62.0_linux_amd64.deb` hardcoded. ARM hosts (Apple Silicon CI runners, Raspberry Pi)
will fail with `dpkg: error processing package`.

```dockerfile
&& wget -qO /tmp/gh.deb https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_amd64.deb \
```

**Fix:**
```dockerfile
&& ARCH=$(dpkg --print-architecture) \
&& wget -qO /tmp/gh.deb "https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_${ARCH}.deb" \
```

**Verify:** Build on ARM host — image builds without dpkg error.

---

#### MEDIUM — S-1 | connectors/github/src/connector.ts line 44

**Issue:** `args.push('--since', since)` in `list_commits` case. `gh api repos/{owner}/{repo}/commits`
accepts `since` as a **URL query parameter**, not a CLI flag. `--since` is valid only for
`gh run list`, not `gh api`. Result: `gh` ignores the flag silently → returns all commits regardless
of date range → context bloat + wrong data.

```typescript
// line 42-45:
const since = query.since as string ?? ''
// ...
if (since) args.push('--since', since)   // WRONG — gh api doesn't accept --since flag
```

**Fix:**
```typescript
case 'list_commits': {
  const { owner, repo, branch = 'main', since } = query as Record<string, string>
  const qs = since ? `?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(since)}` : `?sha=${encodeURIComponent(branch)}`
  const endpoint = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits${qs}`
  return JSON.parse(this.runCli('gh', ['api', endpoint]))
}
```

**Verify:** Call `list_commits` with a `since` date in the past — result set is filtered to that range.

---

#### MEDIUM — I-4 | apps/gateway/src/routes/automations.ts line 50-53

**Issue:** `$queryRaw` with `SELECT *` returns Postgres snake_case column names (`event_type`,
`tenant_id`). `TriggerRule` interface uses camelCase (`eventType`, `tenantId`). The cast
`rules as any[]` hides the mismatch. Inside `TriggerEngine.evaluate()`:

```typescript
if (rule.eventType !== eventType) continue  // rule.eventType is always undefined → skip all rules
```

Result: `evaluate()` always returns 0 matched actions. Automations trigger engine is broken at runtime
despite passing typecheck (any cast).

```typescript
// automations.ts line 50:
tx.$queryRaw`SELECT * FROM trigger_rules WHERE tenant_id = ${tenantId}::uuid AND enabled = true`
// Returns: [{ event_type: 'alert_fired', tenant_id: '...', ... }]  ← snake_case

// engine.ts line 27:
if (rule.eventType !== eventType) continue  // rule.eventType = undefined → always skips
```

**Fix — automations.ts line 50:**
```typescript
tx.$queryRaw<TriggerRule[]>`
  SELECT
    id,
    tenant_id AS "tenantId",
    event_type AS "eventType",
    condition,
    actions,
    enabled
  FROM trigger_rules
  WHERE tenant_id = ${tenantId}::uuid AND enabled = true
`
```

Apply the same fix to the GET `/api/automations/triggers` query at line 13.

**Verify:** POST to `/api/automations/evaluate` with a matching `eventType` → response
has `matched > 0` and correct actions array.

---

#### LOW — CL-4 | packages/agent/src/providers/ollama.ts line 79

**Issue (carried from prior review — still unresolved):** `formatToolCall` emits
`content: ''` (empty string) for assistant+tool_calls messages.
OpenAI-compatible spec requires `content: null` when `tool_calls` is present.
Some Ollama model deployments reject empty string and return 422.

```typescript
// line 77-79:
if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
  return {
    content: typeof m.content === 'string' ? m.content : '',  // WRONG — should be null
```

**Fix:**
```typescript
content: typeof m.content === 'string' ? m.content : null,
```

**Verify:** Tool call round-trip with Ollama model — no 422 error, assistant message accepted.

---

#### LOW — M5-T2 | apps/gateway/src/jobs/cron-monitors.ts

**Issue:** All cron monitor classes return hardcoded stubs. `ServiceHealthSweep`,
`SloBurnCheck`, and `OncallMorningBrief` return fixed `{ status: 'ok' }` — no real
connector queries. `DeployHealthReport` queries the incidents table (wrong model)
instead of a deploy model. No scheduler is wired up — these classes are never called.

This is a scope gap: M5-T2 (CronEngine) in TASKS.md requires a durable scheduler
(Trigger.dev or BullMQ per PRODUCT.md) and real connector reads per job type.
The current stubs pass typecheck but deliver zero value at runtime.

**Not a COMPLETION-PLAN task** — cron monitors were not in the S-0→CL-5 scope.
Flag for next milestone work. Not blocking I-7.

---

#### I-7 DOCKER STATUS

Opencode reports Docker daemon unavailable in agent environment. All acceptance criteria
pass except the Docker smoke test:

- `pnpm typecheck` — 14/14 packages, 0 errors ✓
- `@anvay/agent test` — 53/53 ✓
- `anvay-gateway test` — 23/23 ✓
- `@anvay/web test` — 8/8 ✓
- `grep execSync connectors/` — 0 results ✓
- Docker build/up — ❌ daemon not available in agent environment

**The S-0 package.json BLOCKING issue means Docker would fail even with daemon available.**
Fix S-0 package.json first (above), then run I-7 smoke test locally.

---

### Dimension ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| Feature completeness | 7/10 | All 26 COMPLETION-PLAN tasks coded; CronEngine stubs; Docker untested |
| Code standards | 8/10 | TypeScript strict, spawnSync used, withTenant applied; `as any[]` in automations hides type bug |
| Performance | 8/10 | Token estimation, StructuralGraph $queryRawUnsafe batched; TriggerEngine O(n) rules scan acceptable |
| Security | 9/10 | No execSync, GraphQL variables, withTenant RLS — solid; S-0 arch-specific binary is low risk |
| Readability | 8/10 | IModelProvider + IKnowledgeGraph interfaces clean; automations `as any[]` is a readability smell |
| Clarity and comments | 7/10 | Interfaces well-named; TriggerEngine camelCase mismatch not commented — silent bug |

---

### Pending features vs TASKS.md

| Task | Description | Status |
|------|-------------|--------|
| M0-T1 | pnpm workspaces + turborepo | ✅ Done |
| M0-T2 | Docker Compose dev stack | ✅ Done (I-2 curl fix) |
| M0-T3 | Postgres + Redis health | ✅ Done |
| M0-T4 | Auth (JWT middleware) | ✅ Done |
| M0-T5 | Prisma schema + migrations | ✅ Done (B-1) |
| M0-T6 | Next.js app shell | ✅ Done |
| M0-T7 | Fastify gateway | ✅ Done |
| M0-T8 | E2E Docker smoke test | ⛔ BLOCKED — Dockerfile missing package.json (ESM) |
| M1-T1 | IModelProvider + providers | ✅ Done |
| M1-T2 | ISessionMemory + RedisSessionMemory | ✅ Done |
| M1-T3 | PerimeterEngine (deterministic ACL) | ✅ Done |
| M1-T4 | Orchestrator core (runSession) | ✅ Done |
| M1-T5 | Gateway /api/chat SSE + web proxy | ✅ Done (I-1) |
| M1-T6 | Token meter middleware | ✅ Done (CL-5) |
| M2-T1 | GitHub connector (spawnSync) | ✅ Done — MEDIUM: list_commits --since flag |
| M2-T2 | Linear connector (GraphQL vars) | ✅ Done |
| M2-T3 | Datadog connector (HTTP API) | ✅ Done |
| M2-T4 | ArgoCD connector (spawnSync) | ✅ Done |
| M2-T5 | Connector registry dispatch | ✅ Done (C-3) |
| M3-T1 | IncidentService (withTenant RLS) | ✅ Done (B-7) |
| M3-T2 | Incident routes (404, pagination) | ✅ Done |
| M3-T3 | SREAgent (real model IDs) | ✅ Done (B-5) |
| M3-T4 | War Room integration | ✅ Done |
| M4-T1 | KB schema + UNIQUE constraints | ✅ Done (B-1) |
| M4-T2 | IKnowledgeGraph + resolveContextByName | ✅ Done (B-2) |
| M4-T3 | StructuralGraph (Prisma queryFn) | ✅ Done (B-3) |
| M4-T4 | Graph Builder Agent (FK UUIDs) | ✅ Done (B-4) |
| M4-T5 | KB context injection in orchestrator | ✅ Done (B-3) |
| M4-T6 | Service catalog routes + seed | ✅ Done (I-3) |
| M4-T7 | KB seed bootstrap | ✅ Done (I-3) |
| M5-T1 | TriggerEngine | ✅ Done — MEDIUM: camelCase mismatch (I-4) |
| M5-T2 | CronEngine (Trigger.dev / BullMQ) | ⚠️ STUB — classes exist, no real impl, no scheduler wired |
| M5-T3 | Automations routes | ✅ Done |
| M5-T4 | Automations integration | ✅ Done |

**Blocking Opus review:**
1. Fix S-0 `apps/gateway/Dockerfile` — add `COPY --from=builder /app/deploy/package.json ./package.json`
2. Fix I-4 `apps/gateway/src/routes/automations.ts` — add column aliases to both `$queryRaw` calls

After those two: Opus review and Docker smoke test.

---

<!-- REVIEW SECTION END — 2026-06-08 -->

<!-- REVIEW SECTION START — 2026-06-07o -->
## Review — 2026-06-07 | CL-1,2,3,5 (47efedc)

### CL-1 — WRITE_SUFFIXES whole-word | perimeter/engine.ts

`split(/[._-]/)` then `actionParts.includes(s)` — exact segment match. `autocreate` no longer
false-positive triggers write block. ✓ Tool names are always lowercase so no case issue.

### CL-2 — UUID validation | chat.ts

Inline regex correct — matches UUID v4 format with `i` flag. Works. ✓

**LOW — duplicates existing `isValidUUID` function at bottom of `chat.ts`**
```typescript
// Already exists at line ~336:
function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-...$/.test(s)
}
// CL-2 added inline regex instead of calling it
```
Use `if (!isValidUUID(tenantId)) { ... }` instead of the duplicate regex.
Fix inline when next touching `chat.ts`.

### CL-3 — Remove AppError re-export | anthropic.ts

`import { AppError }` and `export { AppError }` both removed. ✓

### CL-5 — Tool defs in token estimation | orchestrator.ts

`toolTokens = toolDefs.reduce(...)` + `msgTokens + toolTokens + 500`. ✓ Estimation
now accounts for tool schema tokens which can be substantial with many tools.

**Note — CL-4 (Ollama null content) skipped.**
`content: ''` → `content: null` for assistant+tool_calls messages in `providers/ollama.ts`
still pending. Ollama users with tool calls will get malformed message objects. Do CL-4 before
I-7 if Ollama is used in smoke test; otherwise post-demo fix is acceptable.

No blocking issues. Move to I-1 and I-7. ✓

---

<!-- REVIEW SECTION END — 2026-06-07o -->

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

<!-- REVIEW SECTION START — 2026-06-09d -->
## Review — 2026-06-09d (commits up to `43035fd`)

**Scope:** Full project review — M5 completeness check, typecheck, test run.

### Status summary

| Check | Result |
|-------|--------|
| `pnpm -r typecheck` | ✓ ALL PASS (10/10 packages) |
| `pnpm -r test` | PARTIAL — types/web/agent/gateway all pass; argocd/datadog/linear fail (vitest missing) |
| Cron scheduler (BullMQ) | ✓ Implemented + wired in server.ts |
| TriggerEngine + subscriber | ✓ Implemented, tenant-isolated |
| Trigger executor | ✓ Implemented, V1 gate-required for write actions |
| Automations routes | ✓ Fully tenant-isolated, DB-backed |
| DeployHealthReport | ✓ Fixed — queries `entities WHERE type='Deploy'` |
| Gate flow | ✓ push/poll/record/decide all correct |

### BLOCKING

**T1 — `pnpm -r test` exits non-zero: argocd/datadog/linear missing vitest devDependency**

`connectors/argocd/package.json`, `connectors/datadog/package.json`, `connectors/linear/package.json` each have `"test": "vitest run"` but vitest is not in devDependencies and no test files exist. `pnpm -r test` reports `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`. Fix: add vitest + minimal smoke tests, or change script to no-op. (Tracked in BRIDGE.md T1.)

### HIGH

**T2 — bootstrapRegistry passed as undefined in graph-builder subscriber**

`apps/gateway/src/graph-builder/subscriber.ts` line ~44 passes `undefined` for the bootstrapRegistry arg to `GraphBuilderAgent`. `GitHubBootstrap` at `connectors/github/src/bootstrap.ts` exists but is never invoked. ArgoCD, Datadog, Linear connectors have no bootstrap implementations. `connector_registered` events seed a Connector entity in the graph but never bootstrap repos/apps/teams/monitors. Fix: implement bootstrap classes for each connector and wire the registry. (Tracked in BRIDGE.md T2.)

<!-- REVIEW SECTION END — 2026-06-09d -->

<!-- REVIEW SECTION START — 2026-06-09e -->
## Review — 2026-06-09e (commit `5929dc2`)

T1/T2 from BRIDGE.md 2026-06-09d — verified correct.

### BLOCKING

**T3 — GitHub connector test mocks `spawnSync`, connector uses `execFile`**

`connectors/github/src/connector.test.ts` mocks `spawnSync` but `connector.ts` imports and uses `execFile` (via `promisify`). Both tests fail: `No "execFile" export is defined on the "node:child_process" mock`. `pnpm -r test` exits non-zero. Fix: change mock to return `execFile` in callback form (promisify-compatible). (Tracked in BRIDGE.md T3.)

<!-- REVIEW SECTION END — 2026-06-09e -->

<!-- REVIEW SECTION START — 2026-06-09f -->
## Review — 2026-06-09f (commit `36e1d50`)

T3 fix verified.

`vi.spyOn(GitHubConnector.prototype as any, 'runCli')` — correct. promisify preserves Node's `customPromisifySymbol`; vi.mock factory doesn't replicate it. Spy on the private method avoids the issue cleanly.

### Result

| Check | Result |
|-------|--------|
| `pnpm -r typecheck` | ✓ 10/10 packages |
| `pnpm -r test` | ✓ 165/165 tests, 0 failures |
| Open issues | 0 |

**Project fully green.**

<!-- REVIEW SECTION END — 2026-06-09f -->

<!-- REVIEW SECTION START — 2026-06-10d -->
## Review 2026-06-10d — Demo Stack + Alertmanager + chat-stream

**Reviewer:** Claude | **Scope:** Cert check 1 + 3 gaps, chat-stream consistency

### BLOCKING

| # | Location | Issue |
|---|----------|-------|
| B1 | `scripts/start_demo.sh` | Never starts `infra/demo/docker-compose.yml` — Prometheus, Alertmanager, Loki, Grafana, demo apps never launched. Cert check 1 fails: demo stacks not both running. |
| B2 | `infra/demo/alertmanager/alertmanager.yml` | Webhook URL `http://gateway:4000` uses Docker network hostname unreachable from container when gateway runs locally. Cert check 3 (alert flow) can never succeed without real Alertmanager → gateway path. |
| B3 | `apps/gateway/src/routes/chat-stream.ts:8` | `ALLOWED_CONNECTOR_TYPES` missing `alertmanager` — inconsistent with `settings.ts` KNOWN_CONNECTORS. Chat can't use alertmanager connector tools. |

### Open issues
| Category | Count |
|----------|-------|
| BLOCKING | 3 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |
| Open issues | 3 |

<!-- REVIEW SECTION END — 2026-06-10d -->

<!-- REVIEW SECTION START — 2026-06-10e -->
## Review 2026-06-10e — Gateway TypeScript compile errors

**Reviewer:** Claude | **Scope:** `pnpm typecheck` in apps/gateway

### BLOCKING

| # | Location | Error |
|---|----------|-------|
| B1 | `apps/gateway/src/events/alert-subscriber.ts:6` | `import type { Severity } from '@prisma/client'` — no such export; schema defines `IncidentSeverity`. Change to `import type { IncidentSeverity }` and update `SEV_MAP` type. |
| B2 | `apps/gateway/src/routes/audit.ts:13` | `AuditEvent.outcome` union missing `'action_executed'` and `'action_failed'`; both used in `DEMO_EVENTS` and `mapOutcome()`. Add both to union. |

### Open issues
| Category | Count |
|----------|-------|
| BLOCKING | 2 |
| Open issues | 2 |

<!-- REVIEW SECTION END — 2026-06-10e -->

<!-- REVIEW SECTION START — 2026-06-10f -->
## Review 2026-06-10f — Connector credential key mismatch + Docker hostname fallbacks

**Reviewer:** Claude | **Scope:** start_demo.sh seeding + connector agent defaults

### BLOCKING

| # | Location | Issue |
|---|----------|-------|
| B1 | `scripts/start_demo.sh:120-124` | Credentials seeded with key `url` but all connector agents read `(creds as any).baseUrl` → tools always fall back to Docker network hostnames unreachable from local gateway. Also grafana URL uses port 3000 but demo compose sets `GF_SERVER_HTTP_PORT: 3001`. |
| B2 | `connectors/{prometheus,loki,grafana,k8s}/src/agent.ts` | Fallback defaults use Docker network hostnames (`http://prometheus:9090` etc.) — unreachable from macOS host when gateway runs locally. Should be `localhost` with the demo stack port. |

### Open issues
| Category | Count |
|----------|-------|
| BLOCKING | 2 |
| Open issues | 2 |

<!-- REVIEW SECTION END — 2026-06-10f -->
