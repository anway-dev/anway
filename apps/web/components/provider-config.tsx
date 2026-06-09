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

interface ManifestField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

interface ProviderManifest {
  id: string;
  displayName: string;
  website: string;
  fields: ManifestField[];
  models: string[];
  modelsEndpoint?: string;
  defaultBaseUrl?: string;
  openAICompatible: boolean;
}

export function ProviderConfig({ onConfigured, renderGearIn, inline }: { onConfigured?: () => void; renderGearIn?: (gear: React.ReactNode) => React.ReactNode; inline?: boolean }) {
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [manifests, setManifests] = useState<ProviderManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings/provider").then(r => r.json()),
      fetch("/api/settings/provider-manifests").then(r => r.json()),
    ])
      .then(([prov, man]) => {
        setProviderInfo(prov as ProviderInfo);
        setManifests(man as ProviderManifest[]);
        if (!(prov as ProviderInfo).configured) setShowPanel(true);
      })
      .catch(() => setProviderInfo({ configured: false }))
      .finally(() => setLoading(false));
  }, []);

  const selectedManifest = manifests.find(m => m.id === selectedProvider);

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
    if (!apiKey && selectedManifest?.fields.some(f => f.required && f.key === 'apiKey')) return;
    setSaving(true);
    try {
      const body: Record<string, string> = { provider: selectedProvider };
      if (selectedManifest?.defaultBaseUrl) {
        body.baseUrl = selectedManifest.defaultBaseUrl;
      }
      if (apiKey) body.apiKey = apiKey;
      if (baseUrl) body.baseUrl = baseUrl;
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

  // Inline mode: render as config section without overlay
  if (inline) {
    return (
      <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "24px" }}>
        <div style={{ fontSize: "12px", color: "#e5e5e5", fontWeight: 600, marginBottom: "16px", fontFamily: "monospace" }}>
          AI Provider {providerInfo?.configured ? `· ${providerInfo.provider} configured` : ''}
        </div>
        {providerInfo?.configured ? (
          <div style={{ fontSize: "11px", color: "#10b981", fontFamily: "monospace", marginBottom: "12px" }}>
            ● {providerInfo.provider}{providerInfo.defaultModel ? ` / ${providerInfo.defaultModel}` : ''}
          </div>
        ) : null}
      </div>
    );
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
              {manifests.map(m => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>

            {selectedManifest?.fields.map(field => (
              <div key={field.key}>
                <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace" }}>
                  {field.label}{field.required ? ' *' : ''}
                </label>
                <input
                  type={field.type === "password" ? "password" : "text"}
                  value={field.key === 'apiKey' ? apiKey : field.key === 'baseURL' ? (baseUrl || field.defaultValue || '') : ''}
                  onChange={e => {
                    if (field.key === 'apiKey') setApiKey(e.target.value);
                    if (field.key === 'baseURL') setBaseUrl(e.target.value);
                  }}
                  placeholder={field.placeholder || field.defaultValue || `Enter ${field.label.toLowerCase()}`}
                  style={{
                    width: "100%", background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px",
                    color: "#e5e5e5", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace",
                    marginBottom: "16px", outline: "none",
                  }}
                />
              </div>
            ))}

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
