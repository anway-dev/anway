"use client";
import { useState, useEffect } from "react";

// Shape returned by /api/incidents
interface ApiIncident {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "active" | "investigating" | "resolved";
  description?: string | null;
  suggested_root_cause?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

// Display shape used by the view — enriches real data with UI-only fields
interface DisplayIncident {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "active" | "investigating" | "resolved";
  hypothesis: string;
  description: string;
  service: string;
  duration: string;
  oncall: string;
  timeline: TimelineEvent[];
  metrics: Metric[];
  deploys: Deploy[];
  prs: PR[];
  runbook: string[];
}

interface TimelineEvent {
  at: string;
  type: "alert" | "deploy" | "spike" | "ack" | "note" | "rollback";
  label: string;
}

interface Metric {
  name: string;
  value: string;
  unit?: string;
  status: "critical" | "warning" | "ok";
  spark: number[];
}

interface Deploy {
  sha: string;
  service: string;
  version: string;
  deployedBy: string;
  at: string;
  status: "ok" | "suspect" | "culprit";
}

interface PR {
  number: number;
  title: string;
  author: string;
  repo: string;
  mergedAt: string;
  status: "ok" | "suspect";
}

type Filter = "all" | "active" | "investigating" | "resolved";

const SEV_COLOR: Record<DisplayIncident["severity"], string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#888",
};

const STATUS_COLOR: Record<DisplayIncident["status"], string> = {
  active: "#ef4444",
  investigating: "#f59e0b",
  resolved: "#10b981",
};

const STATUS_BG: Record<DisplayIncident["status"], string> = {
  active: "rgba(239,68,68,0.12)",
  investigating: "rgba(245,158,11,0.12)",
  resolved: "rgba(16,185,129,0.12)",
};

const TIMELINE_COLOR: Record<TimelineEvent["type"], string> = {
  alert:    "#ef4444",
  deploy:   "#3b82f6",
  spike:    "#f59e0b",
  ack:      "#10b981",
  note:     "#888",
  rollback: "#8b5cf6",
};

const METRIC_STATUS_COLOR: Record<Metric["status"], string> = {
  critical: "#ef4444",
  warning:  "#f59e0b",
  ok:       "#10b981",
};

const DEPLOY_STATUS_STYLE: Record<Deploy["status"], { bg: string; color: string; border: string }> = {
  ok:      { bg: "transparent", color: "#10b981", border: "transparent" },
  suspect: { bg: "rgba(245,158,11,0.08)", color: "#f59e0b", border: "rgba(245,158,11,0.3)" },
  culprit: { bg: "rgba(239,68,68,0.08)", color: "#ef4444", border: "rgba(239,68,68,0.3)" },
};

function formatDuration(createdAt: string, resolvedAt?: string | null): string {
  const start = new Date(createdAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  const mins = Math.floor((end - start) / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function toDisplay(a: ApiIncident): DisplayIncident {
  return {
    id: a.id.slice(0, 8),
    title: a.title,
    severity: a.severity,
    status: a.status,
    hypothesis: a.suggested_root_cause ?? "Analysing… root cause hypothesis pending.",
    description: a.description ?? "",
    service: "unknown",
    duration: formatDuration(a.created_at, a.resolved_at),
    oncall: "—",
    timeline: [],
    metrics: [],
    deploys: [],
    prs: [],
    runbook: [],
  };
}

function Sparkline({ spark, status }: { spark: number[]; status: Metric["status"] }) {
  const max = Math.max(...spark, 1);
  const color = METRIC_STATUS_COLOR[status];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "1px", height: "24px" }}>
      {spark.map((v, i) => (
        <div
          key={i}
          style={{
            width: "3px",
            height: `${Math.max(2, Math.round((v / max) * 24))}px`,
            background: i === spark.length - 1 ? color : `${color}60`,
            borderRadius: "1px",
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}

function TimelineStrip({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <div style={{ padding: "12px 0", color: "#444", fontSize: "11px" }}>
        No timeline events — connector data not yet available
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto", padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "0", minWidth: "max-content", padding: "0 4px" }}>
        {events.map((evt, i) => {
          const color = TIMELINE_COLOR[evt.type];
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "110px" }}>
              <span style={{ fontSize: "9px", color: "#555", fontFamily: "monospace", marginBottom: "4px" }}>{evt.at}</span>
              <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                {i > 0 && <div style={{ flex: 1, height: "1px", background: "#1a1a1a" }} />}
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}80` }} />
                {i < events.length - 1 && <div style={{ flex: 1, height: "1px", background: "#1a1a1a" }} />}
              </div>
              <span style={{ fontSize: "9px", color: "#888", marginTop: "4px", maxWidth: "96px", textAlign: "center", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {evt.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({ m }: { m: Metric }) {
  const color = METRIC_STATUS_COLOR[m.status];
  return (
    <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "12px 14px", marginBottom: "8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <span style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "monospace" }}>{m.name}</span>
        <span style={{ fontSize: "9px", color, background: `${color}18`, border: `1px solid ${color}40`, padding: "1px 5px", borderRadius: "3px", fontWeight: 700, textTransform: "uppercase" }}>{m.status}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <span style={{ fontSize: "20px", fontWeight: 700, color, fontFamily: "monospace" }}>{m.value}</span>
          {m.unit && <span style={{ fontSize: "11px", color: "#555", marginLeft: "3px" }}>{m.unit}</span>}
        </div>
        <Sparkline spark={m.spark} status={m.status} />
      </div>
    </div>
  );
}

function DeployRow({ d }: { d: Deploy }) {
  const s = DEPLOY_STATUS_STYLE[d.status];
  return (
    <div style={{ padding: "9px 12px", borderRadius: "6px", marginBottom: "6px", background: s.bg, border: `1px solid ${s.border === "transparent" ? "#1a1a1a" : s.border}`, borderLeft: d.status === "culprit" ? `3px solid #ef4444` : `1px solid ${s.border === "transparent" ? "#1a1a1a" : s.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "3px" }}>
        <span style={{ fontFamily: "monospace", fontSize: "11px", color: s.color, fontWeight: 600 }}>{d.sha}</span>
        <span style={{ fontSize: "9px", color: s.color, background: `${s.color === "#10b981" ? "rgba(16,185,129,0.1)" : `${s.color}18`}`, border: `1px solid ${s.color}40`, padding: "1px 5px", borderRadius: "3px", fontWeight: 700, textTransform: "uppercase" }}>{d.status}</span>
      </div>
      <div style={{ fontSize: "10px", color: "#888" }}>
        <span style={{ color: "#d1d5db" }}>{d.service}</span>
        <span style={{ color: "#555", marginLeft: "4px" }}>{d.version}</span>
        <span style={{ color: "#555", marginLeft: "8px" }}>by {d.deployedBy}</span>
        <span style={{ color: "#444", marginLeft: "8px" }}>· {d.at}</span>
      </div>
    </div>
  );
}

function PRRow({ pr }: { pr: PR }) {
  const isSuspect = pr.status === "suspect";
  return (
    <div style={{ padding: "9px 12px", borderRadius: "6px", marginBottom: "6px", background: isSuspect ? "rgba(245,158,11,0.06)" : "transparent", border: `1px solid ${isSuspect ? "rgba(245,158,11,0.25)" : "#1a1a1a"}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "3px" }}>
        <span style={{ fontSize: "11px", color: isSuspect ? "#f59e0b" : "#888", fontFamily: "monospace", fontWeight: 600 }}>#{pr.number}</span>
        {isSuspect && <span style={{ fontSize: "9px", color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", padding: "1px 5px", borderRadius: "3px", fontWeight: 700 }}>SUSPECT</span>}
      </div>
      <div style={{ fontSize: "10px", color: "#d1d5db", marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pr.title}</div>
      <div style={{ fontSize: "10px", color: "#555" }}>{pr.author} · {pr.repo} · merged {pr.mergedAt}</div>
    </div>
  );
}

function PulsingDot({ color }: { color: string }) {
  return (
    <div style={{ position: "relative", width: "8px", height: "8px", flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, animation: "pulse 2s ease-in-out infinite" }} />
      <div style={{ position: "absolute", inset: "-3px", borderRadius: "50%", background: `${color}30`, animation: "pulse-ring 2s ease-in-out infinite" }} />
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes pulse-ring { 0%, 100% { transform: scale(1); opacity: 0.4; } 50% { transform: scale(1.8); opacity: 0; } }
      `}</style>
    </div>
  );
}

export function IncidentView({ onTriggerOrchestrator }: {
  onTriggerOrchestrator: (query: string, context: { title: string; source: string }) => void;
}) {
  const [incidents, setIncidents] = useState<DisplayIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [runbookOpen, setRunbookOpen] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch("/api/incidents")
      .then(r => r.ok ? r.json() : [])
      .then((data: ApiIncident[]) => {
        if (!mounted) return;
        const display = (Array.isArray(data) ? data : []).map(toDisplay);
        setIncidents(display);
        if (display.length > 0) {
          const firstActive = display.find(i => i.status === "active");
          setSelectedId(firstActive?.id ?? display[0].id);
        }
      })
      .catch(() => { if (mounted) setIncidents([]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const filtered = incidents.filter(i => filter === "all" || i.status === filter);
  const selected = selectedId ? incidents.find(i => i.id === selectedId) ?? incidents[0] : incidents[0];

  return (
    <div style={{ display: "flex", height: "100%", background: "#080808", overflow: "hidden" }}>
      {/* Left panel */}
      <div style={{ width: "280px", flexShrink: 0, background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>Incident</div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5" }}>War Room</div>
          <div style={{ fontSize: "11px", color: "#888", marginTop: "2px" }}>Live triage</div>
        </div>

        {/* Filter */}
        <div style={{ padding: "10px 12px", borderBottom: "1px solid #1a1a1a", display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {(["all", "active", "investigating", "resolved"] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "3px 10px", borderRadius: "12px", border: "1px solid",
                fontSize: "10px", cursor: "pointer", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
                background: filter === f ? (f === "all" ? "#1a2a1a" : f === "active" ? "rgba(239,68,68,0.15)" : f === "investigating" ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.1)") : "transparent",
                color: filter === f ? (f === "all" ? "#10b981" : f === "active" ? "#ef4444" : f === "investigating" ? "#f59e0b" : "#10b981") : "#555",
                borderColor: filter === f ? (f === "all" ? "rgba(16,185,129,0.3)" : f === "active" ? "rgba(239,68,68,0.35)" : f === "investigating" ? "rgba(245,158,11,0.35)" : "rgba(16,185,129,0.3)") : "#1a1a1a",
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Incident list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "16px", color: "#444", fontSize: "11px" }}>Loading incidents…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "16px", color: "#444", fontSize: "11px" }}>No incidents</div>
          ) : filtered.map(inc => {
            const isActive = inc.status === "active" || inc.status === "investigating";
            const sevColor = SEV_COLOR[inc.severity];
            return (
              <button
                key={inc.id}
                onClick={() => setSelectedId(inc.id)}
                style={{
                  display: "block", width: "100%", padding: "12px 14px",
                  background: selectedId === inc.id ? "#111" : "transparent",
                  border: "none", borderBottom: "1px solid #111",
                  cursor: "pointer", textAlign: "left",
                  borderLeft: selectedId === inc.id ? `2px solid ${sevColor}` : "2px solid transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "5px" }}>
                  {isActive ? (
                    <PulsingDot color={sevColor} />
                  ) : (
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: STATUS_COLOR[inc.status], flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: "10px", fontFamily: "monospace", color: "#444", background: "#111", border: "1px solid #1a1a1a", padding: "1px 5px", borderRadius: "3px" }}>
                    {inc.id}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", color: STATUS_COLOR[inc.status], background: STATUS_BG[inc.status], border: `1px solid ${STATUS_COLOR[inc.status]}40`, padding: "1px 6px", borderRadius: "10px" }}>
                    {inc.status}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500, marginBottom: "5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {inc.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "9px", color: "#888", background: "#111", border: "1px solid #2a2a2a", padding: "1px 6px", borderRadius: "3px" }}>
                    {inc.service}
                  </span>
                  <span style={{ fontSize: "10px", color: "#555" }}>{inc.duration}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right panel */}
      {!selected ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: "13px" }}>
          {loading ? "Loading…" : "No incidents"}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* Header bar */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "15px", fontWeight: 700, color: "#e5e5e5", flex: 1, minWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selected.title}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", color: SEV_COLOR[selected.severity], background: `${SEV_COLOR[selected.severity]}15`, border: `1px solid ${SEV_COLOR[selected.severity]}40`, padding: "2px 8px", borderRadius: "10px" }}>
                {selected.severity}
              </span>
              <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", color: STATUS_COLOR[selected.status], background: STATUS_BG[selected.status], border: `1px solid ${STATUS_COLOR[selected.status]}40`, padding: "2px 8px", borderRadius: "10px" }}>
                {selected.status}
              </span>
              <span style={{ fontSize: "10px", color: "#888", background: "#111", border: "1px solid #2a2a2a", padding: "2px 8px", borderRadius: "6px" }}>
                {selected.service}
              </span>
              <span style={{ fontSize: "10px", color: "#555" }}>{selected.duration}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: "#1a2a1a", border: "1px solid rgba(16,185,129,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", color: "#10b981", fontWeight: 700 }}>
                  {selected.oncall === "—" ? "—" : selected.oncall.slice(0, 2).toUpperCase()}
                </div>
                <span style={{ fontSize: "10px", color: "#888" }}>{selected.oncall}</span>
              </div>
              <button
                onClick={() => onTriggerOrchestrator(
                  `Investigate ${selected.id}: ${selected.title}`,
                  { title: selected.title, source: "incident-war-room" }
                )}
                style={{ background: "#0a2a1a", border: "1px solid rgba(16,185,129,0.35)", color: "#10b981", padding: "5px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}
              >
                <span style={{ fontSize: "10px" }}>✦</span> Investigate with Anvay
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Hypothesis box */}
            <div style={{ background: "#0a150e", border: "1px solid rgba(16,185,129,0.2)", borderLeft: "3px solid #10b981", borderRadius: "8px", padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "10px", color: "#10b981", fontWeight: 700, letterSpacing: "0.08em" }}>✦ ANVAY — ROOT CAUSE HYPOTHESIS</span>
              </div>
              <p style={{ fontSize: "12px", color: "#c8e6c9", lineHeight: "1.6", margin: 0 }}>
                {selected.hypothesis}
              </p>
            </div>

            {/* Timeline strip */}
            <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "12px 16px" }}>
              <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontWeight: 600 }}>Timeline</div>
              <TimelineStrip events={selected.timeline} />
            </div>

            {/* Three-column grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              {/* Metrics column */}
              <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontWeight: 600 }}>Metrics</div>
                {selected.metrics.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "#333" }}>No metrics — connect Datadog or Prometheus</div>
                ) : selected.metrics.map(m => <MetricCard key={m.name} m={m} />)}
              </div>

              {/* Deploys column */}
              <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontWeight: 600 }}>Recent Deploys</div>
                {selected.deploys.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "#333" }}>No deploys — connect ArgoCD or GitHub Actions</div>
                ) : selected.deploys.map(d => <DeployRow key={d.sha} d={d} />)}
              </div>

              {/* PRs column */}
              <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontWeight: 600 }}>Related PRs</div>
                {selected.prs.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "#333" }}>No PRs — connect GitHub</div>
                ) : selected.prs.map(pr => <PRRow key={pr.number} pr={pr} />)}
              </div>
            </div>

            {/* Runbook section */}
            <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", overflow: "hidden" }}>
              <button
                onClick={() => setRunbookOpen(o => !o)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "12px 16px", background: "none", border: "none", cursor: "pointer", borderBottom: runbookOpen ? "1px solid #1a1a1a" : "none" }}
              >
                <span style={{ fontSize: "11px", color: "#888", fontWeight: 600 }}>
                  Runbook <span style={{ color: "#444" }}>· {selected.runbook.length} steps</span>
                </span>
                <span style={{ fontSize: "10px", color: "#555" }}>{runbookOpen ? "▲" : "▼"}</span>
              </button>
              {runbookOpen && (
                <div style={{ padding: "12px 16px" }}>
                  {selected.runbook.length === 0 ? (
                    <div style={{ fontSize: "11px", color: "#333" }}>No runbook configured</div>
                  ) : selected.runbook.map((step, i) => (
                    <div key={i} style={{ display: "flex", gap: "10px", padding: "7px 0", borderBottom: i < selected.runbook.length - 1 ? "1px solid #111" : "none" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "10px", color: "#10b981", flexShrink: 0, marginTop: "1px" }}>{String(i + 1).padStart(2, "0")}</span>
                      <span style={{ fontSize: "11px", color: "#aaa", lineHeight: "1.5" }}>{step.replace(/^\d+\.\s*/, "")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
