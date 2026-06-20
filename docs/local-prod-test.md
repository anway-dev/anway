# Anvay — Setup Guide

> Two paths: **Path A** runs Anvay locally via docker-compose against a minikube demo cloud. **Path B** deploys Anvay to a real Kubernetes cluster.

---

## Step 0 — Clone

```bash
git clone git@github.com:rgplvr/restol.git
cd restol
```

No `pnpm install` on the host — containers manage their own dependencies.

---

---

# Path A — Local (docker-compose + minikube)

---

## A1 — Prerequisites

```bash
# Docker Desktop (includes docker + docker compose)
brew install --cask docker
# Open Docker Desktop, wait for engine to start

# Demo K8s cloud + tooling
brew install minikube kubectl helm
```

Verify:

```bash
docker info              # Engine running
docker compose version   # v2+
minikube version         # v1.32+
kubectl version          # v1.29+
helm version             # v3.14+
```

---

## A2 — Start Anvay (docker-compose)

### A2a. Create gateway env file

Create `apps/gateway/.env` in the repo:

```bash
# Demo mode — enables one-click login
DEMO_MODE=true

# JWT signing key
JWT_SECRET=local-dev-secret-change-me

# At-rest encryption key for connector credentials (64 hex chars)
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000001

# Alertmanager webhook — must match ANVAY_WEBHOOK_TOKEN in test-cloud-setup/.env.local
ANVAY_WEBHOOK_TOKEN=anvay-demo-webhook-token
ANVAY_WEBHOOK_TENANT=00000000-0000-0000-0000-000000000001

# CD connector key (used by deploy_trigger events from GitHub Actions / CI)
CONNECTOR_API_KEYS=local-cd-key:00000000-0000-0000-0000-000000000001

# ── Auth ──────────────────────────────────────────────────────────────────────
# Local email/password login (enabled by default)
# On first visit, Anvay prompts you to create an admin account — no seed password needed.
# Set to "true" to disable local login entirely (force SSO/OAuth only)
# LOCAL_AUTH_DISABLED=true

# ── LLM (optional — AI features disabled without this) ────────────────────────
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# OLLAMA_ENDPOINT=http://localhost:11434/v1

# OIDC / SSO (optional — leave unset to disable)
# OIDC_ISSUER_URL=https://accounts.google.com   # or your IdP
# OIDC_CLIENT_ID=<client-id>
# OIDC_CLIENT_SECRET=<client-secret>
# OIDC_REDIRECT_URI=http://localhost:8510/api/auth/oidc/callback

# Google OAuth (optional — leave unset to disable)
# GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
# GOOGLE_CLIENT_SECRET=<client-secret>

# GitHub OAuth (optional — leave unset to disable)
# GITHUB_CLIENT_ID=<client-id>
# GITHUB_CLIENT_SECRET=<client-secret>

# Web URL — gateway uses this to redirect back after OAuth
WEB_URL=http://localhost:8500
```

> Do not set `KUBECONFIG` — Anvay reads credentials from the K8s connector config after you register it.

### A2b. Start core services

From the repo root:

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres redis gateway web
```

First run pulls images and installs packages inside containers (~3 min). Watch progress:

```bash
docker compose -f infra/docker-compose.dev.yml logs -f gateway
# Wait for: Gateway listening at http://0.0.0.0:8510
```

### A2c. Run migrations + seed

```bash
docker compose -f infra/docker-compose.dev.yml exec gateway \
  pnpm --filter anvay-gateway prisma migrate deploy

docker compose -f infra/docker-compose.dev.yml exec gateway \
  pnpm --filter anvay-gateway db:seed
```

### A2d. Verify

```bash
curl -s http://localhost:8510/health | python3 -m json.tool
# { "status": "ok", "db": "ok" }
```

Open `http://localhost:8500` — Anvay login page appears.

---

## A3 — Start the Demo Cloud (minikube)

This brings up 15 demo services + full observability stack (Prometheus, Grafana, Alertmanager).

```bash
cd test-cloud-setup
cp .env.example .env.local
```

Edit `.env.local`:

```bash
JWT_SECRET=local-dev-secret-change-me
ANVAY_WEBHOOK_TOKEN=anvay-demo-webhook-token
```

```bash
source .env.local
./scripts/local-k8s.sh
```

Takes 8–12 minutes. When done, verify:

```bash
kubectl get pods -n demo          # all 15: Running
kubectl get pods -n observability # kube-prometheus-stack-*, loki-*: Running
```

**Open three port-forwards** (one terminal tab each):

```bash
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 -n observability
kubectl port-forward svc/kube-prometheus-stack-grafana 3001:80 -n observability
kubectl port-forward svc/kube-prometheus-stack-alertmanager 9093:9093 -n observability
```

Verify Prometheus scraping demo services:

```bash
curl -s 'http://localhost:9090/api/v1/targets?state=active' | \
  python3 -m json.tool | grep '"job"' | sort -u
# demo-services
```

---

## A4 — Log In

Open `http://localhost:8500`.

**Option 1 — Local login (default):**
First visit shows a setup form — enter your email + password to create the admin account.
Subsequent logins use that email + password.

**Option 2 — Demo Login (if `DEMO_MODE=true`):**
Click **Try Demo** — signs a JWT for `admin@demo.anvay.dev`, no password needed.

**Option 3 — SSO / OAuth:**
Appears automatically when `OIDC_ISSUER_URL`, `GOOGLE_CLIENT_ID`, or `GITHUB_CLIENT_ID` is set.

KB graph is empty. All counts zero. Correct.

---

## Accounts

| Service | URL | Credentials |
|---------|-----|-------------|
| Anvay web | `http://localhost:8500` | Demo Login |
| Anvay gateway | `http://localhost:8510` | — |
| Grafana (minikube) | `http://localhost:3001` | admin / admin |
| Prometheus | `http://localhost:9090` | — |
| Alertmanager | `http://localhost:9093` | — |

---

## A5 — Register Connectors

Go to **Connectors** in the left nav. Register in order.

### A5a. Kubernetes Connector

Click **Kubernetes** → Configure.

| Field | Value |
|-------|-------|
| API Server URL | _(blank)_ |
| Bearer Token | _(blank)_ |
| Namespace | `demo` |
| Kubeconfig | Paste: `cat ~/.kube/config` |

Save → Bootstrap. Wait ~30 sec.

Verify — **Knowledge** page shows 15+ Service nodes, 3 Namespace nodes.

### A5b. Prometheus Connector

Click **Prometheus** → Configure.

| Field | Value |
|-------|-------|
| Endpoint URL | `http://localhost:9090` |

Save → Bootstrap.

Verify — Service entities gain `connectorCoordinates.prometheus.job` metadata.

### A5c. Alertmanager Connector

Click **Alertmanager** → Configure.

| Field | Value |
|-------|-------|
| Endpoint URL | `http://localhost:9093` |
| Webhook Token | `anvay-demo-webhook-token` |

Save. No bootstrap needed — receive-only.

Alertmanager in minikube sends alerts to `http://host.docker.internal:8510/api/events/alert`.

### A5d. Grafana Connector

Click **Grafana** → Configure.

| Field | Value |
|-------|-------|
| Grafana URL | `http://localhost:3001` |

Save → Bootstrap (discovers existing dashboards).

---

## A6 — Provision Grafana Dashboards

Get your session token:
> Browser DevTools → Application → Cookies → `localhost:8500` → `token` value

```bash
TOKEN=<paste-token-here>

curl -s -X POST http://localhost:8510/api/connectors/grafana/provision-dashboards \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
# { "ok": true, "created": [...], "total": 15 }
```

Open `http://localhost:3001` → Dashboards — 15 dashboards named `{service} — Service Overview`.

---

## A7 — Test Alert Webhook

Fire a test alert manually:

```bash
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": { "alertname": "HighErrorRate", "severity": "critical", "service": "order-service", "job": "demo-services" },
    "annotations": { "summary": "High error rate on order-service", "description": "Error rate 12%" },
    "startsAt": "2024-01-01T00:00:00Z"
  }]'
```

Verify in Anvay:
- **Signals** page → alert appears
- **War Room** page → incident created, `order-service` linked

---

## A8 — Test Deploy Trigger

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
# { "ok": true, "pipelineId": "..." }
```

Go to **Pipelines** → gate appears → click **Approve** → deploy runs.

---

## A9 — Editor with Live Services

Go to **Editor** → **▾** (top right) → **⎈ Service** tab.

All K8s-bootstrapped services appear. Select one — Anvay loads the source tree.

**Add git credentials** — click **⬡** (git icon):
- Provider: GitHub
- Token: your PAT (`ghp_...`)
- Username: your GitHub username
- Save

---

## A10 — Verify Checklist

```
[ ] kubectl get pods -n demo        — 15/15 Running
[ ] kubectl get pods -n observability — all Running
[ ] http://localhost:9090 targets   — demo-services active
[ ] curl localhost:8510/health      — ok
[ ] K8s bootstrap                   — 15+ Services in KB
[ ] Prometheus bootstrap            — connectorCoordinates on entities
[ ] Alert webhook                   — incident in War Room
[ ] deploy_trigger                  — pipeline gate in Pipelines
[ ] Gate approve                    — deploy stage runs
[ ] Grafana provision               — 15 dashboards created
[ ] Editor service picker           — lists K8s services
[ ] Git credentials                 — saved
```

---

## Teardown

```bash
# Stop Anvay + infra
docker compose -f infra/docker-compose.dev.yml down

# Stop minikube
minikube stop     # pause (keeps state)
minikube delete   # full wipe
```

Wipe DB volumes:

```bash
docker compose -f infra/docker-compose.dev.yml down -v
```

**Restart clean:**

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres redis gateway web
docker compose -f infra/docker-compose.dev.yml exec gateway \
  pnpm --filter anvay-gateway prisma migrate deploy
docker compose -f infra/docker-compose.dev.yml exec gateway \
  pnpm --filter anvay-gateway db:seed
# Then follow A5 onwards
```

---

## Troubleshooting

**Local login: "invalid credentials" or setup form not appearing:**
Migrations haven't run. Run:
```bash
docker compose -f infra/docker-compose.dev.yml exec gateway \
  pnpm --filter anvay-gateway prisma migrate deploy
```
Then refresh — setup form appears on first visit when no admin exists.

**Demo Login missing / 404:**
`DEMO_MODE=true` missing from `apps/gateway/.env`. Add it and restart:
```bash
docker compose -f infra/docker-compose.dev.yml restart gateway
```

**Google/GitHub OAuth redirect error:**
`WEB_URL` must be set in `apps/gateway/.env` (e.g. `http://localhost:8500`).
Callback URIs to register in Google/GitHub console:
- Google: `http://localhost:8510/api/auth/google/callback`
- GitHub: `http://localhost:8510/api/auth/github/callback`

**Alert not reaching Anvay:**
`host.docker.internal` only resolves on Mac + Docker Desktop. On Linux use host IP from `ip route | grep default | awk '{print $3}'` in `test-cloud-setup/k8s/observability/prometheus/values-local.yaml`.

**K8s bootstrap fails:**
Kubeconfig certs change on every minikube restart. Re-paste `cat ~/.kube/config` into the K8s connector config.

**deploy_trigger returns 503:**
No LLM key set. Add `ANTHROPIC_API_KEY` to `apps/gateway/.env` and restart gateway.

**Grafana provision returns 404:**
Register Grafana connector first (A5d).

**Gateway won't start:**
Check logs: `docker compose -f infra/docker-compose.dev.yml logs gateway`
Most common: missing `JWT_SECRET` or `ENCRYPTION_KEY` in `apps/gateway/.env`.

---

---

# Path B — Kubernetes (staging / production)

---

## B1 — Prerequisites

```bash
brew install --cask docker
brew install kubectl helm
# Configure kubeconfig for your cluster (EKS/GKE/AKS)
```

## B2 — Configure Secrets

```bash
kubectl create namespace anvay

kubectl create secret generic anvay-secrets \
  --from-literal=JWT_SECRET=<strong-random-64-chars> \
  --from-literal=ENCRYPTION_KEY=<64-char-hex> \
  --from-literal=DATABASE_URL=postgresql://user:pass@host:5432/anvay \
  --from-literal=REDIS_URL=redis://host:6379 \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...   `# optional — AI features` \
  --from-literal=CONNECTOR_API_KEYS=<key>:<tenantId> \
  --from-literal=ANVAY_WEBHOOK_TOKEN=<random-token> \
  --from-literal=ANVAY_WEBHOOK_TENANT=<tenant-uuid> \
  -n anvay
```

## B3 — Deploy via Helm

CI builds and pushes `anvay-gateway` and `anvay-web` images on every merge to `main`.

```bash
helm upgrade --install anvay infra/helm/anvay \
  --namespace anvay \
  --set image.gateway=<registry>/anvay-gateway:<tag> \
  --set image.web=<registry>/anvay-web:<tag>
```

## B4 — Run Migrations + Seed

```bash
kubectl exec -n anvay deploy/anvay-gateway -- \
  pnpm --filter anvay-gateway prisma migrate deploy

kubectl exec -n anvay deploy/anvay-gateway -- \
  pnpm --filter anvay-gateway db:seed
```

## B5 — Alertmanager Webhook

In your Alertmanager config, add a receiver pointing to Anvay:

```yaml
receivers:
  - name: anvay
    webhook_configs:
      - url: https://<anvay-host>/api/events/alert
        http_config:
          authorization:
            credentials: <ANVAY_WEBHOOK_TOKEN>
```

Then register the Alertmanager connector in Anvay UI with that same token.
