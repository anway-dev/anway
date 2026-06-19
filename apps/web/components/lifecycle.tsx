"use client";
import { useState, useEffect } from "react";

type StageState = "approved" | "review" | "partial" | "running" | "pending" | "inactive" | "failed" | "live";

export interface StageNode {
  id: string;
  type: string;
  label: string;
  title: string;
  state: StageState;
  connector: string;
  connectorColor: string;
  stats?: string;
  actions: string[];
}

interface Feature {
  id: string;
  name: string;
  team: string;
  stages: StageNode[];
}

interface ArtifactRow {
  id: string;
  kind: string;
  title: string;
  status: string;
  parentId: string | null;
  createdAt: string;
}

const STATE_CONFIG: Record<StageState, { label: string; color: string; dot: string }> = {
  approved: { label: "Approved", color: "#10b981", dot: "#10b981" },
  review:   { label: "In Review", color: "#f59e0b", dot: "#f59e0b" },
  partial:  { label: "Partial", color: "#f97316", dot: "#f97316" },
  running:  { label: "Running", color: "#3b82f6", dot: "#3b82f6" },
  pending:  { label: "Pending", color: "#6b7280", dot: "#6b7280" },
  inactive: { label: "—", color: "#374151", dot: "#374151" },
  failed:   { label: "Failed", color: "#ef4444", dot: "#ef4444" },
  live:     { label: "Live", color: "#10b981", dot: "#10b981" },
};

const STAGE_ICONS: Record<string, string> = {
  prd: "📄", spec: "📐", tests: "🧪", collection: "⚡", deploy: "🚀", metrics: "📊",
};

const DEMO_ARTIFACTS: ArtifactRow[] = [
  {
    id: 'demo-prd-1',
    kind: 'prd',
    status: 'approved',
    title: 'CSV export for audit log',
    parentId: null,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-techspec-1',
    kind: 'techspec',
    status: 'review',
    title: 'CSV export — TechSpec',
    parentId: 'demo-prd-1',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

interface Props {
  onNodeClick: (node: StageNode, action?: string) => void;
  activeNodeId: string | null;
}

function artifactStateToStageState(status: string): StageState {
  if (status === "approved") return "approved";
  if (status === "draft") return "review";
  if (status === "generating") return "running";
  return "pending";
}

function buildFeatureFromArtifacts(prd: ArtifactRow, techSpec: ArtifactRow | null): Feature {
  const prdState = artifactStateToStageState(prd.status);
  const specState: StageState = techSpec ? artifactStateToStageState(techSpec.status) : "pending";
  const downstreamState: StageState = specState === "approved" ? "pending" : "inactive";

  return {
    id: prd.id,
    name: prd.title,
    team: "—",
    stages: [
      { id: `${prd.id}-prd`, type: "prd", label: "PRD", title: prd.title, state: prdState, connector: "Linear", connectorColor: "#5e6ad2", actions: ["View PRD", "Generate Tech Spec"] },
      { id: `${prd.id}-spec`, type: "spec", label: "Tech Spec", title: techSpec?.title ?? "Tech Spec", state: specState, connector: "GitHub", connectorColor: "#6e7681", actions: ["View Spec", "Approve"] },
      { id: `${prd.id}-tests`, type: "tests", label: "Tests", title: "Test Suite", state: downstreamState, connector: "GitHub Actions", connectorColor: "#2088ff", actions: ["Generate Tests"] },
      { id: `${prd.id}-collection`, type: "collection", label: "Collection", title: "API Collection", state: downstreamState, connector: "—", connectorColor: "#888", actions: ["Generate Collection"] },
      { id: `${prd.id}-deploy`, type: "deploy", label: "Deploy", title: "Production Deploy", state: downstreamState, connector: "ArgoCD", connectorColor: "#ef7b4d", actions: ["Trigger Deploy"] },
      { id: `${prd.id}-metrics`, type: "metrics", label: "Metrics", title: "Observability", state: "inactive", connector: "Datadog", connectorColor: "#7c3aed", actions: [] },
    ],
  };
}

export function LifecycleView({ onNodeClick, activeNodeId }: Props) {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newFeatureInput, setNewFeatureInput] = useState("");

  useEffect(() => {
    fetch("/api/lifecycle/artifacts")
      .then((r) => r.ok ? r.json() as Promise<ArtifactRow[]> : [])
      .then((rows) => {
        if (!Array.isArray(rows) || rows.length === 0) {
          // Fallback — use demo data when API returns empty
          const prds = DEMO_ARTIFACTS.filter((r) => r.kind === "prd");
          const techSpecs = DEMO_ARTIFACTS.filter((r) => r.kind === "techspec");
          const built = prds.map((prd) => {
            const ts = techSpecs.find((s) => s.parentId === prd.id) ?? null;
            return buildFeatureFromArtifacts(prd, ts);
          });
          setFeatures(built);
          if (built.length > 0) setSelectedFeature(built[0]);
          return;
        }
        const prds = rows.filter((r) => r.kind === "prd");
        const techSpecs = rows.filter((r) => r.kind === "techspec");
        const built = prds.map((prd) => {
          const ts = techSpecs.find((s) => s.parentId === prd.id) ?? null;
          return buildFeatureFromArtifacts(prd, ts);
        });
        setFeatures(built);
        if (built.length > 0) setSelectedFeature(built[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function createPrd() {
    if (!newFeatureInput.trim()) return;
    setCreating(true);
    try {
      const resp = await fetch("/api/lifecycle/prd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureRequest: newFeatureInput.trim() }),
      });
      if (resp.ok) {
        setNewFeatureInput("");
        // Reload artifacts
        const rows = await fetch("/api/lifecycle/artifacts").then((r) => r.json() as Promise<ArtifactRow[]>).catch(() => []);
        const prds = rows.filter((r) => r.kind === "prd");
        const specs = rows.filter((r) => r.kind === "techspec");
        const built = prds.map((prd) => buildFeatureFromArtifacts(prd, specs.find((s) => s.parentId === prd.id) ?? null));
        setFeatures(built);
        if (built.length > 0) setSelectedFeature(built[built.length - 1]);
      }
    } catch {
      // Fallback — append demo PRD when LLM not configured
      const newFeature = buildFeatureFromArtifacts(DEMO_ARTIFACTS[0]!, null);
      setFeatures(prev => [...prev, newFeature]);
      setNewFeatureInput("");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#555", fontSize: "13px" }}>
        Loading lifecycle…
      </div>
    );
  }

  if (features.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "24px" }}>
        <div style={{ color: "#555", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "24px" }}>
          Feature Lifecycle
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }}>
          <div style={{ fontSize: "13px", color: "#444" }}>No features yet. Create the first PRD to start a lifecycle.</div>
          <div style={{ display: "flex", gap: "8px", width: "480px" }}>
            <input
              value={newFeatureInput}
              onChange={(e) => setNewFeatureInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createPrd()}
              placeholder="Describe the feature…"
              style={{
                flex: 1, background: "#111", border: "1px solid #2a2a2a", color: "#e5e5e5",
                padding: "8px 12px", borderRadius: "6px", fontSize: "12px", outline: "none",
              }}
            />
            <button
              onClick={createPrd}
              disabled={creating || !newFeatureInput.trim()}
              style={{
                background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
                color: "#10b981", padding: "8px 16px", borderRadius: "6px", fontSize: "12px",
                cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1,
              }}
            >
              {creating ? "Generating…" : "+ Create PRD"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const current = selectedFeature ?? features[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "32px" }}>
        <div>
          <div style={{ color: "#555", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>
            Feature Lifecycle
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <select
              value={current.id}
              onChange={(e) => {
                const f = features.find((x) => x.id === e.target.value);
                if (f) setSelectedFeature(f);
              }}
              style={{
                background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#e5e5e5",
                padding: "6px 10px", borderRadius: "6px", fontSize: "15px", fontWeight: 600,
                cursor: "pointer", outline: "none",
              }}
            >
              {features.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            value={newFeatureInput}
            onChange={(e) => setNewFeatureInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createPrd()}
            placeholder="New feature…"
            style={{
              background: "#111", border: "1px solid #2a2a2a", color: "#e5e5e5",
              padding: "5px 10px", borderRadius: "6px", fontSize: "12px", outline: "none", width: "200px",
            }}
          />
          <button
            onClick={createPrd}
            disabled={creating || !newFeatureInput.trim()}
            style={{
              background: "transparent", border: "1px solid #2a2a2a", color: "#888",
              padding: "6px 14px", borderRadius: "6px", cursor: creating ? "default" : "pointer", fontSize: "12px",
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating ? "Generating…" : "+ New Feature"}
          </button>
        </div>
      </div>

      {/* Lifecycle nodes */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0", overflowX: "auto", paddingBottom: "16px" }}>
        {current.stages.map((node, i) => (
          <div key={node.id} style={{ display: "flex", alignItems: "center" }}>
            <StageCard
              node={node}
              isActive={activeNodeId === node.id}
              onClick={(action) => onNodeClick(node, action)}
            />
            {i < current.stages.length - 1 && (
              <Arrow active={node.state !== "inactive" && node.state !== "pending"} />
            )}
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: "auto", paddingTop: "32px" }}>
        <ProgressBar stages={current.stages} />
      </div>
    </div>
  );
}

function StageCard({ node, isActive, onClick }: { node: StageNode; isActive: boolean; onClick: (action?: string) => void }) {
  const sc = STATE_CONFIG[node.state];
  const isGhost = node.state === "inactive";

  return (
    <div
      onClick={() => onClick()}
      style={{
        width: "160px", minHeight: "180px", background: isActive ? "#1e2a1e" : "#111",
        border: `1px solid ${isActive ? "#10b981" : isGhost ? "#1a1a1a" : "#2a2a2a"}`,
        borderRadius: "10px", padding: "14px", cursor: "pointer", flexShrink: 0,
        transition: "all 0.15s", opacity: isGhost ? 0.4 : 1,
        boxShadow: isActive ? "0 0 0 1px #10b981, 0 4px 20px rgba(16,185,129,0.15)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <span style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {node.label}
        </span>
        <span style={{ fontSize: "14px" }}>{STAGE_ICONS[node.type] ?? "•"}</span>
      </div>

      <div style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500, marginBottom: "8px", lineHeight: "1.4" }}>
        {node.title}
      </div>

      {node.stats && (
        <div style={{ fontSize: "18px", fontWeight: 700, color: sc.color, marginBottom: "8px" }}>
          {node.stats}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "10px" }}>
        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: sc.color }} />
        <span style={{ fontSize: "11px", color: sc.color }}>{sc.label}</span>
      </div>

      {node.connector !== "—" && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "4px",
          background: "#1a1a1a", border: "1px solid #2a2a2a",
          padding: "2px 6px", borderRadius: "4px", marginBottom: "10px",
        }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: node.connectorColor }} />
          <span style={{ fontSize: "10px", color: "#888" }}>{node.connector}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {node.actions.slice(0, 2).map((action) => {
          const isAI = action.startsWith("Generate") || action === "Export k6";
          return (
            <button
              key={action}
              onClick={(e) => { e.stopPropagation(); onClick(action); }}
              style={{
                background: isAI ? "rgba(16,185,129,0.1)" : "transparent",
                border: `1px solid ${isAI ? "rgba(16,185,129,0.3)" : "#2a2a2a"}`,
                color: isAI ? "#10b981" : "#888",
                padding: "3px 6px", borderRadius: "4px", fontSize: "10px",
                cursor: "pointer", textAlign: "left", width: "100%",
              }}
            >
              {isAI ? "✦ " : ""}{action}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Arrow({ active }: { active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "0 4px", paddingBottom: "30px" }}>
      <svg width="24" height="16" viewBox="0 0 24 16">
        <line x1="0" y1="8" x2="18" y2="8" stroke={active ? "#2a2a2a" : "#1f1f1f"} strokeWidth="1.5" />
        <polyline points="14,4 20,8 14,12" fill="none" stroke={active ? "#3a3a3a" : "#1f1f1f"} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function ProgressBar({ stages }: { stages: StageNode[] }) {
  const total = stages.length;
  const done = stages.filter((s) => ["approved", "live", "running"].includes(s.state)).length;
  const pct = Math.round((done / total) * 100);

  return (
    <div style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: "8px", padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ fontSize: "11px", color: "#888" }}>Lifecycle progress</span>
        <span style={{ fontSize: "11px", color: "#e5e5e5", fontWeight: 600 }}>{pct}%</span>
      </div>
      <div style={{ background: "#1a1a1a", borderRadius: "4px", height: "4px" }}>
        <div style={{ background: "#10b981", width: `${pct}%`, height: "100%", borderRadius: "4px", transition: "width 0.3s" }} />
      </div>
    </div>
  );
}
