"use client";

import { useState } from "react";
import Link from "next/link";

function AnwayMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.95} viewBox="0 0 100 95" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Left leg */}
      <path d="M0 95 L14 95 L50 8 L38 8 Z" fill="#10b981" />
      {/* Right leg */}
      <path d="M62 8 L50 8 L86 95 L100 95 Z" fill="#10b981" />
      {/* ECG crossbar wave */}
      <path d="M32 52 L38 52 L43 35 L48 65 L53 42 L58 52 L68 52"
        stroke="#10b981" strokeWidth="5" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const connectors: Record<string, string[]> = {
  All: [],
  Observability: ["Prometheus", "Grafana", "Datadog", "Loki", "New Relic", "Elastic", "Dynatrace", "Coralogix"],
  Deploy: ["ArgoCD", "Jenkins", "CircleCI", "Vercel", "Terraform"],
  Code: ["GitHub"],
  Cloud: ["AWS CloudWatch", "AWS Health", "GCP Monitoring", "Azure Monitor", "EKS", "GKE"],
  Incident: ["PagerDuty", "OpsGenie"],
  Project: ["Linear", "Jira", "Confluence", "Notion"],
  Security: ["Snyk", "SonarQube", "Vault", "LaunchDarkly"],
};

function getAllConnectors(): string[] {
  const seen = new Set<string>();
  for (const list of Object.values(connectors)) {
    for (const c of list) seen.add(c);
  }
  return [...seen].sort();
}

const FEATURES = [
  { icon: "◎", title: "Single surface", body: "One orchestrator. No switching between tools." },
  { icon: "⬡", title: "33+ connectors", body: "GitHub, Datadog, K8s, Linear, PagerDuty, ArgoCD, Sentry, and more." },
  { icon: "◈", title: "Software Intelligence Graph", body: "Every service, team, deploy, and incident — mapped and queryable." },
  { icon: "⊕", title: "Deterministic access perimeter", body: "Hard rule engine. Not probabilistic. Zero AI guesswork on permissions." },
  { icon: "◐", title: "Role-aware responses", body: "SRE, PM, BA, Dev — same query, right answer for each role." },
  { icon: "↺", title: "Multi-repo sessions", body: "Span N repos in one thread. Context maintained end-to-end." },
  { icon: "⋈", title: "Human loop anywhere", body: "Insert approval gates at any step. Configurable per team or service." },
  { icon: "◷", title: "Follow-up chaining", body: "'Why broken?' → 'Write the test' — one thread, full context." },
  { icon: "≡", title: "Full audit trail", body: "Every query, action, and gate decision. Immutable." },
  { icon: "◑", title: "Proactive intelligence", body: "Cron monitors sweep your stack overnight. Morning brief ready." },
  { icon: "⬘", title: "Event-driven automation", body: "Alert fires → runbook executes → incident opened. Fully wired." },
  { icon: "⊙", title: "Confidence-gated autonomy", body: "Score 0–1. >0.9 auto-passes. Below threshold: human approval." },
];

const ROLES = [
  { icon: "◎", role: "SRE / Oncall", query: '"Alert fired — what\'s the trail?"', body: "Root cause traced across logs, metrics, deploys, and PRs. In seconds, not hours." },
  { icon: "◈", role: "Product Manager", query: '"Status of Feature X?"', body: "Lifecycle graph, Linear tickets, PRs, and deploy state — aggregated into one answer." },
  { icon: "◐", role: "Business Analyst", query: '"How is this user journey performing?"', body: "Metrics, events, and funnel data pulled and analysed in plain language." },
  { icon: "↺", role: "Developer", query: '"Why is this issue happening?"', body: "Multi-repo session, root cause surfaced, regression test written — all in one thread." },
];

const TRUST_LEVELS = [
  { name: "L1 Assist", desc: "Anway reads and suggests. You act manually.", active: false },
  { name: "L2 Approve", desc: "Anway shows the action + gate. You confirm. Anway executes.", active: true, badge: "V1" },
  { name: "L3 Supervise", desc: "Anway executes, you can interrupt. Unlock per-service after trust is established.", active: false },
  { name: "L4 Autonomous", desc: "Anway executes within policy bounds. Unlock explicitly — never default.", active: false },
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function LandingPage() {
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const allConnectors = getAllConnectors();
  const filteredConnectors = activeCategory === "All" ? allConnectors : connectors[activeCategory] ?? [];
  const categories = Object.keys(connectors);

  return (
    <div style={{
      background: "#080808", color: "#e5e5e5", fontFamily: "system-ui, -apple-system, sans-serif",
      height: "100%", overflowY: "auto", scrollBehavior: "smooth",
    }}>
      {/* Section 1 — Nav */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50, background: "rgba(8,8,8,0.92)",
        borderBottom: "1px solid #1a1a1a", backdropFilter: "blur(12px)",
        padding: "0 48px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <AnwayMark size={32} />
          <span style={{ color: "#10b981", fontSize: "20px", fontWeight: 700, letterSpacing: "-0.5px" }}>anway</span>
        </div>
        <div style={{ display: "flex", gap: "32px" }}>
          {["demo", "flow", "features", "connectors", "roles", "trust"].map((s) => (
            <button key={s} onClick={() => scrollTo(s)}
              style={{ color: "#888", fontSize: "14px", textDecoration: "none", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#e5e5e5"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <Link href="/" style={{
          background: "#10b981", color: "#000", fontWeight: 600, padding: "10px 20px",
          borderRadius: "6px", fontSize: "14px", textDecoration: "none",
        }}>
          Open Dashboard &rarr;
        </Link>
      </nav>

      {/* Section 2 — Hero */}
      <section style={{ padding: "120px 48px 80px", textAlign: "center", maxWidth: 860, margin: "0 auto" }}>
        <div style={{
          display: "inline-block", border: "1px solid #1a1a1a", borderRadius: "20px",
          padding: "4px 14px", fontSize: "12px", color: "#10b981", letterSpacing: "0.08em",
          textTransform: "uppercase", marginBottom: "32px",
        }}>
          Central Software Operations
        </div>
        <h1 style={{
          fontSize: "clamp(36px,6vw,72px)", fontWeight: 700, color: "#e5e5e5",
          lineHeight: 1.08, letterSpacing: "-2px", margin: "0 0 24px",
        }}>
          The central nervous<br />system of your<br />software org
        </h1>
        <p style={{ fontSize: "18px", color: "#888", lineHeight: 1.6, maxWidth: "560px", margin: "0 auto 40px" }}>
          Every tool your team uses — GitHub, Datadog, Kubernetes, Linear, PagerDuty —
          connected. One surface to query, act, and govern the entire lifecycle.
        </p>
        <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" style={{
            background: "#10b981", color: "#000", fontWeight: 700, padding: "14px 28px",
            borderRadius: "6px", fontSize: "16px", textDecoration: "none",
          }}>
            Open Dashboard &rarr;
          </Link>
          <button onClick={() => scrollTo("how-it-works")} style={{
            border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "14px 28px",
            borderRadius: "6px", fontSize: "16px", background: "none", cursor: "pointer",
          }}>
            See how it works ↓
          </button>
        </div>

        {/* Terminal trace */}
        <div style={{
          background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px",
          padding: "24px", maxWidth: "720px", margin: "64px auto 0",
          fontFamily: "monospace", fontSize: "13px", textAlign: "left",
        }}>
          <div style={{ color: "#10b981" }}>&#9673; Query received: "payments-api is down"</div>
          <div style={{ color: "#555" }}>&nbsp;&nbsp;&rarr; classifying intent &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "#e5e5e5" }}>[incident_triage]</span></div>
          <div style={{ color: "#555" }}>&nbsp;&nbsp;&rarr; resolving entity &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span style={{ color: "#e5e5e5" }}>[payments-api]</span></div>
          <div style={{ color: "#555" }}>&nbsp;&nbsp;&rarr; graph: 6 connector coordinates resolved</div>
          <div style={{ color: "#10b981" }}>&nbsp;&nbsp;&#10003; github &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span style={{ color: "#e5e5e5" }}>PRs in last 2h: #441 merged — billing logic change</span></div>
          <div style={{ color: "#10b981" }}>&nbsp;&nbsp;&#10003; argocd &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span style={{ color: "#e5e5e5" }}>v2.3.0 deployed 14m ago — suspect</span></div>
          <div style={{ color: "#10b981" }}>&nbsp;&nbsp;&#10003; datadog &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span style={{ color: "#e5e5e5" }}>error rate 8.2% &uarr; (baseline 0.3%)</span></div>
          <div style={{ color: "#10b981" }}>&nbsp;&nbsp;&#10003; k8s &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span style={{ color: "#e5e5e5" }}>3/4 pods Ready, 1 CrashLoopBackOff</span></div>
          <div style={{ color: "#10b981" }}>&nbsp;&nbsp;&#10003; pagerduty &nbsp;&nbsp;&nbsp; <span style={{ color: "#e5e5e5" }}>P1 alert firing since 14:35</span></div>
          <div style={{ color: "#10b981" }}>&nbsp;&nbsp;&#10003; linear &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span style={{ color: "#e5e5e5" }}>Ticket #1204 open — checkout failures</span></div>
          <div style={{ color: "#555" }}>&rarr; synthesising root cause...</div>
          <div style={{ color: "#10b981", marginTop: "8px" }}>&#9673; Root cause: deploy v2.3.0 introduced regression in billing handler.</div>
          <div style={{ color: "#10b981" }}>&nbsp;&nbsp;Recommended action: rollback to v2.2.8 &nbsp;<span style={{ color: "#10b981", border: "1px solid #10b981", padding: "2px 8px", borderRadius: "4px" }}>Confirm &rarr;</span></div>
        </div>
      </section>

      {/* Section 3 — Problem (Before / After) */}
      <section id="problem" style={{ padding: "100px 48px", background: "#080808" }}>
        <h2 style={{ fontSize: "32px", color: "#e5e5e5", textAlign: "center", marginBottom: "60px", fontWeight: 700 }}>
          Before Anway, every boundary is a context switch.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px", maxWidth: "900px", margin: "0 auto" }}>
          {/* Before */}
          <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "40px" }}>
            <div style={{ color: "#ef4444", fontSize: "11px", letterSpacing: "0.1em", marginBottom: "16px", fontWeight: 700 }}>
              BEFORE
            </div>
            <div style={{ fontFamily: "monospace", color: "#555", fontSize: "14px", lineHeight: 2 }}>
              <div>Product &larr;&#x2014;&#x2014;&rarr; Engineering</div>
              <div>Engineering &larr;&#x2014;&#x2014;&rarr; SRE</div>
              <div>SRE &larr;&#x2014;&#x2014;&rarr; Cloud</div>
              <div style={{ color: "#333", fontSize: "12px", marginTop: "8px" }}>(siloed, context lost at every boundary)</div>
            </div>
            <div style={{ marginTop: "24px", color: "#555", fontSize: "14px", lineHeight: 1.8 }}>
              <div>- &quot;Alert fires &rarr; SRE starts from scratch</div>
              <div>- &quot;PM asks status &rarr; developer context-switches</div>
              <div>- &quot;Deploy breaks &rarr; root cause takes hours</div>
            </div>
          </div>
          {/* After */}
          <div style={{ background: "#0a0a0a", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "8px", padding: "40px" }}>
            <div style={{ color: "#10b981", fontSize: "11px", letterSpacing: "0.1em", marginBottom: "16px", fontWeight: 700 }}>
              WITH ANWAY
            </div>
            <div style={{ fontFamily: "monospace", color: "#10b981", fontSize: "14px", lineHeight: 2 }}>
              <div>Product &larr;&#x2014;&#x2014; Anway &#x2014;&#x2014;&rarr; Engineering</div>
              <div>Engineering &larr;&#x2014;&#x2014; Anway &#x2014;&#x2014;&rarr; SRE</div>
              <div>SRE &larr;&#x2014;&#x2014; Anway &#x2014;&#x2014;&rarr; Cloud</div>
              <div style={{ color: "#10b981", fontSize: "12px", marginTop: "8px", opacity: 0.7 }}>(one nervous system, context preserved end-to-end)</div>
            </div>
            <div style={{ marginTop: "24px", color: "#888", fontSize: "14px", lineHeight: 1.8 }}>
              <div>- &quot;Alert fires &rarr; root cause in seconds</div>
              <div>- &quot;PM asks &rarr; live status from every connector</div>
              <div>- &quot;Deploy breaks &rarr; Anway traces the cause</div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4 — How it works */}
      <section id="how-it-works" style={{ padding: "100px 48px", background: "#0a0a0a" }}>
        <h2 style={{ fontSize: "32px", color: "#e5e5e5", textAlign: "center", marginBottom: "12px", fontWeight: 700 }}>
          How Anway works
        </h2>
        <p style={{ color: "#555", textAlign: "center", marginBottom: "64px" }}>
          Graph-first intelligence. Every answer is grounded in live data.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", maxWidth: "900px", margin: "0 auto" }}>
          {[
            { step: "01", title: "Connect your tools", body: "Register any connector in 5 minutes. GitHub, Datadog, Kubernetes, Linear, PagerDuty, ArgoCD, and 30 more." },
            { step: "02", title: "Graph builds automatically", body: "Anway crawls every connector, extracts entities and relationships, and builds a live Software Intelligence Graph. Every service, team, deploy, and incident — mapped." },
            { step: "03", title: "One surface for everything", body: "Query in plain language. Anway resolves context from the graph, queries connectors with precision, and surfaces root cause — not noise." },
          ].map((s) => (
            <div key={s.step} style={{ background: "#080808", border: "1px solid #1a1a1a", padding: "36px", borderRadius: "8px" }}>
              <div style={{ color: "#10b981", fontSize: "11px", fontWeight: 700, marginBottom: "16px" }}>{s.step}</div>
              <div style={{ color: "#e5e5e5", fontSize: "20px", fontWeight: 600, marginBottom: "8px" }}>{s.title}</div>
              <div style={{ color: "#555", fontSize: "14px", lineHeight: 1.6 }}>{s.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 4b — Demo Video */}
      <section id="demo" style={{ padding: "100px 48px", background: "#080808" }}>
        <h2 style={{ fontSize: "32px", color: "#e5e5e5", textAlign: "center", marginBottom: "12px", fontWeight: 700 }}>
          Watch how it works
        </h2>
        <p style={{ color: "#555", textAlign: "center", marginBottom: "64px" }}>
          See Anway in action
        </p>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <div style={{ marginBottom: "16px", fontSize: "11px", color: "#555", textAlign: "center" }}>Product walkthrough · 3 min</div>
          <div style={{ position: "relative", paddingBottom: "56.25%", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "12px", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: "rgba(16,185,129,0.15)", border: "2px solid #10b981", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <span style={{ color: "#10b981", fontSize: "28px", marginLeft: "4px" }}>&#9654;</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4c — Agentic Flow */}
      <section id="agentic-flow" style={{ padding: "100px 48px", background: "#0a0a0a" }}>
        <h2 style={{ fontSize: "32px", color: "#e5e5e5", textAlign: "center", marginBottom: "12px", fontWeight: 700 }}>
          Agentic flow — graph-first intelligence
        </h2>
        <p style={{ color: "#555", textAlign: "center", marginBottom: "64px" }}>
          Every query follows this path. Graph first, connectors second, user last.
        </p>
        <div style={{ maxWidth: "650px", margin: "0 auto", fontFamily: "monospace", fontSize: "13px" }}>
          {[
            { color: "#10b981", label: "User Query", sub: "Plain language question from chat" },
            { color: "#10b981", label: "Orchestrator", sub: "Classifies intent · Resolves role · Enforces perimeter", highlight: false },
            { color: "#10b981", label: "Knowledge Graph resolveContext()", sub: "Entity lookup → connector coordinates · Freshness-scored context block", highlight: true },
            { color: "#10b981", label: "Parallel Specialist Agents", sub: "SRE Agent · GitHub Agent · Datadog Agent · K8s Agent ...", highlight: false },
            { color: "#888", label: "Live Connectors (targeted, not scatter-gather)", sub: "github.getPRs({repo}) · datadog.getMetrics({svc}) · k8s.getPods({ns})", highlight: false },
            { color: "#10b981", label: "Orchestrator synthesizes", sub: "Grounded response with source citations + confidence score", highlight: false },
            { color: "#888", label: "User sees answer + optional confirm gate", sub: "Write actions require explicit approval (V1 trust principle)", highlight: false },
          ].map((step, i) => (
            <div key={step.label} style={{ display: "flex", alignItems: "flex-start", marginBottom: "8px" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "24px", flexShrink: 0 }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: step.color, marginTop: "6px" }} />
                {i < 6 && <div style={{ width: "2px", flex: 1, background: "#1a1a1a", marginTop: "4px" }} />}
              </div>
              <div style={{ background: step.highlight ? "rgba(16,185,129,0.05)" : "#080808", border: step.highlight ? "1px solid #10b981" : "1px solid #1a1a1a", borderRadius: "6px", padding: "12px 16px", flex: 1, marginLeft: "8px" }}>
                <div style={{ color: step.color, fontWeight: 600, marginBottom: "4px" }}>{step.label}</div>
                <div style={{ color: "#555", fontSize: "11px" }}>{step.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </section>


      {/* Section 5 — Features */}
      <section id="features" style={{ padding: "100px 48px", background: "#080808" }}>
        <h2 style={{ fontSize: "32px", color: "#e5e5e5", textAlign: "center", marginBottom: "12px", fontWeight: 700 }}>
          Everything your org needs. One surface.
        </h2>
        <p style={{ color: "#555", textAlign: "center", marginBottom: "64px" }}>
          Built for engineering organisations that move fast and need to stay in control.
        </p>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "1px", maxWidth: "1000px", margin: "0 auto",
        }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", padding: "28px", borderRadius: "6px" }}>
              <div style={{ color: "#10b981", fontSize: "20px", marginBottom: "12px" }}>{f.icon}</div>
              <div style={{ color: "#e5e5e5", fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>{f.title}</div>
              <div style={{ color: "#555", fontSize: "13px", lineHeight: 1.6 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 6 — Connectors */}
      <section id="connectors" style={{ padding: "100px 48px", background: "#0a0a0a" }}>
        <h2 style={{ fontSize: "32px", color: "#e5e5e5", textAlign: "center", marginBottom: "12px", fontWeight: 700 }}>
          Every tool your org uses. Already connected.
        </h2>
        <p style={{ color: "#555", textAlign: "center", marginBottom: "48px" }}>
          33 connectors. More shipping every month.
        </p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginBottom: "40px", flexWrap: "wrap" }}>
          {categories.map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              style={{
                border: activeCategory === cat ? "1px solid #10b981" : "1px solid #1a1a1a",
                padding: "6px 16px", borderRadius: "4px", fontSize: "13px",
                color: activeCategory === cat ? "#10b981" : "#555",
                background: "transparent", cursor: "pointer",
              }}>
              {cat}
            </button>
          ))}
        </div>
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "8px", maxWidth: "1000px",
          margin: "0 auto", justifyContent: "center",
        }}>
          {filteredConnectors.map((c) => (
            <div key={c} style={{
              background: "#080808", border: "1px solid #1a1a1a", padding: "8px 16px",
              borderRadius: "4px", fontSize: "13px", color: "#888",
            }}>
              {c}
            </div>
          ))}
        </div>
      </section>

      {/* Section 7 — Roles */}
      <section id="roles" style={{ padding: "100px 48px", background: "#080808" }}>
        <h2 style={{ fontSize: "32px", color: "#e5e5e5", textAlign: "center", marginBottom: "12px", fontWeight: 700 }}>
          Built for every person in your org
        </h2>
        <p style={{ color: "#555", textAlign: "center", marginBottom: "64px" }}>
          Same platform. Right context for every role.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "1px", maxWidth: "1000px", margin: "0 auto" }}>
          {ROLES.map((r) => (
            <div key={r.role} style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", padding: "32px", borderRadius: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                <span style={{ color: "#10b981", fontSize: "20px" }}>{r.icon}</span>
                <span style={{ color: "#e5e5e5", fontSize: "16px", fontWeight: 600 }}>{r.role}</span>
              </div>
              <div style={{
                background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px",
                padding: "10px 14px", fontSize: "13px", color: "#10b981", fontFamily: "monospace",
                marginBottom: "16px",
              }}>
                {r.query}
              </div>
              <div style={{ color: "#555", fontSize: "14px", lineHeight: 1.6 }}>{r.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 8 — Trust */}
      <section id="trust" style={{ padding: "100px 48px", background: "#0a0a0a" }}>
        <h2 style={{ fontSize: "32px", color: "#e5e5e5", textAlign: "center", marginBottom: "12px", fontWeight: 700 }}>
          Trust is earned incrementally
        </h2>
        <p style={{ color: "#555", textAlign: "center", marginBottom: "64px" }}>
          V1 ships read-only. Every write requires your explicit confirmation.
        </p>
        <div style={{ display: "flex", maxWidth: "800px", margin: "0 auto", gap: "1px" }}>
          {TRUST_LEVELS.map((l) => (
            <div key={l.name} style={{
              flex: 1, padding: "24px", textAlign: "center",
              background: "#080808", borderRadius: "8px",
              border: l.active ? "1px solid #10b981" : "1px solid #1a1a1a",
              opacity: l.active ? 1 : 0.5,
            }}>
              <div style={{ color: "#10b981", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", marginBottom: "4px" }}>
                {l.name} {l.badge ? <span style={{ background: "#10b981", color: "#000", padding: "1px 6px", borderRadius: "3px", fontSize: "9px", marginLeft: "4px" }}>{l.badge}</span> : null}
              </div>
              <div style={{ color: "#e5e5e5", fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
                {l.name === "L1 Assist" ? "Assist" : l.name === "L2 Approve" ? "Approve" : l.name === "L3 Supervise" ? "Supervise" : "Autonomous"}
              </div>
              <div style={{ color: "#555", fontSize: "13px", lineHeight: 1.5 }}>{l.desc}</div>
            </div>
          ))}
        </div>
        <p style={{
          color: "#555", fontSize: "14px", textAlign: "center", marginTop: "40px",
          maxWidth: "560px", margin: "40px auto 0",
        }}>
          Every write shows exactly what will happen, what resource it touches, and confidence score. One click to confirm.
        </p>
      </section>

      {/* Section 9 — Footer CTA */}
      <section style={{ padding: "100px 48px", background: "#080808", borderTop: "1px solid #1a1a1a", textAlign: "center" }}>
        <div style={{ marginBottom: "24px" }}><AnwayMark size={48} /></div>
        <h2 style={{
          fontSize: "clamp(28px,4vw,48px)", fontWeight: 700, color: "#e5e5e5",
          letterSpacing: "-1px", marginBottom: "16px",
        }}>
          Ready to connect your org?
        </h2>
        <p style={{ color: "#555", fontSize: "16px", marginBottom: "40px" }}>
          One surface. Every tool. Full context.
        </p>
        <Link href="/" style={{
          background: "#10b981", color: "#000", fontWeight: 700, padding: "16px 40px",
          borderRadius: "6px", fontSize: "18px", textDecoration: "none", display: "inline-block",
        }}>
          Open Dashboard &rarr;
        </Link>
        <div style={{
          borderTop: "1px solid #1a1a1a", marginTop: "80px", paddingTop: "32px",
          display: "flex", justifyContent: "space-between", color: "#444", fontSize: "13px",
          maxWidth: "800px", margin: "80px auto 0",
        }}>
          <span>&copy; 2026 Anway &middot; anway.io</span>
          <span>Central Software Operations</span>
        </div>
      </section>
    </div>
  );
}
