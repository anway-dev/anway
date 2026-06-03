#!/usr/bin/env bash
# build.sh — Anvay build orchestrator
#
# Architecture:
#   Claude is the orchestrator for every task.
#   Claude reads the task spec, calls opencode to implement, reviews output,
#   runs fix loops, then commits — all in one claude session per task.
#   retry.sh wraps the claude call: rate limit = pause + --continue, never stop.
#
# Flow per task:
#   retry.sh claude "<orchestration prompt>"
#     → claude reads TASKS.md + PRODUCT.md
#     → claude calls: opencode run --model nvidia/moonshotai/kimi-k2.6 "<impl prompt>"
#     → claude reviews output against acceptance criteria
#     → if issues: opencode fixes (up to 3 loops), then claude fixes directly
#     → claude runs pnpm typecheck + lint, commits
#   rate limit on claude → pause → --continue → resumes same session
#
# All tasks sequential — avoids opencode rate limit from parallel calls.
#
# Usage:
#   ./scripts/build.sh              # all milestones
#   ./scripts/build.sh M0           # M0 only
#   ./scripts/build.sh M0-T1        # single task
#
# Logs:   logs/build/<task-id>.log
# Status: logs/build/status.txt  (completed task IDs, skip on re-run)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RETRY="$REPO_ROOT/scripts/retry.sh"
LOG_DIR="$REPO_ROOT/logs/build"
STATUS_FILE="$LOG_DIR/status.txt"
OPENCODE_MODEL="nvidia/moonshotai/kimi-k2.6"

mkdir -p "$LOG_DIR"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

BUILD_TARGET="${1:-all}"

log()   { echo -e "${CYAN}[build]${RESET} $*"; }
ok()    { echo -e "${GREEN}[build]${RESET} $*"; }
err()   { echo -e "${RED}[build]${RESET} $*"; }
title() { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}\n"; }

is_done()  { grep -qx "$1" "$STATUS_FILE" 2>/dev/null; }
mark_done(){
  echo "$1" >> "$STATUS_FILE"
  echo "$1" > "$LOG_DIR/review-trigger"   # signals review-watcher.sh
  ok "$1 done"
}

# ── orchestration prompt template ─────────────────────────────────────────────
# Injected into every claude orchestration call.
# Claude reads the task spec itself from TASKS.md + PRODUCT.md.

orchestrate() {
  local task_id="$1"
  cat <<PROMPT
You are orchestrating the implementation of $task_id for the Anvay project.
Working directory: $REPO_ROOT

Your steps (execute in order, do not skip):

1. READ: docs/TASKS.md section $task_id — full spec, files to create, acceptance criteria.
   READ: docs/PRODUCT.md — source of truth for all interfaces, decisions, non-negotiables.

2. BUILD: Use the opencode skill to implement the task.
   Invoke it with: /opencode <detailed implementation prompt based on what you read in step 1>
   The implementation prompt must include: working directory, specific files to create/modify,
   exact behaviour required, and the acceptance criteria to verify when done.
   opencode will use model $OPENCODE_MODEL.

3. REVIEW: Check the implementation against:
   - Every acceptance criterion in docs/TASKS.md § $task_id
   - Non-negotiables in docs/PRODUCT.md §10 (no console.log, no Tailwind, tenant_id on all tables,
     API keys server-side only, tests ship with code, no vendor lock-in)
   Run: pnpm typecheck and pnpm lint from $REPO_ROOT

4. FIX LOOP (max 3 rounds): If review finds issues, use the opencode skill again with the specific issues to fix.
   Invoke: /opencode <fix prompt listing exact issues>
   Re-review after each fix. Stop loop when review passes or 3 rounds exhausted.

5. DIRECT FIX: If still failing after 3 opencode rounds, fix the remaining issues yourself directly.

6. COMMIT: git add the changed files, git commit with a clear message describing what was built.
   Do not push — commit only.

7. DONE: Output the line "TASK $task_id COMPLETE" when finished.
PROMPT
}

# ── run a task ────────────────────────────────────────────────────────────────

run_task() {
  local task_id="$1"
  local log_file="$LOG_DIR/${task_id}.log"

  if is_done "$task_id"; then
    log "SKIP $task_id (already done)"
    return 0
  fi

  title "$task_id"
  echo "=== $task_id started $(date) ===" | tee -a "$log_file"

  "$RETRY" claude "$(orchestrate "$task_id")" 2>&1 | tee -a "$log_file" || {
    err "$task_id FAILED — see $log_file"
    exit 1
  }

  echo "=== $task_id finished $(date) ===" | tee -a "$log_file"
  mark_done "$task_id"
}

# ── milestones ────────────────────────────────────────────────────────────────

run_m0() {
  title "M0 — Foundation"
  run_task "M0-T1"   # Monorepo root — pnpm + turborepo
  run_task "M0-T2"   # Docker Compose — dev infra stack
  run_task "M0-T3"   # packages/types — shared TS types
  run_task "M0-T4"   # Database schema — Prisma migrations
  run_task "M0-T5"   # apps/gateway — Fastify skeleton
  run_task "M0-T6"   # apps/web — server-side API routes
  run_task "M0-T7"   # CI pipeline — GitHub Actions + Dockerfiles
  run_task "M0-T8"   # End-to-end smoke test
  ok "M0 complete"
}

run_m1() {
  title "M1 — Orchestrator Core"
  run_task "M1-T1"   # IModelProvider + provider implementations
  run_task "M1-T2"   # ISessionMemory + RedisSessionMemory
  run_task "M1-T3"   # Perimeter engine + IAuditSink + middleware
  run_task "M1-T4"   # Orchestrator + createOrchestrator public surface
  run_task "M1-T5"   # apps/gateway /api/chat SSE endpoint
  run_task "M1-T6"   # Wire OrchestratorChat to real SSE
  ok "M1 complete"
}

# ── entry ─────────────────────────────────────────────────────────────────────

case "$BUILD_TARGET" in
  all)   run_m0; run_m1; title "Build complete M0 + M1" ;;
  M0)    run_m0 ;;
  M1)    run_m1 ;;
  M0-*|M1-*) run_task "$BUILD_TARGET" ;;
  *)
    err "Unknown target: $BUILD_TARGET"
    echo "Usage: $0 [all|M0|M1|M0-T1..M0-T8|M1-T1..M1-T6]" >&2
    exit 1
    ;;
esac
