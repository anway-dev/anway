"use client";
import { EmptyState } from "@/components/empty-state"
import { useState, useEffect, useRef } from "react";

interface Connector {
  id: string;
  name: string;
  category: string;
  description: string;
  color: string;
  icon: string;
  capabilities: string[];
  configFields: { label: string; key: string; type: string }[];
  connected: boolean;
}

const CATEGORIES = ["All", "Connected", "Code & CI", "CI/CD", "Observability", "Logging", "Issue Tracking", "Error Tracking", "Alerting", "Deployment", "Kubernetes", "Infrastructure", "Security", "Code Quality", "Collaboration", "Docs", "Cloud Health", "Feature Flags"];
const K8S_TYPES = new Set(['k8s', 'eks', 'gke', 'aks'])

interface BootstrapInfo {
  bootstrapped: boolean
  bootstrappedAt?: string
  namespaces?: string[]
  namespaceFilter?: string[] | null
}

interface ActivityEvent {
  type: string
  connectorType: string
  message: string
  timestamp: string
  level: 'info' | 'success' | 'error' | 'warn'
}

interface NamespaceModal {
  connectorId: string
  connectorName: string
  namespaces: string[]
  selected: string[] | null  // null = all
}

export function ConnectorsView() {
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState<Connector | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<Connector[]>([]);
  const [bootstrapInfo, setBootstrapInfo] = useState<Record<string, BootstrapInfo>>({});
  const [healthInfo, setHealthInfo] = useState<Record<string, { status: string }>>({});
  const [bootstrapping, setBootstrapping] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nsModal, setNsModal] = useState<NamespaceModal | null>(null);
  const [nsSaving, setNsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const activityTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function fetchActivity() {
    fetch('/api/connectors/activity')
      .then(r => r.json() as Promise<{ events: ActivityEvent[] }>)
      .then(data => setActivity(data.events ?? []))
      .catch(() => {})
  }

  function openNamespaceModal(connectorId: string, connectorName: string, info: BootstrapInfo) {
    setNsModal({
      connectorId,
      connectorName,
      namespaces: info.namespaces ?? [],
      selected: info.namespaceFilter ?? null,
    })
  }

  function startBootstrapPoll(connectorId: string, connectorName: string) {
    if (pollTimers.current[connectorId]) return
    let attempts = 0
    pollTimers.current[connectorId] = setInterval(async () => {
      attempts++
      try {
        const r = await fetch(`/api/connectors/${connectorId}/bootstrap-status`)
        const data = await r.json() as BootstrapInfo
        setBootstrapInfo(prev => ({ ...prev, [connectorId]: { ...data } }))
        if (data.bootstrapped || attempts >= 12) {
          clearInterval(pollTimers.current[connectorId])
          delete pollTimers.current[connectorId]
          if (bootstrapping === connectorId) setBootstrapping(null)
          if (data.bootstrapped) {
            // Auto-open namespace modal for k8s connectors after first bootstrap
            if (K8S_TYPES.has(connectorId) && (data.namespaces ?? []).length > 0 && data.namespaceFilter === null) {
              openNamespaceModal(connectorId, connectorName, data)
            }
            // Auto-provision dashboards after Grafana bootstrap
            if (connectorId === 'grafana') {
              fetch(`/api/connectors/grafana/provision-dashboards`, { method: 'POST' }).catch(() => {})
            }
          }
        }
      } catch { /* ignore */ }
    }, 5000)
  }

  useEffect(() => () => {
    Object.values(pollTimers.current).forEach(t => clearInterval(t))
    if (activityTimer.current) clearInterval(activityTimer.current)
  }, [])

  useEffect(() => {
    fetchActivity()
    activityTimer.current = setInterval(fetchActivity, 8000)
    return () => { if (activityTimer.current) clearInterval(activityTimer.current) }
  }, [])

  useEffect(() => {
    fetch("/api/connectors/catalog")
      .then(r => r.json() as Promise<Connector[]>)
      .then(list => {
        setCatalog(list);
        for (const c of list) {
          if (c.connected) {
            fetch(`/api/connectors/${c.id}/bootstrap-status`)
              .then(r => r.json())
              .then((data: BootstrapInfo) => {
                if (data.bootstrapped) setBootstrapInfo(prev => ({ ...prev, [c.id]: data }))
              })
              .catch(() => {});
            fetch(`/api/connectors/${c.id}/status`)
              .then(r => r.json())
              .then((data: { status: string }) => {
                setHealthInfo(prev => ({ ...prev, [c.id]: { status: data.status } }))
              })
              .catch(() => {
                setHealthInfo(prev => ({ ...prev, [c.id]: { status: 'unreachable' } }))
              });
          }
        }
      })
      .catch(() => {});
  }, []);

  const visible = filter === "All" ? catalog : filter === "Connected" ? catalog.filter(c => c.connected) : catalog.filter((c) => c.category === filter);
  const connected = catalog.filter(c => c.connected).length;

  async function testConnector() {
    if (!modal) return
    setTesting(true)
    setTestResult(null)
    try {
      const credentials: Record<string, string> = {}
      for (const field of modal.configFields) {
        if (formValues[field.key]) credentials[field.key] = formValues[field.key]
      }
      const resp = await fetch(`/api/connectors/${modal.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials }),
      })
      const data = await resp.json() as { ok: boolean; message?: string; error?: string }
      setTestResult(data)
    } catch (e) {
      setTestResult({ ok: false, error: String(e) })
    } finally {
      setTesting(false)
    }
  }

  async function handleConnect() {
    if (!modal) return;
    setSaving(true);
    try {
      const credentials: Record<string, string> = {};
      for (const field of modal.configFields) {
        if (formValues[field.key]) credentials[field.key] = formValues[field.key];
      }

      // Auto-test before save — warn on failure, let user click "Save anyway" to proceed
      if (!testResult) {
        setTesting(true)
        try {
          const tr = await fetch(`/api/connectors/${modal.id}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credentials }),
          })
          const data = await tr.json() as { ok: boolean; message?: string; error?: string }
          setTestResult(data)
          if (!data.ok) return  // button turns red "Save anyway" — user clicks again to force save
        } catch { /* ignore test errors — proceed to save */ }
        finally { setTesting(false) }
      }
      // testResult already set (either passed or user is force-saving after failure)

      const resp = await fetch(`/api/settings/connectors/${modal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string }
        setSaveError((err as { error?: string }).error ?? 'Save failed')
        return
      }
      setSaveError(null)
      setTestResult(null)
      const connectorName = modal.name
      const connectorId = modal.id
      setCatalog(prev => prev.map(c => c.id === connectorId ? { ...c, connected: true } : c));
      setModal(null);
      // Auto-trigger bootstrap for k8s connectors after credential save
      if (K8S_TYPES.has(connectorId)) {
        setBootstrapping(connectorId)
        fetch(`/api/connectors/${connectorId}/bootstrap`, { method: 'POST' }).catch(() => {})
        startBootstrapPoll(connectorId, connectorName)
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveNamespaceFilter() {
    if (!nsModal) return
    setNsSaving(true)
    try {
      await fetch(`/api/connectors/${nsModal.connectorId}/namespace-filter`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespaces: nsModal.selected }),
      })
      setBootstrapInfo(prev => ({
        ...prev,
        [nsModal.connectorId]: { ...prev[nsModal.connectorId]!, namespaceFilter: nsModal.selected },
      }))
      setNsModal(null)
    } catch { /* ignore */ } finally {
      setNsSaving(false)
    }
  }

  const LEVEL_COLOR: Record<string, string> = { success: '#10b981', error: '#ef4444', warn: '#f59e0b', info: '#888' }
  const LEVEL_DOT: Record<string, string> = { success: '●', error: '✕', warn: '▲', info: '·' }

  return (
    <div style={{ padding: "24px", height: "100%", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Integrations</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>Connect Your Stack</h2>
          <span
            onClick={() => setFilter("Connected")}
            style={{ fontSize: "12px", color: "#10b981", cursor: "pointer", textDecoration: filter === "Connected" ? "underline" : "none" }}
          >{connected} / {catalog.length} connected</span>
        </div>
        <p style={{ fontSize: "12px", color: "#888", marginTop: "6px", maxWidth: "520px" }}>
          Anvay reads from your existing tools — no data migration, no rip-and-replace. Connect once, get unified lifecycle visibility.
        </p>
      </div>

      {/* Main layout: grid + activity log */}
      <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Category filter */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                style={{
                  background: filter === cat ? "#10b981" : "#111", border: `1px solid ${filter === cat ? "#10b981" : "#2a2a2a"}`,
                  color: filter === cat ? "#000" : "#888", padding: "4px 10px", borderRadius: "4px",
                  fontSize: "11px", cursor: "pointer", fontWeight: filter === cat ? 700 : 400,
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Grid */}
          {catalog.length === 0 ? (
            <EmptyState
              icon="⬡"
              title="Connector catalog unavailable"
              description="Unable to load the connector catalog. Check gateway connectivity."
            />
          ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
            {visible.map((conn) => (
              <ConnectorCard key={conn.id} connector={conn} configured={conn.connected} bootstrap={bootstrapInfo[conn.id]} health={healthInfo[conn.id]} bootstrapping={bootstrapping === conn.id} onBootstrap={() => { setBootstrapping(conn.id); fetch(`/api/connectors/${conn.id}/bootstrap`, { method: 'POST' }).catch(() => {}); startBootstrapPoll(conn.id, conn.name); fetchActivity(); }} onConnect={() => { setSaveError(null); setTestResult(null); setModal(conn); setFormValues({}); }} onConfigureNamespaces={K8S_TYPES.has(conn.id) && bootstrapInfo[conn.id]?.bootstrapped ? () => openNamespaceModal(conn.id, conn.name, bootstrapInfo[conn.id]!) : undefined} onProvisionDashboards={conn.id === 'grafana' && bootstrapInfo[conn.id]?.bootstrapped ? async () => { setProvisioning(true); setProvisionResult(null); try { const r = await fetch('/api/connectors/grafana/provision-dashboards', { method: 'POST' }); const d = await r.json() as { ok?: boolean; created?: string[]; total?: number; error?: string }; setProvisionResult({ ok: d.ok ?? false, message: d.ok ? `${d.total ?? d.created?.length ?? 0} dashboards provisioned` : (d.error ?? 'Failed') }); } catch { setProvisionResult({ ok: false, message: 'Request failed' }); } finally { setProvisioning(false); setTimeout(() => setProvisionResult(null), 5000); } } : undefined} provisionResult={provisionResult} provisioning={provisioning} />
            ))}
          </div>
          )}
        </div>

        {/* Activity log panel */}
        <div style={{ width: "320px", flexShrink: 0, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#e5e5e5", letterSpacing: "0.05em" }}>Activity</span>
            <span style={{ fontSize: "10px", color: "#555" }}>auto-refresh 8s</span>
          </div>
          <div style={{ height: "480px", overflowY: "auto", padding: "8px 0" }}>
            {activity.length === 0 ? (
              <div style={{ padding: "24px 14px", textAlign: "center", fontSize: "11px", color: "#444" }}>No connector activity yet</div>
            ) : (
              activity.map((ev, i) => (
                <div key={i} style={{ padding: "7px 14px", borderBottom: "1px solid #111", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <span style={{ color: LEVEL_COLOR[ev.level] ?? '#888', fontSize: "10px", marginTop: "1px", flexShrink: 0 }}>{LEVEL_DOT[ev.level] ?? '·'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                      <span style={{ fontSize: "10px", fontWeight: 600, color: "#e5e5e5", fontFamily: "monospace" }}>{ev.connectorType}</span>
                      <span style={{ fontSize: "9px", color: "#444", fontFamily: "monospace" }}>{ev.type.replace('connector.', '').replace('connector_', '').replace(/_/g, ' ')}</span>
                    </div>
                    <div style={{ fontSize: "11px", color: LEVEL_COLOR[ev.level] ?? '#888', wordBreak: "break-word", lineHeight: "1.4" }}>{ev.message}</div>
                    <div style={{ fontSize: "9px", color: "#444", marginTop: "2px", fontFamily: "monospace" }}>
                      {(() => { const ms = Date.now() - new Date(ev.timestamp).getTime(); const s = Math.floor(ms / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago` })()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Namespace selector modal */}
      {nsModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110 }}>
          <div style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: "12px", padding: "24px", width: "440px", maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5" }}>Namespace Filter — {nsModal.connectorName}</div>
              <div style={{ fontSize: "11px", color: "#888", marginTop: "4px" }}>Select which namespaces Anvay monitors. Discovered after bootstrap.</div>
            </div>

            {nsModal.namespaces.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#555", padding: "12px 0" }}>No namespaces discovered yet. Run bootstrap first.</div>
            ) : (
              <div style={{ overflowY: "auto", flex: 1, marginBottom: "16px" }}>
                {/* All namespaces option */}
                <label style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px", borderRadius: "6px", cursor: "pointer", background: nsModal.selected === null ? "rgba(16,185,129,0.08)" : "transparent", border: nsModal.selected === null ? "1px solid rgba(16,185,129,0.2)" : "1px solid transparent", marginBottom: "6px" }}>
                  <input type="checkbox" checked={nsModal.selected === null} onChange={() => setNsModal(m => m ? { ...m, selected: null } : m)} style={{ accentColor: "#10b981" }} />
                  <span style={{ fontSize: "12px", color: nsModal.selected === null ? "#10b981" : "#e5e5e5", fontWeight: 600 }}>All namespaces</span>
                </label>
                <div style={{ borderTop: "1px solid #1a1a1a", marginBottom: "8px" }} />
                {nsModal.namespaces.map(ns => {
                  const isSelected = nsModal.selected !== null && nsModal.selected.includes(ns)
                  return (
                    <label key={ns} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 8px", borderRadius: "6px", cursor: "pointer", background: isSelected ? "rgba(16,185,129,0.06)" : "transparent" }}>
                      <input
                        type="checkbox"
                        checked={nsModal.selected === null || isSelected}
                        disabled={nsModal.selected === null}
                        onChange={() => {
                          if (nsModal.selected === null) return
                          setNsModal(m => {
                            if (!m) return m
                            const sel = m.selected!
                            const next = sel.includes(ns) ? sel.filter(n => n !== ns) : [...sel, ns]
                            return { ...m, selected: next.length === 0 ? null : next }
                          })
                        }}
                        style={{ accentColor: "#10b981" }}
                      />
                      <span style={{ fontSize: "12px", color: "#e5e5e5", fontFamily: "monospace" }}>{ns}</span>
                    </label>
                  )
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setNsModal(null)} style={{ flex: 1, background: "transparent", border: "1px solid #2a2a2a", color: "#888", padding: "8px", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  // If user deselected "All" but selected nothing, initialise to all specific
                  if (nsModal.selected !== null && nsModal.selected.length === 0) {
                    setNsModal(m => m ? { ...m, selected: null } : m)
                    return
                  }
                  saveNamespaceFilter()
                }}
                disabled={nsSaving}
                style={{ flex: 1, background: nsSaving ? "#0a0a0a" : "#10b981", border: "none", color: nsSaving ? "#444" : "#000", padding: "8px", borderRadius: "6px", cursor: nsSaving ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 700 }}
              >
                {nsSaving ? "Saving…" : "Save Filter"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credentials modal */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: "12px", padding: "24px", width: "400px", maxWidth: "90vw" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: modal.color + "22", border: `1px solid ${modal.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: modal.color, fontWeight: 700 }}>
                {modal.icon}
              </div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5" }}>Connect {modal.name}</div>
                <div style={{ fontSize: "11px", color: "#888" }}>{modal.category}</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "20px" }}>
              {modal.configFields.map((field) => (
                <div key={field.key}>
                  <label style={{ fontSize: "11px", color: "#888", display: "block", marginBottom: "6px" }}>{field.label}</label>
                  {field.type === "textarea" ? (
                    <textarea
                      value={formValues[field.key] || ""}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={`Paste ${field.label.toLowerCase()} here`}
                      rows={8}
                      spellCheck={false}
                      style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "8px 10px", borderRadius: "6px", fontSize: "11px", fontFamily: "monospace", outline: "none", resize: "vertical", boxSizing: "border-box" }}
                    />
                  ) : (
                    <input
                      type={field.type === "password" ? "password" : "text"}
                      value={formValues[field.key] || ""}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.type === "password" ? "••••••••••••" : `Enter ${field.label.toLowerCase()}`}
                      style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "8px 10px", borderRadius: "6px", fontSize: "12px", outline: "none" }}
                    />
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: "#555", marginBottom: "14px", alignItems: "flex-start" }}>
              <span>🔒</span>
              <span>Credentials are encrypted at rest. Anvay only reads — it never writes to your tools unless a workflow hook explicitly requires it.</span>
            </div>

            {/* Connectivity test */}
            <div style={{ marginBottom: "14px" }}>
              <button
                onClick={testConnector}
                disabled={testing}
                style={{ background: "transparent", border: "1px solid #2a2a2a", color: testing ? "#444" : "#888", padding: "6px 12px", borderRadius: "5px", cursor: testing ? "not-allowed" : "pointer", fontSize: "11px", width: "100%" }}
              >
                {testing ? "Testing connection…" : "Test Connection"}
              </button>
              {testResult && (
                <div style={{ marginTop: "8px", padding: "8px 10px", borderRadius: "5px", fontSize: "11px", background: testResult.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${testResult.ok ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}`, color: testResult.ok ? "#10b981" : "#ef4444", wordBreak: "break-word" }}>
                  {testResult.ok ? `✓ ${testResult.message ?? "Connected"}` : `✕ ${testResult.error ?? "Connection failed"}`}
                </div>
              )}
            </div>

            {saveError && (
              <div style={{ fontSize: "11px", color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "4px", padding: "6px 10px", marginBottom: "12px" }}>
                ⚠ {saveError}
              </div>
            )}

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setModal(null)}
                style={{ flex: 1, background: "transparent", border: "1px solid #2a2a2a", color: "#888", padding: "8px", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={saving || testing || testResult === null}
                style={{
                  flex: 1,
                  background: saving || testing || testResult === null ? "#0a0a0a" : testResult.ok === false ? "#7f1d1d" : "#10b981",
                  border: testResult?.ok === false ? "1px solid #ef4444" : "none",
                  color: saving || testing || testResult === null ? "#444" : testResult.ok === false ? "#fca5a5" : "#000",
                  padding: "8px", borderRadius: "6px",
                  cursor: saving || testing || testResult === null ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 700,
                }}
              >
                {saving ? "Saving…" : testResult === null ? "Test first" : testResult.ok === false ? "Save anyway" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectorCard({ connector: c, configured, bootstrap, health, bootstrapping, onBootstrap, onConnect, onConfigureNamespaces, onProvisionDashboards, provisioning, provisionResult }: { connector: Connector; configured: boolean; bootstrap?: BootstrapInfo; health?: { status: string }; bootstrapping?: boolean; onBootstrap?: () => void; onConnect: () => void; onConfigureNamespaces?: () => void; onProvisionDashboards?: () => void; provisioning?: boolean; provisionResult?: { ok: boolean; message: string } | null }) {
  const healthStatus = health?.status;
  const renderStatus = () => {
    if (!configured) return null;
    if (bootstrapping) return <span style={{ color: "#888", fontSize: "10px", fontFamily: "monospace" }}>&#8635; Bootstrapping&hellip;</span>;
    if (healthStatus === 'bootstrapped' || bootstrap?.bootstrapped) {
      return (
        <span style={{ color: "#10b981", fontSize: "10px", fontFamily: "monospace" }}>
          &#10003; Live{bootstrap?.bootstrappedAt ? ` · synced ${(() => {
            const ms = Date.now() - new Date(bootstrap.bootstrappedAt).getTime();
            const mins = Math.floor(ms / 60000);
            return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
          })()}` : ''}
        </span>
      );
    }
    if (healthStatus === 'pending') return <span style={{ color: "#f59e0b", fontSize: "10px", fontFamily: "monospace" }}>&#9679; Pending sync</span>;
    return <span style={{ color: "#ef4444", fontSize: "10px", fontFamily: "monospace" }}>&#9679; Unreachable</span>;
  };
  return (
    <div style={{
      background: "#111", border: `1px solid ${configured ? "#1f2f1f" : "#1f1f1f"}`,
      borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: c.color + "22", border: `1px solid ${c.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: c.color, fontWeight: 700, flexShrink: 0 }}>
            {c.icon}
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#e5e5e5" }}>{c.name}</div>
            <div style={{ fontSize: "10px", color: "#555" }}>{c.category}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: configured ? "#10b981" : "#444",
            boxShadow: configured ? "0 0 4px #10b981" : "none",
          }} />
          <span style={{ fontSize: "10px", color: configured ? "#10b981" : "#555" }}>
            {configured ? "Configured" : "Off"}
          </span>
        </div>
      </div>

      <div style={{ fontSize: "11px", color: "#888" }}>{c.description}</div>
      {configured && (
        <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {renderStatus()}
          <button onClick={onBootstrap}
            style={{
              background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
              color: "#10b981", padding: "2px 8px", borderRadius: "3px",
              cursor: "pointer", fontSize: "9px", fontFamily: "monospace",
            }}
          >
            {bootstrapping ? "Syncing…" : "Force Resync"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
        {c.capabilities.map((cap) => (
          <span key={cap} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#555", padding: "1px 6px", borderRadius: "3px", fontSize: "10px" }}>
            {cap}
          </span>
        ))}
      </div>

      {onConfigureNamespaces && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "10px", color: "#555" }}>
            {bootstrap?.namespaceFilter === null || !bootstrap?.namespaceFilter
              ? "All namespaces"
              : `${bootstrap.namespaceFilter.length} namespace${bootstrap.namespaceFilter.length !== 1 ? 's' : ''} selected`}
          </span>
          <button onClick={onConfigureNamespaces} style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#888", padding: "1px 6px", borderRadius: "3px", cursor: "pointer", fontSize: "9px", fontFamily: "monospace" }}>
            Filter namespaces
          </button>
        </div>
      )}
      {onProvisionDashboards && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={onProvisionDashboards} disabled={provisioning} style={{ background: "transparent", border: "1px solid #2a2a2a", color: provisioning ? "#555" : "#888", padding: "2px 8px", borderRadius: "3px", cursor: provisioning ? "not-allowed" : "pointer", fontSize: "9px", fontFamily: "monospace" }}>
            {provisioning ? "Provisioning…" : "Provision dashboards"}
          </button>
          {provisionResult && (
            <span style={{ fontSize: "9px", fontFamily: "monospace", color: provisionResult.ok ? "#10b981" : "#ef4444" }}>
              {provisionResult.ok ? "✓" : "✕"} {provisionResult.message}
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {configured ? (
          <span style={{ fontSize: "10px", color: "#555" }}>✓ configured</span>
        ) : (
          <span style={{ fontSize: "10px", color: "#555" }}>Not connected</span>
        )}
        <button
          onClick={onConnect}
          style={{
            background: configured ? "transparent" : "rgba(16,185,129,0.1)",
            border: `1px solid ${configured ? "#2a2a2a" : "rgba(16,185,129,0.3)"}`,
            color: configured ? "#555" : "#10b981",
            padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "11px",
          }}
        >
          {configured ? "Reconfigure" : "Connect"}
        </button>
      </div>
    </div>
  );
}
