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
     → resolveContext(primaryEntity) from Knowledge Graph   ← NON-NEGOTIABLE FIRST STEP
     → spins specialist agents with graph context pre-injected
     → agents read live data from connectors only to fill gaps graph doesn't have
     → aggregates across datasources
     → responds + offers follow-up actions
     → full audit logged
```

**The Knowledge Graph is the mandatory starting point for every investigation, triage, debug, and action. No agent starts from raw connector data. Always graph first.**

- If entity exists in graph → inject context, then query connectors for live L1 data only
- If entity not in graph → trigger async bootstrap for that connector, proceed with L1 live data, graph enriches future queries
- If graph is stale (freshness < 0.5) → inject with staleness flag, agent verifies critical facts from connector
- Skipping the graph step is a hard violation — audit-logged and surfaced as a system error

### Graph provides coordinates. Connectors provide live data.

Agents call connectors freely. The optimization is in **what** they ask for. Without graph context, agents scatter-gather: query every connector speculatively, get back noise, bloat context, pick the wrong resource. With graph context, every connector call is targeted.

**Without graph coordinates:**
```
Agent → Datadog: "find dashboards for payments issues"  → 40 results, read all, wrong one picked
Agent → K8s: "list all namespaces"                      → 30 namespaces, scan all, context bloated
Agent → GitHub: "search repos for payments"             → 12 repos, guess which one
```
Context bloat. Wrong resources. Rot.

**With graph coordinates:**
```
Graph resolves "payments-api" →
  connectorCoordinates = {
    github:    { repo: "org/payments" },
    k8s:       { namespace: "prod", selector: "app=payments-api" },
    datadog:   { service: "payments-api", dashboard_id: "abc-123" },
    linear:    { project: "PAYMENTS", team_id: "team-xyz" },
    argocd:    { app: "payments-api", env: "prod" },
    pagerduty: { service_id: "SVC-999" }
  }

Agent → Datadog: getMetrics({ service: "payments-api", window: "1h" })   // targeted
Agent → GitHub:  getPRs({ repo: "org/payments", limit: 5 })              // targeted
Agent → K8s:     getPods({ namespace: "prod", selector: "app=payments-api" })  // targeted
```
Three calls. Exact data. No bloat.

**The pattern:**
1. Graph `resolveContext(entity)` → `AgentContext` with `connectorCoordinates`
2. Agent uses coordinates to make targeted connector calls
3. If coordinate missing for a connector → agent can still call that connector speculatively, but logs the gap and queues a graph bootstrap to fix it for next time
4. This is the optimization — agents are not blocked, they are guided

**`connectorCoordinates`** maps connector type → graph-resolved resource identifiers. Bootstrap populates these. Richer bootstrap = more targeted agents = less context bloat.

```typescript
interface AgentContext {
  primaryEntity: Entity
  relatedEntities: Entity[]
  relationships: Relationship[]
  recentEpisodes: Episode[]
  connectorCoordinates: Record<string, ConnectorCoordinates>  // targeted call map
  groundingSources: GroundingSource[]
  freshness: number
}

interface ConnectorCoordinates {
  connectorType: string
  resourceIds: Record<string, string>   // { repo: "org/payments", dashboard_id: "abc-123" }
  resolvedAt: Date
  confidence: number   // < 0.7 = treat as hint, agent can still use but should verify
}
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
| **Graph Builder Agent** | Owns the Knowledge Graph. Runs on connector lifecycle events. Extracts entities, resolves relationships, populates connector coordinates. Never called by users — event-driven only. |
| **Product Agent** | Writes PRD from conversation |
| **TechSpec Agent** | Writes tech spec from PRD |
| **Bootstrap Agent** | Scaffolds service/feature in codebase |
| **Test Agent** | Writes tests, regression on demand |
| **Review Agent** | Code review, one-pass findings + test plan |
| **Deploy Agent** | Triggers deploy pipeline |
| **SRE Agent** | Monitors metrics, alerts, root cause traces |
| **Connector Agents** | One per datasource — each operates within declared capability manifest |

---

## Graph Builder Agent

The only agent responsible for building and maintaining the Software Intelligence Graph. Never called by users or the orchestrator on-demand. Runs exclusively in response to connector lifecycle events.

**Trigger events:**

| Event | What Graph Builder does |
|-------|------------------------|
| `connector_registered` | Full bootstrap: crawl entire connector, extract all entities + relationships, seed graph |
| `connector_reconnected` | Re-bootstrap: diff against existing graph, add new entities, update changed ones |
| `project_created` | Seed Project entity, link to Team via connector metadata |
| `repo_created` | Seed Repo entity, parse CODEOWNERS → Team, extract language/stack |
| `namespace_created` | Seed Namespace entity, scan services in namespace → Service→HOSTED_IN→Namespace |
| `resource_added` (cloud) | Extract tags/labels → resolve owning Service, Team; create cloud resource entity |
| `team_changed` | Update Team entity, re-resolve Team→ONCALL→Engineer edges |
| `oncall_rotation` | Update Team→ONCALL→Engineer edge (point-in-time, keep history) |
| `service_deployed` | Create/update Deploy entity, create Deploy→DEPLOYED_TO→Service |
| `pr_merged` | Create Commit entity, link to Repo, extract "fixes #N" → Commit→FIXES→Ticket |
| `ticket_created` | Create Ticket entity, run service resolution (LLM extract + fuzzy match) |
| `incident_created` | Create Incident entity, link to Alert that fired it |
| `connector_capability_changed` | Re-index connector coordinates for all entities sourced from that connector |

**How it works:**

```
Event arrives on EventBus
  → Graph Builder Agent wakes (Trigger.dev job)
  → Reads event payload
  → Calls connector (read-only, perimeter-scoped) to fetch related entities
  → Cheap model: extract entity names, relationships, connector coordinates from payload
  → Upsert entities into StructuralGraph (idempotent — merge on id + tenant_id)
  → Upsert relationships
  → Emit episode to Graphiti (episodic layer) with raw event text
  → Write connector coordinates to AgentContext store
  → Emit `graph:updated` event (downstream agents can invalidate cached contexts)
  → Audit log: what was extracted, from which connector, confidence scores
```

**Cheap model for extraction** — Graph Builder uses the cheap model tier (Haiku / gpt-4o-mini) for:
- Extracting service names from ticket text
- Fuzzy-matching names to known entities
- Parsing "fixes #123" commit messages into Ticket references
- Inferring relationships from unstructured metadata (k8s labels, cloud tags)

Expensive model is never used by Graph Builder. All inputs are structured events — cheap model is sufficient.

**Idempotency contract:** running Graph Builder twice on the same event produces identical graph state. No duplicates. `upsertEntity` and `upsertRelationship` are merge operations.

**Confidence scoring:**
- Explicit metadata (CODEOWNERS file, k8s label `app=payments-api`) → confidence 1.0
- LLM extraction from ticket text → confidence 0.6–0.9 depending on match quality
- Fuzzy name match only → confidence 0.5–0.7
- Confidence < 0.7 on any relationship → stored with `unconfirmed: true`, surfaced in KB view for human confirmation

**What Graph Builder does NOT do:**
- Respond to users
- Make write actions on connectors
- Run on user queries (graph is pre-built, not query-time)
- Block the query path — graph updates are async, always

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
- **Go** — collection runner, FSM, high-throughput connector agents where TypeScript is a bottleneck

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

### Model tier strategy — henchmen + coordinator

Cheap models do the work. Expensive models coordinate and verify. Never route to the expensive model when the cheap model is sufficient.

```
Cheap model (Haiku / gpt-4o-mini / gemini-flash)     — henchmen
  intent classification, connector summarisation, payload trimming,
  tool result extraction, routing decisions, handoff assembly,
  no-progress detection, "needs fresh context?" classifier

Expensive model (Opus / GPT-4o / Sonnet)              — coordinator + verifier
  final user-facing response, root cause hypothesis,
  cross-connector multi-hop reasoning, write action verification,
  gate approval decisions, security analysis
```

Verification fires only when: confidence < threshold OR action is a write OR query is complex analysis. Not on every call.

The harness must route per call, not per session. `createOrchestrator` and `createSpecialistAgent` both accept a model tier config, not a single model.

---

### Non-negotiable: model-agnostic, no vendor lock-in

The harness must not be coupled to any single LLM provider. Users bring their own models — Anthropic, OpenAI, Groq, Mistral, Ollama, LM Studio, or any OpenAI-compatible endpoint. Swapping the model must require only a config change, not a code change.

The harness abstracts over providers via a typed interface:

```typescript
interface IModelProvider {
  chat(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): Promise<ChatResponse>
  stream(messages: Message[], tools: ToolDefinition[], opts: InferenceOptions): AsyncIterator<StreamChunk>
}

interface IEmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}
```

Provider implementations (`AnthropicProvider`, `OpenAIProvider`, `GroqProvider`, `MistralProvider`, `OllamaProvider`) live in `packages/agent/providers/`. Orchestrator and agents call `IModelProvider` — never a provider SDK directly.

### Harness decision — Mastra with wrappers (locked)

**Mastra** is the harness implementation. Decision locked after evaluation against all six requirements.

| Requirement | Mastra verdict |
|-------------|---------------|
| Model-agnostic | ✓ Native multi-provider. Anthropic, OpenAI, Groq, Mistral, Ollama, any OpenAI-compatible |
| Deterministic perimeter | ✓ Tool call lifecycle hooks — `onToolCall` middleware runs before result returns to LLM |
| Full audit hook on every tool call | ✓ Same lifecycle hook wires the audit sink |
| Human-in-loop gate insertable at any step | ✓ Built-in `waitForInput` / suspend-resume primitives |
| Streaming passthrough to SSE without buffering | ✓ Native streaming, SSE-compatible |
| Multi-agent context handoff with typed contracts | ✓ Typed agent-to-agent handoff, shared context object |

**Wrapper layer (`packages/agent`):**

Mastra handles the agent lifecycle. Two thin wrappers sit on top — neither is optional:

1. **Perimeter middleware** — every tool call passes through `perimeterCheck(call, userPerimeter)` before Mastra executes it. Hard block if outside scope. Wired into Mastra's `onToolCall` hook.
2. **Token metering middleware** — every call increments counters in `TokenBudget`. If per-query, per-session, or per-tenant limit is exceeded, call is blocked before reaching the LLM. Wired into Mastra's `onModelCall` hook.

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

**Accepted deviation (2026-06-08):** The orchestrator (`orchestrator.ts`) and specialist agent (`specialist-agent.ts`) use a hand-rolled agentic loop instead of Mastra's native lifecycle hooks. This loop satisfies four of six locked requirements: model-agnostic streaming, perimeter middleware on every tool call, full audit hook, and typed multi-agent context handoff. Two differ from the Mastra plan:

1. **Gate (waitForInput):** Implemented as `IGateSink` + `pollGate()` inline — functionally equivalent to Mastra's `waitForInput` primitive. Yields `gate_required` StreamEvent; polls Redis-backed sink until user approves. Timeout-configurable.
2. **Token meter (onModelCall):** Token budget checks run inline in the agent loop before each model call — equivalent protection, same hard-block semantics.

**Rationale:** The hand-rolled loop:
- Avoids coupling to Mastra's internal lifecycle API which has changed across major versions
- Keeps `IModelProvider` as the sole surface — zero Mastra types exposed to callers
- Is simpler to audit (single source file, explicit control flow)
- Preserves the 4/6 requirement coverage the code review confirmed

**The harness itself remains replaceable.** Mastra is the first concrete implementation behind `IModelProvider`. If a future Mastra version adds lifecycle hooks that materially improve correctness over the inline approach, the loop can migrate. The wrappers (`perimeter.ts`, `token-meter.ts`) are the same regardless of which framework runs underneath.

```typescript
createOrchestrator({ model: IModelProvider, tools, perimeter, auditSink })
createSpecialistAgent({ name, model: IModelProvider, tools, systemPrompt })
createGate({ condition, approvers, autoApproveThreshold })
runSession(orchestrator, input, context) → AsyncIterator<StreamEvent>
```

All surface functions accept `IModelProvider` — never Mastra types or a concrete provider class directly.

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

**Scheduling:** Use a durable scheduler (not in-process `setInterval`). Locked decision:

1. **Trigger.dev** — OSS (Apache 2.0), self-hosted, TypeScript-native, background jobs + crons + event-driven. Primary. Runs in Docker alongside the stack.
2. **BullMQ** — OSS (MIT), Redis-backed, battle-tested fallback if Trigger.dev adds too much ops overhead. Redis already in the stack.

Inngest: proprietary SaaS, not self-hostable — disqualified for an OSS product.

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

### Software Intelligence Graph — two-layer model

The KB is a typed graph of entities and relationships, not a flat document index. Two distinct layers:

#### Layer 1 — Structural Graph (Apache AGE / Cypher on Postgres)

Org topology. Slowly changing. Schema-driven. Seeded by connector bootstrap, updated by connector events.

**Entity types:**
```
Service     id, name, language, tier, tenant_id
Repo        id, url, default_branch, language, tenant_id
Team        id, name, slack_channel, tenant_id
Engineer    id, email, name, tenant_id
Ticket      id, external_id, title, status, severity, source_connector, tenant_id
Deploy      id, sha, version, env, status, deployed_at, tenant_id
Incident    id, title, status, severity, started_at, tenant_id
Alert       id, external_id, title, severity, fired_at, resolved_at, tenant_id
Pipeline    id, name, provider (github_actions|argocd|jenkins), tenant_id
Connector   id, type, mode (read|write|read-write), status, registered_at, tenant_id
```

**Relationship types (directed):**
```
(Service)   -[:HOSTED_IN]->    (Repo)
(Service)   -[:DEPENDS_ON]->   (Service)
(Service)   -[:OWNED_BY]->     (Team)
(Service)   -[:DEPLOYED_BY]->  (Pipeline)
(Service)   -[:MONITORED_BY]-> (Alert)
(Team)      -[:ONCALL]->       (Engineer)
(Engineer)  -[:MEMBER_OF]->    (Team)
(Deploy)    -[:DEPLOYED_TO]->  (Service)
(Deploy)    -[:INTRODUCED]->   (Commit)
(Incident)  -[:CAUSED_BY]->    (Deploy)
(Incident)  -[:AFFECTS]->      (Service)
(Alert)     -[:TRIGGERED_BY]-> (Incident)
(Ticket)    -[:RELATES_TO]->   (Service)
(Ticket)    -[:OWNED_BY]->     (Team)
(Connector) -[:PROVIDES]->     (Service)    // connector feeds data about this service
```

**Key traversal: support ticket → triage context (3 hops)**
```cypher
MATCH (t:Ticket {id: $ticketId})-[:RELATES_TO]->(s:Service)
MATCH (s)-[:HOSTED_IN]->(r:Repo)
MATCH (s)-[:OWNED_BY]->(team:Team)-[:ONCALL]->(eng:Engineer)
OPTIONAL MATCH (s)<-[:DEPLOYED_TO]-(d:Deploy)
  WHERE d.deployed_at > datetime() - duration('P7D')
RETURN s, r, team, eng, collect(d) AS recent_deploys
```

This is the graph that lets an SRE agent answer "ticket #1234 → which service → which repo → who owns it → what changed recently" without touching a single connector at query time.

**Storage: Apache AGE on Postgres** (already in stack, zero new service). AGE brings Cypher to Postgres via an extension. Handles org-scale graphs (100-1000 services) comfortably. Swap to KùzuDB only when traversal benchmarks as bottleneck.

---

#### Layer 2 — Episodic Graph (Graphiti + Apache AGE)

Temporal facts extracted from connector events. Fast-changing. Every fact has `valid_from`/`valid_to`.

```
Deploy event        → episode: "payments-api v2.3 deployed to prod at 14:32"
Alert event         → episode: "error rate spike 8% on payments-api at 14:35"
PR merged           → episode: "PR#441 merged to payments-api, changed billing logic"
Ticket created      → episode: "ticket #1234 opened: checkout failures since 14:30"
```

Graphiti extracts entities and relationships from these events and populates Layer 1, keeping it current. Agents query Layer 2 for temporal reasoning: "what changed in the last hour before the alert?"

**Cross-language note:** Graphiti is a Python library. Episodic graph writes go through `apps/agent-service` (Python FastAPI). TypeScript orchestrator calls the agent-service HTTP API for episodic queries — not direct DB access.

---

#### Connector Bootstrap Contract

Every connector registered in Anvay MUST provide a bootstrap implementation. This is non-negotiable — no connector ships without it.

**Bootstrap runs on:** `connector_registered` event AND `connector_reconnected` event.

```typescript
interface IConnectorBootstrap {
  // Called once on connector registration. Returns extracted entities + relationships.
  bootstrap(connector: ConnectorConfig): Promise<GraphSeed>
}

interface GraphSeed {
  entities: EntitySpec[]
  relationships: RelationshipSpec[]
  episodeHints: string[]  // free-text events for Graphiti extraction
}
```

**What each connector bootstraps:**

| Connector | Entities extracted | Relationships inferred |
|-----------|-------------------|----------------------|
| GitHub | Repo, Engineer (committers), Team (CODEOWNERS) | Service→HOSTED_IN→Repo, Engineer→MEMBER_OF→Team |
| Linear | Ticket, Team | Ticket→RELATES_TO→Service (from labels/mentions), Ticket→OWNED_BY→Team |
| PagerDuty | Engineer, Team | Team→ONCALL→Engineer |
| ArgoCD | Deploy, Pipeline | Deploy→DEPLOYED_TO→Service |
| Datadog | Alert, Dashboard | Alert→TRIGGERED_BY→Incident, Service→MONITORED_BY→Alert |
| K8s | Service (running pods) | Service→DEPENDS_ON→Service (from service discovery) |

After bootstrap, connector registers event subscriptions for ongoing graph updates.

---

#### Event-driven graph updates

Graph evolves continuously. Every connector event is a potential graph mutation:

```
github:push(repo, sha)          → update Repo entity, add Commit episode
github:pr_merged(repo, pr)      → create/update Deploy relationship chain
argocd:deploy_completed(app)    → create Deploy entity, Deploy→DEPLOYED_TO→Service
datadog:alert_fired(service)    → create Alert entity, Alert→TRIGGERED_BY→Incident
linear:ticket_created(ticket)   → create Ticket entity, resolve Ticket→RELATES_TO→Service
pagerduty:oncall_change(user)   → update Team→ONCALL→Engineer edge
connector_added(connector)      → run bootstrap, seed all entities from new connector
```

Relationship resolution on ticket creation (the hard part):
1. Extract service mentions from ticket title/description (LLM extraction, cheap model)
2. Match against known Service entities by name fuzzy match
3. If no match: fall back to team label on ticket → Team→OWNS→Service lookup
4. Create `Ticket→RELATES_TO→Service` edge with confidence score
5. Low confidence (< 0.7): flag for human confirmation, still store with `unconfirmed: true`

---

#### Agent context injection

Agents never query the structural graph directly. The orchestrator resolves context before routing to any specialist agent:

```typescript
// packages/agent/src/interfaces/knowledge-graph.ts

interface IKnowledgeGraph {
  // Episode layer (Graphiti)
  addEpisode(episode: Episode): Promise<void>
  getFacts(query: string, at?: Date): Promise<Fact[]>

  // Structural layer (AGE / Cypher)
  getEntity(id: string): Promise<Entity>
  getRelationships(entityId: string, type?: string): Promise<Relationship[]>

  // Context resolution — multi-hop traversal, returns agent-ready context block
  resolveContext(entityId: string, depth?: number): Promise<AgentContext>

  // Semantic search across both layers
  search(query: string, topK: number): Promise<KBEntry[]>
}

interface AgentContext {
  primaryEntity: Entity
  relatedEntities: Entity[]
  relationships: Relationship[]
  recentEpisodes: Episode[]                              // last 24h of temporal facts
  connectorCoordinates: Record<string, ConnectorCoordinates>  // graph-resolved resource IDs per connector
  groundingSources: GroundingSource[]
  freshness: number                                      // min freshness across all sources
}
```

`resolveContext` is the single call the orchestrator makes before injecting into any agent prompt. Agents receive a grounded, freshness-scored, relationship-rich context block including graph-resolved connector coordinates. Agents use coordinates to make targeted connector calls — not scatter-gather discovery.

---

### Storage architecture

```
Session memory    Redis (TTL = session lifetime, auto-evict)

Structural graph  Apache AGE on Postgres
                  Typed entities + relationships (Cypher queries)
                  Seeded by bootstrap, updated by connector events
                  KùzuDB as swap target if traversal benchmarks as bottleneck

Episodic graph    Graphiti + Neo4j (Graphiti library requires Neo4j for episodic operations)
                  Temporal facts with valid_from/valid_to
                  Written via agent-service (Python), read via HTTP from TS orchestrator
                  FalkorDB disqualified (RSAL).
                  **Accepted deviation (2026-06-08):** Neo4j is required by the Graphiti
                  library — its current stable backend is Neo4j (not Apache AGE). Apache AGE
                  remains for structural graph (Layer 1). Episodic layer (Layer 2) uses Neo4j
                  via Graphiti. This is a library constraint, not a design choice. If Graphiti
                  adds Postgres/AGE support in a future release, Ne4j can be swapped without
                  code changes — IKnowledgeGraph interface stays the same.

Semantic search   pgvector on Postgres (same instance)
                  HNSW index on kb_entries.embedding
                  No dedicated vector DB until benchmarks demand it

Cache             Redis (hot graph entries, connector sync results, TTL-based)
```

### Memory systems — locked decisions

Two separate concerns, two separate solutions. **Both behind interfaces — implementations are swappable without touching agent or business logic.**

#### Interface contract (non-negotiable)

```typescript
// packages/agent/src/interfaces/memory.ts

interface ISessionMemory {
  get(sessionId: string): Promise<SessionContext>
  append(sessionId: string, turn: ConversationTurn): Promise<void>
  summarise(sessionId: string): Promise<void>  // compress old turns
  clear(sessionId: string): Promise<void>
}

interface IKnowledgeGraph {
  addEpisode(episode: Episode): Promise<void>           // event from connector
  getFacts(query: string, at?: Date): Promise<Fact[]>   // temporal: facts valid at time T
  getEntity(id: string): Promise<Entity>
  getRelationships(entityId: string, type?: string): Promise<Relationship[]>
  search(query: string, topK: number): Promise<KBEntry[]>  // semantic + graph
}
```

Agent code imports `ISessionMemory` and `IKnowledgeGraph`. Never a concrete class. Config determines which implementation loads at startup. Swap = change one line in DI config, no agent code changes.

#### Locked implementations (first pass)

**Session memory:** `RedisSessionMemory implements ISessionMemory`
- Redis + rolling summary. ~50 lines. Zero new dependency — Redis already in stack.
- TTL = session lifetime, auto-evict.

**KB / project / org memory:** `GraphitiKnowledgeGraph implements IKnowledgeGraph`
- Graphiti (Zep, Apache 2.0) for temporal graph logic (episode extraction, fact validity window, relationship traversal)
- Apache AGE as graph storage backend (Cypher on Postgres — zero new service)
- Why Graphiti: temporal `valid_from`/`valid_to` on facts directly solves context rot. Mem0 is flat — no relationships, no temporal graph. Wrong fit for a graph-first KB.

#### Swap path if AGE underperforms

```
IKnowledgeGraph
  └── GraphitiKnowledgeGraph (current — Graphiti + Apache AGE on Postgres)
  └── GraphitiKnowledgeGraph (future — Graphiti + KùzuDB if AGE traversal is bottleneck)
  └── NativeGraphKnowledge  (fallback — bespoke Postgres adjacency + pgvector if Graphiti doesn't fit)
```

All three implement the same interface. Agent code unchanged.

| Scope | Implementation | OSS |
|-------|---------------|-----|
| Session memory | `RedisSessionMemory` | ✓ |
| KB / project / org | `GraphitiKnowledgeGraph` (AGE backend) | ✓ |

**Why not a dedicated vector DB (Qdrant/Pinecone)?**
pgvector on Postgres sufficient at org scale. Dedicated vector DB adds ops cost before data volume justifies it. Switch when benchmarks demand it.

**Full stack:**
```
Session     Redis          (TTL, ephemeral, in-process for prototype)
Knowledge   Postgres       (entities, relationships, freshness scoring)
            + pgvector     (semantic retrieval over derived knowledge)
Cache       Redis          (hot entries, connector sync results, TTL-based eviction)
Events      Redis Pub/Sub  (already in stack, zero ops cost)
            Postgres       (event log, invalidation triggers, durable record)
            → Kafka        (upgrade when: >10 connectors concurrent + need durable replay)
```

### Implementation notes (not yet built)

- **Sync layer**: connector agents push events into KB on schedule + on-demand per query
- **Context injection**: orchestrator retrieves relevant KB subgraph per query, injects as grounded context into agent prompts — relevance-ranked, not raw dump
- **Freshness daemon**: background job scores all KB entries, triggers re-sync on decay below threshold
- **Do not build now** — prototype uses mock data. KB + storage is the next major backend milestone after harness is established.

---

## Next.js Version Note

**Read `apps/web/node_modules/next/dist/docs/` before writing any Next.js code.** Breaking changes from training data. `middleware` → `proxy`.
