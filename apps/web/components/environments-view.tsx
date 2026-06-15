"use client";
import { EmptyState } from "@/components/empty-state"
import { useState } from "react";
import { useEnv, type Env } from "@/lib/env-context";

const PRESET_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {PRESET_COLORS.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{
            width: 20, height: 20, borderRadius: "50%", background: c, border: value === c ? "2px solid #fff" : "2px solid transparent",
            cursor: "pointer", padding: 0,
          }}
        />
      ))}
    </div>
  );
}

export function EnvironmentsView() {
  const { environments, env, setEnv, reloadEnvs, apiFetch } = useEnv();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]!);
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const createEnv = async () => {
    if (!newName.trim() || !newLabel.trim()) { setError("Name and label required"); return; }
    if (!/^[a-z0-9-]+$/.test(newName.trim())) { setError("Name: lowercase letters, numbers, hyphens only"); return; }
    setSaving(true);
    setError("");
    const r = await apiFetch("/api/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), label: newLabel.trim(), color: newColor }),
    });
    setSaving(false);
    if (r.ok) {
      setAdding(false);
      setNewName(""); setNewLabel(""); setNewColor(PRESET_COLORS[0]!);
      await reloadEnvs();
    } else {
      const d = await r.json() as { error?: string };
      setError(d.error ?? "Failed to create");
    }
  };

  const startEdit = (e: Env) => {
    setEditing(e.id);
    setEditLabel(e.label);
    setEditColor(e.color);
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await apiFetch(`/api/environments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: editLabel, color: editColor }),
    });
    setSaving(false);
    setEditing(null);
    await reloadEnvs();
  };

  const deleteEnv = async (id: string, name: string) => {
    if (environments.length <= 1) { setError("Cannot delete last environment"); return; }
    const r = await apiFetch(`/api/environments/${id}`, { method: "DELETE" });
    if (r.ok) {
      if (env === name && environments.length > 1) {
        const next = environments.find(e => e.name !== name);
        if (next) setEnv(next.name);
      }
      await reloadEnvs();
    } else {
      const d = await r.json() as { error?: string };
      setError(d.error ?? "Delete failed");
    }
  };

  const moveOrder = async (id: string, direction: -1 | 1) => {
    const idx = environments.findIndex(e => e.id === id);
    if (idx < 0) return;
    const target = environments[idx + direction];
    if (!target) return;
    await apiFetch(`/api/environments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sortOrder: target.sortOrder }),
    });
    await apiFetch(`/api/environments/${target.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sortOrder: environments[idx]!.sortOrder }),
    });
    await reloadEnvs();
  };

  if (environments.length === 0 && !adding) {
    return (
      <div style={{ height: "100%", background: "#080808" }}>
        <EmptyState
          icon="⬢"
          title="No environments"
          description="Create your first environment to get started."
          ctaLabel="Create Environment"
          onCta={() => setAdding(true)}
        />
      </div>
    )
  }

  return (
    <div style={{ padding: 32, maxWidth: 640, color: "#e5e5e5", fontFamily: "monospace" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Environments</div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
            Define deployment environments. Connectors, metrics, alerts, and access are scoped per env.
          </div>
        </div>
        <button
          onClick={() => { setAdding(true); setError(""); }}
          style={{ padding: "6px 14px", background: "#10b981", border: "none", borderRadius: 4, color: "#000", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          + Add
        </button>
      </div>

      {error && <div style={{ padding: "8px 12px", background: "#1a0a0a", border: "1px solid #ef4444", borderRadius: 4, color: "#ef4444", fontSize: 12, marginBottom: 16 }}>{error}</div>}

      {/* Add form */}
      {adding && (
        <div style={{ padding: 16, background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: 6, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>New environment</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value.toLowerCase())}
                placeholder="name (e.g. staging)"
                style={{ flex: 1, padding: "6px 10px", background: "#111", border: "1px solid #2a2a2a", borderRadius: 4, color: "#e5e5e5", fontSize: 12 }}
              />
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Label (e.g. Staging)"
                style={{ flex: 1, padding: "6px 10px", background: "#111", border: "1px solid #2a2a2a", borderRadius: 4, color: "#e5e5e5", fontSize: 12 }}
              />
            </div>
            <ColorPicker value={newColor} onChange={setNewColor} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setAdding(false); setError(""); }} style={{ padding: "5px 12px", background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#888", fontSize: 11, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => void createEnv()} disabled={saving} style={{ padding: "5px 12px", background: "#10b981", border: "none", borderRadius: 3, color: "#000", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                {saving ? "…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Environments list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {environments.map((e, i) => (
          <div
            key={e.id}
            style={{ padding: "14px 16px", background: "#0a0a0a", border: `1px solid ${e.name === env ? e.color + "44" : "#1a1a1a"}`, borderRadius: 6, display: "flex", alignItems: "center", gap: 12 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                onClick={() => void moveOrder(e.id, -1)}
                disabled={i === 0}
                style={{ background: "transparent", border: "none", color: i === 0 ? "#222" : "#555", cursor: i === 0 ? "default" : "pointer", fontSize: 10, padding: "1px 3px", lineHeight: 1 }}
              >▲</button>
              <button
                onClick={() => void moveOrder(e.id, 1)}
                disabled={i === environments.length - 1}
                style={{ background: "transparent", border: "none", color: i === environments.length - 1 ? "#222" : "#555", cursor: i === environments.length - 1 ? "default" : "pointer", fontSize: 10, padding: "1px 3px", lineHeight: 1 }}
              >▼</button>
            </div>

            <div style={{ width: 10, height: 10, borderRadius: "50%", background: e.color, flexShrink: 0 }} />

            {editing === e.id ? (
              <div style={{ flex: 1, display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  autoFocus
                  value={editLabel}
                  onChange={ev => setEditLabel(ev.target.value)}
                  style={{ padding: "4px 8px", background: "#111", border: "1px solid #2a2a2a", borderRadius: 3, color: "#e5e5e5", fontSize: 12, width: 160 }}
                />
                <ColorPicker value={editColor} onChange={setEditColor} />
                <button onClick={() => void saveEdit(e.id)} disabled={saving} style={{ padding: "4px 10px", background: "#10b981", border: "none", borderRadius: 3, color: "#000", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Save</button>
                <button onClick={() => setEditing(null)} style={{ padding: "4px 10px", background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#888", fontSize: 11, cursor: "pointer" }}>Cancel</button>
              </div>
            ) : (
              <>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{e.label}</div>
                  <div style={{ fontSize: 11, color: "#555", marginTop: 1 }}>{e.name}</div>
                </div>
                {e.name === env && <span style={{ fontSize: 10, color: "#10b981", padding: "2px 7px", border: "1px solid #10b98133", borderRadius: 10 }}>active</span>}
                <button onClick={() => setEnv(e.name)} style={{ padding: "4px 10px", background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#888", fontSize: 11, cursor: "pointer" }}>Switch</button>
                <button onClick={() => startEdit(e)} style={{ padding: "4px 10px", background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#888", fontSize: 11, cursor: "pointer" }}>Rename</button>
                <button
                  onClick={() => void deleteEnv(e.id, e.name)}
                  style={{ padding: "4px 10px", background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#555", fontSize: 11, cursor: "pointer" }}
                >Delete</button>
              </>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: "12px 14px", background: "#080808", border: "1px solid #1a1a1a", borderRadius: 6, fontSize: 11, color: "#444", lineHeight: "1.6" }}>
        Environments are ordered. The first environment is the entry point for new promotion pipelines.
        Connectors can be configured per-environment — same connector type, different credentials and clusters.
        Access policies are also env-scoped.
      </div>
    </div>
  );
}
