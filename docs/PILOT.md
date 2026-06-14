# Anvay Pilot Guide

Welcome to the Anvay pilot. This guide walks you through setting up the demo stack, connecting your first datasource, and running your first chat query — in under 15 minutes.

## Prerequisites

- **Docker** 24+ with Docker Compose v2
- **Node.js** 20+ (LTS)
- **pnpm** 9 (`npm install -g pnpm@9`)
- At least 8GB RAM available for Docker

## Step 1 — Install

```bash
git clone https://github.com/anvay/restol.git
cd restol
cp apps/gateway/.env.example apps/gateway/.env
```

### Configure LLM Access

Open `apps/gateway/.env` and set your LLM provider. Choose one:

```bash
# Option A: Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Option B: OpenAI
OPENAI_API_KEY=sk-...

# Option C: Local Ollama (no API key, free)
OLLAMA_ENDPOINT=http://localhost:11434/v1
OLLAMA_DEFAULT_MODEL=llama3.2:3b
```

If using Ollama, start it first: `ollama pull llama3.2:3b`

## Step 2 — Start Demo Stack

```bash
./scripts/start_demo.sh
```

This starts all services: Postgres, Redis, gateway, web UI, Prometheus, Grafana, Alertmanager, Loki, Gitea, and demo microservices.

Wait ~60 seconds for all services to initialise. Monitor progress:

```bash
docker compose -f infra/demo/docker-compose.yml ps
```

### Verify Health

```bash
curl http://localhost:4000/health       # Gateway — {"status":"ok"}
curl http://localhost:3000              # Web UI — loads at http://localhost:3000
curl http://localhost:9090/-/healthy    # Prometheus
curl http://localhost:4000/auth/oidc/status   # OIDC — {"configured":false} (Dex not started)
```

## Step 3 — First Connector

Anvay auto-discovers connectors from your infrastructure. The demo comes with Prometheus pre-configured.

### Check existing connectors

1. Open http://localhost:3000 in your browser
2. Click **Connectors** in the sidebar
3. You'll see the seeded connectors (Prometheus, Loki, etc.)

### Register a new connector via Chat

1. Click **Chat** in the sidebar
2. Type: `Register a Prometheus connector at http://localhost:9090`
3. Anvay will register the connector and bootstrap it — extracting services, targets, and metrics

## Step 4 — First Chat Query

1. In the Chat view, type:
   ```
   What services are running and are they healthy?
   ```
2. Anvay queries the Knowledge Graph first, then targeted connector calls
3. Response includes grounded data with source citations
4. Stale data (older than freshness threshold) shows a re-sync warning

## Step 5 — Alert Flow

The demo includes a full alert pipeline:

1. **Prometheus alert fires** → Alertmanager → Anvay webhook
2. Anvay creates an incident, enriches context from graph + connectors
3. View in **Signals** tab (live alerts)
4. View in **War Room** tab (incident timeline + triage context)

### Trigger a demo alert

```bash
# Simulate an alert via webhook
curl -X POST http://localhost:4000/api/events/incident \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer anvay-demo-webhook-token" \
  -d '{"title": "High error rate on payments-api", "severity": "critical"}'
```

Then check **Signals** and **War Room** in the UI.

## Key Views

| View | What it shows |
|------|---------------|
| **Chat** | Orchestrator — single entry point for all queries |
| **Signals** | Live alerts from all connected datasources |
| **War Room** | Incident timeline, metrics, deploys, root cause |
| **Services** | Service catalog with dependency graph |
| **Workflows** | Autonomy dial (L1-L4), gate configuration |
| **Automations** | Event triggers, cron monitors, retention |
| **Knowledge** | KB explorer — entities, relationships, freshness |
| **Audit** | Immutable audit log — every action, every user |
| **Connectors** | Connector grid with health status |

## Troubleshooting

### Gateway won't start
```bash
docker compose -f infra/demo/docker-compose.yml logs gateway --tail=50
```
Common issues: missing `DATABASE_URL`, Postgres not healthy yet, port 4000 in use.

### Chat returns "No LLM provider configured"
Check `apps/gateway/.env` — ensure at least one LLM provider is configured and the env var is set.

### Connector shows "unhealthy"
Check the connector's endpoint is reachable from the gateway container:
```bash
docker compose -f infra/demo/docker-compose.yml exec gateway curl <connector-url>
```

### Migrations failed
```bash
docker compose -f infra/demo/docker-compose.yml exec gateway \
  sh -c "node_modules/.bin/prisma migrate deploy"
```

### Reset everything
```bash
docker compose -f infra/demo/docker-compose.yml down -v
./scripts/start_demo.sh
```

## Next Steps

1. Connect your real datasources (GitHub, Datadog, Linear, PagerDuty, ArgoCD)
2. Configure OIDC SSO via Dex or your corporate IdP
3. Set up automations — event triggers and cron monitors
4. Configure the autonomy dial per service (L1 → L4)
5. Invite your team and set up per-user perimeters

## Support

- Pilot issues: reply to your pilot coordinator
- Technical issues: `docs/BRIDGE.md` for Codex ↔ Claude communication
- Security: `docs/SECURITY.md` for security architecture and reporting
