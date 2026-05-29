"use client";
import { FEATURES, Feature, StageNode, StageState } from "@/lib/mock";
import { useState } from "react";

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

interface Props {
  onNodeClick: (node: StageNode, action?: string) => void;
  activeNodeId: string | null;
}

export function LifecycleView({ onNodeClick, activeNodeId }: Props) {
  const [selectedFeature, setSelectedFeature] = useState<Feature>(FEATURES[0]);

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
              value={selectedFeature.id}
              onChange={(e) => {
                const f = FEATURES.find((x) => x.id === e.target.value);
                if (f) setSelectedFeature(f);
              }}
              style={{
                background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#e5e5e5",
                padding: "6px 10px", borderRadius: "6px", fontSize: "15px", fontWeight: 600,
                cursor: "pointer", outline: "none",
              }}
            >
              {FEATURES.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <span style={{
              background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888",
              padding: "3px 8px", borderRadius: "4px", fontSize: "11px",
            }}>
              {selectedFeature.team}
            </span>
          </div>
        </div>
        <button
          style={{
            background: "transparent", border: "1px solid #2a2a2a", color: "#888",
            padding: "6px 14px", borderRadius: "6px", cursor: "pointer", fontSize: "12px",
          }}
        >
          + New Feature
        </button>
      </div>

      {/* Lifecycle nodes */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0", overflowX: "auto", paddingBottom: "16px" }}>
        {selectedFeature.stages.map((node, i) => (
          <div key={node.id} style={{ display: "flex", alignItems: "center" }}>
            <StageCard
              node={node}
              isActive={activeNodeId === node.id}
              onClick={(action) => onNodeClick(node, action)}
            />
            {i < selectedFeature.stages.length - 1 && (
              <Arrow active={node.state !== "inactive" && node.state !== "pending"} />
            )}
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: "auto", paddingTop: "32px" }}>
        <ProgressBar stages={selectedFeature.stages} />
      </div>

      {/* Activity feed */}
      <ActivityFeed />
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
      {/* Type label */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <span style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {node.label}
        </span>
        <span style={{ fontSize: "14px" }}>{STAGE_ICONS[node.type]}</span>
      </div>

      {/* Title */}
      <div style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500, marginBottom: "8px", lineHeight: "1.4" }}>
        {node.title}
      </div>

      {/* Stats */}
      {node.stats && (
        <div style={{ fontSize: "18px", fontWeight: 700, color: sc.color, marginBottom: "8px" }}>
          {node.stats}
        </div>
      )}

      {/* State badge */}
      <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "10px" }}>
        <div style={{
          width: "6px", height: "6px", borderRadius: "50%", background: sc.color,
          ...(node.state === "running" ? { animation: "pulse-dot 1.5s ease-in-out infinite" } : {}),
        }} />
        <span style={{ fontSize: "11px", color: sc.color }}>{sc.label}</span>
      </div>

      {/* Connector badge */}
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

      {/* Actions */}
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

function ActivityFeed() {
  const items = [
    { time: "2m ago", text: "GitHub CI: TC-001, TC-002, TC-003 passed", color: "#10b981" },
    { time: "8m ago", text: "AI generated 5 test cases from spec", color: "#8b5cf6" },
    { time: "1h ago", text: "Tech spec moved to In Review by @alex", color: "#888" },
    { time: "3h ago", text: "PRD approved by @priya", color: "#10b981" },
  ];

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid #1a1a1a", paddingTop: "16px" }}>
      <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
        Recent Activity
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: "10px", alignItems: "baseline" }}>
            <span style={{ fontSize: "10px", color: "#444", minWidth: "40px" }}>{item.time}</span>
            <span style={{ fontSize: "11px", color: item.color }}>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
