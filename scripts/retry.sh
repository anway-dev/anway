#!/usr/bin/env bash
# retry.sh — rate-limit-aware retry loop for claude + opencode
#
# Usage:
#   ./scripts/retry.sh claude   "your prompt"
#   ./scripts/retry.sh opencode "your prompt"
#   ./scripts/retry.sh claude   "your prompt" --max-retries 10
#   ./scripts/retry.sh opencode "your prompt" --max-retries 10
#
# Behaviour:
#   - Runs the prompt against the chosen tool
#   - On rate limit: parses wait time from error output, sleeps, retries
#   - No LLM involved in retry logic — pure shell pattern matching
#   - opencode always uses kimi-k2.6 (nvidia/moonshotai/kimi-k2.6)
#   - claude uses default model configured in Claude Code settings

set -euo pipefail

# ── constants ────────────────────────────────────────────────────────────────

OPENCODE_MODEL="nvidia/moonshotai/kimi-k2.6"
DEFAULT_MAX_RETRIES=20
FALLBACK_WAIT_SECS=60      # used when no wait time found in error
MAX_FALLBACK_WAIT=3600     # cap exponential backoff at 1h

# ── colours ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; RESET='\033[0m'

log()  { echo -e "${CYAN}[retry]${RESET} $*" >&2; }
warn() { echo -e "${YELLOW}[retry]${RESET} $*" >&2; }
ok()   { echo -e "${GREEN}[retry]${RESET} $*" >&2; }
err()  { echo -e "${RED}[retry]${RESET} $*" >&2; }

# ── parse args ───────────────────────────────────────────────────────────────

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

# ── detect rate limit in output ──────────────────────────────────────────────
# Returns 0 (true) if output looks like a rate limit error

is_rate_limited() {
  local output="$1"
  echo "$output" | grep -qiE \
    "rate.?limit|429|too many requests|quota exceeded|retry.?after|please try again in|usage limit reached|you've exceeded"
}

# ── parse wait seconds from error output ─────────────────────────────────────
# Tries multiple patterns; returns seconds as integer on stdout
# Falls back to FALLBACK_WAIT_SECS if nothing found

parse_wait_secs() {
  local output="$1"
  local secs=0

  # Pattern: "retry after N seconds" / "retry in N seconds"
  if echo "$output" | grep -oiE "retry.{1,10}([0-9]+) second" | grep -oE "[0-9]+" | head -1 | read -r n 2>/dev/null; then
    [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }
  fi
  n=$(echo "$output" | grep -oiE "retry.{1,10}([0-9]+) second" | grep -oE "[0-9]+" | head -1)
  [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }

  # Pattern: "try again in Xm Ys" (Anthropic format)
  local mins secs_part
  mins=$(echo "$output" | grep -oiE "([0-9]+)m [0-9]+s" | grep -oE "^[0-9]+" | head -1)
  secs_part=$(echo "$output" | grep -oiE "[0-9]+m ([0-9]+)s" | grep -oE "[0-9]+s$" | grep -oE "[0-9]+" | head -1)
  if [[ -n "$mins" ]]; then
    secs=$(( mins * 60 + ${secs_part:-0} ))
    [[ "$secs" -gt 0 ]] && { echo "$secs"; return; }
  fi

  # Pattern: "try again in Xs" (seconds only)
  n=$(echo "$output" | grep -oiE "again in ([0-9]+)s" | grep -oE "[0-9]+" | head -1)
  [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }

  # Pattern: "Retry-After: N" (HTTP header in output)
  n=$(echo "$output" | grep -oiE "Retry-After: ([0-9]+)" | grep -oE "[0-9]+" | head -1)
  [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }

  # Pattern: ISO timestamp "retry after 2025-01-01T14:30:00Z"
  local ts
  ts=$(echo "$output" | grep -oiE "retry.{1,10}(20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]+Z)" \
    | grep -oE "20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]+Z" | head -1)
  if [[ -n "$ts" ]]; then
    local target now
    target=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" "+%s" 2>/dev/null \
          || date -d "$ts" "+%s" 2>/dev/null || echo 0)
    now=$(date +%s)
    secs=$(( target - now ))
    [[ "$secs" -gt 0 ]] && { echo "$secs"; return; }
  fi

  echo "$FALLBACK_WAIT_SECS"
}

# ── countdown display ────────────────────────────────────────────────────────

countdown() {
  local secs="$1"
  local end=$(( $(date +%s) + secs ))
  while [[ $(date +%s) -lt $end ]]; do
    local remaining=$(( end - $(date +%s) ))
    printf "\r${YELLOW}[retry]${RESET} Rate limited — retrying in %3ds " "$remaining" >&2
    sleep 1
  done
  printf "\r${GREEN}[retry]${RESET} Wait done — retrying now                \n" >&2
}

# ── run the tool ─────────────────────────────────────────────────────────────

run_tool() {
  local tool="$1"
  local prompt="$2"
  local combined_output

  if [[ "$tool" == "claude" ]]; then
    # --print-output: print to stdout and exit (non-interactive)
    combined_output=$(claude --print "$prompt" 2>&1) && {
      echo "$combined_output"
      return 0
    } || {
      echo "$combined_output"
      return 1
    }
  else
    # opencode run: always kimi-k2.6, json format for reliable exit codes
    combined_output=$(opencode run \
      --model "$OPENCODE_MODEL" \
      "$prompt" 2>&1) && {
      echo "$combined_output"
      return 0
    } || {
      echo "$combined_output"
      return 1
    }
  fi
}

# ── main retry loop ──────────────────────────────────────────────────────────

attempt=0
fallback_wait=$FALLBACK_WAIT_SECS

log "Tool: $TOOL | Model: $( [[ "$TOOL" == "opencode" ]] && echo "$OPENCODE_MODEL" || echo "default (Claude Code settings)" )"
log "Max retries: $MAX_RETRIES"
log "Prompt: ${PROMPT:0:80}$( [[ ${#PROMPT} -gt 80 ]] && echo '…' )"
echo >&2

while true; do
  attempt=$(( attempt + 1 ))

  if [[ $attempt -gt $MAX_RETRIES ]]; then
    err "Max retries ($MAX_RETRIES) exceeded. Giving up."
    exit 1
  fi

  log "Attempt $attempt / $MAX_RETRIES …"

  output=$(run_tool "$TOOL" "$PROMPT" 2>&1) && exit_code=0 || exit_code=$?

  if [[ $exit_code -eq 0 ]] && ! is_rate_limited "$output"; then
    ok "Success on attempt $attempt"
    echo "$output"
    exit 0
  fi

  if is_rate_limited "$output"; then
    wait_secs=$(parse_wait_secs "$output")

    # Cap wait at MAX_FALLBACK_WAIT
    [[ "$wait_secs" -gt $MAX_FALLBACK_WAIT ]] && wait_secs=$MAX_FALLBACK_WAIT

    warn "Rate limited. Waiting ${wait_secs}s before retry."
    warn "Error snippet: $(echo "$output" | grep -iE "rate.?limit|429|retry|quota|again in" | head -2)"

    countdown "$wait_secs"

    # Reset fallback since we got a real wait time
    fallback_wait=$FALLBACK_WAIT_SECS
  else
    # Non-rate-limit error — print and exit immediately, don't retry
    err "Non-rate-limit error (exit $exit_code) on attempt $attempt:"
    echo "$output" >&2
    exit $exit_code
  fi
done
