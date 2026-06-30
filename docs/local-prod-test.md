# Anway — Setup Guide

> Two paths: **Path A** runs Anway locally via docker-compose against a minikube demo cloud. **Path B** deploys Anway to a real Kubernetes cluster.

---

## Step 0 — Clone

```bash
git clone git@github.com:rgplvr/restol.git
cd restol
```

No `pnpm install` on the host — containers manage their own dependencies.

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

## A2 — Start Anway (docker-compose)

### A2a. Create gateway env file

Create `apps/gateway/.env` in the repo:

```bash
# JWT signing key
JWT_SECRET=local-dev-secret-change-me

# At-rest encryption key for connector credentials (64 hex chars)
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000001

# Alertmanager webhook — must match ANWAY_WEBHOOK_TOKEN in test-cloud-setup/.env.local
ANWAY_WEBHOOK_TOKEN=anway-demo-webhook-token
ANWAY_WEBHOOK_TENANT=00000000-0000-0000-0000-000000000001

# CD connector key (used by deploy_trigger events from GitHub Actions / CI)
CONNECTOR_API_KEYS=local-cd-key:00000000-0000-0000-0000-000000000001

# ── Auth ──────────────────────────────────────────────────────────────────────
# Local email/password login is ON by default.
# First visit shows a setup form — create your admin account there, no password seeded.
# DEMO_MODE=true       # enables one-click Try Demo button (no password needed)
# LOCAL_AUTH_DISABLED=true  # disables local login, forces SSO/OAuth only

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

> Do not set `KUBECONFIG` — Anway reads credentials from the K8s connector config after you register it.

### A2b. Start core services

From the repo root:

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres redis gateway web
```

First run pulls images, installs packages, and generates the Prisma client inside containers (~3–5 min). Watch progress:

```bash
docker compose -f infra/docker-compose.dev.yml logs -f gateway
# Wait for: Gateway listening at http://0.0.0.0:8510
```

> **Note:** If you see `@prisma/client did not initialize yet`, the container is still running `prisma generate`. Wait for the "Gateway listening" line — it appears after generate completes.

### A2c. Run migrations

```bash
docker compose -f infra/docker-compose.dev.yml exec gateway \
  sh -c "cd apps/gateway && pnpm prisma migrate deploy"
```

Seed demo data (optional — populates sample services, incidents, pipelines):

```bash
docker compose -f infra/docker-compose.dev.yml exec gateway \
  sh -c "cd apps/gateway && pnpm db:seed"
```

### A2d. Verify

```bash
curl -s http://localhost:8510/health | python3 -m json.tool
# { "status": "ok", "db": "ok" }
```

Open `http://localhost:8500` — Anway login page appears.

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
ANWAY_WEBHOOK_TOKEN=anway-demo-webhook-token
```

```bash
source .env.local
./scripts/local-k8s.sh
```
### or
```
source .env.local
./scripts/local-orbstack.sh
```

Takes 8–12 minutes. When done, verify:

```bash
kubectl get pods -n demo          # all 15: Running
kubectl get pods -n observability # kube-prometheus-stack-*, loki-*: Running
```

**Open four port-forwards** (one terminal tab each):

```bash
kubectl port-forward --address 0.0.0.0 svc/kube-prometheus-stack-grafana 3001:80 -n observability
kubectl port-forward --address 0.0.0.0 svc/prometheus-operated 9090:9090 -n observability
kubectl port-forward --address 0.0.0.0 svc/alertmanager-operated 9093:9093 -n observability
kubectl port-forward --address 0.0.0.0 svc/api-gateway 8080:3000 -n demo
```

> **`--address 0.0.0.0` is required.** The gateway runs inside Docker and reaches these services via `host.docker.internal`. Without this flag the port-forward only listens on the host loopback and the gateway container cannot reach it.
>
> **macOS firewall:** if you see a timeout when testing connectors, macOS may be blocking `kubectl` from accepting connections. Go to **System Settings → Privacy & Security → Firewall → Firewall Options** and allow `kubectl`.

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
Click **Try Demo** — signs a JWT for `admin@demo.anway.dev`, no password needed.

**Option 3 — SSO / OAuth:**
Appears automatically when `OIDC_ISSUER_URL`, `GOOGLE_CLIENT_ID`, or `GITHUB_CLIENT_ID` is set.

KB graph is empty. All counts zero. Correct.

---

## Accounts

| Service | URL | Credentials |
|---------|-----|-------------|
| Anway web | `http://localhost:8500` | Set on first login (see A4) |
| Anway gateway | `http://localhost:8510` | — |
| Grafana | `http://localhost:3001` (browser) · `http://host.docker.internal:3001` (connector URL) | admin / admin |
| Prometheus | `http://localhost:9090` (browser) · `http://host.docker.internal:9090` (connector URL) | — |
| Alertmanager | `http://localhost:9093` (browser) · `http://host.docker.internal:9093` (connector URL) | — |

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
| Endpoint URL | `http://host.docker.internal:9090` |

> The gateway runs inside Docker. Use `host.docker.internal` instead of `localhost` to reach port-forwarded services on your Mac. The port-forward must be started with `--address 0.0.0.0` (see A3).

Save → Bootstrap.

Verify — Service entities gain `connectorCoordinates.prometheus.job` metadata.

### A5c. Alertmanager Connector

Click **Alertmanager** → Configure.

| Field | Value |
|-------|-------|
| Endpoint URL | `http://host.docker.internal:9093` |
| Webhook Token | `anway-demo-webhook-token` |

Save. No bootstrap needed — receive-only.

Alertmanager in minikube sends alerts to `http://host.docker.internal:8510/api/events/alert`.

### A5d. Grafana Connector

Click **Grafana** → Configure.

| Field | Value |
|-------|-------|
| Grafana URL | `http://host.docker.internal:3001` |
| Grafana URL | `http://grafana:3000` |

Save → Bootstrap (discovers existing dashboards).

---

## A6 — Grafana Dashboards

Dashboards are provisioned automatically when the Grafana connector bootstrap completes. No manual step needed.

To re-provision (e.g. after new services are added): go to **Connectors** → Grafana card → **Provision dashboards**.

Open `http://localhost:3001` → Dashboards — 15 dashboards named `{service} — Service Overview`.

---

## A7 — Test Alert Webhook

Fire a test alert manually:

```bash
curl -X POST http://localhost:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": { "alertname": "HighErrorRate", "severity": "critical", "service": "order-service", "job": "demo-services" },
    "annotations": { "summary": "High error rate on order-service", "description": "Error rate 12%" },
    "startsAt": "2024-01-01T00:00:00Z"
  }]'
```

Verify in Anway:
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

All K8s-bootstrapped services appear. Select one — Anway loads the source tree.

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
# Stop Anway + infra
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
  sh -c "cd apps/gateway && pnpm prisma migrate deploy"
# optional: seed demo data
docker compose -f infra/docker-compose.dev.yml exec gateway \
  sh -c "cd apps/gateway && pnpm db:seed"
# Then follow A5 onwards — first visit prompts admin account creation
```

---

## Troubleshooting

**Local login: "invalid credentials" or setup form not appearing:**
Migrations haven't run. Run:
```bash
docker compose -f infra/docker-compose.dev.yml exec gateway \
  sh -c "cd apps/gateway && pnpm prisma migrate deploy"
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

**Prometheus / Grafana / Alertmanager connector: "TypeError: fetch failed" or timeout:**
The gateway runs inside Docker — `localhost` in connector URLs refers to the container, not your Mac. Use `host.docker.internal` instead (e.g. `http://host.docker.internal:9090`). Also ensure port-forwards are started with `--address 0.0.0.0` and macOS firewall allows `kubectl` to accept incoming connections.

**Alert not reaching Anway:**
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
kubectl create namespace anway

kubectl create secret generic anway-secrets \
  --from-literal=JWT_SECRET=<strong-random-64-chars> \
  --from-literal=ENCRYPTION_KEY=<64-char-hex> \
  --from-literal=DATABASE_URL=postgresql://user:pass@host:5432/anway \
  --from-literal=REDIS_URL=redis://host:6379 \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...   `# optional — AI features` \
  --from-literal=CONNECTOR_API_KEYS=<key>:<tenantId> \
  --from-literal=ANWAY_WEBHOOK_TOKEN=<random-token> \
  --from-literal=ANWAY_WEBHOOK_TENANT=<tenant-uuid> \
  -n anway
```

## B3 — Deploy via Helm

CI builds and pushes `anway-gateway` and `anway-web` images on every merge to `main`.

```bash
helm upgrade --install anway infra/helm/anway \
  --namespace anway \
  --set image.gateway=<registry>/anway-gateway:<tag> \
  --set image.web=<registry>/anway-web:<tag>
```

## B4 — Run Migrations + Seed

```bash
kubectl exec -n anway deploy/anway-gateway -- \
  sh -c "cd apps/gateway && pnpm prisma migrate deploy"

# optional: seed demo data
kubectl exec -n anway deploy/anway-gateway -- \
  sh -c "cd apps/gateway && pnpm db:seed"
```

## B5 — Alertmanager Webhook

In your Alertmanager config, add a receiver pointing to Anway:

```yaml
receivers:
  - name: anway
    webhook_configs:
      - url: https://<anway-host>/api/events/alert
        http_config:
          authorization:
            credentials: <ANWAY_WEBHOOK_TOKEN>
```

Then register the Alertmanager connector in Anway UI with that same token.
