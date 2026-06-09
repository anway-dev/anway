"use client";
import { useState } from "react";
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

export function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>("provider");

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
            Configure which AI model provider Anvay uses for query answering and analysis.
          </p>
          <ProviderConfig inline />
        </div>
      )}
      {tab === "connectors" && <ConnectorsView />}
      {tab === "access" && <AccessView />}
      {tab === "audit" && <AuditView />}
    </div>
  );
}
