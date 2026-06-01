#!/usr/bin/env bash
# build.sh — Anvay build orchestrator
#
# Per-task flow:
#   1. opencode builds the task (via retry.sh — pauses on rate limit, never stops)
#   2. claude reviews output (via retry.sh — same rate limit protection)
#   3. If issues found: opencode fixes → claude re-reviews (max 3 loops)
#   4. If still issues after 3 loops: claude fixes directly
#   5. Mark done, move to next task
#
# All tasks run SEQUENTIALLY — avoids opencode rate limit from parallel calls.
# Rate limit handling on BOTH opencode and claude layers via retry.sh.
#
# Usage:
#   ./scripts/build.sh              # all milestones M0 → M5
#   ./scripts/build.sh M0           # M0 only
#   ./scripts/build.sh M0-T1        # single task
#
# Logs: logs/build/<task-id>.log       (build + fix output)
#        logs/build/<task-id>.review.log (review output)
# Status: logs/build/status.txt        (completed task IDs, one per line)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RETRY="$REPO_ROOT/scripts/retry.sh"
LOG_DIR="$REPO_ROOT/logs/build"
STATUS_FILE="$LOG_DIR/status.txt"
MAX_FIX_LOOPS=3
OPENCODE_MODEL="nvidia/moonshotai/kimi-k2.6"

mkdir -p "$LOG_DIR"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

BUILD_TARGET="${1:-all}"

log()   { echo -e "${CYAN}[build]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[build]${RESET} $*"; }
ok()    { echo -e "${GREEN}[build]${RESET} $*" ; }
err()   { echo -e "${RED}[build]${RESET} $*"  ; }
title() { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}\n"; }

# ── status tracking ───────────────────────────────────────────────────────────

is_done()  { grep -qx "$1" "$STATUS_FILE" 2>/dev/null; }
mark_done(){ echo "$1" >> "$STATUS_FILE"; ok "$1 done"; }

# ── run via retry.sh and capture output (logged + returned) ───────────────────

run_capture() {
  local tool="$1"
  local prompt="$2"
  local log_file="$3"
  local tmp
  tmp=$(mktemp)
  local exit_code=0

  "$RETRY" "$tool" "$prompt" 2>&1 | tee -a "$log_file" "$tmp" || exit_code=$?
  cat "$tmp"
  rm -f "$tmp"
  return $exit_code
}

# ── parse review result ───────────────────────────────────────────────────────

review_passed() {
  echo "$1" | grep -q "^STATUS: PASS"
}

extract_issues() {
  echo "$1" | sed -n '/^ISSUES:/,$ p' | tail -n +2
}

# ── core task runner: build → review → fix loop → claude fallback ─────────────

run_task() {
  local task_id="$1"
  local build_prompt="$2"
  local review_prompt="$3"
  local build_log="$LOG_DIR/${task_id}.log"
  local review_log="$LOG_DIR/${task_id}.review.log"

  if is_done "$task_id"; then
    log "SKIP $task_id (already done)"
    return 0
  fi

  title "$task_id"

  # ── step 1: opencode builds ──────────────────────────────────────────────
  log "[$task_id] BUILD via opencode ($OPENCODE_MODEL)"
  echo "=== BUILD started $(date) ===" | tee -a "$build_log"

  "$RETRY" opencode "$build_prompt" 2>&1 | tee -a "$build_log" || {
    err "[$task_id] Build failed — see $build_log"
    exit 1
  }

  echo "=== BUILD done $(date) ===" | tee -a "$build_log"

  # ── step 2: review-fix loop (max MAX_FIX_LOOPS) ──────────────────────────
  local loop=0
  local review_out issues

  while [[ $loop -lt $MAX_FIX_LOOPS ]]; do
    loop=$(( loop + 1 ))
    log "[$task_id] REVIEW $loop/$MAX_FIX_LOOPS via claude"
    echo "=== REVIEW $loop started $(date) ===" >> "$review_log"

    review_out=$(run_capture claude "$review_prompt" "$review_log") || {
      warn "[$task_id] Review call failed — treating as needs-fix"
    }

    echo "=== REVIEW $loop done $(date) ===" >> "$review_log"

    if review_passed "$review_out"; then
      ok "[$task_id] Review passed on loop $loop"
      mark_done "$task_id"
      return 0
    fi

    issues=$(extract_issues "$review_out")
    warn "[$task_id] Review FAIL loop $loop — issues found:"
    echo "$issues" | head -10 | while IFS= read -r line; do warn "  • $line"; done

    if [[ $loop -lt $MAX_FIX_LOOPS ]]; then
      log "[$task_id] FIX loop $loop via opencode"
      echo "=== FIX $loop started $(date) ===" | tee -a "$build_log"

      "$RETRY" opencode "You are fixing issues found during code review for task $task_id in the Anvay project at $REPO_ROOT.

Read docs/PRODUCT.md and docs/TASKS.md for context on the task requirements.

Issues to fix (from code review):
$issues

Fix all issues above. Follow all rules in docs/PRODUCT.md (non-negotiables). Run the acceptance criteria from docs/TASKS.md for $task_id to verify. Commit the fixes." 2>&1 | tee -a "$build_log" || {
        warn "[$task_id] Fix call failed — will retry review anyway"
      }

      echo "=== FIX $loop done $(date) ===" | tee -a "$build_log"
    fi
  done

  # ── step 3: 3 loops exhausted — claude fixes directly ───────────────────
  warn "[$task_id] $MAX_FIX_LOOPS review loops exhausted — claude fixing directly"
  echo "=== CLAUDE DIRECT FIX started $(date) ===" | tee -a "$build_log"

  "$RETRY" claude "You are directly fixing remaining issues for task $task_id in the Anvay project at $REPO_ROOT.

Read docs/PRODUCT.md (non-negotiables) and docs/TASKS.md (acceptance criteria for $task_id).

Outstanding issues after $MAX_FIX_LOOPS opencode fix attempts:
$issues

Fix every issue above yourself. Do not delegate — implement the fixes directly. Run acceptance criteria to verify. Commit when done." 2>&1 | tee -a "$build_log" || {
    err "[$task_id] Claude direct fix failed — see $build_log"
    exit 1
  }

  echo "=== CLAUDE DIRECT FIX done $(date) ===" | tee -a "$build_log"
  mark_done "$task_id"
}

# ── shared context for all prompts ────────────────────────────────────────────

CTX="Anvay project. Working dir: $REPO_ROOT.
Read docs/PRODUCT.md (source of truth: all interfaces, decisions, non-negotiables) and docs/TASKS.md (task specs + acceptance criteria) before writing any code.
Stack: pnpm monorepo + turborepo, Next.js 16 (apps/web), Fastify (apps/gateway), TypeScript ESM throughout.
Rules (non-negotiable): inline styles only in Next.js (no Tailwind), no console.log (pino only), tenant_id on every DB table, tests ship with code, no vendor lock-in, API keys server-side only.
After implementing: run acceptance criteria from TASKS.md, then git add + git commit."

# ── review prompt template ────────────────────────────────────────────────────
# claude must output STATUS: PASS or STATUS: FAIL + ISSUES: section

review_for() {
  local task_id="$1"
  echo "Review the implementation of $task_id in the Anvay project at $REPO_ROOT.

Check:
1. All acceptance criteria in docs/TASKS.md § $task_id are met
2. All non-negotiables in docs/PRODUCT.md §10 are followed
3. No console.log in source files (use pino)
4. No API keys or secrets in client-side code
5. tenant_id present on every new DB table
6. Tests exist and pass (pnpm typecheck + pnpm lint)
7. No Tailwind classes — inline styles only in Next.js components

Run: pnpm typecheck and pnpm lint from $REPO_ROOT to check for errors.

Output EXACTLY this format — nothing else on the STATUS line:
STATUS: PASS
or
STATUS: FAIL
ISSUES:
- <specific issue 1>
- <specific issue 2>"
}

# ── task build prompts ────────────────────────────────────────────────────────

build_m0_t1() {
  echo "$CTX
Task: M0-T1 — Monorepo root — pnpm workspaces + turborepo pipeline
Full spec: docs/TASKS.md § M0-T1

1. Check pnpm-workspace.yaml covers apps/* and packages/*
2. Add to turbo.json: test task (dependsOn: ['^test'], cache: true) and typecheck task (dependsOn: ['^typecheck'], cache: true)
3. Root package.json scripts: dev, build, lint, typecheck, test — each running 'turbo <script>'
4. Create .nvmrc with content: 22
5. Ensure .gitignore covers: node_modules, .next, dist, .env*.local, *.tsbuildinfo, .turbo, logs/

Verify: pnpm install succeeds, pnpm build runs without error."
}

build_m0_t2() {
  echo "$CTX
Task: M0-T2 — Docker Compose dev infrastructure
Full spec: docs/TASKS.md § M0-T2

Create infra/docker-compose.yml with: postgres+pgvector, redis, otel-collector, prometheus, grafana, jaeger.
Create infra/otel-collector.yaml, infra/prometheus.yml, infra/.env.example.
Postgres init: enable vector extension, create anvay database.
All services: named volumes, healthchecks.
Grafana port 3001 (web uses 3000). Prometheus port 9090. Jaeger UI port 16686.

Verify: docker compose -f infra/docker-compose.yml up -d, all services healthy."
}

build_m0_t3() {
  echo "$CTX
Task: M0-T3 — packages/types — shared TypeScript types
Full spec: docs/TASKS.md § M0-T3

Create packages/types/src/index.ts with:
- Result<T,E>: Ok<T> | Err<E> discriminated union, exhaustive narrowing
- AppError: code (ErrorCode enum), message, cause
- ErrorCode enum: UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, UPSTREAM_ERROR, RATE_LIMITED, TOKEN_LIMIT_EXCEEDED
- Branded types via unique symbol: TenantId, UserId, SessionId, ConnectorId
- AgentRole: 'sre'|'dev'|'pm'|'ba'|'admin'
- ConnectorMode: 'read'|'write'|'read-write'
- StreamEvent discriminated union: text_delta, tool_call, tool_result, gate_required, done, error
- Message: role, content, optional toolCalls
Create packages/types/package.json (name: @anvay/types), packages/types/tsconfig.json (composite: true, strict: true).

Verify: pnpm --filter @anvay/types build succeeds."
}

build_m0_t4() {
  echo "$CTX
Task: M0-T4 — Database schema — Prisma migrations
Full spec: docs/TASKS.md § M0-T4

Add Prisma to apps/gateway. Create schema.prisma with tables (ALL with tenant_id):
tenants, users, sessions, connectors, audit_events (append-only, no updatedAt), incidents.
Enums: Plan (tier1/tier2/tier3), AgentRole, ConnectorMode, IncidentSeverity, IncidentStatus.
Add RLS SQL in migration: enable RLS on each table, policy on current_setting('app.tenant_id')::uuid.
Create seed.ts: demo tenant + admin user + one github connector.
Add .env.example with DATABASE_URL pointing to docker compose postgres.

Verify: DATABASE_URL set to docker postgres, pnpm --filter anvay-gateway prisma migrate dev succeeds."
}

build_m0_t5() {
  echo "$CTX
Task: M0-T5 — apps/gateway — Fastify server skeleton
Full spec: docs/TASKS.md § M0-T5

Bootstrap apps/gateway as Fastify TypeScript ESM app.
Plugins: @fastify/cors, @fastify/jwt (RS256), @fastify/sensible, pino.
Every request log: trace_id, tenant_id, user_id, method, path, status, duration_ms.
Routes: GET /health, GET /metrics (prom-client), POST /auth/token (dev stub).
OTEL: export traces to localhost:4317.
Per-connection: SET app.tenant_id from JWT claim.
Graceful shutdown on SIGTERM.

Verify: pnpm --filter anvay-gateway dev starts, GET /health → 200, GET /metrics → prometheus text."
}

build_m0_t6() {
  echo "$CTX
Task: M0-T6 — apps/web server-side API routes
Full spec: docs/TASKS.md § M0-T6

Create apps/web/app/api/chat/route.ts: POST, reads ANTHROPIC_API_KEY from process.env only, returns stub SSE stream.
Create apps/web/app/api/providers/route.ts: GET, checks which of 6 env vars are set, returns {providers:[{id,configured}]} — NEVER return key values.
Create apps/web/.env.local.example with all 6 vars.
Update apps/web/components/model-config.tsx: remove API key inputs, show provider status fetched from /api/providers.

Verify: POST /api/chat returns text/event-stream, GET /api/providers has no key values, pnpm typecheck passes."
}

build_m0_t7() {
  echo "$CTX
Task: M0-T7 — CI pipeline — GitHub Actions + Dockerfiles
Full spec: docs/TASKS.md § M0-T7

Create .github/workflows/ci.yml: triggers on push + PR to main, parallel jobs: typecheck, lint, test (--passWithNoTests), build, docker-build.
pnpm cache keyed on pnpm-lock.yaml. Node version from .nvmrc.
Create apps/gateway/Dockerfile: multi-stage, distroless final image, non-root user, EXPOSE 3001.
Create apps/web/Dockerfile: multi-stage, Next.js standalone output, non-root user, EXPOSE 3000.

Verify: yaml is valid, docker build apps/gateway succeeds, docker build apps/web succeeds."
}

build_m0_t8() {
  echo "$CTX
Task: M0-T8 — End-to-end smoke test
Full spec: docs/TASKS.md § M0-T8
Depends on: M0-T2 (docker infra) and M0-T5 (gateway) complete.

Create infra/docker-compose.dev.yml: extends docker-compose.yml, adds gateway + web services with dev volume mounts.
Create scripts/smoke-test.sh: polls gateway /health (60s timeout), checks /api/providers, verifies all Prometheus targets are up. Exits 0 on all pass.
Add 'smoke' script to root package.json.

Verify: docker compose -f infra/docker-compose.dev.yml up -d && pnpm smoke exits 0."
}

build_m1_t1() {
  echo "$CTX
Task: M1-T1 — IModelProvider interface + provider implementations
Full spec: docs/TASKS.md § M1-T1, docs/PRODUCT.md §5.4

In packages/agent create:
- src/interfaces/provider.ts: IModelProvider, IEmbeddingProvider, InferenceOptions, ChatResponse, StreamChunk
- src/providers/anthropic.ts, openai.ts, ollama.ts — each implements IModelProvider
- src/providers/factory.ts: ProviderFactory.create(config) — ONLY place provider SDKs imported
Unit tests for each provider using msw or nock mock server.
Non-negotiable: zero provider SDK imports outside src/providers/.

Verify: pnpm --filter @anvay/agent typecheck passes, unit tests pass."
}

build_m1_t2() {
  echo "$CTX
Task: M1-T2 — ISessionMemory + RedisSessionMemory
Full spec: docs/TASKS.md § M1-T2

In packages/agent create:
- src/interfaces/memory.ts: ISessionMemory, ConversationTurn, SessionContext
- src/memory/redis-session.ts: RedisSessionMemory — Redis key session:{id}:turns, TTL 24h reset on append, auto-summarise at 50 turns using cheap model
- src/memory/factory.ts: MemoryFactory.create(config)
Unit tests with ioredis-mock.

Verify: append+get round-trip, TTL resets, summarise compresses >50 turns."
}

build_m1_t3() {
  echo "$CTX
Task: M1-T3 — Perimeter engine + IAuditSink + middleware
Full spec: docs/TASKS.md § M1-T3

In packages/agent create:
- src/interfaces/audit.ts: IAuditSink, AuditEvent, AuditEventType enum
- src/perimeter/engine.ts: AgentPerimeter.allows(toolCall) deterministic (no LLM), resolveCapabilities(), hardBlock()
- src/middleware/perimeter.ts: createPerimeterMiddleware(perimeter, auditSink)
- src/middleware/token-meter.ts: createTokenMeterMiddleware(budget) — hard block if perQuery/perSession/perTenantDaily/perTenantMonthly exceeded
Unit tests: 5+ allow/block cases, token meter at 0 budget blocks, hardBlock always hits audit sink.

Verify: pnpm --filter @anvay/agent typecheck passes, all unit tests pass."
}

build_m1_t4() {
  echo "$CTX
Task: M1-T4 — Orchestrator + public surface
Full spec: docs/TASKS.md § M1-T4
Depends on: M1-T1, M1-T2, M1-T3 all complete.

In packages/agent install @mastra/core. Create:
- src/orchestrator.ts: createOrchestrator({model:IModelProvider,tools,perimeter,auditSink,sessionMemory}), runSession() → AsyncIterator<StreamEvent>. Wire perimeter + token-meter middlewares into Mastra hooks. Cheap model for intent classification first.
- src/specialist-agent.ts: createSpecialistAgent({name,model,tools,systemPrompt})
- src/gate.ts: createGate({condition,approvers,autoApproveThreshold}) using Mastra waitForInput
- src/index.ts: public exports only — NO Mastra types exported
Unit tests: mock IModelProvider, verify perimeter fires on every tool call.

Verify: pnpm --filter @anvay/agent typecheck, no Mastra types in index.ts exports."
}

build_m1_t5() {
  echo "$CTX
Task: M1-T5 — apps/gateway /api/chat SSE endpoint
Full spec: docs/TASKS.md § M1-T5
Depends on: M1-T4 complete.

In apps/gateway create:
- src/routes/chat.ts: POST /api/chat — extract userId+tenantId from JWT, load perimeter from DB, build AgentPerimeter+TokenBudget+IModelProvider via factories, call runSession() from @anvay/agent, stream as SSE (text/event-stream, data: <json>\n\n, end with data: [DONE]\n\n)
- src/audit/postgres-sink.ts: PostgresAuditSink implements IAuditSink — fire-and-forget insert, never awaited on hot path
Register route in server.ts.

Verify: POST /api/chat streams real LLM tokens, audit_events rows appear per call."
}

build_m1_t6() {
  echo "$CTX
Task: M1-T6 — Wire OrchestratorChat to real SSE
Full spec: docs/TASKS.md § M1-T6
Depends on: M1-T5 complete.

Update apps/web/components/orchestrator-chat.tsx:
- Replace mock streaming with fetch('/api/chat', POST, JSON body {query,sessionId})
- Parse ReadableStream as SSE lines, dispatch each StreamEvent type
- text_delta: append to message; tool_call: trace line; gate_required: gate UI with confirm; done: show token usage; error: error state
- sessionId: crypto.randomUUID() on mount, kept in useState
- Keep all existing inline styles — no Tailwind, no layout changes

Verify: real LLM tokens stream in UI, tool trace appears, gate UI shows on gate_required event."
}

# ── milestone runners ─────────────────────────────────────────────────────────

run_m0() {
  title "M0 — Foundation"
  run_task "M0-T1" "$(build_m0_t1)" "$(review_for M0-T1)"
  run_task "M0-T2" "$(build_m0_t2)" "$(review_for M0-T2)"
  run_task "M0-T3" "$(build_m0_t3)" "$(review_for M0-T3)"
  run_task "M0-T4" "$(build_m0_t4)" "$(review_for M0-T4)"
  run_task "M0-T5" "$(build_m0_t5)" "$(review_for M0-T5)"
  run_task "M0-T6" "$(build_m0_t6)" "$(review_for M0-T6)"
  run_task "M0-T7" "$(build_m0_t7)" "$(review_for M0-T7)"
  run_task "M0-T8" "$(build_m0_t8)" "$(review_for M0-T8)"
  ok "M0 complete"
}

run_m1() {
  title "M1 — Orchestrator Core"
  run_task "M1-T1" "$(build_m1_t1)" "$(review_for M1-T1)"
  run_task "M1-T2" "$(build_m1_t2)" "$(review_for M1-T2)"
  run_task "M1-T3" "$(build_m1_t3)" "$(review_for M1-T3)"
  run_task "M1-T4" "$(build_m1_t4)" "$(review_for M1-T4)"
  run_task "M1-T5" "$(build_m1_t5)" "$(review_for M1-T5)"
  run_task "M1-T6" "$(build_m1_t6)" "$(review_for M1-T6)"
  ok "M1 complete"
}

# ── entry ─────────────────────────────────────────────────────────────────────

case "$BUILD_TARGET" in
  all) run_m0; run_m1; title "Build complete M0+M1" ;;
  M0)  run_m0 ;;
  M1)  run_m1 ;;
  M0-*|M1-*)
    tid="$BUILD_TARGET"
    fn="build_${tid//-/_}"
    fn="${fn,,}"
    if declare -f "$fn" > /dev/null; then
      run_task "$tid" "$($fn)" "$(review_for $tid)"
    else
      err "No build function for $tid"
      exit 1
    fi
    ;;
  *)
    err "Unknown target: $BUILD_TARGET"
    echo "Usage: $0 [all|M0|M1|M0-T1..M0-T8|M1-T1..M1-T6]" >&2
    exit 1
    ;;
esac
