# ds-pro-e2e Tasks — Comprehensive E2E Test Coverage Plan

Generated from full audit of 25 E2E specs, 23 UI components, 21 API routes, and mock data.
Date: 2026-06-11

---

## Audit Summary

| Metric | Count |
|--------|-------|
| Existing E2E spec files | 25 |
| Smoke-only specs (12 lines, "page renders") | 12 (48%) |
| Specs with meaningful interaction tests | 8 |
| Specs with API CRUD roundtrips | 3 |
| UI components with zero test coverage beyond render | 10 |
| Write/mutation endpoints | 8 |
| Write endpoints tested in E2E | 2 |

**Core problem:** 48% of specs test only "page did not crash." No test verifies that a user action produces correct state in the API, database, and UI simultaneously. Tests don't cross-check API responses against UI state or database content.

---

## Test Architecture Requirements

Every test must follow the **triple-assertion pattern**:
1. **UI assertion** — what the user sees changed correctly
2. **API assertion** — GET the resource, confirm state persisted
3. **Database assertion** — (where feasible) query the backing store directly

Tests must be **self-cleaning** — every created resource must be deleted in `afterEach`.

---

## Priority Levels

| Level | Meaning |
|-------|---------|
| **P0** | Critical path — app broken without this |
| **P1** | Core feature — major user workflow broken |
| **P2** | Important — edge case or secondary flow |
| **P3** | Nice-to-have — polish, a11y, perf |

---

## 1. Orchestrator Chat (orchestrator-chat.spec.ts)

### P0-1.1: Send message, receive streaming response
- **Intent:** User types query, hits send, sees streaming AI response with source citations
- **UI assertion:**
  - User message appears in chat with correct role badge (auth + inferred)
  - Streaming text appears incrementally (not all at once)
  - Final message shows: confidence bar, source dots, token count, duration
  - Follow-up suggestion chips appear after response completes
- **API assertion:**
  - `POST /api/chat` returns `text/event-stream`
  - SSE stream contains at least one `text_delta` event and a `[DONE]` marker
  - No API keys appear in any SSE chunk
- **DB assertion:** Audit log contains one `chat_query` event with correct user + sessionId
- **Verification:** Run test twice with different queries, verify responses differ (not cached mock)

### P0-1.2: Scenario shortcut triggers agent flow
- **Intent:** Click scenario chip (alert/deploy/why/incident), see agent orchestration trace
- **UI assertion:**
  - Agent state dots appear with pulsing animation for running agents
  - Execution trace log shows at least 2 specialist agents spawned
  - Each log line has: timestamp, actor name, status indicator
  - Final response contains cross-connector data (not single-source)
- **API assertion:** Chat SSE stream includes `agent_spawn` events with agent type names
- **Verification:** Verify log lines reference real connector data (Datadog metrics, GitHub PRs, etc.)

### P0-1.3: Gate approval flow via chat
- **Intent:** Agent suggests write action → gate appears → user approves → action executes
- **UI assertion:**
  - Gate approval card appears with: tool name, confidence score, description
  - "Approve" and "Reject" buttons visible
  - After clicking "Approve", card shows "approved" state
  - Action result appears in chat (e.g., "incident created")
- **API assertion:**
  - `POST /api/gate/{id}/decide` returns `{ ok: true, decision: 'approved' }`
  - The resource the gate was protecting (e.g., incident) now exists via GET
- **DB assertion:** Gate marked as decided in backing store, audit log has `gate_decided` event
- **Verification:** Also test reject path — resource must NOT be created after reject

### P0-1.4: Gate rejection flow via chat
- **Intent:** User rejects a gate → resource not created → chat shows rejection confirmation
- **UI assertion:** After clicking "Reject", card shows "rejected" state, no action executed message
- **API assertion:** `POST /api/gate/{id}/decide` returns `{ ok: true, decision: 'rejected' }`
- **Verification:** Confirm the protected resource does NOT exist after rejection

### P1-1.5: Role display and transition
- **Intent:** Chat shows current auth role and inferred role, updates when inferred changes
- **UI assertion:**
  - User role badge visible in message header
  - Both `auth_role` and `inferred_role` shown when different
  - Role transition visible when inference changes mid-conversation
- **API assertion:** Token endpoint returns correct roles in JWT claims

### P1-1.6: Context freshness warning
- **Intent:** When graph context is stale, chat shows freshness warning
- **UI assertion:**
  - Stale warning badge appears with "Based on data from X ago" text
  - Confidence bar shows reduced value
- **API assertion:** Response SSE includes `freshness` field < 0.5

### P2-1.7: Empty state — new session
- **Intent:** Fresh chat shows empty state with scenario cards, no message history
- **UI assertion:**
  - "ask anway anything..." placeholder visible
  - Scenario cards visible (at least 4)
  - No messages in chat area
  - No follow-up chips visible

### P2-1.8: Error state — LLM unavailable
- **Intent:** When LLM provider is down, chat shows error without crashing
- **UI assertion:** Error message visible ("unavailable" or "error"), input still usable for retry
- **API assertion:** `POST /api/chat` returns 503

### P2-1.9: Concurrent message — prevent double-send
- **Intent:** While thinking, send button is disabled, cannot submit duplicate query
- **UI assertion:** Send button disabled while `isThinking=true`, input disabled or ignored

### P3-1.10: Markdown rendering
- **Intent:** Code blocks, bold, lists, links render correctly in chat messages
- **UI assertion:**
  - Code block has monospace font and background
  - Bold text rendered as `<strong>`
  - Links are clickable (at minimum rendered as `<a>`)

---

## 2. Auth & Session (anway.spec.ts)

### P0-2.1: Token issuance — valid credentials
- **Intent:** Valid email + tenantId returns JWT that can access protected endpoints
- **API assertion:**
  - `POST /auth/token` returns 200 with `{ token: string, expiresIn: '24h' }`
  - Token is valid JWT (3 base64url segments separated by dots)
  - Token decodes to payload containing `email`, `tenantId`, `role`
  - Using token on `GET /api/connectors` returns 200 (not 401)
- **Verification:** Decode JWT payload, verify `iat` and `exp` are valid timestamps

### P0-2.2: Token issuance — missing fields
- **Intent:** Missing email or tenantId returns 400 with descriptive error
- **API assertion:**
  - Missing `email` → 400, body contains "email"
  - Missing `tenantId` → 400, body contains "tenantId"
  - Invalid email format → 400 (not 500, not silent success)

### P0-2.3: Token rejection — expired/malformed
- **Intent:** Expired token, malformed token, and no token all return 401
- **API assertion:**
  - No `Authorization` header → 401
  - Header value `Bearer garbage` → 401
  - Header value `Bearer <valid-but-expired-token>` → 401
  - Wrong signing key token → 401

### P0-2.4: Token rejection — wrong tenant (cross-tenant isolation)
- **Intent:** JWT issued for tenant A cannot access tenant B's resources
- **API assertion:**
  - Token for tenant-A on `GET /api/incidents` with `x-tenant-id: tenant-B` → 401 or 403
  - Token for tenant-A on `GET /api/incidents` with no override → 200 (own data)

### P1-2.5: Token expiry — near-expiry behavior
- **Intent:** Token close to expiry still works; expired token does not
- **API assertion:** Token with `exp` 1 minute in future → 200. Token with `exp` 1 minute in past → 401

### P2-2.6: CORS headers present on all endpoints
- **Intent:** Every API response includes CORS headers for browser access
- **API assertion:** `Access-Control-Allow-Origin` present on all endpoints (health, auth, API routes)

---

## 3. Incidents (anway.spec.ts + incident-view.tsx)

### P0-3.1: Create incident — full roundtrip
- **Intent:** Create incident via API, verify it appears in list and UI
- **API assertion:**
  - `POST /api/incidents` with `{ title, severity, service }` returns 200/201 with `id`
  - `GET /api/incidents` includes the new incident with matching title and severity
  - `GET /api/incidents/{id}` returns full incident with `status: 'active'`
- **UI assertion:**
  - Navigate to War Room, incident appears in list
  - Incident shows correct severity color, service tag, duration
  - Click incident, right panel shows full detail
- **DB assertion:** Incident row exists in database with correct tenant_id
- **Cleanup:** Delete or resolve incident in `afterEach`

### P0-3.2: Create incident — validation
- **Intent:** Invalid incident creation returns 400 with specific error
- **API assertion:**
  - Missing `title` → 400, body contains "title"
  - Invalid `severity` (not in critical/high/medium/low) → 400
  - Empty `title` (zero-length string) → 400
  - Title > 1000 chars → 400 or truncated

### P0-3.3: Resolve incident
- **Intent:** Resolve an active incident, verify status changes everywhere
- **UI assertion:** After resolve, incident moves from "active" to "resolved" filter, status badge changes
- **API assertion:**
  - `PATCH /api/incidents/{id}` with `{ status: 'resolved' }` returns `{ ok: true }`
  - `GET /api/incidents/{id}` returns `status: 'resolved', resolved_at: <timestamp>`
  - `GET /api/incidents?status=resolved` includes the incident
  - `GET /api/incidents?status=active` does NOT include the incident
- **DB assertion:** `resolved_at` timestamp set, status column updated

### P0-3.4: Get non-existent incident
- **Intent:** Requesting incident that doesn't exist returns 404
- **API assertion:** `GET /api/incidents/nonexistent-uuid` → 404

### P1-3.5: Incident list — filtering by status
- **Intent:** Status filter buttons in UI filter the incident list correctly
- **UI assertion:**
  - Click "active" filter → only active incidents visible
  - Click "resolved" filter → only resolved incidents visible
  - Click "all" → all incidents visible
- **API assertion:** `GET /api/incidents?status=active` only returns active incidents

### P1-3.6: Incident list — severity display
- **Intent:** Each incident shows correct severity badge with correct color
- **UI assertion:**
  - Critical severity → red badge (#ef4444)
  - High severity → orange badge (#f59e0b)
  - Medium severity → yellow badge
  - Low severity → blue/gray badge

### P1-3.7: Incident detail — root cause display
- **Intent:** Incident detail panel shows root cause hypothesis when available
- **UI assertion:** Root cause box visible with green border and hypothesis text

### P1-3.8: Incident timeline
- **Intent:** Incident timeline shows connected events in chronological order
- **UI assertion:**
  - At least 1 timeline event visible
  - Events have timestamps
  - Events have type icons (deploy, alert, PR, comment)

### P2-3.9: Empty state — no incidents
- **Intent:** When no incidents exist, show empty state instead of broken table
- **UI assertion:** "No incidents" or empty state message visible, no rows in table

### P2-3.10: Concurrent incident operations
- **Intent:** Two concurrent resolve requests on same incident don't corrupt state
- **API assertion:** Both resolve calls return; at least one succeeds; final state is consistent

---

## 4. Alerts / Signals (signals-view.spec.ts + alerts-view.tsx)

### P0-4.1: Alert ingestion via webhook creates incident (cert-alert-flow)
- **Intent:** Alertmanager-format webhook → Redis pub/sub → incident created
- **API assertion:**
  - `POST /api/events/alert` with valid Alertmanager payload → 200
  - After 800ms wait, `GET /api/incidents` contains incident matching alert name
  - Incident severity matches alert severity
- **Verification:** This is already partially tested in `cert-alert-flow.spec.ts` — extend with severity matching

### P0-4.2: Signals page — tabs filter by kind
- **Intent:** Tab clicks filter signals by kind (All, Alerts, Errors, CI-CD, etc.)
- **UI assertion:**
  - Default tab "All" shows all signals
  - Click "Alerts" tab → only alert-kind signals visible
  - Click "Errors" tab → only error-kind signals visible
  - Active tab has different styling (accent green border/background)
- **API assertion:** `GET /api/alerts` returns array; `GET /api/alerts?kind=alert` returns filtered subset

### P0-4.3: Signal severity badges
- **Intent:** Each signal row shows correct severity badge with correct color
- **UI assertion:**
  - Critical badge visible with red styling
  - High badge visible with orange styling
  - Badge text matches the signal's severity field

### P1-4.4: Signal expand/collapse — triage details
- **Intent:** Click signal row to expand triage summary, click again to collapse
- **UI assertion:**
  - Click unexpanded row → triage summary visible below with source, analysis, confidence
  - Click expanded row → triage summary collapses
  - Only one row expanded at a time (or multiple allowed — clarify behavior)

### P1-4.5: Signal — Debug button triggers orchestrator
- **Intent:** Click "Debug" on a signal card, orchestrator opens with pre-filled context
- **UI assertion:** After clicking Debug, view switches to orchestrator chat with context about that signal
- **Verification:** Chat input pre-filled or context indicator shows the signal's service/alert name

### P1-4.6: Severity filter
- **Intent:** Severity filter buttons (critical/high/medium) filter the signal list
- **UI assertion:**
  - Click "critical" → only critical signals visible
  - Click "high" → only high signals visible
  - Click "all" → all severities visible

### P2-4.7: Alert acknowledge/assign
- **Intent:** User can acknowledge or assign an alert from the signals view
- **UI assertion:**
  - Acknowledge button visible per signal row
  - After acknowledge, triage status changes to "acknowledged"
- **API assertion:** `PATCH /api/alerts/{id}` with `{ status: 'acknowledged' }` returns 200

### P2-4.8: Real-time alert update
- **Intent:** New alert appears in the signals list without manual refresh
- **UI assertion:** Seed alert via API while on signals page → alert appears within 5 seconds (polling or WebSocket)
- **Verification:** This tests the live-update mechanism

### P2-4.9: Empty state — no signals
- **Intent:** When no alerts exist, show empty state
- **UI assertion:** "No signals" or "All clear" message visible

---

## 5. Connectors (connectors.spec.ts + connectors-api.spec.ts + connectors.tsx)

### P0-5.1: Connector list — renders all configured connectors
- **Intent:** Connector grid shows all registered connectors with correct status
- **UI assertion:**
  - At least 1 connector card visible with name and category
  - Configured connectors show green "configured" badge
  - Unconfigured connectors show gray "off" badge
- **API assertion:** `GET /api/connectors` returns array with connector objects

### P0-5.2: Connector category filter
- **Intent:** Category filter buttons show only connectors in that category
- **UI assertion:**
  - Click "Observability" → only observability connectors visible (Datadog, Prometheus, etc.)
  - Click "Code & CI" → only code connectors visible (GitHub, etc.)
  - Click "All" → all connectors visible

### P0-5.3: Connector connect — save credentials
- **Intent:** Open connect modal, enter credentials, save → connector shows as configured
- **UI assertion:**
  - Click "Connect" on unconfigured connector → modal opens
  - Fill credential fields, click Save → modal closes
  - Connector card now shows "configured" badge
  - "Bootstrap now" button appears on configured connector
- **API assertion:**
  - `PUT /api/settings/connectors/{type}` returns 200
  - `GET /api/settings/connectors` shows connector as configured
- **DB assertion:** Credential stored encrypted in database (not plaintext)
- **Cleanup:** Reset connector to unconfigured state

### P0-5.4: Connector connect — save failure shows error
- **Intent:** When credential save fails, error message displayed in modal
- **UI assertion:** Save error → "Save failed" or error message visible in modal, modal stays open
- **API assertion:** `PUT /api/settings/connectors/{type}` with invalid payload → 400

### P0-5.5: Connector bootstrap
- **Intent:** After connecting, bootstrap extracts entities and populates graph
- **UI assertion:**
  - Click "Bootstrap now" → button shows loading state
  - After completion, bootstrap status shows "bootstrapped" with entity count
- **API assertion:**
  - `POST /api/connectors/{type}/bootstrap` returns `{ ok: true }`
  - `GET /api/connectors/{type}/bootstrap-status` returns `{ bootstrapped: true }`
- **DB assertion:** New entities and relationships exist in graph for that connector

### P0-5.6: Connector reconnect
- **Intent:** Reconnecting a connector re-runs bootstrap and updates graph
- **API assertion:**
  - `POST /api/connectors/{type}/reconnect` returns `{ ok: true }`
  - Bootstrap status shows updated timestamp

### P1-5.7: Connector delete
- **Intent:** Delete a connector, verify removed from list and graph
- **UI assertion:** Connector card removed from grid
- **API assertion:**
  - `DELETE /api/connectors/{id}` returns 200/204
  - `GET /api/connectors` no longer includes the connector
- **DB assertion:** Connector entities orphaned or re-assigned, connector row deleted

### P1-5.8: Connector validation — unknown type
- **Intent:** Bootstrap/reconnect for unknown connector type returns 400
- **API assertion:**
  - `POST /api/connectors/unknown-type/bootstrap` → 400
  - `POST /api/connectors/unknown-type/reconnect` → 400

### P1-5.9: Connector validation — malformed UUID
- **Intent:** Delete with non-UUID id returns 400
- **API assertion:** `DELETE /api/connectors/not-a-uuid` → 400

### P2-5.10: Connector search
- **Intent:** Search input filters connector grid by name
- **UI assertion:** Type "git" in search → only GitHub connector visible

### P2-5.11: Connector disable/enable toggle
- **Intent:** Temporarily disable a connector without deleting credentials
- **UI assertion:** Toggle off → connector shows "disabled" status, data stops syncing
- **API assertion:** `PATCH /api/connectors/{id}` with `{ enabled: false }` → 200

---

## 6. Automations (anway.spec.ts + automations-view.tsx)

### P0-6.1: Trigger CRUD — create, read, delete
- **Intent:** Full lifecycle of an automation trigger
- **API assertion:**
  - `POST /api/automations/triggers` with `{ eventType, condition, actions }` returns 200 with `id`
  - `GET /api/automations/triggers` includes new trigger
  - `GET /api/automations/triggers/{id}` returns full trigger with correct fields
  - `DELETE /api/automations/triggers/{id}` returns 200/204
  - `GET /api/automations/triggers` no longer includes the trigger
- **UI assertion:**
  - Navigate to Automations → trigger appears in list
  - Trigger shows: name, event type badge, condition, action tags, last fired, fire count
  - After delete, trigger removed from list
- **DB assertion:** Trigger row exists in database with correct fields

### P0-6.2: Trigger enable/disable
- **Intent:** Toggle trigger on/off, verify state persisted
- **UI assertion:**
  - Click toggle dot → dot changes color (green=enabled, gray=disabled)
  - Trigger status text updates
- **API assertion:**
  - `PATCH /api/automations/triggers/{id}` with `{ enabled: false }` → 200
  - `GET /api/automations/triggers/{id}` returns `enabled: false`

### P0-6.3: Trigger toggle failure shows error
- **Intent:** When toggle API fails, error toast appears, toggle reverts
- **UI assertion:** Error toast visible with message, toggle reverts to previous state
- **API assertion:** `PATCH` to non-existent trigger → 404

### P0-6.4: Monitor list
- **Intent:** Cron monitors page shows all scheduled monitors
- **UI assertion:**
  - Click "Cron Monitors" tab → monitors visible
  - Each monitor shows: name, schedule, last run, next run, last result with status badge
- **API assertion:** `GET /api/automations/monitors` returns array of monitors

### P1-6.5: Trigger expanded runs
- **Intent:** Click trigger to expand recent execution history
- **UI assertion:**
  - Click trigger row → recent runs expand below
  - Each run shows: timestamp, result (success/failure), duration
  - Click again → runs collapse

### P1-6.6: Trigger validation — missing required fields
- **Intent:** Creating trigger without eventType or actions returns 400
- **API assertion:**
  - Missing `eventType` → 400
  - Missing `actions` → 400
  - Empty `actions` array → 400

### P2-6.7: Monitor detail — last result
- **Intent:** Monitor row shows last execution result with correct status
- **UI assertion:** Success → green badge. Failure → red badge. Running → animated indicator

---

## 7. Gate / Approvals (approvals.spec.ts + approvals-view.tsx)

### P0-7.1: Gate create and decide — full roundtrip
- **Intent:** Create gate, approve it, verify resource created
- **API assertion:**
  - `POST /api/gate` with `{ toolName, params, confidence, requestedBy }` returns 200 with `id`
  - `GET /api/gate/{id}` returns gate with `status: 'pending'`
  - `POST /api/gate/{id}/decide` with `{ decision: 'approved' }` returns `{ ok: true, decision: 'approved' }`
  - `GET /api/gate/{id}` returns gate with `status: 'decided', decision: 'approved'`

### P0-7.2: Gate reject — resource not created
- **Intent:** Reject a gate, verify the protected resource was NOT created
- **API assertion:**
  - `POST /api/gate/{id}/decide` with `{ decision: 'rejected' }` returns `{ ok: true, decision: 'rejected' }`
  - The resource the gate was protecting (e.g., incident, deploy) does NOT exist
- **DB assertion:** Gate status is 'decided', decision is 'rejected'

### P0-7.3: Gate idempotency — cannot decide twice
- **Intent:** Deciding an already-decided gate returns 404 or 409
- **API assertion:** Second decide call on same gate → 404 or 409 (not 200)

### P0-7.4: Gate decide — non-existent gate
- **Intent:** Deciding a gate that doesn't exist returns 404
- **API assertion:** `POST /api/gate/non-existent-uuid/decide` → 404

### P1-7.5: Approvals UI — pending list
- **Intent:** Approvals view shows all pending gates with approve/reject buttons
- **UI assertion:**
  - Each pending item shows: tool name, confidence score, description, timestamp
  - "Approve" button visible per item
  - "Reject" button visible per item

### P1-7.6: Approvals UI — approve removes from pending
- **Intent:** Click approve → item removed from pending list, success message shown
- **UI assertion:**
  - After approve click, item disappears from pending list
  - Success message or toast visible
- **API assertion:** Gate status updated to 'decided' with 'approved'

### P1-7.7: Approvals UI — reject removes from pending
- **Intent:** Click reject → item removed from pending list
- **UI assertion:** After reject click, item disappears, no success message for resource creation

### P2-7.8: Approvals — empty state
- **Intent:** When no pending approvals, show empty state
- **UI assertion:** "No pending approvals" or similar message visible

### P2-7.9: Gate authorization — wrong user cannot decide
- **Intent:** User without approval permission cannot decide a gate
- **API assertion:** Decide call with different user's token → 403

---

## 8. Audit (audit-view.spec.ts + audit-view.tsx)

### P0-8.1: Audit trail — all events visible
- **Intent:** Audit page shows all logged events with correct columns
- **UI assertion:**
  - "Audit Trail" heading visible
  - Table columns: Time, User, Role, Query/Action, Agents, Outcome, Duration
  - "Total events" count visible and non-zero after other tests have run
  - "Access denied" count visible (may be zero)
- **API assertion:** `GET /api/audit` returns array of events

### P0-8.2: Audit pagination — limit and offset
- **Intent:** Pagination params control result size and page
- **API assertion:**
  - `GET /api/audit?limit=5` returns at most 5 events
  - `GET /api/audit?limit=5&offset=5` returns different events than offset=0
  - `GET /api/audit?limit=201` capped at 200 (returns ≤ 200)
  - `GET /api/audit?offset=-1` returns 400 (negative offset)

### P0-8.3: Audit search
- **Intent:** Search input filters audit events by query text
- **UI assertion:**
  - Type search term in input → table rows filter to matching events
  - Clear search → all events shown again
- **API assertion:** `GET /api/audit?search=payments` returns only events containing "payments"

### P1-8.4: Audit filters — user, role, outcome
- **Intent:** Dropdown filters narrow audit events
- **UI assertion:**
  - Select a user from filter dropdown → only that user's events visible
  - Select a role → only events with that role visible
  - Select "Access denied" outcome → only denied events visible
  - Multiple filters combine (AND logic)

### P1-8.5: Audit event expand — detail view
- **Intent:** Click audit row to expand full event detail
- **UI assertion:**
  - Click row → detail section expands below with: event ID, full timestamp, duration, user, roles, full query, invoked agents, outcome detail
  - Click expanded row → detail collapses
  - Only one row expanded at a time

### P1-8.6: Audit — every mutation creates audit event
- **Intent:** After creating an incident via API, audit log contains that event
- **API assertion:**
  - Create incident → audit log contains event with action containing "incident" and outcome "success"
  - Event has correct user + role + timestamp

### P2-8.7: Audit — access denied events logged
- **Intent:** 401/403 responses generate audit events with "Access denied" outcome
- **API assertion:** After a 401 request, audit log has at least one event with outcome "Access denied"

---

## 9. Security (security.spec.ts)

### P0-9.1: API keys never exposed
- **Intent:** No API key appears in any response body (health, providers, errors, etc.)
- **API assertion:**
  - `GET /health` — no `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `JWT_SECRET`
  - `GET /api/providers` — only boolean `configured`, no key values
  - Error responses — no stack traces, no internal paths, no keys

### P0-9.2: Credentials not in connector list response
- **Intent:** Connector list response does not include encrypted credentials or plaintext secrets
- **API assertion:** `GET /api/connectors` response body does not contain `config_encrypted`, `credentials:`, or `"apiKey"`

### P0-9.3: SSRF protection — localhost blocked
- **Intent:** Models endpoint rejects internal URLs to prevent SSRF
- **API assertion:**
  - `GET /api/settings/models?baseUrl=http://127.0.0.1:9090` returns empty models (no data leaked)
  - `GET /api/settings/models?baseUrl=http://localhost:9090` returns empty models
  - `GET /api/settings/models?baseUrl=http://[::1]:9090` returns empty models (IPv6 localhost)
  - `GET /api/settings/models?baseUrl=http://169.254.169.254` returns empty models (link-local)
  - `GET /api/settings/models?baseUrl=http://10.0.0.1` returns empty models (private range)
  - `GET /api/settings/models?baseUrl=http://172.16.0.1` returns empty models (private range)
  - `GET /api/settings/models?baseUrl=http://192.168.1.1` returns empty models (private range)
- **Verification:** Test each address independently — each must return empty models array, not an error that leaks info

### P0-9.4: Cross-tenant isolation
- **Intent:** JWT from tenant A cannot access tenant B resources
- **API assertion:**
  - Token-A on `GET /api/incidents` → 200 (own data, may be empty)
  - Token-A on `GET /api/incidents` with `x-tenant-id: tenant-B` → 401 or 403
  - Token-A on `GET /api/audit` → 200
  - Token-A on `GET /api/audit` with `x-tenant-id: tenant-B` → 401 or 403

### P1-9.5: SQL injection resistance
- **Intent:** SQL injection attempts in query params do not cause errors or data leaks
- **API assertion:**
  - `GET /api/audit?search='; DROP TABLE audit;--` → 200 (safe handling, not 500)
  - `GET /api/incidents?status=' OR '1'='1` → 200 or 400, not unexpected data

### P1-9.6: XSS resistance in displayed data
- **Intent:** Script tags in data fields are escaped, not executed
- **UI assertion:**
  - Create incident with title `<script>alert(1)</script>` → title displayed as text, not executed
  - Audit log shows escaped version

### P1-9.7: Rate limiting
- **Intent:** Rapid requests beyond threshold return 429
- **API assertion:** Send 100 requests in 1 second → at least some return 429

### P2-9.8: JWT algorithm confusion
- **Intent:** JWT with `alg: none` is rejected
- **API assertion:** Token with `{"alg":"none","typ":"JWT"}` header → 401

### P2-9.9: Privilege escalation
- **Intent:** Low-privilege user cannot access admin endpoints or write resources
- **API assertion:**
  - Dev-role user on `DELETE /api/connectors/{id}` → 403
  - Dev-role user on `POST /api/settings/provider` → 403

---

## 10. Service Catalog (services.spec.ts + service-catalog.tsx)

### P0-10.1: Service list — renders all services
- **Intent:** Service catalog shows list of all services with health indicators
- **UI assertion:**
  - At least 1 service card visible in sidebar
  - Each service shows: name, health dot (green/yellow/red), team badge, version
  - Active incident count visible (may be 0)
- **API assertion:** `GET /api/services` returns array with service objects containing `id`, `name`, `health`, `team`

### P0-10.2: Service detail — select service shows full detail
- **Intent:** Click service in list → right panel shows detailed service info
- **UI assertion:**
  - Service name and health badge visible in header
  - Metadata visible: team, oncall, repo, language
  - Dependency graph visible with callers and dependencies as connected boxes
  - Metrics cards visible: Error Rate, P99 Latency, RPS, Uptime
  - Recent incidents list visible
  - Deploy info table visible

### P0-10.3: Service health filter
- **Intent:** Health filter buttons filter service list by health status
- **UI assertion:**
  - Click "healthy" → only green-health services visible
  - Click "degraded" → only yellow-health services visible
  - Click "down" → only red-health services visible
  - Click "all" → all services visible

### P1-10.4: Service dependency graph
- **Intent:** Dependency graph shows correct relationships with health colors
- **UI assertion:**
  - Callers section shows upstream services with arrows
  - Dependencies section shows downstream services with arrows
  - Each node colored by health status
  - At least 1 relationship visible per service

### P1-10.5: Service metrics — values and colors
- **Intent:** Metrics cards show actual values with correct color thresholds
- **UI assertion:**
  - Error Rate: red if > 5%, yellow if > 1%, green if < 1%
  - P99 Latency: red if > 1000ms, yellow if > 500ms, green if < 500ms
  - RPS and Uptime displayed with values

### P1-10.6: Investigate button
- **Intent:** "Investigate" button navigates to orchestrator with service context
- **UI assertion:** Click Investigate → view switches to orchestrator chat, context shows service name

### P2-10.7: Service list — empty state
- **Intent:** When no services registered, show empty state
- **UI assertion:** "No services" or setup prompt visible

### P2-10.8: Service list — loading state
- **Intent:** While services are loading, show skeleton or spinner
- **UI assertion:** Loading indicator visible before services render

---

## 11. AI Provider Config (provider-config.spec.ts + model-config.tsx + provider-config.tsx)

### P0-11.1: Provider list — shows all providers with config status
- **Intent:** Provider list shows all 6 providers, each with configured/not-configured status
- **UI assertion:**
  - 6 provider entries visible (Anthropic, OpenAI, Groq, Mistral, Ollama, LM Studio)
  - Each shows "configured" or "not configured" status
- **API assertion:** `GET /api/providers` returns array of 6 items with `{ id, configured: boolean }`

### P0-11.2: Provider save — full flow
- **Intent:** Select provider, enter API key, save → provider marked as configured
- **UI assertion:**
  - Select provider from dropdown/list → config form appears
  - Enter API key, click Save → success message, provider shows "configured"
- **API assertion:**
  - `POST /api/settings/provider` returns 200
  - `GET /api/settings/provider` returns saved config (without key value)
  - `GET /api/providers` now shows `configured: true` for that provider
- **DB assertion:** Provider config stored, API key encrypted at rest

### P0-11.3: Provider config — model selection
- **Intent:** After provider configured, available models populate and can be selected
- **UI assertion:**
  - Model list populates with provider's models
  - Each model shows name and capability badge
  - Selecting a model highlights it
  - Save persists the selected model
- **API assertion:** `GET /api/settings/models?provider=openai` returns model list

### P0-11.4: Provider config — shows prompt when no provider configured
- **Intent:** When no provider configured, full-screen prompt with setup form appears
- **UI assertion:**
  - "Connect your AI model" heading visible
  - Provider selector dropdown visible
  - Save button visible
  - This screen does NOT appear when a provider is already configured

### P1-11.5: Provider disconnect
- **Intent:** Disconnecting a provider clears credentials and reverts to unconfigured
- **UI assertion:**
  - Click "Disconnect" → confirmation prompt
  - After confirm → provider shows "not configured", API key field cleared
- **API assertion:** `DELETE /api/settings/provider` → 200, `GET /api/providers` shows `configured: false`

### P1-11.6: Provider update — change model
- **Intent:** Change the default model for an already-configured provider
- **UI assertion:** Select different model → Save → new model shown as active
- **API assertion:** `POST /api/settings/provider` with new defaultModel → 200

### P2-11.7: Provider test connection
- **Intent:** "Test connection" button verifies API key works
- **UI assertion:**
  - Click "Test connection" → shows "Testing..." or spinner
  - Success → "Connection successful" message
  - Failure → "Connection failed: <reason>" message
- **API assertion:** Test endpoint returns 200 on valid key, 401/403 on invalid key

### P2-11.8: Custom base URL for local providers
- **Intent:** Ollama/LM Studio allow custom endpoint URL
- **UI assertion:**
  - Select Ollama → base URL input field appears
  - Enter custom URL → Save → configuration persists
- **API assertion:** `POST /api/settings/provider` with `baseUrl` → 200

---

## 12. API Client (api-client.spec.ts + apiclient.tsx)

### P0-12.1: Send request and see response
- **Intent:** Type URL, select method, click Send → see response with status, body, headers
- **UI assertion:**
  - URL input accepts text
  - Method selector changes between GET/POST/PUT/PATCH/DELETE
  - Click Send → response panel appears
  - Response shows: status code (colored), timing, size
  - Response body tab shows formatted JSON
  - Response headers tab shows key-value pairs
- **API assertion:** The actual HTTP request is made and response received (not mock)

### P0-12.2: Request body editor
- **Intent:** Switch to POST, enter JSON body, send → body sent correctly
- **UI assertion:**
  - Body tab shows textarea for JSON input
  - Typed JSON appears in request
  - Response reflects the sent body (echo or processed)
- **API assertion:** Sent body matches what was typed

### P0-12.3: Headers management
- **Intent:** Add custom headers, send request, verify headers sent
- **UI assertion:**
  - Headers tab shows key-value inputs
  - "+ Add Header" adds new row
  - Headers appear in request (verify via echo endpoint or response headers)

### P1-12.4: Collections sidebar — select request
- **Intent:** Click saved request in collections sidebar → populates URL, method, body
- **UI assertion:**
  - Collections list visible in sidebar
  - Click a collection item → URL bar updates to that endpoint
  - Method selector updates
  - Request body pre-populated if applicable

### P1-12.5: Response tabs — Body, Headers, Tests
- **Intent:** Tab clicks switch between response views
- **UI assertion:**
  - Click "Body" → JSON response body visible
  - Click "Headers" → response headers table visible
  - Click "Tests" → test assertions visible (pass/fail)

### P2-12.6: Error states
- **Intent:** Invalid URL, network error, timeout show error messages
- **UI assertion:**
  - Invalid URL ("not-a-url") → error message in response panel
  - Network error (localhost:9999) → connection refused message
  - Timeout → timeout message

### P2-12.7: Auth tab — token input
- **Intent:** Auth tab allows entering bearer token, sent with request
- **UI assertion:**
  - Auth tab shows type selector and token input
  - Token sent as `Authorization: Bearer <token>` header
- **API assertion:** Echo endpoint confirms token received

---

## 13. Knowledge Base (kb.spec.ts + kb-view.tsx)

### P0-13.1: Project selector — switch projects
- **Intent:** Click project button to switch KB context
- **UI assertion:**
  - Project selector buttons visible at top
  - Active project has highlighted style
  - Click different project → content changes (wiki, metrics update)
  - Content matches selected project (name, repo visible)

### P0-13.2: Deep dive tabs — switch content sections
- **Intent:** Deep dive tabs switch between KB content sections
- **UI assertion:**
  - Click "Changes" → timeline of change events visible
  - Click "Tests" → test health bar and failing tests visible
  - Click "Metrics" → expanded metric cards with sparklines visible
  - Click "Stack Health" → component health rows visible
  - Click "Runbook" → runbook sections visible

### P1-13.3: Changes tab — kind filter
- **Intent:** Kind filter buttons filter change events by type
- **UI assertion:**
  - Click "Deploy" → only deploy-kind changes visible
  - Click "PR" → only PR-kind changes visible
  - Click "All" → all changes visible

### P1-13.4: Change event expand/collapse
- **Intent:** Click change event to see detail
- **UI assertion:**
  - Click event row → detail expands with description and metadata
  - Click again → detail collapses

### P1-13.5: Entity search
- **Intent:** Search for an entity in the knowledge graph
- **UI assertion:**
  - Type in search input → results appear
  - Results include entities matching the search term
  - Click result → entity detail displayed
- **API assertion:** Search query hits the knowledge graph endpoint

### P2-13.6: KB — empty state
- **Intent:** When no graph data exists, show empty/setup state
- **UI assertion:** "No entities" or bootstrap prompt visible

---

## 14. Workflows (workflow.spec.ts + workflow-view.tsx)

### P0-14.1: Service selector and autonomy levels
- **Intent:** Select service, view and change autonomy level
- **UI assertion:**
  - Service buttons visible in left panel
  - Click service → stages and gate config update for that service
  - Autonomy dial shows L1/L2/L3/L4 with current level highlighted
  - Click L3 → dial updates, color changes
  - Pipeline stages reflect autonomy level (gates enabled/disabled accordingly)

### P0-14.2: Stage pipeline — select stage for gate config
- **Intent:** Click pipeline stage → gate editor expands for that stage
- **UI assertion:**
  - Pipeline stages shown as connected vertical nodes with icons
  - Click stage → expands to show gate configuration
  - Stage shows: type icon, title, gate type badge, agent tags

### P0-14.3: Gate configuration — type and approvals
- **Intent:** Configure gate type and required approvals for a stage
- **UI assertion:**
  - Gate type buttons: manual / auto / disabled
  - Click "manual" → required approvals number buttons (1/2/3) appear
  - Click "auto" → confidence threshold slider appears
  - Click "disabled" → gate config minimized (no approvals needed)

### P1-14.4: Gate configuration — required approvers
- **Intent:** Add/remove required approvers for manual gates
- **UI assertion:**
  - Required approvers list visible
  - Approver has name and "x" remove button
  - Click "x" → approver removed
  - "+ add" button opens approver selection

### P2-14.5: Agent loop animation
- **Intent:** When autonomy is active, agent loop visualization animates
- **UI assertion:** Agent loop visible in left panel with animated step progression

---

## 15. Access Control (access.spec.ts + access-view.tsx)

### P0-15.1: User list — renders provisioned users
- **Intent:** Access view shows all provisioned users with their roles
- **UI assertion:**
  - At least 1 user visible in sidebar
  - Each user shows: initials avatar, name, role badge
  - User count matches API response

### P0-15.2: User selection — shows permission matrix
- **Intent:** Click user → right panel shows their connector access matrix
- **UI assertion:**
  - User info shown: name, email, role
  - Connector access table visible with columns: Connector, Mode (R/W), Read Scope, Write Scope
  - At least 1 connector row visible
  - Each row shows ✓/✗ indicators for read/write access

### P1-15.3: Provision user flow
- **Intent:** Create new user with role and connector permissions
- **UI assertion:**
  - Click "+ Provision user" → form opens
  - Fill email, select role, set connector permissions → Submit
  - New user appears in sidebar list
- **API assertion:**
  - `POST /api/access/users` returns 200 with user id
  - `GET /api/access/users` includes new user
- **DB assertion:** User row exists with correct role + permissions

### P1-15.4: Edit user permissions
- **Intent:** Change a user's connector access scope
- **UI assertion:**
  - Click "Edit" on a connector row → scope editor opens
  - Change read/write scope → Save
  - Updated scopes reflected in the table
- **API assertion:** `PUT /api/access/users/{id}` persists permission changes

### P1-15.5: Connector capability manifest display
- **Intent:** Expand manifest section to see what each connector allows
- **UI assertion:**
  - Manifest section expandable
  - Shows read capabilities (list of resources)
  - Shows write capabilities (list of resources)
  - Matches the connector's declared manifest

### P2-15.6: Permission enforcement — write blocked
- **Intent:** User without write scope cannot execute write actions
- **API assertion:** User with read-only connector scope on `POST /api/incidents` → 403

### P2-15.7: Provisioning template — copy
- **Intent:** YAML template can be copied for infrastructure-as-code provisioning
- **UI assertion:** Template section expandable, YAML visible, "Copy template" button copies to clipboard

---

## 16. Cloud View (cloud.spec.ts + cloud-view.tsx)

### P0-16.1: Provider switch — AWS, GCP, Azure
- **Intent:** Switch between cloud providers, view correct resources
- **UI assertion:**
  - Provider buttons visible (AWS, GCP, Azure)
  - AWS selected by default → AWS resources visible
  - Click GCP → GCP resources shown (or "not connected" state)
  - Click Azure → Azure resources shown (or "not connected" state)

### P0-16.2: Cloud tabs — Overview, Capacity, Security, Config
- **Intent:** Tab clicks switch between cloud views
- **UI assertion:**
  - "Overview" tab → stats grid + resource table visible
  - "Capacity" tab → hot resources (near limit) visible
  - "Security" tab → security findings list visible
  - "Config Issues" tab → misconfigurations list visible

### P1-16.3: Security finding expand/collapse
- **Intent:** Click security finding to expand detail and remediation
- **UI assertion:**
  - Finding row has severity indicator
  - Click row → expands with: description, "Why this matters + how to fix" button
  - Click again → collapses

### P1-16.4: Config issue expand/collapse
- **Intent:** Click config issue to see debug steps
- **UI assertion:**
  - Issue row has severity indicator
  - Click row → expands with: description, "Why + debug steps" button
  - Click again → collapses

### P2-16.5: Resource table — metric bars
- **Intent:** Resource table shows CPU/MEM/CONN/DISK with visual bars
- **UI assertion:**
  - Each resource row has 4 metric columns
  - Bars colored by usage: green (< 50%), yellow (50-80%), red (> 80%)
  - Values labeled with percentages

### P2-16.6: Cloud — empty state (no providers connected)
- **Intent:** When no cloud provider connected, show connection prompt
- **UI assertion:** "Connect a cloud provider" or similar, no resource data shown

---

## 17. Kubernetes View (k8s.spec.ts + k8s-view.tsx)

### P0-17.1: Cluster overview — stat cards
- **Intent:** K8s view shows cluster summary statistics
- **UI assertion:**
  - Total Nodes count visible
  - Namespaces count visible
  - Running Pods count visible
  - Failing Pods count visible (may be 0)

### P0-17.2: Namespace table
- **Intent:** Namespace table shows all namespaces with resource usage
- **UI assertion:**
  - Table has columns: Name, CPU, Memory
  - CPU usage shown as bar + percentage
  - Memory usage shown as bar + percentage

### P1-17.3: Workloads table
- **Intent:** Workloads table shows all workloads with status
- **UI assertion:**
  - Table has columns: Name, Namespace, Type, Replicas, Status
  - Status colored: green (Running/Ready), red (Failed/CrashLoopBackOff), yellow (Pending)

### P1-17.4: Recent events table
- **Intent:** K8s events table shows recent cluster events
- **UI assertion:**
  - Table has columns: Severity, Reason, Object/Message, Time
  - Events sorted by time (newest first)
  - Severity icons visible (Warning ⚠, Error 🔴, Info ℹ)

### P2-17.5: K8s — empty state (no cluster connected)
- **Intent:** When no K8s connector configured, show setup prompt
- **UI assertion:** "Connect a Kubernetes cluster" or similar

---

## 18. Lifecycle View (lifecycle.spec.ts + lifecycle.tsx)

### P0-18.1: Feature selector — switch features
- **Intent:** Feature dropdown switches between tracked features
- **UI assertion:**
  - Feature selector dropdown visible
  - Default feature selected and displayed
  - Switch to different feature → stages update with that feature's data

### P0-18.2: Stage flow — all stages visible
- **Intent:** All lifecycle stages render for the selected feature
- **UI assertion:**
  - 6 stages visible (PRD, Spec, Tests, Collection, Deploy, Metrics)
  - Each stage shows: type icon, title, state badge
  - Arrows connect stages horizontally
  - Progress bar visible showing overall completion

### P1-18.3: Stage card click — opens AI panel
- **Intent:** Click stage card → AI panel opens with context about that stage
- **UI assertion:**
  - Click stage card → AI panel slides in from right
  - Panel shows stage context (feature + stage name)
  - Quick action buttons relevant to the stage visible
  - Close button dismisses panel

### P1-18.4: Stage action buttons
- **Intent:** Action buttons within stage cards trigger AI generation
- **UI assertion:**
  - "Generate test plan" button visible in Tests stage
  - "Export k6" button visible in Collection stage
  - Clicking action button triggers the expected behavior (AI panel or download)

### P2-18.5: Activity feed
- **Intent:** Activity feed shows recent events for the feature
- **UI assertion:**
  - Recent activity entries visible
  - Each entry has: timestamp, colored message
  - Events sorted by time (newest first)

### P2-18.6: Empty state — no features
- **Intent:** When no features being tracked, show empty state
- **UI assertion:** "No features" or "+ New Feature" prompt visible

---

## 19. Editor View (editor.spec.ts + editor-view.tsx)

### P0-19.1: Code display — syntax highlighting
- **Intent:** Editor shows code with syntax highlighting
- **UI assertion:**
  - Code visible in the editor panel
  - Different token types have different colors (keywords, strings, comments visually distinct)
  - Line numbers visible

### P0-19.2: Findings display — gutter markers and list
- **Intent:** Code review findings appear as gutter markers and in the findings panel
- **UI assertion:**
  - Gutter markers visible on lines with findings (error/warning icons)
  - Findings panel shows list: title, severity, description
  - Click finding in panel → scrolls to that line in editor

### P0-19.3: Gate actions — Approve, Request Changes, Deploy
- **Intent:** Gate action buttons visible and clickable
- **UI assertion:**
  - "Approve & Run Tests" button visible
  - "Request Changes" button visible
  - "Deploy to staging" button visible
  - Clicking a button shows visual feedback (state transition)

### P1-19.4: Sidebar activity tabs — Explorer, Search, Git
- **Intent:** Activity tab icons switch the sidebar panel
- **UI assertion:**
  - Click Explorer icon → file tree visible
  - Click Search icon → search input visible
  - Click Git icon → staged changes and commit UI visible

### P1-19.5: Bottom panel tabs — Problems, Tests, Terminal
- **Intent:** Bottom panel tabs switch between output views
- **UI assertion:**
  - Click "Problems" → problems list visible
  - Click "Tests" → test results visible
  - Click "Terminal" → terminal output visible

### P1-19.6: Git panel — commit flow
- **Intent:** Git panel shows staged changes and commit UI
- **UI assertion:**
  - Staged changes list visible with filenames
  - Commit message input visible
  - Commit button visible (may be disabled without message)

### P2-19.7: Panel resize
- **Intent:** Bottom panel can be resized or toggled
- **UI assertion:** Resize toggle changes panel height, close button hides panel

### P2-19.8: Run sequence — test execution display
- **Intent:** After "Approve & Run Tests", test execution progress visible
- **UI assertion:**
  - Test runner output visible in Tests tab
  - Each test shows pass/fail status
  - Summary shows X passed, Y failed

---

## 20. Intake / Signal Routing (intake.spec.ts + intake-view.tsx)

### P0-20.1: Source list — grouped by category
- **Intent:** Intake view shows sources grouped by category with mode badges
- **UI assertion:**
  - Source list visible in sidebar
  - Sources grouped under "Alert Managers" and "Ticketing & Support" (or similar)
  - Each source shows: name, mode badge (Bypass/Monitor/L1 Assist)

### P0-20.2: Source config — intake mode selection
- **Intent:** Click source → configure intake mode
- **UI assertion:**
  - Click source → config panel shows source header
  - Mode buttons: Bypass / Monitor / L1 Assist
  - Current mode highlighted
  - Click different mode → mode changes

### P0-20.3: Source config — escalation settings
- **Intent:** Configure escalation threshold and policy for a source
- **UI assertion:**
  - Escalation threshold slider visible (adjustable)
  - Escalation policy text input visible
  - "Save configuration" button visible

### P1-20.4: Webhook URL display
- **Intent:** Each source shows its webhook endpoint URL
- **UI assertion:**
  - Webhook URL text visible (endpoint path)
  - Status dot (green=active, gray=inactive)
  - "Copy" button copies URL to clipboard

### P1-20.5: Intake log — processed signals
- **Intent:** Intake log shows recently processed signals
- **UI assertion:**
  - Intake log toggle button visible
  - Toggle open → list of processed signals visible
  - Each signal shows: disposition badge, source tag, timestamp, triage summary
  - Disposition colors: green (auto-resolved), yellow (triaged), red (escalated)

### P1-20.6: Save configuration
- **Intent:** Save intake configuration, verify persisted
- **UI assertion:**
  - Change intake mode + escalation → click Save
  - Success confirmation visible
  - Reload page → settings preserved
- **API assertion:** `PUT /api/intake/sources/{id}` returns 200, `GET` returns updated config

### P2-20.7: Intake — empty state
- **Intent:** When no intake sources configured, show empty state
- **UI assertion:** "No intake sources" or setup prompt visible

---

## 21. Settings View (settings.spec.ts + settings-view.tsx)

### P0-21.1: Settings tabs — switch between sections
- **Intent:** Settings tabs switch between AI Provider, Connectors, Access, Audit
- **UI assertion:**
  - 4 tabs visible: AI Provider, Connectors, Access, Audit
  - Default tab content visible
  - Click "Connectors" → connectors config visible
  - Click "Access" → access view visible
  - Click "Audit" → audit view visible
  - Click "AI Provider" → provider config visible

---

## 22. Navigation & App Shell (navigation.spec.ts + app-shell.spec.ts + page.tsx)

### P0-22.1: All 16+ nav items exist
- **Intent:** Every declared nav item is visible in the sidebar
- **UI assertion:**
  - All nav items verified visible: Anway, Signals, War Room, Services, Lifecycle, Editor, Knowledge, Workflows, Approvals, Automations, API Client, Connectors, Audit, Access, Cloud, K8s, Settings

### P0-22.2: Nav click switches view and updates content
- **Intent:** Clicking each nav item changes the main content area to the correct view
- **UI assertion:**
  - Click "Services" → service catalog visible (not War Room)
  - Click "War Room" → incident view visible (not Services)
  - Test every nav item: content area updates correctly for each
  - Active nav item has highlighted/selected style

### P0-22.3: Nav badges — alert and incident counts
- **Intent:** Sidebar nav items show live badge counts
- **UI assertion:**
  - Critical alerts badge visible on Signals nav item (if count > 0)
  - Active incidents badge visible on War Room nav item (if count > 0)
  - Connectors count badge visible on Connectors nav item
  - Badge numbers update when underlying data changes (within refresh interval)

### P0-22.4: Logo and workspace selector
- **Intent:** App shell shows logo and workspace name
- **UI assertion:**
  - "anway" logo text visible in sidebar header
  - Workspace selector visible (may show mock workspace name)

### P1-22.5: Recent queries — clickable
- **Intent:** Recent queries section in sidebar shows clickable queries
- **UI assertion:**
  - Recent queries section visible (if any)
  - Click a query → view switches to chat with that query
- **API assertion:** `GET /api/audit` populates recent queries

### P1-22.6: User profile in sidebar footer
- **Intent:** Sidebar footer shows current user
- **UI assertion:**
  - User avatar/initials visible
  - User email or name visible
  - Click may open user menu

### P2-22.7: Deep link — direct URL navigation
- **Intent:** Navigating directly to a URL loads the correct view
- **UI assertion:** Navigate to `/#services` or equivalent → Services view loads correctly

### P2-22.8: Error boundary — component crash doesn't crash app
- **Intent:** If a view component throws, error boundary shows fallback UI
- **UI assertion:** Error boundary text visible instead of blank page, sidebar still functional

---

## 23. Cross-Cutting Concerns

### P0-23.1: Health endpoints — all return 200
- **Intent:** Health check endpoints confirm service is alive
- **API assertion:**
  - `GET /health` → 200, `{ status: 'ok', version: string, uptime: number }`
  - `GET /health/live` → 200
  - `GET /health/ready` → 200
  - `GET /health/startup` → 200

### P0-23.2: Metrics endpoint — Prometheus format
- **Intent:** Metrics endpoint exposes Prometheus-compatible telemetry
- **API assertion:**
  - `GET /metrics` → 200
  - Response contains `anway_gateway` metric
  - Request counters increment after API calls

### P0-23.3: Web UI — homepage loads without errors
- **Intent:** Browser loads the app without JS errors
- **UI assertion:**
  - Page loads at `http://localhost:3000`
  - No console errors
  - `document.body` has content (not blank page)
  - Sidebar visible

### P1-23.4: Chat validation — missing fields
- **Intent:** Chat endpoint rejects requests without required fields
- **API assertion:**
  - `POST /api/chat` without `query` → 400
  - `POST /api/chat` without `sessionId` → 400
  - `POST /api/chat` with empty `query` (zero-length) → 400

### P1-23.5: Graph events — auth required
- **Intent:** Graph events endpoint requires valid connector key
- **API assertion:**
  - `POST /api/graph/events` without `x-connector-key` → 401
  - `POST /api/graph/events` with invalid key → 401
  - `POST /api/graph/events` with valid key + matching tenant → 200
  - `POST /api/graph/events` with valid key + wrong tenant → 403

### P1-23.6: Event receivers — deploy and PR
- **Intent:** Deploy and PR-merged event receivers validate input
- **API assertion:**
  - `POST /api/events/deploy` without `tenantId` → 400
  - `POST /api/events/deploy` with valid payload → 200
  - `POST /api/events/pr-merged` without `tenantId` → 400
  - `POST /api/events/pr-merged` with valid payload → 200

### P2-23.7: Loading states across all views
- **Intent:** Every data-fetching view shows a loading indicator before data renders
- **UI assertion:** For Services, Incidents, Alerts, Audit, Automations, Connectors — spinner or skeleton visible before data appears

### P2-23.8: Empty states across all views
- **Intent:** Every list/dashboard view shows a meaningful empty state when no data exists
- **UI assertion:** For each view, when API returns empty array, "No X" or setup prompt visible

### P2-23.9: Error states — API failures
- **Intent:** When an API call fails (500/503/network error), UI shows error message instead of crashing
- **UI assertion:**
  - Simulate API failure → error message visible in the relevant view
  - Retry mechanism or manual refresh available
  - App does not crash to blank page

### P2-23.10: Concurrent navigation — rapid clicks don't break state
- **Intent:** Clicking nav items rapidly doesn't cause mixed-state rendering
- **UI assertion:** Rapidly click 5+ nav items → final view renders correctly, no stale data from intermediate views

### P3-23.11: Browser back/forward
- **Intent:** Browser navigation buttons maintain correct view state
- **UI assertion:** Navigate A→B→C, press back → B renders correctly, press back → A renders correctly, press forward → B renders correctly

### P3-23.12: Accessibility — keyboard navigation
- **Intent:** All interactive elements are keyboard-accessible
- **UI assertion:**
  - Tab through nav items → focus ring visible on each
  - Enter activates focused nav item
  - Tab through form fields in logical order
  - Escape closes modals

### P3-23.13: Accessibility — ARIA labels and roles
- **Intent:** Screen reader can navigate the app
- **UI assertion:**
  - Nav landmark has `role="navigation"`
  - Main content has `role="main"`
  - Buttons have accessible names
  - Form inputs have labels

---

## 24. Data Integrity (Cross-API Verification)

### P0-24.1: Incident creation → audit trail
- **Intent:** Creating an incident generates an audit event
- **Steps:**
  1. `POST /api/incidents` → get incident `id`
  2. `GET /api/audit?search={id}` → audit event exists with action "create_incident" or similar
  3. Audit event has correct user, role, timestamp (within 5 seconds of creation)

### P0-24.2: Connector bootstrap → graph entities
- **Intent:** Bootstrapping a connector creates graph entities
- **Steps:**
  1. Connect a connector (e.g., GitHub)
  2. `POST /api/connectors/github/bootstrap`
  3. Poll `GET /api/connectors/github/bootstrap-status` until `bootstrapped: true`
  4. Query knowledge graph → entities from that connector exist
- **DB assertion:** Entity and relationship rows exist for the connector type

### P1-24.3: Alert webhook → incident → audit
- **Intent:** Full pipeline: alert fires → incident created → audit trail records everything
- **Steps:**
  1. `POST /api/events/alert` with valid payload
  2. Wait for processing (poll incidents list)
  3. `GET /api/incidents` → incident exists with matching title
  4. `GET /api/audit` → events for alert received, incident created exist

### P1-24.4: Trigger fire → audit event
- **Intent:** When a trigger fires, an audit event records it
- **Steps:**
  1. Create trigger for `deploy_completed` event
  2. Send `deploy_completed` event
  3. `GET /api/audit` → trigger execution event exists

---

## How to Verify Test Implementation Correctness

1. **Each test file must self-clean:** Use `beforeEach` to set up known state, `afterEach` to delete created resources. No test should depend on state from another test.

2. **API → UI consistency:** Every mutation test must verify the change appears in BOTH the API GET response AND the UI. If API says "incident created" but UI doesn't show it, the test must fail.

3. **No mock bypass:** Tests must hit real endpoints. The gateway must be running. No `mockFetch` in E2E tests (unit tests are for mocks).

4. **Response schema validation:** Don't just check `status === 200`. Verify response body shape: required fields exist, types are correct, no extra sensitive fields.

5. **Timing:** Async operations (alert → incident, bootstrap → entities) must use polling loops with timeouts, not arbitrary `sleep()` calls.

6. **Isolation:** Each test file must be runnable independently. No shared state between spec files.

7. **Failure clarity:** Every assertion must have a descriptive message. "Expected incident list to contain new incident after creation" not "Expected true to be true".

8. **Cross-reference:** For every P0 test, verify the test file references the correct component file (what it tests), the correct API endpoint (backend contract), and the correct database table (persistence contract).

---

## Test File Organization (Recommended)

```
e2e/
├── fixtures.ts                    # Shared helpers (existing, extend)
├── 01-health.spec.ts              # Health + metrics endpoints
├── 02-auth.spec.ts                # Token issuance, validation, rejection
├── 03-security.spec.ts            # SSRF, credential leaks, tenant isolation
├── 04-incidents.spec.ts           # Incident CRUD, filtering, UI
├── 05-signals.spec.ts             # Alerts, signals, webhook ingestion
├── 06-connectors-api.spec.ts      # Connector API endpoints
├── 07-connectors-ui.spec.ts       # Connector UI interactions
├── 08-automations.spec.ts         # Triggers + monitors CRUD
├── 09-gate-approvals.spec.ts      # Gate lifecycle, approvals UI
├── 10-audit.spec.ts               # Audit trail, search, pagination
├── 11-services.spec.ts            # Service catalog, detail, filters
├── 12-orchestrator-chat.spec.ts   # Chat, streaming, gate in chat
├── 13-provider-config.spec.ts     # AI provider setup, model selection
├── 14-api-client.spec.ts          # API client request builder
├── 15-knowledge-base.spec.ts      # KB project selector, tabs, search
├── 16-workflows.spec.ts           # Autonomy dial, gate config
├── 17-access.spec.ts              # User provisioning, permissions
├── 18-cloud.spec.ts               # Cloud provider views
├── 19-k8s.spec.ts                 # K8s cluster overview
├── 20-lifecycle.spec.ts           # Feature lifecycle stages
├── 21-editor.spec.ts              # Code editor, findings, gates
├── 22-intake.spec.ts              # Signal routing configuration
├── 23-settings.spec.ts            # Settings tabs
├── 24-navigation.spec.ts          # App shell, nav, badges
├── 25-cross-cutting.spec.ts       # Loading states, empty states, errors
├── 26-data-integrity.spec.ts      # Cross-API verification chains
├── 27-a11y.spec.ts                # Keyboard nav, ARIA, screen reader
└── 28-performance.spec.ts         # Load times, Lighthouse (P3)
```

---

## Priority Summary

### P0 (Must have — app broken without these): 64 tests
1.1-1.4 (Chat + gate), 2.1-2.4 (Auth), 3.1-3.4 (Incidents), 4.1-4.3 (Signals), 5.1-5.6 (Connectors), 6.1-6.4 (Automations), 7.1-7.4 (Gates), 8.1-8.3 (Audit), 9.1-9.4 (Security), 10.1-10.3 (Services), 11.1-11.4 (Provider config), 12.1-12.3 (API client), 13.1-13.2 (KB), 14.1-14.3 (Workflows), 15.1-15.2 (Access), 16.1-16.2 (Cloud), 17.1-17.2 (K8s), 18.1-18.2 (Lifecycle), 19.1-19.3 (Editor), 20.1-20.3 (Intake), 21.0 (Settings), 22.1-22.4 (Navigation), 23.1-23.3 (Health/Web UI), 24.1-24.2 (Data integrity)

### P1 (Core features — major workflows broken): 44 tests
1.5-1.6, 2.5, 3.5-3.8, 4.4-4.6, 5.7-5.9, 6.5-6.6, 7.5-7.7, 8.4-8.6, 9.5-9.7, 10.4-10.6, 11.5-11.6, 12.4-12.5, 13.3-13.5, 14.4, 15.3-15.5, 16.3-16.4, 17.3-17.4, 18.3-18.4, 19.4-19.6, 20.4-20.6, 22.5-22.6, 23.4-23.6, 24.3-24.4

### P2 (Important — edge cases, secondary flows): 30 tests
1.7-1.9, 2.6, 3.9-3.10, 4.7-4.9, 5.10-5.11, 6.7, 7.8-7.9, 8.7, 9.8-9.9, 10.7-10.8, 11.7-11.8, 12.6-12.7, 13.6, 14.5, 15.6-15.7, 16.5-16.6, 17.5, 18.5-18.6, 19.7-19.8, 20.7, 22.7-22.8, 23.7-23.10

### P3 (Polish — a11y, perf, visual): 13 tests
1.10, 23.11-23.13

**Total: 151 tests needed. Currently: ~50 meaningful tests exist. Gap: ~100 tests.**

---

## Current Test Status vs. Required

| Spec File | Current State | What's Missing |
|-----------|--------------|----------------|
| `anway.spec.ts` | ~32 tests, best coverage | Split into health, auth, security, incidents, automations, chat |
| `cert-alert-flow.spec.ts` | 5 tests, good pipeline | Extend with severity matching, dedup, resolved alerts |
| `connectors-api.spec.ts` | 9 tests, good API | Add delete, reconnect, validation edge cases |
| `security.spec.ts` | 6 tests, good security | Add SQL injection, XSS, rate limiting, privilege escalation |
| `graph-events-extended.spec.ts` | 6 tests, good tenant isolation | Add payload validation, idempotency, event type coverage |
| `signals-view.spec.ts` | 2 tests | Needs: tab switching, severity filter, debug button, acknowledge, real-time |
| `audit-view.spec.ts` | 5 tests | Needs: filters, expand, mutation-to-audit chain |
| `connectors.spec.ts` | 4 tests | Needs: full connect flow, bootstrap, disable, search |
| `approvals.spec.ts` | 3 tests | Needs: reject flow, pending list, empty state |
| `orchestrator-chat.spec.ts` | 3 tests | Needs: full send/receive, streaming, markdown, error states |
| `provider-config.spec.ts` | 2 tests | Needs: full save flow, model select, disconnect, test connection |
| `app-shell.spec.ts` | 2 tests | Needs: all nav items, badges, deep links |
| `navigation.spec.ts` | 2 tests | Needs: view switching assertions for all 16 items |
| `services.spec.ts` | 2 tests | Needs: detail view, health filter, dependency graph, metrics |
| `api-client.spec.ts` | 1 test | Needs: send request, response, headers, collections, errors |
| `access.spec.ts` | 1 test | Needs: user list, permissions matrix, provisioning |
| `cloud.spec.ts` | 1 test | Needs: provider switch, tabs, security findings |
| `editor.spec.ts` | 1 test | Needs: code display, findings, gate actions, panels |
| `intake.spec.ts` | 1 test | Needs: source config, escalation, webhook, save |
| `k8s.spec.ts` | 1 test | Needs: cluster stats, namespace table, workloads |
| `kb.spec.ts` | 1 test | Needs: project switch, tabs, changes, search |
| `lifecycle.spec.ts` | 1 test | Needs: feature select, stages, AI panel |
| `settings.spec.ts` | 1 test | Needs: tab switching assertions |
| `workflow.spec.ts` | 1 test | Needs: autonomy dial, stage select, gate config |
| `graph-events.spec.ts` | 2 tests | Needs: valid ingestion, event type testing |

---

## Implementation Order

1. **Week 1:** P0 tests for Auth (2.x), Incidents (3.x), Security (9.x), Health (23.1-23.3)
2. **Week 2:** P0 tests for Connectors (5.x), Automations (6.x), Gates (7.x), Audit (8.x)
3. **Week 3:** P0 tests for Services (10.x), Signals (4.x), Chat (1.1-1.4)
4. **Week 4:** P0 tests for Provider Config (11.x), remaining views (12.x-21.x), Navigation (22.x)
5. **Week 5:** P1 tests for all sections
6. **Week 6:** P2 + P3 tests, data integrity chains (24.x), cross-cutting (23.7-23.13)
