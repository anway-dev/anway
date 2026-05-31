"use client";
import { useState } from "react";
import { USERS, CONNECTOR_MANIFESTS, UserAccess, ConnectorAccess } from "@/lib/mock";

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

const YAML_TEMPLATE = `# Anvay access provisioning template
# Apply via: anvay access apply -f access.yaml

user: alice
workspace: acme-platform
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

function ConnectorRow({ conn, onEdit }: { conn: ConnectorAccess; onEdit: () => void }) {
  const mc = MODE_CONFIG[conn.mode];
  const isDisabled = conn.status === "disabled";

  return (
    <tr style={{ borderBottom: "1px solid #111", opacity: isDisabled ? 0.5 : 1 }}>
      <td style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "26px", height: "26px", borderRadius: "6px",
            background: `${conn.color}18`, border: `1px solid ${conn.color}33`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "10px", color: conn.color, fontWeight: 700, flexShrink: 0,
          }}>
            {conn.icon}
          </div>
          <span style={{ fontSize: "12px", color: "#d1d5db" }}>{conn.connectorName}</span>
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
        <ScopeChips scopes={conn.readScope} color="#3b82f6" />
      </td>
      <td style={{ padding: "10px 14px" }}>
        <ScopeChips scopes={conn.writeScope} color="#10b981" />
      </td>
      <td style={{ padding: "10px 14px" }}>
        <span style={{
          fontSize: "10px", padding: "1px 6px", borderRadius: "3px",
          background: conn.status === "active" ? "rgba(16,185,129,0.1)" : conn.status === "limited" ? "rgba(245,158,11,0.1)" : "rgba(85,85,85,0.1)",
          border: `1px solid ${conn.status === "active" ? "rgba(16,185,129,0.3)" : conn.status === "limited" ? "rgba(245,158,11,0.3)" : "rgba(85,85,85,0.3)"}`,
          color: conn.status === "active" ? "#10b981" : conn.status === "limited" ? "#f59e0b" : "#555",
        }}>
          {conn.status}
        </span>
      </td>
      <td style={{ padding: "10px 14px" }}>
        <button
          onClick={onEdit}
          style={{
            background: "transparent", border: "1px solid #2a2a2a", color: "#555",
            padding: "3px 8px", borderRadius: "4px", fontSize: "10px", cursor: "pointer",
          }}
        >
          Edit
        </button>
      </td>
    </tr>
  );
}

function ManifestSection({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
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
          {CONNECTOR_MANIFESTS.map((m) => (
            <div key={m.connectorId} style={{ marginBottom: "10px", background: "#111", border: "1px solid #1a1a1a", borderRadius: "6px", padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <div style={{
                  width: "22px", height: "22px", borderRadius: "4px",
                  background: `${m.color}18`, border: `1px solid ${m.color}33`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "9px", color: m.color, fontWeight: 700, flexShrink: 0,
                }}>
                  {m.icon}
                </div>
                <span style={{ fontSize: "12px", color: "#d1d5db", fontFamily: "monospace" }}>{m.connectorId}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: "4px" }}>
                <span style={{ fontSize: "10px", color: "#555" }}>read</span>
                <span style={{ fontSize: "10px", fontFamily: "monospace", color: "#3b82f6" }}>
                  [{m.capabilities.read.map((r) => `"${r}"`).join(", ")}]
                </span>
                <span style={{ fontSize: "10px", color: "#555" }}>write</span>
                <span style={{ fontSize: "10px", fontFamily: "monospace", color: m.capabilities.write.length ? "#10b981" : "#333" }}>
                  {m.capabilities.write.length ? `[${m.capabilities.write.map((r) => `"${r}"`).join(", ")}]` : "[]"}
                </span>
              </div>
            </div>
          ))}
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
          <button style={{
            marginTop: "8px", background: "transparent", border: "1px solid #2a2a2a", color: "#888",
            padding: "5px 12px", borderRadius: "4px", fontSize: "11px", cursor: "pointer",
          }}>
            Copy template
          </button>
        </div>
      )}
    </div>
  );
}

export function AccessView() {
  const [selectedUser, setSelectedUser] = useState<UserAccess>(USERS[0]);
  const [manifestExpanded, setManifestExpanded] = useState(false);
  const [templateExpanded, setTemplateExpanded] = useState(false);

  return (
    <div style={{ display: "flex", height: "100%", background: "#080808", overflow: "hidden" }}>
      {/* Left: User list */}
      <div style={{ width: "220px", flexShrink: 0, background: "#0a0a0a", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #1a1a1a" }}>
          <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Users</div>
          <button style={{
            width: "100%", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
            color: "#10b981", padding: "6px 10px", borderRadius: "6px", fontSize: "11px", cursor: "pointer",
          }}>
            + Provision user
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
          {USERS.map((user) => {
            const isSelected = selectedUser.id === user.id;
            const roleColor = ROLE_COLORS[user.authRole] || "#888";
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
                    {user.name.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: isSelected ? "#e5e5e5" : "#d1d5db", fontWeight: isSelected ? 600 : 400 }}>{user.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                      <span style={{
                        fontSize: "9px", padding: "1px 5px", borderRadius: "3px",
                        background: `${roleColor}18`, border: `1px solid ${roleColor}33`, color: roleColor,
                      }}>
                        {user.authRole}
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
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>
              {selectedUser.name}
            </h2>
            <span style={{
              fontSize: "11px", padding: "2px 8px", borderRadius: "4px",
              background: `${ROLE_COLORS[selectedUser.authRole] || "#888"}18`,
              border: `1px solid ${ROLE_COLORS[selectedUser.authRole] || "#888"}33`,
              color: ROLE_COLORS[selectedUser.authRole] || "#888",
            }}>
              {selectedUser.authRole}
            </span>
          </div>
          <div style={{ fontSize: "12px", color: "#555" }}>{selectedUser.email}</div>
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
              {selectedUser.connectors.map((conn) => (
                <ConnectorRow key={conn.connectorId} conn={conn} onEdit={() => {}} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Permission summary */}
        <div style={{ marginTop: "16px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "14px 16px" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>
            Permission Envelope
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {selectedUser.connectors
              .filter((c) => c.mode !== "none")
              .flatMap((c) => [
                ...c.readScope.map((s) => ({ connector: c.connectorName, scope: s, type: "read", color: "#3b82f6" })),
                ...c.writeScope.map((s) => ({ connector: c.connectorName, scope: s, type: "write", color: "#10b981" })),
              ])
              .map((item, idx) => (
                <span key={idx} style={{
                  fontSize: "10px", fontFamily: "monospace",
                  background: `${item.color}11`, border: `1px solid ${item.color}22`,
                  color: item.color, padding: "2px 7px", borderRadius: "4px",
                }}>
                  {item.type === "write" ? "W" : "R"}:{item.connector.toLowerCase().replace(" ", "-")}:{item.scope}
                </span>
              ))}
            {selectedUser.connectors.filter((c) => c.mode === "none").map((c) => (
              <span key={c.connectorId} style={{
                fontSize: "10px", fontFamily: "monospace",
                background: "rgba(85,85,85,0.1)", border: "1px solid rgba(85,85,85,0.2)",
                color: "#444", padding: "2px 7px", borderRadius: "4px",
              }}>
                BLOCKED:{c.connectorName.toLowerCase().replace(" ", "-")}
              </span>
            ))}
          </div>
        </div>

        <ManifestSection expanded={manifestExpanded} onToggle={() => setManifestExpanded(!manifestExpanded)} />
        <ProvisioningTemplate expanded={templateExpanded} onToggle={() => setTemplateExpanded(!templateExpanded)} />
      </div>
    </div>
  );
}
