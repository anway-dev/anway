"use client";
import { useState } from "react";
import { PROJECTS, PROJECT_WIKIS, ProjectWiki, ChangeEvent, StackComponent } from "@/lib/mock";

type DeepDiveTab = "changes" | "tests" | "metrics" | "stack" | "runbook";

const STATUS_COLOR: Record<string, string> = {
  success: "#10b981", failure: "#ef4444", in_progress: "#3b82f6",
  resolved: "#10b981", open: "#ef4444",
};
const STATUS_LABEL: Record<string, string> = {
  success: "Success", failure: "Failed", in_progress: "In Progress",
  resolved: "Resolved", open: "Open",
};
const KIND_COLOR: Record<string, string> = {
  deploy: "#f97316", pr: "#3b82f6", incident: "#ef4444",
  feature: "#10b981", rollback: "#f59e0b", test: "#8b5cf6",
};
const KIND_ICON: Record<string, string> = {
  deploy: "⬡", pr: "⌗", incident: "◎", feature: "✦", rollback: "↩", test: "⊡",
};
const METRIC_STATUS_COLOR: Record<string, string> = {
  healthy: "#10b981", warning: "#f59e0b", critical: "#ef4444",
};
const TREND_COLOR = (t: string, s: string) => {
  if (s === "critical") return "#ef4444";
  if (s === "warning") return "#f59e0b";
  return t === "up" ? "#10b981" : t === "down" ? "#888" : "#555";
};

function MetricCard({ m }: { m: { label: string; value: string; unit: string; trend: string; trendValue: string; status: string } }) {
  return (
    <div style={{
      background: "#0e0e0e",
      border: `1px solid ${m.status === "critical" ? "rgba(239,68,68,0.25)" : m.status === "warning" ? "rgba(245,158,11,0.2)" : "#1a1a1a"}`,
      borderTop: `2px solid ${METRIC_STATUS_COLOR[m.status]}`,
      borderRadius: "6px", padding: "12px 14px",
    }}>
      <div style={{ fontSize: "10px", color: "#555", fontWeight: 500, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "4px", marginBottom: "4px" }}>
        <span style={{ fontSize: "22px", fontWeight: 700, color: METRIC_STATUS_COLOR[m.status], fontFamily: "monospace", lineHeight: 1 }}>
          {m.value}
        </span>
        <span style={{ fontSize: "11px", color: "#555" }}>{m.unit}</span>
      </div>
      <div style={{ fontSize: "10px", color: TREND_COLOR(m.trend, m.status) }}>
        {m.trend === "up" ? "↑" : m.trend === "down" ? "↓" : "→"} {m.trendValue}
      </div>
    </div>
  );
}

function ChangeRow({ event }: { event: ChangeEvent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ display: "flex", gap: "0", marginBottom: "0" }}>
      {/* Timeline spine */}
      <div style={{ width: "32px", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{
          width: "20px", height: "20px", borderRadius: "50%",
          background: `${KIND_COLOR[event.kind]}20`,
          border: `1px solid ${KIND_COLOR[event.kind]}50`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "9px", color: KIND_COLOR[event.kind], flexShrink: 0, marginTop: "10px",
        }}>
          {KIND_ICON[event.kind]}
        </div>
        <div style={{ width: "1px", flex: 1, background: "#1a1a1a", minHeight: "16px" }} />
      </div>

      {/* Event card */}
      <div style={{ flex: 1, paddingBottom: "8px", paddingLeft: "8px" }}>
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            background: "#0e0e0e", border: "1px solid #1a1a1a",
            borderLeft: `2px solid ${KIND_COLOR[event.kind]}`,
            borderRadius: "5px", padding: "8px 12px", cursor: "pointer",
            transition: "border-color 0.15s",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", color: "#888", background: `${KIND_COLOR[event.kind]}15`, border: `1px solid ${KIND_COLOR[event.kind]}30`, borderRadius: "3px", padding: "1px 5px", textTransform: "capitalize", flexShrink: 0 }}>
              {event.kind}
            </span>
            <span style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {event.title}
            </span>
            <span style={{ fontSize: "10px", color: STATUS_COLOR[event.status], background: `${STATUS_COLOR[event.status]}15`, border: `1px solid ${STATUS_COLOR[event.status]}25`, borderRadius: "3px", padding: "1px 5px", flexShrink: 0 }}>
              {STATUS_LABEL[event.status]}
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <span style={{ fontSize: "10px", color: "#555" }}>{event.timestamp}</span>
            <span style={{ fontSize: "10px", color: "#333" }}>·</span>
            <span style={{ fontSize: "10px", color: "#555" }}>{event.author}</span>
            {event.meta && (
              <>
                <span style={{ fontSize: "10px", color: "#333" }}>·</span>
                <span style={{ fontSize: "10px", color: "#444", fontFamily: "monospace" }}>{event.meta}</span>
              </>
            )}
          </div>
        </div>
        {expanded && (
          <div style={{ marginTop: "4px", padding: "8px 12px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "4px", fontSize: "11px", color: "#888", lineHeight: "1.5" }}>
            {event.detail}
          </div>
        )}
      </div>
    </div>
  );
}

const SUGGESTION_COLOR: Record<string, string> = {
  upgrade: "#8b5cf6", scale: "#3b82f6", replace: "#ef4444", observe: "#f59e0b",
};
const SUGGESTION_LABEL: Record<string, string> = {
  upgrade: "Upgrade", scale: "Scale", replace: "Replace", observe: "Observe",
};

function StackHealthPanel({ components }: { components: StackComponent[] }) {
  const criticalCount = components.filter(c => c.health === "critical").length;
  const warningCount = components.filter(c => c.health === "warning").length;
  const suggestions = components.filter(c => c.suggestion);

  return (
    <div style={{ maxWidth: "760px" }}>
      {/* Summary bar */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", padding: "10px 14px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981" }} />
          <span style={{ fontSize: "11px", color: "#888" }}>{components.filter(c => c.health === "healthy").length} healthy</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#f59e0b" }} />
          <span style={{ fontSize: "11px", color: "#888" }}>{warningCount} warning</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#ef4444" }} />
          <span style={{ fontSize: "11px", color: "#888" }}>{criticalCount} critical</span>
        </div>
        <span style={{ marginLeft: "auto", fontSize: "11px", color: "#555" }}>{suggestions.length} AI suggestion{suggestions.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Component rows */}
      {components.map((c, i) => {
        const hc = c.health === "critical" ? "#ef4444" : c.health === "warning" ? "#f59e0b" : "#10b981";
        return (
          <div
            key={i}
            style={{
              background: "#0e0e0e",
              border: `1px solid ${c.health === "critical" ? "rgba(239,68,68,0.2)" : c.health === "warning" ? "rgba(245,158,11,0.15)" : "#1a1a1a"}`,
              borderLeft: `3px solid ${hc}`,
              borderRadius: "6px", padding: "12px 16px", marginBottom: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <div>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#d1d5db" }}>{c.name}</span>
                <span style={{ fontSize: "10px", color: "#555", fontFamily: "monospace", marginLeft: "6px" }}>v{c.version}</span>
              </div>
              <span style={{ fontSize: "10px", color: "#555", background: "#111", border: "1px solid #1a1a1a", borderRadius: "3px", padding: "1px 6px" }}>{c.role}</span>
              <span style={{ marginLeft: "auto", fontSize: "10px", color: hc, background: `${hc}15`, border: `1px solid ${hc}30`, borderRadius: "3px", padding: "1px 6px" }}>
                {c.health}
              </span>
            </div>
            {/* Scale signal */}
            <div style={{ fontSize: "11px", color: "#888", lineHeight: "1.5", marginBottom: c.suggestion ? "8px" : "0" }}>
              {c.scaleSignal}
            </div>
            {/* AI suggestion */}
            {c.suggestion && c.suggestionKind && (
              <div style={{
                background: `${SUGGESTION_COLOR[c.suggestionKind]}0d`,
                border: `1px solid ${SUGGESTION_COLOR[c.suggestionKind]}30`,
                borderRadius: "4px", padding: "8px 10px", display: "flex", gap: "8px",
              }}>
                <span style={{ fontSize: "10px", color: SUGGESTION_COLOR[c.suggestionKind], background: `${SUGGESTION_COLOR[c.suggestionKind]}20`, border: `1px solid ${SUGGESTION_COLOR[c.suggestionKind]}40`, borderRadius: "3px", padding: "1px 6px", flexShrink: 0, alignSelf: "flex-start" }}>
                  ✦ {SUGGESTION_LABEL[c.suggestionKind]}
                </span>
                <span style={{ fontSize: "11px", color: "#888", lineHeight: "1.5" }}>{c.suggestion}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DeployHealthBar({ wiki }: { wiki: ProjectWiki }) {
  const d = wiki.deployHealth;
  return (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
      {[
        ["Frequency", d.frequency],
        ["Last deploy", d.lastDeploy],
        ["Version", d.lastVersion],
        ["Environment", d.env],
        ["Rollbacks (30d)", String(d.rollbacks30d)],
      ].map(([k, v]) => (
        <div key={k}>
          <div style={{ fontSize: "10px", color: "#444", marginBottom: "2px" }}>{k}</div>
          <div style={{ fontSize: "12px", color: "#d1d5db", fontFamily: "monospace" }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function TestHealthBar({ wiki }: { wiki: ProjectWiki }) {
  const t = wiki.testHealth;
  const passRate = Math.round((t.passing / t.total) * 100);
  return (
    <div>
      {/* Bar */}
      <div style={{ display: "flex", height: "6px", borderRadius: "3px", overflow: "hidden", marginBottom: "10px" }}>
        <div style={{ width: `${(t.passing / t.total) * 100}%`, background: "#10b981" }} />
        <div style={{ width: `${(t.flaky / t.total) * 100}%`, background: "#f59e0b" }} />
        <div style={{ width: `${(t.failing / t.total) * 100}%`, background: "#ef4444" }} />
      </div>
      <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
        {[
          ["Passing", t.passing, "#10b981"],
          ["Flaky",   t.flaky,   "#f59e0b"],
          ["Failing", t.failing, "#ef4444"],
          ["Total",   t.total,   "#888"],
          ["Coverage", `${t.coverage}%`, "#3b82f6"],
          ["Last run", t.lastRun, "#555"],
        ].map(([k, v, c]) => (
          <div key={String(k)}>
            <div style={{ fontSize: "10px", color: "#444", marginBottom: "2px" }}>{String(k)}</div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: String(c), fontFamily: "monospace" }}>{String(v)}</div>
          </div>
        ))}
      </div>

      {/* Failing tests */}
      {t.failing > 0 && (
        <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "5px", padding: "10px 12px" }}>
          <div style={{ fontSize: "10px", color: "#ef4444", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Failing tests
          </div>
          {[
            { id: "TC-004", label: "High-value 3DS bypass", detail: "Risk threshold null for amounts $50–$100" },
            { id: "TC-005", label: "Concurrent duplicate checkout", detail: "Missing idempotency lock at checkout.ts:14" },
          ].slice(0, t.failing).map(tc => (
            <div key={tc.id} style={{ display: "flex", gap: "8px", marginBottom: "5px", fontSize: "11px" }}>
              <span style={{ color: "#ef4444", flexShrink: 0 }}>✗</span>
              <span style={{ color: "#888", fontFamily: "monospace" }}>{tc.id}</span>
              <span style={{ color: "#666" }}>—</span>
              <span style={{ color: "#888" }}>{tc.label}</span>
              <span style={{ color: "#555", marginLeft: "auto" }}>{tc.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function KbView() {
  const [activeProjectId, setActiveProjectId] = useState(PROJECTS[0].id);
  const [deepDiveTab, setDeepDiveTab] = useState<DeepDiveTab>("changes");
  const [kindFilter, setKindFilter] = useState<string>("all");

  const project = PROJECTS.find(p => p.id === activeProjectId)!;
  const wiki = PROJECT_WIKIS.find(w => w.projectId === activeProjectId);

  const criticalCount = wiki?.metrics.filter(m => m.status === "critical").length ?? 0;
  const warningCount = wiki?.metrics.filter(m => m.status === "warning").length ?? 0;

  const allKinds = ["all", "deploy", "pr", "incident", "feature", "rollback", "test"];
  const filteredChanges = (wiki?.changes ?? []).filter(c => kindFilter === "all" || c.kind === kindFilter);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#080808", overflow: "hidden" }}>
      <style>{`@keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>

      {/* Project selector strip */}
      <div style={{ padding: "10px 20px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, background: "#0a0a0a" }}>
        <span style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginRight: "4px" }}>Project</span>
        {PROJECTS.filter(p => PROJECT_WIKIS.some(w => w.projectId === p.id)).map(p => {
          const w = PROJECT_WIKIS.find(wi => wi.projectId === p.id);
          const hasCritical = w?.metrics.some(m => m.status === "critical");
          const isActive = p.id === activeProjectId;
          return (
            <button
              key={p.id}
              onClick={() => setActiveProjectId(p.id)}
              style={{
                padding: "4px 12px", borderRadius: "5px", cursor: "pointer",
                border: isActive ? "1px solid #2a3a2a" : "1px solid #1a1a1a",
                background: isActive ? "#0e1a0e" : "#0e0e0e",
                color: isActive ? "#10b981" : "#555",
                fontSize: "11px", display: "flex", alignItems: "center", gap: "5px",
              }}
            >
              {hasCritical && <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#ef4444", animation: "pulse-dot 1s infinite" }} />}
              {p.name}
            </button>
          );
        })}
      </div>

      {!wiki ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: "12px" }}>
          No wiki for this project yet.
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Project header */}
          <div style={{ padding: "16px 24px 14px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                  <h2 style={{ fontSize: "17px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>{project.name}</h2>
                  <span style={{ fontSize: "10px", color: "#888", fontFamily: "monospace", background: "#111", border: "1px solid #1a1a1a", borderRadius: "3px", padding: "1px 6px" }}>
                    {project.repo}
                  </span>
                  {criticalCount > 0 && (
                    <span style={{ fontSize: "10px", color: "#ef4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "3px", padding: "1px 7px", display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ animation: "pulse-dot 1s infinite", display: "inline-block" }}>●</span>
                      {criticalCount} critical metric{criticalCount > 1 ? "s" : ""}
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span style={{ fontSize: "10px", color: "#f59e0b", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "3px", padding: "1px 7px" }}>
                      ▲ {warningCount} warning{warningCount > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>{wiki.tagline}</div>
                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    <span style={{ fontSize: "10px", color: "#444" }}>Stack</span>
                    {wiki.stack.map(s => (
                      <span key={s} style={{ fontSize: "10px", background: "#111", border: "1px solid #1a1a1a", borderRadius: "3px", padding: "1px 5px", color: "#666" }}>{s}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: "10px", color: "#444" }}>
                    Owners: <span style={{ color: "#666" }}>{wiki.owners.join(", ")}</span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#444" }}>
                    On-call: <span style={{ color: "#666" }}>{wiki.oncall}</span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#444" }}>
                    SLO: <span style={{ color: "#555", fontFamily: "monospace" }}>{wiki.slo}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Metrics snapshot row */}
          <div style={{ padding: "14px 24px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
            <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>Metrics Snapshot</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "8px" }}>
              {wiki.metrics.map(m => <MetricCard key={m.label} m={m} />)}
            </div>
          </div>

          {/* Deep dive tabs + content */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Tab bar */}
            <div style={{ padding: "0 24px", borderBottom: "1px solid #1a1a1a", display: "flex", gap: "2px", flexShrink: 0, background: "#0a0a0a" }}>
              {([
                { id: "changes", label: "Changes",     icon: "⬡" },
                { id: "tests",   label: "Tests",       icon: "⊡" },
                { id: "metrics", label: "Metrics",     icon: "⌇" },
                { id: "stack",   label: "Stack Health", icon: "◉" },
                { id: "runbook", label: "Runbook",     icon: "◈" },
              ] as { id: DeepDiveTab; label: string; icon: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setDeepDiveTab(tab.id)}
                  style={{
                    background: deepDiveTab === tab.id ? "#080808" : "transparent",
                    border: deepDiveTab === tab.id ? "1px solid #1a1a1a" : "1px solid transparent",
                    borderBottom: deepDiveTab === tab.id ? "1px solid #080808" : "1px solid transparent",
                    borderRadius: "5px 5px 0 0",
                    color: deepDiveTab === tab.id ? "#e5e5e5" : "#555",
                    padding: "7px 14px", fontSize: "11px", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: "5px",
                    marginBottom: "-1px",
                  }}
                >
                  <span>{tab.icon}</span>{tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>

              {/* Changes — timeline */}
              {deepDiveTab === "changes" && (
                <div style={{ maxWidth: "760px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "14px" }}>
                    <span style={{ fontSize: "11px", color: "#555" }}>Filter:</span>
                    {allKinds.map(k => (
                      <button
                        key={k}
                        onClick={() => setKindFilter(k)}
                        style={{
                          padding: "2px 9px", borderRadius: "4px", cursor: "pointer",
                          border: kindFilter === k ? `1px solid ${k === "all" ? "#2a2a2a" : KIND_COLOR[k] + "44"}` : "1px solid #1a1a1a",
                          background: kindFilter === k ? (k === "all" ? "#1a1a1a" : `${KIND_COLOR[k]}15`) : "transparent",
                          color: kindFilter === k ? (k === "all" ? "#888" : KIND_COLOR[k]) : "#444",
                          fontSize: "10px", textTransform: "capitalize",
                        }}
                      >
                        {k === "all" ? "All" : KIND_ICON[k] + " " + k}
                      </button>
                    ))}
                  </div>
                  {filteredChanges.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "#444" }}>No events match this filter.</div>
                  ) : filteredChanges.map(event => (
                    <ChangeRow key={event.id} event={event} />
                  ))}
                </div>
              )}

              {/* Tests */}
              {deepDiveTab === "tests" && (
                <div style={{ maxWidth: "640px" }}>
                  <div style={{ marginBottom: "16px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "16px 18px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#e5e5e5", marginBottom: "12px" }}>Test Health</div>
                    <TestHealthBar wiki={wiki} />
                  </div>
                  <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "16px 18px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#e5e5e5", marginBottom: "10px" }}>Deploy Health</div>
                    <DeployHealthBar wiki={wiki} />
                  </div>
                </div>
              )}

              {/* Metrics deep dive */}
              {deepDiveTab === "metrics" && (
                <div>
                  <div style={{ fontSize: "12px", color: "#888", marginBottom: "14px", lineHeight: "1.6" }}>
                    {wiki.description}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                    {wiki.metrics.map(m => (
                      <div
                        key={m.label}
                        style={{
                          background: "#0e0e0e",
                          border: `1px solid ${m.status === "critical" ? "rgba(239,68,68,0.2)" : m.status === "warning" ? "rgba(245,158,11,0.15)" : "#1a1a1a"}`,
                          borderRadius: "8px", padding: "16px 18px",
                        }}
                      >
                        <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>{m.label}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "5px", marginBottom: "6px" }}>
                          <span style={{ fontSize: "28px", fontWeight: 700, color: METRIC_STATUS_COLOR[m.status], fontFamily: "monospace", lineHeight: 1 }}>{m.value}</span>
                          <span style={{ fontSize: "13px", color: "#666" }}>{m.unit}</span>
                        </div>
                        <div style={{ fontSize: "11px", color: TREND_COLOR(m.trend, m.status), marginBottom: "6px" }}>
                          {m.trend === "up" ? "↑" : m.trend === "down" ? "↓" : "→"} {m.trendValue}
                        </div>
                        {/* Fake sparkline */}
                        <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "24px", marginTop: "8px" }}>
                          {[40, 38, 42, 41, 39, 43, 45, 42, 44, 48, 52, 65, 80, 100].map((h, i) => (
                            <div key={i} style={{ flex: 1, background: m.status === "critical" ? "#ef444440" : m.status === "warning" ? "#f59e0b40" : "#10b98140", height: `${h}%`, borderRadius: "1px" }} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stack Health */}
              {deepDiveTab === "stack" && (
                wiki.stackHealth
                  ? <StackHealthPanel components={wiki.stackHealth} />
                  : <div style={{ fontSize: "12px", color: "#444" }}>No stack health data for this project.</div>
              )}

              {/* Runbook */}
              {deepDiveTab === "runbook" && (
                <div style={{ maxWidth: "640px" }}>
                  <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "18px 20px", marginBottom: "12px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#e5e5e5", marginBottom: "10px" }}>Overview</div>
                    <div style={{ fontSize: "12px", color: "#888", lineHeight: "1.7" }}>{wiki.description}</div>
                  </div>
                  {[
                    { title: "High error rate", steps: ["Check Datadog APM for trace-level errors", "Check Loki for exception patterns (namespace: payments)", "Cross-reference with ArgoCD for recent deploys", "If deploy-correlated: gate rollback request → get tech-lead approval", "Page payments-oncall if error rate > 5% for > 5 min"] },
                    { title: "p99 latency spike", steps: ["Check Datadog for DB query latency", "Check Redis hit rate — cache miss can cause DB fallback", "Check k8s pod count — under-scaled pods cause queue buildup", "Check upstream risk-service latency", "Scale pods if < 3 healthy: gate action in k8s connector"] },
                    { title: "CI failing on main", steps: ["Check GitHub Actions for failing job", "Read test failure output — TC-004/TC-005 are known flakies", "If TC-005: idempotency lock missing — PR #342 has fix", "Do not force-push to main — create hotfix branch", "Open PR and await tech-lead review"] },
                  ].map(section => (
                    <div key={section.title} style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "14px 18px", marginBottom: "10px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#d1d5db", marginBottom: "8px" }}>Runbook: {section.title}</div>
                      <ol style={{ margin: 0, padding: "0 0 0 16px" }}>
                        {section.steps.map((step, i) => (
                          <li key={i} style={{ fontSize: "11px", color: "#888", lineHeight: "1.7", marginBottom: "2px" }}>{step}</li>
                        ))}
                      </ol>
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
