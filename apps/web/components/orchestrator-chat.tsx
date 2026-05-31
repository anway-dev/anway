"use client";
import { useState, useEffect, useRef } from "react";
import { SCENARIOS, OrchestratorScenario, AgentActivity } from "@/lib/mock";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  authRole?: string;
  inferredRole?: string;
}

interface AgentState extends AgentActivity {
  currentStatus: "pending" | "running" | "done" | "error";
}

const ROLE_COLORS: Record<string, string> = {
  dev: "#3b82f6",
  sre: "#ef4444",
  pm: "#8b5cf6",
  ba: "#f59e0b",
  admin: "#10b981",
};

function parseMarkdown(text: string): string {
  return text
    .replace(/```([\s\S]*?)```/g, '<code style="display:block;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:4px;padding:8px 10px;margin:6px 0;font-family:monospace;font-size:11px;color:#e5e5e5;white-space:pre-wrap">$1</code>')
    .replace(/`([^`]+)`/g, '<code style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:3px;padding:1px 5px;font-family:monospace;font-size:11px;color:#10b981">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#e5e5e5;font-weight:700">$1</strong>')
    .replace(/\n→/g, '<br/>→')
    .replace(/\n/g, '<br/>');
}

function AgentBadge({ agent }: { agent: AgentState }) {
  const isRunning = agent.currentStatus === "running";
  const isDone = agent.currentStatus === "done";
  const color = isDone ? "#10b981" : isRunning ? "#3b82f6" : "#444";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "8px",
      padding: "8px 10px", background: "#0e0e0e", border: `1px solid ${isRunning ? "#1a2a3a" : "#1a1a1a"}`,
      borderRadius: "6px", marginBottom: "4px",
      transition: "all 0.3s",
    }}>
      <div style={{
        width: "7px", height: "7px", borderRadius: "50%", background: color, flexShrink: 0,
        boxShadow: isRunning ? "0 0 6px #3b82f6" : "none",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "11px", fontFamily: "monospace", color: isDone ? "#888" : isRunning ? "#d1d5db" : "#555" }}>
          {agent.name}
        </div>
        {(isRunning || isDone) && (
          <div style={{ fontSize: "10px", color: "#555", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {agent.detail}
          </div>
        )}
      </div>
      <div style={{ fontSize: "10px", color: color, flexShrink: 0 }}>
        {isDone ? "✓ done" : isRunning ? "running" : "waiting"}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div style={{
      display: "flex", justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: "16px", gap: "10px", alignItems: "flex-start",
    }}>
      {!isUser && (
        <div style={{
          width: "28px", height: "28px", borderRadius: "6px", background: "rgba(16,185,129,0.15)",
          border: "1px solid rgba(16,185,129,0.3)", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: "12px", flexShrink: 0, marginTop: "2px",
        }}>
          ✦
        </div>
      )}
      <div style={{ maxWidth: "75%", minWidth: 0 }}>
        {!isUser && message.authRole && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <span style={{ fontSize: "10px", color: "#555" }}>Orchestrator</span>
            {message.authRole !== message.inferredRole && (
              <span style={{ fontSize: "10px", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "3px", padding: "1px 5px", color: "#888" }}>
                auth: <span style={{ color: ROLE_COLORS[message.authRole] || "#888" }}>{message.authRole}</span>
                {" → inferred: "}
                <span style={{ color: ROLE_COLORS[message.inferredRole || ""] || "#888" }}>{message.inferredRole}</span>
              </span>
            )}
          </div>
        )}
        <div style={{
          background: isUser ? "#1a2a1a" : "#111",
          border: `1px solid ${isUser ? "rgba(16,185,129,0.2)" : "#1a1a1a"}`,
          borderRadius: isUser ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
          padding: "10px 14px",
          fontSize: "13px",
          lineHeight: "1.6",
          color: isUser ? "#d1d5db" : "#c9c9c9",
        }}>
          {isUser ? (
            <span>{message.content}</span>
          ) : (
            <span
              dangerouslySetInnerHTML={{ __html: parseMarkdown(message.content) }}
            />
          )}
          {message.streaming && (
            <span style={{ display: "inline-block", width: "2px", height: "14px", background: "#10b981", marginLeft: "2px", verticalAlign: "middle", animation: "blink 1s step-end infinite" }} />
          )}
        </div>
      </div>
      {isUser && (
        <div style={{
          width: "28px", height: "28px", borderRadius: "50%", background: "#1a2030",
          border: "1px solid #2a3a50", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: "10px", color: "#3b82f6", fontWeight: 700, flexShrink: 0,
        }}>
          AJ
        </div>
      )}
    </div>
  );
}

function FollowUpChips({ chips, onChip }: { chips: string[]; onChip: (chip: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px", paddingLeft: "38px" }}>
      {chips.map((chip) => (
        <button
          key={chip}
          onClick={() => onChip(chip)}
          style={{
            background: "transparent", border: "1px solid #2a2a2a", color: "#888",
            padding: "5px 10px", borderRadius: "6px", fontSize: "11px", cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.borderColor = "rgba(16,185,129,0.4)";
            (e.target as HTMLElement).style.color = "#10b981";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.borderColor = "#2a2a2a";
            (e.target as HTMLElement).style.color = "#888";
          }}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

function ScenarioButtons({ onScenario }: { onScenario: (s: OrchestratorScenario) => void }) {
  return (
    <div style={{ padding: "32px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px", flex: 1, justifyContent: "center" }}>
      <div style={{ textAlign: "center", marginBottom: "8px" }}>
        <div style={{ fontSize: "28px", marginBottom: "8px" }}>✦</div>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "#e5e5e5", marginBottom: "6px" }}>Ask Anvay anything</div>
        <div style={{ fontSize: "12px", color: "#555", maxWidth: "380px", lineHeight: "1.6" }}>
          One orchestrator. All your tools. No agent-picking.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", width: "100%", maxWidth: "560px" }}>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => onScenario(s)}
            style={{
              background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px",
              padding: "12px 14px", cursor: "pointer", textAlign: "left", color: "#888",
              fontSize: "12px", lineHeight: "1.4", transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = "#2a2a2a";
              el.style.color = "#d1d5db";
              el.style.background = "#111";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = "#1a1a1a";
              el.style.color = "#888";
              el.style.background = "#0e0e0e";
            }}
          >
            <div style={{ fontSize: "14px", marginBottom: "4px" }}>{s.emoji}</div>
            <div>{s.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OrchestratorChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentStates, setAgentStates] = useState<AgentState[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [currentAuthRole, setCurrentAuthRole] = useState("dev");
  const [currentInferredRole, setCurrentInferredRole] = useState("dev");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => timeoutsRef.current.forEach(clearTimeout);
  }, []);

  function addTimeout(fn: () => void, ms: number) {
    const t = setTimeout(fn, ms);
    timeoutsRef.current.push(t);
    return t;
  }

  function runScenario(scenario: OrchestratorScenario) {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setFollowUps([]);
    setIsThinking(true);
    setCurrentAuthRole(scenario.authRole);
    setCurrentInferredRole(scenario.inferredRole);

    const userMsgId = `user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: scenario.query },
    ]);

    const initAgents: AgentState[] = scenario.agents.map((a) => ({
      ...a,
      currentStatus: "pending",
    }));
    setAgentStates(initAgents);

    // routing message
    addTimeout(() => {
      const routingId = `routing-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: routingId,
          role: "assistant",
          content: "Orchestrator routing...",
          streaming: true,
          authRole: scenario.authRole,
          inferredRole: scenario.inferredRole,
        },
      ]);

      // replace routing with role inference after 1s
      addTimeout(() => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === routingId
              ? {
                  ...m,
                  content: `Context understood. Spinning ${scenario.agents.length} specialist agents...`,
                  streaming: false,
                }
              : m
          )
        );
        setIsThinking(false);

        // start agents sequentially
        scenario.agents.forEach((agent, idx) => {
          addTimeout(() => {
            setAgentStates((prev) =>
              prev.map((a) => (a.id === agent.id ? { ...a, currentStatus: "running" } : a))
            );
            addTimeout(() => {
              setAgentStates((prev) =>
                prev.map((a) => (a.id === agent.id ? { ...a, currentStatus: "done" } : a))
              );
            }, agent.duration);
          }, agent.startDelay);
        });

        // stream response after all agents done
        const maxAgentTime = Math.max(...scenario.agents.map((a) => a.startDelay + a.duration));
        addTimeout(() => {
          const respId = `resp-${Date.now()}`;
          setMessages((prev) => [
            ...prev,
            { id: respId, role: "assistant", content: "", streaming: true, authRole: scenario.authRole, inferredRole: scenario.inferredRole },
          ]);

          const words = scenario.response.split(" ");
          let accumulated = "";
          words.forEach((word, wIdx) => {
            addTimeout(() => {
              accumulated += (wIdx === 0 ? "" : " ") + word;
              const isFinal = wIdx === words.length - 1;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === respId
                    ? { ...m, content: accumulated, streaming: !isFinal }
                    : m
                )
              );
              if (isFinal) {
                setFollowUps(scenario.followUps);
              }
            }, wIdx * 35);
          });
        }, maxAgentTime + 400);
      }, 1000);
    }, 200);
  }

  function sendFreeForm(text: string) {
    setFollowUps([]);
    setIsThinking(true);
    const userMsgId = `user-${Date.now()}`;
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: text }]);
    setAgentStates([
      { id: "orchestrator", name: "orchestrator", status: "running", detail: "Analyzing intent and routing query", startDelay: 0, duration: 2000, currentStatus: "running" },
    ]);

    addTimeout(() => {
      setAgentStates([
        { id: "orchestrator", name: "orchestrator", status: "done", detail: "Analyzing intent and routing query", startDelay: 0, duration: 2000, currentStatus: "done" },
        { id: "datadog-agent", name: "datadog-agent", status: "done", detail: "Querying connected datasources", startDelay: 0, duration: 1500, currentStatus: "running" },
      ]);
      addTimeout(() => {
        setAgentStates((prev) => prev.map((a) => ({ ...a, currentStatus: "done" })));
        const respId = `resp-${Date.now()}`;
        const genericResponse = "I'm analyzing across your connected sources (GitHub, Datadog, Linear, ArgoCD)...\n\nBased on what I found, there are **2 active blockers** in your payments pipeline and **1 ongoing incident** in the SRE queue. The most urgent item is the TC-005 idempotency failure which is blocking the staging deploy.\n\nWhat would you like to dig into?";
        setMessages((prev) => [...prev, { id: respId, role: "assistant", content: "", streaming: true }]);
        const words = genericResponse.split(" ");
        let acc = "";
        words.forEach((w, i) => {
          addTimeout(() => {
            acc += (i === 0 ? "" : " ") + w;
            const isFinal = i === words.length - 1;
            setMessages((prev) => prev.map((m) => m.id === respId ? { ...m, content: acc, streaming: !isFinal } : m));
            if (isFinal) {
              setFollowUps(["Show active blockers", "View payments incident", "What should I fix first?"]);
              setIsThinking(false);
            }
          }, i * 40);
        });
      }, 1500);
    }, 1200);
  }

  function handleSend() {
    if (!input.trim() || isThinking) return;
    const text = input.trim();
    setInput("");
    sendFreeForm(text);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div style={{ display: "flex", height: "100%", background: "#080808", overflow: "hidden" }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>

      {/* Left: Chat */}
      <div style={{ flex: 2, display: "flex", flexDirection: "column", borderRight: "1px solid #1a1a1a", minWidth: 0 }}>
        {/* Top bar */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#e5e5e5" }}>Orchestrator</span>
          <span style={{ fontSize: "11px", color: "#555", marginLeft: "4px" }}>—</span>
          <span style={{ fontSize: "11px", color: "#555" }}>Acme Platform</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
            {isThinking && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#111", border: "1px solid #2a2a2a", borderRadius: "4px", padding: "3px 8px" }}>
                <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#3b82f6", animation: "blink 1s step-end infinite" }} />
                <span style={{ fontSize: "10px", color: "#888" }}>thinking</span>
              </div>
            )}
            <div style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: "4px", padding: "3px 8px", fontSize: "10px", color: "#555" }}>
              workspace: acme-platform
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {isEmpty ? (
            <ScenarioButtons onScenario={runScenario} />
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {followUps.length > 0 && (
                <FollowUpChips
                  chips={followUps}
                  onChip={(chip) => {
                    setFollowUps([]);
                    sendFreeForm(chip);
                  }}
                />
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid #1a1a1a", flexShrink: 0 }}>
          {!isEmpty && (
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => runScenario(s)}
                  style={{
                    background: "transparent", border: "1px solid #1a1a1a", color: "#555",
                    padding: "3px 8px", borderRadius: "4px", fontSize: "10px", cursor: "pointer",
                  }}
                >
                  {s.emoji} {s.label}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <div style={{ flex: 1, background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: "8px", padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{
                background: `${ROLE_COLORS[currentAuthRole] || "#3b82f6"}22`,
                border: `1px solid ${ROLE_COLORS[currentAuthRole] || "#3b82f6"}44`,
                borderRadius: "4px", padding: "2px 6px", fontSize: "10px",
                color: ROLE_COLORS[currentAuthRole] || "#3b82f6", flexShrink: 0,
                fontFamily: "monospace",
              }}>
                {currentAuthRole}
                {currentAuthRole !== currentInferredRole && (
                  <span style={{ color: "#555" }}>
                    {" → "}
                    <span style={{ color: ROLE_COLORS[currentInferredRole] || "#888" }}>{currentInferredRole}</span>
                  </span>
                )}
              </div>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the orchestrator anything..."
                disabled={isThinking}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "#e5e5e5", fontSize: "13px",
                }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              style={{
                background: input.trim() && !isThinking ? "#10b981" : "#1a1a1a",
                border: "none", color: input.trim() && !isThinking ? "#000" : "#555",
                padding: "10px 16px", borderRadius: "8px", cursor: input.trim() && !isThinking ? "pointer" : "not-allowed",
                fontSize: "13px", fontWeight: 700, transition: "all 0.15s",
              }}
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* Right: Agent Activity */}
      <div style={{ width: "280px", flexShrink: 0, display: "flex", flexDirection: "column", background: "#0a0a0a" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Agent Activity
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
          {agentStates.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center" }}>
              <div style={{ fontSize: "20px", marginBottom: "8px" }}>⬡</div>
              <div style={{ fontSize: "11px", color: "#444" }}>Agents will appear here when the orchestrator spins them up</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: "10px", color: "#555", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {agentStates.filter((a) => a.currentStatus === "done").length} / {agentStates.length} complete
              </div>
              {agentStates.map((agent) => (
                <AgentBadge key={agent.id} agent={agent} />
              ))}
              <div style={{ marginTop: "16px", padding: "10px", background: "#111", border: "1px solid #1a1a1a", borderRadius: "6px" }}>
                <div style={{ fontSize: "10px", color: "#555", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Routing</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {[
                    ["Intent", "inferred from query"],
                    ["Auth", currentAuthRole],
                    ["Inferred", currentInferredRole],
                    ["Context", "workspace: acme-platform"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
                      <span style={{ color: "#444" }}>{k}</span>
                      <span style={{ color: k === "Auth" ? (ROLE_COLORS[v] || "#888") : k === "Inferred" ? (ROLE_COLORS[v] || "#888") : "#888", fontFamily: "monospace" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
