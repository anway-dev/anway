"use client";
import { useState } from "react";
import { INTAKE_SOURCES, INTAKE_LOG, IntakeSource, IntakeMode } from "@/lib/mock";
import { PreviewBanner } from "@/components/preview-banner";

const MODE_LABEL: Record<IntakeMode, string> = {
  bypass: "Bypass",
  monitor: "Monitor",
  handle: "L1 Assist",
};

const MODE_COLOR: Record<IntakeMode, string> = {
  bypass: "#555",
  monitor: "#3b82f6",
  handle: "#10b981",
};

const MODE_DESC: Record<IntakeMode, string> = {
  bypass: "Signals pass through to your existing escalation policy unchanged.",
  monitor: "Anvay observes and logs signals but does not intercept or respond.",
  handle: "Anvay triages and surfaces root cause context to your team. Human decides on action — no auto-resolution.",
};

const DISP_COLOR: Record<string, string> = {
  context_surfaced: "#10b981",
  escalated: "#f59e0b",
  suppressed: "#555",
  open: "#3b82f6",
};

const DISP_LABEL: Record<string, string> = {
  context_surfaced: "Context surfaced",
  escalated: "Escalated",
  suppressed: "Suppressed",
  open: "Open",
};

function SourceCard({ source, selected, onClick }: { source: IntakeSource; selected: boolean; onClick: () => void }) {
  const assistRate = source.stats.received > 0
    ? Math.round((source.stats.assisted / source.stats.received) * 100)
    : 0;

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "10px", width: "100%",
        padding: "10px 12px", borderRadius: "6px", border: selected ? "1px solid #2a3a2a" : "1px solid #1a1a1a",
        background: selected ? "#0e1a0e" : "#0e0e0e", cursor: "pointer", textAlign: "left",
        marginBottom: "4px", transition: "all 0.15s",
      }}
    >
      {/* Icon */}
      <div style={{
        width: "28px", height: "28px", borderRadius: "5px", background: `${source.color}22`,
        border: `1px solid ${source.color}44`, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: "9px", fontWeight: 800, color: source.color,
        fontFamily: "monospace", flexShrink: 0,
      }}>
        {source.icon}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500 }}>{source.name}</span>
          {!source.webhookConfigured && (
            <span style={{ fontSize: "9px", color: "#555", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "3px", padding: "1px 4px" }}>
              not configured
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
          <span style={{
            fontSize: "10px", color: MODE_COLOR[source.mode],
            background: `${MODE_COLOR[source.mode]}15`, border: `1px solid ${MODE_COLOR[source.mode]}30`,
            borderRadius: "3px", padding: "0 5px",
          }}>
            {MODE_LABEL[source.mode]}
          </span>
          {source.stats.received > 0 && (
            <span style={{ fontSize: "10px", color: "#555" }}>
              {assistRate}% assisted · {source.stats.received} received
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ConfigPanel({ source }: { source: IntakeSource }) {
  const [mode, setMode] = useState<IntakeMode>(source.mode);
  const [threshold, setThreshold] = useState(source.confidenceThreshold);
  const [escalationPolicy, setEscalationPolicy] = useState(source.escalationPolicy);
  const assistRate = source.stats.received > 0
    ? Math.round((source.stats.assisted / source.stats.received) * 100)
    : null;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
      {/* Source header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <div style={{
          width: "36px", height: "36px", borderRadius: "8px", background: `${source.color}22`,
          border: `1px solid ${source.color}44`, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: "11px", fontWeight: 800, color: source.color,
          fontFamily: "monospace",
        }}>
          {source.icon}
        </div>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#e5e5e5" }}>{source.name}</div>
          <div style={{ fontSize: "11px", color: "#555", textTransform: "capitalize" }}>{source.category}</div>
        </div>
        {source.stats.received > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "16px" }}>
            {[
              ["Received", source.stats.received, "#888"],
              ["Assisted", source.stats.assisted, "#10b981"],
              ["Escalated", source.stats.escalated, "#f59e0b"],
            ].map(([label, val, color]) => (
              <div key={String(label)} style={{ textAlign: "right" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: color as string }}>{String(val)}</div>
                <div style={{ fontSize: "10px", color: "#555" }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Intake mode */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", color: "#888", fontWeight: 600, marginBottom: "8px" }}>Intake Mode</div>
        <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
          {(["bypass", "monitor", "handle"] as IntakeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1, padding: "8px", borderRadius: "6px", cursor: "pointer",
                border: mode === m ? `1px solid ${MODE_COLOR[m]}66` : "1px solid #1a1a1a",
                background: mode === m ? `${MODE_COLOR[m]}15` : "#0e0e0e",
                color: mode === m ? MODE_COLOR[m] : "#555",
                fontSize: "11px", fontWeight: mode === m ? 700 : 400, transition: "all 0.15s",
              }}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div style={{ fontSize: "11px", color: "#555", lineHeight: "1.5" }}>{MODE_DESC[mode]}</div>
      </div>

      {/* Escalation threshold — only relevant for assist mode */}
      {mode === "handle" && (
        <div style={{ marginBottom: "20px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#888", fontWeight: 600 }}>Escalation threshold</span>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#10b981", fontFamily: "monospace" }}>
              {threshold.toFixed(2)}
            </span>
          </div>
          <input
            type="range" min="0.50" max="0.99" step="0.01"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            style={{ width: "100%", accentColor: "#10b981" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#444", marginTop: "4px" }}>
            <span>0.50 — surface all</span>
            <span>0.99 — high confidence only</span>
          </div>
          <div style={{ marginTop: "8px", fontSize: "11px", color: "#555" }}>
            Signals with confidence ≥ <span style={{ color: "#10b981" }}>{threshold.toFixed(2)}</span>: Anvay surfaces root cause + recommended action to your team.
            Below threshold → escalated directly to <span style={{ color: "#888" }}>{escalationPolicy}</span> with partial context.
            {assistRate !== null && (
              <span style={{ color: "#888" }}> Current rate: {assistRate}% assisted.</span>
            )}
          </div>
        </div>
      )}

      {/* Escalation policy */}
      {mode !== "bypass" && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>Escalation Policy</div>
          <input
            value={escalationPolicy}
            onChange={(e) => setEscalationPolicy(e.target.value)}
            style={{
              width: "100%", background: "#0e0e0e", border: "1px solid #2a2a2a",
              borderRadius: "6px", padding: "8px 12px", color: "#e5e5e5", fontSize: "12px",
              outline: "none", boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: "10px", color: "#444", marginTop: "4px" }}>
            Escalated signals are routed to this policy in {source.name}.
          </div>
        </div>
      )}

      {/* Webhook config */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>Webhook Endpoint</div>
        <div style={{
          background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "6px",
          padding: "10px 12px", display: "flex", alignItems: "center", gap: "8px",
        }}>
          <div style={{
            width: "5px", height: "5px", borderRadius: "50%", flexShrink: 0,
            background: source.webhookConfigured ? "#10b981" : "#555",
          }} />
          <code style={{ flex: 1, fontSize: "11px", fontFamily: "monospace", color: source.webhookConfigured ? "#d1d5db" : "#555" }}>
            https://app.anvay.io{source.webhookPath}
          </code>
          <button style={{
            background: "none", border: "1px solid #2a2a2a", color: "#888",
            padding: "2px 8px", borderRadius: "4px", fontSize: "10px", cursor: "pointer",
          }}>
            Copy
          </button>
        </div>
        {!source.webhookConfigured && (
          <div style={{ fontSize: "10px", color: "#f59e0b", marginTop: "6px" }}>
            ⚠ Configure this URL as a webhook in {source.name} to enable signal routing.
          </div>
        )}
      </div>

      {/* Save */}
      <button style={{
        background: "#10b981", border: "none", color: "#000",
        padding: "8px 20px", borderRadius: "6px", fontSize: "12px",
        fontWeight: 700, cursor: "pointer",
      }}>
        Save configuration
      </button>
    </div>
  );
}

export function IntakeView() {
  const [selectedId, setSelectedId] = useState(INTAKE_SOURCES[0].id);
  const [logTab, setLogTab] = useState(false);

  const selected = INTAKE_SOURCES.find(s => s.id === selectedId)!;
  const alertManagers = INTAKE_SOURCES.filter(s => s.category === "alertmanager");
  const ticketingSources = INTAKE_SOURCES.filter(s => s.category === "ticketing");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#080808" }}>
      <PreviewBanner />
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Left: source list */}
      <div style={{ width: "260px", flexShrink: 0, background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Signal Routing</div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5" }}>Signal Assist</div>
          <div style={{ fontSize: "11px", color: "#555", marginTop: "4px", lineHeight: "1.5" }}>
            Anvay triages signals and surfaces context. Your team decides what to do.
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
          <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
            Alert Managers
          </div>
          {alertManagers.map(s => (
            <SourceCard key={s.id} source={s} selected={selectedId === s.id} onClick={() => setSelectedId(s.id)} />
          ))}

          <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px", marginTop: "16px" }}>
            Ticketing & Support
          </div>
          {ticketingSources.map(s => (
            <SourceCard key={s.id} source={s} selected={selectedId === s.id} onClick={() => setSelectedId(s.id)} />
          ))}
        </div>

        {/* Intake log toggle */}
        <div style={{ padding: "10px 12px", borderTop: "1px solid #1a1a1a" }}>
          <button
            onClick={() => setLogTab(!logTab)}
            style={{
              width: "100%", padding: "7px 10px", borderRadius: "5px", cursor: "pointer",
              background: logTab ? "#1a2a1a" : "transparent",
              border: logTab ? "1px solid rgba(16,185,129,0.2)" : "1px solid #1a1a1a",
              color: logTab ? "#10b981" : "#555", fontSize: "11px", textAlign: "left",
            }}
          >
            ◎ Intake log
          </button>
        </div>
      </div>

      {/* Right: config or log */}
      {logTab ? (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Signal Routing</div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5", marginBottom: "16px" }}>Intake Log</h2>
          {INTAKE_LOG.map(evt => (
            <div
              key={evt.id}
              style={{
                background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px",
                marginBottom: "8px", overflow: "hidden",
                borderLeft: `3px solid ${DISP_COLOR[evt.disposition]}`,
              }}
            >
              <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  fontSize: "9px", fontWeight: 800, fontFamily: "monospace",
                  color: evt.sourceColor, background: `${evt.sourceColor}22`,
                  border: `1px solid ${evt.sourceColor}44`, borderRadius: "3px",
                  padding: "1px 5px", flexShrink: 0,
                }}>
                  {evt.sourceName.split(" ")[0].toUpperCase().slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", color: "#d1d5db", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {evt.title}
                  </div>
                  <div style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}>
                    {evt.receivedAt} · {evt.durationMs}ms
                    {evt.escalatedTo && <span> · escalated to <span style={{ color: "#f59e0b" }}>{evt.escalatedTo}</span></span>}
                  </div>
                </div>
                <div style={{
                  fontSize: "10px", color: DISP_COLOR[evt.disposition],
                  background: `${DISP_COLOR[evt.disposition]}15`,
                  border: `1px solid ${DISP_COLOR[evt.disposition]}30`,
                  borderRadius: "3px", padding: "1px 6px", flexShrink: 0,
                }}>
                  {DISP_LABEL[evt.disposition]}
                  {evt.confidence !== undefined && (
                    <span style={{ opacity: 0.7 }}> · {Math.round(evt.confidence * 100)}%</span>
                  )}
                </div>
              </div>
              <div style={{ padding: "0 14px 10px", fontSize: "11px", color: "#666", lineHeight: "1.5" }}>
                {evt.triageSummary}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ConfigPanel source={selected} />
      )}
      </div>
    </div>
  );
}
