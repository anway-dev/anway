"use client";
import { useState, useEffect } from "react";
import { AUTOMATION_TRIGGERS, CRON_MONITORS, TriggerStatus, CronStatus, CronResultStatus } from "@/lib/mock";

// API response types — replace mock shapes with real API contracts
interface TriggerRuleAPI { id: string; eventType: string; enabled: boolean; condition: unknown; actions: unknown[] }
interface CronMonitorAPI { id: string; name: string; schedule: string; jobType: string; enabled: boolean; lastRunAt: string | null; lastResult: unknown | null }

const TRIGGER_STATUS_COLOR: Record<TriggerStatus, string> = {
  active: "#10b981",
  paused: "#555",
  error:  "#ef4444",
};

const CRON_STATUS_COLOR: Record<CronStatus, string> = {
  active: "#10b981",
  paused: "#555",
  error:  "#ef4444",
};

const RESULT_COLOR: Record<CronResultStatus, string> = {
  ok:      "#10b981",
  warning: "#f59e0b",
  error:   "#ef4444",
  skipped: "#555",
};

const EVENT_COLOR: Record<string, string> = {
  alert_fired:        "#ef4444",
  deploy_completed:   "#3b82f6",
  deploy_failed:      "#ef4444",
  error_rate_threshold: "#f59e0b",
  slo_burn_rate:      "#f59e0b",
  pr_merged:          "#8b5cf6",
  test_failed:        "#ef4444",
  incident_created:   "#ef4444",
  cloud_finding:      "#f59e0b",
};

const ACTION_LABEL: Record<string, string> = {
  notify_oncall:    "Notify oncall",
  notify_channel:   "Notify channel",
  create_incident:  "Create incident",
  open_war_room:    "Open war room",
  surface_context:  "Surface to Anvay",
  escalate:         "Escalate",
  run_runbook:      "Run runbook",
  block_deploy_gate:"Block deploy gate",
};

const ACTION_COLOR: Record<string, string> = {
  notify_oncall:    "#3b82f6",
  notify_channel:   "#3b82f6",
  create_incident:  "#ef4444",
  open_war_room:    "#f59e0b",
  surface_context:  "#10b981",
  escalate:         "#f59e0b",
  run_runbook:      "#8b5cf6",
  block_deploy_gate:"#ef4444",
};

type Tab = "triggers" | "crons";

export function AutomationsView() {
  const [tab, setTab] = useState<Tab>("triggers");
  const [triggers, setTriggers] = useState<TriggerRuleAPI[]>([]);
  const [monitors, setMonitors] = useState<CronMonitorAPI[]>([]);

  useEffect(() => {
    fetch('/api/automations/triggers').then(r => r.json()).then(setTriggers).catch(() => setTriggers([]))
    fetch('/api/automations/monitors').then(r => r.json()).then(setMonitors).catch(() => setMonitors([]))
  }, [])

  async function toggleTrigger(id: string, enabled: boolean) {
    await fetch(`/api/automations/triggers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    setTriggers(prev => prev.map(t => t.id === id ? { ...t, enabled } : t))
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#080808", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
        <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>Agent Harness</div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5", marginBottom: "4px" }}>Automations</div>
        <div style={{ fontSize: "11px", color: "#888" }}>Event triggers · scheduled monitors · proactive intelligence</div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
        {([
          { id: "triggers", label: "Event Triggers", count: triggers.filter(t => t.enabled).length },
          { id: "crons",    label: "Cron Monitors",  count: monitors.filter(c => c.enabled).length },
        ] as { id: Tab; label: string; count: number }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 18px", background: "none", border: "none", cursor: "pointer",
              fontSize: "12px", fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? "#e5e5e5" : "#555",
              borderBottom: tab === t.id ? "2px solid #10b981" : "2px solid transparent",
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            {t.label}
            <span style={{
              fontSize: "10px", background: tab === t.id ? "#1a2a1a" : "#111",
              color: tab === t.id ? "#10b981" : "#444",
              border: "1px solid rgba(16,185,129,0.2)", padding: "1px 6px", borderRadius: "10px",
            }}>
              {t.count}
            </span>
          </button>
        ))}
        <div style={{ marginLeft: "auto", padding: "8px 16px", display: "flex", alignItems: "center" }}>
          <button style={{ background: "#111", border: "1px solid #2a2a2a", color: "#555", padding: "5px 12px", borderRadius: "6px", cursor: "not-allowed", fontSize: "11px" }}>
            + New {tab === "triggers" ? "Trigger" : "Monitor"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "triggers" && (
          <div>
            {/* Table header */}
            <div style={{ display: "grid", gridTemplateColumns: "22px 200px 140px 200px 1fr 90px 60px", gap: "0", padding: "8px 20px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
              {["", "Name", "Event", "Condition", "Actions", "Last Fired", "Fires"].map(h => (
                <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 6px" }}>{h}</div>
              ))}
            </div>

            {AUTOMATION_TRIGGERS.map(t => (
              <div
                key={t.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "22px 200px 140px 200px 1fr 90px 60px",
                  gap: "0",
                  padding: "12px 20px",
                  borderBottom: "1px solid #111",
                  alignItems: "center",
                  background: t.status === "paused" ? "rgba(0,0,0,0.3)" : "transparent",
                  opacity: t.status === "paused" ? 0.6 : 1,
                }}
              >
                {/* Status dot */}
                <div style={{ padding: "0 6px", display: "flex", alignItems: "center" }}>
                  <div style={{
                    width: "6px", height: "6px", borderRadius: "50%",
                    background: TRIGGER_STATUS_COLOR[t.status],
                    ...(t.status === "active" ? { boxShadow: `0 0 5px ${TRIGGER_STATUS_COLOR[t.status]}` } : {}),
                  }} />
                </div>

                {/* Name */}
                <div style={{ padding: "0 6px" }}>
                  <div style={{ fontSize: "12px", color: "#e5e5e5", fontWeight: 500, marginBottom: "2px" }}>{t.name}</div>
                  <div style={{ fontSize: "10px", color: "#444" }}>by {t.createdBy}</div>
                </div>

                {/* Event type */}
                <div style={{ padding: "0 6px" }}>
                  <span style={{
                    fontSize: "10px", color: EVENT_COLOR[t.event] ?? "#888",
                    background: `${EVENT_COLOR[t.event] ?? "#888"}15`,
                    border: `1px solid ${EVENT_COLOR[t.event] ?? "#888"}30`,
                    padding: "2px 7px", borderRadius: "4px", fontFamily: "monospace",
                  }}>
                    {t.event.replace(/_/g, " ")}
                  </span>
                </div>

                {/* Condition */}
                <div style={{ padding: "0 6px" }}>
                  <code style={{ fontSize: "10px", color: "#888", fontFamily: "monospace" }}>{t.condition}</code>
                  <div style={{ fontSize: "10px", color: "#444", marginTop: "2px" }}>{t.scope}</div>
                </div>

                {/* Actions */}
                <div style={{ padding: "0 6px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {t.actions.map((a, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: "9px", color: ACTION_COLOR[a.type],
                        background: `${ACTION_COLOR[a.type]}12`,
                        border: `1px solid ${ACTION_COLOR[a.type]}25`,
                        padding: "2px 6px", borderRadius: "3px",
                      }}
                    >
                      {ACTION_LABEL[a.type] ?? a.type}
                      {a.target ? ` → ${a.target}` : ""}
                    </span>
                  ))}
                </div>

                {/* Last fired */}
                <div style={{ padding: "0 6px", fontSize: "10px", color: t.lastFired ? "#888" : "#444" }}>
                  {t.lastFired ?? "Never"}
                </div>

                {/* Fire count */}
                <div style={{ padding: "0 6px", fontSize: "11px", color: "#555", fontFamily: "monospace" }}>
                  {t.fireCount}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "crons" && (
          <div>
            {/* Table header */}
            <div style={{ display: "grid", gridTemplateColumns: "22px 200px 130px 120px 120px 1fr 60px", gap: "0", padding: "8px 20px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
              {["", "Name", "Schedule", "Last Run", "Next Run", "Last Result", "Runs"].map(h => (
                <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 6px" }}>{h}</div>
              ))}
            </div>

            {CRON_MONITORS.map(c => (
              <div
                key={c.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "22px 200px 130px 120px 120px 1fr 60px",
                  gap: "0",
                  padding: "12px 20px",
                  borderBottom: "1px solid #111",
                  alignItems: "start",
                }}
              >
                {/* Status dot */}
                <div style={{ padding: "0 6px 0 0", display: "flex", alignItems: "center", paddingTop: "2px" }}>
                  <div style={{
                    width: "6px", height: "6px", borderRadius: "50%",
                    background: CRON_STATUS_COLOR[c.status],
                    ...(c.status === "active" ? { boxShadow: `0 0 5px ${CRON_STATUS_COLOR[c.status]}` } : {}),
                  }} />
                </div>

                {/* Name + desc */}
                <div style={{ padding: "0 6px" }}>
                  <div style={{ fontSize: "12px", color: "#e5e5e5", fontWeight: 500, marginBottom: "3px" }}>{c.name}</div>
                  <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.5" }}>{c.description}</div>
                  <div style={{ marginTop: "4px" }}>
                    <span style={{ fontSize: "9px", background: "#111", border: "1px solid #2a2a2a", color: "#666", padding: "1px 6px", borderRadius: "3px" }}>
                      {c.agentType} agent
                    </span>
                  </div>
                </div>

                {/* Schedule */}
                <div style={{ padding: "0 6px" }}>
                  <code style={{ fontSize: "10px", color: "#8b5cf6", fontFamily: "monospace", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", padding: "2px 6px", borderRadius: "3px" }}>
                    {c.schedule}
                  </code>
                </div>

                {/* Last run */}
                <div style={{ padding: "0 6px", fontSize: "10px", color: "#888" }}>{c.lastRun}</div>

                {/* Next run */}
                <div style={{ padding: "0 6px", fontSize: "10px", color: "#555" }}>{c.nextRun}</div>

                {/* Last result */}
                <div style={{ padding: "0 6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "4px" }}>
                    <span style={{
                      fontSize: "9px", fontWeight: 700, textTransform: "uppercase",
                      color: RESULT_COLOR[c.lastResult],
                      background: `${RESULT_COLOR[c.lastResult]}12`,
                      border: `1px solid ${RESULT_COLOR[c.lastResult]}30`,
                      padding: "1px 6px", borderRadius: "3px",
                    }}>
                      {c.lastResult}
                    </span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.5" }}>{c.lastResultSummary}</div>
                </div>

                {/* Run count */}
                <div style={{ padding: "0 6px" }}>
                  <div style={{ fontSize: "11px", color: "#555", fontFamily: "monospace" }}>{c.runCount}</div>
                  {c.errorCount > 0 && (
                    <div style={{ fontSize: "10px", color: "#ef4444", marginTop: "2px" }}>{c.errorCount} err</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
