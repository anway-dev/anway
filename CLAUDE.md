# Anvay — Project Context for Claude Code

## What This Is

Anvay is the **central nervous system of a software organisation**.

Every team already has GitHub, Datadog, Linear, K8s, Loki, Prometheus, Jira, ArgoCD, PagerDuty, Terraform, Coralogix, AWS/GCP/Azure — they never talked to each other. Anvay connects all of them as datasources, builds intelligence on top, and gives every person in the org one surface to query, act, and govern the entire software lifecycle.

**We are not a devtool. We are the connective tissue.**

```
Before:  Product ←——→ Eng ←——→ SRE   (siloed, context lost at boundaries)
After:   Product ←—— Anvay ——→ Eng ←—— Anvay ——→ SRE   (one nervous system)
```

Every connector added = more intelligence for the entire org. Network effect within.

---

## The Mental Model

```
User → Orchestrator (single entry point)
     → classifies intent + resolves effective role
     → resolves user permission envelope
     → spins specialist agents within allowed scope
     → aggregates across datasources
     → responds + offers follow-up actions
     → full audit logged
```

User never picks an agent. Never sees the plumbing. One surface.

---

## User Modes

| Role | Example query | What Anvay does |
|------|--------------|-----------------|
| **SRE/Oncall** | "Alert fired — what's the trail?" | Traces root cause across logs/metrics/deploys |
| **PM** | "Status of Feature X?" | Queries lifecycle graph + Linear + PRs + deploy state |
| **BA** | "How is this user journey performing?" | Pulls metrics + events, analysis query |
| **Dev** | "Why is this issue?" | Multi-repo session, root cause + follow-up (write regression test) |

Role assignment:
```
auth_role      = set at provisioning (base, always present)
inferred_role  = derived from query vocab + workspace signals + session history
effective_role = inferred_role ?? auth_role
```

---

## Developer Lifecycle Flow

Every step: chat with orchestrator. Every transition: configurable gate.

```
Conversation
  → Product Agent writes PRD
  → [PM Approval Gate]
  → TechSpec Agent writes TechSpec
  → [Team/Dev Approval Gate]
  → Bootstrap Agent scaffolds service/feature
  → Test Agent writes tests
  → [PR Gate — configurable approval count]
  → Deploy Agent triggers pipeline
  → SRE Agent monitors metrics + alerts
```

Gates: human-approvable, auto-approvable by policy, always audited.
Human loop insertable at any point. Configurable per team/service.

---

## Agents

| Agent | Role |
|-------|------|
| **Orchestrator** | Single entry point. Classifies, routes, aggregates, responds |
| **Product Agent** | Writes PRD from conversation |
| **TechSpec Agent** | Writes tech spec from PRD |
| **Bootstrap Agent** | Scaffolds service/feature in codebase |
| **Test Agent** | Writes tests, regression on demand |
| **Review Agent** | Code review, one-pass findings + test plan |
| **Deploy Agent** | Triggers deploy pipeline |
| **SRE Agent** | Monitors metrics, alerts, root cause traces |
| **Connector Agents** | One per datasource — each operates within declared capability manifest |

---

## Access Control — Deterministic, Not Probabilistic

**Critical:** AI operates inside a hard permission envelope. Structurally blocked from acting outside it. Not a warning — a hard stop.

### Connector Modes
Every connector registered as: `read` | `write` | `read-write`
- `read` = datasource only
- `write` = can act (deploy, create PR, scale, comment)

### Connector Capability Manifest
Each connector declares what actions it exposes and what scopes those actions require:

```yaml
connector: k8s-prod
mode: read-write
capabilities:
  read:
    resources: ["*"]
  write:
    resources: ["deployments/app1", "deployments/app2"]
```

```yaml
connector: github
mode: read-write
capabilities:
  read:
    scope: ["org/*"]
  write:
    scope: ["org/repo-a"]
```

### User Provisioning
At provision time, user gets an access perimeter across all connectors:

```yaml
user: alice@acme.dev
role: dev
connectors:
  k8s-prod:
    read: ["*"]
    write: ["deployments/app1"]
  github:
    read: ["org/*"]
    write: ["org/repo-a", "org/repo-b"]
  linear:
    read: ["team-payments/*"]
    write: []
```

### Resolution at Runtime
```
session_start:
  resolved_capabilities = user_perimeter ∩ connector_manifest
  agent_action_set = filter(all_actions, resolved_capabilities)

every_agent_action:
  check(action ∈ agent_action_set) → proceed
  else → hard block, logged
```

**Privilege evaluation = deterministic rule engine, not LLM judgment.**

---

## Audit System

Every event immutably logged:
- Every query issued (user, timestamp, effective role, raw query)
- Every follow-up in thread
- Every agent spawned + actions taken
- Every gate decision (approved by whom, auto or manual)
- Every connector read/write operation
- Every hard block (access denied)

Audit feeds intelligence — org-level query patterns, bottleneck detection, usage analytics.

---

## Key Capabilities

1. **Single surface** — orchestrator is the product, user never picks agents
2. **Central nervous system** — connects siloed teams/tools, context preserved end-to-end
3. **Deterministic access perimeter** — hard rule engine, not probabilistic
4. **Connector modes** — read/write declared per connector, scoped per resource
5. **Human loop anywhere** — any gate insertable, configurable per team/service
6. **Configurable review workflows** — approval count, reviewers, auto-approve thresholds
7. **Preconfigured doc templates** — service setup agent creates central template repo
8. **Multi-repo sessions** — dev query spans N repos, context maintained
9. **Follow-up chaining** — "why broken" → "create regression test" → done in one thread
10. **Role-aware responses** — same query answered differently per role
11. **Confidence-gated autonomy** — score 0.0–1.0; >0.90 auto-passes, below arms human approval
12. **Full audit trail** — every action, every user, immutable

---

## V1 Trust Principle — Read + Confirm Only

**V1 ships read-only by default. Every write action requires explicit user confirmation.**

Rationale: trust is earned incrementally. Users must see Anvay surface accurate context and useful suggestions before they will let it act. Skipping this step and shipping autonomous actions in v1 destroys trust on first mistake.

### V1 contract
```
Anvay reads from all connected sources.
Anvay surfaces: root cause, triage context, recommended action.
User sees the recommendation.
User clicks "Apply" / "Confirm" / "Run".
Only then does Anvay execute the write.
```

Every write action — PR creation, deploy trigger, pod restart, ticket update, comment — is gated. No exceptions in v1. The gate UI must:
- Show exactly what will happen (action, target resource, connector)
- Show confidence score
- Require a single explicit confirm click
- Log the confirmation (who, when, what was approved)

### Autonomy dial — unlock post-trust

The full autonomy dial (L1→L4) is the product roadmap. V1 is L2 for everything:

- **L1 Assist** (V1 default) — Anvay reads and suggests. Human does the action manually.
- **L2 Approve** (V1 writes) — Anvay generates + shows gate. Human confirms. Anvay executes.
- **L3 Supervise** — Anvay executes, human can interrupt. Unlock per-service after trust established.
- **L4 Autonomous** — Anvay executes within policy bounds, async audit only. Unlock explicitly, never default.

---

## Architecture

### Stack
- **TypeScript** — orchestrator, agent layer, UI. Anthropic SDK, streaming SSE.
- **Python FastAPI** — heavy parsing, LLM inference jobs, embedding
- **Fastify** — BFF gateway, auth, team sync, proxy
- **Next.js** — web UI (`apps/web`). All styles inline (`style={{}}`). Do NOT use Tailwind — v4 breaks silently.
- **Rust** (planned) — core engine, WASM, collection runner, FSM

### Monorepo Layout
```
anvay/
├── apps/
│   ├── web/              # Next.js UI
│   ├── cli/              # `anvay` CLI
│   ├── gateway/          # Fastify BFF — auth, perimeter enforcement
│   └── agent-service/    # Python FastAPI — LLM inference, embedding
│
├── packages/
│   ├── agent/            # @anvay/agent — harness SDK, orchestrator core
│   ├── collection/       # @anvay/collection — file format + runner
│   ├── repo/             # @anvay/repo — codebase analysis
│   ├── k8s/              # @anvay/k8s — cluster client
│   ├── ui/               # @anvay/ui — shared components
│   └── types/            # @anvay/types — shared TS types
│
├── infra/                # docker-compose, helm, terraform
├── CLAUDE.md
├── turbo.json
└── pnpm-workspace.yaml
```

### Connector Model
Read from existing tools. Write back minimal artifacts only unless workflow hook requires it. Every connector has: mode declaration + capability manifest + connector agent.

---

## Design Language

- Background: `#080808`
- Surface: `#0a0a0a`, `#0e0e0e`, `#111`
- Border: `#1a1a1a`, `#2a2a2a`
- Accent green: `#10b981` — primary interactive color
- Text primary: `#e5e5e5`
- Text secondary: `#888`
- Text muted: `#555`, `#444`
- Error/fail: `#ef4444`
- Warning: `#f59e0b`
- Info: `#3b82f6`
- Purple: `#8b5cf6`

All components follow this palette. Inline styles only.

---

## Current Prototype State (`apps/web`)

Mock data only. Purpose: design validation + demos.

| File | What it is |
|------|-----------|
| `app/page.tsx` | App shell, sidebar nav, view switcher |
| `lib/mock.ts` | All mock data |
| `components/lifecycle.tsx` | PRD→Metrics horizontal stage flow |
| `components/editor-view.tsx` | One-window coding — editor + findings + gate |
| `components/ai-panel.tsx` | Right-side AI chat panel |
| `components/apiclient.tsx` | API client — collections + request builder + response |
| `components/connectors.tsx` | Connector grid with category filter |
| `components/orchestrator-chat.tsx` | God-mode orchestrator — terminal aesthetic, live execution trace |
| `components/cloud-view.tsx` | Cloud health — AWS/GCP/Azure resources, security, config |
| `components/incident-view.tsx` | Incident War Room — timeline, metrics, deploys, PRs, runbook |
| `components/service-catalog.tsx` | Service Catalog — dep graph, metrics, incident history |
| `components/automations-view.tsx` | Automations — event triggers + cron monitors |
| `components/alerts-view.tsx` | Live alerts with severity + triage |
| `components/workflow-view.tsx` | Workflows — autonomy dial, gate config |
| `components/audit-view.tsx` | Immutable audit log |
| `components/access-view.tsx` | User provisioning + perimeter config |
| `components/kb-view.tsx` | Knowledge base explorer |
| `components/intake-view.tsx` | Signal routing + L1 Assist config |

### Next Steps (prototype)
1. ~~Build `OrchestratorChat`~~ ✓ Done
2. ~~Wire `EditorView`~~ ✓ Done
3. ~~Build `WorkflowView`~~ ✓ Done
4. ~~Build Incident War Room + Service Catalog~~ ✓ Done
5. ~~Build Automations (triggers + crons)~~ ✓ Done
6. Build real `@anvay/agent` harness in `packages/agent`
7. Wire `/api/chat` + `/api/providers` route handlers for real LLM calls

### Nav Order (current)
1. Chat — orchestrator, primary surface
2. Signals — live alerts
3. War Room — incident triage
4. Services — service catalog + dep graph
5. Routing — signal routing / L1 Assist
6. Lifecycle — PRD→Metrics stage flow
7. Editor — one-window coding
8. Knowledge — KB explorer
9. Workflows — autonomy dial + gate config
10. Automations — event triggers + cron monitors
11. API Client
12. Connectors
13. Audit
14. Access
15. Models
16. Cloud
17. K8s

### Future Prototype Enhancements

| Feature | Description | Priority |
|---------|-------------|----------|
| **Change Timeline** | Every deploy/PR/config/alert on one horizontal timeline across all connectors. Scrub time → see org state. Answers "what changed before X broke?" | High |
| **Blast Radius Preview** | Before any L2 write action, show graph of affected services/users/traffic. "Restart pod X → drops 47 active sessions." Reinforces V1 trust. | High |
| **Proactive Signals Inbox** | Anvay watches overnight. Morning brief: "3 anomalies, 1 deploy stuck, oncall paged twice." Shifts reactive → proactive. | Medium |
| **SLO Dashboard** | Per-service SLO tracking — error budget burn, 30d trend, Datadog/Prometheus integration. | Medium |
| **Oncall Handoff View** | Shift-change brief auto-generated. What happened, what's open, what to watch. | Medium |

---

## Running

```bash
cd apps/web
npm install
npm run dev
# http://localhost:3000
```

Active branch: `claude/claude-md-docs-k210H`

## Pending Architecture Work

### LLM API calls must be server-side (not yet implemented)
Currently `OrchestratorChat` and `ModelConfig` use mock data. Real LLM calls must go server-side:

```
Browser → POST /api/chat → Route Handler (server)
                              ↓ reads key from process.env
                              → LLM provider API
                              ← streams response back to browser
```

Tasks:
1. Create `apps/web/app/api/chat/route.ts` — POST handler, reads model config from env, calls provider, streams response
2. Create `apps/web/app/api/providers/route.ts` — GET handler, returns which providers are configured (status only, no keys exposed)
3. Create `apps/web/.env.local` template — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OLLAMA_ENDPOINT`, `LMSTUDIO_ENDPOINT`
4. Update `ModelConfig` UI — remove API key input from client, show "configured via env var" status fetched from `/api/providers`
5. Update `OrchestratorChat` — replace mock streaming with `fetch('/api/chat', { method: 'POST', body: ... })` + ReadableStream

**Security rule:** API keys never in client bundle, never in localStorage, never in any client-side state. Only `process.env` on server. Route handlers are the only place keys are read.

---

## Agent Harness Guidance

### Preferred: Anthropic SDK direct + thin harness in `@anvay/agent`

Do NOT adopt a heavy framework (LangChain, LlamaIndex, CrewAI, AutoGen). They add abstraction that fights the deterministic perimeter requirement.

**Why direct SDK:**
- Full control over every tool call — perimeter check runs as middleware before the LLM sees a result
- Native streaming (`stream_manager`, SSE passthrough)
- Tool use lifecycle hooks: `on_tool_call` → check policy → execute or block → audit log
- No hidden agent decisions — every routing step is explicit code, not framework magic

**Thin harness pattern (`packages/agent`):**
```
OrchestratorAgent
  resolveEffectiveRole(user, query)
  resolveCapabilities(user, connectors)        ← deterministic perimeter
  routeToSpecialist(intent) → SpecialistAgent
  SpecialistAgent.run(tools filtered to perimeter)
  every tool_call → audit_log.append(event)
```

**Vercel AI SDK** — acceptable for the web streaming layer only (`apps/web` server routes → browser SSE). Not for agent logic.

**Mastra** — TypeScript-first, supports Anthropic, human-in-loop workflows. Evaluate if the harness in `@anvay/agent` grows complex. Don't start with it.

### If no existing harness satisfies requirements — build it

`packages/agent` (`@anvay/agent`) is the harness. If any evaluated framework cannot satisfy all of:
- Deterministic perimeter (policy check runs before tool result returns to LLM)
- Full audit hook on every tool call with no bypass path
- Human-in-loop gate insertable at any step
- Streaming passthrough to SSE without buffering
- Multi-agent context handoff with typed contracts

...then build the harness in `@anvay/agent` rather than compromise on any of the above. The harness is core product — it is not a commodity. A bespoke 500-line harness we fully control beats a framework that forces a workaround on requirement #2.

Build surface for `@anvay/agent`:
```typescript
createOrchestrator({ model, tools, perimeter, auditSink })
createSpecialistAgent({ name, tools, systemPrompt })
createGate({ condition, approvers, autoApproveThreshold })
runSession(orchestrator, input, context) → AsyncIterator<StreamEvent>
```

### Event Triggers — reactive automation

The harness must support event-driven agent execution. Connectors emit events; the harness routes them to specialist agents without user intervention.

**Event pipeline:**
```
Connector emits event (alert_fired, deploy_failed, error_rate_threshold, ...)
  → EventBus receives + classifies
  → TriggerEngine matches against active trigger rules
  → For each matched rule:
      → perimeter check (is this agent allowed to act on this scope?)
      → spawn SpecialistAgent with event context
      → SpecialistAgent executes action set (notify, create_incident, surface_context, ...)
      → every action → audit_log.append(event)
      → gated actions (write ops) require explicit confirm unless auto-approve policy set
```

**Trigger schema (runtime):**
```typescript
interface Trigger {
  id: string
  event: EventType              // connector event type to match
  condition: TriggerCondition   // threshold, scope, filter
  actions: TriggerAction[]      // ordered action set
  perimeter: AgentPerimeter     // scoped to what this trigger can touch
  auditTag: string              // tagged in every audit event this trigger produces
}
```

**Built-in event types (connectors emit these):**
- `alert_fired` — PagerDuty / Datadog alert
- `deploy_completed` / `deploy_failed` — ArgoCD / GitHub Actions
- `error_rate_threshold` — Datadog metric rule
- `slo_burn_rate` — SLO budget burn
- `pr_merged` — GitHub
- `test_failed` — CI pipeline
- `incident_created` — internal
- `cloud_finding` — cloud security connector

**Action types (what a triggered agent can do):**
- `notify_oncall` / `notify_channel` — write to PagerDuty / Slack (gated in V1)
- `create_incident` — write to internal incident store
- `open_war_room` — surface incident + context to UI
- `surface_context` — inject context into orchestrator as next query
- `escalate` — page next tier
- `run_runbook` — execute a defined runbook step sequence
- `block_deploy_gate` — halt pending deploy approval

All write actions subject to V1 gating rules (L2 Approve — show + confirm before execute).

---

### Cron Monitors — proactive intelligence

The harness must support scheduled agent runs that check system state without a user prompt.

**Cron pipeline:**
```
Scheduler fires cron job (e.g. */5 * * * *)
  → CronEngine instantiates SpecialistAgent with job spec
  → Agent reads from connectors (perimeter-scoped read only)
  → Agent evaluates against thresholds / patterns
  → If anomaly found:
      → emit event to EventBus (triggers may fire on it)
      → write result to KB (with freshness timestamp)
      → optionally surface to Proactive Signals inbox
  → Run result + summary → audit log
```

**Built-in cron monitor types:**
- `service_health_sweep` — error rate, P99, pod health for all prod services
- `cloud_security_scan` — pull findings from all cloud connectors
- `slo_burn_check` — compute 1h + 6h error budget burn rate
- `cost_anomaly_detection` — compare spend to 7d baseline
- `deploy_health_report` — aggregate daily deploy outcomes
- `oncall_morning_brief` — generate shift-change brief for current oncall
- `incident_retrospective` — weekly pattern analysis across resolved incidents

**Cron job schema:**
```typescript
interface CronJob {
  id: string
  schedule: string              // cron expression
  agentType: SpecialistAgentType
  spec: CronJobSpec             // what to check + thresholds
  onAnomaly: TriggerAction[]    // actions to take if anomaly found
  perimeter: AgentPerimeter     // read-only scope this job can access
  resultSink: "kb" | "signals_inbox" | "both"
}
```

**Scheduling:** Use a durable scheduler (not in-process `setInterval`). Options in priority order:
1. **Trigger.dev** — TypeScript-native, background jobs + crons, integrates with Next.js. Evaluate first.
2. **Inngest** — event-driven background functions, cron support, strong DX.
3. **BullMQ** — Redis-backed job queue + cron scheduler. Self-hosted.
4. **pg-boss** — Postgres-backed. Good if already on Postgres, no Redis dependency.

Do not use `setInterval` or `cron` npm packages in production — no persistence, no retry, no visibility.

---

## Connector Strategy

**Priority order: MCP server → CLI → official SDK → REST API**

Rationale: MCP servers expose typed tools that agents can call directly without custom wrapper code. CLIs are second because they're composable, auditable, and don't require maintaining a bespoke HTTP client. Raw REST is last resort.

### Connector acquisition strategy (per integration)
```
1. Check if vendor ships an official MCP server
2. Check if vendor ships a CLI (e.g. gh, pd, argocd, kubectl, aws, gcloud, az)
3. Use official SDK if MCP/CLI absent
4. REST only if nothing else exists
```

When building connector agents: the agent's tool definitions should be thin wrappers around MCP tool calls or CLI subprocess calls — not hand-rolled HTTP. This keeps connectors auditable (every invocation is a subprocess call in the log) and upgradeable (swap MCP version without changing agent code).

### Cloud connectors — provider-agnostic

Cloud is not AWS, GCP, or Azure. Cloud is wherever the org runs. A connector exists for every provider:
- AWS → CloudWatch, Health Dashboard, Cost Explorer, CloudTrail
- GCP → Cloud Monitoring, Cloud Logging, Asset Inventory
- Azure → Monitor, Service Health, Advisor
- Any other provider that exposes metrics/health APIs

Every cloud connector follows the same acquisition strategy above (MCP → CLI → SDK). AWS CLI (`aws`), GCloud CLI (`gcloud`), Azure CLI (`az`) are all first-class targets. Do not hard-code assumptions about which cloud a workspace uses — connector configuration at provisioning time declares what the org has.

**Do not build a connector abstraction layer now.** Defer until 3+ connectors exist and the pattern is clear.

---

## Company-Wide Knowledge Base — Architecture Principles

### The problem: context rot and hallucination

Every LLM system that operates on org knowledge has two failure modes:
1. **Context rot** — knowledge that was true 3 weeks ago is served as current fact. Stale deploy state, outdated runbooks, resolved incidents treated as open.
2. **Hallucination** — the model fills gaps it cannot see with plausible-sounding fabrications. No citation, no timestamp, no way to verify.

Both failures destroy trust faster than no AI at all. Anvay's KB architecture is designed to make both structurally impossible.

---

### Knowledge layers

```
L1  Live state        Pulled fresh per query from connectors (metrics, pod state, CI status)
                      TTL: 0 — never cached, always live

L2  Recent events     Indexed from connectors on sync cycle (deploys, PRs, incidents, alerts)
                      TTL: connector-defined (e.g. GitHub: 2 min, Datadog: 1 min)
                      Invalidation: event-driven (deploy event → invalidate deploy state)

L3  Derived knowledge Summaries, root cause analyses, architecture maps built by Anvay agents
                      TTL: explicit — tagged with source events that invalidate it
                      Example: "payments-api architecture" invalidates on next merged PR to that repo

L4  Org memory        Decisions, patterns, runbooks, team context that rarely changes
                      TTL: long — but stamped with "last verified" date
                      Decay signal: if source doc updated in Notion/GitHub → re-derive
```

**Rule:** every piece of knowledge served to an agent must carry:
- `source` — which connector it came from
- `fetched_at` — timestamp of last sync
- `ttl` — when this knowledge expires
- `confidence` — 0.0–1.0 based on freshness and source reliability

---

### Anti-hallucination: grounding

Agents never generate answers from training data alone. Every claim in a response must be grounded in a knowledge entry with a live source citation.

```
Response format (internal):
  claim: "payments-api error rate is 8%"
  grounded_by: { source: "datadog", metric: "error_rate.payments-api", fetched_at: "14:47:02", value: 0.08 }

  claim: "v2.3.0 was deployed 14 min ago"
  grounded_by: { source: "argocd", event: "deploy-882", fetched_at: "14:46:58", sha: "a4f21bc" }
```

If the orchestrator cannot ground a claim, it must say so explicitly — not infer. "I don't have current data on X — last sync was 4 hours ago" is correct behavior. Confident fabrication is not.

---

### Context rot prevention

**Event-driven invalidation** — connectors emit events that trigger KB invalidation:
```
github:push(repo, branch)     → invalidate: code-knowledge[repo], architecture[repo]
argocd:deploy(service, sha)   → invalidate: deploy-state[service], runbook[service]
datadog:alert(service)        → invalidate: health-state[service]
linear:issue-closed(id)       → invalidate: incident-knowledge[id]
```

**Freshness scoring** — every KB entry has a freshness score that decays over time:
```
freshness = 1.0 at fetch_time
freshness decays by TTL curve per knowledge type
freshness < 0.5 → agent must re-fetch before using
freshness < 0.2 → entry considered stale, not served without re-fetch
freshness = 0.0 → expired, purged from working context
```

**Staleness surfaced to user** — when a response uses knowledge below a freshness threshold, the UI flags it:
```
"Based on data from 3 hours ago · re-sync recommended"
```

---

### Memory architecture

Three memory scopes:

```
Session memory      Lives for the conversation thread
                    Carries: resolved role, active query context, chained facts from this thread
                    Cleared: on new session
                    Purpose: follow-up chaining ("why broken?" → "now write the fix" shares context)

Project memory      Lives per project, persists across sessions
                    Carries: architecture map, recent incidents, active blockers, team context
                    Updated: on connector sync events
                    Purpose: "what's the state of payments-api?" has context without re-fetching everything

Org memory          Lives org-wide, long-term
                    Carries: architectural decisions, team ownership, runbooks, recurring patterns
                    Updated: manually curated + agent-derived from incident post-mortems
                    Purpose: "how do we usually handle X?" draws from institutional knowledge
```

**No cross-session hallucination** — project and org memory entries are always source-cited and freshness-scored. Memory ≠ trusted fact — memory is a cached view of a source, and that source is the truth.

---

### Knowledge graph, not a document store

The KB is a **graph of entities and relationships**, not a flat document index:

```
Service → owns → Endpoint
Service → depends_on → Service
Service → deployed_by → Pipeline
Service → monitored_by → Dashboard
Incident → caused_by → Deploy
Deploy → introduced → Commit
Commit → authored_by → Engineer
Engineer → oncall_for → Service
```

Querying "what caused the outage?" traverses the graph: Incident → Deploy → Commit → diff. Not keyword search — relationship traversal.

---

### Storage architecture

Three stores, each matched to a memory layer:

```
Session memory    Redis
                  In-process Map for prototype, Redis in prod.
                  TTL = session lifetime, auto-evict. No persistence needed.

Project + Org     PostgreSQL + pgvector
memory            Entities and relationships as tables with FK adjacency.
                  pgvector column on derived knowledge rows for semantic retrieval.
                  freshness_score + fetched_at + ttl columns on every KB row.
                  Redis in front as hot-entry cache (TTL-based, connector sync results).

Knowledge graph   Start in Postgres (adjacency table: entity_id, rel_type, target_id).
                  Migrate to FalkorDB or Neo4j only when relationship traversal
                  becomes the measured bottleneck. Don't pre-optimise —
                  Postgres handles moderate graph queries fine with proper indexes.
```

### Proven memory systems to evaluate

Don't build the memory layer from scratch. These are production-tested:

| System | What it is | Use for |
|--------|-----------|---------|
| **Mem0** (mem0.ai) | Purpose-built memory layer for AI agents. Manages user, session, and org memory with automatic extraction + retrieval. Open source + hosted. | Drop-in for session + project memory. Handles extraction, dedup, retrieval out of the box. Evaluate first. |
| **Zep** | Long-term memory for LLM apps. Stores conversation history, extracts facts, builds user/entity models. TypeScript SDK. | Session + project memory. Strong on conversation summarisation and entity extraction from threads. |
| **Letta (MemGPT)** | Stateful agents with persistent memory, self-editing memory blocks. Manages what to keep/evict autonomously. | Org-level memory that self-curates. Useful when memory volume exceeds context window. |
| **LangGraph checkpointing** | Persistence layer for agent state graphs (thread-level). Postgres or Redis backends. | Session memory if using LangGraph for agent orchestration. Not standalone. |
| **pgvector + custom** | Roll your own on Postgres. Full control, no vendor dependency. | When none of the above fit the access pattern or the schema is too specific. |

**Recommendation for Anvay v1:**
- Evaluate **Mem0** first — closest match to the three-scope (session/project/org) model already defined above.
- If Mem0 doesn't fit the connector-event-driven invalidation model, fall back to **Zep** for conversation memory + custom Postgres for KB.
- Do not build a bespoke memory system before proving the access patterns with one of the above.

**Why not a dedicated vector DB (Qdrant/Pinecone) first?**
pgvector on Postgres is sufficient at org scale. Dedicated vector DB adds ops cost before you have the data volume that justifies it. Switch when benchmarks demand it.

**Why not a graph DB first?**
The entity model needs to stabilise before picking a graph DB. Start relational, migrate when you can name the specific traversal queries that are slow in Postgres.

**Full stack:**
```
Session     Redis          (TTL, ephemeral, in-process for prototype)
Knowledge   Postgres       (entities, relationships, freshness scoring)
            + pgvector     (semantic retrieval over derived knowledge)
Cache       Redis          (hot entries, connector sync results, TTL-based eviction)
Events      Postgres       (event log, invalidation triggers)
            → Kafka        (when event volume demands it — not before)
```

### Implementation notes (not yet built)

- **Sync layer**: connector agents push events into KB on schedule + on-demand per query
- **Context injection**: orchestrator retrieves relevant KB subgraph per query, injects as grounded context into agent prompts — relevance-ranked, not raw dump
- **Freshness daemon**: background job scores all KB entries, triggers re-sync on decay below threshold
- **Do not build now** — prototype uses mock data. KB + storage is the next major backend milestone after harness is established.

---

## Next.js Version Note

**Read `apps/web/node_modules/next/dist/docs/` before writing any Next.js code.** Breaking changes from training data. `middleware` → `proxy`.
