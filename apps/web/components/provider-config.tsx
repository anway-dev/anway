"use client";
import { useState, useEffect } from "react";

interface ProviderInfo {
  configured: boolean;
  provider?: string;
  defaultModel?: string;
}

interface ModelList {
  models: string[];
}

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic", keyLabel: "API Key" },
  { value: "openai", label: "OpenAI", keyLabel: "API Key" },
  { value: "deepseek", label: "DeepSeek", keyLabel: "API Key (OpenAI-compatible)" },
  { value: "groq", label: "Groq", keyLabel: "API Key" },
  { value: "mistral", label: "Mistral", keyLabel: "API Key" },
  { value: "ollama", label: "Ollama (local)", keyLabel: "Endpoint URL" },
];

export function ProviderConfig({ onConfigured, renderGearIn }: { onConfigured?: () => void; renderGearIn?: (gear: React.ReactNode) => React.ReactNode }) {
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/provider")
      .then(r => r.json())
      .then((data: ProviderInfo) => {
        setProviderInfo(data);
        if (!data.configured) setShowPanel(true);
      })
      .catch(() => setProviderInfo({ configured: false }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSelectedModel("");
    setModels([]);
    const params = new URLSearchParams({ provider: selectedProvider });
    if (baseUrl) params.set("baseUrl", baseUrl);
    fetch(`/api/settings/models?${params}`)
      .then(r => r.json())
      .then((data: ModelList) => setModels(data.models))
      .catch(() => setModels([]));
  }, [selectedProvider, baseUrl]);

  async function handleSave() {
    if (!apiKey && selectedProvider !== "ollama") return;
    setSaving(true);
    try {
      const body: Record<string, string> = { provider: selectedProvider };
      if (selectedProvider === "deepseek") {
        body.apiKey = apiKey;
        body.baseUrl = "https://api.deepseek.com";
        body.provider = "openai";
      } else if (selectedProvider === "ollama") {
        body.baseUrl = baseUrl || "http://localhost:11434";
      } else {
        body.apiKey = apiKey;
        if (baseUrl) body.baseUrl = baseUrl;
      }
      if (selectedModel) body.defaultModel = selectedModel;
      const resp = await fetch("/api/settings/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        setProviderInfo({ configured: true, provider: selectedProvider, defaultModel: selectedModel });
        setShowPanel(false);
        onConfigured?.();
      }
    } finally {
      setSaving(false);
    }
  }

  // Full-screen overlay when not configured — blocks everything until set up
  if (!loading && providerInfo && !providerInfo.configured && showPanel) {
    return (
      <>
        {renderGearIn ? null : null}
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#080808",
        }}>
          <div style={{
            width: "420px", background: "#0e0e0e", border: "1px solid #1a1a1a",
            borderRadius: "8px", padding: "32px",
          }}>
            <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: "0 0 4px", fontFamily: "monospace" }}>
              Connect your AI model
            </h1>
            <p style={{ fontSize: "12px", color: "#555", margin: "0 0 24px", fontFamily: "monospace" }}>
              Anvay needs an LLM provider to answer queries. Your key stays in your browser session.
            </p>

            <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace" }}>Provider</label>
            <select value={selectedProvider} onChange={e => setSelectedProvider(e.target.value)}
              style={{
                width: "100%", background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px",
                color: "#e5e5e5", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace",
                marginBottom: "16px", outline: "none",
              }}
            >
              {PROVIDER_OPTIONS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>

            <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace" }}>
              {PROVIDER_OPTIONS.find(p => p.value === selectedProvider)?.keyLabel ?? "API Key"}
            </label>
            <input
              type="password" value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={selectedProvider === "ollama" ? "http://localhost:11434" : "sk-..."}
              style={{
                width: "100%", background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px",
                color: "#e5e5e5", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace",
                marginBottom: "16px", outline: "none",
              }}
            />

            {selectedProvider !== "deepseek" && selectedProvider !== "ollama" && (
              <>
                <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace" }}>Base URL (optional)</label>
                <input
                  type="text" value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com"
                  style={{
                    width: "100%", background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px",
                    color: "#e5e5e5", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace",
                    marginBottom: "16px", outline: "none",
                  }}
                />
              </>
            )}

            {models.length > 0 && (
              <>
                <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace" }}>Model</label>
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
                  style={{
                    width: "100%", background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px",
                    color: "#e5e5e5", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace",
                    marginBottom: "24px", outline: "none",
                  }}
                >
                  <option value="">—</option>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </>
            )}

            <button onClick={handleSave} disabled={saving || (!apiKey && selectedProvider !== "ollama")}
              style={{
                width: "100%", padding: "10px", borderRadius: "5px",
                background: saving ? "#0a0a0a" : "rgba(16,185,129,0.12)",
                border: saving ? "1px solid #1a1a1a" : "1px solid rgba(16,185,129,0.35)",
                color: saving ? "#444" : "#10b981",
                fontSize: "12px", fontWeight: 700, fontFamily: "monospace",
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving..." : "Save & Continue"}
            </button>
          </div>
        </div>
      </>
    );
  }

  // Provider configured — render nothing (gear icon placed inline in orchestrator-chat top bar)
  return null;
}
