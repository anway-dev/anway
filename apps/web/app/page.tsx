"use client";
import { useState, useEffect, useCallback } from "react";
import LoginPage from "@/components/login-page";
import { LifecycleView } from "@/components/lifecycle";
import { ConnectorsView } from "@/components/connectors";
import { ApiClientView } from "@/components/apiclient";
import { AiPanel } from "@/components/ai-panel";
import { OrchestratorChat, OrchestratorContext } from "@/components/orchestrator-chat";
import { OnboardingModal } from "@/components/onboarding-modal";
import { WorkflowView } from "@/components/workflow-view";
import { AuditView } from "@/components/audit-view";
import { AccessView } from "@/components/access-view";
import { EditorView } from "@/components/editor-view";
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
import { PipelineView } from "@/components/pipeline-view";
import { EnvironmentsView } from "@/components/environments-view";
import { EnvSelector } from "@/components/env-selector";
import { EnvProvider } from "@/lib/env-context";
import type { StageNode } from "@/components/lifecycle";
import { ErrorBoundary } from "@/components/error-boundary";


type View = "chat" | "alerts" | "routing" | "lifecycle" | "editor" | "kb" | "workflow" | "approvals" | "api" | "connectors" | "audit" | "access" | "k8s" | "cloud" | "incident" | "catalog" | "automations" | "settings" | "projects" | "pipeline" | "environments";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "chat",        label: "Anway",        icon: "✦" },
  { id: "alerts",      label: "Signals",      icon: "◎" },
  { id: "incident",    label: "War Room",     icon: "⚠" },
  { id: "catalog",     label: "Services",     icon: "⬢" },
  { id: "projects",    label: "Projects",     icon: "◫" },
  { id: "pipeline",      label: "Pipeline",      icon: "⬡" },
  { id: "environments",  label: "Environments",  icon: "⬢" },
  { id: "routing",       label: "Routing",       icon: "⇉" },
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
  { id: "cloud",       label: "Cloud",        icon: "☁" },
  { id: "k8s",         label: "K8s",          icon: "☸" },
];

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [activeNode, setActiveNode] = useState<StageNode | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [orchestratorContext, setOrchestratorContext] = useState<OrchestratorContext | undefined>(undefined);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking

  // User identity — fetched from /api/auth/me
  const [userEmail, setUserEmail] = useState("—");
  const [userRole, setUserRole] = useState("—");
  // Demo mode status — the one-click "Try Demo" admin mint only exists when
  // the gateway has DEMO_MODE=true; hide the button otherwise (it would just
  // 404 on /api/auth/demo).
  const [demoEnabled, setDemoEnabled] = useState(false);
  useEffect(() => {
    fetch('/api/auth/methods')
      .then(r => r.ok ? r.json() as Promise<{ demo?: boolean }> : { demo: false })
      .then(m => setDemoEnabled(Boolean(m.demo)))
      .catch(() => setDemoEnabled(false));
  }, []);

  // Handle #token= fragment from OAuth/OIDC redirects
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#token=')) return;
    const token = decodeURIComponent(hash.slice('#token='.length));
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    fetch('/api/auth/set-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(() => { setAuthed(true); })
      .catch(() => {});
  }, []);

  const checkAuth = useCallback(() => {
    fetch('/api/auth/me')
      .then(r => { setAuthed(r.ok); })
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  // Sidebar data — fetched from gateway APIs
  const [recentQueries, setRecentQueries] = useState<{ id: string; query: string }[]>([]);
  const [criticalCount, setCriticalCount] = useState(0);
  const [activeIncidents, setActiveIncidents] = useState(0);
  const [cloudIssues, setCloudIssues] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("Anway");
  const [connectorCount, setConnectorCount] = useState<number | null>(null);

  useEffect(() => {
    // Initialize view from ?view= URL param
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    if (v && NAV.some(n => n.id === v)) setView(v as View);
  }, []);

  useEffect(() => {
    // Fetch critical alerts count
    fetch("/api/alerts")
      .then(r => r.json() as Promise<{ data: { severity: string }[] }>)
      .then(list => setCriticalCount((list.data ?? []).filter(a => a.severity === "critical").length))
      .catch(() => setCriticalCount(0))

    // Fetch active incidents count
    fetch("/api/incidents")
      .then(r => r.json() as Promise<{ data: { status: string }[] }>)
      .then(list => setActiveIncidents((list.data ?? []).filter(i => i.status === "active" || i.status === "investigating").length))
      .catch(() => setActiveIncidents(0))

    // Fetch recent audit events for sidebar
    fetch("/api/audit")
      .then(r => r.json() as Promise<{ data?: { id: string; query: string }[] }>)
      .then(resp => setRecentQueries((resp.data ?? []).slice(0, 3)))
      .catch(() => setRecentQueries([]))

    // Fetch workspace name
    fetch("/api/settings/workspace")
      .then(r => r.json() as Promise<{ name: string }>)
      .then(d => { if (d.name) setWorkspaceName(d.name); })
      .catch(() => {})

    // Fetch connector count
    fetch("/api/connectors/catalog")
      .then(r => r.json() as Promise<{ connected: boolean }[]>)
      .then(list => {
        const count = list.filter(c => c.connected).length
        setConnectorCount(count)
        if (count === 0 && typeof window !== 'undefined' && !localStorage.getItem('anway-onboarding-dismissed')) {
          setShowOnboarding(true)
        }
      })
      .catch(() => {})

    // Fetch user identity — redirect to login on expired session
    fetch("/api/auth/me")
      .then(r => {
        if (r.status === 401) { window.location.href = '/login'; return null }
        return r.ok ? r.json() as Promise<{ email: string; role: string }> : null
      })
      .then(d => {
        if (d) {
          if (d.email) setUserEmail(d.email)
          if (d.role) setUserRole(d.role)
        }
      })
      .catch(() => {})
  }, [])

  const handleNodeClick = (node: StageNode, action?: string) => {
    setActiveNode(node);
    setActiveAction(action ?? null);
  };

  const handleTriggerOrchestrator = (query: string, context: { title: string; source: string }) => {
    setOrchestratorContext({ query, title: context.title, source: context.source });
    setView("chat");
  };

  if (authed === null) {
    return <div style={{ minHeight: "100vh", background: "#080808" }} />;
  }

  if (!authed) {
    return <LoginPage onLogin={() => { setAuthed(true); checkAuth(); }} />;
  }

  return (
    <>
    <EnvProvider>
    <div style={{ display: "flex", height: "100vh", background: "#080808" }}>
      {/* Sidebar */}
      <div style={{ width: "220px", background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: 8 }}>
            <div style={{ width: "24px", height: "24px", background: "#10b981", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 900, color: "#000" }}>
              A
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5", letterSpacing: "-0.02em" }}>anway</span>
            <span style={{ fontSize: "10px", background: "#1a2a1a", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)", padding: "1px 5px", borderRadius: "3px", marginLeft: "2px" }}>
              beta
            </span>
          </div>
          {/* Env selector — always visible, switches all views */}
          <EnvSelector />
        </div>

        {/* Workspace */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #111" }}>
          <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px" }}>Workspace</div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <div style={{ width: "18px", height: "18px", borderRadius: "4px", background: "#1a2030", border: "1px solid #2a3a50", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#3b82f6", fontWeight: 700 }}>
              A
            </div>
            <span style={{ fontSize: "12px", color: "#d1d5db" }}>{workspaceName}</span>
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
              {item.id === "connectors" && connectorCount !== null && connectorCount > 0 && (
                <span style={{ marginLeft: "auto", fontSize: "10px", background: "#1a2a1a", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)", padding: "1px 5px", borderRadius: "10px" }}>
                  {connectorCount}
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
              <div style={{ fontSize: "11px", color: "#d1d5db" }}>{userEmail}</div>
              <div style={{ fontSize: "10px", color: "#555" }}>{userRole}</div>
            </div>
          </div>
          {demoEnabled && (
            <button
              onClick={async () => {
                try {
                  const r = await fetch('/api/auth/demo', { method: 'POST' })
                  const d = await r.json() as { token?: string }
                  if (d.token) { await fetch('/api/auth/set-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: d.token }) }); window.location.reload() }
                } catch { /* ignore */ }
              }}
              style={{ marginTop: '8px', width: '100%', padding: '6px', background: '#1a2a1a', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '5px', color: '#10b981', fontSize: '11px', cursor: 'pointer' }}
            >
              Try Demo
            </button>
          )}
          <button
            onClick={async () => {
              try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
              window.location.href = '/login'
            }}
            style={{ marginTop: '6px', width: '100%', padding: '6px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '5px', color: '#888', fontSize: '11px', cursor: 'pointer' }}
          >
            Log out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0 }}>
        {/* View area */}
        <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
          {view === "chat" && <ErrorBoundary viewName="Orchestrator"><OrchestratorChat initialContext={orchestratorContext} onContextConsumed={() => setOrchestratorContext(undefined)} onNavigate={(v: string) => setView(v as View)} onFirstMessage={() => { localStorage.setItem('anway-onboarding-dismissed', '1'); setShowOnboarding(false); }} /></ErrorBoundary>}
          {view === "alerts" && <ErrorBoundary viewName="Signals"><AlertsView onTriggerOrchestrator={handleTriggerOrchestrator} onGoToConnectors={() => setView("connectors")} /></ErrorBoundary>}
          {view === "routing" && <ErrorBoundary viewName="Routing"><IntakeView /></ErrorBoundary>}
          {view === "kb" && <ErrorBoundary viewName="Knowledge"><KbView /></ErrorBoundary>}
          {view === "lifecycle" && <ErrorBoundary viewName="Lifecycle"><div style={{ height: "100%", overflowY: "auto" }}><LifecycleView onNodeClick={handleNodeClick} activeNodeId={activeNode?.id ?? null} /></div></ErrorBoundary>}
          {view === "editor" && <ErrorBoundary viewName="Editor"><EditorView /></ErrorBoundary>}
          {view === "workflow" && <ErrorBoundary viewName="Workflows"><WorkflowView /></ErrorBoundary>}
          {view === "approvals" && <ErrorBoundary viewName="Approvals"><ApprovalsView /></ErrorBoundary>}
          {view === "api" && <ErrorBoundary viewName="API Client"><ApiClientView /></ErrorBoundary>}
          {view === "connectors" && <ErrorBoundary viewName="Connectors"><ConnectorsView /></ErrorBoundary>}
          {view === "audit" && <ErrorBoundary viewName="Audit"><AuditView /></ErrorBoundary>}
          {view === "access" && <ErrorBoundary viewName="Access"><AccessView /></ErrorBoundary>}
          {view === "cloud" && <ErrorBoundary viewName="Cloud"><CloudView onTriggerOrchestrator={handleTriggerOrchestrator} onGoToConnectors={() => setView("connectors")} /></ErrorBoundary>}
          {view === "incident" && <ErrorBoundary viewName="War Room"><IncidentView onTriggerOrchestrator={handleTriggerOrchestrator} onGoToConnectors={() => setView("connectors")} /></ErrorBoundary>}
          {view === "catalog" && <ErrorBoundary viewName="Services"><ServiceCatalog onTriggerOrchestrator={handleTriggerOrchestrator} onGoToConnectors={() => setView("connectors")} /></ErrorBoundary>}
          {view === "projects" && <ErrorBoundary viewName="Projects"><ProjectsView activeProject="" setActiveProject={() => {}} /></ErrorBoundary>}
          {view === "pipeline" && <ErrorBoundary viewName="Pipeline"><PipelineView onGoToConnectors={() => setView("connectors")} /></ErrorBoundary>}
          {view === "environments" && <ErrorBoundary viewName="Environments"><EnvironmentsView /></ErrorBoundary>}
          {view === "automations" && <ErrorBoundary viewName="Automations"><AutomationsView /></ErrorBoundary>}
          {view === "settings" && <ErrorBoundary viewName="Settings"><SettingsView /></ErrorBoundary>}
          {view === "k8s" && <ErrorBoundary viewName="K8s"><K8sView onGoToConnectors={() => setView("connectors")} /></ErrorBoundary>}
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
    </EnvProvider>
    {showOnboarding && (
      <OnboardingModal
        onDismiss={() => { localStorage.setItem('anway-onboarding-dismissed', '1'); setShowOnboarding(false); }}
        onGoToConnectors={() => { setView('connectors'); setShowOnboarding(false); }}
        onGoToChat={() => { setView('chat'); setShowOnboarding(false); }}
      />
    )}
    </>
  );
}


