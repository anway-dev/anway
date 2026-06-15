"use client";
import { EmptyState } from "@/components/empty-state"
import { FreshnessBadge } from "@/components/freshness-badge"
import { useState, useEffect } from "react";

interface Namespace {
  name: string; pods: number;
  cpuUsed: number; cpuTotal: number;
  memUsed: number; memTotal: number;
  status: string;
}
interface Workload {
  name: string; namespace: string; type: string;
  ready: number; desired: number; status: string;
}
interface K8sEvent {
  severity: "warning" | "normal";
  reason: string; object: string; message: string; time: string;
}
interface ClusterSummary {
  nodes: number; namespaces: number; runningPods: number; failingPods: number;
}
interface K8sOverview {
  connected: boolean;
  summary: ClusterSummary | null;
  namespaces: Namespace[];
  workloads: Workload[];
  events: K8sEvent[];
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "14px 16px", minWidth: "120px" }}>
      <div style={{ fontSize: "22px", fontWeight: 700, color, fontFamily: "monospace", marginBottom: "2px" }}>{value}</div>
      <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function ConfirmModal({ title, detail, onConfirm, onCancel }: { title: string; detail: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "20px 24px", maxWidth: "400px", width: "100%" }}>
        <h3 style={{ fontSize: "14px", color: "#e5e5e5", margin: "0 0 8px 0" }}>{title}</h3>
        <p style={{ fontSize: "11px", color: "#888", margin: "0 0 16px 0", lineHeight: "1.5" }}>{detail}</p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "6px 14px", borderRadius: "5px", border: "1px solid #1a1a1a", background: "transparent", color: "#888", fontSize: "11px", cursor: "pointer", fontFamily: "monospace" }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: "6px 14px", borderRadius: "5px", border: "none", background: "#10b981", color: "#080808", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "monospace" }}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

function ScaleModal({ deploymentName, namespace, onConfirm, onCancel }: { deploymentName: string; namespace: string; onConfirm: (replicas: number) => void; onCancel: () => void }) {
  const [val, setVal] = useState("3")
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "20px 24px", maxWidth: "400px", width: "100%" }}>
        <h3 style={{ fontSize: "14px", color: "#e5e5e5", margin: "0 0 8px 0" }}>Scale {deploymentName}</h3>
        <p style={{ fontSize: "11px", color: "#888", margin: "0 0 12px 0" }}>Namespace: {namespace}</p>
        <input type="number" min="0" value={val} onChange={e => setVal(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", background: "#111", border: "1px solid #1a1a1a", borderRadius: "5px", color: "#e5e5e5", fontSize: "13px", fontFamily: "monospace", marginBottom: "16px", outline: "none" }} />
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "6px 14px", borderRadius: "5px", border: "1px solid #1a1a1a", background: "transparent", color: "#888", fontSize: "11px", cursor: "pointer", fontFamily: "monospace" }}>Cancel</button>
          <button onClick={() => { const n = parseInt(val, 10); if (!isNaN(n) && n >= 0) onConfirm(n) }} style={{ padding: "6px 14px", borderRadius: "5px", border: "none", background: "#10b981", color: "#080808", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "monospace" }}>Scale</button>
        </div>
      </div>
    </div>
  )
}

function Bar({ used, total, color }: { used: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{ flex: 1, height: "6px", background: "#1a1a1a", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "3px" }} />
      </div>
      <span style={{ fontSize: "10px", color: "#888", fontFamily: "monospace", minWidth: "36px", textAlign: "right" }}>{used}/{total}</span>
    </div>
  );
}

export function K8sView({ onGoToConnectors }: { onGoToConnectors?: () => void } = {}) {
  const [data, setData] = useState<K8sOverview | null>(null);
  const [freshnessTimestamp, setFreshnessTimestamp] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'restart' | 'scale' | 'cordon'; title: string; detail: string; ns?: string; name: string } | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/k8s/overview")
      .then(r => r.json() as Promise<K8sOverview>)
      .then(setData)
      .catch(() => setData({ connected: false, summary: null, namespaces: [], workloads: [], events: [] }));
  }, []);

  useEffect(() => {
    fetch("/api/connectors/catalog")
      .then(r => r.json() as Promise<Array<{ id: string; bootstrappedAt: string | null }>>)
      .then(list => {
        const k = list.find(c => c.id === 'k8s')
        setFreshnessTimestamp(k?.bootstrappedAt ?? null)
      })
      .catch(() => {})
  }, [])

  const handleRefresh = async () => {
    try {
      await fetch('/api/connectors/k8s/bootstrap', { method: 'POST' })
      setFreshnessTimestamp(new Date().toISOString())
    } catch { /* non-blocking */ }
  }

  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#555", fontSize: "12px", fontFamily: "monospace" }}>
        Loading cluster data...
      </div>
    );
  }

  if (!data.connected) {
    return (
      <div style={{ height: "100%", background: "#080808" }}>
        <EmptyState
          icon="☸"
          title="No K8s cluster connected"
          description="Connect a Kubernetes cluster to view pods, nodes, and deployments."
          ctaLabel="Connect a connector"
          onCta={onGoToConnectors}
        />
      </div>
    )
  }

  const summary = data.summary ?? { nodes: 0, namespaces: data.namespaces.length, runningPods: 0, failingPods: 0 };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "24px", flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Kubernetes</div>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>Cluster Overview</h2>
          <FreshnessBadge bootstrappedAt={freshnessTimestamp} onRefresh={handleRefresh} />
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: "24px", flexWrap: "wrap" }}>
          <StatCard label="Total Nodes" value={summary.nodes} color="#e5e5e5" />
          <StatCard label="Namespaces" value={summary.namespaces} color="#3b82f6" />
          <StatCard label="Running Pods" value={summary.runningPods} color="#10b981" />
          <StatCard label="Failing Pods" value={summary.failingPods} color="#ef4444" />
        </div>

        {data.namespaces.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "8px", fontFamily: "monospace" }}>Namespaces</h3>
            <div style={{ display: "grid", gridTemplateColumns: "140px 60px 1fr 1fr 80px", padding: "8px 14px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
              {["Name", "Pods", "CPU", "Memory", "Status"].map(h => (
                <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</div>
              ))}
            </div>
            {data.namespaces.map(ns => (
              <div key={ns.name} style={{ display: "grid", gridTemplateColumns: "140px 60px 1fr 1fr 80px", padding: "8px 14px", borderBottom: "1px solid #111", alignItems: "center" }}>
                <div style={{ fontSize: "12px", color: "#e5e5e5", fontFamily: "monospace" }}>{ns.name}</div>
                <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>{ns.pods}</div>
                <Bar used={ns.cpuUsed} total={ns.cpuTotal} color="#3b82f6" />
                <Bar used={ns.memUsed} total={ns.memTotal} color="#8b5cf6" />
                <div style={{ fontSize: "10px", color: ns.status === "Active" ? "#10b981" : "#f59e0b", fontFamily: "monospace" }}>{ns.status}</div>
              </div>
            ))}
          </div>
        )}

        {data.workloads.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "8px", fontFamily: "monospace" }}>Workloads</h3>
            <div style={{ display: "grid", gridTemplateColumns: "160px 100px 120px 80px 100px 140px", padding: "8px 14px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
              {["Name", "Namespace", "Type", "Replicas", "Status", "Actions"].map(h => (
                <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</div>
              ))}
            </div>
            {data.workloads.map((w, i) => {
              const statusColor = w.status === "Healthy" ? "#10b981" : w.status === "Degraded" ? "#ef4444" : "#f59e0b";
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 100px 120px 80px 100px 140px", padding: "8px 14px", borderBottom: "1px solid #111", alignItems: "center" }}>
                  <div style={{ fontSize: "12px", color: "#e5e5e5", fontFamily: "monospace" }}>{w.name}</div>
                  <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>{w.namespace}</div>
                  <div style={{ fontSize: "11px", color: "#555", fontFamily: "monospace" }}>{w.type}</div>
                  <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>{w.ready}/{w.desired}</div>
                  <div style={{ fontSize: "10px", color: statusColor, fontFamily: "monospace" }}>{w.status}</div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button onClick={() => setConfirmAction({ type: 'restart', title: `Restart ${w.name}`, detail: `This will restart all pods in deployment ${w.name} in namespace ${w.namespace}. Active sessions will be dropped.`, ns: w.namespace, name: w.name })}
                      style={{ padding: "3px 8px", borderRadius: "4px", border: "1px solid #2a2a2a", background: "#0e0e0e", color: "#f59e0b", fontSize: "10px", cursor: "pointer", fontFamily: "monospace" }}>Restart</button>
                    <button onClick={() => setConfirmAction({ type: 'scale', title: `Scale ${w.name}`, detail: `Set replica count for ${w.name}`, ns: w.namespace, name: w.name })}
                      style={{ padding: "3px 8px", borderRadius: "4px", border: "1px solid #2a2a2a", background: "#0e0e0e", color: "#3b82f6", fontSize: "10px", cursor: "pointer", fontFamily: "monospace" }}>Scale</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data.events.length > 0 && (
          <div>
            <h3 style={{ fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "8px", fontFamily: "monospace" }}>Recent Events</h3>
            <div style={{ display: "grid", gridTemplateColumns: "24px 100px 1fr 100px", padding: "8px 14px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
              {["", "Reason", "Object", "Time"].map(h => (
                <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</div>
              ))}
            </div>
            {data.events.map((e, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "24px 100px 1fr 100px", padding: "8px 14px", borderBottom: "1px solid #111", alignItems: "center" }}>
                <div style={{ fontSize: "12px", color: e.severity === "warning" ? "#ef4444" : "#3b82f6" }}>{e.severity === "warning" ? "⚠" : "ℹ"}</div>
                <div style={{ fontSize: "11px", color: e.severity === "warning" ? "#ef4444" : "#888", fontFamily: "monospace" }}>{e.reason}</div>
                <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.message}>
                  {e.object}: {e.message}
                </div>
                <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace" }}>{e.time}</div>
              </div>
            ))}
          </div>
        )}

        {data.namespaces.length === 0 && data.workloads.length === 0 && (
          <div style={{ padding: "40px", textAlign: "center", border: "1px dashed #1a1a1a", borderRadius: "8px" }}>
            <div style={{ fontSize: "12px", color: "#555", fontFamily: "monospace" }}>
              Connector active — bootstrapping cluster entities
            </div>
          </div>
        )}
      </div>
      {confirmAction && confirmAction.type === 'scale' && (
        <ScaleModal deploymentName={confirmAction.name} namespace={confirmAction.ns ?? 'default'}
          onConfirm={async (replicas) => {
            setConfirmAction(null)
            try {
              const resp = await fetch(`/api/k8s/deployments/${confirmAction.ns}/${confirmAction.name}/scale`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ replicas }),
              })
              const r = await resp.json()
              setActionResult(`${confirmAction.name}: ${r.ok ? `scaled to ${replicas}` : `failed — ${r.error}`}`)
              setTimeout(() => setActionResult(null), 3000)
            } catch { setActionResult(`${confirmAction.name}: scale failed`); setTimeout(() => setActionResult(null), 3000) }
          }}
          onCancel={() => setConfirmAction(null)} />
      )}
      {confirmAction && confirmAction.type === 'restart' && (
        <ConfirmModal title={confirmAction.title} detail={confirmAction.detail}
          onConfirm={async () => {
            setConfirmAction(null)
            try {
              const resp = await fetch(`/api/k8s/pods/${confirmAction.ns}/${confirmAction.name}/restart`, { method: 'POST' })
              const r = await resp.json()
              setActionResult(`${confirmAction.name}: ${r.ok ? 'restart initiated' : `failed — ${r.error}`}`)
              setTimeout(() => setActionResult(null), 3000)
            } catch { setActionResult(`${confirmAction.name}: restart failed`); setTimeout(() => setActionResult(null), 3000) }
          }}
          onCancel={() => setConfirmAction(null)} />
      )}
      {confirmAction && confirmAction.type === 'cordon' && (
        <ConfirmModal title={confirmAction.title} detail={confirmAction.detail}
          onConfirm={async () => {
            setConfirmAction(null)
            try {
              const resp = await fetch(`/api/k8s/nodes/${confirmAction.name}/cordon`, { method: 'POST' })
              const r = await resp.json()
              setActionResult(`${confirmAction.name}: ${r.ok ? 'cordoned' : `failed — ${r.error}`}`)
              setTimeout(() => setActionResult(null), 3000)
            } catch { setActionResult(`${confirmAction.name}: cordon failed`); setTimeout(() => setActionResult(null), 3000) }
          }}
          onCancel={() => setConfirmAction(null)} />
      )}
      {actionResult && (
        <div style={{ position: "fixed", bottom: "20px", right: "20px", padding: "10px 16px", borderRadius: "6px", background: "#0e0e0e", border: "1px solid #10b981", color: "#e5e5e5", fontSize: "12px", fontFamily: "monospace", zIndex: 1001 }}>
          {actionResult}
        </div>
      )}
    </div>
  );
}
