# Restol — Project Context for Claude Code

## What This Is

Restol is an **AI-native end-to-end developer lifecycle harness**. The core insight: developers already have Datadog, GitHub, Linear, EKS, Coralogix, Terraform — Restol connects to all of them as data sources, never replacing them. We are a harness, not a tool.

**The wedge**: automated testing engine with human-in-the-loop gate.
- PR opened → AI reads diff → one-pass review + test plan → confidence gate → human approves → tests run → results
- Everything else (service portal, K8s lens, lifecycle graph) is additive once the testing wedge lands.

---

## Product Vision

### The Lifecycle Document Graph
A typed, traceable directed graph where every artifact is a node:

```
PRD → TechSpec → TestCase → Collection → Deployment → Metrics
```

Each node has a state machine (FSM). Transitions fire integration hooks. AI agents attach to hooks. The entire lifecycle is in one window.

### One-Window Coding
The primary surface is the **editor**. Everything else surfaces around the code:
- Code editor center
- Inline AI findings as lint annotations (line 8: ⚠ no input validation)
- Right panel: PR info, AI analysis, review findings, test plan
- Bottom gate bar: confidence score, "Approve & Run" button

### Autonomous Agent Loop
```
TRIGGER → UNDERSTAND → PLAN → [Gate A] → GENERATE → EXECUTE → EVALUATE → [Gate B] → ACT
```

- Confidence score 0.0–1.0: >0.90 auto-passes the gate, below arms human approval
- Gates are skippable per policy but audited always

### Autonomy Dial (per service)
- **L1 Assist** — AI suggests, human does everything
- **L2 Approve** — AI generates, human approves before execution (default for `payments-api`)
- **L3 Supervise** — AI executes, human can interrupt (default for `catalog-service`)
- **L4 Autonomous** — AI executes within policy bounds, async audit only

### Connector Model
Read from existing tools, write back minimal artifacts (PR status check, comment with link). Never push data into the customer's tools unless a workflow hook explicitly requires it. Connectors: Prometheus, Datadog, New Relic, GitHub, Linear, Jira, PagerDuty, EKS, GKE, AKS, ArgoCD, Terraform, Terraform Cloud, Coralogix, Loki.

---

## Architecture Decisions

### Stack
- **Rust** — core engine, CLI, WASM module. Speed is not an afterthought.
- **TypeScript** — AI/agent layer, UI. Anthropic SDK, Vercel AI SDK, streaming SSE.
- **Next.js** — UI prototype. All styles are inline (`style={{}}`) — Tailwind v4 has breaking changes from training data.
- **Monorepo** — Turborepo + pnpm. `crates/` for Rust, `apps/` for web/CLI/agent, `packages/` for shared TS.

### Rust Crate Layout (planned)
```
restol-core    — lib crate, pure logic
restol-wasm    — wasm-bindgen, same engine in browser
restol-cli     — binary, axum-based local server
restol-server  — cloud-hosted backend
```

### Why Rust for Core
The test execution engine, FSM runner, collection runner, and connector adapters need deterministic performance. WASM target means same binary runs in browser and CLI — no drift between environments.

### One-Pass AI
Code review findings + test plan generated in one context pass (not separate tool calls). Reduces latency, keeps findings coherent. Output: structured JSON with `findings[]` + `testPlan[]`.

### Collections Format
YAML-first, git-native, version-controllable. Not a proprietary binary blob. Lives next to the code it tests.

---

## Current State (Prototype)

### What's Built (`ui/` — Next.js prototype)
All mock data, no real backend. Purpose: design validation and investor/team demos.

| File | What it is |
|------|-----------|
| `ui/app/page.tsx` | App shell, sidebar nav, view switcher |
| `ui/lib/mock.ts` | All mock data (features, connectors, AI responses) |
| `ui/components/lifecycle.tsx` | PRD→Metrics horizontal stage flow |
| `ui/components/editor-view.tsx` | **One-window coding** — editor + inline findings + gate + test runner |
| `ui/components/ai-panel.tsx` | Right-side AI chat panel, streaming animation |
| `ui/components/apiclient.tsx` | API client (3-panel: collections + request builder + response) |
| `ui/components/connectors.tsx` | Connector grid with category filter, credential modal |
| `ui/app/page.tsx` (inline) | K8s placeholder view |

### What's Pending (next session picks up here)
1. **Wire `EditorView` into `page.tsx`** — add `"editor"` to NAV, import component, set as default view
2. **Create `WorkflowView`** (`ui/components/workflow-view.tsx`) — shows the state machine hooks, autonomous loop visualizer, autonomy dial per service
3. **Add workflow mock data to `lib/mock.ts`** — `WorkflowDefinition[]`, `AutonomyPolicy[]`
4. **Rust crates scaffold** — `cargo new --lib crates/restol-core`, define FSM types, connector trait
5. **Agent harness scaffold** — `apps/agent/`, Anthropic SDK, streaming handler, tool dispatch

### Nav Order (planned — tells a story top-to-bottom)
1. Editor (primary surface — write code here)
2. Lifecycle (PRD→Metrics graph)
3. Workflows (hook + gate config)
4. API Client (test surface)
5. Connectors (integrations)
6. K8s (infra lens)

---

## Key Design Principles

1. **Harness, not tool** — connect existing stack, never rip-and-replace
2. **One window** — editor is the center of gravity, everything else is context
3. **Confidence-gated autonomy** — the AI earns trust incrementally per service
4. **Git-native** — collections, specs, test cases live in the repo alongside code
5. **Speed is not an afterthought** — Rust core, WASM, streaming UI
6. **Build with AI agents** — the product is built by the same kind of harness it enables

---

## Running the Prototype

```bash
cd ui
npm install
npm run dev
# http://localhost:3000
```

Build check:
```bash
npm run build
```

The prototype uses inline styles throughout (`style={{}}`). Do not introduce Tailwind classes — the v4 config is different from training data and will break silently.

---

## Branch

Active development: `claude/claude-md-docs-k210H`

The `main` branch only has the initial commit. All prototype code is on the feature branch above.

---

## Design Language

- Background: `#080808`
- Surface: `#0a0a0a`, `#0e0e0e`, `#111`
- Border: `#1a1a1a`, `#2a2a2a`
- Accent green: `#10b981` (Emerald-500) — primary interactive color
- Text primary: `#e5e5e5`
- Text secondary: `#888`
- Text muted: `#555`, `#444`
- Error/fail: `#ef4444`
- Warning: `#f59e0b`
- Info: `#3b82f6`
- Purple: `#8b5cf6`

All components follow this palette. New components must match.
