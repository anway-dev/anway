# Anway

[![Status: Beta](https://img.shields.io/badge/status-beta-f59e0b.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-10b981.svg)](./CONTRIBUTING.md)
[![Website](https://img.shields.io/badge/site-anway.dev-10b981.svg)](https://www.anway.dev)

**The central nervous system of a software organisation.** _Beta — actively developed; APIs and schemas may change._

Connects GitHub, Datadog, Linear, K8s, Loki, Prometheus, Jira, ArgoCD, PagerDuty, Terraform, and any cloud provider into a single intelligence surface. Every person in the org — SRE, PM, BA, Dev — queries, acts, and governs the entire software lifecycle through one orchestrator.

> **Not a devtool. The connective tissue between Product, Eng and SRE.**
> Every connector added = more intelligence for the entire org. Ask once, see
> everything across every tool, act with confidence behind a governed write path.

**🌐 Live:** [www.anway.dev](https://www.anway.dev)  ·  **🎬 Demo:** watch the 90-second walkthrough below.

## Demo

https://github.com/anway-dev/anway/releases/download/v0.1.0-beta/anway-demo.mp4

> If the player above doesn't load, [**▶ watch the 90-second demo on anway.dev**](https://www.anway.dev) — or click the thumbnail:
>
> [![Watch the Anway demo](./assets/anway-demo-poster.png)](https://www.anway.dev)

A signal fires → ask once → agents trace the root cause across every tool → gated action, then a tour of services, pipelines, connectors and the audit trail.

---

## Repositories

Anway is split across repositories under the [`anway-dev`](https://github.com/anway-dev) org:

| Repo | What it is |
|------|-----------|
| **[anway-dev/anway](https://github.com/anway-dev/anway)** (this repo) | The platform — web UI, gateway, agent harness, agent-service, CLI, connectors, and infra. |
| **[anway-dev/anway-test-setup](https://github.com/anway-dev/anway-test-setup)** | Cloud / e2e test environment — Terraform, k8s manifests, runners, service defs. |

The product demo video and its capture harness live in this repo under
[`apps/web/demo/`](./apps/web/demo).

---

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Local Development](#local-development)
- [Demo Mode](#demo-mode)
- [Configuration Reference](#configuration-reference)
- [Running Tests](#running-tests)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
apps/
  web/           Next.js UI (port 3000)
  gateway/       Fastify BFF — auth, RBAC, audit, connector proxy (port 4000)
  agent-service/ Python FastAPI — LLM inference, episodic graph (port 8000)
  cli/           anway CLI

packages/
  agent/         Orchestrator harness, specialist agents, IModelProvider
  k8s/           Cluster client
  ui/            Shared components
  types/         Shared TypeScript types

infra/
  docker-compose.yml      Dev dependencies (Postgres, Redis, Neo4j)
  docker-compose.dev.yml  Extended dev stack (Prometheus, Grafana, OTEL)
  helm/anway/             Production Helm chart
  terraform/              AWS / GCP / Azure Terraform modules
```

**Storage:**

| Layer | Technology |
|-------|-----------|
| Primary DB | PostgreSQL 16 + pgvector + Apache AGE |
| Session memory | Redis (TTL = session lifetime) |
| Episodic graph | Neo4j 5 (via Graphiti library) |
| Job queue | BullMQ (Redis-backed) |
| SSE fan-out | Redis Pub/Sub |

---

## Prerequisites

| Dependency | Min version | Notes |
|-----------|-------------|-------|
| Node.js | 20 LTS | |
| pnpm | 9 | `npm i -g pnpm` |
| Docker + Compose | 24 | For local infra |
| Python | 3.11 | Only if running agent-service locally |

---

## Local Development

### 1. Clone and install

```bash
git clone <repo>
cd anway
pnpm install
```

### 2. Start infra

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts: Postgres (5432), Redis (6379), Neo4j (7474/7687).

Verify:

```bash
docker compose -f infra/docker-compose.yml ps
```

All services should show `healthy`.

### 3. Configure gateway

```bash
cp apps/gateway/.env.example apps/gateway/.env
```

The defaults work out of the box for local dev. The only value you may want to set immediately:

```env
# Pick any one LLM provider
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or leave both blank — runs Ollama locally if installed
```

If no LLM key is set, the chat endpoint returns `{ error: "No LLM provider configured", code: "NO_PROVIDER" }` with status 200 and the UI shows an inline prompt to configure one. No crash.

### 4. Migrate and seed

```bash
cd apps/gateway
pnpm prisma migrate deploy
pnpm prisma db seed          # populates demo tenant with 22 services, alerts, incidents, pipelines
cd ../..
```

The seed is idempotent — safe to re-run.

### 5. Start the app

Two terminals:

```bash
# Terminal 1 — gateway (http://localhost:4000)
cd apps/gateway && pnpm dev

# Terminal 2 — web UI (http://localhost:3000)
cd apps/web && pnpm dev
```

Open http://localhost:3000.

---

## Demo Mode

Demo mode provisions a single pre-seeded tenant and lets anyone log in without credentials. Intended for live demos and internal reviews — never enable in production.

### Enable

```env
# apps/gateway/.env
DEMO_MODE=true
```

### Use

```bash
curl -X POST http://localhost:4000/api/auth/demo
# → { "token": "<jwt>", "expiresIn": "24h" }
```

The web UI shows a **Try Demo** button on the login page when `DEMO_MODE=true`.

The demo tenant (ID `00000000-0000-0000-0000-000000000001`) is populated by the seed script with:

- 22 services across 3 environments (staging / preprod / prod)
- 5 namespaces
- 10+ alerts (mix of severities)
- 10+ incidents (mix of active / resolved)
- 10+ deploys
- 3 pipelines with stage runs and gate events

---

## Configuration Reference

### Gateway (`apps/gateway/.env`)

**Required for production:**

| Variable | Example | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://anway:pass@host:5432/anway` | Postgres connection |
| `JWT_SECRET` | 64 random chars | HS256 signing secret (dev only) |
| `JWT_PRIVATE_KEY` | RSA PEM | RS256 private key (production — use instead of JWT_SECRET) |
| `JWT_PUBLIC_KEY` | RSA PEM | RS256 public key |
| `REDIS_URL` | `redis://host:6379` | Redis connection |

**LLM provider (one required for chat):**

| Variable | Notes |
|----------|-------|
| `ANTHROPIC_API_KEY` | Claude — recommended |
| `OPENAI_API_KEY` | GPT-4o |
| `GROQ_API_KEY` | Groq (fast, cheap) |
| `MISTRAL_API_KEY` | Mistral |
| `OLLAMA_ENDPOINT` | Local Ollama — default `http://localhost:11434/v1` |
| `OPENAI_BASE_URL` + key | Any OpenAI-compatible endpoint |

**Optional services:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEMO_MODE` | `false` | Enable demo login endpoint |
| `SENTRY_DSN` | — | Error tracking |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Traces (OTEL collector) |
| `NEO4J_URI` | — | Episodic graph (agent-service) |
| `NEO4J_USER` / `NEO4J_PASSWORD` | — | Neo4j credentials |
| `OIDC_ISSUER_URL` | — | SSO via OIDC (Azure AD, Dex, Okta) |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | — | OIDC app credentials |
| `SLACK_SIGNING_SECRET` | — | ChatOps slash commands |
| `GITHUB_WEBHOOK_SECRET` | — | Webhook HMAC verification |
| `DD_WEBHOOK_SECRET` | — | Datadog webhook HMAC |
| `ANWAY_WEBHOOK_TOKEN` | — | Static bearer token for Alertmanager / CI |
| `ALLOW_DEV_TOKEN` | `false` | Accept `dev-token` header (e2e tests only) |

**Connector API keys:**

```env
# Format: name:tenantId,name2:tenantId2
CONNECTOR_API_KEYS=e2e-key:00000000-0000-0000-0000-000000000001
```

### Web (`apps/web/.env.local`)

```env
GATEWAY_URL=http://127.0.0.1:4000   # gateway base URL (server-side only)
```

All other config (LLM keys, connector tokens) lives in the gateway — never in the web app.

---

## Running Tests

### TypeScript type check

```bash
cd apps/gateway && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```

Both must return 0 errors before any merge.

### Unit tests

```bash
pnpm test              # run all workspace tests
cd apps/gateway && pnpm test   # gateway only
```

### E2E (Playwright)

Requires the full stack running (gateway + web + infra):

```bash
# Start infra + app first (see Local Development above)
# Then:
cd apps/web && pnpm exec playwright test

# Run a specific spec:
pnpm exec playwright test e2e/99-certification.spec.ts
```

The certification spec (`99-certification.spec.ts`) is the gate — it verifies all 37 acceptance criteria across every wave.

---

## Production Deployment

### Option A — Docker Compose (single host)

```bash
# Build images
docker build -t anway-gateway:latest apps/gateway
docker build -t anway-web:latest apps/web

# Configure
cp apps/gateway/.env.example apps/gateway/.env.prod
# Edit apps/gateway/.env.prod — set DATABASE_URL, REDIS_URL, JWT_PRIVATE_KEY, etc.

# Start
docker compose -f infra/docker-compose.yml \
               -f infra/prod/docker-compose.override.yml \
               up -d
```

### Option B — Kubernetes (Helm)

The Helm chart at `infra/helm/anway/` includes: gateway deployment, web deployment, HPA (2–10 pods, CPU 70%), PDB (minAvailable: 1), NetworkPolicy, Ingress (nginx), ServiceAccount with IRSA annotations.

```bash
# 1. Create namespace
kubectl create namespace anway

# 2. Create secrets
kubectl create secret generic anway-secrets \
  --namespace anway \
  --from-literal=database-url="postgresql://..." \
  --from-literal=redis-url="redis://..." \
  --from-literal=jwt-private-key="$(cat jwt.key)" \
  --from-literal=jwt-public-key="$(cat jwt.key.pub)"

# 3. Install chart
helm install anway infra/helm/anway \
  --namespace anway \
  --set gateway.image.tag=<version> \
  --set web.image.tag=<version> \
  --set ingress.host=anway.yourdomain.com

# 4. Run migrations (Job)
kubectl apply -f infra/k8s/migrate-job.yaml -n anway
```

### Option C — Terraform (AWS EKS)

```bash
cd infra/terraform/environments/aws

# Configure
cp terraform.tfvars.example terraform.tfvars
# Edit: aws_region, cluster_name, db_password, etc.

terraform init
terraform plan
terraform apply
```

This provisions: EKS cluster, RDS PostgreSQL (Multi-AZ in prod), ElastiCache Redis, ECR repositories, IAM roles (IRSA), S3 bucket for TF state. GCP (`environments/gcp`) and Azure (`environments/azure`) modules follow the same pattern.

### Post-deploy checklist

```
[ ] DATABASE_URL + REDIS_URL reachable from pods
[ ] JWT_PRIVATE_KEY + JWT_PUBLIC_KEY set (RS256, not HS256 secret)
[ ] DEMO_MODE absent or set to false
[ ] ALLOW_DEV_TOKEN absent (never set in prod)
[ ] Postgres migrations applied (prisma migrate deploy)
[ ] Seed run if using demo tenant
[ ] Health check responding: GET /health/live → 200, GET /health/ready → 200
[ ] SENTRY_DSN configured for error tracking
[ ] OTEL collector reachable if telemetry required
[ ] Connector API keys rotated from dev defaults
[ ] ANWAY_WEBHOOK_TOKEN set and matches alertmanager/CI config
[ ] RDS automated backups enabled (Terraform does this automatically)
```

### Health endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health/live` | Liveness — always returns 200 if process is up |
| `GET /health/ready` | Readiness — checks Postgres + Redis connectivity |

Configure Kubernetes probes to use `/health/ready`.

### RBAC roles

| Role | Capabilities |
|------|-------------|
| `admin` | All operations |
| `sre` | Approve gates, create incidents, trigger deploys |
| `dev` | Create pipelines, run stages on non-prod envs |
| `pm` / `ba` | Read only |

Roles are set at user provisioning time via the Access view or API.

### SSO (OIDC)

Anway supports any OIDC-compliant provider (Azure AD, Okta, Google Workspace, Keycloak, Dex).

```env
OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant>/v2.0
OIDC_CLIENT_ID=<app-id>
OIDC_CLIENT_SECRET=<secret>
OIDC_REDIRECT_URI=https://anway.yourdomain.com/auth/oidc/callback
OIDC_TENANT_ID=<anway-tenant-uuid>
```

For local testing, the demo compose stack includes Dex (`infra/demo/dex/`) as a mock OIDC provider.

---

## Troubleshooting

**Chat shows "No AI model configured"**
Set at least one LLM provider key in `apps/gateway/.env`. Restart the gateway.

**Seed fails with "relation does not exist"**
Migrations haven't run. Run `cd apps/gateway && pnpm prisma migrate deploy` first.

**`GET /health/ready` returns 503**
Either Postgres or Redis is unreachable. Check `DATABASE_URL` and `REDIS_URL`. Confirm infra containers are healthy: `docker compose ps`.

**TypeScript errors after pulling**
Run `pnpm install` at the repo root to pick up any new dependencies, then `npx tsc --noEmit` again.

**Playwright tests fail with "demo user not found"**
Re-run the seed: `cd apps/gateway && pnpm prisma db seed`.

**SSE streams drop under load**
Redis is required for SSE fan-out across multiple gateway pods. Ensure `REDIS_URL` is set. Single-pod deployments work without Redis but cannot fan-out.

---

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
setup, workflow and guidelines, and [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please report it privately — see
[`SECURITY.md`](./SECURITY.md). Do **not** open a public issue for anything
exploitable. Note the non-production defaults table there before deploying.

## License

[MIT](./LICENSE) © Anway.
