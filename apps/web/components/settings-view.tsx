"use client";
import { useState, useEffect } from "react";
import { ProviderConfig } from "@/components/provider-config";
import { ConnectorsView } from "@/components/connectors";
import { AccessView } from "@/components/access-view";
import { AuditView } from "@/components/audit-view";

type SettingsTab = "provider" | "connectors" | "access" | "audit";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "provider", label: "AI Provider" },
  { id: "connectors", label: "Connectors" },
  { id: "access", label: "Access" },
  { id: "audit", label: "Audit" },
];

interface TokenUsage { used: number; budget: number | null; month: string }

export function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>("provider");
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const loadUsage = () => {
    fetch('/api/settings/token-usage')
      .then(r => r.json() as Promise<TokenUsage>)
      .then(setTokenUsage)
      .catch(() => {})
  }

  useEffect(() => { loadUsage() }, [])

  const resetDailyUsage = async () => {
    setResetting(true)
    setResetMsg(null)
    try {
      const resp = await fetch('/api/admin/token-usage/reset', { method: 'DELETE' })
      if (resp.ok) {
        setResetMsg('Daily usage reset.')
        loadUsage()
      } else {
        const body = await resp.json().catch(() => ({})) as { error?: string }
        setResetMsg(body.error ?? 'Reset failed.')
      }
    } catch {
      setResetMsg('Gateway unreachable.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div style={{ padding: "24px", height: "100%", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Settings</div>
        <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>Configuration</h2>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "6px 14px", borderRadius: "5px", border: "none",
              background: tab === t.id ? "rgba(16,185,129,0.15)" : "transparent",
              color: tab === t.id ? "#10b981" : "#555",
              fontSize: "11px", fontWeight: tab === t.id ? 600 : 400,
              cursor: "pointer", fontFamily: "monospace",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "provider" && (
        <div>
          <p style={{ fontSize: "12px", color: "#888", marginBottom: "16px" }}>
            Configure which AI model provider Anway uses for query answering and analysis.
          </p>
          <ProviderConfig inline />
          {tokenUsage && (
            <div style={{ marginTop: "24px", padding: "16px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px" }}>
              <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>Token Usage — {tokenUsage.month}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ flex: 1, height: "8px", background: "#1a1a1a", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ width: tokenUsage.budget != null ? `${Math.min(100, tokenUsage.budget > 0 ? (tokenUsage.used / tokenUsage.budget) * 100 : 0)}%` : "0%", height: "100%", background: tokenUsage.budget != null && tokenUsage.used >= tokenUsage.budget ? "#ef4444" : "#10b981", borderRadius: "4px", transition: "width 0.3s" }} />
                </div>
                <span style={{ fontSize: "11px", color: "#888", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  {tokenUsage.used.toLocaleString()} / {tokenUsage.budget != null ? tokenUsage.budget.toLocaleString() : "∞"}
                </span>
              </div>
              {tokenUsage.budget != null && tokenUsage.used >= tokenUsage.budget && (
                <div style={{ marginTop: "8px", fontSize: "11px", color: "#ef4444", fontFamily: "monospace" }}>Budget exceeded — further queries blocked until next billing period.</div>
              )}
              <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  onClick={resetDailyUsage}
                  disabled={resetting}
                  style={{
                    padding: "4px 10px", fontSize: "11px", fontFamily: "monospace",
                    background: "transparent", border: "1px solid #2a2a2a",
                    color: resetting ? "#444" : "#888", borderRadius: "4px",
                    cursor: resetting ? "default" : "pointer",
                  }}
                >
                  {resetting ? "Resetting…" : "Reset daily usage"}
                </button>
                {resetMsg && <span style={{ fontSize: "11px", color: resetMsg === "Daily usage reset." ? "#10b981" : "#ef4444", fontFamily: "monospace" }}>{resetMsg}</span>}
              </div>
            </div>
          )}
        </div>
      )}
      {tab === "connectors" && <ConnectorsView />}
      {tab === "access" && <AccessView />}
      {tab === "audit" && <AuditView />}
    </div>
  );
}
