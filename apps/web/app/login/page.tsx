'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const GATEWAY = process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? 'http://127.0.0.1:4000'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') ?? '/'

  const [email, setEmail] = useState('dev@anvay.local')
  const [tenantId, setTenantId] = useState('00000000-0000-0000-0000-000000000001')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const resp = await fetch(`${GATEWAY}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tenantId }),
      })

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'Login failed' }))
        setError((body as { error?: string }).error ?? `Login failed (${resp.status})`)
        setLoading(false)
        return
      }

      const { token } = await resp.json() as { token: string }

      // Store token in httpOnly cookie via server route
      await fetch('/api/auth/set-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      router.push(redirect)
    } catch {
      setError('Gateway unreachable. Is the server running?')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#080808', color: '#e5e5e5', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        width: '400px', padding: '40px', background: '#0a0a0a',
        border: '1px solid #1a1a1a', borderRadius: '12px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#10b981', marginBottom: '8px' }}>anvay</div>
          <div style={{ fontSize: '12px', color: '#555' }}>Sign in to continue</div>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{
                width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #2a2a2a',
                borderRadius: '6px', color: '#e5e5e5', fontSize: '13px', outline: 'none',
              }}
              placeholder="dev@anvay.local"
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tenant ID</label>
            <input
              type="text"
              value={tenantId}
              onChange={e => setTenantId(e.target.value)}
              required
              pattern="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
              style={{
                width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #2a2a2a',
                borderRadius: '6px', color: '#e5e5e5', fontSize: '13px', outline: 'none',
                fontFamily: 'monospace',
              }}
              placeholder="00000000-0000-0000-0000-000000000001"
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
            disabled={loading}
            style={{
              width: '100%', padding: '10px', background: loading ? '#0e3a28' : '#10b981',
              border: 'none', borderRadius: '6px', color: loading ? '#666' : '#080808',
              fontSize: '13px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '10px', color: '#444' }}>
          Dev mode: any email + valid tenant UUID works
        </div>
      </div>
    </div>
  )
}
