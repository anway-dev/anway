"use client";
import { PreviewBanner } from "@/components/preview-banner";

const MOCK_CLUSTER = {
  nodes: 6,
  namespaces: 3,
  runningPods: 47,
  failingPods: 2,
};

const MOCK_NAMESPACES = [
  { name: "prod", pods: 32, cpuUsed: 14, cpuTotal: 20, memUsed: 48, memTotal: 64, status: "Active" as const },
  { name: "staging", pods: 11, cpuUsed: 4, cpuTotal: 10, memUsed: 12, memTotal: 32, status: "Active" as const },
  { name: "infra", pods: 4, cpuUsed: 2, cpuTotal: 4, memUsed: 4, memTotal: 8, status: "Active" as const },
];

const MOCK_WORKLOADS = [
  { name: "payments-api", namespace: "prod", type: "Deployment", ready: 3, desired: 3, status: "Healthy" as const },
  { name: "auth-service", namespace: "prod", type: "Deployment", ready: 2, desired: 2, status: "Healthy" as const },
  { name: "checkout-api", namespace: "prod", type: "Deployment", ready: 0, desired: 2, status: "Degraded" as const },
  { name: "redis-cache", namespace: "prod", type: "StatefulSet", ready: 1, desired: 1, status: "Healthy" as const },
  { name: "worker", namespace: "prod", type: "DaemonSet", ready: 6, desired: 6, status: "Healthy" as const },
  { name: "payments-api", namespace: "staging", type: "Deployment", ready: 1, desired: 1, status: "Healthy" as const },
  { name: "auth-service", namespace: "staging", type: "Deployment", ready: 0, desired: 1, status: "Pending" as const },
];

const MOCK_EVENTS = [
  { severity: "warning" as const, reason: "BackOff", object: "pod/checkout-api-7d9f6-xr2kp", message: "Back-off restarting failed container", time: "2m ago" },
  { severity: "warning" as const, reason: "Unhealthy", object: "pod/checkout-api-7d9f6-xr2kp", message: "Liveness probe failed", time: "3m ago" },
  { severity: "normal" as const, reason: "Pulled", object: "pod/payments-api-64b9d-m8vwn", message: "Successfully pulled image", time: "8m ago" },
  { severity: "normal" as const, reason: "Scheduled", object: "pod/auth-service-5c7b8-p9qls", message: "Successfully assigned to node-3", time: "15m ago" },
  { severity: "normal" as const, reason: "Created", object: "pod/worker-2f3a1-d9k2n", message: "Created container worker", time: "22m ago" },
  { severity: "normal" as const, reason: "Started", object: "pod/worker-2f3a1-d9k2n", message: "Started container worker", time: "22m ago" },
  { severity: "warning" as const, reason: "Failed", object: "pod/checkout-api-7d9f6-xr2kp", message: "CrashLoopBackOff", time: "5m ago" },
  { severity: "normal" as const, reason: "Scaled", object: "deploy/payments-api", message: "Scaled up replica set payments-api-64b9d to 3", time: "35m ago" },
];

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

export function K8sView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PreviewBanner />
      <div style={{ padding: "24px", flex: 1, minHeight: 0, overflowY: "auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Kubernetes</div>
        <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>Cluster Overview</h2>
      </div>

      {/* Cluster summary */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "24px", flexWrap: "wrap" }}>
        <StatCard label="Total Nodes" value={MOCK_CLUSTER.nodes} color="#e5e5e5" />
        <StatCard label="Namespaces" value={MOCK_CLUSTER.namespaces} color="#3b82f6" />
        <StatCard label="Running Pods" value={MOCK_CLUSTER.runningPods} color="#10b981" />
        <StatCard label="Failing Pods" value={MOCK_CLUSTER.failingPods} color="#ef4444" />
      </div>

      {/* Namespaces */}
      <div style={{ marginBottom: "24px" }}>
        <h3 style={{ fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "8px", fontFamily: "monospace" }}>Namespaces</h3>
        <div style={{ display: "grid", gridTemplateColumns: "140px 60px 1fr 1fr 80px", gap: "0", padding: "8px 14px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
          {["Name", "Pods", "CPU", "Memory", "Status"].map(h => (
            <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</div>
          ))}
        </div>
        {MOCK_NAMESPACES.map(ns => (
          <div key={ns.name} style={{ display: "grid", gridTemplateColumns: "140px 60px 1fr 1fr 80px", gap: "0", padding: "8px 14px", borderBottom: "1px solid #111", alignItems: "center" }}>
            <div style={{ fontSize: "12px", color: "#e5e5e5", fontFamily: "monospace" }}>{ns.name}</div>
            <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>{ns.pods}</div>
            <Bar used={ns.cpuUsed} total={ns.cpuTotal} color="#3b82f6" />
            <Bar used={ns.memUsed} total={ns.memTotal} color="#8b5cf6" />
            <div style={{ fontSize: "10px", color: ns.status === "Active" ? "#10b981" : "#f59e0b", fontFamily: "monospace" }}>{ns.status}</div>
          </div>
        ))}
      </div>

      {/* Workloads */}
      <div style={{ marginBottom: "24px" }}>
        <h3 style={{ fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "8px", fontFamily: "monospace" }}>Workloads</h3>
        <div style={{ display: "grid", gridTemplateColumns: "160px 100px 120px 80px 100px", gap: "0", padding: "8px 14px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
          {["Name", "Namespace", "Type", "Replicas", "Status"].map(h => (
            <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</div>
          ))}
        </div>
        {MOCK_WORKLOADS.map((w, i) => {
          const statusColor = w.status === "Healthy" ? "#10b981" : w.status === "Degraded" ? "#ef4444" : "#f59e0b";
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 100px 120px 80px 100px", gap: "0", padding: "8px 14px", borderBottom: "1px solid #111", alignItems: "center" }}>
              <div style={{ fontSize: "12px", color: "#e5e5e5", fontFamily: "monospace" }}>{w.name}</div>
              <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>{w.namespace}</div>
              <div style={{ fontSize: "11px", color: "#555", fontFamily: "monospace" }}>{w.type}</div>
              <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>{w.ready}/{w.desired}</div>
              <div style={{ fontSize: "10px", color: statusColor, fontFamily: "monospace" }}>{w.status}</div>
            </div>
          );
        })}
      </div>

      {/* Recent Events */}
      <div>
        <h3 style={{ fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "8px", fontFamily: "monospace" }}>Recent Events</h3>
        <div style={{ display: "grid", gridTemplateColumns: "24px 100px 1fr 100px", gap: "0", padding: "8px 14px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
          {["", "Reason", "Object", "Time"].map(h => (
            <div key={h} style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</div>
          ))}
        </div>
        {MOCK_EVENTS.map((e, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "24px 100px 1fr 100px", gap: "0", padding: "8px 14px", borderBottom: "1px solid #111", alignItems: "center" }}>
            <div style={{ fontSize: "12px", color: e.severity === "warning" ? "#ef4444" : "#3b82f6" }}>{e.severity === "warning" ? "⚠" : "ℹ"}</div>
            <div style={{ fontSize: "11px", color: e.severity === "warning" ? "#ef4444" : "#888", fontFamily: "monospace" }}>{e.reason}</div>
            <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.message}>
              {e.object}: {e.message}
            </div>
            <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace" }}>{e.time}</div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
