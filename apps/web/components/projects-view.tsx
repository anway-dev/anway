"use client";
import { useState, useEffect } from "react";

const KB_DOMAINS = ["code", "infra", "metrics", "issues", "docs", "deploys"] as const;
type KBDomain = typeof KB_DOMAINS[number];
type KBStatus = "ready" | "syncing" | "pending";

interface ServiceData {
  id: string;
  name: string;
  health: string;
  language: string;
  team: string;
  repo: string;
  lastDeploy: string;
  description: string;
  activeIncidents: number;
  metrics: { errorRate: number; p99ms: number; rps: number; uptime: number };
}

interface ProjectData {
  id: string;
  name: string;
  repo: string;
  team: string;
  description: string;
  knowledgeBase: Record<KBDomain, KBStatus>;
  connectors: string[];
  autonomyLevel: string;
  lastSync: string;
}

const CONNECTOR_DISPLAY: Record<string, { name: string; icon: string; color: string }> = {
  github:     { name: "GitHub",     icon: "GH", color: "#6e7681" },
  prometheus: { name: "Prometheus", icon: "PR", color: "#e6522c" },
  datadog:    { name: "Datadog",    icon: "DD", color: "#632ca6" },
  pagerduty:  { name: "PagerDuty", icon: "PD", color: "#06ac38" },
  linear:     { name: "Linear",    icon: "LN", color: "#5e6ad2" },
  argocd:     { name: "ArgoCD",    icon: "AC", color: "#ef7b4d" },
};

function serviceToProject(svc: ServiceData): ProjectData {
  const hasRepo = Boolean(svc.repo && svc.repo !== "—");
  const hasMetrics = svc.metrics.rps > 0;
  const hasDeploy = Boolean(svc.lastDeploy && svc.lastDeploy !== "—");
  const connectors: string[] = [];
  if (hasRepo) connectors.push("github");
  if (hasMetrics) connectors.push("prometheus");
  if (svc.health !== "unknown") connectors.push("datadog");
  if (hasDeploy) connectors.push("argocd");

  return {
    id: svc.id,
    name: svc.name,
    repo: hasRepo ? svc.repo : "—",
    team: svc.team || "—",
    description: svc.description || `${svc.language || "unknown"} service`,
    knowledgeBase: {
      code:    hasRepo ? "ready" : "pending",
      infra:   svc.health !== "unknown" ? "ready" : "pending",
      metrics: hasMetrics ? "ready" : "pending",
      issues:  svc.activeIncidents > 0 ? "ready" : "pending",
      docs:    "pending",
      deploys: hasDeploy ? "ready" : "pending",
    },
    connectors,
    autonomyLevel: "L2",
    lastSync: hasDeploy ? svc.lastDeploy : "never",
  };
}

function kbColor(status: KBStatus) {
  if (status === "ready") return "#10b981";
  if (status === "syncing") return "#f59e0b";
  return "#333";
}

function kbComplete(p: ProjectData) {
  return KB_DOMAINS.every(d => p.knowledgeBase[d] === "ready");
}

function kbPartial(p: ProjectData) {
  return !kbComplete(p) && KB_DOMAINS.some(d => p.knowledgeBase[d] === "ready");
}

function syncDot(p: ProjectData) {
  if (kbComplete(p)) return "#10b981";
  if (kbPartial(p)) return "#f59e0b";
  return "#444";
}

function autonomyColor(level: string) {
  if (level === "L4") return "#ef4444";
  if (level === "L3") return "#f59e0b";
  if (level === "L2") return "#3b82f6";
  return "#555";
}

type DiscoveryStep = "idle" | "scanning" | "found" | "creating" | "done";

export function ProjectsView({
  activeProject,
  setActiveProject,
}: {
  activeProject: string;
  setActiveProject: (id: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [discoveryStep, setDiscoveryStep] = useState<DiscoveryStep>("idle");

  useEffect(() => {
    fetch("/api/services")
      .then(r => r.ok ? r.json() as Promise<ServiceData[]> : [])
      .then(svcs => {
        if (Array.isArray(svcs)) setProjects(svcs.map(serviceToProject));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleDiscover() {
    if (!repoUrl.trim()) return;
    setDiscoveryStep("scanning");
    try {
      setDiscoveryStep("found");
      const resp = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });
      if (!resp.ok) throw new Error('create failed');
      setDiscoveryStep("creating");
      const svcs = await fetch('/api/services').then(r => r.ok ? r.json() as Promise<ServiceData[]> : []);
      if (Array.isArray(svcs)) setProjects(svcs.map(serviceToProject));
      setDiscoveryStep("done");
    } catch {
      setDiscoveryStep("idle");
    }
  }

  function closeModal() {
    setShowNewModal(false);
    setRepoUrl("");
    setDiscoveryStep("idle");
  }

  const totalKbComplete = projects.filter(kbComplete).length;
  const teams = new Set(projects.map(p => p.team).filter(t => t !== "—")).size;
  const totalConnectors = new Set(projects.flatMap(p => p.connectors)).size;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "24px", flex: 1, minHeight: 0, overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px" }}>
          <div>
            <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>
              Projects
            </div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>All Projects</h2>
            <p style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
              Services, knowledge bases, and autonomy settings.
            </p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            style={{
              background: "#10b981", border: "none", color: "#000",
              padding: "8px 14px", borderRadius: "6px", cursor: "pointer",
              fontSize: "12px", fontWeight: 700, flexShrink: 0,
            }}
          >
            + New project
          </button>
        </div>

        {/* Stats bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "24px" }}>
          {[
            { label: "Projects",         value: projects.length,                            color: "#e5e5e5" },
            { label: "Teams",            value: teams,                                      color: "#3b82f6" },
            { label: "Active connectors",value: totalConnectors,                            color: "#10b981" },
            { label: "KB complete",      value: `${totalKbComplete} / ${projects.length}`,  color: "#8b5cf6" },
          ].map(s => (
            <div key={s.label} style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "14px 16px" }}>
              <div style={{ fontSize: "20px", fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Project cards */}
        {loading ? (
          <div style={{ color: "#555", fontSize: "13px" }}>Loading projects…</div>
        ) : projects.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: "12px" }}>
            <div style={{ fontSize: "32px", opacity: 0.15 }}>⬢</div>
            <div style={{ fontSize: "13px", color: "#555" }}>No services found — connect GitHub or Prometheus to discover services.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px" }}>
            {projects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                isActive={activeProject === project.id}
                onSelect={() => setActiveProject(project.id)}
              />
            ))}
          </div>
        )}

        {/* New Project Modal */}
        {showNewModal && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
          }}>
            <div style={{
              background: "#111", border: "1px solid #2a2a2a", borderRadius: "12px",
              padding: "28px", width: "460px", maxWidth: "90vw",
            }}>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5", marginBottom: "6px" }}>
                Connect GitHub repo
              </div>
              <div style={{ fontSize: "12px", color: "#888", marginBottom: "20px" }}>
                Anway will auto-discover services, suggest project groupings, and set up knowledge bases.
              </div>

              {discoveryStep === "idle" && (
                <>
                  <label style={{ fontSize: "11px", color: "#888", display: "block", marginBottom: "6px" }}>
                    GitHub repo URL
                  </label>
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={e => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/acme/my-service"
                    style={{
                      width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a",
                      color: "#e5e5e5", padding: "9px 12px", borderRadius: "6px",
                      fontSize: "12px", outline: "none", marginBottom: "16px", boxSizing: "border-box",
                    }}
                  />
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={closeModal} style={{ flex: 1, background: "transparent", border: "1px solid #2a2a2a", color: "#888", padding: "8px", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>
                      Cancel
                    </button>
                    <button onClick={handleDiscover} style={{ flex: 2, background: "#10b981", border: "none", color: "#000", padding: "8px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
                      Connect &amp; Auto-discover
                    </button>
                  </div>
                </>
              )}

              {discoveryStep === "scanning" && (
                <DiscoveryAnimation lines={["Connecting to GitHub...", "Cloning repo metadata...", "Scanning repo structure..."]} />
              )}
              {discoveryStep === "found" && (
                <DiscoveryAnimation lines={[
                  "Scanning repo... done",
                  "Found 3 services: payment-handler, webhook-consumer, scheduler",
                  "Detected: Node.js · Docker · Kubernetes manifests",
                  "Grouping into suggested projects...",
                ]} />
              )}
              {discoveryStep === "creating" && (
                <DiscoveryAnimation lines={[
                  "Creating projects...",
                  "  payment-handler → project created",
                  "  webhook-consumer → project created",
                  "  scheduler → project created",
                  "Linking connectors...",
                ]} />
              )}
              {discoveryStep === "done" && (
                <div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
                    {["payment-handler", "webhook-consumer", "scheduler"].map(svc => (
                      <div key={svc} style={{ display: "flex", alignItems: "center", gap: "10px", background: "#0e0e0e", border: "1px solid #1f2f1f", borderRadius: "6px", padding: "10px 12px" }}>
                        <span style={{ color: "#10b981", fontSize: "13px" }}>✓</span>
                        <span style={{ fontFamily: "monospace", fontSize: "12px", color: "#e5e5e5" }}>{svc}</span>
                        <span style={{ marginLeft: "auto", fontSize: "10px", background: "#1a2a1a", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)", padding: "1px 6px", borderRadius: "3px" }}>
                          Created
                        </span>
                      </div>
                    ))}
                  </div>
                  <button onClick={closeModal} style={{ width: "100%", background: "#10b981", border: "none", color: "#000", padding: "10px", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>
                    Done — Open Projects
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DiscoveryAnimation({ lines }: { lines: string[] }) {
  return (
    <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "14px 16px", fontFamily: "monospace", fontSize: "12px", color: "#10b981", lineHeight: 1.7, minHeight: "80px" }}>
      {lines.map((line, i) => (
        <div key={i} style={{ color: i === lines.length - 1 ? "#f59e0b" : "#10b981" }}>
          {i === lines.length - 1 ? "› " : "✓ "}{line}
        </div>
      ))}
      <span style={{ animation: "blink 1s step-end infinite", color: "#f59e0b" }}>_</span>
    </div>
  );
}

function ProjectCard({ project, isActive, onSelect }: { project: ProjectData; isActive: boolean; onSelect: () => void }) {
  const complete = kbComplete(project);
  const partial = kbPartial(project);
  const dot = syncDot(project);
  const incomplete = !complete;
  const readyCount = KB_DOMAINS.filter(d => project.knowledgeBase[d] === "ready").length;
  const progressPct = Math.round((readyCount / KB_DOMAINS.length) * 100);

  return (
    <div
      style={{
        background: "#111", border: `1px solid ${isActive ? "rgba(16,185,129,0.35)" : "#1a1a1a"}`,
        borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px",
        cursor: "pointer", transition: "border-color 0.15s",
      }}
      onClick={onSelect}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: dot, flexShrink: 0 }} />
            <span style={{ fontFamily: "monospace", fontSize: "13px", fontWeight: 700, color: "#e5e5e5" }}>
              {project.name}
            </span>
            <span style={{
              fontSize: "9px", fontWeight: 700, color: autonomyColor(project.autonomyLevel),
              border: `1px solid ${autonomyColor(project.autonomyLevel)}55`,
              padding: "1px 5px", borderRadius: "3px", background: autonomyColor(project.autonomyLevel) + "11", flexShrink: 0,
            }}>
              {project.autonomyLevel}
            </span>
          </div>
          <div style={{ fontSize: "11px", color: "#555", fontFamily: "monospace", marginBottom: "2px" }}>{project.repo}</div>
          <div style={{ fontSize: "11px", color: "#888" }}>{project.description}</div>
        </div>
        {project.team !== "—" && (
          <span style={{ fontSize: "10px", color: "#3b82f6", border: "1px solid #1a2a4a", background: "#0d1a2e", padding: "2px 7px", borderRadius: "3px", flexShrink: 0, marginLeft: "8px" }}>
            {project.team}
          </span>
        )}
      </div>

      {/* Knowledge base */}
      <div>
        <div style={{ fontSize: "10px", color: "#444", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Knowledge base
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {KB_DOMAINS.map(domain => (
            <div key={domain} title={`${domain}: ${project.knowledgeBase[domain]}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: kbColor(project.knowledgeBase[domain]), boxShadow: project.knowledgeBase[domain] === "ready" ? "0 0 4px #10b98166" : "none" }} />
              <span style={{ fontSize: "8px", color: "#444", textTransform: "uppercase" }}>{domain.slice(0, 3)}</span>
            </div>
          ))}
          <span style={{ fontSize: "10px", color: "#555", marginLeft: "4px" }}>{readyCount}/{KB_DOMAINS.length}</span>
        </div>
        {incomplete && (
          <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
              <span style={{ fontSize: "10px", color: "#f59e0b" }}>
                {readyCount === 0 ? "Setup incomplete" : "Sync in progress"}
              </span>
              <span style={{ fontSize: "10px", color: "#555" }}>{progressPct}%</span>
            </div>
            <div style={{ height: "3px", background: "#1a1a1a", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progressPct}%`, background: progressPct === 0 ? "#333" : "#f59e0b", borderRadius: "2px", transition: "width 0.3s" }} />
            </div>
          </div>
        )}
      </div>

      {/* Connectors */}
      {project.connectors.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
          {project.connectors.map(cid => {
            const conn = CONNECTOR_DISPLAY[cid];
            if (!conn) return null;
            return (
              <div key={cid} title={conn.name} style={{ width: "22px", height: "22px", borderRadius: "5px", background: conn.color + "22", border: `1px solid ${conn.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", color: conn.color, fontWeight: 700, flexShrink: 0 }}>
                {conn.icon}
              </div>
            );
          })}
          <span style={{ fontSize: "10px", color: "#555" }}>{project.connectors.length} connectors</span>
        </div>
      ) : (
        <div style={{ fontSize: "11px", color: "#ef444488", fontStyle: "italic" }}>
          No connectors — knowledge base empty
        </div>
      )}

      {/* Bottom row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
        <span style={{ fontSize: "10px", color: "#555" }}>Synced {project.lastSync}</span>
        <div style={{ display: "flex", gap: "6px" }}>
          <button onClick={e => e.stopPropagation()} style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#888", padding: "4px 9px", borderRadius: "4px", cursor: "pointer", fontSize: "10px" }}>
            Sync now
          </button>
          <button onClick={e => { e.stopPropagation(); onSelect(); }} style={{ background: isActive ? "#1a2a1a" : "rgba(16,185,129,0.08)", border: `1px solid ${isActive ? "rgba(16,185,129,0.3)" : "rgba(16,185,129,0.2)"}`, color: "#10b981", padding: "4px 9px", borderRadius: "4px", cursor: "pointer", fontSize: "10px", fontWeight: 600 }}>
            {isActive ? "Active" : "Open"}
          </button>
        </div>
      </div>
    </div>
  );
}
