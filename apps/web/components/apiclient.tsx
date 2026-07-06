"use client";
import { useState } from "react";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const METHOD_COLORS: Record<string, string> = {
  GET: "#10b981", POST: "#3b82f6", PUT: "#f59e0b", PATCH: "#8b5cf6", DELETE: "#ef4444",
};

const COLLECTIONS = [
  {
    name: "payments-v2", requests: [
      { method: "POST", path: "/v2/payments/quick-checkout", status: 201, time: "234ms" },
      { method: "GET", path: "/v2/payments/methods/:userId", status: 200, time: "89ms" },
      { method: "POST", path: "/v2/payments/refund", status: 200, time: "312ms" },
      { method: "POST", path: "/v2/payments/quick-checkout (high-value)", status: null, time: null },
    ],
  },
  {
    name: "auth-service", requests: [
      { method: "POST", path: "/auth/token", status: 200, time: "145ms" },
      { method: "GET", path: "/auth/me", status: 200, time: "32ms" },
      { method: "POST", path: "/auth/refresh", status: 200, time: "98ms" },
    ],
  },
];

interface RealResponse {
  status: number
  statusText: string
  timeMs: number
  sizeBytes: number
  body: string
  headers: Array<[string, string]>
  error?: string
}

export function ApiClientView() {
  const [method, setMethod] = useState("POST");
  const [url, setUrl] = useState("https://api.acme.dev/v2/payments/quick-checkout");
  const [activeTab, setActiveTab] = useState<"body" | "headers" | "auth">("body");
  const [responseTab, setResponseTab] = useState<"body" | "headers">("body");
  const [body, setBody] = useState(JSON.stringify({ userId: "usr_abc123", methodId: "pm_xyz789", amount: 4999, currency: "USD", idempotencyKey: "req_01HXYZ" }, null, 2));
  const [headerRows, setHeaderRows] = useState<Array<[string, string]>>([["Content-Type", "application/json"]]);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<RealResponse | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<string | null>("POST /v2/payments/quick-checkout");

  // A real request — this previously always set a `sent` flag and rendered a
  // hardcoded MOCK_RESPONSE (fake payment JSON) regardless of what
  // method/url/body/headers were actually configured, confirmed live via
  // independent review. No fetch was ever made at all.
  async function handleSend() {
    setSending(true);
    setResponse(null);
    const started = performance.now();
    try {
      const headers: Record<string, string> = {};
      for (const [k, v] of headerRows) if (k.trim()) headers[k] = v;
      const hasBody = method !== "GET" && method !== "DELETE" && body.trim().length > 0;
      const resp = await fetch(url, {
        method,
        headers,
        body: hasBody ? body : undefined,
      });
      const text = await resp.text();
      const timeMs = Math.round(performance.now() - started);
      setResponse({
        status: resp.status,
        statusText: resp.statusText,
        timeMs,
        sizeBytes: new Blob([text]).size,
        body: text,
        headers: Array.from(resp.headers.entries()),
      });
    } catch (e) {
      setResponse({
        status: 0,
        statusText: "Request failed",
        timeMs: Math.round(performance.now() - started),
        sizeBytes: 0,
        body: "",
        headers: [],
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* Left: Collections */}
      <div style={{ width: "220px", background: "#0e0e0e", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "11px", color: "#888", fontWeight: 600 }}>Collections</span>
          <button style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "14px" }}>+</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {COLLECTIONS.map((col) => (
            <div key={col.name}>
              <div style={{ padding: "8px 16px", fontSize: "11px", color: "#888", display: "flex", alignItems: "center", gap: "6px", borderBottom: "1px solid #111" }}>
                <span style={{ color: "#555" }}>▾</span>
                <span style={{ fontWeight: 600 }}>{col.name}</span>
              </div>
              {col.requests.map((req) => {
                const key = `${req.method} ${req.path}`;
                const isSelected = selectedRequest === key;
                return (
                  <div
                    key={key}
                    onClick={() => setSelectedRequest(key)}
                    style={{ padding: "7px 16px 7px 24px", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", background: isSelected ? "#1a2a1a" : "transparent", borderLeft: isSelected ? "2px solid #10b981" : "2px solid transparent" }}
                  >
                    <span style={{ fontSize: "10px", color: METHOD_COLORS[req.method], fontWeight: 700, minWidth: "32px" }}>{req.method.slice(0, 3)}</span>
                    <span style={{ fontSize: "11px", color: isSelected ? "#e5e5e5" : "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {req.path.replace("/v2/payments/", "").replace("/auth/", "")}
                    </span>
                    {req.status && (
                      <span style={{ marginLeft: "auto", fontSize: "10px", color: req.status < 300 ? "#10b981" : "#ef4444", flexShrink: 0 }}>{req.status}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Middle: Request builder */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* URL bar */}
        <div style={{ padding: "16px", borderBottom: "1px solid #1a1a1a", display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: METHOD_COLORS[method], padding: "8px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, outline: "none", cursor: "pointer" }}
          >
            {METHODS.map((m) => (
              <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>{m}</option>
            ))}
          </select>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ flex: 1, background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", outline: "none", fontFamily: "monospace" }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !url.trim()}
            style={{ background: "#10b981", border: "none", color: "#000", padding: "8px 16px", borderRadius: "6px", cursor: sending ? "default" : "pointer", fontSize: "12px", fontWeight: 700, flexShrink: 0, opacity: sending ? 0.6 : 1 }}
          >
            {sending ? "Sending…" : "Send ↵"}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", padding: "0 16px" }}>
          {(["body", "headers", "auth"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{ background: "none", border: "none", borderBottom: `2px solid ${activeTab === tab ? "#10b981" : "transparent"}`, color: activeTab === tab ? "#e5e5e5" : "#555", padding: "10px 14px", cursor: "pointer", fontSize: "12px", fontWeight: activeTab === tab ? 600 : 400 }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === "body" && <span style={{ marginLeft: "4px", fontSize: "10px", background: "#1a1a1a", padding: "1px 4px", borderRadius: "3px", color: "#888" }}>JSON</span>}
            </button>
          ))}
        </div>

        {/* Body editor */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {activeTab === "body" && (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ width: "100%", height: "100%", background: "#0e0e0e", border: "none", color: "#10b981", fontFamily: "monospace", fontSize: "12px", padding: "16px", resize: "none", outline: "none", lineHeight: "1.6" }}
            />
          )}
          {activeTab === "headers" && (
            <div style={{ padding: "16px" }}>
              {headerRows.map(([k, v], i) => (
                <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <input
                    value={k}
                    onChange={(e) => setHeaderRows(rows => rows.map((r, ri) => ri === i ? [e.target.value, r[1]] : r))}
                    style={{ flex: 1, background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888", padding: "7px 10px", borderRadius: "4px", fontSize: "11px", outline: "none", fontFamily: "monospace" }}
                  />
                  <input
                    value={v}
                    onChange={(e) => setHeaderRows(rows => rows.map((r, ri) => ri === i ? [r[0], e.target.value] : r))}
                    style={{ flex: 2, background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "7px 10px", borderRadius: "4px", fontSize: "11px", outline: "none", fontFamily: "monospace" }}
                  />
                  <button
                    onClick={() => setHeaderRows(rows => rows.filter((_, ri) => ri !== i))}
                    style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "12px", padding: "0 6px" }}
                  >×</button>
                </div>
              ))}
              <button
                onClick={() => setHeaderRows(rows => [...rows, ["", ""]])}
                style={{ background: "transparent", border: "1px dashed #2a2a2a", color: "#555", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "11px", marginTop: "4px" }}
              >
                + Add Header
              </button>
            </div>
          )}
          {activeTab === "auth" && (
            <div style={{ padding: "16px" }}>
              <select style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", outline: "none", marginBottom: "16px" }}>
                <option>Bearer Token</option>
                <option>API Key</option>
                <option>OAuth 2.0</option>
                <option>Basic Auth</option>
              </select>
              <div>
                <label style={{ fontSize: "11px", color: "#888", display: "block", marginBottom: "6px" }}>Token</label>
                <input defaultValue="{{API_TOKEN}}" style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "8px 10px", borderRadius: "6px", fontSize: "12px", outline: "none", fontFamily: "monospace" }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Response */}
      <div style={{ width: "380px", background: "#0e0e0e", borderLeft: "1px solid #1a1a1a", display: "flex", flexDirection: "column" }}>
        {!response ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>⚡</div>
              <div style={{ fontSize: "13px", color: "#555" }}>{sending ? "Sending…" : "Send a request to see the response"}</div>
            </div>
          </div>
        ) : (
          <>
            {/* Response meta — real status/timing/size from the actual fetch */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", gap: "16px", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: response.error || response.status >= 400 ? "#ef4444" : "#10b981", fontWeight: 700 }}>
                {response.error ? "Failed" : `${response.status} ${response.statusText}`}
              </span>
              <span style={{ fontSize: "11px", color: "#888" }}>{response.timeMs}ms</span>
              {!response.error && <span style={{ fontSize: "11px", color: "#888" }}>{response.sizeBytes} B</span>}
            </div>

            <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", padding: "0 16px" }}>
              {(["body", "headers"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setResponseTab(tab)}
                  style={{ background: "none", border: "none", borderBottom: `2px solid ${responseTab === tab ? "#10b981" : "transparent"}`, color: responseTab === tab ? "#e5e5e5" : "#555", padding: "8px 12px", cursor: "pointer", fontSize: "11px", fontWeight: responseTab === tab ? 600 : 400 }}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              {responseTab === "body" && (
                <pre style={{ fontFamily: "monospace", fontSize: "11px", color: response.error ? "#ef4444" : "#10b981", lineHeight: "1.7", margin: 0, whiteSpace: "pre-wrap" }}>
                  {response.error ?? response.body}
                </pre>
              )}
              {responseTab === "headers" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {response.headers.length === 0 && <div style={{ fontSize: "11px", color: "#555" }}>No headers.</div>}
                  {response.headers.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: "12px", fontSize: "11px" }}>
                      <span style={{ color: "#888", minWidth: "160px" }}>{k}</span>
                      <span style={{ color: "#d1d5db", fontFamily: "monospace" }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
