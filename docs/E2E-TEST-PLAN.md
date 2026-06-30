# Anway — E2E Test Plan

Complete Playwright coverage. Every UI view, every API-wired interaction, every user-visible flow.
No feature untested. No mock substituting for real behaviour.

## Principles

- All tests hit the real gateway (`http://127.0.0.1:4000`) and real DB. No mocking.
- Tests that require an LLM key are tagged `@llm` and guarded by `test.skip(process.env.ANTHROPIC_API_KEY === undefined)`.
- Each spec file is self-contained. `beforeAll` provisions auth; `afterAll` cleans up created rows.
- UI tests drive the browser — they navigate to the view, interact via locators, assert visible state.
- API validation tests (`request` fixture) run against the gateway directly.
- Every write operation is verified by a subsequent read. Idempotency confirmed where applicable.

---

## Spec Files

### 1. `e2e/infra.spec.ts` — Infrastructure health + auth

**Coverage: `/health`, `/health/live`, `/health/ready`, `/health/startup`, `/metrics`, `/auth/token`, `/api/auth/dev-token`**

| Test | Type | Assert |
|------|------|--------|
| GET /health → 200, `status: "ok"` | API | status 200, body.status === "ok" |
| GET /health/live → 200 | API | status 200 |
| GET /health/ready → 200 when DB up | API | status 200 |
| GET /health/startup → 200 | API | status 200 |
| GET /metrics → Prometheus text format | API | content-type text/plain, contains `# HELP` |
| POST /auth/token valid body → JWT returned | API | status 200, body.token is string |
| POST /auth/token missing tenantId → 400 | API | status 400 |
| POST /auth/token missing email → 400 | API | status 400 |
| JWT grants access to protected route | API | GET /api/incidents with JWT → 200 |
| Missing JWT returns 401 | API | GET /api/incidents without token → 401 |
| GET /api/auth/dev-token → token string | API | status 200, body.token is string |
| Request counters increment after calls | API | GET /metrics twice; counter value increases |

---

### 2. `e2e/chat.spec.ts` — Orchestrator chat UI + streaming

**Coverage: `OrchestratorChat` component, `/api/chat/stream`, gate approve/reject in chat, scenario shortcuts, follow-up chips, role display, grounding sources banner**

| Test | Type | Assert |
|------|------|--------|
| Chat view loads — input field present | UI | `textarea[placeholder*="anway"]` or `input[placeholder*="anway"]` visible |
| Chat view loads — send button present | UI | button with send icon/text visible |
| Chat view loads — role badge shown | UI | text "dev" or "sre" visible in role area |
| Scenario shortcut chips visible | UI | at least 3 quick-launch chips visible |
| Click scenario chip — populates input | UI | input value matches chip text |
| POST /api/chat missing query → 400 | API | status 400 |
| POST /api/chat missing sessionId → 400 | API | status 400 |
| POST /api/chat without LLM key → 503 | API | status 503 |
| Send message → SSE stream received, text delta events emitted | UI `@llm` | response area shows streamed text |
| Gate required event → gate UI appears in chat | UI `@llm` | gate panel with approve/reject buttons visible |
| Gate approve → POST /api/gate/:id/decide approved:true | UI `@llm` | gate dismissed, action executed confirmation shown |
| Gate reject → POST /api/gate/:id/decide approved:false | UI `@llm` | gate dismissed, rejection message shown |
| Follow-up suggestions appear after response | UI `@llm` | follow-up chip row visible after assistant message |
| Click follow-up chip → sends as new query | UI `@llm` | input cleared, new query in flight |
| Grounding sources banner shown when freshness < threshold | UI `@llm` | `[data-testid="stale-banner"]` or "based on data from" text visible |
| Token usage shown in message footer | UI `@llm` | digit + "t" shown below message |
| Settings panel opens | UI | click settings icon → settings panel visible |
| Settings panel closes | UI | click X → settings panel hidden |

---

### 3. `e2e/connectors.spec.ts` — Connector registry, save, bootstrap

**Coverage: `ConnectorsView`, `/api/settings/connectors`, `PUT /api/settings/connectors/:type`, `/api/connectors/:type/bootstrap`, `/api/connectors/:type/bootstrap-status`**

| Test | Type | Assert |
|------|------|--------|
| Connectors view loads — grid shows connector cards | UI | at least 1 card visible |
| Category filter — click category → filters cards | UI | card count changes |
| Category filter — "All" resets | UI | all connectors shown |
| "Connect" button opens modal | UI | modal with form fields visible |
| Modal shows correct fields for connector type | UI | prometheus modal shows baseUrl field |
| Save valid credentials → connector marked configured | UI | card shows configured badge after save |
| Save → PUT /api/settings/connectors/:type called with credentials | UI | network request contains correct body |
| Save failure → error shown in modal | UI | red error banner visible in modal |
| Error clears when modal reopened | UI | close + reopen modal → no error banner |
| Connector not marked configured on save failure | UI | card does NOT show configured badge |
| Bootstrap button triggers POST /api/connectors/:type/bootstrap | UI | "Bootstrapping…" indicator appears |
| Bootstrap status fetched on load | UI | bootstrapped badge visible if bootstrapped |
| GET /api/connectors → list with valid JWT | API | status 200, array response |
| GET /api/connectors without JWT → 401 | API | status 401 |
| PUT /api/settings/connectors/:type unknown type → 404 | API | status 404 |
| POST /api/connectors/:type/bootstrap → 200 | API | status 200 |

---

### 4. `e2e/incidents.spec.ts` — Incident CRUD + War Room UI

**Coverage: `IncidentView`, `/api/incidents` CRUD**

| Test | Type | Assert |
|------|------|--------|
| War Room view loads — incident list visible | UI | at least 1 row or empty state visible |
| Incident list fetched from real API | UI | incident rows match /api/incidents response |
| Click incident row → detail panel opens | UI | title, severity, timeline visible |
| Timeline shows events in order | UI | oldest event first |
| Resolve button visible on open incident | UI | "Resolve" button present |
| POST /api/incidents creates incident | API | status 201, body has id |
| GET /api/incidents/:id returns created incident | API | title, severity match |
| GET /api/incidents/:nonexistent → 404 | API | status 404 |
| POST /api/incidents missing title → 400 | API | status 400 |
| POST /api/incidents invalid severity → 400 | API | status 400 |
| POST /api/incidents/:id/resolve → ok | API | status 200 |
| PATCH /api/incidents/:id status update | API | status 200, body reflects new status |
| Resolved incident shows resolved badge in UI | UI | create → resolve → reload → badge shown |

---

### 5. `e2e/alerts.spec.ts` — Alert flow: Alertmanager webhook → Redis → incident

**Coverage: `AlertsView`, `/api/events/alert`, alert-subscriber, incident creation**

| Test | Type | Assert |
|------|------|--------|
| Signals view loads — alert list visible | UI | alert rows or empty state shown |
| Alert cards show severity badge | UI | "critical" / "high" / "warning" badge on each card |
| POST /api/events/alert (Alertmanager format) fires → incident created | API | GET /api/incidents within 2s returns new incident |
| Alert with `status: "resolved"` → no incident created | API | incident count unchanged |
| POST /api/events/alert internal format → incident created | API | direct `{tenantId, title, severity}` body → incident |
| POST /api/events/deploy missing tenantId → 400 | API | status 400 |
| POST /api/events/deploy invalid tenantId (not UUID) → 400 | API | status 400 |
| POST /api/events/deploy valid → 200 | API | status 200 |
| POST /api/events/pr-merged valid → 200 | API | status 200 |
| POST /api/events/pr-merged missing tenantId → 400 | API | status 400 |

---

### 6. `e2e/automations.spec.ts` — Triggers CRUD + monitor toggle

**Coverage: `AutomationsView`, `/api/automations/triggers`, `/api/automations/monitors`**

| Test | Type | Assert |
|------|------|--------|
| Automations view loads — triggers tab shown | UI | triggers list or empty state visible |
| Automations view loads — monitors tab shown | UI | monitors list or empty state visible |
| Switch between tabs — content changes | UI | tab content swaps |
| Create trigger form visible | UI | eventType, condition, actions fields present |
| Create trigger → appears in list | UI | fill form + submit → new row in list |
| Delete trigger → removed from list | UI | click delete + confirm → row disappears |
| Toggle monitor enable/disable | UI | PATCH sent → badge reflects new state |
| GET /api/automations/triggers → list | API | status 200, array |
| POST /api/automations/triggers → creates | API | status 201, id returned |
| PATCH /api/automations/triggers/:id → updates | API | status 200 |
| DELETE /api/automations/triggers/:id → removes | API | status 200, GET no longer returns it |
| GET /api/automations/monitors → list | API | status 200, array |
| PATCH /api/automations/monitors/:id → toggles enabled | API | status 200, enabled flipped |
| GET /api/triggers/:id/runs → run history | API | status 200, array |
| GET /api/cron/:id/runs → run history | API | status 200, array |
| POST /api/automations/evaluate → evaluates | API | status 200 |

---

### 7. `e2e/audit.spec.ts` — Audit log view + pagination

**Coverage: `AuditView`, `/api/audit`**

| Test | Type | Assert |
|------|------|--------|
| Audit view loads — log rows visible | UI | table rows or list items present |
| Rows show event type, timestamp, user | UI | columns visible in each row |
| GET /api/audit → returns rows | API | status 200, array with event_type, created_at |
| GET /api/audit?limit=5 → returns max 5 rows | API | array.length <= 5 |
| GET /api/audit?limit=5&offset=5 → second page | API | different rows than offset=0 |
| GET /api/audit?limit=201 → capped at 200 | API | array.length <= 200 |
| GET /api/audit without JWT → 401 | API | status 401 |
| API calls appear in audit log | UI | perform action → refresh audit → new entry |

---

### 8. `e2e/approvals.spec.ts` — Gate approve/reject via Approvals view

**Coverage: `ApprovalsView`, `POST /api/gate/:id/decide`**

| Test | Type | Assert |
|------|------|--------|
| Approvals view loads — pending list visible | UI | list or empty state shown |
| Approve action → POST /api/gate/:id/decide `{approved:true}` | UI | click Approve → POST fired, item removed from list |
| Reject action → POST /api/gate/:id/decide `{approved:false}` | UI | click Reject → POST fired, item removed from list |
| POST /api/gate/:nonexistent/decide → 404 | API | status 404 |
| POST /api/gate/:id/decide without JWT → 401 | API | status 401 |

---

### 9. `e2e/provider-config.spec.ts` — LLM provider setup

**Coverage: `ProviderConfig`/`ModelConfig`, `/api/settings/provider-manifests`, `/api/settings/provider`, `/api/settings/models`**

| Test | Type | Assert |
|------|------|--------|
| Models view loads — provider list shown | UI | provider cards (anthropic, openai, ollama…) visible |
| Select provider → shows fields (API key / base URL) | UI | input fields visible for selected provider |
| Provider manifests fetched from API | UI | provider names match /api/settings/provider-manifests |
| Active provider shown on load | UI | current provider highlighted |
| Save provider config → POST /api/settings/provider | UI | fill key + click save → success state |
| Fetch models → model list shown | UI | model dropdown populates after fetch |
| GET /api/settings/provider-manifests → array | API | status 200, array with id, name, models |
| GET /api/settings/provider with JWT → current config | API | status 200 |
| GET /api/settings/provider without JWT → 401 | API | status 401 |
| POST /api/settings/provider saves config | API | status 200, GET returns new provider |
| GET /api/settings/models?provider=anthropic → model list | API | status 200, array |
| GET /api/settings/models unsafe baseUrl → 400/403 | API | localhost/private IP blocked |

---

### 10. `e2e/services.spec.ts` — Service Catalog

**Coverage: `ServiceCatalog`, `/api/services`**

| Test | Type | Assert |
|------|------|--------|
| Services view loads — service cards visible | UI | at least 1 service card or empty state |
| Service card shows name, tier, language | UI | fields visible on card |
| Click service → detail panel opens | UI | service name in panel header |
| Dependency graph renders | UI | SVG or canvas element visible |
| Incident history shown per service | UI | incidents section in detail |
| Metrics shown per service | UI | error rate, latency, p99 visible |
| GET /api/services → list | API | status 200, array |
| GET /api/services without JWT → 401 | API | status 401 |

---

### 11. `e2e/lifecycle.spec.ts` — Developer lifecycle stage flow

**Coverage: `LifecycleView`, stage nodes**

| Test | Type | Assert |
|------|------|--------|
| Lifecycle view loads — horizontal stage flow visible | UI | 5+ stage nodes visible |
| All stage labels shown (PRD, TechSpec, Code, Tests, Deploy…) | UI | each label text present |
| Click stage node → context injected into chat | UI | navigates to chat view with query populated |
| Active stage highlighted | UI | active node has distinct style |

---

### 12. `e2e/editor.spec.ts` — One-window editor

**Coverage: `EditorView`**

| Test | Type | Assert |
|------|------|--------|
| Editor view loads — code panel visible | UI | code lines or editor element present |
| Findings panel visible | UI | severity badges (error/warn) shown |
| Click finding → highlights line | UI | line number highlighted |
| Gate confirm dialog present | UI | "Apply Fix" or confirm button visible |
| Confirm → gate fires (write action) | UI | confirmation state shown |

---

### 13. `e2e/api-client.spec.ts` — API Client

**Coverage: `ApiClientView`**

| Test | Type | Assert |
|------|------|--------|
| API client view loads — request list visible | UI | request history rows present |
| Method badge shown (GET/POST/etc) | UI | colored badge on each row |
| Click request row → populates builder | UI | method + path + body pre-filled |
| Method selector present | UI | dropdown with GET/POST/PUT/PATCH/DELETE |
| URL input present | UI | input field visible |
| Body editor present | UI | textarea for JSON body |
| Send button present | UI | "Send" button visible |
| Response panel visible after send | UI | status code + body shown |

---

### 14. `e2e/access.spec.ts` — User access + perimeter config

**Coverage: `AccessView`**

| Test | Type | Assert |
|------|------|--------|
| Access view loads — user list visible | UI | user rows or empty state present |
| User row shows email, role, perimeter | UI | columns visible |
| Perimeter config shows connector scopes | UI | connector/scope table or list visible |

---

### 15. `e2e/kb.spec.ts` — Knowledge Base explorer

**Coverage: `KbView`**

| Test | Type | Assert |
|------|------|--------|
| KB view loads — entity list visible | UI | entities or empty state shown |
| Entity row shows type, name, freshness | UI | metadata visible |
| Click entity → relationships panel opens | UI | related entities listed |
| Search input present | UI | search field visible |
| Search filters entity list | UI | type query → list narrows |

---

### 16. `e2e/workflow.spec.ts` — Autonomy dial + gate config

**Coverage: `WorkflowView`**

| Test | Type | Assert |
|------|------|--------|
| Workflow view loads — autonomy dial visible | UI | L1/L2/L3/L4 options visible |
| Current level highlighted | UI | active level has distinct style |
| Click different level → updates selection | UI | new level highlighted |
| Gate config section visible | UI | per-service gate config shown |
| Gate threshold shown | UI | confidence score threshold visible |

---

### 17. `e2e/cloud.spec.ts` — Cloud health

**Coverage: `CloudView`**

| Test | Type | Assert |
|------|------|--------|
| Cloud view loads — provider tabs (AWS/GCP/Azure) | UI | tab bar visible |
| Resource list visible | UI | resource rows or empty state |
| Security finding count shown | UI | count badge visible |
| Click resource → detail panel | UI | resource ARN/ID shown |

---

### 18. `e2e/k8s.spec.ts` — K8s view

**Coverage: `K8sView`**

| Test | Type | Assert |
|------|------|--------|
| K8s view loads without JS errors | UI | page renders, no console errors |
| Namespace list or pod list visible | UI | rows or empty state present |

---

### 19. `e2e/settings.spec.ts` — Settings view

**Coverage: `SettingsView`**

| Test | Type | Assert |
|------|------|--------|
| Settings view loads | UI | settings panel visible |
| Sections visible (general, security, etc.) | UI | at least 1 section heading |

---

### 20. `e2e/intake.spec.ts` — Signal routing / L1 Assist

**Coverage: `IntakeView`**

| Test | Type | Assert |
|------|------|--------|
| Routing view loads — rules list visible | UI | routing rule rows or empty state |
| L1 Assist config shown | UI | threshold + action config visible |
| Rule toggle changes enabled state | UI | toggle → state flips |

---

### 21. `e2e/navigation.spec.ts` — All 19 nav items load clean

**Coverage: all nav views, no JS errors**

| Test | Type | Assert |
|------|------|--------|
| Each of 19 nav items clickable | UI | click → view renders, no uncaught exceptions |
| No page-level JS errors on any view | UI | `page.on('pageerror')` fires zero times per view |
| Scroll reveals all sidebar items | UI | `scrollIntoViewIfNeeded` + `toBeVisible` for every nav item |

---

### 22. `e2e/security.spec.ts` — Security surface

**Coverage: API security, CORS, secret leakage**

| Test | Type | Assert |
|------|------|--------|
| API key not in /health response body | API | JSON.stringify(body) does not contain real key |
| JWT secret not in any response | API | check /health, /metrics, /api/audit |
| CORS header present on API routes | API | `access-control-allow-origin` header set |
| isSafeBaseUrl blocks 127.0.0.1 | API | PUT connector with baseUrl=http://127.0.0.1:9090 → 400 |
| isSafeBaseUrl blocks localhost | API | PUT connector with baseUrl=http://localhost:9090 → 400 |
| isSafeBaseUrl blocks 169.254.169.254 | API | cloud metadata endpoint → 400 |
| isSafeBaseUrl blocks 10.0.0.1 (RFC-1918) | API | private range → 400 |
| POST /api/graph/events without x-connector-key → 401 | API | status 401 |
| Connector credentials not returned in GET /api/connectors | API | no `credentials` or `config_encrypted` field in response |
| JWT cannot be used cross-tenant | API | token from tenant A cannot access tenant B incidents |

---

### 23. `e2e/graph-events.spec.ts` — Graph/KB event ingestion

**Coverage: `/api/graph/events`**

| Test | Type | Assert |
|------|------|--------|
| POST /api/graph/events without connector key → 401 | API | status 401 |
| POST /api/graph/events with valid key + payload → 200 | API | status 200 |
| POST /api/graph/events invalid payload → 400 | API | status 400 |

---

## Test Data + Fixtures

```typescript
// e2e/fixtures.ts
export const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'
export const DEMO_EMAIL  = 'dev@anway.local'
export const GATEWAY     = 'http://127.0.0.1:4000'

export async function getToken(request): Promise<string> {
  const r = await request.get(`${GATEWAY}/api/auth/dev-token`)
  const { token } = await r.json()
  return token
}

export async function authHeaders(request): Promise<Record<string, string>> {
  const token = await getToken(request)
  return { Authorization: `Bearer ${token}` }
}
```

---

## LLM-dependent tests

Tag with `@llm`. Guard with:
```typescript
test.skip(!process.env.ANTHROPIC_API_KEY, 'requires ANTHROPIC_API_KEY')
```

Tests tagged `@llm`: all chat.spec.ts tests involving real streaming, gate flow, follow-up chips, grounding banner, token display.

Run without LLM: `npx playwright test --grep-invert @llm`  
Run all: `ANTHROPIC_API_KEY=sk-… npx playwright test`

---

## Current coverage gap vs this plan

| Spec | Status |
|------|--------|
| infra.spec.ts | ✅ Mostly covered in anway.spec.ts — needs health/live/ready/startup, counter test |
| chat.spec.ts | ⚠️ Exists — only input/button presence tested. All streaming + gate + @llm tests missing |
| connectors.spec.ts | ⚠️ Exists — save error, bootstrap trigger, network request assertions missing |
| incidents.spec.ts | ✅ CRUD covered in anway.spec.ts — UI flow (click row → detail) missing |
| alerts.spec.ts | ⚠️ cert-alert-flow has webhook test — resolved status, deploy/pr events missing |
| automations.spec.ts | ✅ CRUD in anway.spec.ts — UI toggle, run history missing |
| audit.spec.ts | ⚠️ Exists — pagination test missing |
| approvals.spec.ts | ❌ Not written — no test for approve/reject flow |
| provider-config.spec.ts | ⚠️ Exists — save flow, model fetch, SSRF block tests missing |
| services.spec.ts | ❌ Not written |
| lifecycle.spec.ts | ❌ Not written |
| editor.spec.ts | ❌ Not written |
| api-client.spec.ts | ❌ Not written |
| access.spec.ts | ❌ Not written |
| kb.spec.ts | ❌ Not written |
| workflow.spec.ts | ❌ Not written |
| cloud.spec.ts | ❌ Not written |
| k8s.spec.ts | ❌ Not written |
| settings.spec.ts | ❌ Not written |
| intake.spec.ts | ❌ Not written |
| navigation.spec.ts | ✅ Exists — scroll fix applied, covers all nav items |
| security.spec.ts | ⚠️ Partially in anway.spec.ts — SSRF URL block, cross-tenant, credential exposure missing |
| graph-events.spec.ts | ⚠️ 401 in anway.spec.ts — valid key + invalid payload missing |
