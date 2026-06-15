"use client";
import { useState } from "react";

interface OnboardingModalProps {
  onDismiss: () => void;
  onGoToConnectors: () => void;
  onGoToChat: () => void;
}

export function OnboardingModal({ onDismiss, onGoToConnectors, onGoToChat }: OnboardingModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
    }}>
      <div style={{
        background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: "12px",
        maxWidth: "500px", width: "100%", padding: "28px 24px",
        margin: "16px", boxShadow: "0 0 40px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <div style={{
            width: "28px", height: "28px", background: "#10b981", borderRadius: "7px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "13px", fontWeight: 900, color: "#000",
          }}>A</div>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#e5e5e5", letterSpacing: "-0.02em" }}>anvay</span>
          {step > 1 && (
            <span style={{ marginLeft: "auto", fontSize: "11px", color: "#555", fontFamily: "monospace" }}>
              Step {step} of 3
            </span>
          )}
        </div>

        {/* Step indicators */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
          {([1, 2, 3] as const).map(s => (
            <div key={s} style={{
              flex: 1, height: "2px", borderRadius: "1px",
              background: s <= step ? "#10b981" : "#1a1a1a",
              transition: "background 0.2s",
            }} />
          ))}
        </div>

        {/* Step content */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5", marginBottom: "8px" }}>
              Connect your first connector
            </div>
            <div style={{ fontSize: "12px", color: "#888", lineHeight: "1.7", marginBottom: "16px" }}>
              Anvay integrates with your existing tools — GitHub, Datadog, Linear, K8s, ArgoCD, and more.
              Start by connecting a connector to build your knowledge graph.
            </div>
            <button
              onClick={() => { onGoToConnectors(); }}
              style={{
                width: "100%", padding: "10px", borderRadius: "6px",
                background: "#10b981", color: "#000", border: "none",
                fontSize: "13px", fontWeight: 700, cursor: "pointer",
                marginBottom: "8px",
              }}
            >
              Connect a connector
            </button>
            <button
              onClick={() => setStep(2)}
              style={{
                width: "100%", padding: "10px", borderRadius: "6px",
                background: "transparent", color: "#555", border: "1px solid #1a1a1a",
                fontSize: "12px", cursor: "pointer",
              }}
            >
              Skip → Bootstrap graph
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5", marginBottom: "8px" }}>
              Bootstrap your knowledge graph
            </div>
            <div style={{ fontSize: "12px", color: "#888", lineHeight: "1.7", marginBottom: "16px" }}>
              Anvay scans your connected tools to build an intelligent knowledge graph — services,
              repos, teams, deploys, and incidents linked together. This powers every query you make.
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "12px", background: "#0a0a0a", borderRadius: "6px",
              border: "1px solid #1a1a1a", marginBottom: "16px",
            }}>
              <div style={{
                width: "8px", height: "8px", borderRadius: "50%",
                background: "#10b981", boxShadow: "0 0 8px #10b981",
                animation: "pulse-dot 1.5s ease-in-out infinite",
              }} />
              <span style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>
                Bootstrapping after connector registration…
              </span>
            </div>
            <style>{`@keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
            <button
              onClick={() => { onGoToConnectors(); }}
              style={{
                width: "100%", padding: "10px", borderRadius: "6px",
                background: "#10b981", color: "#000", border: "none",
                fontSize: "13px", fontWeight: 700, cursor: "pointer",
                marginBottom: "8px",
              }}
            >
              Go to Connectors
            </button>
            <button
              onClick={() => setStep(3)}
              style={{
                width: "100%", padding: "10px", borderRadius: "6px",
                background: "transparent", color: "#555", border: "1px solid #1a1a1a",
                fontSize: "12px", cursor: "pointer",
              }}
            >
              Skip → Start chatting
            </button>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#e5e5e5", marginBottom: "8px" }}>
              Start chatting with Anvay
            </div>
            <div style={{ fontSize: "12px", color: "#888", lineHeight: "1.7", marginBottom: "16px" }}>
              Ask questions about your infrastructure, debug incidents, review PRs, check deployments —
              all from one surface. Anvay orchestrates agents across all your tools.
            </div>
            <button
              onClick={() => { onGoToChat(); }}
              style={{
                width: "100%", padding: "10px", borderRadius: "6px",
                background: "#10b981", color: "#000", border: "none",
                fontSize: "13px", fontWeight: 700, cursor: "pointer",
                marginBottom: "8px",
              }}
            >
              Open Chat
            </button>
          </div>
        )}

        {/* Dismiss footer */}
        <div style={{
          marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #1a1a1a",
          display: "flex", justifyContent: "flex-end",
        }}>
          <button
            onClick={onDismiss}
            style={{
              background: "none", border: "none", color: "#444",
              fontSize: "11px", cursor: "pointer",
            }}
          >
            Dismiss onboarding
          </button>
        </div>
      </div>
    </div>
  );
}
