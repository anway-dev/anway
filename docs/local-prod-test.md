# Local Prod-Like Test — End-to-End Lifecycle

> **Goal:** Bring up a real 15-service Kubernetes demo cloud, connect it to Anvay from scratch (no pre-seeded data), and verify every major flow: K8s bootstrap, Prometheus metrics, Alertmanager → incident, deploy gate approval, editor service picker, and Grafana dashboards.

---

## Prerequisites

Install on the host:

```bash
brew install minikube kubectl helm
# Docker Desktop must already be running
```

Verify:

```bash
minikube version    # v1.32+
kubectl version     # v1.29+
helm version        # v3.14+
docker info         # Engine running
```

Anvay repo:

```bash
cd /path/to/restol
pnpm install
```

---

## Accounts

| URL | Credentials |
|-----|-------------|
| Anvay web | `http://localhost:3000` |
| Grafana | `http://localhost:3001` — admin / admin |
| Prometheus | `http://localhost:9090` |
| Alertmanager | `http://localhost:9093` |

Anvay login: `admin@demo.anvay.dev` — any password (dev token mode).

---

## Phase 1 — Start the Demo Cloud (minikube)

This brings up all 15 demo services plus the full observability stack.

```bash
cd test-cloud-setup

# Create local env
cp .env.example .env.local
```

Edit `.env.local` — set exactly these two values:

```bash
JWT_SECRET=local-dev-secret-change-me
ANVAY_WEBHOOK_TOKEN=anvay-demo-webhook-token
```

```bash
source .env.local
./scripts/local-k8s.sh
```

This takes 8–12 minutes. When it finishes you will see a summary with the minikube IP and all 15 pods in `demo` namespace.

Verify:

```bash
kubectl get pods -n demo
# All 15 pods: Running
kubectl get pods -n observability
# kube-prometheus-stack-*, loki-*: Running
```

**Open four port-forwards** (keep each in its own terminal tab):

```bash
# Prometheus
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 -n observability

# Grafana
kubectl port-forward svc/kube-prometheus-stack-grafana 3001:80 -n observability

# Alertmanager
kubectl port-forward svc/kube-prometheus-stack-alertmanager 9093:9093 -n observability

# Demo API (optional — verifies services are live)
kubectl port-forward svc/api-gateway 8080:3000 -n demo
```

Verify Prometheus is scraping demo services:

```bash
curl -s 'http://localhost:9090/api/v1/targets?state=active' | \
  python3 -m json.tool | grep '"job"' | sort -u
# Should show: demo-services
```

---

## Phase 2 — Configure and Start Anvay

### 2a. Gateway env

`apps/gateway/.env` — add/confirm these lines:

```bash
# Webhook — Alertmanager sends alerts with this token
# Must match ANVAY_WEBHOOK_TOKEN in .env.local
ANVAY_WEBHOOK_TOKEN=anvay-demo-webhook-token
ANVAY_WEBHOOK_TENANT=00000000-0000-0000-0000-000000000001

# Connector API key for CD deploy_trigger events (format: key:tenantId)
CONNECTOR_API_KEYS=local-cd-key:00000000-0000-0000-0000-000000000001

# LLM — pick one
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# OLLAMA_ENDPOINT=http://localhost:11434/v1
```

> **Do not set KUBECONFIG** — Anvay reads it from the K8s connector config after you register it.

### 2b. Run migrations

```bash
cd apps/gateway
pnpm prisma migrate deploy
```

Expected last line: `All migrations have been successfully applied.`

### 2c. Start services

Open three terminal tabs:

**Tab 1 — Gateway:**

```bash
cd apps/gateway
pnpm dev
```

Wait for: `Gateway listening at http://0.0.0.0:8510`

**Tab 2 — Web:**

```bash
cd apps/web
pnpm dev
```

Wait for: `Ready — started server on http://localhost:3000`

**Tab 3 — Verify both up:**

```bash
curl -s http://localhost:8510/health | python3 -m json.tool
# { "status": "ok", "db": "ok", "redis": "ok" }
```

---

## Phase 3 — Log In

Open `http://localhost:3000`.

Login: `admin@demo.anvay.dev` — any password.

You land on the **Chat** view. The KB graph is empty. All counts are zero. That is correct.

---

## Phase 4 — Register Connectors

Go to **Connectors** (left nav). Register each connector in order.

---

### 4a. Kubernetes Connector

Click the **Kubernetes** card → Configure.

| Field | Value |
|-------|-------|
| API Server URL | _(leave blank)_ |
| Bearer Token | _(leave blank)_ |
| Namespace | `demo` |
| Kubeconfig (YAML content or file path) | Paste output of: `cat ~/.kube/config` |

Click **Save**.

Click **Bootstrap**.

**Verify** (wait ~30 sec):

```bash
curl -s http://localhost:8510/api/connectors/k8s/bootstrap-status \
  -H "Authorization: Bearer $(cat /tmp/anvay-token 2>/dev/null || echo DEV_TOKEN)" | python3 -m json.tool
# { "bootstrapped": true, "bootstrappedAt": "...", "summary": { "status": "success" } }
```

Go to **Knowledge** page → should see **Service** and **Namespace** entities populated — one Service node per pod app label across all namespaces, plus `demo`, `observability`, `kube-system` Namespace nodes.

Expected minimum: 15 Service nodes, 3 Namespace nodes.

---

### 4b. Prometheus Connector

Click **Prometheus** card → Configure.

| Field | Value |
|-------|-------|
| Endpoint URL | `http://localhost:9090` |
| Basic Auth User | _(leave blank)_ |
| Basic Auth Password | _(leave blank)_ |

Click **Save**.

Click **Bootstrap**.

**Verify** — KB now has additional Service entries and existing ones gain `connectorCoordinates.prometheus.job` metadata. Check in Knowledge → click any service entity → metadata panel shows:

```json
{
  "connectorCoordinates": {
    "k8s":        { "resourceIds": { "namespace": "demo", "selector": "app=api-gateway" } },
    "prometheus": { "resourceIds": { "job": "demo-services" } }
  }
}
```

---

### 4c. Alertmanager Connector

Click **Alertmanager** card → Configure.

| Field | Value |
|-------|-------|
| Endpoint URL | `http://localhost:9093` |
| Webhook Token | `anvay-demo-webhook-token` |

Click **Save**. No bootstrap needed — this is receive-only.

This registers the per-tenant webhook token in the DB. Alertmanager in minikube already sends alerts to `http://host.docker.internal:4000/api/events/alert` — Anvay now matches the bearer token against this connector config to identify the tenant.

---

### 4d. Grafana Connector

Click **Grafana** card → Configure.

| Field | Value |
|-------|-------|
| Grafana URL | `http://localhost:3001` |
| Service Account Token | _(leave blank — uses admin/admin basic auth for local dev)_ |
| Org ID | _(leave blank)_ |

Click **Save**.

Click **Bootstrap** — this discovers existing dashboards and registers them in the graph.

---

## Phase 5 — Provision Grafana Dashboards

After K8s + Prometheus are bootstrapped, create a service overview dashboard for every discovered service:

```bash
# Get session token from browser:
# DevTools → Application → Cookies → localhost:3000 → find "token" cookie value

TOKEN=<paste-token-here>

curl -s -X POST http://localhost:8510/api/connectors/grafana/provision-dashboards \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected:

```json
{
  "ok": true,
  "created": ["api-gateway", "auth-service", "cart-service", ...],
  "skipped": [],
  "total": 15
}
```

Open `http://localhost:3001` → Dashboards → you should see 15 dashboards named `{service} — Service Overview` with error rate, request rate, and P95 latency panels.

---

## Phase 6 — Test the Alert Webhook

The demo services have intentional chaos injection (random 500s, latency spikes). The `HighErrorRate` alert fires when error rate > 5% for 30 seconds.

**Wait for organic alert** (~3–5 min with traffic simulator running), **or fire manually:**

```bash
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "HighErrorRate",
      "severity": "critical",
      "service": "order-service",
      "job": "demo-services"
    },
    "annotations": {
      "summary": "High error rate on order-service",
      "description": "Error rate 12% (threshold 5%)"
    },
    "startsAt": "2024-01-01T00:00:00Z"
  }]'
```

Alertmanager routes this to `http://host.docker.internal:4000/api/events/alert` with `Bearer anvay-demo-webhook-token`.

**Verify in Anvay:**

- **Signals** page → new alert appears, severity critical
- **War Room** page → incident created, timeline shows the alert, `order-service` entity linked

---

## Phase 7 — Test the Deploy Trigger

This simulates a GitHub Actions workflow sending a CD event after a successful build.

```bash
curl -X POST http://localhost:8510/api/graph/events \
  -H "Content-Type: application/json" \
  -H "x-connector-key: local-cd-key" \
  -d '{
    "type": "deploy_trigger",
    "tenantId": "00000000-0000-0000-0000-000000000001",
    "service": "api-gateway",
    "sha": "abc1234defgh5678",
    "imageUri": "api-gateway:abc1234",
    "repo": "myorg/api-gateway",
    "environment": "prod",
    "triggeredBy": "raj@company.com",
    "commitMessage": "fix: reduce connection timeout"
  }'
```

Expected:

```json
{ "ok": true, "pipelineId": "<uuid>" }
```

Go to **Pipelines** page → should see:

```
Deploy api-gateway:abc1234 → prod
  [⊡ → Deploy] WAITING APPROVAL   [▶ Deploy] pending   [◎ Monitor] pending
```

Click **Approve** on the gate.

The deploy stage starts. If the K8s connector kubeconfig is correctly configured it runs:

```
→ helm upgrade --install ... --namespace demo
→ Running database migrations…
→ Deployed abc1234 to demo
```

If helm / kubeconfig has issues, it falls back to `[DEMO]` simulation mode showing what it would have run.

---

## Phase 8 — Editor with Live Services

Go to **Editor** → top-right **▾** button → click **⎈ Service** tab.

The dropdown should show all Service entities from the K8s bootstrap:

```
⎈ api-gateway         demo
⎈ auth-service        demo
⎈ cart-service        demo
...
```

Select a service → Anvay tries to load the source tree from `services/{name}/` or `apps/{name}/` relative to `EDITOR_ROOT` (defaults to repo root two levels up from gateway). If source files exist there, the file tree loads.

**Git credentials** — click **⬡** (git icon) in the left activity bar:

- Click **+ Add credentials**
- Provider: GitHub
- Token: paste your GitHub PAT (`ghp_...`)
- Username: your GitHub username
- Click **Save**

Stored encrypted in DB. Anvay uses this when pushing AI-generated code changes on your behalf.

---

## Phase 9 — Verify Full Graph

Go to **Knowledge** page → confirm:

| Entity type | Expected minimum |
|-------------|-----------------|
| Service | 15 (one per K8s pod app label) |
| Namespace | 3 (demo, observability, kube-system) |
| Incident | 1+ (from alert webhook) |
| Deploy | 1+ (from approved pipeline) |

Click any Service entity → one-hop graph shows:
- `HOSTED_IN` → Namespace
- Metadata includes both `k8s` and `prometheus` connector coordinates

---

## Verify Checklist

```
[ ] kubectl get pods -n demo        — 15/15 Running
[ ] kubectl get pods -n observability — prometheus, grafana, alertmanager Running
[ ] http://localhost:9090 targets   — demo-services job active
[ ] Anvay health: curl localhost:8510/health — db:ok, redis:ok
[ ] K8s bootstrap                   — 15+ Service entities in KB
[ ] Prometheus bootstrap            — entities gain prometheus connectorCoordinates
[ ] Alert webhook                   — incident appears in War Room
[ ] deploy_trigger                  — pipeline gate appears in Pipelines
[ ] Gate approve                    — deploy stage runs
[ ] Grafana provision               — 15 dashboards created
[ ] Editor service picker           — lists K8s services
[ ] Git credentials                 — saved in git tab
```

---

## Teardown

```bash
# Stop Anvay
# Ctrl-C the gateway and web terminals

# Stop minikube
minikube stop     # pause (keeps state)
minikube delete   # full wipe

# Stop Docker infra (Postgres + Redis)
docker compose -f infra/docker-compose.dev.yml down

# To wipe Anvay DB completely
docker compose -f infra/docker-compose.dev.yml down -v
```

To restart clean later:

```bash
# 1. Start infra
docker compose -f infra/docker-compose.dev.yml up -d db redis

# 2. Run migrations + seed
cd apps/gateway
pnpm prisma migrate deploy
pnpm prisma db seed

# 3. Remove seeded mock data (keep auth + environments)
PGPASSWORD=anvay_dev_secret psql -h 127.0.0.1 -U anvay -d anvay -c "
  SET session_replication_role = replica;
  TRUNCATE TABLE user_git_credentials, user_perimeters, token_usage_daily,
    pipeline_stage_runs, gate_events, gate_policies, pipelines, automation_runs,
    incidents, trigger_rules, cron_jobs, kb_episodes, kb_entries, artifacts,
    session_turns, entities, relationships, connector_config CASCADE;
  SET session_replication_role = DEFAULT;
"

# 4. Start Anvay
cd apps/gateway && pnpm dev &
cd apps/web && pnpm dev &

# 5. Follow Phase 4 onwards in this doc
```

---

## Troubleshooting

**Alert not reaching Anvay:**  
`host.docker.internal` only resolves on Mac with Docker Desktop. On Linux: replace with host IP (`ip route | grep default | awk '{print $3}'`) in `test-cloud-setup/k8s/observability/prometheus/values-local.yaml`.

**K8s bootstrap fails:**  
The kubeconfig in the connector config must contain the exact content from `~/.kube/config`. If minikube was restarted the certs change — re-register the connector with fresh `cat ~/.kube/config` output.

**deploy_trigger returns 503:**  
No LLM provider configured. Set `ANTHROPIC_API_KEY` or `OLLAMA_ENDPOINT` in `apps/gateway/.env` and restart the gateway.

**helm deploy falls back to [DEMO]:**  
The kubeconfig path in connector config is wrong or the cluster is unreachable. Check: `kubectl cluster-info` — should show the minikube API server URL. Re-paste `~/.kube/config` content into the K8s connector.

**Grafana provision returns 404:**  
Grafana connector not registered. Complete step 4d first.
