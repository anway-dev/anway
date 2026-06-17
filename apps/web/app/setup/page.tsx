'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const GATEWAY = process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? 'http://127.0.0.1:4000'

export default function SetupPage() {
  const router = useRouter()
  const [orgName, setOrgName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  // If already initialized, redirect to login
  useEffect(() => {
    fetch(`${GATEWAY}/api/setup/status`)
      .then(r => r.ok ? r.json() as Promise<{ initialized: boolean }> : { initialized: false })
      .then(s => {
        if (s.initialized) router.replace('/login')
        else setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const resp = await fetch(`${GATEWAY}/api/setup/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgName, adminEmail }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Setup failed' }))
        setError((body as { error?: string }).error ?? `Setup failed (${resp.status})`)
        setLoading(false)
        return
      }
      const { token } = await resp.json() as { token: string }
      await fetch('/api/auth/set-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      router.push('/')
    } catch {
      setError('Gateway unreachable. Is the server running?')
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080808' }}>
        <div style={{ fontSize: '12px', color: '#555', fontFamily: 'monospace' }}>checking...</div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#080808', color: '#e5e5e5', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        width: '440px', padding: '40px', background: '#0a0a0a',
        border: '1px solid #1a1a1a', borderRadius: '12px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#10b981', marginBottom: '8px' }}>anvay</div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#e5e5e5', marginBottom: '6px' }}>Set up your workspace</div>
          <div style={{ fontSize: '12px', color: '#555' }}>First-time setup. Creates your organization and admin account.</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Organization Name</label>
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              required
              autoFocus
              style={{
                width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #2a2a2a',
                borderRadius: '6px', color: '#e5e5e5', fontSize: '13px', outline: 'none',
              }}
              placeholder="Acme Corp"
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Admin Email</label>
            <input
              type="email"
              value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)}
              required
              style={{
                width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #2a2a2a',
                borderRadius: '6px', color: '#e5e5e5', fontSize: '13px', outline: 'none',
              }}
              placeholder="admin@yourorg.com"
            />
          </div>

          {error && (
            <div style={{
              padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '6px', fontSize: '11px', color: '#ef4444', marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !orgName || !adminEmail}
            style={{
              width: '100%', padding: '10px',
              background: loading || !orgName || !adminEmail ? '#0e3a28' : '#10b981',
              border: 'none', borderRadius: '6px',
              color: loading || !orgName || !adminEmail ? '#666' : '#080808',
              fontSize: '13px', fontWeight: 600,
              cursor: loading || !orgName || !adminEmail ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Setting up…' : 'Create Workspace'}
          </button>
        </form>

        <div style={{ marginTop: '20px', padding: '12px', background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: '6px', fontSize: '11px', color: '#555', fontFamily: 'monospace' }}>
          This creates the first admin account. Additional users are provisioned via Access settings.
        </div>
      </div>
    </div>
  )
}
