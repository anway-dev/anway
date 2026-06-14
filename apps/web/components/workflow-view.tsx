"use client";
import { useState, useEffect } from "react";

type GateType = "manual" | "auto" | "disabled";
type AutonomyLevel = "L1" | "L2" | "L3" | "L4";

interface GateConfig {
  type: GateType;
  requiredApprovals: number;
  autoApproveConfidence: number;
  requiredApprovers: string[];
}

interface WorkflowStage {
  id: string;
  name: string;
  icon: string;
  description: string;
  gate: GateConfig;
  agents: string[];
}

interface ServicePolicy {
  id: string;
  name: string;
  autonomyLevel: AutonomyLevel;
  description: string;
}

const WORKFLOW_STAGES: WorkflowStage[] = [
  { id: "prd", name: "PRD", icon: "📄", description: "Product requirement document approved by PM", gate: { type: "manual", requiredApprovals: 1, autoApproveConfidence: 0.95, requiredApprovers: ["pm"] }, agents: ["linear-agent"] },
  { id: "spec", name: "Tech Spec", icon: "📐", description: "Technical specification reviewed by tech lead", gate: { type: "manual", requiredApprovals: 2, autoApproveConfidence: 0.92, requiredApprovers: ["tech-lead", "pm"] }, agents: ["github-agent", "repo-agent"] },
  { id: "bootstrap", name: "Bootstrap", icon: "⚡", description: "Project scaffolding and initial setup", gate: { type: "auto", requiredApprovals: 1, autoApproveConfidence: 0.90, requiredApprovers: ["tech-lead"] }, agents: ["repo-agent"] },
  { id: "tests", name: "Tests", icon: "🧪", description: "All test cases must pass before proceeding", gate: { type: "auto", requiredApprovals: 1, autoApproveConfidence: 0.90, requiredApprovers: ["tech-lead"] }, agents: ["test-agent", "github-agent"] },
  { id: "pr", name: "PR Review", icon: "🔍", description: "Code review by at least one peer", gate: { type: "manual", requiredApprovals: 2, autoApproveConfidence: 0.95, requiredApprovers: ["tech-lead", "peer"] }, agents: ["github-agent", "repo-agent"] },
  { id: "deploy", name: "Deploy", icon: "🚀", description: "Deploy to staging then production", gate: { type: "manual", requiredApprovals: 2, autoApproveConfidence: 0.95, requiredApprovers: ["tech-lead", "sre"] }, agents: ["argocd-agent", "k8s-agent"] },
  { id: "monitor", name: "Monitor", icon: "📊", description: "Continuous observability post-deploy", gate: { type: "disabled", requiredApprovals: 0, autoApproveConfidence: 0.90, requiredApprovers: [] }, agents: ["datadog-agent", "loki-agent", "k8s-agent"] },
];

const FALLBACK_SERVICES: ServicePolicy[] = [
  { id: "payments-api", name: "payments-api", autonomyLevel: "L2", description: "High-value service. Agent can analyze and recommend; all actions require approval." },
  { id: "catalog-service", name: "catalog-service", autonomyLevel: "L3", description: "Medium-risk. Agent can execute non-destructive actions; destructive actions supervised." },
  { id: "auth-service", name: "auth-service", autonomyLevel: "L2", description: "Security-critical. Agent can analyze only; all changes require human approval." },
];

const GATE_COLORS: Record<GateType, string> = {
  manual: "#f59e0b",
  auto: "#10b981",
  disabled: "#555",
};

const AUTONOMY_CONFIG: Record<AutonomyLevel, { label: string; desc: string; color: string; position: number }> = {
  L1: { label: "L1 Assist", desc: "Agent suggests only", color: "#3b82f6", position: 0 },
  L2: { label: "L2 Approve", desc: "Agent acts with approval", color: "#f59e0b", position: 33 },
  L3: { label: "L3 Supervise", desc: "Agent acts, human can override", color: "#f97316", position: 66 },
  L4: { label: "L4 Autonomous", desc: "Agent acts fully autonomously", color: "#ef4444", position: 100 },
};

const LOOP_NODES = [
  { id: "TRIGGER", label: "TRIGGER", color: "#3b82f6" },
  { id: "UNDERSTAND", label: "UNDERSTAND", color: "#8b5cf6" },
  { id: "PLAN", label: "PLAN", color: "#8b5cf6" },
  { id: "GATE_A", label: "Gate A", color: "#f59e0b", isGate: true },
  { id: "GENERATE", label: "GENERATE", color: "#10b981" },
  { id: "EXECUTE", label: "EXECUTE", color: "#10b981" },
  { id: "EVALUATE", label: "EVALUATE", color: "#10b981" },
  { id: "GATE_B", label: "Gate B", color: "#f59e0b", isGate: true },
  { id: "ACT", label: "ACT", color: "#ef4444" },
];

function GateEditor({ stage, onChange }: {
  stage: WorkflowStage;
  onChange: (stage: WorkflowStage) => void;
}) {
  const gate = stage.gate;

  return (
    <div style={{ padding: "16px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", marginTop: "10px" }}>
      <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
        Gate Configuration
      </div>

      {/* Gate type */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "11px", color: "#888", marginBottom: "6px" }}>Gate type</div>
        <div style={{ display: "flex", gap: "6px" }}>
          {(["manual", "auto", "disabled"] as GateType[]).map((type) => (
            <button
              key={type}
              onClick={() => onChange({ ...stage, gate: { ...gate, type } })}
              style={{
                padding: "4px 10px", borderRadius: "4px", fontSize: "11px", cursor: "pointer",
                background: gate.type === type ? `${GATE_COLORS[type]}22` : "transparent",
                border: `1px solid ${gate.type === type ? GATE_COLORS[type] : "#2a2a2a"}`,
                color: gate.type === type ? GATE_COLORS[type] : "#555",
                fontWeight: gate.type === type ? 700 : 400,
              }}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {gate.type !== "disabled" && (
        <>
          {/* Required approvals */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "11px", color: "#888", marginBottom: "6px" }}>Required approvals</div>
            <div style={{ display: "flex", gap: "6px" }}>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => onChange({ ...stage, gate: { ...gate, requiredApprovals: n } })}
                  style={{
                    width: "32px", height: "28px", borderRadius: "4px", fontSize: "12px", cursor: "pointer",
                    background: gate.requiredApprovals === n ? "rgba(16,185,129,0.15)" : "transparent",
                    border: `1px solid ${gate.requiredApprovals === n ? "rgba(16,185,129,0.4)" : "#2a2a2a"}`,
                    color: gate.requiredApprovals === n ? "#10b981" : "#555",
                    fontWeight: gate.requiredApprovals === n ? 700 : 400,
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Auto-approve confidence */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "11px", color: "#888", marginBottom: "6px" }}>Auto-approve if confidence ≥</div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="number"
                min={0.5}
                max={1.0}
                step={0.01}
                value={gate.autoApproveConfidence}
                onChange={(e) => onChange({ ...stage, gate: { ...gate, autoApproveConfidence: parseFloat(e.target.value) } })}
                style={{
                  width: "70px", background: "#111", border: "1px solid #2a2a2a", color: "#e5e5e5",
                  padding: "4px 8px", borderRadius: "4px", fontSize: "12px", outline: "none", fontFamily: "monospace",
                }}
              />
              <div style={{ height: "4px", flex: 1, background: "#1a1a1a", borderRadius: "2px", position: "relative" }}>
                <div style={{ height: "100%", background: "#10b981", width: `${(gate.autoApproveConfidence - 0.5) / 0.5 * 100}%`, borderRadius: "2px", transition: "width 0.2s" }} />
              </div>
            </div>
          </div>

          {/* Required approvers */}
          <div>
            <div style={{ fontSize: "11px", color: "#888", marginBottom: "6px" }}>Required approvers</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {gate.requiredApprovers.map((approver) => (
                <span
                  key={approver}
                  style={{
                    background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888",
                    padding: "2px 8px", borderRadius: "4px", fontSize: "11px",
                    display: "flex", alignItems: "center", gap: "4px",
                  }}
                >
                  {approver}
                  <span
                    onClick={() => onChange({ ...stage, gate: { ...gate, requiredApprovers: gate.requiredApprovers.filter((a) => a !== approver) } })}
                    style={{ cursor: "pointer", color: "#555", fontSize: "12px" }}
                  >×</span>
                </span>
              ))}
              <button
                style={{ background: "transparent", border: "1px dashed #2a2a2a", color: "#555", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer" }}
              >
                + add
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface GatePolicy {
  id: string;
  scope: string;
  approversRequired: number;
  autoApproveThreshold: number;
}

function GatePolicySection() {
  const [policy, setPolicy] = useState<GatePolicy | null>(null);
  const [approversRequired, setApproversRequired] = useState(1);
  const [autoApproveThreshold, setAutoApproveThreshold] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/gate/policies")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: GatePolicy[]) => {
        if (cancelled) return;
        const wildcard = Array.isArray(rows) ? rows.find((p) => p.scope === "*") : undefined;
        if (wildcard) {
          setPolicy(wildcard);
          setApproversRequired(wildcard.approversRequired);
          setAutoApproveThreshold(wildcard.autoApproveThreshold);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const resp = await fetch("/api/gate/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "*", approversRequired, autoApproveThreshold }),
      });
      if (resp.status === 403) {
        setStatus("Admin role required");
      } else if (resp.ok) {
        const saved: GatePolicy = await resp.json();
        setPolicy(saved);
        setStatus("Saved");
      } else {
        const err = await resp.json().catch(() => ({}));
        setStatus(err?.error ?? `Error ${resp.status}`);
      }
    } catch {
      setStatus("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "16px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", marginBottom: "20px", maxWidth: "640px" }}>
      <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
        Gate Policy
      </div>
      <div style={{ fontSize: "11px", color: "#555", marginBottom: "14px" }}>
        Tenant-wide policy for scope <span style={{ fontFamily: "monospace", color: "#888" }}>*</span>. Admin only.
      </div>

      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "11px", color: "#888", marginBottom: "6px" }}>Approvers required</div>
        <div style={{ display: "flex", gap: "6px" }}>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => setApproversRequired(n)}
              style={{
                width: "32px", height: "28px", borderRadius: "4px", fontSize: "12px", cursor: "pointer",
                background: approversRequired === n ? "rgba(16,185,129,0.15)" : "transparent",
                border: `1px solid ${approversRequired === n ? "rgba(16,185,129,0.4)" : "#2a2a2a"}`,
                color: approversRequired === n ? "#10b981" : "#555",
                fontWeight: approversRequired === n ? 700 : 400,
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "11px", color: "#888", marginBottom: "6px" }}>Auto-approve if confidence ≥ (0 = disabled)</div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="number"
            min={0}
            max={1.0}
            step={0.01}
            value={autoApproveThreshold}
            onChange={(e) => setAutoApproveThreshold(parseFloat(e.target.value) || 0)}
            style={{
              width: "70px", background: "#111", border: "1px solid #2a2a2a", color: "#e5e5e5",
              padding: "4px 8px", borderRadius: "4px", fontSize: "12px", outline: "none", fontFamily: "monospace",
            }}
          />
          <div style={{ height: "4px", flex: 1, background: "#1a1a1a", borderRadius: "2px", position: "relative" }}>
            <div style={{ height: "100%", background: "#10b981", width: `${Math.min(Math.max(autoApproveThreshold, 0), 1) * 100}%`, borderRadius: "2px", transition: "width 0.2s" }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: "6px 16px", borderRadius: "6px", fontSize: "12px", cursor: saving ? "default" : "pointer",
            background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", color: "#10b981",
            fontWeight: 600, opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save policy"}
        </button>
        {status && (
          <span style={{ fontSize: "11px", color: status === "Saved" ? "#10b981" : "#ef4444" }}>{status}</span>
        )}
        {policy && (
          <span style={{ fontSize: "10px", color: "#444", fontFamily: "monospace" }}>
            current: {policy.approversRequired} approver(s), threshold {policy.autoApproveThreshold}
          </span>
        )}
      </div>
    </div>
  );
}

function AutonomyDial({ service, onChange }: {
  service: ServicePolicy;
  onChange: (level: AutonomyLevel) => void;
}) {
  const levels: AutonomyLevel[] = ["L1", "L2", "L3", "L4"];
  const cfg = AUTONOMY_CONFIG[service.autonomyLevel];

  return (
    <div style={{ padding: "12px 14px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px" }}>
      <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
        Autonomy Level
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{
          background: `${cfg.color}22`, border: `1px solid ${cfg.color}44`,
          color: cfg.color, padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 700,
        }}>
          {cfg.label}
        </span>
        <span style={{ fontSize: "11px", color: "#555" }}>{cfg.desc}</span>
      </div>
      <div style={{ position: "relative", height: "6px", background: "#1a1a1a", borderRadius: "3px", marginBottom: "8px" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", background: cfg.color, width: `${cfg.position + 8}%`, borderRadius: "3px", transition: "width 0.3s" }} />
        <div style={{ position: "absolute", top: "-3px", left: `${cfg.position}%`, width: "12px", height: "12px", background: cfg.color, borderRadius: "50%", transform: "translateX(-50%)", transition: "left 0.3s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {levels.map((l) => (
          <button
            key={l}
            onClick={() => onChange(l)}
            style={{
              background: service.autonomyLevel === l ? `${AUTONOMY_CONFIG[l].color}22` : "transparent",
              border: `1px solid ${service.autonomyLevel === l ? AUTONOMY_CONFIG[l].color + "44" : "#1a1a1a"}`,
              color: service.autonomyLevel === l ? AUTONOMY_CONFIG[l].color : "#555",
              padding: "3px 6px", borderRadius: "3px", fontSize: "10px", cursor: "pointer", fontWeight: 700,
            }}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentLoop({ activeStageIdx }: { activeStageIdx: number }) {
  const [animIdx, setAnimIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setAnimIdx((i) => (i + 1) % LOOP_NODES.length);
    }, 900);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ padding: "16px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px" }}>
      <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
        Agent Loop
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {LOOP_NODES.map((node, idx) => {
          const isActive = idx === animIdx;
          const isGate = node.isGate;
          return (
            <div key={node.id} style={{ display: "flex", alignItems: "center", gap: "0" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "20px", flexShrink: 0 }}>
                {idx > 0 && (
                  <div style={{ width: "1px", height: "8px", background: "#1a1a1a" }} />
                )}
                <div style={{
                  width: isGate ? "10px" : "8px", height: isGate ? "10px" : "8px",
                  borderRadius: isGate ? "2px" : "50%",
                  background: isActive ? node.color : "#1a1a1a",
                  border: `1px solid ${isActive ? node.color : "#2a2a2a"}`,
                  boxShadow: isActive ? `0 0 6px ${node.color}` : "none",
                  transition: "all 0.3s",
                  transform: isGate ? "rotate(45deg)" : "none",
                }} />
                {idx < LOOP_NODES.length - 1 && (
                  <div style={{ width: "1px", height: "8px", background: "#1a1a1a" }} />
                )}
              </div>
              <div style={{ marginLeft: "10px", padding: "4px 0" }}>
                <span style={{ fontSize: "11px", fontFamily: "monospace", color: isActive ? node.color : isGate ? "#888" : "#444", fontWeight: isActive ? 700 : 400, transition: "color 0.3s" }}>
                  {node.label}
                </span>
                {isActive && (
                  <span style={{ marginLeft: "6px", fontSize: "9px", color: node.color }}>← active</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WorkflowView() {
  const [selectedService, setSelectedService] = useState<ServicePolicy>(FALLBACK_SERVICES[0]);
  const [services, setServices] = useState<ServicePolicy[]>(FALLBACK_SERVICES);
  const [stages, setStages] = useState<WorkflowStage[]>(WORKFLOW_STAGES);

  useEffect(() => {
    fetch("/api/services")
      .then((r) => r.ok ? r.json() as Promise<{ id: string; name: string }[]> : [])
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) return;
        const mapped: ServicePolicy[] = data.map((s) => ({
          id: s.id,
          name: s.name,
          autonomyLevel: "L2" as AutonomyLevel,
          description: `${s.name} — gate policy managed via Workflows`,
        }));
        setServices(mapped);
        setSelectedService(mapped[0]);
      })
      .catch(() => {});
  }, []);
  const [expandedStage, setExpandedStage] = useState<string | null>("tests");
  const [activeStageIdx, setActiveStageIdx] = useState(3);

  function updateStage(updated: WorkflowStage) {
    setStages((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function updateServiceAutonomy(level: AutonomyLevel) {
    setServices((prev) => prev.map((s) => (s.id === selectedService.id ? { ...s, autonomyLevel: level } : s)));
    setSelectedService((prev) => ({ ...prev, autonomyLevel: level }));
  }

  const currentSvc = services.find((s) => s.id === selectedService.id) || selectedService;

  return (
    <div style={{ display: "flex", height: "100%", background: "#080808", overflow: "hidden" }}>
      {/* Left panel */}
      <div style={{ width: "220px", flexShrink: 0, background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Service</div>
          {services.map((svc) => (
            <button
              key={svc.id}
              onClick={() => setSelectedService(svc)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: "6px",
                background: currentSvc.id === svc.id ? "#1a2a1a" : "transparent",
                border: `1px solid ${currentSvc.id === svc.id ? "rgba(16,185,129,0.3)" : "transparent"}`,
                color: currentSvc.id === svc.id ? "#10b981" : "#888",
                fontSize: "12px", cursor: "pointer", marginBottom: "2px",
              }}
            >
              <div style={{ fontFamily: "monospace", fontWeight: currentSvc.id === svc.id ? 600 : 400 }}>{svc.name}</div>
              <div style={{ fontSize: "10px", color: `${AUTONOMY_CONFIG[svc.autonomyLevel].color}`, marginTop: "2px" }}>
                {AUTONOMY_CONFIG[svc.autonomyLevel].label}
              </div>
            </button>
          ))}
        </div>
        <div style={{ padding: "12px", flex: 1, overflowY: "auto" }}>
          <AutonomyDial service={currentSvc} onChange={updateServiceAutonomy} />
          <div style={{ marginTop: "12px" }}>
            <AgentLoop activeStageIdx={activeStageIdx} />
          </div>
        </div>
      </div>

      {/* Main area: Pipeline */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        <GatePolicySection />
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Workflow Pipeline</div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5" }}>
            {currentSvc.name}
          </div>
          <div style={{ fontSize: "12px", color: "#555", marginTop: "4px" }}>{currentSvc.description}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0", maxWidth: "640px" }}>
          {stages.map((stage, idx) => {
            const isExpanded = expandedStage === stage.id;
            const isActive = idx === activeStageIdx;
            const gateColor = GATE_COLORS[stage.gate.type];

            return (
              <div key={stage.id} style={{ display: "flex", gap: "0" }}>
                {/* Connector line */}
                <div style={{ width: "40px", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {idx > 0 && <div style={{ width: "1px", height: "12px", background: "#2a2a2a" }} />}
                  <div style={{
                    width: "24px", height: "24px", borderRadius: "50%",
                    background: isActive ? "rgba(16,185,129,0.15)" : "#111",
                    border: `2px solid ${isActive ? "#10b981" : "#2a2a2a"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "11px", flexShrink: 0,
                    boxShadow: isActive ? "0 0 8px rgba(16,185,129,0.4)" : "none",
                  }}>
                    {stage.icon}
                  </div>
                  {idx < stages.length - 1 && <div style={{ width: "1px", flex: 1, minHeight: "20px", background: "#2a2a2a" }} />}
                </div>

                {/* Stage card */}
                <div style={{ flex: 1, marginBottom: "4px", marginLeft: "12px" }}>
                  <div
                    onClick={() => {
                      setExpandedStage(isExpanded ? null : stage.id);
                      setActiveStageIdx(idx);
                    }}
                    style={{
                      background: isActive ? "#111" : "#0e0e0e",
                      border: `1px solid ${isActive ? "#2a2a2a" : "#1a1a1a"}`,
                      borderRadius: "8px", padding: "12px 14px", cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: isActive ? "#e5e5e5" : "#d1d5db" }}>{stage.name}</span>
                        <span style={{
                          fontSize: "10px", padding: "1px 6px", borderRadius: "3px",
                          background: `${gateColor}18`, border: `1px solid ${gateColor}33`, color: gateColor,
                        }}>
                          {stage.gate.type}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ display: "flex", gap: "3px" }}>
                          {stage.agents.map((a) => (
                            <span key={a} style={{ fontSize: "9px", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#555", padding: "1px 5px", borderRadius: "3px", fontFamily: "monospace" }}>
                              {a.replace("-agent", "")}
                            </span>
                          ))}
                        </div>
                        <span style={{ color: "#555", fontSize: "12px" }}>{isExpanded ? "▴" : "▾"}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: "11px", color: "#555", marginTop: "4px" }}>{stage.description}</div>
                  </div>

                  {isExpanded && (
                    <GateEditor stage={stage} onChange={updateStage} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
