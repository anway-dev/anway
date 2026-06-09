"use client";
import { CONNECTORS, Connector } from "@/lib/mock";
import { useState, useEffect } from "react";

interface ConnectorStatus {
  connectorType: string;
  enabled: boolean;
}

const CATEGORIES = ["All", "Cloud Health", "Observability", "Logging", "Kubernetes", "Code & CI", "Issue Tracking", "Deployment", "Infrastructure", "Alerting", "Docs"];

export function ConnectorsView() {
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState<Connector | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [configuredMap, setConfiguredMap] = useState<Record<string, boolean>>({});
  const [bootstrapInfo, setBootstrapInfo] = useState<Record<string, { bootstrapped: boolean; bootstrappedAt?: string }>>({});
  const [bootstrapping, setBootstrapping] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/connectors")
      .then(r => r.json())
      .then((list: ConnectorStatus[]) => {
        const map: Record<string, boolean> = {};
        for (const c of list) map[c.connectorType] = c.enabled;
        setConfiguredMap(map);
        // Fetch bootstrap status for each configured connector
        for (const c of list) {
          if (c.enabled) {
            fetch(`/api/connectors/${c.connectorType}/bootstrap-status`)
              .then(r => r.json())
              .then((data: { bootstrapped: boolean; bootstrappedAt?: string }) => {
                if (data.bootstrapped) setBootstrapInfo(prev => ({ ...prev, [c.connectorType]: data }))
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, []);

  const visible = filter === "All" ? CONNECTORS : CONNECTORS.filter((c) => c.category === filter);
  const connected = CONNECTORS.filter((c) => configuredMap[c.id] || c.connected).length;

  async function handleConnect() {
    if (!modal) return;
    setSaving(true);
    try {
      const credentials: Record<string, string> = {};
      for (const field of modal.configFields) {
        if (formValues[field.key]) credentials[field.key] = formValues[field.key];
      }
      await fetch(`/api/settings/connectors/${modal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials }),
      });
      setConfiguredMap(prev => ({ ...prev, [modal.id]: true }));
      setModal(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "24px", height: "100%", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Integrations</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>Connect Your Stack</h2>
          <span style={{ fontSize: "12px", color: "#10b981" }}>{connected} / {CONNECTORS.length} connected</span>
        </div>
        <p style={{ fontSize: "12px", color: "#888", marginTop: "6px", maxWidth: "520px" }}>
          Anvay reads from your existing tools — no data migration, no rip-and-replace. Connect once, get unified lifecycle visibility.
        </p>
      </div>

      {/* Category filter */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            style={{
              background: filter === cat ? "#10b981" : "#111", border: `1px solid ${filter === cat ? "#10b981" : "#2a2a2a"}`,
              color: filter === cat ? "#000" : "#888", padding: "4px 10px", borderRadius: "4px",
              fontSize: "11px", cursor: "pointer", fontWeight: filter === cat ? 700 : 400,
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
        {visible.map((conn) => (
          <ConnectorCard key={conn.id} connector={conn} configured={!!configuredMap[conn.id]} bootstrap={bootstrapInfo[conn.id]} bootstrapping={bootstrapping === conn.id} onBootstrap={() => { setBootstrapping(conn.id); fetch(`/api/connectors/${conn.id}/bootstrap`, { method: 'POST' }).catch(() => {}).finally(() => setBootstrapping(null)); }} onConnect={() => { setModal(conn); setFormValues({}); }} />
        ))}
      </div>

      {/* Modal */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: "12px", padding: "24px", width: "400px", maxWidth: "90vw" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: modal.color + "22", border: `1px solid ${modal.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: modal.color, fontWeight: 700 }}>
                {modal.icon}
              </div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5" }}>Connect {modal.name}</div>
                <div style={{ fontSize: "11px", color: "#888" }}>{modal.category}</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "20px" }}>
              {modal.configFields.map((field) => (
                <div key={field.key}>
                  <label style={{ fontSize: "11px", color: "#888", display: "block", marginBottom: "6px" }}>{field.label}</label>
                  <input
                    type={field.type === "password" ? "password" : "text"}
                    value={formValues[field.key] || ""}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.type === "password" ? "••••••••••••" : `Enter ${field.label.toLowerCase()}`}
                    style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "8px 10px", borderRadius: "6px", fontSize: "12px", outline: "none" }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: "#555", marginBottom: "20px", alignItems: "flex-start" }}>
              <span>🔒</span>
              <span>Credentials are encrypted at rest. Anvay only reads — it never writes to your tools unless a workflow hook explicitly requires it.</span>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setModal(null)}
                style={{ flex: 1, background: "transparent", border: "1px solid #2a2a2a", color: "#888", padding: "8px", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={saving}
                style={{
                  flex: 1, background: saving ? "#0a0a0a" : "#10b981", border: "none",
                  color: saving ? "#444" : "#000", padding: "8px", borderRadius: "6px",
                  cursor: saving ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 700,
                }}
              >
                {saving ? "Saving..." : "Connect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectorCard({ connector: c, configured, bootstrap, bootstrapping, onBootstrap, onConnect }: { connector: Connector; configured: boolean; bootstrap?: { bootstrapped: boolean; bootstrappedAt?: string }; bootstrapping?: boolean; onBootstrap?: () => void; onConnect: () => void }) {
  return (
    <div style={{
      background: "#111", border: `1px solid ${configured ? "#1f2f1f" : "#1f1f1f"}`,
      borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: c.color + "22", border: `1px solid ${c.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: c.color, fontWeight: 700, flexShrink: 0 }}>
            {c.icon}
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#e5e5e5" }}>{c.name}</div>
            <div style={{ fontSize: "10px", color: "#555" }}>{c.category}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: configured ? "#10b981" : "#444",
            boxShadow: configured ? "0 0 4px #10b981" : "none",
          }} />
          <span style={{ fontSize: "10px", color: configured ? "#10b981" : "#555" }}>
            {configured ? "Configured" : "Off"}
          </span>
        </div>
      </div>

      <div style={{ fontSize: "11px", color: "#888" }}>{c.description}</div>
      {configured && bootstrap && (
        <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace" }}>
          {bootstrap.bootstrapped ? (
            <span>Bootstrapped {bootstrap.bootstrappedAt ? new Date(bootstrap.bootstrappedAt).toLocaleString() : ''}</span>
          ) : (
            <span>
              Not bootstrapped
              <button onClick={onBootstrap} disabled={bootstrapping}
                style={{
                  marginLeft: "8px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
                  color: bootstrapping ? "#444" : "#10b981", padding: "2px 8px", borderRadius: "3px",
                  cursor: bootstrapping ? "not-allowed" : "pointer", fontSize: "9px", fontFamily: "monospace",
                }}
              >
                {bootstrapping ? '...' : 'Bootstrap now'}
              </button>
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
        {c.capabilities.map((cap) => (
          <span key={cap} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#555", padding: "1px 6px", borderRadius: "3px", fontSize: "10px" }}>
            {cap}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {configured ? (
          <span style={{ fontSize: "10px", color: "#555" }}>✓ configured</span>
        ) : (
          <span style={{ fontSize: "10px", color: "#555" }}>Not connected</span>
        )}
        <button
          onClick={onConnect}
          style={{
            background: configured ? "transparent" : "rgba(16,185,129,0.1)",
            border: `1px solid ${configured ? "#2a2a2a" : "rgba(16,185,129,0.3)"}`,
            color: configured ? "#555" : "#10b981",
            padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "11px",
          }}
        >
          {configured ? "Reconfigure" : "Connect"}
        </button>
      </div>
    </div>
  );
}
