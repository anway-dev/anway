#!/usr/bin/env bash
# retry.sh — rate-limit-aware session runner for claude + opencode
#
# Usage:
#   ./scripts/retry.sh claude   "your prompt"
#   ./scripts/retry.sh opencode "your prompt"
#   ./scripts/retry.sh claude   "your prompt" --max-retries 10
#
# Behaviour:
#   1. First run: starts execution with the prompt
#   2. Rate limit hit mid-run: detects from output, parses wait time, sleeps
#   3. Resume: sends --continue (claude) or --continue (opencode) — NO prompt re-sent
#   4. Loops until successful completion or non-rate-limit error
#
#   No LLM involved in retry logic — pure shell pattern matching.
#   opencode always uses nvidia/moonshotai/kimi-k2.6
#   claude uses default model from Claude Code settings

set -euo pipefail

OPENCODE_MODEL="nvidia/moonshotai/kimi-k2.6"
DEFAULT_MAX_RETRIES=50
FALLBACK_WAIT_SECS=60
MAX_WAIT_SECS=3600

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; DIM='\033[2m'; RESET='\033[0m'

log()  { echo -e "${CYAN}[retry]${RESET} $*" >&2; }
warn() { echo -e "${YELLOW}[retry]${RESET} $*" >&2; }
ok()   { echo -e "${GREEN}[retry]${RESET} $*" >&2; }
err()  { echo -e "${RED}[retry]${RESET} $*" >&2; }

# ── args ─────────────────────────────────────────────────────────────────────

TOOL="${1:-}"
PROMPT="${2:-}"
MAX_RETRIES=$DEFAULT_MAX_RETRIES
shift 2 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-retries) MAX_RETRIES="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$TOOL" || -z "$PROMPT" ]]; then
  echo "Usage: $0 <claude|opencode> \"prompt\" [--max-retries N]" >&2
  exit 1
fi
if [[ "$TOOL" != "claude" && "$TOOL" != "opencode" ]]; then
  err "Unknown tool: $TOOL — must be 'claude' or 'opencode'"
  exit 1
fi

# ── rate limit detection ──────────────────────────────────────────────────────

is_rate_limited() {
  echo "$1" | grep -qiE \
    "rate.?limit|429|too many requests|quota.?exceed|retry.?after|please try again in|usage limit|you've exceeded|overloaded"
}

# ── wait time parser ──────────────────────────────────────────────────────────
# Reads error output, returns seconds to wait as integer

parse_wait_secs() {
  local out="$1"
  local n

  # "Xm Ys" — Anthropic standard format e.g. "try again in 2m 30s"
  local mins secs_part
  mins=$(echo "$out" | grep -oiE "([0-9]+)m [0-9]+s" | grep -oE "^[0-9]+" | head -1)
  secs_part=$(echo "$out" | grep -oiE "[0-9]+m ([0-9]+)s" | grep -oE "[0-9]+s$" | grep -oE "^[0-9]+" | head -1)
  if [[ -n "$mins" ]]; then
    echo $(( mins * 60 + ${secs_part:-0} )); return
  fi

  # "again in Xs" — seconds only
  n=$(echo "$out" | grep -oiE "again in ([0-9]+)s" | grep -oE "[0-9]+" | head -1)
  [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }

  # "retry after N seconds"
  n=$(echo "$out" | grep -oiE "after ([0-9]+) second" | grep -oE "[0-9]+" | head -1)
  [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }

  # "Retry-After: N" header
  n=$(echo "$out" | grep -oiE "Retry-After: ?([0-9]+)" | grep -oE "[0-9]+" | head -1)
  [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }

  # ISO timestamp "retry after 2025-06-01T14:30:00Z"
  local ts
  ts=$(echo "$out" | grep -oiE "20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]+Z" | head -1)
  if [[ -n "$ts" ]]; then
    local target now
    target=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" "+%s" 2>/dev/null \
          || date -d "$ts" "+%s" 2>/dev/null || echo 0)
    now=$(date +%s)
    local diff=$(( target - now ))
    [[ "$diff" -gt 0 ]] && { echo "$diff"; return; }
  fi

  echo "$FALLBACK_WAIT_SECS"
}

# ── countdown ────────────────────────────────────────────────────────────────

countdown() {
  local total="$1"
  local end=$(( $(date +%s) + total ))
  while [[ $(date +%s) -lt $end ]]; do
    local rem=$(( end - $(date +%s) ))
    local mm=$(( rem / 60 ))
    local ss=$(( rem % 60 ))
    printf "\r${YELLOW}[retry]${RESET} Rate limited — resuming in %02d:%02d " "$mm" "$ss" >&2
    sleep 1
  done
  printf "\r${GREEN}[retry]${RESET} Limit cleared — sending continue          \n" >&2
}

# ── run first attempt (with prompt) ──────────────────────────────────────────

run_first() {
  if [[ "$TOOL" == "claude" ]]; then
    claude --dangerously-skip-permissions --output-format stream-json --print "$PROMPT" 2>&1
  else
    opencode run --model "$OPENCODE_MODEL" "$PROMPT" 2>&1
  fi
}

# ── resume (no prompt — continue from last session state) ────────────────────

run_continue() {
  if [[ "$TOOL" == "claude" ]]; then
    claude --dangerously-skip-permissions --output-format stream-json --continue --print "continue" 2>&1
  else
    opencode run --continue --model "$OPENCODE_MODEL" 2>&1
  fi
}

# ── main ──────────────────────────────────────────────────────────────────────

log "Tool    : $TOOL"
log "Model   : $( [[ "$TOOL" == "opencode" ]] && echo "$OPENCODE_MODEL" || echo "Claude Code default" )"
log "Prompt  : ${PROMPT:0:100}$( [[ ${#PROMPT} -gt 100 ]] && echo ' …' )"
log "Retries : $MAX_RETRIES"
echo >&2

attempt=0
is_first=true

while true; do
  attempt=$(( attempt + 1 ))

  if [[ $attempt -gt $MAX_RETRIES ]]; then
    err "Max retries ($MAX_RETRIES) exhausted."
    exit 1
  fi

  if [[ "$is_first" == "true" ]]; then
    log "Starting — attempt $attempt"
    output=$(run_first 2>&1) && exit_code=0 || exit_code=$?
    is_first=false
  else
    log "Resuming — attempt $attempt (--continue)"
    output=$(run_continue 2>&1) && exit_code=0 || exit_code=$?
  fi

  # Success
  if [[ $exit_code -eq 0 ]] && ! is_rate_limited "$output"; then
    ok "Done on attempt $attempt"
    echo "$output"
    exit 0
  fi

  # Rate limit — wait then continue
  if is_rate_limited "$output"; then
    wait_secs=$(parse_wait_secs "$output")
    [[ "$wait_secs" -gt $MAX_WAIT_SECS ]] && wait_secs=$MAX_WAIT_SECS

    warn "Rate limited on attempt $attempt. Wait: ${wait_secs}s"
    # Show the rate limit line from output for debugging
    echo "$output" | grep -iE "rate.?limit|429|retry|again in|quota" | head -2 \
      | while IFS= read -r line; do warn "  ↳ $line"; done

    countdown "$wait_secs"
    continue
  fi

  # Any other error — abort, don't retry
  err "Non-rate-limit failure (exit $exit_code) — aborting"
  echo "$output" >&2
  exit $exit_code
done
