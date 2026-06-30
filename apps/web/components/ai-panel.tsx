"use client";
import type { StageNode } from "@/components/lifecycle";
import { useState, useEffect, useRef } from "react";

interface Props {
  node: StageNode | null;
  action: string | null;
  onClose: () => void;
}

export function AiPanel({ node, action, onClose }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [input, setInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!node) return;

    setLines([]);
    setDone(false);
    setInput("");
    setStreaming(true);

    const prompt = action
      ? `You are an AI assistant for the Anway platform. The user is working on the "${node.label}" stage of their software lifecycle. They want to: ${action}. Provide a concise, helpful analysis.`
      : `You are an AI assistant for the Anway platform. Analyze the "${node.label}" stage (${node.connector ?? "no connector"}) and provide relevant insights.`;

    let aborted = false;
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: prompt, sessionId: `ai-panel-${node.id}` }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) { setStreaming(false); setDone(true); return; }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const event = JSON.parse(data) as { type: string; content?: string };
              if (event.type === 'text_delta' && event.content) {
                setLines(prev => {
                  const last = prev[prev.length - 1] ?? '';
                  const chunk = event.content!;
                  if (chunk.includes('\n')) {
                    const parts = (last + chunk).split('\n');
                    return [...prev.slice(0, -1), ...parts];
                  }
                  return [...prev.slice(0, -1), last + chunk];
                });
              }
            } catch { continue; }
          }
        }
      } catch {
        // swallow abort / network errors
      } finally {
        if (!aborted) { setStreaming(false); setDone(true); }
      }
    })();

    return () => { aborted = true; controller.abort(); };
  }, [node, action]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, chatHistory]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setInput("");
    setChatHistory(prev => [...prev, { role: "user", text: msg }]);
    const placeholder = { role: "ai" as const, text: "" };
    setChatHistory(prev => [...prev, placeholder]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: msg, sessionId: `ai-panel-chat-${node?.id}` }),
      });
      if (!response.ok || !response.body) {
        setChatHistory(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, text: "Error: could not reach AI." } : m));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
          try {
            const event = JSON.parse(data) as { type: string; content?: string };
            if (event.type === 'text_delta' && event.content) {
              setChatHistory(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, text: m.text + event.content! } : m));
            }
          } catch { continue; }
        }
      }
    } catch {
      setChatHistory(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, text: "Network error." } : m));
    }
  };

  if (!node) return null;

  return (
    <div style={{
      width: "340px", background: "#0e0e0e", borderLeft: "1px solid #2a2a2a",
      display: "flex", flexDirection: "column", height: "100%", flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: streaming ? "#10b981" : "#555", ...(streaming ? { animation: "pulse-dot 1s infinite" } : {}) }} />
          <span style={{ fontSize: "12px", color: "#e5e5e5", fontWeight: 600 }}>AI Assistant</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "16px", lineHeight: 1 }}>×</button>
      </div>

      {/* Context badge */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px" }}>Context</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {["Reduce Checkout Friction", node.label, node.connector].filter(Boolean).map((tag) => (
            <span key={tag} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888", padding: "2px 6px", borderRadius: "4px", fontSize: "10px" }}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Output */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", fontFamily: "monospace" }}>
        {/* Streaming output */}
        <div style={{ marginBottom: "16px" }}>
          {lines.map((line, i) => (
            <div
              key={i}
              style={{ fontSize: "12px", lineHeight: "1.7", color: line.startsWith("**") ? "#e5e5e5" : line.startsWith("TC-") ? (line.includes("✓") ? "#10b981" : "#ef4444") : line.startsWith("```") ? "#6b7280" : "#a1a1aa", whiteSpace: "pre-wrap", fontFamily: line.startsWith("```") || line.startsWith("  ") ? "monospace" : "sans-serif", animation: "stream-in 0.15s ease forwards" }}
            >
              {line.replace(/\*\*/g, "")}
            </div>
          ))}
          {streaming && (
            <span style={{ display: "inline-block", width: "8px", height: "14px", background: "#10b981", animation: "pulse-dot 0.8s ease infinite", marginLeft: "2px", borderRadius: "1px" }} />
          )}
        </div>

        {/* Chat history */}
        {chatHistory.map((msg, i) => (
          <div key={i} style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "10px", color: msg.role === "user" ? "#3b82f6" : "#8b5cf6", marginBottom: "4px", textTransform: "uppercase" }}>
              {msg.role === "user" ? "You" : "✦ Anway"}
            </div>
            <div style={{ fontSize: "12px", color: "#d1d5db", lineHeight: "1.6", whiteSpace: "pre-wrap", background: msg.role === "user" ? "#1a1a1a" : "transparent", padding: msg.role === "user" ? "8px 10px" : "0", borderRadius: "6px" }}>
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      {done && (
        <div style={{ padding: "10px 16px", borderTop: "1px solid #1a1a1a", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {["Why is TC-004 failing?", "Trace to PRD", "Create incident"].map((q) => (
            <button
              key={q}
              onClick={() => { setInput(q); }}
              style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888", padding: "4px 8px", borderRadius: "4px", fontSize: "10px", cursor: "pointer" }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a1a" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "8px", padding: "8px 12px" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask anything about this feature..."
            style={{ flex: 1, background: "none", border: "none", color: "#e5e5e5", fontSize: "12px", outline: "none" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            style={{ background: input.trim() ? "#10b981" : "#1f1f1f", border: "none", color: input.trim() ? "#000" : "#555", padding: "4px 8px", borderRadius: "4px", cursor: input.trim() ? "pointer" : "default", fontSize: "11px", fontWeight: 600 }}
          >
            ↵
          </button>
        </div>
        <div style={{ fontSize: "10px", color: "#374151", marginTop: "6px", textAlign: "center" }}>
          Context: Linear · GitHub · Datadog · ArgoCD
        </div>
      </div>
    </div>
  );
}
