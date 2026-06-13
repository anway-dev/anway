#!/usr/bin/env bash
# Wave gate — the executor MUST run this and paste its banner into the bridge
# [ANSWERED] entry. It runs the full acceptance: workspace tests, gateway
# typecheck, web typecheck, and the certification suite. Exit 0 = wave may be
# reported done. Any red = wave is NOT done; fix and rerun.
#
# Usage: ./scripts/wave-check.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
FAIL=0
step() { echo ""; echo -e "${BOLD}── $* ──${NC}"; }
mark() { if [ "$1" -eq 0 ]; then echo -e "${GREEN}PASS${NC} $2"; else echo -e "${RED}FAIL${NC} $2"; FAIL=1; fi; }

step "1/4 workspace unit tests (pnpm -r test)"
pnpm -r test > /tmp/wave-test.log 2>&1
mark $? "pnpm -r test  (tail: $(tail -1 /tmp/wave-test.log))"

step "2/4 gateway typecheck (tsc --noEmit)"
( cd apps/gateway && pnpm exec tsc --noEmit ) > /tmp/wave-tsc-gw.log 2>&1
mark $? "gateway tsc  ($(grep -c 'error TS' /tmp/wave-tsc-gw.log) errors)"

step "3/4 web typecheck (tsc --noEmit)"
( cd apps/web && pnpm exec tsc --noEmit ) > /tmp/wave-tsc-web.log 2>&1
mark $? "web tsc  ($(grep -c 'error TS' /tmp/wave-tsc-web.log) errors)"

step "4/4 certification suite (scripts/certify.sh)"
./scripts/certify.sh > /tmp/wave-certify.log 2>&1
CERT_RC=$?
echo "$(grep -E 'passed|failed' /tmp/wave-certify.log | tail -1)"
mark $CERT_RC "certify  (log: /tmp/wave-certify.log)"

echo ""
echo -e "${BOLD}════════════════════════════════════════════${NC}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}  WAVE-CHECK: PASS — wave may be reported [ANSWERED]${NC}"
  echo -e "${BOLD}════════════════════════════════════════════${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}  WAVE-CHECK: FAIL — wave NOT done. Fix and rerun.${NC}"
  echo -e "${BOLD}  Logs: /tmp/wave-test.log /tmp/wave-tsc-gw.log /tmp/wave-tsc-web.log /tmp/wave-certify.log${NC}"
  echo -e "${BOLD}════════════════════════════════════════════${NC}"
  exit 1
fi
