"use client";
import { useState, useEffect } from "react";

interface PendingGate {
  id: string;
  toolName: string;
  description: string;
  confidence?: number;
  createdAt: string;
}

const MOCK_PENDING: PendingGate[] = [
  { id: "gate-1", toolName: "create_incident", description: "Create incident for payments-api error rate spike", confidence: 0.72, createdAt: new Date(Date.now() - 120_000).toISOString() },
  { id: "gate-2", toolName: "notify_oncall", description: "Notify oncall team about deploy failure in auth-service", confidence: 0.85, createdAt: new Date(Date.now() - 300_000).toISOString() },
];

export function ApprovalsView() {
  const [pending, setPending] = useState<PendingGate[]>(MOCK_PENDING);
  const [processing, setProcessing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const iv = setInterval(async () => {
      // Refresh every 10s — currently uses mock
    }, 10_000);
    return () => clearInterval(iv);
  }, []);

  async function handleDecision(gateId: string, decision: 'approved' | 'rejected') {
    setProcessing(gateId);
    setMessage(null);
    try {
      const resp = await fetch(`/api/gate/${gateId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (resp.ok) {
        setPending(prev => prev.filter(g => g.id !== gateId));
        setMessage(`Gate ${decision} — ${gateId}`);
      } else {
        const err = await resp.json() as { error?: string };
        setMessage(`Error: ${err.error ?? 'unknown'}`);
      }
    } catch {
      setMessage('Network error — gateway unreachable');
    } finally {
      setProcessing(null);
    }
  }

  const toolLabel = (name: string) => {
    const action = name.split('.').pop() ?? name;
    return action.replace(/_/g, ' ');
  };

  return (
    <div style={{ padding: "24px", height: "100%", overflowY: "auto" }}>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Governance</div>
        <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#e5e5e5", margin: 0 }}>Pending Approvals</h2>
        <p style={{ fontSize: "12px", color: "#888", marginTop: "6px" }}>
          V1 trust principle: all write actions require explicit approval.
        </p>
      </div>

      {message && (
        <div style={{
          padding: "8px 12px", marginBottom: "16px", borderRadius: "4px",
          background: message.startsWith('Error') ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)",
          border: `1px solid ${message.startsWith('Error') ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"}`,
          color: message.startsWith('Error') ? "#ef4444" : "#10b981",
          fontSize: "11px", fontFamily: "monospace",
        }}>
          {message}
        </div>
      )}

      {pending.length === 0 ? (
        <div style={{
          padding: "40px", textAlign: "center", border: "1px dashed #1a1a1a", borderRadius: "8px",
        }}>
          <div style={{ fontSize: "24px", marginBottom: "8px", color: "#333" }}>✓</div>
          <div style={{ fontSize: "13px", color: "#555", fontFamily: "monospace" }}>
            No pending approvals — all actions within auto-approve policy
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {pending.map(gate => (
            <div key={gate.id} style={{
              background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "16px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{
                    fontSize: "9px", background: "rgba(239,68,68,0.1)", color: "#ef4444",
                    border: "1px solid rgba(239,68,68,0.2)", padding: "1px 5px", borderRadius: "3px",
                    fontFamily: "monospace", textTransform: "uppercase",
                  }}>
                    {toolLabel(gate.toolName)}
                  </span>
                  {gate.confidence !== undefined && (
                    <span style={{
                      fontSize: "9px", color: gate.confidence > 0.8 ? "#10b981" : "#f59e0b",
                      fontFamily: "monospace",
                    }}>
                      confidence {gate.confidence.toFixed(2)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: "#e5e5e5", fontFamily: "monospace", marginBottom: "2px" }}>
                  {gate.description}
                </div>
                <div style={{ fontSize: "10px", color: "#555", fontFamily: "monospace" }}>
                  {new Date(gate.createdAt).toLocaleTimeString()}
                </div>
              </div>

              <div style={{ display: "flex", gap: "6px", flexShrink: 0, marginLeft: "16px" }}>
                <button onClick={() => handleDecision(gate.id, 'approved')}
                  disabled={processing === gate.id}
                  style={{
                    padding: "6px 14px", borderRadius: "4px", border: "none",
                    background: processing === gate.id ? "#0a0a0a" : "rgba(16,185,129,0.15)",
                    color: processing === gate.id ? "#444" : "#10b981",
                    fontSize: "11px", fontWeight: 700, cursor: processing === gate.id ? "not-allowed" : "pointer",
                  }}
                >
                  {processing === gate.id ? '...' : 'Approve'}
                </button>
                <button onClick={() => handleDecision(gate.id, 'rejected')}
                  disabled={processing === gate.id}
                  style={{
                    padding: "6px 14px", borderRadius: "4px", border: "none",
                    background: processing === gate.id ? "#0a0a0a" : "rgba(239,68,68,0.1)",
                    color: processing === gate.id ? "#444" : "#ef4444",
                    fontSize: "11px", fontWeight: 700, cursor: processing === gate.id ? "not-allowed" : "pointer",
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
