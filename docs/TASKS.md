# Anway — SDE Task Board

> **Agent instructions:** Read `docs/PRODUCT.md` before starting any task — it is the source of truth for all spec, interfaces, decisions, and non-negotiables. Every task below references the relevant PRODUCT.md section. Do not invent behaviour not described there.
>
> **Parallel execution:** Tasks marked `[PARALLEL]` within the same wave have no inter-dependencies and can be worked simultaneously. Tasks marked `[SEQUENTIAL]` must complete before the next wave starts. Never start a task until all its `Depends on` tasks are done.
>
> **Definition of done:** A task is done when its acceptance criteria pass, types check (`pnpm typecheck`), and there are no lint errors (`pnpm lint`). Tests must ship with the code (non-negotiable #7).

---

## M0 — Foundation

**Goal:** Monorepo runs. All services boot. Auth works. DB seeded. `docker compose up` works.
**Ref:** PRODUCT.md §5 (Architecture), §9 M0

---

### Wave 0-A — Must be first

#### M0-T1 `[SEQUENTIAL]`
**Title:** Monorepo root — pnpm workspaces + turborepo pipeline

**What to do:**
- Verify `pnpm-workspace.yaml` covers `apps/*` and `packages/*` (already exists — check it)
- Add `test` and `typecheck` tasks to `turbo.json` with correct `dependsOn` and output caching rules
- Add root `package.json` scripts: `dev`, `build`, `lint`, `typecheck`, `test`
- Add `.nvmrc` / `.node-version` pinned to Node 22
- Add `.gitignore` covering: `node_modules`, `.next`, `dist`, `.env*.local`, `*.tsbuildinfo`

**Files:** `turbo.json`, `package.json`, `.nvmrc`, `.gitignore`

**Done when:**
- `pnpm install` from root resolves all workspaces
- `pnpm build` runs through turborepo pipeline without error
- `pnpm typecheck` runs across all packages

---

### Wave 0-B — All parallel, no inter-dependencies

#### M0-T2 `[PARALLEL]`
**Title:** Docker Compose — dev infrastructure stack

**What to do:**
- Create `infra/docker-compose.yml` with services: postgres (with pgvector extension), redis, otel-collector, prometheus, grafana
- Postgres: init script enables `vector` extension, creates `anway` database
- Redis: no auth in dev, expose 6379
- OTEL Collector: accepts OTLP gRPC (4317) + HTTP (4318), exports to Prometheus + Jaeger
- Prometheus: scrapes OTEL collector, all app `/metrics` endpoints
- Grafana: pre-provisioned Prometheus datasource, import dashboards for Node.js + Postgres
- All services: named volumes for persistence, health checks
- Create `infra/.env.example` with all required vars (Postgres creds, ports)

**Ref:** PRODUCT.md §5.3 (Full stack section at bottom of architecture)

**Files:** `infra/docker-compose.yml`, `infra/.env.example`, `infra/otel-collector.yaml`, `infra/prometheus.yml`

**Done when:**
- `docker compose -f infra/docker-compose.yml up -d` starts all services healthy
- Postgres accepts connections, pgvector extension present
- Prometheus UI shows all targets up
- Grafana loads at `localhost:3001`

---

#### M0-T3 `[PARALLEL]`
**Title:** packages/types — shared TypeScript types

**What to do:**
- Create `packages/types/src/index.ts` exporting all shared types
- Implement: `Result<T, E>` (Ok/Err discriminated union), base `AppError` class with `code` + `message` + `cause`
- Error codes enum: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `UPSTREAM_ERROR`, `RATE_LIMITED`, `TOKEN_LIMIT_EXCEEDED`
- Types for: `TenantId`, `UserId`, `SessionId`, `ConnectorId` (branded string types — not plain `string`)
- Types for: `AgentRole` (`sre | dev | pm | ba | admin`), `ConnectorMode` (`read | write | read-write`)
- Types for: `StreamEvent` (discriminated union: `text_delta | tool_call | tool_result | gate_required | done | error`)
- Types for: `Message` (`role: user | assistant | system`, `content: string`)
- `tsconfig.json` with `composite: true` for project references
- Export from `package.json` as `@anway/types`

**Ref:** PRODUCT.md §5.4 (IModelProvider interface), §6.2 (error handling)

**Files:** `packages/types/src/index.ts`, `packages/types/package.json`, `packages/types/tsconfig.json`

**Done when:**
- `pnpm --filter @anway/types build` succeeds
- All branded types prevent `string` assignment without explicit cast
- `Result` type enforces exhaustive handling in consuming code

---

#### M0-T4 `[PARALLEL]`
**Title:** Database schema — Prisma migrations (initial tables)

**What to do:**
- Add Prisma to `apps/gateway` (do not create a separate package — co-locate with gateway)
- Schema tables (all with `tenant_id` — ref PRODUCT.md §6.6 multi-tenancy rules):
  - `tenants` — `id`, `name`, `slug`, `plan` (tier1/tier2/tier3), `token_budget_monthly`, `connector_limit`, `created_at`
  - `users` — `id`, `tenant_id`, `email`, `role` (AgentRole), `created_at`
  - `sessions` — `id`, `user_id`, `tenant_id`, `created_at`, `expires_at`
  - `connectors` — `id`, `tenant_id`, `name`, `type`, `mode`, `config_encrypted` (jsonb), `capability_manifest` (jsonb), `created_at`
  - `audit_events` — `id`, `tenant_id`, `user_id`, `session_id`, `event_type`, `payload` (jsonb), `created_at` — **no update, no delete permissions on this table**
  - `incidents` — `id`, `tenant_id`, `title`, `severity`, `status`, `created_at`, `resolved_at`
- Row-level security: enable RLS on all tables, policy `tenant_id = current_setting('app.tenant_id')::uuid`
- Migration: `0001_initial.sql` via Prisma migrate
- Seed script: creates demo tenant + admin user

**Ref:** PRODUCT.md §6.5 (persistence), §6.6 (multi-tenancy), §10 non-negotiable #6

**Files:** `apps/gateway/prisma/schema.prisma`, `apps/gateway/prisma/migrations/`, `apps/gateway/prisma/seed.ts`

**Done when:**
- `pnpm --filter anway-gateway prisma migrate dev` applies migration cleanly against running Postgres
- RLS policies reject queries missing `app.tenant_id` context variable
- Seed script creates demo tenant, user, one connector row

---

#### M0-T5 `[PARALLEL]`
**Title:** apps/gateway — Fastify server skeleton

**What to do:**
- Bootstrap `apps/gateway` as a Fastify app (TypeScript, ESM)
- Plugins: `@fastify/cors`, `@fastify/jwt` (RS256), `@fastify/sensible`, `pino` structured logging
- Every request log must include: `trace_id`, `tenant_id` (from JWT), `user_id`, `method`, `path`, `status`, `duration_ms`
- Routes:
  - `GET /health` → `{ status: "ok", version, uptime }`
  - `GET /metrics` → Prometheus text format (use `prom-client`)
  - `POST /auth/token` → stub (returns mock JWT for dev, real auth in M7)
- OTEL instrumentation: `@opentelemetry/sdk-node`, traces exported to OTEL collector configured in T2
- `tenant_id` extracted from JWT, set as `app.tenant_id` Postgres session variable on each DB connection
- Graceful shutdown: `SIGTERM` drains in-flight requests, closes DB pool

**Ref:** PRODUCT.md §5.1 (stack — Fastify BFF), §6.3 (observability), §6.6 (multi-tenancy)

**Files:** `apps/gateway/src/server.ts`, `apps/gateway/src/plugins/`, `apps/gateway/src/routes/health.ts`, `apps/gateway/src/routes/auth.ts`

**Done when:**
- `pnpm --filter anway-gateway dev` starts without error
- `GET /health` returns 200
- `GET /metrics` returns valid Prometheus metrics
- Logs appear as JSON with all required fields
- Traces visible in Jaeger UI

---

#### M0-T6 `[PARALLEL]`
**Title:** apps/web — server-side API routes skeleton

**What to do:**
- Create `apps/web/app/api/chat/route.ts` — POST handler, reads `ANTHROPIC_API_KEY` from `process.env`, returns stub SSE stream (`data: {"type":"text_delta","content":"stub response"}\n\n`)
- Create `apps/web/app/api/providers/route.ts` — GET handler, reads which env vars are set (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OLLAMA_ENDPOINT`, `LMSTUDIO_ENDPOINT`), returns `{ providers: [{ id, configured: boolean }] }` — **never return key values, status only**
- Create `apps/web/.env.local.example` with all six vars, placeholder values, comment explaining server-side-only rule
- Remove any API key input fields from `ModelConfig` component — replace with "Configured via environment variable" status fetched from `/api/providers`

**Ref:** PRODUCT.md §5.1 (LLM API calls must be server-side), §10 non-negotiable #1

**Files:** `apps/web/app/api/chat/route.ts`, `apps/web/app/api/providers/route.ts`, `apps/web/.env.local.example`, `apps/web/components/model-config.tsx`

**Done when:**
- `POST /api/chat` with any body returns SSE stream (`text/event-stream`)
- `GET /api/providers` returns provider list — no key values ever in response
- `ModelConfig` shows provider status, no API key input field visible
- `pnpm typecheck` passes

---

#### M0-T7 `[PARALLEL]`
**Title:** CI pipeline — GitHub Actions

**What to do:**
- Create `.github/workflows/ci.yml`
- Triggers: `push` to any branch, `pull_request` to `main`
- Jobs (all parallel within the workflow):
  - `typecheck` — `pnpm install && pnpm typecheck`
  - `lint` — `pnpm lint`
  - `test` — `pnpm test` (passes if no tests exist yet — add `--passWithNoTests`)
  - `build` — `pnpm build`
  - `docker-build` — builds each `apps/*/Dockerfile` via `docker build`, does not push
- Cache: pnpm store cache keyed on `pnpm-lock.yaml`
- Node version: matches `.nvmrc` from T1
- `Dockerfile` for `apps/gateway`: multi-stage, distroless final image, non-root user
- `Dockerfile` for `apps/web`: multi-stage Next.js standalone output

**Ref:** PRODUCT.md §9 M0 deliverables

**Files:** `.github/workflows/ci.yml`, `apps/gateway/Dockerfile`, `apps/web/Dockerfile`

**Done when:**
- CI passes on a clean push to a test branch
- Docker images build without error
- Cached runs complete in <2 min

---

### Wave 0-C — Depends on T2 + T5 both done

#### M0-T8 `[SEQUENTIAL]`
**Title:** End-to-end smoke test — all services boot together

**What to do:**
- Create `infra/docker-compose.dev.yml` (extends `docker-compose.yml`) that also runs gateway + web in dev mode via volume mounts
- Write `scripts/smoke-test.sh`: hits `/health` on gateway, `/api/providers` on web, checks Prometheus targets, exits 0 if all pass
- Add `pnpm smoke` root script that runs the shell script

**Files:** `infra/docker-compose.dev.yml`, `scripts/smoke-test.sh`

**Done when:**
- `docker compose -f infra/docker-compose.dev.yml up -d && pnpm smoke` exits 0
- All Prometheus targets are `UP`

---

## M1 — Orchestrator Core

**Goal:** Real LLM calls. Orchestrator classifies and responds. Perimeter enforced. Audit logged.
**Ref:** PRODUCT.md §5.4 (agent harness), §5.5 (access control), §9 M1
**Depends on:** All M0 tasks done

---

### Wave 1-A — All parallel

#### M1-T1 `[PARALLEL]`
**Title:** packages/agent — IModelProvider interface + provider implementations

**What to do:**
- Create `packages/agent/src/interfaces/provider.ts`:
  - `IModelProvider` interface: `chat(messages, tools, opts): Promise<ChatResponse>` and `stream(messages, tools, opts): AsyncIterator<StreamChunk>`
  - `IEmbeddingProvider` interface: `embed(texts: string[]): Promise<number[][]>`
  - `InferenceOptions`: `model`, `temperature`, `maxTokens`, `stopSequences`
  - `ChatResponse`: `content`, `toolCalls`, `usage` (inputTokens, outputTokens)
  - `StreamChunk`: discriminated union matching `StreamEvent` from `@anway/types`
- Create provider implementations in `packages/agent/src/providers/`:
  - `AnthropicProvider implements IModelProvider` — uses `@anthropic-ai/sdk`, maps to `IModelProvider` contract
  - `OpenAIProvider implements IModelProvider` — uses `openai` SDK, same contract
  - `OllamaProvider implements IModelProvider` — calls Ollama REST API (OpenAI-compatible endpoint)
- `ProviderFactory.create(config: ProviderConfig): IModelProvider` — reads config, returns correct provider — this is the only place any provider SDK is imported
- All providers: never imported directly by agent or orchestrator code — only via `ProviderFactory`

**Ref:** PRODUCT.md §5.4 (IModelProvider), §5.4 (non-negotiable: model-agnostic)

**Files:** `packages/agent/src/interfaces/provider.ts`, `packages/agent/src/providers/anthropic.ts`, `packages/agent/src/providers/openai.ts`, `packages/agent/src/providers/ollama.ts`, `packages/agent/src/providers/factory.ts`

**Done when:**
- `pnpm --filter @anway/agent typecheck` passes
- All providers implement the full `IModelProvider` interface
- No provider SDK import exists outside `packages/agent/src/providers/`
- Unit test: mock `IModelProvider`, verify orchestrator calls `provider.stream()` not any SDK method directly

---

#### M1-T2 `[PARALLEL]`
**Title:** packages/agent — ISessionMemory interface + RedisSessionMemory

**What to do:**
- Create `packages/agent/src/interfaces/memory.ts`:
  - `ISessionMemory` interface: `get(sessionId)`, `append(sessionId, turn)`, `summarise(sessionId)`, `clear(sessionId)`
  - `ConversationTurn`: `role`, `content`, `toolCalls?`, `timestamp`
  - `SessionContext`: `sessionId`, `userId`, `tenantId`, `effectiveRole`, `turns: ConversationTurn[]`, `summary?: string`
- Create `packages/agent/src/memory/redis-session.ts`:
  - `RedisSessionMemory implements ISessionMemory`
  - Stores turns as JSON list in Redis key `session:{sessionId}:turns`
  - TTL = 24h, refreshed on each `append`
  - `summarise()`: compresses turns older than last 10 into a single summary turn (calls cheap model via `IModelProvider`)
  - Max stored turns before auto-summarise: 50
- `MemoryFactory.create(config): ISessionMemory` — returns correct impl

**Ref:** PRODUCT.md §7.3 (session memory), §7.4 (memory systems — locked decisions: RedisSessionMemory)

**Files:** `packages/agent/src/interfaces/memory.ts`, `packages/agent/src/memory/redis-session.ts`, `packages/agent/src/memory/factory.ts`

**Done when:**
- `append` + `get` round-trip works against running Redis
- `summarise` reduces >50 turns to summary + last 10
- TTL resets on each `append`
- Unit tests: mock Redis, verify TTL reset, turn compression logic

---

#### M1-T3 `[PARALLEL]`
**Title:** packages/agent — perimeter engine + IAuditSink

**What to do:**
- Create `packages/agent/src/interfaces/audit.ts`:
  - `IAuditSink` interface: `append(event: AuditEvent): Promise<void>`
  - `AuditEvent`: `id`, `tenantId`, `userId`, `sessionId`, `eventType`, `payload`, `createdAt`
  - Event types: `query_received`, `agent_spawned`, `tool_call_allowed`, `tool_call_blocked`, `gate_decision`, `write_action_confirmed`, `write_action_executed`, `session_end`
- Create `packages/agent/src/perimeter/engine.ts`:
  - `AgentPerimeter` class: constructed from `user_perimeter` (from DB) + `connector_manifest`
  - `allows(toolCall: ToolCall): boolean` — deterministic rule evaluation, no LLM
  - `resolveCapabilities(userId, connectors): AgentPerimeter` — intersects user perimeter with connector manifests
  - `hardBlock(call, perimeter): HardBlock` — returns typed block with reason, always audit-logged
- Create `packages/agent/src/middleware/perimeter.ts`:
  - `createPerimeterMiddleware(perimeter, auditSink)` — wired into Mastra `onToolCall` hook
  - Blocks and logs before returning to LLM. No exceptions.
- Create `packages/agent/src/middleware/token-meter.ts`:
  - `createTokenMeterMiddleware(budget: TokenBudget)` — wired into Mastra `onModelCall` hook
  - `TokenBudget`: per-query, per-session, per-tenant-daily, per-tenant-monthly limits
  - Hard block if any limit exceeded

**Ref:** PRODUCT.md §5.5 (access control — deterministic), §5.4 (wrapper layer), §6.8 (token metering middleware)

**Files:** `packages/agent/src/interfaces/audit.ts`, `packages/agent/src/perimeter/engine.ts`, `packages/agent/src/middleware/perimeter.ts`, `packages/agent/src/middleware/token-meter.ts`

**Done when:**
- `allows()` returns `false` for any tool call outside declared perimeter — verified with unit tests covering 5+ cases
- `hardBlock` events always appear in audit sink — no code path skips the log
- Token meter blocks when budget exceeded — unit tested with mock budget at 0

---

### Wave 1-B — Depends on T1 + T3 both done

#### M1-T4 `[SEQUENTIAL]`
**Title:** packages/agent — Orchestrator + createOrchestrator public surface

**What to do:**
- Install Mastra: `@mastra/core` in `packages/agent`
- Create `packages/agent/src/orchestrator.ts`:
  - `createOrchestrator({ model: IModelProvider, tools, perimeter, auditSink, sessionMemory })` — returns `Orchestrator`
  - Wire `createPerimeterMiddleware` into Mastra `onToolCall` hook
  - Wire `createTokenMeterMiddleware` into Mastra `onModelCall` hook
  - Wire `auditSink.append` on every tool call (allowed + blocked)
  - `runSession(orchestrator, input, ctx): AsyncIterator<StreamEvent>` — runs the agent loop, yields `StreamEvent` items
  - Intent classification: cheap model call first (classify query intent + role inference before routing to specialist)
  - `StreamEvent` types from `@anway/types` — no Mastra types leak to callers
- `createSpecialistAgent({ name, model: IModelProvider, tools, systemPrompt })` — thin Mastra agent wrapper, same middleware wired
- `createGate({ condition, approvers, autoApproveThreshold })` — uses Mastra `waitForInput` primitive

**Ref:** PRODUCT.md §5.4 (harness surface, wrapper layer, Mastra decision)

**Files:** `packages/agent/src/orchestrator.ts`, `packages/agent/src/specialist-agent.ts`, `packages/agent/src/gate.ts`, `packages/agent/src/index.ts`

**Done when:**
- `createOrchestrator` + `runSession` produce a valid `AsyncIterator<StreamEvent>` against a mock `IModelProvider`
- Perimeter middleware fires on every tool call — verified via test spy on `auditSink.append`
- Token meter fires on every model call
- No Mastra types exported from `packages/agent/src/index.ts`

---

### Wave 1-C — Depends on T4 done

#### M1-T5 `[PARALLEL]`
**Title:** apps/gateway — /api/chat endpoint with real SSE streaming

**What to do:**
- Create `apps/gateway/src/routes/chat.ts`:
  - `POST /api/chat` — body: `{ query: string, sessionId: string, model?: ProviderConfig }`
  - Reads JWT → extracts `userId`, `tenantId`
  - Loads user perimeter from DB
  - Constructs `AgentPerimeter`, `TokenBudget`, `IModelProvider` via factory
  - Calls `runSession(orchestrator, query, ctx)`
  - Streams `StreamEvent` items as SSE (`text/event-stream`)
  - Each SSE event: `data: ${JSON.stringify(event)}\n\n`
  - On stream end: `data: [DONE]\n\n`
- `PostgresAuditSink implements IAuditSink`: writes to `audit_events` table, fire-and-forget (no await on non-critical path), <1ms perceived latency

**Ref:** PRODUCT.md §5.1 (pending architecture — LLM API calls server-side), §5.6 (audit system)

**Files:** `apps/gateway/src/routes/chat.ts`, `apps/gateway/src/audit/postgres-sink.ts`

**Done when:**
- `POST /api/chat` streams real LLM tokens as SSE to curl client
- Every call produces `audit_events` rows (query_received + agent_spawned at minimum)
- Token usage logged to audit payload

---

#### M1-T6 `[PARALLEL]`
**Title:** apps/web — wire OrchestratorChat to real /api/chat SSE

**What to do:**
- Update `apps/web/components/orchestrator-chat.tsx`:
  - Replace mock streaming with `fetch('/api/chat', { method: 'POST', body: JSON.stringify({ query, sessionId }) })`
  - Read response as `ReadableStream`, parse SSE lines, dispatch `StreamEvent` items to UI state
  - Handle all `StreamEvent` types: `text_delta` appends to message, `tool_call` shows execution trace line, `gate_required` shows gate UI, `error` shows error state, `done` finalises message
  - Session ID: generate once per chat mount, persist in component state
  - Show token usage (from `done` event payload) below each response

**Ref:** PRODUCT.md §5.1 (pending architecture), current `apps/web/components/orchestrator-chat.tsx`

**Files:** `apps/web/components/orchestrator-chat.tsx`

**Done when:**
- Chat sends real queries to `/api/chat`
- LLM tokens stream character-by-character into UI
- Tool call trace lines appear as agent executes
- Gate UI appears when `gate_required` event received

---

## M2 — Core Connectors

**Goal:** Generic adapter-based connector system. Any MCP server or CLI auto-registers without writing connector code. Agent-driven discovery. No per-service packages.
**Ref:** PRODUCT.md §4.12 (Zero-code connector registration), §9 M2
**Depends on:** All M1 tasks done, M2-T6/T7 (mcp-adapter + cli-adapter) done ✅

> **CANCELLED:** M2-T1/T2/T3/T4 (per-service connector packages) are removed. There are no `connectors/github`, `connectors/datadog`, `connectors/linear`, `connectors/argocd` packages. Services connect via config entries against the generic adapters. The `connectors/` directory does not exist.

---

### Wave 2-A — All parallel

#### M2-T1 `[PARALLEL]`
**Title:** CliConnector — `discoverSubcommands()` from `--help` output

**What to do:**
- Add `discoverSubcommands()` to `packages/cli-adapter/src/connector.ts`
- Runs `binary --help` → parses subcommand names + one-line descriptions from stdout
- For each top-level subcommand, optionally runs `binary <subcommand> --help` to discover nested subcommands (1 level deep only)
- Returns `DiscoveredCommand[]`: `{ name: string, description: string, subcommands?: string[] }`
- If `allowedSubcommands` is provided in config: skip discovery, use allowlist (curated mode)
- If `allowedSubcommands` is absent: run discovery, build tool list from parsed output
- Add `discoverAndBuild()`: runs discovery → calls `buildTools()` with discovered list → stores in cache
- Help text parsing: handle common formats (`  subcommand   description`, tab-separated, USAGE blocks). Best-effort — unknown format → empty list, log warn

**Files:** `packages/cli-adapter/src/connector.ts`, `packages/cli-adapter/src/discovery.ts`

**Done when:**
- `new CliConnector({ binary: 'gh', name: 'github' }).discoverSubcommands()` returns non-empty list
- `new CliConnector({ binary: 'kubectl', name: 'k8s' }).discoverSubcommands()` returns non-empty list
- `allowedSubcommands` present → discovery skipped, uses list directly
- Unit tests cover: parsed output with mock help text, allowlist bypass
- `pnpm typecheck` clean

---

#### M2-T2 `[PARALLEL]`
**Title:** Agent-driven connector registration tools

**What to do:**
- Add two orchestrator tools to `apps/gateway/src/connectors/`:
  - `register_connector`: accepts `{ type: 'mcp' | 'cli', name, config }` → instantiates adapter, calls `getTools()` / `discoverSubcommands()`, writes to `connectors` table, returns tool count
  - `list_connectors`: returns all connectors for tenant with health status
- Both tools go through perimeter (only `admin` role can call `register_connector`)
- `register_connector` is a write action → subject to gate approval (L2)
- Wire into `getToolsForTenant()` in `apps/gateway/src/connectors/registry.ts`

**Files:** `apps/gateway/src/connectors/registration-tools.ts`, `apps/gateway/src/connectors/registry.ts`

**Done when:**
- Chat message "connect github via gh CLI" → agent calls `register_connector` → `gh` tools available in next query
- Chat message "connect Linear MCP at http://..." → agent calls `register_connector` → Linear tools available
- Non-admin user calling `register_connector` → hard blocked by perimeter

---

### Wave 2-B — Depends on Wave 2-A done

#### M2-T5 `[SEQUENTIAL]`
**Title:** Connector registry + orchestrator integration (updated)

**What to do:**
- `apps/gateway/src/connectors/registry.ts`: loads connector configs from DB per tenant, instantiates `McpConnector` or `CliConnector` based on `connector.type`, caches instances per tenant (singleton — not per-request)
- Singleton pattern: one adapter instance per `(tenantId, connectorId)` pair — prevents connection leak from `McpConnector`
- `getToolsForTenant(prisma, tenantId)`: returns `ExecutableTool[]` for all active connectors for tenant, scoped by perimeter
- Wire `CliConnector.onExec` to `auditSink.append()` for every CLI tool call
- `GET /api/connectors`: returns connector list with health status per tenant (calls `adapter.health()`)
- `apps/web/components/connectors.tsx`: fetch real connector status from `GET /api/connectors`

**Ref:** PRODUCT.md §4.12

**Files:** `apps/gateway/src/connectors/registry.ts`, `apps/gateway/src/routes/connectors.ts`
- KB sync: after each connector read, push event to Redis Pub/Sub channel `kb:sync:{tenantId}`
- `apps/web/components/connectors.tsx`: fetch real connector status from `GET /api/connectors`
- `GET /api/connectors`: returns connector list with health status per tenant

**Ref:** PRODUCT.md §5.7, §5.8, §9 M2

**Files:** `apps/gateway/src/connectors/registry.ts`, `apps/gateway/src/routes/connectors.ts`

**Done when:**
- Orchestrator query that mentions "GitHub PRs" routes to GitHub connector tool
- Connector health shown in UI reflects real API health check
- KB sync event emitted on every connector read

---

### Wave 2-C — Parallel, depends on M2-T5 done

#### M2-T6 `[PARALLEL]`
**Title:** packages/mcp-adapter — generic MCP server connector

**What to do:**
- Create `packages/mcp-adapter/` workspace package
- `McpConnector implements IConnector`:
  - Constructor: `{ url: string, name: string, mode: ConnectorMode }`
  - `getTools()`: calls MCP `tools/list` → maps each tool to `ExecutableTool` with `run()` that calls MCP `tools/call`
  - Tool names namespaced: `<connectorName>.<mcpToolName>` (e.g. `linear.create_issue`)
  - Capability manifest auto-derived from tool list: read tools → `capabilities.read`, write tools → `capabilities.write` (write detection: tool name matches `isWriteAction()`)
  - Health check: `tools/list` ping with 5s timeout
  - Each result tagged: `{ source: connectorName, fetched_at: Date, ttl: 60 }` — override per tool if MCP schema declares `x-ttl`
- `GET /api/connectors/register` body: `{ type: 'mcp', url, name, mode }` → instantiates McpConnector, persists to connectors table, triggers KB bootstrap
- Registry wires `McpConnector` when `connector.type === 'mcp'`

**Ref:** PRODUCT.md §4.12 (Zero-code connector registration), §5.7 (connector strategy)

**Files:** `packages/mcp-adapter/src/connector.ts`, `packages/mcp-adapter/src/tools.ts`, `packages/mcp-adapter/package.json`, `packages/mcp-adapter/tsconfig.json`

**Done when:**
- Point adapter at any MCP-compliant server → `getTools()` returns typed `ExecutableTool[]`
- `run()` calls MCP server and returns grounded result
- Tool names follow `<name>.<mcpTool>` convention
- `health()` returns `healthy` when server reachable, `degraded` on timeout
- `pnpm typecheck` clean, unit test with mock MCP server passes

---

#### M2-T7 `[PARALLEL]`
**Title:** packages/cli-adapter — generic CLI subprocess connector

**What to do:**
- Create `packages/cli-adapter/` workspace package
- `CliConnector implements IConnector`:
  - Constructor: `{ name: string, binary: string, allowedSubcommands: string[], env?: Record<string, string> }`
  - `getTools()`: each `allowedSubcommand` → one `ExecutableTool` (name: `<name>.<subcommand_underscored>`, e.g. `github.pr_list`)
  - `run(subcommand, args)`: executes `[binary, ...subcommand.split(' '), ...argsList]` via `child_process.spawn` — **never shell string interpolation**
  - Args serialized to CLI flags from typed object: `{ repo: 'org/x', limit: 10 }` → `['--repo', 'org/x', '--limit', '10']`
  - Hard limits: 30s timeout (SIGTERM then SIGKILL), 10MB stdout cap
  - Credentials injected via `env` option only — never in argv (no secrets in audit log)
  - Every call appended to audit sink: `{ binary, subcommand, argv: redactedArgv, exitCode, durationMs }`
  - Stdout: JSON.parse if parseable, else plain string
- Registry wires `CliConnector` when `connector.type === 'cli'`

**Ref:** PRODUCT.md §4.12 (Zero-code connector registration), §5.7 (connector strategy)

**Files:** `packages/cli-adapter/src/connector.ts`, `packages/cli-adapter/src/tools.ts`, `packages/cli-adapter/package.json`, `packages/cli-adapter/tsconfig.json`

**Done when:**
- `CliConnector` wrapping `gh` returns typed PR list from `gh pr list --json`
- Subprocess argv logged in audit sink (credentials absent from log)
- Command injection not possible — test: `args = { repo: 'x; rm -rf /' }` → passed as literal string, not interpreted by shell
- 30s timeout enforced — test: slow subprocess killed at deadline
- `pnpm typecheck` clean, unit test with mock subprocess passes

---

## M3 — Incident War Room

**Goal:** Real incident data. War room auto-assembled from live connectors.
**Ref:** PRODUCT.md §3 (feature — Incident War Room), §9 M3
**Depends on:** M2 complete

---

### Wave 3-A — All parallel

#### M3-T1 `[PARALLEL]`
**Title:** IncidentService — CRUD + audit

**What to do:**
- `apps/gateway/src/services/incident.ts`:
  - `create(tenantId, data)`, `update(id, tenantId, patch)`, `resolve(id, tenantId)`, `list(tenantId, filters)`, `get(id, tenantId)`
  - Every mutation: append to `audit_events` — no silent writes
  - Postgres table: already in schema (M0-T4) — add missing columns if needed (`timeline` jsonb, `hypothesis` text, `runbook_steps` jsonb)
- `GET /api/incidents`, `POST /api/incidents`, `PATCH /api/incidents/:id`

**Files:** `apps/gateway/src/services/incident.ts`, `apps/gateway/src/routes/incidents.ts`

**Done when:** CRUD endpoints return correct data, audit rows appear on every mutation

---

#### M3-T2 `[PARALLEL]`
**Title:** SREAgent — hypothesis + timeline assembly

**What to do:**
- `packages/agent/src/agents/sre.ts`:
  - `SREAgent`: specialist agent with tools from GitHub, Datadog, ArgoCD connectors
  - Given incident ID + initial alert context: queries connectors, assembles grounded hypothesis
  - Output: `IncidentContext` — `hypothesis`, `timeline: TimelineEvent[]`, `metrics: MetricSnapshot[]`, `relatedDeploys`, `relatedPRs`, `suggestedRunbook`
  - Every claim grounded: `source`, `fetched_at` attached to each timeline event
  - Uses cheap model for connector summarisation, expensive model for final hypothesis

**Ref:** PRODUCT.md §2 (SRE agent), §7 (anti-hallucination: grounding), §6.8 (model tier strategy)

**Files:** `packages/agent/src/agents/sre.ts`

**Done when:**
- Given mock incident alert, SREAgent returns `IncidentContext` with all fields populated and sourced
- No unsourced claims in output — enforced by type (every field has `groundedBy`)

---

#### M3-T3 `[PARALLEL]`
**Title:** Event trigger — alert_fired → create_incident

**What to do:**
- `apps/gateway/src/triggers/alert-to-incident.ts`:
  - Subscribe to `alert_fired` events on Redis Pub/Sub
  - On receive: perimeter check, create incident via `IncidentService`, spawn `SREAgent` with alert context, store resulting `IncidentContext`
  - Surface result to UI via `POST /api/incidents/{id}/context`
  - All steps: audit-logged

**Ref:** PRODUCT.md §5.4 (event triggers), §3 (automations feature)

**Files:** `apps/gateway/src/triggers/alert-to-incident.ts`

**Done when:** Publish mock `alert_fired` event to Redis → incident appears in DB + SRE context populated

---

### Wave 3-B — Depends on 3-A complete

#### M3-T4 `[SEQUENTIAL]`
**Title:** Wire incident-view.tsx to real API

**What to do:**
- Update `apps/web/components/incident-view.tsx`:
  - Replace all mock data imports with `fetch('/api/incidents')` and `fetch('/api/incidents/{id}/context')`
  - Loading states while context assembles
  - "Trigger Orchestrator" button passes incident context to `OrchestratorChat` as initial context
- All existing UI layout preserved — no redesign, data source swap only

**Files:** `apps/web/components/incident-view.tsx`

**Done when:** War room shows real incident data; clicking incident assembles real hypothesis from live connectors

---

## M4 — Service Catalog + Knowledge Base

**Goal:** Live service graph. KB with freshness scoring. Anti-hallucination grounding.
**Ref:** PRODUCT.md §7 (KB architecture), §9 M4
**Depends on:** M3 complete

---

### Wave 4-A — All parallel

#### M4-T1 `[PARALLEL]`
**Title:** KB schema — entities, relationships, kb_entries

**What to do:**
- Prisma migration: new tables
  - `entities` — `id`, `tenant_id`, `type` (Service/Team/Engineer/Incident/Deploy/PR/Commit/Alert), `name`, `metadata` jsonb, `created_at`
  - `relationships` — `id`, `tenant_id`, `from_entity_id`, `rel_type`, `to_entity_id`, `metadata` jsonb
  - `kb_entries` — `id`, `tenant_id`, `entity_id?`, `source`, `fetched_at`, `ttl_seconds`, `freshness_score` (float), `content` text, `embedding` vector(1536), `created_at`
- Indexes: `entity_id` + `rel_type` on relationships (graph traversal), HNSW index on `kb_entries.embedding`, `(tenant_id, freshness_score)` on kb_entries
- `IKnowledgeGraph` interface in `packages/agent/src/interfaces/knowledge-graph.ts`: `addEpisode`, `getFacts`, `getEntity`, `getRelationships`, `search`

**Ref:** PRODUCT.md §7.5 (storage architecture), §7.6 (IKnowledgeGraph interface)

**Files:** `apps/gateway/prisma/migrations/0002_kb.sql`, `packages/agent/src/interfaces/knowledge-graph.ts`

**Done when:** Migration applies cleanly, HNSW index created, `IKnowledgeGraph` interface compiles

---

#### M4-T2 `[PARALLEL]`
**Title:** GraphitiKnowledgeGraph — Graphiti + Apache AGE implementation

**What to do:**
- Install Graphiti (Zep, Apache 2.0) and Apache AGE Postgres extension
- `packages/agent/src/kb/graphiti-kg.ts`:
  - `GraphitiKnowledgeGraph implements IKnowledgeGraph`
  - `addEpisode`: extract entities + relationships from connector event, write to Postgres via Graphiti
  - `getFacts(query, at?)`: temporal query — facts valid at time `at` (uses Graphiti's `valid_from`/`valid_to`)
  - `search(query, topK)`: pgvector cosine similarity on `kb_entries.embedding` + relationship traversal
  - `getRelationships`: adjacency table traversal (Postgres CTE, 3-hop max)
  - Every entry: `source`, `fetched_at`, `ttl_seconds`, initial `freshness_score = 1.0`
- `KnowledgeGraphFactory.create(config): IKnowledgeGraph`

**Ref:** PRODUCT.md §7.6 (locked: Graphiti + Apache AGE, swap path KùzuDB)

**Files:** `packages/agent/src/kb/graphiti-kg.ts`, `packages/agent/src/kb/factory.ts`

**Done when:**
- `addEpisode` for a deploy event creates Service + Deploy entities + `deployed_by` relationship
- `getFacts('payments-api error rate', at: T)` returns freshness-scored results
- `search` returns top-K relevant entries via embedding similarity

---

#### M4-T3 `[PARALLEL]`
**Title:** Freshness daemon — background KB decay + re-sync

**What to do:**
- `apps/gateway/src/kb/freshness-daemon.ts`:
  - Runs on schedule (every 5 min via `setInterval` in dev, Trigger.dev job in prod — see M5)
  - Queries all `kb_entries` where `freshness_score > 0`
  - Decays score: `freshness = 1.0 * exp(-elapsed / ttl)` (exponential decay)
  - Entries below 0.5: emit `kb:stale:{tenantId}:{entityId}` Redis event (triggers re-sync)
  - Entries below 0.2: mark as stale in DB, not served without re-fetch
  - Purge: entries at 0.0 deleted from working context (kept in archive table for audit)

**Ref:** PRODUCT.md §7.3 (freshness scoring), §7.3 (context rot prevention)

**Files:** `apps/gateway/src/kb/freshness-daemon.ts`

**Done when:** Unit test: entry created with TTL 60s, after simulated 30s decay, score ≈ 0.6

---

### Wave 4-B — Depends on 4-A complete

#### M4-T4 `[SEQUENTIAL]`
**Title:** Orchestrator grounding — every claim sourced

**What to do:**
- Update orchestrator in `packages/agent/src/orchestrator.ts`:
  - Before finalising response, validate all claims are grounded to a `kb_entry` with `source` + `fetched_at`
  - Ungrounded claims: agent must explicitly state "I don't have current data on X — last sync was Y" — never infer
  - Response metadata includes: list of sources used, oldest `fetched_at`, min `freshness_score` across all used entries
- Update `StreamEvent` `done` type: include `groundingSources: GroundingSource[]`
- UI: if any source `freshness_score < 0.5`, show "Based on data from X ago · re-sync recommended" banner in chat

**Ref:** PRODUCT.md §7.2 (anti-hallucination: grounding), §7.3 (staleness surfaced to user)

**Files:** `packages/agent/src/orchestrator.ts`, `apps/web/components/orchestrator-chat.tsx`

**Done when:** Query about stale data shows freshness warning in UI; ungroundable claim produces explicit "no current data" response not a fabrication

---

### Wave 4-C — Depends on 4-A complete (parallel with 4-B)

#### M4-T5 `[PARALLEL]`
**Title:** Software Intelligence Graph — structural schema + Apache AGE

**What to do:**
- Enable Apache AGE extension on Postgres: `CREATE EXTENSION IF NOT EXISTS age;`
- Create AGE graph: `SELECT create_graph('anway_org');`
- Define vertex labels (entity types) and edge labels (relationship types) matching CLAUDE.md "Software Intelligence Graph" schema
- `packages/agent/src/kb/structural-graph.ts`:
  - `StructuralGraph` class — wraps AGE Cypher queries via Postgres driver
  - `upsertEntity(entity: EntitySpec): Promise<void>` — idempotent, merge on `(id, tenant_id)`
  - `upsertRelationship(rel: RelationshipSpec): Promise<void>` — idempotent merge
  - `resolveContext(entityId: string, depth?: number): Promise<AgentContext>` — multi-hop traversal, default depth 3
  - Key traversal implemented: `Ticket → RELATES_TO → Service → HOSTED_IN → Repo, OWNED_BY → Team → ONCALL → Engineer`
  - All queries scoped by `tenant_id` — no cross-tenant leakage
- Add `resolveContext` to `IKnowledgeGraph` interface
- Unit tests: seed 3 services + 2 teams + 5 tickets, assert `resolveContext(ticketId)` returns correct service + team + engineer

**Ref:** CLAUDE.md "Software Intelligence Graph", PRODUCT.md §4.8 (key traversals table)

**Files:** `packages/agent/src/kb/structural-graph.ts`, `packages/agent/src/interfaces/knowledge-graph.ts`, `apps/gateway/prisma/migrations/0003_age.sql`

**Done when:**
- `resolveContext('ticket-123')` returns `{ service: payments-api, repo: org/payments, team: payments-team, oncall: alice }` from seeded test data
- All queries include `tenant_id` filter

---

#### M4-T6 `[PARALLEL]`
**Title:** Graph Builder Agent — event-driven graph maintenance

**What to do:**
- `packages/agent/src/agents/graph-builder.ts`:
  - `GraphBuilderAgent` — Mastra specialist agent, cheap model tier only (Haiku / gpt-4o-mini)
  - Not routable by orchestrator — event-driven only, triggered by Trigger.dev jobs
  - Handles the full event table from CLAUDE.md "Graph Builder Agent" section
  - System prompt: focused on entity extraction, relationship inference, coordinate resolution. No user-facing output.
- `packages/agent/src/interfaces/bootstrap.ts`:
  - `IConnectorBootstrap`: `bootstrap(connector: ConnectorConfig): Promise<GraphSeed>`
  - `GraphSeed`: `{ entities: EntitySpec[], relationships: RelationshipSpec[], episodeHints: string[] }`
- `packages/agent/src/agents/graph-builder.ts` — `runBootstrap(connector, seed)`:
  - Calls `IConnectorBootstrap.bootstrap()`, writes entities + relationships to `StructuralGraph`, emits episodes to Graphiti
  - Idempotent — upsert, never duplicate
  - Emits `bootstrap:completed` / `bootstrap:failed` to EventBus
  - Emits `graph:updated` on every mutation (downstream caches invalidate)
- Event handlers wired per event type (see CLAUDE.md trigger table):
  - `connector_registered` → `runBootstrap()`
  - `ticket_created` → create Ticket entity, run service resolution: cheap-model extract service name → fuzzy match known Service entities → confidence score → `unconfirmed: true` if < 0.7
  - `pr_merged` → create Commit entity, parse "fixes #N" → `Commit→FIXES→Ticket`
  - `resource_added` → extract cloud tags/labels → resolve owning Service
  - All others: upsert entity, upsert relationships per event payload
- Mock `IConnectorBootstrap` implementations for GitHub-shaped + Linear-shaped data — real connector bootstraps ship with their connector packages
- Tests: `connector_registered` event → assert graph seeded with correct entities + relationships; `ticket_created` event → assert service resolution fires + confidence scored

**Ref:** CLAUDE.md "Graph Builder Agent", PRODUCT.md §5.5

**Files:** `packages/agent/src/agents/graph-builder.ts`, `packages/agent/src/interfaces/bootstrap.ts`

**Done when:**
- `connector_registered` triggers bootstrap, graph seeded with mock GitHub connector data
- `ticket_created` creates Ticket entity + attempts service resolution
- `graph:updated` emitted after every mutation
- All runs idempotent (running twice = same graph state)

**Files:** `packages/agent/src/interfaces/bootstrap.ts`, `packages/agent/src/kb/bootstrap-runner.ts`, `packages/agent/src/kb/graph-updater.ts`

**Done when:**
- `runBootstrap` with mock GitHub connector seeds 3 repos + 2 teams + `HOSTED_IN` relationships
- `connector_registered` event auto-triggers bootstrap
- `github:push` event updates Repo entity `last_push_at`
- `linear:ticket_created` event creates Ticket node, attempts service resolution

---

#### M4-T7 `[PARALLEL]`
**Title:** Agent context injection — orchestrator uses graph before routing

**What to do:**
- Update `packages/agent/src/orchestrator.ts`:
  - Before routing to any specialist agent: call `knowledgeGraph.resolveContext(primaryEntityId, depth: 3)`
  - Inject returned `AgentContext` into specialist agent system prompt as a grounded context block
  - Format: structured text block with entities, relationships, recent episodes, freshness scores
  - If `context.freshness < 0.5`: log warning, still inject but mark stale
  - If `resolveContext` fails or returns empty: agent proceeds with L1 live data only (no hallucination fallback)
- `packages/agent/src/orchestrator.ts` — add `extractPrimaryEntity(query: string): Promise<string | null>`:
  - Cheap model call: "what entity is this query about?" → returns entity id if known, null if not
  - On null: skip graph context injection, proceed with live connector data
- Unit tests: mock graph returns context for "payments-api" entity, assert context block appears in specialist agent's first message

**Ref:** CLAUDE.md "Agent context injection", PRODUCT.md §4.8 (context injection description)

**Files:** `packages/agent/src/orchestrator.ts`

**Done when:**
- Query "why is payments-api slow?" → orchestrator resolves `payments-api` entity → injects team + repo + recent deploy context into SRE agent prompt
- Freshness < 0.5 on any source → warning logged, stale flag in context block

---

## M5 — Automations

**Goal:** Event triggers and cron monitors running in production.
**Ref:** PRODUCT.md §3 (automations feature), §5.4 (event triggers + cron monitors), §9 M5
**Depends on:** M4 complete

---

### Wave 5-A — All parallel

#### M5-T1 `[PARALLEL]`
**Title:** Trigger.dev integration — background job infrastructure

**What to do:**
- Add Trigger.dev (`@trigger.dev/sdk`) to `apps/gateway`
- `apps/gateway/src/scheduler/trigger-dev.ts`:
  - `IScheduler` interface: `scheduleCron(job: CronJob): Promise<void>`, `scheduleEvent(trigger: Trigger): Promise<void>`, `cancel(id): Promise<void>`
  - `TriggerDevScheduler implements IScheduler`
  - `BullMQScheduler implements IScheduler` — fallback (Redis-backed), same interface
  - `SchedulerFactory.create(config): IScheduler`
- All cron job definitions in `apps/gateway/src/jobs/` — one file per job type

**Ref:** PRODUCT.md §11 (scheduler locked: Trigger.dev primary, BullMQ fallback), §5.4 (cron pipeline)

**Files:** `apps/gateway/src/scheduler/trigger-dev.ts`, `apps/gateway/src/scheduler/bullmq.ts`, `apps/gateway/src/scheduler/factory.ts`

**Done when:** `TriggerDevScheduler.scheduleCron` registers a job; BullMQ fallback runs same job without code change

---

#### M5-T2 `[PARALLEL]`
**Title:** TriggerEngine — event matching + action execution

**What to do:**
- `apps/gateway/src/triggers/engine.ts`:
  - Subscribes to all Redis Pub/Sub channels: `alert_fired`, `deploy_completed`, `deploy_failed`, `error_rate_threshold`, `pr_merged`, `test_failed`, `incident_created`, `cloud_finding`
  - On event: loads active trigger rules for tenant from DB, evaluates `condition` against event payload
  - Matched rules: perimeter check → spawn specialist agent with event context → execute action set
  - Action execution: all write actions gated (V1 rule) — surface to UI for confirmation before executing
  - Every action: audit-logged with `auditTag` from trigger rule
- CRUD API: `POST /api/automations/triggers`, `GET /api/automations/triggers`, `PATCH`, `DELETE`

**Ref:** PRODUCT.md §5.4 (event pipeline, trigger schema, action types)

**Files:** `apps/gateway/src/triggers/engine.ts`, `apps/gateway/src/routes/automations.ts`

**Done when:** Publish `deploy_failed` event → matched trigger rule fires → gated action surfaces to UI

---

#### M5-T3 `[PARALLEL]`
**Title:** Built-in cron monitors

**What to do:**
- `apps/gateway/src/jobs/service-health-sweep.ts` — queries all connector health + error rates for all prod services, emits anomaly events
- `apps/gateway/src/jobs/slo-burn-check.ts` — computes 1h + 6h error budget burn rate per service
- `apps/gateway/src/jobs/deploy-health-report.ts` — aggregate daily deploy outcomes from ArgoCD
- `apps/gateway/src/jobs/oncall-morning-brief.ts` — generate shift-change brief (SRE agent, read-only)
- All jobs: read-only connector access only, results written to KB, anomalies emitted to Redis Pub/Sub
- CRUD API: `POST /api/automations/monitors`, `GET /api/automations/monitors`

**Ref:** PRODUCT.md §5.4 (cron pipeline, built-in cron monitor types, CronJob schema)

**Files:** `apps/gateway/src/jobs/*.ts`, extend `apps/gateway/src/routes/automations.ts`

**Done when:** Each job runs on schedule, produces KB entries, anomaly triggers event on Redis

---

### Wave 5-B

#### M5-T4 `[SEQUENTIAL]`
**Title:** Wire automations-view.tsx to real API

**What to do:**
- Update `apps/web/components/automations-view.tsx`: replace mock data with real API calls
- Trigger list: `GET /api/automations/triggers` — show status, last fired, action count
- Cron list: `GET /api/automations/monitors` — show schedule, last run result, anomaly count
- Enable/disable toggle: `PATCH /api/automations/triggers/:id { enabled: bool }`
- Layout preserved — data source swap only

**Files:** `apps/web/components/automations-view.tsx`

**Done when:** Real trigger + cron data shown; toggle persists to DB

---

## Notes for the agent

- **Read PRODUCT.md first.** Every task above refers to it. Interfaces, non-negotiables, and decisions are all there.
- **No hardcoded tenant IDs, user IDs, or secrets.** Everything injected via config or extracted from JWT.
- **Every table needs `tenant_id`.** No exceptions. See non-negotiable #6.
- **No `console.log`.** Use `pino` logger. Every log needs `trace_id`. See non-negotiable #8.
- **Tests ship with code.** No task is done without tests. See non-negotiable #7.
- **Parallel tasks can be split across agents.** Tasks in the same `[PARALLEL]` wave have zero inter-dependency — safe to run simultaneously.
- **When in doubt about a design decision** — it is in `docs/PRODUCT.md §11` (Decisions). Do not invent alternatives.
