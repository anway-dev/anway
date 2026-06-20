"use client";
import { useState, useEffect } from "react";

interface AuthMethods {
  local: boolean;
  demo: boolean;
  oidc: boolean;
  google: boolean;
  github: boolean;
  setupRequired: boolean;
}

interface LoginPageProps {
  onLogin: () => void;
}

const GATEWAY_URL = typeof window !== "undefined"
  ? (process.env["NEXT_PUBLIC_GATEWAY_URL"] ?? "http://localhost:8510")
  : "http://localhost:8510";

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [methods, setMethods] = useState<AuthMethods>({ local: true, demo: false, oidc: false, google: false, github: false, setupRequired: false });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/methods")
      .then(r => r.json() as Promise<AuthMethods>)
      .then(setMethods)
      .catch(() => {});
  }, []);

  async function handleLocalLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok) { setError(d.error ?? "login failed"); return; }
      onLogin();
    } catch {
      setError("gateway unreachable");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("passwords do not match"); return; }
    if (password.length < 8) { setError("password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      const r = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok) { setError(d.error ?? "setup failed"); return; }
      onLogin();
    } catch {
      setError("gateway unreachable");
    } finally {
      setLoading(false);
    }
  }

  async function handleDemo() {
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/auth/demo", { method: "POST" });
      const d = await r.json() as { token?: string };
      if (d.token) {
        await fetch("/api/auth/set-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: d.token }) });
        onLogin();
      } else {
        setError("demo login failed — is DEMO_MODE=true set in gateway?");
      }
    } catch {
      setError("gateway unreachable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#080808", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>
      <div style={{ width: 360, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 8, padding: "32px 28px" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#10b981", letterSpacing: 1 }}>Anvay</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
            {methods.setupRequired ? "First-run setup" : "Software Intelligence Platform"}
          </div>
        </div>

        {/* First-run: create admin account */}
        {methods.local && methods.setupRequired && (
          <form onSubmit={handleSetup}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Admin email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@company.com"
                style={{ width: "100%", background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, padding: "8px 10px", color: "#e5e5e5", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="Min 8 characters"
                style={{ width: "100%", background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, padding: "8px 10px", color: "#e5e5e5", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{ width: "100%", background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, padding: "8px 10px", color: "#e5e5e5", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            {error && <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 12 }}>{error}</div>}
            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", padding: "9px 0", background: "#10b981", border: "none", borderRadius: 5, color: "#000", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "Creating account…" : "Create admin account"}
            </button>
          </form>
        )}

        {/* Local login form */}
        {methods.local && !methods.setupRequired && (
          <form onSubmit={handleLocalLogin}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@company.com"
                style={{ width: "100%", background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, padding: "8px 10px", color: "#e5e5e5", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{ width: "100%", background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, padding: "8px 10px", color: "#e5e5e5", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            {error && <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 12 }}>{error}</div>}
            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", padding: "9px 0", background: "#10b981", border: "none", borderRadius: 5, color: "#000", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {/* Divider */}
        {methods.local && !methods.setupRequired && (methods.oidc || methods.google || methods.github || methods.demo) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0" }}>
            <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
            <span style={{ fontSize: 11, color: "#444" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
          </div>
        )}

        {/* OAuth / SSO buttons — hidden during setup */}
        <div style={{ display: methods.setupRequired ? "none" : "flex", flexDirection: "column", gap: 8 }}>
          {methods.google && (
            <a href={`${GATEWAY_URL}/api/auth/google`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 0", background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, color: "#e5e5e5", fontSize: 13, textDecoration: "none", cursor: "pointer" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Continue with Google
            </a>
          )}
          {methods.github && (
            <a href={`${GATEWAY_URL}/api/auth/github`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 0", background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, color: "#e5e5e5", fontSize: 13, textDecoration: "none", cursor: "pointer" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#e5e5e5"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              Continue with GitHub
            </a>
          )}
          {methods.oidc && (
            <a href="/api/auth/oidc/login" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 0", background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, color: "#e5e5e5", fontSize: 13, textDecoration: "none", cursor: "pointer" }}>
              🔒 Sign in with SSO
            </a>
          )}
          {methods.demo && (
            <button
              onClick={handleDemo}
              disabled={loading}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 0", background: "#0d1a0d", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 5, color: "#10b981", fontSize: 13, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}
            >
              ⚡ Try Demo
            </button>
          )}
        </div>

        {!methods.local && !methods.demo && !methods.oidc && !methods.google && !methods.github && (
          <div style={{ textAlign: "center", fontSize: 12, color: "#555", marginTop: 8 }}>
            No login methods configured — check gateway environment variables.
          </div>
        )}
      </div>
    </div>
  );
}
