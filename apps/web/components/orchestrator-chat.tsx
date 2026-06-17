"use client";
import { useState, useEffect, useRef, useCallback } from "react";

interface AgentActivity {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  detail: string;
  startDelay: number;
  duration: number;
}

interface ScenarioSuggestion {
  id: string;
  label: string;
  color: string;
  query: string;
}

const SCENARIO_SUGGESTIONS: ScenarioSuggestion[] = [
  { id: 'scenario-deploy', label: 'Deploy Check', color: '#10b981', query: 'Check recent deploys for issues' },
  { id: 'scenario-alert',  label: 'Alert Triage',  color: '#ef4444', query: 'What alerts are firing right now?' },
  { id: 'scenario-pr',     label: 'PR Summary',    color: '#3b82f6', query: 'Review recent PRs for potential issues' },
];
import { ProviderConfig } from "@/components/provider-config";

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
  gateId?: string;
  gateStatus?: "pending" | "approved" | "rejected";
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

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function parseMarkdown(text: string): string {
  // XSS guard: escape HTML before markdown substitutions — code blocks and inline code
  // have their content pre-escaped; markdown patterns run on escaped text
  const escaped = escapeHtml(text)
  return escaped
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

function MessageBlock({ message, onApproveGate }: { message: Message; onApproveGate?: (gateId: string) => void }) {
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
      {message.gateId && message.gateStatus === 'pending' && onApproveGate && (
        <div style={{ marginTop: 8, paddingLeft: 2 }}>
          <button
            onClick={() => onApproveGate(message.gateId!)}
            style={{
              padding: '6px 16px',
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'monospace',
            }}
          >
            ✓ Approve
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onScenario }: { onScenario: (s: ScenarioSuggestion) => void }) {
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
          <span style={{ fontSize: "9px", color: "#333", fontFamily: "monospace", letterSpacing: "0.12em" }}>QUICK ACTIONS</span>
          <div style={{ flex: 1, height: "1px", background: "#111" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          {SCENARIO_SUGGESTIONS.map(s => (
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
                  fontSize: "9px", color: s.color,
                  background: `${s.color}18`,
                  border: `1px solid ${s.color}33`,
                  borderRadius: "3px", padding: "0 5px", fontFamily: "monospace",
                }}>{s.label}</span>
              </div>
              <div style={{ fontSize: "11px", color: "#555", lineHeight: "1.4", fontFamily: "monospace" }}>{s.query}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  preview?: string;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function OrchestratorChat({ initialContext, onNavigate, onFirstMessage }: { initialContext?: OrchestratorContext; onNavigate?: (view: string) => void; onFirstMessage?: () => void }) {
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
  const [showSettings, setShowSettings] = useState(false);
  const [noProvider, setNoProvider] = useState(false);
  const [userEmail, setUserEmail] = useState("—");
  const [workspaceName, setWorkspaceName] = useState("—");
  const [rightTab, setRightTab] = useState<'trace' | 'sessions'>('trace');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastFiredContextRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string>(`session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const toolNamesRef = useRef(new Map<string, string>());

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logLines]);
  useEffect(() => () => timeoutsRef.current.forEach(clearTimeout), []);

  useEffect(() => { setActiveSessionId(sessionIdRef.current); }, []);

  const refreshSessions = useCallback(() => {
    fetch('/api/sessions')
      .then(r => r.ok ? r.json() as Promise<SessionSummary[]> : [])
      .then(data => { if (Array.isArray(data)) setSessions(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.ok ? r.json() as Promise<{ email: string; role: string; tenantId: string }> : null)
      .then(d => {
        if (d?.email) setUserEmail(d.email)
        if (d?.role) setCurrentAuthRole(d.role)
      })
      .catch(() => {})
    fetch("/api/settings/workspace")
      .then(r => r.ok ? r.json() as Promise<{ name: string }> : null)
      .then(d => { if (d?.name) setWorkspaceName(d.name) })
      .catch(() => {})
    refreshSessions();
  }, [refreshSessions])

  function startNewSession() {
    if (isThinking) return;
    const newId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionIdRef.current = newId;
    setActiveSessionId(newId);
    setMessages([]);
    setLogLines([]);
    setAgentStates([]);
    setFollowUps([]);
    setConfidence(null);
    setContextSource(null);
    setGateRequired(null);
    setNoProvider(false);
  }

  async function loadSession(sessionId: string) {
    if (isThinking || sessionId === sessionIdRef.current) return;
    sessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    // Clear UI for loading state
    setMessages([]);
    setLogLines([]);
    setAgentStates([]);
    setFollowUps([]);
    setConfidence(null);
    setContextSource(null);
    setGateRequired(null);
    setNoProvider(false);
    // Restore turns from DB
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`);
      if (res.ok) {
        const body = await res.json() as { data?: Array<{ id: string; role: string; content: string; createdAt: string }> };
        if (Array.isArray(body.data) && body.data.length > 0) {
          setMessages(body.data.map(t => ({ id: t.id, role: t.role as 'user' | 'assistant', content: t.content })));
        }
      }
    } catch { /* turns may be unavailable if session is fresh */ }
  }

  useEffect(() => {
    if (initialContext && initialContext.query !== lastFiredContextRef.current) {
      lastFiredContextRef.current = initialContext.query;
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
    onFirstMessage?.();
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setFollowUps([]);
    setLogLines([]);
    setConfidence(null);
    setIsThinking(true);
    setGateRequired(null);
    setNoProvider(false);
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: "user", content: text }]);

    const respId = `resp-${Date.now()}`;
    const startTime = Date.now();
    setMessages(prev => [...prev, {
      id: respId, role: "assistant", content: "", streaming: true,
    }]);
    setAgentStates([{ id: "orchestrator", name: "orchestrator", status: "running", detail: "analyzing", startDelay: 0, duration: 0, currentStatus: "running" }]);
    pushLog({ actor: "ANVAY", actorColor: "#10b981", text: "classifying intent", status: "running" });

    try {
      const sessionId = sessionIdRef.current;
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, sessionId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const ct = response.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        const d = await response.json() as { code?: string; error?: string }
        if (d.code === 'NO_PROVIDER') {
          setNoProvider(true)
          setMessages(prev => prev.filter(m => m.id !== respId))
          pushLog({ actor: 'SYSTEM', actorColor: '#f59e0b', text: 'No LLM provider configured', status: 'error' })
          setIsThinking(false)
          return
        }
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
            setMessages(prev => [...prev, {
              id: `gate-${event.gateId}`,
              role: "assistant",
              content: `🚦 Gate required: **${event.toolName}** — reply "approve" to proceed or "cancel" to abort\n\`\`\`json\n${JSON.stringify(event.args, null, 2)}\n\`\`\``,
              gateId: event.gateId,
              gateStatus: "pending",
            }]);
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
      refreshSessions();
    }
  }

  function handleSend() {
    if (!input.trim() || isThinking) return;
    const t = input.trim(); setInput(""); sendRealForm(t);
  }

  function handleApproveGate(gateId: string) {
    if (isThinking) return;
    setMessages(prev => prev.map(m =>
      m.gateId === gateId ? { ...m, gateStatus: 'approved' as const } : m
    ));
    setGateRequired(null);
    sendRealForm(`approve gate ${gateId}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function runScenario(scenario: ScenarioSuggestion) {
    if (isThinking) return;
    sendRealForm(scenario.query);
  }

  const isEmpty = messages.length === 0;

  return (
    <div style={{ display: "flex", height: "100%", background: "#050505", overflow: "hidden", position: "relative" }}>
      <ProviderConfig />
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
          <span style={{ fontSize: "10px", color: "#333", fontFamily: "monospace" }}>anvay</span>

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
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowSettings(!showSettings)}
                style={{
                  background: "transparent", border: "none", color: "#555", cursor: "pointer",
                  fontSize: "11px", fontFamily: "monospace", padding: "2px",
                }}
                title="Provider settings"
              >⚙</button>
              {showSettings && (
                <div style={{
                  position: "absolute", top: "100%", right: 0, zIndex: 100,
                  width: "300px", background: "#0e0e0e", border: "1px solid #1a1a1a",
                  borderRadius: "6px", padding: "16px", marginTop: "6px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)", fontSize: "11px", fontFamily: "monospace",
                }}>
                  <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", marginBottom: "8px" }}>
                    Provider Settings
                  </div>
                  <div style={{ color: "#10b981", marginBottom: "12px" }}>
                    ● configured
                  </div>
                  <button onClick={() => setShowSettings(false)}
                    style={{
                      background: "transparent", border: "1px solid #1a1a1a", color: "#555",
                      padding: "6px 12px", borderRadius: "4px", fontSize: "10px", fontFamily: "monospace", cursor: "pointer",
                    }}
                  >
                    Reconfigure
                  </button>
                </div>
              )}
            </div>
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
              {messages.map(msg => <MessageBlock key={msg.id} message={msg} onApproveGate={handleApproveGate} />)}
              {noProvider && (
                <div style={{
                  margin: "16px 0", padding: "14px 16px",
                  background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.3)",
                  borderRadius: "8px", display: "flex", alignItems: "center", gap: "12px",
                }}>
                  <span style={{ fontSize: "18px", flexShrink: 0 }}>&#9881;</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "12px", color: "#f59e0b", fontWeight: 600, marginBottom: "4px" }}>
                      No AI model configured
                    </div>
                    <div style={{ fontSize: "11px", color: "#888" }}>
                      Configure a model in Settings &rarr; Models
                    </div>
                  </div>
                  <button
                    onClick={() => { setNoProvider(false); onNavigate?.('models'); }}
                    style={{
                      padding: "5px 12px", background: "rgba(245,158,11,0.15)",
                      border: "1px solid rgba(245,158,11,0.3)", borderRadius: "4px",
                      color: "#f59e0b", fontSize: "11px", cursor: "pointer", fontFamily: "monospace",
                    }}
                  >
                    Configure
                  </button>
                </div>
              )}
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
              {SCENARIO_SUGGESTIONS.map(s => (
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

      {/* Right: sessions + trace */}
      <div style={{ width: "310px", flexShrink: 0, display: "flex", flexDirection: "column", background: "#030303", borderLeft: "1px solid #0e0e0e" }}>
        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid #0e0e0e", flexShrink: 0 }}>
          {(['sessions', 'trace'] as const).map(tab => (
            <button key={tab} onClick={() => setRightTab(tab)} style={{
              flex: 1, padding: "9px 0", background: "transparent", border: "none",
              borderBottom: rightTab === tab ? "1px solid #10b981" : "1px solid transparent",
              color: rightTab === tab ? "#10b981" : "#222",
              fontSize: "9px", fontFamily: "monospace", textTransform: "uppercase",
              letterSpacing: "0.1em", cursor: "pointer",
            }}>{tab}</button>
          ))}
        </div>

        {rightTab === 'sessions' && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #080808", flexShrink: 0 }}>
              <button onClick={startNewSession} disabled={isThinking}
                style={{
                  width: "100%", padding: "7px 0", background: "rgba(16,185,129,0.07)",
                  border: "1px solid rgba(16,185,129,0.15)", borderRadius: "4px",
                  color: "#10b981", fontSize: "10px", fontFamily: "monospace",
                  cursor: isThinking ? "not-allowed" : "pointer", opacity: isThinking ? 0.4 : 1,
                }}
                onMouseEnter={e => { if (!isThinking) e.currentTarget.style.background = "rgba(16,185,129,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(16,185,129,0.07)"; }}
              >+ new session</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
              <div style={{ fontSize: "9px", color: "#1a1a1a", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>active</div>
              <div style={{ padding: "8px 10px", background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.12)", borderRadius: "3px", marginBottom: "14px" }}>
                <div style={{ fontSize: "10px", color: "#10b981", fontFamily: "monospace", marginBottom: "2px" }}>current</div>
                <div style={{ fontSize: "9px", color: "#333", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeSessionId.slice(0, 28)}&hellip;</div>
                <div style={{ fontSize: "9px", color: "#1a1a1a", fontFamily: "monospace", marginTop: "2px" }}>{messages.filter(m => m.role === "user").length} turns</div>
              </div>
              <div style={{ fontSize: "9px", color: "#1a1a1a", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>history</div>
              {sessions.length === 0 ? (
                <div style={{ fontSize: "10px", color: "#111", fontFamily: "monospace" }}>no sessions yet_</div>
              ) : sessions.map(s => {
                const isCurrent = s.id === activeSessionId;
                return (
                  <button key={s.id} onClick={() => { loadSession(s.id); setRightTab("trace"); }}
                    disabled={isThinking}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "8px 10px", marginBottom: "4px",
                      background: isCurrent ? "rgba(16,185,129,0.05)" : "transparent",
                      border: isCurrent ? "1px solid rgba(16,185,129,0.12)" : "1px solid #0e0e0e",
                      borderRadius: "3px", cursor: isThinking ? "not-allowed" : "pointer", opacity: isThinking ? 0.5 : 1,
                    }}
                    onMouseEnter={e => { if (!isThinking && !isCurrent) e.currentTarget.style.borderColor = "#1a1a1a"; }}
                    onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.borderColor = "#0e0e0e"; }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                      <span style={{ fontSize: "9px", color: isCurrent ? "#10b981" : "#333", fontFamily: "monospace" }}>{formatRelativeTime(s.updatedAt)}</span>
                      <span style={{ fontSize: "9px", color: "#1a1a1a", fontFamily: "monospace" }}>{s.turnCount}t</span>
                    </div>
                    <div style={{ fontSize: "9px", color: "#222", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.preview ? s.preview.slice(0, 60) : s.id.slice(0, 28)}&hellip;</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {rightTab === "trace" && (
          <>


        {/* Context */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #080808" }}>
          {[
            ["user", userEmail || "—", "#444"],
            ["auth", currentAuthRole + (currentAuthRole !== currentInferredRole ? ` \u2192 ${currentInferredRole}` : ""), ROLE_COLORS[currentAuthRole] || "#444"],
            ["workspace", workspaceName || "—", "#333"],
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
          </>
        )}
      </div>
    </div>
  );
}
