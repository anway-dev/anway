"use client";
import { useState, useEffect } from "react";

interface Provider {
  id: string;
  name: string;
  type: "cloud" | "local";
  icon: string;
  color: string;
  models: string[];
  connected: boolean;
  activeModel?: string;
  envVar?: string;
}

const PROVIDER_META: Record<string, { icon: string; color: string }> = {
  anthropic: { icon: "◆", color: "#cc785c" },
  openai: { icon: "○", color: "#10a37f" },
  deepseek: { icon: "◈", color: "#4f46e5" },
  groq: { icon: "⚡", color: "#f55036" },
  mistral: { icon: "≋", color: "#ff7000" },
  ollama: { icon: "◉", color: "#3b82f6" },
  lmstudio: { icon: "⬡", color: "#8b5cf6" },
};

type TestState = "idle" | "testing" | "success" | "fail";

type SaveState = "idle" | "saving" | "saved" | "error";

export function ModelConfig() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState("anthropic");
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    setLoadingProviders(true);
    fetch("/api/settings/provider-manifests")
      .then(r => r.json())
      .then((manifests: Array<{ id: string; displayName: string; models: string[] }>) => {
        setProviders(manifests.map(m => ({
          id: m.id,
          name: m.displayName,
          type: (m.id === 'ollama' || m.id === 'lmstudio' ? "local" : "cloud") as "cloud" | "local",
          icon: PROVIDER_META[m.id]?.icon ?? "◇",
          color: PROVIDER_META[m.id]?.color ?? "#888",
          models: m.models,
          connected: false,
          envVar: (m.id).toUpperCase() + '_API_KEY',
        })));
      })
      .catch(() => {})
      .finally(() => setLoadingProviders(false));
  }, []);

  const [endpoints, setEndpoints] = useState<Record<string, string>>({
    ollama: "http://localhost:11434",
    lmstudio: "http://localhost:1234",
  });
  const [testState, setTestState] = useState<Record<string, TestState>>({});
  const [providerStatus, setProviderStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((data: { providers: { id: string; configured: boolean }[] }) => {
        const map: Record<string, boolean> = {};
        for (const p of data.providers) {
          map[p.id] = p.configured;
        }
        setProviderStatus(map);
      })
      .catch(() => {
        // silently fail — status will stay empty, UI shows unconfigured
      });
  }, []);

  const provider = providers.find((p) => p.id === selected);

  const handleModelSelect = (providerId: string, model: string) => {
    setProviders((prev) =>
      prev.map((p) => p.id === providerId ? { ...p, activeModel: model } : p)
    );
  };

  const handleTest = async (providerId: string) => {
    setTestState((s) => ({ ...s, [providerId]: "testing" }));
    try {
      const resp = await fetch('/api/providers');
      const data = await resp.json() as { providers: { id: string; configured: boolean }[] };
      const found = data.providers.find(p => p.id === providerId);
      const success = found?.configured ?? false;
      setTestState((s) => ({ ...s, [providerId]: success ? "success" : "fail" }));
      if (success) {
        setProviders((prev) =>
          prev.map((p) => p.id === providerId
            ? { ...p, connected: true, activeModel: p.activeModel ?? p.models[0] }
            : p)
        );
      }
    } catch {
      setTestState((s) => ({ ...s, [providerId]: "fail" }));
    }
  };

  const handleDisconnect = (providerId: string) => {
    setProviders((prev) =>
      prev.map((p) => p.id === providerId ? { ...p, connected: false, activeModel: undefined } : p)
    );
    setTestState((s) => ({ ...s, [providerId]: "idle" }));
  };

  const handleSave = async (providerId: string) => {
    const p = providers.find(pr => pr.id === providerId);
    if (!p) return;
    setSaveState(s => ({ ...s, [providerId]: "saving" }));
    try {
      const body: Record<string, string> = { provider: providerId };
      if (p.activeModel) body['defaultModel'] = p.activeModel;
      if (p.type === "local" && endpoints[providerId]) body['baseUrl'] = endpoints[providerId]!;
      const resp = await fetch('/api/settings/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setSaveState(s => ({ ...s, [providerId]: resp.ok ? "saved" : "error" }));
      if (resp.ok) setTimeout(() => setSaveState(s => ({ ...s, [providerId]: "idle" })), 2000);
    } catch {
      setSaveState(s => ({ ...s, [providerId]: "error" }));
    }
  };

  const activeProvider = providers.find((p) => p.connected && p.activeModel);

  return (
    <div style={{ display: "flex", height: "100%", background: "#080808" }}>

      {/* Left: provider list */}
      <div style={{ width: "220px", background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 16px 10px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em" }}>AI Models</div>
          <div style={{ fontSize: "10px", color: "#444", marginTop: "4px" }}>Connect your subscriptions</div>
        </div>

        {/* Active model banner */}
        {activeProvider && (
          <div style={{ margin: "10px 12px", padding: "8px 10px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "6px" }}>
            <div style={{ fontSize: "9px", color: "#10b981", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>Active</div>
            <div style={{ fontSize: "11px", color: "#e5e5e5", fontWeight: 600 }}>{activeProvider.name}</div>
            <div style={{ fontSize: "10px", color: "#888", fontFamily: "monospace" }}>{activeProvider.activeModel}</div>
          </div>
        )}

        <div style={{ padding: "6px 8px", flex: 1, overflowY: "auto" }}>
          {loadingProviders ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "10px 4px" }}>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 8px" }}>
                  <div style={{ width: "18px", height: "18px", borderRadius: "4px", background: "#1a1a1a", animation: "pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.1}s` }} />
                  <div style={{ height: "10px", borderRadius: "4px", background: "#1a1a1a", flex: 1, animation: "pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.1}s` }} />
                </div>
              ))}
              <style>{`@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:.7} }`}</style>
            </div>
          ) : (
            <>
              <div style={{ fontSize: "9px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", padding: "6px 8px 4px" }}>Cloud</div>
              {providers.filter((p) => p.type === "cloud").map((p) => (
                <button key={p.id} onClick={() => setSelected(p.id)} style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "7px 8px", borderRadius: "6px", cursor: "pointer", border: "none", background: selected === p.id ? "#1a1a1a" : "transparent", textAlign: "left" }}>
                  <span style={{ fontSize: "14px", color: p.color, width: "18px", textAlign: "center" }}>{p.icon}</span>
                  <span style={{ fontSize: "12px", color: selected === p.id ? "#e5e5e5" : "#888", flex: 1 }}>{p.name}</span>
                  {p.connected && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />}
                </button>
              ))}

              <div style={{ fontSize: "9px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", padding: "12px 8px 4px" }}>Local</div>
              {providers.filter((p) => p.type === "local").map((p) => (
                <button key={p.id} onClick={() => setSelected(p.id)} style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "7px 8px", borderRadius: "6px", cursor: "pointer", border: "none", background: selected === p.id ? "#1a1a1a" : "transparent", textAlign: "left" }}>
                  <span style={{ fontSize: "14px", color: p.color, width: "18px", textAlign: "center" }}>{p.icon}</span>
                  <span style={{ fontSize: "12px", color: selected === p.id ? "#e5e5e5" : "#888", flex: 1 }}>{p.name}</span>
                  {p.connected && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Right: config panel */}
      {loadingProviders && !provider && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px" }}>
          <div style={{ width: "28px", height: "28px", border: "2px solid #1a1a1a", borderTop: "2px solid #10b981", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <div style={{ fontSize: "11px", color: "#444" }}>Loading providers…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {!loadingProviders && provider && (
      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        <div style={{ maxWidth: "600px" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: `${provider.color}22`, border: `1px solid ${provider.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", color: provider.color }}>
              {provider.icon}
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5" }}>{provider.name}</div>
              <div style={{ fontSize: "11px", color: "#555" }}>{provider.type === "local" ? "Local model server" : "Cloud API"}</div>
            </div>
            {provider.connected && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "20px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }} />
                <span style={{ fontSize: "11px", color: "#10b981" }}>Connected</span>
              </div>
            )}
          </div>

          {/* Credentials / Connection */}
          <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "10px", overflow: "hidden", marginBottom: "16px" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a", fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {provider.type === "cloud" ? "Authentication" : "Connection"}
            </div>
            <div style={{ padding: "16px" }}>
              {provider.type === "cloud" ? (
                <div>
                  {providerStatus[provider.id] ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "7px" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
                      <span style={{ fontSize: "12px", color: "#10b981" }}>Configured via environment variable</span>
                    </div>
                  ) : (
                    <div style={{ padding: "10px 12px", background: "rgba(85,85,85,0.06)", border: "1px solid #1a1a1a", borderRadius: "7px" }}>
                      <div style={{ fontSize: "12px", color: "#555" }}>
                        Not configured — <a href="/settings" style={{ color: "#10b981", textDecoration: "underline", cursor: "pointer" }} onClick={e => { e.preventDefault(); window.location.href = '/?view=settings'; }}>configure in Settings → AI Provider</a> or set <code style={{ fontFamily: "monospace", color: "#888", background: "#111", padding: "1px 5px", borderRadius: "3px" }}>{provider.envVar}</code> in <code style={{ fontFamily: "monospace", color: "#888", background: "#111", padding: "1px 5px", borderRadius: "3px" }}>.env</code>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: "11px", color: "#888", display: "block", marginBottom: "6px" }}>Endpoint URL</label>
                  <input
                    type="text"
                    value={endpoints[provider.id] ?? ""}
                    onChange={(e) => setEndpoints((ep) => ({ ...ep, [provider.id]: e.target.value }))}
                    style={{ width: "100%", background: "#111", border: "1px solid #2a2a2a", borderRadius: "6px", padding: "8px 12px", color: "#e5e5e5", fontSize: "12px", fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
                  />
                  {provider.id === "ollama" && (
                    <div style={{ fontSize: "10px", color: "#444", marginTop: "6px" }}>Default: http://localhost:11434 — run <code style={{ color: "#888" }}>ollama serve</code> first</div>
                  )}
                  {provider.id === "lmstudio" && (
                    <div style={{ fontSize: "10px", color: "#444", marginTop: "6px" }}>Enable Local Server in LM Studio → Developer tab</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Model selection */}
          {(provider.connected || provider.models.length > 0) && (
            <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "10px", overflow: "hidden", marginBottom: "16px" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>Model</span>
                {provider.type === "local" && provider.connected && (
                  <span style={{ fontSize: "10px", color: "#444" }}>{provider.models.length} discovered</span>
                )}
              </div>
              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                {testState[provider.id] === "testing" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px" }}>
                    <div style={{ width: "16px", height: "16px", border: "2px solid #1a1a1a", borderTop: "2px solid #10b981", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                    <span style={{ fontSize: "11px", color: "#555" }}>Discovering models…</span>
                  </div>
                )}
                {testState[provider.id] !== "testing" && provider.models.map((m) => (
                  <button
                    key={m}
                    onClick={() => handleModelSelect(provider.id, m)}
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "6px", cursor: "pointer", border: `1px solid ${provider.activeModel === m ? provider.color + "44" : "#1a1a1a"}`, background: provider.activeModel === m ? `${provider.color}11` : "transparent", textAlign: "left" }}
                  >
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", border: `2px solid ${provider.activeModel === m ? provider.color : "#333"}`, background: provider.activeModel === m ? provider.color : "transparent", flexShrink: 0 }} />
                    <span style={{ fontSize: "12px", color: provider.activeModel === m ? "#e5e5e5" : "#888", fontFamily: "monospace", flex: 1 }}>{m}</span>
                    {m.includes("opus") && <span style={{ fontSize: "9px", color: "#f59e0b", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", padding: "1px 5px", borderRadius: "3px" }}>most capable</span>}
                    {m.includes("sonnet") && <span style={{ fontSize: "9px", color: "#3b82f6", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", padding: "1px 5px", borderRadius: "3px" }}>balanced</span>}
                    {m.includes("haiku") && <span style={{ fontSize: "9px", color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", padding: "1px 5px", borderRadius: "3px" }}>fastest</span>}
                    {(m.includes("gpt-4o") && !m.includes("mini")) && <span style={{ fontSize: "9px", color: "#f59e0b", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", padding: "1px 5px", borderRadius: "3px" }}>most capable</span>}
                    {m.includes("mini") && <span style={{ fontSize: "9px", color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", padding: "1px 5px", borderRadius: "3px" }}>fastest</span>}
                  </button>
                ))}
                {provider.type === "local" && !provider.connected && (
                  <div style={{ padding: "16px", textAlign: "center", color: "#444", fontSize: "11px" }}>
                    Connect to discover available models
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "10px" }}>
            {!provider.connected ? (
              <button
                onClick={() => handleTest(provider.id)}
                disabled={testState[provider.id] === "testing"}
                style={{ flex: 1, padding: "10px 16px", borderRadius: "7px", cursor: testState[provider.id] === "testing" ? "default" : "pointer", border: "none", background: "#10b981", color: "#000", fontSize: "12px", fontWeight: 700, opacity: testState[provider.id] === "testing" ? 0.7 : 1 }}
              >
                {testState[provider.id] === "testing" ? "Connecting…" : provider.type === "local" ? "Connect & Discover Models" : "Connect"}
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleTest(provider.id)}
                  disabled={testState[provider.id] === "testing"}
                  style={{ padding: "10px 16px", borderRadius: "7px", cursor: "pointer", border: "1px solid #2a2a2a", background: "transparent", color: "#888", fontSize: "12px" }}
                >
                  {testState[provider.id] === "testing" ? "Testing…" : "Test connection"}
                </button>
                <button
                  onClick={() => handleSave(provider.id)}
                  disabled={saveState[provider.id] === "saving"}
                  style={{ flex: 1, padding: "10px 16px", borderRadius: "7px", cursor: saveState[provider.id] === "saving" ? "default" : "pointer", border: "none", background: saveState[provider.id] === "saved" ? "rgba(16,185,129,0.15)" : saveState[provider.id] === "error" ? "rgba(239,68,68,0.15)" : "#10b981", color: saveState[provider.id] === "saved" ? "#10b981" : saveState[provider.id] === "error" ? "#ef4444" : "#000", fontSize: "12px", fontWeight: 700, opacity: saveState[provider.id] === "saving" ? 0.7 : 1 }}
                >
                  {saveState[provider.id] === "saving" ? "Saving…" : saveState[provider.id] === "saved" ? "✓ Saved" : saveState[provider.id] === "error" ? "Save failed" : "Save"}
                </button>
                <button
                  onClick={() => handleDisconnect(provider.id)}
                  style={{ padding: "10px 16px", borderRadius: "7px", cursor: "pointer", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: "12px" }}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>

          {/* Test feedback */}
          {testState[provider.id] === "success" && (
            <div style={{ marginTop: "12px", padding: "10px 14px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "7px", fontSize: "11px", color: "#10b981" }}>
              ✓ Connection successful{provider.activeModel ? ` · active model: ${provider.activeModel}` : ""}
            </div>
          )}
          {testState[provider.id] === "fail" && (
            <div style={{ marginTop: "12px", padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "7px", fontSize: "11px", color: "#ef4444" }}>
              ✗ Connection failed — check your {provider.type === "cloud" ? "environment variable" : "endpoint URL and that the server is running"}
            </div>
          )}
          {saveState[provider.id] === "error" && (
            <div style={{ marginTop: "12px", padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "7px", fontSize: "11px", color: "#ef4444" }}>
              ✗ Save failed — gateway offline or not authenticated
            </div>
          )}

          {/* Setup guide for local providers */}
          {provider.type === "local" && (
            <div style={{ marginTop: "20px", padding: "14px 16px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px" }}>
              <div style={{ fontSize: "11px", color: "#555", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Setup</div>
              {provider.id === "ollama" && (
                <div style={{ fontSize: "11px", color: "#666", lineHeight: "1.7", fontFamily: "monospace" }}>
                  <div style={{ color: "#444" }}># install</div>
                  <div>curl -fsSL https://ollama.com/install.sh | sh</div>
                  <div style={{ color: "#444", marginTop: "8px" }}># pull a model</div>
                  <div>ollama pull llama3.2</div>
                  <div style={{ color: "#444", marginTop: "8px" }}># serve (default port 11434)</div>
                  <div>ollama serve</div>
                </div>
              )}
              {provider.id === "lmstudio" && (
                <div style={{ fontSize: "11px", color: "#666", lineHeight: "1.7" }}>
                  <div>1. Download LM Studio at lmstudio.ai</div>
                  <div>2. Load any GGUF model</div>
                  <div>3. Go to Developer tab → Start Server</div>
                  <div>4. Default port: 1234</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
