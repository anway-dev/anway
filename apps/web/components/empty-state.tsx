interface EmptyStateProps {
  icon: string
  title: string
  description: string
  ctaLabel?: string
  onCta?: () => void
}

export function EmptyState({ icon, title, description, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "16px", padding: "48px" }}>
      <div style={{ fontSize: "40px", opacity: 0.3 }}>{icon}</div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "15px", fontWeight: 600, color: "#e5e5e5", marginBottom: "6px" }}>{title}</div>
        <div style={{ fontSize: "13px", color: "#555", maxWidth: "320px", lineHeight: "1.5" }}>{description}</div>
      </div>
      {ctaLabel && onCta && (
        <button
          onClick={onCta}
          style={{ padding: "8px 16px", background: "#1a2a1a", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "6px", color: "#10b981", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  )
}
