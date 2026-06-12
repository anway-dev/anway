# SALE-READY PLAN — Gap Closure Task List

Generated 2026-06-12 from the honest gap audit (build ≈ 40–45% of vision).
Goal: pilot-ready for a design partner in Phases 1–3; enterprise-credible (Flipkart/Razorpay
vendor review) after Phases 1–5.

## Executor rules (read before every task)

1. **Read the named files before editing.** Never edit from memory of this document alone.
2. **One task = one commit.** Commit message: `feat|fix(scope): <task id> — <summary>`.
3. **After every task run:** `pnpm -r test` and `./scripts/certify.sh`. Both must pass.
   A task is NOT done while either fails.
4. **Never add mock data, never weaken an assertion to make a test pass.** If blocked,
   stop and write the blocker under the task as `BLOCKED: <reason>`.
5. **Naming contracts (violations broke prod before):**
   - Tool names: `<connector-name>.<action>`. Perimeter scopes keyed by connector NAME,
     never DB UUID (`apps/gateway/src/routes/chat.ts` → `toolPrefix`).
   - Bare-named harness tools must be added to the perimeter builtin allowlist.
   - Write-action tool names must match `WRITE_ACTION_PATTERNS` in
     `packages/agent/src/gate/gate.ts` or extend the patterns.
6. **Webhook senders** authenticate with `ANVAY_WEBHOOK_TOKEN` (see
   `apps/gateway/src/routes/events.ts`), never JWT.
7. Every new feature gets a certification test appended to
   `apps/web/e2e/99-certification.spec.ts` (success path, no escape hatches).
8. UI: inline styles only, palette from CLAUDE.md. No Tailwind.

Statuses: `[ ]` open · `[~]` in progress · `[x]` done · `[B]` blocked.

---

## PHASE 1 — Security hardening (enterprise sale blocker #1)

### S1. Encrypt connector credentials at rest
- `[ ]` **S1.1** Create `apps/gateway/src/utils/crypto.ts`: `encryptJson(obj): string` /
  `decryptJson(str): obj` using AES-256-GCM, key from `ANVAY_ENCRYPTION_KEY` env
  (32-byte base64). Format: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`. Throw at startup
  in production if key missing. Unit tests: roundtrip, tamper detection, missing key.
- `[ ]` **S1.2** Migration `0023_encrypted_credentials`: add `credentials_enc TEXT` to
  `connector_config`, `config_enc TEXT` to `connectors`, `api_key_enc TEXT` to
  `provider_config`. Keep old columns for now (S1.4 drops them).
- `[ ]` **S1.3** Update all reads/writes to use encrypted columns via crypto.ts:
  - `apps/gateway/src/routes/settings.ts` (provider apiKey, connector credentials)
  - `apps/gateway/src/routes/connectors.ts` (bootstrap/reconnect credential loads)
  - `apps/gateway/src/graph-builder/subscriber.ts` (`connectorCredential`, kb:stale, payload enrichment)
  - `apps/gateway/src/routes/chat.ts` + `apps/gateway/src/connectors/registry.ts` (config_encrypted)
  - `apps/gateway/src/routes/graph-events.ts` + chat provider resolution (api_key)
  Write a one-shot backfill script `scripts/encrypt-existing-credentials.ts` (reads old
  column, writes enc column, idempotent).
- `[ ]` **S1.4** Migration `0024_drop_plaintext_credentials`: drop old plaintext columns.
  Only after S1.3 certified.
- `[ ]` **S1.5** Cert test: register connector with a credential, then query DB directly
  (`docker exec infra-postgres-1 psql ...`) asserting the stored value does NOT contain
  the plaintext credential substring.

### S2. Secrets hygiene
- `[ ]` **S2.1** `apps/gateway/src/config/env.ts`: in production refuse to boot when
  `JWT_SECRET` is unset, equals the dev default, or is < 32 chars. Unit test with
  `NODE_ENV=production`.
- `[ ]` **S2.2** Audit/log scrubber: in `PostgresAuditSink` and pino serializers, redact
  keys matching `/key|token|secret|password|credential/i` in payloads (replace value with
  `"[REDACTED]"`). Unit test: tool_call audit with `{apiKey: "x"}` arg stores redacted.
- `[ ]` **S2.3** Gateway `/api/auth/dev-token`: additionally require
  `ALLOW_DEV_TOKEN=true` env (defense in depth beyond NODE_ENV check). Update
  `apps/gateway/.env.example`, `.env`, and e2e fixtures docs comment.
- `[ ]` **S2.4** Global rate limiting: add `@fastify/rate-limit` (100 req/min per IP
  default, `/api/events/*` exempt up to 600/min). Keep existing /auth/token limiter.

### S3. SSO (OIDC)
- `[ ]` **S3.1** Add `openid-client` to gateway. New route file
  `apps/gateway/src/routes/oidc.ts`: `GET /auth/oidc/login` (redirect to IdP) and
  `GET /auth/oidc/callback` (code exchange → look up user by email in tenant → issue the
  same JWT as /auth/token). Config via env: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`,
  `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_TENANT_ID`. Routes return 404 when
  unconfigured. Unit tests with mocked issuer.
- `[ ]` **S3.2** Login page: when `GET /auth/oidc/status` reports configured, show
  "Sign in with SSO" button above the email form; clicking navigates to
  `/auth/oidc/login?redirect=<path>`. Callback must set the `anvay_token` cookie via
  existing `/api/auth/set-token` flow (gateway redirects to
  `web/login/sso-complete#token=...`; page posts token to set-token then routes home).
- `[ ]` **S3.3** Cert test (skipped unless `OIDC_ISSUER_URL` set): status endpoint shape;
  plus e2e using a local mock IdP container is optional — document manual verification.

### S4. Per-user access perimeter (vision: user provisioning)
- `[ ]` **S4.1** Migration `0025_user_perimeters`: table `user_perimeters`
  (`id, tenant_id, user_id, connector_name, read_scopes TEXT[], write_scopes TEXT[]`,
  RLS like other tables, unique on tenant+user+connector).
- `[ ]` **S4.2** Gateway CRUD `apps/gateway/src/routes/access.ts`:
  `GET/PUT /api/access/users/:userId/perimeter` (admin only). Audit every change.
- `[ ]` **S4.3** `chat.ts`: when user_perimeters rows exist for the user, intersect them
  into `connectorScopes` (user scope ∩ manifest, per connector_name) instead of the
  current manifest-only scopes. No rows = current behavior (full connector scope).
  Unit test in `apps/gateway/src/__tests__/chat.test.ts`.
- `[ ]` **S4.4** Wire `apps/web/components/access-view.tsx` to the new API (list users,
  edit scopes, save). Remove its mock data import.
- `[ ]` **S4.5** Cert test: PUT a perimeter restricting write to nothing for the demo
  user → chat tool write call gets `hard_block` audit event (assert via /api/audit).

---

## PHASE 2 — Connector buildout (20 noop stubs → real)

### C0. Conformance harness first (do before any connector)
- `[ ]` **C0.1** Create `packages/agent/src/testing/connector-conformance.ts`: exported
  `describeConnectorConformance(name, { bootstrap, mockServer })` running a shared
  contract: bootstrap is idempotent (run twice → same entity count), every entity has
  `connectorCoordinates`, unreachable endpoint throws (no silent []), episodeHints
  non-empty on success. Each connector test file calls this with an undici MockAgent or
  nock fixture.
- `[ ]` **C0.2** Registration: replace the `pendingConnectors` NoopBootstrap list in
  `apps/gateway/src/graph-builder/subscriber.ts` with real imports as each lands.
  Add a unit test asserting no connector in `VALID_BOOTSTRAP_TYPES` maps to Noop.

### C1–C10. Per-connector tasks (identical recipe — one task each)
Recipe for connector `<X>`:
  (a) read `connectors/<X>/src/` — agent.ts/bootstrap.ts may exist but be unwired or stub;
  (b) implement `bootstrap.ts` extracting the entities/relationships in the table below
      via official REST/SDK, credentials from event payload;
  (c) implement read tools in `tools.ts` named `<X>.<action>`;
  (d) conformance test via C0.1 with recorded fixtures;
  (e) add package to gateway deps, import real bootstrap in subscriber.ts, extend
      `VALID_BOOTSTRAP_TYPES` and the connectors UI config fields if missing;
  (f) cert: register with fake-cred → bootstrap-status reports error (not success) —
      proves no silent noop.

| Task | Connector | Entities → relationships | Priority |
|---|---|---|---|
| `[ ]` C1 | jira | Ticket, Team → Ticket RELATES_TO Service, OWNED_BY Team | P0 |
| `[ ]` C2 | slack | Team(channel) → Team notify coordinates | P0 |
| `[ ]` C3 | sentry | Alert/Issue → Alert MONITORED_BY Service | P0 |
| `[ ]` C4 | jenkins | Pipeline, Deploy → Deploy DEPLOYED_TO Service | P0 |
| `[ ]` C5 | pagerduty | Engineer, Team, oncall → Team ONCALL Engineer | P0 |
| `[ ]` C6 | grafana | Dashboard coordinates per service | P1 |
| `[ ]` C7 | opsgenie | Alert, oncall | P1 |
| `[ ]` C8 | newrelic | Service health, Alert | P1 |
| `[ ]` C9 | circleci | Pipeline, test_failed events | P1 |
| `[ ]` C10 | confluence | Doc entities → L4 org memory source | P2 |

Remaining 10 (terraform, vault, snyk, sonarqube, vercel, dynatrace, elastic, coralogix,
launchdarkly, notion): same recipe, P2 — only after C1–C10 certified.

---

## PHASE 3 — Graph depth (the actual product moat)

- `[ ]` **G1** Episodic layer on by default: add `agent-service` + `neo4j` to
  `infra/docker-compose.yml` with healthchecks; set `AGENT_SERVICE_URL` in gateway
  .env.example/.env; certify HybridKnowledgeGraph path (cert: POST episode via an
  alert event → `getFacts` returns it within 30s).
- `[ ]` **G2** Ticket→service resolution (vision "the hard part"): on `ticket_created`,
  Graph Builder extracts service mentions (cheap model), fuzzy-matches Service entities,
  creates `RELATES_TO` edge with confidence; < 0.7 stores `unconfirmed: true`. Verify
  what already exists in `packages/agent/src/graph-builder/` first; close the delta only.
  Cert: post ticket_created webhook mentioning "payments-api" → edge appears in
  /api/graph/entities.
- `[ ]` **G3** Triage traversal endpoint: `GET /api/graph/triage/:entityName` returning
  service → repo → team → oncall → recent deploys (the 3-hop query from CLAUDE.md) from
  structural tables. Used by War Room. Unit + cert test.
- `[ ]` **G4** `connectorCoordinates` audit: every tier-1 bootstrap must write
  coordinates usable for targeted calls (repo, namespace+selector, dashboard_id, job).
  Extend conformance harness to assert per-connector coordinate keys.
- `[ ]` **G5** Staleness surfacing: orchestrator already gets `freshness` — thread it to
  the UI: when < 0.5, chat response header chip "Based on data from <age> · re-sync
  recommended". SSE event `staleness` + render in orchestrator-chat.tsx.

---

## PHASE 4 — Product surface depth

- `[ ]` **P1** Trigger/cron run history: migration `0026_run_history`
  (`automation_runs`: id, tenant_id, kind trigger|cron, ref_id, started_at, finished_at,
  status, summary jsonb, RLS). Write rows in `triggers/executor.ts` and the user-monitor
  `run()` wrapper. Replace `/api/triggers/:id/runs` + `/api/cron/:id/runs` mock-empty
  endpoints with real queries. UI: automations-view expandable rows render real history.
  Cert: created monitor shows ≥1 run with status.
- `[ ]` **P2** Implement remaining monitor types `cloud_security_scan`,
  `cost_anomaly_detection`, `incident_retrospective` in
  `apps/gateway/src/jobs/cron-monitors.ts` (real queries over entities/incidents; cost
  needs a cloud connector — gate behind it, return `status:'unconfigured'` not fake ok).
  Re-add to POST enum + UI list as each lands.
- `[ ]` **P3** Gate policy config: migration `0027_gate_policies`
  (`tenant_id, scope, approvers_required INT, auto_approve_threshold FLOAT`). Gate
  creation in orchestrator reads policy (default: 1 approver, no auto-approve).
  Workflows view edits policies via new `/api/gate/policies` CRUD. Cert: set
  auto_approve_threshold=0.99 → low-confidence write still gates.
- `[ ]` **P4** Lifecycle MVP (one thread, two gates): chat command path where Product
  agent (`packages/agent/src/agents/product.ts`) produces PRD artifact → stored in new
  `artifacts` table → gate → TechSpec agent consumes PRD → techspec artifact → gate.
  Surface artifacts in Lifecycle view (replace its mock for these two stages; later
  stages stay visibly "not connected"). Cert: API-driven PRD→approve→TechSpec flow.
- `[ ]` **P5** Honesty pass on nav: views still 100% mock (cloud, k8s, intake, editor,
  api client, projects) get a visible "DESIGN PREVIEW — not connected" banner component.
  No mock view ships unbannered. Cert I.7: banner present on those views, absent on
  certified ones.
- `[ ]` **P6** Oncall morning brief delivery: `oncall_morning_brief` result →
  Proactive Signals inbox (signals feed entry, severity info). Cert via running monitor.

---

## PHASE 5 — Scale & ops (Flipkart-size credibility)

- `[ ]` **O1** Remove in-process state from gateway: move `sessionTokenUsage`,
  registration of adapters cache TTL, and memory gate sink default to Redis
  (`chat.ts`, `registry.ts`). Acceptance: two gateway instances behind round-robin pass
  cert (document `GATEWAY_INSTANCES=2 ./scripts/certify.sh` mode using docker compose
  scale + nginx).
- `[ ]` **O2** Graceful shutdown + readiness: SIGTERM drains SSE streams, BullMQ worker
  close, Redis quit. `/health/ready` returns 503 during drain. Unit test.
- `[ ]` **O3** Helm chart `infra/helm/anvay/`: gateway, web, agent-service, BullMQ
  worker split-out optional; values for replicas, resources, secrets via existing env
  names. `helm template` lint in CI.
- `[ ]` **O4** Load baseline: `scripts/load/k6-chat.js` (50 VU chat, 500 VU events
  webhook, 5 min) + `scripts/load/run.sh`. Record P99 + error rate into
  `docs/PERF-BASELINE.md`. Fail script if webhook P99 > 500ms or errors > 0.1%.
- `[ ]` **O5** Backup/restore: `scripts/backup.sh` (pg_dump + redis snapshot note),
  `scripts/restore.sh`, documented RPO/RTO in `docs/OPS.md`.
- `[ ]` **O6** CI pipeline: GitHub Actions workflow — typecheck, unit tests, build,
  then certify against compose stack on every PR. Cert suite is the merge gate.

---

## PHASE 6 — Sale collateral (code-adjacent)

- `[ ]` **X1** Audit export: `GET /api/audit/export?from&to` → NDJSON stream (admin
  only, rate-limited). Cert: export contains today's events.
- `[ ]` **X2** Data retention: nightly cron job purging audit_events / automation_runs /
  kb_episodes older than `RETENTION_DAYS` env (default 365). Unit test with fake rows.
- `[ ]` **X3** `docs/SECURITY.md`: encryption at rest (S1), token model, perimeter
  model, webhook auth, RLS tenancy — written from code, no aspirational claims.
- `[ ]` **X4** Pilot runbook `docs/PILOT.md`: install on customer VPC via compose/helm,
  connector onboarding order, SSO setup, expected first-week outcomes.

---

## Sequencing & gates

```
Phase 1 (S1–S4)  → tag v0.2-secure   — pilot conversations can start
Phase 2 (C0–C5)  → tag v0.3-connect  — design partner install
Phase 3 (G1–G5)  → tag v0.4-graph    — the demo that sells
Phase 4 (P1–P6)  → tag v0.5-product
Phase 5 (O1–O6)  → tag v0.6-scale    — enterprise vendor review possible
Phase 6 (X1–X4)  → collateral, parallel with 4–5
```

Order within Phase 1 is mandatory (S1 before S3; S2 anytime). C0 strictly before C1+.
P0 connectors before P1. Everything else parallelizable.

Definition of done for the whole plan: `./scripts/certify.sh` green with every new cert
section, zero NoopBootstrap in VALID_BOOTSTRAP_TYPES, zero plaintext credentials in DB,
two-instance cert pass, and docs X3/X4 reviewed by Raj.
