"use client";
import { EmptyState } from "@/components/empty-state"
import { FreshnessBadge } from "@/components/freshness-badge"
import { useState, useEffect } from "react";

interface ServiceMetrics { errorRate: number; p99ms: number; rps: number; uptime: number }

interface ServiceAPI {
  id: string
  name: string
  health: string
  language: string
  team: string
  oncall: string
  repo: string
  version: string
  lastDeploy: string
  description: string
  dependencies: string[]
  callers: string[]
  activeIncidents: number
  metrics: ServiceMetrics
}

interface IncidentAPI {
  id: string
  title: string
  status: string
  severity: string
  description?: string
  created_at: string
  resolved_at?: string | null
}

type HealthFilter = "all" | "healthy" | "degraded" | "down";

const HEALTH_COLOR: Record<string, string> = {
  healthy:  "#10b981",
  degraded: "#f59e0b",
  down:     "#ef4444",
};

const LANG_COLOR: Record<string, string> = {
  "TypeScript / Fastify": "#3b82f6",
  "TypeScript / Next.js": "#3b82f6",
  "Go":                   "#06b6d4",
  "Python / FastAPI":     "#8b5cf6",
};

interface Props {
  onTriggerOrchestrator: (query: string, context: { title: string; source: string }) => void;
  onGoToConnectors?: () => void;
}

function DepGraph({ svc, allServices }: { svc: ServiceAPI; allServices: ServiceAPI[] }) {
  const callers = allServices.filter(s => svc.callers.includes(s.name));
  const deps    = allServices.filter(s => svc.dependencies.includes(s.name));

  const BOX_W = 120, BOX_H = 36;
  const COL_LEFT = 20, COL_CENTER = 220, COL_RIGHT = 420;
  const CANVAS_H = Math.max(180, Math.max(callers.length, deps.length, 1) * 56 + 40);
  const CENTER_Y = CANVAS_H / 2;

  const callerPositions = callers.map((_, i) => ({
    x: COL_LEFT,
    y: callers.length === 1 ? CENTER_Y - BOX_H / 2 : CENTER_Y - ((callers.length - 1) * 52) / 2 + i * 52 - BOX_H / 2,
  }));
  const depPositions = deps.map((_, i) => ({
    x: COL_RIGHT,
    y: deps.length === 1 ? CENTER_Y - BOX_H / 2 : CENTER_Y - ((deps.length - 1) * 52) / 2 + i * 52 - BOX_H / 2,
  }));

  return (
    <div style={{ position: "relative", height: `${CANVAS_H}px`, background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 8, left: COL_LEFT + BOX_W / 2, transform: "translateX(-50%)", fontSize: "9px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        Callers
      </div>
      <div style={{ position: "absolute", top: 8, left: COL_CENTER + BOX_W / 2, transform: "translateX(-50%)", fontSize: "9px", color: "#10b981", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        This Service
      </div>
      {deps.length > 0 && (
        <div style={{ position: "absolute", top: 8, left: COL_RIGHT + BOX_W / 2, transform: "translateX(-50%)", fontSize: "9px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Dependencies
        </div>
      )}

      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
        {callerPositions.map((pos, i) => {
          const fromX = pos.x + BOX_W;
          const fromY = pos.y + BOX_H / 2;
          const toX   = COL_CENTER;
          const toY   = CENTER_Y;
          const mx = (fromX + toX) / 2;
          return (
            <path key={i} d={`M ${fromX} ${fromY} C ${mx} ${fromY}, ${mx} ${toY}, ${toX} ${toY}`}
              fill="none" stroke={HEALTH_COLOR[callers[i].health] ?? "#888"}
              strokeWidth="1" strokeDasharray={callers[i].health === "healthy" ? "none" : "4 2"} opacity="0.4"
            />
          );
        })}
        {depPositions.map((pos, i) => {
          const fromX = COL_CENTER + BOX_W;
          const fromY = CENTER_Y;
          const toX   = pos.x;
          const toY   = pos.y + BOX_H / 2;
          const mx = (fromX + toX) / 2;
          return (
            <path key={i} d={`M ${fromX} ${fromY} C ${mx} ${fromY}, ${mx} ${toY}, ${toX} ${toY}`}
              fill="none" stroke={HEALTH_COLOR[deps[i].health] ?? "#888"}
              strokeWidth="1" strokeDasharray={deps[i].health === "healthy" ? "none" : "4 2"} opacity="0.4"
            />
          );
        })}
      </svg>

      {callers.map((c, i) => (
        <div key={c.id} style={{
          position: "absolute", left: callerPositions[i].x, top: callerPositions[i].y,
          width: BOX_W, height: BOX_H, background: "#111",
          border: `1px solid ${HEALTH_COLOR[c.health] ?? "#888"}40`,
          borderRadius: "6px", display: "flex", alignItems: "center", padding: "0 8px", gap: "6px",
        }}>
          <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: HEALTH_COLOR[c.health] ?? "#888", flexShrink: 0 }} />
          <span style={{ fontSize: "10px", color: "#d1d5db", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
        </div>
      ))}

      <div style={{
        position: "absolute", left: COL_CENTER, top: CENTER_Y - BOX_H / 2,
        width: BOX_W, height: BOX_H, background: "#0a150e",
        border: "1px solid rgba(16,185,129,0.5)", borderRadius: "6px",
        display: "flex", alignItems: "center", padding: "0 10px", gap: "6px",
        boxShadow: "0 0 12px rgba(16,185,129,0.15)",
      }}>
        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: HEALTH_COLOR[svc.health] ?? "#888", flexShrink: 0 }} />
        <span style={{ fontSize: "11px", color: "#10b981", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{svc.name}</span>
      </div>

      {deps.map((d, i) => (
        <div key={d.id} style={{
          position: "absolute", left: depPositions[i].x, top: depPositions[i].y,
          width: BOX_W, height: BOX_H, background: "#111",
          border: `1px solid ${HEALTH_COLOR[d.health] ?? "#888"}40`,
          borderRadius: "6px", display: "flex", alignItems: "center", padding: "0 8px", gap: "6px",
        }}>
          <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: HEALTH_COLOR[d.health] ?? "#888", flexShrink: 0 }} />
          <span style={{ fontSize: "10px", color: "#d1d5db", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
        </div>
      ))}

      {callers.length === 0 && deps.length === 0 && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "11px", color: "#555" }}>No declared dependencies or callers</span>
        </div>
      )}
    </div>
  );
}

function incidentDuration(inc: IncidentAPI): string {
  const start = new Date(inc.created_at)
  const end = inc.resolved_at ? new Date(inc.resolved_at) : new Date()
  const mins = Math.floor((end.getTime() - start.getTime()) / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export function ServiceCatalog({ onTriggerOrchestrator, onGoToConnectors }: Props) {
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [services, setServices] = useState<ServiceAPI[]>([]);
  const [incidents, setIncidents] = useState<IncidentAPI[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [freshnessTimestamp, setFreshnessTimestamp] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/services').then(r => r.json() as Promise<{ data: ServiceAPI[]; nextCursor: string | null }>).catch(() => ({ data: [] as ServiceAPI[], nextCursor: null })),
      fetch('/api/incidents').then(r => r.json() as Promise<{ data: IncidentAPI[]; nextCursor: string | null }>).catch(() => ({ data: [] as IncidentAPI[], nextCursor: null })),
    ]).then(([svcRes, incRes]) => {
      const svcs = svcRes.data ?? []
      const incs = incRes.data ?? []
      setServices(svcs)
      setIncidents(incs)
      const degraded = svcs.find(s => s.health === 'degraded')
      setSelectedId(degraded?.id ?? svcs[0]?.id ?? '')
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    fetch("/api/connectors/catalog")
      .then(r => r.json() as Promise<Array<{ id: string; bootstrappedAt: string | null }>>)
      .then(list => {
        const dd = list.find(c => c.id === 'datadog')
        setFreshnessTimestamp(dd?.bootstrappedAt ?? null)
      })
      .catch(() => {})
  }, [])

  const handleRefresh = async () => {
    try {
      await fetch('/api/connectors/datadog/bootstrap', { method: 'POST' })
      setFreshnessTimestamp(new Date().toISOString())
    } catch { /* non-blocking */ }
  }

  const metricStatus = (v: number, warn: number, crit: number): string =>
    v >= crit ? "critical" : v >= warn ? "warning" : "ok";
  const metricColor = (s: string) =>
    s === "critical" ? "#ef4444" : s === "warning" ? "#f59e0b" : "#10b981";

  const filtered = healthFilter === "all"
    ? services
    : services.filter(s => s.health === healthFilter);

  const svc = services.find(s => s.id === selectedId) ?? services[0];

  const relatedIncidents = svc
    ? incidents.filter(i =>
        i.title.toLowerCase().includes(svc.name.toLowerCase()) ||
        (i.description ?? '').toLowerCase().includes(svc.name.toLowerCase())
      )
    : [];

  if (loading) {
    return (
      <div style={{ display: "flex", height: "100%", background: "#080808", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: "12px", color: "#444" }}>Loading service catalog…</span>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div style={{ height: "100%", background: "#080808" }}>
        <EmptyState
          icon="⬢"
          title="No services indexed"
          description="Connect GitHub or another source-control connector to index your services."
          ctaLabel="Connect GitHub"
          onCta={onGoToConnectors}
        />
      </div>
    )
  }

  return (
    <div style={{ display: "flex", height: "100%", background: "#080808", overflow: "hidden" }}>
      {/* Left panel */}
      <div style={{ width: "260px", flexShrink: 0, background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>Platform</div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5" }}>Service Catalog</div>
          <div style={{ fontSize: "11px", color: "#888", marginTop: "2px" }}>Entities · deps · health</div>
          <FreshnessBadge bootstrappedAt={freshnessTimestamp} onRefresh={handleRefresh} />
        </div>

        <div style={{ padding: "10px 12px", borderBottom: "1px solid #1a1a1a", display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {(["all", "healthy", "degraded", "down"] as HealthFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setHealthFilter(f)}
              style={{
                padding: "3px 8px", borderRadius: "10px", border: "1px solid",
                fontSize: "10px", cursor: "pointer", textTransform: "capitalize",
                background: healthFilter === f ? `${HEALTH_COLOR[f] ?? "#10b981"}15` : "transparent",
                color: healthFilter === f ? (HEALTH_COLOR[f] ?? "#10b981") : "#555",
                borderColor: healthFilter === f ? `${HEALTH_COLOR[f] ?? "#10b981"}40` : "#1a1a1a",
                fontWeight: healthFilter === f ? 600 : 400,
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              style={{
                display: "block", width: "100%", padding: "11px 14px", textAlign: "left",
                background: selectedId === s.id ? "#111" : "transparent",
                border: "none", borderBottom: "1px solid #111", cursor: "pointer",
                borderLeft: selectedId === s.id ? `2px solid ${HEALTH_COLOR[s.health] ?? "#888"}` : "2px solid transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
                <div style={{
                  width: "7px", height: "7px", borderRadius: "50%",
                  background: HEALTH_COLOR[s.health] ?? "#888", flexShrink: 0,
                  ...(s.health !== "healthy" ? { boxShadow: `0 0 6px ${HEALTH_COLOR[s.health]}` } : {}),
                }} />
                <span style={{ fontSize: "12px", color: "#e5e5e5", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </span>
                {s.activeIncidents > 0 && (
                  <span style={{ fontSize: "10px", background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", padding: "1px 5px", borderRadius: "10px", fontWeight: 700, flexShrink: 0 }}>
                    {s.activeIncidents}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingLeft: "14px" }}>
                <span style={{ fontSize: "9px", background: "#111", border: "1px solid #2a2a2a", color: "#666", padding: "1px 5px", borderRadius: "3px" }}>{s.team}</span>
                <span style={{ fontSize: "10px", color: "#444", fontFamily: "monospace" }}>{s.version}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel */}
      {svc && (
        <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a", display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5", fontFamily: "monospace" }}>{svc.name}</span>
                <span style={{
                  fontSize: "10px", fontWeight: 700, textTransform: "uppercase",
                  color: HEALTH_COLOR[svc.health] ?? "#888",
                  background: `${HEALTH_COLOR[svc.health] ?? "#888"}15`,
                  border: `1px solid ${HEALTH_COLOR[svc.health] ?? "#888"}40`,
                  padding: "2px 8px", borderRadius: "10px",
                }}>
                  {svc.health}
                </span>
                {svc.activeIncidents > 0 && (
                  <span style={{ fontSize: "10px", color: "#ef4444", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", padding: "2px 8px", borderRadius: "10px" }}>
                    {svc.activeIncidents} active incident{svc.activeIncidents > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "11px", color: "#888" }}>Team: <span style={{ color: "#d1d5db" }}>{svc.team}</span></span>
                <span style={{ fontSize: "11px", color: "#555" }}>·</span>
                <span style={{ fontSize: "11px", color: "#888" }}>Oncall: <span style={{ color: "#3b82f6" }}>{svc.oncall}</span></span>
                <span style={{ fontSize: "11px", color: "#555" }}>·</span>
                <span style={{ fontSize: "11px", color: "#888" }}>Repo: <span style={{ color: "#d1d5db", fontFamily: "monospace" }}>{svc.repo}</span></span>
                <span style={{ fontSize: "11px", color: "#555" }}>·</span>
                <span style={{ fontSize: "11px", color: "#888" }}>Lang: <span style={{ color: LANG_COLOR[svc.language] ?? "#888" }}>{svc.language}</span></span>
              </div>
            </div>
            <button
              onClick={() => onTriggerOrchestrator(
                `What is the current health and status of ${svc.name}?`,
                { title: svc.name, source: "service-catalog" }
              )}
              style={{ background: "#0a2a1a", border: "1px solid rgba(16,185,129,0.35)", color: "#10b981", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontWeight: 600, flexShrink: 0, display: "flex", alignItems: "center", gap: "4px" }}
            >
              <span style={{ fontSize: "10px" }}>✦</span> Investigate
            </button>
          </div>

          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            {svc.description && (
              <p style={{ fontSize: "12px", color: "#888", margin: 0, lineHeight: "1.6" }}>{svc.description}</p>
            )}

            <div>
              <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px", fontWeight: 600 }}>Dependency Graph</div>
              <DepGraph svc={svc} allServices={services} />
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px", fontWeight: 600 }}>Live Metrics</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                {[
                  { label: "Error Rate", value: `${svc.metrics.errorRate}%`, status: metricStatus(svc.metrics.errorRate, 1, 5) },
                  { label: "P99 Latency", value: `${svc.metrics.p99ms}ms`, status: metricStatus(svc.metrics.p99ms, 500, 2000) },
                  { label: "RPS", value: `${svc.metrics.rps}`, status: "ok" },
                  { label: "Uptime", value: `${svc.metrics.uptime}%`, status: svc.metrics.uptime < 99.9 ? "warning" : "ok" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#0e0e0e", border: `1px solid ${m.status === "ok" ? "#1a1a1a" : `${metricColor(m.status)}30`}`, borderRadius: "8px", padding: "12px 14px" }}>
                    <div style={{ fontSize: "10px", color: "#555", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.label}</div>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: metricColor(m.status), fontFamily: "monospace" }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontWeight: 600 }}>Recent Incidents</div>
                {relatedIncidents.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "#444" }}>No recent incidents.</div>
                ) : (
                  relatedIncidents.slice(0, 5).map(inc => (
                    <div key={inc.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", borderBottom: "1px solid #111" }}>
                      <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: inc.status === "active" ? "#ef4444" : "#10b981", flexShrink: 0 }} />
                      <span style={{ fontSize: "11px", color: "#888", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inc.title}</span>
                      <span style={{ fontSize: "10px", color: "#444" }}>{incidentDuration(inc)}</span>
                    </div>
                  ))
                )}
              </div>

              <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontWeight: 600 }}>Deploy Info</div>
                {[
                  ["Current version", svc.version],
                  ["Last deploy",     svc.lastDeploy],
                  ["Repo",            svc.repo],
                  ["Language",        svc.language],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #111", fontSize: "11px" }}>
                    <span style={{ color: "#555" }}>{k}</span>
                    <span style={{ color: "#d1d5db", fontFamily: ["Current version", "Repo"].includes(k) ? "monospace" : "inherit" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
