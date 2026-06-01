#!/usr/bin/env bash
# retry.sh — rate-limit-aware session runner for claude + opencode
#
# Streams all output to terminal live (via tee).
# Saves raw output to tmpfile for rate limit detection.
# claude: uses stream-json, parses to readable text while streaming.
# opencode: streams raw output directly.
# On rate limit: detects from saved output, waits, --continue resumes session.

set -euo pipefail

OPENCODE_MODEL="nvidia/moonshotai/kimi-k2.6"
DEFAULT_MAX_RETRIES=50
FALLBACK_WAIT_SECS=60
MAX_WAIT_SECS=3600

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; RESET='\033[0m'

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
  err "Unknown tool: $TOOL"
  exit 1
fi

# ── rate limit detection ──────────────────────────────────────────────────────

is_rate_limited() {
  echo "$1" | grep -qiE \
    "rate.?limit|429|too many requests|quota.?exceed|retry.?after|please try again in|usage limit|you've exceeded|overloaded"
}

# ── wait time parser ──────────────────────────────────────────────────────────

parse_wait_secs() {
  local out="$1"
  local n

  local mins secs_part
  mins=$(echo "$out" | grep -oiE "([0-9]+)m [0-9]+s" | grep -oE "^[0-9]+" | head -1)
  secs_part=$(echo "$out" | grep -oiE "[0-9]+m ([0-9]+)s" | grep -oE "[0-9]+s$" | grep -oE "^[0-9]+" | head -1)
  if [[ -n "$mins" ]]; then echo $(( mins * 60 + ${secs_part:-0} )); return; fi

  n=$(echo "$out" | grep -oiE "again in ([0-9]+)s" | grep -oE "[0-9]+" | head -1)
  [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }

  n=$(echo "$out" | grep -oiE "after ([0-9]+) second" | grep -oE "[0-9]+" | head -1)
  [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }

  n=$(echo "$out" | grep -oiE "Retry-After: ?([0-9]+)" | grep -oE "[0-9]+" | head -1)
  [[ -n "$n" && "$n" -gt 0 ]] && { echo "$n"; return; }

  echo "$FALLBACK_WAIT_SECS"
}

# ── countdown ────────────────────────────────────────────────────────────────

countdown() {
  local total="$1"
  local end=$(( $(date +%s) + total ))
  while [[ $(date +%s) -lt $end ]]; do
    local rem=$(( end - $(date +%s) ))
    printf "\r${YELLOW}[retry]${RESET} Rate limited — resuming in %02d:%02d " "$(( rem/60 ))" "$(( rem%60 ))" >&2
    sleep 1
  done
  printf "\r${GREEN}[retry]${RESET} Limit cleared — resuming now               \n" >&2
}

# ── stream-json parser (python) ───────────────────────────────────────────────
# Reads stream-json from stdin, prints human-readable to stdout line by line

PARSER='
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        e = json.loads(line)
        t = e.get("type","")
        if t == "assistant":
            for b in e.get("message",{}).get("content",[]):
                if b.get("type") == "text" and b["text"].strip():
                    print(b["text"], flush=True)
                elif b.get("type") == "tool_use":
                    inp = str(b.get("input",""))[:200]
                    name = b.get("name","")
                    print(f"[tool:{name}] {inp}", flush=True)
        elif t == "tool_result":
            content = e.get("content","")
            if isinstance(content, list):
                for c in content:
                    if c.get("type") == "text": print(f"[result] {c[\"text\"][:300]}", flush=True)
            elif content:
                print(f"[result] {str(content)[:300]}", flush=True)
        elif t == "result":
            r = e.get("result","")
            if r: print(r, flush=True)
        elif t in ("error","system"):
            print(str(e), flush=True)
    except Exception:
        print(line, flush=True)
'

# ── run tool — streams to terminal, saves raw to tmpfile ─────────────────────

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

run_tool() {
  local first="$1"   # true/false
  local exit_code=0

  if [[ "$TOOL" == "claude" ]]; then
    if [[ "$first" == "true" ]]; then
      claude --dangerously-skip-permissions --output-format stream-json \
        --print "$PROMPT" 2>&1 \
        | tee "$TMPFILE" \
        | python3 -c "$PARSER" \
        || exit_code=${PIPESTATUS[0]}
    else
      claude --dangerously-skip-permissions --output-format stream-json \
        --continue --print "continue" 2>&1 \
        | tee "$TMPFILE" \
        | python3 -c "$PARSER" \
        || exit_code=${PIPESTATUS[0]}
    fi
  else
    # opencode: stream raw output directly — already human-readable
    if [[ "$first" == "true" ]]; then
      opencode run --model "$OPENCODE_MODEL" "$PROMPT" 2>&1 \
        | tee "$TMPFILE" \
        || exit_code=${PIPESTATUS[0]}
    else
      opencode run --continue --model "$OPENCODE_MODEL" 2>&1 \
        | tee "$TMPFILE" \
        || exit_code=${PIPESTATUS[0]}
    fi
  fi

  return $exit_code
}

# ── main ──────────────────────────────────────────────────────────────────────

log "Tool    : $TOOL"
log "Model   : $( [[ "$TOOL" == "opencode" ]] && echo "$OPENCODE_MODEL" || echo "Claude Code default" )"
log "Prompt  : ${PROMPT:0:120}$( [[ ${#PROMPT} -gt 120 ]] && echo ' …' )"
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

  [[ "$is_first" == "true" ]] && log "Starting — attempt $attempt" \
                               || log "Resuming — attempt $attempt (--continue)"

  run_tool "$is_first" && exit_code=0 || exit_code=$?
  is_first=false

  raw=$(cat "$TMPFILE")

  # Success
  if [[ $exit_code -eq 0 ]] && ! is_rate_limited "$raw"; then
    ok "Done on attempt $attempt"
    exit 0
  fi

  # Rate limit
  if is_rate_limited "$raw"; then
    wait_secs=$(parse_wait_secs "$raw")
    [[ "$wait_secs" -gt $MAX_WAIT_SECS ]] && wait_secs=$MAX_WAIT_SECS
    warn "Rate limited — wait ${wait_secs}s"
    echo "$raw" | grep -iE "rate.?limit|429|retry|again in|quota" | head -2 \
      | while IFS= read -r line; do warn "  ↳ $line"; done
    countdown "$wait_secs"
    continue
  fi

  # Other error
  err "Failed (exit $exit_code) — aborting"
  exit $exit_code
done
