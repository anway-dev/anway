# Anvay — Product Requirements & Execution Plan

**Version:** 0.1 · **Status:** Pre-seed prototype → Production roadmap  
**Audience:** Engineering, founding team, contributors

---

## 1. What Anvay Is

Anvay is the **central nervous system of a software organisation**.

Every engineering team already runs GitHub, Datadog, Linear, Kubernetes, Loki, Prometheus, Jira, ArgoCD, PagerDuty, Terraform, Coralogix, and one or more cloud providers. None of these tools talk to each other with intelligence. Context is lost at every boundary. Incidents get triaged by cross-referencing six browser tabs. Feature status lives in someone's head. Deploy causation for outages requires a 30-minute investigation.

Anvay solves this by:
1. Connecting every tool as a typed, permissioned datasource (connector)
2. Building a live knowledge graph across all of them
3. Exposing a single intelligent surface — the orchestrator — where any person in the org can query, act, and govern the entire software lifecycle

**We are not a devtool. We are the connective tissue.**

```
Before:   Product ←——→ Eng ←——→ SRE    (siloed, context lost at every boundary)
After:    Product ←—— Anvay ——→ Eng ←—— Anvay ——→ SRE  (one nervous system)
```

Every connector added compounds the intelligence. The product has a network effect within the organisation — not across organisations.

---

## 2. Core Mental Model

```
User input
  → Orchestrator (single entry point, always)
    → classify intent
    → resolve effective role
    → resolve capability envelope (user ∩ connector perimeter)
    → resolveContext(primaryEntity) from Knowledge Graph   ← MANDATORY, NO EXCEPTIONS
    → inject graph context into specialist agent(s)
    → agents fill gaps with live L1 connector data only (not as primary source)
    → agents surface: context, root cause, recommended action
    → user confirms (V1: every write action is gated)
    → action executes
    → full audit log appended
  → response streamed to user
```

The user never picks an agent. Never sees routing logic. Never touches a connector directly. One surface.

**Non-negotiable: every investigation, triage, debug, and action starts from the Knowledge Graph.** The graph is not a cache — it is the primary source of org context. Connectors feed the graph. Agents query the graph. This order never reverses.

---

## 3. User Personas and Query Modes

| Role | Example query | Anvay behaviour |
|------|--------------|-----------------|
| **SRE / Oncall** | "Alert fired on payments-api — what's the trail?" | Traces root cause across metrics, deploys, logs, recent PRs |
| **PM** | "What's the status of the checkout feature?" | Queries lifecycle graph + Linear + GitHub + deploy state |
| **BA** | "How is the payments funnel performing this week?" | Pulls Datadog metrics + event data, surfaces analysis |
| **Dev** | "Why is TC-004 failing in CI?" | Multi-repo session, root cause, offers to write regression test |
| **EM** | "Who is oncall this week and what incidents are open?" | PagerDuty + incident store query |
| **Security** | "Any critical cloud findings unresolved for > 7 days?" | Cloud connector query across all providers |

**Role resolution (runtime):**
```
auth_role      = set at provisioning (base, always present)
inferred_role  = derived from query vocab + session signals + workspace context
effective_role = inferred_role ?? auth_role
```

Responses are tailored per effective role. Same query, different depth and framing per persona.

---

## 4. Feature Inventory

### 4.1 Orchestrator Chat

The primary surface. Every user interaction starts here.

**Capabilities:**
- Natural language query → multi-agent orchestration → streamed response
- Live execution trace visible to user (which agents ran, which connectors queried, confidence score)
- Role-aware response formatting (SRE sees metrics + runbook; PM sees status + timeline)
- Follow-up chaining: thread context carries across turns ("why broken?" → "now write the fix" — same session)
- Multi-repo context: dev queries span N repos, context maintained end-to-end
- Connector grounding: every claim in response cited with source + timestamp
- Confidence score on every response (0.0–1.0); low-confidence responses flagged explicitly
- Suggested follow-up actions post-response
- Execution trace log: timestamped, actor-tagged (ANVAY, PERIMETER, agent name, CONF, AUDIT)

**V1 contract:**  
Read from all connected sources. Surface context + recommended action. User confirms before any write executes.

---

### 4.2 Signals (Live Alerts)

Real-time alert surface aggregated across all monitoring connectors.

**Capabilities:**
- Alert feed: severity-sorted (critical → high → medium → low)
- Per-alert detail: service, fired time, metric value, triage status, oncall
- Triage status lifecycle: pending → auto-triaged → investigating → escalated → resolved
- "Debug with Anvay ✦" button → pre-filled orchestrator query with alert context
- L1 Assist mode: Anvay surfaces root cause context; human decides action
- Alert grouping by service and time window
- Deduplication across connectors (same incident surfaced from both Datadog and PagerDuty = one entry)

---

### 4.3 Incident War Room

Auto-assembled triage view when an incident is created (manually or via trigger).

**Capabilities:**
- Incident list: severity-filtered, active/investigating/resolved tabs
- Per-incident war room:
  - **Anvay hypothesis** — cross-source root cause analysis with confidence score
  - **Timeline strip** — time-ordered events: alert fired, deploy, metric spike, oncall ack, rollback
  - **Metrics panel** — 4 key metrics with sparklines, colored by severity
  - **Deploy panel** — last N deploys, culprit/suspect highlighted with red border
  - **PR panel** — related PRs, suspect PRs marked
  - **Runbook** — step-by-step remediation, collapsible
- "Investigate with Anvay ✦" → orchestrator pre-loaded with incident context
- Incident severity: critical / high / medium
- Incident status lifecycle: active → investigating → resolved

**Connector sources for auto-assembly:**
- Alert source: PagerDuty, Datadog, Opsgenie
- Metrics: Datadog, Prometheus, Grafana
- Deploys: ArgoCD, GitHub Actions
- Code: GitHub (PRs, commits)
- Logs: Loki, Datadog Logs, Coralogix

---

### 4.4 Service Catalog

Entity graph of every service in the organisation.

**Capabilities:**
- Service list: health-filtered (healthy / degraded / down)
- Per-service detail:
  - **Dependency graph** — visual: callers column → service → dependencies column, SVG connectors coloured by health
  - **Live metrics** — error rate, P99 latency, RPS, uptime
  - **Recent incidents** — linked to war room
  - **Deploy info** — current version, last deploy, repo, language
  - **Oncall** — who owns this service right now
- "Investigate ✦" → orchestrator with service context pre-loaded
- Service health propagation: degraded dependency → parent service flagged

**Data sources:** GitHub (repo), ArgoCD (version/deploy), Datadog/Prometheus (metrics), PagerDuty (oncall), internal KB graph

---

### 4.5 Signal Routing (L1 Assist)

Configurable triage policy for incoming alerts and signals.

**Modes:**
- **Bypass** — signals pass through unprocessed
- **Monitor** — Anvay watches and logs, no action
- **L1 Assist** — Anvay surfaces root cause context + recommended action to team; human decides

**Per-source configuration:**
- Mode selection
- Confidence threshold for escalation
- Business hours / after-hours routing
- Stats: volume, assisted count, escalated count, MTTR

**L1 Assist contract:**  
Anvay reads, triages, surfaces. Never resolves autonomously in V1. Human retains decision authority.

---

### 4.6 Feature Lifecycle (PRD → Metrics)

Horizontal stage flow covering the full development lifecycle of a feature.

**Stages:**
1. **PRD** — product requirements doc (Linear / Notion)
2. **Tech Spec** — engineering spec (Notion / GitHub)
3. **Test Cases** — test suite status (GitHub CI)
4. **API Collection** — request collection (Anvay collection format)
5. **Deploy** — deployment state (ArgoCD)
6. **Metrics** — live production metrics (Datadog)

**Per-stage:**
- Status indicator (approved / review / partial / running / pending / failed / live)
- Connector badge (Linear, Notion, GitHub CI, ArgoCD, Datadog)
- AI panel: Anvay analyses stage, surfaces findings, answers questions in context

**Agent chain for new features:**
```
Conversation → Product Agent writes PRD → [PM Approval Gate]
  → TechSpec Agent writes spec → [Team Gate]
  → Bootstrap Agent scaffolds service → Test Agent writes tests
  → [PR Gate] → Deploy Agent triggers pipeline
  → SRE Agent monitors post-deploy metrics
```

Gates: human-approvable, auto-approvable by policy, always audited.

---

### 4.7 Editor (One-Window Coding)

Code review and editing surface connected to the entire organisational context.

**Capabilities:**
- File explorer + code editor (mock: syntax highlighting, line numbers)
- **Findings panel** — AI-surfaced issues: severity, line reference, description
- **Gate panel** — approval status, required reviewers, auto-approve threshold, confidence score
- Context bar: connected to Linear + GitHub + Datadog + ArgoCD
- "Ask Anvay" button for any finding
- Configurable review policy per repo/service

---

### 4.8 Knowledge Base — Software Intelligence Graph

Company-wide typed knowledge graph. Every entity in the org (services, repos, teams, tickets, deploys, alerts) is a node. Connectors are the source of truth. The graph evolves continuously as connectors emit events.

**The core product value:** when an agent needs to answer anything about a service — ownership, recent changes, active incidents, related tickets — it queries the graph, not the connectors. Connectors feed the graph; the graph serves agents. This is what makes context resolution fast, grounded, and consistent across all agents.

**Knowledge layers:**

| Layer | What | TTL |
|-------|------|-----|
| L1 Live state | Pod health, metric values, CI status | 0 — always fresh from connector |
| L2 Recent events | Deploys, PRs, incidents, alerts | Connector-defined (1–5 min) |
| L3 Derived knowledge | Architecture maps, root cause summaries | Tagged to source events that invalidate it |
| L4 Org memory | Decisions, runbooks, team context, oncall history | Long — stamped + decay signal |

**Software Intelligence Graph — key traversals:**

| Question | Graph path |
|----------|-----------|
| "Who owns this service?" | Service → OWNED_BY → Team → ONCALL → Engineer |
| "Which repo is this ticket about?" | Ticket → RELATES_TO → Service → HOSTED_IN → Repo |
| "What changed before the alert?" | Alert → TRIGGERED_BY → Incident ← CAUSED_BY ← Deploy → INTRODUCED → Commit |
| "What services does this team own?" | Team ← OWNED_BY ← Service (reverse) |
| "What broke when we deployed?" | Deploy → DEPLOYED_TO → Service ← AFFECTS ← Incident |

**Connector bootstrap (mandatory):**  
Every connector registered in Anvay runs a bootstrap agent that crawls the connector and seeds the graph with entities and relationships. No connector ships without a bootstrap implementation. This is what makes existing codebase integration instant — connect GitHub → immediately know all repos, owners, and teams.

**Ever-evolving — event-driven updates:**  
Graph updates on every connector event. New PR merged → update repo node, create commit entity. PagerDuty oncall rotation → update Team→ONCALL→Engineer edge. Ticket created → extract service mention, create Ticket→RELATES_TO→Service edge. No manual curation required.

**Ticket → service resolution (hard problem, explicit strategy):**
1. Extract service name mentions from ticket text (cheap model)
2. Fuzzy match against known Service entity names
3. Fallback: ticket team label → Team→OWNS→Service lookup
4. Confidence < 0.7 → store with `unconfirmed: true`, flag for human confirmation
5. Human confirms/rejects → updates edge, trains future resolution

**Anti-hallucination contract:**  
Every claim grounded to a KB entry with `source`, `fetched_at`, `ttl`, `confidence`. Ungroundable claims: agent says "I don't have current data on X — last sync Y" — never infers. Confident fabrication is a hard failure.

**Staleness surfacing:**  
Response using knowledge below freshness threshold → UI flags: `"Based on data from 3h ago · re-sync recommended"`.

**KB view capabilities:**
- Browse entities by type (service, repo, team, engineer, ticket, incident)
- Relationship graph per entity (visual)
- Freshness indicators per entry
- Re-sync trigger per connector
- Bootstrap status per connector (seeded / pending / failed)

---

### 4.9 Workflows

Autonomy configuration and gate management per service/team.

**Capabilities:**
- **Autonomy dial** per workflow: L1 (assist only) → L2 (approve writes) → L3 (supervise) → L4 (autonomous)
- **Gate configuration**: approval count, named approvers, auto-approve threshold, timeout policy
- **Agent loop visualiser**: see agent chain for a workflow type, step by step
- Confidence threshold config: above X → auto-approve; below → gate to human
- Per-service / per-team overrides

**Autonomy levels:**
- L1 Assist — Anvay reads and suggests. Human does the action manually.
- L2 Approve — Anvay generates + shows gate. Human confirms. Anvay executes. (V1 default for all writes)
- L3 Supervise — Anvay executes, human can interrupt. Unlock per-service post-trust.
- L4 Autonomous — Anvay executes within policy bounds, async audit only. Explicit unlock, never default.

---

### 4.10 Automations

Event-driven triggers and scheduled monitors powered by the agent harness.

#### Event Triggers

Rules that fire specialist agents in response to connector events.

**Trigger schema:**
- Event type (alert_fired, deploy_failed, error_rate_threshold, slo_burn_rate, pr_merged, test_failed, incident_created, cloud_finding)
- Condition (threshold, scope, filter expression)
- Actions (ordered):
  - notify_oncall / notify_channel
  - create_incident
  - open_war_room
  - surface_context (inject into orchestrator)
  - escalate
  - run_runbook
  - block_deploy_gate

All write actions gated in V1. Trigger can auto-surface context without gating (read-only); write actions require confirm.

**Event pipeline:**
```
Connector emits event
  → EventBus classifies + routes
  → TriggerEngine matches active rules
  → Per matched rule: perimeter check → spawn agent → execute action set → audit
```

#### Cron Monitors

Scheduled agent runs for proactive intelligence without user prompt.

**Built-in monitor types:**
- `service_health_sweep` — every 5min, all prod services
- `cloud_security_scan` — every 15min, all cloud providers
- `slo_burn_check` — hourly
- `cost_anomaly_detection` — every 6h
- `deploy_health_report` — daily 08:00
- `oncall_morning_brief` — daily 09:00
- `incident_retrospective` — weekly Monday

**Cron pipeline:**
```
Scheduler fires job
  → Agent reads connectors (read-only, perimeter-scoped)
  → Evaluates thresholds/patterns
  → Anomaly found → emit event → write to KB → surface to Signals inbox
  → Run result → audit log
```

---

### 4.11 API Client

Built-in REST/GraphQL client for connector testing and collection management.

**Capabilities:**
- Collection browser (Anvay collection format)
- Request builder: method, URL, headers, body, auth
- Response viewer: status, body, headers, timing
- Environment variables
- Pre-request and post-response scripts (configurable)
- "Ask Anvay" on any response — contextual analysis

---

### 4.12 Connectors

Registry of all connected datasources and action targets.

**Connector model:**
- Mode: `read` | `write` | `read-write`
- Capability manifest: declared resources + scopes per mode
- Status: connected / auth_error / degraded / not_connected
- Category: Source Control, Monitoring, Project Tracking, CI/CD, Cloud Health, Communication, Incident Management

**Priority for connector implementation:**  
MCP server → CLI → official SDK → REST API

**V1 connector targets:**

| Connector | Mode | Category |
|-----------|------|----------|
| GitHub | read-write | Source Control |
| Linear | read-write | Project Tracking |
| Datadog | read-write | Monitoring |
| ArgoCD | read-write | CI/CD |
| PagerDuty | read-write | Incident Management |
| Kubernetes | read-write | Infrastructure |
| AWS (CloudWatch, Health, Cost) | read | Cloud Health |
| GCP (Cloud Monitoring, Logging) | read | Cloud Health |
| Azure (Monitor, Service Health) | read | Cloud Health |
| Slack | write | Communication |
| Notion | read-write | Documentation |
| Loki | read | Monitoring |
| Prometheus | read | Monitoring |

**Zero-code connector registration (MCP + CLI) — generic, agent-driven:**

There are no per-service connector packages. The two generic adapters (`McpConnector`, `CliConnector`) handle every service. Admins connect a service by registering its config — no code change required, ever.

**Core principle:** the adapters are the only connectors. Services are config, not code.

**MCP Adapter** — point at any MCP server URL → adapter calls `tools/list` at registration time, maps tools to `ExecutableTool[]`. Adding a new SaaS integration = one config entry, zero code.

**CLI Adapter** — point at any CLI binary → adapter runs `binary --help` to discover available subcommands and auto-populate the tool list. No static `allowedSubcommands` list required. The help text is the documentation. Admins can optionally provide a curated allowlist to restrict scope, but it is not required.

**CLI help-text discovery:**
```
CliConnector.discoverSubcommands()
  → runs: binary --help (and binary <subcommand> --help for nested commands)
  → parses subcommand names + descriptions from stdout
  → builds ExecutableTool[] with names, descriptions, and a generic args schema
  → stores discovered manifest in connectors table (human can review + restrict)
```

Both adapters produce the same `ExecutableTool[]` output. Perimeter, audit, gate, and capability manifest apply identically. Capability manifest is auto-derived — from MCP `tools/list` for MCP connectors, from `--help` parse for CLI connectors.

**Registration flows:**
```
MCP: { type: 'mcp', url: 'http://mcp.linear.app', name: 'linear', mode: 'read-write' }
  → McpConnector.getTools() → tools/list → ExecutableTool[]
  → manifest written to connectors table → available in orchestrator

CLI: { type: 'cli', binary: 'gh', name: 'github', mode: 'read-write' }
  → CliConnector.discoverSubcommands() → gh --help → ExecutableTool[]
  → manifest written to connectors table → available in orchestrator

CLI (curated): { type: 'cli', binary: 'kubectl', name: 'k8s', allowedSubcommands: ['get pods', 'get deployments'], mode: 'read' }
  → CliConnector.getTools() → ExecutableTool[] from explicit allowlist (skips discovery)
```

**Agent-driven registration:** the orchestrator exposes connector registration as tools. An admin can say "connect Linear's MCP server at http://mcp.linear.app" in chat — the agent calls `register_connector(type, config)`, the registry instantiates the adapter, tools become available in the next query. No deployment required.

**No per-service connector packages.** M2-T1/T2/T3/T4 (GitHub/Datadog/Linear/ArgoCD) are NOT separate packages. They are connector config entries registered against the generic adapters. The `connectors/` directory does not exist. The connector table in the DB is the source of truth.

This means: any org can self-serve connectors for any MCP-compliant service (Linear, Notion, Stripe, Figma, etc.) or any tool with a CLI (kubectl, aws, gcloud, argocd, pd) without waiting for Anvay to ship an integration.

---

### 4.13 Cloud Health

Multi-provider cloud infrastructure view.

**Capabilities (per connected provider):**
- Resource overview: compute, storage, database — health + key metrics
- Capacity tab: CPU/memory/connection/storage bars per resource
- Security tab: findings by severity (critical/high/medium/low), category (exposure/misconfiguration/vulnerability/compliance), expandable with remediation
- Config tab: configuration drift issues with debug steps
- "Debug ✦" on any critical resource → orchestrator with pre-loaded context

**Provider-agnostic design:** connector configuration at provisioning declares what the org has. No hardcoded AWS assumption.

---

### 4.14 Audit Log

Immutable, append-only record of every action in the system.

**Captured events:**
- Every query: user, timestamp, effective role, raw query text
- Every agent spawned + actions taken
- Every gate decision: approved by whom, auto or manual, confidence score
- Every connector read/write operation: resource, scope, result
- Every hard block (access denied): reason, rule matched
- Every trigger fired
- Every cron run result

Audit log feeds: org-level query analytics, bottleneck detection, usage patterns, compliance export.

---

### 4.15 Access Control

User provisioning and capability perimeter management.

**Provisioning model:**
```yaml
user: alice@acme.dev
role: dev
connectors:
  k8s-prod:
    read: ["*"]
    write: ["deployments/payments-api"]
  github:
    read: ["org/*"]
    write: ["org/payments-api", "org/payments-worker"]
  linear:
    read: ["team-payments/*"]
    write: []
```

**Runtime resolution:**
```
resolved_capabilities = user_perimeter ∩ connector_manifest
agent_action_set = filter(all_actions, resolved_capabilities)

every_agent_action:
  check(action ∈ agent_action_set) → proceed
  else → hard block + audit log
```

**Critical:** Perimeter evaluation is a deterministic rule engine. Not LLM judgment. Structurally blocked, not warned.

---

### 4.16 Model Configuration

LLM provider and model selection for the orchestrator and specialist agents.

**Capabilities:**
- Provider registry: Anthropic, OpenAI, Groq, Mistral, Ollama, LM Studio
- Per-agent model selection (orchestrator may use different model than specialist agents)
- API keys: server-side only, read from env. Never in client bundle, never in localStorage.
- Provider status: configured / not configured (from `/api/providers` endpoint, keys never exposed)
- Model capability flags: streaming, function calling, context window

---

## 5. Architecture

### 5.1 Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Web UI | Next.js 16, TypeScript, inline styles | App router, streaming SSE to browser |
| BFF Gateway | Fastify, TypeScript | Auth, perimeter enforcement, request routing, team sync |
| Agent Service | Python FastAPI | Heavy LLM inference, embedding, long-running jobs |
| Agent Harness | `@anvay/agent`, TypeScript, Anthropic SDK | Orchestrator core, specialist agents, perimeter middleware |
| Background Jobs | Trigger.dev (OSS, self-hosted) · BullMQ fallback | Event triggers, cron monitors, durable scheduling |
| Database | PostgreSQL + pgvector | Entities, KB, audit log, relationships, semantic retrieval |
| Cache | Redis | Session memory, hot KB entries, TTL-based eviction |
| Event Bus | Internal (phase 1) → Kafka (when volume demands) | Connector events, trigger routing |
| CLI | `anvay` CLI, TypeScript | Developer-facing, collection runner, local agent |
| Collection Runner / FSM | Go | High-throughput collection runner, workflow FSM, connector agents where TS throughput is a bottleneck |

### 5.2 Monorepo Layout

```
anvay/
├── apps/
│   ├── web/              # Next.js 16 UI — app shell, views, streaming chat
│   ├── gateway/          # Fastify BFF — auth, JWT, perimeter, proxy
│   ├── agent-service/    # Python FastAPI — LLM inference, embedding, async jobs
│   └── cli/              # `anvay` CLI — collection runner, local dev
│
├── packages/
│   ├── agent/            # @anvay/agent — orchestrator harness, specialist agents
│   ├── collection/       # @anvay/collection — collection format + runner
│   ├── repo/             # @anvay/repo — codebase analysis, AST parsing
│   ├── k8s/              # @anvay/k8s — cluster client
│   ├── ui/               # @anvay/ui — shared React components
│   └── types/            # @anvay/types — shared TypeScript types, DTOs
│
├── connectors/           # one package per connector
│   ├── github/           # @anvay/connector-github
│   ├── datadog/          # @anvay/connector-datadog
│   ├── linear/           # @anvay/connector-linear
│   ├── argocd/           # @anvay/connector-argocd
│   ├── pagerduty/        # @anvay/connector-pagerduty
│   ├── k8s/              # @anvay/connector-k8s
│   ├── aws/              # @anvay/connector-aws
│   ├── gcp/              # @anvay/connector-gcp
│   └── azure/            # @anvay/connector-azure
│
├── infra/
│   ├── docker/           # Dockerfiles per service
│   ├── compose/
│   │   ├── docker-compose.yml        # dev stack
│   │   └── docker-compose.demo.yml   # demo stack (seeded data + real LLM)
│   ├── helm/             # Kubernetes helm charts
│   └── terraform/        # cloud infra as code
│
├── docs/
│   ├── PRODUCT.md        # this document
│   ├── ARCHITECTURE.md
│   ├── CONTRIBUTING.md
│   └── connectors/       # per-connector docs
│
├── CLAUDE.md             # agent context
├── turbo.json
└── pnpm-workspace.yaml
```

### 5.3 Service Communication

```
Browser → [HTTPS] → Gateway (Fastify)
                      ├── /api/chat → SSE stream → @anvay/agent orchestrator
                      ├── /api/connectors → connector registry
                      ├── /api/auth → JWT issue/refresh
                      └── /api/* → proxied to agent-service or direct DB

Agent harness (@anvay/agent)
  → direct Anthropic SDK (streaming)
  → connector calls (CLI subprocess / MCP tool call / SDK)
  → perimeter check middleware (before every tool result returns to LLM)
  → audit sink (every event)

Background jobs (Trigger.dev)
  → scheduled cron runs
  → event trigger processing
  → KB sync jobs
  → connector health checks
```

### 5.4 Agent Harness Design

**Non-negotiable: model-agnostic. No vendor lock-in.**

The harness must not be coupled to any single LLM provider. Users bring their own model — Anthropic, OpenAI, Groq, Mistral, Ollama, LM Studio, or any OpenAI-compatible endpoint. Swapping the provider requires only a config change, never a code change.

Every provider is an implementation of a typed interface:

```typescript
// packages/agent/src/interfaces/model.ts

interface IModelProvider {
  chat(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): Promise<ChatResponse>
  stream(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): AsyncIterator<StreamChunk>
}

interface IEmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}

// Provider implementations in packages/agent/src/providers/
// AnthropicProvider, OpenAIProvider, GroqProvider, MistralProvider, OllamaProvider
// Orchestrator and agents call IModelProvider — never a provider SDK directly
```

**Harness decision — Mastra with wrappers (locked)**

Evaluated against all six requirements. Mastra satisfies all without workarounds.

| Requirement | Mastra verdict |
|-------------|---------------|
| **Model-agnostic** | ✓ Native multi-provider (Anthropic, OpenAI, Groq, Mistral, Ollama, any OpenAI-compatible) |
| **Deterministic perimeter** | ✓ `onToolCall` lifecycle hook — perimeter check runs before result returns to LLM |
| **Full audit hook — no bypass** | ✓ Same hook wires audit sink; no path around it |
| **Human-in-loop gate at any step** | ✓ `waitForInput` / suspend-resume primitives, gate insertable anywhere |
| **Streaming passthrough without buffering** | ✓ Native streaming, SSE-compatible |
| **Multi-agent typed context handoff** | ✓ Typed agent-to-agent handoff, shared context object |

**Wrapper layer built in `packages/agent` on top of Mastra:**

Two thin wrappers — neither optional:

1. **Perimeter middleware** — `onToolCall` hook. Every tool call passes `perimeterCheck(call, userPerimeter)`. Hard block if outside scope. Audit-logged regardless of outcome.
2. **Token metering middleware** — `onModelCall` hook. Every call checked against `TokenBudget`. Hard block if per-query, per-session, or per-tenant limit exceeded before reaching the LLM.

```typescript
// packages/agent/src/middleware/perimeter.ts
export function createPerimeterMiddleware(perimeter: AgentPerimeter) {
  return async (call: ToolCall): Promise<ToolCall | HardBlock> => {
    if (!perimeter.allows(call)) return hardBlock(call, perimeter)
    auditSink.append({ type: "tool_call", call, allowed: true })
    return call
  }
}

// packages/agent/src/middleware/token-meter.ts
export function createTokenMeterMiddleware(budget: TokenBudget) {
  return async (req: ModelCallRequest): Promise<ModelCallRequest | HardBlock> => {
    if (!budget.canSpend(req.estimatedTokens)) return hardBlock("token_limit_exceeded")
    return req
  }
}
```

**The harness itself remains replaceable.** Mastra is the first concrete implementation behind the `IModelProvider` interface. If Mastra changes license, drops a required feature, or fails a future requirement — swap it. The wrappers are framework-agnostic.

```typescript
// packages/agent public surface — all accept IModelProvider, never Mastra types directly
createOrchestrator({ model: IModelProvider, tools, perimeter, auditSink }): Orchestrator
createSpecialistAgent({ name, model: IModelProvider, tools, systemPrompt }): SpecialistAgent
createGate({ condition, approvers, autoApproveThreshold }): Gate
runSession(orch: Orchestrator, input: string, ctx: SessionContext): AsyncIterator<StreamEvent>
```

### 5.5 Graph Builder Agent

Dedicated agent that owns the Knowledge Graph. Not user-facing. Never called on-demand. Runs exclusively on connector lifecycle events via Trigger.dev.

**Trigger contract:**

| Event | Action |
|-------|--------|
| `connector_registered` | Full bootstrap — crawl connector, extract all entities + relationships |
| `connector_reconnected` | Re-bootstrap — diff against existing graph, update changes |
| `project_created` | Seed Project entity, link to Team |
| `repo_created` | Seed Repo, parse CODEOWNERS → Team, extract language |
| `namespace_created` | Seed Namespace, scan services inside → relationships |
| `resource_added` (cloud) | Extract tags → resolve owning Service + Team |
| `team_changed` / `oncall_rotation` | Update Team→ONCALL→Engineer edge |
| `service_deployed` | Create Deploy entity, Deploy→DEPLOYED_TO→Service |
| `pr_merged` | Create Commit entity, parse "fixes #N" → Commit→FIXES→Ticket |
| `ticket_created` | Create Ticket, run service resolution (LLM + fuzzy match) |
| `incident_created` | Create Incident, link to triggering Alert |

**Model used:** cheap tier only (Haiku / gpt-4o-mini). All inputs are structured events — no expensive model justified.

**Output:** updated StructuralGraph + Graphiti episodes + `graph:updated` event emitted so downstream caches invalidate.

**This is why connector bootstrap is non-negotiable.** Without Graph Builder running on `connector_registered`, the graph is empty, `connectorCoordinates` is empty, and every agent scatter-gathers. Graph Builder is what makes targeted connector calls possible.

---

## 6. Code Standards

These apply to every package in the monorepo without exception.

### 6.1 Architecture Pattern

**Interface → Controller → Service → Repository → DTO**

```
Controller     receives HTTP request, validates input DTO, calls service
Service        business logic, orchestrates repositories, emits domain events
Repository     data access only, no business logic, returns domain entities
DTO            typed input/output contracts at every boundary
Interface      everything depends on an interface, not a concrete class
```

Every external dependency is injectable. No hardcoded clients in business logic. This enables: unit testing with mocks, swapping implementations (e.g. Redis → Memcached), multi-tenant config injection.

**This applies to every infrastructure concern — without exception:**

| Concern | Interface | First implementation | Swap path |
|---------|-----------|---------------------|-----------|
| LLM provider | `IModelProvider` | `AnthropicProvider` | Any: OpenAI, Groq, Mistral, Ollama |
| Embedding | `IEmbeddingProvider` | `OpenAIEmbedding` | Any compatible provider |
| Session memory | `ISessionMemory` | `RedisSessionMemory` | Any K/V store |
| Knowledge graph | `IKnowledgeGraph` | `GraphitiKnowledgeGraph` (AGE backend) | KùzuDB, Neo4j, bespoke |
| Connector | `IConnector` | per-connector impl | Any new connector |
| Audit sink | `IAuditSink` | `PostgresAuditSink` | Any durable store |
| Scheduler | `IScheduler` | `TriggerDevScheduler` | BullMQ, pg-boss |
| Cache | `ICache` | `RedisCache` | Any cache backend |

Swap = change DI config. Zero agent or business logic changes.

### 6.2 Dependency Injection

TypeScript packages use constructor injection. No global singletons except logger and config.

```typescript
// Bad
class IncidentService {
  private db = new PrismaClient()  // hardcoded, untestable
}

// Good
class IncidentService {
  constructor(
    private readonly repo: IIncidentRepository,
    private readonly notifier: INotificationService,
    private readonly audit: IAuditSink
  ) {}
}
```

Python packages use FastAPI dependency injection (`Depends`). No module-level clients.

### 6.3 Observability

**Three pillars required for every service: logs, metrics, traces.**

**Logging:**
- Structured JSON logs via `pino` (TypeScript) / `structlog` (Python)
- Every log entry: `timestamp`, `level`, `service`, `trace_id`, `span_id`, `tenant_id`, `user_id` (when applicable)
- Log levels: ERROR (actionable failures), WARN (degraded state), INFO (key lifecycle events), DEBUG (verbose, off in prod)
- No `console.log`. No print statements. Ever.

```typescript
// Every service bootstraps with:
const logger = createLogger({
  service: "gateway",
  version: process.env.APP_VERSION,
  env: process.env.NODE_ENV,
})

// Log call with context:
logger.info({ traceId, tenantId, action: "connector.read" }, "GitHub connector query")
```

**Metrics:**
- OpenTelemetry SDK in every service
- Export to OTEL collector (Prometheus scrape or push)
- Required instrumentation: HTTP request duration + status, DB query duration, cache hit/miss, LLM token usage + latency, connector call duration + status, agent run duration + confidence score

**Tracing:**
- Distributed trace context propagated via `traceparent` header across all service boundaries
- Every agent run = one trace, every tool call = one span
- Trace ID injected into all logs

**Health endpoints:**
- `GET /health/live` — liveness (service is running)
- `GET /health/ready` — readiness (dependencies connected, accepting traffic)
- `GET /health/startup` — startup (initialisation complete)

### 6.4 Error Handling

```typescript
// Domain errors are typed, never strings
class ConnectorAuthError extends AnvayError {
  readonly code = "CONNECTOR_AUTH_FAILED"
  constructor(readonly connectorId: string, cause?: Error) {
    super(`Connector ${connectorId} auth failed`, { cause })
  }
}

// Result type for operations that can fail without throwing
type Result<T, E extends AnvayError = AnvayError> =
  | { ok: true;  value: T }
  | { ok: false; error: E }
```

Never swallow errors silently. Never throw raw `new Error("something went wrong")` — type your errors.

### 6.5 Multi-Tenancy

Every database query scoped to `tenant_id`. No cross-tenant data leakage possible at the query layer.

```sql
-- Every user-data table has tenant_id
CREATE TABLE incidents (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  -- ...
);

-- Row-level security enforced in Postgres
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON incidents
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

Tenant context injected at request boundary (gateway reads JWT → sets `tenant_id` on request context → passed through to every DB call).

### 6.6 Testing

**Every package ships with tests. No untested code merged.**

Test pyramid per service:
```
Unit tests       (>70% coverage target) — pure functions, service logic with mocked deps
Integration tests — service + real DB (Postgres in Docker), real Redis
E2E tests        — full user flow via HTTP, seeded data, agent responses stubbed
```

Test tooling:
- TypeScript: `vitest` (unit + integration), `playwright` (E2E web)
- Python: `pytest` + `pytest-asyncio`, `httpx` for FastAPI

Connector tests: always hit a real sandbox or mock server. Never mock the connector itself — that's how mock/prod divergence hides bugs.

```typescript
// Integration test pattern
describe("IncidentService.create", () => {
  let db: TestDatabase  // real Postgres in Docker

  beforeAll(() => db = await TestDatabase.start())
  afterAll(() => db.stop())

  it("creates incident and emits audit event", async () => {
    const auditSink = new InMemoryAuditSink()
    const svc = new IncidentService(
      new PostgresIncidentRepo(db.client),
      new NoopNotifier(),
      auditSink,
    )
    const incident = await svc.create({ ... })
    expect(incident.id).toBeDefined()
    expect(auditSink.events).toHaveLength(1)
    expect(auditSink.events[0].type).toBe("incident.created")
  })
})
```

### 6.7 Comments and Documentation

Comments explain **why**, not what. No multi-line comment blocks explaining obvious code.

```typescript
// Good: explains a non-obvious constraint
// PagerDuty API throttles at 200 req/min per API key — batch calls to stay under limit
const PAGERDUTY_BATCH_SIZE = 50

// Bad: explains what the code already says
// Loop through incidents and filter by status
const open = incidents.filter(i => i.status === "open")
```

Every public function in `packages/` has a JSDoc comment with: purpose, parameters, return value, any thrown errors.

Every connector package has a `README.md` with: supported operations, required env vars, capability manifest format.

### 6.8 Context Optimisation

Token cost is an existential risk. 15+ connectors each returning large payloads, naive injection, multi-turn sessions — this bankrupts the operator. Context optimisation is not a nice-to-have. It is a first-class architectural constraint enforced at every layer.

---

#### Model Tier Strategy — Henchmen + Coordinator

**Core principle:** cheap models do the work, expensive models coordinate and verify.

```
Cheap model (Haiku / gpt-4o-mini / gemini-flash):
  - Intent classification
  - Connector response trimming and summarisation
  - Large payload summarisation (logs, diffs, metric series)
  - Tool result extraction (raw JSON → 3 relevant fields)
  - "Does this turn need fresh context?" classifier
  - Routing decision (which specialist agent?)
  - Handoff envelope assembly
  - No-progress detection
  - Negative caching classifier

Expensive model (Opus / GPT-4o / Sonnet):
  - Final orchestrator response to user
  - Root cause hypothesis (correctness guaranteed here)
  - Cross-connector multi-hop reasoning
  - Verification pass when cheap model confidence < threshold
  - Gate approval decisions with justification
  - Security / compliance analysis
```

60–70% of agent work is henchman work. Only the coordinator and verifier need the expensive model. Target: 5–10× cost reduction vs always routing to the expensive model.

**Verification pattern:**
Cheap model produces output → expensive model verifies only when:
- Confidence score < configured threshold
- Action is a write (gate decisions always verified)
- Query explicitly requests analysis (not a simple lookup)

Don't verify everything — that negates the saving. Verify where correctness is load-bearing.

---

#### Context Assembly Pipeline

Context is not built by data dumping. Every query goes through a staged pipeline with budget enforcement at each gate.

```
Query received
  │
  ▼
[1] Intent classification (cheap model)
    → which connectors / KB domains relevant?
    → route to correct specialist(s)
  │
  ▼
[2] KB retrieval
    → top-K entries ranked by (relevance × freshness × confidence)
    → only entries above freshness threshold
    → connector called live only when KB entry stale
  │
  ▼
[3] Tool schema subsetting
    → inject only perimeter-filtered tools for resolved specialist
    → NOT the full union of all connector tools
    → schema bloat = 20K+ tokens before query lands — prevent this
  │
  ▼
[4] Trimmed DTOs from connector calls
    → connector adapter returns typed summary DTO only
    → raw API response never touches context
    → GitHub PR: 50+ fields → 8 fields (85% reduction)
  │
  ▼
[5] Large payload summarisation (cheap model, async where possible)
    → logs / diffs / metric series → 1-3 line summary
    → run at KB sync time (paid once), not per query (paid per retrieval)
  │
  ▼
[6] Budget allocation + ranked injection
    → score every candidate: relevance × freshness × confidence
    → inject highest value-per-token first
    → trim lowest-ranked until under hard limit
    → structured output enforced (JSON schema, not prose)
  │
  ▼
[7] Hard limit check
    → verify total tokens < perQueryHardLimit before dispatch
    → if over: trim further, never exceed
  │
  ▼
[8] Dispatch to model (cheap or expensive per routing decision)
  │
  ▼
[9] Token metering
    → record against session / tenant-daily / tenant-monthly budget
    → alert at threshold, hard stop at limit
```

---

#### Token Configuration Schema

Every limit is configurable per tenant. None are optional.

```typescript
interface TokenConfig {
  // Hard limits — never exceeded
  perQueryHardLimit: number           // max tokens per single agent call
  perSessionLimit: number             // max for entire conversation thread
  perTenantDailyLimit: number         // hard ceiling per org per day
  perTenantMonthlyLimit: number       // billing ceiling

  // Alert thresholds (0.0–1.0)
  alertThreshold: number              // default 0.8 — alert at 80% burn of any limit

  // Budget fractions within a query (must sum to ≤ 1.0)
  kbContextFraction: number           // fraction for KB entries
  historyFraction: number             // fraction for conversation history
  toolResultFraction: number          // fraction for tool call results
  responseReserveFraction: number     // reserved for completion — never trimmed

  // Per-source budgets
  perConnectorBudgets: Record<string, number>  // Datadog logs ≠ Linear ticket

  // Agentic loop controls
  maxStepsPerAgent: number            // tool-call iterations per specialist agent
  maxToolCallsPerSession: number      // total tool calls in one conversation
  noProgressDetection: boolean        // same tool + same args twice → halt

  // Model routing thresholds
  cheapModelConfidenceThreshold: number   // below this → escalate to expensive model
  alwaysVerifyWrites: boolean             // write actions always go through verifier
}
```

---

#### Additional Controls

**Parallel tool calls:** Force parallel invocation wherever tools are independent. Sequential loops re-send full context each round — unnecessary token burn. Both Anthropic and OpenAI support parallel tool calls.

**Conversation compression:** After N turns, older turns compressed to a summary block. Raw turns kept only for last M. Never raw-append history indefinitely.

**Speculative retrieval gating:** Don't re-run KB retrieval on every turn. Cheap classifier: "does this turn introduce new entity references?" Only retrieve when yes.

**Tool result caching:** Same connector read within session hits Redis cache. TTL = min(session lifetime, connector TTL). Zero tokens on cache hit.

**Negative caching:** Cache "no result" answers. Agents re-query absent data otherwise, burning tokens on guaranteed misses.

**Cross-agent handoff envelope:** Orchestrator → specialist never passes raw conversation history. Typed envelope only:
```typescript
interface AgentHandoffEnvelope {
  intent: ClassifiedIntent
  groundedFacts: GroundedFact[]   // KB entries, already retrieved
  perimeter: AgentPerimeter
  sessionSummary: string          // compressed, not raw turns
}
```

**Prompt caching:** Stable system prompt + org-level KB context = cacheable prefix. Design: stable content at top, variable at bottom. Never randomise the prefix. 90%+ cache hit rate on warm sessions.

**Streaming abort propagation:** User closes tab → generation continues, billed fully without abort. Client disconnect must propagate server-side cancellation. Required infrastructure.

**Retry budget check:** Before retrying a failed provider call, check token budget. Retry storms on provider 5xx = cost explosion. Exponential backoff + budget gate before each retry.

**Audit log isolation:** Audit events never enter LLM context. Ever. Injecting audit history for "transparency" explodes cost with zero reasoning value.

---

#### Implementation Order

Ship in this sequence — each unblocks the next:

1. **Token metering + hard limits** — fly blind on nothing. Ship first.
2. **Agentic loop caps** — #1 token sinkhole in multi-agent systems. Ship with M1.
3. **Tool schema subsetting** — 20K+ tokens of schemas before query lands. Ship with first connector.
4. **Trimmed DTOs** — per connector, at connector implementation time.
5. **Intent-scoped activation** — before M2 (multiple connectors live).
6. **Model routing (henchmen + coordinator)** — before expensive model costs accumulate.
7. **KB-first retrieval** — replaces live connector calls at M4.
8. **Prompt caching** — after system prompt stabilises.
9. **Payload summarisation at sync time** — M4 KB sync layer.
10. **Conversation compression + speculative retrieval** — ongoing tuning post-M1.

---

## 7. Docker Compose Strategy

### 7.1 Development Stack (`docker-compose.yml`)

Brings up all infrastructure dependencies. Services run locally (hot reload, debuggable).

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: anvay_dev
      POSTGRES_USER: anvay
      POSTGRES_PASSWORD: anvay_dev_secret
    ports: ["5432:5432"]
    volumes: ["postgres_data:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  otel-collector:
    image: otel/opentelemetry-collector-contrib
    volumes: ["./infra/otel/config.yml:/etc/otel/config.yml"]
    ports: ["4317:4317", "4318:4318"]

  prometheus:
    image: prom/prometheus
    volumes: ["./infra/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml"]
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana
    ports: ["3001:3000"]
    volumes: ["grafana_data:/var/lib/grafana"]

  # trigger.dev for background jobs (dev mode)
  triggerdotdev:
    image: ghcr.io/triggerdotdev/trigger.dev:latest
    environment:
      DATABASE_URL: postgresql://anvay:anvay_dev_secret@postgres:5432/anvay_dev
    ports: ["3002:3000"]
    depends_on: [postgres]
```

Services run from host machine: `pnpm dev` in each app, pointing to these infra containers.

**Startup:**
```bash
docker compose up -d         # infra only
pnpm --filter gateway dev    # gateway on :4000
pnpm --filter web dev        # UI on :3000
pnpm --filter agent-service dev  # python on :8000
```

### 7.2 Demo Stack (`docker-compose.demo.yml`)

Brings up the **entire** Anvay stack plus simulated services in demo mode. Purpose: test real product capability end-to-end, not the prototype. Real LLM. Real data flow. Real agent execution.

```yaml
# docker-compose.demo.yml
services:
  # ─── Infrastructure ─────────────────────────
  postgres:   # same as dev
  redis:      # same as dev
  otel-collector:
  prometheus:
  grafana:

  # ─── Anvay Stack ────────────────────────────
  gateway:
    build: ./apps/gateway
    environment:
      DATABASE_URL: ...
      JWT_SECRET: ...
      DEMO_MODE: "true"
    ports: ["4000:4000"]

  web:
    build: ./apps/web
    environment:
      NEXT_PUBLIC_GATEWAY_URL: http://gateway:4000
    ports: ["3000:3000"]

  agent-service:
    build: ./apps/agent-service
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}  # real key, from .env
      DATABASE_URL: ...
    ports: ["8000:8000"]

  # ─── Demo Services (simulate org infrastructure) ─
  demo-payments-api:
    build: ./infra/demo/services/payments-api
    # Emits: real HTTP traffic, error rates, latency, metrics to OTEL collector
    # Simulates: normal ops + periodic incident injection (error spikes, deploy failures)
    ports: ["5001:5001"]

  demo-auth-service:
    build: ./infra/demo/services/auth-service
    ports: ["5002:5002"]

  demo-catalog-service:
    build: ./infra/demo/services/catalog-service
    ports: ["5003:5003"]

  # ─── Demo Connector Simulators ──────────────
  demo-github-connector:
    # Serves GitHub-compatible webhook events + REST responses
    # Seeded with: repos, PRs, commits, CI runs matching the demo services
    build: ./infra/demo/connectors/github
    ports: ["5010:5010"]

  demo-datadog-connector:
    # Serves Datadog-compatible metrics API
    # Reads real metrics from OTEL collector (demo services emit real data)
    build: ./infra/demo/connectors/datadog
    ports: ["5011:5011"]

  demo-linear-connector:
    # Seeded project: "Acme Platform" with tickets, features, sprints
    build: ./infra/demo/connectors/linear
    ports: ["5012:5012"]

  demo-argocd-connector:
    # Simulates ArgoCD: deploy history, health status, rollback API
    build: ./infra/demo/connectors/argocd
    ports: ["5013:5013"]

  demo-pagerduty-connector:
    # Simulates PagerDuty: alert feed, oncall schedule, incident API
    build: ./infra/demo/connectors/pagerduty
    ports: ["5014:5014"]

  # ─── Demo Scenario Injector ─────────────────
  demo-scenario-runner:
    # Orchestrates demo scenarios: injects incidents, deploys, alerts on a schedule
    # Scenario examples:
    #   T+0:00 — normal operation
    #   T+2:00 — payments-api deploy (inject version bump)
    #   T+2:30 — error rate spike (inject fault)
    #   T+3:00 — alert fires (PagerDuty connector emits)
    #   T+3:10 — Anvay auto-assembles war room
    #   T+5:00 — rollback (inject via ArgoCD connector)
    build: ./infra/demo/scenario-runner
```

**Demo startup:**
```bash
cp .env.demo.example .env.demo
# Fill in ANTHROPIC_API_KEY (or OPENAI_API_KEY)
docker compose -f docker-compose.demo.yml up
# → http://localhost:3000  (full Anvay UI, real data, real LLM)
```

**Demo mode contract:**
- Real LLM calls (actual Anthropic/OpenAI API — API key required)
- Real data flowing (demo services emit actual metrics, logs, events)
- Real agent execution (orchestrator classifies, routes, calls connectors, responds)
- Connector simulators are faithful implementations of the real connector API surface
- Scenario runner creates believable incidents and situations without manual setup

This is the test environment for product capability validation — not the prototype mock.

---

## 8. Agent-Assisted Implementation Strategy

### 8.1 Agent Tooling

**Primary:** [OpenCode](https://opencode.ai) with Kimi K2.5/K2.6  
**Secondary:** Claude Code (Anthropic) for architecture, complex reasoning, docs  
**Context:** This document + CLAUDE.md always in context at session start

**Rationale for Kimi K2 for implementation:**
- Long context window: entire packages in context simultaneously
- Strong code generation with interface/DI patterns
- Cost-effective for high-volume implementation turns
- Use Claude Opus/Sonnet for: architecture decisions, complex debugging, security review

### 8.2 Per-Milestone Agent Strategy

Each milestone has a defined agent workflow:

```
1. Architecture session (Claude)
   → Define interfaces, DTOs, DB schema for this milestone
   → Output: interface files, migration files, type contracts

2. Implementation (OpenCode + Kimi K2)
   → Implement against the interfaces defined in step 1
   → Each package in isolation with its own context
   → Tests written alongside implementation (not after)

3. Integration review (Claude)
   → Cross-package type checking
   → Security review on any auth/perimeter code
   → Performance review on DB queries and context usage

4. PR + CI
   → All tests pass
   → TypeScript strict mode: zero errors
   → Lint: zero warnings
```

### 8.3 Context Management for Agents

At the start of every implementation session:
1. Load `CLAUDE.md` and `docs/PRODUCT.md` (this file)
2. Load the interface files for the package being worked on
3. Load relevant test files for the pattern being implemented
4. Do NOT load unrelated packages — keep context tight

**Never ask an agent to implement across multiple packages in one session.** Each session = one package, one concern.

---

## 9. Milestone Execution Plan

### Milestone 0 — Foundation (3 weeks)

**Goal:** Monorepo runs. All services boot. Auth works. DB seeded. Docker compose up.

**Deliverables:**
- pnpm monorepo with turborepo pipeline configured
- `docker-compose.yml` — Postgres + pgvector, Redis, OTEL Collector, Prometheus, Grafana
- Database schema: `tenants`, `users`, `connectors`, `audit_events`, `incidents` (initial tables + migrations via Prisma)
- Gateway (`apps/gateway`): JWT auth, `/health` endpoints, structured logging (pino), OTEL instrumentation
- Web (`apps/web`): real API route `/api/chat` (stub, returns mock stream), `/api/providers` (reads env)
- `packages/types`: shared TS types, base error classes, Result type
- CI pipeline: GitHub Actions — lint, typecheck, test, docker build
- All services: health endpoints responding, structured logs to OTEL, metrics exported

**Definition of done:**
```bash
docker compose up -d
pnpm install
pnpm dev
# → All services healthy, logs flowing, metrics in Prometheus
```

---

### Milestone 1 — Orchestrator Core (4 weeks)

**Goal:** Real LLM calls. Orchestrator classifies and responds. Perimeter enforced. Audit logged.

**Deliverables:**
- `packages/agent`: Orchestrator harness — `createOrchestrator`, `runSession`, perimeter middleware, audit sink
- `apps/gateway`: `/api/chat` endpoint — POST body → agent harness → SSE stream response
- `apps/web`: Real streaming chat — replace mock with `fetch('/api/chat')` + ReadableStream
- Perimeter engine: `resolveCapabilities(user, connectors)` — deterministic rule evaluation
- Audit service: writes all harness events to `audit_events` table (immutable, append-only)
- Session memory: Redis-backed, TTL = session lifetime
- Model config: env-based (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.), `/api/providers` returns status
- `ModelConfig` UI: "configured via env" status, no key input in client

**Test coverage:**
- Orchestrator: unit tests for intent classification, routing, perimeter check
- Audit: integration test — every harness event appears in DB
- Streaming: E2E — POST `/api/chat` returns SSE stream with complete response

---

### Milestone 2 — Core Connectors (5 weeks)

**Goal:** GitHub, Datadog, Linear, ArgoCD connected. Read mode. Real data in orchestrator context.

**Deliverables per connector:**
- `connectors/{name}`: connector package with interface implementation
- Connector interface: `IConnector { capabilities, read(query), write(action), health() }`
- Each connector: MCP tool definitions or CLI subprocess wrapper
- Connector registry: stored in DB per tenant, encrypted secrets, capability manifest
- `ConnectorAgent`: specialist agent that queries a single connector, returns grounded response
- KB sync: connector agent pushes events to KB on schedule + on-demand
- `apps/web/components/connectors.tsx`: real connector status from API

**Connector priority order:**
1. GitHub — PRs, commits, CI runs, repos
2. Datadog — metrics, monitors, logs
3. Linear — issues, projects, cycles
4. ArgoCD — deployments, health, rollback

**Test coverage:**
- Each connector: sandbox/mock server integration test
- KB sync: connector event → KB entry with freshness score

---

### Milestone 3 — Incident War Room (3 weeks)

**Goal:** Real incident data. War room auto-assembled from live connectors.

**Deliverables:**
- `IncidentService`: create, update, resolve, list — multi-tenant, audit-logged
- `SREAgent`: specialist agent — given incident ID, queries connectors, assembles hypothesis
- War room assembly: incident → SRE agent → grounded hypothesis + timeline + metrics + deploys + PRs
- Event trigger: alert_fired → create_incident → surface_context
- `apps/web/components/incident-view.tsx`: wire to real API
- `GET /api/incidents` endpoint

---

### Milestone 4 — Service Catalog + Knowledge Base (4 weeks)

**Goal:** Live service graph. KB with freshness scoring. Anti-hallucination grounding enforced.

**Deliverables:**
- KB schema: `entities`, `relationships`, `kb_entries` (source, fetched_at, ttl, freshness_score, embedding vector)
- Entity types: Service, Team, Engineer, Incident, Deploy, PR, Commit, Alert
- Relationship types: owns, depends_on, deployed_by, monitored_by, caused_by, authored_by, oncall_for
- KB sync agent: pulls from connectors, writes entities + relationships + KB entries
- Freshness daemon: background cron — scores all KB entries, triggers re-sync on decay
- Orchestrator grounding: every agent response claims grounded to KB entry (source + fetched_at)
- `GET /api/catalog/services` — real service catalog from KB
- `apps/web/components/service-catalog.tsx`: wire to real API

---

### Milestone 5 — Automations (3 weeks)

**Goal:** Event triggers and cron monitors running in production.

**Deliverables:**
- Trigger.dev integration: cron jobs + event-driven jobs
- TriggerEngine: matches events to active trigger rules, enforces perimeter, executes action set
- CRUD API for trigger rules: `POST /api/automations/triggers`, etc.
- CRUD API for cron monitors: `POST /api/automations/monitors`
- Built-in cron monitors: service_health_sweep, cloud_security_scan, slo_burn_check, deploy_health_report, oncall_morning_brief
- Proactive Signals inbox: surface anomaly results from cron jobs
- `apps/web/components/automations-view.tsx`: wire to real API

---

### Milestone 6 — Full Lifecycle (4 weeks)

**Goal:** Full PRD → Deploy agent chain working end-to-end.

**Deliverables:**
- ProductAgent: PRD generation from conversation
- TechSpecAgent: spec from PRD
- BootstrapAgent: scaffold service/feature from spec
- TestAgent: test generation from spec
- DeployAgent: trigger ArgoCD pipeline
- Gate service: `createGate`, approval UI, auto-approve policy evaluation
- `apps/web/components/lifecycle.tsx`: wire all stages to real API
- `apps/web/components/workflow-view.tsx`: wire to real gate + workflow config

---

### Milestone 7 — Multi-Tenancy + Enterprise (4 weeks)

**Goal:** Multiple orgs. Proper provisioning. Access control enforced end-to-end.

**Deliverables:**
- Tenant onboarding flow: org creation, admin user, connector provisioning wizard
- User management: invite, role assignment, connector perimeter config
- Row-level security enforced in Postgres (all tables)
- Billing model: usage tracking (LLM tokens, connector calls, seat count)
- SSO integration: SAML, OIDC (Okta, Google Workspace, Azure AD)
- Connector perimeter audit: per-user access log, anomaly detection

---

### Milestone 8 — Demo Mode + OSS Release (2 weeks)

**Goal:** `docker compose -f docker-compose.demo.yml up` → full working product demo with real data.

**Deliverables:**
- Demo services: payments-api, auth-service, catalog-service (Go/TypeScript, emit OTEL)
- Connector simulators: GitHub, Datadog, Linear, ArgoCD, PagerDuty (faithful API implementations)
- Scenario runner: scripted incident injection, normal ops, recovery flow
- `docker-compose.demo.yml`: full stack, single command start
- Seed script: demo tenant, users, connector config, initial KB state
- `docs/CONTRIBUTING.md`: OSS contributor guide
- `docs/connectors/`: per-connector implementation guide
- GitHub repo: public, `LICENSE` (AGPL v3), `LICENSE-COMMERCIAL` (commercial license terms), CI badges, README with demo gif

---

## 10. Non-Negotiables

These are hard constraints. Not guidelines.

1. **API keys server-side only.** Never in client bundle, never in localStorage, never in any client-side state. Only `process.env` on server. Route handlers are the only place keys are read.

2. **Perimeter is deterministic.** No LLM makes access decisions. Policy engine evaluates rules. Hard block is structural, not a warning.

3. **Every write action gated in V1.** No autonomous writes until trust is established. The gate UI must show: what will happen, what resource, confidence score, require one confirm click, log the confirmation.

4. **Audit log is append-only.** No delete, no update. If a record is wrong, add a correction event. Audit feeds compliance.

5. **Anti-hallucination is structural.** Agents cannot generate ungrounded claims. If grounding fails, the agent says so. This is enforced in the harness, not in the system prompt.

6. **Multi-tenancy at the data layer.** `tenant_id` on every row. Row-level security in Postgres. No cross-tenant query possible at the ORM layer.

7. **Tests ship with the code.** No merge without tests. Coverage gate in CI.

8. **Zero `console.log` in production code.** Structured logging via pino/structlog. Every log: trace_id, service, tenant_id.

9. **No vendor lock-in. Period.** The harness is model-agnostic. Agents call `IModelProvider`, never a provider SDK directly. Connector logic calls `IConnector`, never a vendor client directly. Swapping any provider — LLM, database, queue, scheduler — requires only config, not code. Every external dependency is behind an interface.

10. **Evaluate before building the harness.** Existing solutions (Mastra, Vercel AI SDK, LangGraph.js) must be evaluated against all six harness requirements before building bespoke. Bespoke is the fallback, not the default.

11. **Docker compose demo works without local dev environment.** `docker compose -f docker-compose.demo.yml up` is the only prerequisite (plus API key in `.env`).

---

## 11. Decisions

All questions resolved and locked.

| Decision | Status | Resolution |
|----------|--------|------------|
| Memory — session scope | Locked | `RedisSessionMemory implements ISessionMemory` — Redis + rolling summary |
| Memory — KB/project/org scope | Locked | `GraphitiKnowledgeGraph implements IKnowledgeGraph` — Graphiti (Apache 2.0) + Apache AGE on Postgres. Swap path: KùzuDB (MIT). No agent code changes to switch. |
| Background jobs scheduler | Locked | Trigger.dev (Apache 2.0, self-hosted) primary · BullMQ (MIT, Redis-backed) fallback |
| Graph DB | Locked | Postgres adjacency table until traversal is measured bottleneck. Named swap target: KùzuDB (MIT, embedded, zero new service). FalkorDB disqualified (RSAL). |
| Event bus | Locked | Redis Pub/Sub (already in stack, zero ops cost). Switch trigger: >10 connectors at concurrent high frequency OR need durable replay across restarts. Kafka is the named upgrade path. |
| High-perf services (was: Rust) | Locked | Go for collection runner, FSM, high-throughput connector agents. Switch from TypeScript only when benchmarks show bottleneck. Timeline: M4+. |
| Connector simulator fidelity | Locked | Faithful API surface (match tool definitions + response shape). Not byte-perfect. Good enough for integration testing without brittle fixtures. |
| OSS license | Locked | AGPL v3 + commercial dual license |
| Agent harness | Locked | Mastra + wrappers. Perimeter middleware + token metering wired into Mastra lifecycle hooks. Harness remains swappable — surface functions accept `IModelProvider`, never Mastra types directly. |
| Pricing model | Locked | Connector-count tiers + token pool. Configurable per deployment. Defaults: |

```
Tier 1  — up to  3 connectors · 1M tokens/mo  ·  5 seats
Tier 2  — up to 10 connectors · 10M tokens/mo · 25 seats
Tier 3  — unlimited connectors · 100M tokens/mo · unlimited seats
Overage — tokens billed at cost + margin; connector count triggers upgrade nudge (not hard block)
```

**Enforcement model:**

| Limit | Enforcement | Rationale |
|-------|-------------|-----------|
| Token pool | Hard stop | Real cost. Overage = pay-as-you-go if billing configured, else block. |
| Connector count | Soft limit | Not a cost driver. Exceed tier → upgrade nudge + 14-day grace, then read-only. Never hard block in production. |
| Seats | Advisory only | No enforcement. Org manages internally. |

Connector count is the primary tier differentiator for sales messaging. Token pool is the real cost enforcer — more connectors = more agent calls = token cap hit sooner = natural upgrade pressure without breaking production. All thresholds (connector limits, token caps, grace periods, overage rates) are runtime-configurable — no hardcoded values in billing logic.
