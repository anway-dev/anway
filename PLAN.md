# Anway — Hardening Plan

**Owner:** Claude (autonomous executor)  
**Goal:** Close every sale-readiness and production-readiness gap identified in gap analysis.  
**Method:** Waves in criticality order. Each item has a Definition of Done (DoD). TypeScript must pass after every item. Gap analysis re-runs after every wave until all green.

---

## Safeguards

1. TypeScript (`npx tsc --noEmit`) must pass after every task — no exceptions
2. Every route change needs a corresponding proxy in `apps/web/app/api/`
3. No task marked done without verifying the specific DoD criteria below
4. No wave 2 starts until all wave 1 DoDs are verified
5. Hardcoded data, mock responses, and demo fallbacks must be clearly flagged with `// DEMO:` comments — never silently shipped as "real"

---

## WAVE 1 — Sale Blockers

### S1: Seed data script
**DoD:** `pnpm seed` (or `ts-node seed.ts`) populates a demo tenant with: 20+ services, 5+ namespaces, 10+ alerts (mix of severities), 5+ active/resolved incidents, 10+ deploys, 3+ gate events (one pending). All views show non-empty data after seed runs.

### S2: Demo login endpoint
**DoD:** `POST /api/auth/demo` returns a valid JWT for a pre-seeded demo tenant. No password required. Protected by `DEMO_MODE=true` env var — returns 404 in prod. Web UI has "Try Demo" button on login page.

### S3: LLM key missing — graceful error
**DoD:** When no LLM provider is configured, `POST /api/chat` returns `{ error: "No LLM provider configured", code: "NO_PROVIDER" }` with status 200 (not 500). UI shows "Configure a model in Settings" inline in chat — not a blank screen or JS error.

### S4: Remove hardcoded strings
**DoD:** "Acme Platform" reads from `GET /api/settings/workspace` (tenant name). Connector badge count reads from `GET /api/connectors/catalog` (real connected count). No hardcoded "7" or "Acme" in source.

### S5: Error boundaries on all views
**DoD:** Every view rendered in `page.tsx` is wrapped in an `<ErrorBoundary>` that catches render errors and shows an inline error card (not a blank screen). ErrorBoundary has a retry button. TypeScript clean.

### S6: Empty state designs for all views
**DoD:** All views (Signals, War Room, Services, K8s, Cloud, Pipeline, Environments, Connectors) have an empty state component with: icon, explanation text, primary CTA ("Connect a connector" → Connectors view). No blank white/dark rectangle.

### S7: Connector bootstrap feedback
**DoD:** Connectors view shows per-connector bootstrap state: "Bootstrapping…" spinner while in progress, "✓ Last synced X min ago" when done, "⚠ Failed" with retry button when bootstrap errors. Polling `GET /api/connectors/:type/bootstrap-status` every 5s while bootstrapping.

### S8: Pipeline view bug fixes
**DoD:** Pipeline view loads without console errors. Creating a pipeline, running a stage, approving a gate — all work end-to-end. TypeScript clean.

---

## WAVE 2 — Enterprise Close

### E1: Slack notification on gate events
**DoD:** When a gate enters `waiting` state, a Slack message is sent (if Slack connector configured) with: pipeline name, stage name, approve link, who triggered. Uses existing Slack connector config. Gracefully skipped if no Slack configured.

### E2: RBAC on write routes
**DoD:** All mutating routes (DELETE, POST for creates, PATCH) check `request.user.role`. Rules:
- `admin` — all operations
- `sre` — can approve gates, create incidents, trigger deploys
- `dev` — can create pipelines, run stages on non-prod envs only
- `pm` / `ba` — read only
Routes return `403` with `{ error: "insufficient role" }` when rule violated. All existing routes audited and updated.

### E3: Audit log append-only
**DoD:** Migration adds `RULE audit_no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING` and `RULE audit_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING`. Any attempt to modify audit_events silently fails at DB level. Test: `DELETE FROM audit_events` returns no error but rows remain.

### E4: Data freshness indicator
**DoD:** Every view that shows connector-sourced data displays a freshness badge: "Live" (< 2 min), "X min ago" (2–60 min), "Stale — last sync Xh ago" (> 60 min) with a manual refresh button. Uses `bootstrapped_at` from `connector_config` as the freshness source.

### E5: Terraform apply distributed lock
**DoD:** `POST /api/terraform/:env/apply` acquires a Redis lock `terraform:lock:{env}:{tenantId}` with 10-minute TTL before running. Returns `409 { error: "deploy in progress" }` if lock already held. Lock released after apply completes (success or failure).

### E6: Webhook signature verification
**DoD:** `events.ts` verifies HMAC-SHA256 signature for GitHub (`X-Hub-Signature-256`) and Datadog (`DD-REQUEST-SIGNATURE`) webhooks when `GITHUB_WEBHOOK_SECRET` / `DD_WEBHOOK_SECRET` env vars are set. Returns `401` on signature mismatch. Falls back to token auth if secrets not configured (backwards compatible).

### E7: Onboarding flow
**DoD:** New tenant landing on Anway (zero connectors connected) sees an onboarding modal with 3 steps: (1) Connect first connector, (2) Bootstrap graph, (3) Start chatting. Progress tracked. Dismissed permanently on first chat message sent. Not shown after any connector is connected.

---

## WAVE 3 — Flipkart Scale

### F1: Cursor-based pagination
**DoD:** All list endpoints (`/api/services`, `/api/alerts`, `/api/incidents`, `/api/pipelines`, `/api/audit`, `/api/kb`, `/api/entities`) support `?cursor=<id>&limit=<n>` (default limit 50, max 500). Response includes `{ data: [...], nextCursor: "<id>|null" }`. Existing callers without cursor get first page.

### F2: SSE Redis fan-out
**DoD:** Pipeline stage run SSE and chat SSE use Redis pub/sub for fan-out. Flow: handler publishes events to `sse:{runId}` channel; SSE response subscribes to that channel. Works correctly with 2+ gateway pods behind a load balancer.

### F3: BullMQ for graph builder
**DoD:** Graph builder events go through BullMQ queue (`graph-events`) instead of Redis pub/sub. Queue persists events if worker is down. Retry: 3 attempts with exponential backoff. Dead-letter queue for failed events. Worker picks up on restart.

### F4: Per-connector rate limiting
**DoD:** `connector_config` table gets `rate_limit_rps INT DEFAULT 10` column. Connector registry wraps each tool call with a rate limiter (token bucket, Redis-backed). Exceeds limit → wait then retry (not fail). GitHub default: 1 rps (5000/hr = ~1.4/s). Datadog: 0.08 rps (300/hr).

### F5: K8s write actions
**DoD:** `k8s.ts` implements: `POST /api/k8s/pods/:namespace/:name/restart`, `POST /api/k8s/deployments/:namespace/:name/scale` (body: `{ replicas: n }`), `POST /api/k8s/nodes/:name/cordon`. All gated: user must have `sre` or `admin` role. All audit-logged. K8s view exposes these buttons with a confirmation modal (L2 approve pattern).

### F6: SSO Azure AD E2E
**DoD:** OIDC flow works end-to-end against a test Azure AD tenant (or mock OIDC provider in tests). `oidc.ts` handles: authorization_endpoint redirect, token exchange, user provisioning from claims, JWT issue. E2E test using `@backstage/test-utils` or equivalent OIDC mock.

### F7: K8s namespace scoping
**DoD:** K8s queries filter by `user_perimeters.allowed_namespaces` when set. User with `{ allowed_namespaces: ["payments", "orders"] }` sees only those namespaces in K8s view and K8s write actions. Admin sees all.

### F8: Session memory summarization
**DoD:** `InMemorySessionMemory.summarise()` and `RedisSessionMemory.summarise()` compress conversation turns older than the last 10 into a single summary turn. Triggered automatically when session exceeds 50 turns. LLM call (cheap model) to produce summary. Prevents context window overflow.

### F9: Token budget enforcement
**DoD:** `token_budget_monthly` from `tenants` table is enforced. `TokenBudget` middleware in agent harness checks `token_usage_this_month` (stored in Redis, reset monthly) before each LLM call. Exceeds limit → `429 { error: "token budget exceeded" }`. Budget usage visible in Settings view.

### F10: Connection pool config
**DoD:** `DATABASE_URL` includes `?connection_limit=5&pool_timeout=20` (configurable via `DB_POOL_SIZE` env). PgBouncer Terraform resource added to all cloud environments (EKS, ECS, GCP, Azure). Pool mode: transaction. Documented in deployment guide.

---

## WAVE 4 — Complete

### C1: Pipeline rollback stage
**DoD:** After `monitor` stage if status = `failed`, a `rollback` stage auto-triggers: runs `terraform apply` with previous state (stored as `metadata.previousTfState` on the pipeline). Rollback result updates pipeline status. Rollback gate option configurable per pipeline.

### C2: Multi-region Postgres
**DoD:** AWS EKS Terraform environment provisions RDS with Multi-AZ enabled and one read replica in a second AZ. `DATABASE_URL` points to writer. `DATABASE_REPLICA_URL` points to reader (used for read-heavy queries in KB/audit). GCP and Azure equivalents added.

### C3: Helm chart complete
**DoD:** `infra/helm/anway/` includes templates for: Postgres (or external DB secret), Redis, Neo4j, Ingress (nginx), NetworkPolicy (deny-all + allow gateway→postgres, gateway→redis), HorizontalPodAutoscaler (gateway: 2–10 pods, CPU 70%), PodDisruptionBudget (minAvailable: 1), ServiceAccount + IRSA annotations for AWS.

### C4: Automated backup config
**DoD:** AWS EKS Terraform: RDS automated backups enabled (retention 7 days), S3 export enabled. GCP: Cloud SQL automated backups enabled. Azure: Azure Database automated backups with geo-redundant storage. All Terraform outputs include backup schedule info.

### C5: Sentry error tracking
**DoD:** Gateway has `@sentry/node` initialized at startup (when `SENTRY_DSN` set). All unhandled exceptions and Fastify errors captured with tenant context (tenantId in Sentry scope). Source maps uploaded in CI. Sentry connector available in connector catalog.

### C6: ChatOps Slack slash commands
**DoD:** Slack app handles: `/anway incidents` (lists active), `/anway deploy <service> <env>` (triggers pipeline), `/anway approve <gate-id>` (approves gate), `/anway status <service>` (shows health). All responses are ephemeral Slack messages with action buttons.

### C7: SLO burn rate cron
**DoD:** `slo_burn_check` cron job (every 5 min) computes 1h and 6h error budget burn rate for all services with SLO configured. Burn rate > 2× budget → emit alert event → triggers automations. SLO data visible in service detail view.

### C8: Change management on deploy
**DoD:** Pipeline deploy gate (before prod) can optionally require a Jira change ticket. Gate policy `require_change_ticket: true` → gate checks for open Jira ticket linked to this deployment before allowing approval. Change ticket URL stored on pipeline metadata.

---

## Wave Completion Criteria

Each wave is complete when:
- All tasks in wave are marked Done
- `npx tsc --noEmit` passes in both `apps/gateway` and `apps/web`
- Gap analysis re-run shows all wave items as Green
- No regressions in previously-green items

---

## Status

| Wave | Status | Started | Completed |
|------|--------|---------|-----------|
| Wave 1 — Sale Blockers | ✅ Done | 2026-06-15 | 2026-06-15 |
| Wave 2 — Enterprise Close | ✅ Done | 2026-06-15 | 2026-06-15 |
| Wave 3 — Flipkart Scale | ✅ Done | 2026-06-15 | 2026-06-15 |
| Wave 4 — Complete | ✅ Done | 2026-06-15 | 2026-06-15 |
