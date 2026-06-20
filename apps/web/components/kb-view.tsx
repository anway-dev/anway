"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";

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

// ───────────────────────────────────────────────
// Force graph — pure DOM mutation, no react re-renders per frame
// ───────────────────────────────────────────────

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  label: string;
  type: string;
}

interface SimEdge {
  from: string;
  to: string;
  label: string;
}

function runForce(nodes: SimNode[], edges: SimEdge[], W: number, H: number) {
  const cx = W / 2, cy = H / 2;
  const REPEL = 3200;
  const SPRING_LEN = 100;
  const SPRING_K = 0.04;
  const GRAVITY = 0.003;
  const DAMP = 0.88;

  // Repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!, b = nodes[j]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = REPEL / (dist * dist);
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx -= fx; a.vy -= fy;
      b.vx += fx; b.vy += fy;
    }
  }

  // Spring
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const e of edges) {
    const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - SPRING_LEN) * SPRING_K;
    const fx = (dx / dist) * force, fy = (dy / dist) * force;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  // Gravity + integrate
  for (const n of nodes) {
    n.vx += (cx - n.x) * GRAVITY;
    n.vy += (cy - n.y) * GRAVITY;
    n.vx *= DAMP; n.vy *= DAMP;
    n.x += n.vx; n.y += n.vy;
    n.x = Math.max(n.r + 10, Math.min(W - n.r - 10, n.x));
    n.y = Math.max(n.r + 10, Math.min(H - n.r - 10, n.y));
  }
}

interface ForceGraphProps {
  entities: GraphEntity[];
  relationships: GraphRel[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function ForceGraph({ entities, relationships, selectedId, onSelect }: ForceGraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);

  // Mutable sim state
  const sim = useRef<{
    nodes: SimNode[];
    edges: SimEdge[];
    nodeEls: Map<string, SVGGElement>;
    edgeEls: Map<string, SVGLineElement>;
    edgeLabelEls: Map<string, SVGTextElement>;
    tx: number; ty: number; scale: number;
    running: boolean;
    raf: number;
    dragNode: string | null;
    panStart: { mx: number; my: number; tx: number; ty: number } | null;
    selectedId: string | null;
  }>({ nodes: [], edges: [], nodeEls: new Map(), edgeEls: new Map(), edgeLabelEls: new Map(),
       tx: 0, ty: 0, scale: 1, running: false, raf: 0,
       dragNode: null, panStart: null, selectedId: null });

  // Keep selectedId in sync without re-running effect
  useEffect(() => {
    sim.current.selectedId = selectedId;
    // Update node visual state
    for (const [id, el] of sim.current.nodeEls) {
      const node = sim.current.nodes.find(n => n.id === id);
      if (!node) continue;
      const circle = el.querySelector("circle");
      if (!circle) continue;
      const isSel = id === selectedId;
      circle.setAttribute("stroke-width", isSel ? "2" : "1");
      circle.setAttribute("stroke", isSel ? "#fff" : node.color + "66");
      circle.setAttribute("fill", isSel ? node.color + "33" : node.color + "1a");
      circle.setAttribute("r", isSel ? String(node.r + 2) : String(node.r));
    }
  }, [selectedId]);

  // Build + start simulation
  useEffect(() => {
    const s = sim.current;
    s.running = false;
    cancelAnimationFrame(s.raf);
    // Clear old SVG
    if (gRef.current) gRef.current.innerHTML = "";
    s.nodeEls.clear(); s.edgeEls.clear(); s.edgeLabelEls.clear();

    const W = wrapRef.current?.clientWidth ?? 800;
    const H = wrapRef.current?.clientHeight ?? 600;

    // Build nodes
    s.nodes = entities.map((e, i) => {
      const angle = (i / entities.length) * Math.PI * 2;
      const radius = Math.min(W, H) * 0.35;
      return {
        id: e.id,
        x: W / 2 + Math.cos(angle) * radius * (0.5 + Math.random() * 0.5),
        y: H / 2 + Math.sin(angle) * radius * (0.5 + Math.random() * 0.5),
        vx: 0, vy: 0,
        r: 14,
        color: typeColor(e.type),
        label: e.name,
        type: e.type,
      };
    });

    s.edges = relationships.map(r => ({
      from: r.fromEntityId,
      to: r.toEntityId,
      label: r.relType,
    }));

    // Edge group (render under nodes)
    const edgeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    gRef.current?.appendChild(edgeGroup);

    // Node group
    const nodeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    gRef.current?.appendChild(nodeGroup);

    // Create edge elements
    for (const e of s.edges) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("stroke", "#2a4a3a");
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-opacity", "0.7");
      edgeGroup.appendChild(line);
      s.edgeEls.set(`${e.from}→${e.to}`, line);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("fill", "#4a6a5a");
      text.setAttribute("font-size", "8");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("pointer-events", "none");
      text.textContent = e.label;
      edgeGroup.appendChild(text);
      s.edgeLabelEls.set(`${e.from}→${e.to}`, text);
    }

    // Create node elements
    for (const n of s.nodes) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("cursor", "pointer");

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("r", String(n.r));
      circle.setAttribute("fill", n.color + "1a");
      circle.setAttribute("stroke", n.color + "66");
      circle.setAttribute("stroke-width", "1");

      const icon = document.createElementNS("http://www.w3.org/2000/svg", "text");
      icon.setAttribute("text-anchor", "middle");
      icon.setAttribute("dominant-baseline", "central");
      icon.setAttribute("font-size", "10");
      icon.setAttribute("fill", n.color);
      icon.setAttribute("pointer-events", "none");
      icon.textContent = typeIcon(n.type);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("y", String(n.r + 10));
      label.setAttribute("font-size", "9");
      label.setAttribute("fill", "#888");
      label.setAttribute("pointer-events", "none");
      const labelText = n.label.length > 16 ? n.label.slice(0, 14) + "…" : n.label;
      label.textContent = labelText;

      g.appendChild(circle);
      g.appendChild(icon);
      g.appendChild(label);
      nodeGroup.appendChild(g);
      s.nodeEls.set(n.id, g);

      // Click
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const wasDrag = (g as unknown as { _dragged?: boolean })._dragged;
        if (wasDrag) { (g as unknown as { _dragged?: boolean })._dragged = false; return; }
        onSelect(s.selectedId === n.id ? null : n.id);
      });

      // Drag node
      let dragOffset = { x: 0, y: 0 };
      g.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        s.dragNode = n.id;
        (g as unknown as { _dragged?: boolean })._dragged = false;
        dragOffset = { x: n.x - (ev.clientX - (svgRef.current?.getBoundingClientRect().left ?? 0)) / s.scale + s.tx / s.scale,
                       y: n.y - (ev.clientY - (svgRef.current?.getBoundingClientRect().top ?? 0)) / s.scale + s.ty / s.scale };
      });
      g.addEventListener("mouseover", () => { circle.setAttribute("fill", n.color + "33"); });
      g.addEventListener("mouseout", () => {
        if (s.selectedId !== n.id) circle.setAttribute("fill", n.color + "1a");
      });
    }

    // Pan + zoom
    const svg = svgRef.current;
    if (!svg) return;

    const onMouseDown = (ev: MouseEvent) => {
      if (s.dragNode) return;
      s.panStart = { mx: ev.clientX, my: ev.clientY, tx: s.tx, ty: s.ty };
    };
    const onMouseMove = (ev: MouseEvent) => {
      if (s.dragNode) {
        const node = s.nodes.find(n => n.id === s.dragNode);
        if (!node) return;
        const rect = svg.getBoundingClientRect();
        node.x = (ev.clientX - rect.left - s.tx) / s.scale;
        node.y = (ev.clientY - rect.top - s.ty) / s.scale;
        node.vx = 0; node.vy = 0;
        const g = s.nodeEls.get(s.dragNode);
        if (g) (g as unknown as { _dragged?: boolean })._dragged = true;
        return;
      }
      if (!s.panStart) return;
      s.tx = s.panStart.tx + (ev.clientX - s.panStart.mx);
      s.ty = s.panStart.ty + (ev.clientY - s.panStart.my);
      applyTransform();
    };
    const onMouseUp = () => { s.dragNode = null; s.panStart = null; };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const delta = -ev.deltaY * 0.001;
      const newScale = Math.max(0.15, Math.min(4, s.scale * (1 + delta)));
      s.tx = mx - (mx - s.tx) * (newScale / s.scale);
      s.ty = my - (my - s.ty) * (newScale / s.scale);
      s.scale = newScale;
      applyTransform();
    };
    const onSvgClick = () => onSelect(null);

    svg.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("click", onSvgClick);

    function applyTransform() {
      if (gRef.current) gRef.current.setAttribute("transform", `translate(${s.tx},${s.ty}) scale(${s.scale})`);
    }

    // Animation loop
    let tick = 0;
    function loop() {
      if (!s.running) return;
      if (tick < 300) {
        // Cool down: run full simulation for first 300 frames, then idle
        runForce(s.nodes, s.edges, W, H);
      }
      tick++;

      // Update DOM
      for (const n of s.nodes) {
        const g = s.nodeEls.get(n.id);
        if (g) g.setAttribute("transform", `translate(${n.x},${n.y})`);
      }
      const nodeMap = new Map(s.nodes.map(n => [n.id, n]));
      for (const e of s.edges) {
        const key = `${e.from}→${e.to}`;
        const line = s.edgeEls.get(key);
        const lbl = s.edgeLabelEls.get(key);
        const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
        if (a && b && line) {
          line.setAttribute("x1", String(a.x)); line.setAttribute("y1", String(a.y));
          line.setAttribute("x2", String(b.x)); line.setAttribute("y2", String(b.y));
        }
        if (a && b && lbl) {
          lbl.setAttribute("x", String((a.x + b.x) / 2));
          lbl.setAttribute("y", String((a.y + b.y) / 2));
        }
      }

      s.raf = requestAnimationFrame(loop);
    }

    s.running = true;
    s.raf = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      cancelAnimationFrame(s.raf);
      svg.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("click", onSvgClick);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, relationships]);

  return (
    <div ref={wrapRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      <svg
        ref={svgRef}
        style={{ width: "100%", height: "100%", display: "block", background: "#080808", cursor: "grab" }}
      >
        <g ref={gRef} />
      </svg>
      {/* Zoom controls */}
      <div style={{ position: "absolute", bottom: "16px", right: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {[{ label: "+", delta: 0.2 }, { label: "−", delta: -0.2 }, { label: "⌖", delta: 0 }].map(({ label, delta }) => (
          <button
            key={label}
            onClick={() => {
              const s = sim.current;
              const W = wrapRef.current?.clientWidth ?? 800;
              const H = wrapRef.current?.clientHeight ?? 600;
              if (delta === 0) { s.tx = 0; s.ty = 0; s.scale = 1; }
              else { s.scale = Math.max(0.15, Math.min(4, s.scale * (1 + delta))); s.tx = W/2 - (W/2 - s.tx) * (1 + delta); s.ty = H/2 - (H/2 - s.ty) * (1 + delta); }
              if (gRef.current) gRef.current.setAttribute("transform", `translate(${s.tx},${s.ty}) scale(${s.scale})`);
            }}
            style={{ width: "28px", height: "28px", background: "#111", border: "1px solid #2a2a2a", color: "#888", borderRadius: "4px", cursor: "pointer", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Legend */}
      <div style={{ position: "absolute", top: "12px", left: "12px", display: "flex", flexDirection: "column", gap: "3px", background: "#0a0a0aaa", padding: "8px 10px", borderRadius: "6px", border: "1px solid #1a1a1a" }}>
        {Object.entries(TYPE_COLOR).slice(0, 8).map(([t, c]) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: c, flexShrink: 0 }} />
            <span style={{ fontSize: "9px", color: "#555" }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// Main KbView
// ───────────────────────────────────────────────

export function KbView() {
  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [relationships, setRelationships] = useState<GraphRel[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(['Service', 'Team']));
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");

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

  const handleSelect = useCallback((id: string | null) => setSelectedId(id), []);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#080808", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px 12px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Knowledge Graph</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>Software Intelligence Graph</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "12px", color: "#10b981", fontFamily: "monospace" }}>
              {entities.length} entities · {relationships.length} relationships
            </span>
            {/* View toggle */}
            <div style={{ display: "flex", border: "1px solid #2a2a2a", borderRadius: "5px", overflow: "hidden" }}>
              {(["graph", "list"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  style={{
                    padding: "3px 10px", background: viewMode === m ? "#1a1a1a" : "transparent",
                    border: "none", color: viewMode === m ? "#e5e5e5" : "#555",
                    cursor: "pointer", fontSize: "11px",
                  }}
                >
                  {m === "graph" ? "⬡ Graph" : "≡ List"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Type filter + search — list mode only */}
      {viewMode === "list" && (
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
      )}

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
      ) : viewMode === "graph" ? (
        // ─── Graph view ───
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <ForceGraph
            entities={entities}
            relationships={relationships}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
          {/* Detail panel slides in on node select */}
          {selected && (
            <div style={{ width: "280px", overflowY: "auto", padding: "16px", borderLeft: "1px solid #1a1a1a", flexShrink: 0, background: "#0a0a0a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "16px", color: typeColor(selected.type) }}>{typeIcon(selected.type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.name}</div>
                  <div style={{ fontSize: "11px", color: typeColor(selected.type) }}>{selected.type}</div>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#555", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "11px", flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>

              {Object.keys(selected.metadata ?? {}).length > 0 && (
                <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px", padding: "10px 12px", marginBottom: "10px" }}>
                  <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>Metadata</div>
                  {Object.entries(selected.metadata).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: "8px", marginBottom: "3px", fontSize: "10px" }}>
                      <span style={{ color: "#555", fontFamily: "monospace", flexShrink: 0, minWidth: "80px" }}>{k}</span>
                      <span style={{ color: "#888", fontFamily: "monospace", wordBreak: "break-all" }}>
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
                  Relationships ({outgoing.length + incoming.length})
                </div>
                {outgoing.length === 0 && incoming.length === 0 && (
                  <div style={{ fontSize: "10px", color: "#444" }}>No relationships recorded.</div>
                )}
                {outgoing.map((r, i) => {
                  const target = entityById.get(r.toEntityId);
                  return (
                    <div key={`o${i}`} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", fontSize: "10px" }}>
                      <span style={{ color: "#10b981", fontFamily: "monospace", flexShrink: 0 }}>→ {r.relType}</span>
                      <span onClick={() => target && setSelectedId(target.id)}
                        style={{ color: target ? "#d1d5db" : "#555", cursor: target ? "pointer" : "default" }}>
                        {target?.name ?? r.toEntityId.slice(0, 8)}
                      </span>
                    </div>
                  );
                })}
                {incoming.map((r, i) => {
                  const source = entityById.get(r.fromEntityId);
                  return (
                    <div key={`i${i}`} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", fontSize: "10px" }}>
                      <span style={{ color: "#3b82f6", fontFamily: "monospace", flexShrink: 0 }}>← {r.relType}</span>
                      <span onClick={() => source && setSelectedId(source.id)}
                        style={{ color: source ? "#d1d5db" : "#555", cursor: source ? "pointer" : "default" }}>
                        {source?.name ?? r.fromEntityId.slice(0, 8)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: "10px", color: "#333", marginTop: "8px", fontFamily: "monospace" }}>
                {timeAgo(selected.updatedAt)}
              </div>
            </div>
          )}
        </div>
      ) : (
        // ─── List view ───
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{ width: selected ? "50%" : "100%", overflowY: "auto", padding: "12px 16px", borderRight: selected ? "1px solid #1a1a1a" : "none" }}>
            {visible.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#444", padding: "20px" }}>No entities match this filter.</div>
            ) : search.trim() ? (
              visible.map(e => {
                const c = typeColor(e.type);
                const isSel = e.id === selectedId;
                const relCount = relationships.filter(r => r.fromEntityId === e.id || r.toEntityId === e.id).length;
                return (
                  <div key={e.id} onClick={() => setSelectedId(isSel ? null : e.id)}
                    style={{ background: isSel ? "#0e1a0e" : "#0e0e0e", border: isSel ? "1px solid #2a3a2a" : "1px solid #1a1a1a",
                      borderLeft: `3px solid ${c}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "6px", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "12px", color: c, flexShrink: 0 }}>{typeIcon(e.type)}</span>
                    <span style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                    <span style={{ fontSize: "10px", color: c, background: `${c}15`, border: `1px solid ${c}30`, borderRadius: "3px", padding: "1px 6px", flexShrink: 0 }}>{e.type}</span>
                    {relCount > 0 && <span style={{ fontSize: "10px", color: "#555", fontFamily: "monospace", flexShrink: 0 }}>{relCount} link{relCount !== 1 ? "s" : ""}</span>}
                    <span style={{ fontSize: "10px", color: "#444", flexShrink: 0 }}>{timeAgo(e.updatedAt)}</span>
                  </div>
                );
              })
            ) : (
              sortedTypes.map(type => {
                const items = grouped[type] ?? [];
                const expanded = expandedTypes.has(type);
                const c = typeColor(type);
                return (
                  <div key={type} style={{ marginBottom: "4px" }}>
                    <div onClick={() => { setExpandedTypes(prev => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; }); }}
                      style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 8px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "4px", cursor: "pointer", marginBottom: "2px" }}>
                      <span style={{ fontSize: "10px", color: "#555", width: "14px" }}>{expanded ? "▼" : "▶"}</span>
                      <span style={{ fontSize: "12px", color: c }}>{typeIcon(type)}</span>
                      <span style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500 }}>{type}</span>
                      <span style={{ fontSize: "10px", color: "#555", marginLeft: "4px" }}>({items.length})</span>
                    </div>
                    {expanded && items.map(e => {
                      const isSel = e.id === selectedId;
                      const relCount = relationships.filter(r => r.fromEntityId === e.id || r.toEntityId === e.id).length;
                      return (
                        <div key={e.id} onClick={() => setSelectedId(isSel ? null : e.id)}
                          style={{ background: isSel ? "#0e1a0e" : "#0e0e0e", border: isSel ? "1px solid #2a3a2a" : "1px solid #1a1a1a",
                            borderLeft: `3px solid ${c}`, borderRadius: "6px", padding: "8px 14px", marginBottom: "4px", cursor: "pointer",
                            display: "flex", alignItems: "center", gap: "10px", paddingLeft: "24px" }}>
                          <span style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                          {relCount > 0 && <span style={{ fontSize: "10px", color: "#555", fontFamily: "monospace", flexShrink: 0 }}>{relCount} link{relCount !== 1 ? "s" : ""}</span>}
                          <span style={{ fontSize: "10px", color: "#444", flexShrink: 0 }}>{timeAgo(e.updatedAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {selected && (
            <div style={{ width: "50%", overflowY: "auto", padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "16px", color: typeColor(selected.type) }}>{typeIcon(selected.type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#e5e5e5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.name}</div>
                  <div style={{ fontSize: "11px", color: typeColor(selected.type) }}>{selected.type}</div>
                </div>
                <button onClick={() => setSelectedId(null)}
                  style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#555", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "11px" }}>
                  ✕
                </button>
              </div>
              {Object.keys(selected.metadata ?? {}).length > 0 && (
                <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px", padding: "12px 14px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Metadata</div>
                  {Object.entries(selected.metadata).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: "10px", marginBottom: "4px", fontSize: "11px" }}>
                      <span style={{ color: "#555", fontFamily: "monospace", flexShrink: 0, minWidth: "110px" }}>{k}</span>
                      <span style={{ color: "#888", fontFamily: "monospace", wordBreak: "break-all" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px", padding: "12px 14px" }}>
                <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                  Relationships ({outgoing.length + incoming.length})
                </div>
                {outgoing.length === 0 && incoming.length === 0 && <div style={{ fontSize: "11px", color: "#444" }}>No relationships recorded.</div>}
                {outgoing.map((r, i) => {
                  const target = entityById.get(r.toEntityId);
                  return (
                    <div key={`o${i}`} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", fontSize: "11px" }}>
                      <span style={{ color: "#10b981", fontFamily: "monospace", flexShrink: 0 }}>→ {r.relType}</span>
                      <span onClick={() => target && setSelectedId(target.id)}
                        style={{ color: target ? "#d1d5db" : "#555", cursor: target ? "pointer" : "default", textDecoration: target ? "underline dotted #2a2a2a" : "none" }}>
                        {target?.name ?? r.toEntityId.slice(0, 8)}
                      </span>
                      {target && <span style={{ fontSize: "10px", color: typeColor(target.type) }}>{target.type}</span>}
                    </div>
                  );
                })}
                {incoming.map((r, i) => {
                  const source = entityById.get(r.fromEntityId);
                  return (
                    <div key={`i${i}`} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", fontSize: "11px" }}>
                      <span style={{ color: "#3b82f6", fontFamily: "monospace", flexShrink: 0 }}>← {r.relType}</span>
                      <span onClick={() => source && setSelectedId(source.id)}
                        style={{ color: source ? "#d1d5db" : "#555", cursor: source ? "pointer" : "default", textDecoration: source ? "underline dotted #2a2a2a" : "none" }}>
                        {source?.name ?? r.fromEntityId.slice(0, 8)}
                      </span>
                      {source && <span style={{ fontSize: "10px", color: typeColor(source.type) }}>{source.type}</span>}
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
