"use client";
import { useState, useEffect } from "react";

interface TriggerRuleAPI {
  id: string
  eventType: string
  enabled: boolean
  condition: Record<string, unknown> | null
  actions: Array<{ type: string; target?: string; params?: Record<string, string> }>
  createdAt?: string
}

interface CronMonitorAPI {
  id: string
  name: string
  schedule: string
  jobType: string
  enabled: boolean
  lastRunAt: string | null
  lastResult: { status?: string; summary?: string } | null
}

interface DisplayTrigger {
  id: string
  name: string
  status: string
  event: string
  condition: string
  scope: string
  actions: Array<{ type: string; target?: string }>
  lastFired: string | null
  fireCount: number
  createdBy: string
}

interface DisplayCron {
  id: string
  name: string
  status: string
  schedule: string
  description: string
  agentType: string
  lastRun: string
  nextRun: string
  lastResult: string
  lastResultSummary: string
  runCount: number
  errorCount: number
}

function toDisplayTrigger(t: TriggerRuleAPI): DisplayTrigger {
  const condStr = t.condition && Object.keys(t.condition).length > 0
    ? Object.entries(t.condition).map(([k, v]) => `${k}: ${v}`).join(', ')
    : 'any'
  return {
    id: t.id,
    name: t.eventType.replace(/_/g, ' '),
    status: t.enabled ? 'active' : 'paused',
    event: t.eventType,
    condition: condStr,
    scope: 'all',
    actions: t.actions.map(a => ({ type: a.type, target: a.target })),
    lastFired: null,
    fireCount: 0,
    createdBy: 'system',
  }
}

function toDisplayCron(c: CronMonitorAPI): DisplayCron {
  const lastRunAt = c.lastRunAt ? new Date(c.lastRunAt).toLocaleTimeString() : 'Never'
  const resultStatus = c.lastResult?.status ?? 'ok'
  const resultSummary = c.lastResult?.summary ?? ''
  return {
    id: c.id,
    name: c.name,
    status: c.enabled ? 'active' : 'paused',
    schedule: c.schedule,
    description: c.jobType.replace(/_/g, ' '),
    agentType: c.jobType,
    lastRun: lastRunAt,
    nextRun: '—',
    lastResult: resultStatus,
    lastResultSummary: resultSummary,
    runCount: 0,
    errorCount: 0,
  }
}

const STATUS_COLOR: Record<string, string> = {
  active: "#10b981",
  paused: "#555",
  error:  "#ef4444",
};

const RESULT_COLOR: Record<string, string> = {
  ok:      "#10b981",
  warning: "#f59e0b",
  error:   "#ef4444",
  skipped: "#555",
};

const EVENT_COLOR: Record<string, string> = {
  alert_fired:          "#ef4444",
  deploy_completed:     "#3b82f6",
  deploy_failed:        "#ef4444",
  error_rate_threshold: "#f59e0b",
  slo_burn_rate:        "#f59e0b",
  pr_merged:            "#8b5cf6",
  test_failed:          "#ef4444",
  incident_created:     "#ef4444",
  cloud_finding:        "#f59e0b",
};

const ACTION_LABEL: Record<string, string> = {
  notify_oncall:     "Notify oncall",
  notify_channel:    "Notify channel",
  create_incident:   "Create incident",
  open_war_room:     "Open war room",
  surface_context:   "Surface to Anvay",
  escalate:          "Escalate",
  run_runbook:       "Run runbook",
  block_deploy_gate: "Block deploy gate",
};

const ACTION_COLOR: Record<string, string> = {
  notify_oncall:     "#3b82f6",
  notify_channel:    "#3b82f6",
  create_incident:   "#ef4444",
  open_war_room:     "#f59e0b",
  surface_context:   "#10b981",
  escalate:          "#f59e0b",
  run_runbook:       "#8b5cf6",
  block_deploy_gate: "#ef4444",
};

interface AutomationRun {
  id: string
  status: string
  summary: Record<string, unknown> | null
  startedAt: string
  finishedAt: string
}

type Tab = "triggers" | "crons";

export function AutomationsView() {
  const [tab, setTab] = useState<Tab>("triggers");
  const [triggers, setTriggers] = useState<TriggerRuleAPI[]>([]);
  const [monitors, setMonitors] = useState<CronMonitorAPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, 'trigger' | 'cron'>>({});
  const [cronRuns, setCronRuns] = useState<Record<string, AutomationRun[] | 'loading'>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ eventType: 'alert_fired', condition: '{}', actions: '' });
  const [monitorForm, setMonitorForm] = useState({ name: '', schedule: '*/5 * * * *', jobType: 'service_health_sweep' });
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/automations/triggers').then(r => r.json() as Promise<TriggerRuleAPI[]>).catch(() => [] as TriggerRuleAPI[]),
      fetch('/api/automations/monitors').then(r => r.json() as Promise<CronMonitorAPI[]>).catch(() => [] as CronMonitorAPI[]),
    ]).then(([t, m]) => {
      setTriggers(t)
      setMonitors(m)
      setLoading(false)
    })
  }, [])

  async function toggleTrigger(id: string, enabled: boolean) {
    setToggleError(null)
    try {
      const resp = await fetch(`/api/automations/triggers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string }
        setToggleError(err.error ?? `Failed to ${enabled ? 'enable' : 'disable'} trigger`)
        return
      }
      setTriggers(prev => prev.map(t => t.id === id ? { ...t, enabled } : t))
    } catch {
      setToggleError('Network error — could not reach gateway')
    }
  }

  async function createTrigger() {
    setCreateError('')
    setCreating(true)
    try {
      let condition: Record<string, unknown> = {}
      try { condition = JSON.parse(createForm.condition) } catch { setCreateError('Invalid JSON in condition field'); setCreating(false); return }
      const actions = createForm.actions.split(',').map(a => a.trim()).filter(Boolean).map(type => ({ type, params: {} }))
      if (actions.length === 0) { setCreateError('At least one action required'); setCreating(false); return }

      const resp = await fetch('/api/automations/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: createForm.eventType, condition, actions }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string }
        setCreateError(err.error ?? `Failed to create trigger (${resp.status})`)
        setCreating(false)
        return
      }
      const created = await resp.json() as TriggerRuleAPI | TriggerRuleAPI[]
      const trigger = Array.isArray(created) ? created[0] : created
      if (trigger) setTriggers(prev => [...prev, trigger])
      setShowCreateModal(false)
      setCreateForm({ eventType: 'alert_fired', condition: '{}', actions: '' })
    } catch {
      setCreateError('Network error — could not reach gateway')
    }
    setCreating(false)
  }

  async function createMonitor() {
    setCreateError('')
    setCreating(true)
    try {
      if (!monitorForm.name.trim()) { setCreateError('Name required'); setCreating(false); return }
      const resp = await fetch('/api/automations/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(monitorForm),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string }
        setCreateError(err.error ?? `Failed to create monitor (${resp.status})`)
        setCreating(false)
        return
      }
      // Re-fetch list — server returns {ok,id} not the full row
      const list = await fetch('/api/automations/monitors').then(r => r.json() as Promise<CronMonitorAPI[]>).catch(() => monitors)
      setMonitors(list)
      setShowCreateModal(false)
      setMonitorForm({ name: '', schedule: '*/5 * * * *', jobType: 'service_health_sweep' })
    } catch {
      setCreateError('Network error — could not reach gateway')
    }
    setCreating(false)
  }

  function toggleCronExpand(id: string) {
    setExpandedRuns(prev => {
      if (prev[id] === 'cron') return {}
      return { ...prev, [id]: 'cron' }
    })
    if (cronRuns[id] === undefined) {
      setCronRuns(prev => ({ ...prev, [id]: 'loading' }))
      fetch(`/api/cron/${id}/runs`)
        .then(r => r.json() as Promise<{ runs?: AutomationRun[] }>)
        .then(d => setCronRuns(prev => ({ ...prev, [id]: d.runs ?? [] })))
        .catch(() => setCronRuns(prev => ({ ...prev, [id]: [] })))
    }
  }

  const MONITOR_JOB_TYPES = ['service_health_sweep', 'slo_burn_check', 'deploy_health_report', 'oncall_morning_brief']

  const displayTriggers = triggers.map(toDisplayTrigger)
  const displayMonitors = monitors.map(toDisplayCron)

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#080808", overflow: "hidden" }}>
      {/* Error toast */}
      {toggleError && (
        <div style={{ padding: "8px 20px", background: "rgba(239,68,68,0.1)", borderBottom: "1px solid rgba(239,68,68,0.2)", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "11px", color: "#ef4444" }}>{toggleError}</span>
          <button onClick={() => setToggleError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "11px" }}>✕</button>
        </div>
      )}

      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
        <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>Agent Harness</div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5", marginBottom: "4px" }}>Automations</div>
        <div style={{ fontSize: "11px", color: "#888" }}>Event triggers · scheduled monitors · proactive intelligence</div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
        {([
          { id: "triggers", label: "Event Triggers", count: displayTriggers.filter(t => t.status === "active").length },
          { id: "crons",    label: "Cron Monitors",  count: displayMonitors.filter(c => c.status === "active").length },
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
          <button
            onClick={() => setShowCreateModal(true)}
            style={{ background: "#10b981", border: "none", color: "#080808", padding: "5px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}
          >
            + New {tab === "triggers" ? "Trigger" : "Monitor"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#444", fontSize: "12px" }}>Loading…</div>
        )}

        {!loading && tab === "triggers" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "22px 200px 140px 200px 1fr 90px 60px", gap: "0", padding: "8px 20px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
              {["", "Name", "Event", "Condition", "Actions", "Last Fired", "Fires"].map(h => (
                <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 6px" }}>{h}</div>
              ))}
            </div>

            {displayTriggers.length === 0 && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#444", fontSize: "12px" }}>
                No trigger rules configured. Connect a data source to enable event-driven automation.
              </div>
            )}

            {displayTriggers.map(t => {
              const statusColor = STATUS_COLOR[t.status] ?? "#555"
              return (
                <div key={t.id}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "22px 200px 140px 200px 1fr 90px 60px",
                      gap: "0",
                      padding: "12px 20px",
                      borderBottom: "1px solid #111",
                      alignItems: "center",
                      background: t.status === "paused" ? "rgba(0,0,0,0.3)" : "transparent",
                      opacity: t.status === "paused" ? 0.6 : 1,
                      cursor: "pointer",
                    }}
                    onClick={() => setExpandedRuns(prev => prev[t.id] === 'trigger' ? {} : { ...prev, [t.id]: 'trigger' })}
                  >
                    <div style={{ padding: "0 6px", display: "flex", alignItems: "center" }}>
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleTrigger(t.id, t.status !== 'active'); }}
                        style={{
                          width: "6px", height: "6px", borderRadius: "50%",
                          background: statusColor, cursor: "pointer",
                          ...(t.status === "active" ? { boxShadow: `0 0 5px ${statusColor}` } : {}),
                        }}
                      />
                    </div>

                    <div style={{ padding: "0 6px" }}>
                      <div style={{ fontSize: "12px", color: "#e5e5e5", fontWeight: 500, marginBottom: "2px" }}>{t.name}</div>
                      <div style={{ fontSize: "10px", color: "#444" }}>by {t.createdBy}</div>
                    </div>

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

                    <div style={{ padding: "0 6px" }}>
                      <code style={{ fontSize: "10px", color: "#888", fontFamily: "monospace" }}>{t.condition}</code>
                      <div style={{ fontSize: "10px", color: "#444", marginTop: "2px" }}>{t.scope}</div>
                    </div>

                    <div style={{ padding: "0 6px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {t.actions.map((a, i) => {
                        const aColor = ACTION_COLOR[a.type] ?? "#888"
                        return (
                          <span key={i} style={{
                            fontSize: "9px", color: aColor,
                            background: `${aColor}12`,
                            border: `1px solid ${aColor}25`,
                            padding: "2px 6px", borderRadius: "3px",
                          }}>
                            {ACTION_LABEL[a.type] ?? a.type}
                            {a.target ? ` → ${a.target}` : ""}
                          </span>
                        )
                      })}
                    </div>

                    <div style={{ padding: "0 6px", fontSize: "10px", color: t.lastFired ? "#888" : "#444" }}>
                      {t.lastFired ?? "Never"}
                    </div>

                    <div style={{ padding: "0 6px", fontSize: "11px", color: "#555", fontFamily: "monospace" }}>
                      {t.fireCount}
                    </div>
                  </div>

                  {/* Recent runs — run history recording not yet implemented; never show fake data */}
                  {expandedRuns[t.id] === 'trigger' && (
                    <div style={{ padding: "8px 20px 12px 50px", background: "#060606", borderBottom: "1px solid #111" }}>
                      <div style={{ fontSize: "10px", color: "#444", marginBottom: "6px", fontFamily: "monospace" }}>Recent Runs</div>
                      <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace" }}>No run history recorded yet.</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && tab === "crons" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "22px 200px 130px 120px 120px 1fr 60px", gap: "0", padding: "8px 20px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
              {["", "Name", "Schedule", "Last Run", "Next Run", "Last Result", "Runs"].map(h => (
                <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 6px" }}>{h}</div>
              ))}
            </div>

            {displayMonitors.length === 0 && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#444", fontSize: "12px" }}>
                No scheduled monitors configured. Set up a cron monitor to enable proactive intelligence.
              </div>
            )}

            {displayMonitors.map(c => {
              const statusColor = STATUS_COLOR[c.status] ?? "#555"
              const resultColor = RESULT_COLOR[c.lastResult] ?? "#555"
              const runs = cronRuns[c.id]
              return (
                <div key={c.id}>
                <div
                  onClick={() => toggleCronExpand(c.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "22px 200px 130px 120px 120px 1fr 60px",
                    gap: "0",
                    padding: "12px 20px",
                    borderBottom: "1px solid #111",
                    alignItems: "start",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ padding: "0 6px 0 0", display: "flex", alignItems: "center", paddingTop: "2px" }}>
                    <div style={{
                      width: "6px", height: "6px", borderRadius: "50%",
                      background: statusColor,
                      ...(c.status === "active" ? { boxShadow: `0 0 5px ${statusColor}` } : {}),
                    }} />
                  </div>

                  <div style={{ padding: "0 6px" }}>
                    <div style={{ fontSize: "12px", color: "#e5e5e5", fontWeight: 500, marginBottom: "3px" }}>{c.name}</div>
                    <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.5" }}>{c.description}</div>
                    <div style={{ marginTop: "4px" }}>
                      <span style={{ fontSize: "9px", background: "#111", border: "1px solid #2a2a2a", color: "#666", padding: "1px 6px", borderRadius: "3px" }}>
                        {c.agentType} agent
                      </span>
                    </div>
                  </div>

                  <div style={{ padding: "0 6px" }}>
                    <code style={{ fontSize: "10px", color: "#8b5cf6", fontFamily: "monospace", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", padding: "2px 6px", borderRadius: "3px" }}>
                      {c.schedule}
                    </code>
                  </div>

                  <div style={{ padding: "0 6px", fontSize: "10px", color: "#888" }}>{c.lastRun}</div>

                  <div style={{ padding: "0 6px", fontSize: "10px", color: "#555" }}>{c.nextRun}</div>

                  <div style={{ padding: "0 6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "4px" }}>
                      <span style={{
                        fontSize: "9px", fontWeight: 700, textTransform: "uppercase",
                        color: resultColor,
                        background: `${resultColor}12`,
                        border: `1px solid ${resultColor}30`,
                        padding: "1px 6px", borderRadius: "3px",
                      }}>
                        {c.lastResult}
                      </span>
                    </div>
                    <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.5" }}>{c.lastResultSummary}</div>
                  </div>

                  <div style={{ padding: "0 6px" }}>
                    <div style={{ fontSize: "11px", color: "#555", fontFamily: "monospace" }}>{c.runCount}</div>
                    {c.errorCount > 0 && (
                      <div style={{ fontSize: "10px", color: "#ef4444", marginTop: "2px" }}>{c.errorCount} err</div>
                    )}
                  </div>
                </div>

                {expandedRuns[c.id] === 'cron' && (
                  <div style={{ padding: "8px 20px 12px 50px", background: "#060606", borderBottom: "1px solid #111" }}>
                    <div style={{ fontSize: "10px", color: "#444", marginBottom: "6px", fontFamily: "monospace" }}>Recent Runs</div>
                    {runs === 'loading' && (
                      <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace" }}>Loading…</div>
                    )}
                    {Array.isArray(runs) && runs.length === 0 && (
                      <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace" }}>No run history recorded yet.</div>
                    )}
                    {Array.isArray(runs) && runs.map(run => {
                      const rColor = RESULT_COLOR[run.status] ?? "#555"
                      return (
                        <div key={run.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0" }}>
                          <span style={{
                            fontSize: "9px", fontWeight: 700, textTransform: "uppercase",
                            color: rColor, background: `${rColor}12`,
                            border: `1px solid ${rColor}30`, padding: "1px 6px", borderRadius: "3px",
                          }}>
                            {run.status}
                          </span>
                          <span style={{ fontSize: "10px", color: "#888", fontFamily: "monospace" }}>
                            {new Date(run.startedAt).toLocaleString()}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create Trigger Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowCreateModal(false)}>
          <div style={{
            width: '480px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: '12px',
            padding: '24px',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#e5e5e5', marginBottom: '20px' }}>
              {tab === 'triggers' ? 'New Trigger' : 'New Cron Monitor'}
            </div>

            {tab === 'triggers' ? (
              <>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '4px' }}>Event Type</label>
                  <select value={createForm.eventType} onChange={e => setCreateForm(f => ({ ...f, eventType: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#e5e5e5', fontSize: '12px' }}>
                    {Object.keys(EVENT_COLOR).map(et => <option key={et} value={et}>{et}</option>)}
                  </select>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '4px' }}>Condition (JSON)</label>
                  <textarea value={createForm.condition} onChange={e => setCreateForm(f => ({ ...f, condition: e.target.value }))}
                    rows={3} style={{ width: '100%', padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#e5e5e5', fontSize: '11px', fontFamily: 'monospace', resize: 'vertical' }}
                    placeholder='{"severity": "critical"}' />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '4px' }}>Actions (comma-separated)</label>
                  <input value={createForm.actions} onChange={e => setCreateForm(f => ({ ...f, actions: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#e5e5e5', fontSize: '12px', fontFamily: 'monospace' }}
                    placeholder="notify_oncall, create_incident" />
                  <div style={{ fontSize: '9px', color: '#444', marginTop: '4px' }}>
                    Valid: {Object.keys(ACTION_LABEL).join(', ')}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '4px' }}>Name</label>
                  <input value={monitorForm.name} onChange={e => setMonitorForm(f => ({ ...f, name: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#e5e5e5', fontSize: '12px' }}
                    placeholder="prod health sweep" />
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '4px' }}>Schedule (cron)</label>
                  <input value={monitorForm.schedule} onChange={e => setMonitorForm(f => ({ ...f, schedule: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#e5e5e5', fontSize: '12px', fontFamily: 'monospace' }}
                    placeholder="*/5 * * * *" />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '4px' }}>Monitor Type</label>
                  <select value={monitorForm.jobType} onChange={e => setMonitorForm(f => ({ ...f, jobType: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#e5e5e5', fontSize: '12px' }}>
                    {MONITOR_JOB_TYPES.map(jt => <option key={jt} value={jt}>{jt.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </>
            )}

            {createError && (
              <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', fontSize: '11px', color: '#ef4444', marginBottom: '14px' }}>{createError}</div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreateModal(false)}
                style={{ padding: '7px 16px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#888', fontSize: '11px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={tab === 'triggers' ? createTrigger : createMonitor} disabled={creating}
                style={{ padding: '7px 16px', background: creating ? '#0e3a28' : '#10b981', border: 'none', borderRadius: '6px', color: creating ? '#666' : '#080808', fontSize: '11px', fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer' }}>
                {creating ? 'Creating…' : tab === 'triggers' ? 'Create Trigger' : 'Create Monitor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
