"use client";
import { useState, useEffect, useRef } from "react";

interface ProviderInfo { configured: boolean; provider?: string; defaultModel?: string }
interface ModelList { models: string[] }
interface ManifestField { key: string; label: string; type: string; required: boolean; placeholder?: string; defaultValue?: string }
interface ProviderManifest { id: string; displayName: string; website: string; fields: ManifestField[]; models: string[]; modelsEndpoint?: string; defaultBaseUrl?: string; openAICompatible: boolean }

export function ProviderConfig({ onConfigured, inline }: { onConfigured?: () => void; renderGearIn?: (gear: React.ReactNode) => React.ReactNode; inline?: boolean }) {
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [manifests, setManifests] = useState<ProviderManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [cheapModel, setCheapModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const initialModelRef = useRef<string>('');

  useEffect(() => {
    fetch("/api/settings/provider-manifests")
      .then(r => r.json())
      .then((man: ProviderManifest[]) => setManifests(man as ProviderManifest[]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/settings/provider")
      .then(r => r.ok ? r.json() : { configured: false })
      .then((prov: ProviderInfo) => {
        setProviderInfo(prov);
        if (prov.configured && prov.provider) {
          setSelectedProvider(prov.provider);
          if (prov.defaultModel) initialModelRef.current = prov.defaultModel;
        }
        if (!prov.configured) { setShowPanel(true); setEditing(true); }
      })
      .catch(() => setProviderInfo({ configured: false }))
      .finally(() => setLoading(false));
  }, []);

  const selectedManifest = manifests.find(m => m.id === selectedProvider);

  useEffect(() => {
    setSelectedModel("");
    const needsKey = selectedManifest?.fields.some(f => f.key === 'apiKey' && f.required);
    if (needsKey && apiKey.length > 0 && apiKey.length < 10) { setModels([]); return; }
    fetch(`/api/settings/models?${new URLSearchParams({ provider: selectedProvider, ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}) })}`)
      .then(r => r.ok ? r.json() : { models: [] })
      .then((data: ModelList) => {
        const list = data.models ?? [];
        setModels(list);
        if (initialModelRef.current && list.includes(initialModelRef.current)) {
          setSelectedModel(initialModelRef.current);
          initialModelRef.current = '';
        }
      })
      .catch(() => setModels([]));
  }, [selectedProvider, baseUrl, apiKey, selectedManifest]);

  async function handleSave() {
    const needsApiKey = selectedManifest?.fields.some(f => f.required && f.key === 'apiKey');
    if (needsApiKey && !apiKey) return;
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const body: Record<string, string> = { provider: selectedProvider };
      if (selectedManifest?.defaultBaseUrl) body.baseUrl = selectedManifest.defaultBaseUrl;
      if (apiKey) body.apiKey = apiKey;
      if (baseUrl) body.baseUrl = baseUrl;
      if (selectedModel) body.defaultModel = selectedModel;
      if (cheapModel) body.cheapModel = cheapModel;
      const resp = await fetch("/api/settings/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const updated = { configured: true, provider: selectedProvider, defaultModel: selectedModel || undefined };
        setProviderInfo(updated);
        setEditing(false);
        setShowPanel(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        onConfigured?.();
      } else {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
        setSaveError(err.error ?? `Save failed (${resp.status})`);
      }
    } catch {
      setSaveError("Network error — is the gateway running?");
    } finally { setSaving(false); }
  }

  function renderForm(cancelable = false) {
    const needsApiKey = selectedManifest?.fields.some(f => f.required && f.key === 'apiKey');
    const canSave = !saving && (apiKey || !needsApiKey);
    return (
      <div>
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>Provider</label>
          <select value={selectedProvider} onChange={e => { setSelectedProvider(e.target.value); setApiKey(""); setBaseUrl(""); }}
            style={{ width: "100%", background: "#080808", border: "1px solid #2a2a2a", borderRadius: "4px", color: "#e5e5e5", padding: "8px 10px", fontSize: "13px", fontFamily: "monospace", outline: "none" }}>
            {manifests.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </select>
        </div>

        {selectedManifest?.fields.map(field => (
          <div key={field.key} style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {field.label}{field.required ? <span style={{ color: "#ef4444" }}> *</span> : ''}
            </label>
            <input type={field.type === "password" ? "password" : "text"}
              value={field.key === 'apiKey' ? apiKey : field.key === 'baseURL' ? (baseUrl || field.defaultValue || '') : ''}
              onChange={e => { if (field.key === 'apiKey') setApiKey(e.target.value); if (field.key === 'baseURL') setBaseUrl(e.target.value); }}
              placeholder={field.placeholder || field.defaultValue || `Enter ${field.label.toLowerCase()}`}
              style={{ width: "100%", background: "#080808", border: "1px solid #2a2a2a", borderRadius: "4px", color: "#e5e5e5", padding: "8px 10px", fontSize: "13px", fontFamily: "monospace", outline: "none" }} />
          </div>
        ))}

        {models.length > 0 && (
          <>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>Model</label>
              <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
                style={{ width: "100%", background: "#080808", border: "1px solid #2a2a2a", borderRadius: "4px", color: "#e5e5e5", padding: "8px 10px", fontSize: "13px", fontFamily: "monospace", outline: "none" }}>
                <option value="">— select model</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "10px", color: "#555", marginBottom: "4px", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>Cheap model <span style={{ color: "#444" }}>(optional — for fast ops)</span></label>
              <select value={cheapModel} onChange={e => setCheapModel(e.target.value)}
                style={{ width: "100%", background: "#080808", border: "1px solid #2a2a2a", borderRadius: "4px", color: "#e5e5e5", padding: "8px 10px", fontSize: "13px", fontFamily: "monospace", outline: "none" }}>
                <option value="">— use main model</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </>
        )}

        {saveError && (
          <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "4px", fontSize: "11px", color: "#ef4444", fontFamily: "monospace", marginBottom: "12px" }}>
            {saveError}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button onClick={handleSave} disabled={!canSave}
            style={{ flex: 1, padding: "9px", borderRadius: "5px", background: canSave ? "rgba(16,185,129,0.12)" : "#0a0a0a", border: canSave ? "1px solid rgba(16,185,129,0.35)" : "1px solid #1a1a1a", color: canSave ? "#10b981" : "#333", fontSize: "12px", fontWeight: 700, fontFamily: "monospace", cursor: canSave ? "pointer" : "not-allowed" }}>
            {saving ? "Saving…" : "Save"}
          </button>
          {cancelable && (
            <button onClick={() => { setEditing(false); setSaveError(""); }}
              style={{ padding: "9px 16px", borderRadius: "5px", background: "transparent", border: "1px solid #1a1a1a", color: "#555", fontSize: "12px", fontFamily: "monospace", cursor: "pointer" }}>
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // Inline mode — used in Settings
  if (inline) {
    if (loading) {
      return (
        <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "20px 24px" }}>
          <div style={{ fontSize: "11px", color: "#444", fontFamily: "monospace" }}>Loading…</div>
        </div>
      );
    }

    const isConfigured = providerInfo?.configured;

    // Configured + not editing: show clean status card
    if (isConfigured && !editing) {
      return (
        <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ fontSize: "11px", color: "#555", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>AI Provider</div>
            <button onClick={() => { setEditing(true); setSaved(false); }}
              style={{ fontSize: "11px", color: "#10b981", background: "transparent", border: "none", cursor: "pointer", fontFamily: "monospace", padding: 0 }}>
              Edit
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "13px", color: "#e5e5e5", fontFamily: "monospace", fontWeight: 600 }}>
                {providerInfo?.provider}
              </div>
              {providerInfo?.defaultModel && (
                <div style={{ fontSize: "11px", color: "#888", fontFamily: "monospace", marginTop: "2px" }}>
                  {providerInfo.defaultModel}
                </div>
              )}
            </div>
            {saved && (
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "#10b981", fontFamily: "monospace" }}>✓ saved</span>
            )}
          </div>
        </div>
      );
    }

    // Editing or not configured: show form
    return (
      <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", color: "#555", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {isConfigured ? "Change AI Provider" : "Set up AI Provider"}
          </div>
          {!isConfigured && (
            <div style={{ fontSize: "11px", color: "#ef4444", fontFamily: "monospace" }}>Not configured</div>
          )}
        </div>
        {renderForm(!!isConfigured)}
      </div>
    );
  }

  // Full-screen overlay (non-inline, legacy path — kept but no longer mounted in OrchestratorChat)
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
