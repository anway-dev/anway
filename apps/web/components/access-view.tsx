"use client";
import { useState, useEffect } from "react";

const ROLE_COLORS: Record<string, string> = {
  dev: "#3b82f6",
  sre: "#ef4444",
  pm: "#8b5cf6",
  ba: "#f59e0b",
  admin: "#10b981",
};

const MODE_CONFIG: Record<string, { label: string; color: string }> = {
  "read-write": { label: "R/W", color: "#10b981" },
  "read":       { label: "R",   color: "#3b82f6" },
  "none":       { label: "—",   color: "#444" },
};

const CONNECTOR_ICON: Record<string, { icon: string; color: string }> = {
  github: { icon: "GH", color: "#6e7681" },
  datadog: { icon: "DD", color: "#7c3aed" },
  loki: { icon: "LK", color: "#f9a825" },
  k8s: { icon: "K8", color: "#326ce5" },
  argocd: { icon: "AC", color: "#ef7b4d" },
  linear: { icon: "LN", color: "#5e6ad2" },
  prometheus: { icon: "PM", color: "#e6522c" },
  pagerduty: { icon: "PD", color: "#06ac38" },
  slack: { icon: "SL", color: "#4a154b" },
  jira: { icon: "JR", color: "#0052cc" },
  sentry: { icon: "SN", color: "#fb4226" },
  grafana: { icon: "GF", color: "#f46800" },
};

const YAML_TEMPLATE = `# Anway access provisioning template
# Apply via: anway access apply -f access.yaml

user: alice
workspace: [your-workspace-slug]
auth_role: dev

connectors:
  github:
    mode: read-write
    read_scope:
      - "org/*"
    write_scope:
      - "org/payments-service"
      - "org/catalog-service"

  datadog:
    mode: read
    read_scope:
      - "*"

  loki:
    mode: read
    read_scope:
      - "namespace/payments"
      - "namespace/catalog"

  k8s-prod:
    mode: read
    read_scope:
      - "namespace/payments"
    # write disabled — requires sre role

  argocd:
    mode: none
    # no access — requires sre or admin role`;

interface ApiUser {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

interface PerimeterEntry {
  connectorName: string;
  readScopes: string[];
  writeScopes: string[];
}

function ScopeChips({ scopes, color }: { scopes: string[]; color: string }) {
  if (scopes.length === 0) return <span style={{ fontSize: "10px", color: "#333" }}>—</span>;
  return (
    <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
      {scopes.map((s) => (
        <span key={s} style={{
          fontSize: "10px", background: `${color}11`, border: `1px solid ${color}22`,
          color, padding: "1px 6px", borderRadius: "3px", fontFamily: "monospace",
        }}>
          {s}
        </span>
      ))}
    </div>
  );
}

function ConnectorPerimeterRow({ entry }: { entry: PerimeterEntry }) {
  const iconInfo = CONNECTOR_ICON[entry.connectorName.toLowerCase()] ?? { icon: entry.connectorName.slice(0, 2).toUpperCase(), color: "#888" };
  const hasWrite = entry.writeScopes.length > 0;
  const mode = hasWrite ? "read-write" : "read";
  const mc = MODE_CONFIG[mode];

  return (
    <tr style={{ borderBottom: "1px solid #111" }}>
      <td style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "26px", height: "26px", borderRadius: "6px",
            background: `${iconInfo.color}18`, border: `1px solid ${iconInfo.color}33`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "10px", color: iconInfo.color, fontWeight: 700, flexShrink: 0,
          }}>
            {iconInfo.icon}
          </div>
          <span style={{ fontSize: "12px", color: "#d1d5db" }}>{entry.connectorName}</span>
        </div>
      </td>
      <td style={{ padding: "10px 14px" }}>
        <span style={{
          fontSize: "11px", padding: "2px 8px", borderRadius: "4px", fontWeight: 700,
          background: `${mc.color}18`, border: `1px solid ${mc.color}33`, color: mc.color,
          fontFamily: "monospace",
        }}>
          {mc.label}
        </span>
      </td>
      <td style={{ padding: "10px 14px" }}>
        <ScopeChips scopes={entry.readScopes} color="#3b82f6" />
      </td>
      <td style={{ padding: "10px 14px" }}>
        <ScopeChips scopes={entry.writeScopes} color="#10b981" />
      </td>
      <td style={{ padding: "10px 14px" }}>
        <span style={{
          fontSize: "10px", padding: "1px 6px", borderRadius: "3px",
          background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981",
        }}>
          active
        </span>
      </td>
      <td style={{ padding: "10px 14px" }}>
        <button style={{
          background: "transparent", border: "1px solid #2a2a2a", color: "#555",
          padding: "3px 8px", borderRadius: "4px", fontSize: "10px", cursor: "pointer",
        }}>
          Edit
        </button>
      </td>
    </tr>
  );
}

const CONNECTOR_DEFAULT_CAPS: Record<string, { read: string[]; write: string[] }> = {
  github:         { read: ["org/*"], write: [] },
  datadog:        { read: ["*"], write: [] },
  loki:           { read: ["*"], write: [] },
  k8s:            { read: ["*"], write: ["deployments/*"] },
  argocd:         { read: ["*"], write: ["apps/*"] },
  linear:         { read: ["team-*/*"], write: [] },
  prometheus:     { read: ["*"], write: [] },
  pagerduty:      { read: ["*"], write: ["incidents/*"] },
  slack:          { read: ["*"], write: ["channels/*"] },
  jira:           { read: ["*"], write: [] },
  sentry:         { read: ["*"], write: [] },
  coralogix:      { read: ["*"], write: [] },
  notion:         { read: ["*"], write: [] },
  confluence:     { read: ["*"], write: [] },
  grafana:        { read: ["*"], write: [] },
  elastic:        { read: ["*"], write: [] },
  dynatrace:      { read: ["*"], write: [] },
  newrelic:       { read: ["*"], write: [] },
  jenkins:        { read: ["*"], write: [] },
  circleci:       { read: ["*"], write: [] },
  vercel:         { read: ["*"], write: [] },
  terraform:      { read: ["*"], write: [] },
  vault:          { read: ["*"], write: [] },
  snyk:           { read: ["*"], write: [] },
  sonarqube:      { read: ["*"], write: [] },
  opsgenie:       { read: ["*"], write: ["alerts/*"] },
  launchdarkly:   { read: ["*"], write: [] },
  eks:            { read: ["*"], write: [] },
  gke:            { read: ["*"], write: [] },
  "aws-cloudwatch": { read: ["*"], write: [] },
  "aws-health":     { read: ["*"], write: [] },
  "gcp-monitoring": { read: ["*"], write: [] },
  "azure-monitor":  { read: ["*"], write: [] },
}

interface ConnectorConfigRow { connectorType: string; enabled: boolean }

function ManifestSection({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const [manifests, setManifests] = useState<ConnectorConfigRow[]>([]);

  useEffect(() => {
    if (!expanded) return;
    fetch("/api/settings/connectors")
      .then(r => r.json() as Promise<ConnectorConfigRow[]>)
      .then(list => setManifests(list.filter(c => c.enabled)))
      .catch(() => {});
  }, [expanded]);

  const entries = manifests.length > 0 ? manifests : [];

  return (
    <div style={{ marginTop: "16px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px" }}>
      <div
        onClick={onToggle}
        style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div style={{ fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Connector Capability Manifest
        </div>
        <span style={{ color: "#555", fontSize: "11px" }}>{expanded ? "▴" : "▾"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "0 16px 16px" }}>
          {entries.length === 0 && (
            <div style={{ fontSize: "11px", color: "#555", padding: "8px 0" }}>No connectors enabled yet.</div>
          )}
          {entries.map((m) => {
            const iconDef = CONNECTOR_ICON[m.connectorType] ?? { icon: m.connectorType.slice(0, 2).toUpperCase(), color: "#888" };
            const caps = CONNECTOR_DEFAULT_CAPS[m.connectorType] ?? { read: ["*"], write: [] };
            return (
              <div key={m.connectorType} style={{ marginBottom: "10px", background: "#111", border: "1px solid #1a1a1a", borderRadius: "6px", padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <div style={{
                    width: "22px", height: "22px", borderRadius: "4px",
                    background: `${iconDef.color}18`, border: `1px solid ${iconDef.color}33`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "9px", color: iconDef.color, fontWeight: 700, flexShrink: 0,
                  }}>
                    {iconDef.icon}
                  </div>
                  <span style={{ fontSize: "12px", color: "#d1d5db", fontFamily: "monospace" }}>{m.connectorType}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: "4px" }}>
                  <span style={{ fontSize: "10px", color: "#555" }}>read</span>
                  <span style={{ fontSize: "10px", fontFamily: "monospace", color: "#3b82f6" }}>
                    [{caps.read.map((r) => `"${r}"`).join(", ")}]
                  </span>
                  <span style={{ fontSize: "10px", color: "#555" }}>write</span>
                  <span style={{ fontSize: "10px", fontFamily: "monospace", color: caps.write.length ? "#10b981" : "#333" }}>
                    {caps.write.length ? `[${caps.write.map((r) => `"${r}"`).join(", ")}]` : "[]"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProvisioningTemplate({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <div style={{ marginTop: "12px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px" }}>
      <div
        onClick={onToggle}
        style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div style={{ fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Provisioning Template (YAML)
        </div>
        <span style={{ color: "#555", fontSize: "11px" }}>{expanded ? "▴" : "▾"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "0 16px 16px" }}>
          <pre style={{
            background: "#080808", border: "1px solid #1a1a1a", borderRadius: "6px",
            padding: "14px", fontSize: "11px", fontFamily: "monospace", color: "#888",
            overflow: "auto", lineHeight: "1.6", margin: 0,
          }}>
            {YAML_TEMPLATE}
          </pre>
          <button
            onClick={() => navigator.clipboard.writeText(YAML_TEMPLATE).catch(() => {})}
            style={{
              marginTop: "8px", background: "transparent", border: "1px solid #2a2a2a", color: "#888",
              padding: "5px 12px", borderRadius: "4px", fontSize: "11px", cursor: "pointer",
            }}
          >
            Copy template
          </button>
        </div>
      )}
    </div>
  );
}

export function AccessView() {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<ApiUser | null>(null);
  const [perimeter, setPerimeter] = useState<PerimeterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [perimeterLoading, setPerimeterLoading] = useState(false);
  const [manifestExpanded, setManifestExpanded] = useState(false);
  const [templateExpanded, setTemplateExpanded] = useState(false);
  const [provisionModal, setProvisionModal] = useState(false);
  const [provisionEmail, setProvisionEmail] = useState("");
  const [provisionRole, setProvisionRole] = useState("dev");
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/access/users")
      .then((r) => r.json() as Promise<ApiUser[]>)
      .then((data) => {
        const rows = Array.isArray(data) ? data : [];
        setUsers(rows);
        if (rows.length > 0) setSelectedUser(rows[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedUser) return;
    setPerimeterLoading(true);
    fetch(`/api/access/users/${selectedUser.id}/perimeter`)
      .then((r) => r.ok ? r.json() as Promise<PerimeterEntry[]> : [])
      .then((data) => setPerimeter(Array.isArray(data) ? data : []))
      .catch(() => setPerimeter([]))
      .finally(() => setPerimeterLoading(false));
  }, [selectedUser?.id]);

  async function handleProvision() {
    if (!provisionEmail.trim()) return;
    setProvisioning(true);
    setProvisionError(null);
    try {
      const r = await fetch("/api/access/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: provisionEmail.trim(), role: provisionRole }),
      });
      const data = await r.json() as { id: string; email: string; role: string } | { error: string };
      if (!r.ok) { setProvisionError("error" in data ? data.error : "Failed"); return; }
      const newUser = data as { id: string; email: string; role: string };
      const row: ApiUser = { id: newUser.id, email: newUser.email, role: newUser.role, createdAt: new Date().toISOString() };
      setUsers(prev => [...prev, row]);
      setSelectedUser(row);
      setProvisionModal(false);
      setProvisionEmail("");
      setProvisionRole("dev");
    } catch (e) {
      setProvisionError(String(e));
    } finally {
      setProvisioning(false);
    }
  }

  return (
    <div style={{ display: "flex", height: "100%", background: "#080808", overflow: "hidden" }}>
      {/* Left: User list */}
      <div style={{ width: "220px", flexShrink: 0, background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Users</div>
          <button
            onClick={() => { setProvisionModal(true); setProvisionError(null); }}
            style={{
              width: "100%", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
              color: "#10b981", padding: "6px 10px", borderRadius: "6px", fontSize: "11px", cursor: "pointer",
            }}
          >
            + Provision user
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
          {loading && (
            <div style={{ fontSize: "11px", color: "#555", padding: "12px 8px" }}>Loading…</div>
          )}
          {!loading && users.length === 0 && (
            <div style={{ fontSize: "11px", color: "#444", padding: "12px 8px" }}>No users provisioned</div>
          )}
          {users.map((user) => {
            const isSelected = selectedUser?.id === user.id;
            const roleColor = ROLE_COLORS[user.role] || "#888";
            return (
              <button
                key={user.id}
                onClick={() => setSelectedUser(user)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "10px",
                  borderRadius: "6px", cursor: "pointer", marginBottom: "2px",
                  background: isSelected ? "#111" : "transparent",
                  border: `1px solid ${isSelected ? "#2a2a2a" : "transparent"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    background: `${roleColor}18`, border: `1px solid ${roleColor}33`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "10px", color: roleColor, fontWeight: 700, flexShrink: 0,
                  }}>
                    {user.email.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: isSelected ? "#e5e5e5" : "#d1d5db", fontWeight: isSelected ? 600 : 400 }}>{user.email.split("@")[0]}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                      <span style={{
                        fontSize: "9px", padding: "1px 5px", borderRadius: "3px",
                        background: `${roleColor}18`, border: `1px solid ${roleColor}33`, color: roleColor,
                      }}>
                        {user.role}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Access matrix */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        {selectedUser ? (
          <>
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>
                  {selectedUser.email}
                </h2>
                <span style={{
                  fontSize: "11px", padding: "2px 8px", borderRadius: "4px",
                  background: `${ROLE_COLORS[selectedUser.role] || "#888"}18`,
                  border: `1px solid ${ROLE_COLORS[selectedUser.role] || "#888"}33`,
                  color: ROLE_COLORS[selectedUser.role] || "#888",
                }}>
                  {selectedUser.role}
                </span>
              </div>
            </div>

            {/* Access matrix table */}
            <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", overflow: "hidden", marginBottom: "0" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #1a1a1a" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Connector Access Matrix
                </span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
                    {["Connector", "Mode", "Read Scope", "Write Scope", "Status", ""].map((h) => (
                      <th key={h} style={{
                        padding: "8px 14px", textAlign: "left", fontSize: "10px", fontWeight: 600,
                        color: "#555", textTransform: "uppercase", letterSpacing: "0.08em",
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perimeterLoading && (
                    <tr><td colSpan={6} style={{ padding: "16px 14px", fontSize: "11px", color: "#555" }}>Loading perimeter…</td></tr>
                  )}
                  {!perimeterLoading && perimeter.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: "16px 14px", fontSize: "11px", color: "#444" }}>No connector permissions provisioned</td></tr>
                  )}
                  {perimeter.map((entry) => (
                    <ConnectorPerimeterRow key={entry.connectorName} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Permission envelope */}
            <div style={{ marginTop: "16px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>
                Permission Envelope
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {perimeter.flatMap((e) => [
                  ...e.readScopes.map((s) => ({ connector: e.connectorName, scope: s, type: "read", color: "#3b82f6" })),
                  ...e.writeScopes.map((s) => ({ connector: e.connectorName, scope: s, type: "write", color: "#10b981" })),
                ]).map((item, idx) => (
                  <span key={idx} style={{
                    fontSize: "10px", fontFamily: "monospace",
                    background: `${item.color}11`, border: `1px solid ${item.color}22`,
                    color: item.color, padding: "2px 7px", borderRadius: "4px",
                  }}>
                    {item.type === "write" ? "W" : "R"}:{item.connector.toLowerCase()}:{item.scope}
                  </span>
                ))}
                {perimeter.length === 0 && !perimeterLoading && (
                  <span style={{ fontSize: "11px", color: "#444" }}>No permissions assigned</span>
                )}
              </div>
            </div>

            <ManifestSection expanded={manifestExpanded} onToggle={() => setManifestExpanded(!manifestExpanded)} />
            <ProvisioningTemplate expanded={templateExpanded} onToggle={() => setTemplateExpanded(!templateExpanded)} />
          </>
        ) : (
          !loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
              <span style={{ fontSize: "13px", color: "#444" }}>Select a user to view their access</span>
            </div>
          )
        )}
      </div>

      {/* Provision user modal */}
      {provisionModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: "12px", padding: "24px", width: "360px", maxWidth: "90vw" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5", marginBottom: "16px" }}>Provision user</div>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "11px", color: "#888", display: "block", marginBottom: "4px" }}>Email</label>
              <input
                type="email"
                value={provisionEmail}
                onChange={(e) => setProvisionEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleProvision() }}
                placeholder="user@company.com"
                autoFocus
                style={{
                  width: "100%", background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: "6px",
                  color: "#e5e5e5", padding: "7px 10px", fontSize: "12px", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "11px", color: "#888", display: "block", marginBottom: "4px" }}>Role</label>
              <select
                value={provisionRole}
                onChange={(e) => setProvisionRole(e.target.value)}
                style={{
                  width: "100%", background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: "6px",
                  color: "#e5e5e5", padding: "7px 10px", fontSize: "12px", outline: "none",
                }}
              >
                {["admin", "sre", "dev", "pm", "ba"].map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            {provisionError && (
              <div style={{ fontSize: "11px", color: "#ef4444", marginBottom: "12px" }}>{provisionError}</div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setProvisionModal(false); setProvisionEmail(""); setProvisionError(null); }}
                style={{ flex: 1, background: "transparent", border: "1px solid #2a2a2a", color: "#888", padding: "8px", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}
              >
                Cancel
              </button>
              <button
                onClick={handleProvision}
                disabled={provisioning || !provisionEmail.trim()}
                style={{
                  flex: 1, background: provisioning || !provisionEmail.trim() ? "#0a0a0a" : "#10b981",
                  border: "none", color: provisioning || !provisionEmail.trim() ? "#444" : "#000",
                  padding: "8px", borderRadius: "6px",
                  cursor: provisioning || !provisionEmail.trim() ? "not-allowed" : "pointer",
                  fontSize: "12px", fontWeight: 700,
                }}
              >
                {provisioning ? "Provisioning…" : "Provision"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
