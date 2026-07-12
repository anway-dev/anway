"use client";
import { EmptyState } from "@/components/empty-state"
import { useState, useEffect, useCallback, useRef } from "react";
import { useEnv } from "@/lib/env-context";

interface PipelineStage {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: string;
  gate?: boolean;
  env?: string | null;
  envLabel?: string;
  tfEnv?: string;
  run?: {
    status: string;
    output: Record<string, unknown>;
    startedAt?: string;
    finishedAt?: string;
  } | null;
}

interface Pipeline {
  id: string;
  name: string;
  description?: string;
  stages: PipelineStage[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

// Group flat stages into environments + gates for rendering
interface EnvGroup {
  id: string;
  label: string;
  color: string;
  stages: PipelineStage[];
}
interface LayoutItem {
  type: "env" | "gate";
  env?: EnvGroup;
  gate?: PipelineStage;
}

function groupStages(stages: PipelineStage[]): LayoutItem[] {
  const items: LayoutItem[] = [];
  let currentEnv: EnvGroup | null = null;

  for (const stage of stages) {
    if (stage.type === "gate" || stage.gate) {
      if (currentEnv) { items.push({ type: "env", env: currentEnv }); currentEnv = null; }
      items.push({ type: "gate", gate: stage });
    } else {
      // A non-gate stage always belongs in the pipeline flow. Stages that carry
      // an explicit env group under that env; stages without one fall into a
      // default lane so they still render (previously they were silently
      // dropped, leaving a blank detail panel for pipelines whose stages have
      // no env set).
      const envId = stage.env ?? "__pipeline__";
      const envLabel = stage.envLabel ?? stage.env ?? "Stages";
      if (!currentEnv || currentEnv.id !== envId) {
        if (currentEnv) items.push({ type: "env", env: currentEnv });
        currentEnv = { id: envId, label: envLabel, color: stage.color, stages: [] };
      }
      currentEnv.stages.push(stage);
    }
  }
  if (currentEnv) items.push({ type: "env", env: currentEnv });
  return items;
}

function statusColor(status?: string): string {
  switch (status) {
    case "done": return "#10b981";
    case "success": return "#10b981";
    case "running": return "#f59e0b";
    case "failed": return "#ef4444";
    case "waiting": return "#8b5cf6";
    case "pending": return "#8b5cf6";
    case "approved": return "#10b981";
    default: return "#333";
  }
}

function statusIcon(status?: string): string {
  switch (status) {
    case "done": return "✓";
    case "running": return "◌";
    case "failed": return "✗";
    case "waiting": return "⏸";
    case "approved": return "✓";
    default: return "○";
  }
}

function envDone(env: EnvGroup): boolean {
  return env.stages.every(s => s.run?.status === "done" || s.run?.status === "approved");
}

function envHasFailed(env: EnvGroup): boolean {
  return env.stages.some(s => s.run?.status === "failed");
}

function firstIncompleteStage(env: EnvGroup): PipelineStage | undefined {
  return env.stages.find(s => !s.run || (s.run.status !== "done" && s.run.status !== "approved"));
}

export function PipelineView({ onGoToConnectors }: { onGoToConnectors?: () => void } = {}) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selected, setSelected] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [runningStage, setRunningStage] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ stageId: string; lines: string[] }[]>([]);
  const [activeLogStage, setActiveLogStage] = useState<string | null>(null);
  const [gateApprovalState, setGateApprovalState] = useState<{
    pipelineId: string;
    stageId: string;
    requireChangeTicket: boolean;
  } | null>(null);
  const [changeTicketUrl, setChangeTicketUrl] = useState("");
  const [approving, setApproving] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const { env, apiFetch } = useEnv();

  // Track the selected pipeline's id in a ref so fetchPipelines can refresh the
  // selected row WITHOUT depending on the `selected` object. Depending on
  // `selected` here caused an infinite fetch loop: each fetch calls
  // setSelected(new object) → `selected` identity changes → fetchPipelines is
  // recreated → the effect below refires → fetch again … (the Pipeline screen
  // flickered and hammered /api/pipelines as soon as any pipeline was selected).
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { selectedIdRef.current = selected?.id ?? null; }, [selected]);

  const fetchPipelines = useCallback(async () => {
    try {
      const r = await apiFetch("/api/pipelines");
      if (r.ok) {
        const { data } = await r.json() as { data: Pipeline[]; nextCursor: string | null };
        setPipelines(data ?? []);
        const id = selectedIdRef.current;
        if (id) {
          const updated = (data ?? []).find(p => p.id === id);
          if (updated) setSelected(updated);
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [apiFetch]);

  const fetchPipeline = useCallback(async (id: string) => {
    try {
      const r = await apiFetch(`/api/pipelines/${id}`);
      if (r.ok) {
        const pipeline = await r.json() as Pipeline;
        setSelected(pipeline);
        setPipelines(prev => prev.map(p => p.id === id ? pipeline : p));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void fetchPipelines(); }, [fetchPipelines, env]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const appendLog = (stageId: string, line: string) => {
    setLogs(prev => {
      const existing = prev.find(l => l.stageId === stageId);
      if (existing) return prev.map(l => l.stageId === stageId ? { ...l, lines: [...l.lines, line] } : l);
      return [...prev, { stageId, lines: [line] }];
    });
  };

  const runStage = async (pipelineId: string, stageId: string) => {
    setRunningStage(stageId);
    setActiveLogStage(stageId);
    setLogs(prev => prev.filter(l => l.stageId !== stageId));
    appendLog(stageId, `▶ Starting ${stageId}…`);

    try {
      const resp = await apiFetch(`/api/pipelines/${pipelineId}/stages/${stageId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      const reader = resp.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (evt["type"] === "status") appendLog(stageId, `  ${evt["message"]}`);
            else if (evt["type"] === "log") appendLog(stageId, `  ${evt["line"]}`);
            else if (evt["type"] === "done") appendLog(stageId, `✓ Done`);
            else if (evt["type"] === "gate_required") appendLog(stageId, `⏸ ${evt["message"]}`);
            else if (evt["type"] === "error") appendLog(stageId, `✗ Error: ${evt["message"]}`);
          } catch { /* bad json */ }
        }
      }
    } finally {
      setRunningStage(null);
      if (selected) await fetchPipeline(selected.id);
    }
  };

  const approveGate = async (pipelineId: string, stageId: string, changeTicketUrl?: string) => {
    setApproving(true);
    try {
      const body = changeTicketUrl ? JSON.stringify({ changeTicketUrl }) : "{}";
      const resp = await apiFetch(`/api/pipelines/${pipelineId}/stages/${stageId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!resp.ok) {
        const err = await resp.json() as { error?: string; code?: string };
        if (err["code"] === "CHANGE_TICKET_REQUIRED") {
          setGateApprovalState({ pipelineId, stageId, requireChangeTicket: true });
          return;
        }
      }
      setGateApprovalState(null);
      setChangeTicketUrl("");
      if (selected) await fetchPipeline(selected.id);
    } finally {
      setApproving(false);
    }
  };

  const initiateApprove = async (pipelineId: string, stageId: string) => {
    // Fetch gate policy to check if change ticket is required
    try {
      const resp = await apiFetch(`/api/gate-policies?pipelineId=${pipelineId}&stageId=${stageId}`);
      if (resp.ok) {
        const policies = await resp.json() as Array<{ requireChangeTicket?: boolean; require_change_ticket?: boolean }>;
        const policy = policies[0];
        if (policy && (policy.requireChangeTicket || policy.require_change_ticket)) {
          setGateApprovalState({ pipelineId, stageId, requireChangeTicket: true });
          return;
        }
      }
    } catch { /* proceed without gate policy check */ }

    // Proceed with approval
    await approveGate(pipelineId, stageId);
  };

  const runEnvSequential = async (pipelineId: string, env: EnvGroup) => {
    for (const stage of env.stages) {
      const s = stage.run?.status;
      if (s === "done" || s === "approved") continue;
      await runStage(pipelineId, stage.id);
      // Re-fetch to check if stage failed
      await fetchPipeline(pipelineId);
      // Stop if failed
      const refreshed = (pipelines ?? []).find(p => p.id === pipelineId);
      if (refreshed) {
        const updatedStage = refreshed.stages.find(st => st.id === stage.id);
        if (updatedStage?.run?.status === "failed") break;
      }
    }
  };

  const createPipeline = async () => {
    if (!newName.trim()) return;
    const r = await apiFetch("/api/pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
    });
    if (r.ok) {
      const data = await r.json() as Pipeline;
      setPipelines(prev => [data, ...prev]);
      setSelected(data);
      setCreating(false);
      setNewName("");
      setNewDesc("");
    }
  };

  const deletePipeline = async (id: string) => {
    await apiFetch(`/api/pipelines/${id}`, { method: "DELETE" });
    setPipelines(prev => prev.filter(p => p.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const activeLogs = activeLogStage ? (logs.find(l => l.stageId === activeLogStage)?.lines ?? []) : [];
  const layout = selected ? groupStages(selected.stages) : [];

  return (
    <div style={{ display: "flex", height: "100%", background: "#080808", color: "#e5e5e5", fontFamily: "mono", overflow: "hidden" }}>

      {/* Sidebar */}
      <div style={{ width: 220, borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "16px 12px 8px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Pipelines</div>
          <button
            onClick={() => setCreating(true)}
            style={{ width: "100%", padding: "6px 10px", background: "#111", border: "1px solid #2a2a2a", borderRadius: 4, color: "#10b981", fontSize: 12, cursor: "pointer", textAlign: "left" }}
          >
            + New pipeline
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: 12, color: "#555", fontSize: 12 }}>Loading…</div>}
          {pipelines.map(p => (
            <div
              key={p.id}
              data-testid="pipeline-row"
              onClick={() => { setSelected(p); void fetchPipeline(p.id); }}
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid #111",
                cursor: "pointer",
                background: selected?.id === p.id ? "#0e0e0e" : "transparent",
                borderLeft: selected?.id === p.id ? "2px solid #10b981" : "2px solid transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 12, color: "#e5e5e5", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{p.name}</div>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor(p.status), flexShrink: 0 }} />
              </div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{p.status}</div>
            </div>
          ))}
          {!loading && pipelines.length === 0 && (
            <div style={{ padding: 16, color: "#555", fontSize: 12 }}>No pipelines yet</div>
          )}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Create modal */}
        {creating && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
            <div style={{ background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 8, padding: 24, width: 400 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>New Promotion Pipeline</div>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void createPipeline(); if (e.key === "Escape") setCreating(false); }}
                placeholder="Service name (e.g. payments-api)"
                style={{ width: "100%", padding: "8px 12px", background: "#111", border: "1px solid #2a2a2a", borderRadius: 4, color: "#e5e5e5", fontSize: 13, marginBottom: 10, boxSizing: "border-box" }}
              />
              <input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                style={{ width: "100%", padding: "8px 12px", background: "#111", border: "1px solid #2a2a2a", borderRadius: 4, color: "#e5e5e5", fontSize: 13, marginBottom: 16, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setCreating(false)} style={{ padding: "6px 14px", background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4, color: "#888", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                <button onClick={() => void createPipeline()} style={{ padding: "6px 14px", background: "#10b981", border: "none", borderRadius: 4, color: "#000", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Create</button>
              </div>
            </div>
          </div>
        )}

        {/* Gate change ticket modal */}
        {gateApprovalState?.requireChangeTicket && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
            <div style={{ background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 8, padding: 24, width: 420 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Gate Approval — Change Ticket Required</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
                This gate requires a change ticket URL before approval.
              </div>
              <input
                autoFocus
                value={changeTicketUrl}
                onChange={e => setChangeTicketUrl(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && changeTicketUrl.trim()) void approveGate(gateApprovalState.pipelineId, gateApprovalState.stageId, changeTicketUrl.trim()); if (e.key === "Escape") { setGateApprovalState(null); setChangeTicketUrl(""); } }}
                placeholder="Jira change ticket URL (e.g. https://jira.company.com/browse/CHG-1234)"
                style={{ width: "100%", padding: "8px 12px", background: "#111", border: "1px solid #2a2a2a", borderRadius: 4, color: "#e5e5e5", fontSize: 13, marginBottom: 16, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => { setGateApprovalState(null); setChangeTicketUrl(""); }} style={{ padding: "6px 14px", background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4, color: "#888", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                <button
                  disabled={!changeTicketUrl.trim() || approving}
                  onClick={() => void approveGate(gateApprovalState.pipelineId, gateApprovalState.stageId, changeTicketUrl.trim())}
                  style={{
                    padding: "6px 14px",
                    background: changeTicketUrl.trim() ? "#8b5cf6" : "#333",
                    border: "none",
                    borderRadius: 4,
                    color: changeTicketUrl.trim() ? "#fff" : "#555",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: changeTicketUrl.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  {approving ? "Approving…" : "Approve"}
                </button>
              </div>
            </div>
          </div>
        )}

        {!selected ? (
          <div style={{ flex: 1 }}>
            {!loading && pipelines.length === 0 ? (
              <EmptyState
                icon="⬡"
                title="No pipelines"
                description="Connect a repository to auto-generate promotion pipelines."
                ctaLabel="Connect GitHub"
                onCta={onGoToConnectors}
              />
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, height: "100%" }}>
                <div style={{ fontSize: 32, color: "#222" }}>⬡</div>
                <div style={{ color: "#555", fontSize: 14 }}>Select a pipeline or create a new one</div>
                <button onClick={() => setCreating(true)} style={{ marginTop: 8, padding: "8px 18px", background: "#10b981", border: "none", borderRadius: 4, color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  + New Pipeline
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{selected.name}</div>
                {selected.description && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{selected.description}</div>}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 11, color: "#555", padding: "3px 8px", background: "#111", borderRadius: 12, border: "1px solid #1a1a1a" }}>
                  {selected.status}
                </div>
                <button
                  onClick={() => void fetchPipeline(selected.id)}
                  style={{ padding: "4px 10px", background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4, color: "#888", fontSize: 11, cursor: "pointer" }}
                >
                  ↻ Refresh
                </button>
                <button
                  onClick={() => void deletePipeline(selected.id)}
                  style={{ padding: "4px 10px", background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4, color: "#555", fontSize: 11, cursor: "pointer" }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Promotion lanes */}
            <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
              <div style={{ display: "flex", gap: 0, alignItems: "flex-start", minWidth: "max-content" }}>
                {layout.map((item, idx) => {
                  if (item.type === "gate" && item.gate) {
                    const gate = item.gate;
                    const gateStatus = gate.run?.status;
                    // Find prev env
                    const prevItem = layout[idx - 1];
                    const prevEnvDone = prevItem?.type === "env" && prevItem.env ? envDone(prevItem.env) : false;

                    return (
                      <div key={gate.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 8px", minHeight: 240, gap: 8 }}>
                        {gateStatus === "waiting" ? (
                          <button
                            onClick={() => void initiateApprove(selected.id, gate.id)}
                            style={{ padding: "8px 14px", background: "#8b5cf6", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                          >
                            ✓ Approve
                          </button>
                        ) : gateStatus === "approved" || gateStatus === "done" ? (
                          <div style={{ color: "#10b981", fontSize: 18 }}>→</div>
                        ) : prevEnvDone ? (
                          <button
                            onClick={() => void runStage(selected.id, gate.id)}
                            disabled={!!runningStage}
                            style={{ padding: "8px 14px", background: "#f59e0b", border: "none", borderRadius: 6, color: "#000", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: runningStage ? 0.5 : 1 }}
                          >
                            {gate.name}
                          </button>
                        ) : (
                          <div style={{ color: "#333", fontSize: 18 }}>→</div>
                        )}
                        <div style={{ fontSize: 10, color: "#444", textAlign: "center" }}>
                          {gateStatus === "waiting" ? "Pending approval" : gateStatus === "approved" ? "Promoted" : "Gate"}
                        </div>
                      </div>
                    );
                  }

                  if (item.type === "env" && item.env) {
                    const env = item.env;
                    const isDone = envDone(env);
                    const hasFailed = envHasFailed(env);
                    const nextItem = layout[idx + 1];
                    const nextGateWaiting = nextItem?.type === "gate" && nextItem.gate?.run?.status === "waiting";

                    return (
                      <div key={env.id} style={{ minWidth: 200, maxWidth: 220 }}>
                        {/* Env header */}
                        <div style={{
                          padding: "10px 14px",
                          background: "#0a0a0a",
                          border: `1px solid ${env.color}33`,
                          borderBottom: "none",
                          borderRadius: "6px 6px 0 0",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: hasFailed ? "#ef4444" : isDone ? "#10b981" : env.color, opacity: isDone || hasFailed ? 1 : 0.4 }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: env.color }}>{env.label}</span>
                          </div>
                          <button
                            onClick={() => void runEnvSequential(selected.id, env)}
                            disabled={!!runningStage || isDone}
                            style={{
                              padding: "2px 8px",
                              background: isDone ? "transparent" : "#111",
                              border: `1px solid ${isDone ? "#333" : env.color + "44"}`,
                              borderRadius: 3,
                              color: isDone ? "#333" : env.color,
                              fontSize: 10,
                              cursor: isDone ? "default" : "pointer",
                              opacity: runningStage ? 0.5 : 1,
                            }}
                          >
                            {isDone ? "✓ Done" : "▶ Run all"}
                          </button>
                        </div>

                        {/* Stages */}
                        <div style={{ border: `1px solid ${env.color}22`, borderTop: `1px solid ${env.color}33`, borderRadius: "0 0 6px 6px", overflow: "hidden" }}>
                          {env.stages.map((stage, si) => {
                            const stageStatus = stage.run?.status;
                            const isRunning = runningStage === stage.id;
                            const isActive = activeLogStage === stage.id;
                            const output = stage.run?.output as Record<string, unknown> | undefined;

                            return (
                              <div
                                key={stage.id}
                                style={{
                                  padding: "10px 14px",
                                  borderBottom: si < env.stages.length - 1 ? "1px solid #111" : "none",
                                  background: isActive ? "#0e0e0e" : "transparent",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 8,
                                }}
                                onClick={() => {
                                  setActiveLogStage(stage.id);
                                  // If there's no log entry yet, start one
                                  if (!logs.find(l => l.stageId === stage.id)) {
                                    if (stageStatus) setLogs(prev => [...prev, { stageId: stage.id, lines: [`Status: ${stageStatus}`, ...(output?.["summary"] ? [output["summary"] as string] : [])] }]);
                                  }
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                                  <span style={{ fontSize: 13, color: statusColor(stageStatus), flexShrink: 0 }}>
                                    {isRunning ? "◌" : statusIcon(stageStatus)}
                                  </span>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 12, color: stageStatus ? "#e5e5e5" : "#555" }}>{stage.name}</div>
                                    {typeof output?.["summary"] === "string" && (
                                      <div style={{ fontSize: 10, color: "#444", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                                        {output["summary"]}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <button
                                  onClick={e => { e.stopPropagation(); void runStage(selected.id, stage.id); }}
                                  disabled={!!runningStage || stageStatus === "done"}
                                  style={{
                                    padding: "2px 8px",
                                    background: "transparent",
                                    border: "1px solid #222",
                                    borderRadius: 3,
                                    color: stageStatus === "done" ? "#333" : "#888",
                                    fontSize: 10,
                                    cursor: stageStatus === "done" || runningStage ? "default" : "pointer",
                                    flexShrink: 0,
                                    opacity: runningStage && !isRunning ? 0.4 : 1,
                                  }}
                                >
                                  {isRunning ? "…" : stageStatus === "done" ? "✓" : "▶"}
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* Promote button — shown when env is done and there's a gate next */}
                        {isDone && nextGateWaiting && (
                          <div style={{ marginTop: 8, padding: "0 4px" }}>
                            <div style={{ fontSize: 10, color: "#8b5cf6", textAlign: "center", padding: "4px 0" }}>Awaiting gate approval →</div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  return null;
                })}
              </div>

              {/* Log pane */}
              {activeLogs.length > 0 && (
                <div style={{ marginTop: 24, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ padding: "8px 14px", borderBottom: "1px solid #1a1a1a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#555" }}>{activeLogStage}</span>
                    <button onClick={() => setActiveLogStage(null)} style={{ background: "transparent", border: "none", color: "#444", cursor: "pointer", fontSize: 14 }}>×</button>
                  </div>
                  <div ref={logsRef} style={{ padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "#e5e5e5", maxHeight: 200, overflowY: "auto", lineHeight: "1.6" }}>
                    {activeLogs.map((line, i) => (
                      <div key={i} style={{ color: line.startsWith("✓") ? "#10b981" : line.startsWith("✗") ? "#ef4444" : line.startsWith("⏸") ? "#8b5cf6" : "#888" }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
