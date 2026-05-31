#!/usr/bin/env bash
# build.sh — Anvay full-build orchestrator
#
# Every task runs inside retry.sh — rate limits cause a pause + auto-resume,
# never a stop. Parallel wave tasks are backgrounded; each wave waits for all
# tasks in it to finish before advancing.
#
# Usage:
#   ./scripts/build.sh              # run all milestones M0 → M5
#   ./scripts/build.sh M0           # run only M0
#   ./scripts/build.sh M0-T3        # run a single task
#   ./scripts/build.sh M0 --no-review   # skip claude review step
#
# Logs: logs/build/<task-id>.log  (build)
#        logs/build/<task-id>.review.log  (review)
# Status: logs/build/status.txt   (one line per completed task)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RETRY="$REPO_ROOT/scripts/retry.sh"
LOG_DIR="$REPO_ROOT/logs/build"
STATUS_FILE="$LOG_DIR/status.txt"

mkdir -p "$LOG_DIR"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

BUILD_TARGET="${1:-all}"
NO_REVIEW="${2:-}"

log()   { echo -e "${CYAN}[build]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[build]${RESET} $*"; }
ok()    { echo -e "${GREEN}[build]${RESET} $*"; }
err()   { echo -e "${RED}[build]${RESET} $*"; }
title() { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}\n"; }

# ── already done? ─────────────────────────────────────────────────────────────

is_done() {
  grep -qx "$1" "$STATUS_FILE" 2>/dev/null
}

mark_done() {
  echo "$1" >> "$STATUS_FILE"
  ok "$1 complete"
}

# ── run a build task via retry.sh ─────────────────────────────────────────────
# run_task <task-id> <tool> <prompt>
# Logs to logs/build/<task-id>.log
# Skips if already marked done in status.txt

run_task() {
  local task_id="$1"
  local tool="$2"
  local prompt="$3"
  local log_file="$LOG_DIR/${task_id}.log"

  if is_done "$task_id"; then
    log "SKIP $task_id (already done)"
    return 0
  fi

  log "START $task_id → $log_file"
  echo "=== $task_id started at $(date) ===" >> "$log_file"

  if "$RETRY" "$tool" "$prompt" >> "$log_file" 2>&1; then
    mark_done "$task_id"
    echo "=== $task_id finished at $(date) ===" >> "$log_file"
  else
    err "$task_id FAILED — see $log_file"
    echo "=== $task_id FAILED at $(date) ===" >> "$log_file"
    exit 1
  fi
}

# ── run a review via claude after build ───────────────────────────────────────
# review_task <task-id> <review-prompt>

review_task() {
  local task_id="$1"
  local prompt="$2"
  local log_file="$LOG_DIR/${task_id}.review.log"

  [[ "$NO_REVIEW" == "--no-review" ]] && return 0
  is_done "${task_id}.review" && { log "SKIP ${task_id}.review (already done)"; return 0; }

  log "REVIEW $task_id"
  echo "=== ${task_id} review started at $(date) ===" >> "$log_file"

  if "$RETRY" claude "$prompt" >> "$log_file" 2>&1; then
    mark_done "${task_id}.review"
    echo "=== ${task_id} review done at $(date) ===" >> "$log_file"
  else
    warn "${task_id} review failed — non-blocking, continuing"
  fi
}

# ── wait for a set of background PIDs, fail fast on any error ─────────────────

wait_all() {
  local failed=0
  for pid in "$@"; do
    wait "$pid" || { err "Background task (pid $pid) failed"; failed=1; }
  done
  [[ $failed -eq 0 ]] || exit 1
}

# ── context prefix injected into every task prompt ───────────────────────────

CTX="You are an SDE working on the Anvay project (an AI-powered platform for software orgs).
Working directory: $REPO_ROOT
IMPORTANT: Read docs/PRODUCT.md (source of truth — all design decisions, interfaces, non-negotiables) and docs/TASKS.md (task specs with acceptance criteria) before writing any code.
Stack: pnpm monorepo + turborepo, Next.js (apps/web), Fastify (apps/gateway), TypeScript throughout.
Rules: inline styles only in Next.js (no Tailwind), no console.log (use pino), tenant_id on every DB table, tests ship with code, no vendor lock-in.
After implementing, run the acceptance criteria commands listed in TASKS.md for your task to verify done. Then git add + git commit the changes."

# ── task prompts ──────────────────────────────────────────────────────────────

PROMPT_M0_T1="$CTX

Task: M0-T1 — Monorepo root — pnpm workspaces + turborepo pipeline
Ref: docs/TASKS.md § M0-T1

What to implement:
1. Verify pnpm-workspace.yaml covers apps/* and packages/* (file exists, check it)
2. Add 'test' and 'typecheck' turbo tasks to turbo.json with correct dependsOn and output caching
3. Ensure root package.json has scripts: dev, build, lint, typecheck, test — each delegating to pnpm turbo
4. Create .nvmrc pinned to node 22
5. Ensure .gitignore covers: node_modules, .next, dist, .env*.local, *.tsbuildinfo, .turbo

Files: turbo.json, package.json (root), .nvmrc, .gitignore, pnpm-workspace.yaml

Done when: pnpm install succeeds, pnpm build runs turborepo pipeline, pnpm typecheck task exists."

PROMPT_M0_T2="$CTX

Task: M0-T2 — Docker Compose — dev infrastructure stack
Ref: docs/TASKS.md § M0-T2

What to implement:
1. infra/docker-compose.yml with: postgres (pgvector), redis, otel-collector, prometheus, grafana, jaeger
2. Postgres init script: enables vector extension, creates anvay database
3. Redis: no auth, port 6379
4. OTEL Collector: OTLP gRPC 4317 + HTTP 4318, exports to prometheus + jaeger
5. Prometheus: scrapes otel-collector and app /metrics endpoints (gateway:3001, web:3000)
6. Grafana: port 3001, pre-provisioned prometheus datasource, auto-import node + postgres dashboards
7. Jaeger: all-in-one, port 16686 UI
8. All services: named volumes, health checks with retries
9. infra/.env.example: all vars (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, ports)
10. infra/otel-collector.yaml: pipeline config
11. infra/prometheus.yml: scrape config

Done when: docker compose -f infra/docker-compose.yml up -d starts all services healthy, pgvector extension present, Prometheus UI at localhost:9090 shows targets up."

PROMPT_M0_T3="$CTX

Task: M0-T3 — packages/types — shared TypeScript types
Ref: docs/TASKS.md § M0-T3

What to implement:
1. packages/types/src/index.ts — export all shared types
2. Result<T, E> discriminated union: Ok<T> and Err<E> variants with exhaustive type narrowing
3. AppError base class: code (ErrorCode), message, cause, toJSON()
4. ErrorCode enum: UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, UPSTREAM_ERROR, RATE_LIMITED, TOKEN_LIMIT_EXCEEDED
5. Branded types (nominal typing): TenantId, UserId, SessionId, ConnectorId — brand via unique symbol, not plain string
6. AgentRole type: 'sre' | 'dev' | 'pm' | 'ba' | 'admin'
7. ConnectorMode type: 'read' | 'write' | 'read-write'
8. StreamEvent discriminated union: text_delta, tool_call, tool_result, gate_required, done, error — each with typed payload
9. Message type: role ('user'|'assistant'|'system'), content string, optional toolCalls
10. packages/types/package.json: name @anvay/types, exports ./src/index.ts, main field
11. packages/types/tsconfig.json: composite true, strict true, project references ready

Done when: pnpm --filter @anvay/types build succeeds, branded types reject plain string assignment."

PROMPT_M0_T4="$CTX

Task: M0-T4 — Database schema — Prisma migrations
Ref: docs/TASKS.md § M0-T4

What to implement:
1. Add prisma to apps/gateway: pnpm --filter anvay-gateway add prisma @prisma/client
2. apps/gateway/prisma/schema.prisma with tables (ALL with tenant_id uuid):
   - tenants: id uuid pk, name, slug unique, plan (tier1/tier2/tier3 enum), token_budget_monthly bigint, connector_limit int, created_at
   - users: id uuid pk, tenant_id fk, email unique, role (sre/dev/pm/ba/admin enum), created_at
   - sessions: id uuid pk, user_id fk, tenant_id, created_at, expires_at
   - connectors: id uuid pk, tenant_id, name, type, mode (read/write/read-write enum), config_encrypted jsonb, capability_manifest jsonb, created_at
   - audit_events: id uuid pk, tenant_id, user_id, session_id, event_type, payload jsonb, created_at — NO updatedAt, append-only
   - incidents: id uuid pk, tenant_id, title, severity (low/medium/high/critical), status (open/investigating/resolved), created_at, resolved_at nullable
3. Row-level security SQL in migration: enable RLS on each table, policy using current_setting('app.tenant_id')::uuid
4. Migration file: apps/gateway/prisma/migrations/0001_initial/migration.sql
5. Seed script: apps/gateway/prisma/seed.ts — creates demo tenant, admin user, one github connector row
6. DATABASE_URL in apps/gateway/.env.example pointing to docker compose postgres

Done when: DATABASE_URL set, pnpm --filter anvay-gateway prisma migrate dev applies cleanly, seed runs, RLS works."

PROMPT_M0_T5="$CTX

Task: M0-T5 — apps/gateway — Fastify server skeleton
Ref: docs/TASKS.md § M0-T5

What to implement:
1. apps/gateway/src/server.ts: Fastify instance with TypeScript, ESM modules
2. Plugins: @fastify/cors, @fastify/jwt (RS256 — generate dev keypair in setup), @fastify/sensible
3. Pino logger: every request log includes trace_id (from OTEL), tenant_id (from JWT claim), user_id, method, path, status, duration_ms
4. Routes:
   - GET /health → { status: 'ok', version: pkg.version, uptime: process.uptime() }
   - GET /metrics → prom-client Prometheus text format, content-type text/plain
   - POST /auth/token → stub for dev: accepts { email } body, returns signed JWT with userId + tenantId claims (uses dev private key)
5. OTEL: @opentelemetry/sdk-node + @opentelemetry/auto-instrumentations-node, export to OTEL collector at localhost:4317
6. Each DB connection: SET app.tenant_id = '<tenant_id_from_jwt>' so Postgres RLS applies
7. Graceful shutdown: SIGTERM handler — close server, drain pool, exit 0
8. apps/gateway/package.json: name anvay-gateway, scripts dev/build/start/typecheck
9. apps/gateway/tsconfig.json: strict, ESNext target, moduleResolution bundler

Done when: pnpm --filter anvay-gateway dev starts, GET /health returns 200, GET /metrics returns prometheus format, logs are JSON."

PROMPT_M0_T6="$CTX

Task: M0-T6 — apps/web — server-side API routes skeleton
Ref: docs/TASKS.md § M0-T6

What to implement:
1. apps/web/app/api/chat/route.ts:
   - POST handler only
   - Reads ANTHROPIC_API_KEY from process.env (never expose to client)
   - Returns stub SSE stream: Content-Type text/event-stream, sends data lines with StreamEvent JSON, ends with data: [DONE]
   - Body type: { query: string, sessionId: string }
2. apps/web/app/api/providers/route.ts:
   - GET handler only
   - Checks which env vars are set: ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, OLLAMA_ENDPOINT, LMSTUDIO_ENDPOINT
   - Returns { providers: [{ id: string, label: string, configured: boolean }] }
   - NEVER return key values — status only
3. apps/web/.env.local.example: all six vars with placeholder values and comment: '# Server-side only — never expose to browser'
4. Update apps/web/components/model-config.tsx:
   - Remove any API key input fields
   - Fetch GET /api/providers on mount
   - Show each provider as a row: name + green dot (configured) or grey dot (not configured) + 'Set via env var' label
   - No key input, no key storage — status display only

Done when: POST /api/chat returns SSE stream, GET /api/providers never leaks key values, ModelConfig shows provider status only."

PROMPT_M0_T7="$CTX

Task: M0-T7 — CI pipeline — GitHub Actions + Dockerfiles
Ref: docs/TASKS.md § M0-T7

What to implement:
1. .github/workflows/ci.yml:
   - Triggers: push (any branch), pull_request (main)
   - Jobs running in parallel: typecheck, lint, test, build, docker-build
   - Each job: checkout, setup pnpm (caches store keyed on pnpm-lock.yaml), setup node (version from .nvmrc)
   - typecheck: pnpm install --frozen-lockfile && pnpm typecheck
   - lint: pnpm install --frozen-lockfile && pnpm lint
   - test: pnpm install --frozen-lockfile && pnpm test --passWithNoTests
   - build: pnpm install --frozen-lockfile && pnpm build
   - docker-build: matrix over [apps/gateway, apps/web] — docker build each, no push
2. apps/gateway/Dockerfile:
   - Multi-stage: builder (node:22-alpine) installs deps + builds
   - Final: gcr.io/distroless/nodejs22-debian12 — copies built output only
   - Non-root user (node uid 1000), EXPOSE 3001, HEALTHCHECK GET /health
3. apps/web/Dockerfile:
   - Multi-stage: builder installs deps + next build with output: standalone
   - Final: node:22-alpine, copies standalone output, non-root user, EXPOSE 3000

Done when: CI yml is valid YAML, docker build apps/gateway succeeds, docker build apps/web succeeds."

PROMPT_M0_T8="$CTX

Task: M0-T8 — End-to-end smoke test
Ref: docs/TASKS.md § M0-T8
Depends on: M0-T2 (docker infra) and M0-T5 (gateway) both complete

What to implement:
1. infra/docker-compose.dev.yml:
   - Extends infra/docker-compose.yml (use 'include' or 'extends')
   - Adds gateway service: build from apps/gateway, env DATABASE_URL + JWT vars, port 3001, depends_on postgres+redis+otel-collector
   - Adds web service: build from apps/web, port 3000, env GATEWAY_URL=http://gateway:3001
   - Volume mounts for dev hot-reload where applicable
2. scripts/smoke-test.sh:
   - Wait for gateway /health to return 200 (poll up to 60s with 2s interval)
   - Wait for web /api/providers to return 200
   - Check Prometheus API: all targets must be state=up
   - Print PASS/FAIL per check, exit 0 if all pass, exit 1 if any fail
3. Root package.json: add 'smoke' script: 'bash scripts/smoke-test.sh'

Done when: docker compose -f infra/docker-compose.dev.yml up -d && pnpm smoke exits 0."

# ── review prompts ─────────────────────────────────────────────────────────────

review_prompt() {
  local task_id="$1"
  echo "Review the implementation of $task_id in the Anvay project at $REPO_ROOT.
Check against docs/TASKS.md (acceptance criteria for $task_id) and docs/PRODUCT.md (non-negotiables).
Run: pnpm typecheck and pnpm lint from the repo root.
Verify: no console.log in source files, no API keys in any client-side code, tenant_id present on all DB tables touched.
Report: PASS or FAIL with specific issues. If FAIL, fix the issues in-place. Commit fixes if any."
}

# ── milestone functions ────────────────────────────────────────────────────────

run_m0() {
  title "M0 — Foundation"

  # Wave 0-A: sequential
  log "Wave 0-A (sequential)"
  run_task "M0-T1" "opencode" "$PROMPT_M0_T1"
  review_task "M0-T1" "$(review_prompt M0-T1)"

  # Wave 0-B: all parallel
  log "Wave 0-B (parallel: T2 T3 T4 T5 T6 T7)"
  local pids=()

  ( run_task "M0-T2" "opencode" "$PROMPT_M0_T2"
    review_task "M0-T2" "$(review_prompt M0-T2)" ) &
  pids+=($!)

  ( run_task "M0-T3" "opencode" "$PROMPT_M0_T3"
    review_task "M0-T3" "$(review_prompt M0-T3)" ) &
  pids+=($!)

  ( run_task "M0-T4" "opencode" "$PROMPT_M0_T4"
    review_task "M0-T4" "$(review_prompt M0-T4)" ) &
  pids+=($!)

  ( run_task "M0-T5" "opencode" "$PROMPT_M0_T5"
    review_task "M0-T5" "$(review_prompt M0-T5)" ) &
  pids+=($!)

  ( run_task "M0-T6" "opencode" "$PROMPT_M0_T6"
    review_task "M0-T6" "$(review_prompt M0-T6)" ) &
  pids+=($!)

  ( run_task "M0-T7" "opencode" "$PROMPT_M0_T7"
    review_task "M0-T7" "$(review_prompt M0-T7)" ) &
  pids+=($!)

  wait_all "${pids[@]}"
  log "Wave 0-B complete"

  # Wave 0-C: sequential
  log "Wave 0-C (sequential)"
  run_task "M0-T8" "opencode" "$PROMPT_M0_T8"
  review_task "M0-T8" "$(review_prompt M0-T8)"

  ok "M0 complete"
}

run_m1() {
  title "M1 — Orchestrator Core"

  log "Wave 1-A (parallel: T1 T2 T3)"
  local pids=()

  ( run_task "M1-T1" "opencode" "$CTX
Task: M1-T1 — IModelProvider interface + provider implementations
Ref: docs/TASKS.md § M1-T1, docs/PRODUCT.md §5.4

Implement in packages/agent:
1. packages/agent/src/interfaces/provider.ts — IModelProvider, IEmbeddingProvider, InferenceOptions, ChatResponse, StreamChunk types
2. packages/agent/src/providers/anthropic.ts — AnthropicProvider implements IModelProvider using @anthropic-ai/sdk
3. packages/agent/src/providers/openai.ts — OpenAIProvider implements IModelProvider using openai SDK
4. packages/agent/src/providers/ollama.ts — OllamaProvider implements IModelProvider using OpenAI-compatible REST
5. packages/agent/src/providers/factory.ts — ProviderFactory.create(config): IModelProvider — ONLY place provider SDKs are imported
6. Unit tests for each provider using a mock HTTP server (nock or msw)

Non-negotiable: no provider SDK imported outside packages/agent/src/providers/
Done when: pnpm --filter @anvay/agent typecheck passes, unit tests pass."
    review_task "M1-T1" "$(review_prompt M1-T1)" ) &
  pids+=($!)

  ( run_task "M1-T2" "opencode" "$CTX
Task: M1-T2 — ISessionMemory + RedisSessionMemory
Ref: docs/TASKS.md § M1-T2, docs/PRODUCT.md §7.3, §7.4

Implement in packages/agent:
1. packages/agent/src/interfaces/memory.ts — ISessionMemory, ConversationTurn, SessionContext types
2. packages/agent/src/memory/redis-session.ts — RedisSessionMemory implements ISessionMemory
   - Redis key: session:{sessionId}:turns as JSON list
   - TTL 24h, refreshed on each append
   - summarise(): compresses turns older than last 10 into summary turn (calls IModelProvider cheap model)
   - Auto-summarise threshold: 50 turns
3. packages/agent/src/memory/factory.ts — MemoryFactory.create(config): ISessionMemory
4. Unit tests with ioredis-mock

Done when: append+get round-trip works, TTL resets on append, summarise reduces >50 turns."
    review_task "M1-T2" "$(review_prompt M1-T2)" ) &
  pids+=($!)

  ( run_task "M1-T3" "opencode" "$CTX
Task: M1-T3 — Perimeter engine + IAuditSink
Ref: docs/TASKS.md § M1-T3, docs/PRODUCT.md §5.5, §5.6

Implement in packages/agent:
1. packages/agent/src/interfaces/audit.ts — IAuditSink, AuditEvent, AuditEventType enum
2. packages/agent/src/perimeter/engine.ts — AgentPerimeter class:
   - allows(toolCall): boolean — deterministic, no LLM
   - resolveCapabilities(userId, connectors): AgentPerimeter
   - hardBlock(call, perimeter): HardBlock — always audit-logged
3. packages/agent/src/middleware/perimeter.ts — createPerimeterMiddleware(perimeter, auditSink)
4. packages/agent/src/middleware/token-meter.ts — createTokenMeterMiddleware(budget: TokenBudget)
   - TokenBudget: perQuery, perSession, perTenantDaily, perTenantMonthly limits
   - Hard block if any exceeded
5. Unit tests: 5+ perimeter cases (allow + block), token meter block at 0 budget

Done when: allows() blocks all out-of-perimeter calls, hardBlock always hits audit sink."
    review_task "M1-T3" "$(review_prompt M1-T3)" ) &
  pids+=($!)

  wait_all "${pids[@]}"
  log "Wave 1-A complete"

  log "Wave 1-B (sequential: T4)"
  run_task "M1-T4" "opencode" "$CTX
Task: M1-T4 — Orchestrator + createOrchestrator public surface
Ref: docs/TASKS.md § M1-T4, docs/PRODUCT.md §5.4

Implement in packages/agent (depends on M1-T1, M1-T2, M1-T3):
1. Install @mastra/core in packages/agent
2. packages/agent/src/orchestrator.ts:
   - createOrchestrator({ model: IModelProvider, tools, perimeter, auditSink, sessionMemory }): Orchestrator
   - Wire createPerimeterMiddleware into Mastra onToolCall hook
   - Wire createTokenMeterMiddleware into Mastra onModelCall hook
   - runSession(orchestrator, input, ctx): AsyncIterator<StreamEvent>
   - Intent classification: cheap model call first, then route
3. packages/agent/src/specialist-agent.ts — createSpecialistAgent({ name, model, tools, systemPrompt })
4. packages/agent/src/gate.ts — createGate({ condition, approvers, autoApproveThreshold }) using Mastra waitForInput
5. packages/agent/src/index.ts — public exports only, NO Mastra types exported

Non-negotiable: no Mastra types leak from index.ts, all surface functions accept IModelProvider.
Done when: runSession with mock IModelProvider yields StreamEvent items, perimeter fires on every tool call."
  review_task "M1-T4" "$(review_prompt M1-T4)"

  log "Wave 1-C (parallel: T5 T6)"
  local pids2=()

  ( run_task "M1-T5" "opencode" "$CTX
Task: M1-T5 — apps/gateway /api/chat SSE endpoint
Ref: docs/TASKS.md § M1-T5, docs/PRODUCT.md §5.1

Implement in apps/gateway:
1. apps/gateway/src/routes/chat.ts — POST /api/chat:
   - Extract userId, tenantId from JWT
   - Load user perimeter from DB (connectors table for this tenant)
   - Build AgentPerimeter, TokenBudget, IModelProvider via factories
   - Call runSession(orchestrator, query, ctx) from @anvay/agent
   - Stream result as SSE: Content-Type text/event-stream, data: <json>\n\n per event, data: [DONE]\n\n at end
2. apps/gateway/src/audit/postgres-sink.ts — PostgresAuditSink implements IAuditSink:
   - Writes to audit_events table
   - Fire-and-forget: setImmediate wrapping the insert, never awaited on hot path
3. Register route in server.ts

Done when: POST /api/chat streams real LLM tokens to curl, audit_events rows appear after each call."
    review_task "M1-T5" "$(review_prompt M1-T5)" ) &
  pids2+=($!)

  ( run_task "M1-T6" "opencode" "$CTX
Task: M1-T6 — Wire OrchestratorChat to real /api/chat SSE
Ref: docs/TASKS.md § M1-T6, apps/web/components/orchestrator-chat.tsx

Update apps/web/components/orchestrator-chat.tsx:
1. Replace all mock streaming with fetch('/api/chat', { method: 'POST', body: JSON.stringify({ query, sessionId }) })
2. Parse response as ReadableStream, split on newlines, parse 'data: ' prefix per SSE spec
3. Handle each StreamEvent type:
   - text_delta: append to current message content
   - tool_call: add execution trace line showing tool name + input summary
   - tool_result: add result line to trace
   - gate_required: show gate UI (action description + confirm button + confidence score)
   - done: finalise message, show token usage from payload
   - error: show error state with message
4. sessionId: generated once on component mount (crypto.randomUUID()), kept in useState
5. Keep all existing inline styles — no Tailwind, no style changes

Done when: chat sends real queries, tokens stream live, tool trace lines appear, gate UI shows on gate_required."
    review_task "M1-T6" "$(review_prompt M1-T6)" ) &
  pids2+=($!)

  wait_all "${pids2[@]}"
  log "Wave 1-C complete"

  ok "M1 complete"
}

# ── entry point ───────────────────────────────────────────────────────────────

case "$BUILD_TARGET" in
  all)
    run_m0
    run_m1
    title "All milestones complete"
    ;;
  M0) run_m0 ;;
  M1) run_m1 ;;
  M0-T*)
    task="${BUILD_TARGET}"
    var="PROMPT_${task//-/_}"
    prompt="${!var:-}"
    if [[ -z "$prompt" ]]; then
      err "No prompt defined for $task"
      exit 1
    fi
    run_task "$task" "opencode" "$prompt"
    review_task "$task" "$(review_prompt $task)"
    ;;
  *)
    err "Unknown target: $BUILD_TARGET"
    echo "Usage: $0 [all|M0|M1|M0-T1|M0-T2|...]" >&2
    exit 1
    ;;
esac
