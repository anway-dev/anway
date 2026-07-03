#!/usr/bin/env bash
# scripts/prod-readiness-check.sh
#
# Anway production-readiness certification — baseline run against the
# docker-compose.dev.yml stack, AS THE CODE STANDS RIGHT NOW (before the
# 21-task remediation list from the 2026-07-02 audit is implemented).
#
# This is expected to FAIL. That is the correct, honest result of this run —
# it proves the gaps found in the audit are real and reproducible, not
# theoretical. Re-run after each remediation task to watch checks flip to PASS.
#
# Prerequisites:
#   docker compose -f infra/docker-compose.dev.yml up -d
#   (wait ~2 min for gateway/web healthchecks to go healthy)
#
# Usage:
#   bash scripts/prod-readiness-check.sh
#   RUN_UNIT_TESTS=0 bash scripts/prod-readiness-check.sh   # skip the 34 vitest suites (slow)
#   RUN_E2E=1 bash scripts/prod-readiness-check.sh          # also run e2e/99-certification.spec.ts (needs browsers + LLM provider)
#
# Exit code: 0 = every check passed (system is compliant with CLAUDE.md as written).
#            1 = at least one check failed (NOT CERTIFIED).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Exact values pulled from apps/gateway/.env / infra/docker-compose.dev.yml (verified 2026-07-03) ──
GW="${GW:-http://127.0.0.1:8510}"
WEB="${WEB:-http://localhost:8500}"
PROM="${PROM:-http://localhost:8530}"
AM="${AM:-http://localhost:9093}"
GRAFANA="${GRAFANA:-http://localhost:8520}"
LOKI="${LOKI:-http://localhost:3100}"
COMPOSE_FILE="infra/docker-compose.dev.yml"
WEBHOOK_TOKEN="anway-demo-webhook-token"          # apps/gateway/.env ANWAY_WEBHOOK_TOKEN (verbatim)
DEMO_TENANT="00000000-0000-0000-0000-000000000001" # apps/gateway/.env ANWAY_WEBHOOK_TENANT (verbatim)
PG_USER="anway"
PG_DB="anway_dev"                                  # infra/docker-compose.dev.yml postgres.environment.POSTGRES_DB
CERT_EMAIL="${CERT_EMAIL:-prod-readiness-cert@anway.local}"
CERT_PASSWORD="${CERT_PASSWORD:-ProdReadinessCert!2026x}"
RUN_UNIT_TESTS="${RUN_UNIT_TESTS:-1}"
RUN_E2E="${RUN_E2E:-0}"

PASS=0
FAIL=0
SKIP=0
declare -a FAILED_CHECKS=()

hdr()  { printf '\n\033[1;36m── %s ──\033[0m\n' "$*"; }
info() { printf '  [info] %s\n' "$*"; }
ok()   { printf '  \033[0;32m[PASS]\033[0m %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[0;31m[FAIL]\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); FAILED_CHECKS+=("$*"); }
skp()  { printf '  \033[1;33m[SKIP]\033[0m %s\n' "$*"; SKIP=$((SKIP + 1)); }

# Runs a psql query inside the postgres container. Prints the raw scalar result.
pg() {
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc "$1" 2>/dev/null
}

http_code() {
  curl -s -o /tmp/prod-readiness-body.$$ -w '%{http_code}' "$@"
}

echo "==================================================================="
echo " ANWAY PRODUCTION-READINESS CERTIFICATION — BASELINE RUN"
echo " Repo: $REPO_ROOT"
echo " Gateway: $GW   Web: $WEB"
echo "==================================================================="

# =====================================================================
# SECTION 0 / 13 — Infra: docker-compose.dev.yml service health
# =====================================================================
hdr "Section 13 (part 1) — infra service health (docker-compose.dev.yml)"

check_container() {
  local svc="$1"
  local cid
  cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null)"
  if [ -z "$cid" ]; then
    bad "container '$svc' not found — is '$COMPOSE_FILE' up? (docker compose -f $COMPOSE_FILE up -d)"
    return 1
  fi
  local status health
  status="$(docker inspect --format '{{.State.Status}}' "$cid" 2>/dev/null)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$cid" 2>/dev/null)"
  if [ "$status" = "running" ] && { [ "$health" = "healthy" ] || [ "$health" = "no-healthcheck" ]; }; then
    ok "$svc: status=$status health=$health"
    return 0
  else
    bad "$svc: status=$status health=$health (expected status=running, health=healthy|no-healthcheck)"
    return 1
  fi
}

for svc in postgres redis prometheus otel-collector alertmanager loki grafana gateway web; do
  check_container "$svc"
done

echo
info "postgres: docker compose exec -T postgres psql -U $PG_USER -d $PG_DB -tAc 'SELECT 1;'"
if [ "$(pg 'SELECT 1;')" = "1" ]; then ok "postgres reachable via psql (SELECT 1 -> 1)"; else bad "postgres NOT reachable via psql"; fi

info "redis: docker compose exec -T redis redis-cli ping"
redis_ping="$(docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping 2>/dev/null | tr -d '\r\n')"
if [ "$redis_ping" = "PONG" ]; then ok "redis PONG"; else bad "redis did not respond PONG (got: '$redis_ping')"; fi

# =====================================================================
# SECTION 13 (part 2) — gateway health endpoints + Prometheus rules (already-fixed regressions check)
# =====================================================================
hdr "Section 13 (part 2) — gateway health + Prometheus rules load"

code="$(http_code "$GW/health")"
body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"status":"ok"'; then
  ok "GET $GW/health -> 200, body: $body"
else
  bad "GET $GW/health -> $code, body: $body (expected 200 with \"status\":\"ok\")"
fi

code="$(http_code "$GW/health/ready")"
body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"status":"ok"' && printf '%s' "$body" | grep -q '"db":"connected"'; then
  ok "GET $GW/health/ready -> 200, body: $body"
else
  bad "GET $GW/health/ready -> $code, body: $body (expected 200 {\"status\":\"ok\",\"db\":\"connected\"})"
fi

code="$(http_code "$PROM/api/v1/rules")"
body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"name":"anway-gateway"'; then
  ok "Prometheus rules loaded: group 'anway-gateway' present (GET $PROM/api/v1/rules)"
else
  bad "Prometheus rules missing 'anway-gateway' group -> $code, body: $body (infra/prometheus/rules/anway.yml and the docker-compose.dev.yml mount are both correct on disk — an empty groups:[] here means the RUNNING prometheus container has a stale/missing mount)"
  mount_check="$(docker compose -f "$COMPOSE_FILE" exec -T prometheus ls /etc/prometheus/rules/ 2>&1)"
  info "diagnostic: docker compose exec prometheus ls /etc/prometheus/rules/ -> $mount_check"
  info "if that path is missing/empty, recreate the container: docker compose -f $COMPOSE_FILE up -d --force-recreate prometheus"
fi

code="$(http_code "$AM/-/healthy")"
if [ "$code" = "200" ]; then ok "Alertmanager healthy (GET $AM/-/healthy -> 200)"; else bad "Alertmanager /-/healthy -> $code"; fi

code="$(http_code "$GRAFANA/api/health")"
body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
if [ "$code" = "200" ] && printf '%s' "$body" | grep -qE '"database":[[:space:]]*"ok"'; then
  ok "Grafana healthy (GET $GRAFANA/api/health -> 200, database:ok)"
else
  bad "Grafana /api/health -> $code, body: $body"
fi

code="$(http_code "$LOKI/ready")"
if [ "$code" = "200" ]; then ok "Loki ready (GET $LOKI/ready -> 200)"; else bad "Loki /ready -> $code"; fi

# Prod compose port mismatch (infra/prod/docker-compose.yml gateway service) — static check, no live stack needed
hdr "Section 13 (part 3) — infra/prod/docker-compose.yml static config checks"
prod_compose="infra/prod/docker-compose.yml"
port_mapping="$(grep -n '"8510:4000"' "$prod_compose" | head -1)"
port_env="$(grep -n 'PORT: 8510' "$prod_compose" | head -1)"
if [ -n "$port_mapping" ] && [ -n "$port_env" ]; then
  bad "$prod_compose: host:container port mapping is '8510:4000' (line: ${port_mapping%%:*}) but gateway PORT env is 8510 (line: ${port_env%%:*}) — container listens on 8510, host maps to 4000. Gateway is unreachable from outside the container in this compose file."
else
  ok "$prod_compose: gateway port mapping / PORT env consistent"
fi

key_count="$(grep -c 'ANWAY_ENCRYPTION_KEY' "$prod_compose")"
if [ "$key_count" -eq 0 ]; then
  bad "$prod_compose: ANWAY_ENCRYPTION_KEY not set on gateway service (crypto.ts:9-13 throws at first credential decrypt without it)"
else
  ok "$prod_compose: ANWAY_ENCRYPTION_KEY present ($key_count occurrence(s))"
fi

token_count="$(grep -c 'ANWAY_WEBHOOK_TOKEN' "$prod_compose")"
if [ "$token_count" -eq 0 ]; then
  bad "$prod_compose: ANWAY_WEBHOOK_TOKEN not set on gateway service (real alerts from Alertmanager will be dropped — 401)"
else
  ok "$prod_compose: ANWAY_WEBHOOK_TOKEN present ($token_count occurrence(s))"
fi

# Bonus finding: existing repo scripts have a syntax error (discovered while gathering facts for this script)
for f in scripts/smoke-test.sh scripts/certify.sh; do
  if bash -n "$f" 2>/tmp/prod-readiness-bashn.$$; then
    ok "$f: bash -n syntax check passed"
  else
    bad "$f: bash -n syntax error (dropped 'VAR=\"\${' prefix on the GATEWAY_URL line) -> $(cat /tmp/prod-readiness-bashn.$$)"
  fi
done

# =====================================================================
# AUTH — acquire an admin JWT for all subsequent authenticated checks
# =====================================================================
hdr "Auth bootstrap — POST $GW/api/auth/setup (fallback: /api/auth/login)"
TOKEN=""
code="$(http_code -X POST "$GW/api/auth/setup" -H 'Content-Type: application/json' -d "{\"email\":\"$CERT_EMAIL\",\"password\":\"$CERT_PASSWORD\"}")"
body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
if [ "$code" = "200" ]; then
  TOKEN="$(printf '%s' "$body" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)"
  ok "POST /api/auth/setup -> 200, admin user '$CERT_EMAIL' created, token acquired"
elif [ "$code" = "409" ]; then
  info "POST /api/auth/setup -> 409 (setup already complete) — falling back to /api/auth/login with the same cert credentials"
  code2="$(http_code -X POST "$GW/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$CERT_EMAIL\",\"password\":\"$CERT_PASSWORD\"}")"
  body2="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
  if [ "$code2" = "200" ]; then
    TOKEN="$(printf '%s' "$body2" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)"
    ok "POST /api/auth/login -> 200, token acquired for '$CERT_EMAIL'"
  else
    bad "POST /api/auth/login -> $code2, body: $body2 (setup already done by a DIFFERENT admin — set CERT_EMAIL/CERT_PASSWORD env vars to that admin's real credentials to run authenticated checks)"
  fi
else
  bad "POST /api/auth/setup -> $code, body: $body (unexpected — expected 200 or 409)"
fi

if [ -z "$TOKEN" ]; then
  skp "All checks requiring an authenticated admin session below will be SKIPPED — no token available"
fi
AUTH_HEADER="Authorization: Bearer $TOKEN"

# =====================================================================
# SECTION 1 — Agent harness (packages/agent/)
# =====================================================================
hdr "Section 1 — Agent harness: gate + perimeter + audit wiring in the chat tool loop"

n="$(grep -cE 'isWriteAction|pollGate|gateSink|auditSink' packages/agent/src/agents/connector-agent.ts)"
if [ "$n" -gt 0 ]; then
  ok "packages/agent/src/agents/connector-agent.ts: gate/audit wiring present ($n matches for isWriteAction|pollGate|gateSink|auditSink)"
else
  bad "packages/agent/src/agents/connector-agent.ts: ZERO matches for isWriteAction|pollGate|gateSink|auditSink — write tools execute with no L2 gate and no audit log in the production chat path (T1)"
fi

n="$(sed -n '22,34p' packages/agent/src/providers/registry.ts | grep -c cheapModel)"
if [ "$n" -gt 0 ]; then
  ok "packages/agent/src/providers/registry.ts (createProvider, openAICompatible branch): cheapModel propagated ($n matches)"
else
  bad "packages/agent/src/providers/registry.ts:22-34: cheapModel dropped when constructing OpenAIProvider for groq/mistral/deepseek/lmstudio — cheap-tier calls silently run on the expensive default model (T6)"
fi

n="$(grep -c 'resolveContextByName(' packages/agent/src/orchestrator.ts)"
if [ "$n" -eq 1 ]; then
  ok "packages/agent/src/orchestrator.ts: resolveContextByName( called exactly once (coordinate handoff bug fixed)"
else
  bad "packages/agent/src/orchestrator.ts: resolveContextByName( called $n times (expected 1) — the second call at ~line 395 re-resolves by UUID against a name-ILIKE query, corrupting SpecialistContext.coordinates for every connector agent (T5)"
fi

n="$(grep -rn 'createSpecialistAgent' apps packages --include='*.ts' 2>/dev/null | grep -v '\.test\.ts' | grep -v 'packages/agent/src/specialist-agent.ts' | grep -v 'packages/agent/src/index.ts' | wc -l | tr -d ' ')"
info "createSpecialistAgent production call sites (excluding its own file/barrel export/tests): $n (0 = dead code; the fully-gated loop in specialist-agent.ts has no production caller)"

# =====================================================================
# SECTION 2 — Knowledge Graph
# =====================================================================
hdr "Section 2 — Knowledge Graph: kb_entries population, embeddings, chat KB factory"

n="$(grep -rn 'INSERT INTO kb_entries' apps/gateway/src packages/agent/src --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$n" -gt 0 ]; then ok "kb_entries write path exists ($n INSERT site(s))"; else bad "ZERO code paths INSERT INTO kb_entries anywhere in the repo — L3 derived-knowledge / freshness / pgvector search is permanently inert (T9)"; fi

kb_count="$(pg 'SELECT COUNT(*) FROM kb_entries;' 2>/dev/null)"
if [ -n "$kb_count" ]; then
  if [ "$kb_count" -gt 0 ] 2>/dev/null; then ok "kb_entries row count (live DB): $kb_count"; else bad "kb_entries row count (live DB): $kb_count (expected >0 once T9 is implemented)"; fi
else
  skp "kb_entries row count — could not query (postgres unreachable)"
fi

n="$(grep -rl 'implements IEmbeddingProvider' packages/agent/src --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$n" -gt 0 ]; then ok "IEmbeddingProvider implementation(s) found: $n"; else bad "ZERO classes implement IEmbeddingProvider — pgvector semantic search always falls back to ILIKE (T9)"; fi

n="$(grep -c 'new StructuralGraph(' apps/gateway/src/routes/chat.ts)"
if [ "$n" -eq 0 ]; then
  ok "apps/gateway/src/routes/chat.ts: does not construct StructuralGraph directly (uses createKnowledgeGraph factory)"
else
  bad "apps/gateway/src/routes/chat.ts: constructs 'new StructuralGraph(' directly ($n occurrence(s), ~line 501) — bypasses createKnowledgeGraph, so HybridKnowledgeGraph/Graphiti episodic layer is never used even when AGENT_SERVICE_URL is set (T10)"
fi

# =====================================================================
# SECTION 3 — Connector bootstrap contract
# =====================================================================
hdr "Section 3 — Connector bootstrap contract: catalog vs bootstrap registry (computed live)"

node -e "
const fs = require('fs');
const catalogSrc = fs.readFileSync('apps/gateway/src/routes/connectors.ts','utf8');
const ids = [...catalogSrc.matchAll(/\{ id: \"([a-z0-9-]+)\"/g)].map(m=>m[1]);
const subSrc = fs.readFileSync('apps/gateway/src/graph-builder/subscriber.ts','utf8');
const registered = new Set([...subSrc.matchAll(/reg\.set\('([a-z0-9-]+)'/g)].map(m=>m[1]));
const missing = ids.filter(id => !registered.has(id));
console.log('CATALOG_COUNT=' + ids.length);
console.log('REGISTERED_COUNT=' + registered.size);
console.log('MISSING=' + JSON.stringify(missing));
process.exit(missing.length === 0 ? 0 : 1);
"
if [ $? -eq 0 ]; then
  ok "every CONNECTOR_CATALOG id has a bootstrap registration"
else
  bad "CONNECTOR_CATALOG ids with NO bootstrap registration in graph-builder/subscriber.ts buildBootstrapRegistry() — printed above (T14)"
fi

# =====================================================================
# SECTION 4 — Access control / perimeter enforcement (live)
# =====================================================================
hdr "Section 4 — Access control: perimeter on GET /api/gate/pending"

code="$(http_code "$GW/api/gate/pending")"
if [ "$code" = "401" ]; then ok "GET $GW/api/gate/pending (no Authorization header) -> 401"; else bad "GET $GW/api/gate/pending (no auth) -> $code (expected 401)"; fi

if [ -n "$TOKEN" ]; then
  code="$(http_code "$GW/api/gate/pending" -H "$AUTH_HEADER")"
  body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
  if [ "$code" = "200" ] && printf '%s' "$body" | grep -qE '^\['; then
    ok "GET $GW/api/gate/pending (with admin token) -> 200, JSON array"
  else
    bad "GET $GW/api/gate/pending (with admin token) -> $code, body: $body (expected 200 JSON array)"
  fi
else
  skp "GET /api/gate/pending authenticated check — no token"
fi

n="$(grep -c "'trigger_pipeline', 'approve_gate'" apps/gateway/src/routes/chat.ts)"
if [ "$n" -gt 0 ]; then
  ok "apps/gateway/src/routes/chat.ts: deploy tool names (trigger_pipeline/approve_gate) included in perimeter builtins allowlist"
else
  bad "apps/gateway/src/routes/chat.ts: deploy tool names NOT found in the perimeter builtins allowlist — trigger_pipeline/approve_gate are bare-named and hard-blocked by AgentPerimeter.allows() for every chat session (T8)"
fi

# =====================================================================
# SECTION 5 — V1 gating (write actions require confirm) — LIVE
# =====================================================================
hdr "Section 5 — V1 gating: K8s write endpoints (live, admin token bypasses perimeter, hits handler body)"

if [ -n "$TOKEN" ]; then
  code="$(http_code -X POST "$GW/api/k8s/pods/default/cert-check-pod/restart" -H "$AUTH_HEADER")"
  body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
  if [ "$code" = "501" ] && [ "$body" = '{"ok":false,"status":"not_implemented","message":"K8s write actions require connector wiring"}' ]; then
    bad "POST /api/k8s/pods/default/cert-check-pod/restart -> 501 not_implemented (k8s.ts:169) — write action has zero implementation"
  else
    ok "POST /api/k8s/pods/.../restart -> $code, body: $body (no longer 501 — verify this is a real gated execution, not just a different stub)"
  fi

  code="$(http_code -X POST "$GW/api/k8s/deployments/default/cert-check-deploy/scale" -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d '{"replicas":1}')"
  body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
  if [ "$code" = "501" ]; then
    bad "POST /api/k8s/deployments/.../scale -> 501 not_implemented (k8s.ts:200)"
  else
    ok "POST /api/k8s/deployments/.../scale -> $code, body: $body"
  fi

  code="$(http_code -X POST "$GW/api/k8s/nodes/cert-check-node/cordon" -H "$AUTH_HEADER")"
  body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
  if [ "$code" = "501" ]; then
    bad "POST /api/k8s/nodes/.../cordon -> 501 not_implemented (k8s.ts:228)"
  else
    ok "POST /api/k8s/nodes/.../cordon -> $code, body: $body"
  fi
else
  skp "K8s write endpoint live checks — no token"
fi

n="$(grep -c 'not_implemented' apps/gateway/src/routes/k8s.ts)"
info "static confirmation: grep -c not_implemented apps/gateway/src/routes/k8s.ts -> $n (expect 0 once T3 lands)"

n="$(grep -rn "subscribe('trigger_gate_required'" apps/gateway/src --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$n" -gt 0 ]; then
  ok "trigger_gate_required has a consumer ($n subscription site(s))"
else
  bad "NOTHING subscribes to the 'trigger_gate_required' Redis channel — every gated trigger action (notify_oncall, create_incident, notify_channel, escalate, run_runbook, block_deploy_gate) published by apps/gateway/src/triggers/executor.ts:33 is a permanent no-op (T2)"
fi

# =====================================================================
# SECTION 6 — Trigger engine + cron monitors
# =====================================================================
hdr "Section 6 — Trigger engine + cron monitors"

hdr "  live: alert webhook ingestion end-to-end (Alertmanager token -> incident row)"
ALERT_TITLE="CertCheckAlert-$(date +%s)"
code="$(http_code -X POST "$GW/api/events/alert" -H "Authorization: Bearer $WEBHOOK_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"alerts\":[{\"labels\":{\"alertname\":\"$ALERT_TITLE\",\"severity\":\"critical\",\"service\":\"cert-check-service\"},\"status\":\"firing\",\"annotations\":{\"summary\":\"prod-readiness-check synthetic alert\"}}]}")"
body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
if [ "$code" = "200" ] && [ "$body" = '{"ok":true}' ]; then
  ok "POST /api/events/alert (Bearer $WEBHOOK_TOKEN) -> 200 {\"ok\":true}"
else
  bad "POST /api/events/alert -> $code, body: $body (expected 200 {\"ok\":true} — webhook auth or ingestion broken)"
fi

if [ -n "$TOKEN" ]; then
  sleep 1
  code="$(http_code "$GW/api/incidents" -H "$AUTH_HEADER")"
  body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
  if [ "$code" = "200" ] && printf '%s' "$body" | grep -q "$ALERT_TITLE"; then
    ok "GET /api/incidents -> synthetic alert '$ALERT_TITLE' present (alert-to-incident pipeline confirmed live)"
  else
    bad "GET /api/incidents -> $code, synthetic alert '$ALERT_TITLE' NOT found in response (alert-to-incident pipeline broken)"
  fi
else
  skp "GET /api/incidents confirmation — no token"
fi

n="$(grep -n 'TBD' apps/gateway/src/jobs/cron-monitors.ts | wc -l | tr -d ' ')"
if [ "$n" -eq 0 ]; then
  ok "apps/gateway/src/jobs/cron-monitors.ts: no 'TBD' markers"
else
  bad "apps/gateway/src/jobs/cron-monitors.ts: $n 'TBD' marker(s) — CloudSecurityScan has no real implementation (line 81) (T13)"
fi

n="$(grep -rn 'setInterval(' apps/gateway/src packages/agent/src --include='*.ts' 2>/dev/null | grep -v '\.test\.ts' | wc -l | tr -d ' ')"
if [ "$n" -eq 0 ]; then ok "no setInterval( invocations in gateway/agent backend (BullMQ scheduler used, per CLAUDE.md)"; else bad "$n setInterval( invocation(s) found in backend — forbidden per CLAUDE.md"; fi

# =====================================================================
# SECTION 7 — Audit system
# =====================================================================
hdr "Section 7 — Audit system"

if [ -n "$TOKEN" ]; then
  code="$(http_code -X POST "$GW/api/gate" -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d '{"action":"cert_check_action","target":"cert-check-target"}')"
  body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
  if [ "$code" = "201" ]; then
    gate_id="$(printf '%s' "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
    ok "POST /api/gate -> 201, gate_id=$gate_id"
    conn_id="$(pg "SELECT connector_id FROM gate_events WHERE id='$gate_id';")"
    if [ "$conn_id" = "test" ]; then
      bad "gate_events.connector_id for the gate just created = 'test' (hardcoded sentinel, apps/gateway/src/gate/gate-decide-route.ts:186/192) — not the real action-derived connector id (T12)"
    else
      ok "gate_events.connector_id = '$conn_id' (not the hardcoded 'test' sentinel)"
    fi
  else
    bad "POST /api/gate -> $code, body: $body (expected 201)"
  fi
else
  skp "POST /api/gate live check — no token"
fi

n="$(grep -rn "'gate.decision'" apps/gateway/src --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$n" -gt 0 ]; then ok "gate decisions are audited as 'gate.decision' ($n site(s))"; else bad "no code path writes a 'gate.decision' audit_events row — manual and auto-approved gate decisions are invisible in the Audit view (T12)"; fi

n="$(grep -n 'as any' packages/agent/src/orchestrator.ts apps/gateway/src/routes/chat.ts 2>/dev/null | grep -ci eventtype)"
if [ "$n" -eq 0 ]; then ok "no 'eventType: ... as any' casts remaining"; else bad "$n 'eventType: ... as any' cast(s) remain (agent_finding/synthesis_complete/query_started missing from the AuditEvent union) (T12)"; fi

# =====================================================================
# SECTION 8 — Frontend
# =====================================================================
hdr "Section 8 — Frontend"

if [ -f apps/web/lib/mock.ts ]; then
  lc="$(wc -l < apps/web/lib/mock.ts | tr -d ' ')"
  importers="$(grep -rl "from ['\"].*lib/mock['\"]" apps/web/components apps/web/app --include='*.tsx' --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$importers" -eq 0 ]; then
    bad "apps/web/lib/mock.ts exists ($lc lines) with 0 importers — dead mock-data file, should be deleted (T18b)"
  else
    ok "apps/web/lib/mock.ts has $importers importer(s) — in active use"
  fi
else
  ok "apps/web/lib/mock.ts has been removed"
fi

n="$(grep -c 'config: \[\]' apps/gateway/src/routes/cloud.ts)"
if [ "$n" -eq 0 ]; then ok "GET /api/cloud/resources: config array is not hardcoded empty"; else bad "apps/gateway/src/routes/cloud.ts: 'config: []' hardcoded — Cloud view Config tab is permanently empty behind the stale PreviewBanner"; fi

code="$(http_code "$WEB/api/providers")"
body="$(cat /tmp/prod-readiness-body.$$ 2>/dev/null)"
if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"providers"' && printf '%s' "$body" | grep -q '"ollama"'; then
  ok "GET $WEB/api/providers -> 200, providers array present: $body"
else
  bad "GET $WEB/api/providers -> $code, body: $body (expected 200 with providers array incl. anthropic/openai/deepseek/groq/mistral/ollama/lmstudio)"
fi

# =====================================================================
# SECTION 9 — Design language / Tailwind compliance
# =====================================================================
hdr "Section 9 — Tailwind compliance (should be zero — CLAUDE.md forbids it)"

n="$(grep -rc 'className=' apps/web/components apps/web/app --include='*.tsx' 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')"
if [ "$n" -eq 0 ]; then ok "grep className= apps/web/components apps/web/app -> 0 matches"; else bad "$n className= matches found — Tailwind usage forbidden per CLAUDE.md"; fi

n="$(find apps/web -maxdepth 1 -iname 'tailwind.config.*' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$n" -eq 0 ]; then ok "no tailwind.config.* in apps/web"; else bad "tailwind.config.* found in apps/web"; fi

# =====================================================================
# SECTION 10 — Stub/mock/TODO scan
# =====================================================================
hdr "Section 10 — Stub/TODO/mockup scan (narrow pattern — excludes UI 'placeholder' text and legitimate test/e2e fixtures)"

hits="$(grep -rniE 'TODO|FIXME|XXX\b|not implemented|NotImplementedError|\bTBD\b|design mockup' \
  apps/gateway/src apps/web/components apps/web/lib packages/*/src connectors/*/src \
  --include='*.ts' --include='*.tsx' --include='*.py' 2>/dev/null | grep -v '\.test\.ts' | grep -v '/e2e/')"
n="$(printf '%s\n' "$hits" | grep -c .)"
if [ "$n" -eq 0 ]; then
  ok "0 stub/TODO/mockup markers in production paths"
else
  bad "$n stub/TODO/mockup marker(s) in production paths (T18):"
  printf '%s\n' "$hits" | sed 's/^/         /'
fi

# =====================================================================
# SECTION 11 — Test coverage (exact pnpm invocations that exist right now)
# =====================================================================
hdr "Section 11 — Unit test suites (pnpm --filter <name> test), RUN_UNIT_TESTS=$RUN_UNIT_TESTS"

VITEST_PACKAGES=(
  anway-web anway-gateway
  @anway/types @anway/mcp-adapter @anway/agent @anway/cli-adapter
  @anway/connector-vault @anway/connector-confluence @anway/connector-slack
  @anway/connector-newrelic @anway/connector-prometheus @anway/connector-jenkins
  @anway/connector-sonarqube @anway/connector-sentry @anway/connector-pagerduty
  @anway/connector-circleci @anway/connector-linear @anway/connector-grafana
  @anway/connector-notion @anway/connector-snyk @anway/connector-coralogix
  @anway/connector-jira @anway/connector-github @anway/connector-opsgenie
  @anway/connector-datadog @anway/connector-terraform @anway/connector-dynatrace
  @anway/connector-loki @anway/connector-vercel @anway/connector-elastic
  @anway/connector-k8s @anway/connector-argocd @anway/connector-launchdarkly
  @anway/connector-azure-monitor @anway/connector-aws-cloudwatch
  @anway/connector-aws-health @anway/connector-gke @anway/connector-eks
  @anway/connector-gcp-monitoring
)

# Live check — do not hardcode a static "known missing" list, it goes stale the moment a task adds the script.
for dir in connectors/*/; do
  pkg_json="${dir}package.json"
  [ -f "$pkg_json" ] || continue
  pkg_name="$(grep -o '"name": *"[^"]*"' "$pkg_json" | head -1 | sed 's/.*"name": *"\(.*\)"/\1/')"
  [ -n "$pkg_name" ] || continue
  if ! grep -q '"test":' "$pkg_json"; then
    bad "$pkg_name: package.json has NO \"test\" script at all (0 test coverage) — command 'pnpm --filter $pkg_name test' does not exist"
  fi
done

if [ "$RUN_UNIT_TESTS" = "1" ]; then
  for pkg in "${VITEST_PACKAGES[@]}"; do
    info "pnpm --filter $pkg test"
    if pnpm --filter "$pkg" test > /tmp/prod-readiness-test-$$.log 2>&1; then
      ok "$pkg: pnpm --filter $pkg test -> exit 0 ($(tail -n 5 /tmp/prod-readiness-test-$$.log | tr '\n' ' '))"
    else
      bad "$pkg: pnpm --filter $pkg test -> non-zero exit. Last 15 lines:"
      tail -n 15 /tmp/prod-readiness-test-$$.log | sed 's/^/         /'
    fi
    rm -f /tmp/prod-readiness-test-$$.log
  done
else
  skp "34 vitest package suites skipped (RUN_UNIT_TESTS=0). Full list of exact commands:"
  for pkg in "${VITEST_PACKAGES[@]}"; do echo "         pnpm --filter $pkg test"; done
fi

hdr "  agent-service (Python) — pytest is NOT declared as a dependency in pyproject.toml"
if python3 -c "import pytest" 2>/dev/null; then
  ( cd apps/agent-service && python3 -m pytest tests/ -v > /tmp/prod-readiness-pytest.log 2>&1 )
  if [ $? -eq 0 ]; then
    ok "apps/agent-service: python3 -m pytest tests/ -> exit 0 ($(tail -n 3 /tmp/prod-readiness-pytest.log | tr '\n' ' '))"
  else
    bad "apps/agent-service: python3 -m pytest tests/ -> non-zero exit. Last 15 lines:"
    tail -n 15 /tmp/prod-readiness-pytest.log | sed 's/^/         /'
  fi
  rm -f /tmp/prod-readiness-pytest.log
else
  skp "pytest not importable in this environment — install with: pip install pytest httpx ; then run: cd apps/agent-service && python3 -m pytest tests/ -v"
fi

hdr "  e2e (Playwright), RUN_E2E=$RUN_E2E — 49 spec files, e2e/99-certification.spec.ts has 160 top-level test() blocks"
if [ "$RUN_E2E" = "1" ]; then
  ( cd apps/web && npx playwright test e2e/99-certification.spec.ts --reporter=list > /tmp/prod-readiness-e2e.log 2>&1 )
  if [ $? -eq 0 ]; then
    ok "playwright e2e/99-certification.spec.ts -> exit 0 ($(tail -n 5 /tmp/prod-readiness-e2e.log | tr '\n' ' '))"
  else
    bad "playwright e2e/99-certification.spec.ts -> non-zero exit. Last 20 lines:"
    tail -n 20 /tmp/prod-readiness-e2e.log | sed 's/^/         /'
  fi
  rm -f /tmp/prod-readiness-e2e.log
else
  skp "e2e suite skipped (RUN_E2E=0 — needs Playwright browsers installed + web+gateway up + an LLM provider configured). Exact command: (cd apps/web && npx playwright test e2e/99-certification.spec.ts --reporter=list)"
  skp "full e2e regression command: (cd apps/web && npx playwright test --reporter=list)  # 49 spec files, 510 top-level test() blocks total"
fi

# =====================================================================
# SECTION 12 — Env/secrets discipline
# =====================================================================
hdr "Section 12 — Env/secrets discipline"

url_has_query="$(grep -c "'/api/settings/models?" apps/web/components/provider-config.tsx)"
uses_post="$(grep -c "method: 'POST'" apps/web/components/provider-config.tsx)"
if [ "$url_has_query" -eq 0 ] && [ "$uses_post" -gt 0 ]; then
  ok "provider-config.tsx: API key sent via POST body, not a GET querystring"
else
  bad "apps/web/components/provider-config.tsx: API key sent as a GET querystring param to /api/settings/models (browser history / request log exposure) (T16)"
fi

n="$(grep -rn 'localStorage.setItem' apps/web/components apps/web/app --include='*.tsx' 2>/dev/null | grep -iE 'apikey|api_key|secret' | wc -l | tr -d ' ')"
if [ "$n" -eq 0 ]; then ok "no localStorage.setItem calls persist API keys/secrets"; else bad "$n localStorage.setItem call(s) appear to persist a key/secret"; fi

code="$(http_code -X POST "$WEB/api/auth/dev-token")"
if [ "$code" = "404" ]; then ok "POST $WEB/api/auth/dev-token -> 404 (hard-disabled)"; else bad "POST $WEB/api/auth/dev-token -> $code (expected 404)"; fi

# =====================================================================
# SUMMARY
# =====================================================================
echo
echo "==================================================================="
printf ' RESULTS: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
echo "==================================================================="
if [ "$FAIL" -gt 0 ]; then
  echo
  echo " Failed checks:"
  for c in "${FAILED_CHECKS[@]}"; do echo "   - $c"; done
  echo
  echo " NOT CERTIFIED"
  rm -f /tmp/prod-readiness-body.$$ /tmp/prod-readiness-bashn.$$
  exit 1
fi
echo
echo " CERTIFIED"
rm -f /tmp/prod-readiness-body.$$ /tmp/prod-readiness-bashn.$$
exit 0
