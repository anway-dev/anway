"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

/* ————————————————————————————————————————————————————————————————
   Anway — public landing page.
   Design language (CLAUDE.md): bg #080808 · surface #0a0a0a/#0e0e0e/#111 ·
   borders #1a1a1a/#2a2a2a · accent #10b981 · text #e5e5e5/#888/#555/#444.
   Inline styles only. No Tailwind. Terminal-adjacent aesthetic.
   ———————————————————————————————————————————————————————————————— */

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const SANS = "system-ui, -apple-system, sans-serif";

function AnwayMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.95} viewBox="0 0 100 95" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 95 L14 95 L50 8 L38 8 Z" fill="#10b981" />
      <path d="M62 8 L50 8 L86 95 L100 95 Z" fill="#10b981" />
      <path d="M32 52 L38 52 L43 35 L48 65 L53 42 L58 52 L68 52"
        stroke="#10b981" strokeWidth="5" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ———————————————————— shared bits ———————————————————— */

function Kicker({ children, color = "#10b981" }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{
      fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase",
      color, marginBottom: 16,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: "clamp(26px,3.4vw,38px)", fontWeight: 700, color: "#e5e5e5",
      letterSpacing: "-1px", lineHeight: 1.15, margin: "0 0 14px",
    }}>
      {children}
    </h2>
  );
}

function SectionSub({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: "#888", fontSize: 16, lineHeight: 1.65, maxWidth: 640, margin: "0 0 56px" }}>
      {children}
    </p>
  );
}

/* ———————————————————— terminal demo ———————————————————— */

interface TermLine {
  ts: string;
  actor: string;
  color: string;
  text: string;
  em?: boolean;      // emphasised line (root cause, resolution)
  gate?: boolean;    // renders a confirm chip
}

interface Scenario {
  id: string;
  label: string;
  caption: string;
  lines: TermLine[];
}

const SCENARIOS: Scenario[] = [
  {
    id: "triage",
    label: "agentic analysis",
    caption: "sre asks · agents investigate · every claim cited",
    lines: [
      { ts: "14:35:02", actor: "pagerduty", color: "#ef4444", text: "P1 firing — checkout error-rate breach on payments-api" },
      { ts: "14:35:09", actor: "you", color: "#e5e5e5", text: '"payments-api is down — what changed?"' },
      { ts: "14:35:09", actor: "orchestrator", color: "#10b981", text: "intent=incident_triage · role=sre · perimeter resolved" },
      { ts: "14:35:10", actor: "graph", color: "#8b5cf6", text: 'resolveContext("payments-api") → 6 connector coordinates, freshness 0.98' },
      { ts: "14:35:10", actor: "datadog", color: "#7c3aed", text: "getMetrics({service:'payments-api'}) → error rate 8.2% ↑ (baseline 0.3%)" },
      { ts: "14:35:11", actor: "github", color: "#aaa", text: "getPRs({repo:'org/payments'}) → PR #441 merged 41m ago — billing handler" },
      { ts: "14:35:11", actor: "argocd", color: "#f97316", text: "getDeploys({app:'payments-api'}) → v2.3.0 live 14m · sha a4f21bc" },
      { ts: "14:35:12", actor: "k8s", color: "#f59e0b", text: "getPods({ns:'prod', selector:'app=payments-api'}) → 3/4 Ready · 1 CrashLoopBackOff" },
      { ts: "14:35:14", actor: "orchestrator", color: "#10b981", text: "root cause: deploy v2.3.0 (PR #441) regressed the billing handler", em: true },
      { ts: "14:35:14", actor: "orchestrator", color: "#10b981", text: "4 sources cited · zero claims from training data · 12s end to end" },
      { ts: "14:35:14", actor: "gate", color: "#f59e0b", text: "rollback payments-api → v2.2.8", gate: true },
    ],
  },
  {
    id: "zerotouch",
    label: "zero-touch remediation",
    caption: "3am anomaly · policy-bound fix · humans asleep",
    lines: [
      { ts: "03:12:44", actor: "cron", color: "#3b82f6", text: "service_health_sweep — 84 prod services scanned" },
      { ts: "03:12:51", actor: "anomaly", color: "#ef4444", text: "payments-api P99 1.9s (baseline 240ms) · memory 94%" },
      { ts: "03:12:52", actor: "trigger", color: "#3b82f6", text: 'rule "latency-degraded" matched → SRE agent spawned' },
      { ts: "03:12:53", actor: "graph", color: "#8b5cf6", text: "coordinates: k8s → { ns:'prod', selector:'app=payments-api' }" },
      { ts: "03:12:55", actor: "sre-agent", color: "#10b981", text: "diagnosis: connection-pool exhaustion after 03:00 traffic shift" },
      { ts: "03:12:56", actor: "perimeter", color: "#10b981", text: "scale deployments/payments-api ∈ write scope ✓ · policy: L4 autonomous" },
      { ts: "03:12:57", actor: "k8s", color: "#f59e0b", text: "scale payments-api 4 → 8 replicas — executed" },
      { ts: "03:14:10", actor: "verify", color: "#10b981", text: "P99 210ms · error rate 0.2% · recovered", em: true },
      { ts: "03:14:11", actor: "audit", color: "#555", text: "full trace appended, immutable — before the first human woke up" },
    ],
  },
];

function TerminalDemo() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [visible, setVisible] = useState(0);
  const scenario = SCENARIOS[scenarioIdx];
  const lines = scenario.lines;

  useEffect(() => {
    setVisible(0);
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const total = SCENARIOS[scenarioIdx].lines.length;
    const tick = () => {
      i += 1;
      setVisible(i);
      if (i < total) {
        t = setTimeout(tick, 460);
      } else {
        t = setTimeout(() => { i = 0; setVisible(0); t = setTimeout(tick, 500); }, 6000);
      }
    };
    t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, [scenarioIdx]);

  return (
    <div style={{
      background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 8,
      overflow: "hidden", boxShadow: "0 0 60px rgba(16,185,129,0.05)",
    }}>
      {/* title bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", borderBottom: "1px solid #1a1a1a", background: "#0e0e0e",
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["#2a2a2a", "#2a2a2a", "#2a2a2a"].map((c, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {SCENARIOS.map((s, i) => (
            <button key={s.id} onClick={() => setScenarioIdx(i)}
              style={{
                fontFamily: MONO, fontSize: 11, cursor: "pointer", padding: "4px 12px",
                borderRadius: 4, background: i === scenarioIdx ? "rgba(16,185,129,0.1)" : "transparent",
                border: i === scenarioIdx ? "1px solid #10b981" : "1px solid #1a1a1a",
                color: i === scenarioIdx ? "#10b981" : "#555",
              }}>
              {s.label}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: "#444" }}>{scenario.caption}</div>
      </div>

      {/* body */}
      <div style={{ padding: "18px 18px 16px", fontFamily: MONO, fontSize: 12, lineHeight: 1.85, height: 268, overflow: "hidden" }}>
        {lines.slice(0, visible).map((l, i) => (
          <div key={`${scenario.id}-${i}`} style={{
            display: "flex", gap: 10, alignItems: "baseline",
            animation: "landingFadeIn 0.2s ease-out both",
            background: l.em ? "rgba(16,185,129,0.05)" : "transparent",
            borderRadius: 3,
          }}>
            <span style={{ color: "#333", flexShrink: 0, fontSize: 11 }}>{l.ts}</span>
            <span style={{ color: l.color, flexShrink: 0, width: 96, fontSize: 11, opacity: 0.9 }}>{l.actor}</span>
            <span style={{ color: l.em ? "#e5e5e5" : "#999", fontWeight: l.em ? 600 : 400 }}>
              {l.text}
              {l.gate && (
                <span style={{
                  marginLeft: 10, color: "#10b981", border: "1px solid #10b981",
                  padding: "1px 10px", borderRadius: 4, fontSize: 11, whiteSpace: "nowrap",
                }}>
                  Confirm →
                </span>
              )}
            </span>
          </div>
        ))}
        <span style={{
          display: "inline-block", width: 8, height: 15, background: "#10b981",
          verticalAlign: "text-bottom", animation: "landingBlink 1s step-end infinite",
        }} />
      </div>
    </div>
  );
}

/* ———————————————————— before / after diagram ———————————————————— */

function SiloNode({ x, y, label, muted = false }: { x: number; y: number; label: string; muted?: boolean }) {
  const w = label.length * 7.5 + 22;
  return (
    <g>
      <rect x={x - w / 2} y={y - 14} width={w} height={28} rx={5}
        fill={muted ? "#0a0a0a" : "#0e0e0e"} stroke={muted ? "#1a1a1a" : "#2a2a2a"} />
      <text x={x} y={y + 4} textAnchor="middle" fontFamily={MONO} fontSize={11}
        fill={muted ? "#444" : "#888"}>{label}</text>
    </g>
  );
}

function HubNode({ x, y, label }: { x: number; y: number; label: string }) {
  const w = label.length * 8.5 + 34;
  return (
    <g>
      <rect x={x - w / 2} y={y - 18} width={w} height={36} rx={6}
        fill="rgba(16,185,129,0.08)" stroke="#10b981" strokeWidth={1.5}
        style={{ animation: "landingHubPulse 3s ease-in-out infinite" }} />
      <text x={x} y={y + 4} textAnchor="middle" fontFamily={MONO} fontSize={12}
        fontWeight={700} fill="#10b981">{label}</text>
    </g>
  );
}

function BeforeAfter() {
  const teams = [
    { x: 70, y: 46, label: "PRODUCT" },
    { x: 210, y: 46, label: "ENG" },
    { x: 350, y: 46, label: "SRE" },
  ];
  const tools = ["github", "datadog", "k8s", "linear", "pagerduty"];
  const toolXs = [50, 135, 210, 285, 370];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20 }}>
      {/* BEFORE */}
      <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 8, padding: "28px 24px 20px" }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", color: "#ef4444", marginBottom: 6, fontWeight: 700 }}>
          BEFORE
        </div>
        <div style={{ color: "#555", fontSize: 13, marginBottom: 12 }}>
          Every boundary is a context switch. Every tool is a silo.
        </div>
        <svg viewBox="0 0 420 240" width="100%" style={{ display: "block" }}>
          {/* broken team links */}
          <line x1={108} y1={46} x2={172} y2={46} stroke="#2a2a2a" strokeDasharray="4 5" />
          <line x1={238} y1={46} x2={312} y2={46} stroke="#2a2a2a" strokeDasharray="4 5" />
          <text x={140} y={40} textAnchor="middle" fontFamily={MONO} fontSize={12} fill="#ef4444">✕</text>
          <text x={275} y={40} textAnchor="middle" fontFamily={MONO} fontSize={12} fill="#ef4444">✕</text>
          <text x={140} y={66} textAnchor="middle" fontFamily={MONO} fontSize={9} fill="#553333">context lost</text>
          <text x={275} y={66} textAnchor="middle" fontFamily={MONO} fontSize={9} fill="#553333">context lost</text>
          {teams.map((t) => <SiloNode key={t.label} x={t.x} y={t.y} label={t.label} />)}
          {/* disconnected tools */}
          {tools.map((t, i) => <SiloNode key={t} x={toolXs[i]} y={168} label={t} muted />)}
          <text x={210} y={215} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="#444">
            nobody sees the whole system
          </text>
        </svg>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "#555", lineHeight: 2, marginTop: 8 }}>
          <div><span style={{ color: "#ef4444" }}>·</span> alert fires → oncall starts from zero, five tabs deep</div>
          <div><span style={{ color: "#ef4444" }}>·</span> PM asks status → a developer context-switches to answer</div>
          <div><span style={{ color: "#ef4444" }}>·</span> deploy breaks → root cause takes hours of tool archaeology</div>
        </div>
      </div>

      {/* AFTER */}
      <div style={{ background: "#080808", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, padding: "28px 24px 20px" }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", color: "#10b981", marginBottom: 6, fontWeight: 700 }}>
          WITH ANWAY
        </div>
        <div style={{ color: "#888", fontSize: 13, marginBottom: 12 }}>
          One nervous system. Context preserved end to end.
        </div>
        <svg viewBox="0 0 420 240" width="100%" style={{ display: "block" }}>
          {/* edges: teams + tools → hub */}
          {teams.map((t) => (
            <line key={t.label} x1={t.x} y1={60} x2={210} y2={100}
              stroke="#10b981" strokeOpacity={0.45} strokeDasharray="3 4"
              style={{ animation: "landingDash 1.4s linear infinite" }} />
          ))}
          {toolXs.map((x, i) => (
            <line key={tools[i]} x1={x} y1={154} x2={210} y2={136}
              stroke="#10b981" strokeOpacity={0.35} strokeDasharray="3 4"
              style={{ animation: "landingDash 1.4s linear infinite" }} />
          ))}
          {teams.map((t) => <SiloNode key={t.label} x={t.x} y={t.y} label={t.label} />)}
          <HubNode x={210} y={118} label="ANWAY" />
          {tools.map((t, i) => <SiloNode key={t} x={toolXs[i]} y={168} label={t} muted />)}
          <text x={210} y={215} textAnchor="middle" fontFamily={MONO} fontSize={10} fill="#10b981" opacity={0.7}>
            live knowledge graph across every connector
          </text>
        </svg>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "#888", lineHeight: 2, marginTop: 8 }}>
          <div><span style={{ color: "#10b981" }}>·</span> alert fires → root cause traced across 6 tools in seconds</div>
          <div><span style={{ color: "#10b981" }}>·</span> PM asks status → live answer from tickets, PRs, deploy state</div>
          <div><span style={{ color: "#10b981" }}>·</span> deploy breaks → the offending PR is named, with the diff</div>
        </div>
      </div>
    </div>
  );
}

/* ———————————————————— grounding rows ———————————————————— */

const GROUNDED_CLAIMS = [
  {
    claim: '"payments-api error rate is 8.2%"',
    source: "datadog", sourceColor: "#7c3aed",
    ref: "error_rate.payments-api", meta: "fetched 14:35:04 · freshness 1.00",
  },
  {
    claim: '"v2.3.0 was deployed 14 minutes ago"',
    source: "argocd", sourceColor: "#f97316",
    ref: "deploy-882 · sha a4f21bc", meta: "fetched 14:35:11 · freshness 0.98",
  },
  {
    claim: '"PR #441 changed the billing handler"',
    source: "github", sourceColor: "#aaa",
    ref: "org/payments #441", meta: "fetched 14:35:11 · freshness 0.99",
  },
];

function GroundingBlock() {
  return (
    <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 8, padding: 24 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: "#555", letterSpacing: "0.12em", marginBottom: 16 }}>
        EVERY CLAIM CARRIES ITS SOURCE
      </div>
      {GROUNDED_CLAIMS.map((c) => (
        <div key={c.claim} style={{
          display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10,
          padding: "10px 0", borderBottom: "1px solid #1a1a1a", fontFamily: MONO, fontSize: 12,
        }}>
          <span style={{ color: "#e5e5e5", flex: "1 1 260px" }}>{c.claim}</span>
          <span style={{ color: "#333" }}>←</span>
          <span style={{
            color: c.sourceColor, border: "1px solid #1a1a1a", borderRadius: 3,
            padding: "1px 8px", fontSize: 11, background: "#0e0e0e",
          }}>{c.source}</span>
          <span style={{ color: "#666", fontSize: 11 }}>{c.ref}</span>
          <span style={{ color: "#444", fontSize: 10 }}>{c.meta}</span>
        </div>
      ))}
      <div style={{ fontFamily: MONO, fontSize: 11, color: "#555", marginTop: 16, lineHeight: 1.7 }}>
        Can&apos;t ground a claim? Anway says <span style={{ color: "#f59e0b" }}>&quot;I don&apos;t have current data on X — last sync 4h ago&quot;</span>.
        <br />It never fills the gap with a plausible-sounding guess.
      </div>
    </div>
  );
}

/* ———————————————————— scatter vs targeted ———————————————————— */

function ScatterVsTargeted() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
      <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 8, padding: 24 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "#ef4444", letterSpacing: "0.12em", marginBottom: 14, fontWeight: 700 }}>
          WITHOUT A GRAPH — SCATTER-GATHER
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: 2, color: "#555" }}>
          <div>→ datadog: &quot;find dashboards for payments&quot; <span style={{ color: "#ef4444" }}>40 results, wrong one picked</span></div>
          <div>→ k8s: &quot;list all namespaces&quot; <span style={{ color: "#ef4444" }}>30 namespaces scanned</span></div>
          <div>→ github: &quot;search repos for payments&quot; <span style={{ color: "#ef4444" }}>12 repos, guesswork</span></div>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "#444", marginTop: 14 }}>
          context bloat · wrong resources · answers rot
        </div>
      </div>
      <div style={{ background: "#0a0a0a", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, padding: 24 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "#10b981", letterSpacing: "0.12em", marginBottom: 14, fontWeight: 700 }}>
          WITH GRAPH COORDINATES — TARGETED
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: 2, color: "#888" }}>
          <div>→ datadog.getMetrics(<span style={{ color: "#10b981" }}>{`{service:'payments-api'}`}</span>)</div>
          <div>→ k8s.getPods(<span style={{ color: "#10b981" }}>{`{ns:'prod', selector:'app=payments-api'}`}</span>)</div>
          <div>→ github.getPRs(<span style={{ color: "#10b981" }}>{`{repo:'org/payments', limit:5}`}</span>)</div>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "#10b981", marginTop: 14, opacity: 0.8 }}>
          three calls · exact data · no bloat
        </div>
      </div>
    </div>
  );
}

/* ———————————————————— autonomy dial ———————————————————— */

interface AutonomyLevel {
  id: string;
  name: string;
  tagline: string;
  executes: string;
  human: string;
  unlock: string;
  badge?: string;
}

const AUTONOMY_LEVELS: AutonomyLevel[] = [
  {
    id: "L1", name: "Assist",
    tagline: "Anway investigates and recommends. You run the command yourself.",
    executes: "you, manually",
    human: "reads the recommendation, acts",
    unlock: "default from day one",
  },
  {
    id: "L2", name: "Approve", badge: "V1 TODAY",
    tagline: "Anway shows exactly what it will do — action, target resource, connector, confidence score. One click executes.",
    executes: "Anway, after your confirm",
    human: "one explicit click on the gate",
    unlock: "the V1 write path — every write gated, no exceptions",
  },
  {
    id: "L3", name: "Supervise",
    tagline: "Anway executes and streams the trace live. You watch, and can interrupt at any point.",
    executes: "Anway, live-streamed",
    human: "supervises, can abort mid-action",
    unlock: "per-service, after trust is established",
  },
  {
    id: "L4", name: "Autonomous",
    tagline: "Anway remediates within hard policy bounds — scale, rollback, restart — and files the audit trail. Zero human toil.",
    executes: "Anway, within policy bounds",
    human: "reads the async audit trail",
    unlock: "explicit opt-in per service — never the default",
  },
];

function AutonomyDial() {
  const [sel, setSel] = useState(1);
  const level = AUTONOMY_LEVELS[sel];

  return (
    <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 8, padding: "32px 28px" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: "#555", letterSpacing: "0.12em", marginBottom: 28 }}>
        THE AUTONOMY DIAL — HUMAN TOIL DECREASES AS TRUST INCREASES
      </div>

      {/* track */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        {AUTONOMY_LEVELS.map((l, i) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", flex: i === 0 ? "0 0 auto" : "1 1 0" }}>
            {i > 0 && (
              <div style={{
                height: 2, flex: 1,
                background: i <= sel ? "#10b981" : "#1a1a1a",
                transition: "background 0.25s",
              }} />
            )}
            <button onClick={() => setSel(i)} style={{
              background: "none", border: "none", cursor: "pointer", padding: 0,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            }}>
              <div style={{
                width: i === sel ? 18 : 12, height: i === sel ? 18 : 12, borderRadius: "50%",
                background: i <= sel ? "#10b981" : "#111",
                border: i <= sel ? "1px solid #10b981" : "1px solid #2a2a2a",
                boxShadow: i === sel ? "0 0 14px rgba(16,185,129,0.5)" : "none",
                transition: "all 0.25s",
              }} />
              <div style={{
                fontFamily: MONO, fontSize: 11, whiteSpace: "nowrap",
                color: i === sel ? "#10b981" : i <= sel ? "#888" : "#444",
                fontWeight: i === sel ? 700 : 400,
              }}>
                {l.id} {l.name}
                {l.badge && (
                  <span style={{
                    marginLeft: 6, background: "#10b981", color: "#000", fontSize: 9,
                    padding: "1px 5px", borderRadius: 3, fontWeight: 700,
                  }}>{l.badge}</span>
                )}
              </div>
            </button>
          </div>
        ))}
      </div>

      {/* detail panel */}
      <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: 6, padding: "20px 22px" }}>
        <div style={{ color: "#e5e5e5", fontSize: 15, lineHeight: 1.6, marginBottom: 18 }}>{level.tagline}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, fontFamily: MONO, fontSize: 12 }}>
          {[
            ["who executes", level.executes],
            ["human role", level.human],
            ["unlock", level.unlock],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ color: "#444", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{k}</div>
              <div style={{ color: "#888", lineHeight: 1.5 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ———————————————————— gate + perimeter + audit ———————————————————— */

function GateCard() {
  return (
    <div style={{ background: "#080808", border: "1px solid #f59e0b44", borderRadius: 8, padding: 24 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 11,
        color: "#f59e0b", letterSpacing: "0.12em", marginBottom: 18, fontWeight: 700,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", background: "#f59e0b",
          animation: "landingPulseDot 1.6s ease-in-out infinite",
        }} />
        WRITE ACTION — CONFIRMATION REQUIRED
      </div>
      <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: 2.1 }}>
        {[
          ["action", "kubectl scale deployment/payments-api --replicas=8", "#e5e5e5"],
          ["connector", "k8s-prod · write scope: deployments/payments-api ✓", "#888"],
          ["blast radius", "~47 active sessions rebalanced · zero expected downtime", "#888"],
          ["confidence", "0.94", "#10b981"],
        ].map(([k, v, c]) => (
          <div key={k as string} style={{ display: "flex", gap: 12 }}>
            <span style={{ color: "#444", width: 96, flexShrink: 0 }}>{k}</span>
            <span style={{ color: c as string }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <span style={{
          background: "#10b981", color: "#000", fontFamily: MONO, fontSize: 12, fontWeight: 700,
          padding: "8px 18px", borderRadius: 5, cursor: "default",
        }}>Confirm &amp; execute</span>
        <span style={{
          border: "1px solid #2a2a2a", color: "#888", fontFamily: MONO, fontSize: 12,
          padding: "8px 18px", borderRadius: 5, cursor: "default",
        }}>Reject</span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: "#444", marginTop: 14 }}>
        confirmation logged: who · when · what was approved — immutable
      </div>
    </div>
  );
}

function PerimeterCard() {
  return (
    <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 8, padding: 24 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: "#555", letterSpacing: "0.12em", marginBottom: 18, fontWeight: 700 }}>
        DETERMINISTIC PERIMETER — NOT A PROMPT, A RULE ENGINE
      </div>
      <pre style={{
        fontFamily: MONO, fontSize: 12, lineHeight: 1.9, margin: 0,
        color: "#888", whiteSpace: "pre-wrap",
      }}>
{`user: alice@acme.dev
role: sre
k8s-prod:
  read:  `}<span style={{ color: "#10b981" }}>{`["*"]`}</span>{`
  write: `}<span style={{ color: "#10b981" }}>{`["deployments/payments-api"]`}</span>{`
github:
  read:  `}<span style={{ color: "#10b981" }}>{`["org/*"]`}</span>{`
  write: `}<span style={{ color: "#555" }}>{`[]`}</span>
      </pre>
      <div style={{ fontFamily: MONO, fontSize: 11, color: "#555", marginTop: 16, lineHeight: 1.8 }}>
        resolved = user perimeter <span style={{ color: "#10b981" }}>∩</span> connector manifest.
        <br />Outside scope → <span style={{ color: "#ef4444" }}>hard block, logged</span>. Not a warning. Not LLM judgment.
      </div>
    </div>
  );
}

function AuditStrip() {
  const rows = [
    { ts: "03:12:52", text: "trigger latency-degraded matched · sre-agent spawned · scope=payments-api", c: "#888" },
    { ts: "03:12:56", text: "perimeter check PASS · scale deployments/payments-api ∈ write scope", c: "#10b981" },
    { ts: "03:12:57", text: "write executed · k8s-prod · replicas 4→8 · policy=L4 · confidence=0.94", c: "#888" },
    { ts: "03:13:40", text: "perimeter check BLOCK · delete namespace/prod ∉ any scope · hard stop", c: "#ef4444" },
    { ts: "03:14:11", text: "run complete · 6 events appended · immutable", c: "#555" },
  ];
  return (
    <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 8, padding: 24 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: "#555", letterSpacing: "0.12em", marginBottom: 16, fontWeight: 700 }}>
        EVERY ACTION LANDS IN THE AUDIT LOG — INCLUDING THE BLOCKED ONES
      </div>
      <div style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 2.1 }}>
        {rows.map((r) => (
          <div key={r.ts + r.text} style={{ display: "flex", gap: 12 }}>
            <span style={{ color: "#333", flexShrink: 0 }}>{r.ts}</span>
            <span style={{ color: r.c }}>{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ———————————————————— connectors ———————————————————— */

const CONNECTOR_CATEGORIES: Record<string, string[]> = {
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
  for (const list of Object.values(CONNECTOR_CATEGORIES)) for (const c of list) seen.add(c);
  return [...seen].sort();
}

// deterministic pseudo "last sync" so SSR and client render identically
function syncSeconds(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return 3 + (h % 55);
}

function ConnectorGrid() {
  const [activeCategory, setActiveCategory] = useState("All");
  const all = getAllConnectors();
  const filtered = activeCategory === "All" ? all : CONNECTOR_CATEGORIES[activeCategory] ?? [];
  const categories = Object.keys(CONNECTOR_CATEGORIES);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 32, flexWrap: "wrap" }}>
        {categories.map((cat) => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            style={{
              border: activeCategory === cat ? "1px solid #10b981" : "1px solid #1a1a1a",
              padding: "6px 16px", borderRadius: 4, fontSize: 12, fontFamily: MONO,
              color: activeCategory === cat ? "#10b981" : "#555",
              background: activeCategory === cat ? "rgba(16,185,129,0.06)" : "transparent",
              cursor: "pointer",
            }}>
            {cat}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
        {filtered.map((c, i) => (
          <div key={c} style={{
            background: "#0a0a0a", border: "1px solid #1a1a1a", padding: "12px 14px",
            borderRadius: 5, display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%", background: "#10b981", flexShrink: 0,
              animation: "landingPulseDot 2.4s ease-in-out infinite",
              animationDelay: `${(i % 8) * 0.3}s`,
            }} />
            <span style={{ color: "#aaa", fontSize: 13, flex: 1 }}>{c}</span>
            <span style={{ fontFamily: MONO, fontSize: 9, color: "#444" }}>{syncSeconds(c)}s</span>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: "#444", marginTop: 20 }}>
        every connector registered → graph bootstrap runs → entities, relationships and coordinates extracted automatically
      </div>
    </div>
  );
}

/* ———————————————————— roles ———————————————————— */

const ROLES = [
  { role: "SRE / Oncall", color: "#ef4444", query: '"Alert fired — what\'s the trail?"', body: "Root cause traced across logs, metrics, deploys and PRs. In seconds, not hours of tab-hopping." },
  { role: "Product Manager", color: "#8b5cf6", query: '"Status of Feature X?"', body: "Lifecycle graph, Linear tickets, PRs and deploy state — aggregated into one grounded answer. No developer interrupted." },
  { role: "Business Analyst", color: "#f59e0b", query: '"How is this user journey performing?"', body: "Metrics, events and funnel data pulled and analysed in plain language." },
  { role: "Developer", color: "#3b82f6", query: '"Why is this issue happening?"', body: "Multi-repo session, root cause surfaced, regression test written — one thread, full context carried through." },
];

/* ———————————————————— page ———————————————————— */

const NAV_LINKS: [string, string][] = [
  ["why", "Why"],
  ["analysis", "Agentic analysis"],
  ["autonomy", "Zero-touch"],
  ["connectors", "Connectors"],
  ["roles", "Roles"],
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function LandingPage() {
  return (
    <div style={{
      background: "#080808", color: "#e5e5e5", fontFamily: SANS,
      height: "100%", overflowY: "auto", scrollBehavior: "smooth",
    }}>
      <style>{`
        @keyframes landingBlink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes landingFadeIn { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:translateY(0)} }
        @keyframes landingPulseDot { 0%,100%{opacity:1;box-shadow:0 0 4px rgba(16,185,129,0.6)} 50%{opacity:0.35;box-shadow:none} }
        @keyframes landingDash { to { stroke-dashoffset: -14; } }
        @keyframes landingHubPulse { 0%,100%{filter:drop-shadow(0 0 4px rgba(16,185,129,0.3))} 50%{filter:drop-shadow(0 0 14px rgba(16,185,129,0.6))} }
      `}</style>

      {/* ——— nav ——— */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50, background: "rgba(8,8,8,0.9)",
        borderBottom: "1px solid #1a1a1a", backdropFilter: "blur(12px)",
        padding: "0 40px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AnwayMark size={26} />
          <span style={{ color: "#10b981", fontSize: 18, fontWeight: 700, letterSpacing: "-0.5px", fontFamily: MONO }}>anway</span>
        </div>
        <div style={{ display: "flex", gap: 26 }}>
          {NAV_LINKS.map(([id, label]) => (
            <button key={id} onClick={() => scrollTo(id)}
              style={{ color: "#888", fontSize: 13, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: MONO }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#e5e5e5"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; }}>
              {label}
            </button>
          ))}
        </div>
        <Link href="/" style={{
          background: "#10b981", color: "#000", fontWeight: 700, padding: "8px 18px",
          borderRadius: 5, fontSize: 13, textDecoration: "none", fontFamily: MONO,
        }}>
          Open Dashboard →
        </Link>
      </nav>

      {/* ——— hero ——— */}
      <section style={{ padding: "96px 40px 72px", maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ maxWidth: 780 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
            {[
              ["AGENTIC ANALYSIS", "#10b981"],
              ["ZERO-TOUCH INFRA", "#8b5cf6"],
              ["GOVERNED BY DESIGN", "#3b82f6"],
            ].map(([t, c]) => (
              <span key={t} style={{
                fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", color: c,
                border: `1px solid ${c}33`, borderRadius: 20, padding: "5px 14px",
                background: `${c}0d`,
              }}>{t}</span>
            ))}
          </div>
          <h1 style={{
            fontSize: "clamp(38px,5.6vw,68px)", fontWeight: 700, color: "#e5e5e5",
            lineHeight: 1.06, letterSpacing: "-2.5px", margin: "0 0 26px",
          }}>
            The central nervous system<br />of your software org.
          </h1>
          <p style={{ fontSize: 18, color: "#888", lineHeight: 1.65, maxWidth: 640, margin: "0 0 16px" }}>
            GitHub, Datadog, Kubernetes, Linear, PagerDuty, ArgoCD, your clouds — you already have the tools.
            They just don&apos;t talk to each other. Anway connects all of them into one live knowledge graph,
            puts specialist AI agents on top, and gives everyone in the org a single surface to
            <span style={{ color: "#e5e5e5" }}> query, act, and govern</span> the entire software lifecycle.
          </p>
          <p style={{ fontFamily: MONO, fontSize: 13, color: "#555", margin: "0 0 36px" }}>
            Not a devtool. The connective tissue between Product, Eng and SRE.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 64 }}>
            <Link href="/" style={{
              background: "#10b981", color: "#000", fontWeight: 700, padding: "13px 28px",
              borderRadius: 6, fontSize: 15, textDecoration: "none",
            }}>
              Open Dashboard →
            </Link>
            <button onClick={() => scrollTo("analysis")} style={{
              border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "13px 28px",
              borderRadius: 6, fontSize: 15, background: "none", cursor: "pointer",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#10b981"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; }}>
              See it investigate ↓
            </button>
          </div>
        </div>
        <TerminalDemo />
        <div style={{
          display: "flex", gap: 28, flexWrap: "wrap", marginTop: 22,
          fontFamily: MONO, fontSize: 11, color: "#444",
        }}>
          <span><span style={{ color: "#10b981" }}>33+</span> connectors</span>
          <span><span style={{ color: "#10b981" }}>1</span> orchestrator — you never pick an agent</span>
          <span><span style={{ color: "#10b981" }}>0</span> ungated writes in V1</span>
          <span><span style={{ color: "#10b981" }}>100%</span> of actions audited</span>
        </div>
      </section>

      {/* ——— before / after ——— */}
      <section id="why" style={{ padding: "88px 40px", background: "#0a0a0a", borderTop: "1px solid #1a1a1a" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <Kicker>THE PROBLEM</Kicker>
          <SectionTitle>Your org already bought every tool.<br />Nobody wired them together.</SectionTitle>
          <SectionSub>
            Context dies at every team boundary. The oncall engineer re-derives what the deploying developer
            already knew. The PM interrupts engineering to learn what the tools already recorded.
            Anway is the wiring.
          </SectionSub>
          <BeforeAfter />
        </div>
      </section>

      {/* ——— pillar 1: agentic analysis ——— */}
      <section id="analysis" style={{ padding: "88px 40px", borderTop: "1px solid #1a1a1a" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <Kicker>PILLAR 01 — AGENTIC ANALYSIS</Kicker>
          <SectionTitle>Specialist agents that investigate<br />like your best engineer — grounded, not guessed.</SectionTitle>
          <SectionSub>
            Ask &quot;why is checkout failing?&quot; and the orchestrator resolves the entity in the knowledge graph
            first — <span style={{ color: "#e5e5e5" }}>always graph first, never raw connector sprawl</span> —
            then fans out specialist agents that make targeted calls to exactly the right repo, namespace,
            dashboard and ticket. What comes back is a root cause with citations, not a hallucination
            with confidence.
          </SectionSub>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <ScatterVsTargeted />
            <GroundingBlock />
          </div>

          {/* agent roster */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 24 }}>
            {[
              ["orchestrator", "#10b981"], ["sre-agent", "#ef4444"], ["graph-builder", "#8b5cf6"],
              ["github-agent", "#aaa"], ["datadog-agent", "#7c3aed"], ["k8s-agent", "#f59e0b"],
              ["argocd-agent", "#f97316"], ["linear-agent", "#5e6ad2"], ["test-agent", "#3b82f6"],
              ["review-agent", "#06b6d4"],
            ].map(([name, color]) => (
              <span key={name} style={{
                fontFamily: MONO, fontSize: 11, color, border: "1px solid #1a1a1a",
                background: "#0a0a0a", borderRadius: 4, padding: "5px 12px",
              }}>
                ▸ {name}
              </span>
            ))}
            <span style={{ fontFamily: MONO, fontSize: 11, color: "#444", padding: "5px 4px" }}>
              …spun up per query, never picked by you
            </span>
          </div>
        </div>
      </section>

      {/* ——— pillar 2: zero-touch ——— */}
      <section id="autonomy" style={{ padding: "88px 40px", background: "#0a0a0a", borderTop: "1px solid #1a1a1a" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <Kicker color="#8b5cf6">PILLAR 02 — ZERO-TOUCH INFRA MANAGEMENT</Kicker>
          <SectionTitle>Infra that runs itself —<br />inside a perimeter you define.</SectionTitle>
          <SectionSub>
            The end state: anomalies detected, diagnosed and remediated while your team sleeps.
            The path there is deliberate — V1 gates every single write behind an explicit confirm,
            and a deterministic rule engine (not LLM judgment) decides what any agent may ever touch.
            You turn the dial up per service, only as trust is earned.
          </SectionSub>

          <AutonomyDial />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20, marginTop: 20 }}>
            <GateCard />
            <PerimeterCard />
          </div>
          <div style={{ marginTop: 20 }}>
            <AuditStrip />
          </div>
        </div>
      </section>

      {/* ——— connectors ——— */}
      <section id="connectors" style={{ padding: "88px 40px", borderTop: "1px solid #1a1a1a" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <Kicker>DATASOURCES</Kicker>
          <SectionTitle>Every tool your org uses. Already speaking.</SectionTitle>
          <SectionSub>
            33 connectors and counting. Each one registered makes every agent smarter —
            the knowledge graph compounds. Network effect, inside your own org.
          </SectionSub>
          <ConnectorGrid />
        </div>
      </section>

      {/* ——— roles ——— */}
      <section id="roles" style={{ padding: "88px 40px", background: "#0a0a0a", borderTop: "1px solid #1a1a1a" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <Kicker>ONE SURFACE, EVERY ROLE</Kicker>
          <SectionTitle>Same question box. Role-aware answers.</SectionTitle>
          <SectionSub>
            Anway resolves your effective role from your query and workspace signals —
            an SRE gets the pod trace, a PM gets the delivery status, from the same underlying graph.
          </SectionSub>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
            {ROLES.map((r) => (
              <div key={r.role} style={{ background: "#080808", border: "1px solid #1a1a1a", padding: 26, borderRadius: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.color }} />
                  <span style={{ color: "#e5e5e5", fontSize: 15, fontWeight: 600 }}>{r.role}</span>
                </div>
                <div style={{
                  background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: 4,
                  padding: "9px 13px", fontSize: 12.5, color: "#10b981", fontFamily: MONO,
                  marginBottom: 14,
                }}>
                  {r.query}
                </div>
                <div style={{ color: "#666", fontSize: 13.5, lineHeight: 1.6 }}>{r.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ——— footer cta ——— */}
      <section style={{ padding: "100px 40px 60px", borderTop: "1px solid #1a1a1a", textAlign: "center" }}>
        <div style={{ marginBottom: 24 }}><AnwayMark size={48} /></div>
        <h2 style={{
          fontSize: "clamp(28px,4vw,48px)", fontWeight: 700, color: "#e5e5e5",
          letterSpacing: "-1.5px", margin: "0 0 16px",
        }}>
          Give your org a nervous system.
        </h2>
        <p style={{ color: "#555", fontSize: 16, margin: "0 0 36px", fontFamily: MONO }}>
          one surface · every tool · full context · governed writes
        </p>
        <Link href="/" style={{
          background: "#10b981", color: "#000", fontWeight: 700, padding: "15px 38px",
          borderRadius: 6, fontSize: 17, textDecoration: "none", display: "inline-block",
        }}>
          Open Dashboard →
        </Link>
        <div style={{
          borderTop: "1px solid #1a1a1a", marginTop: 80, paddingTop: 28,
          display: "flex", justifyContent: "space-between", color: "#444", fontSize: 12,
          maxWidth: 900, margin: "80px auto 0", fontFamily: MONO, flexWrap: "wrap", gap: 8,
        }}>
          <span>© 2026 Anway · anway.io</span>
          <span>central software operations</span>
        </div>
      </section>
    </div>
  );
}
