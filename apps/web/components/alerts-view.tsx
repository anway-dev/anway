"use client";
import { useState, useEffect } from "react";

// Types matching gateway /api/alerts response
type AlertSeverity = "critical" | "high" | "medium" | "low"
type TriageStatus = "auto_triaged" | "triaging" | "pending" | "escalated"

interface LiveAlert {
  id: string
  kind: "alert" | "ticket" | "metric" | "customer" | "ci" | "error"
  severity: AlertSeverity
  title: string
  source: string
  sourceIcon: string
  sourceColor: string
  service: string
  timestamp: string
  triageStatus: TriageStatus
  triageSummary?: string
  confidence?: number
  gateId?: string
  gateStatus?: "pending_approval" | "auto_approved"
  orchestratorQuery: string
  branch?: string
  commitSha?: string
  runUrl?: string
  errorCount?: number
  firstSeen?: string
}

interface Props {
  onTriggerOrchestrator: (query: string, context: { title: string; source: string }) => void;
}

type Tab = "all" | "alert" | "error" | "ci" | "ticket" | "customer" | "metric";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "all",      label: "All",          icon: "◈" },
  { id: "alert",    label: "Alerts",       icon: "◎" },
  { id: "error",    label: "Errors",       icon: "✕" },
  { id: "ci",       label: "CI/CD",        icon: "⬡" },
  { id: "ticket",   label: "Tickets",      icon: "⊡" },
  { id: "customer", label: "Customers",    icon: "⊞" },
  { id: "metric",   label: "Metrics",      icon: "⌇" },
];

const SEV_COLOR: Record<AlertSeverity, string> = {
  critical: "#ef4444",
  high:     "#f59e0b",
  medium:   "#3b82f6",
  low:      "#555",
};

const TRIAGE_COLOR: Record<TriageStatus, string> = {
  auto_triaged: "#10b981",
  triaging:     "#3b82f6",
  pending:      "#555",
  escalated:    "#ef4444",
};

const TRIAGE_LABEL: Record<TriageStatus, string> = {
  auto_triaged: "Auto-triaged",
  triaging:     "Triaging…",
  pending:      "Pending",
  escalated:    "Escalated",
};

const KIND_COLOR: Record<string, string> = {
  alert:    "#ef4444",
  error:    "#8b5cf6",
  ci:       "#6e7681",
  ticket:   "#5e6ad2",
  customer: "#286efa",
  metric:   "#f59e0b",
};

const KIND_LABEL: Record<string, string> = {
  alert:    "Alert",
  error:    "Error",
  ci:       "CI/CD",
  ticket:   "Ticket",
  customer: "Customer",
  metric:   "Metric",
};

function GateBadge({ gateStatus, gateId }: { gateStatus: "pending_approval" | "auto_approved"; gateId?: string }) {
  if (gateStatus === "auto_approved") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: "4px",
        background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)",
        borderRadius: "4px", padding: "2px 6px", fontSize: "10px", color: "#10b981",
      }}>
        ✓ Auto-approved
      </span>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{
        display: "inline-flex", alignItems: "center", gap: "4px",
        background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
        borderRadius: "4px", padding: "2px 6px", fontSize: "10px", color: "#f59e0b",
      }}>
        ⏳ Pending approval
      </span>
      <button style={{ background: "#10b981", border: "none", color: "#000", padding: "2px 8px", borderRadius: "3px", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}>
        Approve
      </button>
      <button style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#888", padding: "2px 8px", borderRadius: "3px", fontSize: "10px", cursor: "pointer" }}>
        Decline
      </button>
    </div>
  );
}

function SignalRow({ alert, onWhy }: { alert: LiveAlert; onWhy: () => void }) {
  const [expanded, setExpanded] = useState(
    alert.triageStatus === "auto_triaged" && alert.severity === "critical"
  );

  return (
    <div style={{
      background: "#0e0e0e",
      border: "1px solid #1a1a1a",
      borderLeft: `3px solid ${SEV_COLOR[alert.severity]}`,
      borderRadius: "6px", marginBottom: "6px", overflow: "hidden",
    }}>
      {/* Main row */}
      <div style={{ padding: "9px 12px", display: "flex", alignItems: "center", gap: "8px" }}>
        {/* Kind + severity */}
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", flexShrink: 0, width: "62px" }}>
          <span style={{
            fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
            color: KIND_COLOR[alert.kind], background: `${KIND_COLOR[alert.kind]}18`,
            border: `1px solid ${KIND_COLOR[alert.kind]}33`, borderRadius: "3px",
            padding: "1px 5px", textAlign: "center",
          }}>
            {KIND_LABEL[alert.kind]}
          </span>
          <span style={{
            fontSize: "9px", fontWeight: 700, textTransform: "uppercase",
            color: SEV_COLOR[alert.severity], background: `${SEV_COLOR[alert.severity]}15`,
            border: `1px solid ${SEV_COLOR[alert.severity]}30`, borderRadius: "3px",
            padding: "1px 5px", textAlign: "center",
          }}>
            {alert.severity}
          </span>
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {alert.title}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "3px", flexWrap: "wrap" }}>
            <span style={{
              fontSize: "10px", background: "#1a1a1a", border: "1px solid #2a2a2a",
              borderRadius: "3px", padding: "0 5px", color: alert.sourceColor,
              fontFamily: "monospace", fontWeight: 700,
            }}>
              {alert.sourceIcon}
            </span>
            <span style={{ fontSize: "10px", color: "#555" }}>{alert.source}</span>
            <span style={{ fontSize: "10px", color: "#333" }}>·</span>
            <span style={{ fontSize: "10px", color: "#444", fontFamily: "monospace" }}>{alert.service}</span>
            <span style={{ fontSize: "10px", color: "#333" }}>·</span>
            <span style={{ fontSize: "10px", color: "#444" }}>{alert.timestamp}</span>
            {/* CI-specific metadata */}
            {alert.branch && (
              <>
                <span style={{ fontSize: "10px", color: "#333" }}>·</span>
                <span style={{ fontSize: "10px", color: "#6e7681", fontFamily: "monospace" }}>
                  {alert.branch}
                </span>
              </>
            )}
            {alert.commitSha && (
              <span style={{ fontSize: "10px", color: "#444", fontFamily: "monospace" }}>
                @ {alert.commitSha.slice(0, 7)}
              </span>
            )}
            {/* Error-specific metadata */}
            {alert.errorCount !== undefined && (
              <>
                <span style={{ fontSize: "10px", color: "#333" }}>·</span>
                <span style={{ fontSize: "10px", color: "#8b5cf6" }}>{alert.errorCount} events</span>
              </>
            )}
          </div>
        </div>

        {/* Triage status */}
        <span style={{
          fontSize: "10px", color: TRIAGE_COLOR[alert.triageStatus],
          background: `${TRIAGE_COLOR[alert.triageStatus]}15`,
          border: `1px solid ${TRIAGE_COLOR[alert.triageStatus]}30`,
          borderRadius: "3px", padding: "1px 6px", flexShrink: 0,
          display: "flex", alignItems: "center", gap: "4px",
        }}>
          {alert.triageStatus === "triaging" && (
            <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#3b82f6", display: "inline-block", animation: "pulse-dot 1s infinite" }} />
          )}
          {TRIAGE_LABEL[alert.triageStatus]}
          {alert.confidence !== undefined && (
            <span style={{ opacity: 0.65 }}> · {Math.round(alert.confidence * 100)}%</span>
          )}
        </span>

        {/* Expand toggle */}
        {alert.triageSummary && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "11px", padding: "2px 4px", flexShrink: 0 }}
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}

        {/* Debug / Why button */}
        <button
          onClick={onWhy}
          style={{
            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)",
            color: "#10b981", padding: "4px 10px", borderRadius: "5px",
            fontSize: "11px", fontWeight: 700, cursor: "pointer", flexShrink: 0,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget).style.background = "rgba(16,185,129,0.18)"; }}
          onMouseLeave={(e) => { (e.currentTarget).style.background = "rgba(16,185,129,0.08)"; }}
        >
          Debug ✦
        </button>
      </div>

      {/* Expanded triage detail */}
      {expanded && alert.triageSummary && (
        <div style={{ padding: "10px 12px 12px 12px", borderTop: "1px solid #1a1a1a", background: "#0a0a0a" }}>
          <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>
            Auto-triage · {alert.source}
          </div>
          <div style={{ fontSize: "11px", color: "#888", lineHeight: "1.6", marginBottom: alert.gateStatus ? "10px" : "0" }}>
            {alert.triageSummary}
          </div>
          {alert.gateStatus && alert.gateId && (
            <div>
              <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px" }}>
                Action gate — {alert.gateId}
              </div>
              <GateBadge gateStatus={alert.gateStatus} gateId={alert.gateId} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SEV_ORDER: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function AlertsView({ onTriggerOrchestrator }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "all">("all");
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/alerts")
      .then(r => r.json() as Promise<LiveAlert[]>)
      .then(setAlerts)
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false))
  }, [])

  const criticalCount = alerts.filter(a => a.severity === "critical").length;

  let items = tab === "all" ? alerts : alerts.filter(a => a.kind === tab);
  if (severityFilter !== "all") items = items.filter(a => a.severity === severityFilter);
  items = [...items].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#080808", color: "#555", fontSize: "12px", fontFamily: "monospace" }}>
        Loading signals...
      </div>
    )
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#080808", overflow: "hidden" }}>
      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      {/* Header */}
      <div style={{ padding: "16px 20px 0", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <div>
            <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>Signals</div>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>All Project Failures</h2>
          </div>
          {criticalCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px", padding: "3px 8px" }}>
              <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#ef4444", animation: "pulse-dot 1s infinite" }} />
              <span style={{ fontSize: "11px", color: "#ef4444", fontWeight: 600 }}>{criticalCount} critical active</span>
            </div>
          )}
          {/* Severity filter */}
          <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
            {(["all", "critical", "high", "medium"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                style={{
                  background: severityFilter === s ? (s === "all" ? "#1a1a1a" : `${SEV_COLOR[s as AlertSeverity]}18`) : "transparent",
                  border: severityFilter === s ? `1px solid ${s === "all" ? "#2a2a2a" : SEV_COLOR[s as AlertSeverity] + "44"}` : "1px solid transparent",
                  color: severityFilter === s ? (s === "all" ? "#888" : SEV_COLOR[s as AlertSeverity]) : "#444",
                  padding: "3px 9px", borderRadius: "4px", fontSize: "10px",
                  textTransform: "capitalize", cursor: "pointer",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "2px" }}>
          {TABS.map(t => {
            const count = t.id === "all" ? alerts.length : alerts.filter(a => a.kind === t.id).length;
            const hasCritical = t.id !== "all" && alerts.some(a => a.kind === t.id && a.severity === "critical");
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: tab === t.id ? "#0e0e0e" : "transparent",
                  border: tab === t.id ? "1px solid #2a2a2a" : "1px solid transparent",
                  borderBottom: tab === t.id ? "1px solid #0e0e0e" : "1px solid transparent",
                  borderRadius: "5px 5px 0 0",
                  color: tab === t.id ? "#e5e5e5" : "#555",
                  padding: "6px 12px", fontSize: "11px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "5px",
                  marginBottom: "-1px",
                }}
              >
                <span style={{ fontSize: "11px" }}>{t.icon}</span>
                {t.label}
                <span style={{
                  background: hasCritical ? "rgba(239,68,68,0.15)" : "#1a1a1a",
                  color: hasCritical ? "#ef4444" : "#555",
                  border: hasCritical ? "1px solid rgba(239,68,68,0.3)" : "1px solid #2a2a2a",
                  borderRadius: "10px", padding: "0 5px", fontSize: "10px",
                  minWidth: "16px", textAlign: "center",
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Signal list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: "#444", fontSize: "12px" }}>
            No signals match the current filter.
          </div>
        ) : (
          items.map(alert => (
            <SignalRow
              key={alert.id}
              alert={alert}
              onWhy={() => onTriggerOrchestrator(alert.orchestratorQuery, { title: alert.title, source: alert.source })}
            />
          ))
        )}
      </div>

      {/* Footer: source legend */}
      <div style={{ padding: "8px 20px", borderTop: "1px solid #1a1a1a", display: "flex", gap: "12px", flexWrap: "wrap", flexShrink: 0 }}>
        {Object.entries(KIND_LABEL).map(([kind, label]) => (
          <div key={kind} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "1px", background: KIND_COLOR[kind] }} />
            <span style={{ fontSize: "10px", color: "#555" }}>{label}</span>
          </div>
        ))}
        <span style={{ fontSize: "10px", color: "#333", marginLeft: "auto" }}>
          Sources: Datadog · Sentry · GitHub Actions · PagerDuty · Linear · Zendesk · Intercom · EKS
        </span>
      </div>
    </div>
  );
}
