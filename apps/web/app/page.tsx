"use client";
import { useState } from "react";
import { LifecycleView } from "@/components/lifecycle";
import { ConnectorsView } from "@/components/connectors";
import { ApiClientView } from "@/components/apiclient";
import { AiPanel } from "@/components/ai-panel";
import { OrchestratorChat } from "@/components/orchestrator-chat";
import { WorkflowView } from "@/components/workflow-view";
import { AuditView } from "@/components/audit-view";
import { AccessView } from "@/components/access-view";
import { EditorView } from "@/components/editor-view";
import { StageNode } from "@/lib/mock";
import { AUDIT_EVENTS } from "@/lib/mock";

type View = "chat" | "lifecycle" | "editor" | "workflow" | "api" | "connectors" | "audit" | "access" | "k8s";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "chat",       label: "Orchestrator", icon: "✦" },
  { id: "lifecycle",  label: "Lifecycle",    icon: "◈" },
  { id: "editor",     label: "Editor",       icon: "⌗" },
  { id: "workflow",   label: "Workflows",    icon: "⬡" },
  { id: "api",        label: "API Client",   icon: "⚡" },
  { id: "connectors", label: "Connectors",   icon: "⬡" },
  { id: "audit",      label: "Audit",        icon: "◎" },
  { id: "access",     label: "Access",       icon: "⊡" },
  { id: "k8s",        label: "K8s",          icon: "☸" },
];

const RECENT_QUERIES = AUDIT_EVENTS.slice(0, 3);

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [activeNode, setActiveNode] = useState<StageNode | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleNodeClick = (node: StageNode, action?: string) => {
    setActiveNode(node);
    setActiveAction(action ?? null);
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#080808" }}>
      {/* Sidebar */}
      <div style={{ width: "220px", background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ padding: "18px 16px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "24px", height: "24px", background: "#10b981", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 900, color: "#000" }}>
              A
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5", letterSpacing: "-0.02em" }}>anvay</span>
            <span style={{ fontSize: "10px", background: "#1a2a1a", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)", padding: "1px 5px", borderRadius: "3px", marginLeft: "2px" }}>
              beta
            </span>
          </div>
        </div>

        {/* Workspace */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #111" }}>
          <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px" }}>Workspace</div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <div style={{ width: "18px", height: "18px", borderRadius: "4px", background: "#1a2030", border: "1px solid #2a3a50", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#3b82f6", fontWeight: 700 }}>
              A
            </div>
            <span style={{ fontSize: "12px", color: "#d1d5db" }}>Acme Platform</span>
            <span style={{ marginLeft: "auto", color: "#555", fontSize: "12px" }}>⌄</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: "8px", flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", padding: "8px 8px 4px" }}>
            Platform
          </div>
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              style={{
                display: "flex", alignItems: "center", gap: "8px", width: "100%",
                padding: "7px 8px", borderRadius: "6px", cursor: "pointer", border: "none",
                background: view === item.id ? "#1a2a1a" : "transparent",
                color: view === item.id ? "#10b981" : "#888",
                fontSize: "12px", fontWeight: view === item.id ? 600 : 400,
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: "13px", width: "18px", textAlign: "center" }}>{item.icon}</span>
              {item.label}
              {item.id === "connectors" && (
                <span style={{ marginLeft: "auto", fontSize: "10px", background: "#1a2a1a", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)", padding: "1px 5px", borderRadius: "10px" }}>
                  7
                </span>
              )}
              {item.id === "chat" && (
                <span style={{ marginLeft: "auto", width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 4px #10b981" }} />
              )}
            </button>
          ))}

          {/* Recent section */}
          <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", padding: "16px 8px 4px" }}>
            Recent
          </div>
          {RECENT_QUERIES.map((evt) => (
            <button
              key={evt.id}
              onClick={() => setView("chat")}
              style={{
                display: "flex", alignItems: "flex-start", gap: "6px", width: "100%",
                padding: "6px 8px", borderRadius: "6px", cursor: "pointer", border: "none",
                background: "transparent", color: "#555", fontSize: "11px", textAlign: "left",
              }}
            >
              <span style={{ color: "#444", fontSize: "11px", marginTop: "1px", flexShrink: 0 }}>↗</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{evt.query}</span>
            </button>
          ))}
        </nav>

        {/* Bottom */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a1a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#1a2030", border: "1px solid #2a3a50", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#3b82f6", fontWeight: 700 }}>
              AJ
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "#d1d5db" }}>alex@acme.dev</div>
              <div style={{ fontSize: "10px", color: "#555" }}>Admin</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0 }}>
        {/* View area */}
        <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
          {view === "chat" && <OrchestratorChat />}
          {view === "lifecycle" && (
            <div style={{ height: "100%", overflowY: "auto" }}>
              <LifecycleView onNodeClick={handleNodeClick} activeNodeId={activeNode?.id ?? null} />
            </div>
          )}
          {view === "editor" && <EditorView />}
          {view === "workflow" && <WorkflowView />}
          {view === "api" && <ApiClientView />}
          {view === "connectors" && <ConnectorsView />}
          {view === "audit" && <AuditView />}
          {view === "access" && <AccessView />}
          {view === "k8s" && <K8sPlaceholder />}
        </div>

        {/* AI Panel (only for lifecycle view) */}
        {view === "lifecycle" && activeNode && (
          <AiPanel
            node={activeNode}
            action={activeAction}
            onClose={() => { setActiveNode(null); setActiveAction(null); }}
          />
        )}
      </div>
    </div>
  );
}

function K8sPlaceholder() {
  return (
    <div style={{ padding: "24px", height: "100%", overflowY: "auto" }}>
      <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Kubernetes</div>
      <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", marginBottom: "8px" }}>Cluster Overview</h2>
      <p style={{ fontSize: "12px", color: "#888", marginBottom: "24px" }}>Connect an EKS, GKE, or AKS cluster via the Connectors tab to see live workloads.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
        {[["Namespaces", "12", "#3b82f6"], ["Pods Running", "47", "#10b981"], ["Services", "31", "#8b5cf6"]].map(([label, val, color]) => (
          <div key={String(label)} style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "16px" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: color as string }}>{val}</div>
            <div style={{ fontSize: "11px", color: "#888", marginTop: "4px" }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: "8px", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "12px", color: "#888", fontWeight: 600 }}>payments namespace</span>
          <span style={{ fontSize: "11px", color: "#555" }}>eks-us-east-1 · prod</span>
        </div>
        {[
          ["payments-api", "3/3", "Running", "v2.2.9", "32m CPU · 128Mi"],
          ["payments-worker", "2/2", "Running", "v2.2.9", "12m CPU · 64Mi"],
          ["payments-db-proxy", "1/1", "Running", "v1.4.2", "8m CPU · 32Mi"],
        ].map(([name, ready, status, version, resources]) => (
          <div key={String(name)} style={{ padding: "10px 16px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: "16px", fontSize: "11px" }}>
            <span style={{ color: "#d1d5db", minWidth: "160px", fontFamily: "monospace" }}>{name}</span>
            <span style={{ color: "#10b981", minWidth: "40px" }}>{ready}</span>
            <span style={{ color: "#10b981", minWidth: "60px" }}>{status}</span>
            <span style={{ color: "#888", minWidth: "60px", fontFamily: "monospace" }}>{version}</span>
            <span style={{ color: "#555" }}>{resources}</span>
            <button style={{ marginLeft: "auto", background: "none", border: "1px solid #2a2a2a", color: "#888", padding: "2px 8px", borderRadius: "4px", cursor: "pointer", fontSize: "10px" }}>
              Logs
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
