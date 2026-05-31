# Anvay — Project Context for Claude Code

## What This Is

Anvay is the **central nervous system of a software organisation**.

Every team already has GitHub, Datadog, Linear, K8s, Loki, Prometheus, Jira, ArgoCD, PagerDuty, Terraform, Coralogix — they never talked to each other. Anvay connects all of them as datasources, builds intelligence on top, and gives every person in the org one surface to query, act, and govern the entire software lifecycle.

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

## Autonomy Dial (per service)

- **L1 Assist** — AI suggests, human does everything
- **L2 Approve** — AI generates, human approves before execution
- **L3 Supervise** — AI executes, human can interrupt
- **L4 Autonomous** — AI executes within policy bounds, async audit only

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

### Next Steps
1. Build `OrchestratorChat` — primary surface, role-aware, shows agent routing live
2. Wire `EditorView` into `page.tsx`
3. Build `WorkflowView` — autonomy dial, gate config, agent loop visualizer
4. Add orchestrator + workflow mock data to `lib/mock.ts`

### Nav Order
1. Chat (orchestrator — primary surface)
2. Lifecycle (PRD→Metrics graph)
3. Editor (one-window coding)
4. Workflows (hook + gate config)
5. API Client
6. Connectors
7. K8s

---

## Running

```bash
cd apps/web
npm install
npm run dev
# http://localhost:3000
```

Active branch: `claude/claude-md-docs-k210H`

## Next.js Version Note

**Read `apps/web/node_modules/next/dist/docs/` before writing any Next.js code.** Breaking changes from training data. `middleware` → `proxy`.
