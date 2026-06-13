"use client";

export function PreviewBanner() {
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        padding: "8px 16px",
        background: "#0e0e0e",
        borderLeft: "3px solid #f59e0b",
        borderBottom: "1px solid #2a2a2a",
        fontFamily: "monospace",
      }}
    >
      <span style={{ fontSize: "11px", fontWeight: 700, color: "#f59e0b", letterSpacing: "0.04em" }}>
        DESIGN PREVIEW — not connected to live data
      </span>
      <span style={{ fontSize: "10px", color: "#888" }}>
        This view is a design mockup; backend wiring pending.
      </span>
    </div>
  );
}
