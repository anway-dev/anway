"use client"
import { Component, type ReactNode } from "react"

interface Props { children: ReactNode; viewName?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "#080808" }}>
          <div style={{ background: "#0e0e0e", border: "1px solid #2a1a1a", borderRadius: "8px", padding: "24px", maxWidth: "480px", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <span style={{ color: "#ef4444", fontSize: "18px" }}>⚠</span>
              <span style={{ color: "#e5e5e5", fontWeight: 600, fontSize: "14px" }}>
                {this.props.viewName ?? "View"} failed to render
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "#888", fontFamily: "monospace", background: "#111", border: "1px solid #1a1a1a", borderRadius: "4px", padding: "10px", marginBottom: "16px", wordBreak: "break-all" }}>
              {this.state.error.message}
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ padding: "7px 14px", background: "#1a2a1a", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "6px", color: "#10b981", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
