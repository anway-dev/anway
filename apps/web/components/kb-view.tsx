"use client";
import { useState, useEffect, useMemo } from "react";

interface GraphEntity {
  id: string;
  name: string;
  type: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

interface GraphRel {
  fromEntityId: string;
  relType: string;
  toEntityId: string;
}

const TYPE_COLOR: Record<string, string> = {
  Service: "#10b981", Repo: "#3b82f6", Team: "#8b5cf6", Engineer: "#f59e0b",
  Ticket: "#ef4444", Deploy: "#f97316", Incident: "#ef4444", Alert: "#f59e0b",
  Pipeline: "#3b82f6", Connector: "#888", Namespace: "#8b5cf6", Dashboard: "#3b82f6",
  Commit: "#10b981", Project: "#8b5cf6",
};

const TYPE_ICON: Record<string, string> = {
  Service: "◉", Repo: "⌗", Team: "⬡", Engineer: "○", Ticket: "▤",
  Deploy: "⬆", Incident: "◎", Alert: "▲", Pipeline: "⇶", Connector: "⊕",
  Namespace: "▦", Dashboard: "⌇", Commit: "·", Project: "✦",
};

function typeColor(t: string): string { return TYPE_COLOR[t] ?? "#888"; }
function typeIcon(t: string): string { return TYPE_ICON[t] ?? "◌"; }

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function KbView() {
  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [relationships, setRelationships] = useState<GraphRel[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(['Service', 'Team']));

  useEffect(() => {
    fetch("/api/graph/entities")
      .then(r => r.json())
      .then((d: { entities?: GraphEntity[]; relationships?: GraphRel[] }) => {
        setEntities(d.entities ?? []);
        setRelationships(d.relationships ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const entityById = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return counts;
  }, [entities]);

  const types = useMemo(() => Object.keys(typeCounts).sort(), [typeCounts]);

  const visible = useMemo(() => {
    let list = typeFilter === "all" ? entities : entities.filter(e => e.type === typeFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q));
    }
    return list;
  }, [entities, typeFilter, search]);

  const grouped = useMemo(() => {
    const acc: Record<string, GraphEntity[]> = {};
    for (const e of entities) (acc[e.type] ??= []).push(e);
    return acc;
  }, [entities]);
  const sortedTypes = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  const selected = selectedId ? entityById.get(selectedId) : null;
  const outgoing = useMemo(() => selectedId ? relationships.filter(r => r.fromEntityId === selectedId) : [], [relationships, selectedId]);
  const incoming = useMemo(() => selectedId ? relationships.filter(r => r.toEntityId === selectedId) : [], [relationships, selectedId]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#080808", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px 12px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Knowledge Graph</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>Software Intelligence Graph</h2>
          <span style={{ fontSize: "12px", color: "#10b981", fontFamily: "monospace" }}>
            {entities.length} entities · {relationships.length} relationships
          </span>
        </div>
        <p style={{ fontSize: "12px", color: "#888", marginTop: "6px", maxWidth: "560px" }}>
          Entities and relationships extracted by the Graph Builder from connector events. Graph is the mandatory starting point for every investigation.
        </p>
      </div>

      {/* Type filter + search */}
      <div style={{ padding: "10px 24px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", flexShrink: 0, background: "#0a0a0a" }}>
        <button
          onClick={() => setTypeFilter("all")}
          style={{
            padding: "3px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "11px",
            border: typeFilter === "all" ? "1px solid #2a2a2a" : "1px solid #1a1a1a",
            background: typeFilter === "all" ? "#1a1a1a" : "transparent",
            color: typeFilter === "all" ? "#e5e5e5" : "#555",
          }}
        >
          All ({entities.length})
        </button>
        {types.map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            style={{
              padding: "3px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "11px",
              border: typeFilter === t ? `1px solid ${typeColor(t)}44` : "1px solid #1a1a1a",
              background: typeFilter === t ? `${typeColor(t)}15` : "transparent",
              color: typeFilter === t ? typeColor(t) : "#555",
              display: "flex", alignItems: "center", gap: "4px",
            }}
          >
            <span>{typeIcon(t)}</span>{t} ({typeCounts[t]})
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entities..."
          style={{ marginLeft: "auto", background: "#111", border: "1px solid #2a2a2a", color: "#e5e5e5", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", outline: "none", width: "200px" }}
        />
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: "12px" }}>
          Loading graph...
        </div>
      ) : entities.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          <div style={{ fontSize: "24px", color: "#2a2a2a" }}>◌</div>
          <div style={{ fontSize: "13px", color: "#555" }}>Knowledge graph is empty</div>
          <div style={{ fontSize: "11px", color: "#444", maxWidth: "360px", textAlign: "center", lineHeight: "1.6" }}>
            Connect a datasource in Connectors and run bootstrap. The Graph Builder will extract entities and relationships from connector events.
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Entity list */}
          <div style={{ width: selected ? "50%" : "100%", overflowY: "auto", padding: "12px 16px", borderRight: selected ? "1px solid #1a1a1a" : "none" }}>
            {visible.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#444", padding: "20px" }}>No entities match this filter.</div>
            ) : search.trim() ? (
              // Flat filtered list — when search is active
              visible.map(e => {
                const c = typeColor(e.type);
                const isSel = e.id === selectedId;
                const relCount = relationships.filter(r => r.fromEntityId === e.id || r.toEntityId === e.id).length;
                return (
                  <div
                    key={e.id}
                    onClick={() => setSelectedId(isSel ? null : e.id)}
                    style={{
                      background: isSel ? "#0e1a0e" : "#0e0e0e",
                      border: isSel ? "1px solid #2a3a2a" : "1px solid #1a1a1a",
                      borderLeft: `3px solid ${c}`,
                      borderRadius: "6px", padding: "10px 14px", marginBottom: "6px", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "10px",
                    }}
                  >
                    <span style={{ fontSize: "12px", color: c, flexShrink: 0 }}>{typeIcon(e.type)}</span>
                    <span style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.name}
                    </span>
                    <span style={{ fontSize: "10px", color: c, background: `${c}15`, border: `1px solid ${c}30`, borderRadius: "3px", padding: "1px 6px", flexShrink: 0 }}>
                      {e.type}
                    </span>
                    {relCount > 0 && (
                      <span style={{ fontSize: "10px", color: "#555", fontFamily: "monospace", flexShrink: 0 }}>
                        {relCount} link{relCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    <span style={{ fontSize: "10px", color: "#444", flexShrink: 0 }}>{timeAgo(e.updatedAt)}</span>
                  </div>
                );
              })
            ) : (
              // Tree layout grouped by entity type — when no search
              sortedTypes.map(type => {
                const items = grouped[type] ?? [];
                const expanded = expandedTypes.has(type);
                const c = typeColor(type);
                return (
                  <div key={type} style={{ marginBottom: "4px" }}>
                    <div
                      onClick={() => {
                        setExpandedTypes(prev => {
                          const next = new Set(prev);
                          if (next.has(type)) next.delete(type); else next.add(type);
                          return next;
                        });
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        padding: "6px 8px", background: "#0e0e0e", border: "1px solid #1a1a1a",
                        borderRadius: "4px", cursor: "pointer", marginBottom: "2px",
                      }}
                    >
                      <span style={{ fontSize: "10px", color: "#555", width: "14px" }}>
                        {expanded ? "▼" : "▶"}
                      </span>
                      <span style={{ fontSize: "12px", color: c }}>{typeIcon(type)}</span>
                      <span style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500 }}>{type}</span>
                      <span style={{ fontSize: "10px", color: "#555", marginLeft: "4px" }}>({items.length})</span>
                    </div>
                    {expanded && items.map(e => {
                      const isSel = e.id === selectedId;
                      const relCount = relationships.filter(r => r.fromEntityId === e.id || r.toEntityId === e.id).length;
                      return (
                        <div
                          key={e.id}
                          onClick={() => setSelectedId(isSel ? null : e.id)}
                          style={{
                            background: isSel ? "#0e1a0e" : "#0e0e0e",
                            border: isSel ? "1px solid #2a3a2a" : "1px solid #1a1a1a",
                            borderLeft: `3px solid ${c}`,
                            borderRadius: "6px", padding: "8px 14px", marginBottom: "4px", cursor: "pointer",
                            display: "flex", alignItems: "center", gap: "10px",
                            paddingLeft: "24px",
                          }}
                        >
                          <span style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {e.name}
                          </span>
                          {relCount > 0 && (
                            <span style={{ fontSize: "10px", color: "#555", fontFamily: "monospace", flexShrink: 0 }}>
                              {relCount} link{relCount !== 1 ? "s" : ""}
                            </span>
                          )}
                          <span style={{ fontSize: "10px", color: "#444", flexShrink: 0 }}>{timeAgo(e.updatedAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{ width: "50%", overflowY: "auto", padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "16px", color: typeColor(selected.type) }}>{typeIcon(selected.type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#e5e5e5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.name}</div>
                  <div style={{ fontSize: "11px", color: typeColor(selected.type) }}>{selected.type}</div>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#555", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "11px" }}
                >
                  ✕
                </button>
              </div>

              {/* Metadata */}
              {Object.keys(selected.metadata ?? {}).length > 0 && (
                <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px", padding: "12px 14px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Metadata</div>
                  {Object.entries(selected.metadata).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: "10px", marginBottom: "4px", fontSize: "11px" }}>
                      <span style={{ color: "#555", fontFamily: "monospace", flexShrink: 0, minWidth: "110px" }}>{k}</span>
                      <span style={{ color: "#888", fontFamily: "monospace", wordBreak: "break-all" }}>
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Relationships */}
              <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px", padding: "12px 14px" }}>
                <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                  Relationships ({outgoing.length + incoming.length})
                </div>
                {outgoing.length === 0 && incoming.length === 0 && (
                  <div style={{ fontSize: "11px", color: "#444" }}>No relationships recorded for this entity.</div>
                )}
                {outgoing.map((r, i) => {
                  const target = entityById.get(r.toEntityId);
                  return (
                    <div key={`o${i}`} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", fontSize: "11px" }}>
                      <span style={{ color: "#10b981", fontFamily: "monospace", flexShrink: 0 }}>→ {r.relType}</span>
                      <span
                        onClick={() => target && setSelectedId(target.id)}
                        style={{ color: target ? "#d1d5db" : "#555", cursor: target ? "pointer" : "default", textDecoration: target ? "underline dotted #2a2a2a" : "none" }}
                      >
                        {target?.name ?? r.toEntityId.slice(0, 8)}
                      </span>
                      {target && (
                        <span style={{ fontSize: "10px", color: typeColor(target.type) }}>{target.type}</span>
                      )}
                    </div>
                  );
                })}
                {incoming.map((r, i) => {
                  const source = entityById.get(r.fromEntityId);
                  return (
                    <div key={`i${i}`} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", fontSize: "11px" }}>
                      <span style={{ color: "#3b82f6", fontFamily: "monospace", flexShrink: 0 }}>← {r.relType}</span>
                      <span
                        onClick={() => source && setSelectedId(source.id)}
                        style={{ color: source ? "#d1d5db" : "#555", cursor: source ? "pointer" : "default", textDecoration: source ? "underline dotted #2a2a2a" : "none" }}
                      >
                        {source?.name ?? r.fromEntityId.slice(0, 8)}
                      </span>
                      {source && (
                        <span style={{ fontSize: "10px", color: typeColor(source.type) }}>{source.type}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: "10px", color: "#444", marginTop: "10px", fontFamily: "monospace" }}>
                id: {selected.id} · updated {timeAgo(selected.updatedAt)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
