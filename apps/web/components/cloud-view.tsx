"use client";
import { EmptyState } from "@/components/empty-state"
import { FreshnessBadge } from "@/components/freshness-badge"
import { useState, useEffect } from "react";

type Tab = "overview" | "security" | "config" | "capacity";
type CloudFindingSeverity = "critical" | "high" | "medium" | "low";

interface CloudProvider {
  provider: string;
  label: string;
  icon: string;
  color: string;
  connected: boolean;
  resources: number;
  regions: number;
  criticalAlerts: number;
  securityFindings: number;
}

interface CloudResource {
  id: string;
  provider: string;
  name: string;
  type: string;
  service: string;
  region: string;
  status: string;
  metrics?: { cpu?: number; memory?: number; connections?: number; storage?: number };
}

interface CloudSecurityFinding {
  id: string;
  provider: string;
  title: string;
  service: string;
  resource: string;
  severity: CloudFindingSeverity;
  category: string;
  detail: string;
  detectedAt: string;
}

interface CloudConfigIssue {
  id: string;
  provider: string;
  issue: string;
  service: string;
  resource: string;
  severity: CloudFindingSeverity;
  recommendation: string;
}

interface CloudData {
  providers: CloudProvider[];
  resources: CloudResource[];
  security: CloudSecurityFinding[];
  config: CloudConfigIssue[];
}

const DEFAULT_PROVIDERS: CloudProvider[] = [
  { provider: "aws",   label: "Amazon Web Services",   icon: "AWS", color: "#ff9900", connected: false, resources: 0, regions: 0, criticalAlerts: 0, securityFindings: 0 },
  { provider: "gcp",   label: "Google Cloud Platform", icon: "GCP", color: "#4285f4", connected: false, resources: 0, regions: 0, criticalAlerts: 0, securityFindings: 0 },
  { provider: "azure", label: "Microsoft Azure",       icon: "AZ",  color: "#0078d4", connected: false, resources: 0, regions: 0, criticalAlerts: 0, securityFindings: 0 },
];

const SEV_COLOR: Record<CloudFindingSeverity, string> = {
  critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#555",
};

const STATUS_COLOR: Record<string, string> = {
  healthy: "#10b981", warning: "#f59e0b", critical: "#ef4444", unknown: "#555",
};

const CAT_ICON: Record<string, string> = {
  exposure: "⚠", misconfiguration: "⚙", vulnerability: "◎", compliance: "⊞",
};

function MetricBar({ value, warn = 70, crit = 85 }: { value: number; warn?: number; crit?: number }) {
  const color = value >= crit ? "#ef4444" : value >= warn ? "#f59e0b" : "#10b981";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div style={{ flex: 1, height: "4px", background: "#1a1a1a", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: "2px", transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: "10px", color, fontFamily: "monospace", minWidth: "30px", textAlign: "right" }}>{value}%</span>
    </div>
  );
}

function ResourceRow({ r, onDebug }: { r: CloudResource; onDebug: (msg: string) => void }) {
  const isHot = r.metrics && (
    (r.metrics.cpu ?? 0) >= 70 || (r.metrics.memory ?? 0) >= 80 || (r.metrics.connections ?? 0) >= 85
  );
  return (
    <div style={{
      padding: "10px 16px", borderBottom: "1px solid #111",
      display: "flex", alignItems: "center", gap: "12px", fontSize: "11px",
      background: isHot ? "rgba(239,68,68,0.03)" : "transparent",
    }}>
      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: STATUS_COLOR[r.status] ?? "#555", flexShrink: 0 }} />
      <span style={{ color: "#555", minWidth: "80px" }}>{r.service}</span>
      <span style={{ color: "#d1d5db", minWidth: "180px", fontFamily: "monospace", fontSize: "11px" }}>{r.name}</span>
      <span style={{ color: "#555", minWidth: "100px" }}>{r.type}</span>
      <span style={{ color: "#444", minWidth: "90px" }}>{r.region}</span>
      <div style={{ flex: 1, display: "flex", gap: "12px" }}>
        {r.metrics?.cpu !== undefined && (
          <div style={{ minWidth: "90px" }}>
            <div style={{ fontSize: "9px", color: "#444", marginBottom: "2px" }}>CPU</div>
            <MetricBar value={r.metrics.cpu} />
          </div>
        )}
        {r.metrics?.memory !== undefined && (
          <div style={{ minWidth: "90px" }}>
            <div style={{ fontSize: "9px", color: "#444", marginBottom: "2px" }}>MEM</div>
            <MetricBar value={r.metrics.memory} warn={80} crit={90} />
          </div>
        )}
        {r.metrics?.connections !== undefined && (
          <div style={{ minWidth: "90px" }}>
            <div style={{ fontSize: "9px", color: "#444", marginBottom: "2px" }}>CONN</div>
            <MetricBar value={r.metrics.connections} warn={75} crit={90} />
          </div>
        )}
        {r.metrics?.storage !== undefined && (
          <div style={{ minWidth: "90px" }}>
            <div style={{ fontSize: "9px", color: "#444", marginBottom: "2px" }}>DISK</div>
            <MetricBar value={r.metrics.storage} warn={70} crit={85} />
          </div>
        )}
      </div>
      {isHot && (
        <button
          onClick={() => onDebug(`Why is ${r.name} (${r.service}) showing high utilization? Walk me through the metrics trend, likely cause, and recommended action.`)}
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", padding: "3px 8px", borderRadius: "4px", fontSize: "10px", cursor: "pointer", flexShrink: 0, fontWeight: 600 }}
        >
          Debug ✦
        </button>
      )}
    </div>
  );
}

function SecurityRow({ f, onDebug }: { f: CloudSecurityFinding; onDebug: (msg: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px", marginBottom: "6px", overflow: "hidden", borderLeft: `3px solid ${SEV_COLOR[f.severity]}` }}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: "12px", color: SEV_COLOR[f.severity] }}>{CAT_ICON[f.category] ?? "⚠"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500 }}>{f.title}</div>
          <div style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}>
            {f.service} · <span style={{ fontFamily: "monospace" }}>{f.resource}</span> · {f.detectedAt}
          </div>
        </div>
        <span style={{ fontSize: "9px", fontWeight: 700, color: SEV_COLOR[f.severity], background: `${SEV_COLOR[f.severity]}15`, border: `1px solid ${SEV_COLOR[f.severity]}30`, borderRadius: "3px", padding: "1px 6px", flexShrink: 0, textTransform: "uppercase" }}>
          {f.severity}
        </span>
        <span style={{ fontSize: "9px", color: "#555", textTransform: "capitalize", flexShrink: 0, minWidth: "80px" }}>{f.category}</span>
        <span style={{ color: "#444", fontSize: "11px" }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "0 14px 12px", borderTop: "1px solid #111" }}>
          <div style={{ paddingTop: "10px", fontSize: "11px", color: "#888", lineHeight: "1.7", marginBottom: "10px" }}>{f.detail}</div>
          <button
            onClick={() => onDebug(`Security finding: "${f.title}" on ${f.resource}. Why is this a risk, what's the blast radius, and what are the exact remediation steps?`)}
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444", padding: "4px 10px", borderRadius: "4px", fontSize: "10px", cursor: "pointer", fontWeight: 600 }}
          >
            Why this matters + how to fix ✦
          </button>
        </div>
      )}
    </div>
  );
}

function ConfigRow({ c, onDebug }: { c: CloudConfigIssue; onDebug: (msg: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "6px", marginBottom: "6px", overflow: "hidden", borderLeft: `3px solid ${SEV_COLOR[c.severity]}` }}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500 }}>{c.issue}</div>
          <div style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}>
            {c.service} · <span style={{ fontFamily: "monospace" }}>{c.resource}</span>
          </div>
        </div>
        <span style={{ fontSize: "9px", fontWeight: 700, color: SEV_COLOR[c.severity], background: `${SEV_COLOR[c.severity]}15`, border: `1px solid ${SEV_COLOR[c.severity]}30`, borderRadius: "3px", padding: "1px 6px", flexShrink: 0, textTransform: "uppercase" }}>
          {c.severity}
        </span>
        <span style={{ color: "#444", fontSize: "11px" }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "0 14px 12px", borderTop: "1px solid #111" }}>
          <div style={{ paddingTop: "10px", fontSize: "11px", color: "#888", lineHeight: "1.7", marginBottom: "8px" }}>
            <span style={{ color: "#10b981", fontWeight: 600 }}>Fix: </span>{c.recommendation}
          </div>
          <button
            onClick={() => onDebug(`Config issue: "${c.issue}" on ${c.resource} (${c.service}). Explain why this matters and give me exact CLI commands to remediate.`)}
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981", padding: "4px 10px", borderRadius: "4px", fontSize: "10px", cursor: "pointer", fontWeight: 600 }}
          >
            Why + debug steps ✦
          </button>
        </div>
      )}
    </div>
  );
}

export function CloudView({ onTriggerOrchestrator, onGoToConnectors }: {
  onTriggerOrchestrator?: (query: string, context: { title: string; source: string }) => void;
  onGoToConnectors?: () => void;
}) {
  const [provider, setProvider] = useState<string>("aws");
  const [tab, setTab] = useState<Tab>("overview");
  const [cloudData, setCloudData] = useState<CloudData>({ providers: DEFAULT_PROVIDERS, resources: [], security: [], config: [] });
  const [loading, setLoading] = useState(true);
  const [freshnessTimestamp, setFreshnessTimestamp] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cloud/resources")
      .then(r => r.ok ? r.json() as Promise<CloudData> : null)
      .then(data => {
        if (!data) return;
        // Merge real provider data with defaults (ensure all 3 providers always show)
        const realByProvider = new Map(data.providers.map(p => [p.provider, p]));
        const merged = DEFAULT_PROVIDERS.map(def => realByProvider.get(def.provider) ?? def);
        setCloudData({ ...data, providers: merged });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/connectors/catalog")
      .then(r => r.json() as Promise<Array<{ id: string; bootstrappedAt: string | null }>>)
      .then(list => {
        const cw = list.find(c => c.id === 'aws-cloudwatch')
        setFreshnessTimestamp(cw?.bootstrappedAt ?? null)
      })
      .catch(() => {})
  }, [])

  const handleRefresh = async () => {
    try {
      await fetch('/api/connectors/aws-cloudwatch/bootstrap', { method: 'POST' })
      setFreshnessTimestamp(new Date().toISOString())
    } catch { /* non-blocking */ }
  }

  const pSummary = cloudData.providers.find(p => p.provider === provider) ?? DEFAULT_PROVIDERS[0]!;
  const resources = cloudData.resources.filter(r => r.provider === provider);
  const security = cloudData.security.filter(f => f.provider === provider);
  const config = cloudData.config.filter(c => c.provider === provider);
  const hotResources = resources.filter(r =>
    r.metrics && ((r.metrics.cpu ?? 0) >= 70 || (r.metrics.memory ?? 0) >= 80 || (r.metrics.connections ?? 0) >= 85)
  );

  const handleDebug = (query: string) => {
    onTriggerOrchestrator?.(query, { title: "Cloud Health", source: "Cloud" });
  };

  const criticalSec = security.filter(f => f.severity === "critical").length;
  const highSec = security.filter(f => f.severity === "high").length;
  const criticalCfg = config.filter(c => c.severity === "critical").length;
  const highCfg = config.filter(c => c.severity === "high").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#080808" }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Left: provider selector */}
        <div style={{ width: "220px", flexShrink: 0, background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px", borderBottom: "1px solid #1a1a1a" }}>
            <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Cloud Health</div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5" }}>Infrastructure</div>
            <FreshnessBadge bootstrappedAt={freshnessTimestamp} onRefresh={handleRefresh} />
          </div>
          <div style={{ padding: "12px", flex: 1 }}>
            <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>Providers</div>
            {loading ? (
              <div style={{ fontSize: "12px", color: "#555", padding: "8px" }}>Loading…</div>
            ) : cloudData.providers.map(p => (
              <button
                key={p.provider}
                onClick={() => setProvider(p.provider)}
                style={{
                  display: "flex", alignItems: "center", gap: "10px", width: "100%",
                  padding: "10px 10px", borderRadius: "6px",
                  border: provider === p.provider ? `1px solid ${p.color}33` : "1px solid #1a1a1a",
                  background: provider === p.provider ? `${p.color}10` : "#0e0e0e",
                  cursor: "pointer", textAlign: "left", marginBottom: "4px",
                }}
              >
                <div style={{
                  width: "28px", height: "28px", borderRadius: "5px",
                  background: `${p.color}22`, border: `1px solid ${p.color}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "8px", fontWeight: 800, color: p.color, fontFamily: "monospace", flexShrink: 0,
                }}>
                  {p.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", color: "#d1d5db", fontWeight: 500 }}>{p.icon}</div>
                  {p.connected ? (
                    <div style={{ fontSize: "10px", color: "#555" }}>{p.resources} resources · {p.regions} regions</div>
                  ) : (
                    <div style={{ fontSize: "10px", color: "#555" }}>Not connected</div>
                  )}
                </div>
                {p.connected && (p.criticalAlerts > 0 || p.securityFindings > 0) && (
                  <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 4px #ef4444", flexShrink: 0 }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: main content */}
        {!pSummary.connected ? (
          <div style={{ flex: 1 }}>
            <EmptyState
              icon="☁"
              title="No cloud accounts connected"
              description="Connect AWS, GCP, or Azure to view resources and security findings."
              ctaLabel="Connect a connector"
              onCta={onGoToConnectors}
            />
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: "24px" }}>
              <div>
                <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>{pSummary.label}</div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#e5e5e5" }}>Infrastructure Health</div>
              </div>
              <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
                {hotResources.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "5px", padding: "4px 10px" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ef4444" }} />
                    <span style={{ fontSize: "11px", color: "#ef4444", fontWeight: 700 }}>{hotResources.length} near limit</span>
                  </div>
                )}
                {(criticalSec + highSec) > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "5px", padding: "4px 10px" }}>
                    <span style={{ fontSize: "11px", color: "#f59e0b", fontWeight: 700 }}>{criticalSec + highSec} security</span>
                  </div>
                )}
                {(criticalCfg + highCfg) > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: "5px", padding: "4px 10px" }}>
                    <span style={{ fontSize: "11px", color: "#3b82f6", fontWeight: 700 }}>{criticalCfg + highCfg} config</span>
                  </div>
                )}
                <button
                  onClick={() => handleDebug(`Give me a full cloud health summary for ${pSummary.label}: what's at risk, what's about to break, top security concerns, and recommended priority actions.`)}
                  style={{ background: "#10b981", border: "none", color: "#000", padding: "5px 12px", borderRadius: "5px", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
                >
                  Ask Orchestrator ✦
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #1a1a1a", padding: "0 24px" }}>
              {([
                ["overview", "Overview", resources.length],
                ["capacity", "Capacity", hotResources.length],
                ["security", "Security", security.length],
                ["config", "Config Issues", config.length],
              ] as [Tab, string, number][]).map(([id, label, count]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  style={{
                    padding: "10px 16px", background: "none", border: "none", cursor: "pointer",
                    color: tab === id ? "#e5e5e5" : "#555", fontSize: "12px",
                    fontWeight: tab === id ? 600 : 400,
                    borderBottom: tab === id ? "2px solid #10b981" : "2px solid transparent",
                    display: "flex", alignItems: "center", gap: "6px",
                  }}
                >
                  {label}
                  {count > 0 && (
                    <span style={{
                      fontSize: "10px",
                      background: (id === "security" && criticalSec > 0) || (id === "capacity" && hotResources.length > 0) ? "rgba(239,68,68,0.15)" : "#1a1a1a",
                      color: (id === "security" && criticalSec > 0) || (id === "capacity" && hotResources.length > 0) ? "#ef4444" : "#555",
                      border: "1px solid #2a2a2a", borderRadius: "10px", padding: "0 5px",
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {tab === "overview" && (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", padding: "16px 24px" }}>
                    {[
                      ["Resources", pSummary.resources, "#e5e5e5"],
                      ["Regions", pSummary.regions, "#3b82f6"],
                      ["Near Limit", hotResources.length, hotResources.length > 0 ? "#ef4444" : "#10b981"],
                      ["Alerts Active", pSummary.criticalAlerts, pSummary.criticalAlerts > 0 ? "#ef4444" : "#10b981"],
                    ].map(([label, val, color]) => (
                      <div key={String(label)} style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "14px 16px" }}>
                        <div style={{ fontSize: "22px", fontWeight: 700, color: color as string }}>{val}</div>
                        <div style={{ fontSize: "11px", color: "#555", marginTop: "4px" }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  {resources.length === 0 ? (
                    <div style={{ padding: "40px 24px", textAlign: "center", color: "#555", fontSize: "12px" }}>
                      Connected — bootstrapping cloud resources. This may take a minute.
                    </div>
                  ) : (
                    <div style={{ margin: "0 24px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", overflow: "hidden" }}>
                      <div style={{ padding: "10px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", gap: "12px", fontSize: "10px", color: "#444" }}>
                        <span style={{ width: "8px" }} />
                        <span style={{ minWidth: "80px" }}>SERVICE</span>
                        <span style={{ minWidth: "180px" }}>NAME</span>
                        <span style={{ minWidth: "100px" }}>TYPE</span>
                        <span style={{ minWidth: "90px" }}>REGION</span>
                        <span>UTILIZATION</span>
                      </div>
                      {resources.map(r => <ResourceRow key={r.id} r={r} onDebug={handleDebug} />)}
                    </div>
                  )}
                  <div style={{ height: "24px" }} />
                </div>
              )}

              {tab === "capacity" && (
                <div style={{ padding: "16px 24px" }}>
                  <div style={{ fontSize: "12px", color: "#555", marginBottom: "16px", lineHeight: "1.6" }}>
                    Resources with any metric ≥ 70% CPU · 80% memory · 85% connections. Action before these hit limit.
                  </div>
                  {hotResources.length === 0 ? (
                    <div style={{ color: "#555", fontSize: "12px", textAlign: "center", padding: "40px" }}>All resources within safe thresholds</div>
                  ) : (
                    <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", overflow: "hidden" }}>
                      <div style={{ padding: "10px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", gap: "12px", fontSize: "10px", color: "#444" }}>
                        <span style={{ width: "8px" }} />
                        <span style={{ minWidth: "80px" }}>SERVICE</span>
                        <span style={{ minWidth: "180px" }}>NAME</span>
                        <span style={{ minWidth: "100px" }}>TYPE</span>
                        <span style={{ minWidth: "90px" }}>REGION</span>
                        <span>UTILIZATION</span>
                      </div>
                      {hotResources.map(r => <ResourceRow key={r.id} r={r} onDebug={handleDebug} />)}
                    </div>
                  )}
                </div>
              )}

              {tab === "security" && (
                <div style={{ padding: "16px 24px" }}>
                  {criticalSec > 0 && (
                    <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", fontSize: "11px", color: "#ef4444" }}>
                      ⚠ {criticalSec} critical finding{criticalSec > 1 ? "s" : ""} — active exposure risk. Remediate immediately.
                    </div>
                  )}
                  {security.length === 0 ? (
                    <div style={{ color: "#555", fontSize: "12px", textAlign: "center", padding: "40px" }}>No security findings</div>
                  ) : security.map(f => <SecurityRow key={f.id} f={f} onDebug={handleDebug} />)}
                </div>
              )}

              {tab === "config" && (
                <div style={{ padding: "16px 24px" }}>
                  <div style={{ fontSize: "12px", color: "#555", marginBottom: "14px", lineHeight: "1.6" }}>
                    Misconfigurations that increase risk, cost, or blast radius over time.
                  </div>
                  {config.length === 0 ? (
                    <div style={{ color: "#555", fontSize: "12px", textAlign: "center", padding: "40px" }}>No config issues detected</div>
                  ) : config.map(c => <ConfigRow key={c.id} c={c} onDebug={handleDebug} />)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
