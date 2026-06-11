"use client";
import { useState, useEffect } from "react";

interface ProviderInfo { configured: boolean; provider?: string; defaultModel?: string }
interface ModelList { models: string[] }
interface ManifestField { key: string; label: string; type: string; required: boolean; placeholder?: string; defaultValue?: string }
interface ProviderManifest { id: string; displayName: string; website: string; fields: ManifestField[]; models: string[]; modelsEndpoint?: string; defaultBaseUrl?: string; openAICompatible: boolean }

export function ProviderConfig({ onConfigured, inline }: { onConfigured?: () => void; renderGearIn?: (gear: React.ReactNode) => React.ReactNode; inline?: boolean }) {
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [manifests, setManifests] = useState<ProviderManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [cheapModel, setCheapModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);

  // Effect 1: fetch manifests + devToken on mount
  useEffect(() => {
    fetch("/api/settings/provider-manifests")
      .then(r => r.json())
      .then((man: ProviderManifest[]) => setManifests(man as ProviderManifest[]))
      .catch(() => {});
    fetch('/api/auth/dev-token')
      .then(r => r.json())
      .then((d: { token?: string }) => { if (d.token) setDevToken(d.token) })
      .catch(() => setLoading(false));
  }, []);

  // Effect 2: fetch providerInfo once devToken is available
  useEffect(() => {
    if (devToken === null) return;
    fetch("/api/settings/provider", { headers: { Authorization: `Bearer ${devToken}` } })
      .then(r => r.ok ? r.json() : { configured: false })
      .then((prov: ProviderInfo) => {
        setProviderInfo(prov);
        if (!prov.configured) setShowPanel(true);
      })
      .catch(() => setProviderInfo({ configured: false }))
      .finally(() => setLoading(false));
  }, [devToken]);

  const selectedManifest = manifests.find(m => m.id === selectedProvider);

  useEffect(() => {
    setSelectedModel("");
    // For API-key providers, wait until key looks complete (≥10 chars)
    const needsKey = selectedManifest?.fields.some(f => f.key === 'apiKey' && f.required)
    if (needsKey && apiKey.length < 10) { setModels([]); return }
    fetch(`/api/settings/models?${new URLSearchParams({ provider: selectedProvider, ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}) })}`,
      { headers: devToken ? { Authorization: `Bearer ${devToken}` } : {} })
      .then(r => r.ok ? r.json() : { models: [] })
      .then((data: ModelList) => setModels(data.models ?? []))
      .catch(() => setModels([]));
  }, [selectedProvider, baseUrl, apiKey, selectedManifest, devToken]);

  async function handleSave() {
    if (!apiKey && selectedManifest?.fields.some(f => f.required && f.key === 'apiKey')) return;
    setSaving(true);
    try {
      const body: Record<string, string> = { provider: selectedProvider };
      if (selectedManifest?.defaultBaseUrl) body.baseUrl = selectedManifest.defaultBaseUrl;
      if (apiKey) body.apiKey = apiKey;
      if (baseUrl) body.baseUrl = baseUrl;
      if (selectedModel) body.defaultModel = selectedModel;
      if (cheapModel) body.cheapModel = cheapModel;
      const resp = await fetch("/api/settings/provider", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(devToken ? { Authorization: `Bearer ${devToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        setProviderInfo({ configured: true, provider: selectedProvider, defaultModel: selectedModel });
        setShowPanel(false);
        onConfigured?.();
      }
    } finally { setSaving(false); }
  }

  function renderForm() {
    return (
      <div>
        <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace" }}>Provider</label>
        <select value={selectedProvider} onChange={e => setSelectedProvider(e.target.value)}
          style={{ width: "100%", background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px", color: "#e5e5e5", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace", marginBottom: "16px", outline: "none" }}>
          {manifests.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
        </select>

        {selectedManifest?.fields.map(field => (
          <div key={field.key}>
            <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace" }}>{field.label}{field.required ? ' *' : ''}</label>
            <input type={field.type === "password" ? "password" : "text"}
              value={field.key === 'apiKey' ? apiKey : field.key === 'baseURL' ? (baseUrl || field.defaultValue || '') : ''}
              onChange={e => { if (field.key === 'apiKey') setApiKey(e.target.value); if (field.key === 'baseURL') setBaseUrl(e.target.value); }}
              placeholder={field.placeholder || field.defaultValue || `Enter ${field.label.toLowerCase()}`}
              style={{ width: "100%", background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px", color: "#e5e5e5", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace", marginBottom: "16px", outline: "none" }} />
          </div>
        ))}

        {models.length > 0 && (
          <>
            <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace" }}>Model</label>
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
              style={{ width: "100%", background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px", color: "#e5e5e5", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace", marginBottom: "16px", outline: "none" }}>
              <option value="">—</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace" }}>Cheap model (optional)</label>
            <select value={cheapModel} onChange={e => setCheapModel(e.target.value)}
              style={{ width: "100%", background: "#080808", border: "1px solid #1a1a1a", borderRadius: "4px", color: "#e5e5e5", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace", marginBottom: "24px", outline: "none" }}>
              <option value="">— (use main model)</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </>
        )}

        <button onClick={handleSave} disabled={saving || (!apiKey && selectedProvider !== "ollama")}
          style={{ width: "100%", padding: "10px", borderRadius: "5px", background: saving ? "#0a0a0a" : "rgba(16,185,129,0.12)", border: saving ? "1px solid #1a1a1a" : "1px solid rgba(16,185,129,0.35)", color: saving ? "#444" : "#10b981", fontSize: "12px", fontWeight: 700, fontFamily: "monospace", cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    );
  }

  // Inline mode
  if (inline) {
    return (
      <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "24px" }}>
        <div style={{ fontSize: "12px", color: "#e5e5e5", fontWeight: 600, marginBottom: "16px", fontFamily: "monospace" }}>
          AI Provider {providerInfo?.configured ? `· ${providerInfo.provider} configured` : '— not configured'}
        </div>
        {providerInfo?.configured && (
          <div style={{ fontSize: "11px", color: "#10b981", fontFamily: "monospace", marginBottom: "12px" }}>
            ● {providerInfo.provider}{providerInfo.defaultModel ? ` / ${providerInfo.defaultModel}` : ''}
          </div>
        )}
        {renderForm()}
      </div>
    );
  }

  // Full-screen overlay when not configured
  if (!loading && providerInfo && !providerInfo.configured && showPanel) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "#080808" }}>
        <div style={{ width: "420px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "32px" }}>
          <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: "0 0 4px", fontFamily: "monospace" }}>Connect your AI model</h1>
          <p style={{ fontSize: "12px", color: "#555", margin: "0 0 24px", fontFamily: "monospace" }}>Anvay needs an LLM provider to answer queries. Configure below.</p>
          {renderForm()}
        </div>
      </div>
    );
  }

  return null;
}
