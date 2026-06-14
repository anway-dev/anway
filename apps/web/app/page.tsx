"use client";
import { useState, useEffect } from "react";
import { LifecycleView } from "@/components/lifecycle";
import { ConnectorsView } from "@/components/connectors";
import { ApiClientView } from "@/components/apiclient";
import { AiPanel } from "@/components/ai-panel";
import { OrchestratorChat, OrchestratorContext } from "@/components/orchestrator-chat";
import { WorkflowView } from "@/components/workflow-view";
import { AuditView } from "@/components/audit-view";
import { AccessView } from "@/components/access-view";
import { EditorView } from "@/components/editor-view";
import { ModelConfig } from "@/components/model-config";
import { AlertsView } from "@/components/alerts-view";
import { IntakeView } from "@/components/intake-view";
import { KbView } from "@/components/kb-view";
import { CloudView } from "@/components/cloud-view";
import { IncidentView } from "@/components/incident-view";
import { ServiceCatalog } from "@/components/service-catalog";
import { AutomationsView } from "@/components/automations-view";
import { K8sView } from "@/components/k8s-view";
import { SettingsView } from "@/components/settings-view";
import { ApprovalsView } from "@/components/approvals-view";
import { ProjectsView } from "@/components/projects-view";
import type { StageNode } from "@/components/lifecycle";


type View = "chat" | "alerts" | "routing" | "lifecycle" | "editor" | "kb" | "workflow" | "approvals" | "api" | "connectors" | "audit" | "access" | "models" | "k8s" | "cloud" | "incident" | "catalog" | "automations" | "settings" | "projects";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "chat",        label: "Anvay",        icon: "✦" },
  { id: "alerts",      label: "Signals",      icon: "◎" },
  { id: "incident",    label: "War Room",     icon: "⚠" },
  { id: "catalog",     label: "Services",     icon: "⬢" },
  { id: "projects",    label: "Projects",     icon: "◫" },
  { id: "routing",     label: "Routing",      icon: "⇉" },
  { id: "lifecycle",   label: "Lifecycle",    icon: "◈" },
  { id: "editor",      label: "Editor",       icon: "⌗" },
  { id: "kb",          label: "Knowledge",    icon: "◉" },
  { id: "workflow",    label: "Workflows",    icon: "⬡" },
  { id: "approvals",  label: "Approvals",    icon: "⊡" },
  { id: "automations", label: "Automations",  icon: "⟳" },
  { id: "api",         label: "API Client",   icon: "⚡" },
  { id: "connectors",  label: "Connectors",   icon: "⬡" },
  { id: "audit",       label: "Audit",        icon: "⊡" },
  { id: "access",      label: "Access",       icon: "⊞" },
  { id: "settings", label: "Settings", icon: "⚙" },
  { id: "models",      label: "Models",       icon: "◈" },
  { id: "cloud",       label: "Cloud",        icon: "☁" },
  { id: "k8s",         label: "K8s",          icon: "☸" },
];

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [activeNode, setActiveNode] = useState<StageNode | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [orchestratorContext, setOrchestratorContext] = useState<OrchestratorContext | undefined>(undefined);

  // Sidebar data — fetched from gateway APIs
  const [recentQueries, setRecentQueries] = useState<{ id: string; query: string }[]>([]);
  const [criticalCount, setCriticalCount] = useState(0);
  const [activeIncidents, setActiveIncidents] = useState(0);
  const [cloudIssues, setCloudIssues] = useState(0);

  useEffect(() => {
    // Fetch critical alerts count
    fetch("/api/alerts")
      .then(r => r.json() as Promise<{ severity: string }[]>)
      .then(list => setCriticalCount(list.filter(a => a.severity === "critical").length))
      .catch(() => setCriticalCount(0))

    // Fetch active incidents count
    fetch("/api/incidents")
      .then(r => r.json() as Promise<{ status: string }[]>)
      .then(list => setActiveIncidents(list.filter(i => i.status === "active" || i.status === "investigating").length))
      .catch(() => setActiveIncidents(0))

    // Fetch recent audit events for sidebar
    fetch("/api/audit")
      .then(r => r.json() as Promise<{ id: string; query: string }[]>)
      .then(list => setRecentQueries(list.slice(0, 3)))
      .catch(() => setRecentQueries([]))
  }, [])

  const handleNodeClick = (node: StageNode, action?: string) => {
    setActiveNode(node);
    setActiveAction(action ?? null);
  };

  const handleTriggerOrchestrator = (query: string, context: { title: string; source: string }) => {
    setOrchestratorContext({ query, title: context.title, source: context.source });
    setView("chat");
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
              {item.id === "alerts" && criticalCount > 0 && (
                <span style={{ marginLeft: "auto", fontSize: "10px", background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", padding: "1px 5px", borderRadius: "10px", fontWeight: 700 }}>
                  {criticalCount}
                </span>
              )}
              {item.id === "incident" && activeIncidents > 0 && (
                <span style={{ marginLeft: "auto", fontSize: "10px", background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", padding: "1px 5px", borderRadius: "10px", fontWeight: 700 }}>
                  {activeIncidents}
                </span>
              )}
              {item.id === "cloud" && cloudIssues > 0 && (
                <span style={{ marginLeft: "auto", fontSize: "10px", background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", padding: "1px 5px", borderRadius: "10px", fontWeight: 700 }}>
                  {cloudIssues}
                </span>
              )}
            </button>
          ))}

          {/* Recent section */}
          <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", padding: "16px 8px 4px" }}>
            Recent
          </div>
          {recentQueries.map((evt) => (
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
          {view === "chat" && <OrchestratorChat key={orchestratorContext?.query} initialContext={orchestratorContext} />}
          {view === "alerts" && (
            <AlertsView onTriggerOrchestrator={handleTriggerOrchestrator} />
          )}
          {view === "routing" && <IntakeView />}
          {view === "kb" && <KbView />}
          {view === "lifecycle" && (
            <div style={{ height: "100%", overflowY: "auto" }}>
              <LifecycleView onNodeClick={handleNodeClick} activeNodeId={activeNode?.id ?? null} />
            </div>
          )}
          {view === "editor" && <EditorView />}
          {view === "workflow" && <WorkflowView />}
          {view === "approvals" && <ApprovalsView />}
          {view === "api" && <ApiClientView />}
          {view === "connectors" && <ConnectorsView />}
          {view === "audit" && <AuditView />}
          {view === "access" && <AccessView />}
          {view === "models" && <ModelConfig />}
          {view === "cloud" && <CloudView onTriggerOrchestrator={handleTriggerOrchestrator} />}
          {view === "incident" && <IncidentView onTriggerOrchestrator={handleTriggerOrchestrator} />}
          {view === "catalog" && <ServiceCatalog onTriggerOrchestrator={handleTriggerOrchestrator} />}
          {view === "projects" && <ProjectsView activeProject="" setActiveProject={() => {}} />}
          {view === "automations" && <AutomationsView />}
          {view === "settings" && <SettingsView />}
          {view === "k8s" && <K8sView />}
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


