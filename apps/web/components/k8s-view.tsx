"use client";
import { EmptyState } from "@/components/empty-state"
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

  useEffect(() => {
    fetch("/api/k8s/overview")
      .then(r => r.json() as Promise<K8sOverview>)
      .then(setData)
      .catch(() => setData({ connected: false, summary: null, namespaces: [], workloads: [], events: [] }));
  }, []);

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
            <div style={{ display: "grid", gridTemplateColumns: "160px 100px 120px 80px 100px", padding: "8px 14px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
              {["Name", "Namespace", "Type", "Replicas", "Status"].map(h => (
                <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</div>
              ))}
            </div>
            {data.workloads.map((w, i) => {
              const statusColor = w.status === "Healthy" ? "#10b981" : w.status === "Degraded" ? "#ef4444" : "#f59e0b";
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 100px 120px 80px 100px", padding: "8px 14px", borderBottom: "1px solid #111", alignItems: "center" }}>
                  <div style={{ fontSize: "12px", color: "#e5e5e5", fontFamily: "monospace" }}>{w.name}</div>
                  <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>{w.namespace}</div>
                  <div style={{ fontSize: "11px", color: "#555", fontFamily: "monospace" }}>{w.type}</div>
                  <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>{w.ready}/{w.desired}</div>
                  <div style={{ fontSize: "10px", color: statusColor, fontFamily: "monospace" }}>{w.status}</div>
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
    </div>
  );
}
