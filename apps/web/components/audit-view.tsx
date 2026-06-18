"use client";
import { useState, useEffect } from "react";

// Types matching gateway /api/audit response
type AuditOutcome = "root_cause_found" | "answer_provided" | "status_provided" | "analysis_provided" | "pr_created" | "gate_required" | "auto_approved" | "access_denied" | "rollback_initiated" | "blocked"

interface AuditEvent {
  id: string
  timestamp: string
  user: string
  authRole: string
  inferredRole: string
  query: string
  agents: string[]
  outcome: AuditOutcome
  detail: string
  durationMs: number
}

const OUTCOME_CONFIG: Record<AuditOutcome, { label: string; color: string; bg: string }> = {
  root_cause_found: { label: "root_cause_found", color: "#10b981", bg: "rgba(16,185,129,0.08)" },
  answer_provided:  { label: "answer_provided",  color: "#10b981", bg: "rgba(16,185,129,0.08)" },
  status_provided:  { label: "status_provided",  color: "#10b981", bg: "rgba(16,185,129,0.08)" },
  analysis_provided:{ label: "analysis_provided",color: "#10b981", bg: "rgba(16,185,129,0.08)" },
  pr_created:       { label: "pr_created",       color: "#3b82f6", bg: "rgba(59,130,246,0.08)" },
  gate_required:    { label: "gate_required",    color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
  auto_approved:    { label: "auto_approved",    color: "#3b82f6", bg: "rgba(59,130,246,0.08)" },
  access_denied:    { label: "ACCESS DENIED",    color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
  rollback_initiated:{ label: "rollback_initiated", color: "#f97316", bg: "rgba(249,115,22,0.08)" },
  blocked:          { label: "blocked",          color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
};

const ROLE_COLORS: Record<string, string> = {
  dev: "#3b82f6",
  sre: "#ef4444",
  pm: "#8b5cf6",
  ba: "#f59e0b",
  admin: "#10b981",
  system: "#555",
};



function EventRow({ event, expanded, onToggle }: {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const oc = OUTCOME_CONFIG[event.outcome] ?? { label: event.outcome, color: "#888", bg: "rgba(136,136,136,0.08)" };

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          cursor: "pointer",
          background: expanded ? "#111" : "transparent",
          borderBottom: "1px solid #111",
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = "#0e0e0e"; }}
        onMouseLeave={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <td style={{ padding: "10px 14px", fontSize: "11px", fontFamily: "monospace", color: "#444", whiteSpace: "nowrap" }}>
          {event.timestamp.split(" ")[1]}
        </td>
        <td style={{ padding: "10px 14px" }}>
          <span style={{ fontSize: "11px", color: "#d1d5db", fontWeight: 600 }}>{event.user}</span>
        </td>
        <td style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{
              fontSize: "10px", padding: "1px 5px", borderRadius: "3px",
              background: `${ROLE_COLORS[event.authRole] || "#555"}18`,
              border: `1px solid ${ROLE_COLORS[event.authRole] || "#555"}33`,
              color: ROLE_COLORS[event.authRole] || "#555",
              fontFamily: "monospace",
            }}>
              {event.authRole}
            </span>
            {event.authRole !== event.inferredRole && (
              <>
                <span style={{ color: "#444", fontSize: "10px" }}>→</span>
                <span style={{
                  fontSize: "10px", padding: "1px 5px", borderRadius: "3px",
                  background: `${ROLE_COLORS[event.inferredRole] || "#555"}18`,
                  border: `1px solid ${ROLE_COLORS[event.inferredRole] || "#555"}33`,
                  color: ROLE_COLORS[event.inferredRole] || "#555",
                  fontFamily: "monospace",
                }}>
                  {event.inferredRole}
                </span>
              </>
            )}
          </div>
        </td>
        <td style={{ padding: "10px 14px", maxWidth: "260px" }}>
          <div style={{ fontSize: "12px", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {event.query}
          </div>
        </td>
        <td style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
            {event.agents.slice(0, 3).map((a) => (
              <span key={a} style={{ fontSize: "9px", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#555", padding: "1px 5px", borderRadius: "3px", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                {a.replace("-agent", "")}
              </span>
            ))}
            {event.agents.length > 3 && (
              <span style={{ fontSize: "9px", color: "#444" }}>+{event.agents.length - 3}</span>
            )}
            {event.agents.length === 0 && (
              <span style={{ fontSize: "10px", color: "#333" }}>—</span>
            )}
          </div>
        </td>
        <td style={{ padding: "10px 14px" }}>
          <span style={{
            fontSize: "10px", padding: "2px 7px", borderRadius: "4px",
            background: oc.bg, border: `1px solid ${oc.color}33`, color: oc.color,
            fontWeight: event.outcome === "access_denied" ? 700 : 400,
          }}>
            {oc.label}
          </span>
        </td>
        <td style={{ padding: "10px 14px", fontSize: "10px", color: "#444", fontFamily: "monospace", textAlign: "right" }}>
          {event.durationMs}ms
        </td>
        <td style={{ padding: "10px 14px", textAlign: "center" }}>
          <span style={{ color: "#555", fontSize: "11px" }}>{expanded ? "▴" : "▾"}</span>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: "#111" }}>
          <td colSpan={8} style={{ padding: "0 14px 14px 14px" }}>
            <div style={{
              background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "6px",
              padding: "12px 14px", marginTop: "4px",
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 12px", marginBottom: "10px" }}>
                {[
                  ["Event ID", event.id],
                  ["Timestamp", event.timestamp],
                  ["Duration", `${event.durationMs}ms`],
                  ["User", event.user],
                  ["Auth role", event.authRole],
                  ["Inferred role", event.inferredRole],
                ].map(([k, v]) => (
                  <>
                    <span key={`k-${k}`} style={{ fontSize: "10px", color: "#555" }}>{k}</span>
                    <span key={`v-${k}`} style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>{v}</span>
                  </>
                ))}
              </div>
              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px" }}>Query</div>
                <div style={{ fontSize: "12px", color: "#d1d5db", background: "#111", border: "1px solid #1a1a1a", borderRadius: "4px", padding: "6px 10px", fontFamily: "monospace" }}>
                  {event.query}
                </div>
              </div>
              {event.agents.length > 0 && (
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px" }}>Agents invoked</div>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {event.agents.map((a) => (
                      <span key={a} style={{ fontSize: "10px", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888", padding: "2px 7px", borderRadius: "4px", fontFamily: "monospace" }}>
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px" }}>Outcome detail</div>
                <div style={{ fontSize: "11px", color: oc.color === "#ef4444" ? "#ef4444" : "#888", lineHeight: "1.6" }}>
                  {event.detail}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function AuditView() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState("all");
  const [filterRole, setFilterRole] = useState("all");
  const [filterOutcome, setFilterOutcome] = useState("all");
  const [search, setSearch] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/audit")
      .then(r => r.json() as Promise<{ data?: AuditEvent[] }>)
      .then(resp => setEvents(resp.data ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])

  const ALL_USERS = ["all", ...Array.from(new Set(events.map((e) => e.user)))];
  const ALL_ROLES = ["all", ...Array.from(new Set(events.map((e) => e.authRole)))];
  const ALL_OUTCOMES = ["all", ...Array.from(new Set(events.map((e) => e.outcome)))];

  const filtered = events.filter((e) => {
    if (filterUser !== "all" && e.user !== filterUser) return false;
    if (filterRole !== "all" && e.authRole !== filterRole) return false;
    if (filterOutcome !== "all" && e.outcome !== filterOutcome) return false;
    if (search && !e.query.toLowerCase().includes(search.toLowerCase()) && !e.user.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalEvents = events.length;
  const deniedEvents = events.filter((e) => e.outcome === "access_denied").length;
  const gateEvents = events.filter((e) => e.outcome === "gate_required").length;
  const autoEvents = events.filter((e) => e.outcome === "auto_approved").length;

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#080808", color: "#555", fontSize: "12px", fontFamily: "monospace" }}>
        Loading audit events...
      </div>
    )
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "#080808" }}>
      <div style={{ padding: "24px" }}>
        {/* Header */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Compliance</div>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: "0 0 6px" }}>Audit Trail</h2>
          <p style={{ fontSize: "12px", color: "#555", margin: 0 }}>Full immutable log of every query, agent invocation, gate decision, and access event.</p>
        </div>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "20px" }}>
          {[
            { label: "Total events", value: totalEvents, color: "#888" },
            { label: "Access denied", value: deniedEvents, color: "#ef4444" },
            { label: "Gates triggered", value: gateEvents, color: "#f59e0b" },
            { label: "Auto-approved", value: autoEvents, color: "#3b82f6" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "12px 16px" }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color }}>{value}</div>
              <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search queries..."
            style={{
              background: "#0e0e0e", border: "1px solid #2a2a2a", color: "#e5e5e5",
              padding: "6px 10px", borderRadius: "6px", fontSize: "12px", outline: "none", width: "200px",
            }}
          />
          {[
            { label: "User", value: filterUser, options: ALL_USERS, onChange: setFilterUser },
            { label: "Role", value: filterRole, options: ALL_ROLES, onChange: setFilterRole },
            { label: "Outcome", value: filterOutcome, options: ALL_OUTCOMES, onChange: setFilterOutcome },
          ].map(({ label, value, options, onChange }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "#555" }}>{label}:</span>
              <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{
                  background: "#0e0e0e", border: "1px solid #2a2a2a", color: "#888",
                  padding: "5px 8px", borderRadius: "6px", fontSize: "11px", outline: "none", cursor: "pointer",
                }}
              >
                {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          ))}
          <span style={{ fontSize: "11px", color: "#444", marginLeft: "auto" }}>
            {filtered.length} of {totalEvents} events
          </span>
        </div>

        {/* Table */}
        <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
                {["Time", "User", "Role", "Query / Action", "Agents", "Outcome", "ms", ""].map((h) => (
                  <th key={h} style={{
                    padding: "9px 14px", textAlign: "left", fontSize: "10px", fontWeight: 600,
                    color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "32px", textAlign: "center", color: "#444", fontSize: "12px" }}>
                    No events match your filters
                  </td>
                </tr>
              ) : (
                filtered.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    expanded={expandedId === event.id}
                    onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
