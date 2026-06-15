"use client";
import { useState, useRef, useEffect } from "react";
import { useEnv } from "@/lib/env-context";

export function EnvSelector() {
  const { env, setEnv, environments } = useEnv();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const active = environments.find(e => e.name === env);
  const color = active?.color ?? "#888";

  if (environments.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "4px 10px",
          background: "#0e0e0e", border: `1px solid ${color}44`,
          borderRadius: 4, cursor: "pointer", color: "#e5e5e5", fontSize: 12,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontWeight: 500 }}>{active?.label ?? env}</span>
        <span style={{ color: "#555", fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 6,
          minWidth: 160, overflow: "hidden",
        }}>
          {environments.map(e => (
            <button
              key={e.name}
              onClick={() => { setEnv(e.name); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "8px 12px", background: e.name === env ? "#151515" : "transparent",
                border: "none", cursor: "pointer", color: "#e5e5e5", fontSize: 12,
                textAlign: "left",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: e.color, display: "inline-block", flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{e.label}</span>
              {e.name === env && <span style={{ color: "#10b981", fontSize: 10 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
