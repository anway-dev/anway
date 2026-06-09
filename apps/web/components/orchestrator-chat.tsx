"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { SCENARIOS, OrchestratorScenario, AgentActivity } from "@/lib/mock";

export interface OrchestratorContext {
  query: string;
  title: string;
  source: string;
}

type StreamEvent =
  | { type: "text_delta"; content: string }
  | { type: "tool_call"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolCallId: string; result: unknown }
  | { type: "gate_required"; gateId: string; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "done"; inputTokens: number; outputTokens: number; groundingSources?: { source: string; fetchedAt: string; confidence: number; freshness: number }[] }
  | { type: "error"; code: string; message: string };

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  authRole?: string;
  inferredRole?: string;
  durationMs?: number;
  sources?: string[];
  confidence?: number;
  inputTokens?: number;
  outputTokens?: number;
  staleWarning?: string;
}

interface LogLine {
  id: string;
  ts: string;
  actor: string;
  actorColor: string;
  text: string;
  status?: "running" | "done" | "error" | "info";
  ms?: number;
}

interface AgentState extends AgentActivity {
  currentStatus: "pending" | "running" | "done" | "error";
}

const ROLE_COLORS: Record<string, string> = {
  dev: "#3b82f6", sre: "#ef4444", pm: "#8b5cf6",
  ba: "#f59e0b", admin: "#10b981", system: "#444",
};

const AGENT_COLORS: Record<string, string> = {
  "orchestrator": "#10b981", "datadog-agent": "#7c3aed", "loki-agent": "#f9a825",
  "k8s-agent": "#f59e0b", "github-agent": "#aaa", "linear-agent": "#5e6ad2",
  "argocd-agent": "#f97316", "test-agent": "#3b82f6", "repo-agent": "#06b6d4",
  "perimeter": "#10b981", "audit": "#333",
};

const CONNECTORS_ONLINE = ["github", "linear", "datadog", "argocd", "coralogix", "notion", "eks"];
const CONNECTOR_COLORS: Record<string, string> = {
  github: "#aaa", linear: "#5e6ad2", datadog: "#7c3aed",
  argocd: "#f97316", coralogix: "#06b6d4", notion: "#e5e5e5", eks: "#f59e0b",
};

function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}.${String(d.getMilliseconds()).padStart(3,"0")}`;
}

function parseMarkdown(text: string): string {
  return text
    .replace(/```([\s\S]*?)```/g, '<pre style="display:block;background:#030303;border:1px solid #1a1a1a;border-left:2px solid #10b98166;border-radius:3px;padding:10px 12px;margin:8px 0;font-family:monospace;font-size:11px;color:#c9c9c9;white-space:pre-wrap">$1</pre>')
    .replace(/`([^`]+)`/g, '<code style="background:#0e0e0e;border:1px solid #2a2a2a;border-radius:3px;padding:1px 5px;font-family:monospace;font-size:11px;color:#10b981">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#e5e5e5;font-weight:700">$1</strong>')
    .replace(/\n→/g, '<br/><span style="color:#10b98188">→</span>')
    .replace(/\n/g, '<br/>');
}

function LogEntry({ line, idx }: { line: LogLine; idx: number }) {
  return (
    <div style={{
      display: "flex", gap: "8px", padding: "1px 0",
      fontFamily: "monospace", fontSize: "10px", lineHeight: "1.6",
      animation: "fadeIn 0.15s ease-out",
      animationDelay: `${idx * 0.02}s`, animationFillMode: "both",
    }}>
      <span style={{ color: "#222", flexShrink: 0, minWidth: "76px" }}>{line.ts}</span>
      <span style={{
        color: line.actorColor, flexShrink: 0, minWidth: "72px",
        opacity: line.status === "info" ? 0.5 : 1,
      }}>
        {line.actor}
      </span>
      <span style={{
        color: line.status === "done" ? "#555"
          : line.status === "error" ? "#ef4444"
          : line.status === "info" ? "#333"
          : "#888",
        flex: 1,
      }}>
        {line.status === "done" && <span style={{ color: "#10b981" }}>✓ </span>}
        {line.status === "error" && <span style={{ color: "#ef4444" }}>✗ </span>}
        {line.text}
        {line.ms !== undefined && <span style={{ color: "#333" }}> {line.ms}ms</span>}
      </span>
    </div>
  );
}

function MessageBlock({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "baseline", gap: "10px" }}>
        <span style={{ color: "#10b981", fontFamily: "monospace", fontSize: "12px", flexShrink: 0 }}>›</span>
        <div style={{ flex: 1 }}>
          {message.authRole && (
            <span style={{
              fontSize: "9px", color: ROLE_COLORS[message.authRole] || "#888",
              background: `${ROLE_COLORS[message.authRole]}18`,
              border: `1px solid ${ROLE_COLORS[message.authRole]}33`,
              borderRadius: "3px", padding: "0 5px", marginRight: "8px",
              fontFamily: "monospace",
            }}>
              {message.authRole}
              {message.authRole !== message.inferredRole && (
                <span style={{ color: "#333" }}> → <span style={{ color: ROLE_COLORS[message.inferredRole || ""] }}>{message.inferredRole}</span></span>
              )}
            </span>
          )}
          <span style={{ fontSize: "13px", color: "#e5e5e5" }}>{message.content}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "24px" }}>
      {/* Response header bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        paddingBottom: "8px", marginBottom: "10px",
        borderBottom: "1px solid #111",
      }}>
        <span style={{
          fontSize: "10px", color: "#10b981", fontWeight: 700,
          fontFamily: "monospace", letterSpacing: "0.08em",
        }}>✦ ANVAY</span>
        <span style={{ flex: 1, height: "1px", background: "transparent" }} />
        {message.confidence !== undefined && (
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "40px", height: "2px", background: "#111", borderRadius: "1px", overflow: "hidden" }}>
              <div style={{ width: `${message.confidence * 100}%`, height: "100%", background: message.confidence >= 0.9 ? "#10b981" : "#f59e0b" }} />
            </div>
            <span style={{ fontSize: "9px", color: message.confidence >= 0.9 ? "#10b981" : "#f59e0b", fontFamily: "monospace" }}>
              {message.confidence.toFixed(2)}
            </span>
          </div>
        )}
        {message.durationMs && (
          <span style={{ fontSize: "9px", color: "#333", fontFamily: "monospace" }}>{(message.durationMs / 1000).toFixed(1)}s</span>
        )}
        {message.inputTokens !== undefined && message.outputTokens !== undefined && (
          <span style={{ fontSize: "9px", color: "#222", fontFamily: "monospace" }}>
            {message.inputTokens + message.outputTokens}t
          </span>
        )}
        {message.sources && message.sources.length > 0 && (
          <div style={{ display: "flex", gap: "3px" }}>
            {message.sources.map(s => (
              <div key={s} title={s} style={{
                width: "6px", height: "6px", borderRadius: "50%",
                background: CONNECTOR_COLORS[s] || "#333",
              }} />
            ))}
          </div>
        )}
        {message.staleWarning && (
          <span style={{ fontSize: "9px", color: "#f59e0b", fontFamily: "monospace" }}>⚠ {message.staleWarning}</span>
        )}
      </div>
      {/* Response body */}
      <div style={{ fontSize: "13px", lineHeight: "1.9", color: "#b0b0b0", paddingLeft: "2px" }}>
        {message.streaming && message.content === "" ? (
          <span style={{ color: "#333", fontFamily: "monospace" }}>
            processing<span style={{ animation: "blink 0.8s step-end infinite" }}>_</span>
          </span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: parseMarkdown(message.content) }} />
        )}
        {message.streaming && message.content !== "" && (
          <span style={{
            display: "inline-block", width: "2px", height: "13px",
            background: "#10b981", marginLeft: "1px", verticalAlign: "middle",
            animation: "blink 0.8s step-end infinite",
          }} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ onScenario }: { onScenario: (s: OrchestratorScenario) => void }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", gap: "28px", padding: "24px",
      background: "radial-gradient(ellipse at 50% 40%, rgba(16,185,129,0.04) 0%, transparent 65%)",
    }}>
      {/* Hero */}
      <div style={{ textAlign: "center", position: "relative" }}>
        {/* Rings */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: "120px", height: "120px", borderRadius: "50%",
          border: "1px solid rgba(16,185,129,0.06)",
          animation: "ring-expand 3s ease-out infinite",
        }} />
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: "80px", height: "80px", borderRadius: "50%",
          border: "1px solid rgba(16,185,129,0.1)",
          animation: "ring-expand 3s ease-out 1s infinite",
        }} />
        {/* Core */}
        <div style={{
          width: "52px", height: "52px", borderRadius: "13px",
          background: "rgba(16,185,129,0.06)",
          border: "1px solid rgba(16,185,129,0.18)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "22px", margin: "0 auto 14px",
          boxShadow: "0 0 30px rgba(16,185,129,0.08), inset 0 0 20px rgba(16,185,129,0.03)",
        }}>✦</div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#e5e5e5", marginBottom: "5px", fontFamily: "monospace", letterSpacing: "0.06em" }}>
          ANVAY
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
          <span style={{ fontSize: "10px", color: "#444", fontFamily: "monospace" }}>
            ALL SYSTEMS OPERATIONAL · {CONNECTORS_ONLINE.length} CONNECTORS
          </span>
        </div>
      </div>

      {/* Connector row */}
      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", justifyContent: "center", maxWidth: "320px" }}>
        {CONNECTORS_ONLINE.map(c => (
          <div key={c} style={{
            display: "flex", alignItems: "center", gap: "4px",
            background: "#0a0a0a", border: "1px solid #111", borderRadius: "3px", padding: "3px 7px",
          }}>
            <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: CONNECTOR_COLORS[c] || "#10b981" }} />
            <span style={{ fontSize: "9px", color: "#333", fontFamily: "monospace" }}>{c}</span>
          </div>
        ))}
      </div>

      {/* Scenarios */}
      <div style={{ width: "100%", maxWidth: "520px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <div style={{ flex: 1, height: "1px", background: "#111" }} />
          <span style={{ fontSize: "9px", color: "#333", fontFamily: "monospace", letterSpacing: "0.12em" }}>SCENARIOS</span>
          <div style={{ flex: 1, height: "1px", background: "#111" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          {SCENARIOS.map(s => (
            <button
              key={s.id}
              onClick={() => onScenario(s)}
              style={{
                background: "#080808", border: "1px solid #111", borderRadius: "5px",
                padding: "11px 13px", cursor: "pointer", textAlign: "left", transition: "all 0.15s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "rgba(16,185,129,0.2)";
                e.currentTarget.style.background = "#0a0a0a";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "#111";
                e.currentTarget.style.background = "#080808";
              }}
            >
              <div style={{ marginBottom: "5px" }}>
                <span style={{
                  fontSize: "9px", color: ROLE_COLORS[s.inferredRole] || "#888",
                  background: `${ROLE_COLORS[s.inferredRole]}18`,
                  border: `1px solid ${ROLE_COLORS[s.inferredRole]}33`,
                  borderRadius: "3px", padding: "0 5px", fontFamily: "monospace",
                }}>{s.inferredRole}</span>
              </div>
              <div style={{ fontSize: "11px", color: "#555", lineHeight: "1.4", fontFamily: "monospace" }}>{s.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OrchestratorChat({ initialContext }: { initialContext?: OrchestratorContext }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [agentStates, setAgentStates] = useState<AgentState[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [currentAuthRole, setCurrentAuthRole] = useState("dev");
  const [currentInferredRole, setCurrentInferredRole] = useState("dev");
  const [contextSource, setContextSource] = useState<{ title: string; source: string } | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [gateRequired, setGateRequired] = useState<{ gateId: string; toolCallId: string; toolName: string; args: Record<string, unknown> } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const firedInitialContext = useRef(false);
  const sessionIdRef = useRef<string>(`session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const toolNamesRef = useRef(new Map<string, string>());

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logLines]);
  useEffect(() => () => timeoutsRef.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (initialContext && !firedInitialContext.current) {
      firedInitialContext.current = true;
      setContextSource({ title: initialContext.title, source: initialContext.source });
      sendRealForm(initialContext.query);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContext]);

  function addTimeout(fn: () => void, ms: number) {
    const t = setTimeout(fn, ms);
    timeoutsRef.current.push(t);
    return t;
  }

  function pushLog(line: Omit<LogLine, "id" | "ts">) {
    setLogLines(prev => [...prev, { ...line, id: `log-${Date.now()}-${Math.random()}`, ts: now() }]);
  }

  async function sendRealForm(text: string) {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setFollowUps([]);
    setLogLines([]);
    setConfidence(null);
    setIsThinking(true);
    setGateRequired(null);
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: "user", content: text }]);

    const respId = `resp-${Date.now()}`;
    const startTime = Date.now();
    setMessages(prev => [...prev, {
      id: respId, role: "assistant", content: "", streaming: true,
    }]);
    setAgentStates([{ id: "orchestrator", name: "orchestrator", status: "running", detail: "analyzing", startDelay: 0, duration: 0, currentStatus: "running" }]);
    pushLog({ actor: "ANVAY", actorColor: "#10b981", text: "classifying intent", status: "running" });

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, sessionId: sessionIdRef.current }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      pushLog({ actor: "PERIMETER", actorColor: "#10b981", text: "resolving envelope", status: "running" });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(data) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === 'text_delta') {
            setMessages(prev => prev.map(m =>
              m.id === respId
                ? { ...m, content: (m.content || '') + event.content }
                : m
            ));
          } else if (event.type === 'tool_call') {
            toolNamesRef.current.set(event.toolCallId, event.toolName);
            const label = event.toolName.replace('-agent', '').toUpperCase().slice(0, 6);
            const color = AGENT_COLORS[event.toolName] || "#888";
            setAgentStates(prev => [...prev.filter(a => a.name !== event.toolName), {
              id: event.toolName,
              name: event.toolName,
              status: 'running',
              detail: event.toolName,
              startDelay: 0,
              duration: 0,
              currentStatus: 'running',
            }]);
            pushLog({ actor: label, actorColor: color, text: `${event.toolName}(${JSON.stringify(event.args).slice(0, 50)}...)`, status: 'running' });
          } else if (event.type === 'tool_result') {
            const toolName = toolNamesRef.current.get(event.toolCallId) ?? 'TOOL';
            const resultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result).slice(0, 100);
            pushLog({ actor: "TOOL", actorColor: "#555", text: `→ ${resultStr}...`, status: 'done', ms: 0 });
            setAgentStates(prev => prev.map(a => a.name === toolName ? { ...a, currentStatus: 'done' } : a));
          } else if (event.type === 'gate_required') {
            setGateRequired({ gateId: event.gateId, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
            pushLog({ actor: "GATE", actorColor: "#f59e0b", text: `${event.toolName} — awaiting approval`, status: 'running' });
          } else if (event.type === 'error') {
            pushLog({ actor: "ERROR", actorColor: "#ef4444", text: `${event.code}: ${event.message}`, status: 'error' });
            setMessages(prev => prev.map(m =>
              m.id === respId
                ? { ...m, content: (m.content || '') + `\n[Error: ${event.message}]`, streaming: false }
                : m
            ));
          } else if (event.type === 'done') {
            setAgentStates(prev => prev.map(a => ({ ...a, currentStatus: 'done' })));
            const staleSources = (event.groundingSources ?? []).filter(s => s.freshness < 0.5);
            const oldestFetch = staleSources.length > 0
              ? staleSources.reduce((oldest, s) => s.fetchedAt < oldest ? s.fetchedAt : oldest, staleSources[0].fetchedAt)
              : null;
            const staleWarning = oldestFetch
              ? `Based on data from ${new Date(oldestFetch).toLocaleTimeString()} · re-sync recommended`
              : undefined;
            setMessages(prev => prev.map(m =>
              m.id === respId
                ? {
                    ...m,
                    streaming: false,
                    durationMs: Date.now() - startTime,
                    inputTokens: event.inputTokens,
                    outputTokens: event.outputTokens,
                    staleWarning,
                  }
                : m
            ));
            setConfidence(0.9);
            pushLog({ actor: "CONF", actorColor: "#10b981", text: "0.90", status: 'done' });
            pushLog({ actor: "AUDIT", actorColor: "#333", text: `tokens:${event.inputTokens + event.outputTokens} · logged`, status: 'info' });
            pushLog({ actor: "ANVAY", actorColor: "#10b981", text: "complete", status: 'done' });
            setFollowUps(['Show active blockers', 'View payments incident', 'What should I fix first?']);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'connection error';
      pushLog({ actor: "ERROR", actorColor: "#ef4444", text: msg, status: 'error' });
      setMessages(prev => prev.map(m =>
        m.id === respId
          ? { ...m, content: `Connection error: ${msg}`, streaming: false }
          : m
      ));
    } finally {
      setIsThinking(false);
    }
  }

  function handleSend() {
    if (!input.trim() || isThinking) return;
    const t = input.trim(); setInput(""); sendRealForm(t);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function runScenario(scenario: OrchestratorScenario) {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setFollowUps([]);
    setLogLines([]);
    setConfidence(null);
    setIsThinking(true);
    setCurrentAuthRole(scenario.authRole);
    setCurrentInferredRole(scenario.inferredRole);

    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`, role: "user", content: scenario.query,
      authRole: scenario.authRole, inferredRole: scenario.inferredRole,
    }]);
    setAgentStates(scenario.agents.map(a => ({ ...a, currentStatus: "pending" })));

    const intentMap: Record<string, string> = { sre: "incident_triage", pm: "status_query", ba: "analytics_query", dev: "debug_query" };
    addTimeout(() => pushLog({ actor: "ANVAY", actorColor: "#10b981", text: "classifying intent", status: "running" }), 80);
    addTimeout(() => pushLog({ actor: "ANVAY", actorColor: "#10b981", text: `intent:${intentMap[scenario.inferredRole] || "general"} role:${scenario.inferredRole}`, status: "info" }), 420);
    addTimeout(() => pushLog({ actor: "PERIMETER", actorColor: "#10b981", text: `resolving envelope · ${scenario.authRole}→${scenario.inferredRole}`, status: "running" }), 600);
    addTimeout(() => pushLog({ actor: "PERIMETER", actorColor: "#10b981", text: `${scenario.agents.length} connectors scoped · write:gated`, status: "done" }), 900);

    const base = 1100;
    scenario.agents.forEach(agent => {
      const color = AGENT_COLORS[agent.name] || "#888";
      const label = agent.name.replace("-agent", "").toUpperCase().slice(0, 6);
      addTimeout(() => {
        setAgentStates(prev => prev.map(a => a.id === agent.id ? { ...a, currentStatus: "running" } : a));
        pushLog({ actor: label, actorColor: color, text: agent.detail, status: "running" });
      }, base + agent.startDelay);
      addTimeout(() => {
        setAgentStates(prev => prev.map(a => a.id === agent.id ? { ...a, currentStatus: "done" } : a));
        pushLog({ actor: label, actorColor: color, text: "complete", status: "done", ms: agent.duration });
      }, base + agent.startDelay + agent.duration);
    });

    const maxTime = Math.max(...scenario.agents.map(a => a.startDelay + a.duration)) + base;
    const conf = parseFloat((0.86 + Math.random() * 0.11).toFixed(2));

    addTimeout(() => pushLog({ actor: "ANVAY", actorColor: "#10b981", text: "aggregating", status: "running" }), maxTime + 80);
    addTimeout(() => {
      setConfidence(conf);
      pushLog({ actor: "CONF", actorColor: conf >= 0.9 ? "#10b981" : "#f59e0b", text: conf.toFixed(2), status: "done" });
      pushLog({ actor: "AUDIT", actorColor: "#333", text: `evt-${Math.floor(Math.random() * 900 + 100)} · logged`, status: "info" });
    }, maxTime + 380);

    addTimeout(() => {
      setIsThinking(false);
      const respId = `resp-${Date.now()}`;
      const sources = scenario.agents.map(a => a.name.replace("-agent", ""));
      setMessages(prev => [...prev, {
        id: respId, role: "assistant", content: "", streaming: true,
        authRole: scenario.authRole, inferredRole: scenario.inferredRole,
        sources, confidence: conf,
      }]);
      const words = scenario.response.split(" ");
      let acc = "";
      words.forEach((w, i) => {
        addTimeout(() => {
          acc += (i === 0 ? "" : " ") + w;
          const done = i === words.length - 1;
          setMessages(prev => prev.map(m => m.id === respId
            ? { ...m, content: acc, streaming: !done, durationMs: done ? maxTime + 380 + i * 30 : undefined }
            : m
          ));
          if (done) setFollowUps(scenario.followUps);
        }, i * 30);
      });
    }, maxTime + 480);
  }

  const isEmpty = messages.length === 0;

  return (
    <div style={{ display: "flex", height: "100%", background: "#050505", overflow: "hidden" }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes pulse-dot { 0%,100%{box-shadow:0 0 4px #10b981} 50%{box-shadow:0 0 12px #10b981} }
        @keyframes fadeIn { from{opacity:0;transform:translateX(-4px)} to{opacity:1;transform:translateX(0)} }
        @keyframes ring-expand { 0%{opacity:0.4;transform:translate(-50%,-50%) scale(0.8)} 100%{opacity:0;transform:translate(-50%,-50%) scale(1.6)} }
      `}</style>

      {/* Left: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Top bar */}
        <div style={{
          padding: "11px 20px", borderBottom: "1px solid #0e0e0e",
          display: "flex", alignItems: "center", gap: "10px", flexShrink: 0,
          background: "#080808",
        }}>
          <div style={{
            width: "6px", height: "6px", borderRadius: "50%", background: "#10b981",
            animation: isThinking ? "pulse-dot 1.2s ease-in-out infinite" : "none",
            boxShadow: "0 0 5px #10b981",
          }} />
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#10b981", fontFamily: "monospace", letterSpacing: "0.1em" }}>ANVAY</span>
          <span style={{ fontSize: "10px", color: "#222", fontFamily: "monospace" }}>·</span>
          <span style={{ fontSize: "10px", color: "#333", fontFamily: "monospace" }}>acme-platform</span>

          {contextSource && (
            <div style={{
              display: "flex", alignItems: "center", gap: "5px",
              background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)",
              borderRadius: "3px", padding: "2px 8px",
            }}>
              <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#ef4444" }} />
              <span style={{ fontSize: "9px", color: "#ef4444", fontFamily: "monospace" }}>via {contextSource.source}</span>
              <span style={{ fontSize: "9px", color: "#333", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {contextSource.title}</span>
            </div>
          )}

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
            {isThinking && (
              <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                {[0, 0.15, 0.3].map((delay, i) => (
                  <div key={i} style={{
                    width: "3px", height: "3px", borderRadius: "50%", background: "#10b981",
                    animation: `blink 1s step-end ${delay}s infinite`,
                  }} />
                ))}
              </div>
            )}
            <span style={{ fontSize: "9px", color: "#222", fontFamily: "monospace", background: "#0a0a0a", border: "1px solid #111", borderRadius: "3px", padding: "2px 7px" }}>
              {CONNECTORS_ONLINE.length} online
            </span>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: isEmpty ? "0" : "28px 28px 16px" }}>
          {isEmpty ? (
            <EmptyState onScenario={runScenario} />
          ) : (
            <>
              {messages.map(msg => <MessageBlock key={msg.id} message={msg} />)}
              {followUps.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "6px" }}>
                  {followUps.map(chip => (
                    <button
                      key={chip}
                      onClick={() => { setFollowUps([]); sendRealForm(chip); }}
                      style={{
                        background: "#080808", border: "1px solid #111", color: "#555",
                        padding: "4px 10px", borderRadius: "4px", fontSize: "10px",
                        cursor: "pointer", fontFamily: "monospace", transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(16,185,129,0.25)"; e.currentTarget.style.color = "#10b981"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#111"; e.currentTarget.style.color = "#555"; }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid #0e0e0e", flexShrink: 0, background: "#080808" }}>
          {!isEmpty && (
            <div style={{ display: "flex", gap: "5px", marginBottom: "8px", flexWrap: "wrap" }}>
              {SCENARIOS.map(s => (
                <button
                  key={s.id}
                  onClick={() => runScenario(s)}
                  style={{
                    background: "transparent", border: "1px solid #0e0e0e", color: "#333",
                    padding: "2px 8px", borderRadius: "3px", fontSize: "9px",
                    cursor: "pointer", fontFamily: "monospace", transition: "all 0.1s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#888"; e.currentTarget.style.borderColor = "#1a1a1a"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#333"; e.currentTarget.style.borderColor = "#0e0e0e"; }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ color: "#10b981", fontFamily: "monospace", fontSize: "12px", flexShrink: 0 }}>›</span>
            <div style={{
              flex: 1, background: "#0a0a0a",
              border: "1px solid #111",
              borderRadius: "5px", padding: "9px 12px",
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <span style={{
                fontSize: "9px", color: ROLE_COLORS[currentAuthRole] || "#888",
                background: `${ROLE_COLORS[currentAuthRole]}15`,
                border: `1px solid ${ROLE_COLORS[currentAuthRole]}30`,
                borderRadius: "3px", padding: "1px 5px", fontFamily: "monospace", flexShrink: 0,
              }}>{currentAuthRole}</span>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="ask anvay anything..."
                disabled={isThinking}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "#e5e5e5", fontSize: "12px", fontFamily: "monospace",
                }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              style={{
                background: input.trim() && !isThinking ? "rgba(16,185,129,0.12)" : "transparent",
                border: input.trim() && !isThinking ? "1px solid rgba(16,185,129,0.35)" : "1px solid #111",
                color: input.trim() && !isThinking ? "#10b981" : "#2a2a2a",
                padding: "9px 14px", borderRadius: "5px",
                cursor: input.trim() && !isThinking ? "pointer" : "not-allowed",
                fontSize: "12px", fontWeight: 700, transition: "all 0.15s",
              }}
            >↑</button>
          </div>
        </div>
      </div>

      {/* Right: execution trace */}
      <div style={{ width: "310px", flexShrink: 0, display: "flex", flexDirection: "column", background: "#030303", borderLeft: "1px solid #0e0e0e" }}>
        <div style={{ padding: "11px 14px", borderBottom: "1px solid #0e0e0e" }}>
          <span style={{ fontSize: "9px", color: "#222", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Execution Trace
          </span>
        </div>

        {/* Context */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #080808" }}>
          {[
            ["user", "alex@acme.dev", "#444"],
            ["auth", currentAuthRole + (currentAuthRole !== currentInferredRole ? ` → ${currentInferredRole}` : ""), ROLE_COLORS[currentAuthRole] || "#444"],
            ["workspace", "acme-platform", "#333"],
            ["scope", `${CONNECTORS_ONLINE.length} connectors`, "#333"],
          ].map(([k, v, c]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", fontFamily: "monospace", marginBottom: "2px" }}>
              <span style={{ color: "#222" }}>{k}</span>
              <span style={{ color: c as string }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Log */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
          {logLines.length === 0 ? (
            <div style={{ paddingTop: "16px", fontSize: "10px", color: "#1a1a1a", fontFamily: "monospace" }}>awaiting query_</div>
          ) : (
            logLines.map((line, i) => <LogEntry key={line.id} line={line} idx={i} />)
          )}
          <div ref={logEndRef} />
        </div>

        {/* Agent dots + confidence */}
        {agentStates.length > 0 && (
          <div style={{ padding: "10px 14px", borderTop: "1px solid #080808" }}>
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: confidence !== null ? "8px" : "0" }}>
              {agentStates.map(a => {
                const color = AGENT_COLORS[a.name] || "#333";
                return (
                  <div key={a.id} title={a.name} style={{
                    display: "flex", alignItems: "center", gap: "4px",
                    background: "#080808", border: "1px solid #0e0e0e", borderRadius: "3px", padding: "2px 6px",
                  }}>
                    <div style={{
                      width: "4px", height: "4px", borderRadius: "50%",
                      background: a.currentStatus === "done" ? color : a.currentStatus === "running" ? color : "#111",
                      opacity: a.currentStatus === "done" ? 0.6 : a.currentStatus === "running" ? 1 : 0.2,
                      boxShadow: a.currentStatus === "running" ? `0 0 5px ${color}` : "none",
                      animation: a.currentStatus === "running" ? "pulse-dot 1s ease-in-out infinite" : "none",
                    }} />
                    <span style={{ fontSize: "9px", color: "#222", fontFamily: "monospace" }}>
                      {a.name.replace("-agent", "")}
                    </span>
                  </div>
                );
              })}
            </div>
            {confidence !== null && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", fontFamily: "monospace", marginBottom: "3px" }}>
                  <span style={{ color: "#222" }}>confidence</span>
                  <span style={{ color: confidence >= 0.9 ? "#10b981" : "#f59e0b" }}>{confidence.toFixed(2)}</span>
                </div>
                <div style={{ height: "1px", background: "#0e0e0e", overflow: "hidden" }}>
                  <div style={{
                    width: `${confidence * 100}%`, height: "100%",
                    background: confidence >= 0.9 ? "#10b981" : "#f59e0b",
                    transition: "width 0.6s ease-out",
                  }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Gate required */}
        {gateRequired && (
          <div style={{
            padding: "10px 14px", borderTop: "1px solid #080808",
            background: "rgba(245, 158, 11, 0.05)",
          }}>
            <div style={{ fontSize: "9px", color: "#f59e0b", fontFamily: "monospace", marginBottom: "6px", fontWeight: 700 }}>
              ✦ GATE REQUIRED
            </div>
            <div style={{ fontSize: "10px", color: "#888", fontFamily: "monospace", marginBottom: "4px" }}>
              {gateRequired.toolName}
            </div>
            <div style={{ fontSize: "9px", color: "#444", fontFamily: "monospace" }}>
              {JSON.stringify(gateRequired.args)}
            </div>
            <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
              <button
                style={{
                  flex: 1, background: "rgba(245, 158, 11, 0.15)", border: "1px solid rgba(245, 158, 11, 0.3)",
                  color: "#f59e0b", padding: "5px 8px", borderRadius: "3px", fontSize: "9px",
                  cursor: "pointer", fontFamily: "monospace",
                }}
                onClick={() => {
                  const gate = gateRequired
                  if (!gate) return
                  setGateRequired(null)
                  fetch(`/api/gate/${gate.gateId}/decide`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ decision: 'approved' }),
                  }).catch(() => { /* gate decision failed silently — orchestrator will timeout */ })
                }}
              >
                Approve
              </button>
              <button
                style={{
                  flex: 1, background: "transparent", border: "1px solid #111",
                  color: "#444", padding: "5px 8px", borderRadius: "3px", fontSize: "9px",
                  cursor: "pointer", fontFamily: "monospace",
                }}
                onClick={() => {
                  const gate = gateRequired
                  if (!gate) return
                  setGateRequired(null)
                  fetch(`/api/gate/${gate.gateId}/decide`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ decision: 'rejected' }),
                  }).catch(() => { /* gate decision failed silently — orchestrator will timeout */ })
                }}
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
